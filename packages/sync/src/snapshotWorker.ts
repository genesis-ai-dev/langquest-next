import { LINES_VERSION, ORG_STREAM, PERSON_ORG, REDUCER_VERSION, emptyLanguageState, foldLanguage, resume, type AnyEvent, type LanguageState, type PassageLine, type Snapshot } from '@langquest-next/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseTransport } from './supabaseTransport';
import { fetchSnapshot } from './snapshotFetch';
import { listStreams } from './listStreams';
import { cutRows, languageLinesOf, NO_UNIT, SHARED, sharedPart } from './serverCut';

interface SnapshotResult {
  orgId: string;
  streamId: string;
  serverSeq: number;
  /** false when the stream had nothing new since its snapshot. */
  updated: boolean;
  /** A new snapshot was stored (SNAPSHOT_SCHEDULE says when). */
  written: boolean;
}

/**
 * When a language gets a new server snapshot (decisions.md 88): after 200
 * new events or an hour, whichever comes first, once the stream has moved.
 * Rewriting it after every event made a slow phone's download go stale and
 * start over from the log (performance-audit.md item 5). The pass still
 * folds every changed language for the Inbox; only the write waits.
 */
export const SNAPSHOT_SCHEDULE = { minNewEvents: 200, maxAgeMs: 60 * 60 * 1000 };

/**
 * Should the pass store a new snapshot? Always when there is none, and when
 * the new events hold a redaction: a phone whose own checkpoint holds the
 * target waits for a server snapshot past the redaction (syncClient
 * resolvePendingRedaction), whether or not the server's snapshot held it.
 * Otherwise once enough events or time have passed.
 */
export function shouldWriteSnapshot(
  o: { existing: boolean; newEvents: number; redaction: boolean; ageMs: number | null },
  schedule = SNAPSHOT_SCHEDULE
): boolean {
  if (!o.existing || o.redaction) return true;
  if (o.newEvents === 0) return false;
  return o.newEvents >= schedule.minNewEvents || o.ageMs === null || o.ageMs >= schedule.maxAgeMs;
}

/**
 * The async projection worker from PLAN.md section 5: off the write path,
 * runs with the service role, folds each stream with the same reducer the
 * phones run, and stores the result via put_snapshot on SNAPSHOT_SCHEDULE.
 * Incremental: resumes from the last snapshot and folds only the tail, unless a redaction in the
 * tail targets something inside the snapshot, in which case it refolds the
 * whole log so the target really disappears. `visit`, when given, says
 * which language streams to look at; the others are skipped without
 * reading their snapshot (the projection pass skips what has not changed);
 * it may answer after a look at the stream's newest events. `snapshotAgeMs`
 * is how old each language's newest snapshot is when the caller already
 * knows (null: unknown, so a new one is due), which saves a query per language.
 */
export async function runSnapshotWorker(
  service: SupabaseClient, pageSize = 1000, observe?: (snapshot: Snapshot) => Promise<void>,
  visit?: (orgId: string, streamId: string) => boolean | Promise<boolean>,
  onError?: (orgId: string, streamId: string, error: unknown) => void,
  snapshotAgeMs?: (orgId: string, streamId: string) => number | null | undefined
): Promise<SnapshotResult[]> {
  const transport = new SupabaseTransport(service);
  // Smallest first: a language too big for this run (decisions.md 103) can
  // then hold up only languages bigger than itself, not every one after it.
  const streams = (await listStreams(service)).sort((a, b) => Number(a.next_seq) - Number(b.next_seq));
  const out: SnapshotResult[] = [];

  for (const row of streams) {
    const orgId = row.org_id;
    const streamId = row.stream_id;
    // Only language streams have a server snapshot; the organization and person streams are small.
    if (streamId === ORG_STREAM || orgId === PERSON_ORG) continue;
    // A visit that fails is handled like a snapshot that fails (below).
    if (!onError) {
      if (visit && !(await visit(orgId, streamId))) continue;
      out.push(await snapshotOne(service, transport, orgId, streamId, pageSize, observe, snapshotAgeMs));
      continue;
    }
    // With onError, one language that fails (a write that times out) is
    // reported and the pass goes on to the next.
    try {
      if (visit && !(await visit(orgId, streamId))) continue;
      out.push(await snapshotOne(service, transport, orgId, streamId, pageSize, observe, snapshotAgeMs));
    } catch (error) {
      onError(orgId, streamId, error);
    }
  }
  return out;
}

