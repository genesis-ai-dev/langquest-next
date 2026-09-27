-- Phase 2a: one check of one review kind on one version.
-- Rules equal core EVENT_REGISTRY['v1.CheckRecorded']. Older types fall through.
alter function public.validate_payload(text,jsonb)
  rename to validate_payload_pre_check_recorded;
create function public.validate_payload(p_type text,p jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare q jsonb; v jsonb;
begin
  if p_type is distinct from 'v1.CheckRecorded' then
    return public.validate_payload_pre_check_recorded(p_type,p);
  end if;
  if jsonb_typeof(p) is distinct from 'object' then return 'payload must be an object'; end if;
  if not public._is_str(p->'checkId') or not public._is_str(p->'unitId') or not public._is_str(p->'laneId')
    or not public._is_str(p->'takeId') or not public._is_str(p->'kindId') then
    return 'checkId, unitId, laneId, takeId and kindId must be non-empty strings'; end if;
  if (p ? 'stepId' and not public._is_str(p->'stepId'))
    or (p ? 'requestId' and not public._is_str(p->'requestId'))
    or (p ? 'commentBlobHash' and not public._is_str(p->'commentBlobHash')) then
    return 'stepId, requestId and commentBlobHash must be non-empty strings when present'; end if;
  if p ? 'comment' and jsonb_typeof(p->'comment') is distinct from 'string' then return 'comment must be a string'; end if;
  if jsonb_typeof(p->'outcome') is distinct from 'string' or p->>'outcome' not in ('looks_good','needs_changes') then
    return 'outcome must be looks_good or needs_changes'; end if;
  if p->>'outcome'='needs_changes' and not public._is_str(p->'comment') and not public._is_str(p->'commentBlobHash') then
    return 'needs changes must say what: comment or commentBlobHash'; end if;
  if p ? 'answers' then
    if jsonb_typeof(p->'answers') is distinct from 'object' then return 'answers must map question ids to strings'; end if;
    for v in select value from jsonb_each(p->'answers') loop
      if jsonb_typeof(v) is distinct from 'string' then return 'answers must map question ids to strings'; end if;
    end loop;
  end if;
  if p ? 'skippedQuestions' then
    if jsonb_typeof(p->'skippedQuestions') is distinct from 'array' then
      return 'skippedQuestions entries need questionId and reason'; end if;
    for q in select * from jsonb_array_elements(p->'skippedQuestions') loop
      if jsonb_typeof(q) is distinct from 'object' or not public._is_str(q->'questionId') or not public._is_str(q->'reason') then
        return 'skippedQuestions entries need questionId and reason'; end if;
    end loop;
  end if;
  return null;
end $$;
revoke all on function public.validate_payload(text,jsonb) from public,anon;
grant execute on function public.validate_payload(text,jsonb) to authenticated,service_role;

alter function public.event_privilege(text,jsonb)
  rename to event_privilege_pre_check_recorded;
create function public.event_privilege(p_type text,p jsonb)
returns text language sql immutable set search_path = '' as $$
  select case when p_type in ('v1.CheckRecorded')
    then 'review' else public.event_privilege_pre_check_recorded(p_type,p) end;
$$;
revoke all on function public.event_privilege(text,jsonb) from public,anon;
grant execute on function public.event_privilege(text,jsonb) to authenticated,service_role;
-- New event schemas do not change transport compatibility.
