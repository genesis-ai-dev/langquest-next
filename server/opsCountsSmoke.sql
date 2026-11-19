-- The ops dashboard's phone counts (migration *_ops_phone_counts.sql,
-- docs/decisions/2026-11-17-ops-phone-counts-every-10-minutes.md): diag.ops_clients() and diag.ops_fleet() answer what the
-- page's own SQL answered before (kept below as it was), the small tables
-- they read are kept up however often a record is counted, a count records
-- its job run and holds no install id, the stuck phones and a deleted
-- account's rows go at once, and diag_reader runs only diag.ops_cached.
-- Run by `npm run db:test`. Repeatable; every write rolls back.
\set ON_ERROR_STOP on
begin;
-- A count pg_cron starts now waits for this one.
select pg_advisory_xact_lock(hashtext('diag.ops_cache_fill'));

-- The page's SQL before docs/decisions/2026-11-17-ops-phone-counts-every-10-minutes.md, word for word.
create function pg_temp.old_clients() returns jsonb language sql stable as $old$
with r as (
  select install_id, kind, received_at, n, t from diag.records where received_at > now() - interval '7 days'
),
d as (select * from r where received_at > now() - interval '1 day'),
seen as (select install_id, context, last_seen from diag.installs where last_seen > now() - interval '7 days')
select jsonb_build_object(
  'installs', jsonb_build_object(
    'day', (select count(*) from seen where last_seen > now() - interval '1 day'),
    'week', (select count(*) from seen),
    'all', (select count(*) from diag.installs)),
  'records', jsonb_build_object('day', (select count(*) from d), 'week', (select count(*) from r)),
  'platforms', (select coalesce(jsonb_agg(jsonb_build_object('os', x.os, 'installs', x.c) order by x.c desc), '[]'::jsonb)
    from (select coalesce(context->>'os', 'unknown') as os, count(*) as c from seen group by 1) x),
  'builds', (select coalesce(jsonb_agg(jsonb_build_object('runtime', x.rt, 'channel', x.ch, 'update', x.up, 'embedded', x.em,
      'installs', x.c, 'lastSeen', x.ls) order by x.ls desc), '[]'::jsonb)
    from (select context->>'runtimeVersion' as rt, context->>'channel' as ch, left(context->>'updateId', 8) as up,
                 context->>'embedded' as em, count(*) as c, max(last_seen) as ls
          from seen group by 1, 2, 3, 4 order by max(last_seen) desc limit 12) x),
  'sync', (select coalesce(jsonb_object_agg(x.o, jsonb_build_object('records', x.c, 'installs', x.i)), '{}'::jsonb)
    from (select coalesce(t->>'outcome', 'unknown') as o, count(*) as c, count(distinct install_id) as i
          from d where kind = 'sync' group by 1) x),
  'syncErrors', (select coalesce(jsonb_agg(jsonb_build_object('code', x.k, 'records', x.c, 'installs', x.i) order by x.c desc), '[]'::jsonb)
    from (select coalesce(t->>'phase', '?') || ':' || coalesce(t->>'code', t->>'error', '?') as k, count(*) as c, count(distinct install_id) as i
          from d where kind = 'sync' and t->>'outcome' = 'error' group by 1 order by 2 desc limit 8) x),
  'errors', (select coalesce(jsonb_agg(jsonb_build_object('name', x.nm, 'where', x.wh, 'code', x.cd, 'fatal', x.ft, 'records', x.c,
      'day', x.cday, 'installs', x.i, 'lastAt', x.la, 'errorId', x.eid) order by x.la desc), '[]'::jsonb)
    from (select t->>'name' as nm, t->>'where' as wh, t->>'code' as cd, bool_or(t->>'fatal' = 'yes') as ft, count(*) as c,
                 count(*) filter (where received_at > now() - interval '1 day') as cday,
                 count(distinct install_id) as i, max(received_at) as la,
                 (array_agg(t->>'errorId' order by received_at desc))[1] as eid
          from r where kind = 'error' group by 1, 2, 3 order by max(received_at) desc limit 20) x),
  'expected', (select coalesce(jsonb_agg(jsonb_build_object('where', x.wh, 'name', x.nm, 'code', x.cd, 'count', x.c,
      'installs', x.i, 'lastAt', x.la) order by x.c desc), '[]'::jsonb)
    from (select t->>'where' as wh, t->>'name' as nm, t->>'code' as cd, sum(coalesce((n->>'count')::numeric, 1)) as c,
                 count(distinct install_id) as i, max(received_at) as la
          from r where kind = 'expected' group by 1, 2, 3 order by 4 desc limit 12) x),
  'auth', (select coalesce(jsonb_agg(jsonb_build_object('op', x.op, 'outcome', x.oc, 'code', x.cd, 'records', x.c,
      'installs', x.i, 'lastAt', x.la) order by x.c desc), '[]'::jsonb)
    from (select t->>'op' as op, t->>'outcome' as oc, t->>'code' as cd, count(*) as c, count(distinct install_id) as i, max(received_at) as la
          from r where kind = 'auth' and coalesce(t->>'outcome', '') not in ('ok', 'done', 'keep', 'home')
          group by 1, 2, 3 order by 4 desc limit 12) x),
  'transfer', (select coalesce(jsonb_object_agg(x.dir, x.tot), '{}'::jsonb)
    from (select coalesce(t->>'dir', 'unknown') as dir, diag.totals(array_agg(n)) as tot from d where kind = 'transfer' group by 1) x),
  'audio', (select diag.totals(array_agg(n)) from d where kind = 'audio'),
  'device', (select jsonb_build_object(
      'reporting', count(*),
      'lowDisk', count(*) filter (where (n->>'freeDiskMb')::numeric < 500),
      'lostFiles', count(*) filter (where (n->>'lostFiles')::numeric > 0),
      'lostRecordings', count(*) filter (where (n->>'lostRecordings')::numeric > 0),
      'unsentOverDay', count(*) filter (where (n->>'oldestUnsentMin')::numeric > 1440),
      'downloadStuckOverDay', count(*) filter (where (n->>'wantedStuckMin')::numeric > 1440),
      'diagDropped', count(*) filter (where (n->>'diagDropped')::numeric > 0))
    from (select distinct on (install_id) install_id, n from r where kind = 'device' order by install_id, received_at desc) x)
) as v
$old$;
create function pg_temp.old_fleet() returns jsonb language sql stable as $old$
with r as (
  select install_id, org_id, stream_id, kind, received_at, update_id, n, t from diag.records where received_at > now() - interval '14 days'
),
seen as (select install_id, context, last_seen from diag.installs where last_seen > now() - interval '14 days')
select jsonb_build_object(
  'builds', (select coalesce(jsonb_agg(jsonb_build_object('platform', x.os, 'version', x.v, 'reducers', x.rv, 'day', x.d, 'week', x.w, 'fortnight', x.f) order by x.os, x.v desc), '[]'::jsonb)
    from (select coalesce(context->>'os', '?') as os, coalesce(context->>'appVersion', '?') as v, string_agg(distinct context->>'reducerVersion', ', ') as rv,
                 count(*) filter (where last_seen > now() - interval '1 day') as d, count(*) filter (where last_seen > now() - interval '7 days') as w, count(*) as f
          from seen where coalesce(context->>'channel', '') <> 'development' and coalesce(context->>'os', '') <> 'web' group by 1, 2) x),
  'updates', (select coalesce(jsonb_agg(jsonb_build_object('update', x.up, 'runtime', x.rt, 'channel', x.ch, 'installs', x.i,
      'crashed', x.cr, 'firstSeen', x.fs, 'lastSeen', x.ls) order by x.fs desc), '[]'::jsonb)
    from (select coalesce(left(r.update_id, 8), 'embedded') as up, max(s.context->>'runtimeVersion') as rt, max(s.context->>'channel') as ch,
                 count(distinct r.install_id) as i,
                 count(distinct r.install_id) filter (where r.kind = 'error' and r.t->>'fatal' = 'yes') as cr,
                 min(r.received_at) as fs, max(r.received_at) as ls
          from r left join seen s using (install_id) group by 1 order by min(r.received_at) desc limit 12) x),
  'versions', (select coalesce(jsonb_agg(jsonb_build_object('reducer', x.rv, 'protocol', x.pv, 'installs', x.c) order by x.c desc), '[]'::jsonb)
    from (select context->>'reducerVersion' as rv, context->>'protocolVersion' as pv, count(*) as c
          from seen where last_seen > now() - interval '7 days' group by 1, 2) x),
  'web', (select coalesce(jsonb_agg(jsonb_build_object('commit', x.cm, 'installs', x.c) order by x.c desc), '[]'::jsonb)
    from (select context->>'runtimeVersion' as cm, count(*) as c from seen
          where context->>'channel' = 'web' and last_seen > now() - interval '7 days' group by 1 limit 10) x),
  'toMap', (select coalesce(jsonb_agg(jsonb_build_object('day', x.d, 'kind', x.k, 'count', x.c, 'p50Ms', x.p50, 'p95Ms', x.p95) order by x.d, x.k), '[]'::jsonb)
    from (select to_char(date_trunc('day', received_at), 'YYYY-MM-DD') as d, k, count(*) as c,
                 round(percentile_cont(0.5) within group (order by v)) as p50, round(percentile_cont(0.95) within group (order by v)) as p95
          from (select received_at,
                       case when kind = 'open' then 'open' else 'fill' end as k,
                       case when kind = 'open' then (n->>'ms')::numeric else (n->>'msToMap')::numeric end as v
                from r where kind = 'open' or (kind = 'fill' and t->>'event' = 'start')) q
          where v is not null group by 1, 2) x),
  'firstDownloads', (select coalesce(jsonb_agg(jsonb_build_object('day', x.d, 'what', x.w, 'reason', x.re, 'count', x.c, 'installs', x.i) order by x.d desc, x.c desc, x.w, x.re), '[]'::jsonb)
    from (select to_char(date_trunc('day', q.received_at), 'YYYY-MM-DD') as d, q.w, q.re, count(*) as c, count(distinct q.install_id) as i
          from (select r.received_at, r.install_id,
                       case when r.kind = 'snapshot' then 'no_snapshot' else r.t->>'event' end as w,
                       case when r.kind = 'snapshot' then coalesce(s.context->>'reducerVersion', '?') else coalesce(r.t->>'reason', '?') end as re
                from r left join seen s using (install_id)
                where coalesce(s.context->>'channel', '') <> 'development'
                  and ((r.kind = 'fill' and r.t->>'event' in ('fallback', 'restart'))
                    -- The organization's and a person's streams never have a snapshot, so only a language's says anything.
                    or (r.kind = 'snapshot' and r.t->>'outcome' = 'none' and r.stream_id <> '_org' and r.org_id <> '_person'))) q
          group by 1, 2, 3 order by 1 desc, 4 desc limit 40) x),
  'stuck', (select coalesce(jsonb_agg(jsonb_build_object('install', x.install_id, 'unsentMin', x.un, 'stuckMin', x.st, 'freeMb', x.fr,
      'lostFiles', x.lf, 'lostRecordings', x.lr, 'at', x.received_at) order by x.received_at desc), '[]'::jsonb)
    from (select install_id, received_at, (n->>'oldestUnsentMin')::numeric as un, (n->>'wantedStuckMin')::numeric as st,
                 (n->>'freeDiskMb')::numeric as fr, (n->>'lostFiles')::numeric as lf, (n->>'lostRecordings')::numeric as lr
          from (select distinct on (install_id) install_id, received_at, n from r
                where kind = 'device' and received_at > now() - interval '7 days' order by install_id, received_at desc) last
          where (n->>'oldestUnsentMin')::numeric > 1440 or (n->>'wantedStuckMin')::numeric > 1440
             or (n->>'freeDiskMb')::numeric < 500 or (n->>'lostFiles')::numeric > 0 or (n->>'lostRecordings')::numeric > 0
          order by received_at desc limit 25) x)
) as v
$old$;

