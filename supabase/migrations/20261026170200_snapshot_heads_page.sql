-- The newest snapshot of each stream, a page of streams at a time, for the
-- projection pass (performance-audit-2026-10-26.md item 3). The pass read
-- every retained snapshot row's columns every five minutes only to keep the
-- newest per stream; this asks the primary key for one row per stream.
-- Service role only, like list_streams_page.
create or replace function public.snapshot_heads_page(
  p_reducer_version int, p_after_org text default '', p_after_stream text default '', p_limit int default 1000
) returns table (org_id text, stream_id text, server_seq bigint, created_at timestamptz)
language plpgsql security definer set search_path = public stable as $$
begin
  if public.caller_id() is not null then
    raise exception 'service role only' using errcode = '42501';
  end if;
  return query
    select c.org_id, c.stream_id, s.server_seq, s.created_at
    from public.stream_cursors c
    cross join lateral (
      select x.server_seq, x.created_at from public.snapshots x
      where x.org_id = c.org_id and x.stream_id = c.stream_id and x.reducer_version = p_reducer_version
      order by x.server_seq desc limit 1
    ) s
    where (c.org_id, c.stream_id) > (coalesce(p_after_org, ''), coalesce(p_after_stream, ''))
    order by c.org_id, c.stream_id
    limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
end $$;

revoke all on function public.snapshot_heads_page(int, text, text, int) from public, anon, authenticated;
grant execute on function public.snapshot_heads_page(int, text, text, int) to service_role;
