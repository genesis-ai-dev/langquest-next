-- Read-only, as diag_reader (DIAG_DATABASE_URL). Ids, counts, timings and codes only.
-- Each line of output: <label>|<json>
with k as (
  select 'store_review' as who, diag.lookup_email('playreview@frontierrnd.com')->>'profileId' as pid
  union all select 'caleb', diag.lookup_email('caleb.koster@gmail.com')->>'profileId'
  union all select 'caleb', diag.lookup_email('caleb@frontierrnd.com')->>'profileId'
  union all select 'caleb_throwaway', diag.lookup_email('caleb.koster.eh@gmail.com')->>'profileId'
)
select 'known_profiles', jsonb_agg(jsonb_build_object('who', who, 'found', pid is not null)) from k;

-- 1. Sync errors in the last day, one row per install and phase:code
select '1_sync_errors_day', coalesce(jsonb_agg(x order by x.n desc), '[]') from (
  select left(r.install_id, 8) as install, i.context->>'os' as os, i.context->>'osVersion' as os_version, i.context->>'model' as model,
         i.context->>'channel' as channel, i.context->>'runtimeVersion' as runtime, i.context->>'reducerVersion' as reducer,
         coalesce(r.t->>'phase', '?') || ':' || coalesce(r.t->>'code', r.t->>'error', '?') as k, r.t->>'error' as error_name,
         count(*) as n, min(r.received_at) as first_at, max(r.received_at) as last_at,
         (select count(*) from diag.records o where o.install_id = r.install_id and o.kind = 'sync' and o.t->>'outcome' = 'ok' and o.received_at > now() - interval '1 day') as ok_syncs_same_day,
         coalesce((select k.who from (select 'store_review' who, diag.lookup_email('playreview@frontierrnd.com')->>'profileId' pid
            union all select 'caleb', diag.lookup_email('caleb.koster@gmail.com')->>'profileId'
            union all select 'caleb', diag.lookup_email('caleb@frontierrnd.com')->>'profileId') k where k.pid = i.profile_id limit 1), 'other') as who
  from diag.records r left join diag.installs i using (install_id)
  where r.kind = 'sync' and r.t->>'outcome' = 'error' and r.received_at > now() - interval '1 day'
  group by r.install_id, i.context, i.profile_id, r.t->>'phase', r.t->>'code', r.t->>'error') x;

-- 1b. Sync errors by day and phase:code, last 14 days (is this new?)
select '1b_sync_errors_by_day', coalesce(jsonb_agg(x order by x.day, x.n desc), '[]') from (
  select to_char(date_trunc('day', r.received_at), 'MM-DD') as day, coalesce(r.t->>'phase', '?') || ':' || coalesce(r.t->>'code', r.t->>'error', '?') as k,
         count(*) as n, count(distinct r.install_id) as installs,
         count(distinct r.install_id) filter (where i.context->>'os' = 'web') as web_installs
  from diag.records r left join diag.installs i using (install_id)
  where r.kind = 'sync' and r.t->>'outcome' = 'error' and r.received_at > now() - interval '14 days'
  group by 1, 2) x;

-- 2. Installs heard from this week on a reducer older than 21
select '2_old_reducer', coalesce(jsonb_agg(x order by x.n desc), '[]') from (
  select i.context->>'os' as os, i.context->>'channel' as channel, i.context->>'runtimeVersion' as runtime,
         i.context->>'reducerVersion' as reducer, i.context->>'embedded' as embedded, left(i.context->>'updateId', 8) as update_id,
         count(*) as n, min(i.first_seen) as first_seen, max(i.last_seen) as last_seen,
         count(*) filter (where i.profile_id = diag.lookup_email('playreview@frontierrnd.com')->>'profileId') as store_review,
         count(*) filter (where i.profile_id in (diag.lookup_email('caleb.koster@gmail.com')->>'profileId', diag.lookup_email('caleb@frontierrnd.com')->>'profileId', diag.lookup_email('caleb.koster.eh@gmail.com')->>'profileId')) as caleb,
         count(*) filter (where exists (select 1 from diag.records r where r.install_id = i.install_id and r.kind = 'sync' and r.t->>'outcome' = 'too_old' and r.received_at > now() - interval '7 days')) as told_too_old
  from diag.installs i
  where i.last_seen > now() - interval '7 days' and coalesce(nullif(i.context->>'reducerVersion', ''), '0')::int < 21
  group by 1, 2, 3, 4, 5, 6) x;

