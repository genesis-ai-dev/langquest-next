-- The newest server_seq of every partition in one organization, in one
-- query (decisions.md 44, amended 2026-10-03). The dashboard's server asks
-- this before a catch-up pass and pulls only the partitions that moved, so
-- an organization nobody wrote to costs one query instead of a pull per
-- partition. Service role only, like list_partitions.

create or replace function public.partition_heads(p_org_id text)
returns table (partition_id text, head bigint)
language plpgsql security definer set search_path = public stable as $$
begin
  if public.caller_id() is not null then
    raise exception 'service role only' using errcode = '42501';
  end if;
  return query select c.partition_id, c.next_seq - 1 from public.partition_cursors c where c.org_id = p_org_id;
end $$;

revoke all on function public.partition_heads(text) from public, anon, authenticated;
grant execute on function public.partition_heads(text) to service_role;
