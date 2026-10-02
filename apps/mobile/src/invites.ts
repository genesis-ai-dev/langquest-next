import type { Scope } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import type { InvitePreview } from './heldInvite';
import { parseInvite } from './inviteCode';
import { supabase } from './supabase';

/**
 * Invites and join requests (docs/flow-coverage-audit.md 5.B). A person who is
 * not a member yet cannot append to the log, so the two tables here hold the
 * pending state; the RPCs behind them append `v1.InviteIssued`,
 * `v1.InviteRedeemed` and `v1.JoinDecided` so the log still says how everyone
 * got in. Migration 20260915120000.
 *
 * Issuance stores only the token hash. Redemption and optional email
 * delivery transmit the raw token over HTTPS; application logs and
 * delivery receipts must never retain it.
 */

/** Re-exported so screens have one import for everything invite-shaped. */
export { inviteUri, parseInvite } from './inviteCode';

export interface NewInvite {
  inviteId: string;
  /** Shown once, never readable again: only its hash is stored. */
  token: string;
  expiresAt: string;
}

export interface PendingRequest {
  id: string;
  profileId: string;
  message: string;
  createdAt: string;
}

const DEFAULT_TTL_DAYS = 7;

async function sha256Hex(input: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input, {
    encoding: Crypto.CryptoEncoding.HEX
  });
}

/** 32 random bytes as hex: long enough that guessing is not a threat model. */
function newToken(): string {
  const bytes = Crypto.getRandomBytes(32);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Issue an invite. The id and the token are made here so the caller can show
 * the code immediately; the server only ever sees the hash.
 */
export async function issueInvite(
  orgId: string,
  roleId: string,
  scope: Scope = { level: 'org' },
  options: { label?: string; maxUses?: number; ttlDays?: number } = {}
): Promise<NewInvite> {
  const inviteId = Crypto.randomUUID();
  const token = newToken();
  const expiresAt = new Date(Date.now() + (options.ttlDays ?? DEFAULT_TTL_DAYS) * 86_400_000).toISOString();
  // The label (who it is for) is shown to whoever scans it, from the server,
  // and kept out of the log (docs/invites-and-accounts.md section 4).
  const { error } = await supabase.rpc('issue_invite_v3', {
    p_org: orgId,
    p_invite_id: inviteId,
    p_token_hash: await sha256Hex(token),
    p_role_id: roleId,
    p_scope: scope,
    p_expires_at: expiresAt,
    p_label: options.label?.trim() || null,
    p_max_uses: options.maxUses ?? 1
  });
  if (error) throw new Error(error.message);
  return { inviteId, token, expiresAt };
}

/**
 * Run as the person joining. Accepts a scanned link or a pasted code, and
 * returns the org they just joined. The membership is granted under the
 * service actor: a newcomer holds no privilege to grant themselves anything.
 */
export async function redeemInvite(input: string): Promise<{ orgId: string }> {
  const parsed = parseInvite(input);
  if (!parsed) throw new Error('That does not look like an invite code.');
  const { data, error } = await supabase.rpc('redeem_invite_v2', { p_token: parsed.token });
  if (error) throw new Error(error.message);
  const orgId = data as string | null;
  if (!orgId) throw new Error('invite not found');
  return { orgId };
}

/**
 * What the server says a key means, for the scan screen. Null when it could
 * not be asked (offline): the screen then claims nothing.
 */
export async function previewInvite(token: string): Promise<InvitePreview | null> {
  const { data, error } = await supabase.rpc('preview_invite', { p_token: token });
  if (error || !data) return null;
  return data as InvitePreview;
}

/**
 * A sign-in key for a looked-after member (flow F), made by their steward or
 * an organization admin. Only the hash leaves the phone; the code is shown
 * once, as a QR. Returns the person's sign-in name to read out with it.
 */
export async function issueSignInCode(profileId: string): Promise<{ code: string; signInName: string }> {
  const code = newToken();
  const { data, error } = await supabase.rpc('issue_sign_in_code', { p_profile: profileId, p_code_hash: await sha256Hex(code) });
  if (error) throw new Error(error.message);
  return { code, signInName: data as string };
}

/** May this session help that person sign in? False on any doubt. */
export async function canHelpSignIn(profileId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_help_sign_in', { p_profile: profileId });
  return !error && data === true;
}

/**
 * Use a sign-in key with a new password, signed out. Returns the sign-in
 * name; the caller signs in with it.
 */
export async function redeemSignInCode(code: string, password: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('sign-in-code', { body: { code, password } });
  if (error) {
    // The function's own words are in the response body.
    const context = (error as { context?: Response }).context;
    const body = context ? await context.json().catch(() => null) as { error?: string } | null : null;
    throw new Error(body?.error ?? error.message);
  }
  return (data as { signInName: string }).signInName;
}

/** Ask to join an org. One row per (org, requester); asking twice is not an error. */
export async function requestAccess(orgId: string, message: string): Promise<void> {
  const { error } = await supabase.rpc('create_join_request', {
    p_org: orgId,
    p_request_id: Crypto.randomUUID(),
    p_message: message
  });
  if (error) throw new Error(error.message);
}

/** Pending requests an admin may act on. Empty for everyone else, by RLS. */
export async function pendingRequests(orgId: string): Promise<PendingRequest[]> {
  const { data, error } = await supabase
    .from('join_requests')
    .select('id,profile_id,message,created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    profileId: r.profile_id as string,
    message: (r.message as string) ?? '',
    createdAt: r.created_at as string
  }));
}

/**
 * Admit or turn away one request. A role is required to accept, because a
 * membership without one would be a member who can do nothing.
 */
export async function decideRequest(id: string, accepted: boolean, roleId?: string): Promise<void> {
  if (accepted && !roleId) throw new Error('Pick a role before admitting someone.');
  const { error } = await supabase.rpc('decide_join_request', {
    p_request_id: id,
    p_accepted: accepted,
    p_role_id: accepted ? roleId : null
  });
  if (error) throw new Error(error.message);
}
