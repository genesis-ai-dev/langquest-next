-- Publishers bring their own material into their own organization
-- (decisions.md 173, docs/publisher-imports.md). LangQuest staff turn on an
-- importer for an organization, pointed at where that organization keeps its
-- material; its admins ask for a run in the app; the app Worker's schedule
-- builds library documents from the source; and an admin publishes what the
-- run made, as the organization, from the app. The server writes into no
-- organization's library (decision 62): until an admin publishes them, a
-- run's documents are readable by nobody.

-- ---- importers: staff turn one on for an organization ------------------------------

create table public.org_importers (
  org_id text not null,
  -- 'fia': FIA's study guides, key terms, pictures and maps from Bible Aquifer's
  -- public repositories (github.com/<source>/FIATranslationGuide and the rest).
  importer text not null check (importer in ('fia')),
  -- Where the organization keeps its material: for 'fia', the GitHub owner of the repositories.
  source text not null check (source ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'),
  granted_at timestamptz not null default now(),
  granted_by text not null check (length(btrim(granted_by)) between 1 and 200),
  -- Kept once revoked, so the history stays.
  revoked_at timestamptz,
  revoked_by text check (revoked_by is null or length(revoked_by) between 1 and 200),
  check ((revoked_at is null) = (revoked_by is null)),
  primary key (org_id, importer)
);
alter table public.org_importers enable row level security;
revoke all on table public.org_importers from public, anon, authenticated;
grant all on table public.org_importers to service_role;

-- ---- runs ------------------------------------------------------------------------

-- One import: what the admin asked for, where the Worker has got to, and what
-- it made. Where a run stands is worked out from its times (_import_run_state),
-- never kept as a status.
create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  importer text not null,
  -- The importer's source when the run was asked for.
  source text not null,
  -- What to bring in; for 'fia', {"languages": ["eng", "fra"]}.
  options jsonb not null default '{}' check (jsonb_typeof(options) = 'object' and octet_length(options::text) <= 4096),
  requested_by text not null,
  requested_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  -- The Worker holds the run until then; a step that dies lets the next one take it up.
  lease_until timestamptz,
  -- The Worker's place in the run (for 'fia', the items each language made), and how far it is.
  cursor jsonb not null default '{}' check (jsonb_typeof(cursor) = 'object' and octet_length(cursor::text) <= 65536),
  parts_done int not null default 0 check (parts_done >= 0),
  parts_total int check (parts_total is null or parts_total >= 0),
  finished_at timestamptz,
  -- The items the run made, for the admin to publish: [{itemId, kind, name, description, docHash, count}].
  manifest jsonb check (manifest is null or (jsonb_typeof(manifest) = 'array' and jsonb_array_length(manifest) <= 200)),
  failed_at timestamptz,
  failure text check (failure is null or length(failure) <= 500),
  accepted_at timestamptz,
  accepted_by text,
  withdrawn_at timestamptz,
  foreign key (org_id, importer) references public.org_importers (org_id, importer)
);
-- One open run per importer: asking again while one runs gets that one.
create unique index import_runs_one_open on public.import_runs (org_id, importer)
  where finished_at is null and failed_at is null and withdrawn_at is null;
create index import_runs_org_idx on public.import_runs (org_id, requested_at desc);
alter table public.import_runs enable row level security;
revoke all on table public.import_runs from public, anon, authenticated;
grant all on table public.import_runs to service_role;

-- A run keeps its documents the way an organization does: rows in
-- library_document_access, under the run's own key ('_import.<run id>'),
-- which no person is a member of. So _library_store checks them as it checks
-- any organization's (format, size, and that everything a document depends on
-- is the run's too), and nobody can read them. Publishing moves the rows to
-- the organization; withdrawing or failing drops them.
create or replace function public._import_key(p_run uuid)
returns text language sql immutable set search_path = '' as $$ select '_import.' || p_run::text $$;
revoke all on function public._import_key from public, anon, authenticated;

create or replace function public._import_run_state(r public.import_runs)
returns text language sql immutable set search_path = '' as $$
  select case
    when r.withdrawn_at is not null then 'withdrawn'
    when r.failed_at is not null then 'failed'
    when r.accepted_at is not null then 'published'
    when r.finished_at is not null then 'ready'
    when r.started_at is not null then 'importing'
    else 'waiting' end;
$$;
revoke all on function public._import_run_state from public, anon, authenticated;

