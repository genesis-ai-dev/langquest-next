-- The ops dashboard's two reads that grow with phones, "What installs
-- report" and "Builds in the field", counted every 10 minutes so the page
-- reads them at once at any number of phones (decisions.md 256).
--
-- At 40,000 installs with a week of records (8.4 million), the page's own
-- SQL for them took 19 s and 33 s and hit the 15 s statement limit: each
-- read every record of 7 or 14 days, of every kind. Now:
-- - Two small tables are kept up from the records since the last count:
--   diag.install_updates (each install and update it ran: first and last
--   seen, last crash) and diag.install_device (each install's last device
--   record of the week). A build's installs and the phones' disk, lost files
--   and stuck work come from them, not from 14 days of every record.
-- - diag.ops_clients() and diag.ops_fleet() hold the page's SQL, each other
--   kind read through the kind index (diag_records_kind_idx).
-- - diag.ops_cache_fill() runs both every 10 minutes (pg_cron,
--   langquest-ops-counts) into diag.ops_cache, and records an `ops_counts`
--   job run, so a stopped count shows as late on the page.
-- - diag.ops_cached(part), the one function diag_reader may run here,
--   answers the last count with when it was made; with none yet, it counts
--   now.
-- The cache holds counts and update ids, never an install id. The stuck
-- phones (install ids, as the page showed before) are read at once from
-- diag.install_device, whose rows go with the install (cascade) and with
-- the deleted account's records (diag.install_facts_forget).

-- ---- what each phone reported, kept as it comes ----------------------------------------------

-- One row for each install and each update it reported with (the first 8
-- characters of the update id, or 'embedded'): first and last seen, and its
-- last crash on that update. Kept 90 days, like the records it comes from.
create table if not exists diag.install_updates (
  install_id text not null references diag.installs (install_id) on delete cascade,
  update_key text not null,
  first_at timestamptz not null,
  last_at timestamptz not null,
  crashed_at timestamptz,
  primary key (install_id, update_key)
);
create index if not exists diag_install_updates_last_idx on diag.install_updates (last_at);
alter table diag.install_updates enable row level security;
revoke all on diag.install_updates from public, anon, authenticated, service_role;

-- Each install's last device record (free disk, lost files, unsent work),
-- for 7 days after it arrived.
create table if not exists diag.install_device (
  install_id text primary key references diag.installs (install_id) on delete cascade,
  received_at timestamptz not null,
  n jsonb not null
);
create index if not exists diag_install_device_received_idx on diag.install_device (received_at);
alter table diag.install_device enable row level security;
revoke all on diag.install_device from public, anon, authenticated, service_role;

-- Adds the records received since p_from. Least, greatest, the last crash
-- and the last device record are the same however often a record is
-- counted, so the overlap each run takes for records that commit late
-- changes nothing.
create or replace function diag.install_facts_add(p_from timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_updates integer;
  v_devices integer;
begin
  insert into diag.install_updates as u (install_id, update_key, first_at, last_at, crashed_at)
  select r.install_id, coalesce(left(r.update_id, 8), 'embedded'), min(r.received_at), max(r.received_at),
         max(r.received_at) filter (where r.kind = 'error' and r.t->>'fatal' = 'yes')
  from diag.records r
  where r.received_at >= p_from
    and exists (select 1 from diag.installs i where i.install_id = r.install_id)
  group by 1, 2
  on conflict (install_id, update_key) do update set
    first_at = least(u.first_at, excluded.first_at),
    last_at = greatest(u.last_at, excluded.last_at),
    crashed_at = greatest(u.crashed_at, excluded.crashed_at)
  where excluded.first_at < u.first_at or excluded.last_at > u.last_at
     or excluded.crashed_at > coalesce(u.crashed_at, '-infinity'::timestamptz);
  get diagnostics v_updates = row_count;

  insert into diag.install_device as d (install_id, received_at, n)
  select distinct on (r.install_id) r.install_id, r.received_at, r.n
  from diag.records r
  where r.kind = 'device' and r.received_at >= greatest(p_from, now() - interval '7 days')
    and exists (select 1 from diag.installs i where i.install_id = r.install_id)
  order by r.install_id, r.received_at desc
  on conflict (install_id) do update set received_at = excluded.received_at, n = excluded.n
  where excluded.received_at > d.received_at;
  get diagnostics v_devices = row_count;

  delete from diag.install_updates u where u.last_at < now() - interval '90 days';
  delete from diag.install_device d where d.received_at < now() - interval '7 days';
  return jsonb_build_object('updates', v_updates, 'devices', v_devices);
end $$;
revoke all on function diag.install_facts_add(timestamptz) from public, anon, authenticated, service_role;

-- A deleted account's records go (_delete_account), and what they said about
-- an install goes with them, though the install stays when another account
-- delivered from it last. diag.prune deletes records on every delivery, but
-- only ones over 90 days old, which these rows no longer hold, so it stops
-- at the first check.
create or replace function diag.install_facts_forget() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from gone g where g.received_at > now() - interval '89 days') then
    return null;
  end if;
  delete from diag.install_updates u
  using (select distinct g.install_id, coalesce(left(g.update_id, 8), 'embedded') as k from gone g
         where g.received_at > now() - interval '89 days') x
  where u.install_id = x.install_id and u.update_key = x.k;
  delete from diag.install_device d
  using gone g
  where g.kind = 'device' and d.install_id = g.install_id and d.received_at = g.received_at;
  return null;
