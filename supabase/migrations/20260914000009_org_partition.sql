-- Org partition and privilege roles (docs/flow-coverage-audit.md 5.A, 5.C;
-- packages/core/src/org.ts is the client twin of everything here).
--
-- One extra partition per org, partition_id = '_org', in the same events
-- table. Its fold is kept as two rows tables by append_events, the one
-- fold allowed on the write path (invariant 9): org_roles (privilege sets)
-- and org_memberships (who holds which role at which scope). Authorization
-- for any partition is then: the partition's own membership row, or an org
-- membership whose scope covers the partition and whose role holds the
-- privilege the event type needs (event_privilege, same table as core's
-- EVENT_PRIVILEGE). effective_role maps privileges back onto the fixed role
-- set so storage policies and workflow steps keep working unchanged.

create table if not exists public.org_roles (
  org_id text not null,
  role_id text not null,
  name text not null default '',
  privileges text[] not null default '{}',
  retired boolean not null default false,
  hlc text not null default '',
  primary key (org_id, role_id)
);
alter table public.org_roles enable row level security;

create table if not exists public.org_memberships (
  org_id text not null,
  profile_id text not null,
  scope_key text not null,
  scope_level text not null,
  partition_id text,
  lane_id text,
  role_id text,
  removed boolean not null default false,
  role_hlc text not null default '',
  removed_hlc text not null default '',
  primary key (org_id, profile_id, scope_key)
);
create index if not exists org_memberships_profile_idx on public.org_memberships (org_id, profile_id) where not removed;
alter table public.org_memberships enable row level security;

create or replace function public._is_privilege_array(v jsonb) returns boolean language sql immutable as $$
  select v is not null and jsonb_typeof(v) = 'array'
    and not exists (
      select 1 from jsonb_array_elements(v) x
      where jsonb_typeof(x) <> 'string' or (x #>> '{}') not in (
        'manage_structure','invite_members','manage_roles','manage_templates','manage_reference',
        'manage_flows','manage_teams','assign_work','translate','fill_reference','send_to_reviewers','review','view_status'));
$$;

create or replace function public._scope_error(v jsonb) returns text language sql immutable as $$
  select case
    when v is null or jsonb_typeof(v) <> 'object' then 'scope must be an object'
    when v->>'level' = 'org' then null
    when not public._is_str(v->'partitionId') then 'scope.partitionId required'
    when v->>'level' = 'partition' then null
    when v->>'level' = 'lane' then case when public._is_str(v->'laneId') then null else 'scope.laneId required' end
    else 'scope.level must be org, partition or lane'
  end;
$$;

create or replace function public._scope_key(v jsonb) returns text language sql immutable as $$
  select case v->>'level'
    when 'org' then 'org'
    when 'partition' then 'partition:' || (v->>'partitionId')
    else 'lane:' || (v->>'partitionId') || '/' || (v->>'laneId')
  end;
$$;

