-- A user issue in words, for its card on the ops dashboard (decisions.md 202,
-- amended 2026-11-18; docs/decisions/2026-11-18-ops-dashboard-menu-and-overview.md).
--
-- The dashboard shows each issue the watch filed as a card with three lines:
-- Context (what the person was doing, and where), Issue (what goes wrong) and
-- Solution (what would fix it, or what a person must decide). Until now the
-- database kept only the title, so the card could show only the kind's keys.
-- Claude writes the three lines when it files an issue (decisions.json,
-- scripts/user-issues.mjs), in its own words: never what a person wrote, an
-- id or an address (server/userIssues.ts checks them).
--
-- 1. ops.user_issues keeps `context`, `problem` and `solution`.
-- 2. ops_user_issues_looked() takes them with a looked kind.
-- 3. diag.ops_user_issues() hands the newest of each to the dashboard.

alter table ops.user_issues
  add column if not exists context text check (context is null or length(context) between 1 and 300),
  add column if not exists problem text check (problem is null or length(problem) between 1 and 300),
  add column if not exists solution text check (solution is null or length(solution) between 1 and 300);

-- As in 20261103204500_user_issues_fixed.sql, with the three lines: a look that sends none keeps
-- the lines the kind has, unless the kind moved to another issue.
create or replace function public.ops_user_issues_looked(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l jsonb;
  g jsonb;
  s jsonb;
  v_looked int := 0;
  v_grew int := 0;
  v_closed int := 0;
  v_opened int := 0;
  v_rows int;
begin
  if coalesce(p->>'runUrl', '') !~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$' then
    raise exception 'not a run of this repository' using errcode = '22023';
  end if;
  delete from ops.user_issues where verdict in ('noise', 'fixed') and looked_at < now() - interval '90 days';
  for l in select value from jsonb_array_elements(coalesce(p->'looked', '[]'::jsonb)) loop
    -- Filed or known is open (a closed issue Claude points to again is reopened by the workflow);
    -- fixed with an issue is a closed issue's kind people hit again only on builds from before the fix.
    insert into ops.user_issues (key, verdict, issue, issue_url, people, n, note, title, context, problem, solution, fixed_by, fixed_at, closed_at, looked_at, run_url)
    values (l->>'key', l->>'verdict', nullif(l->>'issue', ''), nullif(l->>'issueUrl', ''), (l->>'people')::int, (l->>'count')::bigint,
            nullif(l->>'note', ''), nullif(l->>'title', ''), nullif(l->>'context', ''), nullif(l->>'problem', ''), nullif(l->>'solution', ''),
            (l->>'fixedBy')::int, (l->>'fixedAt')::timestamptz,
            case when l->>'verdict' = 'fixed' and nullif(l->>'issue', '') is not null then now() end, now(), p->>'runUrl')
    on conflict (key) do update set verdict = excluded.verdict, issue = excluded.issue, issue_url = excluded.issue_url,
      people = excluded.people, n = excluded.n, note = excluded.note, title = coalesce(excluded.title, ops.user_issues.title),
      context = case when excluded.issue is distinct from ops.user_issues.issue then excluded.context else coalesce(excluded.context, ops.user_issues.context) end,
      problem = case when excluded.issue is distinct from ops.user_issues.issue then excluded.problem else coalesce(excluded.problem, ops.user_issues.problem) end,
      solution = case when excluded.issue is distinct from ops.user_issues.issue then excluded.solution else coalesce(excluded.solution, ops.user_issues.solution) end,
      fixed_by = excluded.fixed_by, fixed_at = excluded.fixed_at,
      closed_at = case when excluded.closed_at is null then null else coalesce(ops.user_issues.closed_at, excluded.closed_at) end,
      issue_state = case when excluded.issue is distinct from ops.user_issues.issue then null else ops.user_issues.issue_state end,
      looked_at = now(), run_url = excluded.run_url;
    v_looked := v_looked + 1;
  end loop;
  for g in select value from jsonb_array_elements(coalesce(p->'grew', '[]'::jsonb)) loop
    update ops.user_issues set people = (g->>'people')::int, n = (g->>'count')::bigint, grew_at = now()
    where key = g->>'key' and verdict in ('filed', 'known');
    if found then v_grew := v_grew + 1; end if;
  end loop;
  for s in select value from jsonb_array_elements(coalesce(p->'states', '[]'::jsonb)) loop
    if (s->>'closed')::boolean then
      -- Closed: its kinds are fixed, counted again from the fix, and what was sent from help mode about it is done.
      update ops.user_issues set verdict = 'fixed', closed_at = coalesce((s->>'closedAt')::timestamptz, now()),
        fixed_by = (s->>'fixedBy')::int, fixed_at = coalesce((s->>'fixedAt')::timestamptz, (s->>'closedAt')::timestamptz, now()), people = 0
      where issue = s->>'issue' and verdict in ('filed', 'known');
      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        v_closed := v_closed + 1;
        update diag.feedback f set done_at = now(), seen_at = coalesce(f.seen_at, now())
        where f.done_at is null and exists (select 1 from ops.user_issues u where u.issue = s->>'issue' and u.key = 'feedback:' || f.id::text);
      end if;
    else
      update ops.user_issues set verdict = 'filed', closed_at = null, fixed_by = null, fixed_at = null
      where issue = s->>'issue' and verdict = 'fixed';
      get diagnostics v_rows = row_count;
      if v_rows > 0 then v_opened := v_opened + 1; end if;
    end if;
    -- Its state's name in Linear, closed or open (Live after Verifying, Canceled after Live), and its title there.
    update ops.user_issues set issue_state = s->>'state', title = coalesce(nullif(s->>'title', ''), title) where issue = s->>'issue';
  end loop;
  return jsonb_build_object('looked', v_looked, 'grew', v_grew, 'closed', v_closed, 'reopened', v_opened);
end $$;

revoke all on function public.ops_user_issues_looked from public, anon, authenticated;
grant execute on function public.ops_user_issues_looked to service_role;

-- As in 20261117213500_ops_lines_linear.sql, with each issue's three lines: the newest look that sent one.
create or replace function diag.ops_user_issues() returns jsonb
language sql stable security definer set search_path = '' as $$
  with g as (
    select coalesce(u.issue, u.key) as id, u.issue, max(u.issue_url) as issue_url, max(u.title) as title,
           (array_agg(u.verdict order by u.looked_at desc))[1] as verdict, max(u.issue_state) as state,
           max(u.closed_at) as closed_at, max(u.fixed_by) as fixed_by, max(u.fixed_at) as fixed_at,
           jsonb_agg(u.key order by u.key) as keys, max(u.people) as people,
           min(u.first_looked_at) as first_at, max(u.looked_at) as looked_at,
           (array_agg(u.context order by u.looked_at desc) filter (where u.context is not null))[1] as context,
           (array_agg(u.problem order by u.looked_at desc) filter (where u.problem is not null))[1] as problem,
           (array_agg(u.solution order by u.looked_at desc) filter (where u.solution is not null))[1] as solution
    from ops.user_issues u
    where u.verdict <> 'noise' and u.looked_at > now() - interval '90 days'
    group by coalesce(u.issue, u.key), u.issue
  )
  select jsonb_build_object(
    'issues', coalesce((select jsonb_agg(jsonb_build_object('issue', x.issue, 'issueUrl', x.issue_url, 'title', x.title, 'verdict', x.verdict,
        'state', x.state, 'closedAt', x.closed_at, 'fixedBy', x.fixed_by, 'fixedAt', x.fixed_at, 'keys', x.keys, 'people', x.people,
        'firstAt', x.first_at, 'lookedAt', x.looked_at, 'context', x.context, 'problem', x.problem, 'solution', x.solution)
        order by x.open desc, x.first_at desc)
      from (select g.*, (g.issue is not null and g.closed_at is null) as open from g
            order by (g.issue is not null and g.closed_at is null) desc, g.first_at desc limit 100) x), '[]'::jsonb),
    'open', (select count(*) from g where g.issue is not null and g.closed_at is null),
    'closed', (select count(*) from g where g.closed_at is not null),
    'fixed', (select count(*) from g where g.issue is null),
    'noiseWeek', (select count(*) from ops.user_issues u where u.verdict = 'noise' and u.looked_at > now() - interval '7 days'),
    -- What the watch decided about each kind a dashboard line can name (ops lines, server jobs, the
    -- Worker's 5xx), and every kind judged noise this fortnight: each line's Linear issue and state.
    'lines', coalesce((select jsonb_agg(jsonb_build_object('key', x.key, 'verdict', x.verdict, 'issue', x.issue, 'issueUrl', x.issue_url,
        'title', x.title, 'state', x.issue_state, 'closedAt', x.closed_at, 'fixedBy', x.fixed_by, 'fixedAt', x.fixed_at, 'lookedAt', x.looked_at)
        order by x.looked_at desc)
      from (select * from ops.user_issues u
            where (split_part(u.key, ':', 1) in ('ops', 'job', 'worker') and u.looked_at > now() - interval '90 days')
               or (u.verdict = 'noise' and u.looked_at > now() - interval '14 days')
            order by u.looked_at desc limit 1000) x), '[]'::jsonb),
    'last', (select jsonb_build_object('at', r.started_at, 'outcome', r.outcome, 'n', r.n)
      from diag.job_runs r where r.job = 'user_issue_look' order by r.started_at desc limit 1)
  )
$$;
revoke all on function diag.ops_user_issues from public;
grant execute on function diag.ops_user_issues to diag_reader;
