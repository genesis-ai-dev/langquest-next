import { ORG_STREAM, PERSON_ORG, REDUCER_VERSION, emptyLanguageState, foldLanguage, resume, type AnyEvent, type Snapshot } from '@langquest-next/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseTransport } from './supabaseTransport';
import { fetchSnapshot } from './snapshotFetch';
import { listStreams } from './listStreams';

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
 * reading their snapshot (the projection pass skips what has not changed).
 */
export async function runSnapshotWorker(
  service: SupabaseClient, pageSize = 1000, observe?: (snapshot: Snapshot) => Promise<void>,
  visit?: (orgId: string, streamId: string) => boolean,
  onError?: (orgId: string, streamId: string, error: unknown) => void
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
    if (visit && !visit(orgId, streamId)) continue;
    if (!onError) {
      out.push(await snapshotOne(service, transport, orgId, streamId, pageSize, observe));
      continue;
    }
    // With onError, one language that fails (a write that times out) is
    // reported and the pass goes on to the next.
    try {
      out.push(await snapshotOne(service, transport, orgId, streamId, pageSize, observe));
    } catch (error) {
      onError(orgId, streamId, error);
    }
  }
  return out;
}

async function snapshotOne(
  service: SupabaseClient, transport: SupabaseTransport, orgId: string, streamId: string, pageSize: number,
  observe?: (snapshot: Snapshot) => Promise<void>
): Promise<SnapshotResult> {
  const existing = await fetchSnapshot(transport, orgId, streamId, REDUCER_VERSION);
  const tail = await pullAll(transport, orgId, streamId, existing?.serverSeq ?? 0, pageSize);
  if (tail.length === 0) {
    if (existing && observe) await observe(existing);
    return { orgId, streamId, serverSeq: existing?.serverSeq ?? 0, updated: false, written: false };
  }
  const tailIds = new Set(tail.map((e) => e.id));
  const redactsSnapshot = tail.some(
    (e) => e.type === 'v1.Redacted' && !tailIds.has(e.payload.eventId)
  );

  let snapshot: Snapshot;
  if (existing && !redactsSnapshot) {
    const state = resume(existing, tail);
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
  if (existing && !redaction && tail.length < SNAPSHOT_SCHEDULE.minNewEvents) {
    const at = await service.from('snapshots').select('created_at')
      .eq('org_id', orgId).eq('stream_id', streamId).eq('reducer_version', REDUCER_VERSION)
      .order('server_seq', { ascending: false }).limit(1);
    if (at.error) throw new Error(`snapshot age ${orgId}/${streamId}: ${at.error.message}`);
    const written = (at.data?.[0] as { created_at?: string } | undefined)?.created_at;
    ageMs = written ? Date.now() - Date.parse(written) : null;
  }
  const written = shouldWriteSnapshot({ existing: !!existing, newEvents: tail.length, redaction, ageMs });
  if (written) {
    const put = await service.rpc('put_snapshot', {
      p_org_id: orgId,
      p_stream_id: streamId,
      p_reducer_version: REDUCER_VERSION,
      p_server_seq: snapshot.serverSeq,
      p_state: snapshot.state
    });
    if (put.error) throw new Error(`put_snapshot ${orgId}/${streamId}: ${put.error.message}`);
  }
  if (observe) await observe(snapshot);
  return { orgId, streamId, serverSeq: snapshot.serverSeq, updated: true, written };
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
