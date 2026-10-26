import type { LanguageState, PassageLine, Snapshot } from '@langquest-next/core';
import { NO_UNIT, SHARED } from '../src/serverCut';
import type { KeptRecord } from '../src/types';
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
  /** Rows the pass staged, by stream, until put_snapshot moves them in. */
  const staged = new Map<string, { seq: number; rows: KeptRecord[]; shared?: LanguageState }>();

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
      case 'stage_snapshot_units': {
        const key = `${a['p_org_id']}/${a['p_stream_id']}`;
        const seq = Number(a['p_server_seq']);
        const here = staged.get(key);
        const into = here && here.seq === seq ? here : { seq, rows: [] as KeptRecord[] };
        staged.set(key, into);
        for (const [kind, id, unitId, ref, json] of a['p_rows'] as [string, string, string, string, unknown][]) {
          if (kind === SHARED && id === '' && unitId === NO_UNIT) into.shared = json as LanguageState;
          else into.rows.push({ kind, id, unitId, ref, json: JSON.stringify(json) });
        }
        return null;
      }
      case 'put_snapshot': {
        const snap: Snapshot = {
          orgId: String(a['p_org_id']), streamId: String(a['p_stream_id']), reducerVersion: Number(a['p_reducer_version']),
          serverSeq: Number(a['p_server_seq']), state: a['p_state'] as Snapshot['state']
        };
        const key = `${snap.orgId}/${snap.streamId}`;
        server.snapshots.set(key, snap);
        const cut = staged.get(key);
        if (cut && cut.seq === snap.serverSeq && cut.shared) server.keepCut(snap, { shared: cut.shared, rows: cut.rows });
        staged.delete(key);
        return null;
      }
      case 'put_passage_lines':
        server.keepLines(String(a['p_org_id']), String(a['p_stream_id']), Number(a['p_lines_version']), Number(a['p_server_seq']), a['p_lines'] as PassageLine[]);
        return 0;
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
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const eq: Record<string, unknown> = {};
      for (const m of ['select', 'order']) chain[m] = () => chain;
      chain['eq'] = (column: string, value: unknown) => { eq[column] = value; return chain; };
      chain['limit'] = async () => {
        calls.push({ fn: `from:${table}`, args: { ...eq } });
        if (table === 'snapshot_units') {
          const s = server.snapshots.get(`${eq['org_id']}/${eq['stream_id']}`);
          return { data: s && s.serverSeq === Number(eq['server_seq']) && server.hasCut(s) ? [{ server_seq: s.serverSeq }] : [], error: null };
        }
        if (table === 'events') {
          const hit = server.log.some((e) => e.orgId === eq['org_id'] && e.streamId === eq['stream_id'] && e.type === eq['type']);
          return { data: hit ? [{ id: 'x' }] : [], error: null };
        }
        if (table === 'passage_lines') {
          const l = server.lines.get(`${eq['org_id']}/${eq['stream_id']}`);
          return { data: l && l.version === Number(eq['lines_version']) ? [{ server_seq: l.seq }] : [], error: null };
        }
        return opts.snapshotsError
          ? { data: null, error: { message: opts.snapshotsError } }
          : { data: opts.snapshotCreatedAt ? [{ created_at: opts.snapshotCreatedAt }] : [], error: null };
      };
      return chain;
    }
  } as unknown as SupabaseClient;

  return { client, calls, fail, puts: () => calls.filter((c) => c.fn === 'put_snapshot') };
}
