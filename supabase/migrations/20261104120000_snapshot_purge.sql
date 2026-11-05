-- A job keeps the server's snapshots bounded (decisions.md 203, 88).
--
-- put_snapshot deleted older snapshots of the reducer it was writing, and
-- only when it was writing. So a deploy that bumped REDUCER_VERSION froze
-- every language's snapshots of the old version for good, each with a whole
-- cut, and a language that went quiet kept its last day's snapshots. Hosted,
-- 2026-11-04: 17.7 GB of snapshot tables beside 2.2 GB of events.
--
-- These tables are all rebuilt from the log, so nothing here can lose work.
-- What it can cost is a phone on a slow link its download, so each rule below
-- says which phone it leaves alone:
--
-- - A snapshot with a newer one in its version goes once a newer one has been
--   out 24 hours (88). A phone reading pieces has that long; a phone filling
--   from the cut does not care, since it reads the newest cut at or past where
--   it started (147).
-- - One that holds its version's only cut stays, whatever its age (a newer
--   snapshot written without one, its staged rows lost in a crash). A phone
--   part-way through a fill that finds no cut drops what it filled.
-- - Beyond the newest 30 of a version one goes sooner, since a burst (an
--   import) can write one every pass, not one an hour.
-- - The newest of a version that a later one replaced stays 7 days, and for as
--   long as a phone on that version was seen in the last 14 (diag.installs,
--   each delivery of diagnostics): a store build a native change left behind
--   can run an old reducer for weeks, and a phone mid-fill that loses its cut
--   starts over from the whole log.
-- - The only version a language has always stays.
--
-- Each run takes a limited number, so a backlog goes a little at a time and
-- the deletes never wait on, or hold up, a snapshot being read.

alter table public.snapshots add column if not exists superseded_at timestamptz;
alter table public.snapshot_units_staged add column if not exists staged_at timestamptz not null default now();

-- When a later reducer's first snapshot came out: not known for those that
-- came before this column, so the oldest it still has, at worst later than the truth.
update public.snapshots s set superseded_at = (
  select min(h.created_at) from public.snapshots h
  where h.org_id = s.org_id and h.stream_id = s.stream_id and h.reducer_version > s.reducer_version)
where s.superseded_at is null and exists (
  select 1 from public.snapshots h
  where h.org_id = s.org_id and h.stream_id = s.stream_id and h.reducer_version > s.reducer_version);

-- Deleting a snapshot leaves its rows dead until autovacuum comes; a phone
-- paging through a cut reads past them. These rows are rewritten whole, so the
-- default (a fifth of the table dead) means gigabytes. Vacuum also gives back
-- whatever is empty at the end of a table, which is how the state snapshots no
-- longer keep (147) comes back to the disk once the snapshots holding it are gone.
alter table public.snapshots set (
  autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 200,
  toast.autovacuum_vacuum_scale_factor = 0.02, toast.autovacuum_vacuum_threshold = 1000);
alter table public.snapshot_chunks set (
  autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
  toast.autovacuum_vacuum_scale_factor = 0.02, toast.autovacuum_vacuum_threshold = 1000);
alter table public.snapshot_units set (
  autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 5000,
  toast.autovacuum_vacuum_scale_factor = 0.02, toast.autovacuum_vacuum_threshold = 1000);