async function snapshotOne(
  service: SupabaseClient, transport: SupabaseTransport, orgId: string, streamId: string, pageSize: number,
  observe?: (snapshot: Snapshot) => Promise<void>,
  snapshotAgeMs?: (orgId: string, streamId: string) => number | null | undefined
): Promise<SnapshotResult> {
  const existing = await fetchSnapshot(transport, orgId, streamId, REDUCER_VERSION);
  const tail = await pullAll(transport, orgId, streamId, existing?.serverSeq ?? 0, pageSize);
  if (tail.length === 0) {
    // Nothing new, but a snapshot from before the cut, or lines of another LINES_VERSION, get theirs (decisions.md 147).
    if (existing) await completeCut(service, existing);
    if (existing && observe) await observe(existing);
    return { orgId, streamId, serverSeq: existing?.serverSeq ?? 0, updated: false, written: false };
  }
  const tailIds = new Set(tail.map((e) => e.id));
  const redactsSnapshot = tail.some(
    (e) => e.type === 'v1.Redacted' && !tailIds.has(e.payload.eventId)
  );

  let snapshot: Snapshot;
  if (existing && !redactsSnapshot) {
    const state = resume(existing, tail, { clone: false });
    state.appliedEventIds = {};
    snapshot = { ...existing, serverSeq: tail[tail.length - 1]!.serverSeq!, state };
  } else {
    const all = existing || redactsSnapshot ? await pullAll(transport, orgId, streamId, 0, pageSize) : tail;
    const state = foldLanguage(all, emptyLanguageState());
    state.appliedEventIds = {};
    snapshot = { orgId, streamId, reducerVersion: REDUCER_VERSION, serverSeq: all[all.length - 1]!.serverSeq!, state };
  }

  // Its age is only needed when the event count alone does not decide.
  const redaction = tail.some((e) => e.type === 'v1.Redacted');
  let ageMs: number | null = null;
  const known = snapshotAgeMs?.(orgId, streamId);
  if (existing && !redaction && tail.length < SNAPSHOT_SCHEDULE.minNewEvents && known !== undefined) {
    ageMs = known;
  } else if (existing && !redaction && tail.length < SNAPSHOT_SCHEDULE.minNewEvents) {
    const at = await service.from('snapshots').select('created_at')
      .eq('org_id', orgId).eq('stream_id', streamId).eq('reducer_version', REDUCER_VERSION)
      .order('server_seq', { ascending: false }).limit(1);
    if (at.error) throw new Error(`snapshot age ${orgId}/${streamId}: ${at.error.message}`);
    const written = (at.data?.[0] as { created_at?: string } | undefined)?.created_at;
    ageMs = written ? Date.now() - Date.parse(written) : null;
  }
  const written = shouldWriteSnapshot({ existing: !!existing, newEvents: tail.length, redaction, ageMs });
  if (written) {
    // The rows a phone fills its passages from, moved in with the snapshot (decisions.md 147).
    await stageCut(service, snapshot);
    const put = await service.rpc('put_snapshot', {
      p_org_id: orgId,
      p_stream_id: streamId,
      p_reducer_version: REDUCER_VERSION,
      p_server_seq: snapshot.serverSeq,
      p_state: snapshot.state
    });
    if (put.error) throw new Error(`put_snapshot ${orgId}/${streamId}: ${put.error.message}`);
  }
  // Every passage's line, each time the language is folded, not only with a snapshot.
  await putLines(service, snapshot.orgId, snapshot.streamId, snapshot.serverSeq, snapshot.state);
  if (observe) await observe(snapshot);
  return { orgId, streamId, serverSeq: snapshot.serverSeq, updated: true, written };
}

/** Rows sent per call when the pass stages a snapshot's cut: about half a megabyte at Koro's 250 bytes a row. */
export const STAGE_ROWS = 2_000;

/**
 * Cut the fold by passage (core `partEntries`, the phone's `entryRows`) and
 * send the rows, a batch at a time, to wait for `put_snapshot`, which moves
 * them in with the snapshot. The shared part goes last, once the rows have
 * taken what has a passage.
 */
async function stageCut(service: SupabaseClient, snapshot: Snapshot): Promise<void> {
  const { orgId, streamId, serverSeq, state } = snapshot;
  const shared = sharedPart(state);
  let batch: unknown[] = [];
  const send = async () => {
    if (batch.length === 0) return;
    const r = await service.rpc('stage_snapshot_units', {
      p_org_id: orgId, p_stream_id: streamId, p_reducer_version: REDUCER_VERSION, p_server_seq: serverSeq, p_rows: batch
    });
    if (r.error) throw new Error(`stage_snapshot_units ${orgId}/${streamId}: ${r.error.message}`);
    batch = [];
  };
  for (const row of cutRows(state, shared)) {
    batch.push([row.kind, row.id, row.unitId, row.ref, JSON.parse(row.json)]);
    if (batch.length >= STAGE_ROWS) await send();
  }
  batch.push([SHARED, '', NO_UNIT, '', shared]);
  await send();
}

