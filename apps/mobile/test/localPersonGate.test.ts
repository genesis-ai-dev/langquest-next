import { MemoryStore, SyncClient, type SupabaseTransport, type Transport } from '@langquest-next/sync';
import { FakeServer } from '../../../packages/sync/src/testing/fakeServer';

/**
 * No server call for a local person (docs/nearby-sync-plan.md 14.1, 5 "Requests"): the streams'
 * transport fails as offline while a local person holds the phone with no session saved, so
 * their work stays `pending` and nothing is marked refused; and the phone's Supabase client
 * sends nothing as no one then. Both open as soon as first contact saves a session.
 */

const fake = vi.hoisted(() => ({ holds: false, saved: null as string | null, secure: new Map<string, string>(), clients: [] as { key: string; fetch: typeof fetch }[] }));

vi.mock('../src/server/localPerson', () => ({ localPersonHolds: () => fake.holds }));
vi.mock('../src/server/auth', () => ({ savedSignIn: async () => fake.saved }));
// The transport underneath is the test's own; the real one would make a Supabase client.
vi.mock('../src/server/sync', () => ({ supabaseTransport: () => { throw new Error('not in this test'); } }));
vi.mock('react-native-url-polyfill/auto', () => ({}));
vi.mock('../src/server/secureStorage', () => ({
  secureStorage: { getItem: async (k: string) => fake.secure.get(k) ?? null, setItem: async () => undefined, removeItem: async () => undefined }
}));
vi.mock('../src/server/signOut', () => ({ signOutThisDevice: async () => undefined }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _key: string, opts: { auth: { storageKey: string }; global: { fetch: typeof fetch } }) => {
    fake.clients.push({ key: opts.auth.storageKey, fetch: opts.global.fetch });
    return { auth: { getSession: async () => ({ data: { session: null }, error: null }) } };
  }
}));

beforeEach(() => {
  fake.holds = false;
  fake.saved = null;
  fake.secure.clear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

/** The fake server's transport, counting every call that reaches it. */
function counted(server: FakeServer): { transport: Transport; calls: string[] } {
  const calls: string[] = [];
  const inner = server.transportFor();
  // The fake server has no live channel: a watch that opens nothing, so the test can see whether it was asked.
  const withWatch = Object.assign(Object.create(inner) as Transport, { watch: () => () => undefined });
  const transport = new Proxy(withWatch, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => { calls.push(String(key)); return (value as (...a: unknown[]) => unknown).apply(target, args); };
    }
  });
  return { transport, calls };
}

describe('the streams\' transport until first contact', () => {
  it('asks the server nothing for a local person, and their work stays pending, not refused', async () => {
    const { untilFirstContact } = await import('../src/sync/serverTransport');
    const server = new FakeServer();
    const { transport, calls } = counted(server);
    let n = 0;
    const client = new SyncClient({
      orgId: 'o1', streamId: 'L1', actorId: 'newcomer-1', deviceId: 'dev-n', store: new MemoryStore(),
      transport: untilFirstContact(transport as SupabaseTransport), now: () => 1_700_000_000_000, newId: () => `newcomer-1:e${++n}`
    });
    fake.holds = true;
    await client.load();
    await client.append('v1.UnitAdded', { unitId: 'u1', parentUnitId: null, kind: 'passage', label: 'u1', order: 'u1' });
    const result = await client.sync();
    expect(result).toMatchObject({ offline: true });
    expect(calls).toEqual([]);
    expect(await client.pendingCount()).toBe(1);
    expect(await client.refusedCount()).toBe(0);
    // The live channel waits too, and its unsubscribe works before it ever opened.
    const off = (untilFirstContact(transport as SupabaseTransport) as Required<Transport>).watch('o1', 'L1', { onChange: () => undefined } as never);
    await Promise.resolve();
    off();
    expect(calls).toEqual([]);

    // First contact saved a session: the same transport goes on at the next call.
    fake.saved = '{"access_token":"a"}';
    await client.sync();
    expect(calls).toContain('append');
  });

  it('is the plain transport for everyone else', async () => {
    const { untilFirstContact } = await import('../src/sync/serverTransport');
    const { transport, calls } = counted(new FakeServer());
    const gated = untilFirstContact(transport as SupabaseTransport);
    await gated.pull('o1', 'L1', 0, 10);
    const off = (gated as Required<Transport>).watch('o1', 'L1', { onChange: () => undefined } as never);
    off();
    expect(calls).toEqual(['pull', 'watch']);
  });
});

describe('the phone\'s Supabase client', () => {
  it('sends no request as no one while a local person holds the phone, and leaves a hand-over\'s client alone', async () => {
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', 'https://db.example');
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    vi.stubGlobal('__DEV__', true);
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => { sent.push(url); return new Response('[]'); });
    vi.resetModules();
    fake.clients.length = 0;
    const { clientKeptAt } = await import('../src/server/supabase');
    clientKeptAt('kept-key');
    const [main, kept] = fake.clients;
    const asNoOne = { headers: { Authorization: 'Bearer anon' } };
    fake.holds = true;
    await expect(main!.fetch('https://db.example/rest/v1/rpc/pull_events', asNoOne)).rejects.toThrow(/Network request failed/);
    await expect(main!.fetch('https://db.example/functions/v1/join', asNoOne)).rejects.toThrow(/Network request failed/);
    expect(sent).toEqual([]);
    // Supabase Auth's own calls still go, so the server's health can be asked.
    await main!.fetch('https://db.example/auth/v1/health', asNoOne);
    // Another person's kept session is its own storage's to answer for.
    await kept!.fetch('https://db.example/rest/v1/rpc/pull_events', asNoOne);
    fake.holds = false;
    await main!.fetch('https://db.example/rest/v1/rpc/pull_events', asNoOne);
    expect(sent).toEqual(['https://db.example/auth/v1/health', 'https://db.example/rest/v1/rpc/pull_events', 'https://db.example/rest/v1/rpc/pull_events']);
  });
});
