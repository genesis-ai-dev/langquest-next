import { supabase } from './supabase';

/** What a report, a removal or a dismissal is about. */
interface Target { orgId: string; languageId?: string | null; kind: string; id: string }

/** The people this account blocked. */
export function blockedPeople() {
  return supabase.from('user_blocks').select('blocked_id');
}

/** Open reports in an organization, for those who may act on them. */
export function orgContentReports(orgId: string) {
  return supabase.rpc('org_content_reports', { p_org: orgId });
}

/** Take something out of the record for everyone (`v1.Redacted`, appended by the server as the caller). */
export function removeContent(t: Target, reason: string) {
  return supabase.rpc('remove_content', { p_org: t.orgId, p_language: t.languageId ?? null, p_kind: t.kind, p_target: t.id, p_reason: reason });
}

/** Close every open report about it. */
export function dismissReports(t: Target) {
  return supabase.rpc('dismiss_reports', { p_org: t.orgId, p_language: t.languageId ?? null, p_kind: t.kind, p_target: t.id });
}
