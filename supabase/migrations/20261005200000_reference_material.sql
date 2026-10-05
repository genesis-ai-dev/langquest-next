-- Reference material (docs/reference-material.md, decisions.md 59).
--
--   v1.ReferenceRecommended      { itemId, recommended }                 org partition
--   v1.LaneReferenceRecommended  { laneId, itemId, state }               state: recommended | hidden | inherit
--   v1.PassageReferenceLinked    { laneId, unitId, itemId, linked }
--   v1.ReferencesUsed            { laneId, unitId, takeId | reviewId, items: [...] }
--
-- Recommending and linking need manage_reference; recording what was used
-- needs translate or review (whoever publishes the version or the review).
-- The library also takes the new document formats source@1, sourceBook@1,
-- timing@1 and study@2. Timing jobs are the queue fia-align's worker
-- drains: an admin asks (request_timings), the worker claims, reports
-- progress and finishes with timing documents, and an admin's app
-- publishes them as the source's next version.

alter function public.validate_payload(text, jsonb) rename to _validate_payload_before_20261005b;
alter function public.event_privilege(text, jsonb) rename to _event_privilege_before_20261005b;

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
    if coalesce(x->>'kind', '') not in ('source', 'guide', 'note', 'questions') or jsonb_typeof(x->'kind') <> 'string' then
      return 'item kind must be one of source, guide, note, questions';
    end if;
    if jsonb_typeof(x->'opened') is distinct from 'boolean' then return 'opened must be a boolean'; end if;
    foreach k in array array['docHash', 'ref', 'detail', 'copyright'] loop
      if x ? k and jsonb_typeof(x->k) <> 'string' then return k || ' must be a string'; end if;
    end loop;
  end loop;
  return null;
end $$;

create or replace function public.validate_payload(p_type text, p jsonb)
returns text language plpgsql immutable as $$
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'payload must be an object'; end if;
  case p_type
    when 'v1.ReferenceRecommended' then
      if not public._is_str(p->'itemId') then return 'itemId must be a non-empty string'; end if;
      if jsonb_typeof(p->'recommended') is distinct from 'boolean' then return 'recommended must be a boolean'; end if;
    when 'v1.LaneReferenceRecommended' then
      if not (public._is_str(p->'laneId') and public._is_str(p->'itemId')) then return 'laneId and itemId must be non-empty strings'; end if;
      if jsonb_typeof(p->'state') is distinct from 'string' or p->>'state' not in ('recommended', 'hidden', 'inherit') then
        return 'state must be one of recommended, hidden, inherit';
      end if;
    when 'v1.PassageReferenceLinked' then
      if not (public._is_str(p->'laneId') and public._is_str(p->'unitId') and public._is_str(p->'itemId')) then
        return 'laneId, unitId and itemId must be non-empty strings';
      end if;
      if jsonb_typeof(p->'linked') is distinct from 'boolean' then return 'linked must be a boolean'; end if;
    when 'v1.ReferencesUsed' then
      if not (public._is_str(p->'laneId') and public._is_str(p->'unitId')) then return 'laneId and unitId must be non-empty strings'; end if;
      if (p ? 'takeId')::int + (p ? 'reviewId')::int <> 1 then return 'exactly one of takeId, reviewId'; end if;
      if (p ? 'takeId' and not public._is_str(p->'takeId')) or (p ? 'reviewId' and not public._is_str(p->'reviewId')) then
        return 'takeId or reviewId must be non-empty';
      end if;
      return public._used_items_error(p->'items');
    else
      return public._validate_payload_before_20261005b(p_type, p);
  end case;
  return null;
end $$;

create or replace function public.event_privilege(p_type text, p jsonb)
returns text language sql immutable as $$
  select case p_type
    when 'v1.ReferenceRecommended' then 'manage_reference'
    when 'v1.LaneReferenceRecommended' then 'manage_reference'
    when 'v1.PassageReferenceLinked' then 'manage_reference'
    when 'v1.ReferencesUsed' then 'translate,review'
    else public._event_privilege_before_20261005b(p_type, p)
  end;
$$;

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

-- ---- timing jobs ------------------------------------------------------------------

create table if not exists public.timing_jobs (
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
  error text
);
create index if not exists timing_jobs_org on public.timing_jobs (org_id, requested_at desc);
create index if not exists timing_jobs_open on public.timing_jobs (requested_at) where finished_at is null;

