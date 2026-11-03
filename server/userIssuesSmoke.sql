-- The watch for user issues (migration *_user_issues.sql, decisions.md 202):
-- what phones and browsers reported, server jobs in trouble and problems sent
-- from help mode come out as kinds, leaving out development builds, the
-- ignored accounts, ideas and finished feedback, and never naming who sent
-- anything; a kind is handed over once, and again only when twice as many
-- people hit it; a kind found fixed, or whose issue closed in Linear, comes
-- back only for people after the fix (migration *_user_issues_fixed.sql);
-- only the service role reads or writes it, and the ops dashboard reads its
-- list. Run by `npm run db:test`. Every write rolls back.
\set ON_ERROR_STOP on
begin;

insert into ops.watch_ignored (profile_id, note) values ('ui-review', 'The smoke''s store review account');
insert into diag.installs (install_id, profile_id, context) values
  ('ui-a', 'ui-p1', '{"os":"android","appVersion":"2026.1030.1319","channel":"production"}'),
  ('ui-b', 'ui-p2', '{"os":"web","appVersion":"2026.1103.1000"}'),
  ('ui-dev', 'ui-p3', '{"os":"ios","appVersion":"2026.1103.0900","channel":"development"}'),
  ('ui-rev', 'ui-review', '{"os":"android","appVersion":"2026.1030.1319"}');
insert into diag.records (id, install_id, delivered_by, org_id, kind, at, received_at, n, t, stack) values
  -- One error two people hit in the last hours, with a stack; the same from a development build and the review account, left out.
  ('ui-1', 'ui-a', 'ui-p1', 'ui-org', 'error', now(), now() - interval '1 hour', '{}', '{"name":"TypeError","where":"record","code":"-"}', 'at save (recorder.ts:10)'),
  ('ui-2', 'ui-b', 'ui-p2', 'ui-org', 'error', now(), now() - interval '2 hours', '{}', '{"name":"TypeError","where":"record"}', null),
  ('ui-3', 'ui-dev', 'ui-p3', null, 'error', now(), now() - interval '1 hour', '{}', '{"name":"TypeError","where":"record"}', null),
  ('ui-4', 'ui-rev', 'ui-review', null, 'error', now(), now() - interval '1 hour', '{}', '{"name":"TypeError","where":"record"}', null),
  -- Downloads of reference audio failing, besides offline ones; a wrong password; a sign-in that went fine.
  ('ui-5', 'ui-a', 'ui-p1', 'ui-org', 'transfer', now(), now() - interval '1 hour', '{"count":5,"failOther":3,"failOffline":9}', '{"dir":"down","src":"source"}', null),
  ('ui-6', 'ui-a', 'ui-p1', null, 'auth', now(), now() - interval '1 hour', '{}', '{"op":"sign_in","outcome":"ok"}', null),
  ('ui-7', 'ui-a', 'ui-p1', null, 'auth', now(), now() - interval '1 hour', '{}', '{"op":"sign_in","outcome":"refused","code":"invalid_credentials"}', null),
  -- An expected failure seen only 3 times: counted, not handed over.
  ('ui-8', 'ui-b', 'ui-p2', null, 'expected', now(), now() - interval '1 hour', '{"count":3}', '{"where":"mic","name":"Refused","code":"-"}', null),
  -- Recordings lost, and one waiting over a day to upload; a download wanted for half an hour is fine.
  ('ui-9', 'ui-a', 'ui-p1', null, 'device', now(), now() - interval '1 hour', '{"lostRecordings":2,"oldestUnsentMin":2000,"wantedStuckMin":30}', '{}', null),
  ('ui-10', 'ui-b', 'ui-p2', 'ui-org', 'sync', now(), now() - interval '1 hour', '{}', '{"outcome":"error","phase":"pull","code":"57014","error":"ServerError"}', null),
  -- Older than a week: gone; three days old and quiet since: counted, not handed over.
  ('ui-11', 'ui-a', 'ui-p1', null, 'error', now(), now() - interval '9 days', '{}', '{"name":"Old","where":"x"}', null),
  ('ui-12', 'ui-b', 'ui-p2', null, 'error', now(), now() - interval '3 days', '{}', '{"name":"Quiet","where":"x"}', null);
