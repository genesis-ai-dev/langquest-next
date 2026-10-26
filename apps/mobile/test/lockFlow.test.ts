import { randomBytes } from 'node:crypto';
import { patternSecret } from '../src/auth/lockModel';

/**
 * Signing out of a phone and back in with no connection (decisions.md 168):
 * src/server/lock.ts and src/auth/signBackIn.ts against a phone-like store,
 * with supabase-js, the courier and diagnostics faked. The cryptography is
 * lockModel.test.ts; the courier's side is handOverSend.test.ts.
 */
const fake = vi.hoisted(() => ({
  secure: new Map<string, string>(),
  plain: new Map<string, string>(),
  signOuts: [] as unknown[],
  handOvers: new Map<string, { session: string; pushToken?: string }>(),
  pushKept: [] as string[],
  diag: [] as unknown[][]
}));

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
const store = (m: Map<string, string>) => ({
  getItem: async (k: string) => m.get(k) ?? null,
  setItem: async (k: string, v: string) => { m.set(k, v); },
  removeItem: async (k: string) => { m.delete(k); }
});
vi.mock('@react-native-async-storage/async-storage', () => ({ default: store(fake.plain) }));
vi.mock('../src/server/secureStorage', () => ({ secureStorage: store(fake.secure) }));
vi.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)) }));
vi.mock('../src/server/supabase', () => ({
  SESSION_KEY: 'sb-session',
  supabase: {
    auth: {
      stopAutoRefresh: async () => undefined,
      startAutoRefresh: async () => undefined,
      // With nothing stored, supabase-js asks the server nothing and says SIGNED_OUT.
      signOut: async (opts: unknown) => { fake.signOuts.push(opts); return { error: null }; }
    }
  }
}));
vi.mock('../src/diagnostics/report', () => ({ noteExpected: () => undefined }));
vi.mock('../src/auth/authDiag', () => ({ recordAuth: (...a: unknown[]) => { fake.diag.push(a); }, since: () => 1 }));
vi.mock('../src/notifications/notifications', () => ({ keepPushToken: async (t: string) => { fake.pushKept.push(t); } }));
vi.mock('../src/sync/handOver', () => ({
  takeBackHandOver: async (actorId: string) => {
    const h = fake.handOvers.get(actorId) ?? null;
    fake.handOvers.delete(actorId);
    return h;
  }
}));

const session = (actorId: string, access = 'access-1') =>
  JSON.stringify({ access_token: access, refresh_token: `refresh-${access}`, expires_at: 1_700_000_000, user: { id: actorId } });
const Z = [0, 1, 2, 4, 6, 7, 8];
const L = [0, 3, 6, 7, 8];

async function load() {
  vi.resetModules();
  const lock = await import('../src/server/lock');
  const { signBackIn } = await import('../src/auth/signBackIn');
  const heard: string[] = [];
  lock.onUnlocked((s) => { heard.push(s.user.id); });
  return { ...lock, signBackIn, heard };
}

beforeEach(() => {
  fake.secure.clear();
  fake.plain.clear();
  fake.signOuts.length = 0;
  fake.handOvers.clear();
  fake.pushKept.length = 0;
  fake.diag.length = 0;
});

