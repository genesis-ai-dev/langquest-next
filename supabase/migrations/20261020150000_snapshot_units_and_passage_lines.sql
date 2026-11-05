-- The server cuts a language's snapshot by passage, and keeps every
-- passage's line (decisions.md 147, option F of docs/big-languages-plan.md).
--
-- A phone used to download a big language's whole snapshot (Koro Miyan:
-- 40 MB) and cut it into per-passage rows itself (decision 143). Now the
-- projection pass, which folds every changed language whole on the job host
-- (decision 141), cuts the fold with the phone's own code (core
-- partEntries, sync entryRows) and stores the rows here; a phone downloads
-- what the whole language shares and every passage's line (Koro: about half
-- a megabyte), opens the Map on them, and fills the passages' rows in
-- behind, its person's own first.
--
-- snapshot_units: the rows of the newest snapshot of each language and
-- reducer, with the shared part as one row (kind 'shared', unit ''). Only
-- the newest snapshot keeps them: a phone fills from the newest snapshot at
-- or past the one it started from, never an older one, so older snapshots'
-- rows would never be read. Rows go with their snapshot (88's retention).
-- The pass sends them in batches to snapshot_units_staged, and put_snapshot
-- moves them in, in the same transaction as the snapshot.
--
-- passage_lines: every passage's line, of the pass's LINES_VERSION, written
-- each time the pass folds the language (only lines that changed are
-- rewritten). The row under unit '' says which seq the lines hold at: a
-- phone shows the server's line only for a passage nothing it pulled past
-- that seq has touched.
--
-- snapshots.state is no longer written (performance-audit-app.md V7): its
-- pieces (89) serve builds from before, and the rows serve the rest. Every
-- reader of it reads the pieces or the size instead.

alter table public.snapshots alter column state drop not null;

create table if not exists public.snapshot_units (
  org_id text not null,
  stream_id text not null,
  reducer_version int not null,
  server_seq bigint not null,
  -- Compared byte by byte, as the phone pages and compares them.
  kind text collate "C" not null,
  id text collate "C" not null,
  unit_id text collate "C" not null,
  ref text not null default '',
  json jsonb not null,
  primary key (org_id, stream_id, reducer_version, server_seq, kind, id),
  foreign key (org_id, stream_id, reducer_version, server_seq)
    references public.snapshots (org_id, stream_id, reducer_version, server_seq) on delete cascade
);
-- A phone asks for a few passages' rows a page at a time, in this order.
create index if not exists snapshot_units_by_unit
  on public.snapshot_units (org_id, stream_id, reducer_version, server_seq, unit_id, kind, id);
alter table public.snapshot_units enable row level security;
revoke all on public.snapshot_units from public, anon, authenticated;
grant all on public.snapshot_units to service_role;

create table if not exists public.snapshot_units_staged (
  org_id text not null,
  stream_id text not null,
  reducer_version int not null,
  server_seq bigint not null,
  kind text collate "C" not null,
  id text collate "C" not null,
  unit_id text collate "C" not null,
  ref text not null default '',
  json jsonb not null,
  primary key (org_id, stream_id, reducer_version, server_seq, kind, id)
);
alter table public.snapshot_units_staged enable row level security;
revoke all on public.snapshot_units_staged from public, anon, authenticated;
grant all on public.snapshot_units_staged to service_role;

create table if not exists public.passage_lines (
  org_id text not null,
  stream_id text not null,
  lines_version int not null,
  unit_id text collate "C" not null,
  -- The stream's seq when this line was last written; the '' row's is the seq every line holds at.
  server_seq bigint not null,
  json jsonb not null,
  primary key (org_id, stream_id, lines_version, unit_id)
);
alter table public.passage_lines enable row level security;
revoke all on public.passage_lines from public, anon, authenticated;
grant all on public.passage_lines to service_role;

-- A batch of a snapshot's rows, before put_snapshot moves them in. Rows
-- staged for another seq of the stream are left from a pass that died; they go.
create or replace function public.stage_snapshot_units(
  p_org_id text, p_stream_id text, p_reducer_version int, p_server_seq bigint, p_rows jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  if public.caller_id() is not null then
    raise exception 'snapshots are written by the service role only' using errcode = '42501';
  end if;
  delete from public.snapshot_units_staged s
  where s.org_id = p_org_id and s.stream_id = p_stream_id
    and (s.reducer_version <> p_reducer_version or s.server_seq <> p_server_seq);
  insert into public.snapshot_units_staged (org_id, stream_id, reducer_version, server_seq, kind, id, unit_id, ref, json)
  select p_org_id, p_stream_id, p_reducer_version, p_server_seq, r->>0, r->>1, r->>2, coalesce(r->>3, ''), r->4
  from jsonb_array_elements(p_rows) r
  on conflict (org_id, stream_id, reducer_version, server_seq, kind, id)
    do update set unit_id = excluded.unit_id, ref = excluded.ref, json = excluded.json;
end $$;

-- As in 20261012130000_snapshot_chunks.sql, and: state is not kept; the
-- staged rows of this snapshot move in; the rows of older snapshots go.
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

-- The whole snapshot, put together from its pieces now that state is not kept.
create or replace function public.get_snapshot(p_org_id text, p_stream_id text, p_reducer_version int)
returns table(server_seq bigint, state jsonb, created_at timestamptz)
language plpgsql security definer set search_path = public stable as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is not null and not public.can_read_stream(p_org_id, p_stream_id, v_actor) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return query
    select s.server_seq,
           coalesce(s.state, (select string_agg(c.piece, '' order by c.idx) from public.snapshot_chunks c
                              where c.org_id = s.org_id and c.stream_id = s.stream_id
                                and c.reducer_version = s.reducer_version and c.server_seq = s.server_seq)::jsonb),
           s.created_at
    from public.snapshots s
    where s.org_id = p_org_id and s.stream_id = p_stream_id and s.reducer_version = p_reducer_version
    order by s.server_seq desc limit 1;
end $$;

-- Every passage's line of one LINES_VERSION, as the pass worked them out at
-- p_server_seq. Lines that did not change keep their row and seq; lines of
-- passages with nothing on their record any more, and of other versions, go.
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
  delete from public.passage_lines l
  where l.org_id = p_org_id and l.stream_id = p_stream_id and l.lines_version = p_lines_version and l.unit_id <> ''
    and not exists (select 1 from jsonb_array_elements(p_lines) x where x->>'unitId' = l.unit_id);
  insert into public.passage_lines (org_id, stream_id, lines_version, unit_id, server_seq, json)
  select p_org_id, p_stream_id, p_lines_version, x->>'unitId', p_server_seq, x
  from jsonb_array_elements(p_lines) x
  on conflict (org_id, stream_id, lines_version, unit_id)
    do update set server_seq = excluded.server_seq, json = excluded.json
    where passage_lines.json is distinct from excluded.json;
  get diagnostics v_written = row_count;
  insert into public.passage_lines (org_id, stream_id, lines_version, unit_id, server_seq, json)
  values (p_org_id, p_stream_id, p_lines_version, '', p_server_seq, '{}'::jsonb)
  on conflict (org_id, stream_id, lines_version, unit_id) do update set server_seq = greatest(passage_lines.server_seq, excluded.server_seq);
  return v_written;
end $$;

-- The newest snapshot with a cut: its seq, what the whole language shares
-- (unless p_with_shared is false), each passage with rows and how many,
-- and every line of p_lines_version with the seq they hold at (null when
-- the pass has written none of that version). Null when no snapshot has a cut.
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
  select coalesce(jsonb_agg(jsonb_build_array(t.unit_id, t.n) order by t.unit_id), '[]'::jsonb) into v_units
  from (select u.unit_id, count(*) as n from public.snapshot_units u
        where u.org_id = p_org_id and u.stream_id = p_stream_id and u.reducer_version = p_reducer_version
          and u.server_seq = v_seq and u.kind <> 'shared'
        group by u.unit_id) t;
  select l.server_seq into v_lines_seq from public.passage_lines l
  where l.org_id = p_org_id and l.stream_id = p_stream_id and l.lines_version = p_lines_version and l.unit_id = '';
  if v_lines_seq is not null then
    select jsonb_build_object('seq', v_lines_seq, 'lines', coalesce(jsonb_agg(l.json order by l.unit_id), '[]'::jsonb)) into v_lines
    from public.passage_lines l
    where l.org_id = p_org_id and l.stream_id = p_stream_id and l.lines_version = p_lines_version and l.unit_id <> '';
  end if;
  return jsonb_build_object('server_seq', v_seq, 'shared', case when p_with_shared then v_shared end, 'units', v_units, 'lines', v_lines);
end $$;

-- Some passages' rows from the newest snapshot with a cut at or past
-- p_min_seq, in (unit, kind, id) order after p_after, at most p_limit (up
-- to 5,000): {server_seq, rows: [[kind, id, unit, ref, json]], next}. Null
-- when there is no such snapshot.
create or replace function public.get_snapshot_rows(
  p_org_id text, p_stream_id text, p_reducer_version int, p_min_seq bigint, p_unit_ids text[], p_after text[], p_limit int
) returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare
  v_actor text := public.caller_id();
  v_seq bigint;
  v_limit int := least(greatest(coalesce(p_limit, 1000), 1), 5000);
  v_rows jsonb;
  v_n int;
  v_next jsonb;
begin
  if v_actor is not null and not public.can_read_stream(p_org_id, p_stream_id, v_actor) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  select u.server_seq into v_seq from public.snapshot_units u
  where u.org_id = p_org_id and u.stream_id = p_stream_id and u.reducer_version = p_reducer_version
    and u.kind = 'shared' and u.id = '' and u.server_seq >= coalesce(p_min_seq, 0)
  order by u.server_seq desc limit 1;
  if v_seq is null then return null; end if;
  with page as (
    select u.unit_id, u.kind, u.id, u.ref, u.json from public.snapshot_units u
    where u.org_id = p_org_id and u.stream_id = p_stream_id and u.reducer_version = p_reducer_version
      and u.server_seq = v_seq and u.kind <> 'shared' and u.unit_id = any(p_unit_ids)
      and (p_after is null or (u.unit_id, u.kind, u.id) > (p_after[1] collate "C", p_after[2] collate "C", p_after[3] collate "C"))
    order by u.unit_id, u.kind, u.id
    limit v_limit + 1
  ), numbered as (
    select p.*, row_number() over (order by p.unit_id, p.kind, p.id) as n from page p
  )
  select coalesce(jsonb_agg(jsonb_build_array(kind, id, unit_id, ref, json) order by n) filter (where n <= v_limit), '[]'::jsonb),
         count(*),
         (array_agg(jsonb_build_array(unit_id, kind, id) order by n) filter (where n = v_limit))[1]
    into v_rows, v_n, v_next
  from numbered;
  return jsonb_build_object('server_seq', v_seq, 'rows', v_rows, 'next', case when v_n > v_limit then v_next end);
end $$;

-- Which passage each of these entries (pairs [kind, id], up to 1,000) is
-- in, by the newest snapshot with a cut: [[kind, id, unit]], absent when it
-- has none. A phone asks for an event that hangs on a take, review,
-- departure, request or note it does not hold.
create or replace function public.get_snapshot_passages(
  p_org_id text, p_stream_id text, p_reducer_version int, p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare
  v_actor text := public.caller_id();
  v_seq bigint;
begin
  if v_actor is not null and not public.can_read_stream(p_org_id, p_stream_id, v_actor) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  select u.server_seq into v_seq from public.snapshot_units u
  where u.org_id = p_org_id and u.stream_id = p_stream_id and u.reducer_version = p_reducer_version
    and u.kind = 'shared' and u.id = ''
  order by u.server_seq desc limit 1;
  if v_seq is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_array(u.kind, u.id, u.unit_id))
    from (select x->>0 as kind, x->>1 as id from jsonb_array_elements(p_items) x limit 1000) i
    join public.snapshot_units u
      on u.org_id = p_org_id and u.stream_id = p_stream_id and u.reducer_version = p_reducer_version
     and u.server_seq = v_seq and u.kind = i.kind collate "C" and u.id = i.id collate "C"
  ), '[]'::jsonb);
