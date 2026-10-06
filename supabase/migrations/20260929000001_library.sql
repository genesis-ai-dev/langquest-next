-- The library (docs/library.md "Server contract"; docs/decisions.md 36).
-- packages/core library.ts, libraryDocs.ts and the library cases of
-- validate.ts and org.ts are the client twins of everything here.
--
-- Nine new event types: six in the org partition (items, versions,
-- sharing, archiving, subscriptions, pins) and three that tie a language to
-- library versions. Library events need the privilege that manages their
-- kind (core LIBRARY_PRIVILEGE).
--
-- Documents are immutable JSON named by the SHA-256 of their text. The log
-- only ever names them; the bodies live in library_documents, and
-- library_document_access says which organization may read which. An
-- organization reads what it put, and what it adopted from a shared item
-- together with everything that depends on (invariant 6: the copy of access
-- is what makes it self-contained). Nothing touches these tables but the
-- functions below.
--
-- The org fold (_apply_org_event) now also keeps the library projection,
-- with core applyLibraryEvent's merge rules, and hands each new version of a
-- shared, subscribable item to the subscriptions that follow it
-- automatically: access to the document and its deps, and a LibraryPinned in
-- the subscriber's org partition. A version whose event arrives before its
-- document (an offline publish) is handed on when the document is put.

-- ---- event shapes and privileges (core validate.ts, org.ts) ------------------

create or replace function public._is_hash(v jsonb) returns boolean language sql immutable as $$
  select v is not null and jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^[0-9a-f]{64}$';
$$;

-- core LIBRARY_PRIVILEGE, and privilegeFor's fallback for an unknown kind.
create or replace function public._library_privilege(p_kind text) returns text language sql immutable as $$
  select case p_kind
    when 'template' then 'manage_templates' when 'versification' then 'manage_templates'
    when 'flow' then 'manage_flows' when 'material' then 'manage_reference'
    else 'manage_structure' end;
$$;

