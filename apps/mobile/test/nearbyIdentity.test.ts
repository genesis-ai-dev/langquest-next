import { randomBytes, randomUUID } from 'node:crypto';
import { certRequestText, nearbyBytes, revocationText, type ChainLink } from '@langquest-next/core/nearby';
import { MemoryStore } from '@langquest-next/sync';
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
vi.mock('../src/server/nearby', () => ({
  requestCertificate: async (req: (typeof fake.calls)[number]) => { fake.calls.push(req); return fake.answer!(req); }
}));
// The Android key, as Metro gives it to the Android files.
vi.mock('../src/server/nearbyKey', () => import('../src/server/nearbyKey.android'));
vi.mock('../src/nearby/holdChoice', () => import('../src/nearby/holdChoice.android'));
vi.mock('../src/diagnostics/report', () => ({ noteExpected: (where: string, e: unknown) => { fake.noted.push(`${where}: ${e instanceof Error ? e.message : String(e)}`); } }));

const ME = '11111111-1111-4111-8111-111111111111';
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
  return { identity, flag, phone, key, hold };
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
});