insert into diag.feedback (id, profile_id, kind, body, install_id, context, shared_name, shared_email, screenshot, done_at) values
  ('0d000000-0000-4000-8000-0000000000f1', 'ui-p1', 'bug', 'My recording vanished', 'ui-a',
   '{"os":"android","appVersion":"2026.1030.1319","screen":"record","uiLanguage":"fr"}', 'Secret Person', 'secret@example.org', '\xffd8ff'::bytea, null),
  ('0d000000-0000-4000-8000-0000000000f2', 'ui-p2', 'idea', 'Add a dark mode', 'ui-b', '{}', null, null, null, null),
  ('0d000000-0000-4000-8000-0000000000f3', 'ui-review', 'bug', 'The review device', 'ui-rev', '{}', null, null, null, null),
  ('0d000000-0000-4000-8000-0000000000f4', 'ui-p2', 'bug', 'Already handled', 'ui-b', '{}', null, null, null, now());
-- A server job failing three times running, and the Worker's blobs_get route answering 5xx six times in a day.
insert into diag.job_runs (job, started_at, ms, outcome, error_class) values
  ('blob_reconcile', now() - interval '3 hours', 10, 'error', '57014'),
  ('blob_reconcile', now() - interval '2 hours', 10, 'error', '57014'),
  ('blob_reconcile', now() - interval '1 hour', 10, 'error', '57014');
insert into diag.job_runs (job, started_at, ms, outcome, n) values
  ('worker_requests', now() - interval '2 hours', 60000, 'partial', '{"blobs_get_2xx":40,"blobs_get_5xx":4}'),
  ('worker_requests', now() - interval '1 hour', 60000, 'partial', '{"blobs_get_5xx":2,"reports_5xx":1}');

