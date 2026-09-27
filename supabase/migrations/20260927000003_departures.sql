-- Phase 2b: departures from the flow for one passage, and bringing them back.
-- Rules equal core EVENT_REGISTRY['v1.StepSetAside' | 'v1.CheckpointOverridden'
-- | 'v1.DepartureUndone']. Older types fall through unchanged.
alter function public.validate_payload(text,jsonb)
  rename to validate_payload_pre_departures;
create function public.validate_payload(p_type text,p jsonb)
returns text language plpgsql immutable set search_path = '' as $$
begin
  if p_type is distinct from 'v1.StepSetAside' and p_type is distinct from 'v1.CheckpointOverridden'
    and p_type is distinct from 'v1.DepartureUndone' then
    return public.validate_payload_pre_departures(p_type,p);
  end if;
  if jsonb_typeof(p) is distinct from 'object' then return 'payload must be an object'; end if;
  if p_type = 'v1.DepartureUndone' then
    if not public._is_str(p->'undoId') or not public._is_str(p->'departureId') then
      return 'undoId and departureId must be non-empty strings'; end if;
    if p ? 'reason' and jsonb_typeof(p->'reason') is distinct from 'string' then return 'reason must be a string'; end if;
    if jsonb_typeof(p->'departureKind') is distinct from 'string' or p->>'departureKind' not in ('set_aside','override') then
      return 'departureKind must be set_aside or override'; end if;
    return null;
  end if;
  -- v1.StepSetAside and v1.CheckpointOverridden
  if not public._is_str(p->'departureId') or not public._is_str(p->'unitId')
    or not public._is_str(p->'laneId') or not public._is_str(p->'stepId') then
    return 'departureId, unitId, laneId and stepId must be non-empty strings'; end if;
  if p_type = 'v1.StepSetAside' and p ? 'kindId' and not public._is_str(p->'kindId') then
    return 'kindId must be a non-empty string'; end if;
  if p ? 'reason' and jsonb_typeof(p->'reason') is distinct from 'string' then return 'reason must be a string'; end if;
  if p ? 'reasonBlobHash' and not public._is_str(p->'reasonBlobHash') then return 'reasonBlobHash must be a non-empty string'; end if;
  if not public._is_str(p->'reason') and not public._is_str(p->'reasonBlobHash') then
    return 'say why: reason or reasonBlobHash'; end if;
  return null;
end $$;
revoke all on function public.validate_payload(text,jsonb) from public,anon;
grant execute on function public.validate_payload(text,jsonb) to authenticated,service_role;

-- Undoing a departure needs the privilege of the departure it names. The
-- reducer applies an undo only when departureKind matches the departure, so
-- a translator cannot bring back an override by calling it a set-aside.
alter function public.event_privilege(text,jsonb)
  rename to event_privilege_pre_departures;
create function public.event_privilege(p_type text,p jsonb)
returns text language sql immutable set search_path = '' as $$
  select case p_type
    when 'v1.StepSetAside' then 'translate'
    when 'v1.CheckpointOverridden' then 'manage_flows'
    when 'v1.DepartureUndone' then case when p->>'departureKind' = 'set_aside' then 'translate' else 'manage_flows' end
    else public.event_privilege_pre_departures(p_type,p) end;
$$;
revoke all on function public.event_privilege(text,jsonb) from public,anon;
grant execute on function public.event_privilege(text,jsonb) to authenticated,service_role;
-- New event schemas do not change transport compatibility.