create or replace function public._library_payload_error(p_type text, p jsonb)
returns text language plpgsql immutable as $$
declare b jsonb;
begin
  if p_type like 'v1.Library%' then
    if not public._is_str(p->'itemId') then return 'itemId must be a non-empty string'; end if;
    if (p->>'itemId') !~* '^[a-z0-9][a-z0-9._-]{0,120}$' then return 'itemId may use letters, digits, . _ and - only'; end if;
    if coalesce(p->>'kind', '') not in ('template', 'flow', 'material', 'versification') then
      return 'kind must be one of template, flow, material, versification';
    end if;
  end if;
  case p_type
    when 'v1.LibraryItemDefined' then
      if not public._is_str(p->'name') then return 'name must be a non-empty string'; end if;
      if jsonb_typeof(p->'description') is distinct from 'string' then return 'description must be a string'; end if;
      if p ? 'copiedFrom' and not (jsonb_typeof(p->'copiedFrom') = 'object' and public._is_str(p->'copiedFrom'->'orgId')
        and public._is_str(p->'copiedFrom'->'orgName') and public._is_str(p->'copiedFrom'->'itemId')
        and public._is_hash(p->'copiedFrom'->'docHash')) then
        return 'copiedFrom needs orgId, orgName, itemId and a docHash';
      end if;
    when 'v1.LibraryVersionPublished' then
      if not public._is_hash(p->'docHash') then return 'docHash must be a SHA-256 hex digest'; end if;
      if not public._is_opt_str(p->'note') then return 'note must be a string'; end if;
    when 'v1.LibrarySharingSet' then
      if jsonb_typeof(p->'shared') is distinct from 'boolean' then return 'shared must be a boolean'; end if;
      if jsonb_typeof(p->'subscribable') is distinct from 'boolean' then return 'subscribable must be a boolean'; end if;
    when 'v1.LibraryItemArchived' then
      if jsonb_typeof(p->'archived') is distinct from 'boolean' then return 'archived must be a boolean'; end if;
    when 'v1.LibrarySubscribed' then
      if not (public._is_str(p->'sourceOrgId') and public._is_str(p->'sourceOrgName') and public._is_str(p->'sourceItemId')
        and public._is_str(p->'name')) then
        return 'sourceOrgId, sourceOrgName, sourceItemId, name must be non-empty strings';
      end if;
      if jsonb_typeof(p->'autoUpdate') is distinct from 'boolean' then return 'autoUpdate must be a boolean'; end if;
      if jsonb_typeof(p->'active') is distinct from 'boolean' then return 'active must be a boolean'; end if;
    when 'v1.LibraryPinned' then
      if not public._is_hash(p->'docHash') then return 'docHash must be a SHA-256 hex digest'; end if;
    when 'v2.LaneTemplateSelected' then
      if not (public._is_str(p->'laneId') and public._is_str(p->'itemId') and public._is_str(p->'unitPrefix')) then
        return 'laneId, itemId, unitPrefix must be non-empty strings';
      end if;
      if not public._is_hash(p->'docHash') then return 'docHash must be a SHA-256 hex digest'; end if;
      if (p->>'unitPrefix') ~ '[/[:space:]]' then return 'unitPrefix may not contain / or spaces'; end if;
      if p ? 'books' then
        if jsonb_typeof(p->'books') <> 'array' then return 'books must be USFM book codes'; end if;
        for b in select * from jsonb_array_elements(p->'books') loop
          if jsonb_typeof(b) <> 'string' or (b #>> '{}') !~ '^[A-Z0-9]{3}$' then return 'books must be USFM book codes'; end if;
        end loop;
      end if;
    when 'v1.LaneUnitHidden' then
      if not (public._is_str(p->'laneId') and public._is_str(p->'unitId')) then return 'laneId, unitId must be non-empty strings'; end if;
      if jsonb_typeof(p->'hidden') is distinct from 'boolean' then return 'hidden must be a boolean'; end if;
    when 'v2.LaneFlowSelected' then
      if not (public._is_str(p->'laneId') and public._is_str(p->'flowId') and public._is_str(p->'itemId') and public._is_str(p->'name')) then
        return 'laneId, flowId, itemId, name must be non-empty strings';
      end if;
      if not public._is_hash(p->'docHash') then return 'docHash must be a SHA-256 hex digest'; end if;
      if jsonb_typeof(p->'catalogVersion') is distinct from 'number' then return 'catalogVersion must be 2 or more'; end if;
      if (p->>'catalogVersion')::numeric < 2 then return 'catalogVersion must be 2 or more'; end if;
      if (p->>'flowId') ~ '[/@[:space:]]' then return 'flowId may not contain /, @ or spaces'; end if;
    else null;
  end case;
  return null;
end $$;

-- event_privilege as of 20260928000001, plus the library's events. Same table
-- as core EVENT_PRIVILEGE / privilegeFor.
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
    else null
  end;
$$;

-- validate_payload as of 20260928000001, plus the library's payloads.
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
      if coalesce(p->>'level', '') not in ('org', 'partition') then return 'level must be org or partition'; end if;
      if p->>'level' = 'partition' and not public._is_str(p->'partitionId') then return 'partitionId required at partition level'; end if;
      if jsonb_typeof(p->'enabled') is distinct from 'boolean' then return 'enabled must be a boolean'; end if;
    when 'v1.PartitionRegistered' then
      if not (public._is_str(p->'partitionId') and public._is_str(p->'name')) then return 'partitionId and name must be non-empty strings'; end if;
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
    when 'v1.LibraryItemDefined', 'v1.LibraryVersionPublished', 'v1.LibrarySharingSet', 'v1.LibraryItemArchived',
         'v1.LibrarySubscribed', 'v1.LibraryPinned', 'v2.LaneTemplateSelected', 'v1.LaneUnitHidden', 'v2.LaneFlowSelected' then
      return public._library_payload_error(p_type, p);
    else null;
  end case;
  return null;
end $$;


-- ---- tables -----------------------------------------------------------------
--
-- Registers keep the (hlc, event id) that set them, compared byte-wise
-- (collate "C") as core compares strings, so ties settle the same way.

create table if not exists public.library_items (
  org_id text not null,
  item_id text not null,
  kind text,
  kind_hlc text collate "C" not null default '',
  kind_event text collate "C" not null default '',
  name text,
  name_hlc text collate "C" not null default '',
  name_event text collate "C" not null default '',
  description text,
  description_hlc text collate "C" not null default '',
  description_event text collate "C" not null default '',
  copied_from jsonb,
  copied_hlc text collate "C" not null default '',
  copied_event text collate "C" not null default '',
  shared boolean not null default false,
  subscribable boolean not null default false,
  sharing_hlc text collate "C" not null default '',
  sharing_event text collate "C" not null default '',
  archived boolean not null default false,
  archived_hlc text collate "C" not null default '',
  archived_event text collate "C" not null default '',
  primary key (org_id, item_id)
);
create index if not exists library_items_shared_idx on public.library_items (kind, name) where shared and not archived;

create table if not exists public.library_versions (
  org_id text not null,
  item_id text not null,
  doc_hash text not null,
  hlc text collate "C" not null,
  event_id text collate "C" not null,
  actor_id text not null,
  note text,
  primary key (org_id, item_id, doc_hash)
);
create index if not exists library_versions_hash_idx on public.library_versions (doc_hash);

-- A subscription (and the version it is pinned to) of org_id's item item_id
-- to another organization's item. A pin may arrive before its subscription.
create table if not exists public.library_subscriptions (
  org_id text not null,
  item_id text not null,
  source_org_id text,
  source_org_name text,
  source_item_id text,
  name text,
  auto_update boolean not null default false,
  active boolean not null default false,
  sub_hlc text collate "C" not null default '',
  sub_event text collate "C" not null default '',
  pinned text,
  pinned_hlc text collate "C" not null default '',
  pinned_event text collate "C" not null default '',
  primary key (org_id, item_id)
);
create index if not exists library_subscriptions_source_idx on public.library_subscriptions (source_org_id, source_item_id)
  where active and auto_update;

create table if not exists public.library_documents (
  hash text primary key check (hash ~ '^[0-9a-f]{64}$'),
  format text not null,
  body text not null,
  bytes int not null,
  deps text[] not null default '{}',
  created_at timestamptz not null default now()
);
-- Who depends on a document (library_get_documents walks up it).
create index if not exists library_documents_deps_idx on public.library_documents using gin (deps);

create table if not exists public.library_document_access (
  org_id text not null,
  hash text not null references public.library_documents (hash),
  granted_at timestamptz not null default now(),
  primary key (org_id, hash)
);

alter table public.library_items enable row level security;
alter table public.library_versions enable row level security;
alter table public.library_subscriptions enable row level security;
alter table public.library_documents enable row level security;
alter table public.library_document_access enable row level security;
revoke all on public.library_items, public.library_versions, public.library_subscriptions,
  public.library_documents, public.library_document_access from public, anon, authenticated;
grant all on public.library_items, public.library_versions, public.library_subscriptions,
  public.library_documents, public.library_document_access to service_role;

-- ---- the fold (core applyLibraryEvent) ---------------------------------------

-- Does (hlc, id) beat the register's? core `later` / `earlier`.
create or replace function public._lib_later(p_cur_hlc text, p_cur_event text, p_hlc text, p_event text)
returns boolean language sql immutable as $$
  select p_cur_hlc = '' or p_cur_hlc collate "C" < p_hlc collate "C"
    or (p_cur_hlc = p_hlc and p_cur_event collate "C" < p_event collate "C");
$$;
create or replace function public._lib_earlier(p_cur_hlc text, p_cur_event text, p_hlc text, p_event text)
returns boolean language sql immutable as $$
  select p_cur_hlc = '' or p_hlc collate "C" < p_cur_hlc collate "C"
    or (p_cur_hlc = p_hlc and p_event collate "C" < p_cur_event collate "C");
$$;

-- The version an item offers other organizations: its latest published
-- version whose document the owner has put. A version whose document has
-- not arrived yet cannot be handed on.
create or replace function public._library_available(p_org text, p_item text)
returns text language sql stable set search_path = '' as $$
  select v.doc_hash from public.library_versions v
  where v.org_id = p_org and v.item_id = p_item
    and exists (select 1 from public.library_document_access a where a.org_id = p_org and a.hash = v.doc_hash)
  order by v.hlc collate "C" desc, v.event_id collate "C" desc
  limit 1;
$$;

-- Shared items are the organization's own (made or copied), never a subscription (core libraryItemView).
create or replace function public._library_is_subscription(p_org text, p_item text)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.library_subscriptions s where s.org_id = p_org and s.item_id = p_item and s.sub_hlc <> '');
$$;

