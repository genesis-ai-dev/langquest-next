-- Languages and regions: global reference data, not in any stream
-- (docs/languoids.md, decisions.md 73). The tables are LangQuest v2's
-- (supabase/migrations/20251001124000_add_language_region_tables.sql and
-- later, in the v2 repo) with the same names, columns and constraints:
--
--   languoid            a family, language or dialect, in a tree (parent_id)
--   languoid_alias      a name for a languoid, written in a label languoid;
--                       endonym when the label is the languoid itself
--   languoid_source     where it is catalogued: glottolog (the glottocode),
--                       iso639-3, wikidata, wikipedia, wals, ...
--   languoid_property   open key/value facts: category, hid,
--                       fia_available, ...
--   region              a macroarea or nation (or continent, debated, subnational area)
--   region_alias        a region's name in a label languoid
--   region_source       where it is catalogued (iso3166-1)
--   region_property     open key/value facts
--   languoid_region     where a languoid is spoken: majority, official, native
--
-- Differences from v2: download_profiles is left out (it was PowerSync's
-- per-user sync list, and nothing syncs these tables here); ui_ready is left
-- out (it marked v2's interface languages; this app's are still to come);
-- creator_id names a profile here (profiles.id is text).
--
-- The rows are built from Glottolog itself (scripts/glottolog.ts), not
-- copied from v2. A languoid v2 also had keeps v2's id, so imported v2
-- projects still point at it. Glottolog's own id, the glottocode, is a
-- languoid_source row (name 'glottolog'), which is how a newer release
-- finds the row it already made (scripts/languoids.ts).
--
-- Everyone may read. Only the service role writes for now; adding a
-- language people collect in the field comes with its request flow.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists postgis with schema extensions;

create type public.languoid_level as enum ('family', 'language', 'dialect');
-- description: a phrase used to identify a languoid rather than a name
-- ("Immigrant community of Vieil Arzeu in Algeria").
create type public.alias_type as enum ('endonym', 'exonym', 'description');
-- macroarea: one of Glottolog's six (Africa, Eurasia, Papunesia, ...), which
-- are not continents.
create type public.region_level as enum ('continent', 'macroarea', 'nation', 'debated', 'subnational');

create table public.languoid (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.languoid(id) on delete set null deferrable initially immediate,
  name text,
  level public.languoid_level not null,
  -- Where Glottolog places it (WGS 84 longitude and latitude), for
  -- "languages near here" and maps. v2 kept these as text properties.
  location extensions.geography(point, 4326),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_updated timestamptz not null default now(),
  creator_id text references public.profiles(id) on delete set null
);

create table public.languoid_alias (
  id uuid primary key default gen_random_uuid(),
  subject_languoid_id uuid not null references public.languoid(id) on delete cascade,
  -- null when the source does not say what language the name is in; then
  -- alias_type is null too. (v2 required both and guessed English.)
  label_languoid_id uuid references public.languoid(id) on delete restrict,
  name text not null,
  alias_type public.alias_type,
  source_names text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_updated timestamptz not null default now(),
  creator_id text references public.profiles(id) on delete set null,
  constraint uq_languoid_alias unique nulls not distinct (subject_languoid_id, label_languoid_id, alias_type, name)
);

create table public.languoid_source (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version text,
  languoid_id uuid not null references public.languoid(id) on delete cascade,
  unique_identifier text,
  url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_updated timestamptz not null default now(),
  creator_id text references public.profiles(id) on delete set null,
  constraint uq_languoid_source unique (languoid_id, name, unique_identifier)
);

create table public.languoid_property (
  id uuid primary key default gen_random_uuid(),
  languoid_id uuid not null references public.languoid(id) on delete cascade,
  key text not null,
  value text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_updated timestamptz not null default now(),
  creator_id text references public.profiles(id) on delete set null,
  constraint uq_languoid_property unique (languoid_id, key)
);

create table public.region (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.region(id) on delete set null deferrable initially immediate,
  name text,
  level public.region_level not null,
  geometry boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_updated timestamptz not null default now(),
  creator_id text references public.profiles(id) on delete set null
);

create table public.region_alias (
  id uuid primary key default gen_random_uuid(),
  subject_region_id uuid not null references public.region(id) on delete cascade,
  -- null when the source does not say what language the name is in; then
  -- alias_type is null too. (v2 required both and guessed English.)
  label_languoid_id uuid references public.languoid(id) on delete restrict,
  name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_updated timestamptz not null default now(),
  creator_id text references public.profiles(id) on delete set null,
  constraint uq_region_alias unique (subject_region_id, label_languoid_id, name)
);

