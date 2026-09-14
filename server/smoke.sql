-- Exercises append_events / pull_events on a fresh local database.
-- Run via `npm run db:test`. Fails loudly on any unexpected result.

\set ON_ERROR_STOP on

-- Simulate an authenticated caller (no auth.uid() outside PostgREST).
select set_config('request.jwt.claim.sub', 'lead', false);

-- 1. Bootstrap: ProjectCreated + first owner in one batch.
select * from public.append_events('[
  {"id":"e1","type":"v1.ProjectCreated","orgId":"org1","projectId":"p1","actorId":"lead","deviceId":"dA","hlc":"000000000000001:000000:dA","payload":{"name":"Luke","sourceLanguoidId":"eng"}},
  {"id":"e2","type":"v1.MemberAdded","orgId":"org1","projectId":"p1","actorId":"lead","deviceId":"dA","hlc":"000000000000002:000000:dA","payload":{"profileId":"lead","role":"owner"}},
  {"id":"e3","type":"v1.MemberAdded","orgId":"org1","projectId":"p1","actorId":"lead","deviceId":"dA","hlc":"000000000000003:000000:dA","payload":{"profileId":"t1","role":"translator"}}
]'::jsonb);

do $$ begin
  if (select count(*) from public.events where project_id = 'p1') <> 3 then
    raise exception 'expected 3 events after bootstrap';
  end if;
  if public.member_role('org1','p1','lead') <> 'owner' then raise exception 'lead should be owner'; end if;
  if public.member_role('org1','p1','t1') <> 'translator' then raise exception 't1 should be translator'; end if;
end $$;

-- 2. Duplicate id is accepted idempotently with the same seq.
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"e3","type":"v1.MemberAdded","orgId":"org1","projectId":"p1","actorId":"lead","deviceId":"dA","hlc":"000000000000003:000000:dA","payload":{"profileId":"t1","role":"translator"}}
  ]'::jsonb);
  if not r.accepted or r.server_seq <> 3 or r.reason <> 'duplicate' then
    raise exception 'duplicate should be accepted with seq 3, got %', r;
  end if;
end $$;

-- 3. Translator may record but may not change config.
select set_config('request.jwt.claim.sub', 't1', false);
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"e4","type":"v1.RecordingAdded","orgId":"org1","projectId":"p1","actorId":"t1","deviceId":"dB","hlc":"000000000000004:000000:dB","payload":{"recordingId":"rec1","unitId":"u1","laneId":"L1","kind":"target","cards":[{"hash":"c1","durationMs":100}]}}
  ]'::jsonb);
  if not r.accepted then raise exception 'translator recording should be accepted: %', r.reason; end if;

  select * into r from public.append_events('[
    {"id":"e5","type":"v1.ProjectConfigChanged","orgId":"org1","projectId":"p1","actorId":"t1","deviceId":"dB","hlc":"000000000000005:000000:dB","payload":{"config":{}}}
  ]'::jsonb);
  if r.accepted then raise exception 'translator must not change config'; end if;
end $$;

-- 4. Non-member is rejected; actorId spoofing is rejected.
select set_config('request.jwt.claim.sub', 'stranger', false);
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"e6","type":"v1.RecordingAdded","orgId":"org1","projectId":"p1","actorId":"stranger","deviceId":"dX","hlc":"000000000000006:000000:dX","payload":{}}
  ]'::jsonb);
  if r.accepted or r.reason <> 'not a member' then raise exception 'stranger should be rejected, got %', r; end if;

  select * into r from public.append_events('[
    {"id":"e7","type":"v1.RecordingAdded","orgId":"org1","projectId":"p1","actorId":"t1","deviceId":"dX","hlc":"000000000000007:000000:dX","payload":{}}
  ]'::jsonb);
  if r.accepted then raise exception 'spoofed actorId should be rejected'; end if;
end $$;

-- 5. Pull after cursor is bounded and ordered; non-member cannot pull.
select set_config('request.jwt.claim.sub', 'lead', false);
do $$ declare n int; begin
  select count(*) into n from public.pull_events('org1','p1', 2, 10);
  if n <> 2 then raise exception 'expected 2 events after seq 2, got %', n; end if;
end $$;
select set_config('request.jwt.claim.sub', 'stranger', false);
do $$ begin
  begin
    perform * from public.pull_events('org1','p1', 0, 10);
    raise exception 'stranger pull should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 5b. Pulling a project that has no events yet is empty, not an error.
do $$ declare n int; begin
  select count(*) into n from public.pull_events('org1','nonexistent', 0, 10);
  if n <> 0 then raise exception 'empty project should pull 0 rows'; end if;
end $$;

-- 6. Append-only is enforced even for the table owner.
do $$ begin
  begin
    update public.events set hlc = 'x' where id = 'e1';
    raise exception 'update should have been refused';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.events where id = 'e1';
    raise exception 'delete should have been refused';
  exception when insufficient_privilege then null;
  end;
end $$;

select 'smoke ok' as result;
