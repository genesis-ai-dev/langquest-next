-- The operations dashboard's read functions (migration *_ops_dashboard.sql,
-- docs/ops-dashboard-plan.md): shapes, what they must never return, and who
-- may run them. Run by `npm run db:test`. Repeatable; every write rolls back.
-- Assertions are about what this script adds, so they hold on a database
-- that already has data.
\set ON_ERROR_STOP on
begin;
update public.server_config set min_client_version = 0;

insert into auth.users (id, email) values
  ('0d000000-0000-0000-0000-00000000000a', 'ops-admin@example.org'),
  ('0d000000-0000-0000-0000-00000000000b', 'Ops-Reporter@Example.org'),
  ('0d000000-0000-0000-0000-00000000000c', 'ops-gone@example.org');
update auth.users set banned_until = now() + interval '100 years' where id = '0d000000-0000-0000-0000-00000000000b';
insert into public.profiles (id, display_name) values
  ('0d000000-0000-0000-0000-00000000000a', 'Ops Admin Name'), ('0d000000-0000-0000-0000-00000000000b', 'Ops Reporter Name'),
  ('0d000000-0000-0000-0000-00000000000c', 'Ops Gone Name');

-- An organization with an admin, a language, and its work.
select set_config('request.jwt.claim.sub', '', true);
do $$ declare r record; begin
  for r in select * from public.append_events('[
    {"id":"od-1","type":"v1.OrgCreated","orgId":"od-org","streamId":"_org","actorId":"0d000000-0000-0000-0000-00000000000a","deviceId":"dO","hlc":"000000000000001:000000:dO","payload":{"name":"Ops Org"}},
    {"id":"od-2","type":"v1.RoleDefined","orgId":"od-org","streamId":"_org","actorId":"0d000000-0000-0000-0000-00000000000a","deviceId":"dO","hlc":"000000000000002:000000:dO","payload":{"roleId":"org_admin","name":"Organization Admin","privileges":["manage_structure","invite_members","manage_roles","assign_work","translate","view_status"]}},
    {"id":"od-3","type":"v1.MemberAdded","orgId":"od-org","streamId":"_org","actorId":"0d000000-0000-0000-0000-00000000000a","deviceId":"dO","hlc":"000000000000003:000000:dO","payload":{"profileId":"0d000000-0000-0000-0000-00000000000a","roleId":"org_admin","scope":{"level":"org"}}},
    {"id":"od-4","type":"v1.LanguageAdded","orgId":"od-org","streamId":"_org","actorId":"0d000000-0000-0000-0000-00000000000a","deviceId":"dO","hlc":"000000000000004:000000:dO","payload":{"languageId":"od-L","name":"Opsish","code":"ops","sourceCode":"eng"}}
  ]'::jsonb) loop
    if not r.accepted then raise exception 'setup event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;

insert into public.join_requests (id, org_id, profile_id, message) values ('od-jr', 'od-org', '0d000000-0000-0000-0000-00000000000b', 'let me in please');
-- A report about the admin, who can invite members organization-wide: only staff can act on it.
insert into public.content_reports (id, org_id, language_id, target_kind, target_id, reported_profile, reporter_id, reason, details)
  values ('od-rep', 'od-org', null, 'person', '0d000000-0000-0000-0000-00000000000a', '0d000000-0000-0000-0000-00000000000a',
          '0d000000-0000-0000-0000-00000000000b', 'spam', 'secret details text');
insert into public.global_viewers (profile_id, granted_by, note) values ('0d000000-0000-0000-0000-00000000000c', 'ops', 'smoke');
insert into diag.installs (install_id, profile_id, day_start, day_count) values ('od-inst', '0d000000-0000-0000-0000-00000000000a', current_date, 5000);
insert into v2_import.sign_in_failures (email) values ('od@example.org');
insert into public.notifications (id, profile_id, org_id, kind, title, push_attempts, push_last_error)
  values ('od-n1', '0d000000-0000-0000-0000-00000000000a', 'od-org', 'x', 't', 2, 'http_5xx');
