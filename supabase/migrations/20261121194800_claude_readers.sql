-- Two read-only logins for Claude on the production database
-- (docs/production-reads.md,
-- docs/decisions/2026-11-21-claude-reads-production-through-a-gate.md).
--
-- claude_reader: Claude's cloud threads and a developer's laptop. It reads
--   the app's tables, diag, ops and the v2 import, but no secret: no
--   sign-in code, token, key, password reset, push token or webhook secret,
--   and no email. auth, storage and vault are not granted at all.
-- agent_reader: the agent teams in GitHub Actions, whose logs are public and
--   who read what strangers write. diag's tables of ids, counts, times and
--   codes (decision 39), and the event log without its payload.
--
-- The database is what holds them to reading: neither has a grant to write
-- anything, and neither owns anything. Each transaction is read-only by
-- default and each statement stops after 15 s; the read gate
-- (apps/admin/src/read.ts) also opens every transaction read-only, so a
-- function that writes fails there too. NOLOGIN here: a password is not
-- something a migration may hold. scripts/claude-read-access.sh gives each a
-- login on the hosted project. server/claudeReadersSmoke.sql holds all this.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'claude_reader') then
    create role claude_reader nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'agent_reader') then
    create role agent_reader nologin;
  end if;
end $$;

-- BYPASSRLS: row level security is written for app users (auth.uid()), and
-- these logins are no app user; without it every table reads empty. It lets
-- them see rows, never write one: the grants below are SELECT only.
alter role claude_reader nologin noinherit nocreatedb nocreaterole bypassrls connection limit 3;
alter role agent_reader nologin noinherit nocreatedb nocreaterole bypassrls connection limit 3;
alter role claude_reader set default_transaction_read_only = on;
alter role agent_reader set default_transaction_read_only = on;
alter role claude_reader set statement_timeout = '15s';
alter role agent_reader set statement_timeout = '15s';
alter role claude_reader set idle_in_transaction_session_timeout = '30s';
alter role agent_reader set idle_in_transaction_session_timeout = '30s';

-- ---- claude_reader: everything but secrets ----------------------------------------------------

grant usage on schema public, diag, ops, v2_import to claude_reader;
grant select on all tables in schema public, diag, ops, v2_import to claude_reader;
-- A table made later is readable too; a later table that holds a secret
-- revokes it in its own migration (the smoke test names the columns it
-- looks for).
alter default privileges for role postgres in schema public, diag, ops, v2_import grant select on tables to claude_reader;

-- Whole tables that are secrets, or only hashes of them, or emails and addresses.
revoke all on public.sign_in_codes, public.password_resets, public.password_reset_tries,
  public.push_tokens, public.push_receipts, public.api_device_grants, public.api_webhooks,
  public.language_discovery_keys, public.language_discovery_chains,
  v2_import.sign_in_failures
  from claude_reader;

-- Tables with one secret or email column: every other column.
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('public', 'api_tokens', array['token_hash']),
      ('public', 'invites', array['token_hash', 'email']),
      ('public', 'review_links', array['code_hash']),
      ('public', 'org_verification_requests', array['code_hash', 'email']),
      ('diag', 'feedback', array['shared_email']),
      ('v2_import', 'people_links', array['email'])
    ) as x(schema_name, table_name, hidden)
  loop
    execute format('revoke select on %I.%I from claude_reader', t.schema_name, t.table_name);
    execute format('grant select (%s) on %I.%I to claude_reader',
      (select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
         from information_schema.columns
        where table_schema = t.schema_name and table_name = t.table_name and column_name <> all (t.hidden)),
      t.schema_name, t.table_name);
  end loop;
end $$;

-- The report functions diag_reader may call, for the same answers npm run diag gives.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'diag' and has_function_privilege('diag_reader', p.oid, 'execute')
  loop
    execute format('grant execute on function %s to claude_reader', f.fn);
  end loop;
end $$;

-- ---- agent_reader: ids, counts, times and codes ----------------------------------------------

-- What phones and the server's jobs report (decision 39: ids, counts, timings
-- and codes), the totals behind the ops dashboard, and who did what, when, in
-- which stream. Not diag.feedback, which is what people typed and sent, and
-- no report function: some name people or take an email.
grant usage on schema diag, public to agent_reader;
grant select on diag.records, diag.installs, diag.install_updates, diag.install_device,
  diag.job_runs, diag.job_schedule, diag.daily, diag.hourly, diag.monthly, diag.ops_cache
  to agent_reader;
grant select (id, org_id, stream_id, server_seq, type, actor_id, device_id, hlc, parent_event_id, received_at)
  on public.events to agent_reader;
