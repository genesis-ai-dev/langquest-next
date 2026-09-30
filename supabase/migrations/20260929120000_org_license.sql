-- The organization's license (docs/licensing.md; docs/decisions.md 38).
-- packages/core license.ts and the v1.OrgLicenseSet cases of org.ts and
-- validate.ts are the client twins of everything here.
--
-- One new org-partition event, v1.OrgLicenseSet {license}, which only
-- Organization Admin (manage_roles at org scope) may emit. The fold keeps
-- the most open license ever set, so the server never has to refuse a
-- "closing" event: it is accepted and changes nothing, exactly as on every
-- phone. Nothing on the write path reads it.
--
-- Explore's listing (public_projects) now says which license the work is
-- under; the projection worker writes it from the org fold (orgLicense).
-- Who outside the organization may look inside follows from the license
-- (docs/licensing.md "Access"); that read path is not built yet, so nothing
-- here grants outsiders anything new.

-- core LICENSES, most closed first. The order is the merge rule.
create or replace function public.licenses() returns text[] language sql immutable as $$
  select array['all-rights-reserved', 'CC-BY-NC-ND-4.0', 'CC-BY-NC-SA-4.0', 'CC-BY-SA-4.0', 'CC-BY-4.0', 'CC0-1.0'];
$$;

-- event_privilege as of 20260929000001, plus the license. Same table as core
-- EVENT_PRIVILEGE / privilegeFor.
create or replace function public.event_privilege(p_type text, p jsonb)
returns text language sql immutable as $$
  select case p_type
    when 'v1.ProjectCreated' then 'bootstrap'
    when 'v1.ProjectConfigChanged' then 'manage_structure'
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
    when 'v1.ProjectRegistered' then 'manage_structure'
    when 'v1.InviteIssued' then 'invite_members'
    when 'v1.JoinDecided' then 'invite_members'
    -- The passage record.
    when 'v1.ReviewKindDefined' then 'manage_flows'
    when 'v2.WorkflowStepSet' then 'manage_flows'
    when 'v1.ReviewRecorded' then case when p->>'via' = 'logged' then 'review,translate' else 'review' end
    when 'v1.DepartureRecorded' then case p->>'type'
      when 'override' then 'override_checkpoints' when 'keep' then 'translate' else 'translate,review,assign_work' end
    when 'v1.DepartureUndone' then 'translate,review,assign_work,override_checkpoints'
    when 'v1.RequestMade' then 'send_to_reviewers,assign_work'
    when 'v1.RequestWithdrawn' then 'send_to_reviewers,assign_work'
    when 'v1.NoteAdded' then 'translate,review,fill_reference'
    when 'v1.StudyStepMarked' then 'translate'
    when 'v1.LaneNamed' then 'manage_structure'
    -- The library (library.ts): by the kind of item, core LIBRARY_PRIVILEGE.
    when 'v1.LibraryItemDefined' then public._library_privilege(p->>'kind')
    when 'v1.LibraryVersionPublished' then public._library_privilege(p->>'kind')
    when 'v1.LibrarySharingSet' then public._library_privilege(p->>'kind')
    when 'v1.LibraryItemArchived' then public._library_privilege(p->>'kind')
    when 'v1.LibrarySubscribed' then public._library_privilege(p->>'kind')
    when 'v1.LibraryPinned' then public._library_privilege(p->>'kind')
    when 'v2.LaneTemplateSelected' then 'manage_templates'
    when 'v1.LaneUnitHidden' then 'manage_templates,shape_templates'
    when 'v2.LaneFlowSelected' then 'manage_flows'
    -- The organization's license (license.ts): the owner's decision.
    when 'v1.OrgLicenseSet' then 'manage_roles'
    else null
  end;
$$;

-- validate_payload as of 20260929000001, plus the license.
create or replace function public.validate_payload(p_type text, p jsonb)
returns text language plpgsql immutable as $$
declare c jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'payload must be an object'; end if;
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
      if coalesce(p->>'kind', '') not in ('source', 'target') then return 'kind must be source or target'; end if;
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
      if coalesce(p->>'decision', '') not in ('approve', 'suggest_changes') then return 'decision must be approve or suggest_changes'; end if;
    when 'v1.AssignmentMade' then
      if not (public._is_str(p->'unitId') and public._is_str(p->'laneId') and public._is_str(p->'profileId')) then return 'unitId, laneId, profileId must be non-empty strings'; end if;
      if not public._is_role(p->>'role') then return 'role must be a role'; end if;
    when 'v1.SourceImported' then
      if not public._is_str(p->'sourceProjectId') then return 'sourceProjectId must be a non-empty string'; end if;
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
      if coalesce(p->>'rule', '') not in ('any', 'majority', 'unanimous') then return 'rule must be any, majority or unanimous'; end if;
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
      if coalesce(p->>'kind', '') not in ('template', 'reference', 'flow') then return 'kind must be template, reference or flow'; end if;
      if coalesce(p->>'level', '') not in ('org', 'project') then return 'level must be org or project'; end if;
      if p->>'level' = 'project' and not public._is_str(p->'projectId') then return 'projectId required at project level'; end if;
      if jsonb_typeof(p->'enabled') is distinct from 'boolean' then return 'enabled must be a boolean'; end if;
    when 'v1.ProjectRegistered' then
      if not (public._is_str(p->'projectId') and public._is_str(p->'name')) then return 'projectId and name must be non-empty strings'; end if;
    when 'v1.InviteIssued' then
      if not (public._is_str(p->'inviteId') and public._is_str(p->'roleId') and public._is_str(p->'expiresAt')) then return 'inviteId, roleId, expiresAt must be non-empty strings'; end if;
      if jsonb_typeof(p->'scope') is distinct from 'object' then return 'scope must be an object'; end if;
    when 'v1.InviteRedeemed' then
      if not (public._is_str(p->'inviteId') and public._is_str(p->'profileId')) then return 'inviteId, profileId must be non-empty strings'; end if;
    when 'v1.JoinDecided' then
      if not (public._is_str(p->'requestId') and public._is_str(p->'profileId')) then return 'requestId, profileId must be non-empty strings'; end if;
      if jsonb_typeof(p->'accepted') is distinct from 'boolean' then return 'accepted must be a boolean'; end if;
    when 'v1.ReviewKindDefined', 'v2.WorkflowStepSet', 'v1.ReviewRecorded', 'v1.DepartureRecorded', 'v1.DepartureUndone',
         'v1.RequestMade', 'v1.RequestWithdrawn', 'v1.NoteAdded', 'v1.StudyStepMarked', 'v1.LaneNamed' then
      return public._record_payload_error(p_type, p);
    when 'v1.OrgLicenseSet' then
      if jsonb_typeof(p->'license') is distinct from 'string' or not ((p->>'license') = any(public.licenses())) then
        return 'license must be one of ' || array_to_string(public.licenses(), ', ');
      end if;
    when 'v1.LibraryItemDefined', 'v1.LibraryVersionPublished', 'v1.LibrarySharingSet', 'v1.LibraryItemArchived',
         'v1.LibrarySubscribed', 'v1.LibraryPinned', 'v2.LaneTemplateSelected', 'v1.LaneUnitHidden', 'v2.LaneFlowSelected' then
      return public._library_payload_error(p_type, p);
    else null;
  end case;
  return null;
end $$;

alter table public.public_projects
  add column if not exists license text not null default 'all-rights-reserved';

notify pgrst, 'reload schema';
