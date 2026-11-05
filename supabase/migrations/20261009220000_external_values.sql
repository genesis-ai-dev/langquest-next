-- v1.ExternalValueSet: a third-party app's key-value store per language
-- (decisions.md 79).
--
--   v1.ExternalValueSet { key, data: object | null }
--
-- A register per key in the language stream (core reducer.ts): the later
-- clock wins, then the higher id, and null data is a deleted key. LangQuest
-- keeps the values and never acts on them. Only the app's Worker appends
-- one, as the person behind a live access token with the new
-- external_values scope; people, the LangQuest app included, are refused
-- (append_events). The privilege is the contributors' (translate, review,
-- fill_reference), checked as for every event by may_emit.
--
-- The 4 KB cap on data is the Worker's, the only writer: jsonb's text is
-- not JSON.stringify's, so a byte count here could not say what core says.
--
-- validate_payload and event_privilege are restated whole, as `create or
-- replace`, from 20261009200000_language_code_set.sql's, and append_events
-- from 20261009130000_event_integrity_and_grants.sql's, each plus this
-- event. scripts/record-parity-sql.ts holds the first two to core.

alter table public.api_tokens drop constraint api_tokens_scopes_check;
alter table public.api_device_grants drop constraint api_device_grants_requested_scopes_check;
alter table public.api_tokens add constraint api_tokens_scopes_check check (
  cardinality(scopes) > 0 and scopes <@ array['read:published', 'read', 'review', 'release', 'external_values']::text[]);
alter table public.api_device_grants add constraint api_device_grants_requested_scopes_check check (
  cardinality(requested_scopes) > 0 and requested_scopes <@ array['read:published', 'read', 'review', 'release', 'external_values']::text[]);

-- Is this device a live token of this person's in this organization, with
-- the external_values scope, reaching this language? The Worker writes as
-- the token's person from the device `api-<token id>` (agent/view.ts).
create or replace function public._external_values_token(p_org text, p_stream text, p_actor text, p_device text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.api_tokens t
    where 'api-' || t.id::text = p_device
      and t.profile_id::text = p_actor
      and t.org_id = p_org
      and t.revoked_at is null
      and (t.expires_at is null or t.expires_at > now())
      and 'external_values' = any (t.scopes)
      and (t.language_ids is null or p_stream = any (t.language_ids)));
