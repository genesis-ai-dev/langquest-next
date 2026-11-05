-- What stays and what goes from the server's snapshots (decisions.md 88, 203).
-- The rules protect a phone part-way through a download on a slow link, so
-- each block says which phone it protects. It needs nothing from the other
-- smokes and leaves nothing behind.
\set ON_ERROR_STOP on
select set_config('request.jwt.claim.sub', '', false);

-- A snapshot with one piece; with p_cut, the rows a phone fills from.
create or replace function pg_temp.snap(p_stream text, p_version int, p_seq bigint, p_age interval default '0', p_cut boolean default false) returns void
language plpgsql as $$
begin
  if p_cut then
    perform public.stage_snapshot_units('purgeorg', p_stream, p_version, p_seq,
      '[["take","t1","u1","",{"a":1}],["take","t2","u2","",{"a":2}],["shared","","","",{"units":{}}]]'::jsonb);
  end if;
  perform public.put_snapshot('purgeorg', p_stream, p_version, p_seq, jsonb_build_object('seq', p_seq));
  update public.snapshots set created_at = now() - p_age
  where org_id = 'purgeorg' and stream_id = p_stream and reducer_version = p_version and server_seq = p_seq;
end $$;
create or replace function pg_temp.seqs(p_stream text, p_version int) returns bigint[]
language sql as $$
  select coalesce(array_agg(server_seq order by server_seq), '{}') from public.snapshots
  where org_id = 'purgeorg' and stream_id = p_stream and reducer_version = p_version
$$;
create or replace function pg_temp.expect(p_stream text, p_version int, p_seqs bigint[], p_why text) returns void
language plpgsql as $$
begin
  if pg_temp.seqs(p_stream, p_version) is distinct from p_seqs then
    raise exception '%: % v% holds %, expected %', p_why, p_stream, p_version, pg_temp.seqs(p_stream, p_version), p_seqs;
  end if;
end $$;
-- As much as the whole table needs, so a test's rows all get their turn.
create or replace function pg_temp.purge() returns jsonb
language sql as $$ select ops.purge_snapshots(100000, 100000000) $$;

-- put_snapshot no longer cleans up; only the job does.
do $$ begin
  perform pg_temp.snap('write', 1, 1, '3 days');
  perform pg_temp.snap('write', 1, 2, '2 days');
  perform pg_temp.snap('write', 1, 3);
  perform pg_temp.expect('write', 1, array[1, 2, 3]::bigint[], 'writing a snapshot deletes nothing');
end $$;

-- A language that goes quiet is cleaned up with no new write. The window itself
-- is decision 88's: a phone reading pieces has 24 hours after the next one is out.
do $$ begin
  perform pg_temp.snap('quiet', 1, 1, '3 days');
  perform pg_temp.snap('quiet', 1, 2, '2 days');
  perform pg_temp.snap('quiet', 1, 3, '20 hours');
  perform pg_temp.snap('quiet', 1, 4, '1 hour');
  perform pg_temp.purge();
  perform pg_temp.expect('quiet', 1, array[2, 3, 4]::bigint[], 'a snapshot goes once a newer one has been out 24 hours');
  if exists (select 1 from public.snapshot_chunks where org_id = 'purgeorg' and stream_id = 'quiet' and server_seq = 1) then
    raise exception 'pieces should go with their snapshot';
  end if;
  -- The newest stays however old it is: it is what a first download reads.
  perform pg_temp.snap('only', 1, 1, '400 days', true);
  perform pg_temp.purge();
  perform pg_temp.expect('only', 1, array[1]::bigint[], 'a language''s only snapshot stays');
end $$;

-- A phone part-way through a fill asks for the newest cut at or past where it
-- started. Whatever else goes, that must still answer, or the phone drops what
-- it filled and starts over (SyncClient.cutGone).
do $$ declare page jsonb; begin
  perform pg_temp.snap('fill', 1, 1, '3 days', true);
  perform pg_temp.snap('fill', 1, 2, '2 days', true);
  perform pg_temp.snap('fill', 1, 3, '1 hour', true);
  perform pg_temp.purge();
  page := public.get_snapshot_rows('purgeorg', 'fill', 1, 1, array['u1', 'u2'], null, 1);
  if (page->>'server_seq')::bigint <> 3 or jsonb_array_length(page->'rows') <> 1 then raise exception 'the newest cut should answer a fill begun on an older one: %', page; end if;
  -- It goes on from its cursor.
  page := public.get_snapshot_rows('purgeorg', 'fill', 1, 1, array['u1', 'u2'], array['u1', 'take', 't1'], 1);
  if page->'rows'->0->>1 <> 't2' then raise exception 'a fill should go on from its cursor: %', page; end if;
