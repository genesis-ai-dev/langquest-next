-- Sync integrity: client/reducer age never blocks event transport.
-- Keep the existing RPC signatures for every already-installed client.
create or replace function public.require_client_version(p_client_version int)
returns void language plpgsql immutable set search_path = '' as $$
begin
  -- Compatibility shim only. Authentication and per-event validation stay in RPCs.
  return;
end $$;
revoke all on function public.require_client_version(int) from public, anon;
grant execute on function public.require_client_version(int) to authenticated, service_role;
alter table public.server_config alter column min_client_version set default 0;
update public.server_config set min_client_version = 0;
alter table public.server_config add constraint sync_never_requires_client_upgrade
  check (min_client_version = 0);
comment on column public.server_config.min_client_version is
  'Deprecated, permanently zero. Never gate append/pull on app or reducer version. See AGENTS.md.';

-- Preserve source-free workspace checks and per-event refusals at every age.
create or replace function public.pull_events(p_org_id text,p_project_id text,p_after bigint default 0,p_limit int default 500,p_client_version int default 0)
returns setof public.events language plpgsql stable security definer set search_path = '' as $$
begin
  if obt_private.requires_v2(p_org_id,p_project_id) then
    if public.caller_id() is not null and public.member_role(p_org_id,p_project_id,public.caller_id()) is null then
      raise exception 'not a member' using errcode='42501';
    end if;
  end if;
  return query select * from public.pull_events_pre_obt(p_org_id,p_project_id,p_after,p_limit,p_client_version);
end $$;
revoke all on function public.pull_events(text,text,bigint,int,int) from public,anon;
grant execute on function public.pull_events(text,text,bigint,int,int) to authenticated,service_role;

-- Wrap the append boundary, including its historical-role fallback. Rejections
-- remain per-event results so offline clients retain the rejected work.
revoke all on function public.append_events_pre_obt(jsonb,int) from public,anon,authenticated;
create or replace function public.append_events(p_events jsonb,p_client_version int default 0)
returns table(id text,accepted boolean,server_seq bigint,reason text)
language plpgsql security definer set search_path = '' as $$
declare ev jsonb; err text;
begin
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events)>500 then raise exception 'Batch must contain at most 500 events'; end if;
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
    if err is null then err := obt_private.event_error(ev); end if;
    if err is not null then id:=ev->>'id'; accepted:=false; server_seq:=null; reason:=err; return next;
    else return query select * from public.append_events_pre_obt(jsonb_build_array(ev),p_client_version); end if;
  end loop;
end $$;
revoke all on function public.append_events(jsonb,int) from public,anon;
grant execute on function public.append_events(jsonb,int) to authenticated,service_role;