create or replace function public.validate_payload(p_type text, p jsonb)
returns text language plpgsql immutable as $$
declare c jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'payload must be an object'; end if;
  case p_type
    when 'v1.PartitionCreated' then
      if not (public._is_str(p->'name') and public._is_str(p->'sourceLanguoidId')) then return 'name and sourceLanguoidId must be non-empty strings'; end if;
    when 'v1.PartitionConfigChanged' then
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
      if not public._is_str(p->'sourcePartitionId') then return 'sourcePartitionId must be a non-empty string'; end if;
      if jsonb_typeof(p->'sourceSeq') is distinct from 'number' then return 'sourceSeq must be a number'; end if;
      if not public._is_str_array(p->'unitIds') then return 'unitIds must be a string array'; end if;
    when 'v1.BlobStored' then
      if not public._is_str(p->'hash') or jsonb_typeof(p->'size') is distinct from 'number' then return 'hash and size required'; end if;
    when 'v1.BlobInvalidated' then
      if not public._is_str(p->'hash') then return 'hash must be a non-empty string'; end if;
    when 'v1.Redacted' then
      if not public._is_str(p->'eventId') then return 'eventId must be a non-empty string'; end if;
    when 'v1.OrgCreated' then
      if not public._is_str(p->'name') then return 'name must be a non-empty string'; end if;
    when 'v1.RoleDefined' then
      if not (public._is_str(p->'roleId') and public._is_str(p->'name')) then return 'roleId and name must be non-empty strings'; end if;
      if not public._is_privilege_array(p->'privileges') then return 'privileges must be an array of known privileges'; end if;
    when 'v1.RoleRetired' then
      if not public._is_str(p->'roleId') then return 'roleId must be a non-empty string'; end if;
    when 'v1.OrgMemberAdded' then
      if not (public._is_str(p->'profileId') and public._is_str(p->'roleId')) then return 'profileId and roleId must be non-empty strings'; end if;
      if public._scope_error(p->'scope') is not null then return public._scope_error(p->'scope'); end if;
    when 'v1.OrgMemberRemoved' then
      if not public._is_str(p->'profileId') then return 'profileId must be a non-empty string'; end if;
      if public._scope_error(p->'scope') is not null then return public._scope_error(p->'scope'); end if;
    when 'v1.CatalogItemToggled' then
      if not public._is_str(p->'itemId') then return 'itemId must be a non-empty string'; end if;
      if p->>'kind' not in ('template', 'reference', 'flow') then return 'kind must be template, reference or flow'; end if;
      if p->>'level' not in ('org', 'partition') then return 'level must be org or partition'; end if;
      if p->>'level' = 'partition' and not public._is_str(p->'partitionId') then return 'partitionId required at partition level'; end if;
      if jsonb_typeof(p->'enabled') is distinct from 'boolean' then return 'enabled must be a boolean'; end if;
    when 'v1.PartitionRegistered' then
      if not (public._is_str(p->'partitionId') and public._is_str(p->'name')) then return 'partitionId and name must be non-empty strings'; end if;
    else null;
  end case;
  return null;
end $$;

-- Fold one org event into the rows. Registers last-writer-wins by HLC,
-- retired is add-wins, exactly as core's applyOrgEvent.
create or replace function public._apply_org_event(p_org text, p_type text, p jsonb, p_hlc text)
returns void language plpgsql as $$
declare v_key text;
begin
  if p_type = 'v1.RoleDefined' then
    insert into public.org_roles (org_id, role_id, name, privileges, hlc)
    values (p_org, p->>'roleId', p->>'name', array(select jsonb_array_elements_text(p->'privileges')), p_hlc)
    on conflict (org_id, role_id) do update
      set name = excluded.name, privileges = excluded.privileges, hlc = excluded.hlc
      where org_roles.hlc < excluded.hlc;
  elsif p_type = 'v1.RoleRetired' then
    insert into public.org_roles (org_id, role_id, retired) values (p_org, p->>'roleId', true)
    on conflict (org_id, role_id) do update set retired = true;
  elsif p_type in ('v1.OrgMemberAdded', 'v1.OrgMemberRemoved') then
    v_key := public._scope_key(p->'scope');
    insert into public.org_memberships (org_id, profile_id, scope_key, scope_level, partition_id, lane_id)
    values (p_org, p->>'profileId', v_key, p->'scope'->>'level', p->'scope'->>'partitionId', p->'scope'->>'laneId')
    on conflict do nothing;
    if p_type = 'v1.OrgMemberAdded' then
      update public.org_memberships m set role_id = p->>'roleId', role_hlc = p_hlc
        where m.org_id = p_org and m.profile_id = p->>'profileId' and m.scope_key = v_key and m.role_hlc < p_hlc;
      update public.org_memberships m set removed = false, removed_hlc = p_hlc
        where m.org_id = p_org and m.profile_id = p->>'profileId' and m.scope_key = v_key and m.removed_hlc < p_hlc;
    else
      update public.org_memberships m set removed = true, removed_hlc = p_hlc
        where m.org_id = p_org and m.profile_id = p->>'profileId' and m.scope_key = v_key and m.removed_hlc < p_hlc;
    end if;
  end if;
end $$;

-- Backfill any org events already in the log.
do $$ declare e record; begin
  for e in select org_id, type, payload, hlc from public.events
           where partition_id = '_org' and type in ('v1.RoleDefined','v1.RoleRetired','v1.OrgMemberAdded','v1.OrgMemberRemoved')
           order by hlc loop
    perform public._apply_org_event(e.org_id, e.type, e.payload, e.hlc);
  end loop;
end $$;

