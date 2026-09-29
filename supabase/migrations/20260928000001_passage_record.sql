-- The passage record (packages/core record.ts, passage.ts; PLAN.md sections 6 and 13).
--
-- Ten new event types: review kinds, v2 flow steps (parallel kinds and
-- checkpoints), reviews of a version for a kind (in the app, by link, or
-- logged afterwards; a back translation is a review whose artifacts are the
-- content), departures with a reason and their undo, requests and their
-- withdrawal, anchored notes, study-step marks, and a language's name.
--
-- Two new privileges from the UX spec: override_checkpoints and
-- shape_templates. Some events may be emitted under any one of several
-- privileges (a translator or a reviewer may log a community check they
-- ran); event_privilege returns those comma-separated and the callers test
-- overlap. Same table as core EVENT_PRIVILEGE / privilegeFor.

create or replace function public._is_privilege_array(v jsonb) returns boolean language sql immutable as $$
  select v is not null and jsonb_typeof(v) = 'array'
    and not exists (
      select 1 from jsonb_array_elements(v) x
      where jsonb_typeof(x) <> 'string' or (x #>> '{}') not in (
        'manage_structure','invite_members','manage_roles','manage_templates','shape_templates','manage_reference',
        'manage_flows','manage_teams','assign_work','override_checkpoints','translate','fill_reference',
        'send_to_reviewers','review','view_status'));
$$;

create or replace function public.fixed_role_privileges(p_role text)
returns text[] language sql immutable as $$
  select case p_role
    when 'owner' then array['manage_structure','invite_members','manage_roles','manage_templates','shape_templates','manage_reference','manage_flows','manage_teams','assign_work','override_checkpoints','translate','fill_reference','send_to_reviewers','review','view_status']
    when 'coordinator' then array['manage_structure','invite_members','manage_templates','shape_templates','manage_reference','manage_flows','manage_teams','assign_work','override_checkpoints','translate','fill_reference','send_to_reviewers','review','view_status']
    when 'translator' then array['translate','fill_reference','send_to_reviewers','view_status']
    when 'reviewer' then array['review','view_status']
    when 'viewer' then array['view_status']
    else '{}'::text[]
  end;
$$;

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
    -- Source-language audio (a back translation, a key-term pronunciation) is not a draft.
    when 'v1.RecordingAdded' then case when p->>'kind' = 'target' then 'translate' else 'translate,review,fill_reference' end
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
    else null
  end;
$$;

create or replace function public.role_may_emit_event(p_role text, p_type text, p jsonb)
returns boolean language sql immutable as $$
  select coalesce(string_to_array(public.event_privilege(p_type, p), ',') && public.fixed_role_privileges(p_role), false);
$$;

create or replace function public.may_emit(p_org text, p_project text, p_profile text, p_type text, p jsonb)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_priv text := public.event_privilege(p_type, p);
  v_role text;
begin
  if v_priv is null then return false; end if;
  if v_priv = 'bootstrap' then return false; end if;
  if p_project <> '_org' then
    select case when m.removed then null else m.role end into v_role
      from public.memberships m
      where m.org_id = p_org and m.project_id = p_project and m.profile_id = p_profile;
    if p_type='v1.AssignmentMade' and p->>'profileId'=p_profile
      and p->>'role'='translator' and (
        'translate'=any(public.fixed_role_privileges(v_role)) or
        'translate'=any(public.org_privileges(p_org,p_profile,p_project,p->>'laneId'))
      ) then return true; end if;
    if v_role is not null and public.role_may_emit_event(v_role, p_type, p) then return true; end if;
  end if;
  return string_to_array(v_priv, ',') && public.org_privileges(p_org, p_profile, p_project, p->>'laneId');
end $$;

-- Shape helpers for the record's payloads (core validate.ts).
create or replace function public._is_opt_str(v jsonb) returns boolean language sql immutable as $$
  select v is null or jsonb_typeof(v) = 'string';
$$;

create or replace function public._is_str_map(v jsonb) returns boolean language sql immutable as $$
  select v is null or (jsonb_typeof(v) = 'object'
    and not exists (select 1 from jsonb_each(v) e where jsonb_typeof(e.value) <> 'string'));
$$;

