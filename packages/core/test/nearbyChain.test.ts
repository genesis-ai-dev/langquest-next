import { createHash, createPublicKey, verify as edVerify } from 'node:crypto';
import fc from 'fast-check';
import {
  checkChain, newcomerProfileId, peopleWithChains, revokedLater, signedBy, type CheckChainOptions, type ChainVerdict, type InviteLink, type JoinPass, type RevocationList, type WorkerLink
} from '../src/nearbyChain';
import { nearbyDoor, type DoorFacts } from '../src/nearbyDoor';
import { base64urlEncode, linkText, nearbyBytes, passText } from '../src/nearbySigning';
import { foldOrg } from '../src/org';
import { MANAGE_PRIVILEGES, type Privilege } from '../src/orgTerms';
import { OBJECT_MEMBER_NAMES } from '../src/validate';
import type { AnyEvent } from '../src/events';
import { buildOrgFixture } from './fixtures';
import * as v from './nearbyVectors';

const sha256 = (bytes: Uint8Array) => new Uint8Array(createHash('sha256').update(bytes).digest());

/** A signature only this key and these bytes give: real Ed25519 has its own vector below. */
const fakeSign = (key: string, message: Uint8Array) =>
  base64urlEncode(new Uint8Array(createHash('sha512').update(key).update('|').update(message).digest()));
const fakeVerify = (key: string, message: Uint8Array, sig: string) => fakeSign(key, message) === sig;

const keyOf = (n: number) => base64urlEncode(new Uint8Array(32).fill(n));
const ROOT = keyOf(9);
const OTHER_ROOT = keyOf(8);
const INVITER_KEY = keyOf(1);
const NEWCOMER_KEY = keyOf(2);
const SALT = base64urlEncode(new Uint8Array(16).fill(3));
const ORG = 'org1';
const LANG = 'lang1';
const NOW = 1_000_000;
const INVITER = 'inviter-profile';

const rootKeys = new Map([['k1', ROOT], ['k2', OTHER_ROOT]]);
const options = (over: Partial<CheckChainOptions> = {}): CheckChainOptions => ({ rootKeys, orgId: ORG, languageId: LANG, now: NOW, verify: fakeVerify, sha256, ...over });

type WorkerBody = WorkerLink['body'];
function workerLink(over: Partial<WorkerBody> = {}, signer = ROOT, kid = 'k1'): WorkerLink {
  const body: WorkerBody = {
    installKey: INVITER_KEY, profileId: INVITER, deviceId: 'device-a', expiresAt: NOW + 1000,
    org: { orgId: ORG, orgSeq: 40, scopes: [{ level: 'language', languageId: LANG, privileges: ['invite_members', 'translate', 'review'] }] },
    ...over
  };
  return { kind: 'worker@1', kid, body, sig: fakeSign(signer, nearbyBytes('link', linkText({ kind: 'worker@1', kid, body }, ''))) };
}

function joinPass(over: Partial<JoinPass['body']> = {}, signer = ROOT, kid = 'k1'): JoinPass {
  const body: JoinPass['body'] = {
    passId: 'p1', orgId: ORG, languageId: LANG, inviter: INVITER, inviterKey: INVITER_KEY,
    roles: [{ roleId: 'translator', privileges: ['translate'] }, { roleId: 'admin', privileges: ['translate', 'manage_structure'] }],
    maxUses: 3, expiresAt: NOW + 1000, ...over
  };
  return { kind: 'pass@1', kid, body, sig: fakeSign(signer, nearbyBytes('pass', passText({ kind: 'pass@1', kid, body }))) };
}

