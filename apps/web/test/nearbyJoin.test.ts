import { createPrivateKey, createPublicKey, sign as nodeSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  base64urlEncode, firstContactText, issueInviteLink, linkText, nearbyBytes, newcomerProfileId, signJoinPass, type InviteLink, type JoinPass, type WorkerLink
} from '@langquest-next/core/nearby';
import { handleApi, type ApiDeps } from '../worker/api';
import type { RpcAnswer } from '../worker/nearby';
import { subtleSha256, subtleVerify } from '../worker/nearbyKeys';
import { accountFromChain, checkJoinChain, handleJoin, JOIN_PATH, refusalStatus, type CheckedJoin, type JoinDeps } from '../worker/nearbyJoin';
import { routeClass } from '../worker/requestTally';
import { CHAIN, CHAIN_INVITER_KEY, CHAIN_ROOT_KEY, NEWCOMER_ID, NEWCOMER_SALT, PROFILE, PUBLIC_KEY } from '../../../packages/core/test/nearbyVectors';

/**
 * A newcomer's first contact at the Worker (docs/nearby-sync-plan.md 14.1), with real Ed25519 on
 * Node's `crypto.subtle` against core's golden chain. Why: this route makes an account with an id
 * the request brings, signed out, so it must take only a two-link chain the Worker's root signed
 * the pass and first link of, an invite link the inviter's key signed, an id that follows from the
 * newcomer's key, and a proof by that key; and it must ask the database before any Auth call, so a
 * dead pass, an id someone holds or a deleted id makes no account.
 */

const pkcs8 = (seedHex: string) => createPrivateKey({ key: Buffer.from(`302e020100300506032b657004220420${seedHex}`, 'hex'), format: 'der', type: 'pkcs8' });
const publicOf = (seedHex: string) => createPublicKey(pkcs8(seedHex)).export({ format: 'jwk' }).x!;
const signWith = (seedHex: string, message: Uint8Array) => base64urlEncode(new Uint8Array(nodeSign(null, message, pkcs8(seedHex))));

/** As the vectors were made: the root from a seed of 0x03, the inviter 0x02, the newcomer 0x01. */
const ROOT_SEED = '03'.repeat(32);
const INVITER_SEED = '02'.repeat(32);
const NEWCOMER_SEED = '01'.repeat(32);
const ROOT_KEYS = new Map([['k1', CHAIN_ROOT_KEY]]);
const NEWCOMER_DEVICE = '44444444-4444-4444-8444-444444444444';
const REQUEST = '55555555-5555-4555-8555-555555555555';
const GOLDEN_LINK = CHAIN[1] as InviteLink;
const GOLDEN_PASS = GOLDEN_LINK.body.pass;
const WORKER_LINK = CHAIN[0] as WorkerLink;

const proofOf = (o: { seed?: string; profileId?: string; deviceId?: string; publicKey?: string; requestId?: string } = {}) =>
  signWith(o.seed ?? NEWCOMER_SEED, nearbyBytes('firstContact', firstContactText({
    profileId: o.profileId ?? NEWCOMER_ID, deviceId: o.deviceId ?? NEWCOMER_DEVICE, publicKey: o.publicKey ?? PUBLIC_KEY, requestId: o.requestId ?? REQUEST
  })));

const joinBody = (over: Record<string, unknown> = {}) => ({ chain: CHAIN, proof: proofOf(), profileId: NEWCOMER_ID, requestId: REQUEST, ...over });

/** A second newcomer under the golden pass, from a seed of their own, with the inviter's real key. */
async function newcomer(seedByte: string, o: { salt?: string; name?: string; profileId?: string; signer?: string; pass?: JoinPass } = {}) {
  const seed = seedByte.repeat(32);
  const key = publicOf(seed);
  const salt = o.salt ?? 'EBESExQVFhcYGRobHB0eHw';
  const profileId = (await newcomerProfileId(key, salt, subtleSha256))!;
  const body: InviteLink['body'] = {
    pass: o.pass ?? GOLDEN_PASS, installKey: key, idSalt: salt, profileId: o.profileId ?? profileId, deviceId: `d-${seedByte}`, name: o.name ?? 'Nyibol',
    roleId: 'translator', privileges: ['translate']
  };
  const link: InviteLink = { kind: 'invite@1', body, sig: signWith(o.signer ?? INVITER_SEED, nearbyBytes('link', linkText({ kind: 'invite@1', body }, WORKER_LINK.sig))) };
  const chain = [WORKER_LINK, link];
  const proof = (requestId = REQUEST) => signWith(seed, nearbyBytes('firstContact', firstContactText({ profileId: body.profileId, deviceId: body.deviceId, publicKey: key, requestId })));
  return { seed, key, profileId: body.profileId, chain, proof };
}

