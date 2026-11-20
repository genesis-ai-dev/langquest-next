import { createHash } from 'node:crypto';
import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { HlcClock } from '../src/hlc';
import { checkChain, newcomerProfileId, peopleWithChains, type ChainVerdict, type CheckChainOptions, type JoinAsk, type JoinPass, type RevocationList, type WorkerLink } from '../src/nearbyChain';
import {
  chainRoleId, issueInviteLink, JOIN_PASS_USES, joinPassBody, joinPassStop, joinPictures, newcomerOrgState, passRoles, signJoinPass, withChainMembership
} from '../src/nearbyJoin';
import { base64urlEncode, linkText, nearbyBytes, PASS_WINDOW_MS, passIdOf } from '../src/nearbySigning';
import { foldOrg, membershipsOf, privilegesFor, type OrgState } from '../src/org';
import { MANAGE_PRIVILEGES, type Privilege } from '../src/orgTerms';
import { OBJECT_MEMBER_NAMES } from '../src/validate';
import * as v from './nearbyVectors';

/**
 * Joining offline, core's half (docs/nearby-sync-plan.md 14.1, phase 6). Why these tests: a
 * newcomer is let in by a teammate's phone with no server, so every stop the server would apply
 * that a phone can know of (Carl's answers 8, 9 and 17) must hold on the inviter's phone before
 * it signs and on every teammate's phone after, and nothing may let a newcomer take an existing
 * person's identity or a manage privilege.
 */

const sha256 = (bytes: Uint8Array) => new Uint8Array(createHash('sha256').update(bytes).digest());
const fakeSign = (key: string, message: Uint8Array) =>
  base64urlEncode(new Uint8Array(createHash('sha512').update(key).update('|').update(message).digest()));
const fakeVerify = (key: string, message: Uint8Array, sig: string) => fakeSign(key, message) === sig;
const keyOf = (n: number) => base64urlEncode(new Uint8Array(32).fill(n));

const ROOT = keyOf(9);
const INVITER_KEY = keyOf(1);
const NEWCOMER_KEY = keyOf(2);
const SALT = base64urlEncode(new Uint8Array(16).fill(3));
const ORG = 'org1';
const LANG = 'L1';
const NOW = PASS_WINDOW_MS * 200 + 5;
const INVITER = 'lead';
const rootKeys = new Map([['k1', ROOT]]);
const options = (over: Partial<CheckChainOptions> = {}): CheckChainOptions => ({ rootKeys, orgId: ORG, languageId: LANG, now: NOW, verify: fakeVerify, sha256, ...over });

/** An organization: a language lead with Invite in L1, a translator, and roles of each kind. */
function orgEvents(extra: (emit: <T extends EventType>(type: T, payload: EventPayloads[T]) => void) => void = () => undefined): AnyEvent[] {
  const events: AnyEvent[] = [];
  let seq = 0;
  let wall = 1_800_000_000_000;
  const clock = new HlcClock('dA', () => wall);
  const emit = <T extends EventType>(type: T, payload: EventPayloads[T]) => {
    wall += 1000;
    seq += 1;
    events.push({ id: `o${seq}`, type, orgId: ORG, streamId: '_org', actorId: 'admin', deviceId: 'dA', hlc: clock.next(), payload, serverSeq: seq } as AnyEvent);
  };
  emit('v1.OrgCreated', { name: 'Team' });
  emit('v1.RoleDefined', { roleId: 'org_admin', name: 'Admin', privileges: ['manage_roles', 'invite_members', 'translate', 'review', 'view_status'] });
  emit('v1.RoleDefined', { roleId: 'lang_lead', name: 'Language lead', privileges: ['invite_members', 'translate', 'review', 'view_status'] });
  emit('v1.RoleDefined', { roleId: 'translator', name: 'Translator', privileges: ['translate', 'view_status'] });
  emit('v1.RoleDefined', { roleId: 'reviewer', name: 'Reviewer', privileges: ['review', 'view_status'] });
  emit('v1.RoleDefined', { roleId: 'coordinator', name: 'Coordinator', privileges: ['assign_work', 'translate'] });
  emit('v1.LanguageAdded', { languageId: LANG, name: 'Dinka', code: 'din', sourceCode: 'eng' });
  emit('v1.LanguageAdded', { languageId: 'L2', name: 'Nuer', code: 'nus', sourceCode: 'eng' });
  emit('v1.MemberAdded', { profileId: 'admin', roleId: 'org_admin', scope: { level: 'org' } });
  emit('v1.MemberAdded', { profileId: INVITER, roleId: 'lang_lead', scope: { level: 'language', languageId: LANG } });
  emit('v1.MemberAdded', { profileId: 't1', roleId: 'translator', scope: { level: 'language', languageId: LANG } });
  emit('v1.MemberAdded', { profileId: 'other-lang', roleId: 'translator', scope: { level: 'language', languageId: 'L2' } });
  emit('v1.MemberAdded', { profileId: 'gone', roleId: 'translator', scope: { level: 'language', languageId: LANG } });
  emit('v1.MemberRemoved', { profileId: 'gone', scope: { level: 'language', languageId: LANG } });
  emit('v1.InviteIssued', { inviteId: 'inv1', roleId: 'translator', scope: { level: 'language', languageId: LANG }, expiresAt: '2030-01-01T00:00:00Z' });
  emit('v1.JoinDecided', { requestId: 'jr1', profileId: 'asker', accepted: true });
  extra(emit);
  return events;
}
const org = (extra?: Parameters<typeof orgEvents>[0]) => foldOrg(orgEvents(extra));
const ORG_SEQ = orgEvents().length;

