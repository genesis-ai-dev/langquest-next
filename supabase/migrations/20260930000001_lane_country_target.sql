-- A language's country and its recording target (core record.ts, decision 41).
--
--   v1.LaneCountrySet { laneId, country }                       ISO 3166-1 alpha-2
--   v1.LaneTargetSet  { laneId, scope, startDate, targetDate }  YYYY-MM-DD
--
-- Both are registers per lane that an admin (manage_structure) sets from
-- the web dashboard. The previous validate_payload and event_privilege are
-- kept under new names and wrapped, so their long bodies are not copied.

alter function public.validate_payload(text, jsonb) rename to _validate_payload_before_20260930;
alter function public.event_privilege(text, jsonb) rename to _event_privilege_before_20260930;

create or replace function public._is_date(v jsonb) returns boolean language sql immutable as $$
  select v is not null and jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$';
$$;

create or replace function public.validate_payload(p_type text, p jsonb)
returns text language plpgsql immutable as $$
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'payload must be an object'; end if;
  case p_type
    when 'v1.LaneCountrySet' then
      if not public._is_str(p->'laneId') then return 'laneId must be a non-empty string'; end if;
      if jsonb_typeof(p->'country') is distinct from 'string' or (p->>'country') !~ '^[A-Z]{2}$' then
        return 'country must be an ISO 3166 alpha-2 code';
      end if;
    when 'v1.LaneTargetSet' then
      if not public._is_str(p->'laneId') then return 'laneId must be a non-empty string'; end if;
      if coalesce(p->>'scope', '') not in ('gospels', 'nt', 'ot', 'bible') then return 'scope must be one of gospels, nt, ot, bible'; end if;
      if not public._is_date(p->'startDate') then return 'startDate must be a YYYY-MM-DD date'; end if;
      if not public._is_date(p->'targetDate') then return 'targetDate must be a YYYY-MM-DD date'; end if;
      if not (p->>'targetDate' > p->>'startDate') then return 'targetDate must be after startDate'; end if;
    else
      return public._validate_payload_before_20260930(p_type, p);
  end case;
  return null;
end $$;

create or replace function public.event_privilege(p_type text, p jsonb)
returns text language sql immutable as $$
  select case p_type
    when 'v1.LaneCountrySet' then 'manage_structure'
    when 'v1.LaneTargetSet' then 'manage_structure'
    else public._event_privilege_before_20260930(p_type, p)
  end;
$$;

-- The caller's own privileges over a partition, optionally one language:
-- what the dashboard asks before offering an edit. The server still
-- decides on append (may_emit); this only hides controls that would fail.
create or replace function public.my_privileges(p_org text, p_project text, p_lane text default null)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array(
    select distinct x from unnest(
      public.org_privileges(p_org, public.caller_id(), p_project, p_lane)
      || public.fixed_role_privileges((
        select case when m.removed then null else m.role end
        from public.memberships m
        where m.org_id = p_org and m.project_id = p_project and m.profile_id = public.caller_id()))
    ) as x order by x
  ), '{}'::text[])
  where public.caller_id() is not null;
$$;
revoke all on function public.my_privileges(text, text, text) from public, anon;
grant execute on function public.my_privileges(text, text, text) to authenticated;