-- Give an organization a document and everything it depends on.
create or replace function public._library_grant(p_org text, p_hash text)
returns void language sql set search_path = '' as $$
  with recursive docs (hash) as (
    select d.hash from public.library_documents d where d.hash = p_hash
    union
    select d.hash from docs x
      join public.library_documents p on p.hash = x.hash
      join public.library_documents d on d.hash = any (p.deps)
  )
  insert into public.library_document_access (org_id, hash)
  select p_org, docs.hash from docs
  on conflict do nothing;
$$;

-- Hand a new version of a shared, subscribable item to every subscription
-- that follows it automatically: access to it and its deps, and a pin in
-- the subscriber's org partition. Runs when the version's event lands and
-- again when its document is put, whichever is second; the pin's id is
-- decided by (subscriber, item, version), so running it twice appends once.
create or replace function public._library_fan_out(p_org text, p_item text, p_hash text)
returns void language plpgsql set search_path = '' as $$
declare s record; v_id text; v_hlc text; v_payload jsonb;
begin
  if not exists (select 1 from public.library_items i
                 where i.org_id = p_org and i.item_id = p_item and i.shared and i.subscribable)
     or public._library_is_subscription(p_org, p_item)
     or public._library_available(p_org, p_item) is distinct from p_hash then
    return;
  end if;
  for s in
    select x.org_id, x.item_id, x.pinned, coalesce(i.kind, o.kind) as kind
    from public.library_subscriptions x
    left join public.library_items i on i.org_id = x.org_id and i.item_id = x.item_id
    left join public.library_items o on o.org_id = p_org and o.item_id = p_item
    where x.source_org_id = p_org and x.source_item_id = p_item and x.active and x.auto_update
  loop
    perform public._library_grant(s.org_id, p_hash);
    continue when s.pinned is not distinct from p_hash;
    v_id := 'pin:' || s.org_id || ':' || s.item_id || ':' || p_hash;
    v_payload := jsonb_build_object('itemId', s.item_id, 'kind', s.kind, 'docHash', p_hash);
    v_hlc := public._append_event_as(v_id, s.org_id, '_org', 'v1.LibraryPinned', 'server', 'server', v_payload);
    if v_hlc is not null then
      perform public._apply_library_event(s.org_id, v_id, 'v1.LibraryPinned', v_payload, v_hlc, 'server');
    end if;
  end loop;
