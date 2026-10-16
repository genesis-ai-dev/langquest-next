-- A stream's pokes go to its readers only (decisions.md 117).
--
-- events_notify broadcast on a public Realtime channel, so anyone with the
-- publishable key who knew an `events:<org>/<stream>` name could watch when
-- and how much a stream moved (never what). Now the poke is private, and a
-- policy on realtime.messages lets a signed-in person hear a stream's
-- channel only when they may read the stream (can_read_stream, through
-- may_hear_stream), as pull_events asks. The phone joins with `private: true`
-- (packages/sync/src/supabaseTransport.ts). An older app's public channel
-- hears nothing now and falls back to its poll.
--
-- events_notify is restated whole, as `create or replace`, from
-- 20261013120000_api_webhooks.sql's, with the channel made private.

-- Whether the caller may hear a stream's channel: only ever about the
-- caller, so it says nothing of anyone else.
create or replace function public.may_hear_stream(p_topic text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_topic like 'events:%/%' and public.caller_id() is not null and public.can_read_stream(
    split_part(substr(p_topic, 8), '/', 1),
    substr(substr(p_topic, 8), length(split_part(substr(p_topic, 8), '/', 1)) + 2),
    public.caller_id());
$$;
revoke all on function public.may_hear_stream(text) from public, anon;
grant execute on function public.may_hear_stream(text) to authenticated;

create policy "readers hear their streams' pokes" on realtime.messages
  for select to authenticated
  using (realtime.messages.extension = 'broadcast' and public.may_hear_stream(realtime.topic()));

create or replace function public.events_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_sent text := 'langquest.poked_' || md5(new.org_id || '/' || new.stream_id);
  v_seq bigint;
  v_url text;
  v_secret text;
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
      true
    );
  exception when others then
    -- The trigger must never fail an append: a realtime hiccup is not a
    -- reason to lose a translator's recording.
    null;
  end;
  begin
    if exists (select 1 from public.api_webhooks w where w.org_id = new.org_id and w.disabled_at is null) then
      select decrypted_secret into v_url from vault.decrypted_secrets where name = 'langquest_dashboard_url';
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'langquest_webhook_poke_secret';
      if v_url is not null and v_secret is not null then
        perform net.http_post(
          url := v_url || '/api/internal/poke',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-poke-secret', v_secret),
          body := jsonb_build_object('orgId', new.org_id),
          timeout_milliseconds := 5000
        );
      end if;
    end if;
  exception when others then
    -- Nor may a webhook: the cron catches up what a lost poke missed.
    null;
  end;
  return null;
end $$;
