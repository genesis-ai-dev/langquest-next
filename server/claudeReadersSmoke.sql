-- Claude's two read-only logins (migration 20261121194800_claude_readers.sql,
-- docs/production-reads.md). Run by `npm run db:test` as supabase_admin,
-- which may give each a password for the run and log in as it, so the
-- role's own settings apply as they do on the hosted project. Each login is
-- locked again at the end.

\set ON_ERROR_STOP on

-- ---- what both logins are -------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in select rolname, rolconfig, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls from pg_roles where rolname in ('claude_reader', 'agent_reader') loop
    if r.rolsuper or r.rolcreaterole or r.rolcreatedb then raise exception '% may do more than read', r.rolname; end if;
    if not r.rolbypassrls then raise exception '% would read every table empty', r.rolname; end if;
    if not ('default_transaction_read_only=on' = any (r.rolconfig)) then raise exception '% is not read-only by default', r.rolname; end if;
    if not ('statement_timeout=15s' = any (r.rolconfig)) then raise exception '% has no 15 s limit', r.rolname; end if;
  end loop;
  if (select count(*) from pg_roles where rolname in ('claude_reader', 'agent_reader')) <> 2 then raise exception 'a login is missing'; end if;
end $$;

-- Neither may write, truncate or own anything, in any schema it can reach.
do $$
declare
  bad text;
begin
  select string_agg(format('%s %s', r.rolname, c.oid::regclass), ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('claude_reader'), ('agent_reader')) r(rolname)
   where c.relkind in ('r', 'v', 'm', 'p')
     and n.nspname not in ('pg_catalog', 'information_schema', 'net')
     and has_schema_privilege(r.rolname, n.nspname, 'usage')
     and (has_table_privilege(r.rolname, c.oid, 'insert, update, delete, truncate') or pg_get_userbyid(c.relowner) = r.rolname);
  if bad is not null then raise exception 'may write: %', bad; end if;
end $$;

-- No column that holds a secret or an email is readable by claude_reader.
-- A new table with one revokes it in its own migration; a column that only
-- looks like one (a content hash, a key in a list of numbers) goes here.
do $$
declare
  bad text;
begin
  select string_agg(format('%I.%I.%I', c.table_schema, c.table_name, c.column_name), ', ') into bad
    from information_schema.columns c
   where c.table_schema not in ('pg_catalog', 'information_schema', 'net')
     and has_schema_privilege('claude_reader', c.table_schema, 'usage')
     and has_column_privilege('claude_reader', format('%I.%I', c.table_schema, c.table_name), c.column_name, 'select')
     and c.column_name ~* '(token|secret|password|email|_hash$|^ip$|seed|user_code|^key$)'
     and c.column_name !~ '(_id|_at|_sent)$'
     and format('%s.%s', c.table_name, c.column_name) not in (
       'library_versions.doc_hash', 'monthly.key', 'hourly.key', 'daily.key', 'detail_filters.key',
       'ledger.key', 'stamps.key', 'languoid_property.key', 'region_property.key', 'region_staging.key',
       'languoid_property_staging.key', '_languoid_staged_property.key', 'user_issues.key');
  if bad is not null then raise exception 'claude_reader reads a secret or an email: %', bad; end if;
end $$;

-- agent_reader reads every table claude_reader does, but no personal column
-- (names, pictures, voice, what a person typed): those it reads through the
-- views in `masked`, with emails, phone numbers and IP addresses taken out
-- (migration 20261124223000_agent_reader_all_but_personal.sql). A new
-- table with such a column revokes it from agent_reader in its own migration.
do $$
declare
  bad text;
begin
  select string_agg(format('%I.%I.%I', c.table_schema, c.table_name, c.column_name), ', ') into bad
    from information_schema.columns c
   where c.table_schema not in ('pg_catalog', 'information_schema', 'net', 'masked')
     and has_schema_privilege('agent_reader', c.table_schema, 'usage')
     and has_column_privilege('agent_reader', format('%I.%I', c.table_schema, c.table_name), c.column_name, 'select')
     and (c.column_name ~* '(token|secret|password|email|_hash$|^ip$|seed|user_code|^key$)'
          or c.column_name ~* '(display_name|shared_name|avatar|screenshot|^voice$|^picture$|^body$|^payload$|^message$|^details$)')
     and c.column_name !~ '(_id|_at|_sent)$'
     and format('%s.%s', c.table_name, c.column_name) not in (
       'library_versions.doc_hash', 'monthly.key', 'hourly.key', 'daily.key', 'detail_filters.key',
       'ledger.key', 'stamps.key', 'languoid_property.key', 'region_property.key', 'region_staging.key',
       'languoid_property_staging.key', '_languoid_staged_property.key', 'user_issues.key',
       -- library documents (templates, flows), a Bible timing's answer and the v2 import's own log: no person's words
       'library_documents.body', 'timing_job_results.body', 'log.message');
  if bad is not null then raise exception 'agent_reader reads a secret or personal column: %', bad; end if;
