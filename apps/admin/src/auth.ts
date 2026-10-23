/**
 * Who may read the page: a Global Viewer (decision 158) on a session
 * verified with their authenticator. Supabase Auth checks the token and that
 * its session still exists; then the database, asked as that person
 * (`get_user_state`), says whether their Global Viewer access is `on`: an
 * active grant and an `aal2` session. Adding or removing someone is
 * `npm run global-viewer -- grant | revoke`, never a secret. The page signs
 * in from the browser with the public key, so wrong passwords and codes meet
 * Supabase's own limits per address, not the Worker's.
 */
export type Access =
  | { ok: true; profileId: string }
  | { ok: false; status: 401 | 403 | 503; error: string; need?: 'code' | 'setup' };

/** `get_user_state().globalViewer` (migration 20261020210000_global_viewers.sql). */
export type ViewerState = 'on' | 'needs_code' | 'needs_setup' | 'revoked' | null;

/** Remembered per isolate for a minute, keyed by the token's digest, like the app's Worker (decisions.md 121). */
const CACHE_MS = 60_000;
/** A revoke takes effect within this long, like a session check in the app's Worker (decision 118). */
const STATE_MS = 30_000;
const MAX_CACHED = 200;
const known = new Map<string, { profileId: string; until: number }>();
const states = new Map<string, { state: ViewerState; until: number }>();

async function digest(token: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function bearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1]! : null;
}

/** The signed-in person's profile id, from Supabase Auth; null when the token or its session is no good. */
export async function profileOf(token: string, supabaseUrl: string, anonKey: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<string | null> {
  const key = await digest(token);
  const hit = known.get(key);
  if (hit && hit.until > now) return hit.profileId;
  const response = await fetcher(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`, {
    headers: { apikey: anonKey, authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000)
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error(`Supabase Auth answered ${response.status}`);
  const user = (await response.json()) as { id?: unknown };
  if (typeof user.id !== 'string' || !user.id) return null;
  if (known.size >= MAX_CACHED) known.delete(known.keys().next().value!);
  known.set(key, { profileId: user.id, until: now + CACHE_MS });
  return user.id;
}

/** The person's Global Viewer state, asked as them, so the database reads the token's own `aal`. */
export async function viewerState(token: string, supabaseUrl: string, anonKey: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<ViewerState> {
  const key = await digest(token);
  const hit = states.get(key);
  if (hit && hit.until > now) return hit.state;
  const response = await fetcher(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/get_user_state`, {
    method: 'POST',
    headers: { apikey: anonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`The database answered ${response.status}`);
  const body = (await response.json()) as { globalViewer?: unknown } | null;
  const value = body?.globalViewer;
  const state: ViewerState = value === 'on' || value === 'needs_code' || value === 'needs_setup' || value === 'revoked' ? value : null;
  if (states.size >= MAX_CACHED) states.delete(states.keys().next().value!);
  states.set(key, { state, until: now + STATE_MS });
  return state;
}

export async function access(
  request: Request,
  env: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string },
  fetcher: typeof fetch = fetch
): Promise<Access> {
  const token = bearer(request);
  if (!token) return { ok: false, status: 401, error: 'Sign in first.' };
  let profileId: string | null;
  try {
    profileId = await profileOf(token, env.SUPABASE_URL, env.SUPABASE_ANON_KEY, fetcher);
  } catch (e) {
    return { ok: false, status: 503, error: e instanceof Error ? e.message : 'Supabase Auth did not answer' };
  }
  if (!profileId) return { ok: false, status: 401, error: 'Your sign-in ended. Sign in again.' };
  let state: ViewerState;
  try {
    state = await viewerState(token, env.SUPABASE_URL, env.SUPABASE_ANON_KEY, fetcher);
  } catch (e) {
    return { ok: false, status: 503, error: e instanceof Error ? e.message : 'The database did not answer' };
  }
  if (state === 'on') return { ok: true, profileId };
  if (state === 'needs_code') return { ok: false, status: 403, need: 'code', error: 'Enter the code from your authenticator.' };
  if (state === 'needs_setup') return { ok: false, status: 403, need: 'setup', error: 'Set up your authenticator in the app first: Me, then Global Viewer.' };
  return { ok: false, status: 403, error: 'Only LangQuest Global Viewers can open this page (docs/global-viewers.md).' };
}

/** For tests. */
export const forgetSignIns = () => { known.clear(); states.clear(); };
