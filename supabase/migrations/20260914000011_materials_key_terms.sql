-- Step 12 (docs/flow-coverage-audit.md 5.E): reference material as
-- per-field registers with scope, lock and template; question sets as
-- materials; key terms as a living glossary. Validation mirrors core
-- validate.ts; privileges mirror core EVENT_PRIVILEGE (a translator may
-- write question sets, fill fields and adjust key terms; defining other
-- material and locking is managed reference).

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
    when 'v1.LaneTemplateSelected' then
      if not (public._is_str(p->'laneId') and public._is_str(p->'templateId')) then return 'laneId and templateId must be non-empty strings'; end if;
      if jsonb_typeof(p->'catalogVersion') is distinct from 'number' then return 'catalogVersion must be a number'; end if;
    when 'v1.LaneFlowSelected' then
      if not (public._is_str(p->'laneId') and public._is_str(p->'flowId')) then return 'laneId and flowId must be non-empty strings'; end if;
      if jsonb_typeof(p->'catalogVersion') is distinct from 'number' then return 'catalogVersion must be a number'; end if;
    when 'v1.WorkflowStepSet' then
      if not (public._is_str(p->'stepId') and public._is_str(p->'order')) then return 'stepId and order must be non-empty strings'; end if;
      if not public._is_role(p->>'role') then return 'role must be a role'; end if;
      if jsonb_typeof(p->'required') is distinct from 'boolean' then return 'required must be a boolean'; end if;
      if p->>'rule' not in ('any', 'majority', 'unanimous') then return 'rule must be any, majority or unanimous'; end if;
    when 'v1.WorkflowStepRemoved' then
      if not public._is_str(p->'stepId') then return 'stepId must be a non-empty string'; end if;
    when 'v1.ReviewTeamDefined' then
      if not (public._is_str(p->'teamId') and public._is_str(p->'laneId') and public._is_str(p->'name')) then return 'teamId, laneId, name must be non-empty strings'; end if;
    when 'v1.ReviewTeamMemberSet' then
      if not (public._is_str(p->'teamId') and public._is_str(p->'profileId')) then return 'teamId and profileId must be non-empty strings'; end if;
      if jsonb_typeof(p->'member') is distinct from 'boolean' then return 'member must be a boolean'; end if;
    when 'v1.ResponseRecorded' then
      if not (public._is_str(p->'takeId') and public._is_str(p->'respondsToTakeId')) then return 'takeId and respondsToTakeId must be non-empty strings'; end if;
    when 'v1.ReviewCommentRecorded' then
      if not (public._is_str(p->'takeId') and public._is_str(p->'stepId') and public._is_str(p->'blobHash')) then return 'takeId, stepId, blobHash must be non-empty strings'; end if;
    when 'v1.MaterialDefined' then
      if not (public._is_str(p->'materialId') and public._is_str(p->'kind') and public._is_str(p->'title')) then return 'materialId, kind, title must be non-empty strings'; end if;
      if jsonb_typeof(p->'scope') is distinct from 'object' then return 'scope must be an object'; end if;
    when 'v1.MaterialFieldSet' then
      if not (public._is_str(p->'materialId') and public._is_str(p->'fieldId')) then return 'materialId and fieldId must be non-empty strings'; end if;
    when 'v1.MaterialLocked' then
      if not public._is_str(p->'materialId') then return 'materialId must be a non-empty string'; end if;
      if jsonb_typeof(p->'locked') is distinct from 'boolean' then return 'locked must be a boolean'; end if;
    when 'v1.StepQuestionSetLinked' then
      if not (public._is_str(p->'stepId') and public._is_str(p->'materialId')) then return 'stepId and materialId must be non-empty strings'; end if;
    when 'v1.KeyTermDefined' then
      if not (public._is_str(p->'termId') and public._is_str(p->'laneId') and public._is_str(p->'term')) then return 'termId, laneId, term must be non-empty strings'; end if;
      if jsonb_typeof(p->'gloss') is distinct from 'string' then return 'gloss must be a string'; end if;
      if not public._is_str_array(p->'unitScope') then return 'unitScope must be a string array'; end if;
    when 'v1.KeyTermRenderingAdded' then
      if not (public._is_str(p->'termId') and public._is_str(p->'renderingId') and public._is_str(p->'rendering')) then return 'termId, renderingId, rendering must be non-empty strings'; end if;
      if jsonb_typeof(p->'context') is distinct from 'string' then return 'context must be a string'; end if;
    when 'v1.KeyTermAdjusted' then
      if not (public._is_str(p->'termId') and public._is_str(p->'adjustmentId')) then return 'termId and adjustmentId must be non-empty strings'; end if;
      if jsonb_typeof(p->'note') is distinct from 'string' then return 'note must be a string'; end if;
    when 'v1.KeyTermLinked' then
      if not (public._is_str(p->'takeId') and public._is_str(p->'termId')) then return 'takeId and termId must be non-empty strings'; end if;
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
    when 'v1.LaneTemplateSelected' then 'manage_templates'
    when 'v1.LaneFlowSelected' then 'manage_flows'
    when 'v1.WorkflowStepSet' then 'manage_flows'
    when 'v1.WorkflowStepRemoved' then 'manage_flows'
    when 'v1.ReviewTeamDefined' then 'manage_teams'
    when 'v1.ReviewTeamMemberSet' then 'manage_teams'
    when 'v1.ResponseRecorded' then 'translate'
    when 'v1.ReviewCommentRecorded' then 'review'
    when 'v1.MaterialDefined' then case when p->>'kind' = 'questions' then 'fill_reference' else 'manage_reference' end
    when 'v1.MaterialFieldSet' then 'fill_reference'
    when 'v1.MaterialLocked' then 'manage_reference'
    when 'v1.StepQuestionSetLinked' then 'manage_flows'
    when 'v1.KeyTermDefined' then 'fill_reference'
    when 'v1.KeyTermRenderingAdded' then 'fill_reference'
    when 'v1.KeyTermAdjusted' then 'fill_reference'
    when 'v1.KeyTermLinked' then 'fill_reference'
    when 'v1.OrgCreated' then 'bootstrap'
    when 'v1.RoleDefined' then 'manage_roles'
    when 'v1.RoleRetired' then 'manage_roles'
    when 'v1.OrgMemberAdded' then 'invite_members'
    when 'v1.OrgMemberRemoved' then 'invite_members'
    when 'v1.CatalogItemToggled' then case p->>'kind'
      when 'reference' then 'manage_reference' when 'flow' then 'manage_flows' else 'manage_templates' end
    when 'v1.PartitionRegistered' then 'manage_structure'
    else null
  end;