async function inviteLink(before: WorkerLink, over: Partial<InviteLink['body']> = {}, signer = before.body.installKey): Promise<InviteLink> {
  const installKey = over.installKey ?? NEWCOMER_KEY;
  const idSalt = over.idSalt ?? SALT;
  const body: InviteLink['body'] = {
    pass: joinPass(), installKey, idSalt, profileId: (await newcomerProfileId(installKey, idSalt, sha256)) ?? 'no-id', deviceId: 'device-b', name: 'Asha',
    roleId: 'translator', privileges: ['translate'], ...over
  };
  return { kind: 'invite@1', body, sig: fakeSign(signer, nearbyBytes('link', linkText({ kind: 'invite@1', body }, before.sig))) };
}

const reasonOf = async (chain: readonly unknown[], over: Partial<CheckChainOptions> = {}) => {
  const out = await checkChain(chain, options(over));
  return out.ok ? 'accepted' : out.reason;
};

describe('newcomerProfileId', () => {
  it('holds its golden vector, worked out with Python', async () => {
    expect(await newcomerProfileId(v.PUBLIC_KEY, v.NEWCOMER_SALT, sha256)).toBe(v.NEWCOMER_ID);
    expect(v.NEWCOMER_ID.replace(/-/g, '').slice(0, 12)).toBe(v.NEWCOMER_HASH.slice(0, 12));
  });

  it('is a lower-case UUID of version 4, for any key and salt, and takes a promise from sha256', async () => {
    await fc.assert(fc.asyncProperty(fc.uint8Array({ minLength: 32, maxLength: 32 }), fc.uint8Array({ minLength: 16, maxLength: 16 }), async (key, salt) => {
      const id = await newcomerProfileId(base64urlEncode(key), base64urlEncode(salt), async (b) => sha256(b));
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }), { numRuns: 50 });
  });

  it('gives a second person on one install another id, through the salt', async () => {
    const other = base64urlEncode(new Uint8Array(16).fill(4));
    expect(await newcomerProfileId(NEWCOMER_KEY, SALT, sha256)).not.toBe(await newcomerProfileId(NEWCOMER_KEY, other, sha256));
  });

  it('refuses a key or salt that is not canonical, or of the wrong length', async () => {
    const spareBits = `${NEWCOMER_KEY.slice(0, 42)}B`;
    expect(await newcomerProfileId(spareBits, SALT, sha256)).toBeNull();
    expect(await newcomerProfileId(`${NEWCOMER_KEY}=`, SALT, sha256)).toBeNull();
    expect(await newcomerProfileId(NEWCOMER_KEY, base64urlEncode(new Uint8Array(15)), sha256)).toBeNull();
    expect(await newcomerProfileId(NEWCOMER_KEY, base64urlEncode(new Uint8Array(17)), sha256)).toBeNull();
  });
});

describe('checkChain over real Ed25519', () => {
  const spki = (key: string) => createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(key, 'base64url')]), format: 'der', type: 'spki' });
  const real = (key: string, message: Uint8Array, sig: string) => edVerify(null, message, spki(key), Buffer.from(sig, 'base64url'));
  const golden = (over: Partial<CheckChainOptions> = {}) => checkChain(v.CHAIN, { rootKeys: new Map([['k1', v.CHAIN_ROOT_KEY]]), orgId: 'org1', languageId: 'lang1', now: null, verify: real, sha256, ...over });

  it('accepts the golden chain', async () => {
    expect(await golden()).toEqual({
      ok: true,
      holder: { installKey: v.PUBLIC_KEY, profileId: v.NEWCOMER_ID, deviceId: '44444444-4444-4444-8444-444444444444', name: 'Yé' },
      org: { orgId: 'org1', orgSeq: 40, scopes: [{ level: 'language', languageId: 'lang1', privileges: ['translate'] }] },
      links: 2,
      inviter: v.PROFILE,
      roleId: 'translator'
    });
  });

  it('accepts its first link alone, and refuses under another root', async () => {
    const out = await checkChain(v.CHAIN.slice(0, 1), { rootKeys: new Map([['k1', v.CHAIN_ROOT_KEY]]), orgId: 'org1', now: null, verify: real, sha256 });
    expect(out).toMatchObject({ ok: true, links: 1, holder: { installKey: v.CHAIN_INVITER_KEY, profileId: v.PROFILE } });
    expect(await golden({ rootKeys: new Map([['k1', v.CHAIN_INVITER_KEY]]) })).toMatchObject({ ok: false });
  });

  it('refuses the chain with any signed word changed', async () => {
    const copy = JSON.parse(JSON.stringify(v.CHAIN)) as [WorkerLink, InviteLink];
    copy[1].body.name = 'Mallory';
    expect(await checkChain(copy, { rootKeys: new Map([['k1', v.CHAIN_ROOT_KEY]]), orgId: 'org1', now: null, verify: real, sha256 })).toEqual({ ok: false, reason: 'bad link signature' });
  });
});

