-- Push delivery looks only where a push can go (performance-audit-2026-10-26.md
-- item 11). The claim walked the unpushed notifications in seq order and
-- skipped every one whose person has no phone registered; those stay unpushed
-- for ever (they wait in the person's Inbox), so they sat at the low end of
-- notifications_push and every claim walked past all of them. Now the claim
-- is driven from the people who have a token, through an index by person.
-- Which notifications count as pending, and the Inbox-only rows
-- diag.ops_push reports, are unchanged.
create index if not exists notifications_push_person
  on public.notifications (profile_id, seq) where pushed_at is null and active;

create or replace function public.claim_notification_pushes()
returns setof public.notifications language sql security definer set search_path = '' as $$
  update public.notifications n set push_lease_until = now() + interval '5 minutes'
  where id in (select x.id from public.notifications x
    where x.active and x.pushed_at is null
      and x.profile_id in (select t.profile_id from public.push_tokens t)
      and (x.push_lease_until is null or x.push_lease_until < now())
    order by x.seq limit 100 for update of x skip locked)
  returning n.*;
$$;

-- Is there anything for push delivery to do? A notification it could claim
-- now, or a push receipt old enough to read (the same two things
-- deliverPushes looks for). The cron job asks this before it calls the Edge
-- Function, so an idle minute costs one query, not an invocation.
create or replace function public.push_work_waiting() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.notifications x
    where x.active and x.pushed_at is null
      and x.profile_id in (select t.profile_id from public.push_tokens t)
      and (x.push_lease_until is null or x.push_lease_until < now())
  ) or exists (
    select 1 from public.push_receipts r where r.created_at < now() - interval '15 minutes'
  );
$$;

revoke all on function public.push_work_waiting() from public, anon, authenticated;
grant execute on function public.push_work_waiting() to service_role;
-- pg_cron runs the job as the database owner.