function workerLink(over: Partial<WorkerLink['body']> = {}): WorkerLink {
  const body: WorkerLink['body'] = {
    installKey: INVITER_KEY, profileId: INVITER, deviceId: 'device-a', expiresAt: NOW + 1000,
    org: { orgId: ORG, orgSeq: ORG_SEQ, scopes: [{ level: 'language', languageId: LANG, privileges: ['invite_members', 'translate', 'review', 'view_status'] }] },
    ...over
  };
  return { kind: 'worker@1', kid: 'k1', body, sig: fakeSign(ROOT, nearbyBytes('link', linkText({ kind: 'worker@1', kid: 'k1', body }, ''))) };
}

async function pass(over: Partial<JoinPass['body']> = {}): Promise<JoinPass> {
  const body = (await joinPassBody({ orgId: ORG, languageId: LANG, inviter: INVITER, inviterKey: INVITER_KEY, roles: passRoles(Object.entries(org().roles).map(([roleId, r]) => ({ roleId, privileges: r.privileges.value, retired: r.retired })), new Set<Privilege>(['invite_members', 'translate', 'review', 'view_status'])), nowMs: NOW }, sha256))!;
  return signJoinPass({ ...body, ...over }, 'k1', (m) => fakeSign(ROOT, m));
}

async function ask(over: Partial<JoinAsk> = {}): Promise<JoinAsk> {
  const installKey = over.installKey ?? NEWCOMER_KEY;
  const idSalt = over.idSalt ?? SALT;
  return { installKey, idSalt, profileId: (await newcomerProfileId(installKey, idSalt, sha256))!, deviceId: 'device-b', name: 'Nyibol', ...over };
}

const issue = async (o: { link?: WorkerLink; pass?: JoinPass; ask?: JoinAsk; roleId?: string; now?: number; revoked?: RevocationList } = {}) => issueInviteLink({
  inviterLink: o.link ?? workerLink(), pass: o.pass ?? await pass(), ask: o.ask ?? await ask(), roleId: o.roleId ?? 'translator', now: o.now ?? NOW, sha256,
  sign: (m) => fakeSign(INVITER_KEY, m), ...(o.revoked ? { revoked: o.revoked } : {})
});
const reasonOf = async (o: Parameters<typeof issue>[0] = {}) => {
  const out = await issue(o);
  return out.ok ? 'issued' : out.reason;
};

