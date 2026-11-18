-- The ops dashboard's totals by hour and day (migration *_diag_daily.sql,
-- decisions.md 254): what a day's totals hold, that a refill is whole and the
-- same each time, that keys stop at 30 a number, that no key is an install or
-- a person, and the series diag_reader reads. Run by `npm run db:test`.
-- Repeatable; every write rolls back. The day it counts is 40 days ago, where
-- no other smoke writes.
\set ON_ERROR_STOP on
begin;

create temporary table dt_day on commit drop as
  select (date_trunc('day', now(), 'UTC') - interval '40 days') as d;

insert into diag.installs (install_id, profile_id, context) values
  ('dt-inst-ios', 'dt-profile-1', '{"os":"ios","channel":"production"}'),
  ('dt-inst-android', 'dt-profile-2', '{"os":"android","channel":"production"}');

-- Two installs on that day: 35 kinds of error (one a crash), syncs, refused work, a transfer, a take, a lost file.
insert into diag.records (id, install_id, delivered_by, kind, at, received_at, update_id, n, t)
select 'dt-err-' || i, case when i % 2 = 0 then 'dt-inst-ios' else 'dt-inst-android' end,
       case when i % 2 = 0 then 'dt-profile-1' else 'dt-profile-2' end, 'error', d + interval '10 hours', d + interval '10 hours',
       'abcdef1234567890', '{}', jsonb_build_object('name', 'DtError' || i, 'where', 'screen' || i, 'fatal', case when i = 1 then 'yes' else 'no' end)
from dt_day, generate_series(1, 35) i;
insert into diag.records (id, install_id, delivered_by, kind, at, received_at, n, t)
select x.id, x.inst, 'dt-profile-1', x.kind, d + interval '11 hours', d + interval '11 hours', x.n::jsonb, x.t::jsonb
from dt_day, (values
  ('dt-sync-1', 'dt-inst-ios', 'sync', '{"rejected":3,"rejInvalid":1,"rejNotMember":2}', '{"outcome":"ok"}'),
  ('dt-sync-2', 'dt-inst-ios', 'sync', '{}', '{"outcome":"error","phase":"push","code":"E_HTTP"}'),
  ('dt-xfer-1', 'dt-inst-android', 'transfer', '{"count":5,"failHttp5xx":2}', '{"dir":"down"}'),
  ('dt-audio-1', 'dt-inst-android', 'audio', '{"takes":4,"saveFail":1}', '{}'),
  ('dt-dev-1', 'dt-inst-android', 'device', '{"lostFiles":2,"lostRecordings":0}', '{}')
) x(id, inst, kind, n, t);

insert into diag.job_runs (job, started_at, ms, outcome, n, received_at)
select x.job, d + interval '12 hours', x.ms, x.outcome, x.n::jsonb, d + interval '12 hours'
from dt_day, (values
  ('projection', 100, 'ok', '{"newEvents":40,"maxUploadDelayP95Ms":9000,"futureStamped":1}'),
  ('projection', 300, 'error', '{"newEvents":2}'),
  ('worker_requests', 5, 'ok', '{"reports_2xx":10,"reports_5xx":1,"reports_lt100ms":9,"reports_over10s":2,"device_429":3}'),
  ('fold_canary', 1000, 'ok', '{"languages":3,"mismatched":0,"dbBytes":5000000}'),
  ('blob_reconcile', 2000, 'ok', '{"objects":100,"missing":2}')
) x(job, ms, outcome, n);

