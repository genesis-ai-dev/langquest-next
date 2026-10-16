-- Field diagnostics (migration *_field_diagnostics.sql). Run by `npm run db:test`
-- after smoke.sql. Uses its own ids, so it also runs inside BEGIN ... ROLLBACK
-- against a local database that holds other data.

\set ON_ERROR_STOP on

update public.server_config set min_client_version = 0;

-- An org with one language, a lead and a translator in that language.
-- Set up as the server would (an import): people here have joined by invite or request (decisions.md 75).
select set_config('request.jwt.claim.sub', '', false);
do $$ declare r record; begin
  for r in select * from public.append_events('[
  {"id":"dg1","type":"v1.OrgCreated","orgId":"dg_org","streamId":"_org","actorId":"dg_lead","deviceId":"dg_dA","hlc":"000000000000101:000000:dg_dA","payload":{"name":"Diagnostics Test Org"}},
  {"id":"dg1a","type":"v1.RoleDefined","orgId":"dg_org","streamId":"_org","actorId":"dg_lead","deviceId":"dg_dA","hlc":"000000000000101:000001:dg_dA","payload":{"roleId":"org_admin","name":"Organization Admin","privileges":["manage_structure","invite_members","manage_roles","manage_templates","manage_reference","manage_flows","manage_teams","assign_work","translate","fill_reference","send_to_reviewers","review","view_status"]}},
  {"id":"dg1b","type":"v1.RoleDefined","orgId":"dg_org","streamId":"_org","actorId":"dg_lead","deviceId":"dg_dA","hlc":"000000000000101:000002:dg_dA","payload":{"roleId":"translator","name":"Translator","privileges":["translate","fill_reference","send_to_reviewers","view_status"]}},
  {"id":"dg2","type":"v1.MemberAdded","orgId":"dg_org","streamId":"_org","actorId":"dg_lead","deviceId":"dg_dA","hlc":"000000000000102:000000:dg_dA","payload":{"profileId":"dg_lead","roleId":"org_admin","scope":{"level":"org"}}},
  {"id":"dg3","type":"v1.LanguageAdded","orgId":"dg_org","streamId":"_org","actorId":"dg_lead","deviceId":"dg_dA","hlc":"000000000000103:000000:dg_dA","payload":{"languageId":"dg_lang","name":"Dinka Test","code":"din","sourceCode":"eng"}},
  {"id":"dg4","type":"v1.MemberAdded","orgId":"dg_org","streamId":"_org","actorId":"dg_lead","deviceId":"dg_dA","hlc":"000000000000104:000000:dg_dA","payload":{"profileId":"dg_t1","roleId":"translator","scope":{"level":"language","languageId":"dg_lang"}}}
]'::jsonb) loop
    if not r.accepted then raise exception 'seed event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;

-- 1. A translator's phone delivers what it kept.
select set_config('request.jwt.claim.sub', 'dg_t1', false);
do $$
declare
  v_now numeric := extract(epoch from now()) * 1000;
  v_n int;
