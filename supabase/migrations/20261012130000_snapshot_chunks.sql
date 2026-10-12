-- A snapshot's pieces are cut once, when it is written (decisions.md 89).
-- get_snapshot_chunk used to serialize the whole snapshot (state::text) to
-- return each 256 KB piece, and get_snapshot_meta did it twice to say how
-- big it was: about 60 to 80 ms of database time per piece for a
-- Bible-sized snapshot, 55 pieces, so seconds per download, on every cold
-- start and for the workers (performance-audit.md item 4). put_snapshot now
-- serializes it once and stores the pieces (at most 256 KB each, decision
-- 18) and the size; reads are one row.
--
-- A snapshot written before this has no pieces; its reads work as before
-- until it ages out (decisions.md 88 keeps it at most a day once replaced).

alter table public.snapshots
  add column if not exists chars int,
  add column if not exists chunks int;

create table if not exists public.snapshot_chunks (
  org_id text not null,
  stream_id text not null,
  reducer_version int not null,
  server_seq bigint not null,
  idx int not null,
  piece text not null,
  primary key (org_id, stream_id, reducer_version, server_seq, idx),
  foreign key (org_id, stream_id, reducer_version, server_seq)
    references public.snapshots (org_id, stream_id, reducer_version, server_seq) on delete cascade
);
-- Closed like every table; only the snapshot RPCs read it.
alter table public.snapshot_chunks enable row level security;

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
  values (p_org_id, p_stream_id, p_reducer_version, p_server_seq, p_state, length(v_text), null)
  on conflict (org_id, stream_id, reducer_version, server_seq)
    do update set state = excluded.state, chars = excluded.chars, chunks = null, created_at = now();
  delete from public.snapshot_chunks c
  where c.org_id = p_org_id and c.stream_id = p_stream_id and c.reducer_version = p_reducer_version
    and c.server_seq = p_server_seq;
  -- Cut by bytes, at most v_size each, never inside a character (a cut
  -- backs up over UTF-8 continuation bytes). Cutting the text at character
  -- offsets walks it from the start for each piece: 1.4 s for 14 MB.
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
  -- Retention (88): an older snapshot goes, with its pieces, once a newer one has been out 24 hours.
  delete from public.snapshots s
  where s.org_id = p_org_id and s.stream_id = p_stream_id and s.reducer_version = p_reducer_version
    and s.server_seq < p_server_seq
    and exists (
      select 1 from public.snapshots newer
      where newer.org_id = s.org_id and newer.stream_id = s.stream_id and newer.reducer_version = s.reducer_version
        and newer.server_seq > s.server_seq and newer.created_at < now() - interval '24 hours');
end $$;

create or replace function public.get_snapshot_meta(p_org_id text, p_stream_id text, p_reducer_version int)
returns table(server_seq bigint, chunks int, bytes int)
language plpgsql security definer set search_path = public stable as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is not null and not public.can_read_stream(p_org_id, p_stream_id, v_actor) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return query
    select s.server_seq,
           coalesce(s.chunks, greatest(1, ceil(length(s.state::text)::numeric / public.snapshot_chunk_chars()))::int),
           coalesce(s.chars, length(s.state::text))
    from public.snapshots s
    where s.org_id = p_org_id and s.stream_id = p_stream_id and s.reducer_version = p_reducer_version
    order by s.server_seq desc limit 1;
end $$;

create or replace function public.get_snapshot_chunk(
  p_org_id text, p_stream_id text, p_reducer_version int, p_server_seq bigint, p_index int
) returns text
language plpgsql security definer set search_path = public stable as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is not null and not public.can_read_stream(p_org_id, p_stream_id, v_actor) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return coalesce(
    (select c.piece from public.snapshot_chunks c
      where c.org_id = p_org_id and c.stream_id = p_stream_id and c.reducer_version = p_reducer_version
        and c.server_seq = p_server_seq and c.idx = p_index),
    -- Written before pieces were stored: cut the piece as it used to be.
    (select substr(s.state::text, p_index * public.snapshot_chunk_chars() + 1, public.snapshot_chunk_chars())
      from public.snapshots s
      where s.org_id = p_org_id and s.stream_id = p_stream_id and s.reducer_version = p_reducer_version
        and s.server_seq = p_server_seq and s.chunks is null)
  );
end $$;
