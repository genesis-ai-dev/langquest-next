import { ORG_STREAM, PERSON_ORG, REDUCER_VERSION, emptyLanguageState, foldLanguage, resume, type AnyEvent, type Snapshot } from '@langquest-next/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseTransport } from './supabaseTransport';
import { fetchSnapshot } from './snapshotFetch';

export interface SnapshotResult {
  orgId: string;
  streamId: string;
  serverSeq: number;
  /** false when the stream had nothing new since its snapshot. */
  updated: boolean;
}

/**
 * The async projection worker from PLAN.md section 5: off the write path,
 * runs with the service role, folds each stream with the same reducer the
 * phones run, and stores the result via put_snapshot. Incremental: resumes
 * from the last snapshot and folds only the tail, unless a redaction in the
 * tail targets something inside the snapshot, in which case it refolds the
 * whole log so the target really disappears.
 */
export async function runSnapshotWorker(service: SupabaseClient, pageSize = 1000, observe?: (snapshot: Snapshot) => Promise<void>): Promise<SnapshotResult[]> {
  const transport = new SupabaseTransport(service);
  const { data, error } = await service.rpc('list_streams');
  if (error) throw new Error(`list_streams: ${error.message}`);
  const out: SnapshotResult[] = [];

  for (const row of (data ?? []) as { org_id: string; stream_id: string }[]) {
    const orgId = row.org_id;
    const streamId = row.stream_id;
    // Only language streams have a server snapshot; the organization and person streams are small.
    if (streamId === ORG_STREAM || orgId === PERSON_ORG) continue;
    const existing = await fetchSnapshot(transport, orgId, streamId, REDUCER_VERSION);
    const tail = await pullAll(transport, orgId, streamId, existing?.serverSeq ?? 0, pageSize);
    if (tail.length === 0) {
      if (existing && observe) await observe(existing);
      out.push({ orgId, streamId, serverSeq: existing?.serverSeq ?? 0, updated: false });
      continue;
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

    const put = await service.rpc('put_snapshot', {
      p_org_id: orgId,
      p_stream_id: streamId,
      p_reducer_version: REDUCER_VERSION,
      p_server_seq: snapshot.serverSeq,
      p_state: snapshot.state
    });
    if (put.error) throw new Error(`put_snapshot ${orgId}/${streamId}: ${put.error.message}`);
    if (observe) await observe(snapshot);
    out.push({ orgId, streamId, serverSeq: snapshot.serverSeq, updated: true });
  }
  return out;
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
