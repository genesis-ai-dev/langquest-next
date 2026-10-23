-- The ops dashboard's push figures count only what push delivery can send.
-- claim_notification_pushes claims a notification only when its recipient
-- has a push token, so one for a person without a token is never pushed: it
-- waits in their Inbox, as it should. Counting those as "waiting to be
-- pushed" raised a problem that could never clear (9 waiting, the oldest
-- 15 days, with no push token in production at all). They are now
-- `inboxOnly`, apart from `pending`.

create or replace function diag.ops_push() returns jsonb
language sql stable security definer set search_path = '' as $$
  with waiting as (
    select n.created_at, exists (select 1 from public.push_tokens t where t.profile_id = n.profile_id) as reachable
    from public.notifications n where n.active and n.pushed_at is null
  )
  select jsonb_build_object(
    'pending', (select count(*) from waiting where reachable),
    'oldestPendingAt', (select to_jsonb(min(created_at)) from waiting where reachable),
    'inboxOnly', (select count(*) from waiting where not reachable),
    'errors24h', coalesce((select jsonb_agg(jsonb_build_object('code', x.code, 'n', x.n) order by x.code)
      from (select case when diag.is_code(n.push_last_error) then n.push_last_error else 'other' end as code, count(*) as n
            from public.notifications n
            where n.push_last_error is not null and coalesce(n.push_lease_until, n.created_at) > now() - interval '1 day'
            group by 1) x), '[]'::jsonb),
    'tokens', (select count(*) from public.push_tokens),
    'membersWithoutToken', (select count(distinct m.profile_id) from public.org_memberships m
        where not m.removed and not exists (select 1 from public.push_tokens t where t.profile_id = m.profile_id))
  )
$$;
