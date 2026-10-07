-- Languages (languoids): global reference data, not in any stream
-- (docs/languoids.md). Every languoid has a UUID. A Glottolog one also has
-- its glottocode, which is how a newer Glottolog release finds the row it
-- already made; a language collected in the field has no glottocode until
-- Glottolog catalogues it.
--
-- Rows from Glottolog that langquest v2 already had keep v2's UUID, so
-- imported v2 projects point at the same language. Languoids v2 users made
-- themselves are not carried over.
--
-- Everyone may read. Only the service role writes, through the staging
-- tables and languoid_import_apply (scripts/languoids.ts):
--
--   languoid_staging_reset()        empty the staging tables
--   (insert into the staging tables)
--   languoid_import_diff()          what apply would change, row by row
--   languoid_import_apply(release)  seed v2 rows, merge Glottolog, record it

create extension if not exists pg_trgm with schema extensions;

create table public.languoid (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.languoid(id) on delete set null,
  name text not null,
  level text not null check (level in ('family', 'language', 'dialect')),
  -- Glottolog's category: Spoken L1 Language, Sign Language, Pidgin, ...
  category text,
  glottocode text unique check (glottocode ~ '^[a-z0-9]{4}[0-9]{4}$'),
  iso639_3 text check (iso639_3 ~ '^[a-z]{3}$'),
  latitude double precision,
  longitude double precision,
  macroareas text[] not null default '{}',
  -- ISO 3166-1 alpha-2
  countries text[] not null default '{}',
  origin text not null check (origin in ('glottolog', 'field')),
  -- A Glottolog languoid a later release no longer has. Kept so anything
  -- that names it still resolves; search leaves it out.
  retired boolean not null default false,
  -- The Glottolog release that last wrote the row.
  glottolog_release text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (origin = 'field' or glottocode is not null)
);

create index languoid_parent_idx on public.languoid (parent_id);
create index languoid_iso_idx on public.languoid (iso639_3);
create index languoid_name_trgm on public.languoid using gin (lower(name) extensions.gin_trgm_ops);

-- Other names a languoid goes by. lang is the language the name is in, as
-- its source tags it (Glottolog: mostly ISO 639-1 like "en"; v2: ISO 639-3),
-- null when unknown. providers are Glottolog's (multitree, wals, ...).
create table public.languoid_name (
  id uuid primary key default gen_random_uuid(),
  languoid_id uuid not null references public.languoid(id) on delete cascade,
  name text not null,
  lang text,
  providers text[] not null default '{}',
  source text not null check (source in ('glottolog', 'v2', 'langquest')),
  unique nulls not distinct (languoid_id, name, lang)
);

create index languoid_name_languoid_idx on public.languoid_name (languoid_id);
create index languoid_name_name_trgm on public.languoid_name using gin (lower(name) extensions.gin_trgm_ops);

-- One row per apply.
create table public.languoid_import (
  id bigint generated always as identity primary key,
  release text not null,
  applied_at timestamptz not null default now(),
  report jsonb not null
);

-- ---- staging (service role only) ---------------------------------------------

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

create table public.languoid_staging_glottolog_name (
  glottocode text not null,
  name text not null,
  lang text,
  providers text[] not null default '{}'
);

create index on public.languoid_staging_glottolog (parent_glottocode);
create index on public.languoid_staging_glottolog_name (glottocode);

-- v2's languoid rows that came from Glottolog (creator_id is null), and
-- their aliases with the label language's ISO 639-3 code.
create table public.languoid_staging_v2 (
  id uuid primary key,
  parent_id uuid,
  name text,
  level text not null,
  iso639_3 text
);

create table public.languoid_staging_v2_name (
  languoid_id uuid not null,
  name text not null,
  lang text
);

create index on public.languoid_staging_v2 (parent_id);

alter table public.languoid enable row level security;
alter table public.languoid_name enable row level security;
alter table public.languoid_import enable row level security;
alter table public.languoid_staging_glottolog enable row level security;
alter table public.languoid_staging_glottolog_name enable row level security;
alter table public.languoid_staging_v2 enable row level security;
alter table public.languoid_staging_v2_name enable row level security;

create policy languoid_read on public.languoid for select using (true);
create policy languoid_name_read on public.languoid_name for select using (true);

