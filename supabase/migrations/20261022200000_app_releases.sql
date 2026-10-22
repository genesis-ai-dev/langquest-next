-- The store versions that people can download, and the lowest version that
-- may still sync, per platform (decisions.md 150). A store check in the
-- app's Worker (apps/web/worker/storeReleases.ts) adds a row only once a
-- version is live in its store, never while it waits for review, and keeps
-- the time that it first saw it live. The app reads app_versions() to say
-- "New version available" on an older version.
--
-- Versions are compared as numbers, part by part (1.0.0 < 2026.1022.1830):
-- every store build has a higher version than the one before (decision 150,
-- app.config.js).

create table public.app_releases (
  platform text not null check (platform in ('ios', 'android')),
  version text not null check (version ~ '^[0-9]+(\.[0-9]+){0,2}$'),
  live_since timestamptz not null default now(),
  primary key (platform, version)
);
alter table public.app_releases enable row level security;
-- No policies: only the service role writes or reads the table itself.

-- The lowest version of each platform that may still sync. '0' lets every
-- version sync; raising it is a deliberate step (decisions.md 150).
alter table public.server_config
  add column min_version_ios text not null default '0' check (min_version_ios ~ '^[0-9]+(\.[0-9]+){0,2}$'),
  add column min_version_android text not null default '0' check (min_version_android ~ '^[0-9]+(\.[0-9]+){0,2}$');

-- A version as numbers, for ordering.
create or replace function public.version_parts(p_version text)
returns int[] language sql immutable set search_path = public as $$
  select string_to_array(p_version, '.')::int[]
$$;

-- Per platform: the newest live version, since when it is live, and the
-- lowest version that may still sync. A platform with no live version yet
-- has a null version.
create or replace function public.app_versions()
returns table (platform text, version text, live_since timestamptz, min_version text)
language sql stable security definer set search_path = public as $$
  select p.platform, r.version, r.live_since,
         case p.platform when 'ios' then c.min_version_ios else c.min_version_android end
  from (values ('ios'), ('android')) as p(platform)
  cross join public.server_config c
  left join lateral (
    select a.version, a.live_since from public.app_releases a
    where a.platform = p.platform order by public.version_parts(a.version) desc limit 1
  ) r on true
$$;
revoke all on function public.app_versions() from public, anon;
grant execute on function public.app_versions() to authenticated, service_role;

-- What the store check writes: a live version, kept with the first time it
-- was seen live. Seeing it again changes nothing.
create or replace function public.record_app_release(p_platform text, p_version text, p_live_since timestamptz)
returns void language sql security definer set search_path = public as $$
  insert into public.app_releases (platform, version, live_since)
  values (p_platform, p_version, coalesce(p_live_since, now()))
  on conflict (platform, version) do nothing
$$;
revoke all on function public.record_app_release(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_app_release(text, text, timestamptz) to service_role;
