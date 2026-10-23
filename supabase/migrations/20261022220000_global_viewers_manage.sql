-- Global Viewers read an organization's library too (decisions.md 158,
-- amended 2026-10-21): templates, review flows, reference material and
-- their media, which Manage shows. `_library_member` is the library's read
-- check; a Global Viewer whose access is on (an aal2 session) passes it.
-- Nothing it guards writes on membership alone: `library_adopt`, the one
-- write that asks it, asks for the item's privilege too, which a Global
-- Viewer never holds.

create or replace function public._library_member(p_org text, p_profile text)
returns boolean language sql stable set search_path = '' as $$
  select p_profile is not null and (
    exists (select 1 from public.org_memberships m where m.org_id = p_org and m.profile_id = p_profile and not m.removed)
    or public._gv_on(p_profile, public._request_aal(p_profile)));
$$;