insert into diag.installs (install_id, profile_id, context, last_seen) values
  ('oc-a', 'oc-profile-1', '{"os":"android","channel":"production","appVersion":"2026.1117.1 (60)","updateId":"oc0c0c0c12345678","runtimeVersion":"rt-1","reducerVersion":"9"}', now() - interval '1 hour'),
  ('oc-b', 'oc-profile-2', '{"os":"ios","channel":"production","appVersion":"2026.1117.1 (61)","runtimeVersion":"rt-1","reducerVersion":"9"}', now() - interval '2 days'),
  ('oc-c', 'oc-profile-2', '{"os":"web","channel":"web","runtimeVersion":"c0ffee1","reducerVersion":"9"}', now() - interval '10 days'),
  ('oc-d', 'oc-profile-3', '{"os":"android","channel":"production","updateId":"oc0c0c0c12345678","runtimeVersion":"rt-1"}', now() - interval '3 hours');

insert into diag.records (id, install_id, delivered_by, org_id, stream_id, kind, at, received_at, update_id, n, t)
select x.id, x.inst, x.by, x.org, x.stream, x.kind, now() - x.ago, now() - x.ago, x.upd, x.n::jsonb, x.t::jsonb
from (values
  ('oc-1', 'oc-a', 'oc-profile-1', null, null, 'sync', interval '1 hour', 'oc0c0c0c12345678', '{}', '{"outcome":"ok"}'),
  ('oc-2', 'oc-a', 'oc-profile-1', null, null, 'sync', interval '2 hours', 'oc0c0c0c12345678', '{}', '{"outcome":"error","phase":"push","code":"E_HTTP"}'),
  ('oc-3', 'oc-b', 'oc-profile-2', null, null, 'sync', interval '30 hours', null, '{}', '{"outcome":"ok"}'),
  ('oc-4', 'oc-a', 'oc-profile-1', null, null, 'error', interval '3 hours', 'oc0c0c0c12345678', '{}', '{"name":"OcCrash","where":"home","fatal":"yes","errorId":"E-OC0001"}'),
  ('oc-5', 'oc-b', 'oc-profile-2', null, null, 'error', interval '3 days', null, '{}', '{"name":"OcError","where":"record","fatal":"no","errorId":"E-OC0002"}'),
  ('oc-6', 'oc-b', 'oc-profile-2', null, null, 'error', interval '10 days', 'fedcba9876543210', '{}', '{"name":"OcOld","where":"record","fatal":"yes"}'),
  ('oc-7', 'oc-a', 'oc-profile-1', null, null, 'auth', interval '4 hours', 'oc0c0c0c12345678', '{}', '{"op":"renew","outcome":"failed","code":"E_NET"}'),
  -- Sign-in records by class (migration *_sign_in_trouble.sql): oc-7 is trouble, these are no fault, no fault and as designed.
  ('oc-7b', 'oc-a', 'oc-profile-1', null, null, 'auth', interval '4 hours', 'oc0c0c0c12345678', '{}', '{"op":"sign_in","outcome":"refused","code":"oc_wrong_password"}'),
  ('oc-7c', 'oc-b', 'oc-profile-2', null, null, 'auth', interval '2 days', null, '{}', '{"op":"renew","outcome":"offline","code":"oc_offline"}'),
  ('oc-7d', 'oc-b', 'oc-profile-2', null, null, 'auth', interval '2 days', null, '{}', '{"op":"route","outcome":"no_org","code":"oc_no_org"}'),
  ('oc-8', 'oc-a', 'oc-profile-1', null, null, 'expected', interval '5 hours', 'oc0c0c0c12345678', '{"count":3}', '{"where":"home","name":"Offline"}'),
  ('oc-9', 'oc-a', 'oc-profile-1', null, null, 'transfer', interval '6 hours', 'oc0c0c0c12345678', '{"count":5,"failHttp5xx":1}', '{"dir":"down"}'),
  ('oc-10', 'oc-a', 'oc-profile-1', null, null, 'audio', interval '7 hours', 'oc0c0c0c12345678', '{"takes":2}', '{}'),
  ('oc-11', 'oc-a', 'oc-profile-1', null, null, 'device', interval '3 days', 'oc0c0c0c12345678', '{"freeDiskMb":9000}', '{}'),
  ('oc-12', 'oc-a', 'oc-profile-1', null, null, 'device', interval '8 hours', 'oc0c0c0c12345678', '{"freeDiskMb":300,"oldestUnsentMin":2000}', '{}'),
  ('oc-13', 'oc-b', 'oc-profile-2', null, null, 'device', interval '2 days', null, '{"freeDiskMb":8000,"lostFiles":1}', '{}'),
  ('oc-14', 'oc-d', 'oc-profile-3', null, null, 'device', interval '9 days', 'oc0c0c0c12345678', '{"lostRecordings":2}', '{}'),
  ('oc-15', 'oc-a', 'oc-profile-1', 'oc-org', 'oc-lang', 'open', interval '9 hours', 'oc0c0c0c12345678', '{"ms":800}', '{"cold":"yes"}'),
  ('oc-16', 'oc-a', 'oc-profile-1', null, null, 'fill', interval '10 hours', 'oc0c0c0c12345678', '{"msToMap":4000}', '{"event":"start"}'),
  ('oc-17', 'oc-b', 'oc-profile-2', null, null, 'fill', interval '11 days', null, '{}', '{"event":"fallback","reason":"timeout"}'),
  ('oc-18', 'oc-b', 'oc-profile-2', 'oc-org', 'oc-lang', 'snapshot', interval '12 hours', null, '{}', '{"outcome":"none"}'),
  ('oc-19', 'oc-d', 'oc-profile-3', null, null, 'sync', interval '3 hours', 'oc0c0c0c12345678', '{}', '{"outcome":"ok"}'),
  ('oc-20', 'oc-c', 'oc-profile-2', null, null, 'sync', interval '10 days', null, '{}', '{"outcome":"ok"}')
) x(id, inst, by, org, stream, kind, ago, upd, n, t);

