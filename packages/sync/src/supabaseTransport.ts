import { CLIENT_PROTOCOL_VERSION, type AnyEvent } from '@langquest-next/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppendResult, RowCursor, SnapshotHead, SnapshotMeta, SnapshotRowsPage, Transport, WatchHandlers } from './types';
import { ClientTooOldError, NotAuthorizedError, OfflineError, ServerError, UNRENEWED_TEXT, UnrenewedError } from './types';

interface EventRow {
  id: string;
  org_id: string;
  stream_id: string;
  server_seq: number;
  type: string;
  actor_id: string;
  device_id: string;
  hlc: string;
  parent_event_id: string | null;
  payload: unknown;
}

/** Transport over the Postgres RPCs in supabase/migrations. */
export class SupabaseTransport implements Transport {
  constructor(private readonly supabase: SupabaseClient) {}

  async append(events: AnyEvent[]): Promise<AppendResult[]> {
    const { data, error, status } = await this.supabase.rpc('append_events', {
      p_events: events.map(({ serverSeq: _s, ...e }) => e),
      p_client_version: CLIENT_PROTOCOL_VERSION
    });
    if (error) throw toError(error, status);
    return (data as { id: string; accepted: boolean; server_seq: number | null; reason: string | null }[]).map(
      (r) => ({ id: r.id, accepted: r.accepted, serverSeq: r.server_seq, reason: r.reason })
    );
  }

  async snapshotMeta(orgId: string, streamId: string, reducerVersion: number): Promise<SnapshotMeta | null> {
    const { data, error, status } = await this.supabase.rpc('get_snapshot_meta', {
      p_org_id: orgId,
      p_stream_id: streamId,
      p_reducer_version: reducerVersion
    });
    if (error) throw toError(error, status);
    const row = (data as { server_seq: number; chunks: number; bytes: number }[] | null)?.[0];
    return row ? { serverSeq: row.server_seq, chunks: row.chunks, bytes: row.bytes } : null;
  }

  async snapshotChunk(orgId: string, streamId: string, reducerVersion: number, serverSeq: number, index: number): Promise<string | null> {
    const { data, error, status } = await this.supabase.rpc('get_snapshot_chunk', {
      p_org_id: orgId,
      p_stream_id: streamId,
      p_reducer_version: reducerVersion,
      p_server_seq: serverSeq,
      p_index: index
    });
    if (error) throw toError(error, status);
    return (data as string | null) ?? null;
  }

  async snapshotHead(orgId: string, streamId: string, reducerVersion: number, linesVersion: number, withShared = true): Promise<SnapshotHead | null> {
    const { data, error, status } = await this.supabase.rpc('get_snapshot_head', {
      p_org_id: orgId,
      p_stream_id: streamId,
      p_reducer_version: reducerVersion,
      p_lines_version: linesVersion,
      p_with_shared: withShared
    });
    // A server from before the cut (decisions.md 147) has no such function: the phone downloads the whole snapshot.
    if (error?.code === 'PGRST202') return null;
    if (error) throw toError(error, status);
    const head = data as { server_seq: number; shared?: unknown; units: [string, number][]; lines: { seq: number; lines: unknown[] } | null } | null;
    if (!head) return null;
    return {
      serverSeq: Number(head.server_seq),
      ...(head.shared !== undefined && head.shared !== null ? { shared: head.shared } : {}),
      units: head.units.map(([unitId, rows]) => ({ unitId, rows: Number(rows) })),
      lines: head.lines ? { seq: Number(head.lines.seq), lines: head.lines.lines } : null
    };
  }

