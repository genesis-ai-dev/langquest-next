-- The ops dashboard's lines in the watch for user issues (migration
-- *_ops_lines_linear.sql, docs/decisions/2026-11-17-each-ops-line-has-a-linear-issue.md):
-- a line the app Worker passes is handed over once as an `ops:` kind with what
-- the dashboard says, a key that is not an ops line or a link that is not https
-- is left out, a line looked at is not handed over again within the week, and
-- the dashboard's list says each line's Linear issue and state. Run by
-- `npm run db:test`. Every write rolls back.
\set ON_ERROR_STOP on
begin;

set local role service_role;
do $$
declare v jsonb; x jsonb; keys text[];
  lines jsonb := jsonb_build_array(
    jsonb_build_object('key', 'ops:r2-missing', 'level', 'urgent', 'text', 'The R2 reconciliation found 7 recordings the log names but R2 does not have.',
      'title', 'Recordings missing from R2', 'part', 'storage', 'link', 'https://next.langquest.org/ops-dashboard'),
    jsonb_build_object('key', 'ops:worker-build-failed:langquest-next', 'level', 'problem', 'text', 'The latest Workers Build failed.',
      'title', 'A Workers Build failed', 'part', 'cloudflare', 'link', 'javascript:alert(1)'),
    -- Not an ops line: the records already hold job and error kinds, so a line may not stand in for them.
    jsonb_build_object('key', 'job:projection:failing', 'level', 'problem', 'text', 'x', 'title', 'x', 'part', 'jobs'),
    jsonb_build_object('key', 'ops:bad key!', 'level', 'watch', 'text', 'x', 'title', 'x', 'part', 'x'),
    '"not an object"'::jsonb);
begin
  v := public.ops_user_issue_watch(lines);
  select array_agg(e->>'key') into keys from jsonb_array_elements(v->'look') e;
  assert keys @> array['ops:r2-missing', 'ops:worker-build-failed:langquest-next'], 'both ops lines handed over: %', keys;
  assert not keys && array['job:projection:failing', 'ops:bad key!'], 'nothing but ops lines from the dashboard: %', keys;
  select e into x from jsonb_array_elements(v->'look') e where e->>'key' = 'ops:r2-missing';
  assert x->>'family' = 'ops' and x->'server'->'line'->>'title' = 'Recordings missing from R2' and x->'server'->'line'->>'level' = 'urgent'
    and x->'server'->'line'->>'link' = 'https://next.langquest.org/ops-dashboard' and x->'before' = 'null'::jsonb, 'the line as the dashboard says it: %', x;
  select e into x from jsonb_array_elements(v->'look') e where e->>'key' = 'ops:worker-build-failed:langquest-next';
  assert x->'server'->'line'->'link' = 'null'::jsonb, 'only an https link: %', x;
  -- Without lines, as before.
  assert not exists (select 1 from jsonb_array_elements(public.ops_user_issue_watch()->'look') e where e->>'key' like 'ops:%'), 'no lines, no ops kinds';

  v := public.ops_user_issues_looked(jsonb_build_object('sha', repeat('a', 40), 'runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/124',
    'looked', jsonb_build_array(
      jsonb_build_object('key', 'ops:r2-missing', 'verdict', 'filed', 'issue', 'LAN-310', 'issueUrl', 'https://linear.app/x/issue/LAN-310', 'people', 0, 'count', 0,
        'title', 'Recordings missing from R2'),
      jsonb_build_object('key', 'ops:worker-build-failed:langquest-next', 'verdict', 'noise', 'people', 0, 'count', 0, 'note', 'A build cancelled by a newer push.')),
    'grew', '[]'::jsonb));
  assert (v->>'looked')::int = 2, 'two looked at: %', v;
  v := public.ops_user_issue_watch(lines);
  assert not exists (select 1 from jsonb_array_elements(v->'look') e where e->>'key' like 'ops:%'), 'each line looked at once: %', v->'look';
end $$;
reset role;

-- The dashboard reads each line's issue and state, the noise too.
set local role diag_reader;
do $$
declare v jsonb := diag.ops_user_issues(); x jsonb;
begin
  select e into x from jsonb_array_elements(v->'lines') e where e->>'key' = 'ops:r2-missing';
  assert x->>'issue' = 'LAN-310' and x->>'verdict' = 'filed' and x->>'issueUrl' = 'https://linear.app/x/issue/LAN-310', 'the filed line: %', x;
  select e into x from jsonb_array_elements(v->'lines') e where e->>'key' = 'ops:worker-build-failed:langquest-next';
  assert x->>'verdict' = 'noise' and x->'issue' = 'null'::jsonb, 'the noise line: %', x;
end $$;
reset role;

-- A line still on the page after its issue closed, past the check that would clear it, goes back to Claude at
-- once, not after the week (migration *_user_issue_came_back.sql,
-- docs/decisions/2026-11-26-the-live-check-decides-and-linear-follows.md).
update ops.user_issues set verdict = 'fixed', closed_at = now() - interval '2 hours', fixed_at = now() - interval '2 hours', fixed_by = null,
  issue_state = 'Live', looked_at = now() - interval '3 days' where key = 'ops:r2-missing';
set local role service_role;
do $$
declare v jsonb; x jsonb;
  line jsonb := jsonb_build_object('key', 'ops:r2-missing', 'level', 'urgent', 'text', 'The R2 reconciliation found 7 recordings the log names but R2 does not have.',
    'title', 'Recordings missing from R2', 'part', 'storage');
begin
  -- Its check would still count what came before the close: not yet.
  v := public.ops_user_issue_watch(jsonb_build_array(line || jsonb_build_object('settleMin', 600)));
  assert not exists (select 1 from jsonb_array_elements(v->'look') e where e->>'key' = 'ops:r2-missing'), 'not before its check: %', v->'look';
  -- Past it: handed over, with the closed issue in before.
  v := public.ops_user_issue_watch(jsonb_build_array(line || jsonb_build_object('settleMin', 30)));
  select e into x from jsonb_array_elements(v->'look') e where e->>'key' = 'ops:r2-missing';
  assert x->'before'->>'verdict' = 'fixed' and x->'before'->>'issue' = 'LAN-310' and x->'before'->>'closedAt' is not null, 'handed over after its close: %', x;
  -- A line with no settleMin waits an hour, as a server job does.
  assert exists (select 1 from jsonb_array_elements(public.ops_user_issue_watch(jsonb_build_array(line))->'look') e where e->>'key' = 'ops:r2-missing'), 'an hour by default';
end $$;
reset role;
-- Looked at since the close (Claude opened it again, or found it noise): not again until the week or the next close.
update ops.user_issues set looked_at = now() - interval '1 hour' where key = 'ops:r2-missing';
set local role service_role;
do $$ begin
  assert not exists (select 1 from jsonb_array_elements(public.ops_user_issue_watch(jsonb_build_array(jsonb_build_object('key', 'ops:r2-missing', 'level', 'urgent', 'text', 'x', 'title', 'x', 'part', 'storage', 'settleMin', 30)))->'look') e
    where e->>'key' = 'ops:r2-missing'), 'once for each close';
end $$;
reset role;

-- Nobody else hands lines to the watch.
do $$ begin
  set local role authenticated;
  perform public.ops_user_issue_watch('[]'::jsonb);
  raise exception 'a signed-in person ran the watch';
exception when insufficient_privilege then null;
end $$;
reset role;

rollback;
