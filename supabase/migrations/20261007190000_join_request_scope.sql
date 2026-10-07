-- Accepting a join request names the scope, as an invite does and as the
-- partner demo's Assign Role screen asks: the organization, or one language.
-- It always admitted at organization scope, so an admin who wanted someone
-- on one language had to admit them everywhere and then narrow it. The
-- event is unchanged: v1.MemberAdded already carries a scope. Deciding needs
-- Invite at organization level, the same test the join_requests read
-- policy uses.
-- The old signature stays for builds already out and admits at organization
-- scope, as before.

create or replace function public.decide_join_request_v2(
  p_request_id text, p_accepted boolean, p_role_id text default null, p_scope jsonb default '{"level":"org"}'
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor text := public.caller_id();
  v_req record;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  select * into v_req from public.join_requests where id = p_request_id for update;
  if not found then
    if exists (select 1 from public.events where id = 'joindecided:' || p_request_id and actor_id = v_actor) then return; end if;
    raise exception 'request not found' using errcode = '22023';
  end if;
  if not ('invite_members' = any(public.org_privileges(v_req.org_id, v_actor, null))) then
    raise exception 'not allowed to admit members' using errcode = '42501';
  end if;
  if p_accepted then
    if p_role_id is null or not exists (
        select 1 from public.org_roles r where r.org_id = v_req.org_id and r.role_id = p_role_id and not r.retired) then
      raise exception 'a role is required to accept' using errcode = '22023';
    end if;
    if public._scope_error(p_scope) is not null then raise exception 'invalid scope' using errcode = '22023'; end if;
    if p_scope->>'level' = 'language' and not public.language_listed(v_req.org_id, p_scope->>'languageId') then
      raise exception 'unknown language' using errcode = '22023';
    end if;
  end if;

  perform public._append_event_as(
    'joindecided:' || p_request_id, v_req.org_id, '_org', 'v1.JoinDecided', v_actor, 'server',
    jsonb_build_object('requestId', p_request_id, 'profileId', v_req.profile_id, 'accepted', p_accepted));
  if p_accepted then
    perform public._append_event_as(
      'joinmember:' || p_request_id, v_req.org_id, '_org', 'v1.MemberAdded', v_actor, 'server',
      jsonb_build_object('profileId', v_req.profile_id, 'roleId', p_role_id, 'scope', p_scope));
  end if;
  delete from public.join_requests where id = p_request_id;
end $$;

create or replace function public.decide_join_request(p_request_id text, p_accepted boolean, p_role_id text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.decide_join_request_v2(p_request_id, p_accepted, p_role_id, '{"level":"org"}');
end $$;

revoke all on function public.decide_join_request_v2(text, boolean, text, jsonb) from public, anon;
grant execute on function public.decide_join_request_v2(text, boolean, text, jsonb) to authenticated, service_role;
