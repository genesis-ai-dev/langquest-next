-- Sign-in trouble: one rule for the chart, the table, the records behind a point and the
-- line on the Overview.
--
-- A phone writes an `auth` record for each step of signing in, staying signed in and getting
-- into an organization: what was tried (`op`), how it ended (`outcome`) and a code
-- (docs/diagnostics.md). The ops dashboard read those records by two rules:
--   - The chart "Sign-in trouble" and its table (diag.daily_compute, diag.ops_clients,
--     diag.detail_filters) counted every record that did not end `ok`, `done`, `keep` or
--     `home`: also a step with no connection, a wrong password, an invite that expired and a
--     new person with no organization yet.
--   - The line on the Overview (apps/admin/src/sources/diag.ts clientAlerts) read only a
--     step that ended `server`, `failed` or `unreachable` on three or more installs in a week.
-- So the chart showed many sign-in problems and the Overview said nothing (19 November 2026).
--
-- From here one function says what a record is (diag.sign_in_class):
--   ok        the step went as designed: `ok`, `done`, `keep`, `home`, and a new person who
--             is asked for a name (`needs_name`) or has no organization yet (`no_org`).
--   no_fault  the step did not finish, and neither the server nor the app failed: no
--             connection (`offline`, `unreachable`), a change the app tries again (`retry`),
--             a first screen shown before the organization was known (`org_unknown`; the
--             read that failed has its own record), an entry the server refused (a wrong
--             password or code, an email that has an account: `refused` on `sign_in`,
--             `sign_up`, `code`, `v2`) and an invite that cannot be used (`expired`, `used`,
--             `not_found`, `retired`).
--   trouble   all the rest: the server failed (`server`), a change was given up (`failed`), a
--             hand-over's sign-in was refused for good (`gone`), a renewal was answered with
--             a status (`http`), the server said too many (`rate_limited`), a sign-in ended
--             that the person did not end (`ended`), the server refused a step that holds
--             no entry of a person (`refused` on any other op), and an outcome no rule here
--             names, so a new outcome shows until someone says what it is.
-- "Sign-in trouble" counts trouble only, and each kind of it this week is a line on the
-- Overview. A second number, "Sign-in steps refused or with no connection", counts no_fault,
-- so no record leaves the page; it makes no line. The watch for user issues
-- (ops.user_issue_hits) is not changed: it reads every record here but no connection.
--
-- The same rule in three places: diag.daily_compute (the totals the charts read),
-- diag.ops_clients (the tables and the line), and diag.detail_filters (the records behind a
-- tapped point). Both functions are whole copies of their last definition
-- (20261118234300_first_download_wait.sql, 20261117200000_ops_phone_counts.sql) with this
-- rule. The totals of the days that still have raw records are counted again below.

-- ---- the rule ---------------------------------------------------------------------------------

create or replace function diag.sign_in_class(p_t jsonb) returns text
language sql immutable set search_path = '' as $$
  select case
    when coalesce(p_t->>'outcome', '') in ('ok', 'done', 'keep', 'home', 'needs_name', 'no_org') then 'ok'
    when coalesce(p_t->>'op', '') = 'ended' then 'trouble'
    when p_t->>'outcome' in ('offline', 'unreachable', 'retry', 'org_unknown', 'expired', 'used', 'not_found', 'retired') then 'no_fault'
    when p_t->>'outcome' = 'refused' and coalesce(p_t->>'op', '') in ('sign_in', 'sign_up', 'code', 'v2') then 'no_fault'
    else 'trouble'
  end
$$;
revoke all on function diag.sign_in_class(jsonb) from public, anon, authenticated, service_role;

-- A kind of sign-in record, as a chart's key: its op, its outcome and its code.
create or replace function diag.sign_in_key(p_t jsonb) returns text
language sql immutable set search_path = '' as $$
  select left(concat_ws(':', coalesce(p_t->>'op', '?'), coalesce(p_t->>'outcome', '?'), p_t->>'code'), 160)
$$;
revoke all on function diag.sign_in_key(jsonb) from public, anon, authenticated, service_role;

insert into diag.daily_metrics (part, metric, agg) values ('clients', 'sign_in_no_fault', 'sum')
on conflict (part, metric) do update set agg = excluded.agg;

update diag.detail_filters set filter = 'x.kind = ''auth'' and diag.sign_in_class(x.t) = ''trouble''', key = 'diag.sign_in_key(x.t)'
where part = 'clients' and metric = 'sign_in_trouble';
insert into diag.detail_filters (part, metric, source, filter, key) values
  ('clients', 'sign_in_no_fault', 'records', 'x.kind = ''auth'' and diag.sign_in_class(x.t) = ''no_fault''', 'diag.sign_in_key(x.t)')
