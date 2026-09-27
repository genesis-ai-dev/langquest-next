-- Phase 2b: content a producing kind made from a version (a back translation).
-- Rules equal core EVENT_REGISTRY['v1.ContentProduced']. Older types fall through.
-- The content carries its own cards; it is never a TakeComposed in the lane.
alter function public.validate_payload(text,jsonb)
  rename to validate_payload_pre_content_produced;
create function public.validate_payload(p_type text,p jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare c jsonb;
begin
  if p_type is distinct from 'v1.ContentProduced' then
    return public.validate_payload_pre_content_produced(p_type,p);
  end if;
  if jsonb_typeof(p) is distinct from 'object' then return 'payload must be an object'; end if;
  if not public._is_str(p->'contentId') or not public._is_str(p->'unitId') or not public._is_str(p->'laneId')
    or not public._is_str(p->'fromTakeId') or not public._is_str(p->'kindId') or not public._is_str(p->'language') then
    return 'contentId, unitId, laneId, fromTakeId, kindId and language must be non-empty strings'; end if;
  if p ? 'note' and jsonb_typeof(p->'note') is distinct from 'string' then return 'note must be a string'; end if;
  if (p ? 'noteBlobHash' and not public._is_str(p->'noteBlobHash'))
    or (p ? 'requestId' and not public._is_str(p->'requestId')) then
    return 'noteBlobHash and requestId must be non-empty strings when present'; end if;
  if jsonb_typeof(p->'cards') is distinct from 'array' then return 'cards must be an array'; end if;
  for c in select * from jsonb_array_elements(p->'cards') loop
    if jsonb_typeof(c) is distinct from 'object' or not public._is_str(c->'hash') or jsonb_typeof(c->'durationMs') is distinct from 'number' then
      return 'cards entries need a hash and durationMs'; end if;
  end loop;
  if jsonb_array_length(p->'cards') = 0 then return 'cards must hold at least one card'; end if;
  return null;
end $$;
revoke all on function public.validate_payload(text,jsonb) from public,anon;
grant execute on function public.validate_payload(text,jsonb) to authenticated,service_role;

-- The back-translator is asked as a reviewer: privilege review.
alter function public.event_privilege(text,jsonb)
  rename to event_privilege_pre_content_produced;
create function public.event_privilege(p_type text,p jsonb)
returns text language sql immutable set search_path = '' as $$
  select case p_type
    when 'v1.ContentProduced' then 'review'
    else public.event_privilege_pre_content_produced(p_type,p) end;
$$;
revoke all on function public.event_privilege(text,jsonb) from public,anon;
grant execute on function public.event_privilege(text,jsonb) to authenticated,service_role;
-- New event schemas do not change transport compatibility.
