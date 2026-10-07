-- Request Access lists the organizations someone may ask to join
-- (decisions.md 66): those listing at least one language on Explore, by
-- name, with those languages. The screen used to ask for an "organization
-- code", which was the organization's id, and no screen ever shows anyone
-- that id. An organization with nothing listed is not found here; people
-- join it by invite. Signed-in people only, as asking to join is.
-- Security definer, so org_name (service-role only) runs as the owner.

create or replace function public.listed_organizations()
returns table (org_id text, name text, languages text[])
language sql stable security definer set search_path = '' as $$
  select p.org_id, public.org_name(p.org_id), array_agg(p.name order by p.name)
  from public.public_languages p
  join public.language_visibility v
    on v.org_id = p.org_id and v.language_id = p.language_id and v.listed
  where public.caller_id() is not null and public.org_name(p.org_id) is not null
  group by p.org_id
  order by 2, 1
  limit 500;
$$;

revoke all on function public.listed_organizations() from public, anon;
grant execute on function public.listed_organizations() to authenticated, service_role;
