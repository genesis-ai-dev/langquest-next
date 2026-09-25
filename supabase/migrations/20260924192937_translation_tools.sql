-- Optional written versions and metadata for nondestructive audio edits.
create unique index events_text_translation_identity
  on public.events(org_id,project_id,(payload->>'translationId'))
  where type='v1.TextTranslationCreated';
alter function public.validate_payload(text,jsonb)
  rename to validate_payload_pre_translation_tools;
create function public.validate_payload(p_type text,p jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare m jsonb; previous_start numeric := -1;
begin
  if p_type not in ('v1.TextTranslationCreated','v1.TakeMetadataSet') then
    return public.validate_payload_pre_translation_tools(p_type,p);
  end if;
  if jsonb_typeof(p) is distinct from 'object'
    or not public._is_str(p->'unitId') or not public._is_str(p->'laneId') then
    return 'Passage and language are required';
  end if;
  if p_type='v1.TextTranslationCreated' then
    if not public._is_str(p->'translationId') or not public._is_str(p->'text')
      or length(trim(p->>'text'))=0 or length(p->>'text')>50000
      or coalesce(p->>'origin','') not in ('written','asr','ai')
      or not (p ? 'parentTranslationId')
      or (p->'parentTranslationId'<>'null'::jsonb
        and not public._is_str(p->'parentTranslationId'))
      or p->>'parentTranslationId'=p->>'translationId'
      or (p ? 'sourceText' and (jsonb_typeof(p->'sourceText') is distinct from 'string'
        or length(p->>'sourceText')>50000)) then return 'Invalid written translation'; end if;
    return null;
  end if;
  if not public._is_str(p->'takeId') or not public._is_str(p->'name')
    or length(trim(p->>'name'))=0 or length(p->>'name')>200
    or jsonb_typeof(p->'milestones') is distinct from 'array' then return 'Invalid recording metadata'; end if;
  if jsonb_array_length(p->'milestones')>1000 then return 'Too many milestones'; end if;
  for m in select * from jsonb_array_elements(p->'milestones') loop
    if jsonb_typeof(m->'verseStart') is distinct from 'number'
      or jsonb_typeof(m->'verseEnd') is distinct from 'number'
      or jsonb_typeof(m->'startMs') is distinct from 'number' then return 'Invalid verse milestone'; end if;
    if (m->>'verseStart')::numeric<1
      or trunc((m->>'verseStart')::numeric)<>(m->>'verseStart')::numeric
      or trunc((m->>'verseEnd')::numeric)<>(m->>'verseEnd')::numeric
      or (m->>'verseEnd')::numeric<(m->>'verseStart')::numeric
      or (m->>'startMs')::numeric<0
      or (m->>'startMs')::numeric<previous_start then return 'Invalid verse milestone'; end if;
    if m ? 'endMs' then
      if jsonb_typeof(m->'endMs') is distinct from 'number' then return 'Invalid milestone end'; end if;
      if (m->>'endMs')::numeric <= (m->>'startMs')::numeric then return 'Invalid milestone range'; end if;
    end if;
    previous_start := (m->>'startMs')::numeric;
  end loop;
  return null;
end $$;
revoke all on function public.validate_payload(text,jsonb) from public,anon;
grant execute on function public.validate_payload(text,jsonb) to authenticated,service_role;

alter function public.event_privilege(text,jsonb)
  rename to event_privilege_pre_translation_tools;
create function public.event_privilege(p_type text,p jsonb)
returns text language sql immutable set search_path = '' as $$
  select case when p_type in ('v1.TextTranslationCreated','v1.TakeMetadataSet')
    then 'translate' else public.event_privilege_pre_translation_tools(p_type,p) end;
$$;
revoke all on function public.event_privilege(text,jsonb) from public,anon;
grant execute on function public.event_privilege(text,jsonb) to authenticated,service_role;

alter function obt_private.event_error(jsonb) rename to event_error_pre_translation_tools;
create function obt_private.event_error(ev jsonb) returns text
language plpgsql stable security definer set search_path = '' as $$
declare p jsonb := ev->'payload'; typ text := ev->>'type';
  prior public.events; err text; material jsonb; locked boolean;
begin
  -- Metadata may accompany output audio in a source-free workspace.
  err := obt_private.event_error_pre_translation_tools(case when typ='v1.TakeMetadataSet'
    then jsonb_set(ev,'{type}','"v1.TakeArchived"') else ev end);
  if err is not null then return err; end if;
  if typ='v1.MaterialFieldSet' then
    select e.payload into material from public.events e
      where e.org_id=ev->>'orgId' and e.project_id=ev->>'projectId'
      and e.type='v1.MaterialDefined' and e.payload->>'materialId'=p->>'materialId'
      order by e.hlc,e.id limit 1;
    select (e.payload->>'locked')::boolean into locked from public.events e
      where e.org_id=ev->>'orgId' and e.project_id=ev->>'projectId'
      and e.type='v1.MaterialLocked' and e.payload->>'materialId'=p->>'materialId'
      order by e.hlc desc,e.id desc limit 1;
    if coalesce(locked,false) and not public.may_emit(ev->>'orgId',ev->>'projectId',
      ev->>'actorId','v1.MaterialLocked',jsonb_build_object('laneId',material->'scope'->>'laneId')) then
      return 'This reference material is locked';
    end if;
    if material->>'kind'='fia_progress' and not starts_with(p->>'fieldId',
      'fia-progress:'||(ev->>'actorId')||':') then return 'Only your own FIA progress can be changed'; end if;
  end if;
  if typ='v1.TextTranslationCreated' then
    if exists(select 1 from public.events e where e.org_id=ev->>'orgId'
      and e.project_id=ev->>'projectId' and e.type=typ
      and e.payload->>'translationId'=p->>'translationId') then
      return 'Translation versions are immutable; create a child version'; end if;
    if p->>'parentTranslationId' is not null and not exists(
      select 1 from public.events e where e.org_id=ev->>'orgId'
      and e.project_id=ev->>'projectId' and e.type=typ
      and e.payload->>'translationId'=p->>'parentTranslationId'
      and e.payload->>'unitId'=p->>'unitId'
      and e.payload->>'laneId'=p->>'laneId') then return 'Parent translation not found in this passage'; end if;
  elsif typ='v1.TakeMetadataSet' then
    select * into prior from public.events e where e.org_id=ev->>'orgId'
      and e.project_id=ev->>'projectId' and e.type='v1.TakeComposed'
      and e.payload->>'takeId'=p->>'takeId' order by e.hlc,e.id limit 1;
    if prior.id is null or prior.actor_id<>ev->>'actorId'
      or prior.payload->>'unitId' is distinct from p->>'unitId'
      or prior.payload->>'laneId' is distinct from p->>'laneId' then
      return 'Metadata requires your own take in this passage'; end if;
    if exists(select 1 from public.events e where e.org_id=ev->>'orgId'
      and e.project_id=ev->>'projectId' and e.type='v1.TakeSubmitted'
      and e.payload->>'takeId'=p->>'takeId') then return 'Create a child take before editing submitted audio'; end if;
  end if;
  return null;
end $$;
revoke all on function obt_private.event_error(jsonb) from public,anon,authenticated;

-- AI access derives permissions on the server, including source-free restrictions.
create function public.translation_assist_allowed(p_org text,p_project text,p_lane text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.caller_id() is not null
    and public.member_role(p_org,p_project,public.caller_id()) is not null
    and exists(select 1 from public.events e where e.org_id=p_org
      and e.project_id=p_project and e.type='v1.LaneAdded'
      and e.payload->>'laneId'=p_lane)
    and public.may_emit(p_org,p_project,public.caller_id(),
      'v1.TextTranslationCreated',jsonb_build_object('laneId',p_lane))
    and not exists(select 1 from obt_private.workspaces w
      where w.org_id=p_org and w.workspace_id=p_project);
$$;
revoke all on function public.translation_assist_allowed(text,text,text) from public,anon;
grant execute on function public.translation_assist_allowed(text,text,text) to authenticated;
-- New event schemas do not change transport compatibility.

-- Projects are invitation-based. Retain stored flags for audit, but do not
-- expose the historical discovery catalog or allow clients to publish it.
revoke select on public.public_projects, public.project_visibility from anon,authenticated;
revoke execute on function public.set_project_visibility(text,text,boolean) from anon,authenticated;

-- Bound provider usage across server instances, not only within one isolate.
create schema if not exists translation_private;
revoke all on schema translation_private from public,anon,authenticated;
create table translation_private.assistance_usage (
  actor_id text not null,
  hour timestamptz not null,
  requests integer not null check(requests between 1 and 30),
  primary key(actor_id,hour)
);
alter table translation_private.assistance_usage enable row level security;
create function public.claim_translation_assist(p_org text,p_project text,p_lane text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare actor text := public.caller_id(); claimed integer;
begin
  if not public.translation_assist_allowed(p_org,p_project,p_lane) then
    raise exception 'Translation access required' using errcode='42501';
  end if;
  delete from translation_private.assistance_usage
    where actor_id=actor and hour < now()-interval '1 day';
  insert into translation_private.assistance_usage(actor_id,hour,requests)
    values(actor,date_trunc('hour',now()),1)
    on conflict(actor_id,hour) do update
      set requests=translation_private.assistance_usage.requests+1
      where translation_private.assistance_usage.requests<30
    returning requests into claimed;
  return claimed is not null;
end $$;
revoke all on function public.claim_translation_assist(text,text,text) from public,anon;
grant execute on function public.claim_translation_assist(text,text,text) to authenticated;