set local role service_role;
do $$
declare v jsonb; x jsonb; keys text[];
begin
  v := public.ops_user_issue_watch();
  select array_agg(e->>'key' order by o) into keys from jsonb_array_elements(v->'look') with ordinality t(e, o);
  -- Help mode first, then the server, then the phones' kinds by people in the last day.
  assert keys[1] = 'feedback:0d000000-0000-4000-8000-0000000000f1', 'the bug report first: %', keys;
  assert keys @> array['job:blob_reconcile:failing', 'worker:blobs_get:5xx'], 'the server''s trouble: %', keys;
  assert (select max(o) from unnest(keys) with ordinality u(k, o) where k ~ '^(job|worker):')
       < (select min(o) from unnest(keys) with ordinality u(k, o) where k !~ '^(job|worker|feedback):'), 'then the server: %', keys;
  assert (select k from unnest(keys) with ordinality u(k, o) where k !~ '^(job|worker|feedback):' order by o limit 1) = 'error:TypeError@record:-',
    'then the error two people hit: %', keys;
  assert keys @> array['transfer:down:source:failOther', 'auth:sign_in:refused:invalid_credentials', 'device:lostRecordings',
    'device:uploadWaitingOverADay', 'sync:error:pull:57014:ServerError'], 'the other kinds: %', keys;
  assert not keys && array['transfer:down:source:failOffline', 'device:downloadWantedOverADay', 'expected:mic:Refused:-', 'error:Old@x:-',
    'error:Quiet@x:-', 'worker:reports:5xx', 'auth:sign_in:ok:-'], 'nothing offline, short, under ten, old, quiet or fine: %', keys;
  assert not exists (select 1 from unnest(keys) k where k like 'feedback:%f2' or k like 'feedback:%f3' or k like 'feedback:%f4'), 'no idea, review account or done feedback: %', keys;
  assert (v->>'active')::int >= 10, 'the phones'' 8 kinds and the server''s 2 at least, quiet ones too: %', v->>'active';
  assert v->'grew' = '[]'::jsonb, 'nothing filed yet';

  select e into x from jsonb_array_elements(v->'look') e where e->>'key' = 'error:TypeError@record:-';
  assert (x->>'people')::int = 2 and (x->>'peopleDay')::int = 2 and (x->>'installs')::int = 2 and (x->>'count')::int = 2
    and x->'platforms' = '{"android":1,"web":1}'::jsonb and jsonb_array_length(x->'apps') = 2 and x->'installIds' = '["ui-a","ui-b"]'::jsonb
    and x->>'stack' = 'at save (recorder.ts:10)' and x->'before' = 'null'::jsonb, 'the error, counted: %', x;
  select e into x from jsonb_array_elements(v->'look') e where e->>'key' = 'transfer:down:source:failOther';
  assert (x->>'count')::int = 3, 'failures, not records, counted: %', x;
  select e into x from jsonb_array_elements(v->'look') e where e->>'key' = 'job:blob_reconcile:failing';
  assert (x->>'count')::int = 3 and x->'server'->>'lastErrorClass' = '57014' and (x->'server'->>'streak')::int = 3, 'the job: %', x;
  select e into x from jsonb_array_elements(v->'look') e where e->>'key' = 'worker:blobs_get:5xx';
  assert (x->>'count')::int = 6 and x->'server'->>'route' = 'blobs_get', 'the route: %', x;
  x := v->'look'->0->'feedback';
  assert x->>'body' = 'My recording vanished' and x->>'screen' = 'record' and x->>'os' = 'android' and x->>'uiLanguage' = 'fr'
    and (x->>'screenshot')::boolean and not (x->>'picture')::boolean and x->>'installId' = 'ui-a'
    and x->'installKeys' @> '["error:TypeError@record:-","device:lostRecordings"]'::jsonb, 'the bug report, with its phone''s kinds: %', x;
  assert v::text not like '%Secret Person%' and v::text not like '%secret@example.org%' and v::text not like '%ui-p1%', 'never who sent it';

  -- The workflow filed two, called one noise, and the server's two known.
  v := public.ops_user_issues_looked(jsonb_build_object('sha', repeat('a', 40), 'runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/123',
    'looked', jsonb_build_array(
      jsonb_build_object('key', 'feedback:0d000000-0000-4000-8000-0000000000f1', 'verdict', 'filed', 'issue', 'LAN-300', 'issueUrl', 'https://linear.app/x/issue/LAN-300', 'people', 1, 'count', 1),
      jsonb_build_object('key', 'error:TypeError@record:-', 'verdict', 'filed', 'issue', 'LAN-300', 'issueUrl', 'https://linear.app/x/issue/LAN-300', 'people', 2, 'count', 2),
      jsonb_build_object('key', 'auth:sign_in:refused:invalid_credentials', 'verdict', 'noise', 'people', 1, 'count', 1, 'note', 'A wrong password, once.'),
      jsonb_build_object('key', 'job:blob_reconcile:failing', 'verdict', 'known', 'issue', 'LAN-12', 'issueUrl', 'https://linear.app/x/issue/LAN-12', 'people', 0, 'count', 3),
      jsonb_build_object('key', 'worker:blobs_get:5xx', 'verdict', 'known', 'issue', 'LAN-12', 'issueUrl', 'https://linear.app/x/issue/LAN-12', 'people', 0, 'count', 6)),
    'grew', '[]'::jsonb));
  assert v = '{"looked":5,"grew":0,"closed":0,"reopened":0}'::jsonb, 'five looked at: %', v;

  v := public.ops_user_issue_watch();
  select array_agg(e->>'key') into keys from jsonb_array_elements(v->'look') e;
  assert not keys && array['feedback:0d000000-0000-4000-8000-0000000000f1', 'error:TypeError@record:-', 'auth:sign_in:refused:invalid_credentials',
    'job:blob_reconcile:failing', 'worker:blobs_get:5xx'], 'each looked at once: %', keys;
  assert keys @> array['transfer:down:source:failOther', 'device:lostRecordings', 'device:uploadWaitingOverADay', 'sync:error:pull:57014:ServerError'],
    'the rest still to look at: %', keys;
