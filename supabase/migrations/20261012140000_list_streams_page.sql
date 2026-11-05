-- Every stream for the workers, a page at a time (performance-audit.md
-- item 9). list_streams() returns the whole stream_cursors table in one
-- response, and PostgREST cuts a response at max_rows (1000,
-- supabase/config.toml), so past 1000 streams, counting one per person,
-- the snapshot, projection and reconciler passes skipped streams without an
-- error. This pages by the table's key; the workers ask until a page comes
-- back short (packages/client/src/listStreams.ts). list_streams() stays for
-- a worker still deployed from before.

create or replace function public.list_streams_page(
  p_after_org text default '', p_after_stream text default '', p_limit int default 1000
) returns table (org_id text, stream_id text, next_seq bigint)
language plpgsql security definer set search_path = public stable as $$
begin
  if public.caller_id() is not null then
    raise exception 'service role only' using errcode = '42501';
  end if;
  return query
    select c.org_id, c.stream_id, c.next_seq from public.stream_cursors c
    where (c.org_id, c.stream_id) > (coalesce(p_after_org, ''), coalesce(p_after_stream, ''))
    order by c.org_id, c.stream_id
    limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
end $$;

revoke all on function public.list_streams_page(text, text, int) from public, anon, authenticated;
grant execute on function public.list_streams_page(text, text, int) to service_role;
