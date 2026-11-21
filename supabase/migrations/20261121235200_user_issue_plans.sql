-- The issue manager never stops at "the cause is not proven" (docs/agent-team.md "When the cause
-- is not proven yet", docs/decisions/2026-11-21-the-issue-manager-proves-the-cause-or-carries-out-a-plan.md).
--
-- Before, a manager that could not prove a cause changed nothing, and the issue waited for a
-- developer with nothing to do but ask "then prove it". Now the manager writes what it does next and
-- when: read production again, run a test of its own on main (a probe), or add a timing and wait for
-- new records. The watch hands the issue back to the manager at that time, with what the probe
-- printed, until the cause is proven or a developer must choose.
--
-- 1. ops.user_issue_plans keeps one plan for each issue: the newest. A record with no plan removes it.
-- 2. ops_user_issue_plans_done() takes the plans of a run, through the Worker's door
--    (/api/user-issues, server/userIssues.ts checks them first).
-- 3. ops_user_issue_plans_due() names the open issues whose plan's time has come, the oldest first.
-- 4. ops_user_issue_plan(issue) hands the run that writes the issue's fix its plan.
-- 5. diag.ops_user_issue_plans() hands the dashboard what Claude does next on each issue, and when.
-- 6. The issues that stopped at "not proven" before this get a plan, so the manager tries them again.

create table if not exists ops.user_issue_plans (
  issue text primary key check (issue ~ '^[A-Z]{1,10}-[0-9]{1,7}$'),
  -- What Claude does next, in a sentence (Claude's words, never what a person wrote).
  next text not null check (length(next) between 1 and 300),
  -- The steps to prove the cause, all of them.
  steps text check (steps is null or length(steps) between 1 and 600),
  -- When the watch hands the issue back to the manager.
  next_at timestamptz not null,
  -- What the manager's own test printed on main, in the local test world (never production rows).
  probe text check (probe is null or length(probe) between 1 and 6000),
  -- How many plans in a row the issue had. At PLAN_TRIES (scripts/agent-team.mjs) the watch stops handing it back.
  tries int not null default 1 check (tries between 1 and 1000),
  run_url text check (run_url is null or run_url ~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$'),
  at timestamptz not null default now()
);
alter table ops.user_issue_plans enable row level security;

-- A run's plans: each { issue, next, steps, inHours, probe } keeps or replaces the issue's plan; { issue, next: null } removes it.
-- Returns how many were kept or removed.
create or replace function public.ops_user_issue_plans_done(p jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  x jsonb;
  v_kept int := 0;
  v_hours numeric;
begin
  if coalesce(p->>'runUrl', '') !~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$' then
    raise exception 'not a run of this repository' using errcode = '22023';
  end if;
  for x in select value from jsonb_array_elements(coalesce(p->'plans', '[]'::jsonb)) loop
    if coalesce(x->>'issue', '') !~ '^[A-Z]{1,10}-[0-9]{1,7}$' then continue; end if;
    if nullif(x->>'next', '') is null then
      delete from ops.user_issue_plans where issue = x->>'issue';
    else
      v_hours := least(greatest(coalesce((x->>'inHours')::numeric, 1), 0.25), 168);
      insert into ops.user_issue_plans (issue, next, steps, next_at, probe, tries, run_url)
      values (x->>'issue', left(x->>'next', 300), left(nullif(x->>'steps', ''), 600), now() + make_interval(secs => (v_hours * 3600)::int),
              left(nullif(x->>'probe', ''), 6000), 1, p->>'runUrl')
      on conflict (issue) do update set next = excluded.next, steps = excluded.steps, next_at = excluded.next_at,
        probe = excluded.probe, tries = least(ops.user_issue_plans.tries + 1, 1000), run_url = excluded.run_url, at = now();
    end if;
    v_kept := v_kept + 1;
  end loop;
  return v_kept;
end $$;
revoke all on function public.ops_user_issue_plans_done from public, anon, authenticated;
grant execute on function public.ops_user_issue_plans_done to service_role;

-- Open issues whose plan's time has come and that had fewer than p_tries plans in a row, the oldest time first.
-- Not one that a developer has In Progress or In Review in Linear, nor one closed or fixed.
create or replace function public.ops_user_issue_plans_due(p_tries int default 10) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.issue order by x.next_at, x.issue), '[]'::jsonb)
  from (
    select pl.issue, pl.next_at
    from ops.user_issue_plans pl
    where pl.next_at <= now() and pl.tries < greatest(p_tries, 1)
      and exists (
        select 1 from ops.user_issues u where u.issue = pl.issue and u.verdict <> 'noise' and u.looked_at > now() - interval '90 days'
        group by u.issue
        having max(u.closed_at) is null and max(u.fixed_at) is null
           and coalesce(max(u.issue_state), '') not in ('In Progress', 'In Review'))
    order by pl.next_at, pl.issue
    limit 20
  ) x
$$;
revoke all on function public.ops_user_issue_plans_due from public, anon, authenticated;
grant execute on function public.ops_user_issue_plans_due to service_role;

-- The issue's plan for the run that writes its fix, or null.
create or replace function public.ops_user_issue_plan(p_issue text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('next', pl.next, 'steps', pl.steps, 'nextAt', pl.next_at, 'probe', pl.probe, 'tries', pl.tries, 'at', pl.at)
  from ops.user_issue_plans pl where pl.issue = p_issue
$$;
revoke all on function public.ops_user_issue_plan from public, anon, authenticated;
grant execute on function public.ops_user_issue_plan to service_role;

-- For the dashboard: by issue, what Claude does next and when, the last 90 days. Not the probe's output.
create or replace function diag.ops_user_issue_plans() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(pl.issue, jsonb_build_object('next', pl.next, 'steps', pl.steps, 'nextAt', pl.next_at, 'tries', pl.tries, 'at', pl.at)), '{}'::jsonb)
  from ops.user_issue_plans pl
  where pl.at > now() - interval '90 days'
$$;
revoke all on function diag.ops_user_issue_plans from public;
grant execute on function diag.ops_user_issue_plans to diag_reader;

-- Each open issue that stopped at "the cause is not proven" before this migration goes back to the manager
-- under the new rule, at the next runs (3 a run). LAN-323 is left out: a developer's thread works on it now
-- (Caleb Koster, 2026-11-21).
insert into ops.user_issue_plans (issue, next, steps, next_at, tries)
select f.issue, 'Claude tries again under the new rule: it reads production and runs a test of its own to prove the cause.', null, now(), 1
from ops.user_issue_fixes f
where f.decision = 'none' and f.reason = 'unconfirmed' and f.at > now() - interval '90 days' and f.issue <> 'LAN-323'
on conflict (issue) do nothing;
