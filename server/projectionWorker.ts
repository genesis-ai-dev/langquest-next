import type { SupabaseClient } from '@supabase/supabase-js';
import { buildIndexes, foldOrg, languageInfo, languagePeople, languageProgress, orgLicense, privilegesFor, unitTitle,
  updatesFor, type AnyEvent, type OrgState, type Update } from '@langquest-next/core';
import { runSnapshotWorker } from '../packages/client/src/snapshotWorker';
import { SupabaseTransport } from '../packages/client/src/supabaseTransport';

function check(result: { error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
}

/** What an Inbox row says. The app shows the passage; the push shows neither (deliverPushes). */
const UPDATE_TITLES: Record<Update['kind'], string> = {
  request: 'You were asked to help',
  review: 'Your recording was reviewed',
  revision: 'Your feedback was answered with a new recording',
  kept: 'Your feedback was answered',
  request_done: 'What you asked for is done'
};

export async function runProjections(service: SupabaseClient) {
  const transport = new SupabaseTransport(service);
  const orgs = new Map<string, OrgState>();
  async function orgState(orgId: string) {
    const cached = orgs.get(orgId);
    if (cached) return cached;
    const events: AnyEvent[] = [];
    let cursor = 0;
    for (;;) {
      const page = await transport.pull(orgId, '_org', cursor, 1000);
      events.push(...page);
      if (page.length < 1000) break;
      cursor = page[page.length - 1]!.serverSeq!;
    }
    const org = foldOrg(events);
    orgs.set(orgId, org);
    return org;
  }
  const streams = await service.rpc('list_streams');
  check(streams);
  for (const row of streams.data ?? []) {
    if (row.stream_id === '_org' && row.org_id !== '_person') await orgState(row.org_id);
  }
  // One pass per language stream: everyone who may open the language gets
  // the updates that concern them (core updatesFor, the phone's Inbox).
  await runSnapshotWorker(service, 1000, async (snapshot) => {
    const org = await orgState(snapshot.orgId);
    const languageId = snapshot.streamId;
    const state = snapshot.state;
    const idx = buildIndexes(state);
    const notifications = [...languagePeople(org, languageId).keys()].flatMap((profileId) =>
      updatesFor(state, profileId, idx).map((update) => ({
        id: JSON.stringify([snapshot.orgId, languageId, profileId, update.id]),
        profile_id: profileId, kind: update.kind,
        title: `${UPDATE_TITLES[update.kind]}: ${unitTitle(state, update.unitId)}`,
        task_id: null, unit_id: update.unitId
      })));
    check(await service.rpc('reconcile_notifications', {
      p_org: snapshot.orgId, p_language: languageId, p_rows: notifications
    }));
    const visibility = await service.from('language_visibility').select('listed')
      .eq('org_id', snapshot.orgId).eq('language_id', languageId).maybeSingle();
    check(visibility);
    const info = languageInfo(org, languageId);
    if (visibility.data?.listed && info) {
      const progress = languageProgress(state, idx);
      check(await service.from('public_languages').upsert({
        org_id: snapshot.orgId, language_id: languageId,
        name: info.name, code: info.code,
        translated_pct: progress.total ? (100 * progress.recorded) / progress.total : 0,
        // What someone browsing may do with the work (docs/licensing.md).
        license: orgLicense(org),
        updated_at: new Date().toISOString()
      }));
    }
  });
  // The organization's own rows (language null): join requests and reports.
  for (const [orgId, org] of orgs) {
    const requests = await service.from('join_requests').select('id,profile_id')
      .eq('org_id', orgId);
    check(requests);
    const admins = Object.keys(org.members).filter((id) =>
      privilegesFor(org, id).has('invite_members'));
    const rows = admins.flatMap((profileId) => (requests.data ?? []).map((request) => ({
      id: JSON.stringify([orgId,'join',profileId,request.id]),
      profile_id: profileId, kind: 'join_request', title: 'A person requested access'
    })));
    rows.push(...await reportNotifications(service, orgId, org));
    check(await service.rpc('reconcile_notifications', {
      p_org: orgId, p_language: null, p_rows: rows
    }));
  }
}

/**
 * One Inbox row per reported thing for each person who may act on it
 * (decisions.md 48), as `org_content_reports` decides: content for whoever
 * manages its language, a person for whoever admits members organization-
 * wide, never someone about themselves. The title names nothing; the app
 * reads the report itself.
 */
async function reportNotifications(service: SupabaseClient, orgId: string, org: OrgState) {
  const open = await service.from('content_reports')
    .select('language_id,target_kind,target_id,reported_profile')
    .eq('org_id', orgId).is('resolved_at', null).limit(500);
  check(open);
  const seen = new Set<string>();
  const out: { id: string; profile_id: string; kind: string; title: string }[] = [];
  for (const r of open.data ?? []) {
    const person = r.target_kind === 'person';
    const languageId = person ? undefined : (r.language_id as string);
    for (const profileId of Object.keys(org.members)) {
      if (profileId === r.reported_profile) continue;
      if (!privilegesFor(org, profileId, languageId).has(person ? 'invite_members' : 'manage_structure')) continue;
      const id = JSON.stringify([orgId, 'report', profileId, r.language_id, r.target_kind, r.target_id]);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, profile_id: profileId, kind: 'content_report', title: 'Something was reported' });
    }
  }
  return out;
}