begin
  v_n := public.diag_ingest(
    jsonb_build_object('installId', 'dg_dT', 'os', 'android', 'model', 'SM-A105F', 'updateId', 'u-123', 'email', 'x@y.z'),
    jsonb_build_array(
      jsonb_build_object('id', 'dgr1', 'kind', 'sync', 'at', v_now - 60000, 'orgId', 'dg_org', 'streamId', 'dg_lang',
        'n', jsonb_build_object('ms', 5000.4, 'pullNetMs', 4000, 'secret', 1), 't', jsonb_build_object('outcome', 'ok', 'note', 'free text')),
      jsonb_build_object('id', 'dgr2', 'kind', 'transfer', 'at', v_now - 50000, 'orgId', 'dg_org', 'streamId', 'dg_lang',
        'n', jsonb_build_object('count', 3, 'bytes', 300000, 'ms', 30000, 'verifyMs', 20000), 't', jsonb_build_object('dir', 'down')),
      jsonb_build_object('id', 'dgr3', 'kind', 'error', 'at', v_now - 40000,
        'stack', E'TypeError: cannot read "In the beginning"\n    at save (/Users/someone/app/recording.ts:10:5)',
        't', jsonb_build_object('name', 'TypeError', 'where', 'screen passage', 'errorId', 'E-DGTST1', 'fatal', 'no')),
      jsonb_build_object('id', 'dgr4', 'kind', 'load', 'at', v_now - 30000, 'orgId', 'someone_elses_org', 'streamId', 'p', 'n', jsonb_build_object('ms', 10)),
      jsonb_build_object('id', 'dgr5', 'kind', 'transcript', 'at', v_now, 't', jsonb_build_object('text', 'no')),
      jsonb_build_object('id', 'dgr6', 'kind', 'sync', 'at', 'yesterday')
    )
  );
  if v_n <> 4 then raise exception 'expected 4 records kept, got %', v_n; end if;
  -- A resend after a dropped link adds nothing.
  if public.diag_ingest('{"installId":"dg_dT"}', '[{"id":"dgr1","kind":"sync","at":1}]') <> 0 then
    raise exception 'resend should be idempotent';
  end if;
end $$;

do $$
declare r record;
begin
  select * into r from diag.records where id = 'dgr1';
  if r.n <> '{"ms": 5000, "pullNetMs": 4000}'::jsonb then raise exception 'numbers not cleaned: %', r.n; end if;
  if r.t <> '{"outcome": "ok"}'::jsonb then raise exception 'tags not cleaned: %', r.t; end if;
  if r.delivered_by <> 'dg_t1' or r.install_id <> 'dg_dT' or r.update_id <> 'u-123' then raise exception 'provenance wrong'; end if;
  select * into r from diag.records where id = 'dgr3';
  if r.stack <> 'at save (recording.ts:10:5)' then raise exception 'stack kept more than frames: %', r.stack; end if;
  select * into r from diag.records where id = 'dgr4';
  if r.org_id is not null or r.stream_id is not null then raise exception 'filed under an org the caller is not in'; end if;
  if (select context from diag.installs where install_id = 'dg_dT') ? 'email' then raise exception 'context kept an unknown key'; end if;
end $$;

-- 2. The door refuses the anonymous and the oversized.
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  perform public.diag_ingest('{"installId":"dg_dT"}', '[]');
  raise exception 'anonymous ingest should fail';
exception when insufficient_privilege then null;
end $$;
select set_config('request.jwt.claim.sub', 'dg_t1', false);
do $$ begin
  perform public.diag_ingest('{"installId":"dg_dT"}', (select jsonb_agg(jsonb_build_object('id', 'x' || g, 'kind', 'load', 'at', 1)) from generate_series(1, 201) g));
  raise exception 'a 201-record batch should fail';
exception when invalid_parameter_value then null;
end $$;

-- 2b. Made-up install ids do not lift the daily cap: it is per person too.
do $$ begin
  insert into diag.installs (install_id, profile_id, day_count) values ('dg_cap1', 'dg_t1', 5000), ('dg_cap2', 'dg_t1', 5000), ('dg_cap3', 'dg_t1', 5000), ('dg_cap4', 'dg_t1', 5000);
  if public.diag_ingest('{"installId":"dg_cap5"}', '[{"id":"dgcap","kind":"load","at":1}]') <> 0 then
    raise exception 'a person past 20000 records today should be refused';
  end if;
  delete from diag.installs where install_id like 'dg_cap%';
end $$;