create or replace function public._record_payload_error(p_type text, p jsonb)
returns text language plpgsql immutable as $$
declare q jsonb;
begin
  case p_type
    when 'v1.ReviewKindDefined' then
      if not (public._is_str(p->'kindId') and public._is_str(p->'name')) then return 'kindId, name must be non-empty strings'; end if;
      if not (public._is_opt_str(p->'description') and public._is_opt_str(p->'usualReviewer')) then return 'description, usualReviewer must be strings'; end if;
      if p ? 'withholdsContext' and jsonb_typeof(p->'withholdsContext') <> 'boolean' then return 'withholdsContext must be a boolean'; end if;
      if p ? 'produces' and not (jsonb_typeof(p->'produces') = 'object' and public._is_str(p->'produces'->'what')
        and public._is_str(p->'produces'->'into') and public._is_str(p->'produces'->'action') and public._is_str(p->'produces'->'checkedBy')) then
        return 'produces needs what, into, action, checkedBy';
      end if;
    when 'v2.WorkflowStepSet' then
      if not (public._is_str(p->'stepId') and public._is_str(p->'order')) then return 'stepId and order must be non-empty strings'; end if;
      if not public._is_opt_str(p->'laneId') then return 'laneId must be a string'; end if;
      if not public._is_str_array(p->'kindIds') then return 'kindIds must be a string array'; end if;
      if jsonb_typeof(p->'checkpoint') is distinct from 'boolean' then return 'checkpoint must be a boolean'; end if;
    when 'v1.ReviewRecorded' then
      if not (public._is_str(p->'reviewId') and public._is_str(p->'takeId') and public._is_str(p->'kindId')) then return 'reviewId, takeId, kindId must be non-empty strings'; end if;
      if p->>'outcome' is null or p->>'outcome' not in ('looks_good', 'needs_changes', 'recorded') then return 'outcome must be one of looks_good, needs_changes, recorded'; end if;
      if p->>'via' is null or p->>'via' not in ('app', 'link', 'logged') then return 'via must be one of app, link, logged'; end if;
      if not (public._is_opt_str(p->'comment') and public._is_opt_str(p->'commentBlobHash') and public._is_opt_str(p->'place')
        and public._is_opt_str(p->'givenBy') and public._is_opt_str(p->'requestId')) then return 'comment, commentBlobHash, place, givenBy, requestId must be strings'; end if;
      if not (public._is_str_map(p->'answers') and public._is_str_map(p->'skipped')) then return 'answers and skipped must map ids to strings'; end if;
      if p ? 'people' and not (jsonb_typeof(p->'people') = 'number' and (p->>'people')::numeric >= 0) then return 'people must be a number'; end if;
      if p ? 'artifactHashes' and not public._is_str_array(p->'artifactHashes') then return 'artifactHashes must be a string array'; end if;
      if p->>'outcome' = 'recorded' and (jsonb_typeof(p->'artifactHashes') is distinct from 'array' or jsonb_array_length(p->'artifactHashes') = 0) then
        return 'recorded needs artifactHashes';
      end if;
    when 'v1.DepartureRecorded' then
      if not (public._is_str(p->'departureId') and public._is_str(p->'unitId') and public._is_str(p->'laneId') and public._is_str(p->'reason')) then
        return 'departureId, unitId, laneId, reason must be non-empty strings';
      end if;
      if p->>'type' is null or p->>'type' not in ('skip', 'override', 'keep') then return 'type must be one of skip, override, keep'; end if;
      if p->>'type' = 'skip' and not public._is_str(p->'kindId') then return 'skip needs kindId'; end if;
      if p->>'type' = 'override' and not public._is_str(p->'stepId') then return 'override needs stepId'; end if;
      if p->>'type' = 'keep' and not public._is_str(p->'reviewId') then return 'keep needs reviewId'; end if;
    when 'v1.DepartureUndone' then
      if not public._is_str(p->'departureId') then return 'departureId must be a non-empty string'; end if;
    when 'v1.RequestMade' then
      if not (public._is_str(p->'requestId') and public._is_str(p->'unitId') and public._is_str(p->'laneId')) then return 'requestId, unitId, laneId must be non-empty strings'; end if;
      if p->>'what' is null or p->>'what' not in ('record', 'review') then return 'what must be one of record, review'; end if;
      if p->>'what' = 'review' and not public._is_str(p->'kindId') then return 'a review request needs kindId'; end if;
      if not (p ? 'profileId' or p ? 'guest') then return 'profileId or guest required'; end if;
      if p ? 'guest' and not (jsonb_typeof(p->'guest') = 'object' and public._is_str(p->'guest'->'name')
        and public._is_str(p->'guest'->'contact') and p->'guest'->>'channel' in ('whatsapp', 'sms')) then
        return 'guest needs name, channel, contact';
      end if;
      if p ? 'questions' then
        if jsonb_typeof(p->'questions') <> 'array' then return 'questions must be id, text, type'; end if;
        for q in select * from jsonb_array_elements(p->'questions') loop
          if jsonb_typeof(q) <> 'object' or not public._is_str(q->'id') or not public._is_str(q->'text')
            or coalesce(q->>'type', '') not in ('rating', 'yesno', 'text') then
            return 'questions must be id, text, type';
          end if;
        end loop;
      end if;
    when 'v1.RequestWithdrawn' then
      if not public._is_str(p->'requestId') then return 'requestId must be a non-empty string'; end if;
    when 'v1.NoteAdded' then
      if not (public._is_str(p->'noteId') and public._is_str(p->'unitId') and public._is_str(p->'laneId')) then return 'noteId, unitId, laneId must be non-empty strings'; end if;
      if jsonb_typeof(p->'anchor') is distinct from 'object' then return 'anchor must be an object'; end if;
      if coalesce(p->'anchor'->>'kind', '') not in ('passage', 'version', 'verse', 'study', 'term') then
        return 'anchor.kind must be passage, version, verse, study or term';
      end if;
      if not (public._is_str(p->'text') or public._is_str(p->'blobHash') or public._is_str(p->'photoHash')) then
        return 'a note needs text, audio or a photo';
      end if;
    when 'v1.StudyStepMarked' then
      if not (public._is_str(p->'unitId') and public._is_str(p->'laneId') and public._is_str(p->'guideId') and public._is_str(p->'stepId')) then
        return 'unitId, laneId, guideId, stepId must be non-empty strings';
      end if;
      if jsonb_typeof(p->'done') is distinct from 'boolean' then return 'done must be a boolean'; end if;
    when 'v1.LaneNamed' then
      if not (public._is_str(p->'laneId') and public._is_str(p->'name')) then return 'laneId, name must be non-empty strings'; end if;
    else null;
  end case;
  return null;
end $$;

-- validate_payload as of 20260917125750, plus the record's payloads. Enum checks
-- coalesce a missing field to '' so it is refused, as core refuses it (a
-- missing RecordingAdded.kind used to pass here and fail in the fold).
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
    else null;
  end case;
  return null;
end $$;