revoke all on public.languoid, public.languoid_name, public.languoid_import,
  public.languoid_staging_glottolog, public.languoid_staging_glottolog_name,
  public.languoid_staging_v2, public.languoid_staging_v2_name
  from anon, authenticated;
grant select on public.languoid, public.languoid_name to anon, authenticated;
grant all on public.languoid, public.languoid_name, public.languoid_import,
  public.languoid_staging_glottolog, public.languoid_staging_glottolog_name,
  public.languoid_staging_v2, public.languoid_staging_v2_name
  to service_role;

-- ---- matching v2 rows to glottocodes ------------------------------------------

-- Each staged v2 row and the glottocode it is, at most one each way. v2 never
-- kept glottocodes, so: the ISO 639-3 code where both sides have it once,
-- else the chain of names from the root down (with levels), else a name and
-- level that only one languoid has.
create or replace function public._languoid_v2_matches()
returns table(v2_id uuid, glottocode text, matched_on text)
language sql stable set search_path = public as $$
  with recursive
  v2_path as (
    select v.id, v.level, coalesce(v.name, '') || ':' || v.level as path, v.parent_id as next_id, 0 as depth
    from languoid_staging_v2 v
    union all
    select p.id, p.level, coalesce(a.name, '') || ':' || a.level || '/' || p.path, a.parent_id, p.depth + 1
    from v2_path p join languoid_staging_v2 a on a.id = p.next_id
    where p.depth < 64
  ),
  v2_full as (select id, level, path from v2_path where next_id is null),
  gl_path as (
    select g.glottocode, g.level, g.name || ':' || g.level as path, g.parent_glottocode as next_code, 0 as depth
    from languoid_staging_glottolog g
    union all
    select p.glottocode, p.level, a.name || ':' || a.level || '/' || p.path, a.parent_glottocode, p.depth + 1
    from gl_path p join languoid_staging_glottolog a on a.glottocode = p.next_code
    where p.depth < 64
  ),
  gl_full as (select glottocode, level, path from gl_path where next_code is null),
  gl_counts as (
    select g.*,
      count(*) over (partition by g.iso639_3) as iso_n,
      count(*) over (partition by g.name, g.level) as name_n
    from languoid_staging_glottolog g
  ),
  v2_counts as (
    select v.*,
      count(*) over (partition by v.iso639_3) as iso_n,
      count(*) over (partition by v.name, v.level) as name_n
    from languoid_staging_v2 v
  ),
  gl_unique_path as (
    select path, min(glottocode) as glottocode from gl_full group by path having count(*) = 1
  ),
  by_iso as (
    select v.id as v2_id, g.glottocode, 'iso639-3'::text as matched_on, 1 as rank
    from v2_counts v join gl_counts g on g.iso639_3 = v.iso639_3
    where v.iso639_3 is not null and v.iso_n = 1 and g.iso_n = 1
  ),
  by_path as (
    select v.id, g.glottocode, 'name path'::text, 2
    from v2_full v join gl_unique_path g on g.path = v.path
  ),
  by_name as (
    select v.id, g.glottocode, 'name and level'::text, 3
    from v2_counts v join gl_counts g on g.name = v.name and g.level = v.level
    where v.name_n = 1 and g.name_n = 1
  ),
  candidates as (
    select * from by_iso union all select * from by_path union all select * from by_name
  ),
  best_per_v2 as (
    select distinct on (v2_id) v2_id, glottocode, matched_on, rank
    from candidates order by v2_id, rank
  )
  select distinct on (b.glottocode) b.v2_id, b.glottocode, b.matched_on
  from best_per_v2 b
  order by b.glottocode, b.rank, b.v2_id;
$$;

-- ---- preview and apply ---------------------------------------------------------

create or replace function public.languoid_staging_reset()
returns void language sql security definer set search_path = public as $$
  truncate languoid_staging_glottolog, languoid_staging_glottolog_name, languoid_staging_v2, languoid_staging_v2_name;
$$;

