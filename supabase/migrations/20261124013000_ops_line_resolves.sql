-- An admin marks a line of the ops dashboard resolved, and the line comes back
-- when its problem comes back (docs/decisions/2026-11-24-a-resolved-line-comes-back-with-its-problem.md).
--
-- A line such as "R2 class A operations this month are past what the plan
-- includes" is worked out again at each load of the page, so it stayed on the
-- Overview until the month ended, after the admin had looked at it. Now each
-- line has a Resolved button. The page hides a resolved line, and shows it
-- again when the problem comes back: it is worse, its count starts again, or it
-- went from the page and came back. A resolve never hides a new problem.
--
-- 1. ops.line_resolves keeps each resolve: the line, its part, its level and
--    measure at the time, who and when, and when and why it ended.
-- 2. ops_line_resolve() and ops_line_show() take a tap from the dashboard (the
--    service role, after apps/web/worker/opsActions.ts checked the person).
-- 3. ops_line_resolves_seen() ends each resolve whose line went from the page:
--    the watch for user issues calls it every 15 minutes with the lines it sees.
-- 4. diag.ops_line_resolves() hands the open resolves to the dashboard.

create table if not exists ops.line_resolves (
  id uuid primary key default gen_random_uuid(),
  -- The line: '<key>[:<subject>]' (apps/admin/src/alertKinds.ts alertId).
  line text not null check (line ~ '^[a-z0-9-]{1,60}(:[^[:cntrl:]]{1,200})?$'),
  -- The part whose answer holds the line (apps/admin/src/index.ts attention's `section`).
  part text not null check (part ~ '^[a-z0-9_]{1,40}$'),
  -- The line's level when the admin resolved it: a higher level brings it back.
  level text not null check (level in ('urgent', 'problem', 'watch')),
  -- The line's measure then, when its kind has one (usage-billed: the cost so far, in US dollars): twice it brings the line back.
  measure numeric check (measure is null or measure >= 0),
  -- The line's words as the page showed them, for the Resolved list.
  title text not null check (length(title) between 1 and 300),
  by uuid not null,
  at timestamptz not null default now(),
  ended_at timestamptz,
  -- gone: the watch saw the line go from the page; shown: an admin showed it again;
  -- again: an admin resolved the line again after it came back.
  ended text check (ended is null or ended in ('gone', 'shown', 'again')),
  ended_by uuid,
  check ((ended_at is null) = (ended is null))
);
-- One open resolve for each line.
create unique index if not exists line_resolves_open on ops.line_resolves (line) where ended_at is null;
create index if not exists line_resolves_at on ops.line_resolves (at desc);
alter table ops.line_resolves enable row level security;

-- From the dashboard: each line resolved as the page showed it now. A line that has an open resolve
-- (it came back, or another admin resolved it first) gets this one in its place. Answers how many.
create or replace function public.ops_line_resolve(p_lines jsonb, p_by uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  n jsonb;
  v_count int := 0;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 20 then
    raise exception 'at most 20 lines' using errcode = '22023';
  end if;
  for n in select value from jsonb_array_elements(p_lines) loop
    update ops.line_resolves set ended_at = now(), ended = 'again', ended_by = p_by
    where line = n->>'line' and ended_at is null;
    insert into ops.line_resolves (line, part, level, measure, title, by)
    values (n->>'line', n->>'part', n->>'level', (n->>'measure')::numeric, btrim(n->>'title'), p_by);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function public.ops_line_resolve from public, anon, authenticated;
grant execute on function public.ops_line_resolve to service_role;

-- From the dashboard: the lines shown again, by this admin. Answers how many had an open resolve.
create or replace function public.ops_line_show(p_lines text[], p_by uuid) returns int
language sql security definer set search_path = '' as $$
  with ended as (
    update ops.line_resolves set ended_at = now(), ended = 'shown', ended_by = p_by
    where line = any (p_lines) and ended_at is null returning 1)
  select count(*)::int from ended
$$;
revoke all on function public.ops_line_show from public, anon, authenticated;
grant execute on function public.ops_line_show to service_role;

-- From the watch for user issues, every 15 minutes: the lines the dashboard shows now and the parts that
-- answered. Each open resolve on a part that answered whose line is not there ends as gone, so the line
-- shows when its problem comes back. A part that did not answer says nothing about its lines.
create or replace function public.ops_line_resolves_seen(p_lines text[], p_parts text[]) returns int
language sql security definer set search_path = '' as $$
  with ended as (
    update ops.line_resolves set ended_at = now(), ended = 'gone'
    where ended_at is null and part = any (p_parts) and not (line = any (p_lines)) returning 1)
  select count(*)::int from ended
$$;
revoke all on function public.ops_line_resolves_seen from public, anon, authenticated;
grant execute on function public.ops_line_resolves_seen to service_role;

-- For the dashboard: every open resolve, with the admin's display name (the record of who did what:
-- docs/decisions/2026-11-21-every-dashboard-tap-shows-its-state.md). The page decides from the line as it is
-- now whether the problem came back (apps/admin/src/pageResolve.ts resolveBack).
create or replace function diag.ops_line_resolves() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('line', r.line, 'part', r.part, 'level', r.level, 'measure', r.measure,
      'title', r.title, 'at', r.at, 'who', coalesce(nullif(btrim(p.display_name), ''), 'An admin')) order by r.at desc), '[]'::jsonb)
  from ops.line_resolves r
  left join public.profiles p on p.id = r.by::text
  where r.ended_at is null
$$;
revoke all on function diag.ops_line_resolves from public;
grant execute on function diag.ops_line_resolves to diag_reader;

-- The dashboard's two new actions, in its log (ops.actions). Other branches change this list too, so this
-- adds the two names to the list that is there, whatever it holds.
do $$
declare
  v_def text;
  v_names text[];
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c where c.conrelid = 'ops.actions'::regclass and c.conname = 'actions_action_check';
  if v_def is null then raise exception 'ops.actions has no actions_action_check to add to'; end if;
  select array_agg(m[1]) into v_names from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') m;
  v_names := array(select distinct x from unnest(coalesce(v_names, '{}'::text[]) || array['line_resolved', 'line_shown']) x order by x);
  alter table ops.actions drop constraint if exists actions_action_check;
  execute format('alter table ops.actions add constraint actions_action_check check (action = any (%L::text[]))', v_names);
end $$;
