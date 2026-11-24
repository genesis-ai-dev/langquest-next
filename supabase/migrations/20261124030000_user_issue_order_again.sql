-- The fix team tries once more each issue where Claude asked a person for what it can now do itself
-- (docs/decisions/2026-11-24-a-card-asks-only-what-a-person-must-do.md, docs/agent-team.md
-- "Which issue Claude takes first").
--
-- Before 2026-11-23 the fix team could not read production. Some managers then said "a developer
-- decides" and asked the developer to give Claude a token or to run a read (LAN-313, LAN-300,
-- LAN-298). The cards of those issues still say "Waits on you", though Claude now reads production
-- before it starts, and the watch never hands such an issue back. The card's words were also hard to
-- read: SQL, token names and file paths.
--
-- ops_user_issue_order() now also names, as 'again', each open issue whose record is a
-- choice for a developer (reason 'decision', no pull request) written before 2026-11-24 06:00 UTC,
-- and that no run handed over since. A hand-over writes ops.user_issue_tries, so each comes once.
-- The same order as before: Linear's priority, then people, kinds, places, times and the oldest.

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
  -- Claude asked a person for a choice before 2026-11-24 06:00 UTC, with no pull request, and no run
  -- handed the issue over since: the fix team tries it once more, with production reads and the
  -- card's new wording rules.
  again as (
    select f.issue from facts f
    join ops.user_issue_fixes x on x.issue = f.issue
    where f.open and x.reason = 'decision' and x.decision = 'none' and x.pr is null
      and x.at < timestamptz '2026-11-24 06:00:00+00'
      and not exists (select 1 from ops.user_issue_tries t where t.issue = f.issue and t.handed_at >= timestamptz '2026-11-24 06:00:00+00')
  ),
  waits as (
    select issue, 'plan' as source from due
    union all select issue, 'research' from research where issue not in (select issue from due)
    union all select issue, 'untried' from untried where issue not in (select issue from due) and issue not in (select issue from research)
    union all select issue, 'again' from again where issue not in (select issue from due) and issue not in (select issue from research)
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
