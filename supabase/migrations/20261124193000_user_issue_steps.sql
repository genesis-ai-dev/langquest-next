-- Each step on a user issue, kept as it happens, for the issue's card
-- (docs/decisions/2026-11-24-each-issue-card-shows-its-steps.md).
--
-- The issue's tables keep only the newest state, one row an issue: its fix record, its plan, when a run
-- last handed it to the fix team. The card could not show the way the issue went: that the watch found and
-- filed it, that the fix team took it, which reads of production and which logs each try ran, the plan,
-- the fix and its review, the merge and Linear's state. Each change to one of these tables now also adds a
-- step here, whether an admin's instruction started the work or Claude's agent team started it alone.
--
-- 1. ops.user_issue_steps keeps the steps: Claude's words and the records' facts, never a person's words.
-- 2. Triggers on ops.user_issues, ops.user_issue_tries, ops.user_issue_plans, ops.user_issue_fixes and
--    ops.user_issue_notes add them. A step that cannot be kept never stops the write that made it.
-- 3. The steps the rows there now show, so a card has its last steps from the start.
-- 4. diag.ops_user_issue_steps() hands the dashboard each issue's last 25 steps.

create table if not exists ops.user_issue_steps (
  id bigint generated always as identity primary key,
  issue text not null check (issue ~ '^[A-Z]{1,10}-[0-9]{1,7}$'),
  at timestamptz not null default now(),
  -- filed: the watch filed the issue in Linear; known: it added a new kind of problem to it; grew: more people hit it;
  -- handed: a run gave it to the fix team; plan: the issue manager's plan to prove the cause; fix: its fix record;
  -- taken: a run started on an admin's instruction; merged: a pull request that fixes it merged;
  -- state: its state in Linear changed; closed and reopened: in Linear.
  kind text not null check (kind in ('filed', 'known', 'grew', 'handed', 'plan', 'fix', 'taken', 'merged', 'state', 'closed', 'reopened')),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and length(detail::text) <= 2000),
  pr int check (pr is null or pr between 1 and 100000000),
  run_url text check (run_url is null or run_url ~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$')
);
create index if not exists user_issue_steps_issue_at on ops.user_issue_steps (issue, at desc);
alter table ops.user_issue_steps enable row level security;