end $$;
reset role;

-- Three more people hit the filed error and the noise: the error grows, the noise comes back to be looked at again.
insert into diag.installs (install_id, profile_id, context) values ('ui-c', 'ui-p4', '{"os":"ios"}'), ('ui-d', 'ui-p5', '{"os":"ios"}'), ('ui-e', 'ui-p6', '{"os":"ios"}');
insert into diag.records (id, install_id, delivered_by, kind, at, received_at, t)
select 'ui-g' || i || k, 'ui-' || i, 'ui-p' || (ascii(i) - 95), 'auth', now(), now(), jsonb_build_object('op', 'sign_in', 'outcome', 'refused', 'code', 'invalid_credentials')
from unnest(array['c', 'd', 'e']) i, generate_series(1, 1) k;
insert into diag.records (id, install_id, delivered_by, kind, at, received_at, t)
select 'ui-h' || i, 'ui-' || i, 'ui-p' || (ascii(i) - 95), 'error', now(), now(), '{"name":"TypeError","where":"record"}'::jsonb
from unnest(array['c', 'd', 'e']) i;
set local role service_role;
do $$
declare v jsonb; x jsonb;
begin
  v := public.ops_user_issue_watch();
  assert jsonb_array_length(v->'grew') = 1, 'the filed error grew: %', v->'grew';
  x := v->'grew'->0;
  assert x->>'key' = 'error:TypeError@record:-' and x->>'issue' = 'LAN-300' and (x->>'people')::int = 5 and (x->>'peopleBefore')::int = 2
    and (x->'platforms'->>'ios')::int = 3, 'with its new counts: %', x;
  select e into x from jsonb_array_elements(v->'look') e where e->>'key' = 'auth:sign_in:refused:invalid_credentials';
  assert x->'before'->>'verdict' = 'noise' and (x->'before'->>'people')::int = 1 and (x->>'people')::int = 4, 'the noise, back with what was decided: %', x;
  assert not exists (select 1 from jsonb_array_elements(v->'look') e where e->>'key' = 'error:TypeError@record:-'), 'a filed kind is not looked at again, it grows';

  v := public.ops_user_issues_looked(jsonb_build_object('sha', repeat('b', 40), 'runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/124/attempts/2',
    'looked', '[]'::jsonb, 'grew', jsonb_build_array(jsonb_build_object('key', 'error:TypeError@record:-', 'people', 5, 'count', 5),
      jsonb_build_object('key', 'auth:sign_in:refused:invalid_credentials', 'people', 4, 'count', 4))));
  assert v = '{"looked":0,"grew":1,"closed":0,"reopened":0}'::jsonb, 'noise does not grow, it is looked at again: %', v;
  assert jsonb_array_length(public.ops_user_issue_watch()->'grew') = 0, 'counted again from the new number';
end $$;
reset role;
do $$ begin
  assert (select grew_at is not null and people = 5 from ops.user_issues where key = 'error:TypeError@record:-'), 'the new count kept';
end $$;

-- What a run may say: a run of this repository, and kinds, verdicts and issues the table takes.
set local role service_role;
do $$ begin
  begin
    perform public.ops_user_issues_looked(jsonb_build_object('runUrl', 'https://github.com/someone/else/actions/runs/1'));
    raise exception 'another repository''s run was taken';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.ops_user_issues_looked(jsonb_build_object('runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/1',
      'looked', jsonb_build_array(jsonb_build_object('key', 'nope', 'verdict', 'noise', 'people', 1, 'count', 1))));
    raise exception 'a key that is not a kind was taken';
  exception when check_violation then null;
  end;
  begin
    perform public.ops_user_issues_looked(jsonb_build_object('runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/1',
      'looked', jsonb_build_array(jsonb_build_object('key', 'sync:refused', 'verdict', 'filed', 'people', 1, 'count', 1))));
    raise exception 'a filed kind without its issue was taken';
  exception when check_violation then null;
  end;