-- One person with a push token, one without: only the first can be pushed.
insert into public.push_tokens (token, profile_id) values ('od-push-token', '0d000000-0000-0000-0000-00000000000a');
insert into public.notifications (id, profile_id, org_id, kind, title)
  values ('od-n2', '0d000000-0000-0000-0000-00000000000b', 'od-org', 'x', 't');
insert into diag.feedback (id, profile_id, kind, body, install_id) values
  ('0d000000-0000-0000-0000-0000000000f1', '0d000000-0000-0000-0000-00000000000a', 'bug', 'secret feedback text', 'od-inst');

-- 1. Every function, as diag_reader; the role still cannot read the tables.
grant diag_reader to postgres;
set role diag_reader;
do $$
declare v jsonb; t text;
begin
  -- people
  v := diag.ops_people();
  if jsonb_array_length(v->'accounts'->'newByDay') <> 14 or jsonb_array_length(v->'orgs'->'newByWeek') <> 8
     or jsonb_array_length(v->'languages'->'newByWeek') <> 8 or jsonb_array_length(v->'joining'->'invitesByDay') <> 14 then
    raise exception 'ops_people series lengths: %', v;
  end if;
  if (v->'accounts'->>'suspended')::int < 1 or (v->'accounts'->>'total')::int < 3 then raise exception 'ops_people accounts: %', v->'accounts'; end if;
  if (v->'joining'->>'pendingRequests')::int < 1 or v->'joining'->>'oldestRequestAt' is null then raise exception 'ops_people joining: %', v->'joining'; end if;
  if (v->'globalViewers'->>'active')::int < 1 or v->'globalViewers'->'signedInAal2' is null then raise exception 'ops_people gv: %', v->'globalViewers'; end if;
  if v->'activeProfiles'->'day' is null or v->'activeProfiles'->'week' is null then raise exception 'ops_people active: %', v; end if;
  if v::text ilike '%Ops Admin Name%' or v::text ilike '%@example.org%' then raise exception 'ops_people names someone'; end if;

  -- orgs
  v := diag.ops_orgs(1000);
  if jsonb_typeof(v->'orgs') <> 'array' then raise exception 'ops_orgs: %', v; end if;
  select x::text into t from jsonb_array_elements(v->'orgs') x where x->>'orgId' = 'od-org';
  if t is null or (t::jsonb)->>'name' <> 'Ops Org' or ((t::jsonb)->>'pendingRequests')::int <> 1
     or ((t::jsonb)->>'members')::int <> 1 or ((t::jsonb)->>'languages')::int <> 1 or ((t::jsonb)->>'events')::int < 4 then
    raise exception 'ops_orgs row: %', t;
  end if;
  if jsonb_array_length(diag.ops_orgs(1)->'orgs') <> 1 then raise exception 'ops_orgs limit'; end if;

  v := diag.ops_org('od-org');
  if v->>'name' <> 'Ops Org' or v->'inbox' is null or (v->>'pendingRequests')::int <> 1 or (v->>'openReports')::int <> 1
     or jsonb_typeof(v->'membersByRole') <> 'array' or jsonb_typeof(v->'languages') <> 'array' then
    raise exception 'ops_org: %', v;
  end if;
  if diag.ops_org('od-no-such-org') is not null then raise exception 'ops_org of nothing should be null'; end if;

  -- pipeline
  v := diag.ops_pipeline(1, 200, 3600000);
  if jsonb_typeof(v->'lag') <> 'array' or jsonb_typeof(v->'largest') <> 'array' or jsonb_typeof(v->'snapshots'->'worst') <> 'array'
     or v->'lagging' is null or v->'snapshots'->'overdue' is null or v->'snapshots'->'oldReducer' is null or v->'snapshots'->'noCut' is null then
    raise exception 'ops_pipeline: %', v;
  end if;
  -- The schedule is the caller's: thresholds nothing can reach count nothing overdue, and the old signature is gone.
  if (diag.ops_pipeline(1, 2000000000, 3000000000000)->'snapshots'->>'overdue')::int <> 0 then raise exception 'ops_pipeline overdue ignores its thresholds'; end if;
  if to_regprocedure('diag.ops_pipeline(integer)') is not null then raise exception 'a stale ops_pipeline(int) is left'; end if;

  -- cron: no command text
  v := diag.ops_cron();
  if jsonb_typeof(v->'jobs') <> 'array' then raise exception 'ops_cron: %', v; end if;
  if exists (select 1 from jsonb_array_elements(v->'jobs') x where x ? 'command') then raise exception 'ops_cron has a command key'; end if;

  -- database
  v := diag.ops_database();
  if (v->>'bytes')::bigint <= 0 or (v->>'connections')::int < 1 or jsonb_array_length(v->'tables') not between 1 and 10
     or jsonb_array_length(v->'indexes') not between 1 and 10 or (v->'tables'->0->>'name') not like '%.%' then
    raise exception 'ops_database: %', v;
  end if;
  if v::text ilike '%select %' then raise exception 'ops_database returned query text'; end if;

  -- migrations
  v := diag.migrations_applied();
  if jsonb_typeof(v->'count') <> 'number' or not (v ? 'latest') then raise exception 'migrations_applied: %', v; end if;

  -- push
  v := diag.ops_push();
  if (v->>'pending')::int < 1 or v->>'oldestPendingAt' is null or (v->>'inboxOnly')::int < 1 or jsonb_typeof(v->'errors24h') <> 'array'
     or not exists (select 1 from jsonb_array_elements(v->'errors24h') x where x->>'code' = 'http_5xx')
     or v->'tokens' is null or v->'membersWithoutToken' is null then
    raise exception 'ops_push: %', v;
  end if;

  -- integrations
  v := diag.ops_integrations();
  if jsonb_typeof(v->'tokens'->'byScope') <> 'array' or jsonb_typeof(v->'webhooks'->'disabled') <> 'array'
     or v->'deviceGrants'->'pending' is null or v->'reviewLinks'->'active' is null or v->'tokens'->'total' is null then
    raise exception 'ops_integrations: %', v;
  end if;

  -- support: counts and ages, never who or what
  v := diag.ops_support();
  if (v->'reports'->>'open')::int < 1 or (v->'reports'->>'staffOnly')::int < 1 or v->'reports'->>'oldestAt' is null
     or v->'reports'->'resolvedWeek' is null or (v->'suspended'->>'total')::int < 1 or (v->'suspended'->>'week')::int < 1 then
    raise exception 'ops_support: %', v;
  end if;
  t := v::text;
  if t like '%0d000000-0000-0000-0000-00000000000a%' or t like '%0d000000-0000-0000-0000-00000000000b%'
     or t ilike '%secret details%' or t ilike '%reporter%' or t ilike '%reported%' then
    raise exception 'ops_support names someone: %', t;
  end if;

  -- lookup: the id and nothing else; trimmed and case-insensitive
  v := diag.lookup_email('  OPS-reporter@example.ORG ');
  if v <> jsonb_build_object('profileId', '0d000000-0000-0000-0000-00000000000b') or (select count(*) from jsonb_object_keys(v)) <> 1 then
    raise exception 'lookup_email: %', v;
  end if;
  if diag.lookup_email('nobody-at-all@example.org') is not null or diag.lookup_email(null) is not null then raise exception 'lookup of nobody should be null'; end if;

  -- limits
  v := diag.ops_limits();
  if (v->>'v2SignInFailures24h')::int < 1 or (v->>'installsAtDiagCap')::int < 1 then raise exception 'ops_limits: %', v; end if;

  -- sizes
  v := diag.ops_sizes();
  if (v->>'dbBytes')::bigint <= 0 or (v->>'eventsBytes')::bigint <= 0 or (v->>'eventsRows')::bigint < 0 or v->'snapshotsBytes' is null then
    raise exception 'ops_sizes: %', v;
  end if;
  begin
    perform public.ops_sizes();
    raise exception 'diag_reader should not run public.ops_sizes';
  exception when insufficient_privilege then null;
  end;

  -- and still no direct reads
  begin perform * from public.content_reports limit 1; raise exception 'diag_reader read content_reports';
  exception when insufficient_privilege then null; end;
  begin perform * from auth.users limit 1; raise exception 'diag_reader read auth.users';
  exception when insufficient_privilege then null; end;
  begin perform * from public.join_requests limit 1; raise exception 'diag_reader read join_requests';
  exception when insufficient_privilege then null; end;
  begin perform * from cron.job limit 1; raise exception 'diag_reader read cron.job';
  exception when insufficient_privilege then null; end;
  begin perform * from diag.feedback limit 1; raise exception 'diag_reader read diag.feedback';
  exception when insufficient_privilege then null; end;

  -- open feedback: counted, never read
  v := diag.ops_feedback_open();
  if (v->>'open')::int < 1 or v->>'oldestAt' is null or v::text ilike '%secret feedback%' then raise exception 'ops_feedback_open: %', v; end if;

  -- since when the counters run
  v := diag.ops_counts_since();
  if not (v ? 'statements') or v->>'database' is null then raise exception 'ops_counts_since: %', v; end if;
