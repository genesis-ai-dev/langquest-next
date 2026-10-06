-- Gate 5: the server can refuse clients that are too old to read the log
-- correctly. Clients send CLIENT_PROTOCOL_VERSION (packages/core/src/version.ts)
-- with every append and pull; below `min_client_version` they get LQ001 and
-- the app shows an upgrade message instead of silently folding stale state.
-- Raise the minimum with a one-line migration when an event change makes
-- older clients unsafe.

create table public.server_config (
  one boolean primary key default true check (one),
  min_client_version int not null default 1
);
insert into public.server_config default values;
alter table public.server_config enable row level security;

create or replace function public.require_client_version(p_client_version int)
returns void language plpgsql stable as $$
declare v_min int;
begin
  select min_client_version into v_min from public.server_config;
  if coalesce(p_client_version, 0) < v_min then
    raise exception 'client protocol version % is below the minimum %; please upgrade the app', p_client_version, v_min
      using errcode = 'LQ001';
  end if;
end $$;

-- Replace the RPCs with versions that take the client version. The old
-- signatures are dropped so PostgREST has exactly one candidate.
drop function if exists public.append_events(jsonb);
drop function if exists public.pull_events(text, text, bigint, int);

create or replace function public.append_events(p_events jsonb, p_client_version int default 0)
returns table (id text, accepted boolean, server_seq bigint, reason text)
language plpgsql security definer set search_path = public as $$
declare
  ev jsonb;
  v_actor text := public.caller_id();
  v_org text; v_partition text; v_type text; v_id text;
  v_role text; v_seq bigint; v_existing bigint; v_count bigint; v_invalid text;
begin
  perform public.require_client_version(p_client_version);
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events must be a jsonb array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) > 500 then
    raise exception 'batch too large: % events (max 500); page the push', jsonb_array_length(p_events) using errcode = '22023';
  end if;

  for ev in select * from jsonb_array_elements(p_events) loop
    v_id := ev->>'id'; v_org := ev->>'orgId'; v_partition := ev->>'partitionId'; v_type := ev->>'type';

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

    v_role := public.member_role(v_org, v_partition, ev->>'actorId');
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
            ev->>'hlc', ev->>'parentEventId', ev->'payload');

    id := v_id; accepted := true; server_seq := v_seq; reason := null;
    return next;
  end loop;
end $$;

create or replace function public.pull_events(
  p_org_id text, p_partition_id text, p_after bigint default 0, p_limit int default 500, p_client_version int default 0
) returns setof public.events
language plpgsql security definer set search_path = public stable as $$
declare
  v_actor text := public.caller_id();
begin
  perform public.require_client_version(p_client_version);
  if v_actor is not null and public.member_role(p_org_id, p_partition_id, v_actor) is null
     and exists (select 1 from public.events e where e.org_id = p_org_id and e.partition_id = p_partition_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return query
    select * from public.events e
    where e.org_id = p_org_id and e.partition_id = p_partition_id and e.server_seq > p_after
    order by e.server_seq
    limit least(greatest(p_limit, 1), 1000);
end $$;

grant execute on function public.append_events(jsonb, int) to authenticated;
grant execute on function public.pull_events(text, text, bigint, int, int) to authenticated;
