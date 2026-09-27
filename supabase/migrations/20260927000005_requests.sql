-- Phase 2b: asks as requests with their own id, and withdrawing them.
-- Rules equal core EVENT_REGISTRY['v1.RequestMade' | 'v1.RequestWithdrawn'].
-- Older types fall through unchanged (v1.AssignmentMade keeps its rule).
alter function public.validate_payload(text,jsonb)
  rename to validate_payload_pre_requests;
create function public.validate_payload(p_type text,p jsonb)
returns text language plpgsql immutable set search_path = '' as $$
begin
  if p_type is distinct from 'v1.RequestMade' and p_type is distinct from 'v1.RequestWithdrawn' then
    return public.validate_payload_pre_requests(p_type,p);
  end if;
  if jsonb_typeof(p) is distinct from 'object' then return 'payload must be an object'; end if;
  if p_type = 'v1.RequestWithdrawn' then
    if not public._is_str(p->'requestId') then return 'requestId must be a non-empty string'; end if;
    if p ? 'reason' and jsonb_typeof(p->'reason') is distinct from 'string' then return 'reason must be a string'; end if;
    return null;
  end if;
  if not public._is_str(p->'requestId') or not public._is_str(p->'unitId') or not public._is_str(p->'laneId') then
    return 'requestId, unitId and laneId must be non-empty strings'; end if;
  if jsonb_typeof(p->'what') is distinct from 'string' or p->>'what' not in ('record','check') then
    return 'what must be record or check'; end if;
  if (p ? 'kindId' and not public._is_str(p->'kindId'))
    or (p ? 'assigneeId' and not public._is_str(p->'assigneeId'))
    or (p ? 'noteBlobHash' and not public._is_str(p->'noteBlobHash'))
    or (p ? 'questionSetId' and not public._is_str(p->'questionSetId')) then
    return 'kindId, assigneeId, noteBlobHash and questionSetId must be non-empty strings when present'; end if;
  if p ? 'note' and jsonb_typeof(p->'note') is distinct from 'string' then return 'note must be a string'; end if;
  if p ? 'dueDate' and (jsonb_typeof(p->'dueDate') is distinct from 'string' or p->>'dueDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then
    return 'dueDate must be an ISO date (YYYY-MM-DD)'; end if;
  return null;
end $$;
revoke all on function public.validate_payload(text,jsonb) from public,anon;
grant execute on function public.validate_payload(text,jsonb) to authenticated,service_role;

-- Asking to record assigns work; asking for a check sends to reviewers.
-- Withdrawing needs send_to_reviewers; the reducer honours a withdrawal
-- only from the asker or an owner or coordinator.
alter function public.event_privilege(text,jsonb)
  rename to event_privilege_pre_requests;
create function public.event_privilege(p_type text,p jsonb)
returns text language sql immutable set search_path = '' as $$
  select case p_type
    when 'v1.RequestMade' then case when p->>'what' = 'check' then 'send_to_reviewers' else 'assign_work' end
    when 'v1.RequestWithdrawn' then 'send_to_reviewers'
    else public.event_privilege_pre_requests(p_type,p) end;
$$;
revoke all on function public.event_privilege(text,jsonb) from public,anon;
grant execute on function public.event_privilege(text,jsonb) to authenticated,service_role;
-- New event schemas do not change transport compatibility.
