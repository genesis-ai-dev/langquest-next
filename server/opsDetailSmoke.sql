-- The ops dashboard's detail panel and start page (migration *_ops_detail.sql,
-- decisions.md 254): the raw rows behind a tapped bucket add up to that bucket's
-- total, a page is 50 rows, a bucket past 90 days and a count of people show
-- totals only, a row holds no name, email or message, and diag_reader reads
-- only the two functions meant for it. Run by `npm run db:test`. Repeatable;
-- every write rolls back. The day it reads is 41 days ago, where no other smoke
-- writes.
\set ON_ERROR_STOP on
begin;

create temporary table od_day on commit drop as
  select (date_trunc('day', now(), 'UTC') - interval '41 days') as d;
grant select on od_day to diag_reader;

insert into diag.installs (install_id, profile_id, context) values
  ('od-inst-ios', 'od-profile-1', '{"os":"ios","channel":"production"}'),
  ('od-inst-android', 'od-profile-2', '{"os":"android","channel":"development"}');

-- 35 kinds of error (two crashes), 60 syncs (some refused, some failed), transfers, audio, sign-in, shown failures, devices, first downloads.
insert into diag.records (id, install_id, delivered_by, kind, at, received_at, update_id, n, t, stack)
select 'od-err-' || i, case when i % 2 = 0 then 'od-inst-ios' else 'od-inst-android' end,
       case when i % 2 = 0 then 'od-profile-1' else 'od-profile-2' end, 'error', d + interval '10 hours', d + i * interval '1 minute',
       case when i % 3 = 0 then 'abcdef1234567890' end, '{}',
       jsonb_build_object('name', 'OdError' || (i % 33), 'where', 'screen' || (i % 4), 'fatal', case when i in (1, 2) then 'yes' else 'no' end),
       'at f (app.js:1:' || i || ')'
from od_day, generate_series(1, 35) i;
insert into diag.records (id, install_id, delivered_by, kind, at, received_at, n, t)
select 'od-sync-' || i, case when i % 2 = 0 then 'od-inst-ios' else 'od-inst-android' end, 'od-profile-1', 'sync', d + interval '11 hours', d + interval '11 hours' + i * interval '1 second',
       case when i % 10 = 0 then '{"rejected":2,"rejInvalid":1,"rejNotMember":1}'::jsonb else '{}'::jsonb end,
       case when i % 7 = 0 then jsonb_build_object('outcome', 'error', 'phase', 'push', 'code', 'E_HTTP' || (i % 2)) else '{"outcome":"ok"}'::jsonb end
from od_day, generate_series(1, 60) i;
insert into diag.records (id, install_id, delivered_by, kind, at, received_at, n, t)
select x.id, x.inst, 'od-profile-2', x.kind, d + interval '12 hours', d + interval '12 hours' + x.s * interval '1 second', x.n::jsonb, x.t::jsonb
from od_day, (values
  ('od-xfer-1', 'od-inst-android', 'transfer', '{"count":5,"failHttp5xx":2}', '{"dir":"down"}', 1),
  ('od-xfer-2', 'od-inst-ios', 'transfer', '{"count":3}', '{"dir":"down"}', 2),
  ('od-xfer-3', 'od-inst-ios', 'transfer', '{"count":1,"failOffline":1}', '{"dir":"up"}', 3),
  ('od-audio-1', 'od-inst-android', 'audio', '{"takes":4,"saveFail":1}', '{}', 4),
  ('od-audio-2', 'od-inst-ios', 'audio', '{"takes":2,"playFail":1}', '{}', 5),
  ('od-auth-1', 'od-inst-ios', 'auth', '{}', '{"op":"renew","outcome":"failed","code":"E_NET"}', 6),
  ('od-auth-2', 'od-inst-ios', 'auth', '{}', '{"op":"renew","outcome":"ok"}', 7),
  ('od-exp-1', 'od-inst-ios', 'expected', '{"count":3}', '{"where":"home","name":"Offline"}', 8),
  ('od-dev-1', 'od-inst-android', 'device', '{"lostFiles":2,"lostRecordings":1}', '{}', 9),
  ('od-dev-2', 'od-inst-ios', 'device', '{"lostFiles":0}', '{}', 10),
  ('od-open-1', 'od-inst-ios', 'open', '{"ms":900}', '{}', 11),
  ('od-fill-1', 'od-inst-ios', 'fill', '{"msToMap":4000}', '{"event":"start"}', 12),
  ('od-fill-2', 'od-inst-ios', 'fill', '{}', '{"event":"fallback","reason":"timeout"}', 13),
  ('od-fill-3', 'od-inst-android', 'fill', '{}', '{"event":"restart","reason":"crash"}', 14),
  ('od-snap-1', 'od-inst-ios', 'snapshot', '{}', '{"outcome":"none"}', 15)
) x(id, inst, kind, n, t, s);