describe('a pass (Carl\'s answers 8 and 17)', () => {
  it('offers only roles with no manage privilege whose privileges the inviter holds, sorted, each sorted', () => {
    const roles = [
      { roleId: 'translator', privileges: ['view_status', 'translate'] as Privilege[] },
      { roleId: 'admin', privileges: ['translate', 'manage_roles'] as Privilege[] },
      { roleId: 'reviewer', privileges: ['review'] as Privilege[] },
      { roleId: 'old', privileges: ['translate'] as Privilege[], retired: true },
      { roleId: 'empty', privileges: [] as Privilege[] },
      { roleId: 'beyond', privileges: ['override_checkpoints'] as Privilege[] }
    ];
    expect(passRoles(roles, new Set<Privilege>(['invite_members', 'translate', 'review', 'view_status', 'manage_roles']))).toEqual([
      { roleId: 'reviewer', privileges: ['review'] },
      { roleId: 'translator', privileges: ['translate', 'view_status'] }
    ]);
    // With no Invite, nothing.
    expect(passRoles(roles, new Set<Privilege>(['translate', 'review', 'view_status']))).toEqual([]);
  });

  it('gives one id to a window, a new one for a new key or window, and expires at the window\'s end, matching the golden vector', async () => {
    const roles = [{ roleId: 'translator', privileges: ['translate'] as Privilege[] }];
    const at = (nowMs: number, inviterKey = v.PUBLIC_KEY) => joinPassBody({ orgId: 'org1', languageId: 'lang1', inviter: v.PROFILE, inviterKey, roles, nowMs }, sha256);
    const first = (await at(v.PASS_NOW_MS))!;
    expect(first).toEqual({ passId: v.PASS_ID, orgId: 'org1', languageId: 'lang1', inviter: v.PROFILE, inviterKey: v.PUBLIC_KEY, roles, maxUses: JOIN_PASS_USES, expiresAt: v.PASS_EXPIRES_AT });
    expect(JOIN_PASS_USES).toBe(10);
    expect((await at(v.PASS_EXPIRES_AT - 1))!.passId).toBe(v.PASS_ID);
    expect((await at(v.PASS_EXPIRES_AT))!.passId).not.toBe(v.PASS_ID);
    expect((await at(v.PASS_EXPIRES_AT))!.expiresAt).toBe(v.PASS_EXPIRES_AT + PASS_WINDOW_MS);
    expect((await at(v.PASS_NOW_MS, keyOf(7)))!.passId).not.toBe(v.PASS_ID);
    expect(await passIdOf({ orgId: 'org1', languageId: 'lang1', inviter: v.PROFILE, inviterKey: v.PUBLIC_KEY, window: v.PASS_WINDOW }, sha256)).toBe(v.PASS_ID);
  });

  it('is not issued with no role to offer', async () => {
    expect(await joinPassBody({ orgId: ORG, languageId: LANG, inviter: INVITER, inviterKey: INVITER_KEY, roles: [], nowMs: NOW }, sha256)).toBeNull();
  });
});