on conflict (part, metric) do update set source = excluded.source, filter = excluded.filter, key = excluded.key;

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
    select a.at, 'clients', case a.class when 'trouble' then 'sign_in_trouble' else 'sign_in_no_fault' end, ks.k, count(*)
    from (select r.at, diag.sign_in_class(r.t) as class, diag.sign_in_key(r.t) as k from r where r.kind = 'auth') a
    cross join lateral (values (''), (a.k)) ks(k)
    where a.class in ('trouble', 'no_fault') group by 1, 3, 4
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

-- ---- the tables and the line -------------------------------------------------------------------

create or replace function diag.ops_clients() returns jsonb
language sql stable security definer set search_path = '' as $$
with seen as (select install_id, context, last_seen from diag.installs where last_seen > now() - interval '7 days'),
-- The week's sign-in records that did not end well, each with its class (diag.sign_in_class).
au as materialized (
  select x.op, x.oc, x.cd, x.cl, count(*) as c, count(distinct x.install_id) as i, max(x.received_at) as la
  from (select t->>'op' as op, t->>'outcome' as oc, t->>'code' as cd, diag.sign_in_class(t) as cl, install_id, received_at
        from diag.records where kind = 'auth' and received_at > now() - interval '7 days') x
  where x.cl in ('trouble', 'no_fault') group by 1, 2, 3, 4
)
select jsonb_build_object(
  'installs', jsonb_build_object(
    'day', (select count(*) from seen where last_seen > now() - interval '1 day'),
    'week', (select count(*) from seen),
    'all', (select count(*) from diag.installs)),
  'records', jsonb_build_object(
    'day', (select count(*) from diag.records where received_at > now() - interval '1 day'),
    'week', (select count(*) from diag.records where received_at > now() - interval '7 days')),
  'platforms', (select coalesce(jsonb_agg(jsonb_build_object('os', x.os, 'installs', x.c) order by x.c desc), '[]'::jsonb)
    from (select coalesce(context->>'os', 'unknown') as os, count(*) as c from seen group by 1) x),
  'builds', (select coalesce(jsonb_agg(jsonb_build_object('runtime', x.rt, 'channel', x.ch, 'update', x.up, 'embedded', x.em,
      'installs', x.c, 'lastSeen', x.ls) order by x.ls desc), '[]'::jsonb)
    from (select context->>'runtimeVersion' as rt, context->>'channel' as ch, left(context->>'updateId', 8) as up,
                 context->>'embedded' as em, count(*) as c, max(last_seen) as ls
          from seen group by 1, 2, 3, 4 order by max(last_seen) desc limit 12) x),
  'sync', (select coalesce(jsonb_object_agg(x.o, jsonb_build_object('records', x.c, 'installs', x.i)), '{}'::jsonb)
    from (select coalesce(t->>'outcome', 'unknown') as o, count(*) as c, count(distinct install_id) as i
          from diag.records where kind = 'sync' and received_at > now() - interval '1 day' group by 1) x),
  'syncErrors', (select coalesce(jsonb_agg(jsonb_build_object('code', x.k, 'records', x.c, 'installs', x.i) order by x.c desc), '[]'::jsonb)
    from (select coalesce(t->>'phase', '?') || ':' || coalesce(t->>'code', t->>'error', '?') as k, count(*) as c, count(distinct install_id) as i
          from diag.records where kind = 'sync' and received_at > now() - interval '1 day' and t->>'outcome' = 'error'
          group by 1 order by 2 desc limit 8) x),
  'errors', (select coalesce(jsonb_agg(jsonb_build_object('name', x.nm, 'where', x.wh, 'code', x.cd, 'fatal', x.ft, 'records', x.c,
      'day', x.cday, 'installs', x.i, 'lastAt', x.la, 'errorId', x.eid) order by x.la desc), '[]'::jsonb)
    from (select t->>'name' as nm, t->>'where' as wh, t->>'code' as cd, bool_or(t->>'fatal' = 'yes') as ft, count(*) as c,
                 count(*) filter (where received_at > now() - interval '1 day') as cday,
                 count(distinct install_id) as i, max(received_at) as la,
                 (array_agg(t->>'errorId' order by received_at desc))[1] as eid
          from diag.records where kind = 'error' and received_at > now() - interval '7 days'
          group by 1, 2, 3 order by max(received_at) desc limit 20) x),
  'expected', (select coalesce(jsonb_agg(jsonb_build_object('where', x.wh, 'name', x.nm, 'code', x.cd, 'count', x.c,
      'installs', x.i, 'lastAt', x.la) order by x.c desc), '[]'::jsonb)
    from (select t->>'where' as wh, t->>'name' as nm, t->>'code' as cd, sum(coalesce((n->>'count')::numeric, 1)) as c,
                 count(distinct install_id) as i, max(received_at) as la
          from diag.records where kind = 'expected' and received_at > now() - interval '7 days'
          group by 1, 2, 3 order by 4 desc limit 12) x),
  -- Every kind of trouble the page can hold makes a line, so trouble leads and has the most rows.
  'auth', (select coalesce(jsonb_agg(jsonb_build_object('op', x.op, 'outcome', x.oc, 'code', x.cd, 'class', x.cl, 'records', x.c,
      'installs', x.i, 'lastAt', x.la) order by (x.cl = 'trouble') desc, x.c desc, x.op, x.oc, x.cd), '[]'::jsonb)
    from ((select * from au where au.cl = 'trouble' order by au.c desc, au.op, au.oc, au.cd limit 20)
          union all
          (select * from au where au.cl = 'no_fault' order by au.c desc, au.op, au.oc, au.cd limit 12)) x),
  'transfer', (select coalesce(jsonb_object_agg(x.dir, x.tot), '{}'::jsonb)
    from (select coalesce(t->>'dir', 'unknown') as dir, diag.totals(array_agg(n)) as tot
          from diag.records where kind = 'transfer' and received_at > now() - interval '1 day' group by 1) x),
  'audio', (select diag.totals(array_agg(n)) from diag.records where kind = 'audio' and received_at > now() - interval '1 day'),
  'device', (select jsonb_build_object(
      'reporting', count(*),
      'lowDisk', count(*) filter (where (n->>'freeDiskMb')::numeric < 500),
      'lostFiles', count(*) filter (where (n->>'lostFiles')::numeric > 0),
      'lostRecordings', count(*) filter (where (n->>'lostRecordings')::numeric > 0),
      'unsentOverDay', count(*) filter (where (n->>'oldestUnsentMin')::numeric > 1440),
      'downloadStuckOverDay', count(*) filter (where (n->>'wantedStuckMin')::numeric > 1440),
      'diagDropped', count(*) filter (where (n->>'diagDropped')::numeric > 0))
    from diag.install_device where received_at > now() - interval '7 days')
);
$$;
revoke all on function diag.ops_clients() from public, anon, authenticated, service_role;