-- 3. The report functions answer "a translator in this language".
do $$
declare v jsonb;
begin
  if not exists (select 1 from diag.find('Dinka Test') where kind = 'language' and org_id = 'dg_org' and language_id = 'dg_lang') then
    raise exception 'find by language name failed';
  end if;
  if not exists (select 1 from diag.find('Diagnostics Test') where kind = 'org' and org_id = 'dg_org') then
    raise exception 'find by org name failed';
  end if;
  v := diag.language_health('dg_org', 'dg_lang', 6);
  if v->'events' is null or v->'snapshots' <> '[]'::jsonb then raise exception 'language_health: %', v; end if;
  if not exists (select 1 from diag.members('dg_org', 'dg_lang') where profile_id = 'dg_t1' and 'dg_dT' = any (installs)) then
    raise exception 'members should link the translator to their install';
  end if;
  v := diag.summary('dg_org', 'dg_lang');
  if (v->'dg_dT'->'sync'->>'count')::int <> 1 or (v->'dg_dT'->'transfer'->'down'->>'verifyMs')::int <> 20000 then
    raise exception 'summary: %', v;
  end if;
  if jsonb_array_length(v->'dg_dT'->'errors') <> 1 then raise exception 'summary should carry the install''s errors'; end if;
  v := diag.error('E-DGTST1');
  if jsonb_array_length(v) <> 1 or jsonb_array_length(v->0->'before') <> 2 then raise exception 'error lookup: %', v; end if;
  if (select count(*) from diag.timeline('dg_dT')) <> 4 then raise exception 'timeline'; end if;
end $$;

-- 4. Who may read: not the API roles; diag_reader, but not the log itself.
set role authenticated;
do $$ begin
  perform * from diag.records;
  raise exception 'authenticated should not read diag';
exception when insufficient_privilege then null;
end $$;
reset role;
-- On Supabase `postgres` is not a superuser; it may take the role only as a member.
grant diag_reader to postgres;
set role diag_reader;
do $$ begin
  perform diag.summary('dg_org', 'dg_lang');
  perform * from diag.rpc_stats();
  perform * from diag.records;
  begin
    perform * from public.events limit 1;
    raise exception 'diag_reader should not read the event log';
  exception when insufficient_privilege then null;
  end;
  begin
    perform diag.prune();
    raise exception 'diag_reader should not delete';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 5. Retention: 90 days after arrival a record is gone.
do $$ begin
  update diag.records set received_at = now() - interval '91 days' where id = 'dgr1';
  perform diag.prune();
  if exists (select 1 from diag.records where id = 'dgr1') then raise exception 'prune kept an expired record'; end if;
  if not exists (select 1 from diag.records where id = 'dgr2') then raise exception 'prune removed a current record'; end if;
end $$;

-- 6. Server jobs (20261016010000_diag_jobs.sql): runs go in through
-- public.diag_job_ingest as the service role only, content-free.
select set_config('request.jwt.claim.sub', '', false);
set role service_role;
do $$
declare v_id bigint;
begin
  v_id := public.diag_job_ingest('push_delivery', now() - interval '2 seconds', 1500, 'partial',
    '{"claimed": 3, "sent": 2.6, "note": "free text", "bad key!": 1, "nested": {"a": 1}}'::jsonb,
    'canceling statement due to statement timeout', 'dg_org', null);
  perform set_config('dg.job_a', v_id::text, false);
  v_id := public.diag_job_ingest('projection_large', now() - interval '3 hours', 9000, 'ok', '{"projected": 1}', null, null, null);
  perform set_config('dg.job_c', v_id::text, false);
  v_id := public.diag_job_ingest('projection_large', now() - interval '1 minute', 4000, 'error',
    '{"projected": 0, "failed": 1}', 'DbError:57014', 'dg_org', 'dg_lang');
  perform set_config('dg.job_b', v_id::text, false);
  begin
    perform public.diag_job_ingest('make_coffee', now(), 1, 'ok');
    raise exception 'an unknown job should be refused';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.diag_job_ingest('projection', now(), 1, 'fine');
    raise exception 'an unknown outcome should be refused';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;

do $$
declare r record;
begin
  select * into r from diag.job_runs where id = current_setting('dg.job_a')::bigint;
  if r.n <> '{"claimed": 3, "sent": 3}'::jsonb then raise exception 'job numbers not cleaned: %', r.n; end if;
  if r.error_class is not null then raise exception 'a message was kept as an error class: %', r.error_class; end if;
  if r.org_id <> 'dg_org' or r.outcome <> 'partial' or r.ms <> 1500 then raise exception 'job run: %', to_jsonb(r); end if;
  select * into r from diag.job_runs where id = current_setting('dg.job_b')::bigint;
  if r.error_class <> 'DbError:57014' or r.stream_id <> 'dg_lang' then raise exception 'job run error: %', to_jsonb(r); end if;
