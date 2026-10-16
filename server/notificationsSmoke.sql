-- Inbox rows: an organization's (no language) and a language's are
-- reconciled apart, and the daily purge deletes only rows that stayed
-- inactive for 30 days (decisions.md 68, performance-audit-app.md V3).
-- Repeatable; every write rolls back.
\set ON_ERROR_STOP on
begin;
select public.reconcile_notifications('nsmoke-org', 'L1',
  '[{"id":"ns-l1","profile_id":"ns-p","kind":"review","title":"One"},{"id":"ns-l1b","profile_id":"ns-p","kind":"review","title":"One b"}]');
select public.reconcile_notifications('nsmoke-org', 'L2',
  '[{"id":"ns-l2","profile_id":"ns-p","kind":"review","title":"Two"}]');
select public.reconcile_notifications('nsmoke-org', null,
  '[{"id":"ns-org","profile_id":"ns-p","kind":"join_request","title":"Org"}]');

-- A pass for L1 that drops one row removes only that row.
select public.reconcile_notifications('nsmoke-org', 'L1',
  '[{"id":"ns-l1","profile_id":"ns-p","kind":"review","title":"One"}]');
do $$ begin
  if (select active from public.notifications where id = 'ns-l1b') then raise exception 'language pass kept a removed row'; end if;
  if not (select active from public.notifications where id = 'ns-l1') then raise exception 'language pass removed a kept row'; end if;
  if not (select active from public.notifications where id in ('ns-l2') ) then raise exception 'language pass touched another language'; end if;
  if not (select active from public.notifications where id = 'ns-org') then raise exception 'language pass touched an organization row'; end if;
end $$;

-- An empty pass for the organization removes only its own rows.
select public.reconcile_notifications('nsmoke-org', null, '[]');
do $$ begin
  if (select active from public.notifications where id = 'ns-org') then raise exception 'organization pass kept a removed row'; end if;
  if not (select active from public.notifications where id = 'ns-l1') or not (select active from public.notifications where id = 'ns-l2') then
    raise exception 'organization pass touched a language row';
  end if;
end $$;

-- A changed pass moves the cursor and the change time; an unchanged one does not.
do $$ declare s bigint; begin
  select seq into s from public.notifications where id = 'ns-l2';
  perform public.reconcile_notifications('nsmoke-org', 'L2', '[{"id":"ns-l2","profile_id":"ns-p","kind":"review","title":"Two"}]');
  if (select seq from public.notifications where id = 'ns-l2') <> s then raise exception 'unchanged pass advanced the cursor'; end if;
  perform public.reconcile_notifications('nsmoke-org', 'L2', '[{"id":"ns-l2","profile_id":"ns-p","kind":"review","title":"Two, renamed"}]');
  if (select seq from public.notifications where id = 'ns-l2') <= s then raise exception 'changed row did not advance the cursor'; end if;
end $$;

-- The purge: inactive for 30 days goes, unless a push receipt still points at it.
select public.reconcile_notifications('nsmoke-org', 'L1', '[]');
select public.reconcile_notifications('nsmoke-org', 'L3',
  '[{"id":"ns-l3","profile_id":"ns-p","kind":"review","title":"Three"}]');
select public.reconcile_notifications('nsmoke-org', 'L3', '[]');
insert into public.push_receipts (ticket_id, token, notification_id) values ('ns-ticket', 'ns-token', 'ns-l3');
update public.notifications set changed_at = now() - interval '40 days' where id in ('ns-l1', 'ns-l3');
update public.notifications set changed_at = now() - interval '5 days' where id = 'ns-org';
do $$ begin
  execute (select command from cron.job where jobname = 'langquest-purge-notifications');
  if exists (select 1 from public.notifications where id = 'ns-l1') then raise exception 'old inactive row was not purged'; end if;
  if not exists (select 1 from public.notifications where id = 'ns-l3') then raise exception 'row with a waiting receipt was purged'; end if;
  if not exists (select 1 from public.notifications where id = 'ns-org') then raise exception 'recently inactive row was purged'; end if;
  if not exists (select 1 from public.notifications where id = 'ns-l2' and active) then raise exception 'active row was purged'; end if;
end $$;
select 'notifications smoke passed' as result;
rollback;
