// A blue check for an organization (decisions.md 173): asking for one with a
// code by email, confirming it, and which organizations have one.
import { supabase } from './supabase';

/** Why a code was not sent: what the Edge Function or the database answered. */
export type SendRefusal =
  | 'not_allowed' | 'bad_domain' | 'public_domain' | 'bad_email' | 'email_not_at_domain'
  | 'already_verified' | 'waiting' | 'too_soon' | 'too_many' | 'no_email' | 'send_failed' | 'offline';

/** Email a 6-digit code to an address at the organization's domain (supabase/functions/verify-org-email). */
export async function sendVerificationCode(orgId: string, domain: string, email: string, locale: string): Promise<{ sent: true } | { sent: false; reason: SendRefusal }> {
  const { error } = await supabase.functions.invoke('verify-org-email', { body: { orgId, domain, email, locale } });
  if (!error) return { sent: true };
  const context = (error as { context?: Response }).context;
  if (!context || typeof context.json !== 'function') return { sent: false, reason: 'offline' };
  const reply = (await context.json().catch(() => null)) as { reason?: string } | null;
  return { sent: false, reason: (reply?.reason as SendRefusal | undefined) ?? 'send_failed' };
}

/** The code from the email: `waiting` (for LangQuest), `wrong`, `expired`, `too_many` or `no_code`. */
export function confirmVerification(orgId: string, code: string) {
  return supabase.rpc('org_verification_confirm', { p_org: orgId, p_code: code });
}

export function withdrawVerification(orgId: string) {
  return supabase.rpc('org_verification_withdraw', { p_org: orgId });
}

/** The organization's blue check and its latest request, for its admins. */
export function verificationState(orgId: string) {
  return supabase.rpc('org_verification_state', { p_org: orgId });
}

/** Which of these organizations have a blue check, and for which domain. */
export function orgBadges(orgIds: readonly string[]) {
  return supabase.rpc('org_badges', { p_orgs: [...orgIds] });
}