end $$;

do $$
begin
  if masked.personal('write to ana@example.org or +255 712 345 678, from 10.1.2.3, or 555-123-4567')
     <> 'write to [email] or [number], from [ip], or [number]' then
    raise exception 'masked.personal leaves personal data: %', masked.personal('write to ana@example.org or +255 712 345 678, from 10.1.2.3, or 555-123-4567');
  end if;
  if masked.payload('{"text": "call +1 555 123 4567", "n": 1732480000000, "a": {"b": "x@y.io"}}'::jsonb)
     <> '{"text": "call [number]", "n": 1732480000000, "a": {"b": "[email]"}}'::jsonb then
    raise exception 'masked.payload: %', masked.payload('{"text": "call +1 555 123 4567", "n": 1732480000000, "a": {"b": "x@y.io"}}'::jsonb);
  end if;
end $$;

-- ---- claude_reader, logged in --------------------------------------------------------------------

alter role claude_reader login password 'claude-readers-smoke';
\c "dbname=postgres user=claude_reader password=claude-readers-smoke host=127.0.0.1"
\set ON_ERROR_STOP on

do $$
begin
  if current_setting('transaction_read_only') <> 'on' then raise exception 'not read-only'; end if;
  perform count(*) from public.events;
  perform count(*) from public.profiles;
  perform count(*) from diag.records;
  perform count(*) from ops.user_issues;
  perform id, name, created_at from public.api_tokens limit 1;
  begin
    insert into public.profiles (id, display_name) values ('claude-readers-smoke', 'x');
    raise exception 'wrote in a read-only transaction';
  exception when read_only_sql_transaction then null;
  end;
end $$;

-- Turning read-only off is still no grant to write.
set default_transaction_read_only = off;
do $$
declare
  t text;
begin
  begin
    insert into public.profiles (id, display_name) values ('claude-readers-smoke', 'x');
    raise exception 'claude_reader wrote a profile';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.events where id = 'none';
    raise exception 'claude_reader may delete events';
  exception when insufficient_privilege then null;
  end;
  foreach t in array array[
    'select token_hash from public.api_tokens', 'select email from public.invites', 'select * from public.sign_in_codes',
    'select * from public.password_resets', 'select * from public.push_tokens', 'select secret from public.api_webhooks',
    'select shared_email from diag.feedback', 'select email from v2_import.people_links', 'select * from auth.users',
    'select * from storage.objects', 'select * from vault.secrets'
  ] loop
    begin
      execute t;
      raise exception 'claude_reader may run: %', t;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;

-- ---- agent_reader, logged in ---------------------------------------------------------------------

\c "dbname=postgres user=supabase_admin"
\set ON_ERROR_STOP on
alter role claude_reader nologin password null;
alter role agent_reader login password 'claude-readers-smoke';
\c "dbname=postgres user=agent_reader password=claude-readers-smoke host=127.0.0.1"
\set ON_ERROR_STOP on

do $$
declare
  t text;
begin
  if current_setting('transaction_read_only') <> 'on' then raise exception 'not read-only'; end if;
  perform id, type, actor_id, received_at from public.events limit 1;
  perform count(*) from diag.records;
  perform count(*) from diag.job_runs;
  perform count(*) from public.languages;
  perform count(*) from ops.user_issues;
  perform id, updated_at from public.profiles limit 1;
  perform payload from masked.events limit 1;
  perform body, has_voice from masked.feedback limit 1;
  perform message from masked.join_requests limit 1;
  perform details from masked.content_reports limit 1;
  perform count(*) from pg_stat_activity;
  begin
    insert into public.profiles (id, display_name) values ('claude-readers-smoke', 'x');
    raise exception 'agent_reader wrote in a read-only transaction';
  exception when read_only_sql_transaction or insufficient_privilege then null;
  end;
  foreach t in array array[
    'select payload from public.events', 'select * from public.events', 'select * from public.profiles',
    'select display_name from public.profiles', 'select * from diag.feedback', 'select body from diag.feedback',
    'select shared_name from diag.feedback', 'select message from public.join_requests',
    'select details from public.content_reports', 'select token_hash from public.api_tokens',
    'select email from public.invites', 'select * from public.sign_in_codes', 'select * from public.push_tokens',
    'select email from v2_import.people_links', 'select * from auth.users', 'select * from vault.secrets',
    'select * from diag.find(''x'')'
  ] loop
    begin
      execute t;
      raise exception 'agent_reader may run: %', t;
    exception when insufficient_privilege or undefined_function then null;
    end;
  end loop;
end $$;

\c "dbname=postgres user=supabase_admin"
\set ON_ERROR_STOP on
alter role agent_reader nologin password null;