end $$;
revoke all on function diag.install_facts_forget() from public, anon, authenticated, service_role;
drop trigger if exists diag_records_forget_facts on diag.records;
create trigger diag_records_forget_facts after delete on diag.records
  referencing old table as gone
  for each statement execute function diag.install_facts_forget();

-- ---- the two reads ---------------------------------------------------------------------------

-- The phones whose last device record of the week says work is stuck, disk
-- is low or files are lost: 25 at most, newest first.
create or replace function diag.ops_stuck() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('install', x.install_id, 'unsentMin', x.un, 'stuckMin', x.st, 'freeMb', x.fr,
      'lostFiles', x.lf, 'lostRecordings', x.lr, 'at', x.received_at) order by x.received_at desc), '[]'::jsonb)
  from (select install_id, received_at, (n->>'oldestUnsentMin')::numeric as un, (n->>'wantedStuckMin')::numeric as st,
               (n->>'freeDiskMb')::numeric as fr, (n->>'lostFiles')::numeric as lf, (n->>'lostRecordings')::numeric as lr
        from diag.install_device
        where received_at > now() - interval '7 days'
          and ((n->>'oldestUnsentMin')::numeric > 1440 or (n->>'wantedStuckMin')::numeric > 1440
               or (n->>'freeDiskMb')::numeric < 500 or (n->>'lostFiles')::numeric > 0 or (n->>'lostRecordings')::numeric > 0)
        order by received_at desc limit 25) x
$$;
revoke all on function diag.ops_stuck() from public, anon, authenticated, service_role;

-- "What installs report" (apps/admin/src/sources/diag.ts Clients): the
-- page's SQL as it was, with each kind read on its own through the kind
-- index instead of one pass over the week's every record, and the phones'
-- last device records from diag.install_device.
create or replace function diag.ops_clients() returns jsonb
language sql stable security definer set search_path = '' as $$
with seen as (select install_id, context, last_seen from diag.installs where last_seen > now() - interval '7 days')
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
  'auth', (select coalesce(jsonb_agg(jsonb_build_object('op', x.op, 'outcome', x.oc, 'code', x.cd, 'records', x.c,
      'installs', x.i, 'lastAt', x.la) order by x.c desc), '[]'::jsonb)
    from (select t->>'op' as op, t->>'outcome' as oc, t->>'code' as cd, count(*) as c, count(distinct install_id) as i, max(received_at) as la
          from diag.records where kind = 'auth' and received_at > now() - interval '7 days'
            and coalesce(t->>'outcome', '') not in ('ok', 'done', 'keep', 'home')
          group by 1, 2, 3 order by 4 desc limit 12) x),
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

