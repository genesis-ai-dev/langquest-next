-- The snapshot schedule and the diagnostics cap each live in one place.
--
-- diag.ops_pipeline restated sync's SNAPSHOT_SCHEDULE (200 new events, one
-- hour; packages/sync/src/snapshotWorker.ts) to say which snapshots are
-- overdue. It now takes the thresholds from its caller (the admin Worker
-- reads them from sync), so a change to the schedule cannot leave the
-- dashboard counting by the old one.
--
-- diag.ops_limits restated the cap public.diag_ingest applies per install per
-- day. diag._ingest_day_cap() names it for the report; diag_ingest keeps its
-- literal (it is long, and server/opsDashboardSmoke.sql fails when the two
-- differ).

drop function if exists diag.ops_pipeline(int);

create or replace function diag.ops_pipeline(p_reducer int, p_min_new_events int, p_max_age_ms bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  with lang as (
    select c.org_id, c.stream_id as language_id, c.next_seq - 1 as head, m.seq as projected_seq, m.projected_at,
           s.reducer_version, s.server_seq as snap_seq, s.created_at as snap_at, s.chars
    from public.stream_cursors c
    left join public.projection_marks m on m.org_id = c.org_id and m.stream_id = c.stream_id
    left join lateral (select x.reducer_version, x.server_seq, x.created_at, x.chars from public.snapshots x
                        where x.org_id = c.org_id and x.stream_id = c.stream_id
                        order by x.server_seq desc, x.reducer_version desc limit 1) s on true
    where c.stream_id <> '_org' and c.org_id <> '_person'
  ),
  lag as (select l.*, l.head - coalesce(l.projected_seq, 0) as behind from lang l where l.head > coalesce(l.projected_seq, 0)),
  snaps as (
    select l.*, l.head - l.snap_seq as sbehind,
           (l.head - l.snap_seq >= p_min_new_events
            or (l.head > l.snap_seq and l.snap_at < now() - make_interval(secs => p_max_age_ms / 1000.0))) as overdue,
           (l.reducer_version < p_reducer) as old,
           not exists (select 1 from public.snapshot_units u where u.org_id = l.org_id and u.stream_id = l.language_id
                         and u.reducer_version = l.reducer_version and u.server_seq = l.snap_seq) as nocut
    from lang l where l.snap_seq is not null
  ),
  lag10 as (select * from lag order by behind desc, org_id, language_id limit 10),
  worst as (select * from snaps where overdue order by sbehind desc, org_id, language_id limit 5),
  big as (select * from lang where head > 0 order by head desc, org_id, language_id limit 10)
  select jsonb_build_object(
    'lagging', (select count(*) from lag),
    'lag', coalesce((select jsonb_agg(jsonb_build_object('orgId', x.org_id, 'languageId', x.language_id,
        'name', diag._language_name(x.org_id, x.language_id), 'head', x.head, 'projectedSeq', x.projected_seq,
        'behind', x.behind, 'projectedAt', to_jsonb(x.projected_at)) order by x.behind desc, x.org_id, x.language_id) from lag10 x), '[]'::jsonb),
    'snapshots', jsonb_build_object(
      'overdue', (select count(*) from snaps where overdue),
      'oldReducer', (select count(*) from snaps where old),
      'noCut', (select count(*) from snaps where nocut),
      'worst', coalesce((select jsonb_agg(jsonb_build_object('orgId', x.org_id, 'languageId', x.language_id,
          'name', diag._language_name(x.org_id, x.language_id), 'behind', x.sbehind,
          'ageMinutes', floor(extract(epoch from now() - x.snap_at) / 60)::int) order by x.sbehind desc, x.org_id, x.language_id)
        from worst x), '[]'::jsonb)),
    'largest', coalesce((select jsonb_agg(jsonb_build_object('orgId', x.org_id, 'languageId', x.language_id,
        'name', diag._language_name(x.org_id, x.language_id), 'events', x.head, 'snapshotBytes', x.chars)
        order by x.head desc, x.org_id, x.language_id) from big x), '[]'::jsonb)
  )
$$;

revoke all on function diag.ops_pipeline(int, int, bigint) from public;
grant execute on function diag.ops_pipeline(int, int, bigint) to diag_reader;

create or replace function diag._ingest_day_cap() returns int
language sql immutable set search_path = '' as $$ select 5000 $$;
revoke all on function diag._ingest_day_cap() from public;

create or replace function diag.ops_limits() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'v2SignInFailures24h', (select count(*) from v2_import.sign_in_failures f where f.at > now() - interval '1 day'),
    'installsAtDiagCap', (select count(*) from diag.installs i where i.day_start = current_date and i.day_count >= diag._ingest_day_cap()))
$$;
revoke all on function diag.ops_limits() from public;
grant execute on function diag.ops_limits() to diag_reader;