-- ---- the days and hours already counted --------------------------------------------------------

-- Only these two numbers change, so only they are counted again: one read of the sign-in
-- records for the days (89, as diag.daily_fill) and one for the hours (14 days) that still
-- have raw records, then the months of those days. A total from a day whose raw records are
-- gone stays as it is. The function is this migration's own and goes at its end.
create function diag.sign_in_again(p_step interval, p_from timestamptz)
returns table (at timestamptz, metric text, key text, value numeric)
language sql stable set search_path = '' as $$
  with nums as (
    select a.at, case a.class when 'trouble' then 'sign_in_trouble' else 'sign_in_no_fault' end as metric, ks.k as key, count(*)::numeric as value
    from (select pg_catalog.date_bin(p_step, x.received_at, p_from) as at, diag.sign_in_class(x.t) as class, diag.sign_in_key(x.t) as k
          from diag.records x where x.received_at >= p_from and x.kind = 'auth') a
    cross join lateral (values (''), (a.k)) ks(k)
    where a.class in ('trouble', 'no_fault') group by 1, 2, 3
  ),
  -- A number keeps its 30 largest keys in a bucket, the rest as '_other' (diag.daily_compute).
  ranked as (
    select n.*, row_number() over (partition by n.at, n.metric order by n.value desc, n.key) as rn from nums n where n.key <> ''
  )
  select n.at, n.metric, n.key, n.value from nums n where n.key = ''
  union all
  select r.at, r.metric, r.key, r.value from ranked r where r.rn <= 30
  union all
  select r.at, r.metric, '_other', sum(r.value) from ranked r where r.rn > 30 group by 1, 2
$$;

do $$
declare
  v_day timestamptz := pg_catalog.date_trunc('day', now(), 'UTC') - interval '89 days';
  v_hour timestamptz := pg_catalog.date_trunc('hour', now(), 'UTC') - interval '14 days';
  v_metrics text[] := array['sign_in_trouble', 'sign_in_no_fault'];
begin
  delete from diag.daily d where d.part = 'clients' and d.metric = any (v_metrics) and d.day >= (v_day at time zone 'UTC')::date;
  insert into diag.daily (day, part, metric, key, value)
  select (a.at at time zone 'UTC')::date, 'clients', a.metric, a.key, a.value from diag.sign_in_again(interval '1 day', v_day) a;

  delete from diag.hourly h where h.part = 'clients' and h.metric = any (v_metrics) and h.hour >= v_hour;
  insert into diag.hourly (hour, part, metric, key, value)
  select a.at, 'clients', a.metric, a.key, a.value from diag.sign_in_again(interval '1 hour', v_hour) a;

  perform diag.monthly_refill(m) from pg_catalog.generate_series(pg_catalog.date_trunc('month', v_day, 'UTC'), now(), interval '1 month') m;
end $$;

drop function diag.sign_in_again(interval, timestamptz);
