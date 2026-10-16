-- The same server event appended twice at once is appended once (decisions.md
-- 75, amended 2026-10-15).
--
-- _append_event_as is how the server writes its own events: a blob verdict,
-- an invite redeemed, a join decided, a redaction, an account deleted, a
-- library pin. Their ids are fixed by what they record, so two Worker or
-- projection passes over the same thing append the same id. It checked the
-- id before _next_seq locked the stream's cursor, so the second call passed
-- that check while the first was still in flight, waited on the lock, and
-- then failed on the events primary key, aborting its caller's whole
-- transaction instead of returning null as it says it does.
--
-- Now it takes the stream's lock (_next_seq took it anyway) and checks the
-- id again under it, as append_events does since
-- 20261015180000_append_duplicate_under_lock.sql. The first check stays, so
-- an id already stored returns without touching the stream's cursor.
--
-- Restated whole, as `create or replace`, from 20261006000000_baseline.sql;
-- its grants are kept. SQL test: server/concurrentAppendSmoke.sql.

-- A server-issued event (an invite redeemed, a join decided, a person's own
-- choice, a redaction by a moderator), stamped with the server's clock and
-- folded like any organization-stream event. Idempotent by id: returns the
-- clock, or null when the id was already used, even by a call still in
-- flight when this one began.
create or replace function public._append_event_as(
  p_id text, p_org text, p_stream text, p_type text, p_actor text, p_device text, p_payload jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare v_seq bigint; v_hlc text;
begin
  if exists (select 1 from public.events e where e.id = p_id) then return null; end if;
  -- Under the stream's lock, the same id appended at once has committed.
  perform public._lock_stream(p_org, p_stream);
  if exists (select 1 from public.events e where e.id = p_id) then return null; end if;
  v_seq := public._next_seq(p_org, p_stream);
  v_hlc := lpad((extract(epoch from clock_timestamp()) * 1000)::bigint::text, 15, '0')
           || ':' || lpad((v_seq % 1000000)::text, 6, '0') || ':' || p_device;
  insert into public.events (id, org_id, stream_id, server_seq, type, actor_id, device_id, hlc, payload)
  values (p_id, p_org, p_stream, v_seq, p_type, p_actor, p_device, v_hlc, p_payload);
  if p_stream = '_org' then
    perform public._apply_org_event(p_org, p_id, p_type, p_payload, v_hlc, p_actor);
  end if;
  return v_hlc;
end $$;
