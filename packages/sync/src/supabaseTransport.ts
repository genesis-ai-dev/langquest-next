import { CLIENT_PROTOCOL_VERSION, type AnyEvent } from '@langquest-next/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppendResult, SnapshotMeta, Transport, WatchHandlers } from './types';
import { ClientTooOldError, NotAuthorizedError, OfflineError } from './types';

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

/** Transport over the two Postgres RPCs in supabase/migrations. */
export class SupabaseTransport implements Transport {
  constructor(private readonly supabase: SupabaseClient) {}

  async append(events: AnyEvent[]): Promise<AppendResult[]> {
    const { data, error } = await this.supabase.rpc('append_events', {
      p_events: events.map(({ serverSeq: _s, ...e }) => e),
      p_client_version: CLIENT_PROTOCOL_VERSION
    });
    if (error) throw toError(error);
    return (data as { id: string; accepted: boolean; server_seq: number | null; reason: string | null }[]).map(
      (r) => ({ id: r.id, accepted: r.accepted, serverSeq: r.server_seq, reason: r.reason })
    );
  }

  async snapshotMeta(orgId: string, streamId: string, reducerVersion: number): Promise<SnapshotMeta | null> {
    const { data, error } = await this.supabase.rpc('get_snapshot_meta', {
      p_org_id: orgId,
      p_stream_id: streamId,
      p_reducer_version: reducerVersion
    });
    if (error) throw toError(error);
    const row = (data as { server_seq: number; chunks: number; bytes: number }[] | null)?.[0];
    return row ? { serverSeq: row.server_seq, chunks: row.chunks, bytes: row.bytes } : null;
  }

  async snapshotChunk(orgId: string, streamId: string, reducerVersion: number, serverSeq: number, index: number): Promise<string | null> {
    const { data, error } = await this.supabase.rpc('get_snapshot_chunk', {
      p_org_id: orgId,
      p_stream_id: streamId,
      p_reducer_version: reducerVersion,
      p_server_seq: serverSeq,
      p_index: index
    });
    if (error) throw toError(error);
    return (data as string | null) ?? null;
  }

  /**
   * A database trigger (supabase/migrations/*_events_realtime.sql) broadcasts
   * an empty poke on `events:<org>/<stream>` after every insert. The
   * channel is public because the poke says only that the stream moved;
   * the events themselves still come through the RPC and its checks.
   */
  watch(orgId: string, streamId: string, handlers: WatchHandlers): () => void {
    const channel = this.supabase
      .channel(`events:${orgId}/${streamId}`, { config: { private: false } })
      .on('broadcast', { event: 'appended' }, () => handlers.onPoke())
      .subscribe((status) => handlers.onStatus(status === 'SUBSCRIBED'));
    return () => {
      void this.supabase.removeChannel(channel);
    };
  }

  async pull(orgId: string, streamId: string, after: number, limit: number): Promise<AnyEvent[]> {
    const { data, error } = await this.supabase.rpc('pull_events', {
      p_org_id: orgId,
      p_stream_id: streamId,
      p_after: after,
      p_limit: limit,
      p_client_version: CLIENT_PROTOCOL_VERSION
    });
    if (error) throw toError(error);
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
function toError(error: { message: string; code?: string }): Error {
  if (error.code === 'LQ001') return new ClientTooOldError(error.message);
  // insufficient_privilege: every `raise ... using errcode = '42501'` in
  // supabase/migrations, which is how the RPCs refuse a non-member.
  if (error.code === '42501' || /not a member|permission denied|service role only|not authorized/i.test(error.message)) {
    return new NotAuthorizedError(error.message);
  }
  if (/fetch failed|failed to fetch|network|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|timed out/i.test(error.message)) {
    return new OfflineError(error.message);
  }
  return new Error(`${error.code ?? 'rpc'}: ${error.message}`);
}
