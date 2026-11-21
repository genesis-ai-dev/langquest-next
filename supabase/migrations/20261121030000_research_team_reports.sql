-- The research team looks ahead (docs/research-team.md, docs/decisions/2026-11-21-a-research-team-looks-ahead.md).
--
-- One time each day, besides the search for the same mistake in other places (20261119234319_agent_research.sql),
-- a lead (Claude) and its scouts look at what can break next: known security holes in the packages, new versions,
-- and one more subject each weekday. The lead writes a report in plain words for the ops dashboard's Research page.
-- Every word is Claude's own, never what a person wrote.
--
-- 1. ops.research_items gets what a scout of the day says about a thing it found: the scout's subject (beat),
--    the kind of thing, how bad, the public pages that back it, the package and its versions, a date that
--    matters, and the choice it asks of a developer. All may be absent: an item of the old search has none.
-- 2. ops.research_reports keeps each run's report, 90 days.
-- 3. ops_research_done() takes them too; ops_research_context() and diag.ops_research() hand them on.

alter table ops.research_items add column if not exists beat text
  check (beat is null or beat in ('security', 'versions', 'packages', 'offline', 'code-security', 'speed', 'platform', 'alternatives', 'supply-chain'));
alter table ops.research_items add column if not exists kind text
  check (kind is null or kind in ('vulnerability', 'upgrade', 'replace', 'bug', 'risk', 'cost', 'deadline', 'other'));
alter table ops.research_items add column if not exists severity text
  check (severity is null or severity in ('critical', 'high', 'medium', 'low', 'info'));
-- Public pages that back it (an advisory, release notes, a store's rule): at most 6 https addresses.
alter table ops.research_items add column if not exists links jsonb not null default '[]'::jsonb
  check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 6);
alter table ops.research_items add column if not exists package text
  check (package is null or package ~ '^(@[a-z0-9._-]{1,100}/)?[a-z0-9._-]{1,100}$');
alter table ops.research_items add column if not exists from_version text check (from_version is null or from_version ~ '^[0-9A-Za-z.+-]{1,40}$');
alter table ops.research_items add column if not exists to_version text check (to_version is null or to_version ~ '^[0-9A-Za-z.+-]{1,40}$');
alter table ops.research_items add column if not exists deadline date;
-- The choice the team asks of a developer: { why, choices: [{ label, then }] }, 2 to 4 choices, the team's pick first.
alter table ops.research_items add column if not exists ask jsonb
  check (ask is null or (jsonb_typeof(ask) = 'object' and jsonb_typeof(ask->'choices') = 'array' and jsonb_array_length(ask->'choices') between 2 and 4));

-- The places of an item the team found looking ahead can be none: its evidence is a public page. The Worker
-- (server/userIssues.ts) checks that a recommended item has a place or a link.

