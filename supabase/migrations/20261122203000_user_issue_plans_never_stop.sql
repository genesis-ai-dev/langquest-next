-- An issue whose cause Claude did not prove never stops at "a developer decides"
-- (docs/decisions/2026-11-22-an-issue-card-never-ends-at-no-fix.md).
--
-- Before, after PLAN_TRIES (10) hand-backs the watch stopped handing the issue back, and its card said
-- "Claude wrote no fix. A developer decides." Many of those tries were spent on runs that could not read
-- production or ended before they wrote a verdict, so the limit stopped issues for a fault of the job,
-- not of the plan.
--
-- 1. ops_user_issue_plans_due() no longer leaves out an issue for its number of tries.
-- 2. ops_user_issue_tried() waits 24 hours, not 2, after the PLAN_TRIES-th try: the plan goes on once a
--    day, so one issue still cannot use the Frontier plan's week.
-- 3. The plans that stopped at PLAN_TRIES come back at the next run.
-- 4. Each open issue that ended at "not proven" with no plan gets one, so the manager tries it again.

create or replace function public.ops_user_issue_plans_due(p_tries int default 10) returns jsonb
language sql stable security definer set search_path = '' as $$
  -- p_tries is kept so callers need no change; an issue past it still comes back, once a day (ops_user_issue_tried).
  select coalesce(jsonb_agg(x.issue order by x.next_at, x.issue), '[]'::jsonb)
  from (
    select pl.issue, pl.next_at
    from ops.user_issue_plans pl
    where pl.next_at <= now()
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

create or replace function public.ops_user_issue_tried(p jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_kept int := 0;
begin
  if coalesce(p->>'runUrl', '') !~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$' then
    raise exception 'not a run of this repository' using errcode = '22023';
  end if;
  delete from ops.user_issue_tries where handed_at < now() - interval '365 days';
  insert into ops.user_issue_tries (issue, handed_at, run_url)
  select distinct value, now(), p->>'runUrl' from jsonb_array_elements_text(coalesce(p->'tried', '[]'::jsonb))
  where value ~ '^[A-Z]{1,10}-[0-9]{1,7}$'
  on conflict (issue) do update set handed_at = excluded.handed_at, run_url = excluded.run_url;
  get diagnostics v_kept = row_count;
  -- 2 hours between tries; from the 10th try (PLAN_TRIES, scripts/agent-team.mjs) on, 24 hours.
  update ops.user_issue_plans pl
  set tries = least(pl.tries + 1, 1000),
      next_at = greatest(pl.next_at, now() + case when pl.tries + 1 >= 10 then interval '24 hours' else interval '2 hours' end)
  where pl.issue in (select value from jsonb_array_elements_text(coalesce(p->'tried', '[]'::jsonb)));
  return v_kept;
end $$;
revoke all on function public.ops_user_issue_tried from public, anon, authenticated;
grant execute on function public.ops_user_issue_tried to service_role;

-- The plans that stopped at PLAN_TRIES come back at the next run, then once a day.
update ops.user_issue_plans set next_at = now() where tries >= 10;

-- An open issue whose last record says "not proven" with no plan gets one.
insert into ops.user_issue_plans (issue, next, steps, next_at, tries)
select f.issue, 'Claude tries again: it reads production and runs a test of its own to prove the cause.', null, now(), 1
from ops.user_issue_fixes f
where f.decision = 'none' and f.reason = 'unconfirmed' and f.at > now() - interval '90 days'
  and exists (
    select 1 from ops.user_issues u where u.issue = f.issue
    group by u.issue
    having max(u.closed_at) is null and max(u.fixed_at) is null)
on conflict (issue) do nothing;