end $$;

-- A newest snapshot written without a cut (its staged rows lost in a crash)
-- leaves the only cut on an older one; that one stays until a newer cut replaces it.
do $$ begin
  perform pg_temp.snap('uncut', 1, 1, '3 days', true);
  perform pg_temp.snap('uncut', 1, 2, '2 days');
  perform pg_temp.snap('uncut', 1, 3, '1 hour');
  perform pg_temp.purge();
  perform pg_temp.expect('uncut', 1, array[1, 2, 3]::bigint[], 'the only cut stays; so does the one that outlives it by under 24 hours');
  if public.get_snapshot_rows('purgeorg', 'uncut', 1, 1, array['u1'], null, 10) is null then raise exception 'the only cut should still answer'; end if;
  perform pg_temp.snap('uncut', 1, 4, '0', true);
  perform pg_temp.purge();
  perform pg_temp.expect('uncut', 1, array[2, 3, 4]::bigint[], 'an older snapshot goes once a newer cut took its rows');
end $$;

-- A burst (an import, 5 minutes a snapshot) stays within the cap. At one an hour it never applies.
do $$ begin
  for i in 1..35 loop perform pg_temp.snap('burst', 1, i, make_interval(mins => 36 - i)); end loop;
  perform pg_temp.purge();
  perform pg_temp.expect('burst', 1, array(select generate_series(6, 35))::bigint[], 'the newest 30 stay');
  for i in 1..25 loop perform pg_temp.snap('hourly', 1, i, make_interval(hours => 25 - i)); end loop;
  perform pg_temp.purge();
  if cardinality(pg_temp.seqs('hourly', 1)) <> 25 then raise exception 'the schedule''s normal hourly writes should not meet the cap, %', pg_temp.seqs('hourly', 1); end if;
end $$;

-- A deploy that bumps the reducer. A phone on the old version reads only that
-- version: it keeps the newest of it, and everything older goes as usual.
do $$ declare at timestamptz; begin
  perform pg_temp.snap('bump', 1, 1, '3 days', true);
  perform pg_temp.snap('bump', 1, 2, '2 days', true);
  if (select bool_or(superseded_at is not null) from public.snapshots where stream_id = 'bump') then raise exception 'nothing is replaced by a newer reducer yet'; end if;
  perform pg_temp.snap('bump', 2, 2);
  if (select bool_or(superseded_at is null) from public.snapshots where stream_id = 'bump' and reducer_version = 1) then raise exception 'the newer reducer''s snapshot should mark the older version'; end if;
  if (select superseded_at from public.snapshots where stream_id = 'bump' and reducer_version = 2) is not null then raise exception 'the newest version is not replaced'; end if;
  perform pg_temp.purge();
  perform pg_temp.expect('bump', 1, array[2]::bigint[], 'an old version keeps only its newest');

  -- Rewriting the mark would restart the clock.
  update public.snapshots set superseded_at = now() - interval '6 days' where stream_id = 'bump' and reducer_version = 1;
  at := (select superseded_at from public.snapshots where stream_id = 'bump' and reducer_version = 1);
  perform pg_temp.snap('bump', 2, 3);
  if (select superseded_at from public.snapshots where stream_id = 'bump' and reducer_version = 1) <> at then raise exception 'the first newer snapshot sets the time'; end if;

  -- Less than 7 days: it stays, with nobody seen on it.
  perform pg_temp.purge();
  perform pg_temp.expect('bump', 1, array[2]::bigint[], 'an old version stays 7 days');

  -- Past 7 days with a phone on it seen lately (a store build a native change left behind): it stays, with its cut.
  update public.snapshots set superseded_at = now() - interval '30 days' where stream_id = 'bump' and reducer_version = 1;
  insert into diag.installs (install_id, profile_id, context, last_seen) values ('purge-phone', 'p', '{"reducerVersion":"1"}', now() - interval '13 days');
  perform pg_temp.purge();
  perform pg_temp.expect('bump', 1, array[2]::bigint[], 'an old version stays while a phone on it was seen in 14 days');
  if public.get_snapshot_rows('purgeorg', 'bump', 1, 2, array['u1'], null, 10) is null then raise exception 'its cut should still answer a fill'; end if;

  -- A phone on another version does not hold it.
  update diag.installs set context = '{"reducerVersion":"2"}' where install_id = 'purge-phone';
  perform pg_temp.purge();
  perform pg_temp.expect('bump', 1, '{}'::bigint[], 'an old version goes once no phone on it was seen');
  if exists (select 1 from public.snapshot_units where stream_id = 'bump' and reducer_version = 1) then raise exception 'its cut should go with it'; end if;
  if exists (select 1 from public.snapshot_chunks where stream_id = 'bump' and reducer_version = 1) then raise exception 'its pieces should go with it'; end if;
  perform pg_temp.expect('bump', 2, array[2, 3]::bigint[], 'the newest version is untouched');

  -- A phone last seen 14 days ago no longer holds it.
  perform pg_temp.snap('seen', 1, 1, '60 days');
  perform pg_temp.snap('seen', 2, 1);
  update public.snapshots set superseded_at = now() - interval '30 days' where stream_id = 'seen' and reducer_version = 1;
  update diag.installs set context = '{"reducerVersion":"1"}', last_seen = now() - interval '15 days' where install_id = 'purge-phone';
  perform pg_temp.purge();
  perform pg_temp.expect('seen', 1, '{}'::bigint[], 'a phone not seen for 14 days does not hold a version');