describe('the invite link an inviter signs', () => {
  it('names the chosen role with the pass\'s privileges, and every teammate\'s checkChain accepts it', async () => {
    const out = await issue();
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.link.body).toMatchObject({ roleId: 'translator', privileges: ['translate', 'view_status'], name: 'Nyibol', deviceId: 'device-b' });
    const verdict = await checkChain([workerLink(), out.link], options());
    expect(verdict).toMatchObject({ ok: true, links: 2, inviter: INVITER, inviterKey: INVITER_KEY, roleId: 'translator', holder: { profileId: (await ask()).profileId, name: 'Nyibol' } });
  });

  it('refuses an expired pass and an expired certificate', async () => {
    const p = await pass();
    expect(await reasonOf({ now: p.body.expiresAt + 1 })).toBe('certificate expired');
    expect(await reasonOf({ link: workerLink({ expiresAt: Number.MAX_SAFE_INTEGER }), now: p.body.expiresAt + 1 })).toBe('pass expired');
  });

  it('refuses a pass for another organization, language holder or key', async () => {
    expect(await reasonOf({ pass: await pass({ orgId: 'org2' }) })).toBe('wrong organization');
    expect(await reasonOf({ pass: await pass({ inviter: 'someone-else' }) })).toBe('pass names someone else');
    expect(await reasonOf({ pass: await pass({ inviterKey: keyOf(7) }) })).toBe('pass names someone else');
  });

  it('refuses a role off the pass, a role with a manage privilege, and a role the inviter could not grant', async () => {
    expect(await reasonOf({ roleId: 'org_admin' })).toBe('role is not on the pass');
    const managing = await pass({ roles: [{ roleId: 'coordinator', privileges: ['assign_work', 'translate'] }] });
    expect(await reasonOf({ pass: managing, roleId: 'coordinator' })).toBe('a pass cannot grant a manage privilege');
    const noInvite = workerLink({ org: { orgId: ORG, orgSeq: ORG_SEQ, scopes: [{ level: 'language', languageId: LANG, privileges: ['translate', 'view_status'] }] } });
    expect(await reasonOf({ link: noInvite })).toBe('inviter could not grant this role');
    const elsewhere = workerLink({ org: { orgId: ORG, orgSeq: ORG_SEQ, scopes: [{ level: 'language', languageId: 'L2', privileges: ['invite_members', 'translate', 'view_status'] }] } });
    expect(await reasonOf({ link: elsewhere })).toBe('inviter could not grant this role');
  });

  it('refuses an id that does not follow from the key: an existing person\'s, an upper-case copy, a self-link', async () => {
    for (const profileId of [INVITER, 't1', 'gone', (await ask()).profileId.toUpperCase()]) {
      expect(await reasonOf({ ask: await ask({ profileId }) }), profileId).toBe('id does not follow from the key');
    }
    expect(await reasonOf({ ask: await ask({ installKey: INVITER_KEY }) })).toBe('a link cannot vouch for its own key');
  });

  it('refuses a newcomer whose pair is on the revocation list', async () => {
    const a = await ask();
    expect(await reasonOf({ ask: a, revoked: { v: 1, kid: 'k1', orgId: ORG, seq: 1, keys: [[a.installKey, a.profileId, 1]] } })).toBe('key revoked');
  });
});

describe('joinPassStop: a pass stops by itself (Carl\'s answer 9)', () => {
  const here = (o: Partial<Parameters<typeof joinPassStop>[2]> = {}) => ({ now: NOW, org: org(), orgSeqHere: ORG_SEQ, certOrgSeq: ORG_SEQ, ...o });

  it('holds for a role the inviter may grant', async () => {
    expect(joinPassStop(await pass(), 'translator', here())).toBeNull();
    expect(joinPassStop(await pass(), 'reviewer', here())).toBeNull();
  });

  it('stops past expiry, for a role off the pass, and when the inviter\'s key is revoked, whatever the fold says', async () => {
    const p = await pass();
    expect(joinPassStop(p, 'translator', here({ now: p.body.expiresAt + 1 }))).toBe('pass expired');
    expect(joinPassStop(p, 'org_admin', here())).toBe('role is not on the pass');
    const revoked: RevocationList = { v: 1, kid: 'k1', orgId: ORG, seq: 2, keys: [[INVITER_KEY, INVITER, 1]] };
    expect(joinPassStop(p, 'translator', here({ revoked, orgSeqHere: 0 }))).toBe('key revoked');
    // Another person on that phone is not stopped by one person's lost key.
    expect(joinPassStop(p, 'translator', here({ revoked: { ...revoked, keys: [[INVITER_KEY, 'someone-else', 1]] } }))).toBeNull();
  });

  it('stops once the fold has seen the inviter removed, demoted, the role retired or given a manage privilege', async () => {
    const p = await pass();
    const after = (extra: Parameters<typeof orgEvents>[0]) => here({ org: org(extra), orgSeqHere: ORG_SEQ + 1 });
    expect(joinPassStop(p, 'translator', after((emit) => emit('v1.MemberRemoved', { profileId: INVITER, scope: { level: 'language', languageId: LANG } })))).toBe('inviter could not grant this role');
    expect(joinPassStop(p, 'translator', after((emit) => emit('v1.MemberAdded', { profileId: INVITER, roleId: 'translator', scope: { level: 'language', languageId: LANG } })))).toBe('inviter could not grant this role');
    expect(joinPassStop(p, 'translator', after((emit) => emit('v1.RoleRetired', { roleId: 'translator' })))).toBe('inviter could not grant this role');
    expect(joinPassStop(p, 'translator', after((emit) => emit('v1.RoleDefined', { roleId: 'translator', name: 'Translator', privileges: ['translate', 'view_status', 'assign_work'] })))).toBe('inviter could not grant this role');
    // A role widened with no manage privilege the inviter lacks still stops (they could not grant it); one they hold does not.
    expect(joinPassStop(p, 'translator', after((emit) => emit('v1.RoleDefined', { roleId: 'translator', name: 'Translator', privileges: ['translate', 'view_status', 'review'] })))).toBeNull();
  });

  it('below the inviter\'s certificate the pass\'s own word stands, so a team that has not synced carries on', async () => {
    const p = await pass();
    const removed = org((emit) => emit('v1.MemberRemoved', { profileId: INVITER, scope: { level: 'language', languageId: LANG } }));
    expect(joinPassStop(p, 'translator', here({ org: removed, orgSeqHere: ORG_SEQ - 1 }))).toBeNull();
  });
});