-- 2b. Everyone heard from this week, by os and reducer (for scale)
select '2b_all_by_reducer', coalesce(jsonb_agg(x order by x.os, x.reducer), '[]') from (
  select i.context->>'os' as os, i.context->>'reducerVersion' as reducer, count(*) as n
  from diag.installs i where i.last_seen > now() - interval '7 days' group by 1, 2) x;

-- 3. Installs that went quiet 3 days while another device of the same person still reports
with q as (
  select i.* from diag.installs i
  where i.last_seen < now() - interval '3 days' and i.last_seen > now() - interval '30 days' and i.profile_id is not null
    and coalesce(i.context->>'os', '') <> 'web'
    and exists (select 1 from diag.installs o where o.profile_id = i.profile_id and o.install_id <> i.install_id and o.last_seen > now() - interval '3 days')
), who as (
  select q.*, case
    when q.profile_id = diag.lookup_email('playreview@frontierrnd.com')->>'profileId' then 'store_review'
    when q.profile_id in (diag.lookup_email('caleb.koster@gmail.com')->>'profileId', diag.lookup_email('caleb@frontierrnd.com')->>'profileId', diag.lookup_email('caleb.koster.eh@gmail.com')->>'profileId') then 'caleb'
    else 'other' end as who
  from q
)
select '3_quiet_by_group', coalesce(jsonb_agg(x order by x.n desc), '[]') from (
  select who, context->>'os' as os, context->>'channel' as channel, context->>'runtimeVersion' as runtime, context->>'reducerVersion' as reducer,
         count(*) as n, count(distinct profile_id) as profiles,
         min(first_seen) as first_seen, max(last_seen) as last_seen,
         round(avg(extract(epoch from last_seen - first_seen) / 3600)::numeric, 1) as avg_hours_alive,
         count(*) filter (where last_seen - first_seen < interval '1 day') as alive_under_a_day,
         count(*) filter (where context->>'model' ilike any (array['%sdk_gphone%', '%emulator%', '%Simulator%', '%generic%'])) as emulator_like
  from who group by 1, 2, 3, 4, 5) x;

with q as (
  select i.* from diag.installs i
  where i.last_seen < now() - interval '3 days' and i.last_seen > now() - interval '30 days' and i.profile_id is not null
    and coalesce(i.context->>'os', '') <> 'web'
    and exists (select 1 from diag.installs o where o.profile_id = i.profile_id and o.install_id <> i.install_id and o.last_seen > now() - interval '3 days')
)
select '3b_quiet_per_profile', coalesce(jsonb_agg(x order by x.quiet desc), '[]') from (
  select left(q.profile_id, 8) as profile, count(*) as quiet,
         case when q.profile_id = diag.lookup_email('playreview@frontierrnd.com')->>'profileId' then 'store_review'
              when q.profile_id in (diag.lookup_email('caleb.koster@gmail.com')->>'profileId', diag.lookup_email('caleb@frontierrnd.com')->>'profileId', diag.lookup_email('caleb.koster.eh@gmail.com')->>'profileId') then 'caleb'
              else 'other' end as who,
         (select jsonb_agg(distinct coalesce(o.context->>'os', '?')) from diag.installs o where o.profile_id = q.profile_id and o.last_seen > now() - interval '3 days') as still_reporting_on,
         jsonb_agg(distinct coalesce(q.context->>'model', '?')) as quiet_models,
         (select count(*) from diag.installs a where a.profile_id = q.profile_id) as installs_ever
  from q group by q.profile_id) x;

-- 3c. Did the quiet installs say anything about diagnostics before going quiet (dropped or queued records, too-old syncs)?
with q as (
  select i.* from diag.installs i
  where i.last_seen < now() - interval '3 days' and i.last_seen > now() - interval '30 days' and i.profile_id is not null
    and coalesce(i.context->>'os', '') <> 'web'
    and exists (select 1 from diag.installs o where o.profile_id = i.profile_id and o.install_id <> i.install_id and o.last_seen > now() - interval '3 days')
)
select '3c_quiet_last_words', jsonb_build_object(
  'with_any_record', (select count(distinct r.install_id) from diag.records r join q using (install_id)),
  'diag_dropped', (select count(distinct r.install_id) from diag.records r join q using (install_id) where r.kind = 'device' and (r.n->>'diagDropped')::numeric > 0),
  'diag_queued_over_100', (select count(distinct r.install_id) from diag.records r join q using (install_id) where r.kind = 'device' and (r.n->>'diagQueued')::numeric > 100),
  'too_old_sync', (select count(distinct r.install_id) from diag.records r join q using (install_id) where r.kind = 'sync' and r.t->>'outcome' = 'too_old'),
  'unrenewed_sync', (select count(distinct r.install_id) from diag.records r join q using (install_id) where r.kind = 'sync' and r.t->>'outcome' = 'unrenewed'),
  'signed_out', (select count(distinct r.install_id) from diag.records r join q using (install_id) where r.kind = 'auth' and r.t->>'op' ilike '%sign%out%'),
  'last_seen_by_day', (select jsonb_object_agg(d, n) from (select to_char(date_trunc('day', last_seen), 'MM-DD') d, count(*) n from q group by 1) z));

