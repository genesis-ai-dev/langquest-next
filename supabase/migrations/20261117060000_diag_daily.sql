-- Totals by hour and by day, for the ops dashboard's pictures over any range
-- of days (docs/ops-dashboard-plan.md 7, phase 5; decisions.md 254).
--
-- Raw diagnostics and job runs stay 90 days (diag.prune; the privacy policy
-- and docs/play-store-declarations.md promise it). What the dashboard draws
-- past that comes from here: one row for each number, for each part of the
-- dashboard, each key (a platform, a job, an error, a route) and each day,
-- kept for all time. A row holds a count or a level and never an install id,
-- a profile id, a name or an email, so nothing here is about one person.
--
-- One pg_cron job, every 10 minutes, counts the hour now and the hour before
-- into diag.hourly (kept 14 days, for the 24 h range), each hour counts
-- today and yesterday into diag.daily, and each run fills a few days and
-- hours that have no totals yet, newest first, so the 90 days of raw records
-- that exist when this lands come in within a few hours. The page then reads
-- totals only: a year opens as fast as a day, at any number of phones.

-- ---- the tables -----------------------------------------------------------------------------

-- `part` is the dashboard part that shows the number (apps/admin/src/pageOps.ts GROUPS);
-- `key` is '' for the total, else one of the 30 largest keys that day, the rest as '_other'.
create table if not exists diag.daily (
  day date not null,
  part text not null check (part ~ '^[a-z0-9_]{1,40}$'),
  metric text not null check (metric ~ '^[a-z0-9_]{1,60}$'),
  key text not null default '' check (length(key) <= 160),
  value numeric not null,
  primary key (part, metric, day, key)
);
-- A part's totals over a range, without its keys: what most pictures draw.
create index if not exists diag_daily_totals_idx on diag.daily (part, day) include (metric, value) where key = '';

create table if not exists diag.hourly (
  hour timestamptz not null,
  part text not null check (part ~ '^[a-z0-9_]{1,40}$'),
  metric text not null check (metric ~ '^[a-z0-9_]{1,60}$'),
  key text not null default '' check (length(key) <= 160),
  value numeric not null,
  primary key (part, metric, hour, key)
);
create index if not exists diag_hourly_hour_idx on diag.hourly (hour);

-- Each hour and day counted, and when: the fill starts again where it stopped,
-- and the page tells a day with no records from a day not counted yet.
create table if not exists diag.daily_filled (
  step text not null check (step in ('hour', 'day')),
  at timestamptz not null,
  filled_at timestamptz not null default now(),
  rows int not null,
  primary key (step, at)
);

-- How a bucket wider than a day adds each number up: `sum` for a count
-- (errors, runs), `max` for a level (installs that reported, a size, a p95),
-- which a week or a month shows at its busiest day. Every metric the fill
-- writes is here (server/dailyTotalsSmoke.sql holds it).
create table if not exists diag.daily_metrics (
  part text not null,
  metric text not null,
  agg text not null check (agg in ('sum', 'max')),
  primary key (part, metric)
);