describe('checkChain accepts', () => {
  it('one link: the holder and the organization as signed', async () => {
    const link = workerLink();
    expect(await checkChain([link], options())).toEqual({ ok: true, holder: { installKey: INVITER_KEY, profileId: INVITER, deviceId: 'device-a' }, org: link.body.org, links: 1 });
  });

  it('two links: the newcomer holds the invite\'s privileges at language scope, with the first link\'s orgSeq', async () => {
    const first = workerLink();
    const out = await checkChain([first, await inviteLink(first)], options());
    expect(out).toEqual({
      ok: true,
      holder: { installKey: NEWCOMER_KEY, profileId: await newcomerProfileId(NEWCOMER_KEY, SALT, sha256), deviceId: 'device-b', name: 'Asha' },
      org: { orgId: ORG, orgSeq: 40, scopes: [{ level: 'language', languageId: LANG, privileges: ['translate'] }] },
      links: 2, inviter: INVITER, roleId: 'translator'
    });
  });

  it('a verify and a sha256 that answer with promises, as on the Worker', async () => {
    const first = workerLink();
    const chain = [first, await inviteLink(first)];
    expect(await reasonOf(chain, { verify: async (...a) => fakeVerify(...a), sha256: async (b) => sha256(b) })).toBe('accepted');
  });

  it('a retired key still listed, and an inviter at organization scope', async () => {
    const first = workerLink({ org: { orgId: ORG, orgSeq: 1, scopes: [{ level: 'org', privileges: ['invite_members', 'translate'] }] } }, OTHER_ROOT, 'k2');
    expect(await reasonOf([first, await inviteLink(first)])).toBe('accepted');
  });

  it('with no language asked for, the pass names it', async () => {
    const first = workerLink();
    const out = await checkChain([first, await inviteLink(first)], { rootKeys, orgId: ORG, now: NOW, verify: fakeVerify, sha256 });
    expect(out).toMatchObject({ ok: true, org: { scopes: [{ languageId: LANG }] } });
  });

  it('a role\'s privileges in another order, since it is the same role', async () => {
    const first = workerLink({ org: { orgId: ORG, orgSeq: 1, scopes: [{ level: 'language', languageId: LANG, privileges: ['invite_members', 'translate', 'review'] }] } });
    const pass = joinPass({ roles: [{ roleId: 'both', privileges: ['translate', 'review'] }] });
    expect(await reasonOf([first, await inviteLink(first, { pass, roleId: 'both', privileges: ['review', 'translate'] })])).toBe('accepted');
  });
});

describe('expiry', () => {
  it('a link and a pass last through their expiresAt, and not past it', async () => {
    const at = workerLink({ expiresAt: NOW });
    expect(await reasonOf([at])).toBe('accepted');
    expect(await reasonOf([workerLink({ expiresAt: NOW - 1 })])).toBe('certificate expired');
    const first = workerLink();
    expect(await reasonOf([first, await inviteLink(first, { pass: joinPass({ expiresAt: NOW }) })])).toBe('accepted');
    expect(await reasonOf([first, await inviteLink(first, { pass: joinPass({ expiresAt: NOW - 1 }) })])).toBe('pass expired');
  });

  it('`now: null` skips every expiry: batches are carried for months', async () => {
    const first = workerLink({ expiresAt: 1 });
    const chain = [first, await inviteLink(first, { pass: joinPass({ expiresAt: 1 }) })];
    expect(await reasonOf(chain)).toBe('certificate expired');
    expect(await reasonOf(chain, { now: null })).toBe('accepted');
  });

  it('a clock of NaN is past everything', async () => {
    expect(await reasonOf([workerLink()], { now: Number.NaN })).toBe('certificate expired');
  });
});

