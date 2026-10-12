-- One realtime poke per stream per push, and one index fewer on every
-- event (performance-audit.md item 8).
--
-- events_notify broadcast for every inserted row, so a 200-event push sent
-- 200 pokes to every phone listening on that language: a village of 66
-- phones reconnecting with 9,000 events was about 594,000 messages. A poke
-- carries nothing but a seq (the phone pulls through the authorized RPC),
-- so one per stream per transaction, with the highest seq, says the same.
-- The trigger now waits for commit (a deferred constraint trigger); the
-- first row of each stream sends, the rest see it was sent this
-- transaction and skip. Every append_events call is its own transaction.
--
-- events_pull_idx repeated the btree that unique (org_id, stream_id,
-- server_seq) already builds, so every insert wrote both.

create or replace function public.events_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_sent text := 'langquest.poked_' || md5(new.org_id || '/' || new.stream_id);
  v_seq bigint;
begin
  if current_setting(v_sent, true) = 'yes' then return null; end if;
  perform set_config(v_sent, 'yes', true);
  begin
    select max(e.server_seq) into v_seq from public.events e
    where e.org_id = new.org_id and e.stream_id = new.stream_id;
    perform realtime.send(
      jsonb_build_object('server_seq', v_seq),
      'appended',
      'events:' || new.org_id || '/' || new.stream_id,
      false
    );
  exception when others then
    -- The trigger must never fail an append: a realtime hiccup is not a
    -- reason to lose a translator's recording.
    null;
  end;
  return null;
end $$;

drop trigger if exists events_notify on public.events;
create constraint trigger events_notify after insert on public.events
  deferrable initially deferred
  for each row execute function public.events_notify();

drop index if exists public.events_pull_idx;
