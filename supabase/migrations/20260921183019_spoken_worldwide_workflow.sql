-- Six-stage OBT events and source-free back translation partitions.
-- All business status remains derived. The private table only binds access.
create schema if not exists obt_private;
revoke all on schema obt_private from public, anon, authenticated;
create table obt_private.workspaces (
  org_id text not null,
  source_project text not null,
  revision_id text not null,
  workspace_id text primary key,
  translator_id text not null,
  manager_id text not null,
  language text not null,
  unique (org_id, source_project, revision_id)
);
alter table obt_private.workspaces enable row level security;
create index obt_workspace_source_actor on obt_private.workspaces
  (org_id, source_project, translator_id);

alter function public.validate_payload(text,jsonb) rename to validate_payload_pre_obt;
alter function public.validate_payload_pre_obt(text,jsonb) set search_path = public;
create function public.validate_payload(p_type text, p jsonb)
returns text language plpgsql immutable set search_path = public as $$
declare k text; c jsonb; step text := p->>'step';
begin
  if p_type not like 'v1.Obt%' then return public.validate_payload_pre_obt(p_type,p); end if;
  if jsonb_typeof(p) is distinct from 'object' then return 'payload must be an object'; end if;
  foreach k in array array['unitId','laneId','clipId','roundId','firstDraftId','inputTakeId','inputId','takeId','language'] loop
    if p ? k and (not public._is_str(p->k) or length(trim(p->>k))=0) then return 'OBT identifiers must not be blank'; end if;
  end loop;
  if p ? 'clipIds' and jsonb_typeof(p->'clipIds')='array' then
    for c in select * from jsonb_array_elements(p->'clipIds') loop
      if jsonb_typeof(c) is distinct from 'string' or length(trim(c #>> '{}'))=0 then return 'Invalid OBT clips'; end if;
    end loop;
  end if;
  if p_type = 'v1.ObtPolicySet' then
    if not public._is_str(p->'laneId') or coalesce(p->>'consultantRole','') not in ('owner','coordinator','reviewer')
      or coalesce(p->>'finalRole','') not in ('owner','coordinator','reviewer')
      or jsonb_typeof(p->'minimumInteractions') is distinct from 'number' then return 'Invalid OBT policy'; end if;
    if (p->>'minimumInteractions')::numeric not between 1 and 100
      or trunc((p->>'minimumInteractions')::numeric) <> (p->>'minimumInteractions')::numeric then return 'Invalid OBT policy'; end if;
    return null;
  end if;
  if not (public._is_str(p->'unitId') and public._is_str(p->'laneId')) then return 'OBT passage and lane required'; end if;
  case p_type
  when 'v1.ObtRoundStarted' then
    if not (public._is_str(p->'roundId') and public._is_str(p->'firstDraftId'))
      or not coalesce(p->'previousRoundId' = 'null'::jsonb or jsonb_typeof(p->'previousRoundId')='string',false) then return 'Invalid OBT round'; end if;
  when 'v1.ObtWorkspaceCreated' then
    if not (public._is_str(p->'inputTakeId') and public._is_str(p->'language')) then return 'Invalid back translation workspace'; end if;
  when 'v1.ObtAudioAdded' then
    if not public._is_str(p->'clipId') or jsonb_typeof(p->'cards') is distinct from 'array' then return 'Invalid OBT audio'; end if;
    if jsonb_array_length(p->'cards')=0 then return 'Invalid OBT audio'; end if;
    for c in select * from jsonb_array_elements(p->'cards') loop
      if coalesce(c->>'hash','') !~ '^[a-f0-9]{64}$' or jsonb_typeof(c->'durationMs') is distinct from 'number'
        or coalesce(c->>'format','') not in ('wav','m4a') then return 'Invalid OBT audio'; end if;
      if (c->>'durationMs')::numeric < 0 then return 'Invalid OBT audio'; end if;
    end loop;
  when 'v1.ObtInteractionSet' then
    foreach k in array array['interactionId','roundId','draftId','participantName'] loop
      if not public._is_str(p->k) or length(trim(p->>k))=0 then return 'Invalid community interaction'; end if;
    end loop;
    if not public._is_str_array(p->'clipIds') or jsonb_typeof(p->'comments') is distinct from 'string'
      or (p ? 'photoHash' and coalesce(p->>'photoHash','') !~ '^[a-f0-9]{64}$') then return 'Invalid community interaction'; end if;
  when 'v1.ObtStepRecorded' then
    if not (public._is_str(p->'roundId') and public._is_str(p->'inputId')) or coalesce(step,'') not in
      ('community','revision','back_translation','consultant','final_recording','final_approval') then return 'Invalid OBT step'; end if;
    if step in ('consultant','final_approval') then
      if coalesce(p->>'decision','') not in ('approve','changes_requested') then return 'Invalid OBT decision'; end if;
    elsif p->>'decision' is distinct from 'complete' then return 'Invalid OBT decision'; end if;
    if step in ('revision','back_translation','final_recording') and not public._is_str(p->'takeId') then return 'OBT take required'; end if;
    if step='back_translation' and not public._is_str(p->'language') then return 'Back translation language required'; end if;
    if p ? 'note' and jsonb_typeof(p->'note') is distinct from 'string' then return 'Invalid OBT note'; end if;
    if p ? 'clipIds' and not public._is_str_array(p->'clipIds') then return 'Invalid OBT clips'; end if;
  else return 'Unknown OBT event';
  end case;
  return null;
end $$;

alter function public.event_privilege(text,jsonb) rename to event_privilege_pre_obt;
alter function public.event_privilege_pre_obt(text,jsonb) set search_path = public;
create function public.event_privilege(p_type text,p jsonb)
returns text language sql immutable set search_path = public as $$
  select case p_type
    when 'v1.ObtPolicySet' then 'manage_flows'
    when 'v1.ObtRoundStarted' then 'translate'
    when 'v1.ObtAudioAdded' then 'view_status'
    when 'v1.ObtInteractionSet' then 'view_status'
    when 'v1.ObtStepRecorded' then 'view_status'
    when 'v1.ObtWorkspaceCreated' then null
    else public.event_privilege_pre_obt(p_type,p) end;
$$;

-- Existing pulls, snapshot RPCs, realtime RLS and storage policies all ask
-- member_role. A back translator never obtains source-project membership,
-- including through a later org-role grant.
create or replace function public.member_role(p_org_id text,p_project_id text,p_profile_id text)
returns text language sql stable security definer set search_path = public as $$
  select case when exists(select 1 from obt_private.workspaces w
    where w.org_id=p_org_id and w.source_project=p_project_id and w.translator_id=p_profile_id)
  then null else coalesce(
    (select case when m.removed then null else m.role end from public.memberships m
      where m.org_id=p_org_id and m.project_id=p_project_id and m.profile_id=p_profile_id),
    public.effective_role_of(public.org_privileges(p_org_id,p_profile_id,p_project_id,null))) end;
$$;


create function obt_private.event_error(ev jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  p jsonb := ev->'payload'; typ text := ev->>'type';
  org text := ev->>'orgId'; project text := ev->>'projectId';
  actor text := ev->>'actorId'; role text; policy jsonb; r jsonb; prev public.events;
  required_role text; expected text; count_interactions int;
begin
  if exists(select 1 from obt_private.workspaces w where w.org_id=org and w.source_project=project and w.translator_id=actor) then return 'Source project is restricted'; end if;
  if exists(select 1 from obt_private.workspaces w where w.org_id=org and w.workspace_id=project) then
    if typ not in ('v1.RecordingAdded','v1.TakeComposed','v1.TakeSelected','v1.TakeArchived','v1.TakeSubmitted') then return 'Source-free workspace accepts only recordings'; end if;
    if typ in ('v1.RecordingAdded','v1.TakeComposed','v1.TakeSelected') and
      (p->>'unitId' is distinct from 'passage' or p->>'laneId' is distinct from 'output') then return 'Workspace passage required'; end if;
    if typ in ('v1.TakeComposed','v1.TakeArchived','v1.TakeSubmitted') and p->>'takeId'='input' then return 'Assigned input is immutable'; end if;
    if typ='v1.RecordingAdded' and p->>'kind' is distinct from 'target' then return 'Source audio is not permitted'; end if;
  end if;
  if typ not like 'v1.Obt%' then return null; end if;
  if typ='v1.ObtWorkspaceCreated' or (typ='v1.ObtStepRecorded' and p->>'step'='back_translation') then return 'Use the back translation workspace service'; end if;
  role := public.member_role(org,project,actor);
  if role is null or role='viewer' then return 'This role cannot perform OBT work'; end if;
  if typ='v1.ObtPolicySet' then
    if role not in ('owner','coordinator') then return 'Coordinator required'; end if;
    return null;
  end if;
  if typ='v1.ObtAudioAdded' then return null; end if;
  if typ='v1.ObtRoundStarted' then
    if role not in ('owner','coordinator','translator') then return 'Translator required'; end if;
    if not exists(select 1 from public.events e where e.org_id=org and e.project_id=project
      and e.type='v1.TakeComposed' and e.payload->>'takeId'=p->>'firstDraftId'
      and e.payload->>'unitId'=p->>'unitId' and e.payload->>'laneId'=p->>'laneId'
      and jsonb_array_length(e.payload->'cardHashes')>0) then return 'Draft missing'; end if;
    return null;
  end if;
  select e.payload into r from public.events e where e.org_id=org and e.project_id=project
    and e.type='v1.ObtRoundStarted' and e.payload->>'roundId'=p->>'roundId'
    and e.payload->>'unitId'=p->>'unitId' and e.payload->>'laneId'=p->>'laneId'
    order by e.hlc desc,e.id desc limit 1;
  if r is null then return 'Round missing'; end if;
  if typ='v1.ObtInteractionSet' then
    if p->>'draftId' <> r->>'firstDraftId' then return 'Interaction draft does not match round'; end if;
    return null;
  end if;
  select e.payload into policy from public.events e where e.org_id=org and e.project_id=project
    and e.type='v1.ObtPolicySet' and e.payload->>'laneId'=p->>'laneId' order by e.hlc desc,e.id desc limit 1;
  required_role := case p->>'step' when 'consultant' then coalesce(policy->>'consultantRole','coordinator')
    when 'final_approval' then coalesce(policy->>'finalRole','owner') else null end;
  if required_role is not null and role <> required_role and not (p->>'step'='consultant' and role='owner') then return 'Stage belongs to another role'; end if;
  if p->>'step' in ('revision','final_recording') and role not in ('owner','coordinator','translator') then return 'Translator required'; end if;
  select * into prev from public.events e where e.id=p->>'inputId' and e.org_id=org and e.project_id=project;
  if prev.id is null or prev.payload->>'roundId' is distinct from p->>'roundId'
    or prev.payload->>'unitId' is distinct from p->>'unitId' or prev.payload->>'laneId' is distinct from p->>'laneId' then return 'Input missing or wrong round'; end if;
  expected := case p->>'step' when 'revision' then 'community' when 'consultant' then 'back_translation'
    when 'final_recording' then 'consultant' when 'final_approval' then 'final_recording' end;
  if p->>'step'='community' then
    if prev.type <> 'v1.ObtRoundStarted' then return 'Community input must be the round'; end if;
    select count(distinct e.payload->>'interactionId') into count_interactions from public.events e
      where e.org_id=org and e.project_id=project and e.type='v1.ObtInteractionSet' and e.payload->>'roundId'=p->>'roundId'
        and e.payload->>'unitId'=p->>'unitId' and e.payload->>'laneId'=p->>'laneId'
        and e.payload->>'draftId'=r->>'firstDraftId';
    if count_interactions < coalesce((policy->>'minimumInteractions')::int,1) then return 'More community interactions required'; end if;
  elsif prev.type <> 'v1.ObtStepRecorded' or prev.payload->>'step' is distinct from expected
    or prev.payload->>'decision'='changes_requested' then return 'Input stage is not complete'; end if;
  if p->>'step' in ('revision','final_recording') and not exists(select 1 from public.events e
    where e.org_id=org and e.project_id=project and e.type='v1.TakeComposed'
    and e.payload->>'takeId'=p->>'takeId' and e.payload->>'unitId'=p->>'unitId'
    and e.payload->>'laneId'=p->>'laneId' and jsonb_array_length(e.payload->'cardHashes')>0) then return 'Take missing'; end if;
  return null;
end $$;

-- Protocol 1 clients cannot interpret OBT work. Other projects keep working.
create function obt_private.requires_v2(org text, project text)
returns boolean language sql stable set search_path = public as $$
  select exists(select 1 from public.events e where e.org_id=org and e.project_id=project
    and (e.type='v1.ObtWorkspaceCreated' or
      (e.type='v1.LaneFlowSelected' and e.payload->>'flowId'='spoken_worldwide')));
$$;
alter function public.pull_events(text,text,bigint,int,int) rename to pull_events_pre_obt;
revoke all on function public.pull_events_pre_obt(text,text,bigint,int,int) from public,anon,authenticated;
create function public.pull_events(p_org_id text,p_project_id text,p_after bigint default 0,p_limit int default 500,p_client_version int default 0)
returns setof public.events language plpgsql stable security definer set search_path = public as $$
begin
  if obt_private.requires_v2(p_org_id,p_project_id) then
    if public.caller_id() is not null and public.member_role(p_org_id,p_project_id,public.caller_id()) is null then
      raise exception 'not a member' using errcode='42501';
    end if;
    if coalesce(p_client_version,0)<2 then raise exception 'Update the app for this oral workflow' using errcode='LQ001'; end if;
  end if;
  return query select * from public.pull_events_pre_obt(p_org_id,p_project_id,p_after,p_limit,p_client_version);
end $$;
revoke all on function public.pull_events(text,text,bigint,int,int) from public,anon;
grant execute on function public.pull_events(text,text,bigint,int,int) to authenticated;

-- Wrap the append boundary, including its historical-role fallback. Rejections
-- remain per-event results so offline clients retain the rejected work.
alter function public.append_events(jsonb,int) rename to append_events_pre_obt;
revoke all on function public.append_events_pre_obt(jsonb,int) from public,anon,authenticated;
create function public.append_events(p_events jsonb,p_client_version int default 0)
returns table(id text,accepted boolean,server_seq bigint,reason text)
language plpgsql security definer set search_path = public as $$
declare ev jsonb; err text;
begin
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events)>500 then raise exception 'Batch must contain at most 500 events'; end if;
  for ev in select * from jsonb_array_elements(p_events) loop
    if coalesce(p_client_version,0)<2 and (ev->>'type' like 'v1.Obt%'
      or (ev->>'type'='v1.LaneFlowSelected' and ev->'payload'->>'flowId'='spoken_worldwide')
      or obt_private.requires_v2(ev->>'orgId',ev->>'projectId')) then
      raise exception 'Update the app for this oral workflow' using errcode='LQ001';
    end if;
    -- A lost acknowledgement stays retryable after role or policy changes.
    -- Only the original caller can acknowledge their exact stored envelope.
    if (public.caller_id() is null or public.caller_id()=ev->>'actorId') and exists(
      select 1 from public.events e where e.id=ev->>'id' and e.org_id=ev->>'orgId'
        and e.project_id=ev->>'projectId' and e.actor_id=ev->>'actorId'
        and e.type=ev->>'type' and e.hlc=ev->>'hlc' and e.payload=ev->'payload') then
      return query select * from public.append_events_pre_obt(jsonb_build_array(ev),p_client_version);
      continue;
    end if;
    err := public.validate_payload(ev->>'type',ev->'payload');
    if err is null then err := obt_private.event_error(ev); end if;
    if err is not null then id:=ev->>'id'; accepted:=false; server_seq:=null; reason:=err; return next;
    else return query select * from public.append_events_pre_obt(jsonb_build_array(ev),p_client_version); end if;
  end loop;
end $$;
revoke all on function public.append_events(jsonb,int) from public,anon;
grant execute on function public.append_events(jsonb,int) to authenticated;

create function obt_private.cards(org text,project text,take_id text)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(card order by h.ord),'[]'::jsonb)
  from (select * from public.events e where e.org_id=org and e.project_id=project
    and e.type='v1.TakeComposed' and e.payload->>'takeId'=take_id order by e.hlc,e.id limit 1) t,
    jsonb_array_elements_text(t.payload->'cardHashes') with ordinality h(hash,ord)
  cross join lateral (
    select c.card from public.events r,
      jsonb_array_elements(r.payload->'cards') c(card)
    where r.org_id=org and r.project_id=project and r.type='v1.RecordingAdded'
      and c.card->>'hash'=h.hash order by r.server_seq limit 1
  ) c
  where t.org_id=org and t.project_id=project and t.type='v1.TakeComposed'
    and t.payload->>'takeId'=take_id;
$$;

create function public.obt_open_workspace(p_org text,p_project text,p_revision text,p_email text,p_language text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare actor text := public.caller_id(); person text; rev public.events; take jsonb;
  w obt_private.workspaces; wid text; h text; cards jsonb; member jsonb; unit jsonb;
begin
  if actor is null or coalesce(public.member_role(p_org,p_project,actor),'') not in ('owner','coordinator') then raise exception 'Coordinator required' using errcode='42501'; end if;
  if p_language is null or length(trim(p_language))=0 then raise exception 'Language required' using errcode='22023'; end if;
  select id::text into person from auth.users where lower(email)=lower(trim(p_email));
  if person is null then raise exception 'Back translator must first create an account' using errcode='22023'; end if;
  select * into rev from public.events e where e.org_id=p_org and e.project_id=p_project
    and e.id=p_revision and e.type='v1.ObtStepRecorded' and e.payload->>'step'='revision';
  if rev.id is null then raise exception 'Sync the selected revision first' using errcode='22023'; end if;
  -- Serialize competing requests for one input; retries return the same workspace.
  perform pg_advisory_xact_lock(hashtextextended(p_org||':'||p_project||':'||p_revision,0));
  select * into w from obt_private.workspaces where org_id=p_org and source_project=p_project and revision_id=p_revision;
  if w.workspace_id is not null then
    if w.translator_id<>person or w.language<>trim(p_language) then raise exception 'This revision already has a back translator' using errcode='22023'; end if;
    wid:=w.workspace_id;
    -- A second authorized manager needs access to copy the selected audio.
    if public.member_role(p_org,wid,actor) is null then
      member:=jsonb_build_object('profileId',actor,'role','coordinator');
      h:=public._append_event_as(wid||':manager:'||actor,p_org,wid,'v1.MemberAdded',actor,'obt',member);
      perform public._apply_member_event(p_org,wid,'v1.MemberAdded',member,h);
    end if;
  else
    -- Never convert an account that may already hold a source-project copy.
    if person=actor or exists(select 1 from public.events e where e.org_id=p_org
      and ((e.project_id=p_project and (e.actor_id=person or e.payload->>'profileId'=person))
        or (e.project_id='_org' and e.type='v1.OrgMemberAdded' and e.payload->>'profileId'=person))) then
      raise exception 'Use a separate back-translator account without prior source access' using errcode='42501';
    end if;
    wid:='obt-'||gen_random_uuid()::text;
    insert into obt_private.workspaces values(p_org,p_project,p_revision,wid,person,actor,trim(p_language));
    select e.payload into take from public.events e where e.org_id=p_org and e.project_id=p_project
      and e.type='v1.TakeComposed' and e.payload->>'takeId'=rev.payload->>'takeId' order by e.hlc,e.id limit 1;
    cards:=obt_private.cards(p_org,p_project,rev.payload->>'takeId');
    if take is null or jsonb_array_length(cards)=0 or jsonb_array_length(cards)<>jsonb_array_length(take->'cardHashes') then raise exception 'Draft audio is incomplete' using errcode='22023'; end if;
    select e.payload into unit from public.events e where e.org_id=p_org and e.project_id=p_project
      and e.type='v1.UnitAdded' and e.payload->>'unitId'=take->>'unitId' limit 1;
    perform public._append_event_as(wid||':project',p_org,wid,'v1.ProjectCreated',actor,'obt',jsonb_build_object('name','Back translation · '||coalesce(unit->>'label','Passage'),'sourceLanguoidId',trim(p_language)));
    member:=jsonb_build_object('profileId',actor,'role','coordinator');
    h:=public._append_event_as(wid||':manager',p_org,wid,'v1.MemberAdded',actor,'obt',member);
    perform public._apply_member_event(p_org,wid,'v1.MemberAdded',member,h);
    member:=jsonb_build_object('profileId',person,'role','translator');
    h:=public._append_event_as(wid||':translator',p_org,wid,'v1.MemberAdded',actor,'obt',member);
    perform public._apply_member_event(p_org,wid,'v1.MemberAdded',member,h);
    perform public._append_event_as(wid||':lane',p_org,wid,'v1.LaneAdded',actor,'obt',jsonb_build_object('laneId','output','languoidId',trim(p_language)));
    perform public._append_event_as(wid||':unit',p_org,wid,'v1.UnitAdded',actor,'obt',jsonb_build_object('unitId','passage','parentUnitId',null,'kind','passage','label',coalesce(unit->>'label','Passage'),'order','0'));
    perform public._append_event_as(wid||':input-audio',p_org,wid,'v1.RecordingAdded',actor,'obt',jsonb_build_object('recordingId','input','unitId','passage','laneId','output','kind','target','cards',cards));
    perform public._append_event_as(wid||':input',p_org,wid,'v1.TakeComposed',actor,'obt',jsonb_build_object('takeId','input','unitId','passage','laneId','output','cardHashes',take->'cardHashes','parentTakeId',null));
    perform public._append_event_as(wid||':scope',p_org,wid,'v1.ObtWorkspaceCreated',actor,'obt',jsonb_build_object('unitId','passage','laneId','output','inputTakeId','input','language',trim(p_language)));
    perform public._append_event_as(wid||':assignment',p_org,wid,'v1.AssignmentMade',actor,'obt',jsonb_build_object('unitId','passage','laneId','output','profileId',person,'role','translator'));
  end if;
  return jsonb_build_object('workspaceId',wid,'cards',obt_private.cards(p_org,p_project,rev.payload->>'takeId'));
end $$;

create function public.obt_result_packet(p_org text,p_project text,p_revision text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare w obt_private.workspaces; submitted public.events; cards jsonb; take jsonb;
begin
  if public.caller_id() is null or coalesce(public.member_role(p_org,p_project,public.caller_id()),'') not in ('owner','coordinator') then raise exception 'Coordinator required' using errcode='42501'; end if;
  select * into w from obt_private.workspaces where org_id=p_org and source_project=p_project and revision_id=p_revision;
  if w.workspace_id is null then raise exception 'No back translation workspace yet' using errcode='22023'; end if;
  select * into submitted from public.events e where e.org_id=p_org and e.project_id=w.workspace_id
    and e.actor_id=w.translator_id and e.type='v1.TakeSubmitted' and e.payload->>'takeId'<>'input'
    order by e.hlc desc,e.id desc limit 1;
  if submitted.id is null then raise exception 'Back translation has not been delivered yet' using errcode='22023'; end if;
  select e.payload into take from public.events e where e.org_id=p_org and e.project_id=w.workspace_id
    and e.type='v1.TakeComposed' and e.payload->>'takeId'=submitted.payload->>'takeId' order by e.hlc,e.id limit 1;
  cards:=obt_private.cards(p_org,w.workspace_id,submitted.payload->>'takeId');
  if take is null or take->>'unitId' is distinct from 'passage' or take->>'laneId' is distinct from 'output'
    or jsonb_array_length(cards)<>jsonb_array_length(take->'cardHashes') or jsonb_array_length(cards)=0 then raise exception 'Back translation audio missing' using errcode='22023'; end if;
  return jsonb_build_object('workspaceId',w.workspace_id,'submissionId',submitted.id,'takeId',submitted.payload->>'takeId','cards',cards,'language',w.language);
end $$;

create function public.obt_collect_result(p_org text,p_project text,p_revision text,p_submission text)
returns void language plpgsql security definer set search_path = public as $$
declare packet jsonb; rev public.events; c jsonb; take_id text; payload jsonb;
begin
  packet:=public.obt_result_packet(p_org,p_project,p_revision);
  if packet->>'submissionId'<>p_submission then raise exception 'Result changed; collect again' using errcode='22023'; end if;
  for c in select * from jsonb_array_elements(packet->'cards') loop
    if not exists(select 1 from storage.objects where bucket_id='blobs' and name=p_org||'/'||p_project||'/'||(c->>'hash')||'.'||coalesce(c->>'format','wav')) then raise exception 'Copy all result audio before collecting' using errcode='22023'; end if;
  end loop;
  select * into rev from public.events where org_id=p_org and project_id=p_project and id=p_revision;
  take_id:='bt:'||(packet->>'workspaceId')||':'||p_submission;
  payload:=jsonb_build_object('unitId',rev.payload->>'unitId','laneId',rev.payload->>'laneId');
  perform public._append_event_as(take_id||':audio',p_org,p_project,'v1.RecordingAdded',public.caller_id(),'obt',payload||jsonb_build_object('recordingId',take_id,'kind','target','cards',packet->'cards'));
  perform public._append_event_as(take_id||':take',p_org,p_project,'v1.TakeComposed',public.caller_id(),'obt',payload||jsonb_build_object('takeId',take_id,'parentTakeId',null,'cardHashes',(select jsonb_agg(part.value->>'hash') from jsonb_array_elements(packet->'cards') part(value))));
  perform public._append_event_as(take_id||':step',p_org,p_project,'v1.ObtStepRecorded',public.caller_id(),'obt',payload||jsonb_build_object('roundId',rev.payload->>'roundId','step','back_translation','inputId',p_revision,'decision','complete','takeId',take_id,'language',packet->>'language'));
end $$;

-- Include source-free workspaces in account discovery without exposing source projects.
alter function public.my_organizations() rename to my_organizations_pre_obt;
revoke all on function public.my_organizations_pre_obt() from public,anon,authenticated;
create function public.my_organizations() returns table(org_id text,project_id text,name text)
language sql stable security definer set search_path = public as $$
  select o.* from public.my_organizations_pre_obt() o
    where o.project_id is null or public.member_role(o.org_id,o.project_id,public.caller_id()) is not null
  union
  select w.org_id,w.workspace_id,'Back translation · '||w.language
    from obt_private.workspaces w where w.translator_id=public.caller_id();
$$;
revoke all on function public.obt_open_workspace(text,text,text,text,text),public.obt_result_packet(text,text,text),public.obt_collect_result(text,text,text,text),public.my_organizations() from public,anon;
grant execute on function public.obt_open_workspace(text,text,text,text,text),public.obt_result_packet(text,text,text),public.obt_collect_result(text,text,text,text),public.my_organizations() to authenticated;
-- Helpers, including renamed legacy endpoints, are never client APIs.
revoke all on all functions in schema obt_private from public,anon,authenticated;

-- The inherited RPCs use a null caller for service access. Anonymous sessions
-- also have a null caller, so explicit grants are part of source isolation.
revoke all on function public.get_snapshot(text,text,int),
  public.get_snapshot_meta(text,text,int),
  public.get_snapshot_chunk(text,text,int,bigint,int) from public,anon;
grant execute on function public.get_snapshot(text,text,int),
  public.get_snapshot_meta(text,text,int),
  public.get_snapshot_chunk(text,text,int,bigint,int) to authenticated,service_role;
revoke all on function public._append_event_as(text,text,text,text,text,text,jsonb),
  public._append_service_event(text,text,text,text,jsonb),
  public.put_snapshot(text,text,int,bigint,jsonb),public.list_partitions(),
  public.record_blob(text,text,text,bigint),public.invalidate_blob(text,text,text,text)
  from public,anon,authenticated;
grant execute on function public._append_event_as(text,text,text,text,text,text,jsonb),
  public._append_service_event(text,text,text,text,jsonb),
  public.put_snapshot(text,text,int,bigint,jsonb),public.list_partitions(),
  public.record_blob(text,text,text,bigint),public.invalidate_blob(text,text,text,text)
  to service_role;
