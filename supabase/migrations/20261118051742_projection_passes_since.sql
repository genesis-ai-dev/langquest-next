-- A language behind the projection pass: how long, and how many passes left it (LAN-301).
--
-- diag.ops_pipeline listed the languages whose stream is past their
-- projection mark, by how many events. That is normal for up to one pass:
-- the pass runs every five minutes, and an import can append a thousand
-- events between two of them (Bhujel, 2026-11-18: 988 events, projected within
-- six minutes, while the dashboard said the language was behind).
--
-- Each row now also says when the oldest event the pass has not projected
-- arrived (`waitingSince`, the events table's received_at, read by the
-- stream's own index) and how many projection passes started after that and
-- have ended (`passesSince`: a run's row in diag.job_runs is written when
-- the pass ends). A pass takes in every event that was in the log when it
-- started, so passes since mean the language was left behind. One alone can
-- be a pass a deploy stopped, or an append that committed as the pass
-- began; the admin Worker decides how many raise a line
-- (apps/admin/src/sources/ops.ts PASSES_LEFT_BEHIND). The rows are in that
-- order, so the ten returned always hold the ones left behind.
--
-- Restated whole from 20261026130000_ops_schedule_from_caller.sql; the
-- changes are `lag`, `lag10` and the two keys in each `lag` row.

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
  behind as (select l.*, l.head - coalesce(l.projected_seq, 0) as behind from lang l where l.head > coalesce(l.projected_seq, 0)),
  lag as (
    select b.*, w.waiting_since,
           (select count(*) from diag.job_runs r where r.job = 'projection' and r.started_at > w.waiting_since) as passes_since
    from behind b
    left join lateral (select e.received_at as waiting_since from public.events e
                        where e.org_id = b.org_id and e.stream_id = b.language_id and e.server_seq > coalesce(b.projected_seq, 0)
                        order by e.server_seq limit 1) w on true
  ),
  snaps as (
    select l.*, l.head - l.snap_seq as sbehind,
           (l.head - l.snap_seq >= p_min_new_events
            or (l.head > l.snap_seq and l.snap_at < now() - make_interval(secs => p_max_age_ms / 1000.0))) as overdue,
           (l.reducer_version < p_reducer) as old,
           not exists (select 1 from public.snapshot_units u where u.org_id = l.org_id and u.stream_id = l.language_id
                         and u.reducer_version = l.reducer_version and u.server_seq = l.snap_seq) as nocut
    from lang l where l.snap_seq is not null
  ),
  lag10 as (select * from lag order by passes_since desc, behind desc, org_id, language_id limit 10),
  worst as (select * from snaps where overdue order by sbehind desc, org_id, language_id limit 5),
  big as (select * from lang where head > 0 order by head desc, org_id, language_id limit 10)
  select jsonb_build_object(
    'lagging', (select count(*) from lag),
    'lag', coalesce((select jsonb_agg(jsonb_build_object('orgId', x.org_id, 'languageId', x.language_id,
        'name', diag._language_name(x.org_id, x.language_id), 'head', x.head, 'projectedSeq', x.projected_seq,
        'behind', x.behind, 'projectedAt', to_jsonb(x.projected_at),
        'waitingSince', to_jsonb(x.waiting_since), 'passesSince', x.passes_since)
        order by x.passes_since desc, x.behind desc, x.org_id, x.language_id) from lag10 x), '[]'::jsonb),
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