  async snapshotRows(
    orgId: string, streamId: string, reducerVersion: number, minSeq: number, unitIds: readonly string[], after: RowCursor | null, limit: number
  ): Promise<SnapshotRowsPage | null> {
    const { data, error, status } = await this.supabase.rpc('get_snapshot_rows', {
      p_org_id: orgId,
      p_stream_id: streamId,
      p_reducer_version: reducerVersion,
      p_min_seq: minSeq,
      p_unit_ids: unitIds,
      p_after: after ? [after.unitId, after.kind, after.id] : null,
      p_limit: limit
    });
    if (error) throw toError(error, status);
    const page = data as { server_seq: number; rows: [string, string, string, string, unknown][]; next: [string, string, string] | null } | null;
    if (!page) return null;
    return {
      serverSeq: Number(page.server_seq),
      rows: page.rows.map(([kind, id, unitId, ref, json]) => ({ kind, id, unitId, ref, json: JSON.stringify(json) })),
      next: page.next ? { unitId: page.next[0], kind: page.next[1], id: page.next[2] } : null
    };
  }

  async snapshotPassages(orgId: string, streamId: string, reducerVersion: number, items: readonly { kind: string; id: string }[]): Promise<{ kind: string; id: string; unitId: string }[]> {
    const { data, error, status } = await this.supabase.rpc('get_snapshot_passages', {
      p_org_id: orgId,
      p_stream_id: streamId,
      p_reducer_version: reducerVersion,
      p_items: items.map((i) => [i.kind, i.id])
    });
    if (error) throw toError(error, status);
    return ((data as [string, string, string][] | null) ?? []).map(([kind, id, unitId]) => ({ kind, id, unitId }));
  }

  /**
   * A database trigger (events_notify) broadcasts a poke on
   * `events:<org>/<stream>` after every push. The channel is private: the
   * server lets only someone who may read the stream hear it
   * (20261016090000_private_pokes.sql), since even a bare poke says when a
   * language is working. The events themselves come through the RPC.
   */
  watch(orgId: string, streamId: string, handlers: WatchHandlers): () => void {
    const channel = this.supabase
      .channel(`events:${orgId}/${streamId}`, { config: { private: true } })
      .on('broadcast', { event: 'appended' }, () => handlers.onPoke())
      .subscribe((status) => handlers.onStatus(status === 'SUBSCRIBED'));
    return () => {
      void this.supabase.removeChannel(channel);
    };
  }

  async pull(orgId: string, streamId: string, after: number, limit: number): Promise<AnyEvent[]> {
    const { data, error, status } = await this.supabase.rpc('pull_events', {
      p_org_id: orgId,
      p_stream_id: streamId,
      p_after: after,
      p_limit: limit,
      p_client_version: CLIENT_PROTOCOL_VERSION
    });
    if (error) throw toError(error, status);
    return (data as EventRow[]).map(
      (r) =>
        ({
          id: r.id,
          type: r.type,
          orgId: r.org_id,
          streamId: r.stream_id,
          actorId: r.actor_id,
          deviceId: r.device_id,
          hlc: r.hlc,
          payload: r.payload,
          serverSeq: r.server_seq,
          ...(r.parent_event_id ? { parentEventId: r.parent_event_id } : {})
        }) as AnyEvent
    );
  }
}

/**
 * Classify an RPC failure. The distinction that matters to the app is
 * whether the server answered: a refusal is an answer, so it must never
 * become an `OfflineError` (the offline path keeps work queued and, in the
 * UI, blocks escapes like sign-out).
 */
function toError(error: { message: string; code?: string }, status?: number): Error {
  if (error.code === 'LQ001') return new ClientTooOldError(error.message);
  // Stopped on the phone because the sign-in could not be renewed: offline
  // for every purpose but diagnostics. Before the network test, which its
  // text also passes.
  if (UNRENEWED_TEXT.test(error.message)) return new UnrenewedError(error.message);
  // insufficient_privilege: every `raise ... using errcode = '42501'` in
  // supabase/migrations, which is how the RPCs refuse a non-member.
  if (error.code === '42501' || /not a member|permission denied|service role only|not authorized/i.test(error.message)) {
    return new NotAuthorizedError(error.message);
  }
  if (/fetch failed|failed to fetch|network|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|timed out/i.test(error.message)) {
    return new OfflineError(error.message);
  }
  return new ServerError(`${error.code ?? 'rpc'}: ${error.message}`, error.code || (status ? `http${status}` : undefined));
}
