-- Claude also tries the open issues it never tried, and the ops dashboard says what Claude does
-- next and when (docs/agent-team.md "Issues Claude never tried",
-- docs/decisions/2026-11-21-on-its-way-says-what-happens-next.md).
--
-- The fix team took a new issue only in the run that filed it, at most FIX_MAX (3) of them. An
-- issue with no room in that run was never tried: on 2026-11-21, 15 open issues had no fix and
-- nobody worked on them, and the dashboard showed them under "On its way". Now each run also
-- takes the open issues Claude never tried, the oldest first, while FIX_MAX has room; each run
-- says which issues it handed to the fix jobs, so none is tried twice by this way and the
-- dashboard knows when Claude started on each.
--
-- 1. ops.user_issue_tries keeps when a run last handed each issue to the fix jobs.
-- 2. ops_user_issue_untried() names the open issues Claude never tried, the oldest first.
-- 3. ops_user_issue_tried() takes a run's handed issues, through the Worker's door
--    (/api/user-issues, server/userIssues.ts checks them first).
-- 4. diag.ops_user_issue_tries() hands the dashboard when Claude last started on each issue.

create table if not exists ops.user_issue_tries (
  issue text primary key check (issue ~ '^[A-Z]{1,10}-[0-9]{1,7}$'),
  -- When the newest run handed the issue to the fix jobs.
  handed_at timestamptz not null default now(),
  run_url text check (run_url is null or run_url ~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$')
);
alter table ops.user_issue_tries enable row level security;

-- Open issues the watch filed (its newest word on them) that have no fix record and were never handed to the fix jobs, the
-- oldest first. An issue a run handed over and that got no record (its job failed) is not tried
-- again by this way: an admin's instruction on its card starts a new try. Nor is an issue that a
-- developer has In Progress or In Review in Linear.
create or replace function public.ops_user_issue_untried() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.issue order by x.first_at, x.issue), '[]'::jsonb)
  from (
    -- As diag.ops_user_issues() groups them, so the dashboard shows the same issues in the same order.
    select u.issue, min(u.first_looked_at) as first_at
    from ops.user_issues u
    where u.issue is not null and u.verdict <> 'noise' and u.looked_at > now() - interval '90 days'
      and not exists (select 1 from ops.user_issue_fixes f where f.issue = u.issue)
      and not exists (select 1 from ops.user_issue_tries t where t.issue = u.issue)
    group by u.issue
    having (array_agg(u.verdict order by u.looked_at desc))[1] = 'filed' and max(u.closed_at) is null and max(u.fixed_at) is null
       -- A developer works on it in Linear: Claude leaves it alone.
       and coalesce(max(u.issue_state), '') not in ('In Progress', 'In Review')
    order by min(u.first_looked_at), u.issue
    limit 20
  ) x
$$;
revoke all on function public.ops_user_issue_untried from public, anon, authenticated;
grant execute on function public.ops_user_issue_untried to service_role;

-- A run's handed issues: each one's time is now. Returns how many were kept.
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
  return v_kept;
end $$;
revoke all on function public.ops_user_issue_tried from public, anon, authenticated;
grant execute on function public.ops_user_issue_tried to service_role;

-- For the dashboard: when a run last handed each issue to the fix jobs, the last 90 days.
create or replace function diag.ops_user_issue_tries() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(t.issue, t.handed_at), '{}'::jsonb)
  from ops.user_issue_tries t
  where t.handed_at > now() - interval '90 days'
$$;
revoke all on function diag.ops_user_issue_tries from public;
grant execute on function diag.ops_user_issue_tries to diag_reader;
