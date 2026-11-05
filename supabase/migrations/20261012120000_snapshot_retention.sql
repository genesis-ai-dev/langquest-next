-- A snapshot stays downloadable for 24 hours after the next one is written
-- (decisions.md 88). put_snapshot used to delete every older snapshot as
-- soon as a new one landed, so a phone part-way through downloading one
-- found its pieces gone (get_snapshot_chunk answers null), threw the
-- download away and pulled the whole log instead; on a slow link it could
-- happen again on every try (performance-audit.md item 5). Now an older
-- snapshot goes once a newer one has been out for 24 hours. With the
-- worker writing at most one an hour, a busy language keeps up to about 25.

create or replace function public.put_snapshot(
  p_org_id text, p_stream_id text, p_reducer_version int, p_server_seq bigint, p_state jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  if public.caller_id() is not null then
    raise exception 'snapshots are written by the service role only' using errcode = '42501';
  end if;
  insert into public.snapshots (org_id, stream_id, reducer_version, server_seq, state)
  values (p_org_id, p_stream_id, p_reducer_version, p_server_seq, p_state)
  on conflict (org_id, stream_id, reducer_version, server_seq) do update set state = excluded.state, created_at = now();
  delete from public.snapshots s
  where s.org_id = p_org_id and s.stream_id = p_stream_id and s.reducer_version = p_reducer_version
    and s.server_seq < p_server_seq
    and exists (
      select 1 from public.snapshots newer
      where newer.org_id = s.org_id and newer.stream_id = s.stream_id and newer.reducer_version = s.reducer_version
        and newer.server_seq > s.server_seq and newer.created_at < now() - interval '24 hours');
end $$;
