-- "Find your organization" searched, on the phone, only the first 500 listed
-- organizations by name (`listed_organizations`, decision 66): an
-- organization past them could never be found by typing its name. The UI test
-- suite found it (JRN-005) once the local database listed more than 500.
-- The search now runs here, over every listed organization, by its name or
-- any language it lists. Plain substring matching, so % and _ in what was
-- typed match themselves.

create or replace function public.listed_organizations_search(p_query text, p_limit int default 50)
returns table (org_id text, name text, languages text[])
language sql stable security definer set search_path = '' as $$
  with q as (select lower(btrim(coalesce(p_query, ''))) as q),
  listed as (
    select p.org_id, public.org_name(p.org_id) as name, array_agg(p.name order by p.name) as languages
    from public.public_languages p
    join public.language_visibility v
      on v.org_id = p.org_id and v.language_id = p.language_id and v.listed
    where public.caller_id() is not null
    group by p.org_id
  )
  select l.org_id, l.name, l.languages from listed l, q
  where l.name is not null and q.q <> ''
    and (strpos(lower(l.name), q.q) > 0 or exists (select 1 from unnest(l.languages) n where strpos(lower(n), q.q) > 0))
  order by l.name, l.org_id
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke all on function public.listed_organizations_search(text, int) from public, anon;
grant execute on function public.listed_organizations_search(text, int) to authenticated, service_role;