-- What languoid_import_apply would do, one row per change:
--   v2 seed     a v2 row that keeps its UUID (old = v2 name, new = how matched)
--   v2 unmatched a v2 row with no glottocode found; not brought over
--   new         a Glottolog languoid not here yet
--   changed     field old -> new
--   retired     here, but not in this release
--   restored    retired before, back in this release
create or replace function public.languoid_import_diff()
returns table(change text, glottocode text, id uuid, name text, field text, old text, new text)
language sql stable security definer set search_path = public as $$
  with
  m as (select * from _languoid_v2_matches()),
  seed as (
    select m.v2_id as id, m.glottocode, v.name, m.matched_on
    from m join languoid_staging_v2 v on v.id = m.v2_id
    where not exists (select 1 from languoid l where l.id = m.v2_id or l.glottocode = m.glottocode)
  ),
  -- The rows as they will be once v2 is seeded.
  cur as (
    select l.id, l.glottocode, l.name, l.level, l.category, l.iso639_3, l.retired,
      (select p.glottocode from languoid p where p.id = l.parent_id) as parent_glottocode
    from languoid l where l.origin = 'glottolog'
    union all
    select s.id, s.glottocode, null, null, null, null, false, null from seed s
  ),
  pairs as (
    select c.*, g.name as g_name, g.level as g_level, g.category as g_category,
      g.iso639_3 as g_iso, g.parent_glottocode as g_parent
    from cur c join languoid_staging_glottolog g using (glottocode)
  )
  select 'v2 seed', s.glottocode, s.id, s.name, null, s.name, s.matched_on from seed s
  union all
  select 'v2 unmatched', null, v.id, v.name, null, v.level, v.iso639_3
  from languoid_staging_v2 v
  where not exists (select 1 from m where m.v2_id = v.id)
    and not exists (select 1 from languoid l where l.id = v.id)
  union all
  select 'new', g.glottocode, null, g.name, null, null, g.level
  from languoid_staging_glottolog g
  where not exists (select 1 from cur c where c.glottocode = g.glottocode)
  union all
  select 'changed', p.glottocode, p.id, p.g_name, f.field, f.old, f.new
  from pairs p
  cross join lateral (values
    ('name', p.name, p.g_name),
    ('level', p.level, p.g_level),
    ('category', p.category, p.g_category),
    ('iso639_3', p.iso639_3, p.g_iso),
    ('parent', p.parent_glottocode, p.g_parent)
  ) as f(field, old, new)
  -- A seeded row has no old values yet; its first write is not a change.
  where p.name is not null and f.old is distinct from f.new
  union all
  select 'retired', c.glottocode, c.id, c.name, null, null, null
  from cur c
  where not c.retired and not exists (select 1 from languoid_staging_glottolog g where g.glottocode = c.glottocode)
  union all
  select 'restored', c.glottocode, c.id, c.name, null, null, null
  from cur c
  where c.retired and exists (select 1 from languoid_staging_glottolog g where g.glottocode = c.glottocode);
$$;

