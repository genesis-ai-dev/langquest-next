-- Preserve the legacy error contract used by installed clients to classify
-- invalid payloads and oversized requests. Per-event authorization is unchanged.
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
    if err is not null then id:=ev->>'id'; accepted:=false; server_seq:=null; reason:=err; return next;
    else return query select * from public.append_events_pre_obt(jsonb_build_array(ev),p_client_version); end if;
  end loop;
end $$;
revoke all on function public.append_events(jsonb,int) from public,anon;
grant execute on function public.append_events(jsonb,int) to authenticated,service_role;

