-- A language's first download: only a first download, and its time without the wait for a
-- connection (docs/ops-dashboard-plan.md, "Time to a usable Map").
--
-- A phone writes an `open` record each time it opens a stream: a language or the
-- organization, with rows already there (`cold` no) or with none (`cold` yes). Its `ms`
-- runs from the open to the first sync that reads the stream up to date, so it holds the
-- time the phone waited with no connection and the time of the download together. The ops
-- dashboard counted every open as "a language's first download" and showed `ms` as its
-- time, so one phone that opened a language with no connection for 21 minutes made the
-- line "A language's first download took over 18 minutes" (18 November 2026), when the
-- download took 0.2 seconds.
--
-- From here:
--   1. An `open` record is a first download when the stream had no rows on that phone
--      (`cold` yes) and the stream is a language (diag.first_download).
--   2. Its wait is the time with no connection that the phone's `sync` records of that
--      stream hold for the time of the open (`offlineMs`, diag.open_wait_ms), and its
--      download time is `ms` less that wait. The dashboard shows the two apart, and its
--      line reads the download time only. No record is changed or left out.
--   3. "First downloads of a language" counts each first download once: its `open`
--      record. A big language also writes a `fill` record, which was counted too.
--
-- The same rules in three places: diag.daily_compute (the totals the charts read),
-- diag.ops_fleet (the table and the line), and diag.detail_filters (the records behind a
-- tapped point). Both functions are whole copies of their last definition
-- (20261117060000_diag_daily.sql, 20261117200000_ops_phone_counts.sql) with these rules.
-- The totals of the days that still have raw records are counted again below.

-- ---- the rules --------------------------------------------------------------------------------

-- An `open` record is a language's first download: the stream had no rows on that phone,
-- and it is a language, not the organization's stream or a person's.
create or replace function diag.first_download(p_org text, p_stream text, p_t jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_t->>'cold' = 'yes' and p_stream <> '_org' and p_org <> '_person', false)
$$;
revoke all on function diag.first_download(text, text, jsonb) from public, anon, authenticated, service_role;

-- The time an open waited with no connection: a phone that reaches the server again writes
-- a `sync` record with the length of the spell before it (`offlineMs`; a sign-in that could
-- not be renewed counts as such a spell). The spells that ended during the open, on this
-- phone and stream, are its wait, and never more than the open itself. An open whose sync
-- record did not arrive has no wait, so its whole time stays its download time.
create or replace function diag.open_wait_ms(p_install text, p_org text, p_stream text, p_at timestamptz, p_ms numeric) returns numeric
language sql stable set search_path = '' as $$
  select least(p_ms, coalesce((
    select sum((s.n->>'offlineMs')::numeric) from diag.records s
    where s.install_id = p_install and s.kind = 'sync' and s.org_id = p_org and s.stream_id = p_stream and s.n ? 'offlineMs'
      and s.at > p_at - pg_catalog.make_interval(secs => (p_ms / 1000.0)::double precision) - interval '5 seconds'
      and s.at <= p_at + interval '5 seconds'), 0))
$$;
revoke all on function diag.open_wait_ms(text, text, text, timestamptz, numeric) from public, anon, authenticated, service_role;

-- The two numbers of the wait, beside the three of the time.
insert into diag.daily_metrics (part, metric, agg) values
  ('fleet', 'first_download_waits', 'sum'), ('fleet', 'first_download_wait_max_ms', 'max')
on conflict (part, metric) do update set agg = excluded.agg;

-- ---- the totals the charts read ----------------------------------------------------------------