end $$;

-- Fold one library event into the projection. Order-independent and
-- idempotent, exactly as core applyLibraryEvent: kind, copiedFrom and each
-- version earliest wins; everything else is a register, later wins.
create or replace function public._apply_library_event(p_org text, p_id text, p_type text, p jsonb, p_hlc text, p_actor text)
returns void language plpgsql set search_path = '' as $$
declare v_item text := p->>'itemId';
begin
  insert into public.library_items (org_id, item_id) values (p_org, v_item) on conflict do nothing;
  update public.library_items i set kind = p->>'kind', kind_hlc = p_hlc, kind_event = p_id
    where i.org_id = p_org and i.item_id = v_item and public._lib_earlier(i.kind_hlc, i.kind_event, p_hlc, p_id);
  case p_type
    when 'v1.LibraryItemDefined' then
      update public.library_items i set name = p->>'name', name_hlc = p_hlc, name_event = p_id
        where i.org_id = p_org and i.item_id = v_item and public._lib_later(i.name_hlc, i.name_event, p_hlc, p_id);
      update public.library_items i set description = p->>'description', description_hlc = p_hlc, description_event = p_id
        where i.org_id = p_org and i.item_id = v_item and public._lib_later(i.description_hlc, i.description_event, p_hlc, p_id);
      if jsonb_typeof(p->'copiedFrom') = 'object' then
        update public.library_items i set copied_from = p->'copiedFrom', copied_hlc = p_hlc, copied_event = p_id
          where i.org_id = p_org and i.item_id = v_item and public._lib_earlier(i.copied_hlc, i.copied_event, p_hlc, p_id);
      end if;
    when 'v1.LibraryVersionPublished' then
      insert into public.library_versions as v (org_id, item_id, doc_hash, hlc, event_id, actor_id, note)
      values (p_org, v_item, p->>'docHash', p_hlc, p_id, p_actor, nullif(p->>'note', ''))
      on conflict (org_id, item_id, doc_hash) do update
        set hlc = excluded.hlc, event_id = excluded.event_id, actor_id = excluded.actor_id, note = excluded.note
        where public._lib_earlier(v.hlc, v.event_id, excluded.hlc, excluded.event_id);
      perform public._library_fan_out(p_org, v_item, p->>'docHash');
    when 'v1.LibrarySharingSet' then
      update public.library_items i
        set shared = (p->>'shared')::boolean, subscribable = (p->>'shared')::boolean and (p->>'subscribable')::boolean,
            sharing_hlc = p_hlc, sharing_event = p_id
        where i.org_id = p_org and i.item_id = v_item and public._lib_later(i.sharing_hlc, i.sharing_event, p_hlc, p_id);
    when 'v1.LibraryItemArchived' then
      update public.library_items i set archived = (p->>'archived')::boolean, archived_hlc = p_hlc, archived_event = p_id
        where i.org_id = p_org and i.item_id = v_item and public._lib_later(i.archived_hlc, i.archived_event, p_hlc, p_id);
    when 'v1.LibrarySubscribed' then
      insert into public.library_subscriptions (org_id, item_id) values (p_org, v_item) on conflict do nothing;
      update public.library_subscriptions s
        set source_org_id = p->>'sourceOrgId', source_org_name = p->>'sourceOrgName', source_item_id = p->>'sourceItemId',
            name = p->>'name', auto_update = (p->>'autoUpdate')::boolean, active = (p->>'active')::boolean,
            sub_hlc = p_hlc, sub_event = p_id
        where s.org_id = p_org and s.item_id = v_item and public._lib_later(s.sub_hlc, s.sub_event, p_hlc, p_id);
    when 'v1.LibraryPinned' then
      insert into public.library_subscriptions (org_id, item_id) values (p_org, v_item) on conflict do nothing;
      update public.library_subscriptions s set pinned = p->>'docHash', pinned_hlc = p_hlc, pinned_event = p_id
        where s.org_id = p_org and s.item_id = v_item and public._lib_later(s.pinned_hlc, s.pinned_event, p_hlc, p_id);
    else null;
  end case;
