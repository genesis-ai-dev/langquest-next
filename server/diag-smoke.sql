-- Field diagnostics (migration *_field_diagnostics.sql). Run by `npm run db:test`
-- after smoke.sql. Uses its own ids, so it also runs inside BEGIN ... ROLLBACK
-- against a local database that holds other data.

\set ON_ERROR_STOP on

update public.server_config set min_client_version = 0;

-- An org with one language, a lead and a translator.
select set_config('request.jwt.claim.sub', 'dg_lead', false);
do $$ declare r record; begin
  for r in select * from public.append_events('[
  {"id":"dg1","type":"v1.OrgCreated","orgId":"dg_org","projectId":"_org","actorId":"dg_lead","deviceId":"dg_dA","hlc":"000000000000101:000000:dg_dA","payload":{"name":"Diagnostics Test Org"}},
  {"id":"dg1a","type":"v1.RoleDefined","orgId":"dg_org","projectId":"_org","actorId":"dg_lead","deviceId":"dg_dA","hlc":"000000000000101:000001:dg_dA","payload":{"roleId":"org_admin","name":"Organization Admin","privileges":["manage_structure","invite_members","manage_roles","manage_templates","manage_reference","manage_flows","manage_teams","assign_work","translate","fill_reference","send_to_reviewers","review","view_status"]}},
  {"id":"dg1b","type":"v1.RoleDefined","orgId":"dg_org","projectId":"_org","actorId":"dg_lead","deviceId":"dg_dA","hlc":"000000000000101:000002:dg_dA","payload":{"roleId":"translator","name":"Translator","privileges":["translate","fill_reference","send_to_reviewers","view_status"]}},
  {"id":"dg2","type":"v1.OrgMemberAdded","orgId":"dg_org","projectId":"_org","actorId":"dg_lead","deviceId":"dg_dA","hlc":"000000000000102:000000:dg_dA","payload":{"profileId":"dg_lead","roleId":"org_admin","scope":{"level":"org"}}},
  {"id":"dg3","type":"v1.ProjectRegistered","orgId":"dg_org","projectId":"_org","actorId":"dg_lead","deviceId":"dg_dA","hlc":"000000000000103:000000:dg_dA","payload":{"projectId":"dg_lang","name":"Dinka Test"}},
  {"id":"dg4","type":"v1.OrgMemberAdded","orgId":"dg_org","projectId":"_org","actorId":"dg_lead","deviceId":"dg_dA","hlc":"000000000000104:000000:dg_dA","payload":{"profileId":"dg_t1","roleId":"translator","scope":{"level":"org"}}}
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
      jsonb_build_object('id', 'dgr1', 'kind', 'sync', 'at', v_now - 60000, 'orgId', 'dg_org', 'projectId', 'dg_lang',
        'n', jsonb_build_object('ms', 5000.4, 'pullNetMs', 4000, 'secret', 1), 't', jsonb_build_object('outcome', 'ok', 'note', 'free text')),
      jsonb_build_object('id', 'dgr2', 'kind', 'transfer', 'at', v_now - 50000, 'orgId', 'dg_org', 'projectId', 'dg_lang',
        'n', jsonb_build_object('count', 3, 'bytes', 300000, 'ms', 30000, 'verifyMs', 20000), 't', jsonb_build_object('dir', 'down')),
      jsonb_build_object('id', 'dgr3', 'kind', 'error', 'at', v_now - 40000,
        'stack', E'TypeError: cannot read "In the beginning"\n    at save (/Users/someone/app/recording.ts:10:5)',
        't', jsonb_build_object('name', 'TypeError', 'where', 'screen passage', 'errorId', 'E-DGTST1', 'fatal', 'no')),
      jsonb_build_object('id', 'dgr4', 'kind', 'load', 'at', v_now - 30000, 'orgId', 'someone_elses_org', 'projectId', 'p', 'n', jsonb_build_object('ms', 10)),
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
  if r.org_id is not null or r.project_id is not null then raise exception 'filed under an org the caller is not in'; end if;
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

-- 3. The report functions answer "a translator in this language".
do $$
declare v jsonb;
begin
  if not exists (select 1 from diag.find('Dinka Test') where kind = 'language' and org_id = 'dg_org' and project_id = 'dg_lang') then
    raise exception 'find by language name failed';
  end if;
  if not exists (select 1 from diag.find('Diagnostics Test') where kind = 'org' and org_id = 'dg_org') then
    raise exception 'find by org name failed';
  end if;
  v := diag.partition_health('dg_org', 'dg_lang', 6);
  if v->'events' is null or v->'snapshots' <> '[]'::jsonb then raise exception 'partition_health: %', v; end if;
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

select set_config('request.jwt.claim.sub', '', false);
\echo 'diag-smoke ok'
