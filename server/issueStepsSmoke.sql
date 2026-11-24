-- The steps on a user issue (migration 20261124193000_user_issue_steps.sql): each change to the issue's tables adds a
-- step, whether an admin's instruction started the work or Claude's agent team started it alone; the same step from
-- many kinds of problem is kept once; no person's words are kept; diag_reader reads them. Run by `npm run db:test`.
-- Every write rolls back.
\set ON_ERROR_STOP on
begin;

do $$ declare
  run constant text := 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/4242';
  v jsonb; v_note uuid;
begin
  delete from ops.user_issue_steps where issue = 'LAN-951';
  -- The watch files the issue, from two kinds of problem in one run: one step.
  insert into ops.user_issues (key, verdict, issue, issue_url, people, n, run_url)
  values ('transfer:down:lang:failSmoke', 'filed', 'LAN-951', 'https://linear.app/t/issue/LAN-951', 2, 5, run),
         ('transfer:down:lang:failSmoke2', 'filed', 'LAN-951', 'https://linear.app/t/issue/LAN-951', 1, 1, run);
  assert (select count(*) from ops.user_issue_steps where issue = 'LAN-951' and kind = 'filed') = 1, 'the same filing is kept once';
  assert (select detail->>'family' from ops.user_issue_steps where issue = 'LAN-951' and kind = 'filed') = 'transfer', 'with where it came from';

  -- Claude's agent team takes it alone: a plan with reads of the diagnostics and the Worker's logs, then a try that runs them.
  assert public.ops_user_issue_plans_done(jsonb_build_object('runUrl', run, 'plans', jsonb_build_array(jsonb_build_object(
    'issue', 'LAN-951', 'next', 'Read the downloads of the phones that hit it.', 'inHours', 2,
    'reads', jsonb_build_array('select count(*) from diag.records', 'select 1', '--logs worker-logs minutes=60'))))) = 1, 'the plan is kept';
  v := (select detail from ops.user_issue_steps where issue = 'LAN-951' and kind = 'plan');
  assert v->>'next' = 'Read the downloads of the phones that hit it.', 'the plan step has Claude''s words';
  assert v->'reads' = '{"diag": 1, "db": 1, "logs": ["worker-logs"]}'::jsonb, 'and its reads as counts and log names, never the statements';
  perform public.ops_user_issue_tried(jsonb_build_object('runUrl', run, 'tried', jsonb_build_array('LAN-951')));
  assert (select detail->'reads'->>'diag' from ops.user_issue_steps where issue = 'LAN-951' and kind = 'handed') = '1', 'the try says the reads it runs first';

  -- The fix, read by the reviewer, merges; Linear closes it.
  insert into ops.user_issue_fixes (issue, decision, reason, pr, verdict, model, effort, cause, review, run_url)
  values ('LAN-951', 'merge', null, 951, 'fix', 'opus', 'high', 'The retry dropped the language id.', 'Reads well.', run);
  v := (select to_jsonb(s) from ops.user_issue_steps s where issue = 'LAN-951' and kind = 'fix');
  assert (v->'detail'->>'reviewed')::boolean and (v->>'pr')::int = 951 and v->>'run_url' = run, 'the fix step has its review, pull request and run';
  update ops.user_issues set verdict = 'fixed', fixed_by = 951, fixed_at = now(), issue_state = 'Done', closed_at = now() where issue = 'LAN-951';
  assert (select count(*) from ops.user_issue_steps where issue = 'LAN-951' and kind in ('merged', 'state', 'closed')) = 3, 'merged, its state and closed, once each';
  update ops.user_issues set verdict = 'filed', closed_at = null, issue_state = 'Todo' where issue = 'LAN-951';
  assert exists (select 1 from ops.user_issue_steps where issue = 'LAN-951' and kind = 'reopened'), 'opened again in Linear';

  -- An admin's instruction: the run that takes it is a step, with the note's id and none of its words.
  insert into ops.user_issue_notes (issue, text, by) values ('LAN-951', 'Please close it, the person found a way.', gen_random_uuid()) returning id into v_note;
  update ops.user_issue_notes set taken_at = now(), tries = 1, run_url = run where id = v_note;
  assert (select detail->>'note' from ops.user_issue_steps where issue = 'LAN-951' and kind = 'taken') = v_note::text, 'the instruction''s run is a step';
  assert not exists (select 1 from ops.user_issue_steps where issue = 'LAN-951' and detail::text like '%found a way%'), 'no person''s words';

  v := diag.ops_user_issue_steps();
  assert jsonb_array_length(v->'LAN-951') between 9 and 25, 'diag reads the issue''s steps';
  assert (v->'LAN-951'->0->>'at')::timestamptz >= (v->'LAN-951'->-1->>'at')::timestamptz, 'the newest first';
end $$;

set local role diag_reader;
select diag.ops_user_issue_steps() is not null as diag_reads;
reset role;
set local role authenticated;
do $$ begin
  perform 1 from ops.user_issue_steps;
  raise exception 'a signed-in person read the steps';
exception when insufficient_privilege then null;
end $$;
reset role;

rollback;