-- 1. A day's totals.
do $$
declare d timestamptz := (select dt_day.d from dt_day); v numeric; n int; t text;
begin
  perform diag.daily_refill('day', d, d + interval '1 day');
  select value into v from diag.daily where day = d::date and part = 'clients' and metric = 'errors' and key = '';
  if v <> 35 then raise exception 'errors total: %', v; end if;
  -- Its month again from its days: a count adds up, a level keeps its busiest day, 30 keys at most.
  if (select value from diag.monthly where month = date_trunc('month', d::date)::date and part = 'clients' and metric = 'errors' and key = '')
       is distinct from (select sum(value) from diag.daily where date_trunc('month', day) = date_trunc('month', d::date) and part = 'clients' and metric = 'errors' and key = '')
     or (select value from diag.monthly where month = date_trunc('month', d::date)::date and part = 'clients' and metric = 'installs' and key = '')
       is distinct from (select max(value) from diag.daily where date_trunc('month', day) = date_trunc('month', d::date) and part = 'clients' and metric = 'installs' and key = '')
     or (select count(*) from diag.monthly where month = date_trunc('month', d::date)::date and part = 'clients' and metric = 'errors' and key not in ('', '_other')) > 30 then
    raise exception 'month totals: %', (select jsonb_object_agg(metric || '/' || key, value) from diag.monthly where month = date_trunc('month', d::date)::date and part = 'clients' and key = '');
  end if;
  select count(*) into n from diag.daily where day = d::date and part = 'clients' and metric = 'errors' and key not in ('', '_other');
  if n <> 30 then raise exception 'error keys kept: %', n; end if;
  select value into v from diag.daily where day = d::date and part = 'clients' and metric = 'errors' and key = '_other';
  if v <> 5 then raise exception 'errors past the 30 largest: %', v; end if;
  if (select value from diag.daily where day = d::date and part = 'clients' and metric = 'crashes' and key = '') <> 1 then raise exception 'crashes'; end if;
  if (select value from diag.daily where day = d::date and part = 'clients' and metric = 'installs' and key = '') <> 2
     or (select value from diag.daily where day = d::date and part = 'clients' and metric = 'installs' and key = 'ios') <> 1 then
    raise exception 'installs: %', (select jsonb_object_agg(key, value) from diag.daily where day = d::date and part = 'clients' and metric = 'installs');
  end if;
  if (select value from diag.daily where day = d::date and part = 'clients' and metric = 'syncs' and key = 'error') <> 1
     or (select value from diag.daily where day = d::date and part = 'clients' and metric = 'sync_errors' and key = 'push:E_HTTP') <> 1 then
    raise exception 'syncs';
  end if;
  if (select value from diag.daily where day = d::date and part = 'clients' and metric = 'downloads' and key = '') <> 5
     or (select value from diag.daily where day = d::date and part = 'clients' and metric = 'downloads_failed' and key = '') <> 2
     or (select value from diag.daily where day = d::date and part = 'clients' and metric = 'recordings_failed' and key = '') <> 1 then
    raise exception 'transfers or recording';
  end if;
  if (select value from diag.daily where day = d::date and part = 'safety' and metric = 'refused' and key = '') <> 3
     or (select value from diag.daily where day = d::date and part = 'safety' and metric = 'refused' and key = 'invalid') <> 1
     or (select value from diag.daily where day = d::date and part = 'safety' and metric = 'new_events' and key = '') <> 42
     or (select value from diag.daily where day = d::date and part = 'safety' and metric = 'upload_delay_p95_ms' and key = '') <> 9000 then
    raise exception 'safety: %', (select jsonb_object_agg(metric || '/' || key, value) from diag.daily where day = d::date and part = 'safety');
  end if;
  if (select value from diag.daily where day = d::date and part = 'jobs' and metric = 'runs' and key = 'projection') <> 2
     or (select value from diag.daily where day = d::date and part = 'jobs' and metric = 'failed' and key = 'projection') <> 1 then
    raise exception 'jobs';
  end if;
  if (select value from diag.daily where day = d::date and part = 'worker' and metric = 'requests' and key = 'reports') <> 11
     or (select value from diag.daily where day = d::date and part = 'worker' and metric = 'server_errors' and key = 'reports') <> 1
     or (select value from diag.daily where day = d::date and part = 'worker' and metric = 'slow' and key = 'reports') <> 2
     or (select value from diag.daily where day = d::date and part = 'worker' and metric = 'refused' and key = 'device') <> 3 then
    raise exception 'worker: %', (select jsonb_object_agg(metric || '/' || key, value) from diag.daily where day = d::date and part = 'worker');
  end if;
  if (select value from diag.daily where day = d::date and part = 'capacity' and metric = 'db_bytes') <> 5000000
     or (select value from diag.daily where day = d::date and part = 'storage' and metric = 'r2_check' and key = 'missing') <> 2
     or (select value from diag.daily where day = d::date and part = 'storage' and metric = 'lost_files_installs') <> 1 then
    raise exception 'storage or capacity';
  end if;

  -- Every number written has a way to add it up; no key is an install or a person.
  select string_agg(distinct x.part || '.' || x.metric, ', ') into t from diag.daily x
  where not exists (select 1 from diag.daily_metrics m where m.part = x.part and m.metric = x.metric);
  if t is not null then raise exception 'numbers with no row in diag.daily_metrics: %', t; end if;
  if exists (select 1 from diag.daily where key like '%dt-inst%' or key like '%dt-profile%') then raise exception 'a key names an install or a person'; end if;

  -- A refill is whole and the same each time; the day is marked counted.
  select count(*) into n from diag.daily where day = d::date;
  perform diag.daily_refill('day', d, d + interval '1 day');
  if (select count(*) from diag.daily where day = d::date) <> n then raise exception 'a second refill changed the day'; end if;
  if not exists (select 1 from diag.daily_filled where step = 'day' and at = d and rows = n) then raise exception 'the day is not marked counted'; end if;
  delete from diag.records where id = 'dt-sync-2';
  perform diag.daily_refill('day', d, d + interval '1 day');
  if exists (select 1 from diag.daily where day = d::date and part = 'clients' and metric = 'sync_errors') then raise exception 'a refill kept a number that is gone'; end if;

  -- By hour: the same records, in the hour they came.
  perform diag.daily_refill('hour', d + interval '10 hours', d + interval '12 hours');
  if (select value from diag.hourly where hour = d + interval '10 hours' and part = 'clients' and metric = 'errors' and key = '') <> 35
     or exists (select 1 from diag.hourly where hour = d + interval '11 hours' and part = 'clients' and metric = 'errors') then
    raise exception 'hourly errors';
  end if;