insert into diag.daily_metrics (part, metric, agg) values
  -- Phones and browsers: what installs report (diag.records).
  ('clients', 'installs', 'max'), ('clients', 'records', 'sum'), ('clients', 'errors', 'sum'), ('clients', 'crashes', 'sum'),
  ('clients', 'error_installs', 'max'), ('clients', 'syncs', 'sum'), ('clients', 'sync_errors', 'sum'),
  ('clients', 'downloads', 'sum'), ('clients', 'downloads_failed', 'sum'), ('clients', 'uploads', 'sum'), ('clients', 'uploads_failed', 'sum'),
  ('clients', 'takes', 'sum'), ('clients', 'recordings_failed', 'sum'), ('clients', 'playback_failed', 'sum'),
  ('clients', 'sign_in_trouble', 'sum'), ('clients', 'shown_failures', 'sum'),
  -- Builds in the field: installs and crashes by update, first downloads.
  ('fleet', 'installs_by_update', 'max'), ('fleet', 'crashed_by_update', 'max'),
  ('fleet', 'first_downloads', 'sum'), ('fleet', 'first_download_p50_ms', 'max'), ('fleet', 'first_download_p95_ms', 'max'),
  ('fleet', 'first_download_trouble', 'sum'),
  -- Sync and data safety: refused work, what arrived, the fold canary.
  ('safety', 'refused', 'sum'), ('safety', 'refused_installs', 'max'), ('safety', 'new_events', 'sum'),
  ('safety', 'upload_delay_p50_ms', 'max'), ('safety', 'upload_delay_p95_ms', 'max'), ('safety', 'upload_delay_max_ms', 'max'),
  ('safety', 'stamped_ahead', 'sum'), ('safety', 'stamped_ahead_installs', 'sum'),
  ('safety', 'canary_runs', 'sum'), ('safety', 'canary_mismatched', 'sum'),
  -- People and organizations, counted.
  ('people', 'active_accounts', 'max'), ('people', 'new_accounts', 'sum'), ('people', 'new_organizations', 'sum'),
  ('people', 'invites_issued', 'sum'), ('people', 'invites_redeemed', 'sum'),
  -- Server jobs (diag.job_runs), pg_cron, push delivery.
  ('jobs', 'runs', 'sum'), ('jobs', 'failed', 'sum'), ('jobs', 'partial', 'sum'), ('jobs', 'p95_ms', 'max'),
  ('cron', 'runs', 'sum'), ('cron', 'failed', 'sum'),
  ('push', 'delivery', 'sum'),
  -- The app Worker's routes (its request tally) and webhooks.
  ('worker', 'requests', 'sum'), ('worker', 'server_errors', 'sum'), ('worker', 'refused', 'sum'), ('worker', 'slow', 'sum'),
  ('integrations', 'webhook_deliveries', 'sum'),
  -- Storage and capacity.
  ('storage', 'lost_files_installs', 'max'), ('storage', 'lost_recordings_installs', 'max'), ('storage', 'r2_check', 'max'),
  ('capacity', 'db_bytes', 'max'), ('capacity', 'events_bytes', 'max'), ('capacity', 'snapshots_bytes', 'max'),
  -- Support and user issues.
  ('support', 'account_deletions', 'sum'), ('support', 'feedback', 'sum'), ('support', 'content_reports', 'sum'),
  ('userissues', 'looked_at_first', 'sum')
on conflict (part, metric) do update set agg = excluded.agg;

alter table diag.daily enable row level security;
alter table diag.hourly enable row level security;
alter table diag.daily_filled enable row level security;
alter table diag.daily_metrics enable row level security;
revoke all on diag.daily, diag.hourly, diag.daily_filled, diag.daily_metrics from public, anon, authenticated;

-- ---- what one window holds ------------------------------------------------------------------

