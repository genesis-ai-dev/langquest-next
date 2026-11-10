import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { SESSION_KEY, signOutHere, supabase, supabaseConfigError } from './supabase';
import { secureStorage } from './secureStorage';
import { signingOutByChoice } from '../session/signOutCause';
import { tokenSubject } from '../session/tokenModel';
import { readLocalPerson } from './localPerson';

/** Where the session is kept on this device (sessionKey.ts), and why this build cannot reach a server, if it cannot. */
export { SESSION_KEY, signOutHere, supabaseConfigError as serverConfigError };

/**
 * Someone let in offline holds this phone (docs/nearby-sync-plan.md 14.1, 5): from the grant on,
 * no other account may sign in here, or the local person's unsent work would wait under another
 * account's session and their copy would be read as someone else's. Only a session for their own
 * id goes on (first contact, or a helper's code made for them). Thrown before anything is asked.
 */
export class LocalPersonHere extends Error {
  constructor() {
    // i18n-ignore: the error's message, for diagnostics; screens say it in their own words (entry.signIn.localHere)
    super('Someone let in offline works on this phone.');
    this.name = 'LocalPersonHere';
  }
}

/** The local person granted on this phone, if any: a leftover `asking` record holds nothing. */
export async function localPersonHere(): Promise<{ profileId: string; name: string } | null> {
  const p = await readLocalPerson();
  return p && p.stage !== 'asking' ? { profileId: p.profileId, name: p.name } : null;
}

async function refuseUnlessLocal(subject: string | null): Promise<void> {
  const here = await localPersonHere();
  if (here && subject !== here.profileId) throw new LocalPersonHere();
}

export async function signInWithPassword(email: string, password: string) {
  await refuseUnlessLocal(null);
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUp(email: string, password: string) {
  await refuseUnlessLocal(null);
  return supabase.auth.signUp({ email, password });
}

/** Sign in with a session made elsewhere: a v2 account, a sign-in code, an invite, or first contact's for a local person. */
export async function setSession(session: { access_token: string; refresh_token: string }) {
  await refuseUnlessLocal(tokenSubject(session.access_token));
  return supabase.auth.setSession(session);
}

/**
 * The sign-in saved on this device, as stored, whether or not it can be
 * renewed right now (authState.ts, decision 87). It is read where
 * supabase-js keeps it: on a phone the Keychain or Keystore (decision 60,
 * amended 2026-10-15), never the AsyncStorage it moved out of.
 */
export function savedSignIn(): Promise<string | null> {
  return secureStorage.getItem(SESSION_KEY);
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

/**
 * Forgot password (supabase/functions/password-reset), signed out: ask for
 * a link to be emailed, or set a new password with a link's code, and with
 * `lost` revoke the person's nearby keys first (docs/nearby-sync-plan.md
 * section 6). A refusal comes back as `error` with the reply as its context.
 */
export function passwordReset(body: { email: string; locale: string } | { code: string; password: string; lost?: boolean }) {
  return supabase.functions.invoke('password-reset', { body });
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
