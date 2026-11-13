import { randomBytes, randomUUID } from 'node:crypto';
import { base64urlEncode, firstContactText, nearbyBytes, newcomerProfileId } from '@langquest-next/core/nearby';
import { MemoryStore } from '@langquest-next/sync';
import { afterJoin, firstContactStatus, firstContactStep, joinAnswerOf, tokenSubject } from '../src/session/firstContactModel';
import { nobleSha256, nobleVerify } from '../src/nearby/nearbyCryptoModel';
import { inviteChain, person } from './localPersonFixtures';
import type { LocalPerson } from '../src/session/localPersonModel';

/**
 * A local person's first contact (src/nearby/firstContact.android.ts, the rules in
 * src/session/firstContactModel.ts; docs/nearby-sync-plan.md 14.1, 6): the join route asked with
 * the chain and proof of the install key, a session adopted only for this very id, the
 * certificate route asked until it answers, and every refusal keeping the person and their work.
 * The Worker is a fake behind `fetch`; the Keystore, the device store and supabase-js are faked.
 */

const fake = vi.hoisted(() => ({
  secure: new Map<string, string>(),
  store: null as unknown,
  sessions: [] as { access_token: string; refresh_token: string }[],
  sessionError: null as null | { message: string },
  noted: [] as string[],
  joins: [] as Record<string, unknown>[],
  certs: 0,
  join: null as null | ((body: Record<string, unknown>) => Response),
  cert: (): Response => new Response(JSON.stringify({ chains: [], discoveryKeys: [], passes: [], revocations: [] }))
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)), randomUUID: () => randomUUID() }));
vi.mock('../src/server/secureStorage', () => ({
  secureStorage: {
    getItem: async (k: string) => fake.secure.get(k) ?? null,
    setItem: async (k: string, v: string) => { fake.secure.set(k, v); },
    removeItem: async (k: string) => { fake.secure.delete(k); }
  }
}));
vi.mock('../src/storage/store', () => ({ getStore: async () => fake.store, fileLedgerDriver: async () => { throw new Error('no ledger here'); } }));
vi.mock('expo-file-system', () => ({ File: class {}, Paths: { availableDiskSpace: 0 } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined }
}));
vi.mock('../src/server/supabase', () => ({
  SESSION_KEY: 'sb-session',
  supabase: { auth: { getSession: async () => ({ data: { session: fake.sessions.length ? { access_token: fake.sessions.at(-1)!.access_token } : null }, error: null }) } }
}));
vi.mock('../src/server/auth', () => ({
  setSession: async (s: { access_token: string; refresh_token: string }) => {
    if (fake.sessionError) return { data: { session: null }, error: fake.sessionError };
    fake.sessions.push(s);
    return { data: { session: s }, error: null };
  }
}));
vi.mock('../src/server/localPerson', () => import('../src/server/localPerson.android'));
vi.mock('../src/server/nearbyKey', () => import('../src/server/nearbyKey.android'));
vi.mock('../src/nearby/holdChoice', () => import('../src/nearby/holdChoice.android'));
vi.mock('../src/diagnostics/report', () => ({ noteExpected: (where: string, e: unknown) => { fake.noted.push(`${where}: ${e instanceof Error ? e.message : String(e)}`); } }));

/** A Supabase access token for `sub`, as far as the phone reads one. */
const jwt = (sub: string) => `h.${base64urlEncode(new TextEncoder().encode(JSON.stringify({ sub, role: 'authenticated' })))}.s`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

async function load() {
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://next.example');
  const key = await import('../src/server/nearbyKey.android');
  // By the name the app imports it under, so the test and the app share the one held record.
  const local = await import('../src/server/localPerson');
  const contact = await import('../src/nearby/firstContact.android');
  return { key, local, contact };
}

/** A phone with a local person on it: the install key in the Keystore, and the record a grant and a whole copy left. */
async function phoneWithLocalPerson(over: Partial<LocalPerson> = {}) {
  const p = await load();
  const key = (await p.key.ensureInstallKey())!;
  const idSalt = base64urlEncode(new Uint8Array(randomBytes(16)));
  const profileId = (await newcomerProfileId(key.publicKey, idSalt, nobleSha256))!;
  const record = person({ profileId, installKey: key.publicKey, idSalt, chain: inviteChain({ profileId, installKey: key.publicKey, idSalt }), ...over });
  expect(await p.local.keepLocalPerson(record)).toBe(true);
  return { ...p, profileId, publicKey: key.publicKey, record };
}