end $$;

-- A language the pass has not reached since the deploy has no newer version: its
-- only snapshot stays, however old, and a mark without one does not change that.
do $$ begin
  perform pg_temp.snap('notyet', 1, 1, '100 days');
  update public.snapshots set superseded_at = now() - interval '100 days' where stream_id = 'notyet';
  perform pg_temp.purge();
  perform pg_temp.expect('notyet', 1, array[1]::bigint[], 'never the only version a language has');
end $$;

-- Each run is bounded, so the backlog goes a little at a time.
do $$ declare r jsonb; begin
  for i in 1..4 loop perform pg_temp.snap('batch', 1, i, make_interval(days => 6 - i)); end loop;
  r := ops.purge_snapshots(1, 100000000);
  if (r->>'snapshots')::int <> 1 then raise exception 'one snapshot a run was asked for: %', r; end if;
  perform pg_temp.purge();
  -- The row limit stops a run once it is reached, and never before the first.
  perform pg_temp.snap('heavy1', 1, 1, '3 days');
  perform pg_temp.snap('heavy1', 1, 2, '2 days');
  perform pg_temp.snap('heavy2', 1, 1, '3 days');
  perform pg_temp.snap('heavy2', 1, 2, '2 days');
  r := ops.purge_snapshots(100, 1);
  if (r->>'snapshots')::int <> 1 then raise exception 'a run past its rows should stop: %', r; end if;
  perform pg_temp.purge();
end $$;

-- Rows a dead pass staged go after a day; a pass at work keeps its own.
do $$ begin
  perform public.stage_snapshot_units('purgeorg', 'dead', 1, 1, '[["take","t","u","",{}]]'::jsonb);
  perform public.stage_snapshot_units('purgeorg', 'working', 1, 1, '[["take","t","u","",{}]]'::jsonb);
  update public.snapshot_units_staged set staged_at = now() - interval '25 hours' where stream_id = 'dead';
  perform pg_temp.purge();
  if exists (select 1 from public.snapshot_units_staged where stream_id = 'dead') then raise exception 'a dead pass''s rows should go'; end if;
  if not exists (select 1 from public.snapshot_units_staged where stream_id = 'working') then raise exception 'a working pass''s rows should stay'; end if;
  delete from public.snapshot_units_staged where org_id = 'purgeorg';
end $$;