create table if not exists ops.research_reports (
  run_url text primary key check (run_url ~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$'),
  day date not null,
  at timestamptz not null default now(),
  -- headline, summary, beats, lead, minutes, turns, counts, facts: as the Worker checked them (server/userIssues.ts ResearchReport).
  report jsonb not null check (jsonb_typeof(report) = 'object' and length(report::text) <= 32000)
);
alter table ops.research_reports enable row level security;
create index if not exists research_reports_day on ops.research_reports (day desc, at desc);

-- A run's items, its report, and the issues that went to the fix team. An item found again keeps its first time,
-- its issue and when it was handed over. Returns how many of each were kept.
create or replace function public.ops_research_done(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  i jsonb;
  v_kept int := 0;
  v_handed int := 0;
  v_report int := 0;
begin
  if coalesce(p->>'runUrl', '') !~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$' then
    raise exception 'not a run of this repository' using errcode = '22023';
  end if;
  delete from ops.research_items where at < now() - interval '365 days';
  delete from ops.research_reports where at < now() - interval '90 days';
  for i in select value from jsonb_array_elements(coalesce(p->'research', '[]'::jsonb)) loop
    insert into ops.research_items (tag, title, like_issue, found, why, places, steps, decision, action, issue, issue_url, run_url,
                                    beat, kind, severity, links, package, from_version, to_version, deadline, ask)
    values (i->>'tag', i->>'title', nullif(i->>'like', ''), i->>'found', i->>'why', coalesce(i->'places', '[]'::jsonb), nullif(i->'steps', 'null'::jsonb),
            i->>'decision', i->>'action', nullif(i->>'issue', ''), nullif(i->>'issueUrl', ''), p->>'runUrl',
            nullif(i->>'beat', ''), nullif(i->>'kind', ''), nullif(i->>'severity', ''), coalesce(nullif(i->'links', 'null'::jsonb), '[]'::jsonb),
            nullif(i->>'package', ''), nullif(i->>'from', ''), nullif(i->>'to', ''), nullif(i->>'deadline', '')::date, nullif(i->'ask', 'null'::jsonb))
    on conflict (tag) do update set title = excluded.title, like_issue = excluded.like_issue, found = excluded.found, why = excluded.why,
      places = excluded.places, steps = excluded.steps, decision = excluded.decision, action = excluded.action,
      issue = coalesce(excluded.issue, ops.research_items.issue), issue_url = coalesce(excluded.issue_url, ops.research_items.issue_url),
      run_url = excluded.run_url, at = now(),
      beat = coalesce(excluded.beat, ops.research_items.beat), kind = coalesce(excluded.kind, ops.research_items.kind),
      severity = coalesce(excluded.severity, ops.research_items.severity), links = excluded.links, package = excluded.package,
      from_version = excluded.from_version, to_version = excluded.to_version, deadline = excluded.deadline, ask = excluded.ask;
    v_kept := v_kept + 1;
  end loop;
  if jsonb_typeof(p->'report') = 'object' then
    insert into ops.research_reports (run_url, day, report) values (p->>'runUrl', (p->'report'->>'day')::date, (p->'report') - 'day'::text)
    on conflict (run_url) do update set day = excluded.day, report = excluded.report, at = now();
    v_report := 1;
  end if;
  update ops.research_items set handed_at = now()
  where handed_at is null and issue in (select value from jsonb_array_elements_text(coalesce(p->'handed', '[]'::jsonb)));
  get diagnostics v_handed = row_count;
  return jsonb_build_object('research', v_kept, 'handed', v_handed, 'report', v_report);
end $$;
revoke all on function public.ops_research_done from public, anon, authenticated;
grant execute on function public.ops_research_done to service_role;

-- What the leads read: as before, and each item's subject, kind, package and why (a rejected item says why it was
-- rejected, so it is not raised again), and the last report's headline.
create or replace function public.ops_research_context() returns jsonb
language sql stable security definer set search_path = '' as $$
  with g as (
    select u.issue, max(u.title) as title, max(u.closed_at) as closed_at, max(u.fixed_by) as fixed_by,
           (array_agg(u.context order by u.looked_at desc) filter (where u.context is not null))[1] as context,
           (array_agg(u.problem order by u.looked_at desc) filter (where u.problem is not null))[1] as problem,
           (array_agg(u.solution order by u.looked_at desc) filter (where u.solution is not null))[1] as solution,
           max(u.looked_at) as looked_at
    from ops.user_issues u
    where u.issue is not null and u.verdict <> 'noise' and u.looked_at > now() - interval '30 days'
    group by u.issue
  )
  select jsonb_build_object(
    'issues', coalesce((select jsonb_agg(jsonb_build_object('issue', x.issue, 'title', x.title, 'closed', x.closed_at is not null,
        'fixedBy', coalesce(x.fixed_by, f.pr), 'context', x.context, 'problem', x.problem, 'solution', x.solution,
        'summary', f.summary, 'cause', f.cause, 'twins', f.twins, 'decision', f.decision) order by x.looked_at desc)
      from (select * from g order by g.looked_at desc limit 60) x left join ops.user_issue_fixes f on f.issue = x.issue), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('tag', r.tag, 'title', r.title, 'like', r.like_issue, 'decision', r.decision,
        'action', r.action, 'issue', r.issue, 'places', r.places, 'at', r.at, 'firstAt', r.first_at, 'beat', r.beat, 'kind', r.kind,
        'severity', r.severity, 'package', r.package, 'from', r.from_version, 'to', r.to_version, 'why', r.why,
        'fixed', f.decision = 'merge', 'pr', f.pr) order by r.at desc)
      from (select * from ops.research_items where at > now() - interval '180 days' order by at desc limit 200) r
      left join ops.user_issue_fixes f on f.issue = r.issue), '[]'::jsonb),
    'last', (select jsonb_build_object('day', x.day, 'headline', x.report->>'headline') from ops.research_reports x order by x.day desc, x.at desc limit 1))
$$;
revoke all on function public.ops_research_context from public, anon, authenticated;
grant execute on function public.ops_research_context to service_role;

-- For the dashboard: the items of the last 90 days, the newest first, the reports of the last 14 days, and when
-- research last ran.
create or replace function diag.ops_research() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('tag', r.tag, 'title', r.title, 'like', r.like_issue, 'found', r.found, 'why', r.why,
        'places', r.places, 'steps', r.steps, 'decision', r.decision, 'action', r.action, 'issue', r.issue, 'issueUrl', r.issue_url,
        'handedAt', r.handed_at, 'firstAt', r.first_at, 'at', r.at, 'runUrl', r.run_url,
        'beat', r.beat, 'kind', r.kind, 'severity', r.severity, 'links', r.links, 'package', r.package, 'from', r.from_version,
        'to', r.to_version, 'deadline', r.deadline, 'ask', r.ask) order by r.first_at desc)
      from (select * from ops.research_items where at > now() - interval '90 days' order by first_at desc limit 150) r), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(x.report || jsonb_build_object('day', x.day, 'at', x.at, 'runUrl', x.run_url) order by x.day desc, x.at desc)
      from (select * from ops.research_reports where day > current_date - 14 order by day desc, at desc limit 30) x), '[]'::jsonb),
    'lastAt', greatest((select max(at) from ops.research_items), (select max(at) from ops.research_reports)))
$$;
revoke all on function diag.ops_research from public;
grant execute on function diag.ops_research to diag_reader;
