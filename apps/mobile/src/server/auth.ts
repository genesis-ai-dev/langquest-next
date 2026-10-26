import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { SESSION_KEY, signOutHere, supabase, supabaseConfigError } from './supabase';
import { signingOutByChoice } from '../session/signOutCause';

/** Where the session is kept on this device (sessionKey.ts), and why this build cannot reach a server, if it cannot. */
export { SESSION_KEY, signOutHere, supabaseConfigError as serverConfigError };

export function signInWithPassword(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export function signUp(email: string, password: string) {
  return supabase.auth.signUp({ email, password });
}

/** Sign in with a session made elsewhere: a v2 account, a sign-in code, an invite. */
export function setSession(session: { access_token: string; refresh_token: string }) {
  return supabase.auth.setSession(session);
}

/** The session this device holds now, or null. */
export async function currentSession(): Promise<Session | null> {
  return (await supabase.auth.getSession()).data.session;
}

export async function accessToken(): Promise<string | null> {
  return (await currentSession())?.access_token ?? null;
}

/** Be told when the sign-in changes. Returns the unsubscribe. */
export function onAuthChange(listener: (event: AuthChangeEvent, session: Session | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange(listener);
  return () => data.subscription.unsubscribe();
}

/** A looked-after account chooses its password (it had none until now). */
export function choosePassword(password: string) {
  return supabase.auth.updateUser({ password, data: { has_password: true } });
}

/** Forget the sign-in on this device without asking the server (the person's choice, signOutCause.ts). */
export function signOutLocally(): Promise<void> {
  return signingOutByChoice(async () => {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
  });
}

/** Hold the session still (no renewal) while it is moved, and let it renew again. */
export function pauseRenewal(): Promise<void> {
  return supabase.auth.stopAutoRefresh();
}
export function resumeRenewal(): Promise<void> {
  return supabase.auth.startAutoRefresh();
}
