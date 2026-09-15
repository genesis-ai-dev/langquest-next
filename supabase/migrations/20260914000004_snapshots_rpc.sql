-- Gate 4: snapshots end to end. The worker (server/snapshotWorker.ts) folds
-- each partition with the shared reducer and stores the result here; clients
-- cold-start from it and pull only the tail (PLAN.md invariant 10).

-- Members read the newest snapshot for exactly their reducer version.
create or replace function public.get_snapshot(
  p_org_id text, p_project_id text, p_reducer_version int
) returns table (server_seq bigint, state jsonb, created_at timestamptz)
language plpgsql security definer set search_path = public stable as $$
declare
  v_actor text := public.caller_id();
begin
  if v_actor is not null and public.member_role(p_org_id, p_project_id, v_actor) is null then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return query
    select s.server_seq, s.state, s.created_at from public.snapshots s
    where s.org_id = p_org_id and s.project_id = p_project_id and s.reducer_version = p_reducer_version
    order by s.server_seq desc limit 1;
end $$;

-- Only the service role writes snapshots. Older snapshots for the same
-- version are dropped so the table holds one row per (partition, version).
create or replace function public.put_snapshot(
  p_org_id text, p_project_id text, p_reducer_version int, p_server_seq bigint, p_state jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  if public.caller_id() is not null then
    raise exception 'snapshots are written by the service role only' using errcode = '42501';
  end if;
  insert into public.snapshots (org_id, project_id, reducer_version, server_seq, state)
  values (p_org_id, p_project_id, p_reducer_version, p_server_seq, p_state)
  on conflict (org_id, project_id, reducer_version, server_seq) do update set state = excluded.state, created_at = now();
  delete from public.snapshots s
  where s.org_id = p_org_id and s.project_id = p_project_id and s.reducer_version = p_reducer_version
    and s.server_seq < p_server_seq;
end $$;

-- What the worker iterates. Service role only (no JWT sub).
create or replace function public.list_partitions()
returns table (org_id text, project_id text, next_seq bigint)
language plpgsql security definer set search_path = public stable as $$
begin
  if public.caller_id() is not null then
    raise exception 'service role only' using errcode = '42501';
  end if;
  return query select c.org_id, c.project_id, c.next_seq from public.partition_cursors c;
end $$;

grant execute on function public.get_snapshot(text, text, int) to authenticated;
grant execute on function public.put_snapshot(text, text, int, bigint, jsonb) to service_role;
grant execute on function public.list_partitions() to service_role;