-- 4. The tutorial jobs' runs, last 3 days
select '4_tutorial_jobs', coalesce(jsonb_agg(x order by x.started_at), '[]') from (
  select job, to_char(started_at at time zone 'UTC', 'MM-DD HH24:MI') as started_at, round(ms / 1000.0) as s, outcome, error_class, n
  from diag.job_runs where job in ('tutorial_publish', 'tutorial_comments', 'tutorial_intake', 'tutorial_review') and started_at > now() - interval '3 days') x;

-- 5. The app Worker's agent_api requests (the access-token API): by hour, last day, and by day, last 7
select '5_agent_api_by_hour', coalesce(jsonb_agg(x order by x.hour), '[]') from (
  select to_char(date_trunc('hour', started_at) at time zone 'UTC', 'MM-DD HH24') as hour,
         sum(coalesce((n->>'agent_api_lt100ms')::numeric, 0)) as lt100ms, sum(coalesce((n->>'agent_api_lt1s')::numeric, 0)) as lt1s,
         sum(coalesce((n->>'agent_api_lt10s')::numeric, 0)) as lt10s, sum(coalesce((n->>'agent_api_over10s')::numeric, 0)) as over10s,
         sum(coalesce((n->>'agent_api_4xx')::numeric, 0)) as s4xx, sum(coalesce((n->>'agent_api_5xx')::numeric, 0)) as s5xx
  from diag.job_runs where job = 'worker_requests' and started_at > now() - interval '1 day' and n ?| array['agent_api_2xx', 'agent_api_4xx', 'agent_api_5xx']
  group by 1) x;
select '5b_routes_by_day', coalesce(jsonb_agg(x order by x.day), '[]') from (
  select to_char(date_trunc('day', started_at), 'MM-DD') as day,
         sum(coalesce((n->>'agent_api_lt100ms')::numeric, 0) + coalesce((n->>'agent_api_lt1s')::numeric, 0)) as api_fast,
         sum(coalesce((n->>'agent_api_lt10s')::numeric, 0)) as api_1to10s, sum(coalesce((n->>'agent_api_over10s')::numeric, 0)) as api_over10s,
         sum(coalesce((n->>'reports_lt10s')::numeric, 0) + coalesce((n->>'reports_over10s')::numeric, 0)) as reports_slow,
         sum(coalesce((n->>'reports_lt100ms')::numeric, 0) + coalesce((n->>'reports_lt1s')::numeric, 0)) as reports_fast
  from diag.job_runs where job = 'worker_requests' and started_at > now() - interval '7 days' group by 1) x;

-- 6. The database's size: nightly history, now, by schema, biggest tables
select '6_size_history', coalesce(jsonb_agg(jsonb_build_object('at', to_char(started_at, 'MM-DD HH24:MI'), 'gb', round((n->>'dbBytes')::numeric / 1073741824.0, 2)) order by started_at), '[]')
  from diag.job_runs where job = 'fold_canary' and n ? 'dbBytes' and started_at > now() - interval '60 days';
select '6b_sizes_now', diag.ops_sizes();
select '6c_by_schema', coalesce(jsonb_agg(x order by x.gb desc), '[]') from (
  select n.nspname as schema, round(sum(pg_total_relation_size(c.oid))::numeric / 1073741824.0, 2) as gb
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r', 'm') group by 1 having sum(pg_total_relation_size(c.oid)) > 52428800) x;
select '6d_biggest_tables', coalesce(jsonb_agg(x order by x.gb desc), '[]') from (
  select n.nspname || '.' || c.relname as tbl, round(pg_total_relation_size(c.oid)::numeric / 1073741824.0, 2) as gb,
         round(pg_relation_size(c.oid)::numeric / 1073741824.0, 2) as heap_gb, greatest(c.reltuples, 0)::bigint as rows_est
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r', 'm')
  order by pg_total_relation_size(c.oid) desc limit 20) x;
