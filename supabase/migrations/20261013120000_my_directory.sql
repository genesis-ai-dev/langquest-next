-- The names a person may see, in one set-based read (useAccount.ts
-- useDisplayNames). The app read `profiles` with no filter and let the row
-- policy (`profile_visible`) decide, which runs a membership join for every
-- profile on the server: with 11,500 profiles a read took long enough, under
-- several sessions at once, that the app's retries ran out and every member
-- showed as a placeholder name. The table grows with every person who signs
-- up, so on a hosted database it only gets worse. This returns the same set
-- `profile_visible` allows (oneself; members of an organization one belongs
-- to; anyone asking to join an organization where one holds Invite),
-- starting from the caller's own memberships.

create index if not exists org_memberships_by_profile on public.org_memberships (profile_id) where not removed;

create or replace function public.my_directory()
returns table (id text, display_name text)
language sql stable security definer set search_path = '' as $$
  with me as (select public.caller_id() as id),
  mine as (
    select m.org_id from public.org_memberships m, me
    where m.profile_id = me.id and not m.removed
  ),
  seen as (
    select me.id as profile_id from me where me.id is not null
    union
    select other.profile_id from public.org_memberships other
    join mine on mine.org_id = other.org_id
    where not other.removed
    union
    select r.profile_id from public.join_requests r
    join (select distinct org_id from mine) o on o.org_id = r.org_id, me
    where 'invite_members' = any(public.org_privileges(r.org_id, me.id, null))
  )
  select p.id, p.display_name from public.profiles p
  join seen on seen.profile_id = p.id;
$$;

revoke all on function public.my_directory() from public;
grant execute on function public.my_directory() to authenticated;
