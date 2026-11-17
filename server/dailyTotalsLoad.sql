-- How fast the ops dashboard's totals are at scale (decisions.md 254), run by
-- hand on a local database, never in CI (it takes minutes):
--
--   docker exec -i supabase_db_langquest-next psql -U postgres -d postgres < server/dailyTotalsLoad.sql
--
-- It seeds 40,000 installs, a busy day of raw records (1.2 million: 30 from
-- each install), and 3 years of diag.daily for every number with 10 keys
-- each, then times a day's fill, an hour's fill and every range of every
-- part, as diag_reader. The page's budget is 500 ms a call. Everything rolls
-- back.
\set ON_ERROR_STOP on
\timing on
begin;

insert into diag.installs (install_id, profile_id, context, last_seen)
select 'load-' || i, 'load-p-' || (i % 30000), jsonb_build_object('os', case when i % 3 = 0 then 'ios' when i % 3 = 1 then 'android' else 'web' end,
  'channel', 'production', 'appVersion', '2026.11.' || (i % 5)), now()
from generate_series(1, 40000) i;

-- 30 records from each install over the last 24 hours: syncs, devices, transfers, audio and a few errors.
insert into diag.records (id, install_id, delivered_by, kind, at, received_at, update_id, n, t)
select 'load-r-' || i || '-' || k, 'load-' || i, 'load-p-' || (i % 30000),
       (array['sync', 'sync', 'sync', 'device', 'transfer', 'audio', 'auth', 'sync', 'sync', 'error'])[1 + k % 10],
       now() - (k * 47 + i % 60) * interval '1 minute', now() - (k * 47 + i % 60) * interval '1 minute',
       'update' || (i % 4),
       case (1 + k % 10)
         when 4 then jsonb_build_object('freeDiskMb', 2000 + i % 900, 'lostFiles', case when i % 997 = 0 then 1 else 0 end)
         when 5 then jsonb_build_object('count', 3, 'failHttp5xx', case when i % 101 = 0 then 1 else 0 end)
         when 6 then jsonb_build_object('takes', 2)
         else jsonb_build_object('rejected', case when i % 503 = 0 then 2 else 0 end) end,
       case (1 + k % 10)
         when 10 then jsonb_build_object('name', 'LoadError' || (i % 60), 'where', 'screen' || (i % 7), 'fatal', case when i % 50 = 0 then 'yes' else 'no' end)
         when 5 then jsonb_build_object('dir', case when i % 2 = 0 then 'down' else 'up' end)
         when 7 then jsonb_build_object('op', 'renew', 'outcome', case when i % 40 = 0 then 'failed' else 'ok' end)
         else jsonb_build_object('outcome', case when i % 211 = 0 then 'error' else 'ok' end, 'phase', 'push', 'code', 'E_HTTP') end
from generate_series(1, 40000) i, generate_series(0, 29) k;

-- Three years of totals: every number, its total and 10 keys, each day.
insert into diag.daily (day, part, metric, key, value)
select d::date, m.part, m.metric, k.key, (random() * 1000)::int
from generate_series(current_date - 1095, current_date - 2, interval '1 day') d
cross join diag.daily_metrics m
cross join lateral (select '' as key union all select 'key-' || g from generate_series(1, 10) g) k;
insert into diag.daily_filled (step, at, rows)
select 'day', d, 1 from generate_series(current_date - 1095, current_date - 2, interval '1 day') d
on conflict do nothing;
select count(diag.monthly_refill(m)) as months from generate_series(date_trunc('month', current_date - 1095), current_date, interval '1 month') m;
analyze diag.records; analyze diag.installs; analyze diag.daily; analyze diag.monthly; analyze diag.daily_filled;

select count(*) as raw_records from diag.records where received_at > now() - interval '1 day';
select count(*) as daily_rows from diag.daily;

-- A day's fill (once an hour, two of these), then an hour's (every 10 minutes, two of these).
select diag.daily_refill('day', date_trunc('day', now(), 'UTC'), date_trunc('day', now(), 'UTC') + interval '1 day');
select diag.daily_refill('hour', date_trunc('hour', now(), 'UTC') - interval '1 hour', date_trunc('hour', now(), 'UTC'));
select diag.daily_refill('hour', date_trunc('hour', now(), 'UTC') - interval '24 hours', date_trunc('hour', now(), 'UTC') + interval '1 hour');

-- What the page asks, as the page's role.
grant diag_reader to postgres;
set role diag_reader;
select 'clients 24h', length(diag.ops_series('clients', '24h')::text);
select 'clients 14d', length(diag.ops_series('clients', '14d')::text);
select 'clients 90d', length(diag.ops_series('clients', '90d')::text);
select 'clients 1y', length(diag.ops_series('clients', '1y')::text);
select 'clients all', length(diag.ops_series('clients', 'all')::text);
select 'safety all', length(diag.ops_series('safety', 'all')::text);
select 'jobs 1y', length(diag.ops_series('jobs', '1y')::text);
select 'people all', length(diag.ops_series('people', 'all')::text);
reset role;

rollback;