-- Every number for the buckets of p_step from p_from to p_to, read from the
-- raw records, job runs and tables they come from. Each bucket starts at
-- p_from plus a whole number of steps. Keys past the 30 largest of a number
-- in a bucket are added up as '_other', so a flood of new error kinds cannot
-- grow the table without end.
create or replace function diag.daily_compute(p_from timestamptz, p_to timestamptz, p_step interval)
returns table (at timestamptz, part text, metric text, key text, value numeric)
language sql stable security definer set search_path = '' as $$
  with r as materialized (
    select pg_catalog.date_bin(p_step, x.received_at, p_from) as at, x.install_id, x.delivered_by, x.kind, x.update_id, x.n, x.t
    from diag.records x where x.received_at >= p_from and x.received_at < p_to
  ),
  -- A run is written as it ends, so its arrival is at most a day after it began.
  j as materialized (
    select pg_catalog.date_bin(p_step, x.started_at, p_from) as at, x.job, x.ms, x.outcome, x.n
    from diag.job_runs x
    where x.received_at >= p_from and x.received_at < p_to + interval '1 day' and x.started_at >= p_from and x.started_at < p_to
  ),
  ri as materialized (select distinct r.at, r.install_id, coalesce(left(r.update_id, 8), 'embedded') as up from r),
  nums as (
    -- clients
    select ri.at, 'clients' as part, 'installs' as metric, '' as key, count(distinct ri.install_id)::numeric as value from ri group by 1
    union all
    select q.at, 'clients', 'installs', coalesce(i.context->>'os', '?'), count(*)
    from (select distinct ri.at, ri.install_id from ri) q left join diag.installs i using (install_id) group by 1, 4
    union all
    select r.at, 'clients', 'records', '', count(*) from r group by 1
    union all
    select r.at, 'clients', 'records', r.kind, count(*) from r group by 1, 4
    union all
    select r.at, 'clients', 'errors', '', count(*) from r where r.kind = 'error' group by 1
    union all
    select r.at, 'clients', 'errors', left(concat_ws(' · ', coalesce(r.t->>'name', 'Error'), r.t->>'where', r.t->>'code'), 160), count(*)
    from r where r.kind = 'error' group by 1, 4
    union all
    select r.at, 'clients', 'crashes', '', count(*) from r where r.kind = 'error' and r.t->>'fatal' = 'yes' group by 1
    union all
    select r.at, 'clients', 'error_installs', '', count(distinct r.install_id) from r where r.kind = 'error' group by 1
    union all
    select r.at, 'clients', 'syncs', '', count(*) from r where r.kind = 'sync' group by 1
    union all
    select r.at, 'clients', 'syncs', coalesce(r.t->>'outcome', 'unknown'), count(*) from r where r.kind = 'sync' group by 1, 4
    union all
    select r.at, 'clients', 'sync_errors', '', count(*) from r where r.kind = 'sync' and r.t->>'outcome' = 'error' group by 1
    union all
    select r.at, 'clients', 'sync_errors', left(coalesce(r.t->>'phase', '?') || ':' || coalesce(r.t->>'code', r.t->>'error', '?'), 160), count(*)
    from r where r.kind = 'sync' and r.t->>'outcome' = 'error' group by 1, 4
    union all
    select x.at, 'clients', m.metric, '', sum(m.v) from (
      select r.at, coalesce(r.t->>'dir', 'unknown') as dir, r.n from r where r.kind = 'transfer'
    ) x cross join lateral (values
      (case x.dir when 'down' then 'downloads' when 'up' then 'uploads' end,
       coalesce((x.n->>'count')::numeric, 0)),
      (case x.dir when 'down' then 'downloads_failed' when 'up' then 'uploads_failed' end,
       (select coalesce(sum((x.n->>f)::numeric), 0) from unnest(array['failOffline', 'failHttp4xx', 'failHttp5xx', 'failHash', 'failDisk', 'failOther',
         'failAuth', 'failNotFound', 'failTooLarge', 'failBadDigest', 'failGone']) f))
    ) m(metric, v) where m.metric is not null group by 1, 3
    union all
    select x.at, 'clients', m.metric, '', sum(m.v) from (select r.at, r.n from r where r.kind = 'audio') x
    cross join lateral (values
      ('takes', coalesce((x.n->>'takes')::numeric, 0)),
      ('recordings_failed', coalesce((x.n->>'saveFail')::numeric, 0) + coalesce((x.n->>'startFail')::numeric, 0)
         + coalesce((x.n->>'stopFail')::numeric, 0) + coalesce((x.n->>'encodeFail')::numeric, 0)),
      ('playback_failed', coalesce((x.n->>'playFail')::numeric, 0))
    ) m(metric, v) group by 1, 3
    union all
    select r.at, 'clients', 'sign_in_trouble', '', count(*) from r
    where r.kind = 'auth' and coalesce(r.t->>'outcome', '') not in ('ok', 'done', 'keep', 'home') group by 1
    union all
    select r.at, 'clients', 'sign_in_trouble', left(concat_ws(':', coalesce(r.t->>'op', '?'), coalesce(r.t->>'outcome', '?'), r.t->>'code'), 160), count(*) from r
    where r.kind = 'auth' and coalesce(r.t->>'outcome', '') not in ('ok', 'done', 'keep', 'home') group by 1, 4
    union all
    select r.at, 'clients', 'shown_failures', '', sum(coalesce((r.n->>'count')::numeric, 1)) from r where r.kind = 'expected' group by 1
    union all
    select r.at, 'clients', 'shown_failures', left(concat_ws(' · ', coalesce(r.t->>'where', '?'), r.t->>'name', r.t->>'code'), 160), sum(coalesce((r.n->>'count')::numeric, 1))
    from r where r.kind = 'expected' group by 1, 4

    -- fleet
    union all
    select ri.at, 'fleet', 'installs_by_update', ri.up, count(distinct ri.install_id) from ri group by 1, 4
    union all
    select r.at, 'fleet', 'crashed_by_update', '', count(distinct r.install_id) from r where r.kind = 'error' and r.t->>'fatal' = 'yes' group by 1
    union all
    select r.at, 'fleet', 'crashed_by_update', coalesce(left(r.update_id, 8), 'embedded'), count(distinct r.install_id)
    from r where r.kind = 'error' and r.t->>'fatal' = 'yes' group by 1, 4
    union all
    select q.at, 'fleet', m.metric, q.k, m.v from (
      select r.at, case when r.kind = 'open' then 'open' else 'fill' end as k,
             count(*)::numeric as c,
             round((percentile_cont(0.5) within group (order by case when r.kind = 'open' then (r.n->>'ms')::numeric else (r.n->>'msToMap')::numeric end))::numeric) as p50,
             round((percentile_cont(0.95) within group (order by case when r.kind = 'open' then (r.n->>'ms')::numeric else (r.n->>'msToMap')::numeric end))::numeric) as p95
      from r where (r.kind = 'open' and r.n ? 'ms') or (r.kind = 'fill' and r.t->>'event' = 'start' and r.n ? 'msToMap') group by 1, 2
    ) q cross join lateral (values ('first_downloads', q.c), ('first_download_p50_ms', q.p50), ('first_download_p95_ms', q.p95)) m(metric, v)
    where m.v is not null
    union all
    select q.at, 'fleet', 'first_downloads', '', sum(q.c) from (
      select r.at, count(*)::numeric as c from r
      where (r.kind = 'open' and r.n ? 'ms') or (r.kind = 'fill' and r.t->>'event' = 'start' and r.n ? 'msToMap') group by 1
    ) q group by 1
    union all
    select q.at, 'fleet', 'first_download_trouble', q.k, count(*) from (
      select r.at, case when r.kind = 'snapshot' then 'no_snapshot' else (r.t->>'event') || ':' || coalesce(r.t->>'reason', '?') end as k
      from r left join diag.installs i using (install_id)
      where coalesce(i.context->>'channel', '') <> 'development'
        and ((r.kind = 'fill' and r.t->>'event' in ('fallback', 'restart'))
          or (r.kind = 'snapshot' and r.t->>'outcome' = 'none'))
    ) q group by 1, 4

    -- safety
    union all
    select r.at, 'safety', 'refused', '', sum((r.n->>'rejected')::numeric) from r
    where r.kind = 'sync' and (r.n->>'rejected')::numeric > 0 group by 1
    union all
    select x.at, 'safety', 'refused', m.k, sum(m.v) from (select r.at, r.n from r where r.kind = 'sync' and (r.n->>'rejected')::numeric > 0) x
    cross join lateral (values
      ('not_member', (x.n->>'rejNotMember')::numeric), ('not_allowed', (x.n->>'rejNotAllowed')::numeric),
      ('not_listed', (x.n->>'rejNotListed')::numeric), ('invalid', (x.n->>'rejInvalid')::numeric),
      ('clock_ahead', (x.n->>'rejClockAhead')::numeric), ('other', (x.n->>'rejOther')::numeric)
    ) m(k, v) where m.v > 0 group by 1, 4
    union all
    select r.at, 'safety', 'refused_installs', '', count(distinct r.install_id) from r
    where r.kind = 'sync' and (r.n->>'rejected')::numeric > 0 group by 1
    union all
    select x.at, 'safety', m.metric, '', m.v from (
      select j.at, sum((j.n->>'newEvents')::numeric) as ne, max((j.n->>'maxUploadDelayP50Ms')::numeric) as p50,
             max((j.n->>'maxUploadDelayP95Ms')::numeric) as p95, max((j.n->>'maxUploadDelayMs')::numeric) as mx,
             coalesce(sum((j.n->>'futureStamped')::numeric), 0) as fs, coalesce(sum((j.n->>'futureStampedInstalls')::numeric), 0) as fi
      from j where j.job = 'projection' and j.n ? 'newEvents' group by 1
    ) x cross join lateral (values ('new_events', x.ne), ('upload_delay_p50_ms', x.p50), ('upload_delay_p95_ms', x.p95),
      ('upload_delay_max_ms', x.mx), ('stamped_ahead', x.fs), ('stamped_ahead_installs', x.fi)) m(metric, v)
    where m.v is not null
    union all
    select j.at, 'safety', 'canary_runs', '', count(*) from j where j.job = 'fold_canary' group by 1
    union all
    select j.at, 'safety', 'canary_mismatched', '', coalesce(sum((j.n->>'mismatched')::numeric), 0) from j where j.job = 'fold_canary' group by 1

    -- people
    union all
    select r.at, 'people', 'active_accounts', '', count(distinct r.delivered_by) from r group by 1
    union all
    select pg_catalog.date_bin(p_step, u.created_at, p_from), 'people', 'new_accounts', '', count(*)
    from auth.users u where u.created_at >= p_from and u.created_at < p_to group by 1
    union all
    select pg_catalog.date_bin(p_step, b.created_at, p_from), 'people', 'new_organizations', '', count(*)
    from public.org_bootstraps b where b.created_at >= p_from and b.created_at < p_to group by 1
    union all
    select pg_catalog.date_bin(p_step, v.created_at, p_from), 'people', 'invites_issued', '', count(*)
    from public.invites v where v.created_at >= p_from and v.created_at < p_to group by 1
    union all
    select pg_catalog.date_bin(p_step, x.redeemed_at, p_from), 'people', 'invites_redeemed', '', count(*)
    from public.invite_redemptions x where x.redeemed_at >= p_from and x.redeemed_at < p_to group by 1

    -- jobs
    union all
    select j.at, 'jobs', m.metric, m.k, sum(m.v) from j cross join lateral (values
      ('runs', '', 1), ('runs', j.job, 1),
      ('failed', '', case when j.outcome = 'error' then 1 else 0 end), ('failed', j.job, case when j.outcome = 'error' then 1 else 0 end),
      ('partial', '', case when j.outcome = 'partial' then 1 else 0 end), ('partial', j.job, case when j.outcome = 'partial' then 1 else 0 end)
    ) m(metric, k, v) group by 1, 3, 4
    union all
    select j.at, 'jobs', 'p95_ms', j.job, round((percentile_cont(0.95) within group (order by j.ms))::numeric) from j group by 1, 4
    union all
    select pg_catalog.date_bin(p_step, d.start_time, p_from), 'cron', m.metric, m.k, sum(m.v)
    from cron.job_run_details d join cron.job c using (jobid)
    cross join lateral (values ('runs', '', 1), ('runs', c.jobname, 1),
      ('failed', '', case when d.status = 'failed' then 1 else 0 end), ('failed', c.jobname, case when d.status = 'failed' then 1 else 0 end)) m(metric, k, v)
    where d.start_time >= p_from and d.start_time < p_to group by 1, 3, 4
    union all
    select x.at, 'push', 'delivery', e.key, sum(e.value::numeric)
    from (select j.at, j.n from j where j.job = 'push_delivery') x cross join lateral pg_catalog.jsonb_each_text(x.n) e
    where pg_catalog.jsonb_typeof(x.n -> e.key) = 'number' group by 1, 4

    -- worker: the tally's keys are <route>_<class> (apps/web/worker/requestTally.ts)
    union all
    select q.at, 'worker', m.metric, k, sum(q.v) from (
      select x.at, regexp_replace(e.key, '_(2xx|3xx|4xx|5xx|429|lt100ms|lt1s|lt10s|over10s)$', '') as route,
             substring(e.key from '_(2xx|3xx|4xx|5xx|429|lt100ms|lt1s|lt10s|over10s)$') as class, e.value::numeric as v
      from (select j.at, j.n from j where j.job = 'worker_requests') x cross join lateral pg_catalog.jsonb_each_text(x.n) e
      where pg_catalog.jsonb_typeof(x.n -> e.key) = 'number'
    ) q cross join lateral (values
      (case when q.class in ('2xx', '3xx', '4xx', '5xx') then 'requests' end),
      (case when q.class = '5xx' then 'server_errors' end),
      (case when q.class = '429' then 'refused' end),
      (case when q.class in ('lt10s', 'over10s') then 'slow' end)
    ) m(metric) cross join lateral (values (''), (q.route)) ks(k)
    where q.class is not null and m.metric is not null group by 1, 3, 4
    union all
    select x.at, 'integrations', 'webhook_deliveries', e.key, sum(e.value::numeric)
    from (select j.at, j.n from j where j.job = 'webhook_dispatch') x cross join lateral pg_catalog.jsonb_each_text(x.n) e
    where pg_catalog.jsonb_typeof(x.n -> e.key) = 'number' group by 1, 4

    -- storage and capacity
    union all
    select r.at, 'storage', 'lost_files_installs', '', count(distinct r.install_id) from r
    where r.kind = 'device' and (r.n->>'lostFiles')::numeric > 0 group by 1
    union all
    select r.at, 'storage', 'lost_recordings_installs', '', count(distinct r.install_id) from r
    where r.kind = 'device' and (r.n->>'lostRecordings')::numeric > 0 group by 1
    union all
    select x.at, 'storage', 'r2_check', e.key, max(e.value::numeric)
    from (select j.at, j.n from j where j.job = 'blob_reconcile') x cross join lateral pg_catalog.jsonb_each_text(x.n) e
    where pg_catalog.jsonb_typeof(x.n -> e.key) = 'number' group by 1, 4
    union all
    select x.at, 'capacity', m.metric, '', max(m.v) from (select j.at, j.n from j where j.job = 'fold_canary') x
    cross join lateral (values ('db_bytes', (x.n->>'dbBytes')::numeric), ('events_bytes', (x.n->>'eventsBytes')::numeric),
      ('snapshots_bytes', (x.n->>'snapshotsBytes')::numeric)) m(metric, v)
    where m.v is not null group by 1, 3

    -- support and user issues
    union all
    select j.at, 'support', 'account_deletions', '', count(*) from j where j.job = 'account_delete' group by 1
    union all
    select pg_catalog.date_bin(p_step, f.created_at, p_from), 'support', 'feedback', k, count(*)
    from diag.feedback f cross join lateral (values (''), (f.kind)) ks(k)
    where f.created_at >= p_from and f.created_at < p_to group by 1, 4
    union all
    select pg_catalog.date_bin(p_step, c.created_at, p_from), 'support', 'content_reports', '', count(*)
    from public.content_reports c where c.created_at >= p_from and c.created_at < p_to group by 1
    union all
    select pg_catalog.date_bin(p_step, u.first_looked_at, p_from), 'userissues', 'looked_at_first', k, count(*)
    from ops.user_issues u cross join lateral (values (''), (u.verdict)) ks(k)
    where u.first_looked_at >= p_from and u.first_looked_at < p_to group by 1, 4
  ),
  ranked as (
    select x.*, row_number() over (partition by x.at, x.part, x.metric order by x.value desc, x.key) as rn
    from nums x where x.key <> ''
  )
  select x.at, x.part, x.metric, x.key, x.value from nums x where x.key = ''
  union all
  select x.at, x.part, x.metric, x.key, x.value from ranked x where x.rn <= 30
  union all
  select x.at, x.part, x.metric, '_other', sum(x.value) from ranked x where x.rn > 30 group by 1, 2, 3
