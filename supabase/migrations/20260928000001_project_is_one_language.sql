-- A project is one target language (docs/decisions.md section 28). Buckets are
-- org and project; a lane is the project's language, never a level of its own.
-- Event shapes are unchanged: laneId stays in every event that has it, and
-- stored lane-scoped memberships still fold and can still be removed.
--
-- New rules, refused per event like any other business rule:
--   * v1.LaneAdded for a second, different lane in a project.
--   * v1.OrgMemberAdded with scope.level = 'lane'.
-- Same body as 20260925011736 plus the call to _one_language_error.

create or replace function public._one_language_error(ev jsonb) returns text
language plpgsql stable set search_path = '' as $$
begin
  if ev->>'type' = 'v1.LaneAdded' and exists (
    select 1 from public.events e
    where e.org_id = ev->>'orgId' and e.project_id = ev->>'projectId'
      and e.type = 'v1.LaneAdded' and e.payload->>'laneId' is distinct from ev->'payload'->>'laneId') then
    return 'a project has one language; create another project for another language';
  end if;
  if ev->>'type' = 'v1.OrgMemberAdded' and ev->'payload'->'scope'->>'level' = 'lane' then
    return 'invalid payload: scope.level must be org or project';
  end if;
  return null;
end $$;
revoke all on function public._one_language_error(jsonb) from public,anon,authenticated;

create or replace function public.append_events(p_events jsonb,p_client_version int default 0)
returns table(id text,accepted boolean,server_seq bigint,reason text)
language plpgsql security definer set search_path = '' as $$
declare ev jsonb; err text;
begin
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events)>500 then raise exception 'Batch must contain at most 500 events' using errcode='22023'; end if;
  for ev in select * from jsonb_array_elements(p_events) loop
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
    if err is not null then err := 'invalid payload: ' || err;
    else err := obt_private.event_error(ev); end if;
    if err is null then err := public._one_language_error(ev); end if;
    if err is not null then id:=ev->>'id'; accepted:=false; server_seq:=null; reason:=err; return next;
    else return query select * from public.append_events_pre_obt(jsonb_build_array(ev),p_client_version); end if;
  end loop;
end $$;
revoke all on function public.append_events(jsonb,int) from public,anon;
grant execute on function public.append_events(jsonb,int) to authenticated,service_role;