end $$;
reset role;
-- ops_limits and public.diag_ingest use one cap: diag_ingest's literal is the cap function's answer
-- (checked as the owner: diag_reader reaches the cap only through ops_limits, which runs as its definer).
do $$ begin
  if pg_get_functiondef('public.diag_ingest'::regproc) not like '%v_day_count >= ' || diag._ingest_day_cap() || '%' then
    raise exception 'diag_ingest no longer caps an install at diag._ingest_day_cap() (%) records a day', diag._ingest_day_cap();
  end if;
end $$;
-- ops_cron holds no job's command text (checked as the owner, who can read cron.job).
do $$ begin
  if exists (select 1 from cron.job j where length(j.command) > 12 and strpos(diag.ops_cron()::text, j.command) > 0) then
    raise exception 'ops_cron returned a command';
  end if;
end $$;

-- 2. The API roles may run none of them; the service role runs public.ops_sizes.
set role authenticated;
do $$ begin
  perform diag.ops_people();
  raise exception 'authenticated ran an ops function';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.ops_sizes();
  raise exception 'authenticated ran public.ops_sizes';
exception when insufficient_privilege then null;
end $$;
reset role;
set role service_role;
do $$ begin
  if (public.ops_sizes()->>'dbBytes')::bigint <= 0 then raise exception 'service ops_sizes'; end if;
