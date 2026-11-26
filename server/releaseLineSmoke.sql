-- The line of merges on the ops dashboard's Releases page (migration
-- *_ops_release_line.sql): each update's first run on a production iPhone
-- and Android phone, each store build's first run after its version's time,
-- the failure counts by hour and by day, never an install id, and
-- diag_reader runs the function but reads none of its tables.
-- Run by `npm run db:test`. Repeatable; every write rolls back.
\set ON_ERROR_STOP on
begin;

insert into diag.installs (install_id, profile_id, context) values
  ('rl-ios-1', 'rl-profile-1', '{"os":"ios","channel":"production","appVersion":"2026.1121.2103 (79)"}'),
  ('rl-ios-2', 'rl-profile-2', '{"os":"ios","channel":"production","appVersion":"2026.1121.2103 (79)"}'),
  ('rl-android-1', 'rl-profile-3', '{"os":"android","channel":"production","appVersion":"2026.1121.2103 (68)"}'),
  ('rl-dev-1', 'rl-profile-4', '{"os":"ios","channel":"development","appVersion":"2026.1121.2103 (80)"}');

-- Update rlaaaaaa: two iPhones (first at 10:00), one Android phone (11:00), and a development build earlier, which does not count.
-- The store build 2026.1121.2103: one iPhone ran its bundle before 21:03 UTC (an older build then), one after; the Android phone after.
insert into diag.install_updates (install_id, update_key, first_at, last_at) values
  ('rl-ios-1', 'rlaaaaaa', now() - interval '2 days' + interval '10 hours', now()),
  ('rl-ios-2', 'rlaaaaaa', now() - interval '2 days' + interval '12 hours', now()),
  ('rl-android-1', 'rlaaaaaa', now() - interval '2 days' + interval '11 hours', now()),
  ('rl-dev-1', 'rlaaaaaa', now() - interval '2 days', now()),
  ('rl-ios-1', 'embedded', '2026-11-20T08:00:00Z', now()),
  ('rl-ios-2', 'embedded', '2026-11-22T03:00:00Z', now()),
  ('rl-android-1', 'embedded', '2026-11-21T22:00:00Z', now()),
  ('rl-dev-1', 'embedded', '2026-11-21T22:30:00Z', now());

-- Failures: one an hour ago, keyed; a count of an unrelated metric; a zero; and one day before the days diag.hourly holds
-- (its oldest hour, 10 days ago here unless the database holds older ones, starts the hours on the day after it).
insert into diag.hourly (hour, part, metric, key, value) values
  (date_trunc('hour', now(), 'UTC') - interval '10 days', 'clients', 'syncs', '', 1),
  (date_trunc('hour', now(), 'UTC') - interval '1 hour', 'clients', 'shown_failures', 'rl-smoke · RlError · E1', 4),
  (date_trunc('hour', now(), 'UTC') - interval '1 hour', 'clients', 'syncs', '', 40),
  (date_trunc('hour', now(), 'UTC') - interval '1 hour', 'worker', 'server_errors', 'rl-smoke-route', 0);
-- The day before the first full day diag.hourly holds comes from diag.daily (whatever else a database holds).
insert into diag.daily (day, part, metric, key, value)
  select (min(hour) at time zone 'UTC')::date - 1, 'jobs', 'failed', 'rl-smoke-job', 3 from diag.hourly;

grant diag_reader to postgres;
set local role diag_reader;
do $$
declare
  v jsonb := diag.ops_release_line(40);
  u jsonb;
  b jsonb;
begin
  -- Each platform's first production run of the update, with the phones that ran it.
  select jsonb_agg(e order by e->>1) into u from jsonb_array_elements(v->'updates') e where e->>0 = 'rlaaaaaa';
  if jsonb_array_length(u) <> 2 then raise exception 'one row per platform: %', u; end if;
  if (u->0->>1) <> 'android' or (u->0->>3)::int <> 1 then raise exception 'android row: %', u->0; end if;
  if (u->1->>1) <> 'ios' or (u->1->>3)::int <> 2 then raise exception 'ios row, without the development build: %', u->1; end if;
  if abs(extract(epoch from (u->1->>2)::timestamptz - (now() - interval '2 days' + interval '10 hours'))) > 1 then raise exception 'ios first run: %', u->1; end if;

  -- The store build: only runs after 21:03 UTC on 21 November count.
  select jsonb_agg(e order by e->>0) into b from jsonb_array_elements(v->'builds') e where e->>1 = '2026.1121.2103';
  if jsonb_array_length(b) <> 2 then raise exception 'one row per platform: %', b; end if;
  if (b->0->>0) <> 'android' or (b->0->>2)::timestamptz <> '2026-11-21T22:00:00Z' then raise exception 'android build: %', b->0; end if;
  if (b->1->>0) <> 'ios' or (b->1->>2)::timestamptz <> '2026-11-22T03:00:00Z' or (b->1->>3)::int <> 1 then raise exception 'ios build, older run left out: %', b->1; end if;

  -- Failure counts only, above zero; the day before the hours comes by day.
  if not exists (select 1 from jsonb_array_elements(v->'hours') e where e->>3 = 'rl-smoke · RlError · E1' and (e->>4)::numeric = 4) then raise exception 'the keyed failure is missing'; end if;
  if exists (select 1 from jsonb_array_elements(v->'hours') e where e->>2 = 'syncs' or e->>3 = 'rl-smoke-route') then raise exception 'a count that is not a failure, or a zero'; end if;
  if not exists (select 1 from jsonb_array_elements(v->'days') e where e->>3 = 'rl-smoke-job') then raise exception 'the day before the hours is missing'; end if;

  -- No install or profile id anywhere in the answer.
  if v::text ~ 'rl-(ios|android|dev|profile)' then raise exception 'an install or profile id: %', v; end if;

  begin
    perform diag.ops_release_line(0);
    raise exception 'took 0 days';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform count(*) from diag.install_updates;
    raise exception 'diag_reader read diag.install_updates';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