$$;
revoke all on function diag.daily_compute(timestamptz, timestamptz, interval) from public, anon, authenticated, service_role;

-- ---- the fill ---------------------------------------------------------------------------------

-- How many days and hours with no totals yet one run counts, newest first.
create or replace function diag.daily_backfill_days() returns int language sql immutable as $$ select 2 $$;
create or replace function diag.daily_backfill_hours() returns int language sql immutable as $$ select 24 $$;

-- Counts the buckets of one step from p_from to p_to again, whole: a key that
-- dropped out of a bucket's 30 largest goes, and a bucket with no records is
-- marked counted with no rows.
create or replace function diag.daily_refill(p_step text, p_from timestamptz, p_to timestamptz) returns int
language plpgsql security definer set search_path = '' as $$
declare v_rows int := 0; v_n int;
begin
  if p_step = 'hour' then
    delete from diag.hourly h where h.hour >= p_from and h.hour < p_to;
    insert into diag.hourly (hour, part, metric, key, value)
    select c.at, c.part, c.metric, c.key, c.value from diag.daily_compute(p_from, p_to, interval '1 hour') c;
  elsif p_step = 'day' then
    delete from diag.daily d where d.day >= (p_from at time zone 'UTC')::date and d.day < (p_to at time zone 'UTC')::date;
    insert into diag.daily (day, part, metric, key, value)
    select (c.at at time zone 'UTC')::date, c.part, c.metric, c.key, c.value from diag.daily_compute(p_from, p_to, interval '1 day') c;
  else
    raise exception 'step is hour or day, not %', p_step;
  end if;
  get diagnostics v_rows = row_count;
  insert into diag.daily_filled (step, at, filled_at, rows)
  select p_step, b, now(), (select count(*) from diag.hourly h where p_step = 'hour' and h.hour = b)
    + (select count(*) from diag.daily d where p_step = 'day' and d.day = (b at time zone 'UTC')::date)
  from pg_catalog.generate_series(p_from, p_to - interval '1 second', ('1 ' || p_step)::interval) b
  on conflict (step, at) do update set filled_at = excluded.filled_at, rows = excluded.rows;
  get diagnostics v_n = row_count;
  return v_rows;