describe('peopleWithChains: a newcomer\'s two-link chain', () => {
  const newcomer = async (orgSeq = ORG_SEQ, privileges: Privilege[] = ['translate', 'view_status'], roleId = 'translator'): Promise<Extract<ChainVerdict, { ok: true }>> => ({
    ok: true, holder: { installKey: NEWCOMER_KEY, profileId: (await ask()).profileId, deviceId: 'device-b', name: 'Nyibol' }, links: 2,
    org: { orgId: ORG, orgSeq, scopes: [{ level: 'language', languageId: LANG, privileges }] }, inviter: INVITER, inviterKey: INVITER_KEY, roleId
  });

  it('answers with the signed privileges while this fold has no entry for them, in their language only', async () => {
    const n = await newcomer();
    const people = peopleWithChains(org(), [n], ORG_SEQ);
    expect([...people.privilegesIn(n.holder.profileId, LANG)].sort()).toEqual(['translate', 'view_status']);
    expect(people.privilegesIn(n.holder.profileId, 'L2').size).toBe(0);
  });

  it('a removed entry refuses, and removal sticks even under an older fold', async () => {
    const n = await newcomer(ORG_SEQ + 50);
    const removed = org((emit) => {
      emit('v1.MemberAdded', { profileId: n.holder.profileId, roleId: 'translator', scope: { level: 'language', languageId: LANG } });
      emit('v1.MemberRemoved', { profileId: n.holder.profileId, scope: { level: 'language', languageId: LANG } });
    });
    expect(peopleWithChains(removed, [n], ORG_SEQ).privilegesIn(n.holder.profileId, LANG).size).toBe(0);
  });

  it('a live entry answers from the fold, so an admin\'s raised role counts', async () => {
    const n = await newcomer();
    const raised = org((emit) => emit('v1.MemberAdded', { profileId: n.holder.profileId, roleId: 'lang_lead', scope: { level: 'language', languageId: LANG } }));
    expect(peopleWithChains(raised, [n], ORG_SEQ + 1).privilegesIn(n.holder.profileId, LANG).has('invite_members')).toBe(true);
  });

  it('at or past the chain\'s orgSeq, a removed or demoted inviter or a retired role refuses; below it the link decides', async () => {
    const n = await newcomer();
    const cases: Parameters<typeof orgEvents>[0][] = [
      (emit) => emit('v1.MemberRemoved', { profileId: INVITER, scope: { level: 'language', languageId: LANG } }),
      (emit) => emit('v1.MemberAdded', { profileId: INVITER, roleId: 'translator', scope: { level: 'language', languageId: LANG } }),
      (emit) => emit('v1.RoleRetired', { roleId: 'translator' }),
      (emit) => emit('v1.RoleDefined', { roleId: 'translator', name: 'Translator', privileges: ['translate', 'manage_teams'] })
    ];
    for (const extra of cases) {
      const fold = org(extra);
      expect(peopleWithChains(fold, [n], ORG_SEQ).privilegesIn(n.holder.profileId, LANG).size).toBe(0);
      expect(peopleWithChains(fold, [n], ORG_SEQ + 1).privilegesIn(n.holder.profileId, LANG).size).toBe(0);
      expect(peopleWithChains(fold, [n], ORG_SEQ - 1).privilegesIn(n.holder.profileId, LANG).size).toBeGreaterThan(0);
    }
  });

  it('answers only what the role still holds in the fold, never what it gained', async () => {
    const n = await newcomer();
    const narrowed = org((emit) => emit('v1.RoleDefined', { roleId: 'translator', name: 'Translator', privileges: ['translate', 'review'] }));
    expect([...peopleWithChains(narrowed, [n], ORG_SEQ + 1).privilegesIn(n.holder.profileId, LANG)]).toEqual(['translate']);
  });

  it('an inviter whose key is on the list refuses at once, even below orgSeq, and another person on that key does not', async () => {
    const n = await newcomer(ORG_SEQ + 50);
    const list = (person: string): RevocationList => ({ v: 1, kid: 'k1', orgId: ORG, seq: 3, keys: [[INVITER_KEY, person, 1]] });
    expect(peopleWithChains(org(), [n], ORG_SEQ, list(INVITER)).privilegesIn(n.holder.profileId, LANG).size).toBe(0);
    expect(peopleWithChains(org(), [n], ORG_SEQ, list('someone-else')).privilegesIn(n.holder.profileId, LANG).size).toBeGreaterThan(0);
  });

  it('a two-link verdict that does not name its inviter, key and role says nothing', async () => {
    const n = await newcomer();
    const bare = { ok: true, holder: n.holder, links: 2, org: n.org } as ChainVerdict;
    expect(peopleWithChains(org(), [bare], ORG_SEQ - 1).privilegesIn(n.holder.profileId, LANG).size).toBe(0);
  });

  it('a chain naming an existing person\'s id answers from the fold, never from the link', async () => {
    // checkChain refuses such a link; even a verdict made up for one gives nothing past the fold.
    const n = await newcomer(ORG_SEQ + 50, ['translate', 'review', 'view_status']);
    const asT1 = { ...n, holder: { ...n.holder, profileId: 't1' } };
    expect([...peopleWithChains(org(), [asT1], ORG_SEQ).privilegesIn('t1', LANG)].sort()).toEqual(['translate', 'view_status']);
    expect(peopleWithChains(org(), [{ ...n, holder: { ...n.holder, profileId: 'gone' } }], ORG_SEQ).privilegesIn('gone', LANG).size).toBe(0);
  });
});