end $$;

-- The API roles cannot write a run.
set role authenticated;
do $$ begin
  perform public.diag_job_ingest('projection', now(), 1, 'ok');
  raise exception 'authenticated should not write a job run';
exception when insufficient_privilege then null;
end $$;
reset role;
set role anon;
do $$ begin
  perform public.diag_job_ingest('projection', now(), 1, 'ok');
  raise exception 'anon should not write a job run';
exception when insufficient_privilege then null;
end $$;
reset role;

-- The projection pass marks when it projected; push delivery counts attempts.
insert into public.projection_marks (org_id, stream_id, seq, org_seq, listed, version)
values ('dg_org', 'dg_lang', 1, 1, false, 'dg') on conflict (org_id, stream_id) do update set seq = 1;
insert into public.notifications (id, profile_id, org_id, language_id, kind, title)
values ('dg_note1', 'dg_t1', 'dg_org', 'dg_lang', 'review', 'Your recording was reviewed: x');
set role service_role;
do $$ begin
  if public.record_notification_pushes('[{"id": "dg_note1", "error": "http_5xx"}, {"id": "dg_note1", "error": "not a code"}]') <> 1 then
    raise exception 'a failed push should be recorded once, and an unknown code ignored';
  end if;
end $$;
reset role;

-- diag_reader reads runs and reports, and cannot write a run.
set role diag_reader;
do $$
declare v jsonb; r record;
begin
  v := diag.language_health('dg_org', 'dg_lang', 6);
  if v->>'projectedAt' is null or (v->>'projectedSeq')::int <> 1 then raise exception 'language_health projection: %', v; end if;
  v := diag.inbox_health('dg_org');
  if (v->>'pending')::int <> 1 or v->'attempts' <> '{"1": 1}'::jsonb or v->'lastErrors' <> '{"http_5xx": 1}'::jsonb
     or (v->>'members')::int < 2 or v::text ~ 'dg_t1|reviewed' then
    raise exception 'inbox_health: %', v;
  end if;
  perform * from diag.v2_import_status();
  perform * from diag.job_history('projection_large');
  perform * from diag.job_runs;
  select * into r from diag.jobs() j where j.job = 'push_delivery';
  if r.runs < 1 or r.stale or (r.totals->>'claimed')::int < 3 then raise exception 'jobs push_delivery: %', to_jsonb(r); end if;
  select * into r from diag.jobs() j where j.job = 'projection_large';
  if r.last_outcome <> 'error' or r.last_error_class <> 'DbError:57014' or r.streak < 1 then
    raise exception 'jobs projection_large: %', to_jsonb(r);
  end if;
  -- Its last good run is three hours old against a ten-minute schedule; a
  -- real large pass in this database in the last hour would make it fresh.
  if not r.stale and r.last_ok_at < now() - interval '1 hour' then raise exception 'projection_large should be stale: %', to_jsonb(r); end if;
  begin
    perform diag.job_ingest('projection', now(), 1, 'ok');
    raise exception 'diag_reader should not write a job run';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.diag_job_ingest('projection', now(), 1, 'ok');
    raise exception 'diag_reader should not write a job run';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$ begin
  update public.notifications set push_lease_until = now() where id = 'dg_note1';
end $$;
set role service_role;
do $$ begin
  perform public.record_notification_pushes('[{"id": "dg_note1", "error": null}]');