end $$;
reset role;

-- 3. The job list knows the new jobs; an account_delete with no schedule is never stale.
do $$ begin
  if (select count(*) from diag.job_schedule where job in ('fold_canary', 'blob_reconcile', 'account_delete')) <> 3 then raise exception 'job_schedule rows'; end if;
  if (select every from diag.job_schedule where job = 'account_delete') is not null then raise exception 'account_delete should have no schedule'; end if;
end $$;

-- 4. Deleting an account leaves one run, with no id in it.
create temp table od_before as select count(*) as n, coalesce(max(id), 0) as max_id from diag.job_runs where job = 'account_delete';
select set_config('request.jwt.claim.sub', '0d000000-0000-0000-0000-00000000000b', true);
select public.delete_my_account();
do $$
declare r record; b record;
begin
  select * into b from od_before;
  if (select count(*) from diag.job_runs where job = 'account_delete') <> b.n + 1 then raise exception 'expected exactly one new account_delete run'; end if;
  select * into r from diag.job_runs where job = 'account_delete' and id > b.max_id;
  if r.outcome <> 'ok' or r.ms <> 0 or r.n <> '{}'::jsonb or r.org_id is not null or r.stream_id is not null or r.error_class is not null then
    raise exception 'account_delete run: %', r;
  end if;
  if r::text like '%0d000000%' or r::text ilike '%example.org%' or r::text like '%od-org%' then raise exception 'the run names the account: %', r; end if;
  if exists (select 1 from auth.users where id = '0d000000-0000-0000-0000-00000000000b') then raise exception 'account not deleted'; end if;
end $$;

rollback;
