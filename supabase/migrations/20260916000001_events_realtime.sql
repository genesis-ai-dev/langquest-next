-- Realtime pokes. After every insert into the event log, broadcast an empty
-- "appended" message on the partition's channel so devices pull now instead
-- of on their next poll. The channel is public and the payload is only the
-- new server_seq: it says that the partition moved, never what moved. The
-- events themselves still arrive through pull_events and its checks.
--
-- The trigger must never fail an append: a realtime hiccup is not a reason
-- to lose a translator's recording.
create or replace function public.events_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('server_seq', new.server_seq),
      'appended',
      'events:' || new.org_id || '/' || new.partition_id,
      false
    );
  exception when others then
    null;
  end;
  return new;
end $$;

drop trigger if exists events_notify on public.events;
create trigger events_notify after insert on public.events
  for each row execute function public.events_notify();
