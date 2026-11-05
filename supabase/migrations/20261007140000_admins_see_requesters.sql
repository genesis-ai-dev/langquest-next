-- Whoever may admit people to an organization sees the name of each person
-- asking to join it (decisions.md 65). A requester is not a member yet, so
-- sharing an organization did not cover them and admins saw only the
-- placeholder ("Teal Diamond"). The test is the one join_requests_read
-- uses, so an admin reads the names of exactly the requests they can see.
-- Security definer, so org_privileges (service-role only) runs as the owner.

create or replace function public.profile_visible(p_profile text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.caller_id() is not null and (
    p_profile = public.caller_id() or exists (
      select 1 from public.org_memberships me
      join public.org_memberships other on other.org_id = me.org_id
      where me.profile_id = public.caller_id() and not me.removed
        and other.profile_id = p_profile and not other.removed
    ) or exists (
      select 1 from public.join_requests r
      where r.profile_id = p_profile
        and 'invite_members' = any(public.org_privileges(r.org_id, public.caller_id(), null))
    )
  );
$$;