-- core EVENT_PRIVILEGE. 'bootstrap' and null are handled by the caller.
create or replace function public.event_privilege(p_type text, p jsonb)
returns text language sql immutable as $$
  select case p_type
    when 'v1.PartitionCreated' then 'bootstrap'
    when 'v1.PartitionConfigChanged' then 'manage_structure'
    when 'v1.MemberAdded' then 'invite_members'
    when 'v1.MemberRoleChanged' then 'invite_members'
    when 'v1.MemberRemoved' then 'invite_members'
    when 'v1.LaneAdded' then 'manage_structure'
    when 'v1.UnitAdded' then 'manage_templates'
    when 'v1.ReferenceAttached' then 'fill_reference'
    when 'v1.RecordingAdded' then 'translate'
    when 'v1.TakeComposed' then 'translate'
    when 'v1.TakeArchived' then 'translate'
    when 'v1.TakeSelected' then 'translate'
    when 'v1.TakeSubmitted' then 'translate'
    when 'v1.ReviewSubmitted' then 'review'
    when 'v1.AssignmentMade' then 'assign_work'
    when 'v1.SourceImported' then 'manage_structure'
    when 'v1.Redacted' then 'manage_structure'
    when 'v1.OrgCreated' then 'bootstrap'
    when 'v1.RoleDefined' then 'manage_roles'
    when 'v1.RoleRetired' then 'manage_roles'
    when 'v1.OrgMemberAdded' then 'invite_members'
    when 'v1.OrgMemberRemoved' then 'invite_members'
    when 'v1.CatalogItemToggled' then case p->>'kind'
      when 'reference' then 'manage_reference' when 'flow' then 'manage_flows' else 'manage_templates' end
    when 'v1.PartitionRegistered' then 'manage_structure'
    else null  -- server-only (BlobStored, BlobInvalidated) or unknown
  end;
$$;

-- Privileges a profile holds over a partition (and lane, when the event names
-- one): union over live memberships whose scope covers it, through roles
-- that are not retired. core privilegesFor.
create or replace function public.org_privileges(p_org text, p_profile text, p_partition text, p_lane text)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct priv), '{}')
  from public.org_memberships m
  join public.org_roles r on r.org_id = m.org_id and r.role_id = m.role_id and not r.retired
  cross join lateral unnest(r.privileges) as priv
  where m.org_id = p_org and m.profile_id = p_profile and not m.removed
    and (m.scope_level = 'org'
      or (m.scope_level = 'partition' and m.partition_id = p_partition)
      or (m.scope_level = 'lane' and m.partition_id = p_partition and (p_lane is null or m.lane_id = p_lane)));
$$;

-- core effectiveRole.
create or replace function public.effective_role_of(p_privs text[])
returns text language sql immutable as $$
  select case
    when 'manage_roles' = any(p_privs) then 'owner'
    when 'assign_work' = any(p_privs) then 'coordinator'
    when 'translate' = any(p_privs) then 'translator'
    when 'review' = any(p_privs) then 'reviewer'
    when 'view_status' = any(p_privs) then 'viewer'
    else null
  end;
$$;

-- Same signature the storage policies and pull_events already call: the
-- partition's own role if any, else the role the org privileges amount to.
create or replace function public.member_role(
  p_org_id text, p_partition_id text, p_profile_id text
) returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when m.removed then null else m.role end
       from public.memberships m
       where m.org_id = p_org_id and m.partition_id = p_partition_id and m.profile_id = p_profile_id),
    public.effective_role_of(public.org_privileges(p_org_id, p_profile_id, p_partition_id, null)));
$$;

-- May this profile emit this event into this partition? The whole
-- authorization rule in one place; append_events only adds the as-of
-- fallback and the bootstrap exceptions around it.
create or replace function public.may_emit(p_org text, p_partition text, p_profile text, p_type text, p jsonb)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_priv text := public.event_privilege(p_type, p);
  v_role text;
begin
  if v_priv is null then return false; end if;             -- server-only
  if v_priv = 'bootstrap' then return false; end if;       -- caller handles
  if p_partition <> '_org' then
    select case when m.removed then null else m.role end into v_role
      from public.memberships m
      where m.org_id = p_org and m.partition_id = p_partition and m.profile_id = p_profile;
    if v_role is not null and public.role_may_emit(v_role, p_type) then return true; end if;
  end if;
  return v_priv = any(public.org_privileges(p_org, p_profile, p_partition, p->>'laneId'));
