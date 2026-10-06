-- Step 11 (docs/flow-coverage-audit.md 5.D, 5.F): catalog selection per
-- lane, per-step workflow registers, review teams, the respond loop and
-- spoken review comments. Validation mirrors packages/core/src/validate.ts;
-- privileges mirror core EVENT_PRIVILEGE; the fixed-role gate gains the two
-- work events (translator responds, reviewer comments).

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
      'v1.ReferenceAttached', 'v1.ResponseRecorded')
    when p_role = 'reviewer' then p_type in ('v1.ReviewSubmitted', 'v1.ReviewCommentRecorded')
    else false
  end;
$$;