end $$;
reset role;
do $$
declare r record;
begin
  select * into r from public.notifications where id = 'dg_note1';
  if r.pushed_at is null or r.push_lease_until is not null or r.push_attempts <> 2 or r.push_last_error is not null then
    raise exception 'a push that went out: %', to_jsonb(r);
  end if;
  -- Job runs go after 90 days, as records do.
  update diag.job_runs set received_at = now() - interval '91 days' where id = current_setting('dg.job_a')::bigint;
  perform diag.prune();
  if exists (select 1 from diag.job_runs where id = current_setting('dg.job_a')::bigint) then raise exception 'prune kept an expired job run'; end if;
  if not exists (select 1 from diag.job_runs where id = current_setting('dg.job_b')::bigint) then raise exception 'prune removed a current job run'; end if;
  delete from diag.job_runs where id in (current_setting('dg.job_b')::bigint, current_setting('dg.job_c')::bigint);
  delete from public.notifications where id = 'dg_note1';
  delete from public.projection_marks where org_id = 'dg_org';
end $$;

-- 7. The second pass (20261016000000_diag_gaps.sql): the new kinds go in
-- through the same allowlist, and the reports read them, the organization
-- stream, and a member's phone that never opened the language.
select set_config('request.jwt.claim.sub', 'dg_t1', false);
do $$
declare
  v_now numeric := extract(epoch from now()) * 1000;
  v jsonb;
begin
  perform public.diag_ingest(
    jsonb_build_object('installId', 'dg_dT2', 'os', 'ios'),
    jsonb_build_array(
      jsonb_build_object('id', 'dgs1', 'kind', 'sync', 'at', v_now - 9000, 'orgId', 'dg_org', 'streamId', 'dg_lang',
        'n', jsonb_build_object('ms', 900, 'rejNotMember', 2), 't', jsonb_build_object('outcome', 'error', 'code', '57014', 'phase', 'pull')),
      jsonb_build_object('id', 'dgs2', 'kind', 'sync', 'at', v_now - 8000, 'orgId', 'dg_org', 'streamId', '_org',
        'n', jsonb_build_object('ms', 300), 't', jsonb_build_object('outcome', 'unrenewed')),
      jsonb_build_object('id', 'dgs3', 'kind', 'transfer', 'at', v_now - 7000, 'orgId', 'dg_org', 'streamId', 'dg_lang',
        'n', jsonb_build_object('count', 2, 'failTooLarge', 2, 'maxMs', 50), 't', jsonb_build_object('dir', 'up', 'src', 'guide')),
      jsonb_build_object('id', 'dgs4', 'kind', 'audio', 'at', v_now - 6000, 'orgId', 'dg_org', 'streamId', 'dg_lang',
        'n', jsonb_build_object('takes', 3, 'micRefused', 1, 'typed', 5)),
      jsonb_build_object('id', 'dgs5', 'kind', 'audio', 'at', v_now - 5500, 'n', jsonb_build_object('takes', 1)),
      jsonb_build_object('id', 'dgs6', 'kind', 'expected', 'at', v_now - 5000,
        'n', jsonb_build_object('count', 12), 't', jsonb_build_object('where', 'held invite', 'name', 'Error', 'code', 'someone@example.org')),
      jsonb_build_object('id', 'dgs7', 'kind', 'auth', 'at', v_now - 4000,
        'n', jsonb_build_object('pending', 4), 't', jsonb_build_object('op', 'ended', 'outcome', 'refused', 'code', 'session_not_found')),
      jsonb_build_object('id', 'dgs8', 'kind', 'auth', 'at', v_now - 3500, 't', jsonb_build_object('op', 'sign_in', 'outcome', 'wrong guess')),
      jsonb_build_object('id', 'dgs9', 'kind', 'load', 'at', v_now - 3000, 'orgId', 'dg_org', 'streamId', 'dg_lang',
        'n', jsonb_build_object('ms', 40, 'readMs', 10, 'foldMs', 30), 't', jsonb_build_object('reason', 'open', 'checkpoint', 'old_reducer')),
      jsonb_build_object('id', 'dgs10', 'kind', 'device', 'at', v_now - 2000,
        'n', jsonb_build_object('lostFiles', 1, 'diagDropped', 7, 'oldestUnsentMin', 90))
    ));
  -- Codes are tokens: an address is not one. Outcomes come from a fixed set.
  if (select t from diag.records where id = 'dgs6') ? 'code' then raise exception 'an address passed as a code'; end if;
  if (select t from diag.records where id = 'dgs8') ? 'outcome' then raise exception 'an unknown auth outcome was kept'; end if;
  if (select n from diag.records where id = 'dgs4') ? 'typed' then raise exception 'an unknown audio field was kept'; end if;