end $$;

-- _apply_org_event as of 20260914000009, plus the library. Its callers pass
-- the clock but not the event's id or actor, which the library's ties and
-- versions need, so it reads them back from the row just written.
create or replace function public._apply_org_event(p_org text, p_type text, p jsonb, p_hlc text)
returns void language plpgsql as $$
declare v_key text; v_id text; v_actor text;
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
  elsif p_type in ('v1.LibraryItemDefined', 'v1.LibraryVersionPublished', 'v1.LibrarySharingSet',
                   'v1.LibraryItemArchived', 'v1.LibrarySubscribed', 'v1.LibraryPinned') then
    select e.id, e.actor_id into v_id, v_actor from public.events e
      where e.org_id = p_org and e.partition_id = '_org' and e.type = p_type and e.hlc = p_hlc and e.payload = p
      order by e.server_seq desc limit 1;
    if v_id is not null then
      perform public._apply_library_event(p_org, v_id, p_type, p, p_hlc, v_actor);
    end if;
  end if;
end $$;

-- Backfill any library events already in the log.
do $$ declare e record; begin
  for e in select ev.id, ev.org_id, ev.type, ev.payload, ev.hlc, ev.actor_id from public.events ev
           where ev.partition_id = '_org'
             and ev.type in ('v1.LibraryItemDefined', 'v1.LibraryVersionPublished', 'v1.LibrarySharingSet',
                             'v1.LibraryItemArchived', 'v1.LibrarySubscribed', 'v1.LibraryPinned')
             and public.validate_payload(ev.type, ev.payload) is null
           order by ev.org_id, ev.server_seq loop
    perform public._apply_library_event(e.org_id, e.id, e.type, e.payload, e.hlc, e.actor_id);
  end loop;