describe('withChainMembership: a newcomer\'s own phone', () => {
  const member = { profileId: 'new-1', roleId: 'translator', languageId: LANG, privileges: ['translate', 'view_status'] as Privilege[] };

  it('gives the link\'s signed privileges in its language, and changes nothing else', () => {
    const before = org();
    const snapshot = JSON.stringify(before);
    const after = withChainMembership(before, member);
    expect([...privilegesFor(after, 'new-1', LANG)].sort()).toEqual(['translate', 'view_status']);
    expect(privilegesFor(after, 'new-1', 'L2').size).toBe(0);
    expect(membershipsOf(after, 'new-1')).toHaveLength(1);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(after.roles['translator']).toBe(before.roles['translator']);
    expect(after.roles[chainRoleId('translator')]!.name.value).toBe('Translator');
  });

  it('never a manage privilege, and not a role the fold has raised since', () => {
    const raised = org((emit) => emit('v1.RoleDefined', { roleId: 'translator', name: 'Translator', privileges: ['translate', 'view_status', 'assign_work'] }));
    expect(privilegesFor(withChainMembership(raised, member), 'new-1', LANG).has('assign_work')).toBe(false);
    const claimed = withChainMembership(org(), { ...member, privileges: ['translate', 'manage_roles', 'invite_members'] });
    expect([...privilegesFor(claimed, 'new-1', LANG)].some((p) => MANAGE_PRIVILEGES.includes(p))).toBe(false);
  });

  it('does nothing once the fold has any entry for them, live or removed', () => {
    const live = org((emit) => emit('v1.MemberAdded', { profileId: 'new-1', roleId: 'reviewer', scope: { level: 'language', languageId: LANG } }));
    expect(withChainMembership(live, member)).toBe(live);
    const removed = org((emit) => {
      emit('v1.MemberAdded', { profileId: 'new-1', roleId: 'reviewer', scope: { level: 'language', languageId: LANG } });
      emit('v1.MemberRemoved', { profileId: 'new-1', scope: { level: 'language', languageId: LANG } });
    });
    expect(withChainMembership(removed, member)).toBe(removed);
    expect(privilegesFor(withChainMembership(removed, member), 'new-1', LANG).size).toBe(0);
    expect(withChainMembership(org(), null)).toEqual(org());
    for (const name of OBJECT_MEMBER_NAMES) expect(withChainMembership(org(), { ...member, profileId: name }), name).toEqual(org());
  });
});

