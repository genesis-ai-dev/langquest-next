-- LangQuest v2 comes over, one way, and keeps coming until v2 is switched off
-- (docs/v2-import.md). Everything the import keeps is in its own schema,
-- reached only by the service role through the v2_import_* functions below,
-- so retiring the import is dropping this schema and those functions. v2's
-- work itself arrives as ordinary events through append_events; nothing
-- here is read by a phone.

create schema if not exists v2_import;
revoke all on schema v2_import from public, anon, authenticated;

-- ---- the board: where each v2 project goes (section 2) -------------------------------------

-- Organizations v2 projects go into: one the import makes, or one people
-- already made here, chosen on the board (`existing`).
create table v2_import.orgs (
  org_id text primary key check (length(org_id) between 1 and 100),
  name text not null check (length(name) between 1 and 200),
  existing boolean not null default false,
  -- v2 profile ids who run it, at the organization's scope.
  admins text[] not null default '{}',
  updated_by text,
  updated_at timestamptz not null default now()
);

-- A v2 project's place: its organization (null: not coming over), the
-- language decided for it (docs/v2-project-languages.md), and who confirmed
-- both. A project comes over once confirmed, and keeps coming after that.
create table v2_import.placements (
  project_id text primary key check (length(project_id) between 1 and 100),
  org_id text references v2_import.orgs (org_id) on update cascade,
  languoid_id uuid,
  code text check (length(code) between 1 and 40),
  confirmed_by text,
  confirmed_at timestamptz,
  updated_by text,
  updated_at timestamptz not null default now(),
  check ((confirmed_at is null) = (confirmed_by is null)),
  check (confirmed_at is null or (org_id is not null and code is not null))
);

-- ---- what the import has said (section 1) ----------------------------------------------------

-- One row per fact: what the import last said about it (reconcile.ts
-- LedgerEntry). `scope` is the v2 project, or `org:<org id>` for an
-- organization's own facts.
create table v2_import.ledger (
  scope text not null,
  key text not null,
  entry jsonb not null,
  primary key (scope, key)
);

-- v2 files by name: what each turned out to be once copied, or since when
-- v2's bucket has not had it.
create table v2_import.files (
  name text primary key,
  hash text check (hash ~ '^[0-9a-f]{64}$'),
  size bigint,
  duration_ms integer,
  format text check (format in ('wav', 'm4a')),
  missing_since timestamptz,
  copied_at timestamptz,
  check ((hash is null) = (copied_at is null))
);

-- Each pass over a project, with what it did (section 8), for the board.
create table v2_import.passes (
  id bigint generated always as identity primary key,
  project_id text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  report jsonb not null default '{}'
);
create index passes_project_idx on v2_import.passes (project_id, started_at desc);

-- Where the last pass that looked for changes started.
create table v2_import.cursors (
  name text primary key,
  value timestamptz not null,
  updated_at timestamptz not null default now()
);

-- ---- functions, service role only ----------------------------------------------------------

create or replace function public.v2_import_plan()
returns jsonb language sql stable security definer set search_path = v2_import, public as $$
  select jsonb_build_object(
    'orgs', coalesce((select jsonb_agg(to_jsonb(o) order by o.name) from v2_import.orgs o), '[]'),
    'placements', coalesce((select jsonb_agg(to_jsonb(p) order by p.project_id) from v2_import.placements p), '[]'),
    'passes', coalesce((
      select jsonb_agg(jsonb_build_object('project_id', l.project_id, 'finished_at', l.finished_at, 'report', l.report))
      from (select distinct on (project_id) * from v2_import.passes where finished_at is not null
            order by project_id, started_at desc) l), '[]')
  );
$$;

-- Save the board: organizations and placements as the board shows them.
-- A confirmed project's organization never changes here: its language's
-- events carry the organization, so a move would be a second copy.
create or replace function public.v2_import_save_plan(p_orgs jsonb, p_placements jsonb, p_by text)
returns void language plpgsql security definer set search_path = v2_import, public as $$
declare v_moved text;
begin
  insert into v2_import.orgs (org_id, name, existing, admins, updated_by, updated_at)
  select o->>'org_id', o->>'name', coalesce((o->>'existing')::boolean, false),
         coalesce(array(select jsonb_array_elements_text(o->'admins')), '{}'), p_by, now()
  from jsonb_array_elements(coalesce(p_orgs, '[]')) o
  on conflict (org_id) do update set name = excluded.name, existing = excluded.existing, admins = excluded.admins,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at
  where (orgs.name, orgs.existing, orgs.admins) is distinct from (excluded.name, excluded.existing, excluded.admins);

  select p.project_id into v_moved
  from jsonb_array_elements(coalesce(p_placements, '[]')) n
  join v2_import.placements p on p.project_id = n->>'project_id'
  where p.confirmed_at is not null and p.org_id is distinct from n->>'org_id'
  limit 1;
  if v_moved is not null then
    raise exception 'v2 project % has come over already; it cannot move to another organization', v_moved using errcode = '23514';
  end if;

  insert into v2_import.placements (project_id, org_id, languoid_id, code, confirmed_by, confirmed_at, updated_by, updated_at)
  select n->>'project_id', nullif(n->>'org_id', ''), nullif(n->>'languoid_id', '')::uuid, nullif(n->>'code', ''),
         case when (n->>'confirmed')::boolean then coalesce(p.confirmed_by, p_by) end,
         case when (n->>'confirmed')::boolean then coalesce(p.confirmed_at, now()) end,
         p_by, now()
  from jsonb_array_elements(coalesce(p_placements, '[]')) n
  left join v2_import.placements p on p.project_id = n->>'project_id'
  on conflict (project_id) do update set org_id = excluded.org_id, languoid_id = excluded.languoid_id, code = excluded.code,
    confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  where (placements.org_id, placements.languoid_id, placements.code, placements.confirmed_at)
    is distinct from (excluded.org_id, excluded.languoid_id, excluded.code, excluded.confirmed_at);