// ---- a database and Auth that keep what they are told ------------------------------------------

interface World {
  users: Map<string, { chainKey: string; email: string }>;
  taken: Set<string>;
  deleted: Set<string>;
  redeemed: Set<string>;
  members: Set<string>;
  keyed: Set<string>;
  /** What pass_refusal says of a first use. */
  refusal: string | null;
  /** What the redemption in nearby_join_finish says, null when it goes. */
  finishRefusal: string | null;
  signIn: boolean;
  emailsTaken: Set<string>;
  preview: RpcAnswer;
  stateError: RpcAnswer['error'];
  finishError: RpcAnswer['error'];
  signInFails: boolean;
  allowed: boolean;
  calls: { fn: string; args: Record<string, unknown> }[];
}

function setup(over: Partial<JoinDeps> = {}, world: Partial<World> = {}): { deps: JoinDeps; w: World } {
  const w: World = {
    users: new Map(), taken: new Set(), deleted: new Set(), redeemed: new Set(), members: new Set(), keyed: new Set(),
    refusal: null, finishRefusal: null, signIn: true, emailsTaken: new Set(),
    preview: { data: { status: 'ok', orgId: 'org1' }, error: null }, stateError: null, finishError: null, signInFails: false, allowed: true, calls: [],
    ...world
  };
  let digits = 481;
  const deps: JoinDeps = {
    rootKeys: () => ROOT_KEYS,
    allowed: async () => w.allowed,
    state: async (a) => {
      w.calls.push({ fn: 'state', args: a });
      if (w.stateError) return { data: null, error: w.stateError };
      const user = w.users.get(a.profileId);
      const state = user ? (user.chainKey === a.key ? 'mine' : 'taken') : w.deleted.has(a.profileId) ? 'deleted' : w.taken.has(a.profileId) ? 'taken' : 'new';
      const redeemed = w.redeemed.has(a.profileId);
      return {
        data: {
          state, redeemed, member: w.members.has(a.profileId), keyed: w.keyed.has(a.profileId),
          refusal: (state === 'new' || state === 'mine') && !redeemed ? w.refusal : null
        },
        error: null
      };
    },
    finish: async (a) => {
      w.calls.push({ fn: 'finish', args: a });
      if (w.finishError) return { data: null, error: w.finishError };
      const user = w.users.get(a.profileId);
      if (user?.chainKey !== a.key) return { data: null, error: { code: '42501', message: 'not this key\'s account' } };
      w.keyed.add(a.profileId);
      if (w.finishRefusal && !w.members.has(a.profileId)) return { data: { refused: w.finishRefusal }, error: null };
      w.redeemed.add(a.profileId);
      w.members.add(a.profileId);
      return { data: { orgId: a.pass.orgId, email: user.email, signIn: w.signIn }, error: null };
    },
    preview: async (token) => {
      w.calls.push({ fn: 'preview', args: { token } });
      return w.preview;
    },
    createUser: async (a) => {
      w.calls.push({ fn: 'createUser', args: a });
      if (w.users.has(a.id) || w.emailsTaken.has(a.email)) return { error: { message: 'A user with this email address has already been registered' } };
      w.users.set(a.id, { chainKey: a.chainKey, email: a.email });
      return { error: null };
    },
    random: () => (digits++) / 2 ** 32,
    signIn: async (email) => {
      w.calls.push({ fn: 'signIn', args: { email } });
      if (w.signInFails) throw new Error('no session');
      return { access_token: `at-${email}`, refresh_token: 'rt' };
    },
    verify: subtleVerify,
    sha256: subtleSha256,
    ...over
  };
  return { deps, w };
}

