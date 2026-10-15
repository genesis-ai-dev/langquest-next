import type { Session } from '@supabase/supabase-js';

/**
 * Who is signed in on this phone (decision 87). supabase-js reports no one
 * whenever an expired access token cannot be renewed, and offline that is
 * every start more than an hour after the last connection, so taking its
 * word signed people out of their own work in the field. The phone's saved
 * sign-in decides instead: supabase-js deletes it only when the server has
 * said no (or the person signed out), and says so with SIGNED_OUT.
 *
 * Pure, so the tests can hold it without the app's storage.
 */

/** The sign-in saved under the session key, or null when there is none or it cannot be read. */
export function savedSession(raw: string | null | undefined): Session | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<Session> | null;
    if (!s || typeof s !== 'object') return null;
    if (typeof s.access_token !== 'string' || typeof s.refresh_token !== 'string' || typeof s.expires_at !== 'number') return null;
    if (!s.user || typeof s.user.id !== 'string') return null;
    return s as Session;
  } catch {
    return null;
  }
}

/**
 * The person after a supabase-js auth event. Any event with a session names
 * them; only SIGNED_OUT ends them. An empty INITIAL_SESSION means the token
 * could not be renewed just now, which changes nothing: the saved sign-in
 * (read separately) still stands.
 */
export function afterAuthEvent<S>(current: S | null | undefined, event: string, session: S | null): S | null | undefined {
  if (session) return session;
  if (event === 'SIGNED_OUT') return null;
  return current;
}

/** Whether a saved sign-in's access token is still good for a while, so the server can be asked to end it. */
export function accessTokenFresh(session: Pick<Session, 'expires_at'> | null, now: number = Date.now()): boolean {
  return !!session?.expires_at && session.expires_at * 1000 - now > 60_000;
}
