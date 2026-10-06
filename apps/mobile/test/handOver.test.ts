import { createClient } from '@supabase/supabase-js';
import type { BlobRef } from '@langquest-next/core';
import { afterAttempt, parseHandOvers, withHandOver, type Attempt, type HandOver } from '../src/handOverCore';
import { sessionStorageKey } from '../src/sessionKey';


const ref = (hash: string): BlobRef => ({ hash, format: 'm4a', unitId: 'u1' });
const upload = (hash: string) => ({ orgId: 'org', partitionId: 'luke', ref: ref(hash) });
const akol: HandOver = { actorId: 'akol', uploads: [upload('a'), upload('b')], savedAt: '2026-10-05T12:00:00Z' };
const attempt = (over: Partial<Attempt> = {}): Attempt => ({
  sessionGone: false, eventsLeft: 0, accountLeft: 0, finished: [], unregistered: false, ...over
});

describe('hand-over on a shared phone (decisions.md 60)', () => {
  it('ends only when every event, account change, recording and notification is dealt with', () => {
    expect(afterAttempt(akol, attempt({ finished: ['a', 'b'] }))).toEqual({ kind: 'done' });
    expect(afterAttempt(akol, attempt({ finished: ['a'] }))).toEqual({ kind: 'keep', handOver: { ...akol, uploads: [upload('b')] } });
    expect(afterAttempt(akol, attempt({ finished: ['a', 'b'], eventsLeft: 1 })).kind).toBe('keep');
    expect(afterAttempt(akol, attempt({ finished: ['a', 'b'], accountLeft: 1 })).kind).toBe('keep');
    const withPush = { ...akol, uploads: [], pushToken: 'tok' };
    expect(afterAttempt(withPush, attempt())).toEqual({ kind: 'keep', handOver: withPush });
    expect(afterAttempt(withPush, attempt({ unregistered: true }))).toEqual({ kind: 'done' });
  });

  it('a session the server will not renew is dropped; the work waits for their next sign-in', () => {
    expect(afterAttempt(akol, attempt({ sessionGone: true, eventsLeft: 3 }))).toEqual({ kind: 'drop' });
  });

  it('signing out twice before the phone is online keeps one record naming every recording', () => {
    const again: HandOver = { actorId: 'akol', uploads: [upload('b'), upload('c')], savedAt: '2026-10-06T08:00:00Z' };
    const list = withHandOver(withHandOver([], { ...akol, pushToken: 'tok' }), again);
    expect(list).toHaveLength(1);
    expect(list[0]!.uploads.map((u) => u.ref.hash)).toEqual(['b', 'c', 'a']);
    expect(list[0]!.pushToken).toBe('tok');
    expect(withHandOver(list, { ...akol, actorId: 'mary' }).map((h) => h.actorId)).toEqual(['akol', 'mary']);
  });

  it('a torn write reads as no hand-overs, never a crash on launch', () => {
    expect(parseHandOvers(null)).toEqual([]);
    expect(parseHandOvers('{not json')).toEqual([]);
    expect(parseHandOvers('[{"nope":1}]')).toEqual([]);
    expect(parseHandOvers(JSON.stringify([akol]))).toEqual([akol]);
  });
});

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
