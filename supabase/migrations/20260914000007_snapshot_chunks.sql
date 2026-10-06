-- Snapshot download in pieces. A Bible-scale snapshot is around 13 MB of
-- JSON; as one response it fails on the links our users have. Clients read
-- the meta, then fetch 256 KB pieces one at a time, persisting each, so a
-- dropped link resumes instead of restarting. jsonb::text is deterministic,
-- so pieces of the same (partition, version, seq) always reassemble.

create or replace function public.snapshot_chunk_chars() returns int language sql immutable as $$ select 262144 $$;

create or replace function public.get_snapshot_meta(
  p_org_id text, p_partition_id text, p_reducer_version int
) returns table (server_seq bigint, chunks int, bytes int)
language plpgsql security definer set search_path = public stable as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is not null and public.member_role(p_org_id, p_partition_id, v_actor) is null then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return query
    select s.server_seq,
           greatest(1, ceil(length(s.state::text)::numeric / public.snapshot_chunk_chars()))::int,
           length(s.state::text)
    from public.snapshots s
    where s.org_id = p_org_id and s.partition_id = p_partition_id and s.reducer_version = p_reducer_version
    order by s.server_seq desc limit 1;
end $$;

create or replace function public.get_snapshot_chunk(
  p_org_id text, p_partition_id text, p_reducer_version int, p_server_seq bigint, p_index int
) returns text
language plpgsql security definer set search_path = public stable as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is not null and public.member_role(p_org_id, p_partition_id, v_actor) is null then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return (
    select substr(s.state::text, p_index * public.snapshot_chunk_chars() + 1, public.snapshot_chunk_chars())
    from public.snapshots s
    where s.org_id = p_org_id and s.partition_id = p_partition_id
      and s.reducer_version = p_reducer_version and s.server_seq = p_server_seq
  );
end $$;

grant execute on function public.get_snapshot_meta(text, text, int) to authenticated;
grant execute on function public.get_snapshot_chunk(text, text, int, bigint, int) to authenticated;