-- The reads a plan names (ops.user_issue_plans.reads), as counts and log names: never the statements.
-- diag: reads of the field diagnostics (the diag schema); db: other reads of the production database;
-- logs: the logs it reads (`--logs worker-logs ...`: docs/production-reads.md "Logs").
create or replace function ops.user_issue_reads(p_reads jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when p_reads is null or jsonb_typeof(p_reads) <> 'array' or jsonb_array_length(p_reads) = 0 then null else jsonb_build_object(
    'diag', (select count(*) from jsonb_array_elements_text(p_reads) r where r.value !~ '^--logs ' and r.value ~* '\mdiag\.'),
    'db', (select count(*) from jsonb_array_elements_text(p_reads) r where r.value !~ '^--logs ' and r.value !~* '\mdiag\.'),
    'logs', (select coalesce(jsonb_agg(distinct split_part(r.value, ' ', 2)), '[]'::jsonb) from jsonb_array_elements_text(p_reads) r
             where r.value ~ '^--logs [a-z][a-z-]{1,40}')) end
$$;

-- Keeps one step. One issue has many kinds of problem (rows of ops.user_issues), so the same step from each of
-- them in the same 10 minutes is kept once. An issue keeps its last 200 steps.
create or replace function ops.user_issue_step(p_issue text, p_kind text, p_detail jsonb, p_pr int, p_run text, p_at timestamptz default now())
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_detail jsonb := jsonb_strip_nulls(coalesce(p_detail, '{}'::jsonb));
begin
  if p_issue is null then return; end if;
  if exists (select 1 from ops.user_issue_steps s where s.issue = p_issue and s.kind = p_kind and s.detail = v_detail
             and s.pr is not distinct from p_pr and s.at > p_at - interval '10 minutes' and s.at <= p_at + interval '10 minutes') then
    return;
  end if;
  insert into ops.user_issue_steps (issue, at, kind, detail, pr, run_url)
  values (p_issue, coalesce(p_at, now()), p_kind, v_detail, p_pr,
          case when p_run ~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$' then p_run end);
  delete from ops.user_issue_steps s where s.issue = p_issue
    and s.id not in (select x.id from ops.user_issue_steps x where x.issue = p_issue order by x.at desc, x.id desc limit 200);
exception when others then
  -- A step is a record of the work, not the work: the write that made it goes on.
  raise warning 'user issue step not kept: %', sqlerrm;
end $$;
revoke all on function ops.user_issue_step from public;

create or replace function ops.user_issues_step() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.issue is null then return new; end if;
  if tg_op = 'INSERT' or old.issue is distinct from new.issue then
    perform ops.user_issue_step(new.issue, case when new.verdict = 'known' then 'known' else 'filed' end,
      jsonb_build_object('family', split_part(new.key, ':', 1)), null, new.run_url);
    return new;
  end if;
  if new.grew_at is not null and new.grew_at is distinct from old.grew_at then
    perform ops.user_issue_step(new.issue, 'grew', jsonb_build_object('people', new.people), null, new.run_url);
  end if;
  if new.issue_state is not null and new.issue_state is distinct from old.issue_state then
    perform ops.user_issue_step(new.issue, 'state', jsonb_build_object('state', new.issue_state), null, null);
  end if;
  if new.closed_at is not null and old.closed_at is null then
    perform ops.user_issue_step(new.issue, 'closed', jsonb_build_object('state', new.issue_state), null, null);
  elsif new.closed_at is null and old.closed_at is not null then
    perform ops.user_issue_step(new.issue, 'reopened', '{}'::jsonb, null, null);
  end if;
  if new.fixed_by is not null and new.fixed_by is distinct from old.fixed_by then
    perform ops.user_issue_step(new.issue, 'merged', '{}'::jsonb, new.fixed_by, null);
  end if;
  return new;
end $$;
drop trigger if exists user_issues_step on ops.user_issues;
create trigger user_issues_step after insert or update on ops.user_issues for each row execute function ops.user_issues_step();

-- A run gave the issue to the fix team: with the reads of its plan, which the fix job runs before Claude starts
-- (docs/decisions/2026-11-23-the-fix-team-reads-production-before-claude-starts.md).
create or replace function ops.user_issue_tries_step() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.handed_at is distinct from old.handed_at then
    perform ops.user_issue_step(new.issue, 'handed',
      jsonb_build_object('reads', (select ops.user_issue_reads(pl.reads) from ops.user_issue_plans pl where pl.issue = new.issue)), null, new.run_url);
  end if;
  return new;
end $$;
drop trigger if exists user_issue_tries_step on ops.user_issue_tries;
create trigger user_issue_tries_step after insert or update on ops.user_issue_tries for each row execute function ops.user_issue_tries_step();

-- The issue manager's plan: what Claude does next (Claude's words), when, and the reads the next try runs.
create or replace function ops.user_issue_plans_step() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.at is distinct from old.at or new.next is distinct from old.next then
    perform ops.user_issue_step(new.issue, 'plan', jsonb_build_object('next', left(new.next, 300), 'nextAt', new.next_at,
      'reads', ops.user_issue_reads(new.reads), 'probe', new.probe is not null), null, new.run_url);
  end if;
  return new;
end $$;
drop trigger if exists user_issue_plans_step on ops.user_issue_plans;
create trigger user_issue_plans_step after insert or update on ops.user_issue_plans for each row execute function ops.user_issue_plans_step();

-- The fix record: the gate's decision and reason, the manager's verdict, model and effort, the cause it proved
-- (Claude's words), whether the reviewer read the change, and its pull request.
create or replace function ops.user_issue_fixes_step() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.at is distinct from old.at then
    perform ops.user_issue_step(new.issue, 'fix', jsonb_build_object('decision', new.decision, 'reason', new.reason, 'verdict', new.verdict,
      'model', new.model, 'effort', new.effort, 'cause', left(new.cause, 300), 'reviewed', new.review is not null), new.pr, new.run_url);
  end if;
  return new;
end $$;
drop trigger if exists user_issue_fixes_step on ops.user_issue_fixes;
create trigger user_issue_fixes_step after insert or update on ops.user_issue_fixes for each row execute function ops.user_issue_fixes_step();

-- A run started on an admin's instruction: its id only. The words stay in ops.user_issue_notes.
create or replace function ops.user_issue_notes_step() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.taken_at is not null and new.taken_at is distinct from old.taken_at then
    perform ops.user_issue_step(new.issue, 'taken', jsonb_build_object('note', new.id), null, new.run_url);
  end if;
  return new;
end $$;
drop trigger if exists user_issue_notes_step on ops.user_issue_notes;
create trigger user_issue_notes_step after update on ops.user_issue_notes for each row execute function ops.user_issue_notes_step();

-- The steps the rows there now show, at their own times, for the issues of the last 90 days.
do $$ begin
  if not exists (select 1 from ops.user_issue_steps) then
    perform ops.user_issue_step(f.issue, case when f.verdict = 'known' then 'known' else 'filed' end, jsonb_build_object('family', f.family), null, f.run_url, f.at)
    from (select distinct on (u.issue) u.issue, u.verdict, split_part(u.key, ':', 1) as family, u.run_url, u.first_looked_at as at
          from ops.user_issues u where u.issue is not null and u.looked_at > now() - interval '90 days'
          order by u.issue, u.first_looked_at) f;
    perform ops.user_issue_step(t.issue, 'handed', '{}'::jsonb, null, t.run_url, t.handed_at)
    from ops.user_issue_tries t where t.handed_at > now() - interval '90 days';
    perform ops.user_issue_step(pl.issue, 'plan', jsonb_build_object('next', left(pl.next, 300), 'nextAt', pl.next_at,
      'reads', ops.user_issue_reads(pl.reads), 'probe', pl.probe is not null), null, pl.run_url, pl.at)
    from ops.user_issue_plans pl where pl.at > now() - interval '90 days';
    perform ops.user_issue_step(x.issue, 'fix', jsonb_build_object('decision', x.decision, 'reason', x.reason, 'verdict', x.verdict,
      'model', x.model, 'effort', x.effort, 'cause', left(x.cause, 300), 'reviewed', x.review is not null), x.pr, x.run_url, x.at)
    from ops.user_issue_fixes x where x.at > now() - interval '90 days';
    perform ops.user_issue_step(n.issue, 'taken', jsonb_build_object('note', n.id), null, n.run_url, n.taken_at)
    from ops.user_issue_notes n where n.taken_at > now() - interval '90 days';
    perform ops.user_issue_step(m.issue, 'merged', '{}'::jsonb, m.fixed_by, null, m.fixed_at)
    from (select distinct on (u.issue) u.issue, u.fixed_by, u.fixed_at from ops.user_issues u
          where u.issue is not null and u.fixed_by is not null and u.fixed_at > now() - interval '90 days' order by u.issue, u.fixed_at) m;
    perform ops.user_issue_step(c.issue, 'closed', jsonb_build_object('state', c.state), null, null, c.closed_at)
    from (select u.issue, max(u.closed_at) as closed_at, max(u.issue_state) as state from ops.user_issues u
          where u.issue is not null group by u.issue having max(u.closed_at) > now() - interval '90 days') c;
  end if;
end $$;

-- For the dashboard: each issue's last 25 steps of the last 90 days, the newest first.
create or replace function diag.ops_user_issue_steps() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(i.issue, x.steps), '{}'::jsonb)
  from (select distinct s.issue from ops.user_issue_steps s where s.at > now() - interval '90 days') i
  cross join lateral (
    select jsonb_agg(jsonb_build_object('at', l.at, 'kind', l.kind, 'detail', l.detail, 'pr', l.pr, 'run', l.run_url) order by l.at desc, l.id desc) as steps
    from (select s.* from ops.user_issue_steps s where s.issue = i.issue and s.at > now() - interval '90 days'
          order by s.at desc, s.id desc limit 25) l
  ) x
$$;
revoke all on function diag.ops_user_issue_steps from public;
grant execute on function diag.ops_user_issue_steps to diag_reader;