create or replace function diag.daily_compute(p_from timestamptz, p_to timestamptz, p_step interval)
returns table (at timestamptz, part text, metric text, key text, value numeric)
language sql stable security definer set search_path = '' as $$
  with r as materialized (
    select pg_catalog.date_bin(p_step, x.received_at, p_from) as at, x.at as phone_at, x.install_id, x.delivered_by, x.org_id, x.stream_id, x.kind, x.update_id, x.n, x.t
    from diag.records x where x.received_at >= p_from and x.received_at < p_to
  ),
  -- A run is written as it ends, so its arrival is at most a day after it began.
  j as materialized (
    select pg_catalog.date_bin(p_step, x.started_at, p_from) as at, x.job, x.ms, x.outcome, x.n
    from diag.job_runs x
    where x.received_at >= p_from and x.received_at < p_to + interval '1 day' and x.started_at >= p_from and x.started_at < p_to
  ),
  ri as materialized (select distinct r.at, r.install_id, coalesce(left(r.update_id, 8), 'embedded') as up from r),
  -- A language's first download: its `open` record with the wait and the download time apart,
  -- and a big language's `fill` record with the time to its Map.
  fd as materialized (
    select o.at, 'open' as k, o.ms - o.wait as v, o.wait
    from (select r.at, (r.n->>'ms')::numeric as ms, diag.open_wait_ms(r.install_id, r.org_id, r.stream_id, r.phone_at, (r.n->>'ms')::numeric) as wait
          from r where r.kind = 'open' and r.n ? 'ms' and diag.first_download(r.org_id, r.stream_id, r.t)) o
    union all
    select r.at, 'fill', (r.n->>'msToMap')::numeric, 0 from r where r.kind = 'fill' and r.t->>'event' = 'start' and r.n ? 'msToMap'
  ),
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
      select fd.at, fd.k,
             round((percentile_cont(0.5) within group (order by fd.v))::numeric) as p50,
             round((percentile_cont(0.95) within group (order by fd.v))::numeric) as p95
      from fd group by 1, 2
    ) q cross join lateral (values ('first_download_p50_ms', q.p50), ('first_download_p95_ms', q.p95)) m(metric, v)
    where m.v is not null
    union all
    select q.at, 'fleet', m.metric, '', m.v from (
      select fd.at, count(*)::numeric as c, (count(*) filter (where fd.wait > 0))::numeric as w, max(fd.wait) filter (where fd.wait > 0) as mx
      from fd where fd.k = 'open' group by 1
    ) q cross join lateral (values ('first_downloads', q.c), ('first_download_waits', nullif(q.w, 0)), ('first_download_wait_max_ms', q.mx)) m(metric, v)
    where m.v is not null
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


-- ---- the table and the line -------------------------------------------------------------------

