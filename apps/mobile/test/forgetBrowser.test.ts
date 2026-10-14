/**
 * Signing out of a shared browser leaves nothing behind, a held invite too
 * (decisions.md 11; AUTH-034, decided 2026-10-13): its token on a shared
 * computer would let the next person join as someone else.
 */
import { HELD_INVITE_KEY } from '../src/heldInviteStore';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('../src/store', () => ({ deleteLocalDatabases: vi.fn(async () => undefined) }));
vi.mock('../src/webFiles', () => ({ clearAllWebFiles: vi.fn(async () => undefined) }));
vi.mock('../src/report', () => ({ reportError: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined
  }
}));

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear() { map.clear(); },
    getItem(key: string) { return map.has(key) ? map.get(key)! : null; },
    key(index: number) { return [...map.keys()][index] ?? null; },
    removeItem(key: string) { map.delete(key); },
    setItem(key: string, value: string) { map.set(key, String(value)); }
  };
}

const reload = vi.fn();

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  vi.stubGlobal('window', { location: { reload } });
  reload.mockClear();
});

const { forgetThisBrowser } = await import('../src/forgetBrowser');
const { deleteLocalDatabases } = await import('../src/store');
const { clearAllWebFiles } = await import('../src/webFiles');

describe('forget this browser', () => {
  beforeEach(() => {
    vi.mocked(deleteLocalDatabases).mockClear();
    vi.mocked(clearAllWebFiles).mockClear();
  });

  it('drops the held invite with the session', async () => {
    const invite = JSON.stringify({ token: 'abc', heldAt: 1, claim: { kind: 'unclaimed' } });
    localStorage.setItem(HELD_INVITE_KEY, invite);
    localStorage.setItem('sb-ref-auth-token', 'session');
    localStorage.setItem('organizations:someone', '[]');
    sessionStorage.setItem('sb-ref-auth-token', 'session');

    await forgetThisBrowser();

    expect(localStorage.getItem(HELD_INVITE_KEY)).toBeNull();
    expect(localStorage.getItem('sb-ref-auth-token')).toBeNull();
    expect(localStorage.getItem('organizations:someone')).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(deleteLocalDatabases).toHaveBeenCalledOnce();
    expect(clearAllWebFiles).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('clears storage when no invite is held', async () => {
    localStorage.setItem('sb-ref-auth-token', 'session');
    sessionStorage.setItem('draft', '1');

    await forgetThisBrowser();

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(reload).toHaveBeenCalledOnce();
  });
});