-- Someone who may bring material into the organization's library: Manage Reference at its own level.
create or replace function public._may_import(p_org text, p_profile text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_profile is not null and 'manage_reference' = any (public.org_privileges(p_org, p_profile, null));
$$;
revoke all on function public._may_import from public, anon, authenticated;

create or replace function public._import_run_json(r public.import_runs)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'importer', r.importer, 'source', r.source, 'options', r.options, 'state', public._import_run_state(r),
    'requestedAt', r.requested_at, 'startedAt', r.started_at, 'done', r.parts_done, 'total', r.parts_total,
    'finishedAt', r.finished_at, 'manifest', coalesce(r.manifest, '[]'::jsonb), 'failure', r.failure,
    'acceptedAt', r.accepted_at, 'withdrawnAt', r.withdrawn_at);
$$;
revoke all on function public._import_run_json from public, anon, authenticated;

-- ---- what an admin's app calls --------------------------------------------------------

-- The importers turned on for the organization. Empty for anyone who may not
-- import, so the app may ask whoever is signed in.
create or replace function public.org_importers(p_org text)
returns table (importer text, source text, granted_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.importer, i.source, i.granted_at from public.org_importers i
   where i.org_id = p_org and i.revoked_at is null and public._may_import(p_org, public.caller_id())
   order by i.importer;
$$;
revoke all on function public.org_importers from public, anon;
grant execute on function public.org_importers to authenticated;

-- Its importers' latest runs, newest first.
create or replace function public.import_runs_for(p_org text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public._may_import(p_org, public.caller_id()) then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(public._import_run_json(r) order by r.requested_at desc)
    from (select * from public.import_runs r where r.org_id = p_org order by r.requested_at desc limit 10) r), '[]'::jsonb);
end $$;
revoke all on function public.import_runs_for from public, anon;
grant execute on function public.import_runs_for to authenticated;