end $$;

-- A scope's ledger, a page at a time, in key order.
create or replace function public.v2_import_ledger(p_scope text, p_after text default '', p_limit int default 5000)
returns setof jsonb language sql stable security definer set search_path = v2_import, public as $$
  select entry from v2_import.ledger
  where scope = p_scope and key > coalesce(p_after, '')
  order by key limit least(greatest(p_limit, 1), 10000);
$$;

-- Save entries once their events are in the log.
create or replace function public.v2_import_ledger_put(p_scope text, p_entries jsonb)
returns void language sql security definer set search_path = v2_import, public as $$
  insert into v2_import.ledger (scope, key, entry)
  select p_scope, e->>'key', e from jsonb_array_elements(p_entries) e
  on conflict (scope, key) do update set entry = excluded.entry;
$$;

create or replace function public.v2_import_files(p_names text[])
returns setof v2_import.files language sql stable security definer set search_path = v2_import, public as $$
  select * from v2_import.files where name = any (p_names);
$$;

create or replace function public.v2_import_files_put(p_files jsonb)
returns void language sql security definer set search_path = v2_import, public as $$
  insert into v2_import.files (name, hash, size, duration_ms, format, missing_since, copied_at)
  select f->>'name', f->>'hash', (f->>'size')::bigint, (f->>'duration_ms')::int, f->>'format',
         case when f->>'hash' is null then now() end, case when f->>'hash' is not null then now() end
  from jsonb_array_elements(p_files) f
  on conflict (name) do update set hash = excluded.hash, size = excluded.size, duration_ms = excluded.duration_ms,
    format = excluded.format, copied_at = excluded.copied_at,
    missing_since = case when excluded.hash is null then coalesce(files.missing_since, excluded.missing_since) end;
$$;

create or replace function public.v2_import_pass(p_project text, p_started timestamptz, p_report jsonb)
returns void language sql security definer set search_path = v2_import, public as $$
  insert into v2_import.passes (project_id, started_at, finished_at, report) values (p_project, p_started, now(), p_report);
$$;

create or replace function public.v2_import_cursor(p_name text, p_value timestamptz default null)
returns timestamptz language plpgsql security definer set search_path = v2_import, public as $$
declare v timestamptz;
begin
  if p_value is not null then
    insert into v2_import.cursors (name, value) values (p_name, p_value)
    on conflict (name) do update set value = excluded.value, updated_at = now();
    return p_value;
  end if;
  select value into v from v2_import.cursors where name = p_name;
  return v;
end $$;

-- Signing in with a v2 account (functions/v2-sign-in): every try goes to
-- v2's sign-in from the same few servers, so a run of wrong passwords for
-- one email is stopped here before v2 starts refusing everyone.
create table v2_import.sign_in_failures (
  email text not null,
  at timestamptz not null default now()
);
create index sign_in_failures_idx on v2_import.sign_in_failures (email, at desc);

-- May this email try now? With p_failed, also notes a wrong password.
create or replace function public.v2_import_sign_in_try(p_email text, p_failed boolean default false)
returns boolean language plpgsql security definer set search_path = v2_import, public as $$
begin
  delete from v2_import.sign_in_failures where at < now() - interval '1 hour';
  if p_failed then insert into v2_import.sign_in_failures (email) values (lower(p_email)); end if;
  return (select count(*) from v2_import.sign_in_failures where email = lower(p_email)) < 10;
end $$;

-- An organization the import fills uses LangQuest's Bible as any
-- organization does: subscribed in its stream, and allowed to read the
-- document (as library_adopt grants it to a member who subscribes).
create or replace function public.v2_import_library_grant(p_org text, p_hash text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.library_document_access a where a.org_id = 'langquest' and a.hash = p_hash) then
    raise exception 'that is not a LangQuest library document' using errcode = '22023';
  end if;
  perform public._library_grant(p_org, p_hash);
end $$;

do $$
declare f text;
begin
  foreach f in array array['v2_import_sign_in_try', 'v2_import_library_grant', 'v2_import_plan', 'v2_import_save_plan', 'v2_import_ledger', 'v2_import_ledger_put',
                           'v2_import_files', 'v2_import_files_put', 'v2_import_pass', 'v2_import_cursor'] loop
    execute format('revoke all on function public.%I from public, anon, authenticated', f);
    execute format('grant execute on function public.%I to service_role', f);
  end loop;
end $$;