create or replace function diag.ops_fleet() returns jsonb
language sql stable security definer set search_path = '' as $$
with seen as (select install_id, context, last_seen from diag.installs where last_seen > now() - interval '14 days')
select jsonb_build_object(
  'builds', (select coalesce(jsonb_agg(jsonb_build_object('platform', x.os, 'version', x.v, 'reducers', x.rv, 'day', x.d, 'week', x.w, 'fortnight', x.f) order by x.os, x.v desc), '[]'::jsonb)
    from (select coalesce(context->>'os', '?') as os, coalesce(context->>'appVersion', '?') as v, string_agg(distinct context->>'reducerVersion', ', ') as rv,
                 count(*) filter (where last_seen > now() - interval '1 day') as d, count(*) filter (where last_seen > now() - interval '7 days') as w, count(*) as f
          from seen where coalesce(context->>'channel', '') <> 'development' and coalesce(context->>'os', '') <> 'web' group by 1, 2) x),
  'updates', (select coalesce(jsonb_agg(jsonb_build_object('update', x.up, 'runtime', x.rt, 'channel', x.ch, 'installs', x.i,
      'crashed', x.cr, 'firstSeen', x.fs, 'lastSeen', x.ls) order by x.fs desc), '[]'::jsonb)
    from (select u.update_key as up, max(s.context->>'runtimeVersion') as rt, max(s.context->>'channel') as ch,
                 count(*) as i, count(*) filter (where u.crashed_at > now() - interval '14 days') as cr,
                 min(u.first_at) as fs, max(u.last_at) as ls
          from diag.install_updates u left join seen s using (install_id)
          where u.last_at > now() - interval '14 days'
          group by 1 order by min(u.first_at) desc limit 12) x),
  'versions', (select coalesce(jsonb_agg(jsonb_build_object('reducer', x.rv, 'protocol', x.pv, 'installs', x.c) order by x.c desc), '[]'::jsonb)
    from (select context->>'reducerVersion' as rv, context->>'protocolVersion' as pv, count(*) as c
          from seen where last_seen > now() - interval '7 days' group by 1, 2) x),
  'web', (select coalesce(jsonb_agg(jsonb_build_object('commit', x.cm, 'installs', x.c) order by x.c desc), '[]'::jsonb)
    from (select context->>'runtimeVersion' as cm, count(*) as c from seen
          where context->>'channel' = 'web' and last_seen > now() - interval '7 days' group by 1 limit 10) x),
  -- An open's time is its download time: without the wait (diag.open_wait_ms). slow counts the
  -- ones over 15 minutes, the line's limit (FIRST_DOWNLOAD_SLOW_MS, apps/admin/src/sources/ops.ts).
  'toMap', (select coalesce(jsonb_agg(jsonb_build_object('day', x.d, 'kind', x.k, 'count', x.c, 'p50Ms', x.p50, 'p95Ms', x.p95,
      'slow', x.slow, 'waited', x.waited, 'waitMaxMs', x.wmax) order by x.d, x.k), '[]'::jsonb)
    from (select to_char(date_trunc('day', received_at), 'YYYY-MM-DD') as d, k, count(*) as c,
                 round(percentile_cont(0.5) within group (order by v)) as p50, round(percentile_cont(0.95) within group (order by v)) as p95,
                 count(*) filter (where v > 900000) as slow,
                 case when k = 'open' then count(*) filter (where wait > 0) end as waited, round(max(wait) filter (where wait > 0)) as wmax
          from (select o.received_at, 'open' as k, o.ms - o.wait as v, o.wait
                from (select received_at, (n->>'ms')::numeric as ms, diag.open_wait_ms(install_id, org_id, stream_id, at, (n->>'ms')::numeric) as wait
                      from diag.records where kind = 'open' and n ? 'ms' and diag.first_download(org_id, stream_id, t) and received_at > now() - interval '14 days') o
                union all
                select received_at, 'fill', (n->>'msToMap')::numeric, null
                from diag.records where kind = 'fill' and received_at > now() - interval '14 days' and t->>'event' = 'start') q
          where v is not null group by 1, 2) x),
  'firstDownloads', (select coalesce(jsonb_agg(jsonb_build_object('day', x.d, 'what', x.w, 'reason', x.re, 'count', x.c, 'installs', x.i) order by x.d desc, x.c desc, x.w, x.re), '[]'::jsonb)
    from (select to_char(date_trunc('day', q.received_at), 'YYYY-MM-DD') as d, q.w, q.re, count(*) as c, count(distinct q.install_id) as i
          from (select r.received_at, r.install_id, r.t->>'event' as w, coalesce(r.t->>'reason', '?') as re
                from diag.records r left join seen s using (install_id)
                where r.kind = 'fill' and r.received_at > now() - interval '14 days'
                  and coalesce(s.context->>'channel', '') <> 'development' and r.t->>'event' in ('fallback', 'restart')
                union all
                -- The organization's and a person's streams never have a snapshot, so only a language's says anything.
                select r.received_at, r.install_id, 'no_snapshot', coalesce(s.context->>'reducerVersion', '?')
                from diag.records r left join seen s using (install_id)
                where r.kind = 'snapshot' and r.received_at > now() - interval '14 days'
                  and coalesce(s.context->>'channel', '') <> 'development'
                  and r.t->>'outcome' = 'none' and r.stream_id <> '_org' and r.org_id <> '_person') q
          group by 1, 2, 3 order by 1 desc, 4 desc limit 40) x),
  'stuck', diag.ops_stuck()
);
$$;
revoke all on function diag.ops_fleet() from public, anon, authenticated, service_role;

-- ---- the records behind a tapped point --------------------------------------------------------

-- A count's rows add up to its total (server/opsDetailSmoke.sql): the count is of `open`
-- records only, the times are of `open` and `fill`, and the waits are the opens that waited.
insert into diag.detail_filters (part, metric, source, filter, key) values
  ('fleet', 'first_downloads', 'records', 'x.kind = ''open'' and x.n ? ''ms'' and diag.first_download(x.org_id, x.stream_id, x.t)', ''''''),
  ('fleet', 'first_download_p50_ms', 'records', 'x.kind in (''open'', ''fill'') and ((x.kind = ''open'' and x.n ? ''ms'' and diag.first_download(x.org_id, x.stream_id, x.t))'
    || ' or (x.kind = ''fill'' and x.t->>''event'' = ''start'' and x.n ? ''msToMap''))', 'case when x.kind = ''open'' then ''open'' else ''fill'' end'),
  ('fleet', 'first_download_p95_ms', 'records', 'x.kind in (''open'', ''fill'') and ((x.kind = ''open'' and x.n ? ''ms'' and diag.first_download(x.org_id, x.stream_id, x.t))'
    || ' or (x.kind = ''fill'' and x.t->>''event'' = ''start'' and x.n ? ''msToMap''))', 'case when x.kind = ''open'' then ''open'' else ''fill'' end'),
  ('fleet', 'first_download_waits', 'records', 'x.kind = ''open'' and x.n ? ''ms'' and diag.first_download(x.org_id, x.stream_id, x.t)'
    || ' and diag.open_wait_ms(x.install_id, x.org_id, x.stream_id, x.at, (x.n->>''ms'')::numeric) > 0', ''''''),
  ('fleet', 'first_download_wait_max_ms', 'records', 'x.kind = ''open'' and x.n ? ''ms'' and diag.first_download(x.org_id, x.stream_id, x.t)'
    || ' and diag.open_wait_ms(x.install_id, x.org_id, x.stream_id, x.at, (x.n->>''ms'')::numeric) > 0', '''''')
