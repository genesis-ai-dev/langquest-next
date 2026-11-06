-- An older snapshot of a version now goes 6 hours after a newer one comes out,
-- not 24 (decisions.md 88, 204). The window only serves a whole-snapshot
-- download still running: a phone filling from the cut reads the newest cut,
-- and a phone that has to try again asks for the newest snapshot anyway. 40 MB
-- at 2 KB/s is about 5.5 hours, so a download of that size that never stops
-- still finishes. At one snapshot an hour a language keeps about 7 copies, not 25.

-- As in 20261104120000_snapshot_purge.sql, but for the window.
create or replace function ops.purge_snapshots(p_snapshots int default 20, p_rows int default 200000) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_started timestamptz := clock_timestamp();
  v record;
  v_gone int := 0;
  v_rows bigint := 0;
  v_staged int;
  v_result jsonb;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('ops.purge_snapshots')) then
    return '{"skipped":true}'::jsonb;
  end if;
  delete from public.snapshot_units_staged s where s.staged_at < now() - interval '1 day';
  get diagnostics v_staged = row_count;
  for v in
    with on_phones as (
      select distinct i.context->>'reducerVersion' as version from diag.installs i
      where i.last_seen > now() - interval '14 days'
    ), placed as (
      select s.org_id, s.stream_id, s.reducer_version, s.server_seq, s.created_at, s.superseded_at, s.chunks,
        row_number() over newest_first as place,
        min(s.created_at) over (newest_first rows between unbounded preceding and 1 preceding) as oldest_newer,
        max(s.reducer_version) over (partition by s.org_id, s.stream_id) as top_version
      from public.snapshots s
      window newest_first as (partition by s.org_id, s.stream_id, s.reducer_version order by s.server_seq desc)
    )
    select p.org_id, p.stream_id, p.reducer_version, p.server_seq, p.chunks from placed p
    where (p.place > 1 and (p.oldest_newer < now() - interval '6 hours' or p.place > 30)
           and not exists (select 1 from public.snapshot_units u
                           where u.org_id = p.org_id and u.stream_id = p.stream_id and u.reducer_version = p.reducer_version
                             and u.server_seq = p.server_seq and u.kind = 'shared' and u.id = ''))
       or (p.place = 1 and p.reducer_version < p.top_version and p.superseded_at < now() - interval '7 days'
           and not exists (select 1 from on_phones o where o.version = p.reducer_version::text))
    order by p.created_at
    limit greatest(p_snapshots, 0)
  loop
    exit when v_gone > 0 and v_rows >= p_rows;
    v_rows := v_rows + coalesce(v.chunks, 0) + (
      select count(*) from public.snapshot_units u
      where u.org_id = v.org_id and u.stream_id = v.stream_id and u.reducer_version = v.reducer_version and u.server_seq = v.server_seq);
    delete from public.snapshots s
    where s.org_id = v.org_id and s.stream_id = v.stream_id and s.reducer_version = v.reducer_version and s.server_seq = v.server_seq;
    v_gone := v_gone + 1;
  end loop;
  v_result := jsonb_build_object('snapshots', v_gone, 'rows', v_rows, 'staged', v_staged);
  insert into diag.job_runs (job, started_at, ms, outcome, n)
  values ('snapshot_purge', v_started, (extract(epoch from clock_timestamp() - v_started) * 1000)::int, 'ok', v_result);
  return v_result;
end $$;
revoke all on function ops.purge_snapshots(int, int) from public, anon, authenticated, service_role;

-- How many copies of each language's snapshot the server holds, for the ops
-- dashboard: in all, per reducer version, and the 20 languages holding the most.
-- Reads the snapshots' own rows only, never their pieces, so it stays cheap.
create or replace function diag.ops_snapshot_copies() returns jsonb
language sql stable security definer set search_path = '' as $$
  with s as (select org_id, stream_id, reducer_version, created_at, coalesce(chunks, 0)::bigint as pieces, coalesce(chars, 0)::bigint as chars from public.snapshots),
  by_language as (
    select org_id, stream_id, count(distinct reducer_version) as versions, count(*) as snapshots, sum(chars) as chars
    from s group by 1, 2 order by count(*) desc, org_id, stream_id limit 20
  )
  select jsonb_build_object(
    'total', (select jsonb_build_object('snapshots', count(*), 'languages', count(distinct (org_id, stream_id)), 'versions', count(distinct reducer_version),
                                        'pieces', coalesce(sum(pieces), 0), 'chars', coalesce(sum(chars), 0)) from s),
    'byVersion', coalesce((select jsonb_agg(jsonb_build_object('reducer', x.reducer_version, 'languages', x.languages, 'snapshots', x.snapshots, 'pieces', x.pieces,
                                                               'chars', x.chars, 'newestAt', to_jsonb(x.newest), 'oldestAt', to_jsonb(x.oldest)) order by x.reducer_version desc)
      from (select reducer_version, count(distinct (org_id, stream_id)) as languages, count(*) as snapshots, sum(pieces) as pieces, sum(chars) as chars,
                   max(created_at) as newest, min(created_at) as oldest from s group by 1) x), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(jsonb_build_object('orgId', l.org_id, 'languageId', l.stream_id, 'name', diag._language_name(l.org_id, l.stream_id),
        'versions', l.versions, 'snapshots', l.snapshots, 'chars', l.chars,
        'perVersion', (select jsonb_agg(jsonb_build_object('reducer', v.reducer_version, 'snapshots', v.n) order by v.reducer_version desc)
                       from (select reducer_version, count(*) as n from s where s.org_id = l.org_id and s.stream_id = l.stream_id group by 1) v))
      order by l.snapshots desc, l.org_id, l.stream_id) from by_language l), '[]'::jsonb)
  )
$$;
revoke all on function diag.ops_snapshot_copies() from public;
grant execute on function diag.ops_snapshot_copies() to diag_reader;
