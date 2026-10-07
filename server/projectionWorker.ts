import type { SupabaseClient } from '@supabase/supabase-js';
import { buildIndexes, foldOrg, languageInfo, languagePeople, languageProgress, ORG_STREAM, orgLicense, PERSON_ORG,
  REDUCER_VERSION, unitTitle, updatesFor, type AnyEvent, type OrgState, type Update } from '@langquest-next/core';
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

/**
 * Bump the number when what a pass writes changes (a title above, a listing
 * column), so the next pass redoes every language rather than skipping
 * the unchanged ones. A new reducer does the same.
 */
const PROJECTION_VERSION = `${REDUCER_VERSION}:1`;

/** What the last pass wrote for a stream (`projection_marks`). */
interface Mark { org_id: string; stream_id: string; seq: number; org_seq: number; listed: boolean; version: string }

const streamKey = (orgId: string, streamId: string) => JSON.stringify([orgId, streamId]);

/** Every row of a service table, past PostgREST's page limit. */
async function selectAll<T>(service: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await service.from(table).select(columns).range(from, from + 999);
    check(page);
    const rows = (page.data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

/**
 * The projection pass (decisions.md 68). Only what changed since the last
 * pass is read: a language is projected again when its stream has new
 * events, its organization's stream does (who belongs, roles, the language's
 * name), or its public listing was switched; otherwise its snapshot is not
 * even downloaded. An organization whose stream changed has its own Inbox
 * rows refreshed too; the database already refreshes them when a join
 * request or report changes (refresh_org_notifications).
 */
export async function runProjections(service: SupabaseClient) {
  const transport = new SupabaseTransport(service);
  const orgs = new Map<string, { org: OrgState; seq: number }>();
  async function orgState(orgId: string) {
    const cached = orgs.get(orgId);
    if (cached) return cached;
    const events: AnyEvent[] = [];
    let cursor = 0;
    for (;;) {
      const page = await transport.pull(orgId, ORG_STREAM, cursor, 1000);
      events.push(...page);
      if (page.length < 1000) break;
      cursor = page[page.length - 1]!.serverSeq!;
    }
    const folded = { org: foldOrg(events), seq: events.at(-1)?.serverSeq ?? 0 };
    orgs.set(orgId, folded);
    return folded;
  }
  const streams = await service.rpc('list_streams');
  check(streams);
  const heads = new Map<string, number>();
  for (const row of (streams.data ?? []) as { org_id: string; stream_id: string; next_seq: number }[]) {
    heads.set(streamKey(row.org_id, row.stream_id), Number(row.next_seq) - 1);
  }
  const marks = new Map((await selectAll<Mark>(service, 'projection_marks', '*'))
    .map((m) => [streamKey(m.org_id, m.stream_id), m]));
  const listed = new Set((await selectAll<{ org_id: string; language_id: string; listed: boolean }>(
    service, 'language_visibility', 'org_id,language_id,listed'))
    .filter((v) => v.listed).map((v) => streamKey(v.org_id, v.language_id)));
  const changed = (orgId: string, streamId: string) => {
    const mark = marks.get(streamKey(orgId, streamId));
    return !mark || mark.version !== PROJECTION_VERSION
      || Number(mark.seq) !== heads.get(streamKey(orgId, streamId))
      || Number(mark.org_seq) !== heads.get(streamKey(orgId, ORG_STREAM))
      || mark.listed !== listed.has(streamKey(orgId, streamId));
  };
  const mark = async (orgId: string, streamId: string, seq: number, orgSeq: number, isListed: boolean) => {
    check(await service.from('projection_marks').upsert({
      org_id: orgId, stream_id: streamId, seq, org_seq: orgSeq, listed: isListed, version: PROJECTION_VERSION
    }));
  };

  // The organizations' own rows first: they are quick, and admins wait on them.
  for (const [key, head] of heads) {
    const [orgId, streamId] = JSON.parse(key) as [string, string];
    if (streamId !== ORG_STREAM || orgId === PERSON_ORG || !changed(orgId, ORG_STREAM)) continue;
    check(await service.rpc('refresh_org_notifications', { p_org: orgId }));
    await mark(orgId, ORG_STREAM, head, head, false);
  }

  // Each changed language stream: everyone who may open the language gets
  // the updates that concern them (core updatesFor, the phone's Inbox).
  await runSnapshotWorker(service, 1000, async (snapshot) => {
    const { org, seq: orgSeq } = await orgState(snapshot.orgId);
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
    const isListed = listed.has(streamKey(snapshot.orgId, languageId));
    const info = languageInfo(org, languageId);
    if (isListed && info) {
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
    await mark(snapshot.orgId, languageId, snapshot.serverSeq, orgSeq, isListed);
  }, changed);
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