create table public.region_source (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version text,
  region_id uuid not null references public.region(id) on delete cascade,
  unique_identifier text,
  url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_updated timestamptz not null default now(),
  creator_id text references public.profiles(id) on delete set null,
  constraint uq_region_source unique (region_id, unique_identifier)
);

create table public.region_property (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references public.region(id) on delete cascade,
  key text not null,
  value text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_updated timestamptz not null default now(),
  creator_id text references public.profiles(id) on delete set null,
  constraint uq_region_property unique (region_id, key)
);

create table public.languoid_region (
  id uuid primary key default gen_random_uuid(),
  languoid_id uuid not null references public.languoid(id) on delete cascade,
  region_id uuid not null references public.region(id) on delete cascade,
  majority boolean,
  official boolean,
  native boolean,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_updated timestamptz not null default now(),
  creator_id text references public.profiles(id) on delete set null,
  constraint uq_languoid_region unique (languoid_id, region_id)
);

create index idx_languoid_parent on public.languoid (parent_id);
create index idx_languoid_location on public.languoid using gist (location);
create index idx_languoid_alias_subject on public.languoid_alias (subject_languoid_id);
create index idx_languoid_alias_label on public.languoid_alias (label_languoid_id);
create index idx_languoid_source_lid on public.languoid_source (languoid_id);
create index idx_languoid_source_code on public.languoid_source (name, unique_identifier);
create index idx_languoid_prop_lid on public.languoid_property (languoid_id);
create index idx_region_alias_subject on public.region_alias (subject_region_id);
create index idx_region_alias_label on public.region_alias (label_languoid_id);
create index idx_region_alias_name on public.region_alias (name);
create index idx_region_source_rid on public.region_source (region_id);
create index idx_region_prop_rid on public.region_property (region_id);
create index idx_lreg_languoid on public.languoid_region (languoid_id);
create index idx_lreg_region on public.languoid_region (region_id);
-- search_languoids matches lower(name) anywhere in the text.
create index idx_languoid_name_trgm on public.languoid using gin (lower(name) extensions.gin_trgm_ops);
create index idx_languoid_alias_name_trgm on public.languoid_alias using gin (lower(name) extensions.gin_trgm_ops);

-- One row per Glottolog import (scripts/languoids.ts apply).
create table public.languoid_import (
  id bigint generated always as identity primary key,
  release text not null,
  applied_at timestamptz not null default now(),
  report jsonb not null
);

-- ---- read access ---------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['languoid', 'languoid_alias', 'languoid_source', 'languoid_property',
    'region', 'region_alias', 'region_source', 'region_property', 'languoid_region'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy %I on public.%I for select using (true)', t || '_select_policy', t);
  end loop;
end $$;

alter table public.languoid_import enable row level security;
revoke all on public.languoid_import from anon, authenticated;
grant all on public.languoid_import to service_role;

-- ---- reading ---------------------------------------------------------------

-- Finding a language by anything a person might type: a name or any other
-- name in any language, an ISO 639-3 code or a glottocode, with or without
-- accents, and with a typo or two. Builds on v2's search (exact, then
-- starts-with, then contains; endonyms first):
--
--   0  an exact ISO 639-3 code or glottocode
--   1  an exact name or other name
--   2  a name that starts with the text
--   3  a name with a word that starts with the text
--   4  a name that contains the text
--   5  a name spelled nearly like it (four letters or more)
--
-- Among equals, languages come before dialects and families. levels and
-- region_id narrow it (a nation or macroarea). Inactive languoids are left
-- out. matched_alias_name says which other name or code matched.
create or replace function public.search_languoids(
  search_query text,
  result_limit integer default 50,
  levels public.languoid_level[] default null,
  region_id uuid default null
)
returns table (
  id uuid,
  name text,
  level text,
  parent_id uuid,
  parent_name text,
  matched_alias_name text,
  matched_alias_type text,
  iso_code text,
  glottocode text,
  search_rank integer
)
language plpgsql
security invoker
set search_path = ''
stable
as $$
declare
  q text;