$$;

create or replace function public.role_may_emit(p_role text, p_type text)
returns boolean language sql immutable as $$
  select case
    when p_type in ('v1.BlobStored', 'v1.BlobInvalidated') then false
    when p_role in ('owner', 'coordinator') then true
    when p_role = 'translator' then p_type in (
      'v1.RecordingAdded', 'v1.TakeComposed', 'v1.TakeArchived', 'v1.TakeSelected', 'v1.TakeSubmitted',
      'v1.ReferenceAttached', 'v1.ResponseRecorded', 'v1.MaterialDefined', 'v1.MaterialFieldSet',
      'v1.KeyTermDefined', 'v1.KeyTermRenderingAdded', 'v1.KeyTermAdjusted', 'v1.KeyTermLinked')
    when p_role = 'reviewer' then p_type in ('v1.ReviewSubmitted', 'v1.ReviewCommentRecorded')
    else false
  end;
$$;

-- One privilege table for both paths. The fixed roles are the seed roles
-- (core SEED_ROLES); a fixed-role member may emit an event iff the event's
-- privilege (payload included: MaterialDefined by kind) is in that set.
create or replace function public.fixed_role_privileges(p_role text)
returns text[] language sql immutable as $$
  select case p_role
    when 'owner' then array['manage_structure','invite_members','manage_roles','manage_templates','manage_reference','manage_flows','manage_teams','assign_work','translate','fill_reference','send_to_reviewers','review','view_status']
    when 'coordinator' then array['manage_structure','invite_members','manage_templates','manage_reference','manage_flows','manage_teams','assign_work','translate','fill_reference','send_to_reviewers','review','view_status']
    when 'translator' then array['translate','fill_reference','send_to_reviewers','view_status']
    when 'reviewer' then array['review','view_status']
    when 'viewer' then array['view_status']
    else '{}'::text[]
  end;
$$;

create or replace function public.role_may_emit_event(p_role text, p_type text, p jsonb)
returns boolean language sql immutable as $$
  select coalesce(public.event_privilege(p_type, p) = any(public.fixed_role_privileges(p_role)), false);
$$;

create or replace function public.may_emit(p_org text, p_partition text, p_profile text, p_type text, p jsonb)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_priv text := public.event_privilege(p_type, p);
  v_role text;
begin
  if v_priv is null then return false; end if;
  if v_priv = 'bootstrap' then return false; end if;
  if p_partition <> '_org' then
    select case when m.removed then null else m.role end into v_role
      from public.memberships m
      where m.org_id = p_org and m.partition_id = p_partition and m.profile_id = p_profile;
    if v_role is not null and public.role_may_emit_event(v_role, p_type, p) then return true; end if;
  end if;
  return v_priv = any(public.org_privileges(p_org, p_profile, p_partition, p->>'laneId'));
end $$;

-- The as-of path (membership at the event's clock) uses the same table.
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

    v_ok := public.may_emit(v_org, v_partition, ev->>'actorId', v_type, ev->'payload');
    if not v_ok and v_partition <> '_org' and v_wall_ms >= v_now_ms - v_cfg.asof_window_ms then
      v_role := public.member_role_at(v_org, v_partition, ev->>'actorId', v_hlc);
      v_ok := v_role is not null and public.role_may_emit_event(v_role, v_type, ev->'payload');
    end if;
    if not v_ok then
      if v_partition = '_org' then
        select count(*) into v_count from public.events e
          where e.org_id = v_org and e.partition_id = '_org' and e.type = 'v1.OrgMemberAdded';
        v_ok := v_count = 0 and (
          v_type = 'v1.OrgCreated' or v_type = 'v1.RoleDefined'
          or (v_type = 'v1.OrgMemberAdded' and ev->'payload'->>'profileId' = ev->>'actorId'));
      else
        select count(*) into v_count from public.events e
          where e.org_id = v_org and e.partition_id = v_partition and e.type = 'v1.MemberAdded';
        v_ok := v_count = 0
          and cardinality(public.org_privileges(v_org, ev->>'actorId', v_partition, null)) = 0
          and not exists (select 1 from public.org_memberships m where m.org_id = v_org and not m.removed)
          and (v_type = 'v1.PartitionCreated'
            or (v_type = 'v1.MemberAdded' and ev->'payload'->>'profileId' = ev->>'actorId'));
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

grant execute on function public.append_events(jsonb, int) to authenticated;
