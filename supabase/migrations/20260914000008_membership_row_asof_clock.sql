-- Audit L1, L2, L10 (docs/flow-coverage-audit.md).
--
-- 1. memberships: the one fold allowed on the write path, kept as a row by
--    append_events in the same transaction as the member event it comes
--    from. Authorization is a primary-key read instead of a scan of every
--    member event for the profile. Backfilled from the log below, and
--    always derivable from it.
-- 2. As-of authorization: an event is accepted if its actor held a role
--    that may emit it either now or at the event's own clock, within a
--    bounded window. A translator removed during a month offline still gets
--    that month's work in; a stolen old token cannot write into the past
--    forever.
-- 3. Clock-ahead refusal: an event stamped more than five minutes ahead of
--    server time is refused with a reason carrying server time, so the
--    device re-stamps instead of winning every register for years.

create table if not exists public.memberships (
  org_id text not null,
  partition_id text not null,
  profile_id text not null,
  role text,
  removed boolean not null default false,
  role_hlc text not null default '',
  removed_hlc text not null default '',
  primary key (org_id, partition_id, profile_id)
);
alter table public.memberships enable row level security;

-- Fold one member event into the row. Two independent registers (role,
-- removed), each last-writer-wins by HLC, exactly like packages/core.
create or replace function public._apply_member_event(
  p_org text, p_partition text, p_type text, p_payload jsonb, p_hlc text
) returns void language plpgsql as $$
declare v_profile text := p_payload->>'profileId';
begin
  if v_profile is null then return; end if;
  insert into public.memberships (org_id, partition_id, profile_id) values (p_org, p_partition, v_profile)
    on conflict do nothing;
  if p_type in ('v1.MemberAdded', 'v1.MemberRoleChanged') then
    update public.memberships m set role = p_payload->>'role', role_hlc = p_hlc
      where m.org_id = p_org and m.partition_id = p_partition and m.profile_id = v_profile and m.role_hlc < p_hlc;
  end if;
  if p_type = 'v1.MemberAdded' then
    update public.memberships m set removed = false, removed_hlc = p_hlc
      where m.org_id = p_org and m.partition_id = p_partition and m.profile_id = v_profile and m.removed_hlc < p_hlc;
  elsif p_type = 'v1.MemberRemoved' then
    update public.memberships m set removed = true, removed_hlc = p_hlc
      where m.org_id = p_org and m.partition_id = p_partition and m.profile_id = v_profile and m.removed_hlc < p_hlc;
  end if;
end $$;

-- Backfill from the log, oldest first, so the rows equal the fold.
do $$ declare e record; begin
  for e in select org_id, partition_id, type, payload, hlc from public.events
           where type in ('v1.MemberAdded', 'v1.MemberRoleChanged', 'v1.MemberRemoved')
           order by hlc loop
    perform public._apply_member_event(e.org_id, e.partition_id, e.type, e.payload, e.hlc);
  end loop;
end $$;

-- Same signature as before (storage policies call it); now one row read.
create or replace function public.member_role(
  p_org_id text, p_partition_id text, p_profile_id text
) returns text language sql stable security definer set search_path = public as $$
  select case when m.removed then null else m.role end
  from public.memberships m
  where m.org_id = p_org_id and m.partition_id = p_partition_id and m.profile_id = p_profile_id;
$$;

-- The role the profile held at a given clock: folds only that profile's
-- member events up to p_at. Only consulted on the rejection path.
create or replace function public.member_role_at(
  p_org_id text, p_partition_id text, p_profile_id text, p_at text
) returns text language sql stable security definer set search_path = public as $$
  with role_events as (
    select payload->>'role' as role, hlc from public.events
    where org_id = p_org_id and partition_id = p_partition_id
      and type in ('v1.MemberAdded', 'v1.MemberRoleChanged')
      and payload->>'profileId' = p_profile_id and hlc <= p_at
  ),
  removed_events as (
    select (type = 'v1.MemberRemoved') as removed, hlc from public.events
    where org_id = p_org_id and partition_id = p_partition_id
      and type in ('v1.MemberAdded', 'v1.MemberRemoved')
      and payload->>'profileId' = p_profile_id and hlc <= p_at
  )
  select case
    when (select removed from removed_events order by hlc desc limit 1) then null
    else (select role from role_events order by hlc desc limit 1)
  end;
$$;

create index if not exists events_member_profile_idx
  on public.events (org_id, partition_id, (payload->>'profileId'), hlc)
  where type in ('v1.MemberAdded', 'v1.MemberRoleChanged', 'v1.MemberRemoved');

-- Server-side knobs. Kept in server_config so a migration can tune them.
alter table public.server_config
  add column if not exists clock_ahead_tolerance_ms bigint not null default 300000,
  add column if not exists asof_window_ms bigint not null default 7776000000; -- 90 days