end $$;

-- ---- documents -----------------------------------------------------------------

-- Store a document for an organization and give it access. The name is the
-- SHA-256 of the text as sent (the app sends core canonicalJson); its deps
-- must already be readable here, so access never outruns what an
-- organization was given.
create or replace function public._library_store(p_org text, p_body text)
returns text language plpgsql set search_path = '' as $$
declare v_doc jsonb; v_format text; v_deps text[] := '{}'; v_hash text; r record;
begin
  if p_body is null then raise exception 'a document is required' using errcode = '22023'; end if;
  if octet_length(p_body) > 4194304 then raise exception 'document too large (max 4 MB)' using errcode = '54000'; end if;
  begin
    v_doc := p_body::jsonb;
  exception when others then
    raise exception 'a document must be JSON' using errcode = '22023';
  end;
  if jsonb_typeof(v_doc) <> 'object' then raise exception 'a document must be a JSON object' using errcode = '22023'; end if;
  v_format := v_doc->>'format';
  if coalesce(v_format, '') not in ('template@1', 'flow@1', 'study@1', 'collection@1', 'material@1', 'versification@1') then
    raise exception 'unknown document format %', coalesce(v_format, '(none)') using errcode = '22023';
  end if;
  if v_format <> 'versification@1' or v_doc ? 'deps' then
    if jsonb_typeof(v_doc->'deps') is distinct from 'array' then raise exception 'deps must be a list of hashes' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_array_elements(v_doc->'deps') d where not public._is_hash(d)) then
      raise exception 'deps must be a list of hashes' using errcode = '22023';
    end if;
    v_deps := array(select distinct jsonb_array_elements_text(v_doc->'deps'));
  end if;
  if exists (select 1 from unnest(v_deps) dep
             where not exists (select 1 from public.library_document_access a where a.org_id = p_org and a.hash = dep)) then
    raise exception 'a document it depends on is not readable by this organization' using errcode = '42501';
  end if;
  v_hash := encode(sha256(convert_to(p_body, 'UTF8')), 'hex');
  insert into public.library_documents (hash, format, body, bytes, deps)
  values (v_hash, v_format, p_body, octet_length(p_body), v_deps)
  on conflict (hash) do nothing;
  insert into public.library_document_access (org_id, hash) values (p_org, v_hash) on conflict do nothing;
  -- A version published offline may have reached the log before its document.
  for r in select v.item_id from public.library_versions v where v.org_id = p_org and v.doc_hash = v_hash loop
    perform public._library_fan_out(p_org, r.item_id, v_hash);
  end loop;
  return v_hash;
end $$;

create or replace function public._library_member(p_org text, p_profile text)
returns boolean language sql stable set search_path = '' as $$
  select p_profile is not null and exists (
    select 1 from public.org_memberships m where m.org_id = p_org and m.profile_id = p_profile and not m.removed);
$$;

-- ---- RPCs (docs/library.md) ---------------------------------------------------

