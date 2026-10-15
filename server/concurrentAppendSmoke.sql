-- Two pushes of the same event at once (decisions.md 75, amended): a phone's
-- push timed out on a weak link and was retried while the first was still
-- being inserted. The second passes the first id check before the first
-- commits, then waits on the stream's lock; once it has the lock it must
-- answer the event as a duplicate with the first one's seq, not refuse it
-- for its entity id nor fail the batch on the events primary key.
--
-- The two pushes are separate sessions (dblink), so what they write
-- commits. Ids carry a tag unique to the run, which keeps it repeatable.
-- dblink lets only a superuser open a session without a password, so
-- db-test.mjs runs this file as supabase_admin; the two pushes still run
-- as postgres, like every other smoke's.
\set ON_ERROR_STOP on
create extension if not exists dblink with schema extensions;
select set_config('smoke.tag', substr(md5(clock_timestamp()::text), 1, 10), false);

-- An event of this run's organization, by its owner.
create function pg_temp.ev(p_id text, p_type text, p_stream text, p_clock int, p_payload jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id', 'ca-' || current_setting('smoke.tag') || '-' || p_id, 'type', p_type,
    'orgId', 'ca-org-' || current_setting('smoke.tag'), 'streamId', p_stream,
    'actorId', 'ca-owner-' || current_setting('smoke.tag'), 'deviceId', 'dC',
    'hlc', lpad(p_clock::text, 15, '0') || ':000000:dC', 'payload', p_payload);
$$;

-- The organization and its language, set up as the server would (an import), committed.
select set_config('request.jwt.claim.sub', '', false);
do $$ declare r record; begin
  for r in select * from public.append_events(jsonb_build_array(
    pg_temp.ev('o1', 'v1.OrgCreated', '_org', 1, '{"name":"Concurrent"}'),
    pg_temp.ev('o2', 'v1.RoleDefined', '_org', 2, '{"roleId":"admin","name":"Admin","privileges":["manage_roles","manage_structure","manage_templates","translate"]}'),
    pg_temp.ev('o3', 'v1.MemberAdded', '_org', 3, jsonb_build_object('profileId', 'ca-owner-' || current_setting('smoke.tag'),
      'roleId', 'admin', 'scope', jsonb_build_object('level', 'org'))),
    pg_temp.ev('o4', 'v1.LanguageAdded', '_org', 4, '{"languageId":"L","name":"Concurrentish","code":"fia","sourceCode":"eng"}')
  ), 2147483647) loop
    if not r.accepted then raise exception 'setup event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;

-- Push p_event from session A and hold its transaction open; push it again
-- from session B, which waits on A's lock; commit A. Both are accepted, as
-- one event with one seq.
create function pg_temp.race(p_event jsonb, p_what text) returns void language plpgsql as $$
declare
  v_push text := format('select id, accepted, server_seq, reason from public.append_events(%L::jsonb, 2147483647)', jsonb_build_array(p_event));
  v_as text := format('select set_config(''request.jwt.claim.sub'', %L, false)', p_event->>'actorId');
  v_pid int;
  v_waits boolean := false;
  a record; b record;
begin
  perform extensions.dblink_connect('ca_a', 'dbname=postgres user=postgres');
  perform extensions.dblink_connect('ca_b', 'dbname=postgres user=postgres');
  perform * from extensions.dblink('ca_a', v_as) as t(v text);
  perform * from extensions.dblink('ca_b', v_as) as t(v text);
  select pid into v_pid from extensions.dblink('ca_b', 'select pg_backend_pid()') as t(pid int);

  perform extensions.dblink_exec('ca_a', 'begin');
  select * into a from extensions.dblink('ca_a', v_push) as t(id text, accepted boolean, server_seq bigint, reason text);
  if not a.accepted or a.reason is not null then raise exception '%: the first push: %', p_what, a; end if;

  perform extensions.dblink_send_query('ca_b', v_push);
  -- Until B is blocked by A (pg_blocking_pids reads the lock table afresh each call), at most 10 s.
  for i in 1..1000 loop
    v_waits := cardinality(pg_blocking_pids(v_pid)) > 0;
    exit when v_waits;
    perform pg_sleep(0.01);
  end loop;
  if not v_waits then raise exception '%: the second push never waited on the first', p_what; end if;

  perform extensions.dblink_exec('ca_a', 'commit');
  select * into b from extensions.dblink_get_result('ca_b') as t(id text, accepted boolean, server_seq bigint, reason text);
  perform * from extensions.dblink_get_result('ca_b') as t(id text, accepted boolean, server_seq bigint, reason text);
  perform extensions.dblink_disconnect('ca_a');
  perform extensions.dblink_disconnect('ca_b');

  if not b.accepted or b.reason is distinct from 'duplicate' or b.server_seq is distinct from a.server_seq then
    raise exception '%: the second push, expected a duplicate at seq %, got %', p_what, a.server_seq, b;
  end if;
  if (select count(*) from public.events e where e.id = p_event->>'id') <> 1 then
    raise exception '%: stored other than once', p_what;
  end if;
end $$;

-- 1. An event with an entity key (a note's id): a duplicate, not 'note id ... is already used'.
select pg_temp.race(pg_temp.ev('note', 'v1.NoteAdded', 'L', 10,
  '{"noteId":"n1","unitId":"u1","anchor":{"kind":"passage"},"text":"once"}'), 'a note pushed twice at once');

-- 2. An event without one (a unit): a duplicate, not a unique violation that fails the batch.
select pg_temp.race(pg_temp.ev('unit', 'v1.UnitAdded', 'L', 11,
  '{"unitId":"u1","parentUnitId":null,"kind":"book","label":"Luke","order":"a0"}'), 'a unit pushed twice at once');

-- 3. The same on the organization stream, which also folds into its tables once.
select pg_temp.race(pg_temp.ev('rename', 'v1.OrgRenamed', '_org', 12, '{"name":"Concurrent, renamed"}'), 'a rename pushed twice at once');

drop extension dblink;
