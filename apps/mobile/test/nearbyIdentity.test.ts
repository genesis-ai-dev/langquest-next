import { randomBytes, randomUUID } from 'node:crypto';
import { certRequestText, joinPassBody, nearbyBytes, revocationText, type ChainLink } from '@langquest-next/core/nearby';
import { nobleSha256 } from '../src/nearby/nearbyCryptoModel';
import { MemoryStore, SyncClient } from '@langquest-next/sync';
import { nearbyClient } from '@langquest-next/sync/nearby';
import { FakeServer } from '../../../packages/sync/src/testing/fakeServer';
import { fakeSigner, fakeWorker } from '../../../packages/sync/src/testing/memoryNearbyLink';
import { nobleVerify } from '../src/nearby/nearbyCryptoModel';

/**
 * A phone's nearby identity (src/nearby/nearbyIdentity.android.ts; docs/nearby-sync-plan.md 5.5,
 * 5.10, 5.12): the flag from get_user_state, the install key, the certificate call and what is
 * kept of its answer, against a Worker that signs with real Ed25519 (the fleet's `fakeWorker`).
 * The Keystore, the device store and the call are faked; nothing else is.
 */

const fake = vi.hoisted(() => ({
  secure: new Map<string, string>(),
  store: null as unknown,
  calls: [] as { publicKey: string; deviceId: string; languages: string[]; proof: string }[],
  answer: null as null | ((req: { publicKey: string; deviceId: string; languages: string[]; proof: string }) => Promise<{ kind: 'answer'; body: unknown } | { kind: 'later'; status: number }>),
  noted: [] as string[]
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
vi.mock('../src/storage/store', () => ({ getStore: async () => fake.store }));
// The phone's nearby files share the module, and none of this touches them.
vi.mock('expo-file-system', () => ({ File: class {}, Paths: { availableDiskSpace: 0 } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined }
}));
// Signing out here (src/server/lock.ts) asks the server nothing: with nothing stored, supabase-js only says SIGNED_OUT.
vi.mock('../src/server/supabase', () => ({
  SESSION_KEY: 'sb-session',
  supabase: { auth: { stopAutoRefresh: async () => undefined, startAutoRefresh: async () => undefined, signOut: async () => ({ error: null }) } }
}));
vi.mock('../src/server/nearby', () => ({
  requestCertificate: async (req: (typeof fake.calls)[number]) => { fake.calls.push(req); return fake.answer!(req); }
}));
// The Android key, as Metro gives it to the Android files.
vi.mock('../src/server/nearbyKey', () => import('../src/server/nearbyKey.android'));
vi.mock('../src/nearby/holdChoice', () => import('../src/nearby/holdChoice.android'));
vi.mock('../src/diagnostics/report', () => ({ noteExpected: (where: string, e: unknown) => { fake.noted.push(`${where}: ${e instanceof Error ? e.message : String(e)}`); } }));

const ME = '11111111-1111-4111-8111-111111111111';
const session = (actorId: string) => JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 1_700_000_000, user: { id: actorId } });
const worker = fakeWorker('k1');
const rogue = fakeWorker('k2');
const ROOT = fakeSigner('worker:k1');
const KEY_A = 'iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w';

type Phone = Awaited<ReturnType<typeof load>>;

async function load() {
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_NEARBY_CERT_KEYS', `k1:${worker.rootKeys.get('k1')}`);
  const identity = await import('../src/nearby/nearbyIdentity.android');
  const flag = await import('../src/nearby/nearbyFlag');
  const phone = await import('../src/nearby/nearbyPhone.android');
  const key = await import('../src/server/nearbyKey.android');
  const hold = await import('../src/nearby/holdChoice');
  const lock = await import('../src/server/lock');
  const signOut = await import('../src/nearby/nearbySignOut');
  return { identity, flag, phone, key, hold, lock, signOut };
}

