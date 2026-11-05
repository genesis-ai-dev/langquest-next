-- An organization always keeps someone who can manage roles (decided
-- 2026-10-13, PEOPLE-026 in docs/ui-test-suite). Nothing stopped an admin
-- removing themselves, or the last admin, or taking Manage roles off the
-- only role that held it, and then nobody could give it back: only support
-- could. The guard is the server's, as every grant rule is; core
-- `leavesNoRoleManager` mirrors it so the app explains before it tries.
--
-- "Someone who can manage roles" is an org-scope membership, not removed,
-- whose role is live and holds manage_roles. The change is refused when
-- there is such a person now and there would be none after it. The workers
-- (the service role) are not asked, as with the other grant rules.

create or replace function public._role_managers(p_org text, p_type text default '', p jsonb default '{}')
returns bigint language sql stable security definer set search_path = '' as $$
  -- How many hold Manage roles for the whole organization, now (no event)
  -- or as they would after this event. (Every test below is false, never
  -- null, with no event: a null would drop the row.)
  select count(distinct m.profile_id)
  from public.org_memberships m
  join public.org_roles r
    on r.org_id = m.org_id
   and r.role_id = case when p_type = 'v1.MemberAdded' and m.profile_id = p->>'profileId' and public._scope_key(p->'scope') = 'org'
                        then p->>'roleId' else m.role_id end
  where m.org_id = p_org and m.scope_key = 'org' and not m.removed
    and not r.retired
    and not (p_type = 'v1.MemberRemoved' and m.profile_id = p->>'profileId' and public._scope_key(p->'scope') = 'org')
    and not (p_type = 'v1.RoleRetired' and r.role_id = p->>'roleId')
    and 'manage_roles' = any(case when p_type = 'v1.RoleDefined' and r.role_id = p->>'roleId'
                                  then array(select jsonb_array_elements_text(p->'privileges'))
                                  else r.privileges end);
$$;
revoke all on function public._role_managers(text, text, jsonb) from public, anon, authenticated;

-- 20261009130000's, with the last rule added.
create or replace function public._grant_refusal(p_org text, p_actor text, p_type text, p jsonb)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_mine text[] := public.org_privileges(p_org, p_actor, public.language_of_org_event(p_type, p));
  v_role text[];
  v_held text[];
begin
  if p_type in ('v1.MemberAdded', 'v1.InviteIssued') then
    v_role := public._live_role_privileges(p_org, p->>'roleId');
    if v_role is null then return format('there is no role %s', p->>'roleId'); end if;
    if not v_role <@ v_mine then return 'you may only grant a role whose privileges you hold'; end if;
  end if;
  if p_type in ('v1.MemberAdded', 'v1.MemberRemoved') then
    v_held := public._held_at(p_org, p->>'profileId', public._scope_key(p->'scope'));
    if v_held is not null and not v_held <@ v_mine then return 'they hold more there than you do'; end if;
  end if;
  if p_type = 'v1.MemberAdded' and p->>'profileId' <> p_actor and not exists (
    select 1 from public.org_memberships m
    where m.org_id = p_org and m.profile_id = p->>'profileId' and m.role_event <> '') then
    return 'they have not joined this organization; invite them';
  end if;
  if p_type in ('v1.RoleDefined', 'v1.RoleRetired') then
    v_held := public._live_role_privileges(p_org, p->>'roleId');
    if v_held is not null and not v_held <@ v_mine then return 'that role holds more than you do'; end if;
    if p_type = 'v1.RoleDefined' and not array(select jsonb_array_elements_text(p->'privileges')) <@ v_mine then
      return 'you may only give a role privileges you hold';
    end if;
  end if;
  if p_type in ('v1.MemberAdded', 'v1.MemberRemoved', 'v1.RoleDefined', 'v1.RoleRetired')
     and public._role_managers(p_org) > 0 and public._role_managers(p_org, p_type, p) = 0 then
    return 'nobody else could manage roles; give someone Manage roles first';
  end if;
  return null;
end $$;