const post = (body: unknown, ip = '203.0.113.9') => new Request(`https://next.langquest.org${JOIN_PATH}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
  body: typeof body === 'string' ? body : JSON.stringify(body)
});
const fns = (w: World) => w.calls.map((c) => c.fn);

describe('POST /api/nearby/join', () => {
  it('makes the golden newcomer\'s account with the id their key gives, a looked-after address and their key as chain_key, then redeems and signs them in', async () => {
    const { deps, w } = setup();
    const res = await handleJoin(post(joinBody()), deps);
    expect(res.status).toBe(200);
    const made = w.calls.find((c) => c.fn === 'createUser')!.args;
    expect(made).toEqual({ id: NEWCOMER_ID, email: 'ye-481@people.langquest.org', chainKey: PUBLIC_KEY });
    expect(w.calls.find((c) => c.fn === 'state')!.args).toEqual({ profileId: NEWCOMER_ID, key: PUBLIC_KEY, salt: NEWCOMER_SALT, pass: GOLDEN_PASS.body, roleId: 'translator' });
    expect(w.calls.find((c) => c.fn === 'finish')!.args).toEqual({
      profileId: NEWCOMER_ID, key: PUBLIC_KEY, salt: NEWCOMER_SALT, deviceId: NEWCOMER_DEVICE, name: 'Yé', pass: GOLDEN_PASS.body, roleId: 'translator'
    });
    expect(fns(w)).toEqual(['state', 'createUser', 'finish', 'signIn']);
    expect(await res.json()).toEqual({ session: { access_token: 'at-ye-481@people.langquest.org', refresh_token: 'rt' }, orgId: 'org1', signInName: 'ye-481' });
  });

  it('is safe to repeat: the account its key reaches makes no second one, and a session comes only until the key\'s first session', async () => {
    const { deps, w } = setup();
    await handleJoin(post(joinBody()), deps);
    w.calls = [];
    const again = await handleJoin(post(joinBody()), deps);
    expect(fns(w)).toEqual(['state', 'finish', 'signIn']);
    expect((await again.json() as { session?: unknown }).session).toBeDefined();
    // After the certificate call or a helper's code, nearby_join_finish says signIn false: the organization, no session.
    w.signIn = false;
    w.calls = [];
    const after = await handleJoin(post(joinBody()), deps);
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual({ orgId: 'org1', signInName: 'ye-481' });
    expect(fns(w)).not.toContain('signIn');
  });

  it('refuses a dead pass before any Auth call, with the word the app reads, and makes no account', async () => {
    for (const [refusal, status] of [
      ['pass expired', 'expired'], ['pass already used', 'used'], ['joining offline is off for this organization', 'off'],
      ['pass inviter\'s key revoked', 'retired'], ['pass role retired', 'retired'], ['pass role grants a manage privilege', 'retired'],
      ['pass role is no longer available from whoever sent it', 'retired']
    ] as const) {
      const { deps, w } = setup({}, { refusal });
      const res = await handleJoin(post(joinBody()), deps);
      expect(res.status).toBe(410);
      expect(await res.json()).toEqual({ error: refusal, status });
      expect(fns(w)).toEqual(['state']);
      expect(w.users.size).toBe(0);
    }
  });

  it('answers someone who already redeemed the pass after its uses run out, the flag goes off or the key is revoked', async () => {
    const { deps, w } = setup();
    await handleJoin(post(joinBody()), deps);
    w.refusal = 'pass already used';
    const res = await handleJoin(post(joinBody()), deps);
    expect(res.status).toBe(200);
    expect((await res.json() as { orgId: string }).orgId).toBe('org1');
  });

  it('refuses an id someone else holds or a deleted one, making no account, and reaches an account only with its own key', async () => {
    for (const [world, status] of [
      [{ taken: new Set([NEWCOMER_ID]) }, 'taken'],
      [{ deleted: new Set([NEWCOMER_ID]) }, 'deleted'],
      // Another newcomer's account, or an ordinary one with this id: its chain_key is not this key.
      [{ users: new Map([[NEWCOMER_ID, { chainKey: CHAIN_INVITER_KEY, email: 'x@people.langquest.org' }]]) }, 'taken']
    ] as const) {
      const { deps, w } = setup({}, world as Partial<World>);
      const res = await handleJoin(post(joinBody()), deps);
      expect(res.status).toBe(410);
      expect((await res.json() as { status: string }).status).toBe(status);
      expect(fns(w)).toEqual(['state']);
    }
  });

  it('recovers a retry after createUser with no key row, and a race that made the account first, never trying another id', async () => {
    const { deps, w } = setup({}, { users: new Map([[NEWCOMER_ID, { chainKey: PUBLIC_KEY, email: 'ye-007@people.langquest.org' }]]) });
    const res = await handleJoin(post(joinBody()), deps);
    expect(res.status).toBe(200);
    expect(w.keyed.has(NEWCOMER_ID)).toBe(true);
    expect(fns(w)).toEqual(['state', 'finish', 'signIn']);

    // createUser loses a race: the state now says mine, and it goes on.
    const race = setup();
    const create = race.deps.createUser;
    race.deps.createUser = async (a) => {
      race.w.users.set(a.id, { chainKey: a.chainKey, email: 'ye-999@people.langquest.org' });
      return create(a);
    };
    expect((await handleJoin(post(joinBody()), race.deps)).status).toBe(200);
    expect(fns(race.w)).toEqual(['state', 'createUser', 'state', 'finish', 'signIn']);
  });

  it('tries another sign-in name, never another id, when the address is taken', async () => {
    const { deps, w } = setup({}, { emailsTaken: new Set(['ye-481@people.langquest.org']) });
    expect((await handleJoin(post(joinBody()), deps)).status).toBe(200);
    expect(w.calls.filter((c) => c.fn === 'createUser').map((c) => c.args)).toEqual([
      { id: NEWCOMER_ID, email: 'ye-481@people.langquest.org', chainKey: PUBLIC_KEY },
      { id: NEWCOMER_ID, email: 'ye-482@people.langquest.org', chainKey: PUBLIC_KEY }
    ]);
  });

  it('keeps an account a refused redemption leaves behind, deleting nothing, and gives no session', async () => {
    const { deps, w } = setup({}, { finishRefusal: 'invite already used' });
    const res = await handleJoin(post(joinBody()), deps);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'invite already used', status: 'used' });
    expect(w.users.has(NEWCOMER_ID)).toBe(true);
    expect(fns(w)).not.toContain('signIn');
  });

  it('refuses a chain that is not a newcomer\'s, an id that does not follow from the key, a link the inviter did not sign, and a forged pass', async () => {
    const forgedId = await newcomer('09', { profileId: PROFILE });
    const wrongSigner = await newcomer('0a', { signer: '0b'.repeat(32) });
    const forgedPass = await newcomer('0c', { pass: { ...GOLDEN_PASS, body: { ...GOLDEN_PASS.body, maxUses: 50 } } });
    const unknownKid = await newcomer('0d', { pass: { ...GOLDEN_PASS, kid: 'k9' } });
    const cases: [Record<string, unknown>, RegExp][] = [
      [joinBody({ chain: [WORKER_LINK] }), /two links/],
      [joinBody({ chain: [...CHAIN, GOLDEN_LINK] }), /two links/],
      [{ ...joinBody({ chain: forgedId.chain, profileId: PROFILE, proof: forgedId.proof() }) }, /id does not follow from the key/],
      [joinBody({ chain: wrongSigner.chain, profileId: wrongSigner.profileId, proof: wrongSigner.proof() }), /bad link signature/],
      [joinBody({ chain: forgedPass.chain, profileId: forgedPass.profileId, proof: forgedPass.proof() }), /bad pass signature/],
      [joinBody({ chain: unknownKid.chain, profileId: unknownKid.profileId, proof: unknownKid.proof() }), /unknown pass key/]
    ];
    for (const [body, reason] of cases) {
      const { deps, w } = setup();
      const res = await handleJoin(post(body), deps);
      expect(res.status).toBe(410);
      const out = await res.json() as { error: string; status: string };
      expect(out.status).toBe('chain');
      expect(out.error).toMatch(reason);
      expect(w.calls).toEqual([]);
    }
  });

  it('refuses an id the request names other than the chain\'s, an upper-case one, and a proof by another key, device or request', async () => {
    const upper = NEWCOMER_ID.toUpperCase();
    const cases: [Record<string, unknown>, string][] = [
      [joinBody({ profileId: PROFILE }), 'chain'],
      [joinBody({ profileId: upper, proof: proofOf({ profileId: upper }) }), 'chain'],
      [joinBody({ proof: proofOf({ seed: INVITER_SEED }) }), 'proof'],
      [joinBody({ proof: proofOf({ deviceId: 'another' }) }), 'proof'],
      [joinBody({ proof: proofOf({ requestId: '66666666-6666-4666-8666-666666666666' }) }), 'proof']
    ];
    for (const [body, status] of cases) {
      const { deps, w } = setup();
      const res = await handleJoin(post(body), deps);
      expect(res.status).toBe(410);
      expect((await res.json() as { status: string }).status).toBe(status);
      expect(w.calls).toEqual([]);
    }
  });

  it('lets a second newcomer under the same pass in with an id of their own', async () => {
    const second = await newcomer('0e', { name: 'Achol' });
    const { deps, w } = setup();
    await handleJoin(post(joinBody()), deps);
    const res = await handleJoin(post(joinBody({ chain: second.chain, profileId: second.profileId, proof: second.proof() })), deps);
    expect(res.status).toBe(200);
    expect([...w.users.keys()]).toEqual([NEWCOMER_ID, second.profileId]);
    expect(w.users.get(second.profileId)).toEqual({ chainKey: second.key, email: 'achol-482@people.langquest.org' });
  });

  it('lets the same id in with an ordinary invite for the chain\'s organization, previewed before any account', async () => {
    const token = 'a1'.repeat(16);
    const ok = setup({}, { refusal: 'pass expired' });
    const res = await handleJoin(post(joinBody({ token })), ok.deps);
    expect(res.status).toBe(200);
    expect(fns(ok.w)).toEqual(['state', 'preview', 'createUser', 'finish', 'signIn']);
    expect(ok.w.calls.find((c) => c.fn === 'finish')!.args['token']).toBe(token);

    for (const [preview, status] of [
      [{ data: { status: 'ok', orgId: 'org2' }, error: null }, 'not_found'],
      [{ data: { status: 'not_found' }, error: null }, 'not_found'],
      [{ data: { status: 'expired', orgId: 'org1' }, error: null }, 'expired']
    ] as const) {
      const { deps, w } = setup({}, { preview });
      const out = await handleJoin(post(joinBody({ token })), deps);
      expect(out.status).toBe(410);
      expect((await out.json() as { status: string }).status).toBe(status);
      expect(fns(w)).toEqual(['state', 'preview']);
    }
  });

  it('stops at the per-address limit before any signature work, and answers 503 for not yet, never a refusal', async () => {
    let verified = 0;
    const limited = setup({ verify: async (...a) => { verified += 1; return subtleVerify(...a); } }, { allowed: false });
    expect((await handleJoin(post(joinBody()), limited.deps)).status).toBe(429);
    expect(verified).toBe(0);

    expect((await handleJoin(post(joinBody()), setup({ rootKeys: () => new Map() }).deps)).status).toBe(503);
    expect((await handleJoin(post(joinBody()), setup({}, { stateError: { code: 'PGRST202', message: 'no function' } }).deps)).status).toBe(503);
    expect((await handleJoin(post(joinBody()), setup({}, { stateError: { code: '57014', message: 'timeout' } }).deps)).status).toBe(503);
    expect((await handleJoin(post(joinBody()), setup({}, { finishError: { code: 'PGRST202', message: 'no function' } }).deps)).status).toBe(503);
    expect((await handleJoin(post(joinBody()), setup({}, { signInFails: true }).deps)).status).toBe(503);
    const thrown = setup({ state: async () => { throw new Error('network'); } });
    expect((await handleJoin(post(joinBody()), thrown.deps)).status).toBe(503);
  });

  it('asks for POST and a body it can read', async () => {
    const { deps, w } = setup();
    expect((await handleJoin(new Request(`https://next.langquest.org${JOIN_PATH}`), deps)).status).toBe(405);
    for (const bad of ['{', joinBody({ requestId: 'r1' }), joinBody({ chain: 'x' }), joinBody({ proof: 1 }), joinBody({ token: 'not-hex' }), 'x'.repeat(70_000)]) {
      expect((await handleJoin(post(bad), deps)).status).toBe(400);
    }
    expect(w.calls).toEqual([]);
  });

  it('is routed at its literal path, counts as nearby, and answers 503 where it is not set up', async () => {
    const { deps } = setup();
    const base = { profileOf: async () => null } as unknown as ApiDeps;
    expect((await handleApi(post(joinBody()), { ...base, join: deps })).status).toBe(200);
    expect((await handleApi(post(joinBody()), base)).status).toBe(503);
    expect(routeClass('POST', JOIN_PATH)).toBe('nearby');
  });
});

