-- One rule for who may read a partition, used by every read RPC.
--
-- pull_events let any live org member read the org partition (`_org`), but
-- the snapshot reads asked member_role(org, '_org', …), which only an
-- org-scoped membership satisfies. Someone invited to one language could
-- join, then never download the organization: a phone with no checkpoint
-- asks for a snapshot first, was refused "not a member", and showed
-- "What brings you here?" for good (2026-10-01, a Translator invite scoped
-- to one language). Each read deciding for itself is how they drifted, so
-- they now share this function.
create or replace function public.can_read_partition(p_org text, p_partition text, p_profile text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_partition = '_org' then exists (
      select 1 from public.org_memberships m
      where m.org_id = p_org and m.profile_id = p_profile and not m.removed)
    else public.member_role(p_org, p_partition, p_profile) is not null
  end;
$$;
revoke all on function public.can_read_partition(text, text, text) from public, anon, authenticated;

create or replace function public.pull_events(
  p_org_id text, p_partition_id text, p_after bigint default 0, p_limit int default 500, p_client_version int default 0
) returns setof public.events
language plpgsql security definer set search_path = public stable as $$
declare v_actor text := public.caller_id();
begin
  perform public.require_client_version(p_client_version);
  if v_actor is not null and not public.can_read_partition(p_org_id, p_partition_id, v_actor)
     and exists (select 1 from public.events e where e.org_id = p_org_id and e.partition_id = p_partition_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return query
    select * from public.events e
    where e.org_id = p_org_id and e.partition_id = p_partition_id and e.server_seq > p_after
    order by e.server_seq
    limit least(greatest(p_limit, 1), 1000);
end $$;

create or replace function public.get_snapshot(p_org_id text, p_partition_id text, p_reducer_version int)
returns table(server_seq bigint, state jsonb, created_at timestamptz)
language plpgsql security definer set search_path = public stable as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is not null and not public.can_read_partition(p_org_id, p_partition_id, v_actor) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return query
    select s.server_seq, s.state, s.created_at from public.snapshots s
    where s.org_id = p_org_id and s.partition_id = p_partition_id and s.reducer_version = p_reducer_version
    order by s.server_seq desc limit 1;
end $$;

create or replace function public.get_snapshot_meta(p_org_id text, p_partition_id text, p_reducer_version int)
returns table(server_seq bigint, chunks int, bytes int)
language plpgsql security definer set search_path = public stable as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is not null and not public.can_read_partition(p_org_id, p_partition_id, v_actor) then
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
  if v_actor is not null and not public.can_read_partition(p_org_id, p_partition_id, v_actor) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return (
    select substr(s.state::text, p_index * public.snapshot_chunk_chars() + 1, public.snapshot_chunk_chars())
    from public.snapshots s
    where s.org_id = p_org_id and s.partition_id = p_partition_id
      and s.reducer_version = p_reducer_version and s.server_seq = p_server_seq
  );
end $$;
