import type { SupabaseClient } from '@supabase/supabase-js';
import { listStreams } from '../src/listStreams';

/**
 * A service client whose RPC answers as PostgREST does: at most `maxRows`
 * rows a response (supabase/config.toml max_rows = 1000), paged by key.
 */
function service(rows: { org_id: string; stream_id: string; next_seq: number }[], maxRows = 1000) {
  const sorted = [...rows].sort((a, b) => (a.org_id === b.org_id ? (a.stream_id < b.stream_id ? -1 : 1) : a.org_id < b.org_id ? -1 : 1));
  const calls: string[] = [];
  const client = {
    rpc: async (name: string, args: { p_after_org?: string; p_after_stream?: string; p_limit?: number } = {}) => {
      calls.push(name);
      if (name === 'list_streams') return { data: sorted.slice(0, maxRows), error: null };
      const after = [args.p_after_org ?? '', args.p_after_stream ?? ''];
      const page = sorted.filter((r) => r.org_id > after[0]! || (r.org_id === after[0] && r.stream_id > after[1]!));
      return { data: page.slice(0, Math.min(args.p_limit ?? 1000, maxRows)), error: null };
    }
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe('listStreams', () => {
  it('returns every stream past the 1000 rows one response may carry', async () => {
    // Why: list_streams() returned one response, and PostgREST cuts a
    // response at 1000 rows, so past 1000 streams (one per person, too) the
    // snapshot and projection passes skipped streams without an error
    // (performance-audit.md item 9).
    const rows = Array.from({ length: 2500 }, (_, i) => ({ org_id: `org${i % 7}`, stream_id: `s${String(i).padStart(5, '0')}`, next_seq: i + 1 }));
    const { client, calls } = service(rows);
    const streams = await listStreams(client);
    expect(streams).toHaveLength(2500);
    expect(new Set(streams.map((s) => `${s.org_id}/${s.stream_id}`)).size).toBe(2500);
    expect(calls.every((c) => c === 'list_streams_page')).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it('asks once when everything fits', async () => {
    const { client, calls } = service([{ org_id: 'o', stream_id: '_org', next_seq: 3 }]);
    expect(await listStreams(client)).toEqual([{ org_id: 'o', stream_id: '_org', next_seq: 3 }]);
    expect(calls).toHaveLength(1);
  });
});
