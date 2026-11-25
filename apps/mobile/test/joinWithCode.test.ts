import { randomBytes, randomUUID } from 'node:crypto';
import { HlcClock } from '@langquest-next/core';
import { base64urlEncode } from '@langquest-next/core/nearby';
import { LanguageSession, MemoryStore } from '@langquest-next/sync';
import { MemoryNearbyMarks, nearbyClient, nearbyFiles, type NearbyFetchFile, type NearbyJoinGranted, type NearbyJoinOwn } from '@langquest-next/sync/nearby';
import type { JoinCode } from '../src/invites/inviteCode';
import { phoneCryptoOf } from '../src/nearby/nearbyCryptoModel';
import type { PhoneRadio } from '../src/nearby/nearbyLink.native';
import type { LocalPerson } from '../src/session/localPersonModel';

/**
 * Joining offline on the newcomer's phone, at the radio (src/nearby/nearbyJoin.android.ts
 * `joinWithCode`; docs/nearby-sync-plan.md 14.1, 3 and 4). Why these tests (review of
 * 2026-11-24, items 2, 8 and 14, and T5): the session is sync's, tested there, but only the app
 * gives it what a newcomer's join now needs: after the grant, the person's own keep and, by the
 * grant's word, how long the join counts as a meeting; after a whole copy, the language opened as
 * the app opens it, idle on the copy's store, for the steps that follow on the same link; and a
 * record of the join in field diagnostics. The session is faked; it calls what the app gave it.
 */

const seed = new Uint8Array(randomBytes(32));
const random = (n: number) => new Uint8Array(randomBytes(n));
const key = { publicKey: phoneCryptoOf(seed, random).publicKey, seed };

