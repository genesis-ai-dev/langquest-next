import type { SupabaseClient } from '@supabase/supabase-js';
import type { Verified } from './isolateCache';

/**
 * The one place the Worker asks who a bearer token is: its verified claims
 * (signing keys fetched once, or Auth while the project has a shared secret)
 * and whether its session is still live (decision 118). The app's API
 * (`index.ts`, wrapped in caches) and the ops dashboard's actions
 * (`opsActions.ts`, asked every time) both use these two.
 */

/** The token's verified claims, or null when it is not a good token. */
export function claimsVerifier(db: SupabaseClient): (token: string) => Promise<Verified> {
  return async (token) => {
    const { data, error } = await db.auth.getClaims(token);
    if (error || !data?.claims.sub) return null;
    const sessionId = data.claims['session_id'];
    const aal = data.claims['aal'];
    return {
      sub: data.claims.sub, exp: data.claims.exp,
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      aal: typeof aal === 'string' ? aal : undefined
    };
  };
}

/** Whether an Auth session has not been signed out since; throws when the database cannot say. */
export function sessionLiveCheck(db: SupabaseClient): (sessionId: string) => Promise<boolean> {
  return async (sessionId) => {
    const { data, error } = await db.rpc('session_is_live', { p_session: sessionId });
    if (error) throw new Error(`session_is_live: ${error.message}`);
    return data === true;
  };
}