end $$;

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
  v_ok boolean;
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

    -- Authorization: privileges now; else as of the event's clock within the
    -- window (partition membership only; org roles are small and rarely
    -- change); else the bootstrap exceptions.
    v_ok := public.may_emit(v_org, v_partition, ev->>'actorId', v_type, ev->'payload');
    if not v_ok and v_partition <> '_org' and v_wall_ms >= v_now_ms - v_cfg.asof_window_ms then
      v_role := public.member_role_at(v_org, v_partition, ev->>'actorId', v_hlc);
      v_ok := v_role is not null and public.role_may_emit(v_role, v_type);
    end if;
    if not v_ok then
      if v_partition = '_org' then
        -- An org with no members accepts OrgCreated and the creator's own admin membership.
        select count(*) into v_count from public.events e
          where e.org_id = v_org and e.partition_id = '_org' and e.type = 'v1.OrgMemberAdded';
        v_ok := v_count = 0 and (
          v_type = 'v1.OrgCreated' or v_type = 'v1.RoleDefined'
          or (v_type = 'v1.OrgMemberAdded' and ev->'payload'->>'profileId' = ev->>'actorId'));
      else
        -- A partition with no members accepts PartitionCreated and the creator
        -- adding themselves, unless the org already governs it.
        select count(*) into v_count from public.events e
          where e.org_id = v_org and e.partition_id = v_partition and e.type = 'v1.MemberAdded';
        v_ok := v_count = 0
          and cardinality(public.org_privileges(v_org, ev->>'actorId', v_partition, null)) = 0
          and not exists (select 1 from public.org_memberships m where m.org_id = v_org and not m.removed)
          and (v_type = 'v1.PartitionCreated'
            or (v_type = 'v1.MemberAdded' and ev->'payload'->>'profileId' = ev->>'actorId'));
        -- An org member with manage_structure may create a partition under the org.
        if not v_ok and v_count = 0 and v_type in ('v1.PartitionCreated', 'v1.MemberAdded')
           and 'manage_structure' = any(public.org_privileges(v_org, ev->>'actorId', v_partition, null)) then
          v_ok := true;
        end if;
      end if;
      if not v_ok then
        id := v_id; accepted := false; server_seq := null;
        reason := case
          when public.member_role(v_org, v_partition, ev->>'actorId') is null
            and cardinality(public.org_privileges(v_org, ev->>'actorId', v_partition, null)) = 0 then 'not a member'
          else format('role %s may not emit %s', coalesce(public.member_role(v_org, v_partition, ev->>'actorId'), 'member'), v_type)
        end;
        return next; continue;
      end if;
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
    elsif v_partition = '_org' then
      perform public._apply_org_event(v_org, v_type, ev->'payload', v_hlc);
    end if;

    id := v_id; accepted := true; server_seq := v_seq; reason := null;
    return next;
  end loop;
end $$;

-- Pull: the org partition is readable by anyone with a live org membership;
-- a partition by its members or by org members whose scope covers it
-- (member_role now folds both).
create or replace function public.pull_events(
  p_org_id text, p_partition_id text, p_after bigint default 0, p_limit int default 500, p_client_version int default 0
) returns setof public.events
language plpgsql security definer set search_path = public stable as $$
declare
  v_actor text := public.caller_id();
  v_ok boolean;
begin
  perform public.require_client_version(p_client_version);
  if v_actor is not null then
    if p_partition_id = '_org' then
      v_ok := exists (select 1 from public.org_memberships m where m.org_id = p_org_id and m.profile_id = v_actor and not m.removed);
    else
      v_ok := public.member_role(p_org_id, p_partition_id, v_actor) is not null;
    end if;
    if not v_ok and exists (select 1 from public.events e where e.org_id = p_org_id and e.partition_id = p_partition_id) then
      raise exception 'not a member' using errcode = '42501';
    end if;
  end if;
  return query
    select * from public.events e
    where e.org_id = p_org_id and e.partition_id = p_partition_id and e.server_seq > p_after
    order by e.server_seq
    limit least(greatest(p_limit, 1), 1000);
end $$;

grant execute on function public.append_events(jsonb, int) to authenticated;
grant execute on function public.pull_events(text, text, bigint, int, int) to authenticated;