const org = (languages: string[], roleId = 'tr') => ({
  members: { [ME]: { org: { roleId: { value: roleId, hlc: '', eventId: '' }, removed: { value: false, hlc: '', eventId: '' }, scope: { level: 'org' } } } },
  roles: { tr: { name: { value: 'T', hlc: '', eventId: '' }, privileges: { value: ['translate'], hlc: '', eventId: '' }, retired: false } },
  languages: Object.fromEntries(languages.map((l) => [l, {}]))
}) as never;

/** The Worker's answer for one organization: a chain for whoever asked, keys for what it named in `o1`, and a list. */
function issued(o: { signer?: typeof worker; revokedSeq?: number; orgs?: string[] } = {}) {
  return async (req: (typeof fake.calls)[number]) => {
    const orgs = o.orgs ?? ['o1'];
    const chains = await Promise.all(orgs.map(async (orgId) => ({ orgId, chain: await (o.signer ?? worker).certify({ installKey: req.publicKey, profileId: ME, deviceId: req.deviceId }, { orgId, privileges: ['translate'] }) })));
    const discoveryKeys = req.languages.filter((l) => orgs.some((orgId) => l.startsWith(`${orgId}/`)))
      .map((l) => ({ orgId: l.split('/')[0]!, languageId: l.split('/')[1]!, gen: 2, floor: 1, key: KEY_A }));
    const revocations = o.revokedSeq ? [await (async () => {
      const text = revocationText({ v: 1, kid: 'k1', orgId: 'o1', seq: o.revokedSeq!, keys: [[KEY_A, 'someone', 1700000000000]] });
      return { orgId: 'o1', text, kid: 'k1', sig: await ROOT.sign(nearbyBytes('revoked', text)) };
    })()] : [];
    return { kind: 'answer' as const, body: { chains, discoveryKeys, passes: [], revocations } };
  };
}

const findKeys = () => JSON.parse(fake.secure.get(`nearbyFindKeys:${ME}`) ?? '{}') as Record<string, unknown>;
const store = () => fake.store as MemoryStore;
const input = (p: Phone, over: Partial<Parameters<Phone['identity']['refreshNearbyIdentity']>[0]> = {}) =>
  p.identity.refreshNearbyIdentity({ actorId: ME, orgId: 'o1', org: org(['L1', 'L2']), languageId: 'L1', ...over });

beforeEach(() => {
  fake.secure.clear();
  fake.secure.set('sb-session', session(ME));
  fake.store = new MemoryStore();
  fake.calls.length = 0;
  fake.noted.length = 0;
  fake.answer = issued();
});