const fake = vi.hoisted(() => ({
  store: null as unknown,
  options: null as Record<string, unknown> | null,
  /** What the faked session hands `granted`, and what came back. */
  grant: null as string[] | null,
  installKey: '',
  answered: null as unknown,
  /** The faked session asks for the person's own pieces, as after a whole copy. */
  exchange: false,
  own: undefined as unknown,
  report: {} as Record<string, unknown>,
  /** What happened, in order: the language closed, and each record the person was kept as. */
  order: [] as string[],
  diag: [] as { orgId: string; languageId: string; record: unknown }[],
  platform: null as unknown,
  switchOn: true,
  kept: [] as unknown[],
  saved: new Map<string, string>()
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)), randomUUID: () => randomUUID() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async (k: string, v: string) => { fake.saved.set(k, v); }, removeItem: async () => undefined, multiSet: async () => undefined }
}));
vi.mock('../src/diagnostics/appBuild', () => ({ appBuild: () => 'test' }));
vi.mock('../src/diagnostics/report', () => ({ noteExpected: () => undefined }));
vi.mock('../src/library/docStore', () => ({ docText: async () => null, heldDoc: async () => null, heldDocHead: async () => null, keepFetchedDoc: async () => undefined }));
vi.mock('../src/server/auth', () => ({ savedSignIn: async () => null }));
vi.mock('../src/server/localPerson', () => ({
  keepLocalPerson: async (p: { stage: string }) => { fake.kept.push(p); fake.order.push(`kept ${p.stage}`); return true; }, readLocalPerson: async () => null
}));
vi.mock('../src/server/lock', () => ({ anyLocks: async () => false, keepFindKeys: async () => true }));
vi.mock('../src/server/nearbyKey', () => ({ installKey: async () => key, replaceInstallKey: async () => key }));
vi.mock('../src/storage/store', () => ({ getStore: async () => fake.store, holdsUnsent: async () => false }));
vi.mock('../src/sync/handOver', () => ({ anyHandOvers: async () => false }));
vi.mock('../src/sync/appLanguage', () => ({ appLanguagePlatform: async () => fake.platform }));
vi.mock('../src/nearby/nearbyIdentity.native', () => ({
  keepOpenOrgsFromJoin: async () => undefined, nearbyOpenOrgs: async () => new Set<string>(), nearbyOpenSwitch: async () => fake.switchOn
}));
vi.mock('../src/nearby/nearbyPhone.native', () => ({
  keepChains: async () => undefined, nearbyGateFor: async () => ({ people: () => [] }), nearbyMakerFor: async () => undefined, readChains: async () => ({}),
  readRevoked: async () => null, ROOT_KEYS: new Map()
}));
vi.mock('../src/nearby/nearbyRun.native', () => ({
  nearbyDiagFor: (orgId: string, languageId: string) => (record: unknown) => { fake.diag.push({ orgId, languageId, record }); },
  findKeyFor: async () => null,
  nearbyPiecesFor: async () => ({ ok: true, pieces: { gate: { people: () => [] }, signer: { chainFor: () => null } } })
}));
// The session is sync's: here it hands `granted` the grant the test gives, asks for the person's own pieces when told, and ends.
vi.mock('@langquest-next/sync/nearby', async (importOriginal) => {
  const real = await importOriginal<typeof import('@langquest-next/sync/nearby')>();
  class NearbySession {
    private readonly o: Record<string, unknown>;
    constructor(options: Record<string, unknown>) { this.o = options; fake.options = options; }
    async run() {
      const join = this.o['join'] as {
        idSalt: string; profileId: string; name: string; granted(g: unknown): Promise<unknown>; whole?(): Promise<void>; exchange?: { open(): Promise<unknown> };
      };
      if (fake.grant) {
        // The link names the person who asked, as a real grant's must.
        const body = {
          installKey: fake.installKey, idSalt: join.idSalt, profileId: join.profileId, deviceId: this.o['deviceId'], name: join.name, roleId: 'translator', privileges: ['translate'],
          pass: { body: { orgId: 'o1', languageId: 'l1', inviter: 'ana' } }
        };
        const chain = [{ kind: 'worker@1' }, { kind: 'invite@1', body }];
        fake.answered = await join.granted({ chain, verdict: { ok: true }, discovery: { key: 'k', gen: 1, floor: 0 }, orgId: 'o1', languageId: 'l1', features: fake.grant, revoked: null });
      }
      // As the session does: the copy whole is said first, then the person's own pieces are asked for.
      if (fake.grant && (fake.report['copy'] as { whole?: boolean } | null)?.whole) await join.whole?.();
      if (fake.exchange) fake.own = await join.exchange?.open();
      return fake.report;
    }
    stop() { /* nothing runs */ }
  }
  const sessionDiagOf = (_r: unknown, ms: number, mode: string) => ({ t: { event: 'session', mode }, n: { ms } });
  return { ...real, NearbySession, sessionDiagOf };
});

const CODE: JoinCode = { kind: 'join', network: 'wifi-direct', ssid: 'DIRECT-ab-Android_1a2b', passphrase: 'pass', port: 4100, secret: base64urlEncode(new Uint8Array(16).fill(1)), pin: base64urlEncode(new Uint8Array(16).fill(2)) };
const radio = { join: async () => ({ kind: 'wifi-direct', close: async () => undefined }) } as unknown as PhoneRadio;
const hooks = (still = () => true) => ({ pictures: () => undefined, granted: () => undefined, progress: () => undefined, still });

async function join(worn = false, still?: () => boolean) {
  const { joinWithCode } = await import('../src/nearby/nearbyJoin.android');
  return joinWithCode(radio, CODE, 'Nyibol', worn, hooks(still));
}

/** The phone as `appLanguagePlatform` gives it, on this test's store: files kept in memory, the nearby half, file moves. */
function platformOn(store: MemoryStore) {
  const sizes = new Map<string, number>();
  const files = {
    snapshot: () => new Set(sizes.keys()), sizes: () => sizes, sizeOf: (h: string) => sizes.get(h), formatOf: () => undefined, reclaim: () => [],
    onChange: () => () => undefined, onUrlReady: () => () => undefined, totalBytes: () => 0
  };
  const fetchFile: NearbyFetchFile = {
    stagingUri: (f) => `${f.hash}.${f.format}.nearby.part`, commit: async () => undefined, discard: async () => undefined, uriOf: () => null, freeBytes: () => null, remove: () => []
  };
  let t = 0;
  return {
    store, files, budget: undefined, limits: { minFreeBytes: 0, maxTotalBytes: 1e12 }, isDeferred: () => false, build: 'test',
    client: { newId: () => randomUUID(), clock: new HlcClock('d', () => ++t) }, newId: () => randomUUID(),
    nearby: async () => nearbyClient(),
    nearbyFiles: async () => ({ fetchFile, nearbyFiles: nearbyFiles({ marks: new MemoryNearbyMarks(), installKey: () => key.publicKey, canReview: () => false }) })
  };
}

