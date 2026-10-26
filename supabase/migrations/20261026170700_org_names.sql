-- An organization's name is a table row, not an event lookup
-- (performance-audit-2026-10-26.md V8). org_name() found it by sorting the
-- organization's name events, and the organization listings called it for
-- every organization (twice in listed_organizations), before filtering:
-- listed_organizations, listed_organizations_search and
-- global_viewer_organizations (decisions.md 66, 158).
--
-- org_names holds, per organization, the latest v1.OrgCreated or
-- v1.OrgRenamed by (hlc, id) under the C collation, which is the rule
-- org_name() applied to the events, kept by a trigger on every insert of
-- such an event (events are never updated or deleted), and filled here from
-- the events that exist. org_name() reads it, so every other caller (the
-- invite preview, the v2 import's hand-over) gets the same answer faster.
-- Search finds names by trigram index.

create table public.org_names (
  org_id text primary key,
  name text,
  hlc text not null,
  event_id text not null
);
alter table public.org_names enable row level security;
revoke all on public.org_names from public, anon, authenticated;
grant all on public.org_names to service_role;

insert into public.org_names (org_id, name, hlc, event_id)
  select distinct on (e.org_id) e.org_id, e.payload->>'name', e.hlc, e.id
  from public.events e
  where e.stream_id = '_org' and e.type in ('v1.OrgCreated', 'v1.OrgRenamed')
  order by e.org_id, e.hlc collate "C" desc, e.id collate "C" desc;

create or replace function public._org_names_apply() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.org_names as o (org_id, name, hlc, event_id)
  values (new.org_id, new.payload->>'name', new.hlc, new.id)
  on conflict (org_id) do update set name = excluded.name, hlc = excluded.hlc, event_id = excluded.event_id
    where (excluded.hlc collate "C", excluded.event_id collate "C") > (o.hlc collate "C", o.event_id collate "C");
  return null;
end $$;
revoke all on function public._org_names_apply() from public, anon, authenticated;

create trigger org_names_apply after insert on public.events
  for each row when (new.stream_id = '_org' and new.type in ('v1.OrgCreated', 'v1.OrgRenamed'))
  execute function public._org_names_apply();

create index org_names_name_trgm on public.org_names using gin (lower(name) extensions.gin_trgm_ops);
-- The language side of the search (listed languages only).
create index public_languages_name_trgm on public.public_languages using gin (lower(name) extensions.gin_trgm_ops);

-- An organization's name: its latest v1.OrgCreated or v1.OrgRenamed (core `org` register).
create or replace function public.org_name(p_org text)
returns text language sql stable security definer set search_path = public as $$
  select n.name from public.org_names n where n.org_id = p_org;
$$;

create or replace function public.listed_organizations()
returns table (org_id text, name text, languages text[])
language sql stable security definer set search_path = '' as $$
  select p.org_id, n.name, array_agg(p.name order by p.name)
  from public.public_languages p
  join public.language_visibility v
    on v.org_id = p.org_id and v.language_id = p.language_id and v.listed
  join public.org_names n on n.org_id = p.org_id
  where public.caller_id() is not null and n.name is not null
  group by p.org_id, n.name
  order by 2, 1
  limit 500;
$$;

-- Plain substring matching, as before: % and _ in what was typed match themselves.
create or replace function public.listed_organizations_search(p_query text, p_limit int default 50)
returns table (org_id text, name text, languages text[])
language sql stable security definer set search_path = '' as $$
  with q as (
    select '%' || replace(replace(replace(lower(btrim(coalesce(p_query, ''))), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern,
           lower(btrim(coalesce(p_query, ''))) <> '' as on
  ),
  hits as (
    select n.org_id from public.org_names n, q where q.on and lower(n.name) like q.pattern
    union
    select p.org_id from public.public_languages p
    join public.language_visibility v
      on v.org_id = p.org_id and v.language_id = p.language_id and v.listed, q
    where q.on and lower(p.name) like q.pattern
  ),
  listed as (
    select p.org_id, array_agg(p.name order by p.name) as languages
    from public.public_languages p
    join public.language_visibility v
      on v.org_id = p.org_id and v.language_id = p.language_id and v.listed
    where public.caller_id() is not null and p.org_id in (select h.org_id from hits h)
    group by p.org_id
  )
  select l.org_id, n.name, l.languages from listed l
  join public.org_names n on n.org_id = l.org_id
  where n.name is not null
  order by n.name, l.org_id
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

create or replace function public.global_viewer_organizations(
  p_query text default '', p_after_name text default null, p_after_org text default null, p_limit int default 50
) returns table (org_id text, name text, languages text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public._gv_on(public.caller_id(), public._request_aal(public.caller_id())) then
    raise exception 'Global Viewer access is off' using errcode = '42501';
  end if;
  return query
    with q as (select lower(btrim(coalesce(p_query, ''))) as q),
    orgs as (
      select c.org_id, coalesce(n.name, c.org_id) as name,
        coalesce((select array_agg(l.name order by l.name) from public.public_languages l where l.org_id = c.org_id), '{}') as languages
      from public.stream_cursors c
      left join public.org_names n on n.org_id = c.org_id
      where c.stream_id = '_org'
    )
    select o.org_id, o.name, o.languages from orgs o, q
    where (q.q = '' or strpos(lower(o.name), q.q) > 0 or exists (select 1 from unnest(o.languages) n where strpos(lower(n), q.q) > 0))
      and (p_after_name is null or (o.name, o.org_id) > (p_after_name, coalesce(p_after_org, '')))
    order by o.name, o.org_id
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;
