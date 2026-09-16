import type { Scope } from '@langquest-next/core';
import { supabase } from './supabase';

/**
 * Invites and join requests (docs/flow-coverage-audit.md 5.B). These are the
 * only writes by people who are not members yet, so they are not events: they
 * are two small tables behind `issue_invite`, `redeem_invite` and
 * `accept_join_request`, which append the ordinary `v1.OrgMemberAdded` once a
 * member decides. Migration 20260914000012.
 */

export interface Invite {
  inviteId: string;
  /** Shown once, never readable again: only its hash is stored. */
  token: string;
  expiresAt: string;
}

export interface JoinRequest {
  id: string;
  profileId: string;
  message: string;
  createdAt: string;
}

/** What the QR carries: enough for another device to redeem without typing. */
export function inviteLink(orgId: string, token: string): string {
  return `langquest://join?org=${encodeURIComponent(orgId)}&token=${encodeURIComponent(token)}`;
}

/** The token out of a scanned link, or the raw token if that is what was pasted. */
export function tokenFromLink(input: string): string {
  const trimmed = input.trim();
  const match = /[?&]token=([^&\s]+)/.exec(trimmed);
  return match ? decodeURIComponent(match[1]!) : trimmed;
}

export async function issueInvite(
  orgId: string,
  roleId: string,
  scope: Scope = { level: 'org' },
  email?: string
): Promise<Invite> {
  const { data, error } = await supabase.rpc('issue_invite', {
    p_org: orgId,
    p_role_id: roleId,
    p_scope: scope,
    p_email: email ?? null
  });
  if (error) throw new Error(error.message);
  const row = (data as { invite_id: string; token: string; expires_at: string }[])[0];
  if (!row) throw new Error('no invite returned');
  return { inviteId: row.invite_id, token: row.token, expiresAt: row.expires_at };
}

/** Run as the person joining. Returns the org they just joined. */
export async function redeemInvite(token: string): Promise<{ orgId: string; roleId: string }> {
  const { data, error } = await supabase.rpc('redeem_invite', { p_token: tokenFromLink(token) });
  if (error) throw new Error(error.message);
  const row = (data as { org_id: string; role_id: string }[])[0];
  if (!row) throw new Error('invite not found');
  return { orgId: row.org_id, roleId: row.role_id };
}

/** Ask to join an org. One row per (org, requester); asking twice is not an error. */
export async function requestAccess(orgId: string, profileId: string, message: string): Promise<void> {
  const { error } = await supabase
    .from('join_requests')
    .upsert({ org_id: orgId, profile_id: profileId, message }, { onConflict: 'org_id,profile_id' });
  if (error) throw new Error(error.message);
}

/** Pending requests an admin may act on. Empty for everyone else, by RLS. */
export async function listJoinRequests(orgId: string): Promise<JoinRequest[]> {
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

export async function acceptJoinRequest(id: string, roleId: string, scope: Scope = { level: 'org' }): Promise<void> {
  const { error } = await supabase.rpc('accept_join_request', { p_id: id, p_role_id: roleId, p_scope: scope });
  if (error) throw new Error(error.message);
}

export async function declineJoinRequest(id: string): Promise<void> {
  const { error } = await supabase.from('join_requests').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** profileId -> email, so member lists show people instead of uuids. */
export async function memberEmails(orgId: string): Promise<Record<string, string>> {
  const { data, error } = await supabase.rpc('org_member_emails', { p_org: orgId });
  if (error) throw new Error(error.message);
  const out: Record<string, string> = {};
  for (const r of (data ?? []) as { profile_id: string; email: string | null }[]) {
    if (r.email) out[r.profile_id] = r.email;
  }
  return out;
}