on conflict (part, metric) do update set source = excluded.source, filter = excluded.filter, key = excluded.key;

-- ---- the totals so far, counted again ---------------------------------------------------------

-- Only these five numbers change, so only they are counted again: one read of the open and
-- fill records for the days (89, as diag.daily_fill) and one for the hours (14 days) that
-- still have raw records, then the months of those days. A total from a day whose raw
-- records are gone stays as it is. The function is this migration's own and goes at its end.
create function diag.first_download_again(p_step interval, p_from timestamptz)
returns table (at timestamptz, metric text, key text, value numeric)
language sql stable set search_path = '' as $$
  with fd as materialized (
    select pg_catalog.date_bin(p_step, o.received_at, p_from) as at, 'open' as k, o.ms - o.wait as v, o.wait
    from (select x.received_at, (x.n->>'ms')::numeric as ms, diag.open_wait_ms(x.install_id, x.org_id, x.stream_id, x.at, (x.n->>'ms')::numeric) as wait
          from diag.records x
          where x.received_at >= p_from and x.kind = 'open' and x.n ? 'ms' and diag.first_download(x.org_id, x.stream_id, x.t)) o
    union all
    select pg_catalog.date_bin(p_step, x.received_at, p_from), 'fill', (x.n->>'msToMap')::numeric, 0
    from diag.records x
    where x.received_at >= p_from and x.kind = 'fill' and x.t->>'event' = 'start' and x.n ? 'msToMap'
  )
  select q.at, m.metric, q.k, m.v from (
    select fd.at, fd.k,
           round((percentile_cont(0.5) within group (order by fd.v))::numeric) as p50,
           round((percentile_cont(0.95) within group (order by fd.v))::numeric) as p95
    from fd group by 1, 2
  ) q cross join lateral (values ('first_download_p50_ms', q.p50), ('first_download_p95_ms', q.p95)) m(metric, v)
  where m.v is not null
  union all
  select q.at, m.metric, '', m.v from (
    select fd.at, count(*)::numeric as c, (count(*) filter (where fd.wait > 0))::numeric as w, max(fd.wait) filter (where fd.wait > 0) as mx
    from fd where fd.k = 'open' group by 1
  ) q cross join lateral (values ('first_downloads', q.c), ('first_download_waits', nullif(q.w, 0)), ('first_download_wait_max_ms', q.mx)) m(metric, v)
  where m.v is not null
$$;

do $$
declare
  v_day timestamptz := pg_catalog.date_trunc('day', now(), 'UTC') - interval '89 days';
  v_hour timestamptz := pg_catalog.date_trunc('hour', now(), 'UTC') - interval '14 days';
  v_metrics text[] := array['first_downloads', 'first_download_p50_ms', 'first_download_p95_ms', 'first_download_waits', 'first_download_wait_max_ms'];
begin
  delete from diag.daily d where d.part = 'fleet' and d.metric = any (v_metrics) and d.day >= (v_day at time zone 'UTC')::date;
  insert into diag.daily (day, part, metric, key, value)
  select (a.at at time zone 'UTC')::date, 'fleet', a.metric, a.key, a.value from diag.first_download_again(interval '1 day', v_day) a;

  delete from diag.hourly h where h.part = 'fleet' and h.metric = any (v_metrics) and h.hour >= v_hour;
  insert into diag.hourly (hour, part, metric, key, value)
  select a.at, 'fleet', a.metric, a.key, a.value from diag.first_download_again(interval '1 hour', v_hour) a;

  perform diag.monthly_refill(m) from pg_catalog.generate_series(pg_catalog.date_trunc('month', v_day, 'UTC'), now(), interval '1 month') m;
end $$;

drop function diag.first_download_again(interval, timestamptz);