end $$;
revoke all on function diag.daily_refill(text, timestamptz, timestamptz) from public, anon, authenticated, service_role;

-- One run of the job, every 10 minutes: this hour and the last; today and
-- yesterday once an hour; a few buckets with no totals yet; sizes now; and
-- hours past 14 days go. A run that overlaps another does nothing. It records
-- a run (job daily_totals), so a stopped job shows on the dashboard.
create or replace function diag.daily_fill(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_started timestamptz := clock_timestamp();
  v_hour timestamptz := pg_catalog.date_trunc('hour', p_now, 'UTC');
  v_day timestamptz := pg_catalog.date_trunc('day', p_now, 'UTC');
  v_hours int := 2;
  v_days int := 0;
  v_rows int := 0;
  v_b timestamptz;
  v_sizes jsonb;
  v_result jsonb;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('diag.daily_fill')) then
    return '{"skipped":true}'::jsonb;
  end if;
  v_rows := v_rows + diag.daily_refill('hour', v_hour - interval '1 hour', v_hour + interval '1 hour');

  -- Today and yesterday, at most once in 50 minutes: yesterday's late arrivals land in it.
  if not exists (select 1 from diag.daily_filled f where f.step = 'day' and f.at = v_day and f.filled_at > p_now - interval '50 minutes') then
    v_rows := v_rows + diag.daily_refill('day', v_day - interval '1 day', v_day + interval '1 day');
    v_days := 2;
  end if;

  -- Days with raw records (the last 89) and hours of the last 14 days that were never counted, newest first.
  for v_b in
    select b from pg_catalog.generate_series(v_day - interval '89 days', v_day - interval '2 days', interval '1 day') b
    where not exists (select 1 from diag.daily_filled f where f.step = 'day' and f.at = b)
    order by b desc limit diag.daily_backfill_days()
  loop
    v_rows := v_rows + diag.daily_refill('day', v_b, v_b + interval '1 day');
    v_days := v_days + 1;
  end loop;
  for v_b in
    select b from pg_catalog.generate_series(v_hour - interval '14 days', v_hour - interval '2 hours', interval '1 hour') b
    where not exists (select 1 from diag.daily_filled f where f.step = 'hour' and f.at = b)
    order by b desc limit diag.daily_backfill_hours()
  loop
    v_rows := v_rows + diag.daily_refill('hour', v_b, v_b + interval '1 hour');
    v_hours := v_hours + 1;
  end loop;

  -- The database's size now, for today: the fold canary's nightly sizes give the days before.
  v_sizes := diag.ops_sizes();
  insert into diag.daily (day, part, metric, key, value)
  select (v_day at time zone 'UTC')::date, 'capacity', m.metric, '', m.v
  from (values ('db_bytes', (v_sizes->>'dbBytes')::numeric), ('events_bytes', (v_sizes->>'eventsBytes')::numeric),
               ('snapshots_bytes', (v_sizes->>'snapshotsBytes')::numeric)) m(metric, v)
  where m.v is not null
  on conflict (part, metric, day, key) do update set value = greatest(diag.daily.value, excluded.value);

  delete from diag.hourly h where h.hour < v_hour - interval '14 days';
  delete from diag.daily_filled f where f.step = 'hour' and f.at < v_hour - interval '14 days';

  v_result := jsonb_build_object('hours', v_hours, 'days', v_days, 'rows', v_rows);
  insert into diag.job_runs (job, started_at, ms, outcome, n)
  values ('daily_totals', v_started, (extract(epoch from clock_timestamp() - v_started) * 1000)::int, 'ok', v_result);
  return v_result;
