-- Phase 2b: a check that happened outside the app, logged afterwards.
-- Rules equal core EVENT_REGISTRY['v1.CheckLogged']. Older types fall through.
alter function public.validate_payload(text,jsonb)
  rename to validate_payload_pre_check_logged;
create function public.validate_payload(p_type text,p jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare c jsonb;
begin
  if p_type is distinct from 'v1.CheckLogged' then
    return public.validate_payload_pre_check_logged(p_type,p);
  end if;
  if jsonb_typeof(p) is distinct from 'object' then return 'payload must be an object'; end if;
  if not public._is_str(p->'checkId') or not public._is_str(p->'unitId') or not public._is_str(p->'laneId')
    or not public._is_str(p->'takeId') or not public._is_str(p->'kindId') then
    return 'checkId, unitId, laneId, takeId and kindId must be non-empty strings'; end if;
  if (p ? 'stepId' and not public._is_str(p->'stepId'))
    or (p ? 'requestId' and not public._is_str(p->'requestId'))
    or (p ? 'commentBlobHash' and not public._is_str(p->'commentBlobHash'))
    or (p ? 'givenBy' and not public._is_str(p->'givenBy'))
    or (p ? 'place' and not public._is_str(p->'place')) then
    return 'stepId, requestId, commentBlobHash, givenBy and place must be non-empty strings when present'; end if;
  if p ? 'comment' and jsonb_typeof(p->'comment') is distinct from 'string' then return 'comment must be a string'; end if;
  if jsonb_typeof(p->'outcome') is distinct from 'string' or p->>'outcome' not in ('looks_good','needs_changes') then
    return 'outcome must be looks_good or needs_changes'; end if;
  if p->>'outcome'='needs_changes' and not public._is_str(p->'comment') and not public._is_str(p->'commentBlobHash') then
    return 'needs changes must say what: comment or commentBlobHash'; end if;
  if p ? 'people' and (jsonb_typeof(p->'people') is distinct from 'number'
    or (p->>'people')::numeric <> trunc((p->>'people')::numeric) or (p->>'people')::numeric < 1) then
    return 'people must be a whole number of at least 1'; end if;
  if p ? 'evidence' then
    if jsonb_typeof(p->'evidence') is distinct from 'array' then return 'evidence must be an array'; end if;
    for c in select * from jsonb_array_elements(p->'evidence') loop
      if jsonb_typeof(c) is distinct from 'object' or not public._is_str(c->'hash') or jsonb_typeof(c->'durationMs') is distinct from 'number' then
        return 'evidence entries need a hash and durationMs'; end if;
    end loop;
  end if;
  return null;
end $$;
revoke all on function public.validate_payload(text,jsonb) from public,anon;
grant execute on function public.validate_payload(text,jsonb) to authenticated,service_role;

-- Translators hold send_to_reviewers: they may log a check they ran.
-- CheckRecorded stays `review`.
alter function public.event_privilege(text,jsonb)
  rename to event_privilege_pre_check_logged;
create function public.event_privilege(p_type text,p jsonb)
returns text language sql immutable set search_path = '' as $$
  select case p_type
    when 'v1.CheckLogged' then 'send_to_reviewers'
    else public.event_privilege_pre_check_logged(p_type,p) end;
$$;
revoke all on function public.event_privilege(text,jsonb) from public,anon;
grant execute on function public.event_privilege(text,jsonb) to authenticated,service_role;
-- New event schemas do not change transport compatibility.