begin
  if search_query is null or length(trim(search_query)) < 2 then
    return;
  end if;
  q := extensions.unaccent(lower(trim(search_query)));

  return query
  with
  scope as (
    select l.id, l.name, l.level, l.parent_id
    from public.languoid l
    where l.active
      and (levels is null or l.level = any (levels))
      and (search_languoids.region_id is null or exists (
        select 1 from public.languoid_region lr
        where lr.languoid_id = l.id and lr.region_id = search_languoids.region_id and lr.active))
  ),
  candidates as (
    -- codes
    select s.id, ls.unique_identifier as hit, ls.name as hit_type, 0 as rank, 1.0::real as sim
    from public.languoid_source ls join scope s on s.id = ls.languoid_id
    where ls.name in ('iso639-3', 'glottolog') and ls.active and lower(ls.unique_identifier) = q
    union all
    -- names
    select s.id, null, null,
      case when n = q then 1 when n like q || '%' then 2 when n like '% ' || q || '%' or n like '%-' || q || '%' then 3 else 4 end,
      1.0::real
    from scope s, extensions.unaccent(lower(s.name)) n
    where n like '%' || q || '%'
    union all
    -- other names
    select s.id, la.name, la.alias_type::text,
      case when n = q then 1 when n like q || '%' then 2 when n like '% ' || q || '%' or n like '%-' || q || '%' then 3 else 4 end,
      1.0::real
    from public.languoid_alias la join scope s on s.id = la.subject_languoid_id,
      extensions.unaccent(lower(la.name)) n
    where la.active and la.alias_type is distinct from 'description' and n like '%' || q || '%'
    union all
    -- near spellings, only when the text is long enough to mean something
    select s.id, null, null, 5, extensions.similarity(lower(s.name), q)
    from scope s
    where length(q) >= 4 and lower(s.name) operator(extensions.%) q
    union all
    select s.id, la.name, la.alias_type::text, 5, extensions.similarity(lower(la.name), q)
    from public.languoid_alias la join scope s on s.id = la.subject_languoid_id
    where length(q) >= 4 and la.active and la.alias_type is distinct from 'description' and lower(la.name) operator(extensions.%) q
  ),
  best as (
    select distinct on (c.id) c.id, c.hit, c.hit_type, c.rank, c.sim
    from candidates c
    order by c.id, c.rank, c.sim desc, (c.hit_type = 'endonym') desc nulls last, c.hit nulls first
  )
  select s.id, s.name, s.level::text, s.parent_id, p.name, b.hit, b.hit_type,
    (select ls.unique_identifier from public.languoid_source ls
      where ls.languoid_id = s.id and ls.name = 'iso639-3' and ls.active limit 1),
    (select ls.unique_identifier from public.languoid_source ls
      where ls.languoid_id = s.id and ls.name = 'glottolog' and ls.active limit 1),
    b.rank
  from best b
  join scope s on s.id = b.id
  left join public.languoid p on p.id = s.parent_id
  order by b.rank, (s.level = 'language') desc, b.sim desc, s.name
  limit greatest(1, least(coalesce(result_limit, 50), 200));
end;
$$;

-- v2's: every nation (or those named) with its languoids.
create or replace function public.list_nations_with_languages(names text[] default null)
returns table (region_id uuid, region_name text, languages jsonb)
language sql
stable
set search_path = ''
as $$
  with nations as (
    select r.id, r.name
    from public.region r
    where r.level = 'nation'
      and (names is null or exists (select 1 from unnest(names) n where lower(n) = lower(r.name)))
  ),
  lang_rows as (
    select lr.region_id, jsonb_build_object('id', lq.id, 'name', lq.name, 'level', lq.level) as lang
    from public.languoid_region lr
    join public.languoid lq on lq.id = lr.languoid_id
    where lr.region_id in (select id from nations)
  )
  select n.id, n.name,
    coalesce((select jsonb_agg(lang order by (lang->>'name')) from lang_rows where lang_rows.region_id = n.id), '[]'::jsonb)
  from nations n
  order by n.name;
$$;

-- v2's: every nation's id and name.
create or replace function public.list_nation_names()
returns table (region_id uuid, region_name text)
language sql
stable
set search_path = ''
as $$
  select id, name from public.region where level = 'nation' order by name;
$$;

grant execute on function public.search_languoids(text, integer, public.languoid_level[], uuid) to anon, authenticated;
grant execute on function public.list_nations_with_languages(text[]) to anon, authenticated;
grant execute on function public.list_nation_names() to anon, authenticated;

