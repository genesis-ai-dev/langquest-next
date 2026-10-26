import type { HandOver, HandOverAttempt } from '@langquest-next/sync';

/**
 * Sending hand-overs from a shared phone (src/sync/handOver.ts, decisions.md
 * 60): which outcome of a person's delivery forgets them, keeps them, or
 * says the phone is offline. The courier itself is faked (it is tested in
 * packages/sync/test/handOver.test.ts); so are storage and the kept sessions.
 */
const fake = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  session: new Map<string, 'ok' | 'unreachable' | 'gone'>(),
  forgotten: [] as { actorId: string; endSession: boolean }[],
  /** People with a lock here (decisions.md 168), and what the courier did to it. */
  locked: new Set<string>(),
  lockCalls: [] as string[],
  kept: new Map<string, string>(),
  deliver: vi.fn(),
  note: vi.fn()
}));

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => fake.storage.get(k) ?? null,
    setItem: async (k: string, v: string) => { fake.storage.set(k, v); },
    removeItem: async (k: string) => { fake.storage.delete(k); }
  }
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'device-1' }));
vi.mock('../src/account/accountData', () => ({ accountOutbox: (actorId: string) => ({ actorId }) }));
vi.mock('../src/sync/blobs', () => ({ getBlobStore: async () => ({ exists: async () => true }) }));
vi.mock('../src/notifications/notifications', () => ({ handOverPushToken: async () => null }));
vi.mock('../src/diagnostics/report', () => ({ noteExpected: fake.note }));
vi.mock('../src/diagnostics/diagnostics', () => ({
  diagnostics: { record: () => undefined, audio: () => undefined, expected: () => undefined },
  flushDiagnostics: async () => undefined,
  timedTransfer: (_dir: unknown, _where: unknown, run: (t: object) => unknown) => run({})
}));
vi.mock('../src/sync/store', () => ({
  getStore: async () => ({ meta: async () => 'device-1', commit: async () => undefined })
}));
vi.mock('../src/server/handOver', () => ({
  actAs: (actorId: string) => ({ actorId }),
  keptSession: async (actorId: string) => fake.session.get(actorId) ?? 'ok',
  forgetKeptSession: async (actorId: string, endSession: boolean) => { fake.forgotten.push({ actorId, endSession }); },
  keepSessionAndSignOut: async () => true,
  keptSessionRaw: async (actorId: string) => fake.kept.get(actorId) ?? null
}));
vi.mock('../src/server/lock', () => ({
  keepLockedAfterHandOver: async (actorId: string, raw: string | null) => {
    fake.lockCalls.push(`keep ${actorId} ${raw}`);
    return fake.locked.has(actorId) && raw !== null;
  },
  dropLockedSession: async (actorId: string) => { fake.lockCalls.push(`drop ${actorId}`); }
}));
vi.mock('@langquest-next/sync', async (original) => ({
  ...(await original<typeof import('@langquest-next/sync')>()),
  deliverHandOver: fake.deliver
}));

const upload = (hash: string) => ({ orgId: 'org', languageId: 'luke', ref: { hash, format: 'm4a', unitId: 'u1' } });
const akol: HandOver = { actorId: 'akol', uploads: [upload('a'), upload('b')], savedAt: '2026-10-05T12:00:00Z' };
const mary: HandOver = { actorId: 'mary', uploads: [upload('c')], savedAt: '2026-10-05T13:00:00Z' };
const attempt = (over: Partial<HandOverAttempt> = {}): HandOverAttempt => ({
  sessionGone: false, eventsLeft: 0, accountLeft: 0, finished: [], unregistered: false, ...over
});
const delivered = (over: Partial<HandOverAttempt> = {}, offline = false) => ({ attempt: attempt(over), offline });

const stored = () => JSON.parse(fake.storage.get('hand-overs') ?? '[]') as HandOver[];

async function load(...list: HandOver[]) {
  fake.storage.set('hand-overs', JSON.stringify(list));
  vi.resetModules();
  return import('../src/sync/handOver');
}
async function seed(...list: HandOver[]) {
  return (await load(...list)).sendAll;
}

beforeEach(() => {
  fake.storage.clear();
  fake.session.clear();
  fake.forgotten.length = 0;
  fake.locked.clear();
  fake.lockCalls.length = 0;
  fake.kept.clear();
  fake.deliver.mockReset();
  fake.note.mockReset();
});

