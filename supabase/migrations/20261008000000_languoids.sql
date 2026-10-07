-- Languages and regions: global reference data, not in any stream
-- (docs/languoids.md, decisions.md 70). The tables are LangQuest v2's
-- (supabase/migrations/20251001124000_add_language_region_tables.sql and
-- later, in the v2 repo) with the same names, columns and constraints:
--
--   languoid            a family, language or dialect, in a tree (parent_id)
--   languoid_alias      a name for a languoid, written in a label languoid;
--                       endonym when the label is the languoid itself
--   languoid_source     where it is catalogued: glottolog (the glottocode),
--                       iso639-3, wikidata, wikipedia, wals, ...
--   languoid_property   open key/value facts: category, macroareas, hid,
--                       latitude, longitude, fia_available, ...
--   region              a continent or nation (or debated, subnational area)
--   region_alias        a region's name in a label languoid
--   region_source       where it is catalogued (iso3166-1)
--   region_property     open key/value facts
--   languoid_region     where a languoid is spoken: majority, official, native
--
-- Two differences from v2. download_profiles is left out: it was
-- PowerSync's per-user sync list, and nothing syncs these tables here.
-- creator_id names a profile here (profiles.id is text).
--
-- Rows keep v2's ids. Glottolog's own id, the glottocode, is a
-- languoid_source row (name 'glottolog'), which is how a newer Glottolog
-- release finds the row it already made (scripts/languoids.ts).
--
-- Everyone may read. Only the service role writes for now; adding a
-- language people collect in the field comes with its request flow.

create extension if not exists pg_trgm with schema extensions;

create type public.languoid_level as enum ('family', 'language', 'dialect');
create type public.alias_type as enum ('endonym', 'exonym');
create type public.region_level as enum ('continent', 'nation', 'debated', 'subnational');

create table public.languoid (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.languoid(id) on delete set null deferrable initially immediate,
  name text,
  level public.languoid_level not null,
  ui_ready boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_updated timestamptz not null default now(),
  creator_id text references public.profiles(id) on delete set null
);

