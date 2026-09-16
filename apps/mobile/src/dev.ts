import type { Role } from '@langquest-next/core';
import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase';

/**
 * Dev-only personas. Each is a real local Supabase user so every event it
 * emits passes the server's actor check. "Seed demo team" (run by the owner)
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
 * Who may switch persona in a build that is not a dev build. Exploring the
 * translator's and reviewer's experience is how the product gets tested, and
 * a release build has no dev menu, so the people doing that testing are named
 * here (or in EXPO_PUBLIC_PERSONA_EMAILS, comma separated). Everyone else
 * sees no persona switcher at all; the switch is still a real sign-in with a
 * real password, so this grants nothing the password does not.
 */
export const PERSONA_TESTERS: string[] = (process.env.EXPO_PUBLIC_PERSONA_EMAILS ?? 'ryder@frontierrnd.com')
  .split(',')
  .map((e: string) => e.trim().toLowerCase())
  .filter(Boolean);

export function maySwitchPersona(email: string | null | undefined, isDev: boolean): boolean {
  return isDev || (!!email && PERSONA_TESTERS.includes(email.toLowerCase()));
}

export const DEV_PASSWORD = process.env.EXPO_PUBLIC_DEV_PASSWORD ?? 'password123';

/**
 * The persona's user id, creating the account only if it does not exist yet,
 * without touching the app session. Sign-in comes first: a hosted project
 * with email confirmation on answers signUp for an existing address with an
 * obfuscated user whose id is not the real one, and a membership written
 * against that id would point at nobody.
 */
export async function ensurePersonaAccount(p: Pick<Persona, 'id' | 'email'>): Promise<string> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
  const side = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const inn = await side.auth.signInWithPassword({ email: p.email, password: DEV_PASSWORD });
  if (inn.data.user) return inn.data.user.id;
  const up = await side.auth.signUp({ email: p.email, password: DEV_PASSWORD });
  if (up.error || !up.data.user) throw new Error(`persona ${p.id}: ${up.error?.message ?? inn.error?.message ?? 'no user'}`);
  return up.data.user.id;
}

/** Real sign-in as the persona on the app's own client. */
export async function switchToPersona(p: Pick<Persona, 'id' | 'email'>): Promise<void> {
  await ensurePersonaAccount(p);
  const { error } = await supabase.auth.signInWithPassword({ email: p.email, password: DEV_PASSWORD });
  if (error) throw error;
}

export function personaForEmail(email: string | null | undefined): Persona | undefined {
  return PERSONAS.find((p) => p.email === email);
}
