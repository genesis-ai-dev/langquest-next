-- Scope rank for invitations and join decisions.
--
-- issue_invite asked only "does the caller hold invite_members at org
-- scope?" and never compared the requested scope with the caller's own.
-- decide_join_request always admitted at org scope. Both now ask one
-- question: does the caller hold invite_members through a membership whose
-- scope is at or above the scope being granted (core `scopeCovers`, with
-- rank org > project > lane)? A project admin may grant that project or a
-- lane in it; a lane admin only that lane; neither may grant org scope.
--
-- Contracts kept for installed clients: issue_invite keeps its signature,
-- check order, messages and SQLSTATEs. decide_join_request gains an optional
-- trailing p_scope that defaults to org, so a three-argument call behaves
-- exactly as before. The old three-argument function is dropped in the same
-- transaction, because keeping it beside the new one would make every
-- three-argument call ambiguous.

create or replace function public._may_grant_scope(p_org text, p_profile text, p_scope jsonb)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.org_memberships m
    join public.org_roles r on r.org_id = m.org_id and r.role_id = m.role_id and not r.retired
    where m.org_id = p_org and m.profile_id = p_profile and not m.removed
      and 'invite_members' = any(r.privileges)
      and (m.scope_level = 'org'
        or (m.scope_level = 'project' and p_scope->>'level' in ('project', 'lane')
            and m.project_id = p_scope->>'projectId')
        or (m.scope_level = 'lane' and p_scope->>'level' = 'lane'
            and m.project_id = p_scope->>'projectId' and m.lane_id = p_scope->>'laneId')));
$$;
revoke all on function public._may_grant_scope(text, text, jsonb) from public, anon, authenticated;

create or replace function public.issue_invite(
  p_org text, p_invite_id text, p_token_hash text, p_role_id text, p_scope jsonb, p_expires_at timestamptz
) returns void language plpgsql security definer set search_path = public as $$
declare v_actor text := public.caller_id(); v_id public.invites.id%type;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if not public._may_grant_scope(p_org, v_actor, p_scope) then
    raise exception 'not allowed to invite members' using errcode = '42501';
  end if;
  if p_expires_at <= now() then raise exception 'invite already expired' using errcode = '22023'; end if;
  if not exists (select 1 from public.org_roles r where r.org_id = p_org and r.role_id = p_role_id and not r.retired) then
    raise exception 'unknown role %', p_role_id using errcode = '22023';
  end if;

  if p_token_hash !~ '^[0-9a-f]{64}$' or p_expires_at > now() + interval '90 days' then
    raise exception 'invalid invite' using errcode = '22023';
  end if;
  if public._scope_error(p_scope) is not null then
    raise exception 'invalid scope' using errcode = '22023';
  end if;
  v_id := p_invite_id;
  if exists (select 1 from public.invites where id = v_id) then
    if exists (select 1 from public.invites where id = v_id
      and issued_by = v_actor and org_id = p_org and token_hash = p_token_hash
      and role_id = p_role_id and scope = p_scope) then return; end if;
    raise exception 'invite id already used' using errcode = '22023';
  end if;
  insert into public.invites (id, org_id, token_hash, role_id, scope, expires_at, issued_by)
  values (v_id, p_org, p_token_hash, p_role_id, p_scope, p_expires_at, v_actor);

  perform public._append_event_as(
    'invite:' || p_invite_id, p_org, '_org', 'v1.InviteIssued', v_actor, 'server',
    jsonb_build_object('inviteId', p_invite_id, 'roleId', p_role_id, 'scope', p_scope,
                       'expiresAt', to_char(p_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
end $$;

drop function if exists public.decide_join_request(text, boolean, text);

create or replace function public.decide_join_request(
  p_request_id text, p_accepted boolean, p_role_id text default null, p_scope jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor text := public.caller_id();
  v_req record;
  v_scope jsonb := coalesce(p_scope, jsonb_build_object('level', 'org'));
  v_hlc text;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  select * into v_req from public.join_requests where id::text = p_request_id for update;
  if not found then
    if exists (select 1 from public.events where id = 'joindecided:' || p_request_id and actor_id = v_actor) then return; end if;
    raise exception 'request not found' using errcode = '22023';
  end if;
  if not public._may_grant_scope(v_req.org_id, v_actor, v_scope) then
    raise exception 'not allowed to admit members' using errcode = '42501';
  end if;
  if public._scope_error(v_scope) is not null then
    raise exception 'invalid scope' using errcode = '22023';
  end if;
  if p_accepted and (p_role_id is null or not exists (
        select 1 from public.org_roles r where r.org_id = v_req.org_id and r.role_id = p_role_id and not r.retired)) then
    raise exception 'a role is required to accept' using errcode = '22023';
  end if;

  perform public._append_event_as(
    'joindecided:' || p_request_id, v_req.org_id, '_org', 'v1.JoinDecided', v_actor, 'server',
    jsonb_build_object('requestId', p_request_id, 'profileId', v_req.profile_id, 'accepted', p_accepted));

  if p_accepted then
    v_hlc := public._append_event_as(
      'joinmember:' || p_request_id, v_req.org_id, '_org', 'v1.OrgMemberAdded', v_actor, 'server',
      jsonb_build_object('profileId', v_req.profile_id, 'roleId', p_role_id, 'scope', v_scope));
    if v_hlc is not null then
      perform public._apply_org_event(v_req.org_id, 'v1.OrgMemberAdded',
        jsonb_build_object('profileId', v_req.profile_id, 'roleId', p_role_id, 'scope', v_scope), v_hlc);
    end if;
  end if;

  delete from public.join_requests where id::text = p_request_id;
end $$;

revoke all on function public.decide_join_request(text, boolean, text, jsonb) from public, anon;
grant execute on function public.decide_join_request(text, boolean, text, jsonb) to authenticated;
grant execute on function public.issue_invite(text, text, text, text, jsonb, timestamptz) to authenticated;
notify pgrst, 'reload schema';
