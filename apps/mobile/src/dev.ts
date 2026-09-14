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
  email: string;
}

const DOMAIN = 'example.test';

export const PERSONAS: Persona[] = [
  { id: 'owner', label: 'Org admin', role: 'owner', email: `lq-owner@${DOMAIN}` },
  { id: 'coordinator', label: 'Project admin', role: 'coordinator', email: `lq-coordinator@${DOMAIN}` },
  { id: 'translator', label: 'Translator', role: 'translator', email: `lq-translator@${DOMAIN}` },
  { id: 'reviewer', label: 'Reviewer', role: 'reviewer', email: `lq-reviewer@${DOMAIN}` },
  { id: 'viewer', label: 'Viewer', role: 'viewer', email: `lq-viewer@${DOMAIN}` },
  { id: 'noorg', label: 'No organization', role: null, email: `lq-noorg@${DOMAIN}` }
];

export const DEV_PASSWORD = process.env.EXPO_PUBLIC_DEV_PASSWORD ?? 'password123';

/** Create the account if needed and return its user id, without touching the app session. */
export async function ensurePersonaAccount(p: Persona): Promise<string> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
  const side = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const up = await side.auth.signUp({ email: p.email, password: DEV_PASSWORD });
  if (up.data.user) return up.data.user.id;
  const inn = await side.auth.signInWithPassword({ email: p.email, password: DEV_PASSWORD });
  if (inn.error || !inn.data.user) throw new Error(`persona ${p.id}: ${inn.error?.message ?? 'no user'}`);
  return inn.data.user.id;
}

/** Real sign-in as the persona on the app's own client. */
export async function switchToPersona(p: Persona): Promise<void> {
  await ensurePersonaAccount(p);
  const { error } = await supabase.auth.signInWithPassword({ email: p.email, password: DEV_PASSWORD });
  if (error) throw error;
}

export function personaForEmail(email: string | null | undefined): Persona | undefined {
  return PERSONAS.find((p) => p.email === email);
}
