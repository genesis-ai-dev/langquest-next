-- The whole server schema, written from the final definitions (decision 63,
-- docs/streams-and-languages.md). It replaced 32 migrations when the
-- databases were reset to make every organization hold languages directly:
-- one organization stream, one stream per language, one per person. Later
-- changes are new migrations beside this one, as before.
--
-- Sections: extensions and schemas; tables; the event log and its streams;
-- authorization; payload validation; the organization stream's fold;
-- invites, join requests and sign-in help; the person stream; notifications
-- and public listings; moderation; account deletion; the library; timings;
-- diagnostics; triggers, row security and storage; privileges. The
-- projection worker's schedule is the next migration, which npm run
-- secrets also runs once the Vault secrets are set.
--
-- Function bodies may name objects defined further down.
set check_function_bodies = false;

-- ---- extensions and schemas ---------------------------------------------------

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create schema if not exists diag;

-- A read-only role for support tooling (scripts/diag.ts) and for Claude.
-- NOLOGIN here: a password is not something a migration may hold. Enabling
-- it for a hosted database is in docs/diagnostics.md.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'diag_reader') then
    create role diag_reader nologin;
  end if;
end $$;

-- ---- tables ---------------------------------------------------------------------

-- The event log (PLAN.md sections 5 to 9). Append-only: triggers refuse
-- UPDATE and DELETE for every role. A stream is (org_id, stream_id): the
-- organization stream is stream '_org', a language's stream is its language
-- id, and a person's stream is their profile id under org '_person'.
create table public.events (
  id text primary key,
  org_id text not null,
  stream_id text not null,
  server_seq bigint not null,
  type text not null,
  actor_id text not null,
  device_id text not null,
  hlc text not null,
  parent_event_id text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  unique (org_id, stream_id, server_seq)
);
create index events_pull_idx on public.events (org_id, stream_id, server_seq);
create index events_parent_idx on public.events (org_id, stream_id, parent_event_id) where parent_event_id is not null;
create index events_type_idx on public.events (org_id, stream_id, type);
create index events_org_names_idx on public.events (type, org_id) where stream_id = '_org';

-- One sequence counter per stream; the append locks it, which serializes
-- writes per stream and only per stream.
create table public.stream_cursors (
  org_id text not null,
  stream_id text not null,
  next_seq bigint not null default 1,
  primary key (org_id, stream_id)
);

-- Server snapshots of a language stream, one per reducer version (the
-- projection worker writes them; invariant 10).
create table public.snapshots (
  org_id text not null,
  stream_id text not null,
  reducer_version int not null,
  server_seq bigint not null,
  state jsonb not null,
  created_at timestamptz not null default now(),
  primary key (org_id, stream_id, reducer_version, server_seq)
);

-- Protocol settings: below min_client_version the server answers LQ001.
create table public.server_config (
  one boolean primary key default true check (one),
  min_client_version int not null default 1,
  clock_ahead_tolerance_ms bigint not null default 300000,
  asof_window_ms bigint not null default 7776000000
);
insert into public.server_config default values;

-- ---- the organization stream, folded for authorization ------------------------
-- What the write path must know without folding the log: roles, who holds
-- which role at which scope, and which languages exist. Written only by
-- _apply_org_event as organization-stream events are accepted.

create table public.org_roles (
  org_id text not null,
  role_id text not null,
  name text not null default '',
  privileges text[] not null default '{}',
  retired boolean not null default false,
  hlc text not null default '' collate "C",
  event_id text not null default '' collate "C",
  primary key (org_id, role_id)
);

-- One role per (person, scope). scope_key is 'org' or 'language:<id>'.
create table public.org_memberships (
  org_id text not null,
  profile_id text not null,
  scope_key text not null,
  scope_level text not null check (scope_level in ('org', 'language')),
  language_id text,
  role_id text,
  removed boolean not null default false,
  role_hlc text not null default '' collate "C",
  role_event text not null default '' collate "C",
  removed_hlc text not null default '' collate "C",
  removed_event text not null default '' collate "C",
  primary key (org_id, profile_id, scope_key),
  check ((scope_level = 'language') = (language_id is not null))
);
create index org_memberships_profile_idx on public.org_memberships (org_id, profile_id) where not removed;

-- An organization's languages (v1.LanguageAdded and its registers). A
-- language stream accepts events only once its row has been added.
create table public.languages (
  org_id text not null,
  language_id text not null,
  added_name text,
  code text,
  source_code text,
  added_hlc text not null default '' collate "C",
  added_event text not null default '' collate "C",
  renamed text,
  renamed_hlc text not null default '' collate "C",
  renamed_event text not null default '' collate "C",
  country text,
  country_hlc text not null default '' collate "C",
  country_event text not null default '' collate "C",
  target jsonb,
  target_hlc text not null default '' collate "C",
  target_event text not null default '' collate "C",
  primary key (org_id, language_id)
);

-- ---- invites, join requests, sign-in help ---------------------------------------

create table public.invites (
  id text primary key,
  org_id text not null,
  token_hash text not null unique,
  role_id text not null,
  scope jsonb not null,
  expires_at timestamptz not null,
  issued_by text not null,
  redeemed_by text,
  redeemed_at timestamptz,
  created_at timestamptz not null default now(),
  email text,
  email_sent_at timestamptz,
  label text,
  max_uses int not null default 1,
  constraint invites_max_uses check (max_uses between 1 and 50)
);
create index invites_org on public.invites (org_id, created_at desc);

create table public.invite_redemptions (
  invite_id text not null references public.invites (id) on delete cascade,
  profile_id text not null,
  redeemed_at timestamptz not null default now(),
  primary key (invite_id, profile_id)
);

