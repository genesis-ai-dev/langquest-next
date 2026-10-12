import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { accessTokenFresh, afterAuthEvent, savedSession } from '../src/authState';
import { answerAtOnceWhileOffline, NOT_RENEWED, sessionSafeFetch, type RenewalWatch } from '../src/sessionSafeFetch';
import { signOutThisDevice } from '../src/signOutCore';

// Decision 87: someone offline for months, online for a second, then
// offline again, keeps their sign-in and their work. These run the app's own
// supabase-js against a phone-like storage and a network the test controls.

const URL_ = 'https://abcdefgh.supabase.co';
const ANON = 'anon-key';
const KEY = 'sb-abcdefgh-auth-token';
const DAY = 86_400;

type Network = (url: string, init?: RequestInit) => Promise<Response>;
const offline: Network = async () => { throw new TypeError('Network request failed'); };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const page = (status: number) => new Response('<html>Sign in to the hotspot</html>', { status, headers: { 'content-type': 'text/html' } });

function sessionAt(expiresAt: number) {
  return {
    access_token: 'access', refresh_token: 'refresh', token_type: 'bearer', expires_in: 3600, expires_at: expiresAt,
    user: { id: 'akol', email: 'akol-deng-482@people.langquest.org', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-08-01T00:00:00Z' }
  };
}
const now = () => Math.floor(Date.now() / 1000);

/** A phone holding a sign-in that expires at `expiresAt`, on `network`, with or without the app's fetch. */
function phone(expiresAt: number | null, network: Network, opts: { safe?: boolean } = {}) {
  const stored = new Map<string, string>(expiresAt === null ? [] : [[KEY, JSON.stringify(sessionAt(expiresAt))]]);
  const storage = {
    getItem: async (k: string) => stored.get(k) ?? null,
    setItem: async (k: string, v: string) => { stored.set(k, v); },
    removeItem: async (k: string) => { stored.delete(k); }
  };
  const requests: string[] = [];
  const base = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push(url);
    return network(url, init);
  }) as typeof fetch;
  const watch: RenewalWatch = { failedAt: null };
  const fetchImpl = opts.safe === false ? base : sessionSafeFetch({ anonKey: ANON, watch, hasSavedSession: async () => stored.has(KEY), base });
  const client: SupabaseClient = createClient(URL_, ANON, {
    auth: { storage, storageKey: KEY, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchImpl }
  });
  // As supabase.ts builds every client.
  if (opts.safe !== false) answerAtOnceWhileOffline(client.auth, { watch, readSaved: () => storage.getItem(KEY) });
  const events: string[] = [];
  client.auth.onAuthStateChange((e) => { events.push(e); });
  return { client, storage, stored, requests, events };
}

