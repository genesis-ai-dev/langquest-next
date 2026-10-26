-- The server's snapshot path does less per fold (performance-audit-2026-10-26.md
-- item 14, decisions.md 88, 147).
--
-- 1. get_snapshot_head no longer counts every unit row on each cold open:
--    put_snapshot counts each passage's rows once, from the rows it moves in,
--    and keeps them on the snapshot's row (snapshots.unit_counts). A cut made
--    before this keeps its counting until its next snapshot; the backfill
--    below fills the ones that exist.
-- 2. The staging table is unlogged. Its rows live from the pass's first
--    batch to put_snapshot, a few minutes, and are written again into
--    snapshot_units; keeping them out of the write-ahead log takes about a
--    third off the snapshot's WAL. A crash empties it; put_snapshot then
--    finds nothing staged, writes the snapshot without a cut, and the next
--    visit stages the cut again (snapshotWorker completeCut).
-- 3. put_passage_lines found the lines to drop with a scan of the incoming
--    lines per stored line; it now joins on them. It also clears a stored
--    line's digest when it changes the line.
-- 4. Lines keep a digest, and the pass sends only the lines whose digest
--    differs from the stored one (passage_line_digests, put_passage_lines_delta):
--    after a few events, a few lines, not every passage's. Nothing a phone
--    reads changes.

alter table public.snapshots add column if not exists unit_counts jsonb;
alter table public.snapshot_units_staged set unlogged;
alter table public.passage_lines add column if not exists digest text;

-- As in 20261020150000_snapshot_units_and_passage_lines.sql, and: the rows' counts are kept on the snapshot.
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
  -- Retention (88): an older snapshot goes, with its pieces, once a newer one has been out 24 hours.
  delete from public.snapshots s
  where s.org_id = p_org_id and s.stream_id = p_stream_id and s.reducer_version = p_reducer_version
    and s.server_seq < p_server_seq
    and exists (
      select 1 from public.snapshots newer
      where newer.org_id = s.org_id and newer.stream_id = s.stream_id and newer.reducer_version = s.reducer_version
        and newer.server_seq > s.server_seq and newer.created_at < now() - interval '24 hours');
end $$;

-- As in 20261020150000, and: the passages' counts come from the snapshot's row.
create or replace function public.get_snapshot_head(
  p_org_id text, p_stream_id text, p_reducer_version int, p_lines_version int, p_with_shared boolean default true
) returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare
  v_actor text := public.caller_id();
  v_seq bigint;
  v_shared jsonb;
  v_units jsonb;
  v_lines jsonb;
  v_lines_seq bigint;
begin
  if v_actor is not null and not public.can_read_stream(p_org_id, p_stream_id, v_actor) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  select u.server_seq, u.json into v_seq, v_shared from public.snapshot_units u
  where u.org_id = p_org_id and u.stream_id = p_stream_id and u.reducer_version = p_reducer_version
    and u.kind = 'shared' and u.id = ''
  order by u.server_seq desc limit 1;
  if v_seq is null then return null; end if;
  -- The counts put_snapshot stored with the snapshot; counted here only for one cut before it did.
  select s.unit_counts into v_units from public.snapshots s
  where s.org_id = p_org_id and s.stream_id = p_stream_id and s.reducer_version = p_reducer_version and s.server_seq = v_seq;
  if v_units is null then
    select coalesce(jsonb_agg(jsonb_build_array(t.unit_id, t.n) order by t.unit_id), '[]'::jsonb) into v_units
    from (select u.unit_id, count(*) as n from public.snapshot_units u
          where u.org_id = p_org_id and u.stream_id = p_stream_id and u.reducer_version = p_reducer_version
            and u.server_seq = v_seq and u.kind <> 'shared'
          group by u.unit_id) t;
  end if;
  select l.server_seq into v_lines_seq from public.passage_lines l
  where l.org_id = p_org_id and l.stream_id = p_stream_id and l.lines_version = p_lines_version and l.unit_id = '';
  if v_lines_seq is not null then
    select jsonb_build_object('seq', v_lines_seq, 'lines', coalesce(jsonb_agg(l.json order by l.unit_id), '[]'::jsonb)) into v_lines
    from public.passage_lines l
    where l.org_id = p_org_id and l.stream_id = p_stream_id and l.lines_version = p_lines_version and l.unit_id <> '';
  end if;
  return jsonb_build_object('server_seq', v_seq, 'shared', case when p_with_shared then v_shared end, 'units', v_units, 'lines', v_lines);
end $$;

-- The counts of the cuts that exist: the newest snapshot of each language has rows.
update public.snapshots s set unit_counts = (
  select coalesce(jsonb_agg(jsonb_build_array(t.unit_id, t.n) order by t.unit_id), '[]'::jsonb)
  from (select u.unit_id, count(*) as n from public.snapshot_units u
        where u.org_id = s.org_id and u.stream_id = s.stream_id and u.reducer_version = s.reducer_version
          and u.server_seq = s.server_seq and u.kind <> 'shared'
        group by u.unit_id) t)
where s.unit_counts is null and exists (
  select 1 from public.snapshot_units u
  where u.org_id = s.org_id and u.stream_id = s.stream_id and u.reducer_version = s.reducer_version
    and u.server_seq = s.server_seq and u.kind = 'shared' and u.id = '');