describe('checkChain refuses', () => {
  const noVerify = () => { throw new Error('verify must not run'); };

  it('no chain, and more links than asked', async () => {
    expect(await reasonOf([])).toBe('no chain');
    expect(await reasonOf({} as unknown as unknown[])).toBe('no chain');
    const first = workerLink();
    const second = await inviteLink(first);
    expect(await reasonOf([first, second, second], { verify: noVerify })).toBe('too many links');
    expect(await reasonOf([first, second], { maxLinks: 1, verify: noVerify })).toBe('too many links');
  });

  it('a kind it does not know, before any verify', async () => {
    const first = workerLink();
    expect(await reasonOf([{ ...first, kind: 'worker@2' }], { verify: noVerify })).toBe('unknown link kind');
    expect(await reasonOf([first, { ...(await inviteLink(first)), kind: 'invite@2' }], { verify: noVerify })).toBe('unknown link kind');
    expect(await reasonOf([null], { verify: noVerify })).toBe('unknown link kind');
    expect(await reasonOf(['worker@1'], { verify: noVerify })).toBe('unknown link kind');
    expect(await reasonOf([first, [first]], { verify: noVerify })).toBe('unknown link kind');
  });

  it('a known kind out of its place', async () => {
    const first = workerLink();
    const second = await inviteLink(first);
    expect(await reasonOf([second], { verify: noVerify })).toBe('link out of order');
    expect(await reasonOf([first, first], { verify: noVerify })).toBe('link out of order');
  });

  it('an unknown kid, and one named like a member of an object', async () => {
    expect(await reasonOf([workerLink({}, ROOT, 'k9')])).toBe('unknown certificate key');
    for (const name of OBJECT_MEMBER_NAMES) expect(await reasonOf([workerLink({}, ROOT, name)]), name).toBe('unknown certificate key');
    const first = workerLink();
    expect(await reasonOf([first, await inviteLink(first, { pass: joinPass({}, ROOT, 'k9') })])).toBe('unknown pass key');
  });

  it('another organization: a first link, and a pass', async () => {
    expect(await reasonOf([workerLink({ org: { orgId: 'org2', orgSeq: 1, scopes: [] } })])).toBe('wrong organization');
    const first = workerLink();
    expect(await reasonOf([first, await inviteLink(first, { pass: joinPass({ orgId: 'org2' }) })])).toBe('wrong organization');
  });

  it('a first link naming organizations in a list: it names one', async () => {
    const link = workerLink();
    const listed = { ...link, body: { ...link.body, org: [link.body.org] } };
    expect(await reasonOf([listed])).toBe('malformed link');
  });

  it('a pass for another language', async () => {
    const first = workerLink();
    expect(await reasonOf([first, await inviteLink(first, { pass: joinPass({ languageId: 'lang2' }) })])).toBe('wrong language');
  });

  it('a first link or a pass the root did not sign', async () => {
    expect(await reasonOf([workerLink({}, OTHER_ROOT)])).toBe('bad certificate signature');
    const first = workerLink();
    expect(await reasonOf([first, await inviteLink(first, { pass: joinPass({}, INVITER_KEY) })])).toBe('bad pass signature');
    const tampered = joinPass();
    tampered.body.maxUses = 1000;
    expect(await reasonOf([first, await inviteLink(first, { pass: tampered })])).toBe('bad pass signature');
  });

  it('a second link not signed by the key the first names', async () => {
    const first = workerLink();
    expect(await reasonOf([first, await inviteLink(first, {}, NEWCOMER_KEY)])).toBe('bad link signature');
  });

  it('an invite link lifted from under another first link: each link holds the signature before it', async () => {
    const first = workerLink();
    const invite = await inviteLink(first);
    const otherFirst = workerLink({ deviceId: 'device-z' });
    expect(await reasonOf([otherFirst, invite])).toBe('bad link signature');
  });

  it('a verify that throws, or answers anything but true', async () => {
    expect(await reasonOf([workerLink()], { verify: () => { throw new Error('bad key'); } })).toBe('bad certificate signature');
    expect(await reasonOf([workerLink()], { verify: async () => Promise.reject(new Error('bad key')) })).toBe('bad certificate signature');
    expect(await reasonOf([workerLink()], { verify: (() => 1) as unknown as CheckChainOptions['verify'] })).toBe('bad certificate signature');
  });

  it('a pass naming another inviter, or another key', async () => {
    const first = workerLink();
    expect(await reasonOf([first, await inviteLink(first, { pass: joinPass({ inviter: 'someone-else' }) })])).toBe('pass names someone else');
    expect(await reasonOf([first, await inviteLink(first, { pass: joinPass({ inviterKey: keyOf(7) }) })])).toBe('pass names someone else');
  });

  it('a role not on the pass, or carrying other privileges than the pass says', async () => {
    const first = workerLink();
    expect(await reasonOf([first, await inviteLink(first, { roleId: 'owner' })])).toBe('role is not on the pass');
    expect(await reasonOf([first, await inviteLink(first, { privileges: ['translate', 'review'] })])).toBe('role is not on the pass');
    expect(await reasonOf([first, await inviteLink(first, { privileges: [] })])).toBe('role is not on the pass');
    expect(await reasonOf([first, await inviteLink(first, { pass: joinPass({ roles: [{ roleId: 'translator', privileges: ['translate', 'translate'] }] }), privileges: ['translate', 'review'] })])).toBe('role is not on the pass');
  });

  it.each(MANAGE_PRIVILEGES.map((p) => [p] as const))('a role with %s, whoever signed it', async (privilege: Privilege) => {
    const first = workerLink({ org: { orgId: ORG, orgSeq: 1, scopes: [{ level: 'org', privileges: ['invite_members', 'translate', privilege] }] } });
    const pass = joinPass({ roles: [{ roleId: 'r', privileges: ['translate', privilege] }] });
    expect(await reasonOf([first, await inviteLink(first, { pass, roleId: 'r', privileges: ['translate', privilege] })])).toBe('a pass cannot grant a manage privilege');
  });

  it('a role the inviter could not grant: no Invite, or a privilege they lack, or only elsewhere', async () => {
    const withScopes = (scopes: WorkerBody['org']['scopes']) => workerLink({ org: { orgId: ORG, orgSeq: 1, scopes } });
    for (const scopes of [
      [{ level: 'language', languageId: LANG, privileges: ['translate'] }],
      [{ level: 'language', languageId: LANG, privileges: ['invite_members'] }],
      [{ level: 'language', languageId: 'lang2', privileges: ['invite_members', 'translate'] }],
      []
    ] as WorkerBody['org']['scopes'][]) {
      const first = withScopes(scopes);
      expect(await reasonOf([first, await inviteLink(first)])).toBe('inviter could not grant this role');
    }
  });

  it('Invite at one scope and the privilege at another adds up, as `mayGrantRole` does', async () => {
    const first = workerLink({ org: { orgId: ORG, orgSeq: 1, scopes: [{ level: 'org', privileges: ['invite_members'] }, { level: 'language', languageId: LANG, privileges: ['translate'] }] } });
    expect(await reasonOf([first, await inviteLink(first)])).toBe('accepted');
  });

  it('an id that does not derive from the key: an admin\'s, an upper-case copy, another salt\'s', async () => {
    const first = workerLink();
    const right = (await newcomerProfileId(NEWCOMER_KEY, SALT, sha256))!;
    expect(await reasonOf([first, await inviteLink(first, { profileId: INVITER })])).toBe('id does not follow from the key');
    expect(await reasonOf([first, await inviteLink(first, { profileId: right.toUpperCase() })])).toBe('id does not follow from the key');
    expect(await reasonOf([first, await inviteLink(first, { profileId: (await newcomerProfileId(NEWCOMER_KEY, base64urlEncode(new Uint8Array(16)), sha256))! })])).toBe('id does not follow from the key');
  });

  it('a non-canonical key, and a salt that is not 16 bytes', async () => {
    const first = workerLink();
    const spareBits = `${NEWCOMER_KEY.slice(0, 42)}B`;
    expect(await reasonOf([first, await inviteLink(first, { installKey: spareBits, profileId: 'x' })])).toBe('malformed link');
    expect(await reasonOf([first, await inviteLink(first, { idSalt: base64urlEncode(new Uint8Array(15)), profileId: 'x' })])).toBe('malformed link');
    expect(await reasonOf([workerLink({ installKey: spareBits })])).toBe('malformed link');
  });

  it('a self-link', async () => {
    const first = workerLink();
    expect(await reasonOf([first, await inviteLink(first, { installKey: INVITER_KEY })])).toBe('a link cannot vouch for its own key');
  });

  it('a chain with a revoked pair in any link, and only that pair', async () => {
    const first = workerLink();
    const chain = [first, await inviteLink(first)];
    const newcomer = (await newcomerProfileId(NEWCOMER_KEY, SALT, sha256))!;
    const list = (key: string, person: string): RevocationList => ({ v: 1, kid: 'k1', orgId: ORG, seq: 1, keys: [[key, person, 5]] });
    expect(await reasonOf(chain, { revoked: list(INVITER_KEY, INVITER) })).toBe('key revoked');
    expect(await reasonOf(chain, { revoked: list(NEWCOMER_KEY, newcomer) })).toBe('key revoked');
    // Another person on that shared phone is not refused because of one person's lost phone.
    expect(await reasonOf(chain, { revoked: list(INVITER_KEY, 'someone-else') })).toBe('accepted');
    expect(await reasonOf(chain, { revoked: list(keyOf(7), INVITER) })).toBe('accepted');
  });

  it('a third link by default, and even when asked for: a newcomer holds no Invite', async () => {
    const first = workerLink();
    const second = await inviteLink(first);
    const passOnward = joinPass({ inviter: second.body.profileId, inviterKey: second.body.installKey });
    const body: InviteLink['body'] = { ...second.body, pass: passOnward, installKey: keyOf(5), profileId: (await newcomerProfileId(keyOf(5), SALT, sha256))! };
    const third: InviteLink = { kind: 'invite@1', body, sig: fakeSign(NEWCOMER_KEY, nearbyBytes('link', linkText({ kind: 'invite@1', body }, second.sig))) };
    expect(await reasonOf([first, second, third])).toBe('too many links');
    expect(await reasonOf([first, second, third], { maxLinks: 3 })).toBe('inviter could not grant this role');
  });

  it('a form too deep to canonicalize, without throwing', async () => {
    let deep: unknown = 'x';
    for (let i = 0; i < 40; i++) deep = [deep];
    const link = workerLink();
    expect(await reasonOf([{ ...link, body: { ...link.body, extra: deep } }])).toMatch(/^malformed chain/);
    expect(await reasonOf([{ ...link, body: { ...link.body, extra: 'a\u0000b' } }])).toMatch(/^malformed chain/);
  });

  it('every field of a good chain swapped for junk: a refusal, never a throw', async () => {
    const first = workerLink();
    const second = await inviteLink(first);
    const chain = JSON.stringify([first, second]);
    const paths: (string | number)[][] = [];
    const walk = (x: unknown, at: (string | number)[]) => {
      if (at.length > 0) paths.push(at);
      if (Array.isArray(x)) x.forEach((c, i) => walk(c, [...at, i]));
      else if (typeof x === 'object' && x !== null) for (const [k, c] of Object.entries(x)) walk(c, [...at, k]);
    };
    walk(JSON.parse(chain), []);
    const junk = fc.oneof(fc.constant(null), fc.integer(), fc.double(), fc.string(), fc.constant([]), fc.constant({}), fc.boolean());
    await fc.assert(fc.asyncProperty(fc.constantFrom(...paths), junk, async (path, value) => {
      const copy = JSON.parse(chain) as unknown[];
      let at: unknown = copy;
      for (const k of path.slice(0, -1)) at = (at as Record<string | number, unknown>)[k];
      const last = path[path.length - 1]!;
      const before = JSON.stringify((at as Record<string | number, unknown>)[last]);
      if (before === JSON.stringify(value)) return;
      (at as Record<string | number, unknown>)[last] = value;
      expect((await checkChain(copy, options())).ok, path.join('.')).toBe(false);
    }), { numRuns: 400 });
  });

  it('whatever comes off the wire: a refusal, never a throw', async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.jsonValue(), { maxLength: 4 }), async (chain) => {
      expect((await checkChain(chain, options())).ok).toBe(false);
    }), { numRuns: 200 });
  });
});