const REPORT = { ended: { how: 'done' }, names: [] as { profileId: string; name: string }[], join: { granted: true, refused: null, exchange: true }, copy: { whole: true, filled: 1, docs: { kept: 0, missing: 0, refused: 0, capped: false } } };

beforeEach(() => {
  fake.installKey = key.publicKey;
  fake.store = new MemoryStore();
  fake.report = REPORT;
  fake.order = [];
  fake.options = null;
  fake.grant = null;
  fake.answered = null;
  fake.exchange = false;
  fake.own = undefined;
  fake.diag = [];
  fake.platform = null;
  fake.switchOn = true;
  fake.kept = [];
});
afterEach(() => { vi.restoreAllMocks(); });

describe('a newcomer\'s join, as the app builds it', () => {
  it('asks with the steps after the copy, library files too, and starts on a port and keep that hold nothing', async () => {
    await join();
    const options = fake.options!;
    expect(options['join']).toMatchObject({ as: 'newcomer', exchange: { library: true } });
    expect(options['orgId']).toBe('');
  });

  // Item 12: work by someone let in offline that came in the steps after the copy shows under their name.
  it('keeps the names the session\'s checked chains gave as the person\'s chain names, and none before a grant', async () => {
    fake.saved = new Map();
    fake.grant = ['nearby'];
    fake.report = { ...REPORT, names: [{ profileId: 'nc-2', name: 'Deng' }] };
    await join();
    const kept = [...fake.saved].find(([k]) => k.startsWith('chain-names:'));
    expect(kept && JSON.parse(kept[1])).toEqual({ 'nc-2': 'Deng' });
    fake.saved = new Map();
    fake.grant = null;
    await join();
    expect([...fake.saved.keys()].some((k) => k.startsWith('chain-names:'))).toBe(false);
  });

  // Item 8: the join is a meeting on the newcomer's phone too, where it may share while LangQuest is open: by the grant's word.
  it('the grant answers the copy\'s target and the person\'s own keep, and a meeting\'s length only where the grant says the organization shares while open', async () => {
    fake.grant = ['nearby', 'nearby_join', 'nearby_open'];
    await join();
    const answered = fake.answered as NearbyJoinGranted;
    expect(answered.target).toMatchObject({ languageId: 'l1', language: { keptOnDisk: true } });
    // A copy a teammate at another checkpoint would finish is dropped for that teammate's whole one (review item 4).
    expect(typeof answered.target?.language.dropCopy).toBe('function');
    expect(answered.keep).toBeDefined();
    expect(answered.notesMetForMs).toBe(14 * 86_400_000);
    for (const [features, switchOn, worn] of [[['nearby'], true, false], [['nearby', 'nearby_open'], false, false], [['nearby', 'nearby_open'], true, true]] as const) {
      fake.store = new MemoryStore();
      fake.switchOn = switchOn;
      fake.grant = [...features];
      await join(worn);
      expect((fake.answered as NearbyJoinGranted).notesMetForMs, JSON.stringify({ features, switchOn, worn })).toBeUndefined();
    }
  });

  // Item 2: after a whole copy the steps on the same link run on the language as the app opens it, on the copy's store.
  it('after a whole copy, opens the language idle on the copy\'s store, with no file worker, and closes it before the person is set', async () => {
    fake.platform = platformOn(fake.store as MemoryStore);
    fake.grant = ['nearby'];
    fake.exchange = true;
    const close = LanguageSession.prototype.close;
    const closed = vi.spyOn(LanguageSession.prototype, 'close').mockImplementation(function (this: LanguageSession) { fake.order.push('closed'); close.call(this); });
    const started = vi.spyOn(LanguageSession.prototype, 'start');
    const out = await join();
    const own = fake.own as NearbyJoinOwn;
    expect(own).toBeTruthy();
    expect(own.files).not.toHaveProperty('take');
    expect(typeof own.files.wanted).toBe('function');
    expect(own.keep).toBeDefined();
    expect(own.library).toBeDefined();
    expect(own.port).toHaveProperty('getState');
    // Idle: nothing syncs or transfers, and it is closed once the session ends, before the person is set.
    expect(started).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(out.ready).toBe(true);
    // The record is marked the moment the copy is whole, before the steps after it, and still \`filling\`.
    expect(fake.order).toEqual(['kept asking', 'kept filling', 'kept filling', 'closed', 'kept ready']);
  });

  // Item 2: setting the person waits on the steps after the copy. A phone that dies during them still holds a whole copy, and the
  // mark lets the join screen set the person at the next start (joinOfflineModel \`wholeAtStart\`), with no teammate.
  it('marks the record as soon as the copy is whole, still filling, and the person set drops the mark', async () => {
    fake.platform = platformOn(fake.store as MemoryStore);
    fake.grant = ['nearby'];
    fake.exchange = true;
    await join();
    const [, filling, marked, ready] = fake.kept as LocalPerson[];
    expect(filling).not.toHaveProperty('copyWhole');
    expect(marked).toEqual({ ...filling, copyWhole: true });
    expect(ready).toEqual({ ...filling, stage: 'ready' });
    // A copy that is not whole marks nothing.
    fake.kept = [];
    fake.report = { ...REPORT, ended: { how: 'dropped' }, join: { granted: true, refused: null, exchange: false }, copy: { ...REPORT.copy, whole: false } };
    await join();
    expect((fake.kept as LocalPerson[]).map((p) => [p.stage, p.copyWhole ?? false])).toEqual([['asking', false], ['filling', false]]);
  });

  // Item 14: the newcomer says why the steps after the copy did not run, and a person who left is not pieces that would not open.
  it('answers that the person left, not that no pieces opened, when they left before the steps after the copy', async () => {
    fake.platform = platformOn(fake.store as MemoryStore);
    fake.grant = ['nearby'];
    fake.exchange = true;
    const opened = vi.spyOn(LanguageSession, 'open');
    // On the screen until the grant is kept; gone by the time the copy is whole.
    const out = await join(false, () => fake.answered === null);
    expect(fake.own).toBe('left');
    expect(opened).not.toHaveBeenCalled();
    // The copy is whole all the same, so the person is set.
    expect(out.ready).toBe(true);
  });

  it('a phone with no nearby half answers no pieces, and the join ends with the copy', async () => {
    fake.platform = { ...platformOn(fake.store as MemoryStore), nearby: async () => undefined };
    fake.grant = ['nearby'];
    fake.exchange = true;
    await join();
    expect(fake.own).toBeNull();
  });

  it('asks for no pieces before the grant', async () => {
    fake.exchange = true;
    await join();
    expect(fake.own).toBeNull();
  });

  // Item 14: the newcomer's join in field diagnostics, queued with the rest until the person is set and online.
  it('records the join in field diagnostics under the organization and language granted, and under none before a grant', async () => {
    fake.grant = ['nearby'];
    await join();
    expect(fake.diag).toEqual([{ orgId: 'o1', languageId: 'l1', record: { t: { event: 'session', mode: 'join' }, n: { ms: expect.any(Number) } } }]);
    fake.diag = [];
    fake.grant = null;
    fake.report = { ...REPORT, join: { granted: false, refused: 'not let in', exchange: false }, copy: null };
    await join();
    expect(fake.diag).toEqual([{ orgId: '', languageId: '', record: expect.objectContaining({ t: { event: 'session', mode: 'join' } }) }]);
  });
});
