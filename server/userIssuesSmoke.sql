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
  -- Downloads of reference audio failing, besides offline ones; a renewal the server failed; a sign-in that went fine;
  -- a wrong password, no fault of the server or the app (diag.sign_in_class), not handed over.
  ('ui-5', 'ui-a', 'ui-p1', 'ui-org', 'transfer', now(), now() - interval '1 hour', '{"count":5,"failOther":3,"failOffline":9}', '{"dir":"down","src":"source"}', null),
  ('ui-6', 'ui-a', 'ui-p1', null, 'auth', now(), now() - interval '1 hour', '{}', '{"op":"sign_in","outcome":"ok"}', null),
  ('ui-7', 'ui-a', 'ui-p1', null, 'auth', now(), now() - interval '1 hour', '{}', '{"op":"renew","outcome":"server","code":"unexpected_failure"}', null),
  ('ui-7b', 'ui-b', 'ui-p2', null, 'auth', now(), now() - interval '1 hour', '{}', '{"op":"sign_in","outcome":"refused","code":"invalid_credentials"}', null),
  -- An expected failure seen only 3 times: counted, not handed over.
  ('ui-8', 'ui-b', 'ui-p2', null, 'expected', now(), now() - interval '1 hour', '{"count":3}', '{"where":"mic","name":"Refused","code":"-"}', null),
  -- Recordings lost, and one waiting over a day to upload; a download wanted for half an hour is fine.
  ('ui-9', 'ui-a', 'ui-p1', null, 'device', now(), now() - interval '1 hour', '{"lostRecordings":2,"oldestUnsentMin":2000,"wantedStuckMin":30}', '{}', null),
  ('ui-10', 'ui-b', 'ui-p2', 'ui-org', 'sync', now(), now() - interval '1 hour', '{}', '{"outcome":"error","phase":"pull","code":"57014","error":"ServerError"}', null),
  -- Older than a week: gone; three days old and quiet since, never looked at: handed over, last.
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
  assert keys @> array['transfer:down:source:failOther', 'auth:renew:server:unexpected_failure', 'device:lostRecordings',
    'device:uploadWaitingOverADay', 'sync:error:pull:57014:ServerError'], 'the other kinds: %', keys;
  assert keys[array_length(keys, 1)] = 'error:Quiet@x:-', 'a kind never looked at, from days ago, last: %', keys;
  assert not keys && array['transfer:down:source:failOffline', 'device:downloadWantedOverADay', 'expected:mic:Refused:-', 'error:Old@x:-',
    'worker:reports:5xx', 'auth:sign_in:ok:-', 'auth:sign_in:refused:invalid_credentials'], 'nothing offline, short, under ten, old, fine or no fault: %', keys;
  assert (v->>'waiting')::int = 0, 'nothing waits: %', v->>'waiting';
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
      jsonb_build_object('key', 'error:TypeError@record:-', 'verdict', 'filed', 'issue', 'LAN-300', 'issueUrl', 'https://linear.app/x/issue/LAN-300', 'people', 2, 'count', 2,
        'context', 'A person saves a recording.', 'problem', 'The recording is gone.', 'known', 'The phone saw the save start, not its end.', 'solution', 'Keep the file until the save ends.'),
      jsonb_build_object('key', 'auth:renew:server:unexpected_failure', 'verdict', 'noise', 'people', 1, 'count', 1, 'note', 'One server failure, once.'),
      jsonb_build_object('key', 'job:blob_reconcile:failing', 'verdict', 'known', 'issue', 'LAN-12', 'issueUrl', 'https://linear.app/x/issue/LAN-12', 'people', 0, 'count', 3),
      jsonb_build_object('key', 'worker:blobs_get:5xx', 'verdict', 'known', 'issue', 'LAN-12', 'issueUrl', 'https://linear.app/x/issue/LAN-12', 'people', 0, 'count', 6)),
    'grew', '[]'::jsonb));
  assert v = '{"looked":5,"grew":0,"closed":0,"reopened":0}'::jsonb, 'five looked at: %', v;

  v := public.ops_user_issue_watch();
  select array_agg(e->>'key') into keys from jsonb_array_elements(v->'look') e;
  assert not keys && array['feedback:0d000000-0000-4000-8000-0000000000f1', 'error:TypeError@record:-', 'auth:renew:server:unexpected_failure',
    'job:blob_reconcile:failing', 'worker:blobs_get:5xx'], 'each looked at once: %', keys;
  assert keys @> array['transfer:down:source:failOther', 'device:lostRecordings', 'device:uploadWaitingOverADay', 'sync:error:pull:57014:ServerError'],
    'the rest still to look at: %', keys;
end $$;
reset role;

-- Three more people hit the filed error and the noise: the error grows, the noise comes back to be looked at again.
insert into diag.installs (install_id, profile_id, context) values ('ui-c', 'ui-p4', '{"os":"ios"}'), ('ui-d', 'ui-p5', '{"os":"ios"}'), ('ui-e', 'ui-p6', '{"os":"ios"}');
insert into diag.records (id, install_id, delivered_by, kind, at, received_at, t)
select 'ui-g' || i || k, 'ui-' || i, 'ui-p' || (ascii(i) - 95), 'auth', now(), now(), jsonb_build_object('op', 'renew', 'outcome', 'server', 'code', 'unexpected_failure')
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
  select e into x from jsonb_array_elements(v->'look') e where e->>'key' = 'auth:renew:server:unexpected_failure';
  assert x->'before'->>'verdict' = 'noise' and (x->'before'->>'people')::int = 1 and (x->>'people')::int = 4, 'the noise, back with what was decided: %', x;
  assert not exists (select 1 from jsonb_array_elements(v->'look') e where e->>'key' = 'error:TypeError@record:-'), 'a filed kind is not looked at again, it grows';

  v := public.ops_user_issues_looked(jsonb_build_object('sha', repeat('b', 40), 'runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/124/attempts/2',
    'looked', '[]'::jsonb, 'grew', jsonb_build_array(jsonb_build_object('key', 'error:TypeError@record:-', 'people', 5, 'count', 5),
      jsonb_build_object('key', 'auth:renew:server:unexpected_failure', 'people', 4, 'count', 4))));
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
  -- Its three lines for the card are those one of its kinds was filed with, kept through the looks since.
  assert x->>'context' = 'A person saves a recording.' and x->>'problem' = 'The recording is gone.' and x->>'known' = 'The phone saw the save start, not its end.' and x->>'solution' = 'Keep the file until the save ends.',
    'the lines of its card';
  assert (select count(*) = 1 from ops.user_issues where issue = 'LAN-300' and context is not null), 'only the kind that was sent lines holds them';
  select e into x from jsonb_array_elements(v->'issues') e where e->'keys' = '["transfer:down:source:failOther"]'::jsonb;
  assert x->>'issue' is null and (x->>'fixedBy')::int = 295 and x->>'title' = 'Reference audio does not download' and x->>'context' is null, 'found fixed, with no lines';
  assert jsonb_array_length(v->'issues') = 3 and v::text not like '%ui-p%' and v::text not like '%secret%', 'no noise, never who';
