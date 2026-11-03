-- Read-only. Snapshot storage by reducer version, and who runs each reducer. One JSON value.
with
rv as (
  select s.reducer_version as v, count(*) as snapshots,
         count(distinct s.stream_id) filter (where s.stream_id <> '_org') as languages,
         count(distinct s.org_id) filter (where s.stream_id = '_org') as org_streams,
         count(*) filter (where s.state is not null) as with_old_state,
         sum(coalesce(pg_column_size(s.state), 0)) as state_bytes,
         sum(coalesce(s.chars, 0)) as chars,
         min(s.created_at) as oldest, max(s.created_at) as newest
  from public.snapshots s group by 1
),
ch as (select reducer_version as v, count(*) as pieces, sum(pg_column_size(c.*)) as bytes from public.snapshot_chunks c group by 1),
un as (select reducer_version as v, count(*) as rows, sum(pg_column_size(u.*)) as bytes from public.snapshot_units u group by 1),
per_stream as (
  select s.reducer_version as v, s.org_id, s.stream_id, count(*) as n, max(s.chars) as max_chars
  from public.snapshots s group by 1, 2, 3
),
review as (select id::text as pid from auth.users where lower(email) = 'playreview@frontierrnd.com'),
staff as (select id::text as pid from auth.users where lower(email) in ('caleb.koster@gmail.com', 'caleb@frontierrnd.com', 'caleb.koster.eh@gmail.com')),
inst as (
  select i.*, nullif(i.context->>'reducerVersion', '') as v,
         case when i.profile_id in (select pid from review) then 'store_review'
              when i.profile_id in (select pid from staff) then 'caleb' else 'people' end as who
  from diag.installs i where i.last_seen > now() - interval '30 days'
),
big as (
  select e.org_id, e.stream_id, count(*) as events from public.events e group by 1, 2 order by 3 desc limit 8
)
select jsonb_build_object(
  'by_reducer', (select jsonb_agg(jsonb_build_object(
      'reducer', rv.v, 'snapshots', rv.snapshots, 'languages', rv.languages, 'org_streams', rv.org_streams,
      'with_old_state', rv.with_old_state, 'state_mb', round(rv.state_bytes / 1048576.0),
      'pieces', ch.pieces, 'pieces_mb', round(coalesce(ch.bytes, 0) / 1048576.0),
      'unit_rows', un.rows, 'units_mb', round(coalesce(un.bytes, 0) / 1048576.0),
      'total_mb', round((rv.state_bytes + coalesce(ch.bytes, 0) + coalesce(un.bytes, 0)) / 1048576.0),
      'snapshot_text_mb', round(rv.chars / 1048576.0),
      'oldest', to_char(rv.oldest, 'MM-DD HH24:MI'), 'newest', to_char(rv.newest, 'MM-DD HH24:MI')) order by rv.v)
    from rv left join ch using (v) left join un using (v)),
  'snapshots_per_language', (select jsonb_agg(jsonb_build_object('reducer', x.v, 'languages', x.langs, 'with_1', x.one, 'with_2_to_5', x.few, 'with_6_plus', x.many, 'most', x.most) order by x.v)
    from (select v, count(*) as langs, count(*) filter (where n = 1) as one, count(*) filter (where n between 2 and 5) as few,
                 count(*) filter (where n >= 6) as many, max(n) as most from per_stream where stream_id <> '_org' group by v) x),
  'snapshot_size_mb', (select jsonb_agg(jsonb_build_object('reducer', x.v, 'median', x.p50, 'p90', x.p90, 'largest', x.mx) order by x.v)
    from (select v, round((percentile_cont(0.5) within group (order by max_chars) / 1048576.0)::numeric, 2) as p50,
                 round((percentile_cont(0.9) within group (order by max_chars) / 1048576.0)::numeric, 2) as p90,
                 round(max(max_chars) / 1048576.0, 1) as mx
          from per_stream where stream_id <> '_org' and max_chars is not null group by v) x),
  'biggest_languages', (select jsonb_agg(jsonb_build_object('language', left(b.stream_id, 8), 'events', b.events,
      'snapshots', (select jsonb_object_agg(p.v, jsonb_build_object('n', p.n, 'mb', round(coalesce(p.max_chars, 0) / 1048576.0, 1)))
                    from per_stream p where p.org_id = b.org_id and p.stream_id = b.stream_id)) order by b.events desc) from big b),
  'made_by_day', (select jsonb_agg(jsonb_build_object('day', x.d, 'reducer', x.v, 'snapshots', x.n, 'mb', x.mb) order by x.d, x.v)
    from (select to_char(date_trunc('day', created_at at time zone 'America/Los_Angeles'), 'MM-DD') as d, reducer_version as v, count(*) as n,
                 round(sum(coalesce(chars, 0)) / 1048576.0) as mb
          from public.snapshots where created_at > now() - interval '14 days' group by 1, 2) x),
  'installs_by_reducer', (select jsonb_agg(jsonb_build_object('reducer', x.v, 'who', x.who, 'os', x.os,
      'installs_7d', x.i7, 'people_7d', x.p7, 'installs_30d', x.i30, 'people_30d', x.p30) order by x.v, x.who, x.os)
    from (select v, who, coalesce(context->>'os', '?') as os,
                 count(*) filter (where last_seen > now() - interval '7 days') as i7,
                 count(distinct profile_id) filter (where last_seen > now() - interval '7 days') as p7,
                 count(*) as i30, count(distinct profile_id) as p30
          from inst group by 1, 2, 3) x),
  'people_newest_install', (select jsonb_agg(jsonb_build_object('reducer', x.v, 'people', x.n) order by x.v)
    from (select v, count(*) as n from (select distinct on (profile_id) profile_id, v from inst where who = 'people' and context->>'os' <> 'web'
                                        order by profile_id, last_seen desc) q group by v) x),
  'snapshot_downloads_14d', (select jsonb_agg(jsonb_build_object('why', x.why, 'outcome', x.outcome, 'reducer_now', x.v, 'n', x.n, 'installs', x.i) order by x.n desc)
    from (select r.t->>'why' as why, r.t->>'outcome' as outcome, nullif(i.context->>'reducerVersion', '') as v, count(*) as n, count(distinct r.install_id) as i
          from diag.records r left join diag.installs i using (install_id)
          where r.kind = 'snapshot' and r.received_at > now() - interval '14 days' group by 1, 2, 3) x),
  'table_health', (select jsonb_agg(jsonb_build_object('table', s.relname, 'live_rows', s.n_live_tup, 'dead_rows', s.n_dead_tup,
      'total_mb', round(pg_total_relation_size(s.relid) / 1048576.0), 'toast_mb', round(coalesce(pg_total_relation_size(c.reltoastrelid), 0) / 1048576.0),
      'last_autovacuum', to_char(s.last_autovacuum, 'MM-DD HH24:MI')))
    from pg_stat_user_tables s join pg_class c on c.oid = s.relid
    where s.schemaname = 'public' and s.relname in ('snapshots', 'snapshot_chunks', 'snapshot_units', 'snapshot_units_staged', 'events')),
  'db_mb_now', round(pg_database_size(current_database()) / 1048576.0)
) as v;