describe('sendAll', () => {
  it('with no hand-overs does nothing and is not offline', async () => {
    const sendAll = await seed();
    expect(await sendAll(null)).toEqual({ offline: false });
    expect(fake.deliver).not.toHaveBeenCalled();
  });

  it('a person back in as themselves is forgotten without sending: their own session sends it', async () => {
    const sendAll = await seed(akol, mary);
    fake.deliver.mockResolvedValue(delivered({ finished: ['c'] }));
    expect(await sendAll('akol')).toEqual({ offline: false });
    expect(fake.forgotten).toEqual([{ actorId: 'akol', endSession: true }, { actorId: 'mary', endSession: true }]);
    expect(fake.deliver).toHaveBeenCalledTimes(1);
    expect(stored()).toEqual([]);
  });

  it('a session that cannot be reached means offline, and the hand-over stays', async () => {
    const sendAll = await seed(akol);
    fake.session.set('akol', 'unreachable');
    expect(await sendAll(null)).toEqual({ offline: true });
    expect(fake.deliver).not.toHaveBeenCalled();
    expect(fake.forgotten).toEqual([]);
    expect(stored()).toEqual([akol]);
  });

  it('a session the server refused to renew is gone: the person is forgotten without ending anything, and it is not offline', async () => {
    const sendAll = await seed(akol);
    fake.session.set('akol', 'gone');
    expect(await sendAll(null)).toEqual({ offline: false });
    expect(fake.forgotten).toEqual([{ actorId: 'akol', endSession: false }]);
    expect(fake.deliver).not.toHaveBeenCalled();
    expect(stored()).toEqual([]);
    // No lock can bring an ended session back.
    expect(fake.lockCalls).toEqual(['drop akol']);
  });

  it('everything sent: the person is forgotten and their kept session ended', async () => {
    const sendAll = await seed(akol);
    fake.deliver.mockResolvedValue(delivered({ finished: ['a', 'b'] }));
    expect(await sendAll(null)).toEqual({ offline: false });
    expect(fake.forgotten).toEqual([{ actorId: 'akol', endSession: true }]);
    expect(stored()).toEqual([]);
  });

  it('everything sent by someone with a lock here: the session is sealed in its newest form and not ended, so they can come back offline', async () => {
    const sendAll = await seed(akol);
    fake.locked.add('akol');
    fake.kept.set('akol', 'renewed-session');
    fake.deliver.mockResolvedValue(delivered({ finished: ['a', 'b'] }));
    expect(await sendAll(null)).toEqual({ offline: false });
    expect(fake.lockCalls).toEqual(['keep akol renewed-session']);
    expect(fake.forgotten).toEqual([{ actorId: 'akol', endSession: false }]);
    expect(stored()).toEqual([]);
  });

  it('a session the server turned down mid-delivery is dropped without ending it', async () => {
    const sendAll = await seed(akol);
    fake.deliver.mockResolvedValue(delivered({ sessionGone: true, eventsLeft: 3 }));
    await sendAll(null);
    expect(fake.forgotten).toEqual([{ actorId: 'akol', endSession: false }]);
    expect(stored()).toEqual([]);
    expect(fake.lockCalls).toEqual(['drop akol']);
  });

  it('part sent: the recordings that went are crossed off and the rest wait, reporting offline when delivery was', async () => {
    const sendAll = await seed(akol);
    fake.deliver.mockResolvedValue(delivered({ finished: ['a'] }, true));
    expect(await sendAll(null)).toEqual({ offline: true });
    expect(fake.forgotten).toEqual([]);
    expect(stored()).toHaveLength(1);
    expect(stored()[0]!.uploads.map((u) => u.ref.hash)).toEqual(['b']);
  });

  it('a delivery that throws is noted and counts as offline, and the next person is still tried', async () => {
    const sendAll = await seed(akol, mary);
    fake.deliver.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(delivered({ finished: ['c'] }));
    expect(await sendAll(null)).toEqual({ offline: true });
    expect(fake.note).toHaveBeenCalledWith('hand-over', expect.objectContaining({ message: 'network' }));
    expect(stored().map((h) => h.actorId)).toEqual(['akol']);
    expect(fake.forgotten).toEqual([{ actorId: 'mary', endSession: true }]);
  });
});

describe('takeBackHandOver (decisions.md 168)', () => {
  it('gives back the kept session and the notifications still to disconnect, forgetting the hand-over without ending the session', async () => {
    const { takeBackHandOver } = await load({ ...akol, pushToken: 'push-1' }, mary);
    fake.kept.set('akol', 'kept-session');
    expect(await takeBackHandOver('akol')).toEqual({ session: 'kept-session', pushToken: 'push-1' });
    expect(fake.forgotten).toEqual([{ actorId: 'akol', endSession: false }]);
    expect(stored().map((h) => h.actorId)).toEqual(['mary']);
  });

  it('with no hand-over, or one whose session is gone, takes nothing and leaves it to the courier', async () => {
    const { takeBackHandOver } = await load(akol);
    expect(await takeBackHandOver('mary')).toBeNull();
    expect(await takeBackHandOver('akol')).toBeNull();
    expect(stored()).toEqual([akol]);
    expect(fake.forgotten).toEqual([]);
  });

  it('waits for a delivery under way, which stops before its next recording, so the two never hold the session at once', async () => {
    const { sendAll, takeBackHandOver } = await load(akol);
    fake.kept.set('akol', 'kept-session');
    let release!: () => void;
    const uploads: string[] = [];
    fake.deliver.mockImplementation(async (h: HandOver, deps: { upload: (u: unknown) => Promise<unknown> }) => {
      await new Promise<void>((r) => { release = r; });
      for (const u of h.uploads) {
        try { await deps.upload(u); uploads.push(u.ref.hash); } catch { return delivered({}, true); }
      }
      return delivered({ finished: uploads });
    });
    const sending = sendAll(null);
    await vi.waitFor(() => expect(fake.deliver).toHaveBeenCalled());
    const back = takeBackHandOver('akol');
    release();
    expect(await back).toEqual({ session: 'kept-session' });
    await sending;
    expect(uploads).toEqual([]);
    expect(fake.forgotten).toEqual([{ actorId: 'akol', endSession: false }]);
    expect(stored()).toEqual([]);
  });
});