create table if not exists public.timing_job_results (
  job_id uuid not null references public.timing_jobs (id) on delete cascade,
  book text not null,
  chapter int not null,
  ok boolean not null,
  body jsonb not null,
  primary key (job_id, book, chapter)
);
alter table public.timing_jobs enable row level security;
alter table public.timing_job_results enable row level security;

-- An admin asks for verse timings for some books of one source.
create or replace function public.request_timings(
  p_org text, p_item text, p_bible_id text, p_audio_fileset text, p_text_fileset text, p_books text[], p_versification text default 'eng'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.caller_id(); v_id uuid;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if not (public.org_privileges(p_org, v_actor, '_org', null) && array['manage_reference']) then
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
  -- One open job per source and audio is enough.
  select j.id into v_id from public.timing_jobs j
   where j.org_id = p_org and j.item_id = p_item and j.audio_fileset = p_audio_fileset and j.finished_at is null limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.timing_jobs (org_id, item_id, requested_by, bible_id, audio_fileset, text_fileset, books, versification, total)
  values (p_org, p_item, v_actor, p_bible_id, p_audio_fileset, p_text_fileset, p_books, coalesce(p_versification, 'eng'), 0)
  returning id into v_id;
  return v_id;
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
  if v_actor is null or not (public.org_privileges(p_org, v_actor, '_org', null) && array['manage_reference']) then
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

revoke all on function public.request_timings(text, text, text, text, text, text[], text), public.timing_jobs_for(text),
  public.timing_job_results(text, uuid), public.timing_job_claim(text), public.timing_job_progress(uuid, int, int, text),
  public.timing_job_finish(uuid, jsonb, text) from public, anon;
grant execute on function public.request_timings(text, text, text, text, text, text[], text), public.timing_jobs_for(text),
  public.timing_job_results(text, uuid) to authenticated;
revoke all on function public.timing_job_claim(text), public.timing_job_progress(uuid, int, int, text),
  public.timing_job_finish(uuid, jsonb, text) from authenticated;
grant execute on function public.timing_job_claim(text), public.timing_job_progress(uuid, int, int, text),
  public.timing_job_finish(uuid, jsonb, text) to service_role;

notify pgrst, 'reload schema';

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
revoke all on function public._library_media_readable(text, text) from public, anon;
grant execute on function public._library_media_readable(text, text) to authenticated;

drop policy if exists "blobs: library media read" on storage.objects;
create policy "blobs: library media read"
  on storage.objects for select to authenticated
  using (bucket_id = 'blobs' and public._library_media_readable(name, public.caller_id()));

-- ---- timings for LangQuest's own sources ----------------------------------------
--
-- An organization that follows one of LangQuest's sources may ask for its
-- missing timings too. The job then names LangQuest's item, and the web
-- Worker's scheduled publisher (apps/web/worker/timings.ts) publishes the
-- passing chapters as that item's next version, so every organization
-- following it gets them. Only LangQuest's items are published this way:
-- the server writes into no other organization's library.
alter table public.timing_jobs add column if not exists publish_org text;
alter table public.timing_jobs add column if not exists publish_item text;
alter table public.timing_jobs add column if not exists published_at timestamptz;

drop function if exists public.request_timings(text, text, text, text, text, text[], text);
create or replace function public.request_timings(
  p_org text, p_item text, p_bible_id text, p_audio_fileset text, p_text_fileset text, p_books text[], p_versification text default 'eng',
  p_publish_org text default null, p_publish_item text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.caller_id(); v_id uuid;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if not (public.org_privileges(p_org, v_actor, '_org', null) && array['manage_reference']) then
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
revoke all on function public.request_timings(text, text, text, text, text, text[], text, text, text) from public, anon;
grant execute on function public.request_timings(text, text, text, text, text, text[], text, text, text) to authenticated;

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
revoke all on function public.timing_jobs_to_publish(), public.timing_job_published(uuid), public.timing_job_results_for_publisher(uuid),
  public.library_docs_for_publisher(text, text) from public, anon, authenticated;
grant execute on function public.timing_jobs_to_publish(), public.timing_job_published(uuid), public.timing_job_results_for_publisher(uuid),
  public.library_docs_for_publisher(text, text) to service_role;
notify pgrst, 'reload schema';