-- As in 20261026170800_snapshot_cut_storage.sql, and: older snapshots are the
-- job's to delete; a snapshot of a later reducer marks the versions before it.
create or replace function public.put_snapshot(
  p_org_id text, p_stream_id text, p_reducer_version int, p_server_seq bigint, p_state jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_text text;
  v_bytes bytea;
  v_size int := public.snapshot_chunk_chars();
  v_len int;
  v_pos int := 0;
  v_end int;
  v_count int := 0;
begin
  if public.caller_id() is not null then
    raise exception 'snapshots are written by the service role only' using errcode = '42501';
  end if;
  v_text := p_state::text;
  insert into public.snapshots (org_id, stream_id, reducer_version, server_seq, state, chars, chunks)
  values (p_org_id, p_stream_id, p_reducer_version, p_server_seq, null, length(v_text), null)
  on conflict (org_id, stream_id, reducer_version, server_seq)
    do update set state = null, chars = excluded.chars, chunks = null, created_at = now();
  delete from public.snapshot_chunks c
  where c.org_id = p_org_id and c.stream_id = p_stream_id and c.reducer_version = p_reducer_version
    and c.server_seq = p_server_seq;
  v_bytes := convert_to(v_text, 'UTF8');
  v_len := length(v_bytes);
  loop
    v_end := least(v_pos + v_size, v_len);
    while v_end < v_len and (get_byte(v_bytes, v_end) & 192) = 128 loop v_end := v_end - 1; end loop;
    insert into public.snapshot_chunks (org_id, stream_id, reducer_version, server_seq, idx, piece)
    values (p_org_id, p_stream_id, p_reducer_version, p_server_seq, v_count,
            convert_from(substring(v_bytes from v_pos + 1 for v_end - v_pos), 'UTF8'));
    v_count := v_count + 1;
    v_pos := v_end;
    exit when v_pos >= v_len;
  end loop;
  update public.snapshots s set chunks = v_count
  where s.org_id = p_org_id and s.stream_id = p_stream_id and s.reducer_version = p_reducer_version
    and s.server_seq = p_server_seq;
  -- The cut (decisions.md 147): this snapshot's rows, if the pass staged them; the newest snapshot alone keeps rows.
  if exists (select 1 from public.snapshot_units_staged s
             where s.org_id = p_org_id and s.stream_id = p_stream_id and s.reducer_version = p_reducer_version
               and s.server_seq = p_server_seq) then
    delete from public.snapshot_units u
    where u.org_id = p_org_id and u.stream_id = p_stream_id and u.reducer_version = p_reducer_version;
    insert into public.snapshot_units (org_id, stream_id, reducer_version, server_seq, kind, id, unit_id, ref, json)
    select org_id, stream_id, reducer_version, server_seq, kind, id, unit_id, ref, json
    from public.snapshot_units_staged s
    where s.org_id = p_org_id and s.stream_id = p_stream_id and s.reducer_version = p_reducer_version
      and s.server_seq = p_server_seq;
    -- How many rows each passage has, counted once here for get_snapshot_head, not on every cold open.
    update public.snapshots n set unit_counts = (
      select coalesce(jsonb_agg(jsonb_build_array(t.unit_id, t.n) order by t.unit_id), '[]'::jsonb)
      from (select s.unit_id, count(*) as n from public.snapshot_units_staged s
            where s.org_id = p_org_id and s.stream_id = p_stream_id and s.reducer_version = p_reducer_version
              and s.server_seq = p_server_seq and s.kind <> 'shared'
            group by s.unit_id) t)
    where n.org_id = p_org_id and n.stream_id = p_stream_id and n.reducer_version = p_reducer_version
      and n.server_seq = p_server_seq;
  end if;
  delete from public.snapshot_units_staged s where s.org_id = p_org_id and s.stream_id = p_stream_id;
  -- The time a later reducer replaced these, once: the job counts from it.
  update public.snapshots s set superseded_at = now()
  where s.org_id = p_org_id and s.stream_id = p_stream_id and s.reducer_version < p_reducer_version
    and s.superseded_at is null;
end $$;

-- A run is recorded even with nothing to do, so a job that stops shows as stale
-- (npm run diag -- jobs) long before the tables show it.
insert into diag.job_schedule (job, every, slack, runs_on) values
  ('snapshot_purge', interval '10 minutes', interval '20 minutes', 'pg_cron, langquest-purge-snapshots, in the database')
on conflict (job) do update set every = excluded.every, slack = excluded.slack, runs_on = excluded.runs_on;

-- One run of the job: at most p_snapshots snapshots, and no more once p_rows of
-- their pieces and rows are gone, the oldest first. Rows a dead pass staged go
-- after a day. A run that overlaps another does nothing.
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
    where (p.place > 1 and (p.oldest_newer < now() - interval '24 hours' or p.place > 30)
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

-- A redaction takes effect on the server: no snapshot from before it stays
-- readable, on any version. Called by the pass once a snapshot past it is
-- written, so with none past it (a call out of turn) nothing goes. A phone on
-- an older reducer gets no snapshot past a redaction in any case.
create or replace function public.drop_snapshots_before(p_org_id text, p_stream_id text, p_server_seq bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.caller_id() is not null then
    raise exception 'snapshots are written by the service role only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.snapshots s
                 where s.org_id = p_org_id and s.stream_id = p_stream_id and s.server_seq >= p_server_seq) then
    return;
  end if;
  delete from public.snapshots s
  where s.org_id = p_org_id and s.stream_id = p_stream_id and s.server_seq < p_server_seq;
end $$;
revoke all on function public.drop_snapshots_before(text, text, bigint) from public, anon, authenticated;
grant execute on function public.drop_snapshots_before(text, text, bigint) to service_role;

-- Every table a language's snapshots take space in; the pieces were left out, a third of it.
create or replace function diag.ops_sizes() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'dbBytes', pg_database_size(current_database()),
    'eventsBytes', pg_total_relation_size('public.events'::regclass),
    'eventsRows', (select greatest(c.reltuples, 0)::bigint from pg_catalog.pg_class c where c.oid = 'public.events'::regclass),
    'snapshotsBytes', pg_total_relation_size('public.snapshots'::regclass) + pg_total_relation_size('public.snapshot_chunks'::regclass)
      + pg_total_relation_size('public.snapshot_units'::regclass) + pg_total_relation_size('public.snapshot_units_staged'::regclass))
$$;

-- It needs no secret, so a reset keeps it (server/cronSmoke.sql).
do $$
begin
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'langquest-purge-snapshots';
  perform cron.schedule('langquest-purge-snapshots', '7-59/10 * * * *', $job$
    select ops.purge_snapshots();
  $job$);
end $$;