insert into diag.job_runs (job, started_at, ms, outcome, n, received_at)
select x.job, d + interval '13 hours' + x.s * interval '1 minute', x.ms, x.outcome, x.n::jsonb, d + interval '13 hours' + x.s * interval '1 minute'
from od_day, (values
  ('projection', 100, 'ok', '{"newEvents":40}', 1),
  ('projection', 300, 'error', '{"newEvents":2}', 2),
  ('projection', 200, 'partial', '{}', 3),
  ('worker_requests', 5, 'ok', '{"reports_2xx":10,"reports_5xx":1,"device_429":3}', 4),
  ('fold_canary', 1000, 'ok', '{"mismatched":0,"dbBytes":5000000}', 5),
  ('fold_canary', 1000, 'ok', '{"mismatched":1,"dbBytes":5100000}', 6),
  ('push_delivery', 50, 'ok', '{"sent":4,"failed":1}', 7),
  ('webhook_dispatch', 50, 'ok', '{"delivered":2}', 8),
  ('blob_reconcile', 2000, 'ok', '{"objects":100,"missing":2}', 9),
  ('account_delete', 20, 'ok', '{}', 10)
) x(job, ms, outcome, n, s);

insert into diag.feedback (id, created_at, profile_id, kind, body, install_id, shared_name, shared_email)
select gen_random_uuid(), d + interval '14 hours' + i * interval '1 minute', 'od-profile-1', case when i % 2 = 0 then 'bug' else 'idea' end,
       'Write to od-person@example.com, from Od Person', 'od-inst-ios', 'Od Person', 'od-person@example.com'
from od_day, generate_series(1, 3) i;

insert into ops.user_issues (key, verdict, issue, issue_url, title, people, first_looked_at)
select 'error:OdError' || i, case when i = 1 then 'filed' else 'noise' end, case when i = 1 then 'LAN-1' end,
       case when i = 1 then 'https://linear.app/x/issue/LAN-1' end, 'Od issue ' || i, 2, d + interval '15 hours'
from od_day, generate_series(1, 2) i;

