// i18n-ignore-file: developer tools, shown only in development builds.
import { createClient } from '@supabase/supabase-js';
import { DEV_PASSWORD, personaPassword, personasAvailable, type Persona } from '../dev';
import { supabase } from './supabase';

// Dev-build personas (dev.ts): accounts on a local server, made and signed
// in to beside the app's own session, or on it when switching.

/**
 * The persona's user id, creating the account only if it does not exist yet,
 * without touching the app session. Sign-in comes first: a hosted project
 * with email confirmation on answers signUp for an existing address with an
 * obfuscated user whose id is not the real one, and a membership written
 * against that id would point at nobody.
 */
/** The persona signed in on a client of its own, beside the app's session. */
async function personaSession(p: Pick<Persona, 'id' | 'email'>) {
  const password = personaPassword();
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
  const side = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const inn = await side.auth.signInWithPassword({ email: p.email, password });
  if (inn.data.user) return { side, userId: inn.data.user.id };
  const up = await side.auth.signUp({ email: p.email, password });
  if (up.error || !up.data.user) throw new Error(`persona ${p.id}: ${up.error?.message ?? inn.error?.message ?? 'no user'}`, { cause: up.error ?? inn.error });
  return { side, userId: up.data.user.id };
}

export async function ensurePersonaAccount(p: Pick<Persona, 'id' | 'email'>): Promise<string> {
  return (await personaSession(p)).userId;
}

/** The persona redeems an invite as itself, as someone scanning it would. Returns its profile id. */
export async function joinAsPersona(p: Pick<Persona, 'id' | 'email'>, token: string): Promise<string> {
  const { side, userId } = await personaSession(p);
  const { error } = await side.rpc('redeem_invite_v2', { p_token: token });
  if (error) throw new Error(`persona ${p.id} joining: ${error.message}`, { cause: error });
  return userId;
}

/** Real sign-in as the persona on the app's own client. */
export async function switchToPersona(p: Pick<Persona, 'id' | 'email'>): Promise<void> {
  await ensurePersonaAccount(p);
  const { error } = await supabase.auth.signInWithPassword({ email: p.email, password: personaPassword() });
  if (error) throw error;
}


/**
 * Dev on a local server: `npm run db:test` wipes auth users. The dev
 * account is made again when these are its email and password, instead of
 * stranding the developer at sign-in. Answers whether it was.
 */
export async function recreateDevAccount(email: string, password: string): Promise<boolean> {
  if (!personasAvailable().ok || email !== process.env.EXPO_PUBLIC_DEV_EMAIL || password !== DEV_PASSWORD) return false;
  await ensurePersonaAccount({ id: 'dev', email });
  return true;
}