describe('the nearby identity', () => {
  it('asks nothing, and makes no key, until the server has said which organizations are on', async () => {
    const p = await load();
    await input(p);
    p.flag.heardUserState(ME, { termsVersion: '1' });
    await input(p);
    p.flag.heardUserState(ME, { orgFeatures: { o1: ['nearby_join'] } });
    await input(p);
    expect(fake.calls).toEqual([]);
    expect(await p.key.installKey()).toBeNull();
  });

  it('with nearby on: makes the key, proves it, and keeps the chain, the languages\' keys and the list', async () => {
    const p = await load();
    fake.answer = issued({ revokedSeq: 3 });
    p.flag.heardUserState(ME, { orgFeatures: { o1: ['nearby'] } });
    await store().setCursor('o1', 'L2', 5);
    await input(p);
    expect(fake.calls).toHaveLength(1);
    const [call] = fake.calls;
    const key = (await p.key.installKey())!;
    expect(call!.publicKey).toBe(key.publicKey);
    expect(call!.languages).toEqual(['o1/L1', 'o1/L2']);
    expect(nobleVerify(key.publicKey, nearbyBytes('certRequest', certRequestText({ profileId: ME, deviceId: call!.deviceId, publicKey: key.publicKey })), call!.proof)).toBe(true);
    expect(Object.keys(await p.phone.readChains(ME))).toEqual(['o1']);
    expect(p.phone.holdsCertificate(ME, 'o1')).toBe(true);
    expect(p.phone.holdsCertificate(ME, 'o2')).toBe(false);
    expect(findKeys()).toEqual({ 'o1/L1': { gen: 2, key: KEY_A, floor: 1, direct: true }, 'o1/L2': { gen: 2, key: KEY_A, floor: 1, direct: true } });
    expect((await p.phone.readRevoked('o1'))?.list.seq).toBe(3);
    // The key is in the Keystore, never in the plain store.
    expect(JSON.stringify([...(store() as unknown as { metas: Map<string, string> }).metas])).not.toContain(fake.secure.get('nearby-install-key')!);
    // Asked once: the next pull, a day early, asks nothing.
    await input(p);
    expect(fake.calls).toHaveLength(1);
    expect(fake.noted).toEqual([]);
  });

  it('asks again on a membership change, a newer list, and the first time a language with no key opens', async () => {
    const p = await load();
    p.flag.heardUserState(ME, { orgFeatures: { o1: ['nearby'] } });
    await input(p);
    await input(p, { org: org(['L1', 'L2'], 'admin') });
    expect(fake.calls).toHaveLength(2);
    fake.answer = issued({ revokedSeq: 2 });
    p.flag.heardUserState(ME, { orgFeatures: { o1: ['nearby'] }, nearbyRevokedSeq: { o1: 2 } });
    await input(p, { org: org(['L1', 'L2'], 'admin') });
    expect(fake.calls).toHaveLength(3);
    expect((await p.phone.readRevoked('o1'))?.list.seq).toBe(2);
    // A language with no key: once, and not again this run if the answer has none for it.
    fake.answer = issued();
    const bare = async () => ({ kind: 'answer' as const, body: { chains: [{ orgId: 'o1', chain: (await p.phone.readChains(ME))['o1'] }], discoveryKeys: [], passes: [], revocations: [] } });
    fake.answer = bare;
    await input(p, { org: org(['L1', 'L2', 'L3'], 'admin'), languageId: 'L3' });
    await input(p, { org: org(['L1', 'L2', 'L3'], 'admin'), languageId: 'L3' });
    expect(fake.calls).toHaveLength(4);
    expect(fake.calls[3]!.languages).toContain('o1/L3');
  });

  it('keeps no chain the Worker\'s bundled keys do not sign, and so no discovery key', async () => {
    const p = await load();
    fake.answer = issued({ signer: rogue });
    p.flag.heardUserState(ME, { orgFeatures: { o1: ['nearby'] } });
    await input(p);
    expect(await p.phone.readChains(ME)).toEqual({});
    expect(findKeys()).toEqual({});
    expect(fake.noted.some((n) => n.startsWith('nearby certificate'))).toBe(true);
  });

  it('on a build from before the Worker\'s key rotated, keeps the chain and discovery keys the old key signed (scripts/nearby-signing-key.sh)', async () => {
    const p = await load();
    p.flag.heardUserState(ME, { orgFeatures: { o1: ['nearby'] } });
    await input(p);
    const held = await p.phone.readChains(ME);
    expect(Object.keys(held)).toEqual(['o1']);
    // The Worker now signs with a key this build does not carry: its answer cannot be checked, so it changes nothing here.
    fake.answer = async (req) => {
      const body = (await issued({ signer: rogue })(req)).body;
      return { kind: 'answer', body: { ...body, discoveryKeys: body.discoveryKeys.map((k) => ({ ...k, gen: 3, key: `${'B'.repeat(42)}A` })) } };
    };
    await input(p, { org: org(['L1', 'L2'], 'admin') });
    expect(fake.calls).toHaveLength(2);
    expect(await p.phone.readChains(ME)).toEqual(held);
    expect(p.phone.holdsCertificate(ME, 'o1')).toBe(true);
    expect(findKeys()).toEqual({ 'o1/L1': { gen: 2, key: KEY_A, floor: 1, direct: true } });
    expect(fake.noted.some((n) => n.startsWith('nearby certificate'))).toBe(true);
  });

  it('drops an organization a checked answer no longer names, while keeping one whose new chain it could not check', async () => {
    const p = await load();
    p.flag.heardUserState(ME, { orgFeatures: { o1: ['nearby'], o2: ['nearby'], o3: ['nearby'] } });
    fake.answer = issued({ orgs: ['o1', 'o2', 'o3'] });
    await input(p);
    await input(p, { orgId: 'o2', org: org(['L9']), languageId: 'L9' });
    await input(p, { orgId: 'o3', org: org(['L5']), languageId: 'L5' });
    expect(Object.keys(findKeys()).sort()).toEqual(['o1/L1', 'o2/L9', 'o3/L5']);
    const o3 = (await p.phone.readChains(ME))['o3'];
    // o1 checks, o2 is not named (this person left it), o3's chain is signed by a key this build does not trust.
    fake.answer = async (req) => {
      const good = (await issued({ orgs: ['o1'] })(req)).body;
      const bad = (await issued({ orgs: ['o3'], signer: rogue })(req)).body;
      return { kind: 'answer', body: { ...good, chains: [...good.chains, ...bad.chains], discoveryKeys: [...good.discoveryKeys, ...bad.discoveryKeys] } };
    };
    await input(p, { org: org(['L1'], 'admin') });
    expect(Object.keys(await p.phone.readChains(ME)).sort()).toEqual(['o1', 'o3']);
    expect((await p.phone.readChains(ME))['o3']).toEqual(o3);
    expect(Object.keys(findKeys()).sort()).toEqual(['o1/L1', 'o3/L5']);
  });

  it('makes a new key when the old one was revoked, drops every chain naming it, and asks once more', async () => {
    const p = await load();
    p.flag.heardUserState(ME, { orgFeatures: { o1: ['nearby'] } });
    await input(p);
    const old = (await p.key.installKey())!.publicKey;
    await store().setMeta('nearbyChain:someone-else', JSON.stringify({ o1: [] }));
    let first = true;
    fake.answer = async (req) => {
      if (first) { first = false; return { kind: 'answer', body: { revoked: true } }; }
      return issued()(req);
    };
    await input(p, { org: org(['L1'], 'admin') });
    const now = (await p.key.installKey())!.publicKey;
    expect(now).not.toBe(old);
    expect(fake.calls.slice(1).map((c) => c.publicKey)).toEqual([old, now]);
    expect(await store().meta('nearbyChain:someone-else')).toBeUndefined();
    const chain = (await p.phone.readChains(ME))['o1'] as ChainLink[];
    expect(chain[0]!.kind === 'worker@1' && chain[0]!.body.installKey).toBe(now);
  });

  it('drops the chain and discovery keys of an organization turned off, with no call', async () => {
    const p = await load();
    p.flag.heardUserState(ME, { orgFeatures: { o1: ['nearby'], o2: ['nearby'] } });
    fake.answer = issued({ orgs: ['o1', 'o2'] });
    await input(p);
    await input(p, { orgId: 'o2', org: org(['L9']), languageId: 'L9' });
    expect(Object.keys(findKeys()).sort()).toEqual(['o1/L1', 'o2/L9']);
    const calls = fake.calls.length;
    p.flag.heardUserState(ME, { orgFeatures: { o2: ['nearby'] } });
    await input(p, { orgId: 'o2', org: org(['L9']), languageId: 'L9' });
    expect(fake.calls.length).toBe(calls);
    expect(Object.keys(await p.phone.readChains(ME))).toEqual(['o2']);
    expect(Object.keys(findKeys())).toEqual(['o2/L9']);
    p.flag.heardUserState(ME, { orgFeatures: {} });
    await input(p);
    expect(await p.phone.readChains(ME)).toEqual({});
    expect(fake.secure.has(`nearbyFindKeys:${ME}`)).toBe(false);
    expect(p.phone.holdsCertificate(ME, 'o2')).toBe(false);
  });

  it('keeps what it holds when the Worker says later, and asks again on the next check', async () => {
    const p = await load();
    p.flag.heardUserState(ME, { orgFeatures: { o1: ['nearby'] } });
    fake.answer = async () => ({ kind: 'later', status: 503 });
    await input(p);
    expect(await p.phone.readChains(ME)).toEqual({});
    fake.answer = issued();
    await input(p);
    expect(fake.calls).toHaveLength(2);
    expect(p.phone.holdsCertificate(ME, 'o1')).toBe(true);
  });

  it('gives each person and organization one nearby half, and the door real signatures', async () => {
    const p = await load();
    p.flag.heardUserState(ME, { orgFeatures: { o1: ['nearby'] } });
    await input(p);
    expect(await p.phone.nearbyMakerFor('o1', ME)).toBe(await p.phone.nearbyMakerFor('o1', ME));
    expect(await p.phone.nearbyMakerFor('o2', ME)).not.toBe(await p.phone.nearbyMakerFor('o1', ME));
    const signer = (await p.phone.nearbySignerFor('o1', [ME, 'nobody']))!;
    expect(signer.publicKey).toBe((await p.key.installKey())!.publicKey);
    expect(signer.chainFor(ME)).toEqual((await p.phone.readChains(ME))['o1']);
    expect(signer.chainFor('nobody')).toBeNull();
    const message = new Uint8Array([1, 2, 3]);
    const sig = await signer.sign(message);
    const gate = await p.phone.nearbyGateFor('o1', org(['L1']), 0);
    expect(gate.rootKeys).toEqual(worker.rootKeys);
    expect(await gate.verify!(signer.publicKey, message, sig)).toBe(true);
    expect(await gate.verify!(signer.publicKey, new Uint8Array([1, 2]), sig)).toBe(false);
    expect(gate.people().privilegesIn(ME, 'L1').has('translate')).toBe(true);
  });

  it('writes no discovery key in the clear for someone who signed out while the certificate call was out', async () => {
    const p = await load();
    await p.lock.setLockPattern(ME, [0, 1, 2, 4, 6, 7, 8], 3);
    p.flag.heardUserState(ME, { orgFeatures: { o1: ['nearby'] } });
    // Sign Out lands while the Worker is answering; then someone else signs in on this phone.
    fake.answer = async (req) => { await p.lock.lockAndSignOut(ME); fake.secure.set('sb-session', session('mary')); return issued()(req); };
    await input(p);
    expect(fake.calls).toHaveLength(1);
    expect(fake.secure.has(`nearbyFindKeys:${ME}`)).toBe(false);
    expect([...fake.secure.values()].join()).not.toContain(KEY_A);
    // That answer settled nothing: signed in again, the next check asks, and its answer brings them back.
    fake.secure.set('sb-session', session(ME));
    fake.answer = issued();
    await input(p);
    expect(fake.calls).toHaveLength(2);
    expect(Object.keys(findKeys())).toEqual(['o1/L1']);
  });

  it('a sign-out the server forced leaves no discovery key in the clear, and no nearbyPeers (5.12 "The store")', async () => {
    const p = await load();
    p.flag.heardUserState(ME, { orgFeatures: { o1: ['nearby'] } });
    await input(p);
    expect(Object.keys(findKeys())).toEqual(['o1/L1']);
    fake.secure.set('nearbyFindKeys:mary', 'mary\'s, untouched');
    await store().setMeta('nearbyPeers:o1/L1', '[]');
    await store().setMeta('nearbyPeers:o1/L2', '[]');
    await store().setMeta('deviceId', 'd1');
    // supabase-js deleted the session when renewing was refused, then said SIGNED_OUT; nobody chose it.
    fake.secure.delete('sb-session');
    await p.signOut.nearbyAfterAuthEvent('SIGNED_OUT', JSON.parse(session(ME)));
    expect(fake.secure.has(`nearbyFindKeys:${ME}`)).toBe(false);
    expect([...fake.secure.values()].join()).not.toContain(KEY_A);
    expect(await store().meta('nearbyPeers:o1/L1')).toBeUndefined();
    expect(await store().meta('nearbyPeers:o1/L2')).toBeUndefined();
    expect(fake.secure.get('nearbyFindKeys:mary')).toBe('mary\'s, untouched');
    expect(await store().meta('deviceId')).toBe('d1');
    // Any other event, or a sign-out with nobody signed in before, touches nothing.
    await store().setMeta('nearbyPeers:o1/L1', '[]');
    await p.signOut.nearbyAfterAuthEvent('TOKEN_REFRESHED', JSON.parse(session(ME)));
    await p.signOut.nearbyAfterAuthEvent('SIGNED_OUT', null);
    expect(await store().meta('nearbyPeers:o1/L1')).toBe('[]');
  });

  it('keeps the hold choice: on by default, off under a disguise, as pressed once pressed', async () => {
    const p = await load();
    expect(p.hold.currentHoldChoice()).toBeNull();
    await p.identity.refreshHoldChoice(false);
    expect(p.hold.currentHoldChoice()).toEqual({ hold: true });
    await p.identity.refreshHoldChoice(true);
    expect(p.hold.currentHoldChoice()).toEqual({ hold: false, reviewWindow: 5 });
    await store().setMeta('nearbyHold', 'true');
    await p.identity.refreshHoldChoice(true);
    expect(p.hold.currentHoldChoice()).toEqual({ hold: true });
  });

  it('signs the unsent work of everyone on this phone with a certificate here, signed out or not (Carl\'s answer 5)', async () => {
    const MARY = '22222222-2222-4222-8222-222222222222';
    const JOE = '33333333-3333-4333-8333-333333333333';
    const p = await load();
    p.flag.heardUserState(ME, { orgFeatures: { o1: ['nearby'] } });
    await input(p);
    const { publicKey, deviceId } = fake.calls[0]!;
    // Mary signed out earlier, and her chain for this organization stayed (5.5); Joe holds one for another organization only.
    await p.phone.keepChains(MARY, { o1: await worker.certify({ installKey: publicKey, profileId: MARY, deviceId }, { orgId: 'o1', privileges: ['translate'] }) });
    await p.phone.keepChains(JOE, { o2: await worker.certify({ installKey: publicKey, profileId: JOE, deviceId }, { orgId: 'o2', privileges: ['translate'] }) });
    expect((await p.phone.chainPeople()).sort()).toEqual([ME, MARY, JOE].sort());

    const server = new FakeServer();
    const maker = nearbyClient({ sha256: async (b) => b.slice(0, 32), holdsCertificate: () => true });
    let n = 0;
    const clientOf = (actorId: string) => new SyncClient({
      orgId: 'o1', streamId: 'L1', actorId, deviceId, store: store(), transport: server.transportFor(), now: () => 1_700_000_000_000,
      newId: () => `${actorId}:e${++n}`, nearby: maker
    });
    const unit = (id: string) => ({ unitId: id, parentUnitId: null, kind: 'passage', label: id, order: id });
    for (const who of [MARY, JOE, ME]) {
      const c = clientOf(who);
      await c.load();
      await c.append('v1.UnitAdded', unit(`u-${who}`));
    }
    const mine = clientOf(ME);
    await mine.load();

    const signer = (await p.phone.phoneSignerFor('o1', ME))!;
    expect(signer.chainFor(MARY)).toEqual((await p.phone.readChains(MARY))['o1']);
    expect(signer.chainFor(JOE)).toBeNull();
    expect(await mine.signUnsigned(signer)).toMatchObject({ batches: 2, events: 2, noCertificate: 1 });
    expect((await store().batchKeys('o1', 'L1')).map((b) => b.actorId).sort()).toEqual([ME, MARY].sort());

    // A new install key forgets every chain, and who held one.
    await p.phone.forgetAllChains();
    expect(await p.phone.chainPeople()).toEqual([]);
  });
});

