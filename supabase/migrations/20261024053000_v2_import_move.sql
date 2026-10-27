-- A v2 project that came over into one organization can come over again
-- into another (decisions.md 94, amended 2026-10-24). A language's events
-- carry its organization, so this is a second copy, not a move: the
-- placement takes the new organization and a new language id, the import
-- brings the whole project over again under that id there, and the first
-- copy stays where it was, no longer kept up to date, until its
-- organization's admins remove it. Every Language asked for BIRAT
-- RAJBANSHI, which had come over into its owners' own organization.

-- The language's id in Next, when it is not the v2 project's own id, and
-- when the project last came over again.
alter table v2_import.placements
  add column language_id text check (length(language_id) between 1 and 100),
  add column moved_at timestamptz;

-- Where each project was before it came over again, so the first copy can
-- be found: its organization and its language.
create table v2_import.moves (
  id bigint generated always as identity primary key,
  project_id text not null references v2_import.placements (project_id),
  from_org text not null,
  from_language text not null,
  to_org text not null,
  to_language text not null,
  moved_by text not null,
  moved_at timestamptz not null default now()
);
alter table v2_import.moves enable row level security;

create or replace function public.v2_import_move(p_project text, p_org text, p_language text, p_by text)
returns void language plpgsql security definer set search_path = v2_import, public as $$
declare v_from_org text; v_from_language text; v_confirmed timestamptz;
begin
  select org_id, coalesce(language_id, project_id), confirmed_at into v_from_org, v_from_language, v_confirmed
  from v2_import.placements where project_id = p_project for update;
  if not found or v_confirmed is null then
    raise exception 'v2 project % has not come over; place it on the board instead', p_project using errcode = '23514';
  end if;
  if not exists (select 1 from v2_import.orgs where org_id = p_org) then
    raise exception 'no organization % on the board', p_org using errcode = '23503';
  end if;
  if v_from_org = p_org then
    raise exception 'v2 project % is in % already', p_project, p_org using errcode = '23514';
  end if;
  if p_language is null or p_language = v_from_language
     or exists (select 1 from v2_import.placements where coalesce(language_id, project_id) = p_language)
     or exists (select 1 from v2_import.moves where from_language = p_language or to_language = p_language) then
    raise exception 'the new language id must be one not used before' using errcode = '23505';
  end if;
  insert into v2_import.moves (project_id, from_org, from_language, to_org, to_language, moved_by)
  values (p_project, v_from_org, v_from_language, p_org, p_language, p_by);
  update v2_import.placements
  set org_id = p_org, language_id = p_language, moved_at = now(), updated_by = p_by, updated_at = now()
  where project_id = p_project;
end $$;

revoke all on function public.v2_import_move from public, anon, authenticated;
grant execute on function public.v2_import_move to service_role;

-- Welcome back names the language by its id in Next, which for a project
-- that came over again is no longer the v2 project's id. Otherwise as in
-- 20261013000000_v2_import.sql.
create or replace function public.v2_welcome()
returns jsonb language sql stable security definer set search_path = '' as $$
  with mine as (
    select x.p->>'id' as project_id, x.p->>'name' as was, x.ord
    from v2_import.arrivals a cross join lateral jsonb_array_elements(a.projects) with ordinality as x (p, ord)
    where a.profile_id = public.caller_id()
  ),
  placed as (
    select m.*, pl.project_id is not null as on_board, pl.org_id, coalesce(pl.language_id, m.project_id) as language_id,
      coalesce(nullif(l.renamed, ''), nullif(l.added_name, ''), pl.name, m.was) as language_name,
      pl.confirmed_at is not null and l.language_id is not null
        and exists (select 1 from v2_import.ledger g where g.scope = coalesce(pl.language_id, m.project_id)) as arrived
    from mine m
    left join v2_import.placements pl on pl.project_id = m.project_id
    left join public.languages l on l.org_id = pl.org_id and l.language_id = coalesce(pl.language_id, m.project_id)
  ),
  here as (
    select p.*, r.recordings, r.passages, r.last_unit, r.last_hlc
    from placed p
    cross join lateral (
      select count(*) as recordings, count(distinct e.payload->>'unitId') as passages,
        (array_agg(e.payload->>'unitId' order by e.hlc collate "C" desc))[1] as last_unit,
        max(e.hlc collate "C") as last_hlc
      from public.events e
      where e.org_id = p.org_id and e.stream_id = p.language_id and e.type = 'v1.RecordingAdded' and e.actor_id = public.caller_id()
    ) r
    where p.arrived and exists (
      select 1 from public.org_memberships om
      where om.org_id = p.org_id and om.profile_id = public.caller_id() and not om.removed
        and (om.scope_level = 'org' or om.language_id = p.language_id)
    )
  )
  select jsonb_build_object(
    'here', coalesce((select jsonb_agg(jsonb_build_object(
        'languageId', h.language_id, 'orgId', h.org_id, 'orgName', coalesce(public.org_name(h.org_id), h.org_id),
        'name', h.language_name, 'was', h.was, 'recordings', h.recordings, 'passages', h.passages,
        'lastUnitId', h.last_unit, 'lastAt', h.last_hlc
      ) order by h.recordings desc, h.ord) from here h), '[]'),
    'onTheirWay', coalesce((select jsonb_agg(jsonb_build_object('id', p.project_id, 'name', p.was) order by p.ord)
      from placed p where not p.arrived and (not p.on_board or p.org_id is not null)), '[]')
  );
$$;
