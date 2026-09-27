-- Phase 2a: flow steps that hold review kinds, and project review kinds.
-- Rules equal core EVENT_REGISTRY (packages/core/src/eventRegistry.ts).
-- Every older type falls through to the previous function unchanged.
alter function public.validate_payload(text,jsonb)
  rename to validate_payload_pre_flow_kinds;
create function public.validate_payload(p_type text,p jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare k jsonb;
begin
  if p_type not in ('v2.WorkflowStepSet','v1.ReviewKindDefined') then
    return public.validate_payload_pre_flow_kinds(p_type,p);
  end if;
  if jsonb_typeof(p) is distinct from 'object' then return 'payload must be an object'; end if;
  if p_type='v2.WorkflowStepSet' then
    if not public._is_str(p->'stepId') or not public._is_str(p->'order') then
      return 'stepId and order must be non-empty strings'; end if;
    if p ? 'laneId' and not public._is_str(p->'laneId') then return 'laneId must be a non-empty string'; end if;
    if p ? 'label' and jsonb_typeof(p->'label') is distinct from 'string' then return 'label must be a string'; end if;
    if jsonb_typeof(p->'kindIds') is distinct from 'array'
      or jsonb_array_length(p->'kindIds') not between 1 and 20 then
      return 'kindIds must hold 1 to 20 non-empty strings'; end if;
    for k in select * from jsonb_array_elements(p->'kindIds') loop
      if not public._is_str(k) then return 'kindIds must hold 1 to 20 non-empty strings'; end if;
    end loop;
    if jsonb_typeof(p->'checkpoint') is distinct from 'boolean' then return 'checkpoint must be a boolean'; end if;
    return null;
  end if;
  -- v1.ReviewKindDefined
  if not public._is_str(p->'kindId') or not public._is_str(p->'name') then
    return 'kindId and name must be non-empty strings'; end if;
  if length(p->>'name')>200 then return 'name is too long'; end if;
  if p ? 'icon' and jsonb_typeof(p->'icon') is distinct from 'string' then return 'icon must be a string'; end if;
  if p ? 'withholdsContext' and jsonb_typeof(p->'withholdsContext') is distinct from 'boolean' then
    return 'withholdsContext must be a boolean'; end if;
  if p ? 'produces' and (jsonb_typeof(p->'produces') is distinct from 'object'
    or not public._is_str(p->'produces'->'what') or not public._is_str(p->'produces'->'language')
    or not public._is_str(p->'produces'->'checkedByKindId')) then
    return 'produces needs what, language and checkedByKindId'; end if;
  return null;
end $$;
revoke all on function public.validate_payload(text,jsonb) from public,anon;
grant execute on function public.validate_payload(text,jsonb) to authenticated,service_role;

alter function public.event_privilege(text,jsonb)
  rename to event_privilege_pre_flow_kinds;
create function public.event_privilege(p_type text,p jsonb)
returns text language sql immutable set search_path = '' as $$
  select case when p_type in ('v2.WorkflowStepSet','v1.ReviewKindDefined')
    then 'manage_flows' else public.event_privilege_pre_flow_kinds(p_type,p) end;
$$;
revoke all on function public.event_privilege(text,jsonb) from public,anon;
grant execute on function public.event_privilege(text,jsonb) to authenticated,service_role;
-- New event schemas do not change transport compatibility.