-- ---- loading Glottolog (service role) ------------------------------------------
--
-- scripts/languoids.ts builds the nine tables from one Glottolog release,
-- keyed by glottocode, with the id each languoid and region will have, and
-- puts them in the staging tables below. Then:
--
--   languoid_analyze()              fresh statistics for the planner
--   languoid_import_diff()          what apply would change, languoid by languoid
--   languoid_import_counts()        how many rows apply would add, change or retire, per table
--   languoid_import_apply(release)  make the changes, record the import
--   languoid_staging_reset()        empty the staging tables
--
-- Rows the import owns are the ones with no creator_id, on languoids that
-- have a glottolog source (and, for properties, the keys Glottolog gives).
-- Of those, a row the release no longer has becomes inactive; nothing is
-- deleted, and rows people add (with a creator_id) are left alone.

create table public.languoid_staging (
  id uuid primary key,
  glottocode text not null unique,
  parent_glottocode text,
  name text not null,
  level text not null,
  latitude double precision,
  longitude double precision
);
create table public.region_staging (
  id uuid primary key,
  key text not null unique,
  name text not null,
  level text not null,
  iso3166_1 text
);
create table public.languoid_alias_staging (
  glottocode text not null,
  label_glottocode text,
  name text not null,
  alias_type text,
  source_names text[] not null default '{}'
);
create table public.languoid_source_staging (
  glottocode text not null,
  name text not null,
  version text,
  unique_identifier text not null,
  url text
);
create table public.languoid_property_staging (
  glottocode text not null,
  key text not null,
  value text not null
);
create table public.languoid_region_staging (
  glottocode text not null,
  region_key text not null
);
create index on public.languoid_alias_staging (glottocode);
create index on public.languoid_source_staging (glottocode);
create index on public.languoid_property_staging (glottocode);
create index on public.languoid_region_staging (glottocode);

