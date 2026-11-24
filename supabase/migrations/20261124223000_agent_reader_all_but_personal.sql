-- agent_reader reads what claude_reader reads, except personal data
-- (docs/production-reads.md, "The two logins";
-- docs/decisions/2026-11-24-agents-read-everything-but-personal-data.md).
--
-- Caleb (2026-11-24): the agent teams' read-only access is not to be
-- limited in any way, except personal data. Personal data is a person's
-- name, email, phone number, IP address, picture, voice and screenshot.
-- Secrets stay hidden from every login, as for claude_reader.
--
-- What a person typed (help-mode feedback, notes in event payloads, a join
-- request's message, a content report's details) is readable through the
-- views in schema `masked`, with emails, phone numbers and IP addresses
-- taken out. The base columns stay closed to agent_reader.
--
-- Both logins also get pg_read_all_stats (slow statements, locks, waits in
-- pg_stat_statements and pg_stat_activity) where the project lets postgres
-- grant it.

-- ---- every table, as claude_reader --------------------------------------------------------------

grant usage on schema public, diag, ops, v2_import to agent_reader;
grant select on all tables in schema public, diag, ops, v2_import to agent_reader;
alter default privileges for role postgres in schema public, diag, ops, v2_import grant select on tables to agent_reader;

-- Whole tables that are secrets, or only hashes of them.
revoke all on public.sign_in_codes, public.password_resets, public.password_reset_tries,
  public.push_tokens, public.push_receipts, public.api_device_grants, public.api_webhooks,
  public.language_discovery_keys, public.language_discovery_chains,
  v2_import.sign_in_failures
  from agent_reader;

-- Tables with a secret or personal column: every other column.
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
      ('v2_import', 'people_links', array['email']),
      -- personal: names and pictures of people
      ('public', 'profiles', array['display_name', 'avatar_blob']),
      -- what a person typed or recorded: read through `masked`
      ('diag', 'feedback', array['shared_email', 'shared_name', 'body', 'screenshot', 'voice', 'picture']),
      ('public', 'events', array['payload']),
      ('public', 'join_requests', array['message']),
      ('public', 'content_reports', array['details'])
    ) as x(schema_name, table_name, hidden)
  loop
    execute format('revoke select on %I.%I from agent_reader', t.schema_name, t.table_name);
    execute format('grant select (%s) on %I.%I to agent_reader',
      (select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
         from information_schema.columns
        where table_schema = t.schema_name and table_name = t.table_name and column_name <> all (t.hidden)),
      t.schema_name, t.table_name);
  end loop;
end $$;

-- ---- what people typed, with personal data taken out ---------------------------------------------

create schema if not exists masked;
revoke all on schema masked from public;
grant usage on schema masked to agent_reader, claude_reader;

-- Emails, IP addresses and phone numbers (with a leading +, or as 555 123 4567) in free text.
create or replace function masked.personal(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(t,
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', 'g'),
    '\m\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\M', '[ip]', 'g'),
    '\+\d[\d ().-]{6,}\d', '[number]', 'g'),
    '\(?\m\d{3}\)?[ .-]\d{3}[ .-]\d{4}\M', '[number]', 'g')
$$;

-- An event's payload with each top-level string masked, and emails masked
-- anywhere in it (an email only ever sits inside a JSON string, and the
-- stand-in holds no quote, so the JSON stays whole).
create or replace function masked.payload(p jsonb) returns jsonb
language sql immutable parallel safe set search_path = '' as $$
  select case
    when p is null then null
    when jsonb_typeof(p) = 'object' then (
      select regexp_replace(coalesce(jsonb_object_agg(k, case when jsonb_typeof(v) = 'string' then to_jsonb(masked.personal(v #>> '{}')) else v end), '{}'::jsonb)::text,
        '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', 'g')::jsonb
      from jsonb_each(p) e(k, v))
    when jsonb_typeof(p) = 'string' then to_jsonb(masked.personal(p #>> '{}'))
    else p
  end
$$;

create or replace view masked.events as
  select id, org_id, stream_id, server_seq, type, actor_id, device_id, hlc, parent_event_id, received_at,
         masked.payload(payload) as payload
    from public.events;

create or replace view masked.feedback as
  select id, created_at, profile_id, kind, masked.personal(body) as body, install_id, context,
         voice_format, voice_ms, seen_at, done_at,
         screenshot is not null as has_screenshot, voice is not null as has_voice, picture is not null as has_picture
    from diag.feedback;

create or replace view masked.join_requests as
  select id, org_id, profile_id, masked.personal(message) as message, created_at
    from public.join_requests;

create or replace view masked.content_reports as
  select id, org_id, language_id, target_kind, target_id, unit_id, reported_profile, reporter_id, reason,
         masked.personal(details) as details, created_at, resolved_at, resolved_by, resolution
    from public.content_reports;

grant select on all tables in schema masked to agent_reader, claude_reader;
grant execute on function masked.personal(text), masked.payload(jsonb) to agent_reader, claude_reader;

-- ---- statistics: slow statements, locks and waits ------------------------------------------------

grant usage on schema extensions to agent_reader, claude_reader;
do $$
begin
  grant pg_read_all_stats to agent_reader, claude_reader;
exception when insufficient_privilege or invalid_grant_operation then
  raise notice 'pg_read_all_stats is not granted here (%): pg_stat_statements shows each login only its own statements', sqlerrm;
end $$;