/** supabase-js retries a failed renewal for about 25 seconds; the clock is the test's. */
async function settle<T>(p: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(30_000);
  return p;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('who is signed in on this phone (authState.ts)', () => {
  it('reads the saved sign-in, and anything torn or foreign as none', () => {
    expect(savedSession(JSON.stringify(sessionAt(1)))?.user.id).toBe('akol');
    for (const raw of [null, '', '{not json', 'null', '{}', JSON.stringify({ ...sessionAt(1), user: null }), JSON.stringify({ ...sessionAt(1), refresh_token: 3 })]) {
      expect(savedSession(raw)).toBeNull();
    }
  });

  it('only a sign-out ends the person; an empty start (could not renew) changes nothing', () => {
    const akol = { id: 'akol' };
    expect(afterAuthEvent(akol, 'INITIAL_SESSION', null)).toBe(akol);
    expect(afterAuthEvent(undefined, 'INITIAL_SESSION', null)).toBeUndefined();
    expect(afterAuthEvent(akol, 'SIGNED_OUT', null)).toBeNull();
    const renewed = { id: 'akol' };
    expect(afterAuthEvent(akol, 'TOKEN_REFRESHED', renewed)).toBe(renewed);
    expect(afterAuthEvent(null, 'SIGNED_IN', akol)).toBe(akol);
  });

  it('a token is fresh until a minute before it expires', () => {
    expect(accessTokenFresh({ expires_at: now() + 3600 })).toBe(true);
    expect(accessTokenFresh({ expires_at: now() + 30 })).toBe(false);
    expect(accessTokenFresh(null)).toBe(false);
  });
});

describe('starting the app offline months after the last connection', () => {
  it('supabase-js reports no one, but the sign-in is still saved, so the app opens on the person', async () => {
    const p = phone(now() - 60 * DAY, offline);
    const { data } = await settle(p.client.auth.getSession());
    expect(data.session).toBeNull();
    expect(savedSession(await p.storage.getItem(KEY))?.user.id).toBe('akol');
    expect(p.events).not.toContain('SIGNED_OUT');
  });

  it('an hour-old token offline is the same as a two-month-old one', async () => {
    const p = phone(now() - 3600, offline);
    await settle(p.client.auth.getSession());
    expect(p.stored.has(KEY)).toBe(true);
  });
});

describe('offline, calls answer at once instead of after half a minute', () => {
  it('once a renewal has failed for want of a network, the next calls do not wait for its retries', async () => {
    const p = phone(now() - 60 * DAY, offline);
    let first = false;
    const firstCall = p.client.auth.getSession().then(() => { first = true; });
    await vi.advanceTimersByTimeAsync(50);
    let second: unknown = 'waiting';
    void p.client.rpc('my_organizations').then((r) => { second = r.error?.message; });
    await vi.advanceTimersByTimeAsync(50);
    expect(second).toContain(NOT_RENEWED);
    expect(first).toBe(false); // supabase-js is still retrying the renewal
    await settle(firstCall);
  });

  it('a token still good is used as it is', async () => {
    const p = phone(now() + 3600, offline);
    const { data } = await p.client.auth.getSession();
    expect(data.session?.access_token).toBe('access');
  });
});

describe('a moment online: renewing the sign-in (sessionSafeFetch.ts)', () => {
  it('without the app fetch, a rate limit or a hotspot page deletes the sign-in (why it exists)', async () => {
    for (const answer of [() => json(429, { code: 'over_request_rate_limit', msg: 'Request rate limit reached' }), () => page(403), () => page(511)]) {
      const p = phone(now() - 60 * DAY, async () => answer(), { safe: false });
      await settle(p.client.auth.getSession());
      expect(p.stored.has(KEY)).toBe(false);
    }
  });

  it('with it, a rate limit, a timeout or a page from something in between keeps the sign-in for next time', async () => {
    for (const answer of [() => json(429, { code: 'over_request_rate_limit' }), () => json(408, { code: 'request_timeout' }), () => page(403), () => page(511), () => page(200), () => page(503)]) {
      const p = phone(now() - 60 * DAY, async () => answer());
      await settle(p.client.auth.getSession());
      expect(p.stored.has(KEY)).toBe(true);
      expect(p.events).not.toContain('SIGNED_OUT');
    }
  });

  it('Supabase Auth saying the sign-in is over still ends it', async () => {
    for (const code of ['refresh_token_not_found', 'refresh_token_already_used', 'session_expired', 'user_banned']) {
      const p = phone(now() - 60 * DAY, async () => json(400, { code, msg: 'Invalid Refresh Token' }));
      await settle(p.client.auth.getSession());
      expect(p.stored.has(KEY)).toBe(false);
      expect(p.events).toContain('SIGNED_OUT');
    }
  });

  it('a renewal that works renews', async () => {
    const renewed = { ...sessionAt(now() + 3600), access_token: 'new', refresh_token: 'new-refresh' };
    const p = phone(now() - 60 * DAY, async () => json(200, renewed));
    const { data } = await settle(p.client.auth.getSession());
    expect(data.session?.access_token).toBe('new');
    expect(savedSession(p.stored.get(KEY))?.refresh_token).toBe('new-refresh');
  });

  it('leaves every other answer from Supabase Auth alone, such as a wrong password', async () => {
    const p = phone(null, async () => json(400, { code: 'invalid_credentials', msg: 'Invalid login credentials' }));
    const { error } = await settle(p.client.auth.signInWithPassword({ email: 'a@b.org', password: 'x' }));
    expect(error?.status).toBe(400);
    expect(error?.message).toBe('Invalid login credentials');
  });
});

describe('nothing goes out as no one while a sign-in waits to renew', () => {
  it('a request that would carry only the public key fails as offline while a sign-in is saved', async () => {
    const p = phone(now() - 60 * DAY, async (url) => (url.includes('/token?') ? json(429, {}) : json(200, [])));
    const { error } = await settle(p.client.rpc('my_organizations'));
    expect(error?.message).toContain(NOT_RENEWED);
    // supabaseTransport.ts reads this as OfflineError, never as a refusal.
    expect(/network/i.test(error!.message)).toBe(true);
    expect(p.requests.some((u) => u.includes('/rest/v1/'))).toBe(false);
  });

  it('someone signed out still reads public listings', async () => {
    const p = phone(null, async () => json(200, []));
    const { error } = await settle(p.client.rpc('list_public_languages'));
    expect(error).toBeNull();
    expect(p.requests.some((u) => u.includes('/rest/v1/rpc/list_public_languages'))).toBe(true);
  });

  it('a signed-in request with a good token goes out as the person', async () => {
    const p = phone(now() + 3600, async () => json(200, []));
    const { error } = await settle(p.client.rpc('my_organizations'));
    expect(error).toBeNull();
  });
});

describe('signing out of this device only (signOutCore.ts)', () => {
  it('online, ends just this session on the server and forgets it here', async () => {
    const seen: string[] = [];
    const p = phone(now() + 3600, async (url) => { seen.push(url); return new Response(null, { status: 204 }); });
    await settle(signOutThisDevice(p.client, p.storage, KEY));
    expect(seen.filter((u) => u.includes('/logout'))).toEqual([`${URL_}/auth/v1/logout?scope=local`]);
    expect(p.stored.has(KEY)).toBe(false);
    expect(p.events).toContain('SIGNED_OUT');
  });

  it('offline with a good token, forgets it here and tells the app', async () => {
    const p = phone(now() + 3600, offline);
    await settle(signOutThisDevice(p.client, p.storage, KEY));
    expect(p.stored.has(KEY)).toBe(false);
    expect(p.events).toContain('SIGNED_OUT');
  });

  it('offline months later, asks the server nothing and signs out at once', async () => {
    const p = phone(now() - 60 * DAY, offline);
    await signOutThisDevice(p.client, p.storage, KEY);
    expect(p.requests).toEqual([]);
    expect(p.stored.has(KEY)).toBe(false);
    expect(p.events).toContain('SIGNED_OUT');
  });
});
