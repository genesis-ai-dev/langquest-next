-- Phase 2b: anchored notes (v1.ContextItemAdded).
-- Rules equal core EVENT_REGISTRY['v1.ContextItemAdded'] (contextHomeError,
-- contextAnchorError, optMs). Older types fall through unchanged.

create or replace function public._is_ms(v jsonb) returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(v) = 'number' and (v#>>'{}')::numeric >= 0 and (v#>>'{}')::numeric = trunc((v#>>'{}')::numeric);
$$;

create or replace function public._context_home_error(h jsonb) returns text language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(h) is distinct from 'object' then return 'home must be an object'; end if;
  if jsonb_typeof(h->'level') is distinct from 'string' or h->>'level' not in ('project','lane','unit') then
    return 'home.level must be project, lane or unit'; end if;
  if (h ? 'laneId' and not public._is_str(h->'laneId')) or (h ? 'unitId' and not public._is_str(h->'unitId')) then
    return 'home.laneId and home.unitId must be non-empty strings when present'; end if;
  if h->>'level' = 'lane' and not (h ? 'laneId') then return 'a lane home needs laneId'; end if;
  if h->>'level' = 'unit' and not (h ? 'unitId') then return 'a unit home needs unitId'; end if;
  return null;
end $$;

create or replace function public._context_anchor_error(a jsonb) returns text language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(a) is distinct from 'object' then return 'anchors entries must be objects'; end if;
  case a->>'type'
    when 'unit' then
      if not public._is_str(a->'unitId') then return 'unitId must be a non-empty string'; end if;
    when 'verse' then
      if not public._is_str(a->'unitId') or not public._is_str(a->'verse') then return 'unitId and verse must be non-empty strings'; end if;
      if a ? 'translation' and not public._is_str(a->'translation') then return 'translation must be a non-empty string'; end if;
      if a ? 'atMs' and not public._is_ms(a->'atMs') then return 'atMs must be whole milliseconds'; end if;
    when 'take' then
      if not public._is_str(a->'takeId') then return 'takeId must be a non-empty string'; end if;
      if (a ? 'atMs' and not public._is_ms(a->'atMs')) or (a ? 'endMs' and not public._is_ms(a->'endMs')) then
        return 'atMs and endMs must be whole milliseconds'; end if;
    when 'study' then
      if not public._is_str(a->'materialId') or not public._is_str(a->'stepId') then return 'materialId and stepId must be non-empty strings'; end if;
      if a ? 'sectionId' and not public._is_str(a->'sectionId') then return 'sectionId must be a non-empty string'; end if;
      if a ? 'atMs' and not public._is_ms(a->'atMs') then return 'atMs must be whole milliseconds'; end if;
    when 'term' then
      if not public._is_str(a->'termId') then return 'termId must be a non-empty string'; end if;
    else
      return 'anchor type must be unit, verse, take, study or term';
  end case;
  return null;
end $$;

alter function public.validate_payload(text,jsonb)
  rename to validate_payload_pre_context_items;
create function public.validate_payload(p_type text,p jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare a jsonb; err text;
begin
  if p_type is distinct from 'v1.ContextItemAdded' then
    return public.validate_payload_pre_context_items(p_type,p);
  end if;
  if jsonb_typeof(p) is distinct from 'object' then return 'payload must be an object'; end if;
  if not public._is_str(p->'itemId') or not public._is_str(p->'kind') then return 'itemId and kind must be non-empty strings'; end if;
  if p ? 'text' and jsonb_typeof(p->'text') is distinct from 'string' then return 'text must be a string'; end if;
  if (p ? 'blobHash' and not public._is_str(p->'blobHash'))
    or (p ? 'photoHash' and not public._is_str(p->'photoHash'))
    or (p ? 'aboutTakeId' and not public._is_str(p->'aboutTakeId')) then
    return 'blobHash, photoHash and aboutTakeId must be non-empty strings when present'; end if;
  err := public._context_home_error(p->'home');
  if err is not null then return err; end if;
  if jsonb_typeof(p->'anchors') is distinct from 'array' then return 'anchors must be an array'; end if;
  for a in select * from jsonb_array_elements(p->'anchors') loop
    err := public._context_anchor_error(a);
    if err is not null then return err; end if;
  end loop;
  if not public._is_str(p->'text') and not public._is_str(p->'blobHash') and not public._is_str(p->'photoHash') then
    return 'say something: text, blobHash or photoHash'; end if;
  return null;
end $$;
revoke all on function public.validate_payload(text,jsonb) from public,anon;
grant execute on function public.validate_payload(text,jsonb) to authenticated,service_role;

-- Notes are reference work: fill_reference (translators hold it).
alter function public.event_privilege(text,jsonb)
  rename to event_privilege_pre_context_items;
create function public.event_privilege(p_type text,p jsonb)
returns text language sql immutable set search_path = '' as $$
  select case p_type
    when 'v1.ContextItemAdded' then 'fill_reference'
    else public.event_privilege_pre_context_items(p_type,p) end;
$$;
revoke all on function public.event_privilege(text,jsonb) from public,anon;
grant execute on function public.event_privilege(text,jsonb) to authenticated,service_role;
-- New event schemas do not change transport compatibility.