/** Push contains no language name or personal content on the lock screen. */
export async function deliverPushes(service: SupabaseClient, fetcher = fetch) {
  const claimed = await service.rpc('claim_notification_pushes');
  check(claimed);
  for (const row of claimed.data ?? []) {
    const tokens = await service.from('push_tokens').select('token').eq('profile_id', row.profile_id);
    check(tokens);
    // No registered phone yet: leave it pending with a five-minute lease.
    if (!tokens.data?.length) continue;
    let accepted = true;
    for (const { token } of tokens.data) {
      const response = await fetcher('https://exp.host/--/api/v2/push/send', {
        signal: AbortSignal.timeout(15_000),
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: token, title: 'LangQuest',
          body: 'You have an update in your inbox.',
          data: { notificationId: row.id }, channelId: 'work' })
      });
      if (!response.ok) { accepted = false; continue; }
      const result = await response.json();
      const ticket = result.data;
      if (ticket?.status === 'ok' && ticket.id) {
        check(await service.from('push_receipts').upsert({
          ticket_id: ticket.id, token, notification_id: row.id
        }));
      } else if (ticket?.details?.error === 'DeviceNotRegistered') {
        check(await service.from('push_tokens').delete().eq('token',token));
      } else accepted = false;
    }
    if (accepted) check(await service.from('notifications')
      .update({ pushed_at: new Date().toISOString(), push_lease_until: null }).eq('id',row.id));
  }
  const receipts = await service.from('push_receipts').select('*')
    .lt('created_at', new Date(Date.now() - 15 * 60_000).toISOString()).limit(100);
  check(receipts);
  if (!receipts.data?.length) return;
  const response = await fetcher('https://exp.host/--/api/v2/push/getReceipts', {
    signal: AbortSignal.timeout(15_000),
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ ids: receipts.data.map((r) => r.ticket_id) })
  });
  if (!response.ok) return;
  const result = await response.json();
  for (const receipt of receipts.data) {
    const status = result.data?.[receipt.ticket_id];
    if (!status) continue;
    if (status.details?.error === 'DeviceNotRegistered') {
      check(await service.from('push_tokens').delete().eq('token',receipt.token));
    } else if (status.status === 'error') {
      check(await service.from('notifications').update({ pushed_at:null })
        .eq('id',receipt.notification_id));
    }
    check(await service.from('push_receipts').delete().eq('ticket_id',receipt.ticket_id));
  }
}
