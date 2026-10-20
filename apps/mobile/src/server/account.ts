import { DeliveryError, type AccountAction } from '@langquest-next/sync';
import { supabase } from './supabase';
import { sendingAs } from './handOver';

/** The organizations this account belongs to. */
export function myOrganizations() {
  return supabase.rpc('my_organizations');
}

/** Everyone's profile name this account may see, in one set-based read. */
export function myDirectory() {
  return supabase.rpc('my_directory') as unknown as Promise<{ data: { id: string; display_name: string }[] | null; error: unknown }>;
}

export function profileName(profileId: string) {
  return supabase.from('profiles').select('display_name').eq('id', profileId).maybeSingle();
}

export function profileNames(profileIds: string[]) {
  return supabase.from('profiles').select('id,display_name').in('id', profileIds);
}

/** Who looks after this account, if someone does. */
export function accountSteward(profileId: string) {
  return supabase.from('account_stewards').select('steward_id').eq('profile_id', profileId).maybeSingle();
}

/** What the server remembers of this account across devices (the welcome seen, AUTH-058). */
export function userState() {
  return supabase.rpc('get_user_state');
}

/** Delete this account on the server. Null when it went, or the server's reason and its code (a SQLSTATE). */
export async function deleteMyAccount(): Promise<{ message: string; code?: string } | null> {
  const { error } = await supabase.rpc('delete_my_account');
  return error ? { message: error.message, ...(error.code ? { code: error.code } : {}) } : null;
}

/** Languages listed on Explore (`public_languages`, written by the projection worker). */
export function publicLanguages() {
  return supabase.from('public_languages')
    .select('org_id,language_id,name,code,translated_pct,updated_at,license')
    .order('name').limit(100);
}

export function listedOrganizations() {
  return supabase.rpc('listed_organizations');
}

export function searchListedOrganizations(query: string) {
  return supabase.rpc('listed_organizations_search', { p_query: query, p_limit: 50 });
}

/**
 * Send one queued account change (durableOutbox.ts) as `actorId`: as the
 * person signed in, or under a session kept for someone who handed this
 * phone on (handOver.ts). A refusal the server will repeat is permanent.
 */
export async function deliverAccountAction(actorId: string, action: AccountAction,
  attached: { screenshot?: string | null; voice?: { base64: string; format: string } | null } = {}): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const client = data.session?.user.id === actorId ? supabase : sendingAs(actorId);
  if (!client) {
    // i18n-ignore: kept in the account outbox; shown through outboxErrorText (accountText.ts)
    throw new DeliveryError('Sign in again to send your saved changes.', true, 'no_session');
  }
  const p = action.payload;
  const { error } = action.kind === 'join_request'
    ? await client.rpc('create_join_request', {
      p_request_id: action.id, p_org: p.orgId, p_message: p.message
    })
    : action.kind === 'profile'
      ? await client.rpc('save_profile', { p_display_name: p.displayName })
      : action.kind === 'report'
        // Reports and blocks (decisions.md 48): rows on the server, never events.
        ? await client.rpc('report_content', {
          p_id: action.id, p_org: p.orgId, p_language: p.languageId ?? null, p_kind: p.kind,
          p_target: p.targetId, p_profile: p.profileId, p_reason: p.reason,
          p_details: p.details ?? null, p_unit: p.unitId ?? null
        })
        : action.kind === 'block'
          ? await client.rpc('set_blocked', { p_profile: p.profileId, p_blocked: p.blocked })
          : action.kind === 'feedback'
            // Feedback from help mode (decisions.md 141): the server reads the name and email itself, if shared.
            ? await client.rpc('feedback_submit', {
              p_id: action.id, p_kind: p.kind, p_body: p.body, p_install: p.installId, p_context: p.context ?? {},
              p_share_profile: p.shareProfile === true, p_screenshot: attached.screenshot ?? null,
              p_voice: attached.voice?.base64 ?? null, p_voice_format: attached.voice?.format ?? null,
              p_voice_ms: attached.voice ? (p.voice as { durationMs?: number } | null)?.durationMs ?? null : null
            })
            : await client.rpc('record_user_event', {
              p_id: action.id, p_type: p.type, p_payload: p.payload
            });
  if (error) {
    const permanent = ['22023', '42501', '23514'].includes(error.code);
    throw new DeliveryError(error.message, !permanent, error.code || undefined);
  }
}
