import { answerWithin, ANSWER_WITHIN_MS, NETWORK_CHANGED, stopRequestsInFlight } from '../src/server/sessionSafeFetch';

/** The operating system's network listeners, as expo-network holds them. */
const networkListeners = vi.hoisted(() => [] as ((s: { isConnected?: boolean; isInternetReachable?: boolean }) => void)[]);

vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
  Platform: { OS: 'android' }
}));
vi.mock('expo-network', () => ({
  addNetworkStateListener: (l: (typeof networkListeners)[number]) => {
    networkListeners.push(l);
    return { remove: () => { networkListeners.splice(networkListeners.indexOf(l), 1); } };
  }
}));

const { onWake } = await import('../src/sync/wake');

/** One network event, told to every listener in one go, as the operating system does. */
function network(s: { isConnected: boolean }): void {
  for (const l of [...networkListeners]) l(s);
}

/** A request on a connection that died with the network: it neither answers nor fails. */
const silent = (() => new Promise<Response>(() => {})) as typeof fetch;
const send = () => answerWithin(silent, ANSWER_WITHIN_MS)('https://abcdefgh.supabase.co/rest/v1/rpc/pull_events').then(() => 'answered', (e: unknown) => e);

beforeEach(() => { stopRequestsInFlight(); });

describe('a network change stops requests still out, then wakes sync (sync/wake.ts)', () => {
  it('the network goes: the request out fails as offline at once, and every listener wakes', async () => {
    // Why: a sync whose request waits on a dead connection holds its
    // language's turn; stopped, the sync woken next sends it again (LAN-339).
    const woke: string[] = [];
    const offA = onWake(() => woke.push('language'));
    const offB = onWake(() => woke.push('organization'));
    try {
      network({ isConnected: true });
      const outcome = send();
      network({ isConnected: false });
      expect(String(await outcome)).toContain(NETWORK_CHANGED);
      expect(woke).toEqual(['language', 'organization']);
    } finally {
      offA();
      offB();
    }
  });

  it('a request one listener sends as it wakes is not stopped by the next listener of the same change', async () => {
    let sent: Promise<unknown> | null = null;
    const offA = onWake(() => { sent = send(); });
    const offB = onWake(() => undefined);
    try {
      network({ isConnected: false });
      network({ isConnected: true });
      expect(sent).not.toBeNull();
      expect(await Promise.race([sent, new Promise((r) => setTimeout(() => r('still out'), 20))])).toBe('still out');
      expect(stopRequestsInFlight()).toBe(1);
    } finally {
      offA();
      offB();
    }
  });
});