end $$;
select set_config('request.jwt.claim.sub', '', false);
do $$
declare v jsonb;
begin
  v := diag.summary('dg_org', 'dg_lang', interval '1 day', 'dg_dT2');
  v := v->'dg_dT2';
  if v is null then raise exception 'summary should hold the new install'; end if;
  if (v->'sync'->'errorCodes'->>'pull:57014')::int <> 1 or (v->'sync'->'rejectedBy'->>'notMember')::int <> 2 then raise exception 'sync codes: %', v->'sync'; end if;
  if (v->'orgSync'->'outcomes'->>'unrenewed')::int <> 1 then raise exception 'org stream: %', v->'orgSync'; end if;
  if (v->'otherTransfer'->'guide:up'->>'failTooLarge')::int <> 2 then raise exception 'other transfers: %', v->'otherTransfer'; end if;
  -- The language's audio and the audio no language claimed.
  if (v->'audio'->>'takes')::int <> 4 or (v->'audio'->>'micRefused')::int <> 1 then raise exception 'audio: %', v->'audio'; end if;
  if (v->'load'->>'staleCheckpoints')::int <> 1 or (v->'load'->>'readMs')::int <> 10 then raise exception 'load: %', v->'load'; end if;
  if (v->>'diagDropped')::int <> 7 or (v->'device'->>'lostFiles')::int <> 1 then raise exception 'device: %', v; end if;
  if jsonb_array_length(v->'auth') <> 2 or (v->'expected'->0->>'count')::int <> 12 then raise exception 'auth and expected: %', v; end if;
end $$;
-- A member's phone that only synced the organization is still in the language's report.
select set_config('request.jwt.claim.sub', 'dg_t1', false);
select public.diag_ingest(jsonb_build_object('installId', 'dg_dT3'), jsonb_build_array(
  jsonb_build_object('id', 'dgs11', 'kind', 'sync', 'at', extract(epoch from now()) * 1000 - 1000, 'orgId', 'dg_org', 'streamId', '_org',
    'n', jsonb_build_object('ms', 100), 't', jsonb_build_object('outcome', 'ok'))));
select set_config('request.jwt.claim.sub', '', false);
set role diag_reader;
do $$
declare v jsonb;
begin
  v := diag.summary('dg_org', 'dg_lang', interval '1 day');
  if v->'dg_dT3' is null or jsonb_typeof(v->'dg_dT3'->'orgSync') <> 'object' or jsonb_typeof(v->'dg_dT3'->'sync') <> 'null' then
    raise exception 'a member''s phone that never opened the language: %', v->'dg_dT3';
  end if;
  v := diag.org_summary('dg_org', interval '1 day');
  if v->'installs'->'dg_dT2' is null or v->'installs'->'dg_dT2'->>'roles' is null then raise exception 'org_summary: %', v; end if;
  if not exists (select 1 from jsonb_array_elements(v->'silent') x where x->>'profileId' = 'dg_lead') then
    raise exception 'org_summary should name members never heard from: %', v->'silent';
  end if;
  v := diag.person('dg_t1', interval '1 day');
  if jsonb_typeof(v->'dg_dT2'->'auth') is distinct from 'array' or jsonb_typeof(v->'dg_dT2'->'orgs') is distinct from 'array' then raise exception 'person: %', v; end if;
end $$;
reset role;
delete from diag.records where install_id in ('dg_dT2', 'dg_dT3');
delete from diag.installs where install_id in ('dg_dT2', 'dg_dT3');

select set_config('request.jwt.claim.sub', '', false);
\echo 'diag-smoke ok'
