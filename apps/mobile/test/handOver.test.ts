import { createClient } from '@supabase/supabase-js';
import { sessionStorageKey } from '../src/sessionKey';

// The hand-over's own rules and its delivery attempt are tested with the
// rest of the sync package (packages/sync/test/handOver.test.ts).

describe('what the hand-over relies on in supabase-js', () => {
  it('the session key named in sessionKey.ts is the one supabase-js uses by default', () => {
    for (const url of ['https://abcdefgh.supabase.co', 'http://127.0.0.1:54321']) {
      const client = createClient(url, 'anon', { auth: { persistSession: false, autoRefreshToken: false } });
      expect(sessionStorageKey(url)).toBe((client.auth as unknown as { storageKey: string }).storageKey);
    }
  });

  it('once the session is moved to its own key, signing out asks the server nothing and still tells the app', async () => {
    const session = {
      access_token: 'a', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'akol', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-05T00:00:00Z' }
    };
    const stored = new Map<string, string>([['session', JSON.stringify(session)]]);
    const storage = {
      getItem: async (k: string) => stored.get(k) ?? null,
      setItem: async (k: string, v: string) => { stored.set(k, v); },
      removeItem: async (k: string) => { stored.delete(k); }
    };
    const requests: string[] = [];
    const client = createClient('https://abcdefgh.supabase.co', 'anon', {
      auth: { storage, storageKey: 'session', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async (url: RequestInfo | URL) => { requests.push(String(url)); return new Response('{}', { status: 200 }); } }
    });
    expect((await client.auth.getSession()).data.session?.user.id).toBe('akol');
    const events: string[] = [];
    client.auth.onAuthStateChange((e) => { events.push(e); });
    // What signOutHandingOver does: copy it to the courier's key, remove it, sign out.
    stored.set('hand-over-session:akol', stored.get('session')!);
    stored.delete('session');
    const { error } = await client.auth.signOut({ scope: 'local' });
    expect(error).toBeNull();
    expect(requests).toEqual([]);
    expect(events).toContain('SIGNED_OUT');
    expect((await client.auth.getSession()).data.session).toBeNull();
    // The courier's client finds it where it was put, still good.
    const courier = createClient('https://abcdefgh.supabase.co', 'anon', {
      auth: { storage, storageKey: 'hand-over-session:akol', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async (url: RequestInfo | URL) => { requests.push(String(url)); return new Response('{}', { status: 200 }); } }
    });
    expect((await courier.auth.getSession()).data.session?.refresh_token).toBe('r');
    expect(requests).toEqual([]);
  });
});