create or replace function public.library_put_document(p_org text, p_body text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if not (public.org_privileges(p_org, v_actor, '_org', null) && array['manage_templates', 'manage_flows', 'manage_reference']) then
    raise exception 'not allowed to publish to this library' using errcode = '42501';
  end if;
  return public._library_store(p_org, p_body);
end $$;

-- Documents p_org may read: what it put or adopted, and for browsing, the
-- version each shared item offers together with everything that version
-- depends on (a shared collection's guides, a shared template's
-- versification). Reading is what sharing means; adopting is for pinning or
-- copying. A requested hash p_org cannot read directly is walked up the
-- dependency graph, a bounded number of levels, to a version some shared
-- item offers.
create or replace function public.library_get_documents(p_org text, p_hashes text[])
returns table (hash text, body text) language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_actor text := public.caller_id();
begin
  if not public._library_member(p_org, v_actor) then raise exception 'not a member' using errcode = '42501'; end if;
  if cardinality(p_hashes) > 200 then raise exception 'too many documents (max 200); page the request' using errcode = '22023'; end if;
  return query
    with recursive wanted (h) as (
      select distinct w.h from unnest(p_hashes) as w (h)
      where not exists (select 1 from public.library_document_access a where a.org_id = p_org and a.hash = w.h)
    ), up (h, root, depth) as (
      select w.h, w.h, 0 from wanted w
      union
      select p.hash, u.root, u.depth + 1 from up u
        join public.library_documents p on p.deps @> array[u.h]
        where u.depth < 8
    ), browsable (root) as (
      select distinct u.root from up u
      where exists (select 1 from public.library_versions v
                    join public.library_items i on i.org_id = v.org_id and i.item_id = v.item_id
                    where v.doc_hash = u.h and i.shared and not i.archived
                      and not public._library_is_subscription(v.org_id, v.item_id)
                      and public._library_available(v.org_id, v.item_id) = u.h)
    )
    select d.hash, d.body from public.library_documents d
    where d.hash = any (p_hashes)
      and (exists (select 1 from public.library_document_access a where a.org_id = p_org and a.hash = d.hash)
        or d.hash in (select b.root from browsable b));
end $$;

-- Shared, unarchived items of every organization, with the version each offers.
create or replace function public.library_shared_items(
  p_kind text default null, p_query text default null, p_limit int default 50, p_offset int default 0
) returns table (org_id text, org_name text, item_id text, kind text, name text, description text,
                 subscribable boolean, version_count int, latest_hash text, updated_hlc text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_like text := '%' || replace(replace(replace(coalesce(p_query, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  if public.caller_id() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  return query
    select i.org_id,
      coalesce((select e.payload->>'name' from public.events e
                where e.org_id = i.org_id and e.partition_id = '_org' and e.type = 'v1.OrgCreated'
                order by e.server_seq limit 1), i.org_id),
      i.item_id, i.kind, coalesce(i.name, i.item_id), coalesce(i.description, ''), i.subscribable,
      (select count(*)::int from public.library_versions v where v.org_id = i.org_id and v.item_id = i.item_id),
      a.hash,
      (select v.hlc::text from public.library_versions v where v.org_id = i.org_id and v.item_id = i.item_id and v.doc_hash = a.hash)
    from public.library_items i
    cross join lateral (select public._library_available(i.org_id, i.item_id) as hash) a
    where i.shared and not i.archived and a.hash is not null
      and (p_kind is null or i.kind = p_kind)
      and (coalesce(p_query, '') = '' or i.name ilike v_like or i.description ilike v_like)
      and not public._library_is_subscription(i.org_id, i.item_id)
    order by coalesce(i.name, i.item_id), i.org_id, i.item_id
    limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- Give p_org one version of a shared item and everything it depends on,
-- before it copies or subscribes. Unsharing later never takes it away.
create or replace function public.library_adopt(p_org text, p_source_org text, p_source_item text, p_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.caller_id(); v_kind text;
begin
  if not public._library_member(p_org, v_actor) then raise exception 'not a member' using errcode = '42501'; end if;
  select i.kind into v_kind from public.library_items i
    where i.org_id = p_source_org and i.item_id = p_source_item and i.shared and not i.archived
      and not public._library_is_subscription(i.org_id, i.item_id);
  if v_kind is null then raise exception 'that item is not shared' using errcode = '42501'; end if;
  if not (public._library_privilege(v_kind) = any (public.org_privileges(p_org, v_actor, '_org', null))) then
    raise exception 'not allowed to manage % items here', v_kind using errcode = '42501';
  end if;
  if not exists (select 1 from public.library_versions v
                 where v.org_id = p_source_org and v.item_id = p_source_item and v.doc_hash = p_hash) then
    raise exception 'that is not a version of the item' using errcode = '22023';
  end if;
  if not exists (select 1 from public.library_document_access a where a.org_id = p_source_org and a.hash = p_hash) then
    raise exception 'that version''s document has not been published yet' using errcode = '22023';
  end if;
  perform public._library_grant(p_org, p_hash);
end $$;

-- Each active subscription of p_org: what it is pinned to, and the newest
-- version its source offers while the source still allows subscribing.
create or replace function public.library_updates(p_org text)
returns table (item_id text, source_org_id text, source_item_id text, pinned_hash text, latest_hash text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public._library_member(p_org, public.caller_id()) then raise exception 'not a member' using errcode = '42501'; end if;
  return query
    select s.item_id, s.source_org_id, s.source_item_id, s.pinned,
      case when exists (select 1 from public.library_items i
                        where i.org_id = s.source_org_id and i.item_id = s.source_item_id and i.shared and i.subscribable)
           then public._library_available(s.source_org_id, s.source_item_id) end
    from public.library_subscriptions s
    where s.org_id = p_org and s.active
    order by s.item_id;
end $$;

-- How scripts/library-seed.ts publishes the LangQuest organization (service role only).
create or replace function public.library_seed_document(p_org text, p_body text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  return public._library_store(p_org, p_body);
end $$;

-- Org-partition events {id, type, payload, actorId?}: validated, appended
-- under the server's clock and folded. Ids already in the log are skipped,
-- so a seed can be run again. Returns how many were appended.
create or replace function public.library_seed_events(p_org text, p_events jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare ev jsonb; v_err text; v_hlc text; n int := 0;
begin
  if jsonb_typeof(p_events) is distinct from 'array' then raise exception 'p_events must be a jsonb array' using errcode = '22023'; end if;
  for ev in select * from jsonb_array_elements(p_events) loop
    if not (public._is_str(ev->'id') and public._is_str(ev->'type')) then
      raise exception 'each event needs an id and a type' using errcode = '22023';
    end if;
    v_err := public.validate_payload(ev->>'type', ev->'payload');
    if v_err is not null then raise exception 'event %: %', ev->>'id', v_err using errcode = '22023'; end if;
    v_hlc := public._append_event_as(ev->>'id', p_org, '_org', ev->>'type',
      coalesce(nullif(ev->>'actorId', ''), 'service'), 'server', ev->'payload');
    if v_hlc is not null then
      perform public._apply_org_event(p_org, ev->>'type', ev->'payload', v_hlc);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ---- access ---------------------------------------------------------------------

revoke all on function public._library_available(text, text), public._library_is_subscription(text, text),
  public._library_grant(text, text), public._library_fan_out(text, text, text),
  public._apply_library_event(text, text, text, jsonb, text, text), public._apply_org_event(text, text, jsonb, text),
  public._library_store(text, text), public._library_member(text, text)
  from public, anon, authenticated;
revoke all on function public.library_put_document(text, text), public.library_get_documents(text, text[]),
  public.library_shared_items(text, text, int, int), public.library_adopt(text, text, text, text),
  public.library_updates(text)
  from public, anon;
grant execute on function public.library_put_document(text, text), public.library_get_documents(text, text[]),
  public.library_shared_items(text, text, int, int), public.library_adopt(text, text, text, text),
  public.library_updates(text)
  to authenticated;
revoke all on function public.library_seed_document(text, text), public.library_seed_events(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.library_seed_document(text, text), public.library_seed_events(text, jsonb) to service_role;
notify pgrst, 'reload schema';
