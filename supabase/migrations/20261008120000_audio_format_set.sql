-- v1.AudioFormatSet: a voice note's format (decisions.md 71).
--
-- A voice note is named only by the event that uses it (decision 30), which
-- has no format field, so every device took it for m4a. A browser that
-- cannot record MP4 stores WAV (decision 58), and the note was then looked
-- for, uploaded and fetched as <hash>.m4a. The device that has the file now
-- says its format with an event of its own, appended ahead of the event that
-- names the note. Whoever may name a voice note may say its format.
-- core validate.ts and EVENT_PRIVILEGE are the same rules
-- (scripts/record-parity-sql.ts); both functions are redefined whole.

create or replace function public.event_privilege(p_type text, p jsonb)
returns text language sql immutable as $$
  select case p_type
    -- organization stream
    when 'v1.OrgCreated' then 'bootstrap'
    when 'v1.RoleDefined' then 'manage_roles'
    when 'v1.RoleRetired' then 'manage_roles'
    when 'v1.MemberAdded' then 'invite_members'
    when 'v1.MemberRemoved' then 'invite_members'
    when 'v1.InviteIssued' then 'invite_members'
    when 'v1.InviteRedeemed' then null
    when 'v1.JoinDecided' then 'invite_members'
    when 'v1.LicenseSet' then 'manage_roles'
    when 'v1.LanguageAdded' then 'manage_structure'
    when 'v1.LanguageRenamed' then 'manage_structure'
    when 'v1.LanguageCountrySet' then 'manage_structure'
    when 'v1.LanguageTargetSet' then 'manage_structure'
    when 'v1.ReferenceRecommended' then 'manage_reference'
    when 'v1.LibraryItemDefined' then public._library_privilege(p->>'kind')
    when 'v1.LibraryVersionPublished' then public._library_privilege(p->>'kind')
    when 'v1.LibrarySharingSet' then public._library_privilege(p->>'kind')
    when 'v1.LibraryItemArchived' then public._library_privilege(p->>'kind')
    when 'v1.LibrarySubscribed' then public._library_privilege(p->>'kind')
    when 'v1.LibraryPinned' then public._library_privilege(p->>'kind')
    -- either stream
    when 'v1.Redacted' then 'manage_structure'
    -- language stream
    when 'v1.TemplateSelected' then 'manage_templates'
    when 'v1.UnitAdded' then 'manage_templates'
    when 'v1.UnitHidden' then 'manage_templates,shape_templates'
    when 'v1.FlowSelected' then 'manage_flows'
    when 'v1.FlowStepSet' then 'manage_flows'
    when 'v1.FlowStepRemoved' then 'manage_flows'
    when 'v1.ReviewKindDefined' then 'manage_flows'
    when 'v1.ReviewTeamDefined' then 'manage_teams'
    when 'v1.ReviewTeamMemberSet' then 'manage_teams'
    when 'v1.ReviewTeamKindSet' then 'manage_teams'
    when 'v1.RecordingAdded' then 'translate'
    when 'v1.TakeComposed' then 'translate'
    when 'v1.TakeArchived' then 'translate'
    when 'v1.TakeSubmitted' then 'translate'
    when 'v1.ResponseRecorded' then 'translate'
    when 'v1.AudioFormatSet' then 'translate,review,assign_work,send_to_reviewers,override_checkpoints,fill_reference'
    when 'v1.ReviewRecorded' then case when p->>'via' = 'logged' then 'review,translate' else 'review' end
    when 'v1.DepartureRecorded' then case p->>'type'
      when 'override' then 'override_checkpoints' when 'keep' then 'translate' else 'translate,review,assign_work' end
    when 'v1.DepartureUndone' then 'translate,review,assign_work,override_checkpoints'
    when 'v1.RequestMade' then 'send_to_reviewers,assign_work'
    when 'v1.RequestWithdrawn' then 'send_to_reviewers,assign_work'
    when 'v1.NoteAdded' then 'translate,review,fill_reference'
    when 'v1.StudyStepMarked' then 'translate'
    when 'v1.MaterialDefined' then case when p->>'kind' = 'questions' then 'fill_reference' else 'manage_reference' end
    when 'v1.MaterialFieldSet' then 'fill_reference'
    when 'v1.MaterialLocked' then 'manage_reference'
    when 'v1.KeyTermDefined' then 'fill_reference'
    when 'v1.KeyTermRenderingAdded' then 'fill_reference'
    when 'v1.KeyTermAdjusted' then 'fill_reference'
    when 'v1.KeyTermLinked' then 'fill_reference'
    when 'v1.ReferenceSet' then 'manage_reference'
    when 'v1.PassageReferenceLinked' then 'manage_reference'
    when 'v1.ReferencesUsed' then 'translate,review'
    else null
  end;