-- After a redaction no snapshot from before it stays readable, on any version;
-- one past it stays. A language with nothing past the redaction keeps what it has.
do $$ begin
  perform pg_temp.snap('redact', 1, 5, '1 hour', true);
  perform pg_temp.snap('redact', 2, 6, '1 hour');
  perform pg_temp.snap('redact', 2, 7, '30 minutes');
  perform pg_temp.snap('redact', 2, 9, '0', true);
  perform public.drop_snapshots_before('purgeorg', 'redact', 8);
  perform pg_temp.expect('redact', 1, '{}'::bigint[], 'an older version''s copy may hold the redacted event');
  perform pg_temp.expect('redact', 2, array[9]::bigint[], 'only what is past the redaction stays');
  perform public.drop_snapshots_before('purgeorg', 'redact', 100);
  perform pg_temp.expect('redact', 2, array[9]::bigint[], 'never the last one, with nothing past the redaction to replace it');
end $$;

-- Only the service role writes.
select set_config('request.jwt.claim.sub', 'someone', false);
do $$ begin
  perform public.drop_snapshots_before('purgeorg', 'redact', 100);
  raise exception 'a signed-in caller must not drop snapshots';
exception when insufficient_privilege then null;
end $$;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  if has_function_privilege('authenticated', 'public.drop_snapshots_before(text, text, bigint)', 'execute') then raise exception 'signed-in people may run drop_snapshots_before'; end if;
  if has_function_privilege('anon', 'public.drop_snapshots_before(text, text, bigint)', 'execute') then raise exception 'anon may run drop_snapshots_before'; end if;
  if not has_function_privilege('service_role', 'public.drop_snapshots_before(text, text, bigint)', 'execute') then raise exception 'the pass should run drop_snapshots_before'; end if;
  if has_function_privilege('service_role', 'ops.purge_snapshots(integer, integer)', 'execute') then raise exception 'the purge belongs to the database''s own job'; end if;
end $$;

-- What the dashboard says about these tables counts all of them, and they are vacuumed sooner than the default.
do $$ declare t text; begin
  if (diag.ops_sizes()->>'snapshotsBytes')::bigint < pg_total_relation_size('public.snapshots') + pg_total_relation_size('public.snapshot_units')
       + pg_total_relation_size('public.snapshot_chunks') + pg_total_relation_size('public.snapshot_units_staged') then
    raise exception 'snapshotsBytes should count every snapshot table';
  end if;
  foreach t in array array['snapshots', 'snapshot_chunks', 'snapshot_units'] loop
    if not exists (select 1 from pg_class c where c.oid = ('public.' || t)::regclass and c.reloptions::text like '%autovacuum_vacuum_scale_factor%') then
      raise exception '% should be vacuumed sooner', t;
    end if;
    if not exists (select 1 from pg_class c join pg_class toast on toast.oid = c.reltoastrelid
                   where c.oid = ('public.' || t)::regclass and toast.reloptions::text like '%autovacuum_vacuum_scale_factor%') then
      raise exception '%''s TOAST table should be vacuumed sooner', t;
    end if;
  end loop;
end $$;

-- Every run says what it did on the jobs page (npm run diag -- jobs), so a job that stopped shows as stale.
do $$ declare r jsonb; begin
  perform pg_temp.snap('run', 1, 1, '3 days');
  perform pg_temp.snap('run', 1, 2, '2 days');
  delete from diag.job_runs where job = 'snapshot_purge';
  r := pg_temp.purge();
  if (r->>'snapshots')::int < 1 then raise exception 'purge said %', r; end if;
  if not exists (select 1 from diag.job_runs where job = 'snapshot_purge' and outcome = 'ok' and (n->>'snapshots')::int >= 1) then raise exception 'a run should leave a job run'; end if;
  perform pg_temp.purge();
  if (select count(*) from diag.job_runs where job = 'snapshot_purge') <> 2 then raise exception 'a run with nothing to do should leave a job run too'; end if;
  if (select every from diag.job_schedule where job = 'snapshot_purge') <> interval '10 minutes' then raise exception 'the job should be on the schedule'; end if;
  delete from diag.job_runs where job = 'snapshot_purge';
end $$;

-- Leave nothing behind.
delete from public.snapshots where org_id = 'purgeorg';
delete from public.snapshot_units_staged where org_id = 'purgeorg';
delete from diag.installs where install_id = 'purge-phone';
