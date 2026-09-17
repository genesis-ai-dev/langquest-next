-- Forward repair: hosted migration 20260915120000 has an earlier API
-- despite the same history entry. Preserve its overload and add the current
-- contract. %type accepts both its UUID ids and fresh-install text ids.
create or replace function public._append_event_as(
  p_id text, p_org text, p_project text, p_type text, p_actor text, p_device text, p_payload jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare v_seq bigint; v_hlc text;
begin
  if exists (select 1 from public.events e where e.id = p_id) then return null; end if;
  insert into public.partition_cursors (org_id, project_id) values (p_org, p_project)
    on conflict do nothing;
  update public.partition_cursors c set next_seq = c.next_seq + 1
    where c.org_id = p_org and c.project_id = p_project
    returning c.next_seq - 1 into v_seq;
  v_hlc := lpad((extract(epoch from clock_timestamp()) * 1000)::bigint::text, 15, '0')
           || ':' || lpad((v_seq % 1000000)::text, 6, '0') || ':' || p_device;
  insert into public.events (id, org_id, project_id, server_seq, type, actor_id, device_id, hlc, payload)
  values (p_id, p_org, p_project, v_seq, p_type, p_actor, p_device, v_hlc, p_payload);
  return v_hlc;
end $$;

-- ---------------------------------------------------------------------------
-- Issue an invite. One transaction: the row that makes it redeemable and the
-- event that records it were never separately observable.
-- ---------------------------------------------------------------------------
create or replace function public.issue_invite(
  p_org text, p_invite_id text, p_token_hash text, p_role_id text, p_scope jsonb, p_expires_at timestamptz
) returns void language plpgsql security definer set search_path = public as $$
declare v_actor text := public.caller_id(); v_id public.invites.id%type;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if not ('invite_members' = any(public.org_privileges(p_org, v_actor, null, null))) then
    raise exception 'not allowed to invite members' using errcode = '42501';
  end if;
  if p_expires_at <= now() then raise exception 'invite already expired' using errcode = '22023'; end if;
  if not exists (select 1 from public.org_roles r where r.org_id = p_org and r.role_id = p_role_id and not r.retired) then
    raise exception 'unknown role %', p_role_id using errcode = '22023';
  end if;

  if p_token_hash !~ '^[0-9a-f]{64}$' or p_expires_at > now() + interval '90 days' then
    raise exception 'invalid invite' using errcode = '22023';
  end if;
  if public._scope_error(p_scope) is not null then
    raise exception 'invalid scope' using errcode = '22023';
  end if;
  v_id := p_invite_id;
  if exists (select 1 from public.invites where id = v_id) then
    if exists (select 1 from public.invites where id = v_id
      and issued_by = v_actor and org_id = p_org and token_hash = p_token_hash
      and role_id = p_role_id and scope = p_scope) then return; end if;
    raise exception 'invite id already used' using errcode = '22023';
  end if;
  insert into public.invites (id, org_id, token_hash, role_id, scope, expires_at, issued_by)
  values (v_id, p_org, p_token_hash, p_role_id, p_scope, p_expires_at, v_actor);

  perform public._append_event_as(
    'invite:' || p_invite_id, p_org, '_org', 'v1.InviteIssued', v_actor, 'server',
    jsonb_build_object('inviteId', p_invite_id, 'roleId', p_role_id, 'scope', p_scope,
                       'expiresAt', to_char(p_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
end $$;

-- ---------------------------------------------------------------------------
-- Redeem an invite, running as the redeemer. Grants the membership under the
-- service actor: the newcomer has no privilege to grant themselves anything,
-- so the event cannot be theirs. Returns the org they joined.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_invite_v2(p_token text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_actor text := public.caller_id();
  v_hash text := encode(extensions.digest(p_token, 'sha256'), 'hex');
  v_inv record;
  v_hlc text;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  select * into v_inv from public.invites where token_hash = v_hash for update;
  if not found then raise exception 'invite not found' using errcode = '22023'; end if;
  if v_inv.redeemed_by = v_actor then return v_inv.org_id; end if;
  if v_inv.redeemed_by is not null then raise exception 'invite already used' using errcode = '22023'; end if;
  if v_inv.expires_at <= now() then raise exception 'invite expired' using errcode = '22023'; end if;

  if not exists (select 1 from public.org_roles where org_id = v_inv.org_id and role_id = v_inv.role_id and not retired) then
    raise exception 'invite role is no longer available' using errcode = '22023';
  end if;
  update public.invites set redeemed_by = v_actor, redeemed_at = now() where id = v_inv.id;

  v_hlc := public._append_event_as(
    'invitemember:' || v_inv.id, v_inv.org_id, '_org', 'v1.OrgMemberAdded', 'service', 'server',
    jsonb_build_object('profileId', v_actor, 'roleId', v_inv.role_id, 'scope', v_inv.scope));
  if v_hlc is not null then
    perform public._apply_org_event(v_inv.org_id, 'v1.OrgMemberAdded',
      jsonb_build_object('profileId', v_actor, 'roleId', v_inv.role_id, 'scope', v_inv.scope), v_hlc);
  end if;

  perform public._append_event_as(
    'inviteredeem:' || v_inv.id, v_inv.org_id, '_org', 'v1.InviteRedeemed', 'service', 'server',
    jsonb_build_object('inviteId', v_inv.id, 'profileId', v_actor));

  return v_inv.org_id;
end $$;

-- ---------------------------------------------------------------------------
-- Ask to join. Any signed-in user, at most one open request per org. Nothing
-- reaches the log until a member decides, so a flood of requests cannot grow
-- anybody's partition.
-- ---------------------------------------------------------------------------
create or replace function public.create_join_request(p_org text, p_request_id text, p_message text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_actor text := public.caller_id(); v_id public.join_requests.id%type;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if not exists (select 1 from public.events e where e.org_id = p_org and e.project_id = '_org') then
    raise exception 'unknown organization' using errcode = '22023';
  end if;
  if exists (select 1 from public.events where id = 'joindecided:' || p_request_id) then return; end if;
  if public.org_privileges(p_org, v_actor, null, null) <> '{}' then
    raise exception 'already a member' using errcode = '22023';
  end if;
  v_id := p_request_id;
  if length(p_message) > 2000 then raise exception 'message too long' using errcode = '22023'; end if;
  insert into public.join_requests (id, org_id, profile_id, message)
  values (v_id, p_org, v_actor, coalesce(p_message, ''))
  on conflict (org_id, profile_id) do update set message = excluded.message, created_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- Decide one. Declining records the verdict and closes the request; the
-- asker is told by the absence of a membership, not by a silent delete.
-- ---------------------------------------------------------------------------
create or replace function public.decide_join_request(p_request_id text, p_accepted boolean, p_role_id text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor text := public.caller_id();
  v_req record;
  v_scope jsonb := jsonb_build_object('level', 'org');
  v_hlc text;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  select * into v_req from public.join_requests where id::text = p_request_id for update;
  if not found then
    if exists (select 1 from public.events where id = 'joindecided:' || p_request_id and actor_id = v_actor) then return; end if;
    raise exception 'request not found' using errcode = '22023';
  end if;
  if not ('invite_members' = any(public.org_privileges(v_req.org_id, v_actor, null, null))) then
    raise exception 'not allowed to admit members' using errcode = '42501';
  end if;
  if p_accepted and (p_role_id is null or not exists (
        select 1 from public.org_roles r where r.org_id = v_req.org_id and r.role_id = p_role_id and not r.retired)) then
    raise exception 'a role is required to accept' using errcode = '22023';
  end if;

  perform public._append_event_as(
    'joindecided:' || p_request_id, v_req.org_id, '_org', 'v1.JoinDecided', v_actor, 'server',
    jsonb_build_object('requestId', p_request_id, 'profileId', v_req.profile_id, 'accepted', p_accepted));

  if p_accepted then
    v_hlc := public._append_event_as(
      'joinmember:' || p_request_id, v_req.org_id, '_org', 'v1.OrgMemberAdded', v_actor, 'server',
      jsonb_build_object('profileId', v_req.profile_id, 'roleId', p_role_id, 'scope', v_scope));
    if v_hlc is not null then
      perform public._apply_org_event(v_req.org_id, 'v1.OrgMemberAdded',
        jsonb_build_object('profileId', v_req.profile_id, 'roleId', p_role_id, 'scope', v_scope), v_hlc);
    end if;
  end if;

  delete from public.join_requests where id::text = p_request_id;
end $$;

grant execute on function public.issue_invite(text, text, text, text, jsonb, timestamptz) to authenticated;
grant execute on function public.redeem_invite_v2(text) to authenticated;
grant execute on function public.create_join_request(text, text, text) to authenticated;
grant execute on function public.decide_join_request(text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The privilege and validation tables gain the new types. Both mirror
-- packages/core (EVENT_PRIVILEGE and validate.ts); they must not drift.
-- InviteRedeemed is deliberately absent from event_privilege: it falls to
-- null, which means server-only, so no client can forge a redemption.
-- ---------------------------------------------------------------------------
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
    else null
  end;
$$;

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
      if p->>'level' not in ('org', 'project') then return 'level must be org or project'; end if;
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
    else null;
  end case;
  return null;
end $$;

-- Internal append helpers are never callable by a phone.
do $$
declare helper regprocedure;
begin
  for helper in select p.oid::regprocedure from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='_append_org_event'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', helper);
  end loop;
end $$;
revoke all on function public._append_event_as(text,text,text,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.issue_invite(text,text,text,text,jsonb,timestamptz) from public, anon;
revoke all on function public.redeem_invite_v2(text) from public, anon;
revoke all on function public.create_join_request(text,text,text) from public, anon;
revoke all on function public.decide_join_request(text,boolean,text) from public, anon;
grant select on public.invites, public.join_requests to authenticated;
notify pgrst, 'reload schema';