describe('newcomerOrgState: what a starting copy holds of the organization', () => {
  it('copies the allowlist: the organization, roles, license, library, recommendations, this language, live members here or at org scope', () => {
    const full = foldOrg(orgEvents((emit) => {
      emit('v1.LibraryItemDefined', { itemId: 'notes', kind: 'material', name: 'Notes', description: '' });
      emit('v1.ReferenceRecommended', { itemId: 'notes', recommended: true });
      emit('v1.LicenseSet', { license: 'CC-BY-SA-4.0' } as never);
      emit('v1.ClusterNamed', { clusterId: 'c1', name: 'South' } as never);
    }));
    const copy = newcomerOrgState(full, LANG);
    expect(copy.org).toEqual(full.org);
    expect(copy.roles).toEqual(full.roles);
    expect(copy.library).toEqual(full.library);
    expect(copy.recommendations).toEqual(full.recommendations);
    expect(copy.license).toEqual(full.license);
    expect(Object.keys(copy.languages)).toEqual([LANG]);
    expect(Object.keys(copy.members).sort()).toEqual(['admin', INVITER, 't1'].sort());
    expect(copy.invites).toEqual({});
    expect(copy.joinDecisions).toEqual({});
    expect(copy.clusters).toEqual({});
    expect(copy.redactions).toEqual({});
    expect(copy.appliedEventIds).toEqual({});
    // Shared nothing: changing the copy leaves the fold alone.
    copy.roles['translator']!.retired = true;
    expect(full.roles['translator']!.retired).toBe(false);
  });

  it('leaves out any field added later, is idempotent, and refuses member names', () => {
    const full = org() as OrgState & { secrets?: unknown };
    full.secrets = { any: 'thing' };
    const copy = newcomerOrgState(full, LANG);
    expect(copy).not.toHaveProperty('secrets');
    expect(newcomerOrgState(copy, LANG)).toEqual(copy);
    expect(newcomerOrgState(full, '__proto__').languages).toEqual({});
    expect(Object.keys(newcomerOrgState(full, 'nowhere').languages)).toEqual([]);
  });

  it('a person in two organizations: the copy holds only this organization\'s fold', () => {
    // The fold is one organization's (OrgState holds one); a member of L2 only is not in L1's copy.
    const copy = newcomerOrgState(org(), LANG);
    expect(copy.members['other-lang']).toBeUndefined();
    expect(copy.members['gone']).toBeUndefined();
  });
});

describe('the two pictures from th', () => {
  it('hold their golden vectors, worked out with Python', async () => {
    expect([...sha256(nearbyBytes('pictures', v.OPENING.th))].map((b) => b.toString(16).padStart(2, '0')).join('')).toBe(v.PICTURES_HASH);
    expect(await joinPictures(v.OPENING.th, sha256)).toEqual([...v.PICTURES]);
    expect(await joinPictures(v.PICTURES_SAME_TH, sha256)).toEqual([...v.PICTURES_SAME]);
  });

  it('are two different pictures of sixteen, for any th, and take a promise from sha256', async () => {
    for (let i = 0; i < 200; i++) {
      const th = createHash('sha256').update(String(i)).digest('hex');
      const [a, b] = await joinPictures(th, async (bytes) => sha256(bytes));
      expect(a).not.toBe(b);
      expect(a >= 0 && a < 16 && b >= 0 && b < 16).toBe(true);
    }
  });
});