create table public.languoid_alias (
  id uuid primary key default gen_random_uuid(),
  subject_languoid_id uuid not null references public.languoid(id) on delete cascade,
  label_languoid_id uuid not null references public.languoid(id) on delete restrict,
  name text not null,
  alias_type public.alias_type not null,
  source_names text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_updated timestamptz not null default now(),
  creator_id text references public.profiles(id) on delete set null,
  constraint uq_languoid_alias unique (subject_languoid_id, label_languoid_id, alias_type, name)
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
  label_languoid_id uuid not null references public.languoid(id) on delete restrict,
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

-- ---- reading: v2's RPCs ------------------------------------------------------

-- v2's search (20251125120000_add_languoid_references.sql, step 15): names
-- and aliases, exact, then starts-with, then contains, preferring
-- endonyms. Added here: an exact ISO 639-3 code or glottocode ranks first
-- (rank 0, the code in matched_alias_name and its source in
-- matched_alias_type), and each row says its glottocode.
create or replace function public.search_languoids(
  search_query text,
  result_limit integer default 50,
  ui_ready_only boolean default false
)
returns table (
  id uuid,
  name text,
  level text,
  ui_ready boolean,
  parent_id uuid,
  matched_alias_name text,
  matched_alias_type text,
  iso_code text,
  search_rank integer,
  glottocode text
)
language plpgsql
security invoker
set search_path = ''
stable
as $$
declare
  normalized_query text;
begin
  if search_query is null or length(trim(search_query)) < 2 then
    return;
  end if;
  normalized_query := lower(trim(search_query));

  return query
  with
  code_matches as (
    select l.id, l.name, l.level::text as level, l.ui_ready, l.parent_id,
      ls.unique_identifier as matched_alias_name, ls.name as matched_alias_type, 0 as search_rank
    from public.languoid_source ls
    join public.languoid l on l.id = ls.languoid_id
    where ls.name in ('iso639-3', 'glottolog') and ls.active = true
      and lower(ls.unique_identifier) = normalized_query
      and l.active = true
      and (not ui_ready_only or l.ui_ready = true)
  ),
  languoid_name_matches as (
    select l.id, l.name, l.level::text as level, l.ui_ready, l.parent_id,
      null::text as matched_alias_name, null::text as matched_alias_type,
      case
        when lower(l.name) = normalized_query then 1
        when lower(l.name) like normalized_query || '%' then 2
        else 3
      end as search_rank
    from public.languoid l
    where l.active = true
      and lower(l.name) ilike '%' || normalized_query || '%'
      and (not ui_ready_only or l.ui_ready = true)
  ),
  alias_matches as (
    select distinct on (l.id)
      l.id, l.name, l.level::text as level, l.ui_ready, l.parent_id,
      la.name as matched_alias_name, la.alias_type::text as matched_alias_type,
      case
        when lower(la.name) = normalized_query then 1
        when lower(la.name) like normalized_query || '%' then 2
        else 3
      end as search_rank
    from public.languoid l
    join public.languoid_alias la on la.subject_languoid_id = l.id and la.active = true
    where l.active = true
      and lower(la.name) ilike '%' || normalized_query || '%'
      and (not ui_ready_only or l.ui_ready = true)
    order by l.id,
      case
        when lower(la.name) = normalized_query then 1
        when lower(la.name) like normalized_query || '%' then 2
        else 3
      end,
      la.alias_type -- endonyms first
  ),
  combined as (
    select * from code_matches
    union all
    select * from languoid_name_matches
    union all
    select * from alias_matches
  ),
  ranked as (
    select distinct on (c.id) c.*
    from combined c
    order by c.id, c.search_rank, c.matched_alias_name nulls last
  )
  select r.id, r.name, r.level, r.ui_ready, r.parent_id, r.matched_alias_name, r.matched_alias_type,
    (select ls.unique_identifier from public.languoid_source ls
      where ls.languoid_id = r.id and lower(ls.name) = 'iso639-3' and ls.active = true limit 1),
    r.search_rank,
    (select ls.unique_identifier from public.languoid_source ls
      where ls.languoid_id = r.id and ls.name = 'glottolog' and ls.active = true limit 1)
  from ranked r
  order by r.search_rank, r.name
  limit result_limit;
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

grant execute on function public.search_languoids(text, integer, boolean) to anon, authenticated;
grant execute on function public.list_nations_with_languages(text[]) to anon, authenticated;
grant execute on function public.list_nation_names() to anon, authenticated;

-- ---- importing Glottolog (service role) ---------------------------------------
--
--   languoid_staging_reset()        empty the staging tables
--   (insert the release into them)
--   languoid_analyze()              fresh statistics for the planner
--   languoid_import_diff()          what apply would change, row by row
--   languoid_import_counts()        how many rows apply would add, per table
--   languoid_import_apply(release)  make the changes, record the import

create table public.languoid_staging_glottolog (
  glottocode text primary key,
  parent_glottocode text,
  name text not null,
  level text not null,
  category text,
  iso639_3 text,
  latitude double precision,
  longitude double precision,
  macroareas text[] not null default '{}',
  countries text[] not null default '{}'
);
create index on public.languoid_staging_glottolog (parent_glottocode);
create index on public.languoid_staging_glottolog (iso639_3);

-- label_iso639_3: the ISO 639-3 code of the language the name is written in.
create table public.languoid_staging_glottolog_name (
  glottocode text not null,
  name text not null,
  label_iso639_3 text not null,
  providers text[] not null default '{}'
);
create index on public.languoid_staging_glottolog_name (glottocode);

alter table public.languoid_staging_glottolog enable row level security;
alter table public.languoid_staging_glottolog_name enable row level security;
revoke all on public.languoid_staging_glottolog, public.languoid_staging_glottolog_name from anon, authenticated;
grant all on public.languoid_staging_glottolog, public.languoid_staging_glottolog_name to service_role;

-- Each languoid with no glottolog source, matched to the staged glottocode
-- it is (at most one each way): its ISO 639-3 code where that is unique on
-- both sides, else its chain of names from the root, else a name and level
-- only one languoid has. v2 never kept glottocodes, so this links its rows
-- on the first import; after that every Glottolog row has its source.
create or replace function public._languoid_glottocode_matches()
returns table(languoid_id uuid, glottocode text, matched_on text)
language sql stable set search_path = public as $$
  with recursive
  linked as (select ls.unique_identifier as glottocode from languoid_source ls where ls.name = 'glottolog'),
  cand as (
    select l.id, l.parent_id, coalesce(l.name, '') as name, l.level::text as level,
      (select ls.unique_identifier from languoid_source ls where ls.languoid_id = l.id and ls.name = 'iso639-3' limit 1) as iso
    from languoid l
    where l.creator_id is null
      and not exists (select 1 from languoid_source ls where ls.languoid_id = l.id and ls.name = 'glottolog')
  ),
  lq_path as (
    select l.id, l.name || ':' || l.level::text as path, l.parent_id as next_id, 0 as depth
    from languoid l where l.id in (select id from cand)
    union all
    select p.id, coalesce(a.name, '') || ':' || a.level::text || '/' || p.path, a.parent_id, p.depth + 1
    from lq_path p join languoid a on a.id = p.next_id
    where p.depth < 64
  ),
  lq_full as (select id, path from lq_path where next_id is null),
  gl as (
    select g.*, count(*) over (partition by g.iso639_3) as iso_n, count(*) over (partition by g.name, g.level) as name_n
    from languoid_staging_glottolog g
    where g.glottocode not in (select glottocode from linked)
  ),
  gl_path as (
    select g.glottocode, g.name || ':' || g.level as path, g.parent_glottocode as next_code, 0 as depth
    from languoid_staging_glottolog g
    union all
    select p.glottocode, a.name || ':' || a.level || '/' || p.path, a.parent_glottocode, p.depth + 1
    from gl_path p join languoid_staging_glottolog a on a.glottocode = p.next_code
    where p.depth < 64
  ),
  gl_unique_path as (
    select path, min(glottocode) as glottocode from gl_path where next_code is null group by path having count(*) = 1
  ),
  c as (
    select cand.*, count(*) over (partition by iso) as iso_n, count(*) over (partition by name, level) as name_n from cand
  ),
  candidates as (
    select c.id, gl.glottocode, 'iso639-3'::text as matched_on, 1 as rank
    from c join gl on gl.iso639_3 = c.iso
    where c.iso is not null and c.iso_n = 1 and gl.iso_n = 1
    union all
    select f.id, u.glottocode, 'name path', 2
    from lq_full f join gl_unique_path u on u.path = f.path
    where u.glottocode not in (select glottocode from linked)
    union all
    select c.id, gl.glottocode, 'name and level', 3
    from c join gl on gl.name = c.name and gl.level = c.level
    where c.name_n = 1 and gl.name_n = 1
  ),
  best as (
    select distinct on (id) id, glottocode, matched_on, rank from candidates order by id, rank
  )
  select distinct on (b.glottocode) b.id, b.glottocode, b.matched_on
  from best b
  order by b.glottocode, b.rank, b.id;
$$;

-- Fresh statistics after a bulk load, without which matching plans badly
-- (a minute instead of a second). The script calls it after staging.
create or replace function public.languoid_analyze()
returns void language plpgsql security definer set search_path = public as $$
begin
  analyze languoid_staging_glottolog;
  analyze languoid_staging_glottolog_name;
  analyze languoid;
  analyze languoid_alias;
  analyze languoid_source;
  analyze languoid_property;
  analyze languoid_region;
  analyze region;
  analyze region_source;
end $$;

create or replace function public.languoid_staging_reset()
returns void language sql security definer set search_path = public as $$
  truncate languoid_staging_glottolog, languoid_staging_glottolog_name;
$$;

-- What apply would do to languoids, one row per change:
--   linked       a languoid gets its glottocode (new: how it was matched)
--   unmatched    a languoid with no glottocode and no match; left as it is
--   new          a Glottolog languoid not here yet
--   changed      field (name, level, parent, iso639-3) goes from old to new
--   deactivated  has a glottocode this release no longer has; active = false
--   reactivated  was deactivated, back in this release
create or replace function public.languoid_import_diff()
returns table(change text, glottocode text, id uuid, name text, field text, old text, new text)
language sql stable security definer set search_path = public as $$
  with
  m as (select * from _languoid_glottocode_matches()),
  -- Every languoid's glottocode: from its source row, or matched now.
  gc as (
    select ls.languoid_id as id, ls.unique_identifier as glottocode from languoid_source ls where ls.name = 'glottolog'
    union all
    select m.languoid_id, m.glottocode from m
  ),
  iso as (
    select ls.languoid_id as id, min(ls.unique_identifier) as iso from languoid_source ls where ls.name = 'iso639-3' group by 1
  ),
  cur2 as (
    select gc.glottocode, l.id, l.name, l.level::text as level, l.active, pg.glottocode as parent_glottocode, iso.iso
    from gc
    join languoid l on l.id = gc.id
    left join gc pg on pg.id = l.parent_id
    left join iso on iso.id = l.id
  )
  select 'linked', m.glottocode, m.languoid_id, l.name, null, null, m.matched_on
  from m join languoid l on l.id = m.languoid_id
  union all
  select 'unmatched', null, l.id, l.name, null, l.level::text, null
  from languoid l
  where l.creator_id is null
    and not exists (select 1 from languoid_source ls where ls.languoid_id = l.id and ls.name = 'glottolog')
    and not exists (select 1 from m where m.languoid_id = l.id)
  union all
  select 'new', g.glottocode, null, g.name, null, null, g.level
  from languoid_staging_glottolog g
  where not exists (select 1 from cur2 c where c.glottocode = g.glottocode)
  union all
  select 'changed', c.glottocode, c.id, g.name, f.field, f.old, f.new
  from cur2 c join languoid_staging_glottolog g using (glottocode)
  cross join lateral (values
    ('name', c.name, g.name),
    ('level', c.level, g.level),
    ('parent', c.parent_glottocode, g.parent_glottocode),
    ('iso639-3', c.iso, g.iso639_3)
  ) as f(field, old, new)
  -- An ISO code Glottolog adds is counted by languoid_import_counts; a
  -- languoid keeps one Glottolog leaves out. Only a different code is a change.
  where f.old is distinct from f.new and not (f.field = 'iso639-3' and (f.new is null or f.old is null))
  union all
  select 'deactivated', c.glottocode, c.id, c.name, null, null, null
  from cur2 c
  where c.active and not exists (select 1 from languoid_staging_glottolog g where g.glottocode = c.glottocode)
  union all
  select 'reactivated', c.glottocode, c.id, c.name, null, null, null
  from cur2 c
  where not c.active and exists (select 1 from languoid_staging_glottolog g where g.glottocode = c.glottocode);
$$;

-- The glottocode -> languoid id each staged languoid will have: linked rows,
-- matched rows, and a new id for the rest. Used by counts and apply.
create or replace function public._languoid_import_ids()
returns table(glottocode text, id uuid, is_new boolean)
language sql volatile set search_path = public as $$
  with known as (
    select ls.unique_identifier as glottocode, ls.languoid_id as id from languoid_source ls where ls.name = 'glottolog'
    union all
    select m.glottocode, m.languoid_id from _languoid_glottocode_matches() m
  )
  select g.glottocode, coalesce(k.id, gen_random_uuid()), k.id is null
  from languoid_staging_glottolog g left join known k using (glottocode);
$$;

-- How many rows apply would add to each table (aliases, sources,
-- properties written or changed, region links), and what it leaves out.
create or replace function public.languoid_import_counts()
returns table(what text, n bigint)
language plpgsql volatile security definer set search_path = public as $$
begin
  create temp table if not exists _ids (glottocode text primary key, id uuid, is_new boolean) on commit drop;
  truncate _ids;
  insert into _ids select * from _languoid_import_ids();
  -- Labels as they will be once apply has added the release's ISO codes.
  create temp table if not exists _label (iso text primary key, id uuid) on commit drop;
  truncate _label;
  insert into _label
  select iso, min(id::text)::uuid from (
    select ls.unique_identifier as iso, ls.languoid_id as id
    from languoid_source ls join languoid l on l.id = ls.languoid_id
    where ls.name = 'iso639-3' and l.active
    union
    select g.iso639_3, i.id from languoid_staging_glottolog g join _ids i using (glottocode)
    where g.iso639_3 is not null
  ) x
  group by iso having count(distinct id) = 1;

  return query
  select 'languoid_alias added', count(*) from (
    select distinct i.id, lb.id as label, s.name,
      case when lb.id = i.id then 'endonym' else 'exonym' end as t
    from languoid_staging_glottolog_name s
    join _ids i using (glottocode)
    join _label lb on lb.iso = s.label_iso639_3
  ) a
  where not exists (select 1 from languoid_alias x where x.subject_languoid_id = a.id and x.label_languoid_id = a.label
    and x.alias_type::text = a.t and x.name = a.name)
  union all
  select 'names left out (label language not here)', count(*)
  from languoid_staging_glottolog_name s
  where not exists (select 1 from _label lb where lb.iso = s.label_iso639_3)
  union all
  select 'languoid_source glottolog added', count(*) from _ids i
  where not exists (select 1 from languoid_source x where x.languoid_id = i.id and x.name = 'glottolog')
  union all
  select 'languoid_source iso639-3 added', count(*) from languoid_staging_glottolog g join _ids i using (glottocode)
  where g.iso639_3 is not null and not exists (select 1 from languoid_source x where x.languoid_id = i.id and x.name = 'iso639-3')
  union all
  select 'languoid_property written', count(*) from _languoid_staged_properties() p join _ids i using (glottocode)
  where (i.is_new or exists (select 1 from languoid_property x where x.languoid_id = i.id and x.key = p.key))
    and not exists (select 1 from languoid_property x where x.languoid_id = i.id and x.key = p.key and x.value = p.value)
  union all
  select 'languoid_region added', count(*) from (
    select distinct i.id, r.region_id from _languoid_staged_regions() r join _ids i using (glottocode)
  ) lr
  where not exists (select 1 from languoid_region x where x.languoid_id = lr.id and x.region_id = lr.region_id)
  union all
  select 'country codes with no region', count(distinct c)
  from languoid_staging_glottolog g, unnest(g.countries) c
  where not exists (select 1 from region_source rs where rs.name = 'iso3166-1' and rs.unique_identifier = c);
end $$;

-- The languoid each ISO 639-3 code labels a name with: the active languoid
-- with that iso639-3 source, when only one has it.
create or replace function public._languoid_label_ids()
returns table(iso text, id uuid)
language sql stable set search_path = public as $$
  select ls.unique_identifier, min(ls.languoid_id::text)::uuid
  from languoid_source ls join languoid l on l.id = ls.languoid_id
  where ls.name = 'iso639-3' and l.active
  group by ls.unique_identifier having count(*) = 1;
$$;

-- v2's property keys, as v2 wrote them: category ("Spoken L1 Language"),
-- macroareas ("Eurasia, Papunesia"), latitude, longitude.
create or replace function public._languoid_staged_properties()
returns table(glottocode text, key text, value text)
language sql stable set search_path = public as $$
  select g.glottocode, p.key, p.value
  from languoid_staging_glottolog g
  cross join lateral (values
    ('category', g.category),
    ('macroareas', nullif(array_to_string(g.macroareas, ', '), '')),
    ('latitude', g.latitude::text),
    ('longitude', g.longitude::text)
  ) as p(key, value)
  where p.value is not null;
$$;

-- Where each staged languoid is spoken: its macroareas (continent regions,
-- by name) and countries (nation regions, by iso3166-1 source).
create or replace function public._languoid_staged_regions()
returns table(glottocode text, region_id uuid)
language sql stable set search_path = public as $$
  select g.glottocode, r.id
  from languoid_staging_glottolog g, unnest(g.macroareas) m
  join region r on r.level = 'continent' and r.name = m
  union
  select g.glottocode, rs.region_id
  from languoid_staging_glottolog g, unnest(g.countries) c
  join region_source rs on rs.name = 'iso3166-1' and rs.unique_identifier = c;
$$;

create or replace function public.languoid_import_apply(p_release text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_report jsonb;
  v_counts jsonb;
begin
  if (select count(*) from languoid_staging_glottolog) = 0 then
    raise exception 'nothing staged: load a Glottolog release first';
  end if;

  select jsonb_object_agg(change, n) into v_report
  from (select change, count(*) as n from languoid_import_diff() group by change) c;
  select jsonb_object_agg(what, n) into v_counts from languoid_import_counts();
  v_report := coalesce(v_report, '{}'::jsonb) || coalesce(v_counts, '{}'::jsonb);

  -- languoid_import_counts made _ids for its own count; the ids are made afresh.
  create temp table if not exists _ids (glottocode text primary key, id uuid, is_new boolean) on commit drop;
  truncate _ids;
  insert into _ids select * from _languoid_import_ids();

  -- 1. New languoids, then every staged languoid's name, level and tree.
  insert into languoid (id, name, level)
  select i.id, g.name, g.level::languoid_level
  from _ids i join languoid_staging_glottolog g using (glottocode)
  where i.is_new;

  -- A renamed languoid keeps its old name as an English alias, so a
  -- search for it still finds it.
  insert into languoid_alias (subject_languoid_id, label_languoid_id, name, alias_type, source_names)
  select l.id, en.id, l.name, 'exonym', array['glottolog (earlier name)']
  from _ids i
  join languoid_staging_glottolog g using (glottocode)
  join languoid l on l.id = i.id
  join _languoid_label_ids() en on en.iso = 'eng'
  where l.name is not null and l.name <> g.name
  on conflict on constraint uq_languoid_alias do nothing;

  update languoid l set name = g.name, level = g.level::languoid_level, active = true, last_updated = now()
  from _ids i join languoid_staging_glottolog g using (glottocode)
  where l.id = i.id and (l.name, l.level::text, l.active) is distinct from (g.name, g.level, true);

  update languoid l set parent_id = p.id, last_updated = now()
  from _ids i
  join languoid_staging_glottolog g using (glottocode)
  left join _ids p on p.glottocode = g.parent_glottocode
  where l.id = i.id and l.parent_id is distinct from p.id;

  -- 2. Glottocodes (with this release) and ISO 639-3 codes.
  insert into languoid_source (name, version, languoid_id, unique_identifier, url)
  select 'glottolog', p_release, i.id, i.glottocode, 'https://glottolog.org/resource/languoid/id/' || i.glottocode
  from _ids i
  on conflict (languoid_id, name, unique_identifier) do update
    set version = excluded.version, active = true, last_updated = now()
    where languoid_source.version is distinct from excluded.version or not languoid_source.active;

  insert into languoid_source (name, languoid_id, unique_identifier)
  select 'iso639-3', i.id, g.iso639_3
  from _ids i join languoid_staging_glottolog g using (glottocode)
  where g.iso639_3 is not null
    and not exists (select 1 from languoid_source x where x.languoid_id = i.id and x.name = 'iso639-3');

  -- 3. Gone from this release: kept, inactive.
  update languoid l set active = false, last_updated = now()
  from languoid_source ls
  where ls.languoid_id = l.id and ls.name = 'glottolog' and l.active
    and not exists (select 1 from languoid_staging_glottolog g where g.glottocode = ls.unique_identifier);

  -- 4. Properties Glottolog gives: every one for a new languoid, and for
  --    the rest only the keys it already has, as v2's load chose them (it
  --    took coordinates for languages, not the ones Glottolog derives for
  --    dialects and families). Other keys (fia_available, hid, ...) stay.
  insert into languoid_property (languoid_id, key, value)
  select i.id, p.key, p.value
  from _languoid_staged_properties() p join _ids i using (glottocode)
  where i.is_new or exists (select 1 from languoid_property x where x.languoid_id = i.id and x.key = p.key)
  on conflict (languoid_id, key) do update set value = excluded.value, last_updated = now()
    where languoid_property.value is distinct from excluded.value;

  -- 5. Names, each written in a label languoid; endonym when that is the
  --    languoid itself, as v2 inferred it. Names already here stay.
  insert into languoid_alias (subject_languoid_id, label_languoid_id, name, alias_type, source_names)
  select i.id, lb.id, s.name,
    case when lb.id = i.id then 'endonym'::alias_type else 'exonym'::alias_type end,
    s.providers
  from languoid_staging_glottolog_name s
  join _ids i using (glottocode)
  join _languoid_label_ids() lb on lb.iso = s.label_iso639_3
  on conflict on constraint uq_languoid_alias do nothing;

  -- 6. Where each is spoken.
  insert into languoid_region (languoid_id, region_id)
  select distinct i.id, r.region_id
  from _languoid_staged_regions() r join _ids i using (glottocode)
  on conflict on constraint uq_languoid_region do nothing;

  insert into languoid_import (release, report) values (p_release, v_report);
  perform languoid_staging_reset();
  return v_report;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    '_languoid_glottocode_matches()', 'languoid_analyze()', 'languoid_staging_reset()', 'languoid_import_diff()',
    '_languoid_import_ids()', 'languoid_import_counts()', '_languoid_label_ids()',
    '_languoid_staged_properties()', '_languoid_staged_regions()', 'languoid_import_apply(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