-- "Builds in the field" (apps/admin/src/sources/ops.ts Fleet): the page's
-- SQL as it was, each kind read through the kind index; a build's installs
-- and crashes come from diag.install_updates, and the stuck phones from
-- diag.install_device. A build's first seen is now its first record in 90
-- days, not in the 14 days shown.
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
  'toMap', (select coalesce(jsonb_agg(jsonb_build_object('day', x.d, 'kind', x.k, 'count', x.c, 'p50Ms', x.p50, 'p95Ms', x.p95) order by x.d, x.k), '[]'::jsonb)
    from (select to_char(date_trunc('day', received_at), 'YYYY-MM-DD') as d, k, count(*) as c,
                 round(percentile_cont(0.5) within group (order by v)) as p50, round(percentile_cont(0.95) within group (order by v)) as p95
          from (select received_at, 'open' as k, (n->>'ms')::numeric as v
                from diag.records where kind = 'open' and received_at > now() - interval '14 days'
                union all
                select received_at, 'fill', (n->>'msToMap')::numeric
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

-- ---- the count every 10 minutes --------------------------------------------------------------

-- The last count of each read: 'clients' and 'fleet' (without the stuck
-- phones, which diag.ops_cached reads at once).
create table if not exists diag.ops_cache (
  part text primary key check (part in ('clients', 'fleet')),
  counted_at timestamptz not null,
  ms integer not null,
  v jsonb not null
);
alter table diag.ops_cache enable row level security;
revoke all on diag.ops_cache from public, anon, authenticated, service_role;

create or replace function diag.ops_cache_fill() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_started timestamptz := clock_timestamp();
  v_from timestamptz;
  v_t timestamptz;
  v_v jsonb;
  v_n jsonb;
  v_ms integer;
  v_part text;
begin
  -- One count at a time: a run that finds another still counting leaves it.
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('diag.ops_cache_fill')) then
    return '{"skipped":true}'::jsonb;
  end if;
  -- The records since the last count, and 15 minutes before it for records
  -- that commit late; the first time, all 90 days.
  v_from := coalesce((select c.counted_at from diag.ops_cache c where c.part = 'fleet') - interval '15 minutes',
                     now() - interval '90 days');
  v_n := diag.install_facts_add(v_from);

  foreach v_part in array array['clients', 'fleet'] loop
    v_t := clock_timestamp();
    v_v := case v_part when 'clients' then diag.ops_clients() else diag.ops_fleet() - 'stuck' end;
    v_ms := (extract(epoch from clock_timestamp() - v_t) * 1000)::int;
    v_n := v_n || jsonb_build_object(v_part || 'Ms', v_ms);
    insert into diag.ops_cache (part, counted_at, ms, v) values (v_part, now(), v_ms, v_v)
    on conflict (part) do update set counted_at = excluded.counted_at, ms = excluded.ms, v = excluded.v;
  end loop;

  insert into diag.job_runs (job, started_at, ms, outcome, n)
  values ('ops_counts', v_started, (extract(epoch from clock_timestamp() - v_started) * 1000)::int, 'ok', v_n);
  return v_n;
end $$;
revoke all on function diag.ops_cache_fill() from public, anon, authenticated, service_role;

insert into diag.job_schedule (job, every, slack, runs_on) values
  ('ops_counts', interval '10 minutes', interval '20 minutes', 'pg_cron, langquest-ops-counts, in the database')
on conflict (job) do update set every = excluded.every, slack = excluded.slack, runs_on = excluded.runs_on;

-- What the page reads: the last count and when it was made, or a count made
-- now when there is none yet; the stuck phones always now.
create or replace function diag.ops_cached(p_part text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_v jsonb;
  v_at timestamptz;
begin
  if p_part is null or p_part not in ('clients', 'fleet') then
    raise exception 'no such count: %', p_part using errcode = '22023';
  end if;
  select c.v, c.counted_at into v_v, v_at from diag.ops_cache c where c.part = p_part;
  if v_v is null then
    v_v := case p_part when 'clients' then diag.ops_clients() else diag.ops_fleet() end;
    v_at := now();
  end if;
  if p_part = 'fleet' then
    v_v := v_v || jsonb_build_object('stuck', diag.ops_stuck());
  end if;
  return v_v || jsonb_build_object('countedAt', v_at);
end $$;
revoke all on function diag.ops_cached(text) from public, anon, authenticated, service_role;
grant execute on function diag.ops_cached(text) to diag_reader;

-- It needs no secret, so a reset keeps it (server/cronSmoke.sql).
do $$
begin
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'langquest-ops-counts';
  perform cron.schedule('langquest-ops-counts', '2-59/10 * * * *', $job$
    select diag.ops_cache_fill();
  $job$);
end $$;

-- The first count, so the page never reads a week of records itself.
select diag.ops_cache_fill();
