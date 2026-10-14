-- The same person in v2 and in Next (docs/v2-import.md section 3). A v2
-- person whose email already has an account in Next is linked to it only when
-- someone on the team confirms, on the transfer dashboard, that both are the
-- same person (Caleb, 2026-10-14). Next does not confirm emails at sign-up, so
-- a matching email alone links nobody. Once linked, the import names that
-- Next account wherever it would have named the v2 one: memberships, the
-- organizations it runs, and work from then on.

create table v2_import.people_links (
  v2_id text primary key check (length(v2_id) between 1 and 100),
  next_id text not null check (length(next_id) between 1 and 100),
  email text check (length(email) <= 320),
  confirmed_by text not null,
  confirmed_at timestamptz not null default now(),
  -- Undo keeps the row, turned off, so the next sync takes the Next account's membership back.
  active boolean not null default true
);

-- Next's accounts with these emails, for the dashboard's Same email list.
create or replace function public.v2_import_next_accounts(p_emails text[])
returns table (id text, email text, created_at timestamptz, last_sign_in_at timestamptz, display_name text, from_v2 boolean)
language sql stable security definer set search_path = v2_import, public as $$
  select u.id::text, lower(u.email), u.created_at, u.last_sign_in_at, p.display_name,
         coalesce(u.raw_user_meta_data ->> 'from_v2', '') = 'true'
  from auth.users u left join public.profiles p on p.id = u.id::text
  where lower(u.email) in (select lower(e) from unnest(p_emails) e);
$$;

create or replace function public.v2_import_link(p_v2 text, p_next text, p_email text, p_by text)
returns void language sql security definer set search_path = v2_import, public as $$
  insert into v2_import.people_links (v2_id, next_id, email, confirmed_by) values (p_v2, p_next, lower(p_email), p_by)
  on conflict (v2_id) do update set next_id = excluded.next_id, email = excluded.email, confirmed_by = excluded.confirmed_by, confirmed_at = now(), active = true;
$$;

create or replace function public.v2_import_unlink(p_v2 text, p_by text default null)
returns void language sql security definer set search_path = v2_import, public as $$
  update v2_import.people_links set active = false, confirmed_by = coalesce(p_by, confirmed_by), confirmed_at = now() where v2_id = p_v2;
$$;

-- The plan now carries the links.
create or replace function public.v2_import_plan()
returns jsonb language sql stable security definer set search_path = v2_import, public as $$
  select jsonb_build_object(
    'orgs', coalesce((select jsonb_agg(to_jsonb(o) order by o.name) from v2_import.orgs o), '[]'),
    'placements', coalesce((select jsonb_agg(to_jsonb(p) order by p.project_id) from v2_import.placements p), '[]'),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('project_id', r.project_id, 'profile_id', r.profile_id, 'role', r.role)) from v2_import.roles r), '[]'),
    'links', coalesce((select jsonb_agg(jsonb_build_object('v2_id', k.v2_id, 'next_id', k.next_id, 'email', k.email, 'confirmed_by', k.confirmed_by, 'confirmed_at', k.confirmed_at, 'active', k.active) order by k.v2_id) from v2_import.people_links k), '[]'),
    'passes', coalesce((
      select jsonb_agg(jsonb_build_object('project_id', l.project_id, 'finished_at', l.finished_at, 'report', l.report))
      from (select distinct on (project_id) * from v2_import.passes where finished_at is not null and error is null
            order by project_id, started_at desc) l), '[]')
  );
$$;

-- Whether a v2 person has signed in here: as themselves, or as the Next account linked to them.
create or replace function public.v2_import_people(p_ids text[])
returns table (id text, display_name text, signed_in_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = v2_import, public as $$
  select i.id, coalesce(p.display_name, q.display_name), u.created_at, u.last_sign_in_at
  from unnest(p_ids) i (id)
  left join v2_import.people_links k on k.v2_id = i.id and k.active
  left join auth.users u on u.id::text = coalesce(k.next_id, i.id)
  left join public.profiles p on p.id = i.id
  left join public.profiles q on q.id = k.next_id;
$$;

do $$
declare f text;
begin
  foreach f in array array['v2_import_next_accounts', 'v2_import_link', 'v2_import_unlink', 'v2_import_plan', 'v2_import_people'] loop
    execute format('revoke all on function public.%I from public, anon, authenticated', f);
    execute format('grant execute on function public.%I to service_role', f);
  end loop;
end $$;
