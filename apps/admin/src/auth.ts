import { list } from './env';

/**
 * Who may read the page: a LangQuest account that is signed in (Supabase
 * Auth checks the token and that its session still exists) and whose
 * profile id is in ADMIN_PROFILE_IDS. The page signs in from the browser
 * with the public key, so wrong passwords meet Supabase's own limits per
 * address, not the Worker's.
 */
export type Access =
  | { ok: true; profileId: string }
  | { ok: false; status: 401 | 403 | 503; error: string; profileId?: string };

/** Remembered per isolate for a minute, keyed by the token's digest, like the app's Worker (decisions.md 121). */
const CACHE_MS = 60_000;
const MAX_CACHED = 200;
const known = new Map<string, { profileId: string; until: number }>();

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

export async function access(
  request: Request,
  env: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string; ADMIN_PROFILE_IDS?: string | undefined },
  fetcher: typeof fetch = fetch
): Promise<Access> {
  const admins = list(env.ADMIN_PROFILE_IDS);
  const token = bearer(request);
  if (!token) return { ok: false, status: 401, error: 'Sign in first.' };
  let profileId: string | null;
  try {
    profileId = await profileOf(token, env.SUPABASE_URL, env.SUPABASE_ANON_KEY, fetcher);
  } catch (e) {
    return { ok: false, status: 503, error: e instanceof Error ? e.message : 'Supabase Auth did not answer' };
  }
  if (!profileId) return { ok: false, status: 401, error: 'Your sign-in ended. Sign in again.' };
  // The id is told to the person it belongs to, so whoever sets the page up can put their own on the list.
  if (admins.length === 0) return { ok: false, status: 403, error: 'No one is on the admin list yet.', profileId };
  if (!admins.includes(profileId)) return { ok: false, status: 403, error: 'This account is not on the admin list.', profileId };
  return { ok: true, profileId };
}

/** For tests. */
export const forgetSignIns = () => known.clear();