describe('join passes (docs/nearby-sync-plan.md 14.1, 1)', () => {
  const roles = [{ roleId: 'tr', privileges: ['translate' as const] }];
  /** The answer above, with a pass for each language named, by `signer`, for `inviter` and `inviterKey` (this person and key unless said). */
  function withPasses(o: { signer?: typeof worker; inviter?: string; inviterKey?: string; orgs?: string[] } = {}) {
    return async (req: (typeof fake.calls)[number]) => {
      const answer = await issued(o.orgs ? { orgs: o.orgs } : {})(req);
      const passes = await Promise.all(req.languages.map(async (where) => {
        const [orgId, languageId] = where.split('/') as [string, string];
        const body = (await joinPassBody({ orgId, languageId, inviter: o.inviter ?? ME, inviterKey: o.inviterKey ?? req.publicKey, roles, nowMs: Date.now() }, nobleSha256))!;
        return { orgId, languageId, pass: await (o.signer ?? worker).signPass(body) };
      }));
      return { kind: 'answer' as const, body: { ...answer.body, passes } };
    };
  }

  it('keeps each pass the Worker signed for this person and key, and Let someone in finds the open language\'s', async () => {
    const p = await load();
    fake.answer = withPasses();
    p.flag.heardUserState(ME, { orgFeatures: { o1: ['nearby', 'nearby_join'] } });
    await input(p);
    const pass = await p.phone.joinPassFor(ME, 'o1', 'L1');
    expect(pass?.body).toMatchObject({ orgId: 'o1', languageId: 'L1', inviter: ME, maxUses: 10 });
    expect(await p.phone.joinPassFor(ME, 'o1', 'L2')).toBeNull();
    expect(await p.phone.joinPassFor(ME, 'o2', 'L1')).toBeNull();
    expect(fake.noted).toEqual([]);
    // Replaced whole: an answer with none leaves none.
    fake.answer = issued();
    await input(p, { org: org(['L1', 'L2'], 'admin') });
    expect(await p.phone.readPasses(ME)).toEqual([]);
  });

  it('keeps no pass another key signed, or one for another person or key', async () => {
    for (const o of [{ signer: rogue }, { inviter: 'someone-else' }, { inviterKey: KEY_A }]) {
      fake.store = new MemoryStore();
      fake.noted.length = 0;
      const p = await load();
      fake.answer = withPasses(o);
      p.flag.heardUserState(ME, { orgFeatures: { o1: ['nearby', 'nearby_join'] } });
      await input(p);
      expect(Object.keys(await p.phone.readChains(ME))).toEqual(['o1']);
      expect(await p.phone.readPasses(ME)).toEqual([]);
      expect(fake.noted.some((n) => n.startsWith('nearby certificate'))).toBe(true);
    }
  });

  it('drops the passes of an organization turned off, and every pass when the key is replaced', async () => {
    const p = await load();
    fake.answer = withPasses({ orgs: ['o1', 'o2'] });
    p.flag.heardUserState(ME, { orgFeatures: { o1: ['nearby'], o2: ['nearby'] } });
    await input(p);
    await input(p, { orgId: 'o2', org: org(['L1']), languageId: 'L1' });
    expect((await p.phone.readPasses(ME)).map((x) => x.orgId).sort()).toEqual(['o1', 'o2']);
    p.flag.heardUserState(ME, { orgFeatures: { o2: ['nearby'] } });
    await input(p, { orgId: 'o2', org: org(['L1']), languageId: 'L1' });
    expect((await p.phone.readPasses(ME)).map((x) => x.orgId)).toEqual(['o2']);
    await p.phone.forgetAllChains();
    expect(await p.phone.readPasses(ME)).toEqual([]);
  });

  it('first contact\'s call goes whatever the flag says, never makes a key, and says whether the Worker answered', async () => {
    const p = await load();
    const first = { actorId: ME, orgId: 'o1', org: org(['L1']), languageId: 'L1' };
    // No key: nothing to prove, and none is made for it.
    await expect(p.identity.firstCertificate(first)).rejects.toThrow(/no install key/);
    expect(await p.key.installKey()).toBeNull();
    const key = (await p.key.ensureInstallKey())!;
    fake.answer = async () => ({ kind: 'later', status: 503 });
    expect(await p.identity.firstCertificate(first)).toBe(false);
    fake.answer = issued();
    // The server has not said which organizations are on: the call still goes.
    expect(await p.identity.firstCertificate(first)).toBe(true);
    expect(fake.calls.map((c) => c.languages)).toEqual([['o1/L1'], ['o1/L1']]);
    expect(fake.calls[1]!.publicKey).toBe(key.publicKey);
    expect(Object.keys(await p.phone.readChains(ME))).toEqual(['o1']);
  });
});