end $$;
reset role;

-- Noise looked at over 90 days ago is taken out by the next run.
update ops.user_issues set looked_at = now() - interval '91 days' where verdict = 'noise';
set local role service_role;
select public.ops_user_issues_looked(jsonb_build_object('runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/125'));
reset role;
do $$ begin
  assert not exists (select 1 from ops.user_issues where verdict = 'noise'), 'old noise taken out';
  assert (select count(*) from ops.user_issues) = 4, 'the filed and known ones stay';
  assert (select every from diag.job_schedule where job = 'user_issue_watch') = interval '15 minutes', 'the watch is a job whose stop shows';
  assert exists (select 1 from diag.job_schedule where job = 'user_issue_look' and every is null), 'and so is the look';
end $$;

-- The build each problem came from: a browser's commit, a phone's update or store build.
do $$ begin
  assert ops.user_issue_build('{"os":"web","runtimeVersion":"4df4afdeaf0f99"}') = 'web 4df4afdeaf0f', 'a browser''s commit';
  assert ops.user_issue_build('{"os":"ios","embedded":"yes","runtimeVersion":"2026.1030.1319","updateId":"x"}') = 'ios store build 2026.103', 'a store build';
  assert ops.user_issue_build('{"os":"android","embedded":"no","updateId":"1a2b3c4d-5e6f"}') = 'android update 1a2b3c4d', 'an update';
  assert ops.user_issue_build('{"os":"ios"}') = 'ios ?' and ops.user_issue_build('{}') = '? ?', 'unknown';
end $$;