end $$;

-- An admin's instruction on an open issue (migration *_user_issue_notes.sql): kept for the watch, taken by a run
-- at most twice, answered once, and shown on the ops dashboard without who wrote it.
do $$
declare
  v jsonb; n jsonb; a text; b text; c text;
  run text := 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/140';
  admin uuid := '0d000000-0000-0000-0000-0000000000aa';
begin
  assert public.ops_user_issue_instruct('LAN-300', 'Fix it.', admin) = 'not_found', 'not on a closed issue';
  assert public.ops_user_issue_instruct('LAN-999', 'Fix it.', admin) = 'not_found', 'nor on one the watch does not have';
  -- An issue a line of the dashboard names itself (a nightly test's): the app Worker says so.
  c := public.ops_user_issue_instruct('LAN-998', 'Find the cause.', admin, true);
  assert (select named from ops.user_issue_notes where id = c::uuid), 'kept as named';
  assert public.ops_user_issue_notes_waiting()->0->>'issue' = 'LAN-998', 'the watch takes it';
  delete from ops.user_issue_notes where id = c::uuid;
  a := public.ops_user_issue_instruct('LAN-12', '  Wait for the passage first.  ', admin);
  b := public.ops_user_issue_instruct('LAN-12', 'Why 30 seconds?', admin);
  assert a ~ '^[0-9a-f-]{36}$' and b ~ '^[0-9a-f-]{36}$', 'kept, with an id';
  -- One transaction gives every row the same time: set them apart, as minutes do in production.
  update ops.user_issue_notes set at = now() - interval '2 minutes' where id = a::uuid;
  update ops.user_issue_notes set at = now() - interval '1 minute' where id = b::uuid;
  v := public.ops_user_issue_notes_waiting();
  assert jsonb_array_length(v) = 1 and v->0->>'issue' = 'LAN-12' and v->0->'ids' = jsonb_build_array(a, b), 'the watch is handed the issue with its notes, the oldest first';
  v := public.ops_user_issue_notes('LAN-12');
  assert jsonb_array_length(v->'waiting') = 2 and v->'waiting'->0->>'text' = 'Wait for the passage first.' and jsonb_array_length(v->'before') = 0, 'the fix run reads the words';

  -- A run takes both and answers the first; an answer stays.
  v := public.ops_user_issue_notes_done(jsonb_build_object('runUrl', run, 'notes', jsonb_build_array(
    jsonb_build_object('id', a, 'taken', true), jsonb_build_object('id', b, 'taken', true))));
  assert v = '{"taken": 2, "answered": 0}'::jsonb, 'taken';
  v := public.ops_user_issue_notes_done(jsonb_build_object('runUrl', run, 'notes', jsonb_build_array(
    jsonb_build_object('id', a, 'taken', false, 'result', 'changed', 'answer', 'I moved the wait.', 'pr', 512))));
  assert v = '{"taken": 0, "answered": 1}'::jsonb, 'answered';
  v := public.ops_user_issue_notes_done(jsonb_build_object('runUrl', run, 'notes', jsonb_build_array(
    jsonb_build_object('id', a, 'taken', false, 'result', 'none'), jsonb_build_object('id', a, 'taken', true))));
  assert v = '{"taken": 0, "answered": 0}'::jsonb
    and (select result = 'changed' and pr = 512 and tries = 1 and run_url = run from ops.user_issue_notes where id = a::uuid), 'an answer stays';

  -- The run that took the second stopped: it comes back once, and not a third time.
  assert public.ops_user_issue_notes_waiting()->0->'ids' = jsonb_build_array(b), 'the other comes back';
  perform public.ops_user_issue_notes_done(jsonb_build_object('runUrl', run, 'notes', jsonb_build_array(jsonb_build_object('id', b, 'taken', true))));
  assert jsonb_array_length(public.ops_user_issue_notes_waiting()) = 0, 'and not a third time';
  v := public.ops_user_issue_notes('LAN-12');
  assert jsonb_array_length(v->'waiting') = 1 and v->'before'->0->>'answer' = 'I moved the wait.' and v->'before'->0->>'result' = 'changed',
    'the run that has it still reads it, with what was said before';

  begin
    perform public.ops_user_issue_notes_done(jsonb_build_object('runUrl', 'https://github.com/someone/else/actions/runs/1'));
    assert false, 'another repository''s run got in';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.ops_user_issue_notes_done(jsonb_build_object('runUrl', run, 'notes', jsonb_build_array(
      jsonb_build_object('id', b, 'taken', false, 'result', 'merged'))));
    assert false, 'a result off the list got in';
  exception when check_violation then null;
  end;

  -- Three that wait fill an issue.
  perform public.ops_user_issue_instruct('LAN-12', 'One.', admin), public.ops_user_issue_instruct('LAN-12', 'Two.', admin), public.ops_user_issue_instruct('LAN-12', 'Three.', admin);
  assert public.ops_user_issue_instruct('LAN-12', 'Four.', admin) = 'full', 'three wait already';

  -- The dashboard: by issue, the oldest first, each with its state; never who wrote it.
  set local role diag_reader;
  v := diag.ops_user_issue_notes();
  reset role;
  n := v->'LAN-12';
  assert jsonb_array_length(n) = 5 and not v ? 'LAN-300', 'the last five of each issue that has any';
  assert n->0->>'state' = 'answered' and n->0->>'answer' = 'I moved the wait.' and (n->0->>'pr')::int = 512 and n->0->>'result' = 'changed', 'the answer under the words';
  assert n->1->>'state' = 'working' and n->1->>'runUrl' = run and n->2->>'state' = 'waiting', 'a run has the second; the third waits';
  assert v::text not like '%' || admin::text || '%', 'never who';
  update ops.user_issue_notes set taken_at = now() - interval '4 hours' where id = b::uuid;
  assert diag.ops_user_issue_notes()->'LAN-12'->1->>'state' = 'stopped', 'two runs took it and neither answered';

  assert not has_function_privilege('authenticated', 'public.ops_user_issue_instruct(text, text, uuid, boolean)', 'execute')
    and not has_function_privilege('anon', 'public.ops_user_issue_notes(text)', 'execute')
    and not has_function_privilege('authenticated', 'public.ops_user_issue_notes_done(jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.ops_user_issue_notes_waiting()', 'execute'), 'only the service role';
  perform public.ops_record_action(admin, 'user_issue_note', 'LAN-12', 'ok', 'note:' || a);
end $$;

-- The agent team's record of a fix (migration *_user_issue_fix_record.sql): one for each issue, the
-- newest; a later record that sends no words keeps the reasoning; the dashboard reads it with the
-- pictures that came with the problem.
do $$
declare
  v jsonb;
  run text := 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/150';
begin
  assert public.ops_user_issue_fixes_done(jsonb_build_object('runUrl', run)) = 0, 'a run with none';
  assert public.ops_user_issue_fixes_done(jsonb_build_object('runUrl', run, 'fixes', jsonb_build_array(
    jsonb_build_object('issue', 'LAN-300', 'decision', 'merge', 'reason', null, 'why', 'The change does what it says.', 'pr', 560, 'verdict', 'fix',
      'model', 'sonnet', 'effort', 'medium', 'summary', 'Saves the part before closing.', 'cause', 'save() closes the file first.',
      'proof', 'recorder.test.ts fails without it.', 'review', 'The change does what it says.', 'twins', null,
      'before', encode('\xffd8ffe000'::bytea, 'base64'), 'after', encode('\xffd8ffe001'::bytea, 'base64')),
    jsonb_build_object('issue', 'LAN-12', 'decision', 'none', 'reason', 'unconfirmed', 'why', 'The cause is not proven.', 'pr', null, 'verdict', 'unconfirmed')))) = 2, 'two kept';
  v := diag.ops_user_issue_fixes();
  assert v->'LAN-300'->>'decision' = 'merge' and v->'LAN-300'->>'pr' = '560' and v->'LAN-300'->>'model' = 'sonnet' and v->'LAN-300'->>'runUrl' = run, 'as sent: %', v->'LAN-300';
  assert v->'LAN-300'->'pictures' = jsonb_build_array(jsonb_build_object('id', '0d000000-0000-4000-8000-0000000000f1', 'screenshot', true, 'picture', false)),
    'with the screenshot that came with the problem: %', v->'LAN-300'->'pictures';
  assert (v->'LAN-300'->>'beforeAfter')::boolean and not (v->'LAN-12'->>'beforeAfter')::boolean, 'which have the two pictures';
  assert diag.ops_user_issue_fix_picture('LAN-300', 'before') = '\xffd8ffe000'::bytea and diag.ops_user_issue_fix_picture('LAN-300', 'after') = '\xffd8ffe001'::bytea
    and diag.ops_user_issue_fix_picture('LAN-300', 'other') is null and diag.ops_user_issue_fix_picture('LAN-12', 'before') is null, 'each picture by its name';
  assert v->'LAN-12'->>'decision' = 'none' and v->'LAN-12'->'pictures' = '[]'::jsonb and v->'LAN-12'->>'summary' is null, 'no change, no pictures';
  assert v::text not like '%ui-p1%' and v::text not like '%My recording vanished%', 'never who, never their words';
  -- Its checks failed: the job that follows it sends only the decision, and the reasoning stays.
  perform public.ops_user_issue_fixes_done(jsonb_build_object('runUrl', run, 'fixes', jsonb_build_array(
    jsonb_build_object('issue', 'LAN-300', 'decision', 'waits', 'reason', 'stalled', 'why', 'Its checks failed (gate: failure).', 'pr', 560))));
  v := diag.ops_user_issue_fixes()->'LAN-300';
  assert v->>'decision' = 'waits' and v->>'reason' = 'stalled' and v->>'cause' = 'save() closes the file first.' and v->>'verdict' = 'fix', 'the decision changes, the reasoning stays: %', v;
  assert (v->>'beforeAfter')::boolean, 'and its pictures';
  -- Another pull request for the issue: the pictures of the first one go.
  perform public.ops_user_issue_fixes_done(jsonb_build_object('runUrl', run, 'fixes', jsonb_build_array(
    jsonb_build_object('issue', 'LAN-300', 'decision', 'waits', 'reason', 'review', 'why', 'A second fix.', 'pr', 561))));
  assert not (diag.ops_user_issue_fixes()->'LAN-300'->>'beforeAfter')::boolean, 'pictures are of one pull request';
  begin
    perform public.ops_user_issue_fixes_done(jsonb_build_object('runUrl', run, 'fixes', jsonb_build_array(jsonb_build_object('issue', 'LAN-300', 'decision', 'merge', 'reason', 'mode', 'pr', 560))));
    assert false, 'a merge with a reason to wait was kept';
  exception when check_violation then null;
  end;
  begin
    perform public.ops_user_issue_fixes_done(jsonb_build_object('runUrl', 'https://github.com/someone/else/actions/runs/1', 'fixes', '[]'::jsonb));
    assert false, 'a run of another repository was taken';
  exception when sqlstate '22023' then null;
  end;
  assert not has_function_privilege('authenticated', 'public.ops_user_issue_fixes_done(jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.ops_user_issue_fixes_done(jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'diag.ops_user_issue_fixes()', 'execute')
    and not has_function_privilege('authenticated', 'diag.ops_user_issue_fix_picture(text, text)', 'execute'), 'only the service role writes, only the dashboard reads';
end $$;

-- Each new issue's diagram (migration *_user_issue_diagrams.sql): one for each issue, the newest.
do $$
declare
  run constant text := 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/142';
  steps jsonb := jsonb_build_array(jsonb_build_object('where', 'Person', 'text', 'Taps Play.', 'wrong', false), jsonb_build_object('where', 'Browser', 'text', 'The request is refused.', 'wrong', true));
begin
  assert public.ops_user_issue_diagrams_done(jsonb_build_object('runUrl', run)) = 0, 'a run with none';
  assert public.ops_user_issue_diagrams_done(jsonb_build_object('runUrl', run, 'diagrams', jsonb_build_array(jsonb_build_object('issue', 'LAN-320', 'steps', steps)))) = 1, 'kept';
  perform public.ops_user_issue_diagrams_done(jsonb_build_object('runUrl', run, 'diagrams', jsonb_build_array(jsonb_build_object('issue', 'LAN-320', 'steps', steps || steps))));
  assert jsonb_array_length(diag.ops_user_issue_diagrams()->'LAN-320') = 4, 'the newest diagram of an issue';
  begin
    perform public.ops_user_issue_diagrams_done(jsonb_build_object('runUrl', run, 'diagrams', jsonb_build_array(jsonb_build_object('issue', 'LAN-321', 'steps', steps->0))));
    assert false, 'a diagram that is no list was kept';
  exception when check_violation then null;
  end;
  assert not has_function_privilege('authenticated', 'public.ops_user_issue_diagrams_done(jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'diag.ops_user_issue_diagrams()', 'execute'), 'only the service role writes, only the dashboard reads';
end $$;

-- A picture of the screen where the problem shows, for an issue with no change: `before` alone.
do $$
declare
  run constant text := 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/143';
begin
  perform public.ops_user_issue_fixes_done(jsonb_build_object('runUrl', run, 'fixes', jsonb_build_array(
    jsonb_build_object('issue', 'LAN-330', 'decision', 'none', 'reason', 'decision', 'before', encode('\xffd8ffe000'::bytea, 'base64')))));
  assert (diag.ops_user_issue_fixes()->'LAN-330'->>'before')::boolean and not (diag.ops_user_issue_fixes()->'LAN-330'->>'beforeAfter')::boolean
    and diag.ops_user_issue_fix_picture('LAN-330', 'before') = '\xffd8ffe000'::bytea and diag.ops_user_issue_fix_picture('LAN-330', 'after') is null, 'one picture, of the problem';
  begin
    perform public.ops_user_issue_fixes_done(jsonb_build_object('runUrl', run, 'fixes', jsonb_build_array(
      jsonb_build_object('issue', 'LAN-331', 'decision', 'none', 'reason', 'decision', 'after', encode('\xffd8ffe000'::bytea, 'base64')))));
    assert false, 'a picture after the fix with none before it was kept';
  exception when check_violation then null;
  end;
end $$;

-- What the research team found (migration *_agent_research.sql): one record for each tag; an item found
-- again keeps its first time, its issue and when it went to the fix team.
do $$
declare
  run constant text := 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/141';
  v jsonb;
  item jsonb := jsonb_build_object('tag', 'fixed-width-label', 'title', 'Words are cut off on the invite button', 'like', 'LAN-300',
    'found', 'The label has a fixed width.', 'why', 'A long word shows as half a word.', 'places', jsonb_build_array('apps/mobile/src/screens/invite.tsx:142'),
    'decision', 'recommend', 'action', 'fix', 'issue', 'LAN-310', 'issueUrl', 'https://linear.app/frontierrandd/issue/LAN-310/x');
begin
  assert public.ops_research_done(jsonb_build_object('runUrl', run)) = jsonb_build_object('research', 0, 'handed', 0, 'report', 0), 'a run with none';
  assert public.ops_research_done(jsonb_build_object('runUrl', run, 'research', jsonb_build_array(item,
    jsonb_build_object('tag', 'not-proven', 'title', 'Maybe the same', 'found', 'It can be.', 'why', 'Not shown.', 'decision', 'watch', 'action', 'none'))))
    = jsonb_build_object('research', 2, 'handed', 0, 'report', 0), 'two items kept';
  assert public.ops_research_waiting() = '["LAN-310"]'::jsonb, 'the recommended fix waits for the fix team';
  v := public.ops_research_context();
  assert jsonb_array_length(v->'items') = 2 and jsonb_typeof(v->'issues') = 'array', 'the lead reads the items of earlier runs';
  -- Handed to the fix team one time; found again without its issue, it keeps the issue.
  assert public.ops_research_done(jsonb_build_object('runUrl', run, 'handed', jsonb_build_array('LAN-310', 'LAN-999'))) = jsonb_build_object('research', 0, 'handed', 1, 'report', 0), 'handed';
  assert public.ops_research_waiting() = '[]'::jsonb, 'not handed twice';
  perform public.ops_research_done(jsonb_build_object('runUrl', run, 'research', jsonb_build_array(item - 'issue' - 'issueUrl' || jsonb_build_object('title', 'Words are cut off'))));
  v := (select x from jsonb_array_elements(diag.ops_research()->'items') x where x->>'tag' = 'fixed-width-label');
  assert v->>'issue' = 'LAN-310' and v->>'title' = 'Words are cut off' and v->>'handedAt' is not null and v->'places'->>0 = 'apps/mobile/src/screens/invite.tsx:142'
    and v->>'like' = 'LAN-300' and v->>'runUrl' = run, 'found again: new words, the same issue';
  -- An admin tells Claude what to do with a recommended item, by its issue; not with one the research does not have.
  declare n text := public.ops_user_issue_instruct('LAN-310', 'Fix the second button too.', '0d000000-0000-0000-0000-0000000000aa');
  begin
    assert n ~ '^[0-9a-f-]{36}$', 'an instruction on a research item is kept';
    assert exists (select 1 from jsonb_array_elements(public.ops_user_issue_notes_waiting()) w where w->>'issue' = 'LAN-310'), 'and the watch is handed its issue';
    delete from ops.user_issue_notes where id = n::uuid;
  end;
  assert public.ops_user_issue_instruct('LAN-998', 'Fix it.', '0d000000-0000-0000-0000-0000000000aa') = 'not_found', 'not on an issue nobody has';
  -- The mistake as a diagram: kept with the item, and replaced when it is found again.
  perform public.ops_research_done(jsonb_build_object('runUrl', run, 'research', jsonb_build_array(item || jsonb_build_object('steps', jsonb_build_array(
    jsonb_build_object('where', 'Person', 'text', 'Opens the invite screen.', 'wrong', false), jsonb_build_object('where', 'Phone', 'text', 'Draws the button 96 wide.', 'wrong', true))))));
  v := (select x from jsonb_array_elements(diag.ops_research()->'items') x where x->>'tag' = 'fixed-width-label');
  assert jsonb_array_length(v->'steps') = 2 and (v->'steps'->1->>'wrong')::boolean, 'the item keeps its diagram';
  assert diag.ops_research()->>'lastAt' is not null and jsonb_array_length(diag.ops_research()->'items') = 2, 'the dashboard reads both';
  -- The team that looks ahead (migration *_research_team_reports.sql): an item with its package, proof and choice,
  -- and the day's report, which a second run of the same day replaces.
  assert public.ops_research_done(jsonb_build_object('runUrl', run || '/attempts/2', 'research', jsonb_build_array(jsonb_build_object(
      'tag', 'hono-cookie-hole', 'title', 'A hole in hono', 'found', 'hono 4.6.1 reads cookies slowly.', 'why', 'One person can stop the Worker.',
      'places', '[]'::jsonb, 'decision', 'recommend', 'action', 'ask', 'beat', 'security', 'kind', 'vulnerability', 'severity', 'high',
      'links', jsonb_build_array('https://github.com/advisories/GHSA-aaaa'), 'package', 'hono', 'from', '4.6.1', 'to', '4.6.5', 'deadline', '2026-12-31',
      'ask', jsonb_build_object('why', 'A package change waits.', 'choices', jsonb_build_array(jsonb_build_object('label', 'Upgrade'), jsonb_build_object('label', 'Wait'))))),
    'report', jsonb_build_object('day', current_date::text, 'headline', 'One hole needs an upgrade.', 'summary', '[]'::jsonb, 'beats', '[]'::jsonb, 'lead', 'ok')))
    = jsonb_build_object('research', 1, 'handed', 0, 'report', 1), 'an item and a report kept';
  perform public.ops_research_done(jsonb_build_object('runUrl', run || '/attempts/2', 'report', jsonb_build_object('day', current_date::text, 'headline', 'Replaced.', 'lead', 'ok')));
  v := diag.ops_research();
  assert jsonb_array_length(v->'reports') = 1 and v->'reports'->0->>'headline' = 'Replaced.' and v->'reports'->0->>'day' = current_date::text
   , 'the report of a run, replaced by its second';
  v := (select x from jsonb_array_elements(diag.ops_research()->'items') x where x->>'tag' = 'hono-cookie-hole');
  assert v->>'beat' = 'security' and v->>'package' = 'hono' and v->>'to' = '4.6.5' and v->>'deadline' = '2026-12-31'
    and jsonb_array_length(v->'ask'->'choices') = 2 and v->'links'->>0 = 'https://github.com/advisories/GHSA-aaaa', 'the item keeps what the team found';
  assert public.ops_research_context()->'last'->>'headline' = 'Replaced.', 'the leads read the last headline';
  begin
    perform public.ops_research_done(jsonb_build_object('runUrl', run, 'research', jsonb_build_array(item || jsonb_build_object('tag', 'odd-beat', 'beat', 'gossip'))));
    assert false, 'an odd beat was kept';
  exception when check_violation then null;
  end;
  begin
    perform public.ops_research_done(jsonb_build_object('runUrl', run, 'research', jsonb_build_array(item || jsonb_build_object('tag', 'Not A Tag'))));
    assert false, 'an odd tag was kept';
  exception when check_violation then null;
  end;
  begin
    perform public.ops_research_done(jsonb_build_object('runUrl', 'https://github.com/someone/else/actions/runs/1'));
    assert false, 'a run of another repository was taken';
  exception when sqlstate '22023' then null;
  end;
  assert not has_function_privilege('authenticated', 'public.ops_research_done(jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.ops_research_context()', 'execute')
    and not has_function_privilege('authenticated', 'public.ops_research_waiting()', 'execute')
    and not has_function_privilege('authenticated', 'diag.ops_research()', 'execute')
    and not has_table_privilege('authenticated', 'ops.research_reports', 'select'), 'only the service role writes, only the dashboard reads';
end $$;

-- Kinds found fixed are taken out 90 days after they were looked at, like noise.
update ops.user_issues set looked_at = now() - interval '91 days' where key = 'transfer:down:source:failOther';
select public.ops_user_issues_looked(jsonb_build_object('runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/131')) is not null as looked;
do $$ begin
  assert not exists (select 1 from ops.user_issues where key = 'transfer:down:source:failOther'), 'old fixed taken out';
end $$;

-- What Claude may look at (migration *_user_issue_evidence.sql): a problem's screenshot and
-- picture, and its phone's build and records around it, never who sent it or which organization.
update diag.feedback set picture = '\xffd8ffe0'::bytea where id = '0d000000-0000-4000-8000-0000000000f1';
insert into diag.feedback (id, created_at, profile_id, kind, body, install_id, screenshot) values
  ('0d000000-0000-4000-8000-0000000000f5', now() - interval '40 days', 'ui-p2', 'bug', 'Long ago', 'ui-b', '\xffd8ff'::bytea),
  ('0d000000-0000-4000-8000-0000000000f6', now(), 'ui-p2', 'idea', 'A picture of an idea', 'ui-b', '\xffd8ff'::bytea);
insert into diag.records (id, install_id, delivered_by, org_id, stream_id, kind, at, received_at, n, t) values
  ('ui-q1', 'ui-a', 'ui-p1', 'ui-org', 'ui-lang', 'transfer', now() - interval '10 minutes', now(), '{"count":4,"bytes":800000,"ms":48000,"maxMs":30000}', '{"dir":"down","src":"lang"}'),
  ('ui-q2', 'ui-a', 'ui-p1', 'ui-org', '_org', 'sync', now() - interval '20 minutes', now(), '{"ms":900}', '{"outcome":"ok","phase":"pull"}'),
  ('ui-q3', 'ui-a', 'ui-p1', null, null, 'audio', now() - interval '4 days', now(), '{"plays":1}', '{}');
-- Judged by the watch, so its screenshot stays readable after 30 days.
update diag.feedback set created_at = now() - interval '40 days' where id = '0d000000-0000-4000-8000-0000000000f1';
set local role service_role;
do $$
declare v jsonb; x jsonb;
begin
  v := public.ops_user_issue_media('0d000000-0000-4000-8000-0000000000f1');
  assert decode(v->>'screenshot', 'base64') = '\xffd8ff'::bytea and decode(v->>'picture', 'base64') = '\xffd8ffe0'::bytea, 'the screenshot and the picture: %', v;
  assert v::text not like '%Secret%' and v::text not like '%secret@%' and v::text not like '%ui-p1%', 'never who';
  assert public.ops_user_issue_media('0d000000-0000-4000-8000-0000000000f5') is null, 'not a problem from long ago the watch never judged';
  assert public.ops_user_issue_media('0d000000-0000-4000-8000-0000000000f6') is null, 'not an idea';
  assert public.ops_user_issue_media('0d000000-0000-4000-8000-0000000000ff') is null, 'nothing for a problem that is not there';

  v := public.ops_user_issue_phone('ui-a', now());
  assert v->>'installId' = 'ui-a' and v->>'build' = 'android ?' and v->'phone' = '{"os":"android","appVersion":"2026.1030.1319","channel":"production"}'::jsonb,
    'the phone and its build: %', v->'phone';
  assert jsonb_array_length(v->'records') = 8, 'the records of three days, not older: %', jsonb_array_length(v->'records');
  assert (select bool_and((a->>'at')::timestamptz >= (b->>'at')::timestamptz)
    from jsonb_array_elements(v->'records') with ordinality p(a, o) join jsonb_array_elements(v->'records') with ordinality q(b, o2) on o2 = o + 1), 'newest first';
  select e into x from jsonb_array_elements(v->'records') e where e->>'kind' = 'transfer' and e->'t'->>'src' = 'lang';
  assert (x->'n'->>'ms')::int = 48000 and x->>'about' = 'language' and x->>'receivedAt' is not null, 'a download''s timings: %', x;
  select e into x from jsonb_array_elements(v->'records') e where e->>'kind' = 'sync';
  assert x->>'about' = 'organization', 'the organization''s stream: %', x;
  assert v::text not like '%ui-org%' and v::text not like '%ui-lang%' and v::text not like '%ui-p1%', 'no organization, language or account: %', v;
  assert jsonb_array_length(public.ops_user_issue_phone('ui-a', now() - interval '3 days')->'records') = 1, 'around the time asked for';
  assert public.ops_user_issue_phone('ui-nobody') is null, 'nothing for an install that is not there';
end $$;
reset role;

-- Nobody else reads or writes it.
do $$ begin
  set local role authenticated;
  perform public.ops_user_issue_watch();
  raise exception 'a signed-in person read the watch';
exception when insufficient_privilege then null;
end $$;
reset role;
do $$ begin
  set local role authenticated;
  perform public.ops_user_issue_media('0d000000-0000-4000-8000-0000000000f1');
  raise exception 'a signed-in person read a screenshot';
exception when insufficient_privilege then null;
end $$;
reset role;
do $$ begin
  set local role anon;
  perform public.ops_user_issue_phone('ui-a');
  raise exception 'anyone read a phone''s records';
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

-- What the watch reads since 2026-11-21 (migration 20261121031500_user_issue_watch_gaps.sql): slowness by
-- the field report's limits, a stale snapshot, taps on audio not yet on the phone, records a phone dropped,
-- each stack's top line, and what waits past the 20 a run. In a savepoint, so the checks above stand alone.
savepoint gaps;
delete from diag.records;
update diag.feedback set done_at = now() where done_at is null;
delete from ops.user_issues;
delete from diag.job_runs where job in ('blob_reconcile', 'worker_requests', 'user_issue_watch');
insert into diag.records (id, install_id, delivered_by, org_id, stream_id, kind, at, received_at, n, t, stack) values
  -- A sync slow on the phone, one slow on the network, one fine.
  ('gp-1', 'ui-a', 'ui-p1', 'ui-org', 'ui-s1', 'sync', now(), now(), '{"applyMs":15000,"pushNetMs":1000,"pullNetMs":2000}', '{"outcome":"ok"}', null),
  ('gp-2', 'ui-b', 'ui-p2', 'ui-org', 'ui-s1', 'sync', now(), now(), '{"applyMs":1000,"pullNetMs":70000}', '{"outcome":"ok"}', null),
  ('gp-3', 'ui-b', 'ui-p2', 'ui-org', 'ui-s1', 'sync', now(), now(), '{"applyMs":3000,"pullNetMs":3000}', '{"outcome":"ok"}', null),
  -- A language open of 8 s; one of 2 s.
  ('gp-4', 'ui-a', 'ui-p1', 'ui-org', 'ui-s1', 'load', now(), now(), '{"ms":8000}', '{"reason":"open","checkpoint":"ok"}', null),
  ('gp-5', 'ui-b', 'ui-p2', 'ui-org', 'ui-s1', 'load', now(), now(), '{"ms":2000}', '{"reason":"open","checkpoint":"ok"}', null),
  -- A checkpoint of 4 s.
  ('gp-6', 'ui-a', 'ui-p1', 'ui-org', 'ui-s1', 'checkpoint', now(), now(), '{"ms":4000}', '{"path":"slow"}', null),
  -- Two first downloads of 20 minutes: one all online, one with 10 minutes offline (not slow).
  ('gp-7', 'ui-a', 'ui-p1', 'ui-org', 'ui-s1', 'open', now(), now(), '{"ms":1200000}', '{"cold":"yes"}', null),
  ('gp-8', 'ui-b', 'ui-p2', 'ui-org', 'ui-s2', 'open', now(), now(), '{"ms":1200000}', '{"cold":"yes"}', null),
  ('gp-9', 'ui-b', 'ui-p2', 'ui-org', 'ui-s2', 'sync', now() - interval '1 minute', now(), '{"offlineMs":600000}', '{"outcome":"ok"}', null),
  -- A fill over a day; a file over 2 minutes.
  ('gp-10', 'ui-a', 'ui-p1', 'ui-org', 'ui-s1', 'fill', now(), now(), '{"ms":90000000}', '{"event":"done"}', null),
  ('gp-11', 'ui-a', 'ui-p1', 'ui-org', 'ui-s1', 'transfer', now(), now(), '{"count":2,"maxMs":200000}', '{"dir":"down","src":"lang"}', null),
  -- A play that waited 4 s for its first sound, and 12 taps on audio not on the phone; 3 taps elsewhere are not counted.
  ('gp-12', 'ui-a', 'ui-p1', 'ui-org', 'ui-s1', 'audio', now(), now(), '{"maxWaitMs":4000,"playNotHere":12}', '{}', null),
  ('gp-13', 'ui-b', 'ui-p2', 'ui-org', 'ui-s1', 'audio', now(), now(), '{"maxWaitMs":400,"playNotHere":3}', '{}', null),
  -- A stale snapshot; records a phone dropped.
  ('gp-14', 'ui-a', 'ui-p1', 'ui-org', 'ui-s1', 'snapshot', now(), now(), '{"ms":100}', '{"outcome":"stale","why":"redaction"}', null),
  ('gp-15', 'ui-a', 'ui-p1', null, null, 'device', now(), now(), '{"diagDropped":40}', '{}', null),
  -- One error from two places in the code.
  ('gp-16', 'ui-a', 'ui-p1', null, null, 'error', now(), now(), '{}', '{"name":"RangeError","where":"map"}', E'at draw (map.ts:4)\nat run (a.ts:1)'),
  ('gp-17', 'ui-a', 'ui-p1', null, null, 'error', now(), now(), '{}', '{"name":"RangeError","where":"map"}', E'at draw (map.ts:4)\nat run (a.ts:1)'),
  ('gp-18', 'ui-b', 'ui-p2', null, null, 'error', now(), now(), '{}', '{"name":"RangeError","where":"map"}', E'at zoom (map.ts:9)\nat run (a.ts:1)');
-- A language folded again 21 times in a day beyond opening it.
insert into diag.records (id, install_id, delivered_by, org_id, stream_id, kind, at, received_at, n, t)
select 'gp-r' || i, 'ui-b', 'ui-p2', 'ui-org', 'ui-s1', 'load', date_trunc('day', now()) + interval '1 minute', now(), '{"ms":100}', '{"reason":"requeue"}'
from generate_series(1, 21) i;

set local role service_role;
do $$
declare v jsonb; x jsonb; keys text[];
begin
  v := public.ops_user_issue_watch();
  select array_agg(e->>'key') into keys from jsonb_array_elements(v->'look') e;
  assert keys @> array['slow:sync:phone', 'slow:sync:network', 'slow:load:open:ok', 'slow:checkpoint:slow', 'slow:open:first', 'slow:fill:done',
    'slow:transfer:down:lang', 'slow:audio:firstSound', 'slow:refolds', 'audio:playNotHere', 'snapshot:stale:redaction', 'device:diagDropped',
    'error:RangeError@map:-'], 'the new kinds: %', keys;
  assert (v->>'waiting')::int = 0, 'nothing waits: %', v->>'waiting';
  select e into x from jsonb_array_elements(v->'look') e where e->>'key' = 'slow:open:first';
  assert x->'installIds' = '["ui-a"]'::jsonb, 'only the download that was slow online: %', x;
  select e into x from jsonb_array_elements(v->'look') e where e->>'key' = 'slow:load:open:ok';
  assert x->'installIds' = '["ui-a"]'::jsonb, 'only the slow open: %', x;
  select e into x from jsonb_array_elements(v->'look') e where e->>'key' = 'audio:playNotHere';
  assert (x->>'count')::int = 12 and x->'installIds' = '["ui-a"]'::jsonb, 'only the hour over 10 taps, counted by taps: %', x;
  select e into x from jsonb_array_elements(v->'look') e where e->>'key' = 'slow:refolds';
  assert (x->>'count')::int = 1 and x->'installIds' = '["ui-b"]'::jsonb, 'one phone-day: %', x;
  select e into x from jsonb_array_elements(v->'look') e where e->>'key' = 'error:RangeError@map:-';
  assert x->'tops' = '[{"frame":"at draw (map.ts:4)","records":2},{"frame":"at zoom (map.ts:9)","records":1}]'::jsonb, 'each stack''s top line: %', x->'tops';
  assert not exists (select 1 from jsonb_array_elements(v->'look') e where e->>'key' like 'slow:%' and e->'installIds' @> '["ui-b"]'::jsonb
    and e->>'key' not in ('slow:sync:network', 'slow:refolds')), 'nothing fine counted as slow: %', keys;
end $$;
reset role;

-- 25 more errors than the watch looks at in a run: 20 go, the rest wait.
insert into diag.records (id, install_id, delivered_by, kind, at, received_at, t)
select 'gp-w' || i, 'ui-a', 'ui-p1', 'error', now(), now(), jsonb_build_object('name', 'Many' || i, 'where', 'x') from generate_series(1, 25) i;
insert into diag.job_runs (job, started_at, ms, outcome, n) values ('user_issue_watch', now(), 10, 'ok', '{"active":40,"look":20,"grew":0,"waiting":18}');
set local role service_role;
do $$
declare v jsonb;
begin
  v := public.ops_user_issue_watch();
  assert jsonb_array_length(v->'look') = 20 and (v->>'waiting')::int = 18, 'twenty, and 18 wait: % %', jsonb_array_length(v->'look'), v->>'waiting';
end $$;
reset role;
set local role diag_reader;
do $$ begin
  assert (diag.ops_user_issues()->>'waiting')::int = 18, 'the dashboard reads what waits: %', diag.ops_user_issues()->>'waiting';
end $$;
reset role;
rollback to savepoint gaps;

-- The plan of an issue whose cause is not proven yet (migration 20261121235200_user_issue_plans.sql):
-- kept, handed back when its time comes, counted, removed, and shown to the dashboard without the probe.
savepoint plans;
insert into ops.user_issues (key, verdict, issue, issue_url) values
  ('error:PlanA@x:-', 'filed', 'LAN-901', 'https://linear.app/x/issue/LAN-901'),
  ('error:PlanB@x:-', 'filed', 'LAN-902', 'https://linear.app/x/issue/LAN-902');
set local role service_role;
do $$ begin
  assert public.ops_user_issue_plans_done(jsonb_build_object('runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/777', 'plans', jsonb_build_array(
    jsonb_build_object('issue', 'LAN-901', 'next', 'Run a probe.', 'steps', '1. Probe.', 'inHours', 0.25, 'probe', 'took 4100 ms'),
    jsonb_build_object('issue', 'LAN-902', 'next', 'Read production.', 'inHours', 9999)))) = 2, 'two plans kept';
  assert public.ops_user_issue_plans_due() = '[]'::jsonb, 'nothing due yet';
  begin
    perform public.ops_user_issue_plans_done(jsonb_build_object('runUrl', 'https://github.com/someone/else/actions/runs/1', 'plans', '[]'::jsonb));
    assert false, 'another repository''s run';
  exception when sqlstate '22023' then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select next_at > now() + interval '14 minutes' and next_at < now() + interval '16 minutes' from ops.user_issue_plans where issue = 'LAN-901'), 'a quarter hour';
  assert (select next_at < now() + interval '169 hours' from ops.user_issue_plans where issue = 'LAN-902'), 'at most a week';
  assert not has_function_privilege('authenticated', 'public.ops_user_issue_plans_done(jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.ops_user_issue_plans_due(int)', 'execute'), 'only the Worker';
end $$;
update ops.user_issue_plans set next_at = now() - interval '1 minute';
set local role service_role;
do $$ begin
  assert public.ops_user_issue_plans_due() = '["LAN-901", "LAN-902"]'::jsonb, 'both due: %', public.ops_user_issue_plans_due();
  assert public.ops_user_issue_plan('LAN-901')->>'probe' = 'took 4100 ms', 'the next try reads the probe';
  -- A second plan counts a try.
  perform public.ops_user_issue_plans_done(jsonb_build_object('runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/778', 'plans', jsonb_build_array(jsonb_build_object('issue', 'LAN-901', 'next', 'Probe again.', 'inHours', 1))));
  assert (public.ops_user_issue_plan('LAN-901')->>'tries')::int = 2, 'two tries';
end $$;
reset role;
-- At the limit an issue is not handed back, nor a closed one.
update ops.user_issue_plans set next_at = now() - interval '1 minute';
set local role service_role;
do $$ begin
  assert public.ops_user_issue_plans_due(2) = '["LAN-902"]'::jsonb, 'LAN-901 is at the limit: %', public.ops_user_issue_plans_due(2);
end $$;
reset role;
update ops.user_issues set verdict = 'fixed', fixed_at = now(), closed_at = now() where issue = 'LAN-902';
set local role service_role;
do $$ begin
  assert public.ops_user_issue_plans_due() = '["LAN-901"]'::jsonb, 'a closed issue stays: %', public.ops_user_issue_plans_due();
  -- A record with no next step removes the plan.
  perform public.ops_user_issue_plans_done(jsonb_build_object('runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/779', 'plans', jsonb_build_array(jsonb_build_object('issue', 'LAN-902', 'next', null))));
  assert public.ops_user_issue_plan('LAN-902') is null, 'removed';
end $$;
reset role;
set local role diag_reader;
do $$ begin
  assert diag.ops_user_issue_plans()->'LAN-901'->>'next' = 'Probe again.', 'the dashboard reads the next step';
  assert not (diag.ops_user_issue_plans()->'LAN-901' ? 'probe'), 'never the probe';
end $$;
reset role;
rollback to savepoint plans;

rollback;
