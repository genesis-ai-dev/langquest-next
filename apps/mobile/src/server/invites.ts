import type { Scope } from '@langquest-next/core';
import { supabase } from './supabase';

/**
 * An invite the server keeps by its token's hash; the label is shown to
 * whoever scans it, never put in the log. One that names checks of its
 * language puts whoever joins with it on them (decisions.md 141).
 */
export function issueInvite(i: {
  orgId: string; inviteId: string; tokenHash: string; roleId: string; scope: Scope; expiresAt: string; label: string | null; maxUses: number;
  checks?: readonly string[];
}) {
  const args = {
    p_org: i.orgId,
    p_invite_id: i.inviteId,
    p_token_hash: i.tokenHash,
    p_role_id: i.roleId,
    p_scope: i.scope,
    p_expires_at: i.expiresAt,
    p_label: i.label,
    p_max_uses: i.maxUses
  };
  return i.checks?.length ? supabase.rpc('issue_invite_v4', { ...args, p_checks: [...i.checks] }) : supabase.rpc('issue_invite_v3', args);
}

/** Join with an invite, as the person joining. Answers the organization joined. */
export function redeemInvite(token: string) {
  return supabase.rpc('redeem_invite_v2', { p_token: token });
}

export function previewInvite(token: string) {
  return supabase.rpc('preview_invite', { p_token: token });
}

export function issueSignInCode(profileId: string, codeHash: string, lost: boolean) {
  return supabase.rpc('issue_sign_in_code_v2', { p_profile: profileId, p_code_hash: codeHash, p_lost: lost });
}

export function canHelpSignIn(profileId: string) {
  return supabase.rpc('can_help_sign_in', { p_profile: profileId });
}

/** An Edge Function (`join`, `sign-in-code`, `send-invite`); a refusal comes back as `error` with the response as its context. */
export function invokeFunction(name: string, body: Record<string, unknown>) {
  return supabase.functions.invoke(name, { body });
}

export function createJoinRequest(orgId: string, requestId: string, message: string) {
  return supabase.rpc('create_join_request', { p_org: orgId, p_request_id: requestId, p_message: message });
}

/** Requests to join an organization, oldest first. Empty for anyone who may not invite there, by RLS. */
export function joinRequests(orgId: string) {
  return supabase
    .from('join_requests')
    .select('id,profile_id,message,created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });
}

/** How many people are asking to join: a count only, no rows. */
export function joinRequestCount(orgId: string) {
  return supabase.from('join_requests').select('id', { count: 'exact', head: true }).eq('org_id', orgId);
}

/** This person's own request to join, if it is still open. */
export function ownJoinRequest(orgId: string, profileId: string) {
  return supabase.from('join_requests').select('id').eq('org_id', orgId).eq('profile_id', profileId).limit(1);
}

export function decideJoinRequest(requestId: string, accepted: boolean, roleId: string | null, scope: Scope) {
  return supabase.rpc('decide_join_request_v2', { p_request_id: requestId, p_accepted: accepted, p_role_id: roleId, p_scope: scope });
}

/** Email an invite through the send-invite function; a refusal's status says which (supabase/functions/send-invite). */
export function sendInviteEmail(inviteId: string, token: string, email: string, locale: string) {
  return supabase.functions.invoke('send-invite', { body: { inviteId, token, email, locale } });
}