/**
 * A short fingerprint of a line, to tell which stored lines are as they were.
 * 53 bits (cyrb53) is plenty for one passage's line against its own earlier
 * one; a miss only means a line is sent again.
 */
function lineDigest(line: PassageLine): string {
  const text = JSON.stringify(line);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}:${text.length}`;
}

/**
 * Write every passage's line of this LINES_VERSION, held at `seq`. Only the
 * lines that differ from what the database holds are sent: it keeps each
 * line's digest (`passage_line_digests`), and a few events change a few
 * lines, not all of a Bible-scale language's. Before the migration that
 * adds those, or when the digests cannot be read, every line is sent and the
 * database rewrites only those that changed (`put_passage_lines`).
 */
async function putLines(service: SupabaseClient, orgId: string, streamId: string, seq: number, state: LanguageState): Promise<void> {
  const lines = languageLinesOf(state);
  const stored = await service.rpc('passage_line_digests', { p_org_id: orgId, p_stream_id: streamId, p_lines_version: LINES_VERSION });
  if (stored.error) {
    const r = await service.rpc('put_passage_lines', {
      p_org_id: orgId, p_stream_id: streamId, p_lines_version: LINES_VERSION, p_server_seq: seq, p_lines: lines
    });
    if (r.error) throw new Error(`put_passage_lines ${orgId}/${streamId}: ${r.error.message}`);
    return;
  }
  const had = stored.data as Record<string, string | null>;
  const digests: Record<string, string> = {};
  const changed: PassageLine[] = [];
  const now = new Set<string>();
  for (const line of lines) {
    now.add(line.unitId);
    const digest = lineDigest(line);
    if (had[line.unitId] !== digest) {
      changed.push(line);
      digests[line.unitId] = digest;
    }
  }
  const removed = Object.keys(had).filter((unitId) => !now.has(unitId));
  const r = await service.rpc('put_passage_lines_delta', {
    p_org_id: orgId, p_stream_id: streamId, p_lines_version: LINES_VERSION, p_server_seq: seq,
    p_lines: changed, p_digests: digests, p_removed: removed
  });
  if (r.error) throw new Error(`put_passage_lines_delta ${orgId}/${streamId}: ${r.error.message}`);
}

/**
 * A language with nothing new: give its newest snapshot a cut if it was
 * written before the server cut snapshots, and write its lines if the
 * pass has none of this LINES_VERSION at its seq (after a deploy that
 * changed what a line says).
 */
async function completeCut(service: SupabaseClient, snapshot: Snapshot): Promise<void> {
  const { orgId, streamId, serverSeq } = snapshot;
  const cut = await service.from('snapshot_units').select('server_seq')
    .eq('org_id', orgId).eq('stream_id', streamId).eq('reducer_version', REDUCER_VERSION).eq('kind', SHARED).eq('server_seq', serverSeq).limit(1);
  if (cut.error) throw new Error(`snapshot_units ${orgId}/${streamId}: ${cut.error.message}`);
  if ((cut.data ?? []).length === 0) {
    await stageCut(service, snapshot);
    const put = await service.rpc('put_snapshot', {
      p_org_id: orgId, p_stream_id: streamId, p_reducer_version: REDUCER_VERSION, p_server_seq: serverSeq, p_state: snapshot.state
    });
    if (put.error) throw new Error(`put_snapshot ${orgId}/${streamId}: ${put.error.message}`);
  }
  const lines = await service.from('passage_lines').select('server_seq')
    .eq('org_id', orgId).eq('stream_id', streamId).eq('lines_version', LINES_VERSION).eq('unit_id', NO_UNIT).limit(1);
  if (lines.error) throw new Error(`passage_lines ${orgId}/${streamId}: ${lines.error.message}`);
  const at = (lines.data?.[0] as { server_seq?: number } | undefined)?.server_seq;
  if (at === undefined || Number(at) < serverSeq) await putLines(service, orgId, streamId, serverSeq, snapshot.state);
}

async function pullAll(transport: SupabaseTransport, orgId: string, streamId: string, after: number, pageSize: number): Promise<AnyEvent[]> {
  const all: AnyEvent[] = [];
  for (;;) {
    const page = await transport.pull(orgId, streamId, after, pageSize);
    all.push(...page);
    if (page.length < pageSize) return all;
    after = page[page.length - 1]!.serverSeq!;
  }
}