create or replace function public.languoid_import_apply(p_release text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_report jsonb;
begin
  if (select count(*) from languoid_staging_glottolog) = 0 then
    raise exception 'nothing staged: load a Glottolog release first';
  end if;

  select jsonb_object_agg(change, n) into v_report
  from (select change, count(*) as n from languoid_import_diff() group by change) c;
  v_report := coalesce(v_report, '{}'::jsonb);

  -- 1. v2's Glottolog rows keep their UUIDs. Values are written in step 2.
  insert into languoid (id, name, level, glottocode, origin)
  select m.v2_id, g.name, g.level, g.glottocode, 'glottolog'
  from _languoid_v2_matches() m
  join languoid_staging_glottolog g on g.glottocode = m.glottocode
  where not exists (select 1 from languoid l where l.id = m.v2_id or l.glottocode = m.glottocode);

  -- 2. Every languoid in the release, new or not.
  insert into languoid as l (name, level, category, glottocode, iso639_3, latitude, longitude,
    macroareas, countries, origin, glottolog_release)
  select g.name, g.level, g.category, g.glottocode, g.iso639_3, g.latitude, g.longitude,
    g.macroareas, g.countries, 'glottolog', p_release
  from languoid_staging_glottolog g
  on conflict (glottocode) do update set
    name = excluded.name, level = excluded.level, category = excluded.category,
    iso639_3 = excluded.iso639_3, latitude = excluded.latitude, longitude = excluded.longitude,
    macroareas = excluded.macroareas, countries = excluded.countries,
    retired = false, glottolog_release = p_release,
    updated_at = case
      when (l.name, l.level, l.category, l.iso639_3, l.latitude, l.longitude, l.macroareas, l.countries, l.retired)
        is distinct from (excluded.name, excluded.level, excluded.category, excluded.iso639_3, excluded.latitude,
          excluded.longitude, excluded.macroareas, excluded.countries, false)
      then now() else l.updated_at end;

  -- 3. The tree.
  update languoid l set parent_id = p.id, updated_at = now()
  from languoid_staging_glottolog g
  left join languoid p on p.glottocode = g.parent_glottocode
  where l.glottocode = g.glottocode and l.parent_id is distinct from p.id;

  -- 4. Gone from Glottolog: kept, but retired.
  update languoid l set retired = true, updated_at = now()
  where l.origin = 'glottolog' and not l.retired
    and not exists (select 1 from languoid_staging_glottolog g where g.glottocode = l.glottocode);

  -- 5. Glottolog's names are replaced; other sources' names stay.
  delete from languoid_name n
  using languoid l
  where n.languoid_id = l.id and n.source = 'glottolog'
    and exists (select 1 from languoid_staging_glottolog g where g.glottocode = l.glottocode);

  insert into languoid_name (languoid_id, name, lang, providers, source)
  select l.id, s.name, s.lang, s.providers, 'glottolog'
  from languoid_staging_glottolog_name s
  join languoid l on l.glottocode = s.glottocode
  where s.name <> l.name
  on conflict (languoid_id, name, lang) do update set providers = excluded.providers, source = 'glottolog';

  -- 6. v2's names for the languoids it shares, where Glottolog has none like them.
  insert into languoid_name (languoid_id, name, lang, source)
  select distinct n.languoid_id, n.name, n.lang, 'v2'
  from languoid_staging_v2_name n
  join languoid l on l.id = n.languoid_id
  where n.name <> l.name
  on conflict (languoid_id, name, lang) do nothing;

  insert into languoid_import (release, report) values (p_release, v_report);
  perform languoid_staging_reset();
  return v_report;
end $$;

-- ---- search ------------------------------------------------------------------

-- Languoids whose name, other name, ISO 639-3 code or glottocode matches q,
-- best first: an exact code, an exact name, a name that starts with q, then
-- by similarity. Retired languoids are left out.
create or replace function public.search_languoids(q text, max_rows int default 50)
returns table(id uuid, name text, level text, glottocode text, iso639_3 text, parent_name text, matched_name text, origin text)
language sql stable set search_path = public, extensions as $$
  with term as (select lower(btrim(q)) as t),
  hits as (
    select l.id, l.name as hit, 0 as rank from languoid l, term
    where l.iso639_3 = term.t or l.glottocode = term.t
    union all
    select l.id, l.name, case when lower(l.name) = term.t then 1 when lower(l.name) like term.t || '%' then 2 else 4 end
    from languoid l, term
    where lower(l.name) like '%' || term.t || '%' or (length(term.t) > 3 and lower(l.name) % term.t)
    union all
    select n.languoid_id, n.name, case when lower(n.name) = term.t then 1 when lower(n.name) like term.t || '%' then 3 else 5 end
    from languoid_name n, term
    where lower(n.name) like '%' || term.t || '%' or (length(term.t) > 3 and lower(n.name) % term.t)
  ),
  best as (
    select distinct on (h.id) h.id, h.hit, h.rank from hits h order by h.id, h.rank, h.hit
  )
  select l.id, l.name, l.level, l.glottocode, l.iso639_3, p.name, nullif(b.hit, l.name), l.origin
  from best b
  join languoid l on l.id = b.id
  left join languoid p on p.id = l.parent_id
  cross join term
  where not l.retired and length(term.t) > 0
  order by b.rank, (l.level = 'language') desc, similarity(lower(b.hit), term.t) desc, l.name
  limit greatest(1, least(coalesce(max_rows, 50), 200));
$$;

revoke all on function public._languoid_v2_matches(), public.languoid_staging_reset(),
  public.languoid_import_diff(), public.languoid_import_apply(text)
  from public, anon, authenticated;
grant execute on function public._languoid_v2_matches(), public.languoid_staging_reset(),
  public.languoid_import_diff(), public.languoid_import_apply(text)
  to service_role;
grant execute on function public.search_languoids(text, int) to anon, authenticated;