-- 1. The rows behind each count add up to its total, for the total and for each key kept.
do $$
declare d timestamptz := (select od_day.d from od_day); bad jsonb; checked int;
begin
  -- Every number with raw rows has its filter, from the same place, and every filter is a number.
  select jsonb_agg(m.part || '.' || m.metric) into bad from diag.daily_metrics m
  where diag.ops_detail_source(m.part, m.metric) in ('records', 'job_runs')
    and not exists (select 1 from diag.detail_filters f where f.part = m.part and f.metric = m.metric and f.source = diag.ops_detail_source(m.part, m.metric));
  if bad is not null then raise exception 'numbers without a detail filter: %', bad; end if;
  select jsonb_agg(f.part || '.' || f.metric) into bad from diag.detail_filters f
  where not exists (select 1 from diag.daily_metrics m where m.part = f.part and m.metric = f.metric);
  if bad is not null then raise exception 'detail filters for no number: %', bad; end if;
  perform diag.daily_refill('day', d, d + interval '1 day');
  with t as (
    select x.part, x.metric, x.key, x.value,
      case when (x.part, x.metric) in (('clients', 'installs'), ('clients', 'error_installs'), ('fleet', 'installs_by_update'), ('fleet', 'crashed_by_update'),
                                       ('safety', 'refused_installs'), ('storage', 'lost_files_installs'), ('storage', 'lost_recordings_installs')) then 'installs'
           when (x.part, x.metric) in (('clients', 'records'), ('clients', 'errors'), ('clients', 'crashes'), ('clients', 'syncs'), ('clients', 'sync_errors'),
                                       ('clients', 'sign_in_trouble'), ('fleet', 'first_downloads'), ('fleet', 'first_download_trouble'), ('jobs', 'runs'),
                                       ('jobs', 'failed'), ('jobs', 'partial'), ('safety', 'canary_runs'), ('support', 'feedback'), ('support', 'account_deletions'),
                                       ('userissues', 'looked_at_first')) then 'rows' end as how
    from diag.daily x where x.day = d::date and x.key <> '_other'
  ),
  got as (
    select t.*, (select case t.how when 'rows' then count(*) else count(distinct r.item->>'install') end
                 from diag.ops_detail_rows(t.part, t.metric, t.key, d, d + interval '1 day', 0, 100000) r) as n
    from t where t.how is not null and t.value > 0
  )
  select jsonb_agg(jsonb_build_object('n', g.part || '.' || g.metric || '/' || g.key, 'total', g.value, 'rows', g.n)) filter (where g.n <> g.value), count(*)
  into bad, checked from got g;
  if bad is not null then raise exception 'rows do not add up to their totals: %', bad; end if;
  if checked < 40 then raise exception 'only % totals checked', checked; end if;

  -- The rows that are not plain counts still come from their own records.
  if (select count(*) from diag.ops_detail_rows('clients', 'downloads_failed', '', d, d + interval '1 day', 0, 100)) <> 1
     or (select count(*) from diag.ops_detail_rows('clients', 'uploads_failed', '', d, d + interval '1 day', 0, 100)) <> 1
     or (select count(*) from diag.ops_detail_rows('clients', 'recordings_failed', '', d, d + interval '1 day', 0, 100)) <> 1
     or (select count(*) from diag.ops_detail_rows('clients', 'playback_failed', '', d, d + interval '1 day', 0, 100)) <> 1
     or (select count(*) from diag.ops_detail_rows('safety', 'refused', 'invalid', d, d + interval '1 day', 0, 100)) <> 6
     or (select count(*) from diag.ops_detail_rows('safety', 'new_events', '', d, d + interval '1 day', 0, 100)) <> 2
     or (select count(*) from diag.ops_detail_rows('safety', 'canary_mismatched', '', d, d + interval '1 day', 0, 100)) <> 1
     or (select count(*) from diag.ops_detail_rows('worker', 'requests', 'reports', d, d + interval '1 day', 0, 100)) <> 1
     or (select count(*) from diag.ops_detail_rows('worker', 'refused', 'nothing', d, d + interval '1 day', 0, 100)) <> 0
     or (select count(*) from diag.ops_detail_rows('push', 'delivery', 'sent', d, d + interval '1 day', 0, 100)) <> 1
     or (select count(*) from diag.ops_detail_rows('capacity', 'db_bytes', '', d, d + interval '1 day', 0, 100)) <> 2
     or (select count(*) from diag.ops_detail_rows('storage', 'r2_check', 'missing', d, d + interval '1 day', 0, 100)) <> 1 then
    raise exception 'rows behind sums and levels';
  end if;
  -- A key read past the 30 kept ('_other') lists every row of the number.
  if (select count(*) from diag.ops_detail_rows('clients', 'errors', '_other', d, d + interval '1 day', 0, 100)) <> 35 then
    raise exception '_other lists every row';
  end if;
end $$;