-- Ask for a run: {ok, run} with the new run, or {ok: false, reason}
-- ('not_allowed', 'no_importer', 'bad_options', or 'running' with the open run).
create or replace function public.import_request(p_org text, p_importer text, p_options jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.caller_id(); v_imp public.org_importers; v_run public.import_runs; v_langs jsonb;
begin
  if not public._may_import(p_org, v_actor) then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;
  select * into v_imp from public.org_importers i where i.org_id = p_org and i.importer = p_importer and i.revoked_at is null;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_importer'); end if;
  if p_importer = 'fia' then
    v_langs := p_options->'languages';
    if jsonb_typeof(v_langs) is distinct from 'array' or jsonb_array_length(v_langs) not between 1 and 40
       or exists (select 1 from jsonb_array_elements(v_langs) l where jsonb_typeof(l) <> 'string' or l #>> '{}' !~ '^[a-z]{3}$') then
      return jsonb_build_object('ok', false, 'reason', 'bad_options');
    end if;
    p_options := jsonb_build_object('languages', (select jsonb_agg(distinct l #>> '{}') from jsonb_array_elements(v_langs) l));
  end if;
  select * into v_run from public.import_runs r
   where r.org_id = p_org and r.importer = p_importer and r.finished_at is null and r.failed_at is null and r.withdrawn_at is null;
  if found then return jsonb_build_object('ok', false, 'reason', 'running', 'run', public._import_run_json(v_run)); end if;
  insert into public.import_runs (org_id, importer, source, options, requested_by)
  values (p_org, p_importer, v_imp.source, p_options, v_actor) returning * into v_run;
  return jsonb_build_object('ok', true, 'run', public._import_run_json(v_run));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'reason', 'running');
end $$;
revoke all on function public.import_request from public, anon;
grant execute on function public.import_request to authenticated;

-- Stop a run that is waiting or importing, or set aside one that is ready:
-- its documents go, as if it had never run. 'withdrawn' or 'not_open'.
create or replace function public.import_run_withdraw(p_org text, p_run uuid)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if not public._may_import(p_org, public.caller_id()) then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.import_runs set withdrawn_at = now(), lease_until = null
   where id = p_run and org_id = p_org and withdrawn_at is null and failed_at is null and accepted_at is null;
  if not found then return 'not_open'; end if;
  delete from public.library_document_access where org_id = public._import_key(p_run);
  return 'withdrawn';
end $$;
revoke all on function public.import_run_withdraw from public, anon;
grant execute on function public.import_run_withdraw to authenticated;

-- Make a finished run's documents the organization's, so its admin's app can
-- publish the items (v1.LibraryItemDefined, v1.LibraryVersionPublished) as
-- the organization. Safe to call again. Answers the items to publish, or
-- {reason}: 'not_ready' (still importing, failed or withdrawn), 'no_importer'
-- (staff turned it off).
create or replace function public.import_run_accept(p_org text, p_run uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.caller_id(); v_run public.import_runs;
begin
  if not public._may_import(p_org, v_actor) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_run from public.import_runs where id = p_run and org_id = p_org for update;
  if not found or v_run.finished_at is null or v_run.withdrawn_at is not null or v_run.failed_at is not null then
    return jsonb_build_object('reason', 'not_ready');
  end if;
  if not exists (select 1 from public.org_importers i where i.org_id = p_org and i.importer = v_run.importer and i.revoked_at is null) then
    return jsonb_build_object('reason', 'no_importer');
  end if;
  insert into public.library_document_access (org_id, hash)
  select p_org, a.hash from public.library_document_access a where a.org_id = public._import_key(p_run)
  on conflict do nothing;
  delete from public.library_document_access where org_id = public._import_key(p_run);
  update public.import_runs set accepted_at = coalesce(accepted_at, now()), accepted_by = coalesce(accepted_by, v_actor) where id = p_run;
  return jsonb_build_object('items', coalesce(v_run.manifest, '[]'::jsonb));
end $$;
revoke all on function public.import_run_accept from public, anon;
grant execute on function public.import_run_accept to authenticated;

-- ---- what the app Worker's schedule calls (service role) --------------------------------

-- The run to work on next, held for p_lease_seconds: the oldest open one that
-- no step holds. A run whose importer staff turned off fails here. Null when
-- there is none.
create or replace function public.import_run_next(p_lease_seconds int default 600)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_run public.import_runs;
begin
  update public.import_runs r set failed_at = now(), failure = 'LangQuest turned this importer off.', lease_until = null
   where r.finished_at is null and r.failed_at is null and r.withdrawn_at is null
     and not exists (select 1 from public.org_importers i where i.org_id = r.org_id and i.importer = r.importer and i.revoked_at is null);
  delete from public.library_document_access a using public.import_runs r
   where a.org_id = public._import_key(r.id) and r.failed_at is not null;
  select * into v_run from public.import_runs r
   where r.finished_at is null and r.failed_at is null and r.withdrawn_at is null and (r.lease_until is null or r.lease_until < now())
   order by r.requested_at limit 1 for update skip locked;
  if not found then return null; end if;
  update public.import_runs set started_at = coalesce(started_at, now()), lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 60))
   where id = v_run.id returning * into v_run;
  return jsonb_build_object('id', v_run.id, 'orgId', v_run.org_id, 'importer', v_run.importer, 'source', v_run.source,
    'options', v_run.options, 'cursor', v_run.cursor, 'done', v_run.parts_done, 'total', v_run.parts_total);
end $$;
revoke all on function public.import_run_next from public, anon, authenticated;
grant execute on function public.import_run_next to service_role;

-- Is the run still the Worker's to carry on? False once withdrawn, failed,
-- finished, or its importer turned off.
create or replace function public._import_run_open(p_run uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.import_runs r join public.org_importers i on i.org_id = r.org_id and i.importer = r.importer
                  where r.id = p_run and r.finished_at is null and r.failed_at is null and r.withdrawn_at is null and i.revoked_at is null);
$$;
revoke all on function public._import_run_open from public, anon, authenticated;

-- Keep documents for the run (dependencies first), as _library_store keeps
-- an organization's; answers their hashes in order.
create or replace function public.import_run_put_documents(p_run uuid, p_bodies text[])
returns text[] language plpgsql security definer set search_path = '' as $$
declare v_out text[] := '{}'; b text;
begin
  if not public._import_run_open(p_run) then raise exception 'the run is not open' using errcode = '55000'; end if;
  if cardinality(p_bodies) > 500 then raise exception 'too many documents (max 500); send them in parts' using errcode = '22023'; end if;
  foreach b in array coalesce(p_bodies, '{}') loop
    v_out := v_out || public._library_store(public._import_key(p_run), b);
  end loop;
  return v_out;
end $$;
revoke all on function public.import_run_put_documents from public, anon, authenticated;
grant execute on function public.import_run_put_documents to service_role;

-- Where the run has got to, and the lease renewed. False when it is no longer the Worker's to carry on.
create or replace function public.import_run_save(p_run uuid, p_cursor jsonb, p_done int, p_total int, p_lease_seconds int default 600)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public._import_run_open(p_run) then return false; end if;
  update public.import_runs set cursor = coalesce(p_cursor, cursor), parts_done = greatest(coalesce(p_done, parts_done), 0), parts_total = coalesce(p_total, parts_total),
    lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 60))
   where id = p_run;
  return true;
end $$;
revoke all on function public.import_run_save from public, anon, authenticated;
grant execute on function public.import_run_save to service_role;

-- The run is done: what it made, for an admin to publish. Every item's
-- document must be the run's. False when the run was no longer open.
create or replace function public.import_run_finish(p_run uuid, p_manifest jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public._import_run_open(p_run) then return false; end if;
  if jsonb_typeof(p_manifest) <> 'array' or exists (
       select 1 from jsonb_array_elements(p_manifest) m
        where coalesce(m->>'itemId', '') !~ '^[a-z0-9][a-z0-9._-]{0,120}$' or coalesce(m->>'name', '') = ''
           or not exists (select 1 from public.library_document_access a where a.org_id = public._import_key(p_run) and a.hash = m->>'docHash')) then
    raise exception 'every item needs an id, a name and a document of the run' using errcode = '22023';
  end if;
  update public.import_runs set finished_at = now(), manifest = p_manifest, lease_until = null where id = p_run;
  return true;
end $$;
revoke all on function public.import_run_finish from public, anon, authenticated;
grant execute on function public.import_run_finish to service_role;

-- The run cannot go on (its source answered wrongly, or a document was refused).
create or replace function public.import_run_fail(p_run uuid, p_failure text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.import_runs set failed_at = now(), failure = left(coalesce(nullif(btrim(p_failure), ''), 'The import stopped.'), 500), lease_until = null
   where id = p_run and finished_at is null and failed_at is null and withdrawn_at is null;
  delete from public.library_document_access where org_id = public._import_key(p_run);
end $$;
revoke all on function public.import_run_fail from public, anon, authenticated;
grant execute on function public.import_run_fail to service_role;

-- ---- staff (service role; scripts/publisher-import.ts) ---------------------------------------

-- 'granted', 'no_org' or 'say_who'. Granting again changes the source and turns a revoked importer back on.
create or replace function public.org_importer_grant(p_org text, p_importer text, p_source text, p_by text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(btrim(p_by), '') = '' then return 'say_who'; end if;
  if public.org_name(p_org) is null then return 'no_org'; end if;
  insert into public.org_importers (org_id, importer, source, granted_by) values (p_org, p_importer, p_source, btrim(p_by))
  on conflict (org_id, importer) do update set source = excluded.source, granted_at = now(), granted_by = excluded.granted_by,
    revoked_at = null, revoked_by = null;
  return 'granted';
end $$;
revoke all on function public.org_importer_grant from public, anon, authenticated;
grant execute on function public.org_importer_grant to service_role;

-- 'revoked', 'not_granted' or 'say_who'. Runs under way fail at their next step; what was published stays.
create or replace function public.org_importer_revoke(p_org text, p_importer text, p_by text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(btrim(p_by), '') = '' then return 'say_who'; end if;
  update public.org_importers set revoked_at = now(), revoked_by = btrim(p_by) where org_id = p_org and importer = p_importer and revoked_at is null;
  return case when found then 'revoked' else 'not_granted' end;
end $$;
revoke all on function public.org_importer_revoke from public, anon, authenticated;
grant execute on function public.org_importer_revoke to service_role;

-- Every importer, with its organization and its latest run.
create or replace function public.org_importer_list()
returns table (org_id text, org_name text, importer text, source text, granted_at timestamptz, granted_by text,
               revoked_at timestamptz, revoked_by text, runs bigint, last_run jsonb)
language sql stable security definer set search_path = '' as $$
  select i.org_id, public.org_name(i.org_id), i.importer, i.source, i.granted_at, i.granted_by, i.revoked_at, i.revoked_by,
    (select count(*) from public.import_runs r where r.org_id = i.org_id and r.importer = i.importer),
    (select public._import_run_json(r) from public.import_runs r where r.org_id = i.org_id and r.importer = i.importer order by r.requested_at desc limit 1)
  from public.org_importers i order by i.granted_at desc;
$$;
revoke all on function public.org_importer_list from public, anon, authenticated;
grant execute on function public.org_importer_list to service_role;