-- The first count reads all 90 days; a first seen 14 days back makes it the page's old answer.
delete from diag.ops_cache;
delete from diag.install_updates;
delete from diag.install_device;
do $$
declare k text; r jsonb; old_c jsonb; new_c jsonb; old_f jsonb; new_f jsonb;
begin
  r := diag.install_facts_add(now() - interval '14 days');
  if (r->>'updates')::int < 5 then raise exception 'install_facts_add added % updates', r; end if;
  -- Counted again, nothing changes.
  r := diag.install_facts_add(now() - interval '14 days');
  if (r->>'updates')::int <> 0 or (r->>'devices')::int <> 0 then raise exception 'a second add changed rows: %', r; end if;
  old_c := pg_temp.old_clients(); new_c := diag.ops_clients();
  old_f := pg_temp.old_fleet(); new_f := diag.ops_fleet();
  -- The old read had no wait: what the new one says of it (slow, waited, waitMaxMs) has its own test below.
  new_f := jsonb_set(new_f, '{toMap}', (select coalesce(jsonb_agg(x.v - 'slow' - 'waited' - 'waitMaxMs' order by x.i), '[]'::jsonb)
    from jsonb_array_elements(new_f->'toMap') with ordinality x(v, i)));
  -- The old read called every sign-in record that did not end ok trouble: the classes have their own test below.
  for k in select jsonb_object_keys(old_c || new_c) loop
    if k <> 'auth' and old_c->k is distinct from new_c->k then raise exception 'clients %: % against %', k, old_c->k, new_c->k; end if;
  end loop;
  -- A sign-in record has a class (migration *_sign_in_trouble.sql): a renewal given up is trouble, a wrong
  -- password and a step with no connection are no fault, and a new person with no organization is in neither.
  -- Trouble leads, since each kind of it is a line on the Overview.
  if (select jsonb_object_agg(a->>'code', a->>'class') from jsonb_array_elements(new_c->'auth') a where a->>'code' in ('E_NET', 'oc_wrong_password', 'oc_offline', 'oc_no_org'))
       is distinct from '{"E_NET": "trouble", "oc_wrong_password": "no_fault", "oc_offline": "no_fault"}'::jsonb
     or exists (select 1 from jsonb_array_elements(new_c->'auth') a where a->>'class' not in ('trouble', 'no_fault') or a->>'class' is null)
     or exists (select 1 from jsonb_array_elements(new_c->'auth') with ordinality a(v, i), jsonb_array_elements(new_c->'auth') with ordinality b(v, i)
                where a.i < b.i and a.v->>'class' = 'no_fault' and b.v->>'class' = 'trouble') then
    raise exception 'sign-in records are in the wrong class: %', new_c->'auth';
  end if;
  for k in select jsonb_object_keys(old_f || new_f) loop
    if old_f->k is distinct from new_f->k then raise exception 'fleet %: % against %', k, old_f->k, new_f->k; end if;
  end loop;
  -- The fixture is in it: a crash on oc0c0c0c.
  if not exists (select 1 from jsonb_array_elements(diag.ops_fleet()->'updates') u where u->>'update' = 'oc0c0c0c' and (u->>'installs')::int = 2 and (u->>'crashed')::int = 1) then
    raise exception 'update oc0c0c0c is not 2 installs and 1 crash: %', diag.ops_fleet()->'updates';
  end if;
