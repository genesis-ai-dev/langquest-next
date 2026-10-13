-- Webhooks for apps with an access token (docs/agent-api.md, decisions.md 95).
--
-- A webhook belongs to one token: it is made, listed and deleted with that
-- token, and stops when the token is revoked. Only the app's Worker reads
-- and writes it (service role), like api_tokens: row-level security is on
-- with no policies. The secret is kept as it is, unlike a token's: every
-- delivery is signed with it. A leaked secret lets someone send a fake
-- nudge, which carries no data; the app still reads through its token.
--
-- What was sent, and what is still to send, lives in the organization's
-- Durable Object (apps/web/worker/agent/dispatch.ts), not here.

create table public.api_webhooks (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  token_id uuid not null references public.api_tokens (id) on delete cascade,
  url text not null check (url ~ '^https://' and length(url) <= 2000),
  events text[] not null check (cardinality(events) > 0),
  -- Null: every language the token reaches.
  language_ids text[],
  secret text not null,
  created_at timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_reason text
);

create index api_webhooks_token on public.api_webhooks (token_id, created_at desc);
-- The poke below asks this on every push: is anyone listening to this organization?
create index api_webhooks_live on public.api_webhooks (org_id) where disabled_at is null;

alter table public.api_webhooks enable row level security;
revoke all on public.api_webhooks from public, anon, authenticated;
grant select, insert, update, delete on public.api_webhooks to service_role;

-- events_notify (20261012150000_one_poke_per_push.sql) already runs once
-- per stream per push, after commit. It now also pokes the Worker when the
-- organization has a running webhook, so the Durable Object looks within
-- seconds. pg_net only queues the request: the append never waits for it,
-- and a lost poke is caught by the Worker's cron. The two Vault secrets are
-- set by npm run secrets; without them nothing is sent.

create extension if not exists pg_net with schema extensions;

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
      false
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
