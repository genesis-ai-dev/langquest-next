import type { Snapshot } from '@langquest-next/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FakeServer } from '../src/testing/fakeServer';

interface Call {
  fn: string;
  args: Record<string, unknown>;
}

/**
 * A service-role SupabaseClient answered by a FakeServer: the RPCs the
 * projection worker and the reconciler use (list_streams_page, pull_events,
 * get_snapshot_meta, get_snapshot_chunk, put_snapshot) and the one
 * `snapshots` read. `fail` makes a named RPC (`put_snapshot`, or
 * `put_snapshot:<streamId>`) answer with an error.
 */
export function fakeSupabase(server: FakeServer, opts: { snapshotCreatedAt?: string | null; snapshotsError?: string } = {}) {
  const calls: Call[] = [];
  const fail = new Map<string, string>();
  const transport = server.transportFor();

  const streams = () => {
    const seen = new Map<string, { org_id: string; stream_id: string; next_seq: number }>();
    for (const e of server.log) {
      seen.set(`${e.orgId}/${e.streamId}`, { org_id: e.orgId, stream_id: e.streamId, next_seq: server.head(e.orgId, e.streamId) + 1 });
    }
    return [...seen.values()].sort((a, b) => `${a.org_id}/${a.stream_id}`.localeCompare(`${b.org_id}/${b.stream_id}`));
  };

  const answer = async (fn: string, a: Record<string, unknown>): Promise<unknown> => {
    switch (fn) {
      case 'list_streams_page': {
        const after = `${a['p_after_org']}/${a['p_after_stream']}`;
        return streams().filter((s) => `${s.org_id}/${s.stream_id}` > after).slice(0, Number(a['p_limit']));
      }
      case 'pull_events':
        return (await transport.pull(String(a['p_org_id']), String(a['p_stream_id']), Number(a['p_after']), Number(a['p_limit']))).map((e) => ({
          id: e.id, org_id: e.orgId, stream_id: e.streamId, server_seq: e.serverSeq, type: e.type, actor_id: e.actorId,
          device_id: e.deviceId, hlc: e.hlc, parent_event_id: e.parentEventId ?? null, payload: e.payload
        }));
      case 'get_snapshot_meta': {
        const m = await transport.snapshotMeta(String(a['p_org_id']), String(a['p_stream_id']), Number(a['p_reducer_version']));
        return m ? [{ server_seq: m.serverSeq, chunks: m.chunks, bytes: m.bytes }] : [];
      }
      case 'get_snapshot_chunk':
        return transport.snapshotChunk(
          String(a['p_org_id']), String(a['p_stream_id']), Number(a['p_reducer_version']), Number(a['p_server_seq']), Number(a['p_index'])
        );
      case 'put_snapshot': {
        const snap: Snapshot = {
          orgId: String(a['p_org_id']), streamId: String(a['p_stream_id']), reducerVersion: Number(a['p_reducer_version']),
          serverSeq: Number(a['p_server_seq']), state: a['p_state'] as Snapshot['state']
        };
        server.snapshots.set(`${snap.orgId}/${snap.streamId}`, snap);
        return null;
      }
      case 'record_blob':
        server.storeBlob(String(a['p_org']), String(a['p_stream']), String(a['p_hash']), Number(a['p_size']));
        return null;
      case 'invalidate_blob':
        return null;
      default:
        throw new Error(`unexpected rpc ${fn}`);
    }
  };

  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const message = fail.get(`${fn}:${args['p_stream_id']}`) ?? fail.get(fn);
      if (message) return { data: null, error: { message } };
      return { data: await answer(fn, args), error: null };
    },
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order']) chain[m] = () => chain;
      chain['limit'] = async () =>
        opts.snapshotsError
          ? { data: null, error: { message: opts.snapshotsError } }
          : { data: opts.snapshotCreatedAt ? [{ created_at: opts.snapshotCreatedAt }] : [], error: null };
      return chain;
    }
  } as unknown as SupabaseClient;

  return { client, calls, fail, puts: () => calls.filter((c) => c.fn === 'put_snapshot') };
}
