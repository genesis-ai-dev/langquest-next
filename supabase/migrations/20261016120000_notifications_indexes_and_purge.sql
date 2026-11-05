-- Notifications at scale (performance-audit-app.md V3, V9).
--
-- 1. reconcile_notifications filtered on `language_id is not distinct from
--    p_language`, which no btree serves, and had no (org_id, language_id)
--    index anyway, so every language's projection pass scanned the whole
--    table. Now the two cases are separate statements, each with a partial
--    index over the active rows, and the new ids are collected once.
-- 2. Rows that went inactive were never deleted, and a phone's inbox read
--    (profile_id, seq) walks them. A new column says when a row last
--    changed, and a daily job deletes rows that have been inactive for 30
--    days. The phone keeps a copy of its Inbox and learns a row went away
--    from the inactive row itself; a phone that has not synced for longer
--    than that starts its copy over (refreshInbox), so a purged row cannot
--    linger on it.
-- 3. push_receipts is read by age and joined by notification; give both an
--    index (the foreign key needs the second for any delete of a
--    notification).

alter table public.notifications add column if not exists changed_at timestamptz not null default now();

create index if not exists notifications_org_language_active
  on public.notifications (org_id, language_id) where active;
create index if not exists notifications_org_active_no_language
  on public.notifications (org_id) where active and language_id is null;
create index if not exists push_receipts_created_at on public.push_receipts (created_at);
create index if not exists push_receipts_notification on public.push_receipts (notification_id);

-- A projection pass replaces one language's Inbox rows (or the
-- organization's, with a null language) atomically. The sequence advances
-- only when a row changes, including becoming inactive, for cursor pulls;
-- changed_at moves with it.
create or replace function public.reconcile_notifications(p_org text, p_language text, p_rows jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  keep text[];
begin
  select coalesce(array_agg(r->>'id'), '{}') into keep
    from jsonb_array_elements(p_rows) r where r->>'id' is not null;
  if p_language is null then
    update public.notifications n set active = false, seq = default, changed_at = now()
      where n.org_id = p_org and n.language_id is null and n.active
        and not exists (select 1 from unnest(keep) k where k = n.id);
  else
    update public.notifications n set active = false, seq = default, changed_at = now()
      where n.org_id = p_org and n.language_id = p_language and n.active
        and not exists (select 1 from unnest(keep) k where k = n.id);
  end if;
  insert into public.notifications (id, profile_id, org_id, language_id, kind, title, task_id, unit_id)
    select r->>'id', r->>'profile_id', p_org, p_language, r->>'kind', r->>'title', r->>'task_id', r->>'unit_id'
    from jsonb_array_elements(p_rows) r
    on conflict (id) do update set active = true, title = excluded.title, seq = default, changed_at = now()
      where not notifications.active or notifications.title <> excluded.title;
end $$;

-- Inactive rows older than 30 days, once a day. A row with a push receipt
-- still waiting for Expo's answer stays until the receipt is gone.
do $$
begin
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'langquest-purge-notifications';
  perform cron.schedule('langquest-purge-notifications', '17 3 * * *', $job$
    delete from public.notifications n
    where not n.active and n.changed_at < now() - interval '30 days'
      and not exists (select 1 from public.push_receipts r where r.notification_id = n.id);
  $job$);
end $$;
