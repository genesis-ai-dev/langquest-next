-- The fix team takes the most important issue first
-- (docs/decisions/2026-11-22-the-fix-team-takes-the-most-important-issue-first.md, docs/agent-team.md
-- "Which issue Claude takes first").
--
-- Each run hands at most FIX_MAX (3) issues to the fix jobs. Before, the new issues went first, then
-- the plans whose time came, the research's, and the issues Claude never tried, each list the oldest
-- first. An issue that 40 people hit could wait behind one that one person hit once. Now one order
-- holds every issue that waits for the fix team, the most important first:
--   1. Linear's priority: Urgent, then High, then Medium (or none), then Low. A developer who
--      changes it in Linear changes the order at the next run.
--   2. More people hit it (the most people of one of its kinds, in 7 days).
--   3. It touches more: more kinds of failure point to it, then more places where the research
--      found the same mistake.
--   4. It happened more times.
--   5. It waits longer.
-- An admin's instruction on a card still goes before this order (scripts/user-issues.mjs notesToTake).
--
-- 1. ops.user_issue_priorities keeps each issue's priority in Linear, as the watch last read it.
-- 2. ops_user_issue_priorities_done() takes what a run read, through the Worker's door.
-- 3. ops_user_issue_order() names the issues that wait for the fix team, in that order, with why.
-- 4. diag.ops_user_issue_order() hands the same order to the dashboard.

create table if not exists ops.user_issue_priorities (
  issue text primary key check (issue ~ '^[A-Z]{1,10}-[0-9]{1,7}$'),
  -- Linear's number: 0 none, 1 Urgent, 2 High, 3 Medium, 4 Low.
  priority smallint not null check (priority between 0 and 4),
  at timestamptz not null default now()
);
alter table ops.user_issue_priorities enable row level security;

-- A run's priorities, read from Linear: each one replaces the last. Returns how many changed.
create or replace function public.ops_user_issue_priorities_done(p jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_kept int := 0;
begin
  if coalesce(p->>'runUrl', '') !~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$' then
    raise exception 'not a run of this repository' using errcode = '22023';
  end if;
  insert into ops.user_issue_priorities (issue, priority, at)
  select distinct on (x->>'issue') x->>'issue', (x->>'priority')::smallint, now()
  from jsonb_array_elements(coalesce(p->'priorities', '[]'::jsonb)) x
  where x->>'issue' ~ '^[A-Z]{1,10}-[0-9]{1,7}$' and x->>'priority' ~ '^[0-4]$'
  on conflict (issue) do update set priority = excluded.priority, at = now()
    where ops.user_issue_priorities.priority is distinct from excluded.priority;
  get diagnostics v_kept = row_count;
  return v_kept;
end $$;
revoke all on function public.ops_user_issue_priorities_done from public, anon, authenticated;
grant execute on function public.ops_user_issue_priorities_done to service_role;

-- Every issue that waits for the fix team, the most important first, with the facts the order used:
--   from     plan (the cause is not proven yet and its plan's time came), research (the research
--            recommends a fix), untried (Claude never tried it)
--   priority Linear's number (0 none, 1 Urgent, 2 High, 3 Medium, 4 Low)
--   people   the most people of one of its kinds, in 7 days
--   kinds    how many kinds of failure point to it
--   places   how many places the research found with the same mistake
--   times    how many times its kinds happened
--   firstAt  when the watch first saw it
-- The same rules as before say which issues wait (ops_user_issue_plans_due, ops_research_waiting,
-- ops_user_issue_untried), without their limit of 20, so the order sees all of them.
create or replace function public.ops_user_issue_order(p_tries int default 10) returns jsonb
language sql stable security definer set search_path = '' as $$
  with facts as (
    select u.issue, min(u.first_looked_at) as first_at, max(u.people) as people, count(*) as kinds, sum(u.n) as times,
      (array_agg(u.verdict order by u.looked_at desc))[1] as last_verdict,
      max(u.closed_at) is null and max(u.fixed_at) is null and coalesce(max(u.issue_state), '') not in ('In Progress', 'In Review') as open
    from ops.user_issues u
    where u.issue is not null and u.verdict <> 'noise' and u.looked_at > now() - interval '90 days'
    group by u.issue
  ),
  due as (select value as issue from jsonb_array_elements_text(public.ops_user_issue_plans_due(p_tries))),
  research as (select value as issue from jsonb_array_elements_text(public.ops_research_waiting())),
  untried as (
    select f.issue from facts f
    where f.open and f.last_verdict = 'filed'
      and not exists (select 1 from ops.user_issue_fixes x where x.issue = f.issue)
      and not exists (select 1 from ops.user_issue_tries t where t.issue = f.issue)
  ),
  waits as (
    select issue, 'plan' as source from due
    union all select issue, 'research' from research where issue not in (select issue from due)
    union all select issue, 'untried' from untried where issue not in (select issue from due) and issue not in (select issue from research)
  ),
  ranked as (
    select w.issue, w.source, coalesce(p.priority, 0) as priority,
      -- None counts as Medium.
      case coalesce(p.priority, 0) when 1 then 1 when 2 then 2 when 4 then 4 else 3 end as level,
      coalesce(f.people, 0) as people, coalesce(f.kinds, 0) as kinds,
      (select count(*) from ops.research_items r where r.like_issue = w.issue) as places,
      coalesce(f.times, 0) as times, f.first_at
    from waits w
    left join facts f on f.issue = w.issue
    left join ops.user_issue_priorities p on p.issue = w.issue
  )
  select coalesce(jsonb_agg(jsonb_build_object('issue', r.issue, 'from', r.source, 'priority', r.priority, 'people', r.people,
      'kinds', r.kinds, 'places', r.places, 'times', r.times, 'firstAt', r.first_at)
    order by r.level, r.people desc, r.kinds desc, r.places desc, r.times desc, r.first_at nulls last, r.issue), '[]'::jsonb)
  from ranked r
$$;
revoke all on function public.ops_user_issue_order from public, anon, authenticated;
grant execute on function public.ops_user_issue_order to service_role;

-- For the dashboard: the same order, so its "next run" row names what the watch takes.
create or replace function diag.ops_user_issue_order() returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.ops_user_issue_order(10)
$$;
revoke all on function diag.ops_user_issue_order from public;
grant execute on function diag.ops_user_issue_order to diag_reader;
