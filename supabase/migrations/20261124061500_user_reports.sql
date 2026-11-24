-- User reports go first and have their own page
-- (docs/decisions/2026-11-24-user-reports-have-their-own-page-and-go-first.md).
--
-- A report is what a person sent from help mode in the app (diag.feedback): a problem or an idea.
-- Before this, a problem a person sent was one card among the watch's other cards on User issues,
-- and the fix team took it in the same order as a crash that no person wrote about.
--
-- 1. ops_user_issue_order() puts each issue that a person sent first: an issue with a key
--    'feedback:<id>' goes before every issue without one, whatever Linear's priority. Inside
--    each half the order is as before: Linear's priority, then people, kinds, places, times and
--    the oldest. Each row says 'sent'. The rest of the function is as
--    20261124030000_user_issue_order_again.sql made it.
-- 2. diag.ops_user_reports() hands the dashboard's User reports page each report of the last
--    90 days with what the watch decided about it and the state of its Linear issue. Reports from
--    an account in ops.watch_ignored (test accounts and the store review accounts) are only counted.
--    It gives what diag.feedback() already gives diag_reader (the words and the screen), and no name,
--    address, install or account.

create or replace function public.ops_user_issue_order(p_tries int default 10) returns jsonb
language sql stable security definer set search_path = '' as $$
  with facts as (
    select u.issue, min(u.first_looked_at) as first_at, max(u.people) as people, count(*) as kinds, sum(u.n) as times,
      (array_agg(u.verdict order by u.looked_at desc))[1] as last_verdict,
      bool_or(split_part(u.key, ':', 1) = 'feedback') as sent,
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
    select w.issue, w.source, coalesce(f.sent, false) as sent, coalesce(p.priority, 0) as priority,
      -- None counts as Medium.
      case coalesce(p.priority, 0) when 1 then 1 when 2 then 2 when 4 then 4 else 3 end as level,
      coalesce(f.people, 0) as people, coalesce(f.kinds, 0) as kinds,
      (select count(*) from ops.research_items r where r.like_issue = w.issue) as places,
      coalesce(f.times, 0) as times, f.first_at
    from waits w
    left join facts f on f.issue = w.issue
    left join ops.user_issue_priorities p on p.issue = w.issue
  )
  select coalesce(jsonb_agg(jsonb_build_object('issue', r.issue, 'from', r.source, 'sent', r.sent, 'priority', r.priority, 'people', r.people,
      'kinds', r.kinds, 'places', r.places, 'times', r.times, 'firstAt', r.first_at)
    order by r.sent desc, r.level, r.people desc, r.kinds desc, r.places desc, r.times desc, r.first_at nulls last, r.issue), '[]'::jsonb)
  from ranked r
$$;
revoke all on function public.ops_user_issue_order from public, anon, authenticated;
grant execute on function public.ops_user_issue_order to service_role;

create or replace function diag.ops_user_reports() returns jsonb
language sql stable security definer set search_path = '' as $$
  with r as (
    select f.id, f.created_at, f.kind, f.body, f.context, f.screenshot is not null as screenshot, f.picture is not null as picture, f.voice_ms,
      exists (select 1 from ops.watch_ignored w where w.profile_id = f.profile_id) as test
    from diag.feedback f
    where f.created_at > now() - interval '90 days'
  ),
  -- Each Linear issue that a report is in, with what the watch knows about the issue from all its kinds.
  g as (
    select u.issue, max(u.issue_url) as issue_url, max(u.title) as title, max(u.issue_state) as state,
      max(u.closed_at) as closed_at, max(u.fixed_by) as fixed_by, max(u.fixed_at) as fixed_at,
      (array_agg(u.problem order by u.looked_at desc) filter (where u.problem is not null))[1] as problem,
      (array_agg(u.known order by u.looked_at desc) filter (where u.known is not null))[1] as known,
      (array_agg(u.solution order by u.looked_at desc) filter (where u.solution is not null))[1] as solution
    from ops.user_issues u
    where u.issue in (select k.issue from ops.user_issues k where k.key like 'feedback:%' and k.issue is not null)
    group by u.issue
  )
  select jsonb_build_object(
    'reports', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'at', r.created_at, 'kind', r.kind, 'says', left(r.body, 1000), 'screen', r.context->>'screen', 'os', r.context->>'os',
        'screenshot', r.screenshot, 'picture', r.picture, 'voiceMs', r.voice_ms,
        'verdict', u.verdict, 'note', u.note, 'lookedAt', u.looked_at,
        'issue', u.issue, 'issueUrl', g.issue_url, 'title', coalesce(g.title, u.title), 'state', g.state,
        'closedAt', g.closed_at, 'fixedBy', coalesce(g.fixed_by, u.fixed_by), 'fixedAt', coalesce(g.fixed_at, u.fixed_at),
        'problem', coalesce(g.problem, u.problem), 'known', coalesce(g.known, u.known), 'solution', coalesce(g.solution, u.solution),
        'priority', p.priority)
        order by r.created_at desc)
      from (select * from r where not r.test order by r.created_at desc limit 200) r
      left join ops.user_issues u on u.key = 'feedback:' || r.id::text
      left join g on g.issue = u.issue
      left join ops.user_issue_priorities p on p.issue = u.issue), '[]'::jsonb),
    'test', (select count(*) from r where r.test)
  )
$$;
revoke all on function diag.ops_user_reports from public;
grant execute on function diag.ops_user_reports to diag_reader;