beforeEach(() => {
  fake.secure.clear();
  fake.store = new MemoryStore();
  fake.sessions.length = 0;
  fake.sessionError = null;
  fake.noted.length = 0;
  fake.joins.length = 0;
  fake.certs = 0;
  fake.join = null;
  fake.cert = () => new Response(JSON.stringify({ chains: [], discoveryKeys: [], passes: [], revocations: [] }));
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === 'https://next.example/api/nearby/join') {
      const body = JSON.parse(init!.body as string) as Record<string, unknown>;
      fake.joins.push(body);
      expect((init!.headers as Record<string, string>)['Authorization']).toBeUndefined();
      return fake.join!(body);
    }
    if (url === 'https://next.example/api/nearby/certificate') { fake.certs += 1; return fake.cert(); }
    throw new Error(`no route ${url}`);
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('the join route\'s answers', () => {
  it('reads a session, an account with none, a refusal, and not yet', () => {
    const session = { access_token: 'a', refresh_token: 'r' };
    expect(joinAnswerOf(200, { session, orgId: 'o1', signInName: 'nyibol-482' })).toEqual({ kind: 'in', session, orgId: 'o1', signInName: 'nyibol-482' });
    expect(joinAnswerOf(200, { orgId: 'o1', signInName: 'nyibol-482' })).toEqual({ kind: 'in', orgId: 'o1', signInName: 'nyibol-482' });
    expect(joinAnswerOf(410, { error: 'pass expired', status: 'expired' })).toEqual({ kind: 'refused', status: 'expired', error: 'pass expired' });
    expect(joinAnswerOf(410, null)).toEqual({ kind: 'refused', status: 'refused', error: '' });
    expect(joinAnswerOf(429, null)).toEqual({ kind: 'later', status: 429 });
    expect(joinAnswerOf(503, {})).toEqual({ kind: 'later', status: 503 });
    for (const [status, body] of [[200, null], [200, { orgId: 'o1' }], [200, { orgId: 'o1', signInName: 'x', session: { access_token: 'a' } }], [400, {}], [500, {}]] as const) {
      expect(joinAnswerOf(status, body)).toBeNull();
    }
  });

  it('a session is adopted only for this very id', () => {
    expect(tokenSubject(jwt('newcomer-1'))).toBe('newcomer-1');
    expect(tokenSubject('nope')).toBeNull();
    expect(tokenSubject('a.%%%.c')).toBeNull();
  });

  it('what happens next, and what a screen says, for each record and session', () => {
    const ready = person({ stage: 'ready' });
    expect(firstContactStep(null, null)).toBe('none');
    for (const stage of ['asking', 'filling', 'done'] as const) expect(firstContactStep(person({ stage }), null)).toBe('none');
    expect(firstContactStep(ready, null)).toBe('join');
    expect(firstContactStep(ready, 'newcomer-1')).toBe('adopt');
    expect(firstContactStep(person({ stage: 'joined' }), 'newcomer-1')).toBe('certificate');
    // Its session went: key sign-in is still open until the certificate route answers, so it joins again.
    expect(firstContactStep(person({ stage: 'joined' }), null)).toBe('join');
    expect(firstContactStep(ready, 'someone-else')).toBe('otherAccount');
    const refused = person({ refused: { status: 'used', at: 1 } });
    expect(firstContactStep(refused, null)).toBe('stopped');
    expect(firstContactStep(refused, null, true)).toBe('join');

    expect(firstContactStatus(ready, null, false, null)).toEqual({ kind: 'waiting' });
    expect(firstContactStatus(ready, null, true, null)).toEqual({ kind: 'joining' });
    expect(firstContactStatus(ready, null, false, 'keyLost')).toEqual({ kind: 'blocked', why: 'keyLost' });
    expect(firstContactStatus(ready, 'someone-else', false, null)).toEqual({ kind: 'blocked', why: 'otherAccount' });
    expect(firstContactStatus(person({ stage: 'joined' }), 'newcomer-1', false, null)).toEqual({ kind: 'finishing' });
    expect(firstContactStatus(refused, null, false, null)).toEqual({ kind: 'refused', status: 'used' });
    expect(firstContactStatus(person({ needsCode: { signInName: 'n-1', at: 1 } }), null, false, null)).toEqual({ kind: 'needsCode', signInName: 'n-1' });
    expect(firstContactStatus(person({ stage: 'done' }), 'newcomer-1', false, null)).toEqual({ kind: 'none' });
  });

  it('a refusal or a helper\'s code replaces the other, and a session clears both', () => {
    const p = person({ refused: { status: 'used', at: 1 } });
    expect(afterJoin(p, { kind: 'in', orgId: 'o1', signInName: 'n-1' }, 5).person).toEqual({ ...person(), needsCode: { signInName: 'n-1', at: 5 } });
    expect(afterJoin(p, { kind: 'refused', status: 'taken', error: '' }, 6).person.refused).toEqual({ status: 'taken', at: 6 });
    const s = { access_token: 'a', refresh_token: 'r' };
    expect(afterJoin(p, { kind: 'in', orgId: 'o1', signInName: 'n-1', session: s }, 7)).toEqual({ person: person(), adopt: s });
    expect(afterJoin(p, { kind: 'later', status: 503 }, 8).person).toBe(p);
  });
});

describe('first contact on an Android phone', () => {
  it('fails offline and is tried again with the same request id, then adopts the session and asks the certificate route until it answers', async () => {
    const p = await phoneWithLocalPerson();
    // No connection: nothing changes, and the scheduler backs off.
    fake.join = () => { throw new TypeError('Network request failed'); };
    expect(await p.contact.firstContactTurn(null)).toEqual({ offline: true });
    expect((await p.local.readLocalPerson())?.stage).toBe('ready');
    // Not yet: a town's phones share one address.
    fake.join = () => json(429, { error: 'Too many requests.' });
    expect(await p.contact.firstContactTurn(null)).toEqual({ offline: true });
    // In, with a session for this id; the certificate route is busy the first time.
    fake.join = () => json(200, { session: { access_token: jwt(p.profileId), refresh_token: 'r1' }, orgId: 'org-1', signInName: 'nyibol-482' });
    fake.cert = () => json(503, { error: 'later' });
    expect(await p.contact.firstContactTurn(null)).toEqual({ offline: true });
    expect(fake.sessions).toEqual([{ access_token: jwt(p.profileId), refresh_token: 'r1' }]);
    expect((await p.local.readLocalPerson())?.stage).toBe('joined');
    expect(fake.certs).toBe(1);

    // Every try sent the chain, the id, one request id, and a proof of this key over the First contact text.
    expect(fake.joins).toHaveLength(3);
    const ids = new Set(fake.joins.map((b) => b['requestId']));
    expect(ids.size).toBe(1);
    for (const body of fake.joins) {
      expect(body).toMatchObject({ chain: p.record.chain, profileId: p.profileId });
      expect(body['token']).toBeUndefined();
      const text = firstContactText({ profileId: p.profileId, deviceId: p.record.deviceId, publicKey: p.publicKey, requestId: body['requestId'] as string });
      expect(nobleVerify(p.publicKey, nearbyBytes('firstContact', text), body['proof'] as string)).toBe(true);
    }

    // Signed in now (the session's id is the person's): the next turn asks only the certificate route.
    fake.cert = () => new Response(JSON.stringify({ chains: [], discoveryKeys: [], passes: [], revocations: [] }));
    expect(await p.contact.firstContactTurn(p.profileId)).toEqual({ offline: false });
    expect(fake.joins).toHaveLength(3);
    expect(fake.certs).toBe(2);
    expect((await p.local.readLocalPerson())?.stage).toBe('done');
    // Over: nothing more is sent.
    expect(await p.contact.firstContactTurn(p.profileId)).toEqual({ offline: false });
    expect(fake.joins).toHaveLength(3);
    expect(fake.certs).toBe(2);
  });

  it('a refusal keeps the person and their work, says why, and sends nothing more until an invite\'s token', async () => {
    const p = await phoneWithLocalPerson();
    fake.join = () => json(410, { error: 'pass expired', status: 'expired' });
    expect(await p.contact.firstContactTurn(null)).toEqual({ offline: false });
    const kept = (await p.local.readLocalPerson())!;
    expect(kept).toMatchObject({ profileId: p.profileId, stage: 'ready', refused: { status: 'expired' } });
    expect(kept.chain).toEqual(p.record.chain);
    expect(p.local.localPersonHolds()).toBe(true);
    expect(firstContactStatus(kept, null, false, null)).toEqual({ kind: 'refused', status: 'expired' });
    expect(await p.contact.firstContactTurn(null)).toEqual({ offline: false });
    expect(fake.joins).toHaveLength(1);
    expect(fake.sessions).toEqual([]);
    expect(fake.certs).toBe(0);

    // Someone with Invite let the same id in with an ordinary invite: the token goes with the chain and proof.
    const token = 'ab'.repeat(32);
    fake.join = () => json(200, { session: { access_token: jwt(p.profileId), refresh_token: 'r' }, orgId: 'org-1', signInName: 'nyibol-482' });
    expect(await p.contact.firstContactTurn(null, token)).toEqual({ offline: false });
    expect(fake.joins[1]).toMatchObject({ token, profileId: p.profileId });
    expect((await p.local.readLocalPerson())).toMatchObject({ stage: 'done' });
    expect((await p.local.readLocalPerson())?.refused).toBeUndefined();
  });

  it('an account whose key sign-in is over needs a helper\'s code, and keeps the person', async () => {
    const p = await phoneWithLocalPerson();
    fake.join = () => json(200, { orgId: 'org-1', signInName: 'nyibol-482' });
    expect(await p.contact.firstContactTurn(null)).toEqual({ offline: false });
    expect(await p.local.readLocalPerson()).toMatchObject({ stage: 'ready', needsCode: { signInName: 'nyibol-482' } });
    expect(fake.sessions).toEqual([]);
  });

  it('never adopts a session for another id, and a session that would not set is tried again', async () => {
    const p = await phoneWithLocalPerson();
    fake.join = () => json(200, { session: { access_token: jwt('someone-else'), refresh_token: 'r' }, orgId: 'org-1', signInName: 'x' });
    expect(await p.contact.firstContactTurn(null)).toEqual({ offline: true });
    expect(fake.sessions).toEqual([]);
    expect((await p.local.readLocalPerson())?.stage).toBe('ready');
    expect(fake.noted.some((n) => n.includes('another id'))).toBe(true);

    fake.join = () => json(200, { session: { access_token: jwt(p.profileId), refresh_token: 'r' }, orgId: 'org-1', signInName: 'x' });
    fake.sessionError = { message: 'Network request failed' };
    expect(await p.contact.firstContactTurn(null)).toEqual({ offline: true });
    expect((await p.local.readLocalPerson())?.stage).toBe('ready');
    expect(fake.certs).toBe(0);
  });

  it('a restart between the session and the record: the saved session is recorded, then the certificate route asked', async () => {
    const p = await phoneWithLocalPerson();
    // supabase-js saved the session the join route gave; the record still says ready.
    fake.sessions.push({ access_token: jwt(p.profileId), refresh_token: 'r' });
    fake.join = () => { throw new Error('the join route is not asked again'); };
    expect(await p.contact.firstContactTurn(p.profileId)).toEqual({ offline: false });
    expect(fake.joins).toHaveLength(0);
    expect(fake.certs).toBe(1);
    expect((await p.local.readLocalPerson())?.stage).toBe('done');
  });

  it('sends nothing for someone else\'s session, or with an install key that is not this person\'s', async () => {
    const p = await phoneWithLocalPerson();
    fake.join = () => { throw new Error('nothing is sent'); };
    expect(await p.contact.firstContactTurn('someone-else')).toEqual({ offline: false, block: 'otherAccount' });
    await p.key.replaceInstallKey();
    expect(await p.contact.firstContactTurn(null)).toEqual({ offline: false, block: 'keyLost' });
    expect(fake.joins).toEqual([]);
    expect((await p.local.readLocalPerson())?.stage).toBe('ready');
  });

  it('one turn at a time: two asked at once send the join route once', async () => {
    const p = await phoneWithLocalPerson();
    fake.join = () => json(503, {});
    const [a, b] = await Promise.all([p.contact.firstContactTurn(null), p.contact.firstContactTurn(null)]);
    expect([a, b]).toEqual([{ offline: true }, { offline: true }]);
    expect(fake.joins).toHaveLength(1);
  });
});
