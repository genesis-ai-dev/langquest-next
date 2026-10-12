import type { SupabaseClient } from '@supabase/supabase-js';

export interface StreamRow {
  org_id: string;
  stream_id: string;
  next_seq: number;
}

/**
 * Every stream, for the workers (service role). One response carries at
 * most 1000 rows (PostgREST max_rows), so this pages by key
 * (`list_streams_page`) until a page comes back short; `list_streams()`
 * stopped at 1000 without saying so (performance-audit.md item 9).
 */
export async function listStreams(service: SupabaseClient, pageSize = 1000): Promise<StreamRow[]> {
  const out: StreamRow[] = [];
  let after = { org: '', stream: '' };
  for (;;) {
    const { data, error } = await service.rpc('list_streams_page', { p_after_org: after.org, p_after_stream: after.stream, p_limit: pageSize });
    if (error) throw new Error(`list_streams_page: ${error.message}`);
    const page = (data ?? []) as StreamRow[];
    out.push(...page);
    if (page.length < pageSize) return out;
    const last = page[page.length - 1]!;
    after = { org: last.org_id, stream: last.stream_id };
  }
}