create or replace function public.append_events(p_events jsonb, p_client_version int default 0)
returns table (id text, accepted boolean, server_seq bigint, reason text)
language plpgsql security definer set search_path = public as $$
declare
  ev jsonb;
  v_actor text := public.caller_id();
  v_org text; v_partition text; v_type text; v_id text; v_hlc text;
  v_role text; v_seq bigint; v_existing bigint; v_count bigint; v_invalid text;
  v_now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_wall_ms bigint;
  v_cfg record;
begin
  perform public.require_client_version(p_client_version);
  select clock_ahead_tolerance_ms, asof_window_ms into v_cfg from public.server_config;
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events must be a jsonb array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) > 500 then
    raise exception 'batch too large: % events (max 500); page the push', jsonb_array_length(p_events) using errcode = '22023';
  end if;

  for ev in select * from jsonb_array_elements(p_events) loop
    v_id := ev->>'id'; v_org := ev->>'orgId'; v_partition := ev->>'partitionId'; v_type := ev->>'type'; v_hlc := ev->>'hlc';

    if v_id is null or v_org is null or v_partition is null or v_type is null or ev->'payload' is null
       or not public._is_str(ev->'hlc') or not public._is_str(ev->'deviceId') or not public._is_str(ev->'actorId') then
      id := v_id; accepted := false; server_seq := null; reason := 'malformed envelope';
      return next; continue;
    end if;

    if v_actor is not null and ev->>'actorId' <> v_actor then
      id := v_id; accepted := false; server_seq := null; reason := 'actorId does not match caller';
      return next; continue;
    end if;

    select e.server_seq into v_existing from public.events e where e.id = v_id;
    if found then
      id := v_id; accepted := true; server_seq := v_existing; reason := 'duplicate';
      return next; continue;
    end if;

    -- Clock sanity (L2). The wall part of the HLC is the first 15 digits.
    v_wall_ms := nullif(regexp_replace(split_part(v_hlc, ':', 1), '\D', '', 'g'), '')::bigint;
    if v_wall_ms is null then
      id := v_id; accepted := false; server_seq := null; reason := 'malformed envelope';
      return next; continue;
    end if;
    if v_wall_ms > v_now_ms + v_cfg.clock_ahead_tolerance_ms then
      id := v_id; accepted := false; server_seq := null;
      reason := format('clock ahead: server time %s', v_now_ms);
      return next; continue;
    end if;

    -- Authorization: current membership, else membership as of the event's
    -- own clock within the window (L1), else the bootstrap exception.
    v_role := public.member_role(v_org, v_partition, ev->>'actorId');
    if v_role is null or not public.role_may_emit(v_role, v_type) then
      if v_wall_ms >= v_now_ms - v_cfg.asof_window_ms then
        v_role := public.member_role_at(v_org, v_partition, ev->>'actorId', v_hlc);
      end if;
    end if;
    if v_role is null then
      select count(*) into v_count from public.events e
        where e.org_id = v_org and e.partition_id = v_partition and e.type = 'v1.MemberAdded';
      if not (v_count = 0 and (
        v_type = 'v1.PartitionCreated'
        or (v_type = 'v1.MemberAdded' and ev->'payload'->>'profileId' = ev->>'actorId')
      )) then
        id := v_id; accepted := false; server_seq := null; reason := 'not a member';
        return next; continue;
      end if;
    elsif not public.role_may_emit(v_role, v_type) then
      id := v_id; accepted := false; server_seq := null;
      reason := format('role %s may not emit %s', v_role, v_type);
      return next; continue;
    end if;

    v_invalid := public.validate_payload(v_type, ev->'payload');
    if v_invalid is not null then
      id := v_id; accepted := false; server_seq := null; reason := 'invalid payload: ' || v_invalid;
      return next; continue;
    end if;

    insert into public.partition_cursors (org_id, partition_id) values (v_org, v_partition)
      on conflict do nothing;
    update public.partition_cursors c set next_seq = c.next_seq + 1
      where c.org_id = v_org and c.partition_id = v_partition
      returning c.next_seq - 1 into v_seq;

    insert into public.events (id, org_id, partition_id, server_seq, type, actor_id, device_id,
                               hlc, parent_event_id, payload)
    values (v_id, v_org, v_partition, v_seq, v_type, ev->>'actorId', ev->>'deviceId',
            v_hlc, ev->>'parentEventId', ev->'payload');

    if v_type in ('v1.MemberAdded', 'v1.MemberRoleChanged', 'v1.MemberRemoved') then
      perform public._apply_member_event(v_org, v_partition, v_type, ev->'payload', v_hlc);
    end if;

    id := v_id; accepted := true; server_seq := v_seq; reason := null;
    return next;
  end loop;
end $$;

grant execute on function public.append_events(jsonb, int) to authenticated;
