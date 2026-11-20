-- A small diagram on each user issue's card (docs/agent-team.md "An image on each card").
--
-- Many issues have nothing to look at: an error from the records, a download that failed, a server
-- job in trouble. When the watch files an issue, Claude writes the steps that go wrong, and the ops
-- dashboard draws them: one box for each step, the step that goes wrong in red. The steps are
-- Claude's own words about the app, never what a person wrote, and the page draws them as text.
--
-- 1. ops.user_issue_diagrams keeps one diagram for each issue: the newest.
-- 2. ops_user_issue_diagrams_done() takes the diagrams of a run, through the Worker's door
--    (/api/user-issues, server/userIssues.ts checks them first).
-- 3. diag.ops_user_issue_diagrams() hands them to the dashboard, by issue.

create table if not exists ops.user_issue_diagrams (
  issue text primary key check (issue ~ '^[A-Z]{1,10}-[0-9]{1,7}$'),
  -- 2 to 6 of { where, text, wrong }: where it happens (Phone, Server), what happens, and whether this step goes wrong.
  steps jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 2 and 6),
  run_url text check (run_url is null or run_url ~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$'),
  at timestamptz not null default now()
);
alter table ops.user_issue_diagrams enable row level security;

create or replace function public.ops_user_issue_diagrams_done(p jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  d jsonb;
  v_kept int := 0;
begin
  if coalesce(p->>'runUrl', '') !~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$' then
    raise exception 'not a run of this repository' using errcode = '22023';
  end if;
  delete from ops.user_issue_diagrams where at < now() - interval '365 days';
  for d in select value from jsonb_array_elements(coalesce(p->'diagrams', '[]'::jsonb)) loop
    insert into ops.user_issue_diagrams (issue, steps, run_url) values (d->>'issue', d->'steps', p->>'runUrl')
    on conflict (issue) do update set steps = excluded.steps, run_url = excluded.run_url, at = now();
    v_kept := v_kept + 1;
  end loop;
  return v_kept;
end $$;
revoke all on function public.ops_user_issue_diagrams_done from public, anon, authenticated;
grant execute on function public.ops_user_issue_diagrams_done to service_role;

create or replace function diag.ops_user_issue_diagrams() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(d.issue, d.steps), '{}'::jsonb) from ops.user_issue_diagrams d
$$;
revoke all on function diag.ops_user_issue_diagrams from public;
grant execute on function diag.ops_user_issue_diagrams to diag_reader;