end $$;
revoke all on function diag.daily_fill(timestamptz) from public, anon, authenticated, service_role;

insert into diag.job_schedule (job, every, slack, runs_on) values
  ('daily_totals', interval '10 minutes', interval '20 minutes', 'pg_cron, langquest-daily-totals, in the database')
on conflict (job) do update set every = excluded.every, slack = excluded.slack, runs_on = excluded.runs_on;

-- ---- what the dashboard reads ----------------------------------------------------------------

-- One part's numbers over a range, in buckets: 24h by hour (diag.hourly),
-- 14d and 90d by day, 1y by week and all by month (diag.daily). Each number
-- has its total and, when it has keys, its 10 largest keys over the range,
-- the rest added up as '_other', with one value for each bucket (null where
-- nothing was counted). A week or a month adds a `sum` number up and shows a
-- `max` number at its busiest day. `counted` says, for each bucket, whether
-- any of it was counted yet: a counted bucket with no records holds 0 for a
-- `sum` number, and one not counted yet holds null, not 0. Buckets start at
-- midnight UTC.
create or replace function diag.ops_series(p_part text, p_range text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_hour timestamptz := pg_catalog.date_trunc('hour', v_now, 'UTC');
  v_today date := (v_now at time zone 'UTC')::date;
  v_step text;
  v_from timestamptz;
  v_buckets timestamptz[];
  v_series jsonb;
  v_counted jsonb;
begin
  if p_range is null or p_range not in ('24h', '14d', '90d', '1y', 'all') then
    raise exception 'range is 24h, 14d, 90d, 1y or all' using errcode = '22023';
  end if;
  v_step := case p_range when '24h' then 'hour' when '1y' then 'week' when 'all' then 'month' else 'day' end;
  v_from := case p_range
    when '24h' then v_hour - interval '23 hours'
    when '14d' then (v_today - 13)::timestamp at time zone 'UTC'
    when '90d' then (v_today - 89)::timestamp at time zone 'UTC'
    when '1y' then pg_catalog.date_trunc('week', (v_today - 364)::timestamp) at time zone 'UTC'
    else pg_catalog.date_trunc('month', coalesce((select min(d.day) from diag.daily d where d.part = p_part), v_today)::timestamp) at time zone 'UTC' end;
  v_buckets := array(select pg_catalog.generate_series(v_from, case when v_step = 'hour' then v_hour else v_today::timestamp at time zone 'UTC' end,
    ('1 ' || v_step)::interval));
  select jsonb_agg(exists (select 1 from diag.daily_filled f
           where f.step = case when v_step = 'hour' then 'hour' else 'day' end and f.at >= b.at and f.at < b.at + ('1 ' || v_step)::interval) order by b.i)
  into v_counted from unnest(v_buckets) with ordinality b(at, i);

  with pts as (
    select h.metric, h.key, h.hour as b, h.value
    from diag.hourly h where v_step = 'hour' and h.part = p_part and h.hour >= v_from
    union all
    select d.metric, d.key, pg_catalog.date_trunc(v_step, d.day::timestamp) at time zone 'UTC',
           case m.agg when 'max' then max(d.value) else sum(d.value) end
    from diag.daily d join diag.daily_metrics m on m.part = d.part and m.metric = d.metric
    where v_step <> 'hour' and d.part = p_part and d.day >= (v_from at time zone 'UTC')::date
    group by d.metric, d.key, 3, m.agg
  ),
  m as (select x.metric, x.agg from diag.daily_metrics x where x.part = p_part),
  keyed as (
    select k.metric, k.key, row_number() over (partition by k.metric order by k.total desc, k.key) as rn
    from (select p.metric, p.key, sum(p.value) as total from pts p where p.key not in ('', '_other') group by 1, 2) k
  ),
  named as (
    select p.metric, case when p.key = '' then '' when kd.rn <= 10 then p.key else '_other' end as key, p.b, p.value
    from pts p left join keyed kd on kd.metric = p.metric and kd.key = p.key
  ),
  idx as (select b.at, b.i::int as i from unnest(v_buckets) with ordinality b(at, i)),
  folded as (
    select n.metric, n.key, ix.i, case when m.agg = 'max' and n.key <> '_other' then max(n.value) else sum(n.value) end as value
    from named n join m using (metric) join idx ix on ix.at = n.b group by 1, 2, 3, m.agg
  ),
  -- Each series as {bucket number: value}, then one value for each bucket in order.
  series as (
    select f.metric, f.key, m.agg, jsonb_object_agg(f.i::text, f.value) as byi
    from folded f join m using (metric) group by 1, 2, 3
  )
  select coalesce(jsonb_agg(jsonb_build_object('metric', s.metric, 'key', s.key, 'agg', s.agg, 'values',
      (select jsonb_agg(coalesce(s.byi -> ix.i::text,
         case when s.agg = 'sum' and (v_counted ->> (ix.i - 1))::boolean then '0'::jsonb else 'null'::jsonb end) order by ix.i) from idx ix))
    order by s.metric, s.key <> '', s.key), '[]'::jsonb)
  into v_series from series s;

  return jsonb_build_object('part', p_part, 'range', p_range, 'step', v_step,
    'buckets', to_jsonb(v_buckets), 'counted', v_counted, 'series', v_series);
end $$;
revoke all on function diag.ops_series(text, text) from public, anon, authenticated;
grant execute on function diag.ops_series(text, text) to diag_reader;

-- ---- the schedule -------------------------------------------------------------------------

-- It needs no secret, so a reset keeps it (server/cronSmoke.sql).
do $$
begin
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'langquest-daily-totals';
  perform cron.schedule('langquest-daily-totals', '4-59/10 * * * *', $job$
    select diag.daily_fill();
  $job$);
end $$;
