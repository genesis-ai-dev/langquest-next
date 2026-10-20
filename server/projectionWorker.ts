import type { SupabaseClient } from '@supabase/supabase-js';
import { buildIndexes, foldOrg, languageInfo, languagePeople, languageProgress, LINES_VERSION, onlyEventsThatLeaveTheReport, ORG_STREAM, orgLicense, PERSON_ORG,
  REDUCER_VERSION, REPORT_VERSION, reportInputs, unitTitle, updatesFor, type AnyEvent, type OrgState, type Update } from '@langquest-next/core';
import { runSnapshotWorker, shouldWriteSnapshot, SNAPSHOT_SCHEDULE } from '../packages/sync/src/snapshotWorker';
import { SupabaseTransport } from '../packages/sync/src/supabaseTransport';
import { listStreams } from '../packages/sync/src/listStreams';

/**
 * A database call that failed. Its operation and SQLSTATE travel with it,
 * so a job run can say what failed (`reconcile_notifications:57014`)
 * without its message (server/jobRuns.ts errorClassOf).
 */
export class DbError extends Error {
  override name = 'DbError';
  constructor(readonly op: string, readonly code: string | undefined, message: string) {
    super(message);
  }
}

function check(result: { error: { message: string; code?: string } | null }, op: string) {
  if (result.error) throw new DbError(op, result.error.code, result.error.message);
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
 * the unchanged ones. A new reducer, report or lines version does the same:
 * 2 added the report inputs (decisions.md 142), 3 the snapshot's cut by
 * passage and every passage's line (decisions.md 147), so every language
 * gets them once.
 */
const PROJECTION_VERSION = `${REDUCER_VERSION}:${REPORT_VERSION}:${LINES_VERSION}:3`;

/**
 * Languages too big for an Edge Function (decisions.md 103). A run there
 * gets 256 MB and 2 s of CPU; folding Santhali (225,000 events, a 61 MB
 * state) took about 850 MB in Node. A language is large when its newest
 * snapshot is `chars` long or more, or when `events` or more have arrived
 * since it (all of its log when it has none). Hosted environments run the
 * whole pass in the job container (`server/projections.ts`, decisions.md
 * 141); only a local stack's Edge pass, every minute, leaves these out
 * (`server/projectionEdge.ts`), and `npx tsx server/projections.ts` runs them.
 */
export const LARGE = { chars: 10_000_000, events: 25_000 };

export function isLarge(o: { chars: number; head: number; snapshotSeq: number }, limits = LARGE): boolean {
  return o.chars >= limits.chars || o.head - o.snapshotSeq >= limits.events;
}

/** Which languages a pass covers: every one (the job container), or only the small ones (a local stack's Edge Function). */
export type ProjectionScope = 'all' | 'small';

/** What the last pass wrote for a stream (`projection_marks`). */
interface Mark { org_id: string; stream_id: string; seq: number; org_seq: number; listed: boolean; version: string }

const streamKey = (orgId: string, streamId: string) => JSON.stringify([orgId, streamId]);

/** Every row of a service table, past PostgREST's page limit. */
async function selectAll<T>(service: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await service.from(table).select(columns).range(from, from + 999);
    check(page, table);
    const rows = (page.data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

/**
 * What a pass has done so far. The caller passes it in, so a pass that stops
 * at a failing language still says how far it got (its job run).
 */
export interface ProjectionCounts {
  /** Organizations whose own Inbox rows were refreshed. */
  orgs: number;
  /** Languages whose Inbox rows and listing were written. */
  projected: number;
}

/**
 * The Edge pass stopped at a language: which one, and what failed (`cause`).
 * The message is the cause's, for the function's log.
 */
export class ProjectionFailed extends Error {
  override name = 'ProjectionFailed';
  constructor(readonly orgId: string, readonly streamId: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
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
 *
 * A language whose stream moved is not always folded either: when the
 * organization and the listing are as the mark left them, no snapshot is
 * due, and every new event is of a type that cannot change an Inbox row, a
 * row's title or the language's progress (`eventsThatCannotChangeInbox`),
 * the pass reads just those events and moves the mark to them, without
 * downloading the snapshot (a Bible-scale one is about 14 MB). The
 * snapshot's own schedule (88) is unchanged: once 200 events or an hour
 * have passed, the language is folded and its snapshot written as before.
 */
export async function runProjections(
  service: SupabaseClient, scope: ProjectionScope = 'all', counts: ProjectionCounts = { orgs: 0, projected: 0 },
  /** Called as each language's projection is written, for what the caller measures per language (server/projections.ts). */
  projected?: (orgId: string, streamId: string) => void,
  /**
   * Asked before each organization and language. True stops the pass there:
   * the one in hand finishes, the rest wait for the next pass (the job
   * container asks to stop on SIGTERM, decisions.md 141).
   */
  stop?: () => boolean
): Promise<{ languages: number; snapshots: number; quiet: number; failed: { orgId: string; streamId: string; error: unknown }[] }> {
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
  const heads = new Map<string, number>();
  for (const row of await listStreams(service)) {
    heads.set(streamKey(row.org_id, row.stream_id), Number(row.next_seq) - 1);
  }
  const marks = new Map((await selectAll<Mark>(service, 'projection_marks', '*'))
    .map((m) => [streamKey(m.org_id, m.stream_id), m]));
  const listed = new Set((await selectAll<{ org_id: string; language_id: string; listed: boolean }>(
    service, 'language_visibility', 'org_id,language_id,listed'))
    .filter((v) => v.listed).map((v) => streamKey(v.org_id, v.language_id)));
  // The newest snapshot of each language, so one that went quiet with a few
  // events past its snapshot still gets a new one after an hour (decisions.md 88).
  const snapshotOf = new Map<string, { seq: number; at: number; chars: number }>();
  for (const s of await selectAll<{ org_id: string; stream_id: string; reducer_version: number; server_seq: number; created_at: string; chars: number | null }>(
    service, 'snapshots', 'org_id,stream_id,reducer_version,server_seq,created_at,chars')) {
    if (s.reducer_version !== REDUCER_VERSION) continue;
    const key = streamKey(s.org_id, s.stream_id);
    const seen = snapshotOf.get(key);
    if (!seen || Number(s.server_seq) > seen.seq) {
      snapshotOf.set(key, { seq: Number(s.server_seq), at: Date.parse(s.created_at), chars: Number(s.chars ?? 0) });
    }
  }
  const large = (orgId: string, streamId: string) => {
    const snap = snapshotOf.get(streamKey(orgId, streamId));
    return isLarge({ chars: snap?.chars ?? 0, head: heads.get(streamKey(orgId, streamId)) ?? 0, snapshotSeq: snap?.seq ?? 0 });
  };
  const inScope = (orgId: string, streamId: string) => scope === 'all' || !large(orgId, streamId);
  const snapshotDue = (orgId: string, streamId: string) => {
    const snap = snapshotOf.get(streamKey(orgId, streamId));
    const head = heads.get(streamKey(orgId, streamId)) ?? 0;
    return !!snap && snap.seq < head && Date.now() - snap.at >= SNAPSHOT_SCHEDULE.maxAgeMs;
  };
  const changed = (orgId: string, streamId: string) => {
    const mark = marks.get(streamKey(orgId, streamId));
    return !mark || mark.version !== PROJECTION_VERSION
      || Number(mark.seq) !== heads.get(streamKey(orgId, streamId))
      || Number(mark.org_seq) !== heads.get(streamKey(orgId, ORG_STREAM))
      || mark.listed !== listed.has(streamKey(orgId, streamId));
  };
  const mark = async (orgId: string, streamId: string, seq: number, orgSeq: number, isListed: boolean) => {
    check(await service.from('projection_marks').upsert({
      // projected_at is set by the database on this write (20261016010000_diag_jobs.sql).
      org_id: orgId, stream_id: streamId, seq, org_seq: orgSeq, listed: isListed, version: PROJECTION_VERSION
    }), 'projection_marks');
  };

  /**
   * Look at only the events past the mark. When they are all quiet and
   * nothing else is due, move the mark to them (no snapshot download) and
   * say so. Any doubt answers false and the language is folded as usual.
   */
  let quiet = 0;
  const skipQuiet = async (orgId: string, streamId: string): Promise<boolean> => {
    const key = streamKey(orgId, streamId);
    const m = marks.get(key);
    const snap = snapshotOf.get(key);
    const head = heads.get(key) ?? 0;
    if (!m || !snap || m.version !== PROJECTION_VERSION) return false;
    if (Number(m.org_seq) !== heads.get(streamKey(orgId, ORG_STREAM)) || m.listed !== listed.has(key)) return false;
    // At most one page of news; a long backlog is folded.
    if (Number(m.seq) >= head || head - Number(m.seq) > 1000) return false;
    const ageMs = Number.isNaN(snap.at) ? null : Date.now() - snap.at;
    if (shouldWriteSnapshot({ existing: true, newEvents: head - snap.seq, redaction: false, ageMs })) return false;
    try {
      const tail = await transport.pull(orgId, streamId, Number(m.seq), 1000);
      // Quiet for the report too (decisions.md 142): an upload changes the report, so it is folded.
      if (tail.length === 0 || !onlyEventsThatLeaveTheReport(tail)) return false;
      const seq = tail[tail.length - 1]!.serverSeq!;
      // The stored report inputs hold for the tail too; saying so keeps Reports from calling them old.
      check(await service.from('language_report_inputs').update({ seq, updated_at: new Date().toISOString() })
        .eq('org_id', orgId).eq('language_id', streamId).eq('report_version', REPORT_VERSION), 'language_report_inputs');
      await mark(orgId, streamId, seq, Number(m.org_seq), m.listed);
    } catch {
      return false;
    }
    quiet += 1;
    return true;
  };

  // The organizations' own rows first: they are quick, and admins wait on them.
  for (const [key, head] of heads) {
    const [orgId, streamId] = JSON.parse(key) as [string, string];
    if (stop?.()) break;
    if (streamId !== ORG_STREAM || orgId === PERSON_ORG || !changed(orgId, ORG_STREAM)) continue;
    check(await service.rpc('refresh_org_notifications', { p_org: orgId }), 'refresh_org_notifications');
    await mark(orgId, ORG_STREAM, head, head, false);
    counts.orgs += 1;
  }

  // Each changed language stream: everyone who may open the language gets
  // the updates that concern them (core updatesFor, the phone's Inbox).
  const failed: { orgId: string; streamId: string; error: unknown }[] = [];
  // What the public listing holds now, read once and only if a listed language is folded.
  let shownRows: Promise<Map<string, { name: string; code: string; translated_pct: number; license: string }>> | undefined;
  const publicRows = () => shownRows ??= selectAll<{ org_id: string; language_id: string; name: string; code: string; translated_pct: number; license: string }>(
    service, 'public_languages', 'org_id,language_id,name,code,translated_pct,license')
    .then((rows) => new Map(rows.map((r) => [streamKey(r.org_id, r.language_id), r])));
  const results = await runSnapshotWorker(service, 1000, async (snapshot) => {
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
    }), 'reconcile_notifications');
    // What the language's report is made from, for the app's Worker to render (decisions.md 142).
    check(await service.from('language_report_inputs').upsert({
      org_id: snapshot.orgId, language_id: languageId, seq: snapshot.serverSeq, report_version: REPORT_VERSION,
      inputs: reportInputs(state, Date.now(), idx), updated_at: new Date().toISOString()
    }), 'language_report_inputs');
    const isListed = listed.has(streamKey(snapshot.orgId, languageId));
    const info = languageInfo(org, languageId);
    if (isListed && info) {
      const progress = languageProgress(state, idx);
      const row = {
        org_id: snapshot.orgId, language_id: languageId,
        name: info.name, code: info.code,
        translated_pct: progress.total ? (100 * progress.recorded) / progress.total : 0,
        // What someone browsing may do with the work (docs/licensing.md).
        license: orgLicense(org)
      };
      // Written only when something shown changed, not on every fold.
      const shown = (await publicRows()).get(streamKey(snapshot.orgId, languageId));
      if (!shown || shown.name !== row.name || shown.code !== row.code
        || shown.translated_pct !== row.translated_pct || shown.license !== row.license) {
        check(await service.from('public_languages').upsert({ ...row, updated_at: new Date().toISOString() }), 'public_languages');
      }
    }
    await mark(snapshot.orgId, languageId, snapshot.serverSeq, orgSeq, isListed);
    counts.projected += 1;
    projected?.(snapshot.orgId, languageId);
  }, async (orgId, streamId) => !stop?.() && inScope(orgId, streamId) && (changed(orgId, streamId) || snapshotDue(orgId, streamId))
    && !(await skipQuiet(orgId, streamId)),
  // The whole pass goes on past a language that fails, so the next waits only
  // for its own turn; a local Edge pass stops at the first error, as before,
  // and says which language it stopped at.
  (orgId, streamId, error) => {
    if (scope === 'small') throw new ProjectionFailed(orgId, streamId, error);
    failed.push({ orgId, streamId, error });
  },
  // The age of the snapshot the pass already read, so folding does not ask again.
  (orgId, streamId) => {
    const snap = snapshotOf.get(streamKey(orgId, streamId));
    return snap ? (Number.isNaN(snap.at) ? null : Date.now() - snap.at) : undefined;
  });
  return { languages: results.filter((r) => r.updated).length, snapshots: results.filter((r) => r.written).length, quiet, failed };
}

/** Why a push did not go out (`notifications.push_last_error`, 20261016010000_diag_jobs.sql). */
type PushError = 'no_token' | 'http_4xx' | 'http_5xx' | 'timeout' | 'unreachable' | 'ticket_error' | 'receipt_error';

/** What one push delivery pass did, for its job run. */
export interface PushCounts {
  claimed: number;
  /** Every phone of the person accepted it. */
  sent: number;
  /** The person's phones were unregistered between the claim and the send. */
  noToken: number;
  /** A send was refused or never answered; the row is tried again when its lease runs out. */
  failed: number;
  /** Failed rows by their code. */
  failHttp4xx: number;
  failHttp5xx: number;
  failTimeout: number;
  failUnreachable: number;
  failTicket: number;
  /** Tokens Expo said no longer exist, dropped. */
  unregistered: number;
  /** Receipts read back from Expo, and how many said the send failed after all. */
  receipts: number;
  receiptErrors: number;
  /** 1 when Expo's receipts could not be read this pass (they are read again next time). */
  receiptsError: number;
}

const FAIL_COUNT = {
  http_4xx: 'failHttp4xx', http_5xx: 'failHttp5xx', timeout: 'failTimeout', unreachable: 'failUnreachable', ticket_error: 'failTicket'
} as const satisfies Partial<Record<PushError, keyof PushCounts>>;

const isTimeout = (e: unknown) => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');

/**
 * Each claimed row's outcome: pushed, or an attempt counted with its code.
 * Before the migration that adds the columns is applied, a row that went out
 * is marked as the pass marked it before, so nothing is pushed twice.
 */
async function recordPushes(service: SupabaseClient, results: { id: string; error: PushError | null }[]) {
  if (!results.length) return;
  if (!(await service.rpc('record_notification_pushes', { p_results: results })).error) return;
  for (const r of results) {
    if (r.error === null) {
      check(await service.from('notifications').update({ pushed_at: new Date().toISOString(), push_lease_until: null }).eq('id', r.id), 'notifications');
    } else if (r.error === 'receipt_error') {
      check(await service.from('notifications').update({ pushed_at: null }).eq('id', r.id), 'notifications');
    }
  }
}

/** Push contains no language name or personal content on the lock screen. */
export async function deliverPushes(service: SupabaseClient, fetcher = fetch): Promise<PushCounts> {
  const counts: PushCounts = {
    claimed: 0, sent: 0, noToken: 0, failed: 0, failHttp4xx: 0, failHttp5xx: 0, failTimeout: 0, failUnreachable: 0, failTicket: 0,
    unregistered: 0, receipts: 0, receiptErrors: 0, receiptsError: 0
  };
  const claimed = await service.rpc('claim_notification_pushes');
  check(claimed, 'claim_notification_pushes');
  const results: { id: string; error: PushError | null }[] = [];
  try {
    // Every claimed person's phones in one query, not one per row.
    const rows: { id: string; profile_id: string }[] = claimed.data ?? [];
    const tokensOf = new Map<string, { token: string }[]>();
    if (rows.length) {
      const found = await service.from('push_tokens').select('token,profile_id')
        .in('profile_id', [...new Set(rows.map((r) => r.profile_id))]);
      check(found, 'push_tokens');
      for (const t of (found.data ?? []) as { token: string; profile_id: string }[]) {
        const list = tokensOf.get(t.profile_id);
        if (list) list.push({ token: t.token }); else tokensOf.set(t.profile_id, [{ token: t.token }]);
      }
    }
    for (const row of rows) {
      counts.claimed += 1;
      const tokens = { data: tokensOf.get(row.profile_id) ?? [] };
      // No registered phone any more: leave it pending with a five-minute lease.
      if (!tokens.data.length) {
        counts.noToken += 1;
        results.push({ id: row.id, error: 'no_token' });
        continue;
      }
      let error: keyof typeof FAIL_COUNT | null = null;
      for (const { token } of tokens.data) {
        // One phone that does not answer is that row's failure, not the pass's.
        let response: Response;
        try {
          response = await fetcher('https://exp.host/--/api/v2/push/send', {
            signal: AbortSignal.timeout(15_000),
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: token, title: 'LangQuest',
              body: 'You have an update in your inbox.',
              data: { notificationId: row.id }, channelId: 'work' })
          });
        } catch (e) {
          error = isTimeout(e) ? 'timeout' : 'unreachable';
          continue;
        }
        if (!response.ok) {
          error = response.status >= 500 ? 'http_5xx' : 'http_4xx';
          await response.body?.cancel().catch(() => undefined);
          continue;
        }
        const result = await response.json().catch(() => null);
        const ticket = result?.data;
        if (ticket?.status === 'ok' && ticket.id) {
          check(await service.from('push_receipts').upsert({
            ticket_id: ticket.id, token, notification_id: row.id
          }), 'push_receipts');
        } else if (ticket?.details?.error === 'DeviceNotRegistered') {
          check(await service.from('push_tokens').delete().eq('token', token), 'push_tokens');
          counts.unregistered += 1;
        } else error = 'ticket_error';
      }
      if (error) {
        counts.failed += 1;
        counts[FAIL_COUNT[error]] += 1;
      } else counts.sent += 1;
      results.push({ id: row.id, error });
    }
  } finally {
    // What went out is marked even when the pass stops part way, so it is not sent again.
    await recordPushes(service, results);
  }
  const receipts = await service.from('push_receipts').select('*')
    .lt('created_at', new Date(Date.now() - 15 * 60_000).toISOString()).limit(100);
  check(receipts, 'push_receipts');
  if (!receipts.data?.length) return counts;
  let response: Response;
  try {
    response = await fetcher('https://exp.host/--/api/v2/push/getReceipts', {
      signal: AbortSignal.timeout(15_000),
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: receipts.data.map((r) => r.ticket_id) })
    });
  } catch {
    counts.receiptsError = 1;
    return counts;
  }
  if (!response.ok) {
    counts.receiptsError = 1;
    await response.body?.cancel().catch(() => undefined);
    return counts;
  }
  const result = await response.json();
  const back: { id: string; error: PushError }[] = [];
  const read: string[] = [];
  for (const receipt of receipts.data) {
    const status = result.data?.[receipt.ticket_id];
    if (!status) continue;
    counts.receipts += 1;
    if (status.details?.error === 'DeviceNotRegistered') {
      check(await service.from('push_tokens').delete().eq('token', receipt.token), 'push_tokens');
      counts.unregistered += 1;
    } else if (status.status === 'error') {
      counts.receiptErrors += 1;
      back.push({ id: receipt.notification_id, error: 'receipt_error' });
    }
    read.push(receipt.ticket_id);
  }
  // Back to pending before the receipts go, so a failure here leaves them to be read again.
  await recordPushes(service, back);
  for (const ticketId of read) check(await service.from('push_receipts').delete().eq('ticket_id', ticketId), 'push_receipts');
  return counts;
}