end $$;

-- Signed-in people read (each function checks the caller); only the service role writes.
revoke all on function public.get_snapshot_head(text, text, integer, integer, boolean) from public, anon;
grant execute on function public.get_snapshot_head(text, text, integer, integer, boolean) to authenticated, service_role;
revoke all on function public.get_snapshot_rows(text, text, integer, bigint, text[], text[], integer) from public, anon;
grant execute on function public.get_snapshot_rows(text, text, integer, bigint, text[], text[], integer) to authenticated, service_role;
revoke all on function public.get_snapshot_passages(text, text, integer, jsonb) from public, anon;
grant execute on function public.get_snapshot_passages(text, text, integer, jsonb) to authenticated, service_role;
revoke all on function public.stage_snapshot_units(text, text, integer, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.stage_snapshot_units(text, text, integer, bigint, jsonb) to service_role;
revoke all on function public.put_passage_lines(text, text, integer, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.put_passage_lines(text, text, integer, bigint, jsonb) to service_role;
revoke all on function public.put_snapshot(text, text, integer, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.put_snapshot(text, text, integer, bigint, jsonb) to service_role;
revoke all on function public.get_snapshot(text, text, integer) from public, anon;
grant execute on function public.get_snapshot(text, text, integer) to authenticated, service_role;

-- A language stream as a cold phone meets it, restated from
-- 20261016010000_diag_jobs.sql: a snapshot's size from its row, since state
-- is no longer kept, and the server's cut and lines beside it.
create or replace function diag.language_health(p_org text, p_language text, p_reducer_version int)
returns jsonb
language sql stable security definer set search_path = public, pg_catalog as $$
  with ev as (
    select count(*) as events, coalesce(max(server_seq), 0) as "maxSeq",
           count(*) filter (where received_at > now() - interval '7 days') as "events7d",
           max(received_at) as "lastEventAt"
    from public.events where org_id = p_org and stream_id = p_language
  ),
  snap as (
    select reducer_version, max(server_seq) as seq, max(created_at) as created_at
    from public.snapshots where org_id = p_org and stream_id = p_language
    group by reducer_version
  ),
  blobs as (
    select count(*) as count, coalesce(sum((payload->>'size')::bigint), 0) as bytes,
           coalesce(max((payload->>'size')::bigint), 0) as "maxBytes"
    from public.events where org_id = p_org and stream_id = p_language and type = 'v1.BlobStored'
  ),
  roles as (
    select coalesce(role_id, 'none') || ' (' || scope_level || ' scope)' as role, count(*) as n from public.org_memberships
    where org_id = p_org and not removed and (scope_level = 'org' or language_id = p_language)
    group by 1
  ),
  marks as (
    select stream_id, seq, projected_at from public.projection_marks
    where org_id = p_org and stream_id in (p_language, '_org')
  )
  select jsonb_build_object(
    'events', (select to_jsonb(ev) from ev),
    'reducerVersion', p_reducer_version,
    'snapshots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reducerVersion', s.reducer_version, 'seq', s.seq, 'createdAt', s.created_at,
        'tail', (select "maxSeq" from ev) - s.seq,
        'bytes', case when s.reducer_version = p_reducer_version then (
          select x.chars from public.snapshots x
          where x.org_id = p_org and x.stream_id = p_language and x.reducer_version = s.reducer_version and x.server_seq = s.seq
        ) end,
        -- The server's cut of it (decisions.md 147): how many rows, so a first download fills in.
        'units', (select count(*) from public.snapshot_units u
          where u.org_id = p_org and u.stream_id = p_language and u.reducer_version = s.reducer_version and u.server_seq = s.seq)
      ) order by s.reducer_version desc) from snap s), '[]'::jsonb),
    'blobs', (select to_jsonb(blobs) from blobs),
    -- Every passage's line the pass wrote, by LINES_VERSION, and the seq they hold at.
    'lines', coalesce((select jsonb_object_agg(l.lines_version::text, jsonb_build_object('seq', l.server_seq,
        'passages', (select count(*) from public.passage_lines p where p.org_id = p_org and p.stream_id = p_language
                       and p.lines_version = l.lines_version and p.unit_id <> '')))
      from public.passage_lines l where l.org_id = p_org and l.stream_id = p_language and l.unit_id = ''), '{}'::jsonb),
    'roles', coalesce((select jsonb_object_agg(role, n) from roles), '{}'::jsonb),
    'projectedAt', (select projected_at from marks where stream_id = p_language),
    'projectedSeq', (select seq from marks where stream_id = p_language),
    'orgProjectedAt', (select projected_at from marks where stream_id = '_org')
  )
$$;