end $$;

-- 2. The job: it counts now, marks what it counted and records a run.
do $$
declare r jsonb; before int := (select count(*) from diag.job_runs where job = 'daily_totals');
begin
  r := diag.daily_fill();
  if (r->>'hours')::int < 2 or r ? 'skipped' then raise exception 'daily_fill: %', r; end if;
  if (select count(*) from diag.job_runs where job = 'daily_totals') <> before + 1 then raise exception 'no daily_totals run'; end if;
  if not exists (select 1 from diag.daily_filled where step = 'hour' and at = date_trunc('hour', now(), 'UTC')) then raise exception 'this hour is not counted'; end if;
  if not exists (select 1 from diag.daily_filled where step = 'day' and at = date_trunc('day', now(), 'UTC')) then raise exception 'today is not counted'; end if;
  if not exists (select 1 from diag.daily where day = (now() at time zone 'UTC')::date and part = 'capacity' and metric = 'db_bytes') then raise exception 'no size for today'; end if;
end $$;

-- 3. What the page reads, as diag_reader, which cannot read the tables themselves.
grant diag_reader to postgres;
set role diag_reader;
do $$
declare v jsonb; s jsonb; i int; d date := (now() at time zone 'UTC')::date - 40; ok boolean;
begin
  v := diag.ops_series('clients', '90d');
  if v->>'step' <> 'day' or jsonb_array_length(v->'buckets') <> 90 or jsonb_array_length(v->'counted') <> 90 then raise exception '90d shape: %', v - 'series'; end if;
  i := (select b.i - 1 from jsonb_array_elements_text(v->'buckets') with ordinality b(at, i) where (b.at::timestamptz at time zone 'UTC')::date = d);
  select x into s from jsonb_array_elements(v->'series') x where x->>'metric' = 'errors' and x->>'key' = '';
  if (s->'values'->>i)::numeric <> 35 or s->>'agg' <> 'sum' or jsonb_array_length(s->'values') <> 90 then raise exception '90d errors: %', s; end if;
  if (select count(*) from jsonb_array_elements(v->'series') x where x->>'metric' = 'errors' and x->>'key' not in ('', '_other')) <> 10 then
    raise exception 'a series keeps its 10 largest keys';
  end if;
  -- A counted bucket with nothing in it is 0; one not counted is null.
  ok := (v->'counted'->>(i + 1))::boolean;
  if ok and (s->'values'->>(i + 1)) is distinct from '0' then raise exception 'a counted day with no errors: %', s->'values'->>(i + 1); end if;
  if not ok and (s->'values'->>(i + 1)) is not null then raise exception 'a day not counted holds %', s->'values'->>(i + 1); end if;

  v := diag.ops_series('clients', '24h');
  if v->>'step' <> 'hour' or jsonb_array_length(v->'buckets') <> 24 then raise exception '24h shape: %', v - 'series'; end if;
  v := diag.ops_series('clients', '14d');
  if jsonb_array_length(v->'buckets') <> 14 then raise exception '14d shape'; end if;
  v := diag.ops_series('clients', '1y');
  if v->>'step' <> 'week' or jsonb_array_length(v->'buckets') not between 53 and 54 then raise exception '1y shape: %', v - 'series'; end if;
  select x into s from jsonb_array_elements(v->'series') x where x->>'metric' = 'installs' and x->>'key' = '';
  if s->>'agg' <> 'max' then raise exception 'installs add up as a level: %', s; end if;
  v := diag.ops_series('clients', 'all');
  if v->>'step' <> 'month' or jsonb_array_length(v->'buckets') < 2 then raise exception 'all shape: %', v - 'series'; end if;
  v := diag.ops_series('pipeline', '14d');
  if jsonb_array_length(v->'series') <> 0 then raise exception 'a part with no totals: %', v; end if;

  begin
    perform diag.ops_series('clients', '7d');
    raise exception 'a range the page does not offer was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform count(*) from diag.daily;
    raise exception 'diag_reader read diag.daily';
  exception when insufficient_privilege then null;
  end;
  begin
    perform diag.daily_fill();
    raise exception 'diag_reader ran the fill';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
