-- Taking back a checkpoint override needs what making one needs (decided
-- 2026-10-13, PASS-056 in docs/ui-test-suite). v1.DepartureUndone names only
-- the departure, so its privilege cannot come from its own payload
-- (event_privilege): anyone who may set a step aside (translate, review,
-- assign work) could undo an override that only Override checkpoints may
-- make. may_emit now looks the departure up in the same stream; an undo of a
-- set-aside or a kept version keeps the old list, and so does an undo of a
-- departure the server has not seen (it changes nothing).

create or replace function public.may_emit(p_org text, p_stream text, p_profile text, p_type text, p jsonb)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_priv text := public.event_privilege(p_type, p);
begin
  if v_priv is null or v_priv = 'bootstrap' then return false; end if;
  if p_type = 'v1.DepartureUndone' and exists (
    select 1 from public.events e
    where e.org_id = p_org and e.stream_id = p_stream and e.type = 'v1.DepartureRecorded'
      and e.payload->>'departureId' = p->>'departureId' and e.payload->>'type' = 'override')
  then
    v_priv := 'override_checkpoints';
  end if;
  return string_to_array(v_priv, ',') && public.org_privileges(
    p_org, p_profile,
    case when p_stream = '_org' then public.language_of_org_event(p_type, p) else p_stream end);
end $$;

revoke all on function public.may_emit(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.may_emit(text, text, text, text, jsonb) to service_role;