do $$
declare t text;
begin
  foreach t in array array['languoid_staging', 'region_staging', 'languoid_alias_staging', 'languoid_source_staging',
    'languoid_property_staging', 'languoid_region_staging'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- The keys Glottolog gives; other keys (fia_available, ...) are not the import's.
create or replace function public._languoid_import_keys()
returns text[] language sql immutable as $$ select array['hid', 'category', 'iso_retirement_reason', 'iso_retirement_note', 'iso_retirement_date', 'replaced_by', 'glottolog_note'] $$;

create or replace function public.languoid_staging_reset()
returns void language sql security definer set search_path = public as $$
  truncate languoid_staging, region_staging, languoid_alias_staging, languoid_source_staging,
    languoid_property_staging, languoid_region_staging;
$$;

-- Fresh statistics after a bulk load, without which the planner picks
-- plans that take a minute instead of a second.
create or replace function public.languoid_analyze()
returns void language plpgsql security definer set search_path = public as $$
begin
  analyze languoid_staging; analyze region_staging; analyze languoid_alias_staging;
  analyze languoid_source_staging; analyze languoid_property_staging; analyze languoid_region_staging;
  analyze languoid; analyze languoid_alias; analyze languoid_source; analyze languoid_property;
  analyze languoid_region; analyze region; analyze region_source;
end $$;

-- The staged rows with ids in place of glottocodes and region keys.
create or replace view public._languoid_staged_alias with (security_invoker = true) as
  select s.id as subject_languoid_id, lb.id as label_languoid_id, a.name, a.alias_type::alias_type as alias_type, a.source_names
  from languoid_alias_staging a
  join languoid_staging s on s.glottocode = a.glottocode
  left join languoid_staging lb on lb.glottocode = a.label_glottocode;
create or replace view public._languoid_staged_source with (security_invoker = true) as
  select s.id as languoid_id, x.name, x.version, x.unique_identifier, x.url
  from languoid_source_staging x join languoid_staging s on s.glottocode = x.glottocode;
create or replace view public._languoid_staged_property with (security_invoker = true) as
  select s.id as languoid_id, x.key, x.value
  from languoid_property_staging x join languoid_staging s on s.glottocode = x.glottocode;
create or replace view public._languoid_staged_region with (security_invoker = true) as
  select distinct s.id as languoid_id, r.id as region_id
  from languoid_region_staging x
  join languoid_staging s on s.glottocode = x.glottocode
  join region_staging r on r.key = x.region_key;
-- Languoids the import owns: those with a glottolog source.
create or replace view public._languoid_glottolog with (security_invoker = true) as
  select ls.languoid_id as id, ls.unique_identifier as glottocode
  from languoid_source ls where ls.name = 'glottolog' and ls.creator_id is null;
revoke all on public._languoid_staged_alias, public._languoid_staged_source, public._languoid_staged_property,
  public._languoid_staged_region, public._languoid_glottolog from anon, authenticated;
grant select on public._languoid_staged_alias, public._languoid_staged_source, public._languoid_staged_property,
  public._languoid_staged_region, public._languoid_glottolog to service_role;

-- What apply would do to languoids, one row per change:
--   new          a languoid not here yet (new: where its id comes from is the script's)
--   changed      field (name, level, parent) goes from old to new
--   deactivated  has a glottocode this release no longer has; active = false
--   reactivated  was inactive, back in this release
create or replace function public.languoid_import_diff()
returns table(change text, glottocode text, id uuid, name text, field text, old text, new text)
language sql stable security definer set search_path = public as $$
  with cur as (
    select s.glottocode, s.id, l.name, l.level::text as level, l.active,
      (select g.glottocode from _languoid_glottolog g where g.id = l.parent_id) as parent_glottocode
    from languoid_staging s join languoid l on l.id = s.id
  )
  select 'new', s.glottocode, s.id, s.name, null, null, s.level
  from languoid_staging s where not exists (select 1 from languoid l where l.id = s.id)
  union all
  select 'changed', c.glottocode, c.id, s.name, f.field, f.old, f.new
  from cur c join languoid_staging s using (glottocode)
  cross join lateral (values ('name', c.name, s.name), ('level', c.level, s.level), ('parent', c.parent_glottocode, s.parent_glottocode)) as f(field, old, new)
  where f.old is distinct from f.new
  union all
  select 'deactivated', g.glottocode, g.id, l.name, null, null, null
  from _languoid_glottolog g join languoid l on l.id = g.id
  where l.active and not exists (select 1 from languoid_staging s where s.glottocode = g.glottocode)
  union all
  select 'reactivated', c.glottocode, c.id, c.name, null, null, null
  from cur c where not c.active;
$$;

-- How many rows apply would add, change and retire in each table.
create or replace function public.languoid_import_counts()
returns table(what text, n bigint)
language sql stable security definer set search_path = public as $$
  with owned as (select id from languoid_staging)
  select 'region added', count(*) from region_staging s where not exists (select 1 from region r where r.id = s.id)
  union all select 'region renamed', count(*) from region_staging s join region r on r.id = s.id where r.name is distinct from s.name
  union all select 'languoid location set or moved', count(*) from languoid_staging s join languoid l on l.id = s.id
    where s.latitude is not null and (l.location is null
      or abs(extensions.st_y(l.location::extensions.geometry) - s.latitude) > 1e-9 or abs(extensions.st_x(l.location::extensions.geometry) - s.longitude) > 1e-9)
  union all select 'region_source added', count(*) from region_staging s
    where s.iso3166_1 is not null and not exists (select 1 from region_source x where x.region_id = s.id and x.unique_identifier = s.iso3166_1)
  union all select 'languoid_alias added', count(*) from _languoid_staged_alias a
    where not exists (select 1 from languoid_alias x where x.subject_languoid_id = a.subject_languoid_id and x.name = a.name and x.label_languoid_id is not distinct from a.label_languoid_id and x.alias_type is not distinct from a.alias_type)
  union all select 'languoid_alias changed', count(*) from _languoid_staged_alias a join languoid_alias x
    on x.subject_languoid_id = a.subject_languoid_id and x.name = a.name and x.label_languoid_id is not distinct from a.label_languoid_id and x.alias_type is not distinct from a.alias_type
    where x.source_names is distinct from a.source_names or not x.active
  union all select 'languoid_alias retired', count(*) from languoid_alias x
    where x.active and x.creator_id is null and x.subject_languoid_id in (select id from owned)
      and not exists (select 1 from _languoid_staged_alias a where x.subject_languoid_id = a.subject_languoid_id and x.name = a.name and x.label_languoid_id is not distinct from a.label_languoid_id and x.alias_type is not distinct from a.alias_type)
  union all select 'languoid_source added', count(*) from _languoid_staged_source a
    where not exists (select 1 from languoid_source x where (x.languoid_id, x.name, x.unique_identifier) = (a.languoid_id, a.name, a.unique_identifier))
  union all select 'languoid_source changed', count(*) from _languoid_staged_source a join languoid_source x
    on (x.languoid_id, x.name, x.unique_identifier) = (a.languoid_id, a.name, a.unique_identifier)
    where (x.version, x.url, x.active) is distinct from (a.version, a.url, true)
  union all select 'languoid_source retired', count(*) from languoid_source x
    where x.active and x.creator_id is null and x.languoid_id in (select id from owned)
      and not exists (select 1 from _languoid_staged_source a where (x.languoid_id, x.name, x.unique_identifier) = (a.languoid_id, a.name, a.unique_identifier))
  union all select 'languoid_property added', count(*) from _languoid_staged_property a
    where not exists (select 1 from languoid_property x where (x.languoid_id, x.key) = (a.languoid_id, a.key))
  union all select 'languoid_property changed', count(*) from _languoid_staged_property a join languoid_property x
    on (x.languoid_id, x.key) = (a.languoid_id, a.key)
    where (x.value, x.active) is distinct from (a.value, true)
  union all select 'languoid_property retired', count(*) from languoid_property x
    where x.active and x.creator_id is null and x.key = any (_languoid_import_keys()) and x.languoid_id in (select id from owned)
      and not exists (select 1 from _languoid_staged_property a where (x.languoid_id, x.key) = (a.languoid_id, a.key))
  union all select 'languoid_region added', count(*) from _languoid_staged_region a
    where not exists (select 1 from languoid_region x where (x.languoid_id, x.region_id) = (a.languoid_id, a.region_id))
  union all select 'languoid_region retired', count(*) from languoid_region x
    where x.active and x.creator_id is null and x.languoid_id in (select id from owned)
      and not exists (select 1 from _languoid_staged_region a where (x.languoid_id, x.region_id) = (a.languoid_id, a.region_id));
$$;

create or replace function public.languoid_import_apply(p_release text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_report jsonb;
begin
  if not exists (select 1 from languoid_staging) then
    raise exception 'nothing staged: build a Glottolog release first';
  end if;
  -- A staged id must be the one this glottocode already has, or one no other languoid has.
  if exists (
    select 1 from languoid_staging s join _languoid_glottolog g on g.glottocode = s.glottocode where g.id <> s.id
    union all
    select 1 from languoid_staging s join _languoid_glottolog g on g.id = s.id where g.glottocode <> s.glottocode
  ) then
    raise exception 'staged ids disagree with the glottocodes already here; build the release again';
  end if;

  select jsonb_object_agg(change, n) into v_report
  from (select change, count(*) as n from languoid_import_diff() group by change) c;
  v_report := coalesce(v_report, '{}'::jsonb)
    || coalesce((select jsonb_object_agg(what, n) from languoid_import_counts() where n > 0), '{}'::jsonb);

  -- Regions.
  insert into region (id, name, level)
  select s.id, s.name, s.level::region_level from region_staging s
  on conflict (id) do update set name = excluded.name, active = true, last_updated = now()
    where (region.name, region.active) is distinct from (excluded.name, true);
  insert into region_source (name, region_id, unique_identifier)
  select 'iso3166-1', s.id, s.iso3166_1 from region_staging s where s.iso3166_1 is not null
  on conflict on constraint uq_region_source do nothing;

  -- Languoids, then the tree, then those the release no longer has.
  insert into languoid (id, name, level, location)
  select s.id, s.name, s.level::languoid_level,
    case when s.latitude is not null and s.longitude is not null
      then extensions.st_setsrid(extensions.st_makepoint(s.longitude, s.latitude), 4326)::extensions.geography end
  from languoid_staging s
  on conflict (id) do update set name = excluded.name, level = excluded.level, location = excluded.location, active = true, last_updated = now()
    where (languoid.name, languoid.level, languoid.active) is distinct from (excluded.name, excluded.level, true)
      or not extensions.st_equals(coalesce(languoid.location::extensions.geometry, 'POINT EMPTY'), coalesce(excluded.location::extensions.geometry, 'POINT EMPTY'));
  update languoid l set parent_id = p.id, last_updated = now()
  from languoid_staging s left join languoid_staging p on p.glottocode = s.parent_glottocode
  where l.id = s.id and l.parent_id is distinct from p.id;
  update languoid l set active = false, last_updated = now()
  from _languoid_glottolog g
  where l.id = g.id and l.active and not exists (select 1 from languoid_staging s where s.glottocode = g.glottocode);

  -- Sources (the glottocode first, so the languoid is the import's from here on).
  insert into languoid_source (languoid_id, name, version, unique_identifier, url)
  select languoid_id, name, version, unique_identifier, url from _languoid_staged_source
  order by (name = 'glottolog') desc
  on conflict on constraint uq_languoid_source do update
    set version = excluded.version, url = excluded.url, active = true, last_updated = now()
    where (languoid_source.version, languoid_source.url, languoid_source.active) is distinct from (excluded.version, excluded.url, true);
  update languoid_source x set active = false, last_updated = now()
  where x.active and x.creator_id is null and x.languoid_id in (select id from languoid_staging)
    and not exists (select 1 from _languoid_staged_source a where (x.languoid_id, x.name, x.unique_identifier) = (a.languoid_id, a.name, a.unique_identifier));

  -- Properties.
  insert into languoid_property (languoid_id, key, value)
  select languoid_id, key, value from _languoid_staged_property
  on conflict on constraint uq_languoid_property do update set value = excluded.value, active = true, last_updated = now()
    where (languoid_property.value, languoid_property.active) is distinct from (excluded.value, true);
  update languoid_property x set active = false, last_updated = now()
  where x.active and x.creator_id is null and x.key = any (_languoid_import_keys()) and x.languoid_id in (select id from languoid_staging)
    and not exists (select 1 from _languoid_staged_property a where (x.languoid_id, x.key) = (a.languoid_id, a.key));

  -- Names.
  insert into languoid_alias (subject_languoid_id, label_languoid_id, name, alias_type, source_names)
  select subject_languoid_id, label_languoid_id, name, alias_type, source_names from _languoid_staged_alias
  on conflict on constraint uq_languoid_alias do update set source_names = excluded.source_names, active = true, last_updated = now()
    where (languoid_alias.source_names, languoid_alias.active) is distinct from (excluded.source_names, true);
  update languoid_alias x set active = false, last_updated = now()
  where x.active and x.creator_id is null and x.subject_languoid_id in (select id from languoid_staging)
    and not exists (select 1 from _languoid_staged_alias a where x.subject_languoid_id = a.subject_languoid_id and x.name = a.name and x.label_languoid_id is not distinct from a.label_languoid_id and x.alias_type is not distinct from a.alias_type);

  -- Where each is spoken.
  insert into languoid_region (languoid_id, region_id)
  select languoid_id, region_id from _languoid_staged_region
  on conflict on constraint uq_languoid_region do update set active = true, last_updated = now()
    where not languoid_region.active;
  update languoid_region x set active = false, last_updated = now()
  where x.active and x.creator_id is null and x.languoid_id in (select id from languoid_staging)
    and not exists (select 1 from _languoid_staged_region a where (x.languoid_id, x.region_id) = (a.languoid_id, a.region_id));

  insert into languoid_import (release, report) values (p_release, v_report);
  perform languoid_staging_reset();
  return v_report;
end $$;

do $$
declare f text;
begin
  foreach f in array array['_languoid_import_keys()', 'languoid_staging_reset()', 'languoid_analyze()',
    'languoid_import_diff()', 'languoid_import_counts()', 'languoid_import_apply(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ---- the language explorer (the web app's /languages) ---------------------------

-- Every languoid and region with their names, sources, properties and
-- links, in the explorer page's shape (apps/mobile/public/languages.html):
-- one array per column, rows referring to each other by position. The
-- Worker caches it (/api/languoids), so it runs about once an hour.
create or replace function public.languoid_explorer()
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  with
  l as (select x.*, (row_number() over (order by x.name, x.id) - 1)::int as i from languoid x),
  r as (select x.*, (row_number() over (order by x.level, x.name, x.id) - 1)::int as i from region x),
  gc as (select languoid_id, min(unique_identifier) as code from languoid_source where name = 'glottolog' group by 1),
  iso as (select languoid_id, min(unique_identifier) as code from languoid_source where name = 'iso639-3' group by 1),
  a as (
    select s.i as subject, coalesce(lb.i, -1) as label, x.name,
      case x.alias_type when 'endonym' then 1 when 'exonym' then 0 when 'description' then 3 else 2 end as type,
      array_to_string(x.source_names, '|') as sources
    from languoid_alias x join l s on s.id = x.subject_languoid_id left join l lb on lb.id = x.label_languoid_id
    where x.active
  ),
  sl as (select sources, (row_number() over (order by sources) - 1)::int as k from (select distinct sources from a) d),
  src as (select l.i, x.name, x.unique_identifier, x.url, x.version from languoid_source x join l on l.id = x.languoid_id where x.active),
  kl as (select name, (row_number() over (order by name) - 1)::int as k from (select distinct name from src) d),
  prop as (select l.i, x.key, x.value from languoid_property x join l on l.id = x.languoid_id where x.active),
  pk as (select key, (row_number() over (order by key) - 1)::int as k from (select distinct key from prop) d),
  lr as (select l.i as li, r.i as ri from languoid_region x join l on l.id = x.languoid_id join r on r.id = x.region_id where x.active)
  select jsonb_build_object(
    'release', (select release from languoid_import order by id desc limit 1),
    'built', (select applied_at from languoid_import order by id desc limit 1),
    'live', true,
    'unlabelled', '{}'::jsonb,
    'languoid', (select jsonb_build_object(
      'id', jsonb_agg(l.id order by l.i),
      'glottocode', jsonb_agg(coalesce(gc.code, '') order by l.i),
      'name', jsonb_agg(l.name order by l.i),
      'level', jsonb_agg(case l.level when 'family' then 0 when 'language' then 1 else 2 end order by l.i),
      'parent', jsonb_agg(coalesce(p.i, -1) order by l.i),
      'origin', jsonb_agg('' order by l.i),
      'lat', jsonb_agg(st_y(l.location::geometry) order by l.i),
      'lon', jsonb_agg(st_x(l.location::geometry) order by l.i))
      from l left join l p on p.id = l.parent_id left join gc on gc.languoid_id = l.id),
    'alias', (select jsonb_build_object(
      'subject', coalesce(jsonb_agg(a.subject), '[]'), 'label', coalesce(jsonb_agg(a.label), '[]'),
      'name', coalesce(jsonb_agg(a.name), '[]'), 'type', coalesce(jsonb_agg(a.type), '[]'),
      'sources', coalesce(jsonb_agg(sl.k), '[]'),
      'sourceList', (select coalesce(jsonb_agg(sources order by k), '[]') from sl))
      from a join sl using (sources)),
    'source', (select jsonb_build_object(
      'languoid', coalesce(jsonb_agg(src.i), '[]'), 'kind', coalesce(jsonb_agg(kl.k), '[]'),
      'kindList', (select coalesce(jsonb_agg(name order by k), '[]') from kl),
      'id', coalesce(jsonb_agg(src.unique_identifier), '[]'),
      'url', coalesce(jsonb_agg(case when src.name = 'glottolog' then '' else coalesce(src.url, '') end), '[]'),
      'version', coalesce(jsonb_agg(coalesce(src.version, '')), '[]'))
      from src join kl using (name)),
    'property', (select jsonb_build_object(
      'languoid', coalesce(jsonb_agg(prop.i), '[]'), 'key', coalesce(jsonb_agg(pk.k), '[]'),
      'keyList', (select coalesce(jsonb_agg(key order by k), '[]') from pk),
      'value', coalesce(jsonb_agg(prop.value), '[]'))
      from prop join pk using (key)),
    'umbrella', (select coalesce(jsonb_agg(jsonb_build_object('family', f.i, 'code', coalesce(iso.code, ''), 'proposed', -1)), '[]')
      from l f left join iso on iso.languoid_id = f.id
      where f.level = 'family' and exists (select 1 from languoid_alias x where x.label_languoid_id = f.id and x.active)),
    'region', (select jsonb_build_object(
      'id', coalesce(jsonb_agg(r.id order by r.i), '[]'),
      'name', coalesce(jsonb_agg(r.name order by r.i), '[]'),
      'level', coalesce(jsonb_agg(r.level order by r.i), '[]'),
      'iso', coalesce(jsonb_agg(coalesce((select min(unique_identifier) from region_source s where s.region_id = r.id and s.name = 'iso3166-1'), '') order by r.i), '[]'))
      from r),
    'languoidRegion', (select jsonb_build_object('languoid', coalesce(jsonb_agg(li), '[]'), 'region', coalesce(jsonb_agg(ri), '[]')) from lr)
  );
$$;
revoke all on function public.languoid_explorer() from public, anon, authenticated;
grant execute on function public.languoid_explorer() to service_role;
