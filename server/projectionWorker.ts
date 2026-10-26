import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildIndexes, foldOrg, languageInfo, languagePeople, languageProgress, LINES_VERSION, onlyEventsThatLeaveTheReport, ORG_STREAM, orgLicense, PERSON_ORG,
  REDUCER_VERSION, REPORT_VERSION, reportInputs, unitTitle, updatesFor, type AnyEvent, type OrgState, type Update } from '@langquest-next/core';
import { runSnapshotWorker, shouldWriteSnapshot, SNAPSHOT_SCHEDULE } from '../packages/sync/src/snapshotWorker';
import { SupabaseTransport } from '../packages/sync/src/supabaseTransport';
import { listStreams } from '../packages/sync/src/listStreams';
import { check } from './dbError';
import { ARRIVAL_SAMPLE, arrivalStats, type ArrivalRow, type ArrivalStats } from './arrivals';

/** What an Inbox row says. The app shows the passage; the push shows neither (server/pushDelivery.ts). */
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

/** What the last pass wrote for a stream (`projection_marks`). */
interface Mark {
  org_id: string; stream_id: string; seq: number; org_seq: number; listed: boolean; version: string;
  /** What the language's projection read from the organization at `org_seq` (`orgFingerprint`); null on a mark from before it. */
  org_fp: string | null;
}

/**
 * Everything a language's projection reads from its organization: who may
 * open it (the Inbox rows go to them), its name and code, and the licence
 * (the public listing). Any other organization event (an invite, a role for
 * another language, a join decided elsewhere) leaves this as it was, and the
 * language is not folded again for it. A change to what the projection reads
 * from the organization must change this too, or add to PROJECTION_VERSION.
 */
export function orgFingerprint(org: OrgState, languageId: string): string {
  const info = languageInfo(org, languageId);
  return createHash('sha256').update(JSON.stringify([
    [...languagePeople(org, languageId).keys()].sort(), info?.name ?? null, info?.code ?? null, orgLicense(org)
  ])).digest('hex');
}

const streamKey = (orgId: string, streamId: string) => JSON.stringify([orgId, streamId]);

