// Global Viewers (decisions.md 158, docs/global-viewers.md): every
// organization, read-only, on a session verified with an authenticator code.
// The server decides; these only ask it.
import { Platform } from 'react-native';
import { supabase } from './supabase';

/**
 * The ops dashboard (decisions.md 160): on the web, beside the app on the
 * Worker that serves it, which lets in a Global Viewer on this same verified
 * session. None on a phone, where the browser would not share the session.
 */
export function opsDashboardUrl(): string | null {
  if (Platform.OS !== 'web') return null;
  return `${process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') ?? ''}/ops-dashboard`;
}

export interface ViewableOrganization { org_id: string; name: string; languages: string[] }

/** Every organization whose name, or a language's, holds `query`; refused unless Global Viewer access is on. */
export function globalViewerOrganizations(query: string, after?: { name: string; orgId: string }) {
  return supabase.rpc('global_viewer_organizations', {
    p_query: query, p_limit: 50,
    ...(after ? { p_after_name: after.name, p_after_org: after.orgId } : {})
  }) as unknown as Promise<{ data: ViewableOrganization[] | null; error: { message: string; code?: string } | null }>;
}

/** The names of an organization's members, for a Global Viewer whose access is on. */
export function globalViewerDirectory(orgId: string) {
  return supabase.rpc('global_viewer_directory', { p_org: orgId }) as unknown as
    Promise<{ data: { id: string; display_name: string | null }[] | null; error: unknown }>;
}

/** Has this sign-in entered an authenticator code (aal2), and could it? */
export async function assuranceLevel(): Promise<{ current: string | null; next: string | null }> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  return { current: data.currentLevel, next: data.nextLevel };
}

/**
 * Start setting up an authenticator: what to put in the authenticator app
 * (its `otpauth:` address, and the key for typing in), and the factor to
 * verify. A set-up left unfinished before is removed first, so starting
 * again never collides with it.
 */
export async function startAuthenticator(name: string): Promise<{ factorId: string; uri: string; secret: string }> {
  const listed = await supabase.auth.mfa.listFactors();
  if (listed.error) throw listed.error;
  for (const f of listed.data.all) {
    if (f.factor_type === 'totp' && f.status === 'unverified') {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
      if (error) throw error;
    }
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: name });
  if (error) throw error;
  return { factorId: data.id, uri: data.totp.uri, secret: data.totp.secret };
}

/** The authenticator this account already set up, if any. */
export async function verifiedAuthenticator(): Promise<string | null> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return data.totp[0]?.id ?? null;
}

/** Check a 6-digit code; on success this sign-in is aal2 from now on. */
export function verifyAuthenticator(factorId: string, code: string) {
  return supabase.auth.mfa.challengeAndVerify({ factorId, code });
}
