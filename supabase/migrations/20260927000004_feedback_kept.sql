-- Phase 2b: "Keep it, say why". The author keeps the version after feedback.
-- Rules equal core EVENT_REGISTRY['v1.FeedbackKept']. Older types fall through.
alter function public.validate_payload(text,jsonb)
  rename to validate_payload_pre_feedback_kept;
create function public.validate_payload(p_type text,p jsonb)
returns text language plpgsql immutable set search_path = '' as $$
begin
  if p_type is distinct from 'v1.FeedbackKept' then
    return public.validate_payload_pre_feedback_kept(p_type,p);
  end if;
  if jsonb_typeof(p) is distinct from 'object' then return 'payload must be an object'; end if;
  if not public._is_str(p->'keptId') then return 'keptId must be a non-empty string'; end if;
  if p ? 'checkId' and not public._is_str(p->'checkId') then return 'checkId must be a non-empty string'; end if;
  if p ? 'legacyTarget' and (jsonb_typeof(p->'legacyTarget') is distinct from 'object'
    or not public._is_str(p->'legacyTarget'->'takeId') or not public._is_str(p->'legacyTarget'->'stepId')
    or not public._is_str(p->'legacyTarget'->'reviewerId')) then
    return 'legacyTarget needs takeId, stepId and reviewerId'; end if;
  if not (p ? 'checkId') and not (p ? 'legacyTarget') then return 'name the feedback: checkId or legacyTarget'; end if;
  if p ? 'reason' and jsonb_typeof(p->'reason') is distinct from 'string' then return 'reason must be a string'; end if;
  if p ? 'reasonBlobHash' and not public._is_str(p->'reasonBlobHash') then return 'reasonBlobHash must be a non-empty string'; end if;
  if not public._is_str(p->'reason') and not public._is_str(p->'reasonBlobHash') then
    return 'say why: reason or reasonBlobHash'; end if;
  return null;
end $$;
revoke all on function public.validate_payload(text,jsonb) from public,anon;
grant execute on function public.validate_payload(text,jsonb) to authenticated,service_role;

alter function public.event_privilege(text,jsonb)
  rename to event_privilege_pre_feedback_kept;
create function public.event_privilege(p_type text,p jsonb)
returns text language sql immutable set search_path = '' as $$
  select case when p_type in ('v1.FeedbackKept')
    then 'translate' else public.event_privilege_pre_feedback_kept(p_type,p) end;
$$;
revoke all on function public.event_privilege(text,jsonb) from public,anon;
grant execute on function public.event_privilege(text,jsonb) to authenticated,service_role;
-- New event schemas do not change transport compatibility.
