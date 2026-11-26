-- The line of merges on the ops dashboard's Releases page
-- (docs/decisions/2026-11-26-release-timeline-on-the-releases-page.md): when
-- each bundle the phones run first ran on an iPhone and on an Android phone,
-- and the failures each hour, so a merge's line ends where phones first ran
-- it and a rise in failures shows under the merges before it.
--
-- diag.ops_release_line(p_days), the one function here, answers for the last
-- p_days days (1 to 90):
-- - updates: [update key, os, first seen, phones] for each over-the-air
--   update (diag.install_updates keeps the first 8 characters of its id) that
--   production phones ran;
-- - builds: [os, app version, first seen, phones] for each store build whose
--   own bundle production phones ran. The version is the merge's time in UTC
--   (apps/mobile/app.config.js), and only runs after that time count: an
--   install keeps the time it first ran any store build's bundle, which is
--   older than the newer build it may run now;
-- - hours and days: [time, part, metric, key, value] of the failure counts
--   (diag.hourly, then diag.daily for the days before its 14 days).
-- Times and counts only: never an install id, a profile id, a name or a
-- message. diag_reader may run it, as the page's Worker does.

create or replace function diag.ops_release_line(p_days integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz;
  v_split date;
begin
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'days is 1 to 90' using errcode = '22023';
  end if;
  v_from := now() - pg_catalog.make_interval(days => p_days);
  -- Whole days come from diag.daily up to the first full day diag.hourly holds; hours after it.
  v_split := coalesce((select (min(h.hour) at time zone 'UTC')::date + 1 from diag.hourly h), (now() at time zone 'UTC')::date + 1);
  return jsonb_build_object(
    'updates', (select coalesce(jsonb_agg(jsonb_build_array(x.k, x.os, x.f, x.n) order by x.f), '[]'::jsonb) from (
        select u.update_key as k, i.context->>'os' as os, min(u.first_at) as f, count(*) as n
        from diag.install_updates u join diag.installs i on i.install_id = u.install_id
        where u.update_key <> 'embedded' and u.last_at >= v_from
          and i.context->>'os' in ('ios', 'android') and i.context->>'channel' = 'production'
        group by 1, 2) x),
    'builds', (select coalesce(jsonb_agg(jsonb_build_array(y.os, y.v, y.f, y.n) order by y.f), '[]'::jsonb) from (
        select x.os, x.v, min(x.first_at) filter (where x.first_at >= x.made) as f, count(*) filter (where x.first_at >= x.made) as n
        from (
          select i.context->>'os' as os, pg_catalog.split_part(i.context->>'appVersion', ' ', 1) as v, u.first_at,
                 case when m[2]::int / 100 between 1 and 12 and m[2]::int % 100 between 1 and 31 and m[3]::int / 100 < 24 and m[3]::int % 100 < 60
                      then pg_catalog.make_timestamptz(m[1]::int, m[2]::int / 100, m[2]::int % 100, m[3]::int / 100, m[3]::int % 100, 0, 'UTC') end as made
          from diag.install_updates u join diag.installs i on i.install_id = u.install_id
          cross join lateral (select pg_catalog.regexp_match(i.context->>'appVersion', '^(\d{4})\.(\d{3,4})\.(\d{1,4})') as m) p
          where u.update_key = 'embedded' and u.last_at >= v_from and p.m is not null
            and i.context->>'os' in ('ios', 'android') and i.context->>'channel' = 'production'
        ) x
        group by 1, 2 having count(*) filter (where x.first_at >= x.made) > 0) y),
    'hours', (select coalesce(jsonb_agg(jsonb_build_array(h.hour, h.part, h.metric, h.key, h.value) order by h.hour), '[]'::jsonb)
        from diag.hourly h
        where h.hour >= greatest(v_from, v_split::timestamp at time zone 'UTC')
          and (h.part, h.metric) in (('clients', 'shown_failures'), ('clients', 'errors'), ('clients', 'downloads_failed'), ('clients', 'sign_in_trouble'),
                                     ('worker', 'server_errors'), ('jobs', 'failed'), ('cron', 'failed'))
          and h.value > 0),
    'days', (select coalesce(jsonb_agg(jsonb_build_array(d.day, d.part, d.metric, d.key, d.value) order by d.day), '[]'::jsonb)
        from diag.daily d
        where d.day >= (v_from at time zone 'UTC')::date and d.day < v_split
          and (d.part, d.metric) in (('clients', 'shown_failures'), ('clients', 'errors'), ('clients', 'downloads_failed'), ('clients', 'sign_in_trouble'),
                                     ('worker', 'server_errors'), ('jobs', 'failed'), ('cron', 'failed'))
          and d.value > 0)
  );
end $$;
revoke all on function diag.ops_release_line(integer) from public, anon, authenticated, service_role;
grant execute on function diag.ops_release_line(integer) to diag_reader;
