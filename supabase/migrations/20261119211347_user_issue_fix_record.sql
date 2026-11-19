-- The agent team's record of each fix, for the ops dashboard (docs/agent-team.md,
-- docs/decisions/2026-11-19-an-agent-team-fixes-user-issues.md).
--
-- A team of Claude agents writes a fix for each issue the watch for user issues
-- files (decisions.md 202). Code then decides whether the fix merges without a
-- person or waits for a developer (scripts/agent-team.mjs `gate`). A developer
-- reads on the dashboard what was decided and why: what changed, the cause, the
-- test that proves it, what the reviewer said, and the pictures that came with
-- the problem. The words are Claude's own (they are also in the public pull
-- request), never what a person wrote.
--
-- 1. ops.user_issue_fixes keeps one record for each issue: the newest.
-- 2. ops_user_issue_fixes_done() takes the records of a run, through the Worker's
--    door (/api/user-issues, server/userIssues.ts checks them first).
-- 3. diag.ops_user_issue_fixes() hands them to the dashboard, with which problems
--    sent from help mode have a screenshot or a picture.
-- 4. diag.ops_user_issue_fix_picture() hands the dashboard one picture of a display
--    fix: the screen before the fix, or after it.

create table if not exists ops.user_issue_fixes (
  issue text primary key check (issue ~ '^[A-Z]{1,10}-[0-9]{1,7}$'),
  -- merge: its pull request merges without a person. waits: a draft pull request waits for a developer.
  -- none: the team changed nothing, and a developer decides.
  decision text not null check (decision in ('merge', 'waits', 'none')),
  -- Why it waits, as the gate says it (server/userIssues.ts FIX_REASONS).
  reason text check (reason is null or reason in ('mode', 'review', 'decision', 'not_a_bug', 'unconfirmed', 'cause', 'paths', 'checks', 'reviewer', 'instruction', 'app', 'stalled')),
  why text check (why is null or length(why) between 1 and 600),
  pr int check (pr is null or pr between 1 and 100000000),
  verdict text check (verdict is null or verdict in ('fix', 'review', 'decision', 'not_a_bug', 'unconfirmed', 'approved')),
  -- The issue manager's model and effort, as the coordinator chose them.
  model text check (model is null or model in ('sonnet', 'opus')),
  effort text check (effort is null or effort in ('low', 'medium', 'high')),
  summary text check (summary is null or length(summary) between 1 and 1000),
  cause text check (cause is null or length(cause) between 1 and 600),
  proof text check (proof is null or length(proof) between 1 and 400),
  review text check (review is null or length(review) between 1 and 1000),
  twins text check (twins is null or length(twins) between 1 and 1000),
  -- A display fix's proof: the screen without the change and with it (JPEG), from the local test world, never a person's phone.
  before_jpg bytea check (before_jpg is null or length(before_jpg) <= 150000),
  after_jpg bytea check (after_jpg is null or length(after_jpg) <= 150000),
  run_url text check (run_url is null or run_url ~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$'),
  at timestamptz not null default now(),
  check ((decision = 'merge') = (reason is null)),
  check ((decision = 'none') = (pr is null)),
  check ((before_jpg is null) = (after_jpg is null))
);
alter table ops.user_issue_fixes enable row level security;

-- What a run did: the number of records kept. A later record of an issue replaces the decision and
-- keeps the words it does not send (a pull request that stalled keeps the reasoning of its fix).
create or replace function public.ops_user_issue_fixes_done(p jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  f jsonb;
  v_kept int := 0;
begin
  if coalesce(p->>'runUrl', '') !~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$' then
    raise exception 'not a run of this repository' using errcode = '22023';
  end if;
  for f in select value from jsonb_array_elements(coalesce(p->'fixes', '[]'::jsonb)) loop
    insert into ops.user_issue_fixes (issue, decision, reason, why, pr, verdict, model, effort, summary, cause, proof, review, twins, before_jpg, after_jpg, run_url)
    values (f->>'issue', f->>'decision', nullif(f->>'reason', ''), nullif(f->>'why', ''), (f->>'pr')::int, nullif(f->>'verdict', ''),
            nullif(f->>'model', ''), nullif(f->>'effort', ''), nullif(f->>'summary', ''), nullif(f->>'cause', ''), nullif(f->>'proof', ''),
            nullif(f->>'review', ''), nullif(f->>'twins', ''), decode(nullif(f->>'before', ''), 'base64'), decode(nullif(f->>'after', ''), 'base64'), p->>'runUrl')
    on conflict (issue) do update set decision = excluded.decision, reason = excluded.reason, why = excluded.why, pr = excluded.pr,
      verdict = coalesce(excluded.verdict, ops.user_issue_fixes.verdict), model = coalesce(excluded.model, ops.user_issue_fixes.model),
      effort = coalesce(excluded.effort, ops.user_issue_fixes.effort), summary = coalesce(excluded.summary, ops.user_issue_fixes.summary),
      cause = coalesce(excluded.cause, ops.user_issue_fixes.cause), proof = coalesce(excluded.proof, ops.user_issue_fixes.proof),
      review = coalesce(excluded.review, ops.user_issue_fixes.review), twins = coalesce(excluded.twins, ops.user_issue_fixes.twins),
      -- The pictures stay while the record is about the same pull request, and go with another one.
      before_jpg = case when excluded.before_jpg is not null then excluded.before_jpg when excluded.pr is not distinct from ops.user_issue_fixes.pr then ops.user_issue_fixes.before_jpg end,
      after_jpg = case when excluded.after_jpg is not null then excluded.after_jpg when excluded.pr is not distinct from ops.user_issue_fixes.pr then ops.user_issue_fixes.after_jpg end,
      run_url = excluded.run_url, at = now();
    v_kept := v_kept + 1;
  end loop;
  return v_kept;
end $$;
revoke all on function public.ops_user_issue_fixes_done from public, anon, authenticated;
grant execute on function public.ops_user_issue_fixes_done to service_role;

-- For the dashboard: by issue, the record of the last 90 days, and `pictures`: each problem sent
-- from help mode among the issue's kinds that came with a screenshot or a picture (the page asks
-- for the file itself by its id, as its Feedback list does). Never who sent it.
create or replace function diag.ops_user_issue_fixes() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(x.issue, jsonb_build_object('decision', x.decision, 'reason', x.reason, 'why', x.why, 'pr', x.pr,
      'verdict', x.verdict, 'model', x.model, 'effort', x.effort, 'summary', x.summary, 'cause', x.cause, 'proof', x.proof,
      'review', x.review, 'twins', x.twins, 'runUrl', x.run_url, 'at', x.at, 'beforeAfter', x.before_jpg is not null,
      'pictures', coalesce((
        select jsonb_agg(jsonb_build_object('id', f.id, 'screenshot', f.screenshot is not null, 'picture', f.picture is not null) order by f.created_at)
        from ops.user_issues u join diag.feedback f on u.key = 'feedback:' || f.id::text
        where u.issue = x.issue and (f.screenshot is not null or f.picture is not null)), '[]'::jsonb))), '{}'::jsonb)
  from ops.user_issue_fixes x
  where x.at > now() - interval '90 days'
$$;
revoke all on function diag.ops_user_issue_fixes from public;
grant execute on function diag.ops_user_issue_fixes to diag_reader;

-- One picture of a display fix, for a signed-in admin: 'before' or 'after'.
create or replace function diag.ops_user_issue_fix_picture(p_issue text, p_which text) returns bytea
language sql stable security definer set search_path = '' as $$
  select case p_which when 'before' then before_jpg when 'after' then after_jpg end from ops.user_issue_fixes where issue = p_issue
$$;
revoke all on function diag.ops_user_issue_fix_picture from public;
grant execute on function diag.ops_user_issue_fix_picture to diag_reader;