end $$;

-- An open is a language's first download only when the phone had no rows of that language
-- (migration *_first_download_wait.sql): not an open of rows it has, of the organization's
-- stream or of a person's, and not one that does not say. Each of these took 18 minutes.
insert into diag.records (id, install_id, delivered_by, org_id, stream_id, kind, at, received_at, n, t)
select x.id, 'oc-a', 'oc-profile-1', x.org, x.stream, 'open', now() - interval '9 hours', now() - interval '9 hours', '{"ms":1080000}', x.t::jsonb
from (values
  ('oc-open-warm', 'oc-org', 'oc-lang', '{"cold":"no"}'),
  ('oc-open-org', 'oc-org', '_org', '{"cold":"yes"}'),
  ('oc-open-person', '_person', 'oc-profile-1', '{"cold":"yes"}'),
  ('oc-open-untold', null, null, '{}')
) x(id, org, stream, t);
-- A first download that waited 21 minutes with no connection and then took 0.2 seconds (the
-- phone of 18 November 2026): its sync record holds the wait, and its time is the rest. The
-- same phone's spell on another language, and one an hour before, are not this open's wait.
insert into diag.records (id, install_id, delivered_by, org_id, stream_id, kind, at, received_at, n, t)
select x.id, 'oc-a', 'oc-profile-1', 'oc-org', x.stream, x.kind, now() - interval '9 hours' - x.ago, now() - interval '9 hours', x.n::jsonb, x.t::jsonb
from (values
  ('oc-open-waited', 'oc-lang-2', 'open', interval '0', '{"ms":1281294}', '{"cold":"yes"}'),
  ('oc-open-sync', 'oc-lang-2', 'sync', interval '1 second', '{"ms":200,"offlineMs":1281078}', '{"outcome":"ok"}'),
  ('oc-open-sync-other', 'oc-lang-3', 'sync', interval '1 second', '{"ms":200,"offlineMs":900000}', '{"outcome":"ok"}'),
  ('oc-open-sync-before', 'oc-lang-2', 'sync', interval '1 hour', '{"ms":200,"offlineMs":900000}', '{"outcome":"ok"}')
) x(id, stream, kind, ago, n, t);
do $$
declare v jsonb;
begin
  select jsonb_agg(x) into v from jsonb_array_elements(diag.ops_fleet()->'toMap') x where x->>'kind' = 'open';
  if jsonb_array_length(v) <> 1 or (v->0->>'count')::int <> 2 or (v->0->>'p95Ms')::numeric <> 771 or (v->0->>'slow')::int <> 0
     or (v->0->>'waited')::int <> 1 or (v->0->>'waitMaxMs')::numeric <> 1281078 then
    raise exception 'toMap counts an open that is not a first download, or a wait as download time: %', v;
  end if;
  if diag.open_wait_ms('oc-a', 'oc-org', 'oc-lang-2', now() - interval '9 hours', 1000) <> 1000 then
    raise exception 'a wait is longer than its open';
  end if;
