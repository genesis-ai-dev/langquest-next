import { parsePeople, showsLock, startState, withActor, withPerson } from '../src/appLock/appLockModel';

/**
 * The app lock (decisions.md 200): who has it on, and when it stands in
 * front of the app. The pattern check is lockFlow.test.ts; the store that
 * holds this on the phone is below, with the key-value store faked.
 */
describe('the app lock\'s rules', () => {
  it('a fresh start stands for whoever has it on, once the app knows who is signed in', () => {
    const s = startState(['akol']);
    expect(showsLock(s)).toBe(false);
    expect(showsLock(withActor(s, 'akol'))).toBe(true);
    expect(showsLock(withActor(s, 'mary'))).toBe(false);
    expect(showsLock(withActor(s, null))).toBe(false);
  });

  it('someone who just signed in, by any way, is not asked again', () => {
    const nobody = withActor(startState(['akol']), null);
    expect(showsLock(withActor(nobody, 'akol'))).toBe(false);
    // Signing out from the lock takes it down too.
    const locked = withActor(startState(['akol']), 'akol');
    expect(showsLock(withActor(withActor(locked, null), 'akol'))).toBe(false);
  });

  it('the same person again changes nothing', () => {
    const locked = withActor(startState(['akol']), 'akol');
    expect(withActor(locked, 'akol')).toBe(locked);
  });

  it('keeps each person once, and reads a torn write as nobody', () => {
    expect(withPerson(withPerson(['akol'], 'akol', true), 'mary', true)).toEqual(['akol', 'mary']);
    expect(withPerson(['akol', 'mary'], 'akol', false)).toEqual(['mary']);
    expect(parsePeople(JSON.stringify(['akol', 3, '', 'mary']))).toEqual(['akol', 'mary']);
    for (const raw of [null, '', '{', '{"a":1}', 'null']) expect(parsePeople(raw)).toEqual([]);
  });
});

const fake = vi.hoisted(() => ({
  kv: new Map<string, string>(),
  ways: ['pattern'] as string[],
  checked: [] as string[],
  dismissed: 0,
  signedOut: [] as string[]
}));
vi.mock('expo-sqlite/kv-store', () => ({
  default: {
    getItemSync: (k: string) => fake.kv.get(k) ?? null,
    setItemSync: (k: string, v: string) => { fake.kv.set(k, v); },
    removeItemSync: (k: string) => { fake.kv.delete(k); }
  }
}));
vi.mock('react-native', () => ({ Keyboard: { dismiss: () => { fake.dismissed++; } } }));
vi.mock('../src/diagnostics/report', () => ({ noteExpected: () => undefined }));
vi.mock('../src/server/lock', () => ({
  lockWays: async () => fake.ways,
  checkPattern: async (_actorId: string, dots: number[]) => { fake.checked.push(dots.join('-')); return dots.length >= 5 ? { kind: 'ok' } : { kind: 'wrong' }; },
  lockAndSignOut: async (actorId: string) => { fake.signedOut.push(actorId); },
  lockPictures: async () => ({ taken: [], mine: 3 }),
  setLockPattern: async () => ({ kind: 'ok' })
}));

async function load() {
  vi.resetModules();
  return import('../src/appLock/appLock');
}

beforeEach(() => {
  fake.kv.clear();
  fake.ways = ['pattern'];
  fake.checked.length = 0;
  fake.dismissed = 0;
  fake.signedOut.length = 0;
});

describe('the app lock on a phone', () => {
  it('is off for everyone until turned on, and on stays on through a restart', async () => {
    let lock = await load();
    lock.setActor('akol');
    expect(showsLock(lock.appLockState())).toBe(false);
    lock.setOn('akol', true);
    // Turned on now: it stands the next time the app is left or opened, not at once.
    expect(showsLock(lock.appLockState())).toBe(false);
    lock = await load();
    expect(showsLock(lock.appLockState())).toBe(false);
    lock.setActor('akol');
    expect(showsLock(lock.appLockState())).toBe(true);
  });

  it('stands each time the app is left, however short the time away', async () => {
    const lock = await load();
    lock.setActor('akol');
    lock.setOn('akol', true);
    lock.leftApp();
    expect(showsLock(lock.appLockState())).toBe(true);
    expect(fake.dismissed).toBe(1);
    expect(await lock.tryPattern([0, 1])).toEqual({ kind: 'wrong' });
    expect(showsLock(lock.appLockState())).toBe(true);
    expect(await lock.tryPattern([0, 1, 2, 4, 6])).toEqual({ kind: 'ok' });
    expect(showsLock(lock.appLockState())).toBe(false);
  });

  it('someone else signed in is not held by it, and leaving does not ask them', async () => {
    const lock = await load();
    lock.setActor('akol');
    lock.setOn('akol', true);
    lock.setActor('mary');
    lock.leftApp();
    expect(showsLock(lock.appLockState())).toBe(false);
  });

  it('turns itself off when the person no longer has a pattern here', async () => {
    fake.kv.set('app-lock-people', JSON.stringify(['akol']));
    fake.ways = ['password'];
    const lock = await load();
    lock.setActor('akol');
    await vi.waitFor(() => expect(lock.appLockState().people).toEqual([]));
    expect(fake.kv.has('app-lock-people')).toBe(false);
    expect(showsLock(lock.appLockState())).toBe(false);
  });

  it('Forgot? signs out as Sign Out does once the app gives it the way, else locks the sign-in and signs out', async () => {
    const lock = await load();
    lock.setActor('akol');
    await lock.signOutFromLock();
    expect(fake.signedOut).toEqual(['akol']);
    const handed: string[] = [];
    lock.setSignOutForLock(async () => { handed.push('hand-over'); });
    await lock.signOutFromLock();
    expect(handed).toEqual(['hand-over']);
    expect(fake.signedOut).toEqual(['akol']);
  });
});