create table public.invite_join_requests (
  request_id uuid primary key,
  profile_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.join_requests (
  id text primary key,
  org_id text not null,
  profile_id text not null,
  message text not null default '',
  created_at timestamptz not null default now(),
  unique (org_id, profile_id)
);
create index join_requests_org on public.join_requests (org_id, created_at);

-- Who to ask for help signing in: the inviter of an account without email.
create table public.account_stewards (
  profile_id uuid primary key references auth.users (id) on delete cascade,
  steward_id uuid not null references auth.users (id) on delete cascade,
  since timestamptz not null default now()
);

create table public.sign_in_codes (
  code_hash text primary key,
  profile_id uuid not null references auth.users (id) on delete cascade,
  issued_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  lost boolean not null default false
);

-- ---- people ------------------------------------------------------------------------

create table public.profiles (
  id text primary key,
  display_name text not null check (length(display_name) between 1 and 100),
  avatar_blob text,
  updated_at timestamptz not null default now()
);

create table public.user_blocks (
  blocker_id text not null,
  blocked_id text not null check (length(blocked_id) between 1 and 100),
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- ---- notifications and public listings -------------------------------------------

-- A person's Inbox rows from the projection worker. language_id is null for
-- rows about the organization (a join request, a report).
create table public.notifications (
  id text primary key,
  seq bigint generated always as identity unique,
  profile_id text not null,
  org_id text not null,
  language_id text,
  kind text not null,
  title text not null,
  task_id text,
  unit_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  pushed_at timestamptz,
  push_lease_until timestamptz
);
create index notifications_inbox on public.notifications (profile_id, seq);
create index notifications_push on public.notifications (seq) where pushed_at is null and active;

create table public.push_tokens (
  token text primary key,
  profile_id text not null,
  updated_at timestamptz not null default now()
);
create index push_tokens_profile on public.push_tokens (profile_id);

create table public.push_receipts (
  ticket_id text primary key,
  token text not null,
  notification_id text not null references public.notifications (id),
  created_at timestamptz not null default now()
);

-- Whether a language is listed publicly, and what the listing shows.
create table public.language_visibility (
  org_id text not null,
  language_id text not null,
  listed boolean not null default false,
  primary key (org_id, language_id)
);

create table public.public_languages (
  org_id text not null,
  language_id text not null,
  name text not null,
  code text not null default '',
  translated_pct double precision not null default 0,
  license text not null default 'all-rights-reserved',
  updated_at timestamptz not null default now(),
  primary key (org_id, language_id)
);

-- ---- moderation ---------------------------------------------------------------------

-- language_id is null for a report about a person (the organization's).
create table public.content_reports (
  id text primary key check (length(id) between 1 and 100),
  org_id text not null,
  language_id text,
  target_kind text not null check (target_kind in ('version', 'review', 'note', 'request', 'person')),
  target_id text not null check (length(target_id) between 1 and 300),
  unit_id text check (length(unit_id) <= 300),
  reported_profile text not null,
  reporter_id text,
  reason text not null check (reason in ('offensive', 'sexual', 'harassment', 'violence', 'spam', 'other')),
  details text check (length(details) <= 1000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  resolution text check (resolution in ('removed', 'dismissed')),
  check ((resolved_at is null) = (resolution is null)),
  check ((target_kind = 'person') = (language_id is null))
);
create index content_reports_open on public.content_reports (org_id, created_at) where resolved_at is null;
create index content_reports_reporter on public.content_reports (reporter_id, created_at);

-- ---- the library (docs/library.md, decision 36) -----------------------------------

create table public.library_documents (
  hash text primary key check (hash ~ '^[0-9a-f]{64}$'),
  format text not null,
  body text not null,
  bytes int not null,
  deps text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index library_documents_deps_idx on public.library_documents using gin (deps);

create table public.library_document_access (
  org_id text not null,
  hash text not null references public.library_documents (hash),
  granted_at timestamptz not null default now(),
  primary key (org_id, hash)
);

create table public.library_items (
  org_id text not null,
  item_id text not null,
  kind text,
  kind_hlc text not null default '' collate "C",
  kind_event text not null default '' collate "C",
  name text,
  name_hlc text not null default '' collate "C",
  name_event text not null default '' collate "C",
  description text,
  description_hlc text not null default '' collate "C",
  description_event text not null default '' collate "C",
  copied_from jsonb,
  copied_hlc text not null default '' collate "C",
  copied_event text not null default '' collate "C",
  shared boolean not null default false,
  subscribable boolean not null default false,
  sharing_hlc text not null default '' collate "C",
  sharing_event text not null default '' collate "C",
  archived boolean not null default false,
  archived_hlc text not null default '' collate "C",
  archived_event text not null default '' collate "C",
  primary key (org_id, item_id)
);
create index library_items_shared_idx on public.library_items (kind, name) where shared and not archived;

create table public.library_versions (
  org_id text not null,
  item_id text not null,
  doc_hash text not null,
  hlc text not null collate "C",
  event_id text not null collate "C",
  actor_id text not null,
  note text,
  primary key (org_id, item_id, doc_hash)
);
create index library_versions_hash_idx on public.library_versions (doc_hash);

create table public.library_subscriptions (
  org_id text not null,
  item_id text not null,
  source_org_id text,
  source_org_name text,
  source_item_id text,
  name text,
  auto_update boolean not null default false,
  active boolean not null default false,
  sub_hlc text not null default '' collate "C",
  sub_event text not null default '' collate "C",
  pinned text,
  pinned_hlc text not null default '' collate "C",
  pinned_event text not null default '' collate "C",
  primary key (org_id, item_id)
);
create index library_subscriptions_source_idx on public.library_subscriptions (source_org_id, source_item_id) where active and auto_update;

-- ---- verse timings (docs/reference-material.md, decision 62) ----------------------

create table public.timing_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  item_id text not null,
  requested_by text not null,
  requested_at timestamptz not null default now(),
  bible_id text not null,
  audio_fileset text not null,
  text_fileset text,
  books text[] not null,
  versification text not null default 'eng',
  claimed_by text,
  claimed_at timestamptz,
  done int not null default 0,
  total int not null default 0,
  note text,
  finished_at timestamptz,
  error text,
  publish_org text,
  publish_item text,
  published_at timestamptz
);
create index timing_jobs_open on public.timing_jobs (requested_at) where finished_at is null;
create index timing_jobs_org on public.timing_jobs (org_id, requested_at desc);

create table public.timing_job_results (
  job_id uuid not null references public.timing_jobs (id) on delete cascade,
  book text not null,
  chapter int not null,
  ok boolean not null,
  body jsonb not null,
  primary key (job_id, book, chapter)
);

-- ---- field diagnostics (decision 39, docs/diagnostics.md) -------------------------

create table diag.installs (
  install_id text primary key,
  profile_id text not null,
  context jsonb not null default '{}',
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  day_start date not null default current_date,
  day_count int not null default 0
);
create index diag_installs_profile_idx on diag.installs (profile_id);

-- stream_id names the stream a sync record was about (a language's, or '_org').
create table diag.records (
  id text primary key,
  install_id text not null,
  delivered_by text not null,
  org_id text,
  stream_id text,
  kind text not null,
  at timestamptz not null,
  received_at timestamptz not null default now(),
  update_id text,
  n jsonb not null default '{}',
  t jsonb not null default '{}',
  stack text
);
create index diag_records_error_idx on diag.records ((t ->> 'errorId')) where kind = 'error';
create index diag_records_install_idx on diag.records (install_id, at desc);
create index diag_records_stream_idx on diag.records (org_id, stream_id, at desc);
create index diag_records_received_idx on diag.records (received_at);

-- ---- the event log and its streams ---------------------------------------------------

-- Caller identity as opaque text (no uuid cast; actor ids are strings here).
-- Reads the PostgREST JWT claims, or the legacy per-claim setting for tests.
create or replace function public.caller_id()
returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
    nullif(current_setting('request.jwt.claim.sub', true), '')
  );
$$;

-- The log is append-only, for every role and every row.
create or replace function public.events_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'events are append-only (%)', tg_op using errcode = '42501';
end $$;

-- Below server_config.min_client_version the app must upgrade (LQ001).
create or replace function public.require_client_version(p_version int)
returns void language plpgsql stable set search_path = public as $$
begin
  if coalesce(p_version, 0) < (select min_client_version from public.server_config) then
    raise exception 'client too old' using errcode = 'LQ001';
  end if;
end $$;

-- The next server_seq of a stream. Locks its cursor row, which serializes
-- appends per stream (and only per stream).
create or replace function public._next_seq(p_org text, p_stream text)
returns bigint language plpgsql set search_path = public as $$
declare v_seq bigint;
begin
  insert into public.stream_cursors (org_id, stream_id) values (p_org, p_stream) on conflict do nothing;
  update public.stream_cursors c set next_seq = c.next_seq + 1
    where c.org_id = p_org and c.stream_id = p_stream
    returning c.next_seq - 1 into v_seq;
  return v_seq;
end $$;

-- A server-issued event (an invite redeemed, a join decided, a person's own
-- choice, a redaction by a moderator), stamped with the server's clock and
-- folded like any organization-stream event. Idempotent by id: returns the
-- clock, or null when the id was already used.
create or replace function public._append_event_as(
  p_id text, p_org text, p_stream text, p_type text, p_actor text, p_device text, p_payload jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare v_seq bigint; v_hlc text;
begin
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

-- One append helper for every server-issued blob verdict. Idempotent by id.
create or replace function public._append_service_event(
  p_id text, p_org text, p_stream text, p_type text, p_payload jsonb
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  return public._append_event_as(p_id, p_org, p_stream, p_type, 'service', 'storage', p_payload) is not null;
end $$;

-- Does a language stream exist? It does once the organization stream added
-- the language (v1.LanguageAdded): the gate on every language stream.
create or replace function public.language_listed(p_org text, p_language text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.languages l where l.org_id = p_org and l.language_id = p_language and l.added_hlc <> '');
$$;

-- ---------------------------------------------------------------------------
-- append_events: the only write path for clients. Per event: envelope,
-- author, idempotency, clock, authorization, the language gate, payload
-- shape; then the next sequence, and for the organization stream the fold
-- the write path needs (_apply_org_event). Each event gets its own answer;
-- one refusal never fails the batch.
-- ---------------------------------------------------------------------------
create or replace function public.append_events(p_events jsonb, p_client_version int default 0)
returns table (id text, accepted boolean, server_seq bigint, reason text)
language plpgsql security definer set search_path = public as $$
declare
  ev jsonb;
  v_actor text := public.caller_id();
  v_org text; v_stream text; v_type text; v_id text; v_hlc text;
  v_seq bigint; v_existing bigint; v_invalid text;
  v_now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_wall_ms bigint;
  v_tolerance bigint;
  v_ok boolean;
begin
  perform public.require_client_version(p_client_version);
  select clock_ahead_tolerance_ms into v_tolerance from public.server_config;
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events must be a jsonb array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) > 500 then
    raise exception 'batch too large: % events (max 500); page the push', jsonb_array_length(p_events) using errcode = '22023';
  end if;

  for ev in select * from jsonb_array_elements(p_events) loop
    v_id := ev->>'id'; v_org := ev->>'orgId'; v_stream := ev->>'streamId'; v_type := ev->>'type'; v_hlc := ev->>'hlc';

    if not (public._is_str(ev->'id') and public._is_str(ev->'orgId') and public._is_str(ev->'streamId')
            and public._is_str(ev->'type') and public._is_str(ev->'hlc') and public._is_str(ev->'deviceId')
            and public._is_str(ev->'actorId')) or ev->'payload' is null then
      id := v_id; accepted := false; server_seq := null; reason := 'malformed envelope';
      return next; continue;
    end if;

    if v_actor is not null and ev->>'actorId' <> v_actor then
      id := v_id; accepted := false; server_seq := null; reason := 'actorId does not match caller';
      return next; continue;
    end if;

    select e.server_seq into v_existing from public.events e where e.id = v_id;
    if found then
      id := v_id; accepted := true; server_seq := v_existing; reason := 'duplicate';
      return next; continue;
    end if;

    v_wall_ms := nullif(regexp_replace(split_part(v_hlc, ':', 1), '\D', '', 'g'), '')::bigint;
    if v_wall_ms is null then
      id := v_id; accepted := false; server_seq := null; reason := 'malformed envelope';
      return next; continue;
    end if;
    if v_wall_ms > v_now_ms + v_tolerance then
      id := v_id; accepted := false; server_seq := null;
      reason := format('clock ahead: server time %s', v_now_ms);
      return next; continue;
    end if;

    -- A person's stream is written only by record_user_event.
    if v_org = '_person' then
      id := v_id; accepted := false; server_seq := null; reason := format('may not emit %s here', v_type);
      return next; continue;
    end if;

    v_ok := public.may_emit(v_org, v_stream, ev->>'actorId', v_type, ev->'payload');
    if not v_ok and v_stream = '_org' then
      -- The organization's creation: until anyone is a member, its creator
      -- may create it, define its roles and make themselves its first member.
      v_ok := not exists (select 1 from public.org_memberships m where m.org_id = v_org)
        and (v_type in ('v1.OrgCreated', 'v1.RoleDefined')
          or (v_type = 'v1.MemberAdded' and ev->'payload'->>'profileId' = ev->>'actorId'
              and ev->'payload'->'scope'->>'level' = 'org'));
    end if;
    if not v_ok then
      id := v_id; accepted := false; server_seq := null;
      reason := case
        when not public.can_read_stream(v_org, v_stream, ev->>'actorId') then 'not a member'
        else format('may not emit %s', v_type)
      end;
      return next; continue;
    end if;

    -- A language stream exists once the organization lists the language. A
    -- phone may push a new language's events before the organization's
    -- (two streams, two outboxes); it retries them (NOT_LISTED).
    if v_stream <> '_org' and not public.language_listed(v_org, v_stream) then
      id := v_id; accepted := false; server_seq := null; reason := 'language not listed yet';
      return next; continue;
    end if;

    v_invalid := public.validate_payload(v_type, ev->'payload');
    if v_invalid is not null then
      id := v_id; accepted := false; server_seq := null; reason := 'invalid payload: ' || v_invalid;
      return next; continue;
    end if;

    v_seq := public._next_seq(v_org, v_stream);
    insert into public.events (id, org_id, stream_id, server_seq, type, actor_id, device_id,
                               hlc, parent_event_id, payload)
    values (v_id, v_org, v_stream, v_seq, v_type, ev->>'actorId', ev->>'deviceId',
            v_hlc, ev->>'parentEventId', ev->'payload');

    if v_stream = '_org' then
      perform public._apply_org_event(v_org, v_id, v_type, ev->'payload', v_hlc, ev->>'actorId');
    end if;

    id := v_id; accepted := true; server_seq := v_seq; reason := null;
    return next;
  end loop;
end $$;

-- A bounded, ordered page of a stream for someone who may read it.
create or replace function public.pull_events(
  p_org_id text, p_stream_id text, p_after bigint default 0, p_limit int default 500, p_client_version int default 0
) returns setof public.events
language plpgsql security definer set search_path = public stable as $$
declare v_actor text := public.caller_id();
begin
  perform public.require_client_version(p_client_version);
  if v_actor is not null and not public.can_read_stream(p_org_id, p_stream_id, v_actor) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return query
    select * from public.events e
    where e.org_id = p_org_id and e.stream_id = p_stream_id and e.server_seq > p_after
    order by e.server_seq
    limit least(greatest(p_limit, 1), 1000);
end $$;

-- ---- snapshots (language streams; invariant 10, decision 18) ---------------------

create or replace function public.get_snapshot(p_org_id text, p_stream_id text, p_reducer_version int)
returns table(server_seq bigint, state jsonb, created_at timestamptz)
language plpgsql security definer set search_path = public stable as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is not null and not public.can_read_stream(p_org_id, p_stream_id, v_actor) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return query
    select s.server_seq, s.state, s.created_at from public.snapshots s
    where s.org_id = p_org_id and s.stream_id = p_stream_id and s.reducer_version = p_reducer_version
    order by s.server_seq desc limit 1;
end $$;

-- Only the service role writes snapshots. Older snapshots for the same
-- version are dropped so the table holds one row per (stream, version).
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
    and s.server_seq < p_server_seq;
end $$;

-- Snapshot download in pieces. A Bible-scale snapshot is around 13 MB of
-- JSON; as one response it fails on the links our users have. Clients read
-- the meta, then fetch 256 KB pieces one at a time, persisting each, so a
-- dropped link resumes instead of restarting. jsonb::text is deterministic,
-- so pieces of the same (stream, version, seq) always reassemble.
create or replace function public.snapshot_chunk_chars() returns int language sql immutable as $$ select 262144 $$;

create or replace function public.get_snapshot_meta(p_org_id text, p_stream_id text, p_reducer_version int)
returns table(server_seq bigint, chunks int, bytes int)
language plpgsql security definer set search_path = public stable as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is not null and not public.can_read_stream(p_org_id, p_stream_id, v_actor) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return query
    select s.server_seq,
           greatest(1, ceil(length(s.state::text)::numeric / public.snapshot_chunk_chars()))::int,
           length(s.state::text)
    from public.snapshots s
    where s.org_id = p_org_id and s.stream_id = p_stream_id and s.reducer_version = p_reducer_version
    order by s.server_seq desc limit 1;
end $$;

create or replace function public.get_snapshot_chunk(
  p_org_id text, p_stream_id text, p_reducer_version int, p_server_seq bigint, p_index int
) returns text
language plpgsql security definer set search_path = public stable as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is not null and not public.can_read_stream(p_org_id, p_stream_id, v_actor) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return (
    select substr(s.state::text, p_index * public.snapshot_chunk_chars() + 1, public.snapshot_chunk_chars())
    from public.snapshots s
    where s.org_id = p_org_id and s.stream_id = p_stream_id
      and s.reducer_version = p_reducer_version and s.server_seq = p_server_seq
  );
end $$;

-- What the workers iterate. Service role only (no JWT sub).
create or replace function public.list_streams()
returns table (org_id text, stream_id text, next_seq bigint)
language plpgsql security definer set search_path = public stable as $$
begin
  if public.caller_id() is not null then
    raise exception 'service role only' using errcode = '42501';
  end if;
  return query select c.org_id, c.stream_id, c.next_seq from public.stream_cursors c;
end $$;

-- The newest server_seq of every stream in one organization, in one query
-- (decisions.md 44, amended 2026-10-03). The dashboard's server asks this
-- before a catch-up pass and pulls only the streams that moved. Service
-- role only, like list_streams.
create or replace function public.stream_heads(p_org_id text)
returns table (stream_id text, head bigint)
language plpgsql security definer set search_path = public stable as $$
begin
  if public.caller_id() is not null then
    raise exception 'service role only' using errcode = '42501';
  end if;
  return query select c.stream_id, c.next_seq - 1 from public.stream_cursors c where c.org_id = p_org_id;
end $$;

-- Realtime pokes. After every insert into the event log, broadcast an empty
-- "appended" message on the stream's channel so devices pull now instead
-- of on their next poll. The channel is public and the payload is only the
-- new server_seq: it says that the stream moved, never what moved. The
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
      'events:' || new.org_id || '/' || new.stream_id,
      false
    );
  exception when others then
    null;
  end;
  return new;
end $$;

-- ---- blobs (PLAN.md section 14) ----------------------------------------------------
-- Objects live in the private "blobs" bucket at <org>/<stream>/<hash>.<ext>.

-- The storage trigger: fires on insert and on metadata change (an upsert
-- that replaced the bytes). The id carries the size, so a re-upload with
-- different bytes produces a fresh confirmation the reducer prefers.
create or replace function public.record_blob_stored()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_org text := split_part(new.name, '/', 1);
  v_stream text := split_part(new.name, '/', 2);
  v_hash text := split_part(split_part(new.name, '/', 3), '.', 1);
  v_size bigint := coalesce((new.metadata ->> 'size')::bigint, 0);
begin
  if new.bucket_id <> 'blobs' or v_org = '' or v_stream = '' or v_hash = '' then return new; end if;
  if tg_op = 'UPDATE' and coalesce((old.metadata ->> 'size')::bigint, -1) = v_size then return new; end if;
  perform public._append_service_event(
    format('blob:%s:%s:%s:%s', v_org, v_stream, v_hash, v_size), v_org, v_stream,
    'v1.BlobStored', jsonb_build_object('hash', v_hash, 'size', v_size));
  return new;
end $$;

-- Reconciler entry points. Service role only.
create or replace function public.record_blob(p_org text, p_stream text, p_hash text, p_size bigint)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if public.caller_id() is not null then raise exception 'service role only' using errcode = '42501'; end if;
  return public._append_service_event(
    format('blob:%s:%s:%s:%s', p_org, p_stream, p_hash, p_size), p_org, p_stream,
    'v1.BlobStored', jsonb_build_object('hash', p_hash, 'size', p_size));
end $$;

create or replace function public.invalidate_blob(p_org text, p_stream text, p_hash text, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if public.caller_id() is not null then raise exception 'service role only' using errcode = '42501'; end if;
  return public._append_service_event(
    format('blobinvalid:%s:%s:%s:%s', p_org, p_stream, p_hash, (extract(epoch from clock_timestamp()) * 1000)::bigint),
    p_org, p_stream, 'v1.BlobInvalidated', jsonb_build_object('hash', p_hash, 'reason', p_reason));
end $$;

-- ---- authorization (decision 23, amended by 63) ------------------------------------

-- Privileges a profile holds for a language: the union of their org-scope
-- role, if any, and their role in that language, if any, through roles that
-- are not retired. With no language, only the org-scope role counts.
-- core privilegesFor.
create or replace function public.org_privileges(p_org text, p_profile text, p_language text)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct priv), '{}')
  from public.org_memberships m
  join public.org_roles r on r.org_id = m.org_id and r.role_id = m.role_id and not r.retired
  cross join lateral unnest(r.privileges) as priv
  where m.org_id = p_org and m.profile_id = p_profile and not m.removed
    and (m.scope_level = 'org' or (p_language is not null and m.scope_level = 'language' and m.language_id = p_language));
$$;

-- core effectiveRole.
create or replace function public.effective_role_of(p_privs text[])
returns text language sql immutable as $$
  select case
    when 'manage_roles' = any(p_privs) then 'owner'
    when 'assign_work' = any(p_privs) then 'coordinator'
    when 'translate' = any(p_privs) then 'translator'
    when 'review' = any(p_privs) then 'reviewer'
    when 'view_status' = any(p_privs) then 'viewer'
    else null
  end;
$$;

-- The language an organization-stream event is authorized against, or null
-- for org scope. core languageOfOrgEvent.
create or replace function public.language_of_org_event(p_type text, p jsonb)
returns text language sql immutable as $$
  select case
    when p_type in ('v1.LanguageRenamed', 'v1.LanguageCountrySet', 'v1.LanguageTargetSet') then p->>'languageId'
    when p_type in ('v1.MemberAdded', 'v1.MemberRemoved', 'v1.InviteIssued') and p->'scope'->>'level' = 'language'
      then p->'scope'->>'languageId'
    else null
  end;
$$;

-- May this person append this event to this stream? The event's privilege
-- (event_privilege) against what they hold for the language the event is
-- about: the stream's own language, or for the organization stream the
-- language its payload names, else org scope.
create or replace function public.may_emit(p_org text, p_stream text, p_profile text, p_type text, p jsonb)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_priv text := public.event_privilege(p_type, p);
begin
  if v_priv is null or v_priv = 'bootstrap' then return false; end if;
  return string_to_array(v_priv, ',') && public.org_privileges(
    p_org, p_profile,
    case when p_stream = '_org' then public.language_of_org_event(p_type, p) else p_stream end);
end $$;

-- Who may read a stream, used by every read RPC: the organization stream,
-- anyone with a role in the organization at any scope; a language stream,
-- anyone with a role covering that language; a person's stream, that person.
create or replace function public.can_read_stream(p_org text, p_stream text, p_profile text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_org = '_person' then p_stream = p_profile
    when p_stream = '_org' then exists (
      select 1 from public.org_memberships m
      where m.org_id = p_org and m.profile_id = p_profile and not m.removed)
    else cardinality(public.org_privileges(p_org, p_profile, p_stream)) > 0
  end;
$$;

-- The caller's own privileges in an organization, optionally for one
-- language: what a screen asks before offering an edit. The server still
-- decides on append (may_emit); this only hides controls that would fail.
create or replace function public.my_privileges(p_org text, p_language text default null)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array(select x from unnest(public.org_privileges(p_org, public.caller_id(), p_language)) as x order by x), '{}'::text[])
  where public.caller_id() is not null;
$$;

-- core EVENT_PRIVILEGE and privilegeFor: the privilege an event needs, a
-- comma-separated list when any one will do, 'bootstrap' for the
-- organization's creation, null for server-only. scripts/record-parity-sql.ts
-- holds the two together.
create or replace function public.event_privilege(p_type text, p jsonb)
returns text language sql immutable as $$
  select case p_type
    -- organization stream
    when 'v1.OrgCreated' then 'bootstrap'
    when 'v1.RoleDefined' then 'manage_roles'
    when 'v1.RoleRetired' then 'manage_roles'
    when 'v1.MemberAdded' then 'invite_members'
    when 'v1.MemberRemoved' then 'invite_members'
    when 'v1.InviteIssued' then 'invite_members'
    when 'v1.InviteRedeemed' then null
    when 'v1.JoinDecided' then 'invite_members'
    when 'v1.LicenseSet' then 'manage_roles'
    when 'v1.LanguageAdded' then 'manage_structure'
    when 'v1.LanguageRenamed' then 'manage_structure'
    when 'v1.LanguageCountrySet' then 'manage_structure'
    when 'v1.LanguageTargetSet' then 'manage_structure'
    when 'v1.ReferenceRecommended' then 'manage_reference'
    when 'v1.LibraryItemDefined' then public._library_privilege(p->>'kind')
    when 'v1.LibraryVersionPublished' then public._library_privilege(p->>'kind')
    when 'v1.LibrarySharingSet' then public._library_privilege(p->>'kind')
    when 'v1.LibraryItemArchived' then public._library_privilege(p->>'kind')
    when 'v1.LibrarySubscribed' then public._library_privilege(p->>'kind')
    when 'v1.LibraryPinned' then public._library_privilege(p->>'kind')
    -- either stream
    when 'v1.Redacted' then 'manage_structure'
    -- language stream
    when 'v1.TemplateSelected' then 'manage_templates'
    when 'v1.UnitAdded' then 'manage_templates'
    when 'v1.UnitHidden' then 'manage_templates,shape_templates'
    when 'v1.FlowSelected' then 'manage_flows'
    when 'v1.FlowStepSet' then 'manage_flows'
    when 'v1.FlowStepRemoved' then 'manage_flows'
    when 'v1.ReviewKindDefined' then 'manage_flows'
    when 'v1.ReviewTeamDefined' then 'manage_teams'
    when 'v1.ReviewTeamMemberSet' then 'manage_teams'
    when 'v1.ReviewTeamKindSet' then 'manage_teams'
    when 'v1.RecordingAdded' then 'translate'
    when 'v1.TakeComposed' then 'translate'
    when 'v1.TakeArchived' then 'translate'
    when 'v1.TakeSubmitted' then 'translate'
    when 'v1.ResponseRecorded' then 'translate'
    when 'v1.ReviewRecorded' then case when p->>'via' = 'logged' then 'review,translate' else 'review' end
    when 'v1.DepartureRecorded' then case p->>'type'
      when 'override' then 'override_checkpoints' when 'keep' then 'translate' else 'translate,review,assign_work' end
    when 'v1.DepartureUndone' then 'translate,review,assign_work,override_checkpoints'
    when 'v1.RequestMade' then 'send_to_reviewers,assign_work'
    when 'v1.RequestWithdrawn' then 'send_to_reviewers,assign_work'
    when 'v1.NoteAdded' then 'translate,review,fill_reference'
    when 'v1.StudyStepMarked' then 'translate'
    when 'v1.MaterialDefined' then case when p->>'kind' = 'questions' then 'fill_reference' else 'manage_reference' end
    when 'v1.MaterialFieldSet' then 'fill_reference'
    when 'v1.MaterialLocked' then 'manage_reference'
    when 'v1.KeyTermDefined' then 'fill_reference'
    when 'v1.KeyTermRenderingAdded' then 'fill_reference'
    when 'v1.KeyTermAdjusted' then 'fill_reference'
    when 'v1.KeyTermLinked' then 'fill_reference'
    when 'v1.ReferenceSet' then 'manage_reference'
    when 'v1.PassageReferenceLinked' then 'manage_reference'
    when 'v1.ReferencesUsed' then 'translate,review'
    else null
  end;
$$;

-- core LIBRARY_PRIVILEGE, and privilegeFor's fallback for an unknown kind.
create or replace function public._library_privilege(p_kind text) returns text language sql immutable as $$
  select case p_kind
    when 'template' then 'manage_templates' when 'versification' then 'manage_templates'
    when 'flow' then 'manage_flows' when 'material' then 'manage_reference'
    else 'manage_structure' end;
$$;

-- ---- payload validation (invariant 11) ----------------------------------------------
-- core validate.ts, rule for rule: an event that passes here folds on every
-- phone, and one that would not is refused at the door. Unknown types pass,
-- so an older server never refuses a newer client's event for its shape
-- (its privilege still decides). scripts/record-parity-sql.ts holds the two
-- together.

create or replace function public._is_str(v jsonb) returns boolean language sql immutable as $$
  select v is not null and jsonb_typeof(v) = 'string' and (v #>> '{}') <> '';
$$;
create or replace function public._is_opt_str(v jsonb) returns boolean language sql immutable as $$
  select v is null or jsonb_typeof(v) = 'string';
$$;
create or replace function public._is_bool(v jsonb) returns boolean language sql immutable as $$
  select v is not null and jsonb_typeof(v) = 'boolean';
$$;
create or replace function public._is_str_array(v jsonb) returns boolean language sql immutable as $$
  select v is not null and jsonb_typeof(v) = 'array'
    and not exists (select 1 from jsonb_array_elements(v) x where jsonb_typeof(x) <> 'string');
$$;
create or replace function public._is_str_map(v jsonb) returns boolean language sql immutable as $$
  select v is null or (jsonb_typeof(v) = 'object'
    and not exists (select 1 from jsonb_each(v) e where jsonb_typeof(e.value) <> 'string'));
$$;
create or replace function public._is_hash(v jsonb) returns boolean language sql immutable as $$
  select v is not null and jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^[0-9a-f]{64}$';
$$;
create or replace function public._is_date(v jsonb) returns boolean language sql immutable as $$
  select v is not null and jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$';
$$;
create or replace function public._is_privilege_array(v jsonb) returns boolean language sql immutable as $$
  select v is not null and jsonb_typeof(v) = 'array'
    and not exists (
      select 1 from jsonb_array_elements(v) x
      where jsonb_typeof(x) <> 'string' or (x #>> '{}') not in (
        'manage_structure','invite_members','manage_roles','manage_templates','shape_templates','manage_reference',
        'manage_flows','manage_teams','assign_work','override_checkpoints','translate','fill_reference',
        'send_to_reviewers','review','view_status'));
$$;
-- A value that is one of these strings (core oneOf).
create or replace function public._is_one_of(v jsonb, p_values text[]) returns boolean language sql immutable as $$
  select v is not null and jsonb_typeof(v) = 'string' and (v #>> '{}') = any(p_values);
$$;
-- Cards: [{hash, durationMs}, ...].
create or replace function public._is_cards(v jsonb) returns boolean language sql immutable as $$
  select v is not null and jsonb_typeof(v) = 'array' and not exists (
    select 1 from jsonb_array_elements(v) c
    where jsonb_typeof(c) <> 'object' or not public._is_str(c->'hash') or jsonb_typeof(c->'durationMs') is distinct from 'number');
$$;

-- core LICENSES, most closed first. The order is the merge rule.
-- Fixed roles (core SEED_ROLES' privileges, privilegesOfFixedRole), for the
-- parity check and for seeding an organization's roles.
create or replace function public.fixed_role_privileges(p_role text)
returns text[] language sql immutable as $$
  select case p_role
    when 'owner' then array['manage_structure','invite_members','manage_roles','manage_templates','shape_templates','manage_reference','manage_flows','manage_teams','assign_work','override_checkpoints','translate','fill_reference','send_to_reviewers','review','view_status']
    when 'coordinator' then array['manage_structure','invite_members','manage_templates','shape_templates','manage_reference','manage_flows','manage_teams','assign_work','override_checkpoints','translate','fill_reference','send_to_reviewers','review','view_status']
    when 'translator' then array['translate','fill_reference','send_to_reviewers','view_status']
    when 'reviewer' then array['review','view_status']
    when 'viewer' then array['view_status']
    else '{}'::text[]
  end;
$$;
create or replace function public.role_may_emit_event(p_role text, p_type text, p jsonb)
returns boolean language sql immutable as $$
  select coalesce(string_to_array(public.event_privilege(p_type, p), ',') && public.fixed_role_privileges(p_role), false);
$$;

create or replace function public.licenses() returns text[] language sql immutable as $$
  select array['all-rights-reserved', 'CC-BY-NC-ND-4.0', 'CC-BY-NC-SA-4.0', 'CC-BY-SA-4.0', 'CC-BY-4.0', 'CC0-1.0'];
$$;

-- A membership or invite scope: the organization, or one language (core scope()).
create or replace function public._scope_error(v jsonb) returns text language sql immutable as $$
  select case
    when v is null or jsonb_typeof(v) <> 'object' then 'scope must be an object'
    when v->>'level' = 'org' and jsonb_typeof(v->'level') = 'string' then
      case when (select count(*) from jsonb_object_keys(v)) = 1 then null else 'an org scope names nothing else' end
    when v->>'level' = 'language' and jsonb_typeof(v->'level') = 'string' then
      case when public._is_str(v->'languageId') and (select count(*) from jsonb_object_keys(v)) = 2 then null
        else 'a language scope names its languageId and nothing else' end
    else 'scope.level must be org or language'
  end;
$$;

-- core scopeKey.
create or replace function public._scope_key(v jsonb) returns text language sql immutable as $$
  select case v->>'level' when 'org' then 'org' else 'language:' || (v->>'languageId') end;
$$;

-- The items of v1.ReferencesUsed (core usedItems).
create or replace function public._used_items_error(p jsonb)
returns text language plpgsql immutable as $$
declare x jsonb; k text;
begin
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) = 0 or jsonb_array_length(p) > 200 then
    return 'items must be a list of 1 to 200';
  end if;
  for x in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(x) <> 'object' then return 'items must be objects'; end if;
    if not (public._is_str(x->'itemId') and public._is_str(x->'name')) then return 'items need an itemId and a name'; end if;
    if not public._is_one_of(x->'kind', array['source', 'guide', 'note', 'questions']) then
      return 'item kind must be one of source, guide, note, questions';
    end if;
    if not public._is_bool(x->'opened') then return 'opened must be a boolean'; end if;
    foreach k in array array['docHash', 'ref', 'detail', 'copyright'] loop
      if not public._is_opt_str(x->k) then return k || ' must be a string'; end if;
    end loop;
  end loop;
  return null;
end $$;

create or replace function public.validate_payload(p_type text, p jsonb)
returns text language plpgsql immutable as $$
declare x jsonb; n int;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'payload must be an object'; end if;

  -- The library's items: an id people can read, of a kind the library knows.
  if p_type like 'v1.Library%' then
    if not public._is_str(p->'itemId') then return 'itemId must be a non-empty string'; end if;
    if (p->>'itemId') !~* '^[a-z0-9][a-z0-9._-]{0,120}$' then return 'itemId may use letters, digits, . _ and - only'; end if;
    if not public._is_one_of(p->'kind', array['template', 'flow', 'material', 'versification']) then
      return 'kind must be one of template, flow, material, versification';
    end if;
  end if;

  case p_type
    -- ---- organization stream
    when 'v1.OrgCreated' then
      if not public._is_str(p->'name') then return 'name must be a non-empty string'; end if;
    when 'v1.RoleDefined' then
      if not (public._is_str(p->'roleId') and public._is_str(p->'name')) then return 'roleId, name must be non-empty strings'; end if;
      if not public._is_privilege_array(p->'privileges') then return 'privileges must be known privileges'; end if;
    when 'v1.RoleRetired' then
      if not public._is_str(p->'roleId') then return 'roleId must be a non-empty string'; end if;
    when 'v1.MemberAdded' then
      if not (public._is_str(p->'profileId') and public._is_str(p->'roleId')) then return 'profileId, roleId must be non-empty strings'; end if;
      return public._scope_error(p->'scope');
    when 'v1.MemberRemoved' then
      if not public._is_str(p->'profileId') then return 'profileId must be a non-empty string'; end if;
      return public._scope_error(p->'scope');
    when 'v1.InviteIssued' then
      if not (public._is_str(p->'inviteId') and public._is_str(p->'roleId') and public._is_str(p->'expiresAt')) then
        return 'inviteId, roleId, expiresAt must be non-empty strings';
      end if;
      return public._scope_error(p->'scope');
    when 'v1.InviteRedeemed' then
      if not (public._is_str(p->'inviteId') and public._is_str(p->'profileId')) then return 'inviteId, profileId must be non-empty strings'; end if;
    when 'v1.JoinDecided' then
      if not (public._is_str(p->'requestId') and public._is_str(p->'profileId')) then return 'requestId, profileId must be non-empty strings'; end if;
      if not public._is_bool(p->'accepted') then return 'accepted must be a boolean'; end if;
    when 'v1.LicenseSet' then
      if not public._is_one_of(p->'license', public.licenses()) then
        return 'license must be one of ' || array_to_string(public.licenses(), ', ');
      end if;
    when 'v1.LanguageAdded' then
      if not (public._is_str(p->'languageId') and public._is_str(p->'name') and public._is_str(p->'code') and public._is_str(p->'sourceCode')) then
        return 'languageId, name, code, sourceCode must be non-empty strings';
      end if;
      if (p->>'languageId') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$' then return 'languageId may use letters, digits, _ and - only'; end if;
    when 'v1.LanguageRenamed' then
      if not (public._is_str(p->'languageId') and public._is_str(p->'name')) then return 'languageId, name must be non-empty strings'; end if;
    when 'v1.LanguageCountrySet' then
      if not public._is_str(p->'languageId') then return 'languageId must be a non-empty string'; end if;
      if jsonb_typeof(p->'country') is distinct from 'string' or (p->>'country') !~ '^[A-Z]{2}$' then
        return 'country must be an ISO 3166 alpha-2 code';
      end if;
    when 'v1.LanguageTargetSet' then
      if not public._is_str(p->'languageId') then return 'languageId must be a non-empty string'; end if;
      if not public._is_one_of(p->'scope', array['gospels', 'nt', 'ot', 'bible']) then return 'scope must be one of gospels, nt, ot, bible'; end if;
      if not public._is_date(p->'startDate') then return 'startDate must be a YYYY-MM-DD date'; end if;
      if not public._is_date(p->'targetDate') then return 'targetDate must be a YYYY-MM-DD date'; end if;
      if not ((p->>'targetDate') collate "C" > (p->>'startDate') collate "C") then return 'targetDate must be after startDate'; end if;
    when 'v1.ReferenceRecommended' then
      if not public._is_str(p->'itemId') then return 'itemId must be a non-empty string'; end if;
      if not public._is_bool(p->'recommended') then return 'recommended must be a boolean'; end if;
    when 'v1.LibraryItemDefined' then
      if not public._is_str(p->'name') then return 'name must be a non-empty string'; end if;
      if jsonb_typeof(p->'description') is distinct from 'string' then return 'description must be a string'; end if;
      if p ? 'copiedFrom' and not (jsonb_typeof(p->'copiedFrom') = 'object' and public._is_str(p->'copiedFrom'->'orgId')
        and public._is_str(p->'copiedFrom'->'orgName') and public._is_str(p->'copiedFrom'->'itemId')
        and public._is_hash(p->'copiedFrom'->'docHash')) then
        return 'copiedFrom needs orgId, orgName, itemId and a docHash';
      end if;
    when 'v1.LibraryVersionPublished' then
      if not public._is_hash(p->'docHash') then return 'docHash must be a SHA-256 hex digest'; end if;
      if not public._is_opt_str(p->'note') then return 'note must be a string'; end if;
    when 'v1.LibrarySharingSet' then
      if not (public._is_bool(p->'shared') and public._is_bool(p->'subscribable')) then return 'shared, subscribable must be booleans'; end if;
    when 'v1.LibraryItemArchived' then
      if not public._is_bool(p->'archived') then return 'archived must be a boolean'; end if;
    when 'v1.LibrarySubscribed' then
      if not (public._is_str(p->'sourceOrgId') and public._is_str(p->'sourceOrgName') and public._is_str(p->'sourceItemId')
        and public._is_str(p->'name')) then
        return 'sourceOrgId, sourceOrgName, sourceItemId, name must be non-empty strings';
      end if;
      if not (public._is_bool(p->'autoUpdate') and public._is_bool(p->'active')) then return 'autoUpdate, active must be booleans'; end if;
    when 'v1.LibraryPinned' then
      if not public._is_hash(p->'docHash') then return 'docHash must be a SHA-256 hex digest'; end if;
    -- ---- either stream
    when 'v1.Redacted' then
      if not public._is_str(p->'eventId') then return 'eventId must be a non-empty string'; end if;
      if not public._is_opt_str(p->'reason') then return 'reason must be a string'; end if;
    -- ---- language stream
    when 'v1.TemplateSelected' then
      if not (public._is_str(p->'itemId') and public._is_str(p->'unitPrefix')) then return 'itemId, unitPrefix must be non-empty strings'; end if;
      if not public._is_hash(p->'docHash') then return 'docHash must be a SHA-256 hex digest'; end if;
      if (p->>'unitPrefix') ~ '[/[:space:]]' then return 'unitPrefix may not contain / or spaces'; end if;
      if p ? 'books' then
        if jsonb_typeof(p->'books') <> 'array' then return 'books must be USFM book codes'; end if;
        for x in select * from jsonb_array_elements(p->'books') loop
          if jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ '^[A-Z0-9]{3}$' then return 'books must be USFM book codes'; end if;
        end loop;
      end if;
    when 'v1.UnitAdded' then
      if not (public._is_str(p->'unitId') and public._is_str(p->'kind') and public._is_str(p->'label') and public._is_str(p->'order')) then
        return 'unitId, kind, label, order must be non-empty strings';
      end if;
      if not (jsonb_typeof(p->'parentUnitId') is not distinct from 'null' or public._is_str(p->'parentUnitId')) then return 'parentUnitId must be a non-empty string'; end if;
    when 'v1.UnitHidden' then
      if not public._is_str(p->'unitId') then return 'unitId must be a non-empty string'; end if;
      if not public._is_bool(p->'hidden') then return 'hidden must be a boolean'; end if;
    when 'v1.FlowSelected' then
      if not public._is_str(p->'flowId') then return 'flowId must be a non-empty string'; end if;
      if (p->>'flowId') ~ '[/@[:space:]]' then return 'flowId may not contain /, @ or spaces'; end if;
      if not (public._is_opt_str(p->'itemId') and public._is_opt_str(p->'name')) then return 'itemId, name must be strings'; end if;
      if p ? 'docHash' and not public._is_hash(p->'docHash') then return 'docHash must be a SHA-256 hex digest'; end if;
    when 'v1.FlowStepSet' then
      if not (public._is_str(p->'stepId') and public._is_str(p->'order')) then return 'stepId, order must be non-empty strings'; end if;
      if not public._is_str_array(p->'kindIds') then return 'kindIds must be a string array'; end if;
      if not public._is_bool(p->'checkpoint') then return 'checkpoint must be a boolean'; end if;
    when 'v1.FlowStepRemoved' then
      if not public._is_str(p->'stepId') then return 'stepId must be a non-empty string'; end if;
    when 'v1.ReviewKindDefined' then
      if not (public._is_str(p->'kindId') and public._is_str(p->'name')) then return 'kindId, name must be non-empty strings'; end if;
      if not (public._is_opt_str(p->'description') and public._is_opt_str(p->'usualReviewer')) then return 'description, usualReviewer must be strings'; end if;
      if p ? 'withholdsContext' and not public._is_bool(p->'withholdsContext') then return 'withholdsContext must be a boolean'; end if;
      if p ? 'produces' and not (jsonb_typeof(p->'produces') = 'object' and public._is_str(p->'produces'->'what')
        and public._is_str(p->'produces'->'into') and public._is_str(p->'produces'->'action') and public._is_str(p->'produces'->'checkedBy')) then
        return 'produces needs what, into, action, checkedBy';
      end if;
    when 'v1.ReviewTeamDefined' then
      if not (public._is_str(p->'teamId') and public._is_str(p->'name')) then return 'teamId, name must be non-empty strings'; end if;
    when 'v1.ReviewTeamMemberSet' then
      if not (public._is_str(p->'teamId') and public._is_str(p->'profileId')) then return 'teamId, profileId must be non-empty strings'; end if;
      if not public._is_bool(p->'member') then return 'member must be a boolean'; end if;
    when 'v1.ReviewTeamKindSet' then
      if not public._is_str(p->'teamId') then return 'teamId must be a non-empty string'; end if;
      if not (jsonb_typeof(p->'kindId') is not distinct from 'null' or public._is_str(p->'kindId')) then return 'kindId must be a string or null'; end if;
    when 'v1.RecordingAdded' then
      if not (public._is_str(p->'recordingId') and public._is_str(p->'unitId')) then return 'recordingId, unitId must be non-empty strings'; end if;
      if not public._is_one_of(p->'kind', array['source', 'target']) then return 'kind must be source or target'; end if;
      if not public._is_cards(p->'cards') then return 'cards must be cards'; end if;
    when 'v1.TakeComposed' then
      if not (public._is_str(p->'takeId') and public._is_str(p->'unitId')) then return 'takeId, unitId must be non-empty strings'; end if;
      if not public._is_str_array(p->'cardHashes') then return 'cardHashes must be a string array'; end if;
      if not (jsonb_typeof(p->'parentTakeId') is not distinct from 'null' or public._is_str(p->'parentTakeId')) then return 'parentTakeId must be a non-empty string'; end if;
    when 'v1.TakeArchived' then
      if not public._is_str(p->'takeId') then return 'takeId must be a non-empty string'; end if;
    when 'v1.TakeSubmitted' then
      if not public._is_str(p->'takeId') then return 'takeId must be a non-empty string'; end if;
      if p ? 'questionSetIds' and not public._is_str_array(p->'questionSetIds') then return 'questionSetIds must be a string array'; end if;
    when 'v1.ResponseRecorded' then
      if not (public._is_str(p->'takeId') and public._is_str(p->'respondsToTakeId')) then return 'takeId, respondsToTakeId must be non-empty strings'; end if;
      if not (public._is_opt_str(p->'note') and public._is_opt_str(p->'blobHash')) then return 'note, blobHash must be strings'; end if;
    when 'v1.ReviewRecorded' then
      if not (public._is_str(p->'reviewId') and public._is_str(p->'takeId') and public._is_str(p->'kindId')) then return 'reviewId, takeId, kindId must be non-empty strings'; end if;
      if not public._is_one_of(p->'outcome', array['looks_good', 'needs_changes', 'recorded']) then return 'outcome must be one of looks_good, needs_changes, recorded'; end if;
      if not public._is_one_of(p->'via', array['app', 'link', 'logged']) then return 'via must be one of app, link, logged'; end if;
      if not (public._is_opt_str(p->'comment') and public._is_opt_str(p->'commentBlobHash') and public._is_opt_str(p->'place')
        and public._is_opt_str(p->'givenBy') and public._is_opt_str(p->'requestId')) then return 'comment, commentBlobHash, place, givenBy, requestId must be strings'; end if;
      if not (public._is_str_map(p->'answers') and public._is_str_map(p->'skipped')) then return 'answers and skipped must map ids to strings'; end if;
      if p ? 'people' and not (case when jsonb_typeof(p->'people') = 'number' then (p->>'people')::numeric >= 0 else false end) then return 'people must be a number'; end if;
      if p ? 'artifacts' and not public._is_cards(p->'artifacts') then return 'artifacts must be cards'; end if;
      if p->>'outcome' = 'recorded' and (jsonb_typeof(p->'artifacts') is distinct from 'array' or jsonb_array_length(p->'artifacts') = 0) then
        return 'recorded needs artifacts';
      end if;
    when 'v1.DepartureRecorded' then
      if not (public._is_str(p->'departureId') and public._is_str(p->'unitId') and public._is_str(p->'reason')) then
        return 'departureId, unitId, reason must be non-empty strings';
      end if;
      if not public._is_one_of(p->'type', array['skip', 'override', 'keep']) then return 'type must be one of skip, override, keep'; end if;
      if not (public._is_opt_str(p->'kindId') and public._is_opt_str(p->'stepId') and public._is_opt_str(p->'reviewId') and public._is_opt_str(p->'reasonBlobHash')) then
        return 'kindId, stepId, reviewId, reasonBlobHash must be strings';
      end if;
      if p->>'type' = 'skip' and not public._is_str(p->'kindId') then return 'skip needs kindId'; end if;
      if p->>'type' = 'override' and not public._is_str(p->'stepId') then return 'override needs stepId'; end if;
      if p->>'type' = 'keep' and not public._is_str(p->'reviewId') then return 'keep needs reviewId'; end if;
    when 'v1.DepartureUndone' then
      if not public._is_str(p->'departureId') then return 'departureId must be a non-empty string'; end if;
    when 'v1.RequestMade' then
      if not (public._is_str(p->'requestId') and public._is_str(p->'unitId')) then return 'requestId, unitId must be non-empty strings'; end if;
      if not public._is_one_of(p->'what', array['record', 'review']) then return 'what must be one of record, review'; end if;
      if not (public._is_opt_str(p->'kindId') and public._is_opt_str(p->'profileId') and public._is_opt_str(p->'teamId')
        and public._is_opt_str(p->'dueDate') and public._is_opt_str(p->'note') and public._is_opt_str(p->'noteBlobHash')) then
        return 'kindId, profileId, teamId, dueDate, note, noteBlobHash must be strings';
      end if;
      if p->>'what' = 'review' and not public._is_str(p->'kindId') then return 'a review request needs kindId'; end if;
      if p ? 'guest' and not (jsonb_typeof(p->'guest') = 'object' and public._is_str(p->'guest'->'name')
        and public._is_str(p->'guest'->'contact') and public._is_one_of(p->'guest'->'channel', array['whatsapp', 'sms'])) then
        return 'guest needs name, channel, contact';
      end if;
      if p ? 'questions' then
        if jsonb_typeof(p->'questions') <> 'array' then return 'questions must be id, text, type'; end if;
        for x in select * from jsonb_array_elements(p->'questions') loop
          if jsonb_typeof(x) <> 'object' or not public._is_str(x->'id') or not public._is_str(x->'text')
            or not public._is_one_of(x->'type', array['rating', 'yesno', 'text'])
            or (x ? 'required' and not public._is_bool(x->'required')) then
            return 'questions must be id, text, type';
          end if;
        end loop;
      end if;
      select count(*) into n from unnest(array['profileId', 'guest', 'teamId']) k where p ? k and (p->k) <> '""'::jsonb;
      if n <> 1 then return 'exactly one of profileId, guest, teamId'; end if;
    when 'v1.RequestWithdrawn' then
      if not public._is_str(p->'requestId') then return 'requestId must be a non-empty string'; end if;
    when 'v1.NoteAdded' then
      if not (public._is_str(p->'noteId') and public._is_str(p->'unitId')) then return 'noteId, unitId must be non-empty strings'; end if;
      if not (public._is_opt_str(p->'text') and public._is_opt_str(p->'blobHash') and public._is_opt_str(p->'photoHash') and public._is_opt_str(p->'onTakeId')) then
        return 'text, blobHash, photoHash, onTakeId must be strings';
      end if;
      if jsonb_typeof(p->'anchor') is distinct from 'object' then return 'anchor must be an object'; end if;
      case p->'anchor'->>'kind'
        when 'passage' then null;
        when 'version' then if not public._is_str(p->'anchor'->'takeId') then return 'anchor.takeId required'; end if;
        when 'verse' then if not public._is_str(p->'anchor'->'verse') then return 'anchor.verse required'; end if;
        when 'study' then if not (public._is_str(p->'anchor'->'guideId') and public._is_str(p->'anchor'->'stepId')) then return 'anchor.guideId and stepId required'; end if;
        when 'term' then if not public._is_str(p->'anchor'->'termId') then return 'anchor.termId required'; end if;
        else return 'anchor.kind must be passage, version, verse, study or term';
      end case;
      if not (public._is_str(p->'text') or public._is_str(p->'blobHash') or public._is_str(p->'photoHash')) then
        return 'a note needs text, audio or a photo';
      end if;
    when 'v1.StudyStepMarked' then
      if not (public._is_str(p->'unitId') and public._is_str(p->'guideId') and public._is_str(p->'stepId')) then
        return 'unitId, guideId, stepId must be non-empty strings';
      end if;
      if not public._is_bool(p->'done') then return 'done must be a boolean'; end if;
    when 'v1.MaterialDefined' then
      if not (public._is_str(p->'materialId') and public._is_str(p->'kind') and public._is_str(p->'title')) then
        return 'materialId, kind, title must be non-empty strings';
      end if;
      if not public._is_opt_str(p->'templateRef') then return 'templateRef must be a string'; end if;
      if jsonb_typeof(p->'scope') is distinct from 'object' or exists (
        select 1 from jsonb_each(p->'scope') e where e.key not in ('unitId', 'stepId') or not public._is_str(e.value)) then
        return 'scope may name a unitId and a stepId only';
      end if;
    when 'v1.MaterialFieldSet' then
      if not (public._is_str(p->'materialId') and public._is_str(p->'fieldId')) then return 'materialId, fieldId must be non-empty strings'; end if;
      if not (public._is_opt_str(p->'text') and public._is_opt_str(p->'blobHash')) then return 'text, blobHash must be strings'; end if;
    when 'v1.MaterialLocked' then
      if not public._is_str(p->'materialId') then return 'materialId must be a non-empty string'; end if;
      if not public._is_bool(p->'locked') then return 'locked must be a boolean'; end if;
    when 'v1.KeyTermDefined' then
      if not (public._is_str(p->'termId') and public._is_str(p->'term')) then return 'termId, term must be non-empty strings'; end if;
      if jsonb_typeof(p->'gloss') is distinct from 'string' then return 'gloss must be a string'; end if;
      if not public._is_str_array(p->'unitScope') then return 'unitScope must be a string array'; end if;
    when 'v1.KeyTermRenderingAdded' then
      if not (public._is_str(p->'termId') and public._is_str(p->'renderingId') and public._is_str(p->'rendering')) then
        return 'termId, renderingId, rendering must be non-empty strings';
      end if;
      if jsonb_typeof(p->'context') is distinct from 'string' then return 'context must be a string'; end if;
    when 'v1.KeyTermAdjusted' then
      if not (public._is_str(p->'termId') and public._is_str(p->'adjustmentId')) then return 'termId, adjustmentId must be non-empty strings'; end if;
      if jsonb_typeof(p->'note') is distinct from 'string' then return 'note must be a string'; end if;
      if not (public._is_opt_str(p->'blobHash') and public._is_opt_str(p->'duringTakeId')) then return 'blobHash, duringTakeId must be strings'; end if;
    when 'v1.KeyTermLinked' then
      if not (public._is_str(p->'takeId') and public._is_str(p->'termId')) then return 'takeId, termId must be non-empty strings'; end if;
      if not (public._is_opt_str(p->'note') and public._is_opt_str(p->'adjustmentId')) then return 'note, adjustmentId must be strings'; end if;
    when 'v1.ReferenceSet' then
      if not public._is_str(p->'itemId') then return 'itemId must be a non-empty string'; end if;
      if not public._is_one_of(p->'state', array['recommended', 'hidden', 'inherit']) then return 'state must be one of recommended, hidden, inherit'; end if;
    when 'v1.PassageReferenceLinked' then
      if not (public._is_str(p->'unitId') and public._is_str(p->'itemId')) then return 'unitId, itemId must be non-empty strings'; end if;
      if not public._is_bool(p->'linked') then return 'linked must be a boolean'; end if;
    when 'v1.ReferencesUsed' then
      if not public._is_str(p->'unitId') then return 'unitId must be a non-empty string'; end if;
      if (p ? 'takeId')::int + (p ? 'reviewId')::int <> 1 then return 'exactly one of takeId, reviewId'; end if;
      if (p ? 'takeId' and not public._is_str(p->'takeId')) or (p ? 'reviewId' and not public._is_str(p->'reviewId')) then
        return 'takeId or reviewId must be non-empty';
      end if;
      return public._used_items_error(p->'items');
    when 'v1.BlobStored' then
      if not public._is_str(p->'hash') then return 'hash must be a non-empty string'; end if;
      if jsonb_typeof(p->'size') is distinct from 'number' then return 'size must be a number'; end if;
    when 'v1.BlobInvalidated' then
      if not public._is_str(p->'hash') then return 'hash must be a non-empty string'; end if;
      if not public._is_opt_str(p->'reason') then return 'reason must be a string'; end if;
    else null;
  end case;
  return null;
end $$;

-- ---- the organization fold (core applyOrgEvent) -------------------------------------
-- What the write path needs from the organization stream, kept as it is
-- appended: roles, memberships, languages, the library. Registers are later
-- (clock, then event id) wins, the same tie-break as core, so the rows equal
-- a fold of the stream in any order.

create or replace function public._lib_later(p_cur_hlc text, p_cur_event text, p_hlc text, p_event text)
returns boolean language sql immutable as $$
  select p_cur_hlc = '' or p_cur_hlc collate "C" < p_hlc collate "C"
    or (p_cur_hlc = p_hlc and p_cur_event collate "C" < p_event collate "C");
$$;
create or replace function public._lib_earlier(p_cur_hlc text, p_cur_event text, p_hlc text, p_event text)
returns boolean language sql immutable as $$
  select p_cur_hlc = '' or p_hlc collate "C" < p_cur_hlc collate "C"
    or (p_cur_hlc = p_hlc and p_event collate "C" < p_cur_event collate "C");
$$;

create or replace function public._apply_org_event(p_org text, p_id text, p_type text, p jsonb, p_hlc text, p_actor text)
returns void language plpgsql set search_path = '' as $$
declare v_key text; v_lang text := p->>'languageId';
begin
  if p_type = 'v1.RoleDefined' then
    insert into public.org_roles (org_id, role_id) values (p_org, p->>'roleId') on conflict do nothing;
    update public.org_roles r
      set name = p->>'name', privileges = array(select jsonb_array_elements_text(p->'privileges') order by 1), hlc = p_hlc, event_id = p_id
      where r.org_id = p_org and r.role_id = p->>'roleId' and public._lib_later(r.hlc, r.event_id, p_hlc, p_id);
  elsif p_type = 'v1.RoleRetired' then
    insert into public.org_roles (org_id, role_id, retired) values (p_org, p->>'roleId', true)
    on conflict (org_id, role_id) do update set retired = true;
  elsif p_type in ('v1.MemberAdded', 'v1.MemberRemoved') then
    v_key := public._scope_key(p->'scope');
    insert into public.org_memberships (org_id, profile_id, scope_key, scope_level, language_id)
    values (p_org, p->>'profileId', v_key, p->'scope'->>'level', p->'scope'->>'languageId')
    on conflict do nothing;
    if p_type = 'v1.MemberAdded' then
      update public.org_memberships m set role_id = p->>'roleId', role_hlc = p_hlc, role_event = p_id
        where m.org_id = p_org and m.profile_id = p->>'profileId' and m.scope_key = v_key
          and public._lib_later(m.role_hlc, m.role_event, p_hlc, p_id);
    end if;
    update public.org_memberships m set removed = (p_type = 'v1.MemberRemoved'), removed_hlc = p_hlc, removed_event = p_id
      where m.org_id = p_org and m.profile_id = p->>'profileId' and m.scope_key = v_key
        and public._lib_later(m.removed_hlc, m.removed_event, p_hlc, p_id);
  elsif p_type in ('v1.LanguageAdded', 'v1.LanguageRenamed', 'v1.LanguageCountrySet', 'v1.LanguageTargetSet') then
    insert into public.languages (org_id, language_id) values (p_org, v_lang) on conflict do nothing;
    case p_type
      when 'v1.LanguageAdded' then
        update public.languages l
          set added_name = p->>'name', code = p->>'code', source_code = p->>'sourceCode', added_hlc = p_hlc, added_event = p_id
          where l.org_id = p_org and l.language_id = v_lang and public._lib_earlier(l.added_hlc, l.added_event, p_hlc, p_id);
      when 'v1.LanguageRenamed' then
        update public.languages l set renamed = p->>'name', renamed_hlc = p_hlc, renamed_event = p_id
          where l.org_id = p_org and l.language_id = v_lang and public._lib_later(l.renamed_hlc, l.renamed_event, p_hlc, p_id);
      when 'v1.LanguageCountrySet' then
        update public.languages l set country = p->>'country', country_hlc = p_hlc, country_event = p_id
          where l.org_id = p_org and l.language_id = v_lang and public._lib_later(l.country_hlc, l.country_event, p_hlc, p_id);
      else
        update public.languages l
          set target = jsonb_build_object('scope', p->'scope', 'startDate', p->'startDate', 'targetDate', p->'targetDate'),
              target_hlc = p_hlc, target_event = p_id
          where l.org_id = p_org and l.language_id = v_lang and public._lib_later(l.target_hlc, l.target_event, p_hlc, p_id);
    end case;
  elsif p_type in ('v1.LibraryItemDefined', 'v1.LibraryVersionPublished', 'v1.LibrarySharingSet',
                   'v1.LibraryItemArchived', 'v1.LibrarySubscribed', 'v1.LibraryPinned') then
    perform public._apply_library_event(p_org, p_id, p_type, p, p_hlc, p_actor);
  end if;
end $$;

-- A language's name as people see it: the latest rename, else the name it
-- was added with (core languageName).
create or replace function public.language_display_name(l public.languages)
returns text language sql immutable as $$
  select coalesce(l.renamed, l.added_name, l.language_id);
$$;

-- ---- invites ---------------------------------------------------------------------------
-- An invite grants one role at one scope (the organization, or one language).
-- The inviter needs Invite (`invite_members`) at that scope; the newcomer's
-- membership is a service event, since they hold nothing to grant it with.

create or replace function public.issue_invite_v3(
  p_org text, p_invite_id text, p_token_hash text, p_role_id text, p_scope jsonb, p_expires_at timestamptz,
  p_label text default null, p_max_uses int default 1
) returns void language plpgsql security definer set search_path = public as $$
declare v_actor text := public.caller_id(); v_label text := nullif(btrim(coalesce(p_label, '')), '');
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if public.is_managed_account(v_actor) then
    raise exception 'add your own email before inviting others' using errcode = '42501';
  end if;
  if public._scope_error(p_scope) is not null then raise exception 'invalid scope' using errcode = '22023'; end if;
  if not ('invite_members' = any(public.org_privileges(p_org, v_actor, p_scope->>'languageId'))) then
    raise exception 'not allowed to invite members' using errcode = '42501';
  end if;
  if p_scope->>'level' = 'language' and not public.language_listed(p_org, p_scope->>'languageId') then
    raise exception 'unknown language' using errcode = '22023';
  end if;
  if p_expires_at <= now() then raise exception 'invite already expired' using errcode = '22023'; end if;
  if not exists (select 1 from public.org_roles r where r.org_id = p_org and r.role_id = p_role_id and not r.retired) then
    raise exception 'unknown role %', p_role_id using errcode = '22023';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' or p_expires_at > now() + interval '90 days' then
    raise exception 'invalid invite' using errcode = '22023';
  end if;
  if p_max_uses is null or p_max_uses not between 1 and 50 then raise exception 'invalid number of uses' using errcode = '22023'; end if;
  if length(v_label) > 80 then raise exception 'label too long' using errcode = '22023'; end if;
  if exists (select 1 from public.invites where id = p_invite_id) then
    if exists (select 1 from public.invites where id = p_invite_id
      and issued_by = v_actor and org_id = p_org and token_hash = p_token_hash
      and role_id = p_role_id and scope = p_scope) then return; end if;
    raise exception 'invite id already used' using errcode = '22023';
  end if;
  insert into public.invites (id, org_id, token_hash, role_id, scope, expires_at, issued_by, label, max_uses)
  values (p_invite_id, p_org, p_token_hash, p_role_id, p_scope, p_expires_at, v_actor, v_label, p_max_uses);

  perform public._append_event_as(
    'invite:' || p_invite_id, p_org, '_org', 'v1.InviteIssued', v_actor, 'server',
    jsonb_build_object('inviteId', p_invite_id, 'roleId', p_role_id, 'scope', p_scope,
                       'expiresAt', to_char(p_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
end $$;

-- The signed-in person redeems for themselves.
create or replace function public.redeem_invite_v2(p_token text)
returns text language plpgsql security definer set search_path = public as $$
begin
  return public.redeem_invite_for(public.caller_id(), p_token);
end $$;

-- Redeem for a named account; only the service role may name someone else.
-- Returns the organization joined.
create or replace function public.redeem_invite_for(p_actor text, p_token text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_hash text := encode(extensions.digest(p_token, 'sha256'), 'hex');
  v_inv record;
  v_used int;
  v_suffix text;
begin
  if p_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  select * into v_inv from public.invites where token_hash = v_hash for update;
  if not found then raise exception 'invite not found' using errcode = '22023'; end if;
  if exists (select 1 from public.invite_redemptions where invite_id = v_inv.id and profile_id = p_actor) then
    return v_inv.org_id;
  end if;
  select count(*) into v_used from public.invite_redemptions where invite_id = v_inv.id;
  if v_used >= v_inv.max_uses then raise exception 'invite already used' using errcode = '22023'; end if;
  if v_inv.expires_at <= now() then raise exception 'invite expired' using errcode = '22023'; end if;
  if not exists (select 1 from public.org_roles where org_id = v_inv.org_id and role_id = v_inv.role_id and not retired) then
    raise exception 'invite role is no longer available' using errcode = '22023';
  end if;

  insert into public.invite_redemptions (invite_id, profile_id) values (v_inv.id, p_actor);
  update public.invites set
    redeemed_by = coalesce(redeemed_by, p_actor),
    redeemed_at = coalesce(redeemed_at, now()),
    -- A one-person label names that person; it is not needed once used.
    label = case when v_used + 1 >= max_uses and max_uses = 1 then null else label end
  where id = v_inv.id;

  -- Who to ask for help: the inviter, shown to the person. It grants nothing (may_help_sign_in).
  if public.is_managed_account(p_actor) then
    insert into public.account_stewards (profile_id, steward_id)
    values (p_actor::uuid, v_inv.issued_by::uuid) on conflict (profile_id) do nothing;
  end if;

  -- The first use keeps the plain ids; later uses of a group invite carry
  -- the person, so each is its own event.
  v_suffix := case when v_used = 0 then '' else ':' || p_actor end;
  perform public._append_event_as(
    'invitemember:' || v_inv.id || v_suffix, v_inv.org_id, '_org', 'v1.MemberAdded', 'service', 'server',
    jsonb_build_object('profileId', p_actor, 'roleId', v_inv.role_id, 'scope', v_inv.scope));
  perform public._append_event_as(
    'inviteredeem:' || v_inv.id || v_suffix, v_inv.org_id, '_org', 'v1.InviteRedeemed', 'service', 'server',
    jsonb_build_object('inviteId', v_inv.id, 'profileId', p_actor));
  return v_inv.org_id;
end $$;

-- What a key means. Holding the token (256 random bits) is the permission.
create or replace function public.preview_invite(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_inv record;
  v_me text := public.caller_id();
  v_used int;
  v_status text;
begin
  if p_token is null or p_token !~ '^[0-9a-fA-F]{32,128}$' then return jsonb_build_object('status', 'not_found'); end if;
  select * into v_inv from public.invites
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select count(*) into v_used from public.invite_redemptions r where r.invite_id = v_inv.id;
  v_status := case
    when v_me is not null and exists (select 1 from public.invite_redemptions r
      where r.invite_id = v_inv.id and r.profile_id = v_me) then 'joined'
    when v_used >= v_inv.max_uses then 'used'
    when v_inv.expires_at <= now() then 'expired'
    when not exists (select 1 from public.org_roles where org_id = v_inv.org_id and role_id = v_inv.role_id and not retired) then 'retired'
    else 'ok' end;
  return jsonb_build_object(
    'status', v_status,
    'orgId', v_inv.org_id,
    'orgName', public.org_name(v_inv.org_id),
    'roleName', (select r.name from public.org_roles r where r.org_id = v_inv.org_id and r.role_id = v_inv.role_id),
    'scopeLevel', v_inv.scope->>'level',
    'languageName', (select public.language_display_name(l) from public.languages l
      where l.org_id = v_inv.org_id and l.language_id = v_inv.scope->>'languageId'),
    'label', v_inv.label,
    'invitedBy', (select p.display_name from public.profiles p where p.id = v_inv.issued_by),
    'group', v_inv.max_uses > 1,
    'expiresAt', v_inv.expires_at
  );
end $$;

-- An organization's name: its latest v1.OrgCreated (core `org` register).
create or replace function public.org_name(p_org text)
returns text language sql stable security definer set search_path = public as $$
  select e.payload->>'name' from public.events e
  where e.org_id = p_org and e.stream_id = '_org' and e.type = 'v1.OrgCreated'
  order by e.hlc collate "C" desc, e.id collate "C" desc limit 1;
$$;

-- ---- join requests ------------------------------------------------------------------
-- Any signed-in person may ask, once per organization. Nothing reaches the
-- log until someone with Invite at org scope decides.

create or replace function public.create_join_request(p_org text, p_request_id text, p_message text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if not exists (select 1 from public.events e where e.org_id = p_org and e.stream_id = '_org') then
    raise exception 'unknown organization' using errcode = '22023';
  end if;
  if exists (select 1 from public.events where id = 'joindecided:' || p_request_id) then return; end if;
  if exists (select 1 from public.org_memberships m where m.org_id = p_org and m.profile_id = v_actor and not m.removed) then
    raise exception 'already a member' using errcode = '22023';
  end if;
  if length(p_message) > 2000 then raise exception 'message too long' using errcode = '22023'; end if;
  insert into public.join_requests (id, org_id, profile_id, message)
  values (p_request_id, p_org, v_actor, coalesce(p_message, ''))
  on conflict (org_id, profile_id) do update set message = excluded.message, created_at = now();
end $$;

-- Declining records the verdict and closes the request; accepting also adds
-- the person at org scope with the chosen role.
create or replace function public.decide_join_request(p_request_id text, p_accepted boolean, p_role_id text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor text := public.caller_id();
  v_req record;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  select * into v_req from public.join_requests where id = p_request_id for update;
  if not found then
    if exists (select 1 from public.events where id = 'joindecided:' || p_request_id and actor_id = v_actor) then return; end if;
    raise exception 'request not found' using errcode = '22023';
  end if;
  if not ('invite_members' = any(public.org_privileges(v_req.org_id, v_actor, null))) then
    raise exception 'not allowed to admit members' using errcode = '42501';
  end if;
  if p_accepted and (p_role_id is null or not exists (
        select 1 from public.org_roles r where r.org_id = v_req.org_id and r.role_id = p_role_id and not r.retired)) then
    raise exception 'a role is required to accept' using errcode = '22023';
  end if;

  perform public._append_event_as(
    'joindecided:' || p_request_id, v_req.org_id, '_org', 'v1.JoinDecided', v_actor, 'server',
    jsonb_build_object('requestId', p_request_id, 'profileId', v_req.profile_id, 'accepted', p_accepted));
  if p_accepted then
    perform public._append_event_as(
      'joinmember:' || p_request_id, v_req.org_id, '_org', 'v1.MemberAdded', v_actor, 'server',
      jsonb_build_object('profileId', v_req.profile_id, 'roleId', p_role_id, 'scope', jsonb_build_object('level', 'org')));
  end if;
  delete from public.join_requests where id = p_request_id;
end $$;

-- ---- signing someone back in ---------------------------------------------------------
-- Whoever could invite a looked-after person to where they are now: Invite at
-- the organization, or at a language the person belongs to. Only accounts
-- without email are helped, and only by someone with their own email.
create or replace function public.may_help_sign_in(p_helper text, p_profile text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_helper is not null and p_helper <> p_profile
    and public.is_managed_account(p_profile)
    and not public.is_managed_account(p_helper)
    and exists (
      select 1
      from public.org_memberships m
      join public.org_memberships h on h.org_id = m.org_id and h.profile_id = p_helper and not h.removed
      join public.org_roles r on r.org_id = h.org_id and r.role_id = h.role_id and not r.retired
      where m.profile_id = p_profile and not m.removed
        and 'invite_members' = any(r.privileges)
        and (h.scope_level = 'org' or (m.scope_level = 'language' and h.language_id = m.language_id))
    );
$$;

create or replace function public.can_help_sign_in(p_profile text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.may_help_sign_in(public.caller_id(), p_profile);
$$;

-- ---- a person's stream ---------------------------------------------------------------
-- Organization '_person', stream = the profile id. Written only here, read
-- only by its owner (can_read_stream).
create or replace function public.record_user_event(p_id text, p_type text, p_payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if p_id is null or length(p_id) > 256 or p_id not like v_actor || ':%' then
    raise exception 'invalid event id' using errcode = '22023';
  end if;
  if p_type not in ('v1.TermsAccepted','v1.VisionSeen','v1.WalkthroughDone')
    or p_type is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'invalid user event' using errcode = '22023';
  end if;
  if p_type = 'v1.TermsAccepted' and (
    not public._is_str(p_payload->'version') or length(p_payload->>'version') > 100
  ) then raise exception 'terms version required' using errcode = '22023'; end if;
  perform public._append_event_as(p_id, '_person', v_actor, p_type, v_actor, 'server', p_payload);
end $$;

create or replace function public.get_user_state()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'termsVersion', (select payload->>'version' from public.events
      where org_id = '_person' and stream_id = public.caller_id()
        and type = 'v1.TermsAccepted' order by server_seq desc limit 1),
    'visionSeen', exists(select 1 from public.events where org_id = '_person'
      and stream_id = public.caller_id() and type = 'v1.VisionSeen'),
    'walkthroughDone', exists(select 1 from public.events where org_id = '_person'
      and stream_id = public.caller_id() and type = 'v1.WalkthroughDone'));
$$;

-- Navigation: the organizations the caller belongs to, at any scope. Their
-- languages come from each organization's stream.
create or replace function public.my_organizations()
returns table(org_id text, name text)
language sql stable security definer set search_path = '' as $$
  select distinct m.org_id, coalesce(public.org_name(m.org_id), m.org_id)
  from public.org_memberships m
  where m.profile_id = public.caller_id() and not m.removed;
$$;

create or replace function public.profile_visible(p_profile text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.caller_id() is not null and (
    p_profile = public.caller_id() or exists (
      select 1 from public.org_memberships me
      join public.org_memberships other on other.org_id = me.org_id
      where me.profile_id = public.caller_id() and not me.removed
        and other.profile_id = p_profile and not other.removed
    )
  );
$$;

-- ---- public listing and notifications --------------------------------------------------

create or replace function public.set_language_visibility(p_org text, p_language text, p_listed boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.caller_id() is null or not ('manage_structure' = any(
    public.org_privileges(p_org, public.caller_id(), p_language))) then
    raise exception 'Structure management permission required.' using errcode = '42501';
  end if;
  insert into public.language_visibility values (p_org, p_language, p_listed)
    on conflict (org_id, language_id) do update set listed = excluded.listed;
  if not p_listed then delete from public.public_languages where org_id = p_org and language_id = p_language; end if;
end $$;

-- A projection pass replaces one language's Inbox rows (or the
-- organization's, with a null language) atomically. The sequence advances
-- only when a row changes, including becoming inactive, for cursor pulls.
create or replace function public.reconcile_notifications(p_org text, p_language text, p_rows jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications n set active = false, seq = default
    where n.org_id = p_org and n.language_id is not distinct from p_language and n.active
      and not exists (select 1 from jsonb_array_elements(p_rows) r where r->>'id' = n.id);
  insert into public.notifications (id, profile_id, org_id, language_id, kind, title, task_id, unit_id)
    select r->>'id', r->>'profile_id', p_org, p_language, r->>'kind', r->>'title', r->>'task_id', r->>'unit_id'
    from jsonb_array_elements(p_rows) r
    on conflict (id) do update set active = true, title = excluded.title, seq = default
      where not notifications.active or notifications.title <> excluded.title;
end $$;

create or replace function public.claim_notification_pushes()
returns setof public.notifications language sql security definer set search_path = '' as $$
  update public.notifications n set push_lease_until = now() + interval '5 minutes'
  where id in (select id from public.notifications
    where active and pushed_at is null
      and exists (select 1 from public.push_tokens t where t.profile_id = notifications.profile_id)
      and (push_lease_until is null or push_lease_until < now())
    order by seq limit 100 for update skip locked)
  returning n.*;
$$;

-- ---- moderation (decision 46) ----------------------------------------------------------
-- A report is about something on a language's record, or about a person
-- (the organization's; language null).

-- The events that hold one reported thing in a language stream.
create or replace function public._content_events(p_org text, p_language text, p_kind text, p_target text)
returns table(event_id text, actor_id text, redacted boolean)
language sql stable security definer set search_path = public as $$
  select e.id, e.actor_id, exists (
    select 1 from public.events r
     where r.org_id = e.org_id and r.stream_id = e.stream_id
       and r.type = 'v1.Redacted' and r.payload->>'eventId' = e.id)
  from public.events e
  where e.org_id = p_org and e.stream_id = p_language and (
    (p_kind = 'note' and e.type = 'v1.NoteAdded' and e.payload->>'noteId' = p_target)
    or (p_kind = 'request' and e.type = 'v1.RequestMade' and e.payload->>'requestId' = p_target)
    or (p_kind = 'review' and e.type = 'v1.ReviewRecorded' and e.payload->>'reviewId' = p_target)
    or (p_kind = 'version' and e.type in ('v1.TakeComposed', 'v1.TakeSubmitted', 'v1.ResponseRecorded')
        and e.payload->>'takeId' = p_target)
    -- A version's "what changed" note is part of the version.
    or (p_kind = 'version' and e.type = 'v1.NoteAdded'
        and e.payload->'anchor'->>'kind' = 'version' and e.payload->'anchor'->>'role' = 'change'
        and e.payload->'anchor'->>'takeId' = p_target));
$$;

-- Report something, from the phone's account outbox. Only what the caller
-- may read can be reported, and only by its maker's id.
create or replace function public.report_content(
  p_id text, p_org text, p_language text, p_kind text, p_target text, p_profile text,
  p_reason text, p_details text default null, p_unit text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if p_id is null or length(p_id) not between 1 and 100 then
    raise exception 'invalid report id' using errcode = '22023';
  end if;
  if exists (select 1 from public.content_reports r where r.id = p_id) then
    if exists (select 1 from public.content_reports r where r.id = p_id and r.reporter_id = v_actor) then return; end if;
    raise exception 'report id already used' using errcode = '22023';
  end if;
  if p_org is null
     or p_kind is null or p_kind not in ('version', 'review', 'note', 'request', 'person')
     or p_reason is null or p_reason not in ('offensive', 'sexual', 'harassment', 'violence', 'spam', 'other')
     or p_target is null or length(p_target) not between 1 and 300
     or p_profile is null or length(p_profile) > 100
     or length(p_details) > 1000 or length(p_unit) > 300 then
    raise exception 'invalid report' using errcode = '22023';
  end if;
  if (p_kind = 'person') <> (p_language is null) then
    raise exception 'invalid report' using errcode = '22023';
  end if;
  if not public.can_read_stream(p_org, coalesce(p_language, '_org'), v_actor) then
    raise exception 'Only members can report what is in an organization.' using errcode = '42501';
  end if;
  if p_profile = v_actor then
    raise exception 'You cannot report yourself.' using errcode = '22023';
  end if;
  if p_kind = 'person' then
    if p_target <> p_profile or not exists (select 1 from public.org_memberships m
                                             where m.org_id = p_org and m.profile_id = p_profile) then
      raise exception 'That person is not in this organization.' using errcode = '22023';
    end if;
  else
    if not exists (select 1 from public._content_events(p_org, p_language, p_kind, p_target) c
                    where c.actor_id = p_profile) then
      raise exception 'That is not on the record.' using errcode = '22023';
    end if;
    -- Already taken out of the record: nothing left to act on.
    if not exists (select 1 from public._content_events(p_org, p_language, p_kind, p_target) c
                    where not c.redacted) then return; end if;
  end if;
  if (select count(*) from public.content_reports r
       where r.reporter_id = v_actor and r.created_at > now() - interval '1 day') >= 50 then
    raise exception 'That is a lot of reports for one day. Email admin@frontierrnd.com instead.' using errcode = '22023';
  end if;
  insert into public.content_reports (id, org_id, language_id, target_kind, target_id, unit_id,
    reported_profile, reporter_id, reason, details)
  values (p_id, p_org, p_language, p_kind, p_target, p_unit,
    p_profile, v_actor, p_reason, nullif(trim(p_details), ''));
end $$;

-- May this person act on reports? Content needs what v1.Redacted needs
-- (manage_structure) for that language; a person needs what removing a
-- member needs (invite_members), organization-wide.
create or replace function public._may_moderate(p_org text, p_language text, p_kind text, p_profile text)
returns boolean language sql stable security definer set search_path = public as $$
  select case when p_kind = 'person'
    then 'invite_members' = any(public.org_privileges(p_org, p_profile, null))
    else 'manage_structure' = any(public.org_privileges(p_org, p_profile, p_language)) end;
$$;

-- An organization's open reports, for those who may act on them. Never who
-- reported, and never reports about the caller (staff see those).
create or replace function public.org_content_reports(p_org text)
returns table(id text, language_id text, target_kind text, target_id text, unit_id text,
  reported_profile text, reason text, details text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.language_id, r.target_kind, r.target_id, r.unit_id,
         r.reported_profile, r.reason, r.details, r.created_at
    from public.content_reports r
   where r.org_id = p_org and r.resolved_at is null
     and public.caller_id() is not null
     and r.reported_profile <> public.caller_id()
     and public._may_moderate(r.org_id, r.language_id, r.target_kind, public.caller_id())
   order by r.created_at
   limit 200;
$$;

-- Take content out of the record: v1.Redacted for every event that holds it,
-- as the person who decided, so every phone's fold drops it. Closes the open
-- reports about it. Returns how many events were redacted.
create or replace function public._remove_content(
  p_org text, p_language text, p_kind text, p_target text, p_actor text, p_reason text
) returns int language plpgsql security definer set search_path = public as $$
declare
  v_count int := 0;
  c record;
begin
  if p_kind is null or p_kind not in ('version', 'review', 'note', 'request') or p_language is null then
    raise exception 'Only something on the record can be removed.' using errcode = '22023';
  end if;
  for c in select * from public._content_events(p_org, p_language, p_kind, p_target) where not redacted loop
    if public._append_event_as('removed:' || c.event_id, p_org, p_language, 'v1.Redacted', p_actor, 'server',
         jsonb_build_object('eventId', c.event_id, 'reason', left(coalesce(nullif(trim(p_reason), ''), 'reported'), 200)))
       is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  update public.content_reports r set resolved_at = now(), resolved_by = p_actor, resolution = 'removed'
   where r.org_id = p_org and r.language_id = p_language and r.target_kind = p_kind
     and r.target_id = p_target and r.resolved_at is null;
  return v_count;
end $$;

-- From the app: a moderator removes something, reported or not.
create or replace function public.remove_content(
  p_org text, p_language text, p_kind text, p_target text, p_reason text default null
) returns int language plpgsql security definer set search_path = public as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if not public._may_moderate(p_org, p_language, p_kind, v_actor) then
    raise exception 'Only someone who manages this language can remove things from its record.' using errcode = '42501';
  end if;
  return public._remove_content(p_org, p_language, p_kind, p_target, v_actor, p_reason);
end $$;

-- From the app: a moderator looked and leaves it. Closes every open report
-- about that one thing or person.
create or replace function public.dismiss_reports(p_org text, p_language text, p_kind text, p_target text)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if not public._may_moderate(p_org, p_language, p_kind, v_actor) then
    raise exception 'Only someone who manages this language can answer its reports.' using errcode = '42501';
  end if;
  update public.content_reports r set resolved_at = now(), resolved_by = v_actor, resolution = 'dismissed'
   where r.org_id = p_org and r.language_id is not distinct from p_language and r.target_kind = p_kind
     and r.target_id = p_target and r.resolved_at is null and r.reported_profile <> v_actor;
end $$;

-- For staff (npm run moderation, or the Supabase SQL editor). Service role
-- only; the actor on a redaction is 'service'.
create or replace function public.staff_resolve_report(p_report text, p_action text)
returns int language plpgsql security definer set search_path = public as $$
declare r public.content_reports;
begin
  select * into r from public.content_reports where id = p_report;
  if not found then raise exception 'no report %', p_report using errcode = '22023'; end if;
  if p_action = 'remove' then
    return public._remove_content(r.org_id, r.language_id, r.target_kind, r.target_id, 'service', 'removed by LangQuest staff');
  elsif p_action = 'dismiss' then
    update public.content_reports c set resolved_at = now(), resolved_by = 'service', resolution = 'dismissed'
     where c.org_id = r.org_id and c.language_id is not distinct from r.language_id and c.target_kind = r.target_kind
       and c.target_id = r.target_id and c.resolved_at is null;
    return 0;
  end if;
  raise exception 'action is remove or dismiss' using errcode = '22023';
end $$;

-- ---- account deletion (decision 46) ---------------------------------------------------
-- Leaves every organization (a service MemberRemoved per scope held), then
-- forgets the person's tokens, Inbox, profile, diagnostics, blocks and that
-- they reported anything. Their work stays on the record under their id.
create or replace function public._delete_account(p_actor text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  m record;
begin
  if p_actor is null or p_actor = '' then raise exception 'no account' using errcode = '22023'; end if;
  select u.email into v_email from auth.users u where u.id::text = p_actor;

  for m in select om.org_id, om.scope_key, om.scope_level, om.language_id
             from public.org_memberships om
            where om.profile_id = p_actor and not om.removed loop
    perform public._append_event_as('accountdeleted:' || p_actor || ':' || m.scope_key,
      m.org_id, '_org', 'v1.MemberRemoved', 'service', 'server',
      jsonb_build_object('profileId', p_actor, 'scope', jsonb_strip_nulls(jsonb_build_object(
        'level', m.scope_level, 'languageId', m.language_id))));
  end loop;

  delete from public.push_receipts r using public.push_tokens t
    where r.token = t.token and t.profile_id = p_actor;
  delete from public.push_tokens where profile_id = p_actor;
  delete from public.notifications where profile_id = p_actor;
  delete from public.join_requests where profile_id = p_actor;
  delete from public.profiles where id = p_actor;
  if v_email is not null then
    update public.invites set email = null where lower(email) = lower(v_email);
  end if;
  delete from diag.records where delivered_by = p_actor;
  delete from diag.installs where profile_id = p_actor;
  update storage.objects set owner = null, owner_id = null where owner_id = p_actor;
  delete from public.user_blocks where blocker_id = p_actor or blocked_id = p_actor;
  update public.content_reports set reporter_id = null where reporter_id = p_actor;

  delete from auth.users where id::text = p_actor;
end $$;

-- ---- accounts, sign-in codes, the library, timing jobs ----------------------------------
-- Unchanged from the migrations they came from but for the stream names.

create or replace function public.save_profile(p_display_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if length(trim(p_display_name)) not between 1 and 100 or p_display_name is null then
    raise exception 'Use a name between 1 and 100 characters.' using errcode = '22023';
  end if;
  insert into public.profiles(id, display_name) values(v_actor, trim(p_display_name))
  on conflict(id) do update set display_name = excluded.display_name, updated_at = now();
end $$;

create or replace function public.register_push_token(p_token text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.caller_id() is null then raise exception 'sign in required' using errcode='42501'; end if;
  if p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' or length(p_token)>200 then
    raise exception 'invalid push token' using errcode='22023';
  end if;
  insert into public.push_tokens(token,profile_id) values(p_token,public.caller_id())
    on conflict(token) do update set profile_id=excluded.profile_id,updated_at=now();
end $$;

create or replace function public.unregister_push_token(p_token text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_tokens where token=p_token and profile_id=public.caller_id();
$$;

-- The one definition of a looked-after account. The phone has the same rule
-- (apps/mobile/src/accounts.ts MANAGED_DOMAIN).
create or replace function public.is_managed_email(p_email text)
returns boolean language sql immutable as $$
  select coalesce(lower(p_email) like '%@people.langquest.org', false);
$$;

create or replace function public.is_managed_account(p_profile text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select public.is_managed_email(u.email::text) from auth.users u where u.id::text = p_profile), false);
$$;

-- suspend_account (20260930220000) set banned_until to 'infinity', which the
-- auth server cannot read: a suspended person saw "Database error querying
-- schema" instead of "User is banned". A date a century out reads as a ban
-- and lasts as long (decisions.md 48).
create or replace function public.suspend_account(p_profile text, p_suspended boolean default true)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update auth.users set banned_until = case when p_suspended then now() + interval '100 years' end
   where id::text = p_profile;
  return found;
end $$;

create or replace function public.set_blocked(p_profile text, p_blocked boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if p_profile is null or length(p_profile) not between 1 and 100 or p_blocked is null then
    raise exception 'invalid block' using errcode = '22023';
  end if;
  if p_profile = v_actor then raise exception 'You cannot block yourself.' using errcode = '22023'; end if;
  if p_blocked then
    if (select count(*) from public.user_blocks where blocker_id = v_actor) >= 1000 then
      raise exception 'You have blocked as many people as one account can.' using errcode = '22023';
    end if;
    insert into public.user_blocks (blocker_id, blocked_id) values (v_actor, p_profile)
      on conflict do nothing;
  else
    delete from public.user_blocks where blocker_id = v_actor and blocked_id = p_profile;
  end if;
end $$;

-- From the app: the signed-in person deletes themselves.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  perform public._delete_account(v_actor);
end $$;

-- For staff, answering an emailed request (langquest.org/en/next/delete-account):
-- in the Supabase SQL editor, select public.delete_account_for_email('them@example.org');
-- Returns false when no account has that email. Never callable from the app.
create or replace function public.delete_account_for_email(p_email text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  select u.id::text into v_id from auth.users u where lower(u.email) = lower(trim(p_email));
  if v_id is null then return false; end if;
  perform public._delete_account(v_id);
  return true;
end $$;

-- The old signature (builds in review) makes a code that keeps the old phone.
create or replace function public.issue_sign_in_code(p_profile text, p_code_hash text)
returns text language sql security definer set search_path = public as $$
  select public.issue_sign_in_code_v2(p_profile, p_code_hash, false);
$$;

-- Service role only (the Edge Function): take a key once. Returns the
-- account and its address, or nothing for a used, expired or unknown key,
-- or one whose account has since got its own email.
create or replace function public.take_sign_in_code(p_code_hash text)
returns table (profile_id uuid, email text) language plpgsql security definer set search_path = public as $$
begin
  if public.caller_id() is not null then raise exception 'service role only' using errcode = '42501'; end if;
  return query
    update public.sign_in_codes c set used_at = now()
    from auth.users u
    where c.code_hash = p_code_hash and c.used_at is null and c.expires_at > now()
      and u.id = c.profile_id and public.is_managed_email(u.email::text)
    returning c.profile_id, u.email::text;
end $$;

-- Give a key back when the password could not be set, so the person can retry.
create or replace function public.release_sign_in_code(p_code_hash text)
returns void language sql security definer set search_path = public as $$
  update public.sign_in_codes set used_at = null where code_hash = p_code_hash and public.caller_id() is null;
$$;

create or replace function public.issue_sign_in_code_v2(p_profile text, p_code_hash text, p_lost boolean)
returns text language plpgsql security definer set search_path = public as $$
declare v_actor text := public.caller_id(); v_email text;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if not public.may_help_sign_in(v_actor, p_profile) then
    raise exception 'not allowed to help this person sign in' using errcode = '42501';
  end if;
  if p_code_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid code' using errcode = '22023'; end if;
  -- One live key per person: a new one replaces any unused one.
  delete from public.sign_in_codes where profile_id = p_profile::uuid and used_at is null;
  insert into public.sign_in_codes (code_hash, profile_id, issued_by, expires_at, lost)
  values (p_code_hash, p_profile::uuid, v_actor::uuid, now() + interval '1 hour', coalesce(p_lost, false));
  select u.email into v_email from auth.users u where u.id = p_profile::uuid;
  return split_part(v_email, '@', 1);
end $$;

-- Service role only (the Edge Function): take a key once, with whether the
-- old phone is lost and who helped, for the person's Settings.
create or replace function public.take_sign_in_code_v2(p_code_hash text)
returns table (profile_id uuid, email text, lost boolean, helper_name text)
language plpgsql security definer set search_path = public as $$
begin
  if public.caller_id() is not null then raise exception 'service role only' using errcode = '42501'; end if;
  return query
    update public.sign_in_codes c set used_at = now()
    from auth.users u
    where c.code_hash = p_code_hash and c.used_at is null and c.expires_at > now()
      and u.id = c.profile_id and public.is_managed_email(u.email::text)
    returning c.profile_id, u.email::text, c.lost,
      (select p.display_name from public.profiles p where p.id = c.issued_by::text);
end $$;

-- The version an item offers other organizations: its latest published
-- version whose document the owner has put. A version whose document has
-- not arrived yet cannot be handed on.
create or replace function public._library_available(p_org text, p_item text)
returns text language sql stable set search_path = '' as $$
  select v.doc_hash from public.library_versions v
  where v.org_id = p_org and v.item_id = p_item
    and exists (select 1 from public.library_document_access a where a.org_id = p_org and a.hash = v.doc_hash)
  order by v.hlc collate "C" desc, v.event_id collate "C" desc
  limit 1;
$$;

-- Shared items are the organization's own (made or copied), never a subscription (core libraryItemView).
create or replace function public._library_is_subscription(p_org text, p_item text)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.library_subscriptions s where s.org_id = p_org and s.item_id = p_item and s.sub_hlc <> '');
$$;

-- Give an organization a document and everything it depends on.
create or replace function public._library_grant(p_org text, p_hash text)
returns void language sql set search_path = '' as $$
  with recursive docs (hash) as (
    select d.hash from public.library_documents d where d.hash = p_hash
    union
    select d.hash from docs x
      join public.library_documents p on p.hash = x.hash
      join public.library_documents d on d.hash = any (p.deps)
  )
  insert into public.library_document_access (org_id, hash)
  select p_org, docs.hash from docs
  on conflict do nothing;
$$;

-- Hand a new version of a shared, subscribable item to every subscription
-- that follows it automatically: access to it and its deps, and a pin in
-- the subscriber's organization stream. Runs when the version's event lands and
-- again when its document is put, whichever is second; the pin's id is
-- decided by (subscriber, item, version), so running it twice appends once.
create or replace function public._library_fan_out(p_org text, p_item text, p_hash text)
returns void language plpgsql set search_path = '' as $$
declare s record; v_id text; v_payload jsonb;
begin
  if not exists (select 1 from public.library_items i
                 where i.org_id = p_org and i.item_id = p_item and i.shared and i.subscribable)
     or public._library_is_subscription(p_org, p_item)
     or public._library_available(p_org, p_item) is distinct from p_hash then
    return;
  end if;
  for s in
    select x.org_id, x.item_id, x.pinned, coalesce(i.kind, o.kind) as kind
    from public.library_subscriptions x
    left join public.library_items i on i.org_id = x.org_id and i.item_id = x.item_id
    left join public.library_items o on o.org_id = p_org and o.item_id = p_item
    where x.source_org_id = p_org and x.source_item_id = p_item and x.active and x.auto_update
  loop
    perform public._library_grant(s.org_id, p_hash);
    continue when s.pinned is not distinct from p_hash;
    v_id := 'pin:' || s.org_id || ':' || s.item_id || ':' || p_hash;
    v_payload := jsonb_build_object('itemId', s.item_id, 'kind', s.kind, 'docHash', p_hash);
    perform public._append_event_as(v_id, s.org_id, '_org', 'v1.LibraryPinned', 'server', 'server', v_payload);
  end loop;
end $$;

-- Fold one library event into the projection. Order-independent and
-- idempotent, exactly as core applyLibraryEvent: kind, copiedFrom and each
-- version earliest wins; everything else is a register, later wins.
create or replace function public._apply_library_event(p_org text, p_id text, p_type text, p jsonb, p_hlc text, p_actor text)
returns void language plpgsql set search_path = '' as $$
declare v_item text := p->>'itemId';
begin
  insert into public.library_items (org_id, item_id) values (p_org, v_item) on conflict do nothing;
  update public.library_items i set kind = p->>'kind', kind_hlc = p_hlc, kind_event = p_id
    where i.org_id = p_org and i.item_id = v_item and public._lib_earlier(i.kind_hlc, i.kind_event, p_hlc, p_id);
  case p_type
    when 'v1.LibraryItemDefined' then
      update public.library_items i set name = p->>'name', name_hlc = p_hlc, name_event = p_id
        where i.org_id = p_org and i.item_id = v_item and public._lib_later(i.name_hlc, i.name_event, p_hlc, p_id);
      update public.library_items i set description = p->>'description', description_hlc = p_hlc, description_event = p_id
        where i.org_id = p_org and i.item_id = v_item and public._lib_later(i.description_hlc, i.description_event, p_hlc, p_id);
      if jsonb_typeof(p->'copiedFrom') = 'object' then
        update public.library_items i set copied_from = p->'copiedFrom', copied_hlc = p_hlc, copied_event = p_id
          where i.org_id = p_org and i.item_id = v_item and public._lib_earlier(i.copied_hlc, i.copied_event, p_hlc, p_id);
      end if;
    when 'v1.LibraryVersionPublished' then
      insert into public.library_versions as v (org_id, item_id, doc_hash, hlc, event_id, actor_id, note)
      values (p_org, v_item, p->>'docHash', p_hlc, p_id, p_actor, nullif(p->>'note', ''))
      on conflict (org_id, item_id, doc_hash) do update
        set hlc = excluded.hlc, event_id = excluded.event_id, actor_id = excluded.actor_id, note = excluded.note
        where public._lib_earlier(v.hlc, v.event_id, excluded.hlc, excluded.event_id);
      perform public._library_fan_out(p_org, v_item, p->>'docHash');
    when 'v1.LibrarySharingSet' then
      update public.library_items i
        set shared = (p->>'shared')::boolean, subscribable = (p->>'shared')::boolean and (p->>'subscribable')::boolean,
            sharing_hlc = p_hlc, sharing_event = p_id
        where i.org_id = p_org and i.item_id = v_item and public._lib_later(i.sharing_hlc, i.sharing_event, p_hlc, p_id);
    when 'v1.LibraryItemArchived' then
      update public.library_items i set archived = (p->>'archived')::boolean, archived_hlc = p_hlc, archived_event = p_id
        where i.org_id = p_org and i.item_id = v_item and public._lib_later(i.archived_hlc, i.archived_event, p_hlc, p_id);
    when 'v1.LibrarySubscribed' then
      insert into public.library_subscriptions (org_id, item_id) values (p_org, v_item) on conflict do nothing;
      update public.library_subscriptions s
        set source_org_id = p->>'sourceOrgId', source_org_name = p->>'sourceOrgName', source_item_id = p->>'sourceItemId',
            name = p->>'name', auto_update = (p->>'autoUpdate')::boolean, active = (p->>'active')::boolean,
            sub_hlc = p_hlc, sub_event = p_id
        where s.org_id = p_org and s.item_id = v_item and public._lib_later(s.sub_hlc, s.sub_event, p_hlc, p_id);
    when 'v1.LibraryPinned' then
      insert into public.library_subscriptions (org_id, item_id) values (p_org, v_item) on conflict do nothing;
      update public.library_subscriptions s set pinned = p->>'docHash', pinned_hlc = p_hlc, pinned_event = p_id
        where s.org_id = p_org and s.item_id = v_item and public._lib_later(s.pinned_hlc, s.pinned_event, p_hlc, p_id);
    else null;
  end case;
end $$;

-- ---- the library takes the new formats --------------------------------------------
create or replace function public._library_store(p_org text, p_body text)
returns text language plpgsql set search_path = '' as $$
declare v_doc jsonb; v_format text; v_deps text[] := '{}'; v_hash text; r record;
begin
  if p_body is null then raise exception 'a document is required' using errcode = '22023'; end if;
  if octet_length(p_body) > 4194304 then raise exception 'document too large (max 4 MB)' using errcode = '54000'; end if;
  begin
    v_doc := p_body::jsonb;
  exception when others then
    raise exception 'a document must be JSON' using errcode = '22023';
  end;
  if jsonb_typeof(v_doc) <> 'object' then raise exception 'a document must be a JSON object' using errcode = '22023'; end if;
  v_format := v_doc->>'format';
  if coalesce(v_format, '') not in ('template@1', 'flow@1', 'study@1', 'study@2', 'collection@1', 'material@1', 'source@1', 'sourceBook@1', 'timing@1', 'versification@1') then
    raise exception 'unknown document format %', coalesce(v_format, '(none)') using errcode = '22023';
  end if;
  if v_format <> 'versification@1' or v_doc ? 'deps' then
    if jsonb_typeof(v_doc->'deps') is distinct from 'array' then raise exception 'deps must be a list of hashes' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_array_elements(v_doc->'deps') d where not public._is_hash(d)) then
      raise exception 'deps must be a list of hashes' using errcode = '22023';
    end if;
    v_deps := array(select distinct jsonb_array_elements_text(v_doc->'deps'));
  end if;
  if exists (select 1 from unnest(v_deps) dep
             where not exists (select 1 from public.library_document_access a where a.org_id = p_org and a.hash = dep)) then
    raise exception 'a document it depends on is not readable by this organization' using errcode = '42501';
  end if;
  v_hash := encode(sha256(convert_to(p_body, 'UTF8')), 'hex');
  insert into public.library_documents (hash, format, body, bytes, deps)
  values (v_hash, v_format, p_body, octet_length(p_body), v_deps)
  on conflict (hash) do nothing;
  insert into public.library_document_access (org_id, hash) values (p_org, v_hash) on conflict do nothing;
  -- A version published offline may have reached the log before its document.
  for r in select v.item_id from public.library_versions v where v.org_id = p_org and v.doc_hash = v_hash loop
    perform public._library_fan_out(p_org, r.item_id, v_hash);
  end loop;
  return v_hash;
end $$;

create or replace function public._library_member(p_org text, p_profile text)
returns boolean language sql stable set search_path = '' as $$
  select p_profile is not null and exists (
    select 1 from public.org_memberships m where m.org_id = p_org and m.profile_id = p_profile and not m.removed);
$$;

-- ---- RPCs (docs/library.md) ---------------------------------------------------
create or replace function public.library_put_document(p_org text, p_body text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if not (public.org_privileges(p_org, v_actor, null) && array['manage_templates', 'manage_flows', 'manage_reference']) then
    raise exception 'not allowed to publish to this library' using errcode = '42501';
  end if;
  return public._library_store(p_org, p_body);
end $$;

-- Documents p_org may read: what it put or adopted, and for browsing, the
-- version each shared item offers together with everything that version
-- depends on (a shared collection's guides, a shared template's
-- versification). Reading is what sharing means; adopting is for pinning or
-- copying. A requested hash p_org cannot read directly is walked up the
-- dependency graph, a bounded number of levels, to a version some shared
-- item offers.
create or replace function public.library_get_documents(p_org text, p_hashes text[])
returns table (hash text, body text) language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_actor text := public.caller_id();
begin
  if not public._library_member(p_org, v_actor) then raise exception 'not a member' using errcode = '42501'; end if;
  if cardinality(p_hashes) > 200 then raise exception 'too many documents (max 200); page the request' using errcode = '22023'; end if;
  return query
    with recursive wanted (h) as (
      select distinct w.h from unnest(p_hashes) as w (h)
      where not exists (select 1 from public.library_document_access a where a.org_id = p_org and a.hash = w.h)
    ), up (h, root, depth) as (
      select w.h, w.h, 0 from wanted w
      union
      select p.hash, u.root, u.depth + 1 from up u
        join public.library_documents p on p.deps @> array[u.h]
        where u.depth < 8
    ), browsable (root) as (
      select distinct u.root from up u
      where exists (select 1 from public.library_versions v
                    join public.library_items i on i.org_id = v.org_id and i.item_id = v.item_id
                    where v.doc_hash = u.h and i.shared and not i.archived
                      and not public._library_is_subscription(v.org_id, v.item_id)
                      and public._library_available(v.org_id, v.item_id) = u.h)
    )
    select d.hash, d.body from public.library_documents d
    where d.hash = any (p_hashes)
      and (exists (select 1 from public.library_document_access a where a.org_id = p_org and a.hash = d.hash)
        or d.hash in (select b.root from browsable b));
end $$;

-- Shared, unarchived items of every organization, with the version each offers.
create or replace function public.library_shared_items(
  p_kind text default null, p_query text default null, p_limit int default 50, p_offset int default 0
) returns table (org_id text, org_name text, item_id text, kind text, name text, description text,
                 subscribable boolean, version_count int, latest_hash text, updated_hlc text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_like text := '%' || replace(replace(replace(coalesce(p_query, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  if public.caller_id() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  return query
    select i.org_id,
      coalesce((select e.payload->>'name' from public.events e
                where e.org_id = i.org_id and e.stream_id = '_org' and e.type = 'v1.OrgCreated'
                order by e.server_seq limit 1), i.org_id),
      i.item_id, i.kind, coalesce(i.name, i.item_id), coalesce(i.description, ''), i.subscribable,
      (select count(*)::int from public.library_versions v where v.org_id = i.org_id and v.item_id = i.item_id),
      a.hash,
      (select v.hlc::text from public.library_versions v where v.org_id = i.org_id and v.item_id = i.item_id and v.doc_hash = a.hash)
    from public.library_items i
    cross join lateral (select public._library_available(i.org_id, i.item_id) as hash) a
    where i.shared and not i.archived and a.hash is not null
      and (p_kind is null or i.kind = p_kind)
      and (coalesce(p_query, '') = '' or i.name ilike v_like or i.description ilike v_like)
      and not public._library_is_subscription(i.org_id, i.item_id)
    order by coalesce(i.name, i.item_id), i.org_id, i.item_id
    limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- Give p_org one version of a shared item and everything it depends on,
-- before it copies or subscribes. Unsharing later never takes it away.
create or replace function public.library_adopt(p_org text, p_source_org text, p_source_item text, p_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.caller_id(); v_kind text;
begin
  if not public._library_member(p_org, v_actor) then raise exception 'not a member' using errcode = '42501'; end if;
  select i.kind into v_kind from public.library_items i
    where i.org_id = p_source_org and i.item_id = p_source_item and i.shared and not i.archived
      and not public._library_is_subscription(i.org_id, i.item_id);
  if v_kind is null then raise exception 'that item is not shared' using errcode = '42501'; end if;
  if not (public._library_privilege(v_kind) = any (public.org_privileges(p_org, v_actor, null))) then
    raise exception 'not allowed to manage % items here', v_kind using errcode = '42501';
  end if;
  if not exists (select 1 from public.library_versions v
                 where v.org_id = p_source_org and v.item_id = p_source_item and v.doc_hash = p_hash) then
    raise exception 'that is not a version of the item' using errcode = '22023';
  end if;
  if not exists (select 1 from public.library_document_access a where a.org_id = p_source_org and a.hash = p_hash) then
    raise exception 'that version''s document has not been published yet' using errcode = '22023';
  end if;
  perform public._library_grant(p_org, p_hash);
end $$;

-- Each active subscription of p_org: what it is pinned to, and the newest
-- version its source offers while the source still allows subscribing.
create or replace function public.library_updates(p_org text)
returns table (item_id text, source_org_id text, source_item_id text, pinned_hash text, latest_hash text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public._library_member(p_org, public.caller_id()) then raise exception 'not a member' using errcode = '42501'; end if;
  return query
    select s.item_id, s.source_org_id, s.source_item_id, s.pinned,
      case when exists (select 1 from public.library_items i
                        where i.org_id = s.source_org_id and i.item_id = s.source_item_id and i.shared and i.subscribable)
           then public._library_available(s.source_org_id, s.source_item_id) end
    from public.library_subscriptions s
    where s.org_id = p_org and s.active
    order by s.item_id;
end $$;

-- How scripts/library-seed.ts publishes the LangQuest organization (service role only).
create or replace function public.library_seed_document(p_org text, p_body text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  return public._library_store(p_org, p_body);
end $$;

-- Organization-stream events {id, type, payload, actorId?}: validated, appended
-- under the server's clock and folded. Ids already in the log are skipped,
-- so a seed can be run again. Returns how many were appended.
create or replace function public.library_seed_events(p_org text, p_events jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare ev jsonb; v_err text; v_hlc text; n int := 0;
begin
  if jsonb_typeof(p_events) is distinct from 'array' then raise exception 'p_events must be a jsonb array' using errcode = '22023'; end if;
  for ev in select * from jsonb_array_elements(p_events) loop
    if not (public._is_str(ev->'id') and public._is_str(ev->'type')) then
      raise exception 'each event needs an id and a type' using errcode = '22023';
    end if;
    v_err := public.validate_payload(ev->>'type', ev->'payload');
    if v_err is not null then raise exception 'event %: %', ev->>'id', v_err using errcode = '22023'; end if;
    v_hlc := public._append_event_as(ev->>'id', p_org, '_org', ev->>'type',
      coalesce(nullif(ev->>'actorId', ''), 'service'), 'server', ev->'payload');
    if v_hlc is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Jobs and their progress, for the organization's members.
create or replace function public.timing_jobs_for(p_org text)
returns table (id uuid, item_id text, audio_fileset text, books text[], requested_at timestamptz, claimed_at timestamptz,
               done int, total int, note text, finished_at timestamptz, error text, results int, failed int)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_actor text := public.caller_id();
begin
  if not public._library_member(p_org, v_actor) then raise exception 'not a member' using errcode = '42501'; end if;
  return query
    select j.id, j.item_id, j.audio_fileset, j.books, j.requested_at, j.claimed_at, j.done, j.total, j.note, j.finished_at, j.error,
           (select count(*)::int from public.timing_job_results r where r.job_id = j.id),
           (select count(*)::int from public.timing_job_results r where r.job_id = j.id and not r.ok)
      from public.timing_jobs j where j.org_id = p_org order by j.requested_at desc limit 50;
end $$;

-- A finished job's timing documents, for an admin's app to publish.
create or replace function public.timing_job_results(p_org text, p_job uuid)
returns table (book text, chapter int, ok boolean, body jsonb)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_actor text := public.caller_id();
begin
  if v_actor is null or not (public.org_privileges(p_org, v_actor, null) && array['manage_reference']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query select r.book, r.chapter, r.ok, r.body from public.timing_job_results r
    join public.timing_jobs j on j.id = r.job_id where j.id = p_job and j.org_id = p_org order by r.book, r.chapter;
end $$;

-- The worker (service role): take the oldest open job no one holds, or one
-- held for over an hour by a worker that went away.
create or replace function public.timing_job_claim(p_worker text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.timing_jobs;
begin
  select * into v from public.timing_jobs j
   where j.finished_at is null and (j.claimed_at is null or j.claimed_at < now() - interval '1 hour')
   order by j.requested_at limit 1 for update skip locked;
  if v.id is null then return null; end if;
  update public.timing_jobs set claimed_by = left(coalesce(p_worker, 'worker'), 80), claimed_at = now() where id = v.id;
  return jsonb_build_object('job_id', v.id, 'bible_id', v.bible_id, 'audio_fileset', v.audio_fileset,
    'text_fileset', v.text_fileset, 'books', to_jsonb(v.books), 'versification', v.versification);
end $$;

create or replace function public.timing_job_progress(p_job uuid, p_done int, p_total int, p_note text)
returns void language sql security definer set search_path = '' as $$
  update public.timing_jobs set done = greatest(0, p_done), total = greatest(0, p_total), note = left(p_note, 500), claimed_at = now()
   where id = p_job and finished_at is null;
$$;

create or replace function public.timing_job_finish(p_job uuid, p_results jsonb, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  if jsonb_typeof(coalesce(p_results, '[]'::jsonb)) <> 'array' then raise exception 'results must be an array' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    if r->>'format' is distinct from 'timing@1' or (r->>'book') !~ '^[A-Z0-9]{3}$' or jsonb_typeof(r->'chapter') <> 'number' then
      raise exception 'each result must be a timing@1 document' using errcode = '22023';
    end if;
    insert into public.timing_job_results (job_id, book, chapter, ok, body)
    values (p_job, r->>'book', (r->>'chapter')::int, coalesce((r->'check'->>'ok')::boolean, false), r)
    on conflict (job_id, book, chapter) do update set ok = excluded.ok, body = excluded.body;
  end loop;
  update public.timing_jobs set finished_at = now(), error = left(p_error, 2000) where id = p_job;
end $$;

-- ---- guide media ----------------------------------------------------------------
--
-- Files an authored guide (study@2) names live at <org>/_org/<hash>.<ext>.
-- Every member of the organization may read them, whatever the scope of
-- their membership, and so may members of an organization that can read a
-- guide naming that hash (one it copied or follows): content addressing
-- means a hash is readable only because a document it may read names it.
create or replace function public._library_media_readable(p_name text, p_profile text)
returns boolean language sql stable security definer set search_path = '' as $$
  select split_part(p_name, '/', 2) = '_org' and p_profile is not null and (
    public._library_member(split_part(p_name, '/', 1), p_profile)
    or exists (
      select 1 from public.org_memberships m
        join public.library_document_access a on a.org_id = m.org_id
        join public.library_documents d on d.hash = a.hash
       where m.profile_id = p_profile and not m.removed and d.format = 'study@2'
         and position(split_part(split_part(p_name, '/', 3), '.', 1) in d.body) > 0
         and length(split_part(split_part(p_name, '/', 3), '.', 1)) = 64));
$$;

create or replace function public.request_timings(
  p_org text, p_item text, p_bible_id text, p_audio_fileset text, p_text_fileset text, p_books text[], p_versification text default 'eng',
  p_publish_org text default null, p_publish_item text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.caller_id(); v_id uuid;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if not (public.org_privileges(p_org, v_actor, null) && array['manage_reference']) then
    raise exception 'not allowed to ask for timings here' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_books), 0) = 0 or cardinality(p_books) > 120
     or exists (select 1 from unnest(p_books) b where b !~ '^[A-Z0-9]{3}$') then
    raise exception 'books must be 1 to 120 USFM codes' using errcode = '22023';
  end if;
  if coalesce(p_audio_fileset, '') !~ '^[A-Za-z0-9_-]{4,40}$' or coalesce(p_bible_id, '') !~ '^[A-Za-z0-9_-]{3,40}$'
     or (p_text_fileset is not null and p_text_fileset !~ '^[A-Za-z0-9_-]{4,40}$') then
    raise exception 'not a Bible Brain id' using errcode = '22023';
  end if;
  if (p_publish_org is null) <> (p_publish_item is null) then raise exception 'publish_org and publish_item go together' using errcode = '22023'; end if;
  if p_publish_org is not null and (p_publish_org <> 'langquest' or not exists (
       select 1 from public.library_subscriptions s
        where s.org_id = p_org and s.item_id = p_item and s.source_org_id = p_publish_org and s.source_item_id = p_publish_item)) then
    raise exception 'only a LangQuest source this organization follows' using errcode = '42501';
  end if;
  select j.id into v_id from public.timing_jobs j
   where coalesce(j.publish_org, j.org_id) = coalesce(p_publish_org, p_org) and coalesce(j.publish_item, j.item_id) = coalesce(p_publish_item, p_item)
     and j.audio_fileset = p_audio_fileset and j.published_at is null and (j.finished_at is null or j.publish_org is not null) limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.timing_jobs (org_id, item_id, requested_by, bible_id, audio_fileset, text_fileset, books, versification, total, publish_org, publish_item)
  values (p_org, p_item, v_actor, p_bible_id, p_audio_fileset, p_text_fileset, p_books, coalesce(p_versification, 'eng'), 0, p_publish_org, p_publish_item)
  returning id into v_id;
  return v_id;
end $$;

-- The publisher (service role): finished jobs for LangQuest's items not yet published.
create or replace function public.timing_jobs_to_publish()
returns table (id uuid, publish_org text, publish_item text)
language sql stable security definer set search_path = '' as $$
  select j.id, j.publish_org, j.publish_item from public.timing_jobs j
   where j.publish_org is not null and j.finished_at is not null and j.published_at is null
   order by j.finished_at limit 20;
$$;

create or replace function public.timing_job_published(p_job uuid)
returns void language sql security definer set search_path = '' as $$
  update public.timing_jobs set published_at = now() where id = p_job;
$$;

-- A job's results for the publisher, whatever organization asked.
create or replace function public.timing_job_results_for_publisher(p_job uuid)
returns table (book text, chapter int, ok boolean, body jsonb)
language sql stable security definer set search_path = '' as $$
  select r.book, r.chapter, r.ok, r.body from public.timing_job_results r where r.job_id = p_job order by r.book, r.chapter;
$$;

-- The current document of an organization's item and the documents it names, for the publisher.
create or replace function public.library_docs_for_publisher(p_org text, p_item text)
returns table (hash text, body text, is_current boolean)
language sql stable security definer set search_path = '' as $$
  with cur as (select public._library_available(p_org, p_item) as h)
  select d.hash, d.body, d.hash = (select h from cur) from public.library_documents d
   where d.hash = (select h from cur) or d.hash = any (select unnest(c.deps) from public.library_documents c where c.hash = (select h from cur));
$$;

-- ---- field diagnostics (decision 50) --------------------------------------------------

-- The twin of DIAG_SCHEMA and DIAG_CONTEXT in packages/client/src/diagnostics.ts;
-- scripts/diagSchema.test.ts holds them equal. Change both together.
create or replace function diag.schema() returns jsonb language sql immutable as $$
select
-- diag-schema:begin
'{"kinds":{"sync":{"n":["ms","pushNetMs","pullNetMs","applyMs","pushed","rejected","pulled","pages","pending","offlineMs"],"t":{"outcome":["ok","offline","refused","too_old","error"],"error":"token"}},"load":{"n":["ms","events","fromSnapshot"],"t":{}},"snapshot":{"n":["ms","chunks","resumedChunks","bytes","seq"],"t":{"outcome":["ok","none","stale"]}},"transfer":{"n":["count","bytes","ms","maxMs","signMs","fetchMs","verifyMs","failOffline","failHttp4xx","failHttp5xx","failHash","failDisk","failOther"],"t":{"dir":["up","down"]}},"device":{"n":["freeDiskMb","totalDiskMb","blobCacheMb","blobsWanted"],"t":{}},"error":{"n":[],"t":{"name":"token","where":"token","errorId":"token","fatal":["yes","no"]}}},"context":["installId","os","osVersion","model","appVersion","runtimeVersion","updateId","channel","embedded","reducerVersion","protocolVersion"]}'
-- diag-schema:end
::jsonb
$$;

-- Same pattern as DIAG_TOKEN: code-like text, no @, quotes or commas.
create or replace function diag.is_token(p text) returns boolean language sql immutable as $$
  select p is not null and p ~ '^[A-Za-z0-9 _.:()/#-]{1,80}$'
$$;

-- Apply the allowlist to one record, as sanitizeDiag does on the phone.
-- Null when the record is not one we keep.
create or replace function diag.clean(p_record jsonb) returns jsonb
language plpgsql immutable as $$
declare
  v_kind text := p_record->>'kind';
  v_spec jsonb := diag.schema()->'kinds'->v_kind;
  v_n jsonb := '{}';
  v_t jsonb := '{}';
  v_key text;
  v_allowed jsonb;
  v_val jsonb;
  v_stack text;
  v_out jsonb;
begin
  if v_spec is null or not diag.is_token(p_record->>'id') or jsonb_typeof(p_record->'at') is distinct from 'number' then
    return null;
  end if;
  -- Milliseconds since 1970, inside what timestamptz holds.
  if (p_record->>'at')::numeric not between 0 and 1e14 then return null; end if;
  for v_key in select jsonb_array_elements_text(v_spec->'n') loop
    v_val := p_record->'n'->v_key;
    if jsonb_typeof(v_val) = 'number' then
      v_n := v_n || jsonb_build_object(v_key, round(greatest(-1e12, least(1e12, v_val::text::numeric))));
    end if;
  end loop;
  for v_key, v_allowed in select key, value from jsonb_each(v_spec->'t') loop
    v_val := p_record->'t'->v_key;
    if jsonb_typeof(v_val) = 'string' and (
      (v_allowed = '"token"'::jsonb and diag.is_token(v_val #>> '{}'))
      or (jsonb_typeof(v_allowed) = 'array' and v_allowed ? (v_val #>> '{}'))
    ) then
      v_t := v_t || jsonb_build_object(v_key, v_val);
    end if;
  end loop;
  v_out := jsonb_build_object('id', p_record->'id', 'kind', v_kind, 'at', round((p_record->>'at')::numeric), 'n', v_n, 't', v_t);
  if diag.is_token(p_record->>'orgId') then
    v_out := v_out || jsonb_build_object('orgId', p_record->'orgId');
    if diag.is_token(p_record->>'streamId') then
      v_out := v_out || jsonb_build_object('streamId', p_record->'streamId');
    end if;
  end if;
  -- Frames only (the message line can carry what someone typed), paths cut to file names.
  if v_kind = 'error' and jsonb_typeof(p_record->'stack') = 'string' then
    select string_agg(regexp_replace(l, '(?:[A-Za-z]+://)?(?:/[^/\s():]+)+/([^/\s():]+)', '\1', 'g'), E'\n' order by i)
      into v_stack
      from (
        select btrim(s.l) as l, s.i
        from regexp_split_to_table(left(p_record->>'stack', 8000), E'\n') with ordinality as s(l, i)
        where btrim(s.l) ~ '^at \S' or btrim(s.l) ~ '^[\w$.<>]*@\S+:\d+:\d+$'
        order by s.i
        limit 40
      ) f;
    if v_stack is not null then v_out := v_out || jsonb_build_object('stack', v_stack); end if;
  end if;
  return v_out;
end $$;

-- Delete what is past retention, a bounded amount per call.
create or replace function diag.prune(p_limit int default 1000) returns int
language plpgsql security definer set search_path = diag, pg_catalog as $$
declare v_n int;
begin
  delete from diag.records where id in (
    select id from diag.records where received_at < now() - interval '90 days' order by received_at limit p_limit
  );
  get diagnostics v_n = row_count;
  delete from diag.installs where install_id in (
    select install_id from diag.installs where last_seen < now() - interval '180 days' limit p_limit
  );
  return v_n;
end $$;

-- A record may name an org only if the delivering account belongs to it, so
-- nobody can file diagnostics under someone else's organization.
create or replace function diag.may_tag(p_profile text, p_org text) returns boolean
language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (select 1 from public.org_memberships m where m.org_id = p_org and m.profile_id = p_profile and not m.removed)
$$;

-- Records a phone kept while offline, oldest first, at most 200 per call.
-- Idempotent by record id, so a resend after a dropped link is harmless.
-- Returns how many were new. Capped at 5000 records per install per day.
create or replace function public.diag_ingest(p_context jsonb, p_records jsonb)
returns int
language plpgsql security definer set search_path = public, diag, pg_catalog as $$
declare
  v_actor text := public.caller_id();
  v_install text := p_context->>'installId';
  v_context jsonb := '{}';
  v_key text;
  v_record jsonb;
  v_clean jsonb;
  v_org text;
  v_stream text;
  v_inserted int := 0;
  v_row int;
  v_day_count int;
begin
  if v_actor is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not diag.is_token(v_install) or length(v_install) > 64 then
    raise exception 'invalid payload: installId' using errcode = '22023';
  end if;
  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) > 200 then
    raise exception 'invalid payload: at most 200 records' using errcode = '22023';
  end if;
  for v_key in select jsonb_array_elements_text(diag.schema()->'context') loop
    if diag.is_token(p_context->>v_key) then
      v_context := v_context || jsonb_build_object(v_key, p_context->>v_key);
    end if;
  end loop;

  insert into diag.installs as i (install_id, profile_id, context)
  values (v_install, v_actor, v_context)
  on conflict (install_id) do update set
    profile_id = excluded.profile_id,
    context = excluded.context,
    last_seen = now(),
    day_start = current_date,
    day_count = case when i.day_start = current_date then i.day_count else 0 end
  returning day_count into v_day_count;
  if v_day_count >= 5000 then return 0; end if;

  for v_record in select value from jsonb_array_elements(p_records) loop
    continue when length(v_record::text) > 8192;
    v_clean := diag.clean(v_record);
    continue when v_clean is null;
    v_org := v_clean->>'orgId';
    v_stream := v_clean->>'streamId';
    if v_org is not null and not diag.may_tag(v_actor, v_org) then
      v_org := null;
      v_stream := null;
    end if;
    insert into diag.records (id, install_id, delivered_by, org_id, stream_id, kind, at, update_id, n, t, stack)
    values (
      v_clean->>'id', v_install, v_actor, v_org, v_stream, v_clean->>'kind',
      to_timestamp((v_clean->>'at')::numeric / 1000.0), v_context->>'updateId',
      v_clean->'n', v_clean->'t', v_clean->>'stack'
    )
    on conflict (id) do nothing;
    get diagnostics v_row = row_count;
    v_inserted := v_inserted + v_row;
  end loop;

  update diag.installs set day_count = day_count + v_inserted where install_id = v_install;
  perform diag.prune(200);
  return v_inserted;
end $$;

-- Orgs and languages whose id or any past name matches, with their current name.
create or replace function diag.find(p_query text)
returns table (kind text, org_id text, language_id text, name text)
language sql stable security definer set search_path = public, pg_catalog as $$
  with names as (
    select 'org'::text as kind, e.org_id, null::text as language_id, e.payload->>'name' as name, e.hlc
      from public.events e where e.stream_id = '_org' and e.type = 'v1.OrgCreated'
    union all
    select 'language', e.org_id, e.payload->>'languageId', e.payload->>'name', e.hlc
      from public.events e where e.stream_id = '_org' and e.type in ('v1.LanguageAdded', 'v1.LanguageRenamed')
  ),
  hits as (
    select distinct n.kind, n.org_id, n.language_id from names n
    where n.name ilike '%' || p_query || '%' or n.org_id = p_query or n.language_id = p_query
  )
  select distinct on (n.kind, n.org_id, n.language_id) n.kind, n.org_id, n.language_id, n.name
  from names n join hits h on h.kind = n.kind and h.org_id = n.org_id and h.language_id is not distinct from n.language_id
  order by n.kind, n.org_id, n.language_id, n.hlc desc
$$;

-- A language stream as a cold phone meets it: how much there is to pull,
-- whether a snapshot for its reducer exists and how far behind the tail it
-- is, how much audio, and who is in it (by role, as counts).
create or replace function diag.language_health(p_org text, p_language text, p_reducer_version int)
returns jsonb
language sql stable security definer set search_path = public, pg_catalog as $$
  with ev as (
    select count(*) as events, coalesce(max(server_seq), 0) as "maxSeq",
           count(*) filter (where received_at > now() - interval '7 days') as "events7d",
           max(received_at) as "lastEventAt"
    from public.events where org_id = p_org and stream_id = p_language
  ),
  snap as (
    select reducer_version, max(server_seq) as seq, max(created_at) as created_at
    from public.snapshots where org_id = p_org and stream_id = p_language
    group by reducer_version
  ),
  blobs as (
    select count(*) as count, coalesce(sum((payload->>'size')::bigint), 0) as bytes,
           coalesce(max((payload->>'size')::bigint), 0) as "maxBytes"
    from public.events where org_id = p_org and stream_id = p_language and type = 'v1.BlobStored'
  ),
  roles as (
    select coalesce(role_id, 'none') || ' (' || scope_level || ' scope)' as role, count(*) as n from public.org_memberships
    where org_id = p_org and not removed and (scope_level = 'org' or language_id = p_language)
    group by 1
  )
  select jsonb_build_object(
    'events', (select to_jsonb(ev) from ev),
    'reducerVersion', p_reducer_version,
    'snapshots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reducerVersion', s.reducer_version, 'seq', s.seq, 'createdAt', s.created_at,
        'tail', (select "maxSeq" from ev) - s.seq,
        'bytes', case when s.reducer_version = p_reducer_version then (
          select length(x.state::text) from public.snapshots x
          where x.org_id = p_org and x.stream_id = p_language and x.reducer_version = s.reducer_version and x.server_seq = s.seq
        ) end
      ) order by s.reducer_version desc) from snap s), '[]'::jsonb),
    'blobs', (select to_jsonb(blobs) from blobs),
    'roles', coalesce((select jsonb_object_agg(role, n) from roles), '{}'::jsonb)
  )
$$;

-- Everyone who can open the language, by profile id only, with what their
-- phones last did: last event pushed here, which devices pushed it, and
-- whether any install of theirs has delivered diagnostics.
create or replace function diag.members(p_org text, p_language text)
returns table (profile_id text, roles text, devices text[], last_event_at timestamptz, installs text[], last_diag_at timestamptz)
language sql stable security definer set search_path = public, diag, pg_catalog as $$
  with people as (
    select m.profile_id, coalesce(m.role_id, 'none') as role from public.org_memberships m
    where m.org_id = p_org and not m.removed and (m.scope_level = 'org' or m.language_id = p_language)
  ),
  pushed as (
    select e.actor_id, array_agg(distinct e.device_id) as devices, max(e.received_at) as last_at
    from public.events e where e.org_id = p_org and e.stream_id = p_language group by e.actor_id
  )
  select p.profile_id,
         string_agg(distinct p.role, ','),
         (select devices from pushed where actor_id = p.profile_id),
         (select last_at from pushed where actor_id = p.profile_id),
         (select array_agg(i.install_id order by i.last_seen desc) from diag.installs i where i.profile_id = p.profile_id),
         (select max(i.last_seen) from diag.installs i where i.profile_id = p.profile_id)
  from people p
  group by p.profile_id
  order by 4 desc nulls last
$$;

-- What each install that worked in this language reported over the window,
-- aggregated per kind. Errors are per install, not per language: a crash
-- is not tagged with the language that was open.
create or replace function diag.summary(p_org text, p_language text, p_since interval default interval '14 days', p_install text default null)
returns jsonb
language sql stable security definer set search_path = diag, public, pg_catalog as $$
  with scope as (
    select distinct r.install_id from diag.records r
    where r.org_id = p_org and r.stream_id = p_language and r.at > now() - p_since
      and (p_install is null or r.install_id = p_install)
  ),
  r as (
    select r.* from diag.records r join scope using (install_id)
    where r.at > now() - p_since
      and ((r.org_id = p_org and r.stream_id = p_language) or r.kind in ('error', 'device'))
  ),
  sync as (
    select install_id, jsonb_build_object(
      'count', count(*),
      'p50Ms', percentile_cont(0.5) within group (order by (n->>'ms')::numeric),
      'p95Ms', percentile_cont(0.95) within group (order by (n->>'ms')::numeric),
      'pushNetMs', sum((n->>'pushNetMs')::numeric), 'pullNetMs', sum((n->>'pullNetMs')::numeric),
      'applyMs', sum((n->>'applyMs')::numeric), 'pages', sum((n->>'pages')::numeric),
      'pushed', sum((n->>'pushed')::numeric), 'pulled', sum((n->>'pulled')::numeric),
      'rejected', sum((n->>'rejected')::numeric), 'maxPending', max((n->>'pending')::numeric),
      'maxOfflineMs', max((n->>'offlineMs')::numeric), 'lastAt', max(at)
    ) as j from r where kind = 'sync' group by install_id
  ),
  outcomes as (
    select install_id, jsonb_object_agg(outcome, c) as j from (
      select install_id, t->>'outcome' as outcome, count(*) as c from r where kind = 'sync' group by 1, 2
    ) x group by install_id
  ),
  transfer as (
    select install_id, jsonb_object_agg(dir, j) as j from (
      select install_id, t->>'dir' as dir, jsonb_build_object(
        'count', sum((n->>'count')::numeric), 'bytes', sum((n->>'bytes')::numeric),
        'ms', sum((n->>'ms')::numeric), 'maxMs', max((n->>'maxMs')::numeric),
        'signMs', sum((n->>'signMs')::numeric), 'fetchMs', sum((n->>'fetchMs')::numeric),
        'verifyMs', sum((n->>'verifyMs')::numeric),
        'failOffline', sum((n->>'failOffline')::numeric), 'failHttp4xx', sum((n->>'failHttp4xx')::numeric),
        'failHttp5xx', sum((n->>'failHttp5xx')::numeric), 'failHash', sum((n->>'failHash')::numeric),
        'failDisk', sum((n->>'failDisk')::numeric), 'failOther', sum((n->>'failOther')::numeric)
      ) as j from r where kind = 'transfer' group by 1, 2
    ) x group by install_id
  ),
  loads as (
    select install_id, jsonb_build_object(
      'count', count(*),
      'p50Ms', percentile_cont(0.5) within group (order by (n->>'ms')::numeric),
      'p95Ms', percentile_cont(0.95) within group (order by (n->>'ms')::numeric),
      'maxEvents', max((n->>'events')::numeric)
    ) as j from r where kind = 'load' group by install_id
  ),
  snaps as (
    select install_id, jsonb_agg(jsonb_build_object('at', at, 'outcome', t->>'outcome') || n order by at desc) as j
    from r where kind = 'snapshot' group by install_id
  ),
  device as (
    select distinct on (install_id) install_id, n || jsonb_build_object('at', at) as j
    from r where kind = 'device' order by install_id, at desc
  ),
  errors as (
    select install_id, jsonb_agg(jsonb_build_object('name', name, 'where', "where", 'count', c, 'lastErrorId', last_id, 'lastAt', last_at) order by c desc) as j from (
      select install_id, t->>'name' as name, t->>'where' as "where", count(*) as c,
             (array_agg(t->>'errorId' order by at desc))[1] as last_id, max(at) as last_at
      from r where kind = 'error' group by 1, 2, 3
    ) x group by install_id
  ),
  releases as (
    select install_id, jsonb_agg(jsonb_build_object('updateId', update_id, 'from', f, 'to', l, 'records', c) order by f) as j from (
      select install_id, update_id, min(at) as f, max(at) as l, count(*) as c from r group by 1, 2
    ) x group by install_id
  ),
  clock as (
    select install_id, round(extract(epoch from max(at - received_at))) as ahead_s
    from r group by install_id
  )
  select coalesce(jsonb_object_agg(i.install_id, jsonb_build_object(
    'profileId', i.profile_id,
    'context', i.context,
    'lastSeen', i.last_seen,
    'clockAheadS', greatest(0, (select ahead_s from clock c where c.install_id = i.install_id)),
    'sync', (select s.j || jsonb_build_object('outcomes', o.j) from sync s left join outcomes o using (install_id) where s.install_id = i.install_id),
    'transfer', (select j from transfer x where x.install_id = i.install_id),
    'load', (select j from loads x where x.install_id = i.install_id),
    'snapshots', (select j from snaps x where x.install_id = i.install_id),
    'device', (select j from device x where x.install_id = i.install_id),
    'errors', (select j from errors x where x.install_id = i.install_id),
    'releases', (select j from releases x where x.install_id = i.install_id)
  )), '{}'::jsonb)
  from diag.installs i join scope using (install_id)
$$;

-- One install's records in order: the timeline around a complaint.
create or replace function diag.timeline(p_install text, p_since interval default interval '2 days', p_limit int default 200)
returns table (at timestamptz, received_at timestamptz, kind text, org_id text, stream_id text, update_id text, n jsonb, t jsonb, stack text)
language sql stable security definer set search_path = diag, pg_catalog as $$
  select r.at, r.received_at, r.kind, r.org_id, r.stream_id, r.update_id, r.n, r.t, r.stack
  from diag.records r
  where r.install_id = p_install and r.at > now() - p_since
  order by r.at desc
  limit least(p_limit, 2000)
$$;

-- The code a person read out ("E-7K2Q"): the error, its install, and what
-- that install recorded just before it.
create or replace function diag.error(p_error_id text)
returns jsonb
language sql stable security definer set search_path = diag, pg_catalog as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'installId', e.install_id,
    'at', e.at,
    'receivedAt', e.received_at,
    'updateId', e.update_id,
    't', e.t,
    'stack', e.stack,
    'context', (select i.context from diag.installs i where i.install_id = e.install_id),
    'before', (
      select jsonb_agg(jsonb_build_object('at', b.at, 'kind', b.kind, 'streamId', b.stream_id, 'n', b.n, 't', b.t) order by b.at)
      from (select * from diag.records b where b.install_id = e.install_id and b.at <= e.at and b.id <> e.id order by b.at desc limit 30) b
    )
  ) order by e.at desc), '[]'::jsonb)
  from diag.records e
  where e.kind = 'error' and e.t->>'errorId' = p_error_id
$$;

-- How the sync RPCs are doing server-side, all orgs together (pg_stat_statements).
create or replace function diag.rpc_stats()
returns table (rpc text, calls bigint, mean_ms numeric, max_ms numeric, total_s numeric, rows_per_call numeric)
language sql stable security definer set search_path = extensions, pg_catalog as $$
  select substring(s.query from '(append_events|pull_events|get_snapshot_meta|get_snapshot_chunk|diag_ingest)') as rpc,
         sum(s.calls)::bigint,
         round((sum(s.total_exec_time) / nullif(sum(s.calls), 0))::numeric, 1),
         round(max(s.max_exec_time)::numeric, 1),
         round((sum(s.total_exec_time) / 1000)::numeric, 1),
         round((sum(s.rows)::numeric / nullif(sum(s.calls), 0)), 1)
  from extensions.pg_stat_statements s
  where s.query ~ '(append_events|pull_events|get_snapshot_meta|get_snapshot_chunk|diag_ingest)'
    and s.query !~ 'pg_stat_statements'
  group by 1
  order by 5 desc
$$;

-- ---- triggers --------------------------------------------------------------------------

create trigger events_no_update before update on public.events
  for each row execute function public.events_immutable();
create trigger events_no_delete before delete on public.events
  for each row execute function public.events_immutable();
create trigger events_notify after insert on public.events
  for each row execute function public.events_notify();

-- ---- row-level security ------------------------------------------------------------------
-- Every table is closed; the few a client reads directly say who may.

do $$
declare t text;
begin
  foreach t in array array[
    'events', 'stream_cursors', 'snapshots', 'server_config', 'org_roles', 'org_memberships', 'languages',
    'invites', 'invite_redemptions', 'invite_join_requests', 'join_requests', 'account_stewards', 'sign_in_codes',
    'profiles', 'user_blocks', 'notifications', 'push_tokens', 'push_receipts', 'language_visibility',
    'public_languages', 'content_reports', 'library_documents', 'library_document_access', 'library_items',
    'library_versions', 'library_subscriptions', 'timing_jobs', 'timing_job_results'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy invites_read on public.invites for select to authenticated
  using ('invite_members' = any(public.org_privileges(org_id, public.caller_id(), scope->>'languageId')));
create policy join_requests_read on public.join_requests for select to authenticated
  using (profile_id = public.caller_id() or 'invite_members' = any(public.org_privileges(org_id, public.caller_id(), null)));
create policy account_stewards_read on public.account_stewards for select to authenticated
  using (profile_id::text = public.caller_id() or steward_id::text = public.caller_id());
create policy profiles_read on public.profiles for select to authenticated using (public.profile_visible(id));
create policy user_blocks_read on public.user_blocks for select to authenticated
  using (blocker_id = (select public.caller_id()));
create policy notifications_read on public.notifications for select to authenticated
  using (profile_id = (select public.caller_id()));
create policy visibility_read on public.language_visibility for select to anon, authenticated using (listed);
create policy public_languages_read on public.public_languages for select to anon, authenticated
  using (exists (select 1 from public.language_visibility v
    where v.org_id = public_languages.org_id and v.language_id = public_languages.language_id and v.listed));

-- ---- audio (decision 9) ---------------------------------------------------------------
-- Objects live at <org>/<stream>/<hash>.<ext>. Whoever may read a stream may
-- read and upload its audio; uploads are content-addressed, so a re-upload
-- is harmless. The storage trigger records each one as v1.BlobStored.

insert into storage.buckets (id, name, public) values ('blobs', 'blobs', false) on conflict (id) do nothing;

-- May the caller use the audio under this object name?
create or replace function public._blob_readable(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.caller_id() is not null
    and public.can_read_stream(split_part(p_name, '/', 1), split_part(p_name, '/', 2), public.caller_id());
$$;

create policy "blobs: members read" on storage.objects for select to authenticated
  using (bucket_id = 'blobs' and public._blob_readable(name));
create policy "blobs: members write" on storage.objects for insert to authenticated
  with check (bucket_id = 'blobs' and public._blob_readable(name));
create policy "blobs: members overwrite" on storage.objects for update to authenticated
  using (bucket_id = 'blobs' and public._blob_readable(name));
create policy "blobs: library media read" on storage.objects for select to authenticated
  using (bucket_id = 'blobs' and public._library_media_readable(name, public.caller_id()));

create trigger blobs_record_stored
  after insert or update of metadata on storage.objects
  for each row execute function public.record_blob_stored();

-- ---- grants ----------------------------------------------------------------------------
-- Functions default to every API role. These are narrowed: internal
-- helpers to the service role, the caller-checked RPCs to signed-in people.

do $$
declare f text;
begin
  -- Service role only.
  foreach f in array array[
    '_append_event_as', '_append_service_event', '_apply_org_event', '_apply_library_event', '_content_events',
    '_delete_account', '_library_available', '_library_fan_out', '_library_grant', '_library_is_subscription',
    '_library_member', '_library_store', '_may_moderate', '_remove_content', 'can_read_stream',
    'claim_notification_pushes', 'delete_account_for_email', 'is_managed_account', 'library_docs_for_publisher',
    'library_seed_document', 'library_seed_events', 'may_help_sign_in', 'stream_heads', 'reconcile_notifications',
    'redeem_invite_for', 'release_sign_in_code', 'staff_resolve_report', 'suspend_account', 'take_sign_in_code',
    'take_sign_in_code_v2', 'timing_job_claim', 'timing_job_finish', 'timing_job_progress', 'timing_job_published',
    'timing_job_results_for_publisher', 'timing_jobs_to_publish'
  ] loop
    execute format('revoke all on function public.%I from public, anon, authenticated', f);
    execute format('grant execute on function public.%I to service_role', f);
  end loop;
  -- Signed-in people (each checks the caller itself).
  foreach f in array array[
    '_blob_readable', '_library_media_readable', 'can_help_sign_in', 'create_join_request', 'decide_join_request',
    'delete_my_account', 'diag_ingest', 'dismiss_reports', 'get_user_state', 'issue_invite_v3', 'issue_sign_in_code',
    'issue_sign_in_code_v2', 'library_adopt', 'library_get_documents', 'library_put_document', 'library_shared_items',
    'library_updates', 'may_emit', 'my_organizations', 'my_privileges', 'org_content_reports', 'profile_visible',
    'record_user_event', 'redeem_invite_v2', 'register_push_token', 'remove_content', 'report_content',
    'request_timings', 'save_profile', 'set_blocked', 'set_language_visibility', 'timing_job_results',
    'timing_jobs_for', 'unregister_push_token'
  ] loop
    execute format('revoke all on function public.%I from public, anon', f);
    execute format('grant execute on function public.%I to authenticated, service_role', f);
  end loop;
end $$;

-- Anyone holding an invite key may preview it, signed in or not.
revoke all on function public.preview_invite from public;
grant execute on function public.preview_invite to anon, authenticated, service_role;

-- The diagnostics schema: read by diag_reader (npm run diag), written only
-- through public.diag_ingest.
grant usage on schema diag to diag_reader;
grant select on diag.installs, diag.records to diag_reader;
do $$
declare f text;
begin
  foreach f in array array['clean', 'error', 'find', 'is_token', 'members', 'language_health', 'rpc_stats',
                           'schema', 'summary', 'timeline'] loop
    execute format('revoke all on function diag.%I from public', f);
    execute format('grant execute on function diag.%I to diag_reader', f);
  end loop;
  revoke all on function diag.may_tag from public;
  revoke all on function diag.prune from public;
end $$;

-- Tables a client never writes directly.
revoke all on public.content_reports, public.invite_join_requests, public.library_documents,
  public.library_document_access, public.library_items, public.library_versions, public.library_subscriptions,
  public.languages from anon, authenticated;
revoke all on public.user_blocks from anon, authenticated;
grant select on public.user_blocks to authenticated;
