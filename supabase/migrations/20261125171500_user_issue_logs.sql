-- The watch keeps the logs of the moment a failure starts, and a failure that comes back goes to the
-- fix team at once (docs/agent-team.md "The logs of the moment";
-- docs/decisions/2026-11-25-the-watch-keeps-the-logs-of-the-moment-a-failure-starts.md).
--
-- On 2026-11-25 the fix team tried LAN-298 (filed 2026-11-17) for the first time. The failure had
-- come again on 2026-11-22 while the issue was open, and nobody looked: the watch hands an ops line
-- or a server job to Claude once a week, and a kind with no people never "grows". The Worker logs
-- keep 24 hours, so the logs of each failure were gone when the fix team read them, and the issue
-- held no error text.
--
-- 1. ops.user_issue_logs keeps, for each kind, the log lines the watch read at the moment it saw the
--    failure (Worker errors and warnings, Postgres errors, the API's errors, lines that name the
--    kind), as agent_reader reads them: personal data already taken out by the log gate, and again
--    by the Worker. 30 days.
-- 2. ops_user_issue_logs_saved() takes a run's logs, through the Worker's door (/api/user-issues,
--    server/userIssues.ts checks them first).
-- 3. ops_user_issue_logs_of() hands the fix team an issue's saved logs, the newest first.
-- 4. ops_user_issue_back() names each open issue whose server job or ops line is failing now while
--    the watch does not hand it to Claude (looked at in the last 7 days), and had no logs saved in
--    12 hours: the watch saves its logs at once.
-- 5. ops_user_issue_order() puts an issue whose failure came back (logs saved with why 'back' after
--    the issue was last handed to the fix team) after the issues a person sent and before every
--    other issue, whatever Linear's priority: its logs are gone in a day. Each row says 'back'. The
--    rest of the function is as 20261124061500_user_reports.sql made it.

