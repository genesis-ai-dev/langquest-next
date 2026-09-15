-- Gate 1 and gate 3 of the cutover assessment:
--   * append_events refuses batches over 500 events (clients page at 200),
--     so one oversized request can never become a permanent retry loop.
--   * validate_payload mirrors packages/core/src/validate.ts. The log cannot
--     be edited, so a malformed event must be refused at the door.
--   * v1.Redacted is the append-only removal; owners and coordinators only.

create or replace function public.validate_payload(p_type text, p jsonb)
returns text language plpgsql immutable as $$
declare
  c jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'payload must be an object'; end if;

  -- Helper predicates inline: nonempty string, role, string array.
  case p_type
    when 'v1.ProjectCreated' then
      if not (public._is_str(p->'name') and public._is_str(p->'sourceLanguoidId')) then return 'name and sourceLanguoidId must be non-empty strings'; end if;
    when 'v1.ProjectConfigChanged' then
      if jsonb_typeof(p->'config') is distinct from 'object' then return 'config must be an object'; end if;
    when 'v1.MemberAdded', 'v1.MemberRoleChanged' then
      if not public._is_str(p->'profileId') then return 'profileId must be a non-empty string'; end if;
      if not public._is_role(p->>'role') then return 'role must be a role'; end if;
    when 'v1.MemberRemoved' then
      if not public._is_str(p->'profileId') then return 'profileId must be a non-empty string'; end if;
    when 'v1.LaneAdded' then
      if not (public._is_str(p->'laneId') and public._is_str(p->'languoidId')) then return 'laneId and languoidId must be non-empty strings'; end if;
    when 'v1.UnitAdded' then
      if not (public._is_str(p->'unitId') and public._is_str(p->'kind') and public._is_str(p->'label') and public._is_str(p->'order')) then return 'unitId, kind, label, order must be non-empty strings'; end if;
      if jsonb_typeof(p->'parentUnitId') not in ('null', 'string') then return 'parentUnitId must be a string or null'; end if;
    when 'v1.ReferenceAttached' then
      if not (public._is_str(p->'unitId') and public._is_str(p->'refId') and public._is_str(p->'kind')) then return 'unitId, refId, kind must be non-empty strings'; end if;
    when 'v1.RecordingAdded' then
      if not (public._is_str(p->'recordingId') and public._is_str(p->'unitId') and public._is_str(p->'laneId')) then return 'recordingId, unitId, laneId must be non-empty strings'; end if;
      if p->>'kind' not in ('source', 'target') then return 'kind must be source or target'; end if;
      if jsonb_typeof(p->'cards') is distinct from 'array' then return 'cards must be an array'; end if;
      for c in select * from jsonb_array_elements(p->'cards') loop
        if jsonb_typeof(c) <> 'object' or not public._is_str(c->'hash') or jsonb_typeof(c->'durationMs') is distinct from 'number' then
          return 'cards entries need a hash and durationMs';
        end if;
      end loop;
    when 'v1.TakeComposed' then
      if not (public._is_str(p->'takeId') and public._is_str(p->'unitId') and public._is_str(p->'laneId')) then return 'takeId, unitId, laneId must be non-empty strings'; end if;
      if not public._is_str_array(p->'cardHashes') then return 'cardHashes must be a string array'; end if;
      if jsonb_typeof(p->'parentTakeId') not in ('null', 'string') then return 'parentTakeId must be a string or null'; end if;
    when 'v1.TakeArchived', 'v1.TakeSubmitted' then
      if not public._is_str(p->'takeId') then return 'takeId must be a non-empty string'; end if;
    when 'v1.TakeSelected' then
      if not (public._is_str(p->'unitId') and public._is_str(p->'laneId') and public._is_str(p->'takeId')) then return 'unitId, laneId, takeId must be non-empty strings'; end if;
    when 'v1.ReviewSubmitted' then
      if not (public._is_str(p->'takeId') and public._is_str(p->'stepId')) then return 'takeId and stepId must be non-empty strings'; end if;
      if p->>'decision' not in ('approve', 'suggest_changes') then return 'decision must be approve or suggest_changes'; end if;
    when 'v1.AssignmentMade' then
      if not (public._is_str(p->'unitId') and public._is_str(p->'laneId') and public._is_str(p->'profileId')) then return 'unitId, laneId, profileId must be non-empty strings'; end if;
      if not public._is_role(p->>'role') then return 'role must be a role'; end if;
    when 'v1.SourceImported' then
      if not public._is_str(p->'sourceProjectId') then return 'sourceProjectId must be a non-empty string'; end if;
      if jsonb_typeof(p->'sourceSeq') is distinct from 'number' then return 'sourceSeq must be a number'; end if;
      if not public._is_str_array(p->'unitIds') then return 'unitIds must be a string array'; end if;
    when 'v1.BlobStored' then
      if not public._is_str(p->'hash') or jsonb_typeof(p->'size') is distinct from 'number' then return 'hash and size required'; end if;
    when 'v1.Redacted' then
      if not public._is_str(p->'eventId') then return 'eventId must be a non-empty string'; end if;
    else
      -- Unknown type: accepted, so a newer app is not blocked by an older server.
      null;
  end case;
  return null;