describe('peopleWithChains: a newer certificate decides', () => {
  const fold = foldOrg(buildOrgFixture());
  const member = Object.keys(fold.members)[0]!;
  const language = Object.keys(fold.languages).find((id) => fold.languages[id]?.added)!;
  const stranger = 'added-last-week';
  const held = (profileId: string, orgSeq: number, privileges: Privilege[], languageId = language): ChainVerdict => ({
    ok: true, holder: { installKey: keyOf(1), profileId, deviceId: 'd' }, links: 1,
    org: { orgId: ORG, orgSeq, scopes: [{ level: 'language', languageId, privileges }] }
  });

  it('someone added after this fold is not turned away, by a chain signed past it', () => {
    const people = peopleWithChains(fold, [held(stranger, 11, ['translate'])], 10);
    expect([...people.privilegesIn(stranger, language)]).toEqual(['translate']);
    expect(people.privilegesIn(stranger, 'another-language').size).toBe(0);
  });

  it('a certificate at organization scope covers every language', () => {
    const org: ChainVerdict = { ok: true, holder: { installKey: keyOf(1), profileId: stranger, deviceId: 'd' }, links: 1, org: { orgId: ORG, orgSeq: 11, scopes: [{ level: 'org', privileges: ['review'] }] } };
    expect([...peopleWithChains(fold, [org], 10).privilegesIn(stranger, 'any')]).toEqual(['review']);
  });

  it('it decides outright: someone demoted since this fold holds what the certificate says', () => {
    expect(peopleWithChains(fold, [], 10).privilegesIn(member, language).size).toBeGreaterThan(0);
    expect(peopleWithChains(fold, [held(member, 11, [])], 10).privilegesIn(member, language).size).toBe(0);
  });

  it('at or below this phone\'s sequence the fold answers, and on a starting copy it beats an older chain', () => {
    // `orgSeqHere` holds a starting copy's `serverSeq` with the cursor still at 0, so a year-old certificate loses.
    const fromFold = [...peopleWithChains(fold, [], 10).privilegesIn(member, language)].sort();
    for (const orgSeq of [9, 10]) {
      const people = peopleWithChains(fold, [held(member, orgSeq, ['review']), held(stranger, orgSeq, ['translate'])], 10);
      expect([...people.privilegesIn(member, language)].sort()).toEqual(fromFold);
      expect(people.privilegesIn(stranger, language).size).toBe(0);
    }
  });

  it('a person\'s newest chain speaks for them, in either order', () => {
    const older = held(stranger, 11, ['translate']);
    const newer = held(stranger, 12, ['review']);
    expect([...peopleWithChains(fold, [older, newer], 10).privilegesIn(stranger, language)]).toEqual(['review']);
    expect([...peopleWithChains(fold, [newer, older], 10).privilegesIn(stranger, language)]).toEqual(['review']);
  });

  it('a refused chain says nothing, and a two-link chain waits for its own rule', () => {
    const two: ChainVerdict = { ...held(stranger, 11, ['translate']), links: 2 } as ChainVerdict;
    const people = peopleWithChains(fold, [{ ok: false, reason: 'no' }, two], 10);
    expect(people.privilegesIn(stranger, language).size).toBe(0);
  });

  it('the language list stays the fold\'s, and a member name finds nothing', () => {
    const people = peopleWithChains(fold, [held(stranger, 11, ['translate'], 'not-listed')], 10);
    expect(people.languageListed(language)).toBe(true);
    expect(people.languageListed('not-listed')).toBe(false);
    for (const name of OBJECT_MEMBER_NAMES) expect(people.privilegesIn(name, language).size, name).toBe(0);
  });

  it('the door reads it: a refusal the fold gave becomes a pass, and a later fold takes it back', () => {
    const facts: DoorFacts = { entityTaken: () => false, reviewAuthor: () => undefined, noteAuthor: () => undefined, departureType: () => undefined };
    const event = {
      id: `by:${stranger}:c:0`, type: 'v1.TakeArchived', orgId: ORG, streamId: language, actorId: stranger, deviceId: 'd1', hlc: '001700000000000:000000:d1', payload: { takeId: `by:${stranger}:t` }
    } as unknown as AnyEvent;
    const ctx = { orgId: ORG, languageId: language, facts };
    expect(nearbyDoor(event, { ...ctx, people: peopleWithChains(fold, [], 10) })).toMatchObject({ retry: true });
    expect(nearbyDoor(event, { ...ctx, people: peopleWithChains(fold, [held(stranger, 11, ['translate'])], 10) })).toBeNull();
    expect(nearbyDoor(event, { ...ctx, people: peopleWithChains(fold, [held(stranger, 11, ['translate'])], 11) })).toMatchObject({ retry: true });
  });
});