$$;

create or replace function public.validate_payload(p_type text, p jsonb)
returns text language plpgsql immutable as $$
declare x jsonb; n int;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'payload must be an object'; end if;

  -- The library's items: an id people can read, of a kind the library knows.
  if p_type like 'v1.Library%' then
    if not public._is_str(p->'itemId') then return 'itemId must be a non-empty string'; end if;
    if (p->>'itemId') !~* '^[a-z0-9][a-z0-9._-]{0,120}$' then return 'itemId may use letters, digits, . _ and - only'; end if;
    if not public._is_one_of(p->'kind', array['template', 'flow', 'material', 'versification']) then
      return 'kind must be one of template, flow, material, versification';
    end if;
  end if;

  case p_type
    -- ---- organization stream
    when 'v1.OrgCreated' then
      if not public._is_str(p->'name') then return 'name must be a non-empty string'; end if;
    when 'v1.RoleDefined' then
      if not (public._is_str(p->'roleId') and public._is_str(p->'name')) then return 'roleId, name must be non-empty strings'; end if;
      if not public._is_privilege_array(p->'privileges') then return 'privileges must be known privileges'; end if;
    when 'v1.RoleRetired' then
      if not public._is_str(p->'roleId') then return 'roleId must be a non-empty string'; end if;
    when 'v1.MemberAdded' then
      if not (public._is_str(p->'profileId') and public._is_str(p->'roleId')) then return 'profileId, roleId must be non-empty strings'; end if;
      return public._scope_error(p->'scope');
    when 'v1.MemberRemoved' then
      if not public._is_str(p->'profileId') then return 'profileId must be a non-empty string'; end if;
      return public._scope_error(p->'scope');
    when 'v1.InviteIssued' then
      if not (public._is_str(p->'inviteId') and public._is_str(p->'roleId') and public._is_str(p->'expiresAt')) then
        return 'inviteId, roleId, expiresAt must be non-empty strings';
      end if;
      return public._scope_error(p->'scope');
    when 'v1.InviteRedeemed' then
      if not (public._is_str(p->'inviteId') and public._is_str(p->'profileId')) then return 'inviteId, profileId must be non-empty strings'; end if;
    when 'v1.JoinDecided' then
      if not (public._is_str(p->'requestId') and public._is_str(p->'profileId')) then return 'requestId, profileId must be non-empty strings'; end if;
      if not public._is_bool(p->'accepted') then return 'accepted must be a boolean'; end if;
    when 'v1.LicenseSet' then
      if not public._is_one_of(p->'license', public.licenses()) then
        return 'license must be one of ' || array_to_string(public.licenses(), ', ');
      end if;
    when 'v1.LanguageAdded' then
      if not (public._is_str(p->'languageId') and public._is_str(p->'name') and public._is_str(p->'code') and public._is_str(p->'sourceCode')) then
        return 'languageId, name, code, sourceCode must be non-empty strings';
      end if;
      if (p->>'languageId') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$' then return 'languageId may use letters, digits, _ and - only'; end if;
    when 'v1.LanguageRenamed' then
      if not (public._is_str(p->'languageId') and public._is_str(p->'name')) then return 'languageId, name must be non-empty strings'; end if;
    when 'v1.LanguageCountrySet' then
      if not public._is_str(p->'languageId') then return 'languageId must be a non-empty string'; end if;
      if jsonb_typeof(p->'country') is distinct from 'string' or (p->>'country') !~ '^[A-Z]{2}$' then
        return 'country must be an ISO 3166 alpha-2 code';
      end if;
    when 'v1.LanguageTargetSet' then
      if not public._is_str(p->'languageId') then return 'languageId must be a non-empty string'; end if;
      if not public._is_one_of(p->'scope', array['gospels', 'nt', 'ot', 'bible']) then return 'scope must be one of gospels, nt, ot, bible'; end if;
      if not public._is_date(p->'startDate') then return 'startDate must be a YYYY-MM-DD date'; end if;
      if not public._is_date(p->'targetDate') then return 'targetDate must be a YYYY-MM-DD date'; end if;
      if not ((p->>'targetDate') collate "C" > (p->>'startDate') collate "C") then return 'targetDate must be after startDate'; end if;
    when 'v1.ReferenceRecommended' then
      if not public._is_str(p->'itemId') then return 'itemId must be a non-empty string'; end if;
      if not public._is_bool(p->'recommended') then return 'recommended must be a boolean'; end if;
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
      if not (public._is_bool(p->'shared') and public._is_bool(p->'subscribable')) then return 'shared, subscribable must be booleans'; end if;
    when 'v1.LibraryItemArchived' then
      if not public._is_bool(p->'archived') then return 'archived must be a boolean'; end if;
    when 'v1.LibrarySubscribed' then
      if not (public._is_str(p->'sourceOrgId') and public._is_str(p->'sourceOrgName') and public._is_str(p->'sourceItemId')
        and public._is_str(p->'name')) then
        return 'sourceOrgId, sourceOrgName, sourceItemId, name must be non-empty strings';
      end if;
      if not (public._is_bool(p->'autoUpdate') and public._is_bool(p->'active')) then return 'autoUpdate, active must be booleans'; end if;
    when 'v1.LibraryPinned' then
      if not public._is_hash(p->'docHash') then return 'docHash must be a SHA-256 hex digest'; end if;
    -- ---- either stream
    when 'v1.Redacted' then
      if not public._is_str(p->'eventId') then return 'eventId must be a non-empty string'; end if;
      if not public._is_opt_str(p->'reason') then return 'reason must be a string'; end if;
    -- ---- language stream
    when 'v1.TemplateSelected' then
      if not (public._is_str(p->'itemId') and public._is_str(p->'unitPrefix')) then return 'itemId, unitPrefix must be non-empty strings'; end if;
      if not public._is_hash(p->'docHash') then return 'docHash must be a SHA-256 hex digest'; end if;
      if (p->>'unitPrefix') ~ '[/[:space:]]' then return 'unitPrefix may not contain / or spaces'; end if;
      if p ? 'books' then
        if jsonb_typeof(p->'books') <> 'array' then return 'books must be USFM book codes'; end if;
        for x in select * from jsonb_array_elements(p->'books') loop
          if jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ '^[A-Z0-9]{3}$' then return 'books must be USFM book codes'; end if;
        end loop;
      end if;
    when 'v1.UnitAdded' then
      if not (public._is_str(p->'unitId') and public._is_str(p->'kind') and public._is_str(p->'label') and public._is_str(p->'order')) then
        return 'unitId, kind, label, order must be non-empty strings';
      end if;
      if not (jsonb_typeof(p->'parentUnitId') is not distinct from 'null' or public._is_str(p->'parentUnitId')) then return 'parentUnitId must be a non-empty string'; end if;
    when 'v1.UnitHidden' then
      if not public._is_str(p->'unitId') then return 'unitId must be a non-empty string'; end if;
      if not public._is_bool(p->'hidden') then return 'hidden must be a boolean'; end if;
    when 'v1.FlowSelected' then
      if not public._is_str(p->'flowId') then return 'flowId must be a non-empty string'; end if;
      if (p->>'flowId') ~ '[/@[:space:]]' then return 'flowId may not contain /, @ or spaces'; end if;
      if not (public._is_opt_str(p->'itemId') and public._is_opt_str(p->'name')) then return 'itemId, name must be strings'; end if;
      if p ? 'docHash' and not public._is_hash(p->'docHash') then return 'docHash must be a SHA-256 hex digest'; end if;
    when 'v1.FlowStepSet' then
      if not (public._is_str(p->'stepId') and public._is_str(p->'order')) then return 'stepId, order must be non-empty strings'; end if;
      if not public._is_str_array(p->'kindIds') then return 'kindIds must be a string array'; end if;
      if not public._is_bool(p->'checkpoint') then return 'checkpoint must be a boolean'; end if;
    when 'v1.FlowStepRemoved' then
      if not public._is_str(p->'stepId') then return 'stepId must be a non-empty string'; end if;
    when 'v1.ReviewKindDefined' then
      if not (public._is_str(p->'kindId') and public._is_str(p->'name')) then return 'kindId, name must be non-empty strings'; end if;
      if not (public._is_opt_str(p->'description') and public._is_opt_str(p->'usualReviewer')) then return 'description, usualReviewer must be strings'; end if;
      if p ? 'withholdsContext' and not public._is_bool(p->'withholdsContext') then return 'withholdsContext must be a boolean'; end if;
      if p ? 'produces' and not (jsonb_typeof(p->'produces') = 'object' and public._is_str(p->'produces'->'what')
        and public._is_str(p->'produces'->'into') and public._is_str(p->'produces'->'action') and public._is_str(p->'produces'->'checkedBy')) then
        return 'produces needs what, into, action, checkedBy';
      end if;
    when 'v1.ReviewTeamDefined' then
      if not (public._is_str(p->'teamId') and public._is_str(p->'name')) then return 'teamId, name must be non-empty strings'; end if;
    when 'v1.ReviewTeamMemberSet' then
      if not (public._is_str(p->'teamId') and public._is_str(p->'profileId')) then return 'teamId, profileId must be non-empty strings'; end if;
      if not public._is_bool(p->'member') then return 'member must be a boolean'; end if;
    when 'v1.ReviewTeamKindSet' then
      if not public._is_str(p->'teamId') then return 'teamId must be a non-empty string'; end if;
      if not (jsonb_typeof(p->'kindId') is not distinct from 'null' or public._is_str(p->'kindId')) then return 'kindId must be a string or null'; end if;
    when 'v1.RecordingAdded' then
      if not (public._is_str(p->'recordingId') and public._is_str(p->'unitId')) then return 'recordingId, unitId must be non-empty strings'; end if;
      if not public._is_one_of(p->'kind', array['source', 'target']) then return 'kind must be source or target'; end if;
      if not public._is_cards(p->'cards') then return 'cards must be cards'; end if;
    when 'v1.TakeComposed' then
      if not (public._is_str(p->'takeId') and public._is_str(p->'unitId')) then return 'takeId, unitId must be non-empty strings'; end if;
      if not public._is_str_array(p->'cardHashes') then return 'cardHashes must be a string array'; end if;
      if not (jsonb_typeof(p->'parentTakeId') is not distinct from 'null' or public._is_str(p->'parentTakeId')) then return 'parentTakeId must be a non-empty string'; end if;
    when 'v1.TakeArchived' then
      if not public._is_str(p->'takeId') then return 'takeId must be a non-empty string'; end if;
    when 'v1.TakeSubmitted' then
      if not public._is_str(p->'takeId') then return 'takeId must be a non-empty string'; end if;
      if p ? 'questionSetIds' and not public._is_str_array(p->'questionSetIds') then return 'questionSetIds must be a string array'; end if;
    when 'v1.ResponseRecorded' then
      if not (public._is_str(p->'takeId') and public._is_str(p->'respondsToTakeId')) then return 'takeId, respondsToTakeId must be non-empty strings'; end if;
      if not (public._is_opt_str(p->'note') and public._is_opt_str(p->'blobHash')) then return 'note, blobHash must be strings'; end if;
    when 'v1.AudioFormatSet' then
      if not public._is_str(p->'hash') then return 'hash must be a non-empty string'; end if;
      if not public._is_one_of(p->'format', array['wav', 'm4a']) then return 'format must be one of wav, m4a'; end if;
    when 'v1.ReviewRecorded' then
      if not (public._is_str(p->'reviewId') and public._is_str(p->'takeId') and public._is_str(p->'kindId')) then return 'reviewId, takeId, kindId must be non-empty strings'; end if;
      if not public._is_one_of(p->'outcome', array['looks_good', 'needs_changes', 'recorded']) then return 'outcome must be one of looks_good, needs_changes, recorded'; end if;
      if not public._is_one_of(p->'via', array['app', 'link', 'logged']) then return 'via must be one of app, link, logged'; end if;
      if not (public._is_opt_str(p->'comment') and public._is_opt_str(p->'commentBlobHash') and public._is_opt_str(p->'place')
        and public._is_opt_str(p->'givenBy') and public._is_opt_str(p->'requestId')) then return 'comment, commentBlobHash, place, givenBy, requestId must be strings'; end if;
      if not (public._is_str_map(p->'answers') and public._is_str_map(p->'skipped')) then return 'answers and skipped must map ids to strings'; end if;
      if p ? 'people' and not (case when jsonb_typeof(p->'people') = 'number' then (p->>'people')::numeric >= 0 else false end) then return 'people must be a number'; end if;
      if p ? 'artifacts' and not public._is_cards(p->'artifacts') then return 'artifacts must be cards'; end if;
      if p->>'outcome' = 'recorded' and (jsonb_typeof(p->'artifacts') is distinct from 'array' or jsonb_array_length(p->'artifacts') = 0) then
        return 'recorded needs artifacts';
      end if;
    when 'v1.DepartureRecorded' then
      if not (public._is_str(p->'departureId') and public._is_str(p->'unitId') and public._is_str(p->'reason')) then
        return 'departureId, unitId, reason must be non-empty strings';
      end if;
      if not public._is_one_of(p->'type', array['skip', 'override', 'keep']) then return 'type must be one of skip, override, keep'; end if;
      if not (public._is_opt_str(p->'kindId') and public._is_opt_str(p->'stepId') and public._is_opt_str(p->'reviewId') and public._is_opt_str(p->'reasonBlobHash')) then
        return 'kindId, stepId, reviewId, reasonBlobHash must be strings';
      end if;
      if p->>'type' = 'skip' and not public._is_str(p->'kindId') then return 'skip needs kindId'; end if;
      if p->>'type' = 'override' and not public._is_str(p->'stepId') then return 'override needs stepId'; end if;
      if p->>'type' = 'keep' and not public._is_str(p->'reviewId') then return 'keep needs reviewId'; end if;
    when 'v1.DepartureUndone' then
      if not public._is_str(p->'departureId') then return 'departureId must be a non-empty string'; end if;
    when 'v1.RequestMade' then
      if not (public._is_str(p->'requestId') and public._is_str(p->'unitId')) then return 'requestId, unitId must be non-empty strings'; end if;
      if not public._is_one_of(p->'what', array['record', 'review']) then return 'what must be one of record, review'; end if;
      if not (public._is_opt_str(p->'kindId') and public._is_opt_str(p->'profileId') and public._is_opt_str(p->'teamId')
        and public._is_opt_str(p->'dueDate') and public._is_opt_str(p->'note') and public._is_opt_str(p->'noteBlobHash')) then
        return 'kindId, profileId, teamId, dueDate, note, noteBlobHash must be strings';
      end if;
      if p->>'what' = 'review' and not public._is_str(p->'kindId') then return 'a review request needs kindId'; end if;
      if p ? 'guest' and not (jsonb_typeof(p->'guest') = 'object' and public._is_str(p->'guest'->'name')
        and public._is_str(p->'guest'->'contact') and public._is_one_of(p->'guest'->'channel', array['whatsapp', 'sms'])) then
        return 'guest needs name, channel, contact';
      end if;
      if p ? 'questions' then
        if jsonb_typeof(p->'questions') <> 'array' then return 'questions must be id, text, type'; end if;
        for x in select * from jsonb_array_elements(p->'questions') loop
          if jsonb_typeof(x) <> 'object' or not public._is_str(x->'id') or not public._is_str(x->'text')
            or not public._is_one_of(x->'type', array['rating', 'yesno', 'text'])
            or (x ? 'required' and not public._is_bool(x->'required')) then
            return 'questions must be id, text, type';
          end if;
        end loop;
      end if;
      select count(*) into n from unnest(array['profileId', 'guest', 'teamId']) k where p ? k and (p->k) <> '""'::jsonb;
      if n <> 1 then return 'exactly one of profileId, guest, teamId'; end if;
    when 'v1.RequestWithdrawn' then
      if not public._is_str(p->'requestId') then return 'requestId must be a non-empty string'; end if;
    when 'v1.NoteAdded' then
      if not (public._is_str(p->'noteId') and public._is_str(p->'unitId')) then return 'noteId, unitId must be non-empty strings'; end if;
      if not (public._is_opt_str(p->'text') and public._is_opt_str(p->'blobHash') and public._is_opt_str(p->'photoHash') and public._is_opt_str(p->'onTakeId')) then
        return 'text, blobHash, photoHash, onTakeId must be strings';
      end if;
      if jsonb_typeof(p->'anchor') is distinct from 'object' then return 'anchor must be an object'; end if;
      case p->'anchor'->>'kind'
        when 'passage' then null;
        when 'version' then if not public._is_str(p->'anchor'->'takeId') then return 'anchor.takeId required'; end if;
        when 'verse' then if not public._is_str(p->'anchor'->'verse') then return 'anchor.verse required'; end if;
        when 'study' then if not (public._is_str(p->'anchor'->'guideId') and public._is_str(p->'anchor'->'stepId')) then return 'anchor.guideId and stepId required'; end if;
        when 'term' then if not public._is_str(p->'anchor'->'termId') then return 'anchor.termId required'; end if;
        else return 'anchor.kind must be passage, version, verse, study or term';
      end case;
      if not (public._is_str(p->'text') or public._is_str(p->'blobHash') or public._is_str(p->'photoHash')) then
        return 'a note needs text, audio or a photo';
      end if;
    when 'v1.StudyStepMarked' then
      if not (public._is_str(p->'unitId') and public._is_str(p->'guideId') and public._is_str(p->'stepId')) then
        return 'unitId, guideId, stepId must be non-empty strings';
      end if;
      if not public._is_bool(p->'done') then return 'done must be a boolean'; end if;
    when 'v1.MaterialDefined' then
      if not (public._is_str(p->'materialId') and public._is_str(p->'kind') and public._is_str(p->'title')) then
        return 'materialId, kind, title must be non-empty strings';
      end if;
      if not public._is_opt_str(p->'templateRef') then return 'templateRef must be a string'; end if;
      if jsonb_typeof(p->'scope') is distinct from 'object' or exists (
        select 1 from jsonb_each(p->'scope') e where e.key not in ('unitId', 'stepId') or not public._is_str(e.value)) then
        return 'scope may name a unitId and a stepId only';
      end if;
    when 'v1.MaterialFieldSet' then
      if not (public._is_str(p->'materialId') and public._is_str(p->'fieldId')) then return 'materialId, fieldId must be non-empty strings'; end if;
      if not (public._is_opt_str(p->'text') and public._is_opt_str(p->'blobHash')) then return 'text, blobHash must be strings'; end if;
    when 'v1.MaterialLocked' then
      if not public._is_str(p->'materialId') then return 'materialId must be a non-empty string'; end if;
      if not public._is_bool(p->'locked') then return 'locked must be a boolean'; end if;
    when 'v1.KeyTermDefined' then
      if not (public._is_str(p->'termId') and public._is_str(p->'term')) then return 'termId, term must be non-empty strings'; end if;
      if jsonb_typeof(p->'gloss') is distinct from 'string' then return 'gloss must be a string'; end if;
      if not public._is_str_array(p->'unitScope') then return 'unitScope must be a string array'; end if;
    when 'v1.KeyTermRenderingAdded' then
      if not (public._is_str(p->'termId') and public._is_str(p->'renderingId') and public._is_str(p->'rendering')) then
        return 'termId, renderingId, rendering must be non-empty strings';
      end if;
      if jsonb_typeof(p->'context') is distinct from 'string' then return 'context must be a string'; end if;
    when 'v1.KeyTermAdjusted' then
      if not (public._is_str(p->'termId') and public._is_str(p->'adjustmentId')) then return 'termId, adjustmentId must be non-empty strings'; end if;
      if jsonb_typeof(p->'note') is distinct from 'string' then return 'note must be a string'; end if;
      if not (public._is_opt_str(p->'blobHash') and public._is_opt_str(p->'duringTakeId')) then return 'blobHash, duringTakeId must be strings'; end if;
    when 'v1.KeyTermLinked' then
      if not (public._is_str(p->'takeId') and public._is_str(p->'termId')) then return 'takeId, termId must be non-empty strings'; end if;
      if not (public._is_opt_str(p->'note') and public._is_opt_str(p->'adjustmentId')) then return 'note, adjustmentId must be strings'; end if;
    when 'v1.ReferenceSet' then
      if not public._is_str(p->'itemId') then return 'itemId must be a non-empty string'; end if;
      if not public._is_one_of(p->'state', array['recommended', 'hidden', 'inherit']) then return 'state must be one of recommended, hidden, inherit'; end if;
    when 'v1.PassageReferenceLinked' then
      if not (public._is_str(p->'unitId') and public._is_str(p->'itemId')) then return 'unitId, itemId must be non-empty strings'; end if;
      if not public._is_bool(p->'linked') then return 'linked must be a boolean'; end if;
    when 'v1.ReferencesUsed' then
      if not public._is_str(p->'unitId') then return 'unitId must be a non-empty string'; end if;
      if (p ? 'takeId')::int + (p ? 'reviewId')::int <> 1 then return 'exactly one of takeId, reviewId'; end if;
      if (p ? 'takeId' and not public._is_str(p->'takeId')) or (p ? 'reviewId' and not public._is_str(p->'reviewId')) then
        return 'takeId or reviewId must be non-empty';
      end if;
      return public._used_items_error(p->'items');
    when 'v1.BlobStored' then
      if not public._is_str(p->'hash') then return 'hash must be a non-empty string'; end if;
      if jsonb_typeof(p->'size') is distinct from 'number' then return 'size must be a number'; end if;
    when 'v1.BlobInvalidated' then
      if not public._is_str(p->'hash') then return 'hash must be a non-empty string'; end if;
      if not public._is_opt_str(p->'reason') then return 'reason must be a string'; end if;
    else null;
  end case;
  return null;
end $$;
