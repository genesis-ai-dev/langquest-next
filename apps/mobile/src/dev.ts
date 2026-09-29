import type { Role } from '@langquest-next/core';
import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase';

/**
 * Dev-only personas. Each is a real user on a local Supabase so every event
 * it emits passes the server's actor check. "Seed demo team" (run by the owner)
 * creates the accounts and appends their memberships and assignments to the
 * open project; switching persona is a real sign-in as that user.
 */
export interface Persona {
  id: string;
  label: string;
  /** Membership role seeded into the project; null = not a member. */
  role: Role | null;
  /** Org role id seeded into the org partition (core SEED_ROLES). */
  roleId: string | null;
  email: string;
}

const DOMAIN = 'example.test';

export const PERSONAS: Persona[] = [
  { id: 'owner', label: 'Org admin', role: 'owner', roleId: 'org_admin', email: `lq-owner@${DOMAIN}` },
  { id: 'coordinator', label: 'Project admin', role: 'coordinator', roleId: 'project_coordinator', email: `lq-coordinator@${DOMAIN}` },
  { id: 'translator', label: 'Translator', role: 'translator', roleId: 'translator', email: `lq-translator@${DOMAIN}` },
  { id: 'reviewer', label: 'Reviewer', role: 'reviewer', roleId: 'reviewer', email: `lq-reviewer@${DOMAIN}` },
  { id: 'viewer', label: 'Viewer', role: 'viewer', roleId: 'viewer', email: `lq-viewer@${DOMAIN}` },
  { id: 'noorg', label: 'No organization', role: null, roleId: null, email: `lq-noorg@${DOMAIN}` }
];

/**
 * The personas are shared test accounts, so they only ever exist on a local
 * Supabase (127.0.0.1 or localhost). Against a hosted server, persona
 * switching and "Seed demo team" are off in every build: their password is
 * inlined into the bundle (every EXPO_PUBLIC_* value is), so it must never
 * guard a real account, and seeding would write personas into a real org.
 */
export function isLocalServer(url: string | null | undefined = process.env.EXPO_PUBLIC_SUPABASE_URL): boolean {
  if (!url) return false;
  const host = /^[a-z]+:\/\/(\[[^\]]+\]|[^/:?#]+)/i.exec(url.trim())?.[1]?.toLowerCase();
  // 10.0.2.2 is the Android emulator's name for the host machine.
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '10.0.2.2';
}

/**
 * Testers named here (or in EXPO_PUBLIC_PERSONA_EMAILS, comma separated) may
 * open the persona sheet in a build that is not a dev build, to walk through
 * the translator's and reviewer's experience; only against a local server
 * (see isLocalServer). Dev builds may always open it.
 */
export const PERSONA_TESTERS: string[] = (process.env.EXPO_PUBLIC_PERSONA_EMAILS ?? 'ryder@frontierrnd.com')
  .split(',')
  .map((e: string) => e.trim().toLowerCase())
  .filter(Boolean);

export function maySwitchPersona(email: string | null | undefined, isDev: boolean, serverUrl?: string | null): boolean {
  if (isDev) return true;
  return isLocalServer(serverUrl ?? process.env.EXPO_PUBLIC_SUPABASE_URL) && !!email && PERSONA_TESTERS.includes(email.toLowerCase());
}

/**
 * The personas' shared password, from the developer's own env file. There is
 * no fallback: without one, persona switching is unavailable (the sheet says
 * so) rather than using a password anyone could read out of the bundle.
 */
export const DEV_PASSWORD: string | null = process.env.EXPO_PUBLIC_DEV_PASSWORD || null;

/** Persona sign-in works only against a local server and with a password set. */
export function personasAvailable(): { ok: true; password: string } | { ok: false; reason: string } {
  if (!isLocalServer()) return { ok: false, reason: 'Personas work only against a local server (127.0.0.1 or localhost).' };
  if (!DEV_PASSWORD) return { ok: false, reason: 'Persona switching is off: set EXPO_PUBLIC_DEV_PASSWORD in .env.development.local.' };
  return { ok: true, password: DEV_PASSWORD };
}

/** "Seed demo team" writes accounts and memberships: dev builds on a local server only. */
export function maySeedDemoTeam(isDev: boolean): boolean {
  return isDev && personasAvailable().ok;
}

class PersonasUnavailable extends Error {
  override name = 'PersonasUnavailable';
}

function personaPassword(): string {
  const a = personasAvailable();
  if (!a.ok) throw new PersonasUnavailable(a.reason);
  return a.password;
}

/**
 * The persona's user id, creating the account only if it does not exist yet,
 * without touching the app session. Sign-in comes first: a hosted project
 * with email confirmation on answers signUp for an existing address with an
 * obfuscated user whose id is not the real one, and a membership written
 * against that id would point at nobody.
 */
export async function ensurePersonaAccount(p: Pick<Persona, 'id' | 'email'>): Promise<string> {
  const password = personaPassword();
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
  const side = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const inn = await side.auth.signInWithPassword({ email: p.email, password });
  if (inn.data.user) return inn.data.user.id;
  const up = await side.auth.signUp({ email: p.email, password });
  if (up.error || !up.data.user) throw new Error(`persona ${p.id}: ${up.error?.message ?? inn.error?.message ?? 'no user'}`, { cause: up.error ?? inn.error });
  return up.data.user.id;
}

/** Real sign-in as the persona on the app's own client. */
export async function switchToPersona(p: Pick<Persona, 'id' | 'email'>): Promise<void> {
  await ensurePersonaAccount(p);
  const { error } = await supabase.auth.signInWithPassword({ email: p.email, password: personaPassword() });
  if (error) throw error;
}

export function personaForEmail(email: string | null | undefined): Persona | undefined {
  return PERSONAS.find((p) => p.email === email);
}