end $$;
delete from diag.records where id like 'oc-open-%';

-- The stuck phones are the last device record of the week of each (only
-- this fixture's, so a big local seed does not fill the 25).
delete from diag.install_device where install_id not like 'oc-%';
do $$
begin
  if (select count(*) from jsonb_array_elements(diag.ops_fleet()->'stuck') s where s->>'install' like 'oc-%') <> 2
     or exists (select 1 from jsonb_array_elements(diag.ops_fleet()->'stuck') s where s->>'install' = 'oc-d') then
    raise exception 'stuck is not oc-a and oc-b: %', diag.ops_fleet()->'stuck';
  end if;
  if (select (s->>'freeMb')::int from jsonb_array_elements(diag.ops_fleet()->'stuck') s where s->>'install' = 'oc-a') <> 300 then
    raise exception 'oc-a is not its last device record';
  end if;
end $$;

-- A crash that arrives late moves the crash, and an older device record never replaces a newer one.
insert into diag.records (id, install_id, delivered_by, kind, at, received_at, update_id, n, t) values
  ('oc-21', 'oc-d', 'oc-profile-3', 'error', now(), now(), 'oc0c0c0c12345678', '{}', '{"name":"OcCrash","where":"home","fatal":"yes"}'),
  ('oc-22', 'oc-a', 'oc-profile-1', 'device', now() - interval '20 hours', now() - interval '20 hours', 'oc0c0c0c12345678', '{"freeDiskMb":7000}', '{}');
do $$
declare r jsonb;
begin
  r := diag.install_facts_add(now() - interval '1 day');
  if (select crashed_at from diag.install_updates where install_id = 'oc-d' and update_key = 'oc0c0c0c') is null then
    raise exception 'the late crash is not counted';
  end if;
  if (select (n->>'freeDiskMb')::int from diag.install_device where install_id = 'oc-a') <> 300 then
    raise exception 'an older device record replaced a newer one';
  end if;
end $$;

-- The count every 10 minutes: both parts, a job run, no install id in the cache, and the stuck phones read now.
do $$
declare r jsonb; before int := (select count(*) from diag.job_runs where job = 'ops_counts'); cache text;
begin
  r := diag.ops_cache_fill();
  if r ? 'skipped' then raise exception 'the count was skipped'; end if;
  if (select count(*) from diag.ops_cache) <> 2 then raise exception 'the cache is not two parts'; end if;
  if (select count(*) from diag.job_runs where job = 'ops_counts' and outcome = 'ok') <> before + 1 then raise exception 'no ops_counts run'; end if;
  if not (select n ? 'clientsMs' and n ? 'fleetMs' from diag.job_runs where job = 'ops_counts' order by id desc limit 1) then raise exception 'the run lacks its times'; end if;
  cache := (select string_agg(v::text, ' ') from diag.ops_cache);
  if exists (select 1 from diag.installs i where i.install_id like 'oc-%' and position(i.install_id in cache) > 0) then
    raise exception 'the cache holds an install id';
  end if;
  if exists (select 1 from diag.installs i where i.install_id like 'oc-%' and position(i.profile_id in cache) > 0) then
    raise exception 'the cache holds a profile id';
  end if;
  if (select v ? 'stuck' from diag.ops_cache where part = 'fleet') then raise exception 'the fleet cache holds the stuck list'; end if;
  if diag.ops_cached('clients') - 'countedAt' is distinct from diag.ops_clients() then raise exception 'ops_cached clients is not the count'; end if;
  if diag.ops_cached('fleet') - 'countedAt' is distinct from diag.ops_fleet() then raise exception 'ops_cached fleet is not the count'; end if;
  if (diag.ops_cached('fleet')->>'countedAt')::timestamptz <> now() then raise exception 'countedAt is not when it counted'; end if;
  begin
    perform diag.ops_cached('people');
    raise exception 'an unknown part was answered';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- With no count yet it counts now, the same.
do $$
declare c jsonb; f jsonb;
begin
  c := diag.ops_cached('clients'); f := diag.ops_cached('fleet');
  delete from diag.ops_cache;
  if diag.ops_cached('clients') is distinct from c or diag.ops_cached('fleet') is distinct from f then
    raise exception 'a count made now differs from the stored one';
  end if;
  perform diag.ops_cache_fill();
end $$;

-- diag.prune's deletes, over 90 days old, keep the rows; a deleted account's
-- records take what they said; a deleted install takes the rest and leaves
-- the stuck list at once.
insert into diag.records (id, install_id, delivered_by, kind, at, received_at, update_id, n, t) values
  ('oc-old', 'oc-a', 'oc-profile-1', 'sync', now() - interval '91 days', now() - interval '91 days', 'oc0c0c0c12345678', '{}', '{}');
do $$
begin
  delete from diag.records where id = 'oc-old';
  if not exists (select 1 from diag.install_updates where install_id = 'oc-a') or not exists (select 1 from diag.install_device where install_id = 'oc-a') then
    raise exception 'an old record took an install''s rows';
  end if;
  delete from diag.records where delivered_by = 'oc-profile-2';
  if exists (select 1 from diag.install_updates where install_id in ('oc-b', 'oc-c')) or exists (select 1 from diag.install_device where install_id = 'oc-b') then
    raise exception 'a deleted account''s records left their rows';
  end if;
  if exists (select 1 from jsonb_array_elements(diag.ops_cached('fleet')->'stuck') s where s->>'install' = 'oc-b') then
    raise exception 'a deleted account''s phone is still stuck';
  end if;
  delete from diag.installs where install_id = 'oc-a';
  if exists (select 1 from diag.install_updates where install_id = 'oc-a') or exists (select 1 from diag.install_device where install_id = 'oc-a') then
    raise exception 'a deleted install left its rows';
  end if;
  if exists (select 1 from jsonb_array_elements(diag.ops_cached('fleet')->'stuck') s where s->>'install' = 'oc-a') then
    raise exception 'a deleted install is still stuck';
  end if;
end $$;

-- diag_reader reads the count and nothing under it; the app's roles not even that.
set local role diag_reader;
select diag.ops_cached('clients') is not null as reads_clients, diag.ops_cached('fleet') is not null as reads_fleet;
do $$
declare f text; t text;
begin
  foreach f in array array['diag.ops_cache_fill()', 'diag.ops_clients()', 'diag.ops_fleet()', 'diag.ops_stuck()',
                           'diag.install_facts_add(now())'] loop
    begin
      execute 'select ' || f;
      raise exception 'diag_reader ran %', f;
    exception when insufficient_privilege then null;
    end;
  end loop;
  foreach t in array array['diag.ops_cache', 'diag.install_updates', 'diag.install_device'] loop
    begin
      execute 'select count(*) from ' || t;
      raise exception 'diag_reader read %', t;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;
reset role;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(r, 'diag.ops_cached(text)', 'execute') then raise exception '% may run diag.ops_cached', r; end if;
    if has_function_privilege(r, 'diag.ops_cache_fill()', 'execute') then raise exception '% may run diag.ops_cache_fill', r; end if;
  end loop;
end $$;

rollback;