-- 2. A row holds ids, codes and counts: never a name, an email or what someone wrote.
do $$
declare d timestamptz := (select od_day.d from od_day); keys text[];
begin
  if exists (
    select 1 from diag.daily_metrics m, diag.ops_detail_rows(m.part, m.metric, '', d, d + interval '1 day', 0, 1000) r
    where r.item::text ~* 'od-person|example\.com|Od Person'
  ) then raise exception 'a detail row holds a name, an email or a message'; end if;
  select array_agg(distinct k order by k) into keys
  from diag.daily_metrics m, diag.ops_detail_rows(m.part, m.metric, '', d, d + interval '1 day', 0, 1000) r, jsonb_object_keys(r.item) k;
  if keys && array['body', 'email', 'shared_email', 'shared_name', 'details', 'context', 'voice_format'] then
    raise exception 'a detail row names a field it must not: %', keys;
  end if;
  if exists (select 1 from diag.ops_detail_rows('people', 'active_accounts', '', d, d + interval '1 day', 0, 10)) then
    raise exception 'people are listed';
  end if;
end $$;

-- 3. As the page reads it (diag_reader): 50 rows a page, totals only past 90 days and for people, refusals.
set local role diag_reader;
do $$
declare d timestamptz := (select od_day.d from od_day); p0 jsonb; p1 jsonb; x jsonb; ok boolean;
begin
  p0 := diag.ops_detail('clients', 'syncs', '', d, d + interval '1 day', 0);
  p1 := diag.ops_detail('clients', 'syncs', '', d, d + interval '1 day', 1);
  if jsonb_array_length(p0->'rows') <> 50 or not (p0->>'more')::boolean or jsonb_array_length(p1->'rows') <> 10 or (p1->>'more')::boolean then
    raise exception 'pages: % then %', jsonb_array_length(p0->'rows'), jsonb_array_length(p1->'rows');
  end if;
  if exists (select 1 from jsonb_array_elements(p0->'rows') a, jsonb_array_elements(p1->'rows') b where a->>'id' = b->>'id') then
    raise exception 'a row on two pages';
  end if;
  if (p0->'rows'->0->>'received')::timestamptz < (p0->'rows'->49->>'received')::timestamptz then raise exception 'newest first'; end if;

  x := diag.ops_detail('clients', 'errors', '', now() - interval '100 days', now() - interval '93 days', 0);
  if x->>'source' <> 'totals' or jsonb_array_length(x->'rows') <> 0 or x->>'note' is null then raise exception 'past 90 days: %', x; end if;
  x := diag.ops_detail('clients', 'errors', '', now() - interval '95 days', now() - interval '85 days', 0);
  if x->>'source' <> 'records' or x->>'note' is null then raise exception 'across 90 days: %', x; end if;
  x := diag.ops_detail('people', 'active_accounts', '', d, d + interval '1 day', 0);
  if x->>'source' <> 'totals' or jsonb_array_length(x->'rows') <> 0 then raise exception 'people: %', x; end if;

  begin perform diag.ops_detail('clients', 'nothing', '', d, d + interval '1 day', 0); ok := false;
  exception when invalid_parameter_value then ok := true; end;
  if not ok then raise exception 'an unknown number is refused'; end if;
  begin perform diag.ops_detail('clients', 'errors', '', d, d + interval '40 days', 0); ok := false;
  exception when invalid_parameter_value then ok := true; end;
  if not ok then raise exception 'a bucket past a month is refused'; end if;
  begin perform diag.ops_detail('clients', 'errors', '', d, d + interval '1 day', -1); ok := false;
  exception when invalid_parameter_value then ok := true; end;
  if not ok then raise exception 'a page below 0 is refused'; end if;
  begin perform diag.ops_detail_rows('clients', 'errors', '', d, d + interval '1 day', 0, 10); ok := false;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'diag_reader runs ops_detail_rows'; end if;

  -- The start page: 14 days of the pairs asked for, in that order; a counted day with no count is 0.
  x := diag.ops_glance(array['jobs', 'capacity', 'clients'], array['runs', 'db_bytes', 'nothing']);
  if x->>'step' <> 'day' or jsonb_array_length(x->'buckets') <> 14 or jsonb_array_length(x->'counted') <> 14
     or jsonb_array_length(x->'series') <> 2 or x->'series'->0->>'metric' <> 'runs' or x->'series'->1->>'agg' <> 'max'
     or jsonb_array_length(x->'series'->0->'values') <> 14 then
    raise exception 'glance: %', x;
  end if;
end $$;
reset role;

rollback;
\echo 'ops detail smoke passed'
