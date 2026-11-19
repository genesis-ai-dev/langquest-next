-- What the agent team's research found, for the ops dashboard (docs/agent-team.md "The research team",
-- docs/decisions/2026-11-19-an-agent-team-fixes-user-issues.md, amended).
--
-- One time each day a lead (Claude) reads what the team fixed and what is open, and starts scouts that
-- look in the code for the same mistake in other places. It presents each thing found to the developers
-- on the dashboard: what, why, where, and what it recommends. Every word is Claude's own, never what a
-- person wrote: the research reads only the team's own words and the code.
--
-- 1. ops.research_items keeps one record for each thing found, by its tag.
-- 2. ops_research_context() hands the lead what the team knows, in the team's words.
-- 3. ops_research_done() takes a run's items and the issues handed to the fix team, through the
--    Worker's door (/api/user-issues, server/userIssues.ts checks them first).
-- 4. ops_research_waiting() names the recommended issues that wait for the fix team.
-- 5. diag.ops_research() hands the items to the dashboard.

create table if not exists ops.research_items (
  tag text primary key check (tag ~ '^[a-z0-9][a-z0-9-]{2,59}$'),
  title text not null check (length(title) between 1 and 200),
  -- The issue this is like: the one whose fix started the search.
  like_issue text check (like_issue is null or like_issue ~ '^[A-Z]{1,10}-[0-9]{1,7}$'),
  found text not null check (length(found) between 1 and 600),
  why text not null check (length(why) between 1 and 600),
  -- Where in the code: at most 8 of `path` or `path:line`.
  places jsonb not null default '[]'::jsonb check (jsonb_typeof(places) = 'array' and jsonb_array_length(places) <= 8),
  -- recommend: do something about it. watch: not sure yet. reject: looked at, nothing to do (kept so it is not found again).
  decision text not null check (decision in ('recommend', 'watch', 'reject')),
  -- fix: the fix team can write the change. ask: a developer must decide first. none: nothing to do.
  action text not null check (action in ('fix', 'ask', 'none')),
  -- The Linear issue filed for a recommended item.
  issue text check (issue is null or issue ~ '^[A-Z]{1,10}-[0-9]{1,7}$'),
  issue_url text check (issue_url is null or (issue_url ~ '^https://linear\.app/[A-Za-z0-9/_.-]+$' and length(issue_url) <= 320)),
  -- When its issue went to the fix team.
  handed_at timestamptz,
  first_at timestamptz not null default now(),
  at timestamptz not null default now(),
  run_url text check (run_url is null or run_url ~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$')
);
alter table ops.research_items enable row level security;

-- What the lead reads: each issue of the watch from the last 30 days in Claude's words (its card's
-- lines, and the record of its fix), and the items of earlier runs, so nothing is presented twice.
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
        'action', r.action, 'issue', r.issue, 'places', r.places, 'at', r.at) order by r.at desc)
      from (select * from ops.research_items where at > now() - interval '180 days' order by at desc limit 200) r), '[]'::jsonb))
$$;
revoke all on function public.ops_research_context from public, anon, authenticated;
grant execute on function public.ops_research_context to service_role;

-- A run's items, and the issues that went to the fix team. An item found again keeps its first
-- time, its issue and when it was handed over. Returns how many of each were kept.
create or replace function public.ops_research_done(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  i jsonb;
  v_kept int := 0;
  v_handed int := 0;
begin
  if coalesce(p->>'runUrl', '') !~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$' then
    raise exception 'not a run of this repository' using errcode = '22023';
  end if;
  delete from ops.research_items where at < now() - interval '365 days';
  for i in select value from jsonb_array_elements(coalesce(p->'research', '[]'::jsonb)) loop
    insert into ops.research_items (tag, title, like_issue, found, why, places, decision, action, issue, issue_url, run_url)
    values (i->>'tag', i->>'title', nullif(i->>'like', ''), i->>'found', i->>'why', coalesce(i->'places', '[]'::jsonb),
            i->>'decision', i->>'action', nullif(i->>'issue', ''), nullif(i->>'issueUrl', ''), p->>'runUrl')
    on conflict (tag) do update set title = excluded.title, like_issue = excluded.like_issue, found = excluded.found, why = excluded.why,
      places = excluded.places, decision = excluded.decision, action = excluded.action,
      issue = coalesce(excluded.issue, ops.research_items.issue), issue_url = coalesce(excluded.issue_url, ops.research_items.issue_url),
      run_url = excluded.run_url, at = now();
    v_kept := v_kept + 1;
  end loop;
  update ops.research_items set handed_at = now()
  where handed_at is null and issue in (select value from jsonb_array_elements_text(coalesce(p->'handed', '[]'::jsonb)));
  get diagnostics v_handed = row_count;
  return jsonb_build_object('research', v_kept, 'handed', v_handed);
end $$;
revoke all on function public.ops_research_done from public, anon, authenticated;
grant execute on function public.ops_research_done to service_role;

-- The recommended issues the fix team can write a change for and did not get yet, the oldest first.
create or replace function public.ops_research_waiting() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.issue order by x.first_at), '[]'::jsonb)
  from (select issue, first_at from ops.research_items
        where decision = 'recommend' and action = 'fix' and issue is not null and handed_at is null
        order by first_at limit 10) x
$$;
revoke all on function public.ops_research_waiting from public, anon, authenticated;
grant execute on function public.ops_research_waiting to service_role;

-- For the dashboard: the items of the last 90 days, the newest first, and when research last ran.
create or replace function diag.ops_research() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('tag', r.tag, 'title', r.title, 'like', r.like_issue, 'found', r.found, 'why', r.why,
        'places', r.places, 'decision', r.decision, 'action', r.action, 'issue', r.issue, 'issueUrl', r.issue_url,
        'handedAt', r.handed_at, 'firstAt', r.first_at, 'at', r.at, 'runUrl', r.run_url) order by r.first_at desc)
      from (select * from ops.research_items where at > now() - interval '90 days' order by first_at desc limit 100) r), '[]'::jsonb),
    'lastAt', (select max(at) from ops.research_items))
$$;
revoke all on function diag.ops_research from public;
grant execute on function diag.ops_research to diag_reader;