create table if not exists ops.user_issue_logs (
  id bigint generated always as identity primary key,
  key text not null check (length(key) <= 300 and key ~ '^(error|sync|transfer|auth|expected|audio|fill|device|slow|snapshot|job|worker|feedback|ops):[A-Za-z0-9 _.:()/#@-]+$'),
  at timestamptz not null default now(),
  -- 'new': a kind the watch handed to Claude (new, or back after a fix or a week). 'back': the failure
  -- of an open issue came back while the watch did not hand it over.
  why text not null check (why in ('new', 'back')),
  run_url text check (run_url is null or run_url ~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$'),
  -- [{source, ask, note, lines: [text]}], at most 64 KB.
  logs jsonb not null check (jsonb_typeof(logs) = 'array' and octet_length(logs::text) <= 65536)
);
create index if not exists user_issue_logs_key_at on ops.user_issue_logs (key, at desc);
alter table ops.user_issue_logs enable row level security;

-- A run's logs, each for one kind. Returns how many were kept.
create or replace function public.ops_user_issue_logs_saved(p jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_kept int := 0;
begin
  if coalesce(p->>'runUrl', '') !~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$' then
    raise exception 'not a run of this repository' using errcode = '22023';
  end if;
  delete from ops.user_issue_logs where at < now() - interval '30 days';
  insert into ops.user_issue_logs (key, why, run_url, logs)
  select e->>'key', e->>'why', p->>'runUrl', e->'logs'
  from jsonb_array_elements(case when jsonb_typeof(p->'logs') = 'array' then p->'logs' else '[]'::jsonb end) e
  where jsonb_typeof(e) = 'object' and jsonb_typeof(e->'logs') = 'array';
  get diagnostics v_kept = row_count;
  return v_kept;
end
$$;
revoke all on function public.ops_user_issue_logs_saved from public, anon, authenticated;
grant execute on function public.ops_user_issue_logs_saved to service_role;

-- An issue's saved logs, from all its kinds, the newest first: at most 8 saves.
create or replace function public.ops_user_issue_logs_of(p_issue text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', x.key, 'at', x.at, 'why', x.why, 'runUrl', x.run_url, 'logs', x.logs) order by x.at desc), '[]'::jsonb)
  from (
    select l.key, l.at, l.why, l.run_url, l.logs
    from ops.user_issue_logs l
    where l.key in (select u.key from ops.user_issues u where u.issue = p_issue)
    order by l.at desc
    limit 8
  ) x
$$;
revoke all on function public.ops_user_issue_logs_of from public, anon, authenticated;
grant execute on function public.ops_user_issue_logs_of to service_role;

-- The open issues whose server job or ops line fails now, which the watch does not hand to Claude
-- (looked at in the last 7 days), with no logs saved for that kind in 12 hours. `p_lines` are the ops
-- dashboard's lines that need a Linear issue, as the app Worker read them a moment ago (the same as
-- ops_user_issue_watch takes).
create or replace function public.ops_user_issue_back(p_lines jsonb default '[]'::jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  with now_failing as (
    select s.key, s.detail from ops.user_issue_server() s
    union all
    select distinct on (v->>'key') v->>'key', jsonb_build_object('line', jsonb_build_object(
             'level', left(v->>'level', 20), 'text', left(v->>'text', 600), 'title', left(v->>'title', 120), 'part', left(v->>'part', 40)))
    from jsonb_array_elements(case when jsonb_typeof(p_lines) = 'array' then p_lines else '[]'::jsonb end) v
    where jsonb_typeof(v) = 'object' and length(v->>'key') <= 290 and v->>'key' ~ '^ops:[A-Za-z0-9 _.:()/#@-]+$'
  )
  select coalesce(jsonb_agg(jsonb_build_object('key', x.key, 'issue', x.issue, 'server', x.detail) order by x.issue, x.key), '[]'::jsonb)
  from (
    select distinct on (f.key) f.key, u.issue, f.detail
    from now_failing f
    join ops.user_issues u on u.key = f.key
    where u.issue is not null and u.verdict in ('filed', 'known') and u.closed_at is null and u.fixed_at is null
      and u.looked_at >= now() - interval '7 days'
      and not exists (select 1 from ops.user_issue_logs l where l.key = f.key and l.at > now() - interval '12 hours')
    order by f.key
    limit 10
  ) x
$$;
revoke all on function public.ops_user_issue_back from public, anon, authenticated;
grant execute on function public.ops_user_issue_back to service_role;

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
  -- The failure came back and the watch saved its logs after the fix team last had the issue: the fix
  -- team reads them while they are fresh (the Worker logs keep 24 hours).
  back as (
    select f.issue from facts f
    where f.open
      and exists (
        select 1 from ops.user_issue_logs l join ops.user_issues k on k.key = l.key
        where k.issue = f.issue and l.why = 'back' and l.at > now() - interval '1 day'
          and l.at > coalesce((select max(t.handed_at) from ops.user_issue_tries t where t.issue = f.issue), '-infinity'::timestamptz)
          and l.at > coalesce((select max(x.at) from ops.user_issue_fixes x where x.issue = f.issue), '-infinity'::timestamptz))
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
    select issue, 'back' as source from back
    union all select issue, 'plan' from due where issue not in (select issue from back)
    union all select issue, 'research' from research where issue not in (select issue from back) and issue not in (select issue from due)
    union all select issue, 'untried' from untried where issue not in (select issue from back) and issue not in (select issue from due) and issue not in (select issue from research)
    union all select issue, 'again' from again where issue not in (select issue from back) and issue not in (select issue from due) and issue not in (select issue from research)
  ),
  ranked as (
    select w.issue, w.source, coalesce(f.sent, false) as sent, w.source = 'back' as back, coalesce(p.priority, 0) as priority,
      -- None counts as Medium.
      case coalesce(p.priority, 0) when 1 then 1 when 2 then 2 when 4 then 4 else 3 end as level,
      coalesce(f.people, 0) as people, coalesce(f.kinds, 0) as kinds,
      (select count(*) from ops.research_items r where r.like_issue = w.issue) as places,
      coalesce(f.times, 0) as times, f.first_at
    from (select distinct on (issue) issue, source from waits order by issue) w
    left join facts f on f.issue = w.issue
    left join ops.user_issue_priorities p on p.issue = w.issue
  )
  select coalesce(jsonb_agg(jsonb_build_object('issue', r.issue, 'from', r.source, 'sent', r.sent, 'back', r.back, 'priority', r.priority, 'people', r.people,
      'kinds', r.kinds, 'places', r.places, 'times', r.times, 'firstAt', r.first_at)
    order by r.sent desc, r.back desc, r.level, r.people desc, r.kinds desc, r.places desc, r.times desc, r.first_at nulls last, r.issue), '[]'::jsonb)
  from ranked r
$$;
revoke all on function public.ops_user_issue_order from public, anon, authenticated;
grant execute on function public.ops_user_issue_order to service_role;