-- Every passage's line of one LINES_VERSION, as the pass worked them out at
-- p_server_seq. Lines that did not change keep their row and seq; lines of
-- passages with nothing on their record any more, and of other versions, go.
-- Restated from 20261020150000: the lines to drop are found by a join on the
-- incoming ids, and a line that changed loses its digest (put_passage_lines_delta).
create or replace function public.put_passage_lines(
  p_org_id text, p_stream_id text, p_lines_version int, p_server_seq bigint, p_lines jsonb
) returns int language plpgsql security definer set search_path = public as $$
declare v_written int;
begin
  if public.caller_id() is not null then
    raise exception 'lines are written by the service role only' using errcode = '42501';
  end if;
  delete from public.passage_lines l
  where l.org_id = p_org_id and l.stream_id = p_stream_id and l.lines_version <> p_lines_version;
  with incoming as materialized (select x->>'unitId' as unit_id from jsonb_array_elements(p_lines) x)
  delete from public.passage_lines l
  where l.org_id = p_org_id and l.stream_id = p_stream_id and l.lines_version = p_lines_version and l.unit_id <> ''
    and not exists (select 1 from incoming i where i.unit_id = l.unit_id);
  insert into public.passage_lines (org_id, stream_id, lines_version, unit_id, server_seq, json)
  select p_org_id, p_stream_id, p_lines_version, x->>'unitId', p_server_seq, x
  from jsonb_array_elements(p_lines) x
  on conflict (org_id, stream_id, lines_version, unit_id)
    do update set server_seq = excluded.server_seq, json = excluded.json, digest = null
    where passage_lines.json is distinct from excluded.json;
  get diagnostics v_written = row_count;
  insert into public.passage_lines (org_id, stream_id, lines_version, unit_id, server_seq, json)
  values (p_org_id, p_stream_id, p_lines_version, '', p_server_seq, '{}'::jsonb)
  on conflict (org_id, stream_id, lines_version, unit_id) do update set server_seq = greatest(passage_lines.server_seq, excluded.server_seq);
  return v_written;
end $$;

-- The digest each stored line was written with ({unitId: digest}, null for a
-- line written without one), for the pass to send only what differs.
create or replace function public.passage_line_digests(p_org_id text, p_stream_id text, p_lines_version int)
returns jsonb language plpgsql security definer set search_path = public stable as $$
begin
  if public.caller_id() is not null then
    raise exception 'lines are read by the service role only' using errcode = '42501';
  end if;
  return coalesce((select jsonb_object_agg(l.unit_id, l.digest) from public.passage_lines l
    where l.org_id = p_org_id and l.stream_id = p_stream_id and l.lines_version = p_lines_version and l.unit_id <> ''), '{}'::jsonb);
end $$;

-- The lines that differ from what passage_line_digests said (p_lines, with
-- p_digests: {unitId: digest}) and the passages that have none any more
-- (p_removed: [unitId]); the rest keep their rows and seq. The row under unit
-- '' says the lines hold at p_server_seq, as put_passage_lines has it.
create or replace function public.put_passage_lines_delta(
  p_org_id text, p_stream_id text, p_lines_version int, p_server_seq bigint, p_lines jsonb, p_digests jsonb, p_removed jsonb
) returns int language plpgsql security definer set search_path = public as $$
declare v_written int;
begin
  if public.caller_id() is not null then
    raise exception 'lines are written by the service role only' using errcode = '42501';
  end if;
  delete from public.passage_lines l
  where l.org_id = p_org_id and l.stream_id = p_stream_id and l.lines_version <> p_lines_version;
  delete from public.passage_lines l
  where l.org_id = p_org_id and l.stream_id = p_stream_id and l.lines_version = p_lines_version and l.unit_id <> ''
    and l.unit_id in (select jsonb_array_elements_text(p_removed));
  insert into public.passage_lines (org_id, stream_id, lines_version, unit_id, server_seq, json, digest)
  select p_org_id, p_stream_id, p_lines_version, x->>'unitId', p_server_seq, x, p_digests->>(x->>'unitId')
  from jsonb_array_elements(p_lines) x
  on conflict (org_id, stream_id, lines_version, unit_id)
    do update set
      server_seq = case when passage_lines.json is distinct from excluded.json then excluded.server_seq else passage_lines.server_seq end,
      json = excluded.json, digest = excluded.digest
    where passage_lines.json is distinct from excluded.json or passage_lines.digest is distinct from excluded.digest;
  get diagnostics v_written = row_count;
  insert into public.passage_lines (org_id, stream_id, lines_version, unit_id, server_seq, json)
  values (p_org_id, p_stream_id, p_lines_version, '', p_server_seq, '{}'::jsonb)
  on conflict (org_id, stream_id, lines_version, unit_id) do update set server_seq = greatest(passage_lines.server_seq, excluded.server_seq);
  return v_written;
end $$;

revoke all on function public.passage_line_digests(text, text, integer) from public, anon, authenticated;
grant execute on function public.passage_line_digests(text, text, integer) to service_role;
revoke all on function public.put_passage_lines_delta(text, text, integer, bigint, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.put_passage_lines_delta(text, text, integer, bigint, jsonb, jsonb, jsonb) to service_role;