$$;
revoke all on function public._external_values_token(text, text, text, text) from public, anon, authenticated;
grant execute on function public._external_values_token(text, text, text, text) to service_role;

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
    when 'v1.OrgCreated', 'v1.OrgRenamed' then
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
    when 'v1.LanguageCodeSet' then
      if not (public._is_str(p->'languageId') and public._is_str(p->'code')) then return 'languageId, code must be non-empty strings'; end if;
      if length(p->>'code') > 40 then return 'code must be at most 40 characters'; end if;
      if not (jsonb_typeof(p->'languoidId') is not distinct from 'null'
        or coalesce(jsonb_typeof(p->'languoidId') = 'string' and (p->>'languoidId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false)) then
        return 'languoidId must be a languoid id or null';
      end if;
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
    when 'v1.BookNameSet' then
      if not (public._is_str(p->'book') and public._is_str(p->'name')) then return 'book, name must be non-empty strings'; end if;
      if (p->>'book') !~ '^[A-Z0-9]{3}$' then return 'book must be a USFM book code'; end if;
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
    when 'v1.FlowStepLinksSet' then
      if not public._is_str(p->'stepId') then return 'stepId must be a non-empty string'; end if;
      if not public._is_bool(p->'allowed') then return 'allowed must be a boolean'; end if;
    when 'v1.VersionReleased' then
      if not (public._is_str(p->'takeId') and public._is_str(p->'channel')) then return 'takeId, channel must be non-empty strings'; end if;
      if not public._is_bool(p->'live') then return 'live must be a boolean'; end if;
      if p ? 'url' and not public._is_str(p->'url') then return 'url must be a non-empty string'; end if;
      if length(p->>'channel') > 60 then return 'channel must be at most 60 characters'; end if;
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
    when 'v1.ExternalValueSet' then
      if jsonb_typeof(p->'key') is distinct from 'string' or p->>'key' = '' then return 'key must be a non-empty string'; end if;
      if length(p->>'key') > 256 then return 'key must be at most 256 characters'; end if;
      if p->>'key' !~ '^[A-Za-z0-9._~:@+-]+(/[A-Za-z0-9._~:@+-]+)*$' then return 'key must be segments of letters, digits and . _ ~ : @ + - joined by /'; end if;
      if p->>'key' ~ '(^|/)\.\.?(/|$)' then return 'key segments may not be . or ..'; end if;
      if jsonb_typeof(p->'data') is distinct from 'object' and jsonb_typeof(p->'data') is distinct from 'null' then return 'data must be an object or null'; end if;
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

create or replace function public.event_privilege(p_type text, p jsonb)
returns text language sql immutable as $$
  select case p_type
    -- organization stream
    when 'v1.OrgCreated' then 'bootstrap'
    when 'v1.OrgRenamed' then 'manage_roles'
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
    when 'v1.LanguageCodeSet' then 'manage_structure'
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
    when 'v1.BookNameSet' then 'manage_templates'
    when 'v1.FlowSelected' then 'manage_flows'
    when 'v1.FlowStepSet' then 'manage_flows'
    when 'v1.FlowStepRemoved' then 'manage_flows'
    when 'v1.ReviewKindDefined' then 'manage_flows'
    when 'v1.ReviewTeamDefined' then 'manage_teams'
    when 'v1.ReviewTeamMemberSet' then 'manage_teams'
    when 'v1.ReviewTeamKindSet' then 'manage_teams'
    when 'v1.FlowStepLinksSet' then 'manage_flows'
    when 'v1.VersionReleased' then 'assign_work'
    when 'v1.RecordingAdded' then 'translate'
    when 'v1.TakeComposed' then 'translate'
    when 'v1.TakeArchived' then 'translate'
    when 'v1.TakeSubmitted' then 'translate'
    when 'v1.ResponseRecorded' then 'translate'
    when 'v1.AudioFormatSet' then 'translate,review,assign_work,send_to_reviewers,override_checkpoints,fill_reference'
    when 'v1.ExternalValueSet' then 'translate,review,fill_reference'
    when 'v1.ReviewRecorded' then case when p->>'via' in ('logged', 'link') then 'review,translate' else 'review' end
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

create or replace function public.append_events(p_events jsonb, p_client_version int default 0)
returns table (id text, accepted boolean, server_seq bigint, reason text)
language plpgsql security definer set search_path = public as $$
declare
  ev jsonb;
  v_actor text := public.caller_id();
  v_org text; v_stream text; v_type text; v_id text; v_hlc text;
  v_seq bigint; v_invalid text; v_key text;
  v_prior public.events;
  v_now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_wall_ms bigint;
  v_tolerance bigint;
  v_ok boolean;
  v_bootstrap boolean;
begin
  perform public.require_client_version(p_client_version);
  select clock_ahead_tolerance_ms into v_tolerance from public.server_config;
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events must be a jsonb array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) > 500 then
    raise exception 'batch too large: % events (max 500); page the push', jsonb_array_length(p_events) using errcode = '22023';
  end if;

  for ev in select * from jsonb_array_elements(p_events) loop
    v_id := ev->>'id'; v_org := ev->>'orgId'; v_stream := ev->>'streamId'; v_type := ev->>'type'; v_hlc := ev->>'hlc';

    if not (public._is_str(ev->'id') and public._is_str(ev->'orgId') and public._is_str(ev->'streamId')
            and public._is_str(ev->'type') and public._is_str(ev->'hlc') and public._is_str(ev->'deviceId')
            and public._is_str(ev->'actorId')) or ev->'payload' is null then
      id := v_id; accepted := false; server_seq := null; reason := 'malformed envelope';
      return next; continue;
    end if;

    if v_actor is not null and ev->>'actorId' <> v_actor then
      id := v_id; accepted := false; server_seq := null; reason := 'actorId does not match caller';
      return next; continue;
    end if;

    -- One id, one event: the same event again is a duplicate; the id on
    -- anything else is refused, never answered as if it were this one.
    select * into v_prior from public.events e where e.id = v_id;
    if found then
      if v_prior.org_id = v_org and v_prior.stream_id = v_stream and v_prior.actor_id = ev->>'actorId' and v_prior.type = v_type then
        id := v_id; accepted := true; server_seq := v_prior.server_seq; reason := 'duplicate';
      else
        id := v_id; accepted := false; server_seq := null; reason := 'malformed envelope: event id already used';
      end if;
      return next; continue;
    end if;
    if v_actor is not null and public._server_event_id(v_id) then
      id := v_id; accepted := false; server_seq := null; reason := 'malformed envelope: event id reserved for the server';
      return next; continue;
    end if;

    v_wall_ms := nullif(regexp_replace(split_part(v_hlc, ':', 1), '\D', '', 'g'), '')::bigint;
    if v_wall_ms is null then
      id := v_id; accepted := false; server_seq := null; reason := 'malformed envelope';
      return next; continue;
    end if;
    if v_wall_ms > v_now_ms + v_tolerance then
      id := v_id; accepted := false; server_seq := null;
      reason := format('clock ahead: server time %s', v_now_ms);
      return next; continue;
    end if;

    -- A person's stream is written only by record_user_event.
    if v_org = '_person' then
      id := v_id; accepted := false; server_seq := null; reason := format('may not emit %s here', v_type);
      return next; continue;
    end if;

    -- A third-party app's value comes only from the app's Worker (the
    -- service role), as the person behind a live token that holds the
    -- external_values scope and reaches this language (decisions.md 79).
    if v_type = 'v1.ExternalValueSet' and not (v_actor is null
         and public._external_values_token(v_org, v_stream, ev->>'actorId', ev->>'deviceId')) then
      id := v_id; accepted := false; server_seq := null; reason := format('may not emit %s', v_type);
      return next; continue;
    end if;

    v_ok := public.may_emit(v_org, v_stream, ev->>'actorId', v_type, ev->'payload');
    v_bootstrap := false;
    if not v_ok and v_stream = '_org' then
      -- The organization's creation: until anyone is a member, and while
      -- nobody else has written to it, its creator may create it, define
      -- its roles and make themselves its first member.
      v_ok := not exists (select 1 from public.org_memberships m where m.org_id = v_org)
        and not exists (select 1 from public.events e where e.org_id = v_org and e.stream_id = '_org' and e.actor_id <> ev->>'actorId')
        and (v_type in ('v1.OrgCreated', 'v1.RoleDefined')
          or (v_type = 'v1.MemberAdded' and ev->'payload'->>'profileId' = ev->>'actorId'
              and ev->'payload'->'scope'->>'level' = 'org'));
      v_bootstrap := v_ok;
    end if;
    if not v_ok then
      id := v_id; accepted := false; server_seq := null;
      reason := case
        when not public.can_read_stream(v_org, v_stream, ev->>'actorId') then 'not a member'
        else format('may not emit %s', v_type)
      end;
      return next; continue;
    end if;

    -- A language stream exists once the organization lists the language. A
    -- phone may push a new language's events before the organization's
    -- (two streams, two outboxes); it retries them (NOT_LISTED).
    if v_stream <> '_org' and not public.language_listed(v_org, v_stream) then
      id := v_id; accepted := false; server_seq := null; reason := 'language not listed yet';
      return next; continue;
    end if;

    v_invalid := public.validate_payload(v_type, ev->'payload');
    if v_invalid is not null then
      id := v_id; accepted := false; server_seq := null; reason := 'invalid payload: ' || v_invalid;
      return next; continue;
    end if;

    -- A redaction is never redacted (rule 7).
    if v_type = 'v1.Redacted' and exists (select 1 from public.events e
         where e.id = ev->'payload'->>'eventId' and e.type = 'v1.Redacted') then
      id := v_id; accepted := false; server_seq := null; reason := 'invalid payload: a redaction cannot be redacted';
      return next; continue;
    end if;

    -- Nobody grants more than they hold (the workers, as the service role, import and seed).
    if v_actor is not null and v_stream = '_org' and not v_bootstrap then
      v_invalid := public._grant_refusal(v_org, v_actor, v_type, ev->'payload');
      if v_invalid is not null then
        id := v_id; accepted := false; server_seq := null; reason := format('may not emit %s: %s', v_type, v_invalid);
        return next; continue;
      end if;
    end if;

    -- One create, one entity, checked under the stream's lock.
    v_key := public._entity_key(v_type, ev->'payload');
    if v_key is not null then
      perform public._lock_stream(v_org, v_stream);
      if exists (select 1 from public.events e
                 where e.org_id = v_org and e.stream_id = v_stream and public._entity_key(e.type, e.payload) = v_key) then
        id := v_id; accepted := false; server_seq := null;
        reason := format('invalid payload: %s id %s is already used', split_part(v_key, ':', 1), substr(v_key, length(split_part(v_key, ':', 1)) + 2));
        return next; continue;
      end if;
    end if;

    v_seq := public._next_seq(v_org, v_stream);
    insert into public.events (id, org_id, stream_id, server_seq, type, actor_id, device_id,
                               hlc, parent_event_id, payload)
    values (v_id, v_org, v_stream, v_seq, v_type, ev->>'actorId', ev->>'deviceId',
            v_hlc, ev->>'parentEventId', ev->'payload');

    if v_stream = '_org' then
      perform public._apply_org_event(v_org, v_id, v_type, ev->'payload', v_hlc, ev->>'actorId');
    end if;

    id := v_id; accepted := true; server_seq := v_seq; reason := null;
    return next;
  end loop;
end $$;