describe('signing out of a phone, locked', () => {
  it('someone with no password or pattern here is not signed out: Sign Out asks for a pattern first', async () => {
    const lock = await load();
    fake.secure.set('sb-session', session('akol'));
    expect(await lock.lockWays('akol')).toEqual([]);
    await expect(lock.lockAndSignOut('akol')).rejects.toThrow();
    expect(fake.secure.get('sb-session')).toBe(session('akol'));
  });

  it('seals the session without asking the server, and the pattern brings the same session back offline', async () => {
    const lock = await load();
    fake.secure.set('sb-session', session('akol'));
    expect(await lock.setLockPattern('akol', Z, 3)).toEqual({ kind: 'ok' });
    expect(await lock.lockWays('akol')).toEqual(['pattern']);
    await lock.lockAndSignOut('akol');
    expect(fake.secure.has('sb-session')).toBe(false);
    expect(fake.signOuts).toEqual([{ scope: 'local' }]);
    // Nothing kept in the clear: not the session, the key or the pattern.
    for (const v of [...fake.secure.values(), ...fake.plain.values()]) {
      expect(v).not.toContain('refresh-access-1');
      expect(v).not.toContain(Z.join('-'));
    }
    expect(await lock.lockWays('akol')).toEqual([]);
    expect(await lock.patternPeople()).toEqual([{ actorId: 'akol', picture: 3 }]);

    expect(await lock.signBackIn('pattern', patternSecret(L), { actorId: 'akol' })).toEqual({ kind: 'wrong' });
    expect(fake.secure.has('sb-session')).toBe(false);
    expect(await lock.signBackIn('pattern', patternSecret(Z), { actorId: 'akol' })).toEqual({ kind: 'ok' });
    expect(fake.secure.get('sb-session')).toBe(session('akol'));
    expect(lock.heard).toEqual(['akol']);
    // Signed in again: off the Sign In screen, and ready to lock again at the next sign-out.
    expect(await lock.patternPeople()).toEqual([]);
    expect(await lock.lockWays('akol')).toEqual(['pattern']);
  });

  it('their password opens it too, matched by what they type, never a stored name', async () => {
    const lock = await load();
    fake.secure.set('sb-session', session('akol'));
    await lock.rememberPassword('akol', 'Akol@Example.org', 'correct horse');
    await lock.lockAndSignOut('akol');
    expect([...fake.secure.values(), ...fake.plain.values()].join()).not.toMatch(/akol@example|correct horse/i);
    // A password-only lock shows no picture on Sign In.
    expect(await lock.patternPeople()).toEqual([]);
    expect(await lock.signBackIn('password', 'correct horse', { address: 'mary@example.org' })).toEqual({ kind: 'none' });
    expect(await lock.signBackIn('password', 'wrong', { address: 'akol@example.org' })).toEqual({ kind: 'wrong' });
    expect(await lock.signBackIn('password', 'correct horse', { address: ' akol@example.org' })).toEqual({ kind: 'ok' });
    expect(fake.secure.get('sb-session')).toBe(session('akol'));
  });

  it('two people never share a picture, and one person\'s wrong guesses never hold up the other', async () => {
    const lock = await load();
    fake.secure.set('sb-session', session('akol'));
    await lock.setLockPattern('akol', Z, 3);
    await lock.lockAndSignOut('akol');
    fake.secure.set('sb-session', session('mary'));
    expect(await lock.setLockPattern('mary', L, 3)).toEqual({ kind: 'pictureTaken' });
    expect((await lock.lockPictures('mary')).taken).toEqual([3]);
    // The same pattern is allowed: the picture says whose lock to open.
    expect(await lock.setLockPattern('mary', Z, 5)).toEqual({ kind: 'ok' });
    await lock.lockAndSignOut('mary');
    expect(await lock.patternPeople()).toEqual([{ actorId: 'akol', picture: 3 }, { actorId: 'mary', picture: 5 }]);

    const tries = [];
    for (let i = 0; i < 5; i++) tries.push((await lock.signBackIn('pattern', patternSecret(L), { actorId: 'akol' })).kind);
    expect(tries).toEqual(['wrong', 'wrong', 'wrong', 'wrong', 'wrong']);
    expect((await lock.signBackIn('pattern', patternSecret(Z), { actorId: 'akol' })).kind).toBe('wait');
    expect(await lock.signBackIn('pattern', patternSecret(Z), { actorId: 'mary' })).toEqual({ kind: 'ok' });
    expect(fake.secure.get('sb-session')).toBe(session('mary'));
  });

  it('the same password typed online later brings back the key, so the pattern still opens; a new password starts over', async () => {
    const lock = await load();
    fake.secure.set('sb-session', session('akol'));
    await lock.rememberPassword('akol', 'akol@example.org', 'pw-one');
    await lock.setLockPattern('akol', Z, 3);
    await lock.lockAndSignOut('akol');
    // Back in online by the server, with a new session.
    fake.secure.set('sb-session', session('akol', 'access-2'));
    await lock.signedInHere('akol');
    expect(await lock.patternPeople()).toEqual([]);
    await lock.rememberPassword('akol', 'akol@example.org', 'pw-one');
    expect((await lock.lockWays('akol')).sort()).toEqual(['password', 'pattern']);
    await lock.lockAndSignOut('akol');
    expect(await lock.signBackIn('pattern', patternSecret(Z), { actorId: 'akol' })).toEqual({ kind: 'ok' });
    expect(fake.secure.get('sb-session')).toBe(session('akol', 'access-2'));

    // A password changed elsewhere opens nothing old: only it counts now.
    await lock.lockAndSignOut('akol');
    fake.secure.set('sb-session', session('akol', 'access-3'));
    await lock.signedInHere('akol');
    await lock.rememberPassword('akol', 'akol@example.org', 'pw-two');
    expect(await lock.lockWays('akol')).toEqual(['password']);
    expect((await lock.lockPictures('akol')).mine).toBe(3);
  });
});

