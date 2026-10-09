-- search_languoids (20261009000000_languoids.sql), restated whole: among
-- equal matches a languoid's own name comes before another's other name.
--
-- Searching "Nuer" listed Ngundu, which Glottolog also calls Nuer, before
-- Nuer itself, and showed Nuer as matched by an other name: a languoid that
-- matched both by its name and by an other name kept the other name. The
-- add-language picker (docs/languoids.md) shows that match, so it has to
-- be the right one. Nothing else changes.

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
    order by c.id, c.rank, c.sim desc, (c.hit is null) desc, (c.hit_type = 'endonym') desc nulls last, c.hit
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
  order by b.rank, (s.level = 'language') desc, b.sim desc, (b.hit is null) desc, s.name
  limit greatest(1, least(coalesce(result_limit, 50), 200));
end;
$$;