/** Every row of a service table (with `onlyTrue` set, those where that column is true), past PostgREST's page limit. */
async function selectAll<T>(service: SupabaseClient, table: string, columns: string, onlyTrue?: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const query = service.from(table).select(columns);
    const page = await (onlyTrue ? query.eq(onlyTrue, true) : query).range(from, from + 999);
    check(page, table);
    const rows = (page.data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

/** The newest snapshot of each stream at this reducer version, one row per stream (`snapshot_heads_page`), not every retained one. */
async function snapshotHeads(service: SupabaseClient): Promise<{ org_id: string; stream_id: string; server_seq: number; created_at: string }[]> {
  const out: { org_id: string; stream_id: string; server_seq: number; created_at: string }[] = [];
  let after = { org: '', stream: '' };
  for (;;) {
    const page = await service.rpc('snapshot_heads_page', {
      p_reducer_version: REDUCER_VERSION, p_after_org: after.org, p_after_stream: after.stream, p_limit: 1000
    });
    check(page, 'snapshot_heads_page');
    const rows = (page.data ?? []) as typeof out;
    out.push(...rows);
    if (rows.length < 1000) return out;
    const last = rows[rows.length - 1]!;
    after = { org: last.org_id, stream: last.stream_id };
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
 * The projection pass (decisions.md 68). Only what changed since the last
 * pass is read: a language is projected again when its stream has new
 * events, what it reads from its organization changed (who belongs, the
 * language's name and code, the licence: `orgFingerprint`; other
 * organization events leave it alone), or its public listing was switched;
 * otherwise its snapshot is not even downloaded. An organization whose stream changed has its own Inbox
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
  service: SupabaseClient, counts: ProjectionCounts = { orgs: 0, projected: 0 },
  /** Called as each language's projection is written, for what the caller measures per language (server/projections.ts). */
  projected?: (orgId: string, streamId: string) => void,
  /**
   * Asked before each organization and language. True stops the pass there:
   * the one in hand finishes, the rest wait for the next pass (the job
   * container asks to stop on SIGTERM, decisions.md 141).
   */
  stop?: () => boolean
): Promise<{ languages: number; snapshots: number; quiet: number; arrivals: ArrivalStats; failed: { orgId: string; streamId: string; error: unknown }[] }> {
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
  const marks = new Map((await selectAll<Mark>(service, 'projection_marks', 'org_id,stream_id,seq,org_seq,listed,version,org_fp'))
    .map((m) => [streamKey(m.org_id, m.stream_id), m]));
  // Only the listed ones are needed, so the unlisted majority is not read.
  const listed = new Set((await selectAll<{ org_id: string; language_id: string }>(
    service, 'language_visibility', 'org_id,language_id', 'listed'))
    .map((v) => streamKey(v.org_id, v.language_id)));
  // The newest snapshot of each language, so one that went quiet with a few
  // events past its snapshot still gets a new one after an hour (decisions.md 88).
  const snapshotOf = new Map<string, { seq: number; at: number }>();
  for (const s of await snapshotHeads(service)) {
    snapshotOf.set(streamKey(s.org_id, s.stream_id), { seq: Number(s.server_seq), at: Date.parse(s.created_at) });
  }
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
  /**
   * Has anything the language's projection reads from its organization
   * changed since its mark? When the organization's stream has moved, the
   * organization is folded (once per pass) and the fingerprint compared: an
   * event for someone else's role or another language leaves it equal. A
   * mark from before fingerprints answers true.
   */
  const orgMoved = async (orgId: string, streamId: string, m: Mark): Promise<{ moved: boolean; seq: number; fp: string | null }> => {
    if (Number(m.org_seq) === heads.get(streamKey(orgId, ORG_STREAM))) return { moved: false, seq: Number(m.org_seq), fp: m.org_fp };
    if (!m.org_fp) return { moved: true, seq: Number(m.org_seq), fp: null };
    const { org, seq } = await orgState(orgId);
    const fp = orgFingerprint(org, streamId);
    return { moved: fp !== m.org_fp, seq, fp };
  };
  /** Does this language need folding, for its own events, listing, version or organization? */
  const languageChanged = async (orgId: string, streamId: string): Promise<boolean> => {
    const m = marks.get(streamKey(orgId, streamId));
    if (!m || m.version !== PROJECTION_VERSION
      || Number(m.seq) !== heads.get(streamKey(orgId, streamId))
      || m.listed !== listed.has(streamKey(orgId, streamId))) return true;
    const org = await orgMoved(orgId, streamId, m);
    if (org.moved) return true;
    // The organization moved but not for this language: take the mark along, so the next pass does not fold the organization again.
    if (org.seq !== Number(m.org_seq)) await mark(orgId, streamId, Number(m.seq), org.seq, m.listed, org.fp);
    return false;
  };
  // Events appended since the last pass, in every stream (a stream with no mark has no baseline).
  let newEvents = 0;
  for (const [key, m] of marks) {
    const head = heads.get(key);
    if (head !== undefined && head > Number(m.seq)) newEvents += head - Number(m.seq);
  }
  /**
   * The newest events past the mark, for upload delay and clock skew
   * (arrivals.ts). A language that fails is sampled again by the next pass;
   * a failed sample is skipped and never fails the language.
   */
  const arrivalRows: ArrivalRow[] = [];
  const sampleArrivals = async (orgId: string, streamId: string) => {
    const key = streamKey(orgId, streamId);
    const m = marks.get(key);
    const head = heads.get(key) ?? 0;
    if (!m || head <= Number(m.seq)) return;
    try {
      const page = await service.from('events').select('hlc,received_at,device_id')
        .eq('org_id', orgId).eq('stream_id', streamId).gt('server_seq', Number(m.seq)).lte('server_seq', head)
        .order('server_seq', { ascending: false }).limit(ARRIVAL_SAMPLE);
      if (!page.error) arrivalRows.push(...((page.data ?? []) as ArrivalRow[]));
    } catch {
      // A sample is never the language's failure.
    }
  };
  const mark = async (orgId: string, streamId: string, seq: number, orgSeq: number, isListed: boolean, orgFp: string | null = null) => {
    const row = {
      // projected_at is set by the database on this write (20261016010000_diag_jobs.sql).
      org_id: orgId, stream_id: streamId, seq, org_seq: orgSeq, listed: isListed, version: PROJECTION_VERSION, org_fp: orgFp
    };
    check(await service.from('projection_marks').upsert(row), 'projection_marks');
    marks.set(streamKey(orgId, streamId), row);
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
    if (m.listed !== listed.has(key)) return false;
    const org = await orgMoved(orgId, streamId, m);
    if (org.moved) return false;
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
      await mark(orgId, streamId, seq, org.seq, m.listed, org.fp);
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
    await mark(snapshot.orgId, languageId, snapshot.serverSeq, orgSeq, isListed, orgFingerprint(org, languageId));
    counts.projected += 1;
    projected?.(snapshot.orgId, languageId);
  }, async (orgId, streamId) => {
    if (stop?.() || !((await languageChanged(orgId, streamId)) || snapshotDue(orgId, streamId))) return false;
    // Before the quiet skip moves the mark: quiet languages arrive too.
    await sampleArrivals(orgId, streamId);
    return !(await skipQuiet(orgId, streamId));
  },
  // The pass goes on past a language that fails, so the next waits only for its own turn.
  (orgId, streamId, error) => { failed.push({ orgId, streamId, error }); },
  // The age of the snapshot the pass already read, so folding does not ask again.
  (orgId, streamId) => {
    const snap = snapshotOf.get(streamKey(orgId, streamId));
    return snap ? (Number.isNaN(snap.at) ? null : Date.now() - snap.at) : undefined;
  });
  return { languages: results.filter((r) => r.updated).length, snapshots: results.filter((r) => r.written).length, quiet, arrivals: arrivalStats(arrivalRows, newEvents), failed };
}