describe('revokedLater: earlier work stands, per event', () => {
  const list: RevocationList = { v: 1, kid: 'k1', orgId: ORG, seq: 1, keys: [[INVITER_KEY, INVITER, 5_000]] };
  const at = (wall: number) => `${String(wall).padStart(15, '0')}:000000:d1`;

  it('passes what is dated before, and refuses the rest', () => {
    expect(revokedLater(list, INVITER_KEY, INVITER, at(4_999))).toBe(false);
    expect(revokedLater(list, INVITER_KEY, INVITER, at(5_000))).toBe(true);
    expect(revokedLater(list, INVITER_KEY, INVITER, at(6_000))).toBe(true);
  });

  it('a clock that cannot be read counts as later', () => {
    expect(revokedLater(list, INVITER_KEY, INVITER, 'x1:y:z')).toBe(true);
    expect(revokedLater(list, INVITER_KEY, INVITER, undefined)).toBe(true);
  });

  it('another person on that key is not refused, nor anyone with no list', () => {
    expect(revokedLater(list, INVITER_KEY, 'someone-else', at(9_000))).toBe(false);
    expect(revokedLater(list, NEWCOMER_KEY, INVITER, at(9_000))).toBe(false);
    expect(revokedLater(undefined, INVITER_KEY, INVITER, at(9_000))).toBe(false);
  });
});

describe('signedBy', () => {
  it('a check that throws is a failed check', async () => {
    expect(await signedBy(() => { throw new Error('bad bytes'); }, ROOT, new Uint8Array(), 'x')).toBe(false);
    expect(await signedBy(async () => true, ROOT, new Uint8Array(), 'x')).toBe(true);
  });
});
