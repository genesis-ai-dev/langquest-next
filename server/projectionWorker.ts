import type { SupabaseClient } from '@supabase/supabase-js';
import { buildIndexes, deriveInbox, deriveProgress, foldOrg, privilegesFor,
  withOrgMembers, type AnyEvent, type OrgState } from '@langquest-next/core';
import { runSnapshotWorker } from '../packages/client/src/snapshotWorker';
import { SupabaseTransport } from '../packages/client/src/supabaseTransport';

function check(result: { error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
}
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
  const partitions = await service.rpc('list_partitions');
  check(partitions);
  for (const row of partitions.data ?? []) {
    if (row.project_id === '_org') await orgState(row.org_id);
  }
  await runSnapshotWorker(service, 1000, async (snapshot) => {
    const org = await orgState(snapshot.orgId);
    const state = withOrgMembers(snapshot.state, org, snapshot.projectId);
    const idx = buildIndexes(state);
    const notifications = Object.keys(state.members).flatMap((profileId) =>
      deriveInbox(state, profileId, idx).map((item) => ({
        id: JSON.stringify([snapshot.orgId,snapshot.projectId,profileId,item.id]),
        profile_id: profileId, kind: item.kind, title: item.title,
        task_id: item.taskId ?? null, unit_id: item.unitId ?? null,
        lane_id: item.laneId ?? null
      })));
    check(await service.rpc('reconcile_notifications', {
      p_org: snapshot.orgId, p_project: snapshot.projectId, p_rows: notifications
    }));
    const visibility = await service.from('project_visibility').select('listed')
      .eq('org_id', snapshot.orgId).eq('project_id', snapshot.projectId).maybeSingle();
    check(visibility);
    if (visibility.data?.listed && state.project) {
      const lanes = Object.keys(state.lanes);
      const percentages = lanes.map((lane) => deriveProgress(state, lane, idx).translatedPct);
      check(await service.from('public_projects').upsert({
        org_id: snapshot.orgId, project_id: snapshot.projectId,
        name: state.project.value.name,
        languages: Object.values(state.lanes).map((lane) => lane.languoidId),
        translated_pct: percentages.length
          ? percentages.reduce((sum, pct) => sum + pct, 0) / percentages.length : 0,
        updated_at: new Date().toISOString()
      }));
    }
  });
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
    check(await service.rpc('reconcile_notifications', {
      p_org: orgId, p_project: '_org', p_rows: rows
    }));
  }
}

/** Push contains no project title or personal content on the lock screen. */
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