-- Closing the loop (as the owner, to read the table between calls). Claude finds the downloads
-- already fixed by a pull request that merged after the reports; the issue LAN-300 closes in
-- Linear, opens again, and closes for good.
do $$
declare v jsonb; c timestamptz;
begin
  v := public.ops_user_issue_watch();
  assert v->'issues' @> '[{"issue":"LAN-300","state":null,"closed":false},{"issue":"LAN-12","state":null,"closed":false}]'::jsonb
    and jsonb_array_length(v->'issues') = 2, 'the issues to read in Linear';

  v := public.ops_user_issues_looked(jsonb_build_object('runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/126',
    'looked', jsonb_build_array(jsonb_build_object('key', 'transfer:down:source:failOther', 'verdict', 'fixed', 'people', 0, 'count', 3,
      'title', 'Reference audio does not download', 'fixedBy', 295, 'fixedAt', now() - interval '30 minutes', 'note', 'PR 295 merged after the reports.'))));
  assert v = '{"looked":1,"grew":0,"closed":0,"reopened":0}'::jsonb, 'one found fixed';
  assert (select verdict = 'fixed' and issue is null and closed_at is null and fixed_by = 295 from ops.user_issues where key = 'transfer:down:source:failOther'),
    'fixed with no issue';
  v := public.ops_user_issue_watch();
  assert not exists (select 1 from jsonb_array_elements(v->'look') e where e->>'key' = 'transfer:down:source:failOther'), 'not looked at again';

  -- LAN-300 closes in Linear (Live), fixed by PR 312; LAN-12 only moves along.
  v := public.ops_user_issues_looked(jsonb_build_object('runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/127',
    'states', jsonb_build_array(
      jsonb_build_object('issue', 'LAN-300', 'state', 'Live', 'closed', true, 'closedAt', now() - interval '5 minutes', 'fixedBy', 312, 'fixedAt', now() - interval '10 minutes',
        'title', 'Recordings vanish on save'),
      jsonb_build_object('issue', 'LAN-12', 'state', 'In Progress', 'closed', false))));
  assert v = '{"looked":0,"grew":0,"closed":1,"reopened":0}'::jsonb, 'one closed, one only moved';
  assert (select bool_and(verdict = 'fixed' and closed_at is not null and fixed_by = 312 and people = 0 and issue_state = 'Live') and count(*) = 2
    from ops.user_issues where issue = 'LAN-300'), 'its two kinds fixed';
  assert (select bool_and(verdict = 'known' and issue_state = 'In Progress') from ops.user_issues where issue = 'LAN-12'), 'the open one keeps its verdict';
  assert (select done_at is not null from diag.feedback where id = '0d000000-0000-4000-8000-0000000000f1'), 'what was sent about it is done';
  v := public.ops_user_issue_watch();
  assert v->'issues' @> '[{"issue":"LAN-300","state":"Live","closed":true}]'::jsonb, 'read as closed';
  assert v->'grew' = '[]'::jsonb, 'a closed issue does not grow';
  assert not exists (select 1 from jsonb_array_elements(v->'look') e where e->>'key' = 'error:TypeError@record:-'), 'nor comes back before the fix is a day old';

  -- Someone opens it again in Linear, then it closes again with no pull request named.
  v := public.ops_user_issues_looked(jsonb_build_object('runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/128',
    'states', jsonb_build_array(jsonb_build_object('issue', 'LAN-300', 'state', 'Todo', 'closed', false))));
  assert v = '{"looked":0,"grew":0,"closed":0,"reopened":1}'::jsonb, 'reopened';
  assert (select bool_and(verdict = 'filed' and closed_at is null and fixed_by is null and fixed_at is null and issue_state = 'Todo')
    from ops.user_issues where issue = 'LAN-300'), 'filed again';
  perform public.ops_user_issues_looked(jsonb_build_object('runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/129',
    'states', jsonb_build_array(jsonb_build_object('issue', 'LAN-300', 'state', 'Live', 'closed', true, 'closedAt', now() - interval '2 minutes'))));
  select closed_at into c from ops.user_issues where key = 'error:TypeError@record:-';
  assert (select fixed_by is null and fixed_at = c from ops.user_issues where key = 'error:TypeError@record:-'), 'no PR named: fixed when it closed';

  -- A fix must say when.
  begin
    perform public.ops_user_issues_looked(jsonb_build_object('runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/1',
      'looked', jsonb_build_array(jsonb_build_object('key', 'device:lostRecordings', 'verdict', 'fixed', 'people', 0, 'count', 1))));
    raise exception 'a fix without its time was taken';
  exception when check_violation then null;
  end;
end $$;

-- Two days on: the closed error comes back with the people after the fix; one person more on the
-- fixed downloads is not enough, two are, with their builds.
update ops.user_issues set fixed_at = now() - interval '2 days' where key in ('transfer:down:source:failOther', 'error:TypeError@record:-');
do $$
declare v jsonb; x jsonb;
begin
  v := public.ops_user_issue_watch();
  assert not exists (select 1 from jsonb_array_elements(v->'look') e where e->>'key' = 'transfer:down:source:failOther'), 'one person after the fix is not enough';
  select e into x from jsonb_array_elements(v->'look') e where e->>'key' = 'error:TypeError@record:-';
  assert (x->>'peopleAfterFix')::int = 5 and x->'before'->>'verdict' = 'fixed' and x->'before'->>'issue' = 'LAN-300' and x->'before'->>'state' = 'Live'
    and x->'before'->>'closedAt' is not null, 'the closed error, back with what was decided';