describe('accountFromChain and the chain it takes', () => {
  it('takes the golden chain as the newcomer\'s, with no expiry, and refuses a one-link chain', async () => {
    const ok = await checkJoinChain(CHAIN, { rootKeys: () => ROOT_KEYS, verify: subtleVerify, sha256: subtleSha256 });
    expect(ok.ok && ok.checked.holder).toEqual({ installKey: PUBLIC_KEY, profileId: NEWCOMER_ID, deviceId: NEWCOMER_DEVICE, name: 'Yé' });
    expect(await checkJoinChain([WORKER_LINK], { rootKeys: () => ROOT_KEYS, verify: subtleVerify, sha256: subtleSha256 })).toMatchObject({ ok: false });
  });

  it('a link core issues under a pass the Worker signs is one the route takes', async () => {
    const pass = await signJoinPass({ ...GOLDEN_PASS.body, passId: 'cd'.repeat(16) }, 'k1', (m) => signWith(ROOT_SEED, m));
    const key = publicOf('0f'.repeat(32));
    const salt = 'ICEiIyQlJicoKSorLC0uLw';
    const profileId = (await newcomerProfileId(key, salt, subtleSha256))!;
    const issued = await issueInviteLink({
      inviterLink: WORKER_LINK, pass, ask: { installKey: key, idSalt: salt, profileId, deviceId: 'd-0f', name: 'Deng' }, roleId: 'translator',
      now: GOLDEN_PASS.body.expiresAt - 1, sha256: subtleSha256, sign: (m) => signWith(INVITER_SEED, m)
    });
    expect(issued.ok).toBe(true);
    const chain = [WORKER_LINK, (issued as { link: InviteLink }).link];
    const checked = await checkJoinChain(chain, { rootKeys: () => ROOT_KEYS, verify: subtleVerify, sha256: subtleSha256 });
    expect(checked.ok).toBe(true);
    const { deps } = setup();
    expect(await accountFromChain((checked as { checked: CheckedJoin }).checked, deps)).toMatchObject({ kind: 'in', orgId: 'org1', signIn: true });
  });

  it('for the relay, does nothing more for an account with its key row and a live membership', async () => {
    const checked = await checkJoinChain(CHAIN, { rootKeys: () => ROOT_KEYS, verify: subtleVerify, sha256: subtleSha256 });
    const { deps, w } = setup({}, {
      users: new Map([[NEWCOMER_ID, { chainKey: PUBLIC_KEY, email: 'ye@people.langquest.org' }]]), keyed: new Set([NEWCOMER_ID]), members: new Set([NEWCOMER_ID])
    });
    expect(await accountFromChain((checked as { checked: CheckedJoin }).checked, deps, { relay: true })).toMatchObject({ kind: 'in' });
    expect(fns(w)).toEqual(['state']);
  });

  it('reads each refusal as the word the app knows', () => {
    expect(['pass expired', 'invite expired', 'pass already used', 'invite already used', 'joining offline is off for this organization', 'invite not found', 'pass role retired']
      .map(refusalStatus)).toEqual(['expired', 'expired', 'used', 'used', 'off', 'not_found', 'retired']);
  });
});