describe('work handed to the courier (decisions.md 60)', () => {
  it('coming back takes the kept session, its newest form, and the notifications it had not disconnected yet', async () => {
    const lock = await load();
    fake.secure.set('sb-session', session('akol'));
    await lock.setLockPattern('akol', Z, 3);
    // What keepSessionAndSignOut does: the session moves to the courier's key, sealed too, the key kept.
    await lock.sealHandedOver('akol', session('akol'));
    fake.secure.delete('sb-session');
    expect(await lock.patternPeople()).toEqual([{ actorId: 'akol', picture: 3 }]);
    fake.handOvers.set('akol', { session: session('akol', 'renewed'), pushToken: 'push-1' });
    expect(await lock.signBackIn('pattern', patternSecret(Z), { actorId: 'akol' })).toEqual({ kind: 'ok' });
    expect(fake.secure.get('sb-session')).toBe(session('akol', 'renewed'));
    expect(fake.pushKept).toEqual(['push-1']);
  });

  it('once everything went, the newest session stays sealed for them and the key goes', async () => {
    const lock = await load();
    fake.secure.set('sb-session', session('akol'));
    await lock.setLockPattern('akol', Z, 3);
    await lock.sealHandedOver('akol', session('akol'));
    fake.secure.delete('sb-session');
    expect(await lock.keepLockedAfterHandOver('akol', session('akol', 'renewed'))).toBe(true);
    expect([...fake.secure.keys()].some((k) => k.startsWith('lock-key:'))).toBe(false);
    expect(await lock.signBackIn('pattern', patternSecret(Z), { actorId: 'akol' })).toEqual({ kind: 'ok' });
    expect(fake.secure.get('sb-session')).toBe(session('akol', 'renewed'));
  });

  it('someone with no lock here: the courier ends the session as before', async () => {
    const lock = await load();
    expect(await lock.keepLockedAfterHandOver('akol', session('akol'))).toBe(false);
  });

  it('a session the server ended takes the lock\'s copy with it: Sign In stops offering it', async () => {
    const lock = await load();
    fake.secure.set('sb-session', session('akol'));
    await lock.setLockPattern('akol', Z, 3);
    await lock.sealHandedOver('akol', session('akol'));
    fake.secure.delete('sb-session');
    await lock.dropLockedSession('akol');
    expect(await lock.patternPeople()).toEqual([]);
    expect(await lock.signBackIn('pattern', patternSecret(Z), { actorId: 'akol' })).toEqual({ kind: 'none' });
  });
});

describe('deleting the account', () => {
  it('leaves nothing of the lock', async () => {
    const lock = await load();
    fake.secure.set('sb-session', session('akol'));
    await lock.rememberPassword('akol', 'akol@example.org', 'pw');
    await lock.setLockPattern('akol', Z, 3);
    await lock.forgetLock('akol');
    expect([...fake.secure.keys()].filter((k) => k !== 'sb-session')).toEqual([]);
  });
});