end $$;

create or replace function public._is_str(v jsonb) returns boolean language sql immutable as $$
  select v is not null and jsonb_typeof(v) = 'string' and (v #>> '{}') <> '';
$$;
create or replace function public._is_role(v text) returns boolean language sql immutable as $$
  select v in ('owner', 'coordinator', 'translator', 'reviewer', 'viewer');
$$;
create or replace function public._is_str_array(v jsonb) returns boolean language sql immutable as $$
  select v is not null and jsonb_typeof(v) = 'array'
    and not exists (select 1 from jsonb_array_elements(v) x where jsonb_typeof(x) <> 'string');
$$;

create or replace function public.role_may_emit(p_role text, p_type text)
returns boolean language sql immutable as $$
  select case
    when p_type = 'v1.BlobStored' then false
    when p_role in ('owner', 'coordinator') then true
    when p_role = 'translator' then p_type in (
      'v1.RecordingAdded', 'v1.TakeComposed', 'v1.TakeArchived', 'v1.TakeSelected', 'v1.TakeSubmitted',
      'v1.ReferenceAttached')
    when p_role = 'reviewer' then p_type in ('v1.ReviewSubmitted')
    else false
  end;
$$;

create or replace function public.append_events(p_events jsonb)
returns table (id text, accepted boolean, server_seq bigint, reason text)
language plpgsql security definer set search_path = public as $$
declare
  ev jsonb;
  v_actor text := public.caller_id();
  v_org text; v_project text; v_type text; v_id text;
  v_role text; v_seq bigint; v_existing bigint; v_count bigint; v_invalid text;
begin
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events must be a jsonb array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) > 500 then
    raise exception 'batch too large: % events (max 500); page the push', jsonb_array_length(p_events) using errcode = '22023';
  end if;

  for ev in select * from jsonb_array_elements(p_events) loop
    v_id := ev->>'id'; v_org := ev->>'orgId'; v_project := ev->>'projectId'; v_type := ev->>'type';

    if v_id is null or v_org is null or v_project is null or v_type is null or ev->'payload' is null
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

    v_role := public.member_role(v_org, v_project, ev->>'actorId');
    if v_role is null then
      select count(*) into v_count from public.events e
        where e.org_id = v_org and e.project_id = v_project and e.type = 'v1.MemberAdded';
      if not (v_count = 0 and (
        v_type = 'v1.ProjectCreated'
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

    insert into public.partition_cursors (org_id, project_id) values (v_org, v_project)
      on conflict do nothing;
    update public.partition_cursors c set next_seq = c.next_seq + 1
      where c.org_id = v_org and c.project_id = v_project
      returning c.next_seq - 1 into v_seq;

    insert into public.events (id, org_id, project_id, server_seq, type, actor_id, device_id,
                               hlc, parent_event_id, payload)
    values (v_id, v_org, v_project, v_seq, v_type, ev->>'actorId', ev->>'deviceId',
            ev->>'hlc', ev->>'parentEventId', ev->'payload');

    id := v_id; accepted := true; server_seq := v_seq; reason := null;
    return next;
  end loop;
end $$;