end $$;
insert into diag.installs (install_id, profile_id, context) values ('ui-f', 'ui-p7', '{"os":"web","runtimeVersion":"0123456789abcdef"}');
insert into diag.records (id, install_id, delivered_by, kind, at, received_at, n, t)
values ('ui-j1', 'ui-f', 'ui-p7', 'transfer', now(), now(), '{"count":2,"failOther":2}', '{"dir":"down","src":"source"}');
do $$
declare v jsonb; x jsonb; c timestamptz;
begin
  v := public.ops_user_issue_watch();
  select e into x from jsonb_array_elements(v->'look') e where e->>'key' = 'transfer:down:source:failOther';
  assert (x->>'peopleAfterFix')::int = 2 and x->'before'->>'verdict' = 'fixed' and (x->'before'->>'fixedBy')::int = 295 and x->'before'->>'issue' is null
    and x->'apps' @> '[{"app":"web 0123456789ab","installs":1}]'::jsonb and x->'platforms' = '{"android":1,"web":1}'::jsonb, 'back after the fix';

  -- Claude: the error's people ran builds from before the fix. It stays closed, counted from 5.
  select closed_at into c from ops.user_issues where key = 'error:TypeError@record:-';
  v := public.ops_user_issues_looked(jsonb_build_object('runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/130',
    'looked', jsonb_build_array(jsonb_build_object('key', 'error:TypeError@record:-', 'verdict', 'fixed', 'issue', 'LAN-300',
      'issueUrl', 'https://linear.app/x/issue/LAN-300', 'people', 5, 'count', 5, 'fixedBy', 312, 'fixedAt', now() - interval '2 days'))));
  assert (select verdict = 'fixed' and closed_at = c and people = 5 and issue_state = 'Live' from ops.user_issues where key = 'error:TypeError@record:-'),
    'closed as it was';
  v := public.ops_user_issue_watch();
  assert not exists (select 1 from jsonb_array_elements(v->'look') e where e->>'key' = 'error:TypeError@record:-'), 'not again until 10 after the fix';
end $$;

-- The ops dashboard's list: one row per issue, open first, with the PR that fixed it; noise left out.
grant diag_reader to postgres;
do $$
declare v jsonb; x jsonb;
begin
  set local role diag_reader;
  v := diag.ops_user_issues();
  reset role;
  assert (v->>'open')::int = 1 and (v->>'closed')::int = 1 and (v->>'fixed')::int = 1, 'one of each';
  assert v->'issues'->0->>'issue' = 'LAN-12' and v->'issues'->0->>'state' = 'In Progress' and jsonb_array_length(v->'issues'->0->'keys') = 2, 'open first';
  select e into x from jsonb_array_elements(v->'issues') e where e->>'issue' = 'LAN-300';
  assert x->>'verdict' = 'fixed' and x->>'state' = 'Live' and (x->>'fixedBy')::int = 312 and x->>'closedAt' is not null
    and x->>'issueUrl' = 'https://linear.app/x/issue/LAN-300' and x->>'title' = 'Recordings vanish on save', 'the closed one, with its title in Linear';
  select e into x from jsonb_array_elements(v->'issues') e where e->'keys' = '["transfer:down:source:failOther"]'::jsonb;
  assert x->>'issue' is null and (x->>'fixedBy')::int = 295 and x->>'title' = 'Reference audio does not download', 'found fixed';
  assert jsonb_array_length(v->'issues') = 3 and v::text not like '%ui-p%' and v::text not like '%secret%', 'no noise, never who';
end $$;

-- Kinds found fixed are taken out 90 days after they were looked at, like noise.
update ops.user_issues set looked_at = now() - interval '91 days' where key = 'transfer:down:source:failOther';
select public.ops_user_issues_looked(jsonb_build_object('runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/131')) is not null as looked;
do $$ begin
  assert not exists (select 1 from ops.user_issues where key = 'transfer:down:source:failOther'), 'old fixed taken out';
end $$;

-- Nobody else reads or writes it.
do $$ begin
  set local role authenticated;
  perform public.ops_user_issue_watch();
  raise exception 'a signed-in person read the watch';
exception when insufficient_privilege then null;
end $$;
reset role;
do $$ begin
  set local role anon;
  perform public.ops_user_issues_looked('{}'::jsonb);
  raise exception 'anyone wrote to the watch';
exception when insufficient_privilege then null;
end $$;
reset role;
do $$ begin
  set local role diag_reader;
  perform 1 from ops.user_issues;
  raise exception 'diag_reader read the watch''s table';
exception when insufficient_privilege then null;
end $$;
reset role;

rollback;
