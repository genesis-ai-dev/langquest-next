-- One account's LangQuest v2 projects, as Welcome back sees them (LAN-250).
--
-- Someone from v2 waited days on Welcome back with two projects "on their
-- way", and support could not tell why: v2_welcome() answers only for the
-- person signed in, and diag.v2_import_status() lists transfers, not whose
-- projects they are. This says, for each project v2-sign-in noted for the
-- account (v2_import.arrivals), where it stands, by the same rules as
-- v2_welcome(): not on the transfer board, Not coming over, on the board and
-- not confirmed, confirmed and not transferred yet, transferred and its
-- language not projected yet, here and the person not a member, or here.
-- Ids, states and times only: no project or person names.

create or replace function diag.v2_person(p_profile text)
returns table (
  project_id text, state text, org_id text, language_id text, confirmed_at timestamptz,
  last_pass_at timestamptz, last_pass_state text, arrived_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  with mine as (
    select x.p->>'id' as project_id, x.ord, a.at
    from v2_import.arrivals a cross join lateral jsonb_array_elements(a.projects) with ordinality as x (p, ord)
    where a.profile_id = p_profile
  ),
  placed as (
    select m.*, pl.project_id is not null as on_board, pl.org_id, pl.confirmed_at,
      coalesce(pl.language_id, m.project_id) as language_id,
      exists (select 1 from v2_import.ledger g where g.scope = coalesce(pl.language_id, m.project_id)) as transferred,
      exists (select 1 from public.languages l where l.org_id = pl.org_id and l.language_id = coalesce(pl.language_id, m.project_id)) as projected,
      exists (select 1 from public.org_memberships om
        where om.org_id = pl.org_id and om.profile_id = p_profile and not om.removed
          and (om.scope_level = 'org' or om.language_id = coalesce(pl.language_id, m.project_id))) as member,
      (select d from v2_import.passes d where d.project_id = m.project_id order by d.started_at desc limit 1) as pass
    from mine m
    left join v2_import.placements pl on pl.project_id = m.project_id
  )
  select p.project_id,
    case when not p.on_board then 'not_on_board'
         when p.org_id is null then 'not_coming_over'
         when p.confirmed_at is null then 'unconfirmed'
         when not p.transferred then 'not_transferred'
         when not p.projected then 'not_projected'
         when not p.member then 'not_member'
         else 'here' end,
    p.org_id, case when p.on_board and p.org_id is not null then p.language_id end, p.confirmed_at,
    (p.pass).started_at,
    case when (p.pass).id is null then null
         when (p.pass).finished_at is null and (p.pass).progress_at > now() - interval '2 minutes' then 'running'
         when (p.pass).finished_at is null then 'cut_off'
         when (p.pass).error is not null then 'error'
         else 'done' end,
    p.at
  from placed p
  order by p.ord
$$;

revoke all on function diag.v2_person from public;
grant execute on function diag.v2_person to diag_reader;
