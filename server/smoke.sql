-- Exercises append_events / pull_events on a fresh local database.
-- Run via `npm run db:test`. Fails loudly on any unexpected result.

\set ON_ERROR_STOP on

-- Legacy calls below omit p_client_version; allow them, the version check has its own section (5h).
update public.server_config set min_client_version = 0;

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
    {"id":"e6","type":"v1.RecordingAdded","orgId":"org1","projectId":"p1","actorId":"stranger","deviceId":"dX","hlc":"000000000000006:000000:dX","payload":{"recordingId":"unauthorized","unitId":"u1","laneId":"L1","kind":"target","cards":[{"hash":"c1","durationMs":100}]}}
  ]'::jsonb);
  if r.accepted or r.reason <> 'not a member' then raise exception 'stranger should be rejected, got %', r; end if;

  select * into r from public.append_events('[
    {"id":"e7","type":"v1.RecordingAdded","orgId":"org1","projectId":"p1","actorId":"t1","deviceId":"dX","hlc":"000000000000007:000000:dX","payload":{"recordingId":"unauthorized","unitId":"u1","laneId":"L1","kind":"target","cards":[{"hash":"c1","durationMs":100}]}}
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

-- 5c. Clients cannot forge a blob confirmation, but a storage object lands one.
select set_config('request.jwt.claim.sub', 'lead', false);
do $$ declare r record; n int; begin
  select * into r from public.append_events('[
    {"id":"forged","type":"v1.BlobStored","orgId":"org1","projectId":"p1","actorId":"lead","deviceId":"dA","hlc":"000000000000009:000000:dA","payload":{"hash":"h1","size":1}}
  ]'::jsonb);
  if r.accepted then raise exception 'client must not emit BlobStored'; end if;

  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('blobs', 'org1/p1/abc123.wav', null, '{"size": 4321}'::jsonb);
  select count(*) into n from public.events e
    where e.project_id = 'p1' and e.type = 'v1.BlobStored' and e.payload->>'hash' = 'abc123' and (e.payload->>'size')::int = 4321;
  if n <> 1 then raise exception 'storage insert should append one BlobStored, got %', n; end if;

  -- A second insert of the same object name (re-upload) must not duplicate it.
  begin
    insert into storage.objects (bucket_id, name, owner, metadata)
    values ('blobs', 'org1/p1/abc123.wav', null, '{"size": 4321}'::jsonb);
  exception when unique_violation then null;
  end;
  select count(*) into n from public.events e where e.project_id = 'p1' and e.type = 'v1.BlobStored';
  if n <> 1 then raise exception 'BlobStored must be idempotent'; end if;

  -- An upsert that changed the bytes (different size) re-confirms with the new size.
  update storage.objects set metadata = '{"size": 5000}'::jsonb where bucket_id = 'blobs' and name = 'org1/p1/abc123.wav';
  select count(*) into n from public.events e where e.project_id = 'p1' and e.type = 'v1.BlobStored' and (e.payload->>'size')::int = 5000;
  if n <> 1 then raise exception 'size change should re-confirm, got %', n; end if;
  -- Same size again: no new event.
  update storage.objects set metadata = '{"size": 5000, "x": 1}'::jsonb where bucket_id = 'blobs' and name = 'org1/p1/abc123.wav';
  select count(*) into n from public.events e where e.project_id = 'p1' and e.type = 'v1.BlobStored';
  if n <> 2 then raise exception 'same size must not re-confirm, got %', n; end if;
end $$;

-- 5c2. Reconciler verdicts: service only; clients cannot forge BlobInvalidated.
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"forgedinv","type":"v1.BlobInvalidated","orgId":"org1","projectId":"p1","actorId":"lead","deviceId":"dA","hlc":"000000000000009:000001:dA","payload":{"hash":"abc123"}}
  ]'::jsonb, 1);
  if r.accepted then raise exception 'client must not emit BlobInvalidated'; end if;
  begin
    perform public.invalidate_blob('org1', 'p1', 'abc123', 'x');
    raise exception 'member must not call invalidate_blob';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', '', false);
do $$ declare n int; begin
  if not public.invalidate_blob('org1', 'p1', 'abc123', 'hash mismatch') then raise exception 'invalidate should append'; end if;
  if not public.record_blob('org1', 'p1', 'zzz', 7) then raise exception 'record_blob should append'; end if;
  if public.record_blob('org1', 'p1', 'zzz', 7) then raise exception 'record_blob must be idempotent'; end if;
  select count(*) into n from public.events e where e.project_id = 'p1' and e.type = 'v1.BlobInvalidated';
  if n <> 1 then raise exception 'expected one BlobInvalidated, got %', n; end if;
end $$;
select set_config('request.jwt.claim.sub', 'lead', false);

-- 5d. Malformed payloads are refused at the door (the log cannot be edited later).
select set_config('request.jwt.claim.sub', 't1', false);
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"bad1","type":"v1.RecordingAdded","orgId":"org1","projectId":"p1","actorId":"t1","deviceId":"dB","hlc":"000000000000010:000000:dB","payload":{"recordingId":"recX","unitId":"u1","laneId":"L1","kind":"target"}}
  ]'::jsonb);
  if r.accepted or r.reason not like 'invalid payload%' then raise exception 'missing cards should be refused, got %', r; end if;
  select * into r from public.append_events('[
    {"id":"bad2","type":"v1.TakeComposed","orgId":"org1","projectId":"p1","actorId":"t1","deviceId":"dB","hlc":"000000000000011:000000:dB","payload":"nope"}
  ]'::jsonb);
  if r.accepted then raise exception 'non-object payload should be refused'; end if;
end $$;

-- 5e. Oversized batches are refused outright; clients must page.
do $$ begin
  begin
    perform * from public.append_events((select jsonb_agg(jsonb_build_object(
      'id', 'big' || i, 'type', 'v1.TakeArchived', 'orgId', 'org1', 'projectId', 'p1', 'actorId', 't1',
      'deviceId', 'dB', 'hlc', '000000000000012:' || lpad(i::text, 6, '0') || ':dB', 'payload', jsonb_build_object('takeId', 'x')))
      from generate_series(1, 501) i));
    raise exception 'batch of 501 should have been refused';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- 5f. Redaction: owners may, translators may not.
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"rd0","type":"v1.Redacted","orgId":"org1","projectId":"p1","actorId":"t1","deviceId":"dB","hlc":"000000000000013:000000:dB","payload":{"eventId":"e4"}}
  ]'::jsonb);
  if r.accepted then raise exception 'translator must not redact'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'lead', false);
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"rd1","type":"v1.Redacted","orgId":"org1","projectId":"p1","actorId":"lead","deviceId":"dA","hlc":"000000000000014:000000:dA","payload":{"eventId":"e4","reason":"wrong passage"}}
  ]'::jsonb);
  if not r.accepted then raise exception 'owner redaction should be accepted: %', r.reason; end if;
end $$;

-- 5g. Snapshots: service writes, members read newest for their version, strangers cannot.
select set_config('request.jwt.claim.sub', '', false);
select public.put_snapshot('org1', 'p1', 1, 3, '{"v":"old"}'::jsonb);
select public.put_snapshot('org1', 'p1', 1, 5, '{"v":"new"}'::jsonb);
do $$ declare n int; begin
  select count(*) into n from public.snapshots where project_id = 'p1';
  if n <> 1 then raise exception 'put_snapshot should keep one row per version, got %', n; end if;
end $$;
select set_config('request.jwt.claim.sub', 'lead', false);
do $$ declare r record; begin
  select * into r from public.get_snapshot('org1', 'p1', 1);
  if r.server_seq <> 5 or r.state->>'v' <> 'new' then raise exception 'get_snapshot should return the newest, got %', r; end if;
  if (select count(*) from public.get_snapshot('org1', 'p1', 2)) <> 0 then raise exception 'other reducer version must be empty'; end if;
  begin
    perform public.put_snapshot('org1', 'p1', 1, 9, '{}'::jsonb);
    raise exception 'members must not write snapshots';
  exception when insufficient_privilege then null;
  end;
end $$;
-- Chunked read reassembles to the stored state exactly.
do $$ declare m record; v_text text := ''; i int; begin
  select * into m from public.get_snapshot_meta('org1', 'p1', 1);
  if m.server_seq <> 5 or m.chunks <> 1 then raise exception 'meta wrong: %', m; end if;
  for i in 0 .. m.chunks - 1 loop
    v_text := v_text || public.get_snapshot_chunk('org1', 'p1', 1, 5, i);
  end loop;
  if v_text::jsonb <> '{"v":"new"}'::jsonb then raise exception 'chunks do not reassemble: %', v_text; end if;
  if public.get_snapshot_chunk('org1', 'p1', 1, 4, 0) is not null then raise exception 'wrong seq must be null'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'stranger', false);
do $$ begin
  begin
    perform * from public.get_snapshot_meta('org1', 'p1', 1);
    raise exception 'stranger meta read should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.get_snapshot('org1', 'p1', 1);
    raise exception 'stranger snapshot read should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', 'lead', false);

-- 5h. All client versions can transport events. The global gate cannot return.
do $$ begin
  perform * from public.pull_events('org1', 'p1', 0, 10, 0);
  perform * from public.pull_events('org1', 'p1', 0, 10, null);
  perform * from public.append_events('[]'::jsonb, 1);
  begin
    update public.server_config set min_client_version = 2;
    raise exception 'Global sync gate was re-enabled';
  exception when check_violation then null;
  end;
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

-- 7. Long-offline liabilities (docs/flow-coverage-audit.md L1, L2, L10).
-- 7a. The memberships row equals the fold, and member_role reads it.
select set_config('request.jwt.claim.sub', 'lead', false);
do $$ declare m record; begin
  select * into m from public.memberships where org_id = 'org1' and project_id = 'p1' and profile_id = 't1';
  if m.role <> 'translator' or m.removed then raise exception 'memberships row wrong: %', m; end if;
  if public.member_role('org1','p1','t1') <> 'translator' then raise exception 'member_role should read the row'; end if;
end $$;

-- 7b. Clock ahead: refused with server time in the reason; nothing stored.
do $$ declare r record; begin
  select * into r from public.append_events(format('[
    {"id":"e7b","type":"v1.LaneAdded","orgId":"org1","projectId":"p1","actorId":"lead","deviceId":"dA","hlc":"%s:000000:dA","payload":{"laneId":"L9","languoidId":"x"}}
  ]', lpad(((extract(epoch from now()) * 1000)::bigint + 3600000)::text, 15, '0'))::jsonb);
  if r.accepted or r.reason not like 'clock ahead: server time %' then raise exception 'clock-ahead should be refused, got %', r; end if;
  if exists (select 1 from public.events where id = 'e7b') then raise exception 'refused event must not be stored'; end if;
end $$;

-- 7c. As-of authorization: t1 is removed now, but work stamped while they
--     were a member is accepted; work stamped after removal is not.
do $$ declare r record; begin
  select * into r from public.append_events(format('[
    {"id":"e7c0","type":"v1.MemberRemoved","orgId":"org1","projectId":"p1","actorId":"lead","deviceId":"dA","hlc":"%s:000000:dA","payload":{"profileId":"t1"}}
  ]', lpad(((extract(epoch from now()) * 1000)::bigint - 86400000)::text, 15, '0'))::jsonb);
  if not r.accepted then raise exception 'removal should be accepted: %', r.reason; end if;
  if public.member_role('org1','p1','t1') is not null then raise exception 't1 should be removed now'; end if;
end $$;
select set_config('request.jwt.claim.sub', 't1', false);
do $$ declare r record; v_before text; v_after text; begin
  v_before := lpad(((extract(epoch from now()) * 1000)::bigint - 2 * 86400000)::text, 15, '0');
  v_after := lpad(((extract(epoch from now()) * 1000)::bigint - 60000)::text, 15, '0');
  select * into r from public.append_events(format('[
    {"id":"e7c1","type":"v1.TakeSubmitted","orgId":"org1","projectId":"p1","actorId":"t1","deviceId":"dB","hlc":"%s:000000:dB","payload":{"takeId":"take-old"}}
  ]', v_before)::jsonb);
  if not r.accepted then raise exception 'work stamped before removal should be accepted as-of: %', r.reason; end if;
  select * into r from public.append_events(format('[
    {"id":"e7c2","type":"v1.TakeSubmitted","orgId":"org1","projectId":"p1","actorId":"t1","deviceId":"dB","hlc":"%s:000000:dB","payload":{"takeId":"take-new"}}
  ]', v_after)::jsonb);
  if r.accepted or r.reason <> 'not a member' then raise exception 'work stamped after removal should be refused, got %', r; end if;
end $$;
-- 7d. Re-admission: the row flips back and current work is accepted again.
select set_config('request.jwt.claim.sub', 'lead', false);
select * from public.append_events(format('[
  {"id":"e7d0","type":"v1.MemberAdded","orgId":"org1","projectId":"p1","actorId":"lead","deviceId":"dA","hlc":"%s:000000:dA","payload":{"profileId":"t1","role":"translator"}}
]', lpad(((extract(epoch from now()) * 1000)::bigint - 30000)::text, 15, '0'))::jsonb);
select set_config('request.jwt.claim.sub', 't1', false);
do $$ declare r record; begin
  if public.member_role('org1','p1','t1') <> 'translator' then raise exception 't1 should be a translator again'; end if;
  select * into r from public.append_events(format('[
    {"id":"e7c2","type":"v1.TakeSubmitted","orgId":"org1","projectId":"p1","actorId":"t1","deviceId":"dB","hlc":"%s:000000:dB","payload":{"takeId":"take-new"}}
  ]', lpad(((extract(epoch from now()) * 1000)::bigint - 60000)::text, 15, '0'))::jsonb);
  if not r.accepted then raise exception 're-pushed work after re-admission should be accepted: %', r.reason; end if;
end $$;
select set_config('request.jwt.claim.sub', 'lead', false);

-- 8. Org partition and privilege roles (docs/flow-coverage-audit.md 5.A, 5.C).
-- 8a. Bootstrap the org: creator, seed roles, creator's own admin membership.
select set_config('request.jwt.claim.sub', 'lead', false);
do $$ declare r record; n int := 0; begin
  for r in select * from public.append_events('[
    {"id":"o1","type":"v1.OrgCreated","orgId":"org1","projectId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000101:000000:dA","payload":{"name":"Wycliffe"}},
    {"id":"o2","type":"v1.RoleDefined","orgId":"org1","projectId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000102:000000:dA","payload":{"roleId":"org_admin","name":"Organization Admin","privileges":["manage_structure","invite_members","manage_roles","manage_templates","manage_reference","manage_flows","manage_teams","assign_work","translate","fill_reference","send_to_reviewers","review","view_status"]}},
    {"id":"o3","type":"v1.RoleDefined","orgId":"org1","projectId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000103:000000:dA","payload":{"roleId":"lang_lead","name":"Team Leader","privileges":["assign_work","manage_teams","translate","review","view_status"]}},
    {"id":"o4","type":"v1.OrgMemberAdded","orgId":"org1","projectId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000104:000000:dA","payload":{"profileId":"lead","roleId":"org_admin","scope":{"level":"org"},"displayName":"Lead"}},
    {"id":"o5","type":"v1.ProjectRegistered","orgId":"org1","projectId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000105:000000:dA","payload":{"projectId":"p2","name":"Ruth"}},
    {"id":"o6","type":"v1.CatalogItemToggled","orgId":"org1","projectId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000106:000000:dA","payload":{"kind":"flow","itemId":"quick_check","level":"org","enabled":false}}
  ]'::jsonb) loop
    if not r.accepted then raise exception 'org bootstrap event % refused: %', r.id, r.reason; end if;
    n := n + 1;
  end loop;
  if n <> 6 then raise exception 'expected 6 org events'; end if;
  if (select privileges from public.org_roles where org_id = 'org1' and role_id = 'lang_lead') <> '{assign_work,manage_teams,translate,review,view_status}'::text[] then raise exception 'org_roles row wrong'; end if;
  if (select role_id from public.org_memberships where org_id = 'org1' and profile_id = 'lead' and scope_key = 'org') <> 'org_admin' then raise exception 'org_memberships row wrong'; end if;
  if public.member_role('org1', 'p2', 'lead') <> 'owner' then raise exception 'org admin should be effective owner of any project, got %', public.member_role('org1','p2','lead'); end if;
end $$;

-- 8b. An org admin creates a project the org governs, with no project-level MemberAdded.
do $$ declare r record; begin
  for r in select * from public.append_events('[
    {"id":"p2e1","type":"v1.ProjectCreated","orgId":"org1","projectId":"p2","actorId":"lead","deviceId":"dA","hlc":"000000000000110:000000:dA","payload":{"name":"Ruth","sourceLanguoidId":"eng"}},
    {"id":"p2e2","type":"v1.LaneAdded","orgId":"org1","projectId":"p2","actorId":"lead","deviceId":"dA","hlc":"000000000000111:000000:dA","payload":{"laneId":"din","languoidId":"din"}},
    {"id":"p2e3","type":"v1.LaneAdded","orgId":"org1","projectId":"p2","actorId":"lead","deviceId":"dA","hlc":"000000000000112:000000:dA","payload":{"laneId":"nus","languoidId":"nus"}}
  ]'::jsonb) loop
    if not r.accepted then raise exception 'org admin project event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;

-- 8c. A lane-scoped team leader may assign in their lane only; a stranger may not touch the org.
select * from public.append_events('[
  {"id":"o7","type":"v1.OrgMemberAdded","orgId":"org1","projectId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000113:000000:dA","payload":{"profileId":"akol","roleId":"lang_lead","scope":{"level":"lane","projectId":"p2","laneId":"din"}}}
]'::jsonb);
select set_config('request.jwt.claim.sub', 'akol', false);
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"p2e4","type":"v1.AssignmentMade","orgId":"org1","projectId":"p2","actorId":"akol","deviceId":"dB","hlc":"000000000000114:000000:dB","payload":{"unitId":"u1","laneId":"din","profileId":"t1","role":"translator"}}
  ]'::jsonb);
  if not r.accepted then raise exception 'lane admin should assign in own lane: %', r.reason; end if;
  select * into r from public.append_events('[
    {"id":"p2e5","type":"v1.AssignmentMade","orgId":"org1","projectId":"p2","actorId":"akol","deviceId":"dB","hlc":"000000000000115:000000:dB","payload":{"unitId":"u1","laneId":"nus","profileId":"t1","role":"translator"}}
  ]'::jsonb);
  if r.accepted then raise exception 'lane admin must not assign in another lane'; end if;
  select * into r from public.append_events('[
    {"id":"o8","type":"v1.RoleDefined","orgId":"org1","projectId":"_org","actorId":"akol","deviceId":"dB","hlc":"000000000000116:000000:dB","payload":{"roleId":"sneaky","name":"Sneaky","privileges":["manage_roles"]}}
  ]'::jsonb);
  if r.accepted then raise exception 'lane admin must not define org roles'; end if;
  perform * from public.pull_events('org1', '_org', 0, 10);
  perform * from public.pull_events('org1', 'p2', 0, 10);
end $$;
select set_config('request.jwt.claim.sub', 'stranger', false);
do $$ declare r record; begin
  begin
    perform * from public.pull_events('org1', '_org', 0, 10);
    raise exception 'stranger must not pull the org partition';
  exception when insufficient_privilege then null;
  end;
  select * into r from public.append_events('[
    {"id":"o9","type":"v1.OrgMemberAdded","orgId":"org1","projectId":"_org","actorId":"stranger","deviceId":"dX","hlc":"000000000000117:000000:dX","payload":{"profileId":"stranger","roleId":"org_admin","scope":{"level":"org"}}}
  ]'::jsonb);
  if r.accepted or r.reason <> 'not a member' then raise exception 'stranger must not join an org that has members, got %', r; end if;
end $$;

-- 8d. Invalid org payloads are refused at the door.
select set_config('request.jwt.claim.sub', 'lead', false);
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"o10","type":"v1.RoleDefined","orgId":"org1","projectId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000118:000000:dA","payload":{"roleId":"x","name":"X","privileges":["fly"]}}
  ]'::jsonb);
  if r.accepted or r.reason not like 'invalid payload:%' then raise exception 'unknown privilege should be refused, got %', r; end if;
  select * into r from public.append_events('[
    {"id":"o11","type":"v1.OrgMemberAdded","orgId":"org1","projectId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000119:000000:dA","payload":{"profileId":"x","roleId":"org_admin","scope":{"level":"lane","projectId":"p2"}}}
  ]'::jsonb);
  if r.accepted or r.reason not like 'invalid payload:%' then raise exception 'lane scope without laneId should be refused, got %', r; end if;
end $$;

-- 9. Step 11: catalog selection, step registers, teams, respond loop.
select set_config('request.jwt.claim.sub', 'lead', false);
do $$ declare r record; begin
  for r in select * from public.append_events('[
    {"id":"s1","type":"v1.LaneTemplateSelected","orgId":"org1","projectId":"p2","actorId":"lead","deviceId":"dA","hlc":"000000000000201:000000:dA","payload":{"laneId":"din","templateId":"fia","catalogVersion":1}},
    {"id":"s2","type":"v1.UnitAdded","orgId":"org1","projectId":"p2","actorId":"lead","deviceId":"dA","hlc":"000000000000202:000000:dA","payload":{"unitId":"fia@1/gen","parentUnitId":null,"kind":"book","label":"Genesis","order":"b0000"}},
    {"id":"s3","type":"v1.LaneFlowSelected","orgId":"org1","projectId":"p2","actorId":"lead","deviceId":"dA","hlc":"000000000000203:000000:dA","payload":{"laneId":"din","flowId":"quick_check","catalogVersion":1}},
    {"id":"s4","type":"v1.WorkflowStepSet","orgId":"org1","projectId":"p2","actorId":"lead","deviceId":"dA","hlc":"000000000000204:000000:dA","payload":{"stepId":"quick_check@1/peer_review","laneId":"din","order":"s00","role":"reviewer","required":true,"rule":"any"}},
    {"id":"s5","type":"v1.WorkflowStepRemoved","orgId":"org1","projectId":"p2","actorId":"lead","deviceId":"dA","hlc":"000000000000205:000000:dA","payload":{"stepId":"old"}},
    {"id":"s6","type":"v1.ReviewTeamDefined","orgId":"org1","projectId":"p2","actorId":"lead","deviceId":"dA","hlc":"000000000000206:000000:dA","payload":{"teamId":"team1","laneId":"din","name":"Community"}},
    {"id":"s7","type":"v1.ReviewTeamMemberSet","orgId":"org1","projectId":"p2","actorId":"lead","deviceId":"dA","hlc":"000000000000207:000000:dA","payload":{"teamId":"team1","profileId":"r1","member":true}}
  ]'::jsonb) loop
    if not r.accepted then raise exception 'step 11 event % refused: %', r.id, r.reason; end if;
  end loop;
  select * into r from public.append_events('[
    {"id":"s8","type":"v1.WorkflowStepSet","orgId":"org1","projectId":"p2","actorId":"lead","deviceId":"dA","hlc":"000000000000208:000000:dA","payload":{"stepId":"x","laneId":"din","order":"s00","role":"reviewer","required":true,"rule":"sometimes"}}
  ]'::jsonb);
  if r.accepted or r.reason not like 'invalid payload:%' then raise exception 'bad quorum rule should be refused, got %', r; end if;
end $$;
-- Translator may respond; reviewer may leave a spoken comment; neither may select a template.
select set_config('request.jwt.claim.sub', 't1', false);
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"s9","type":"v1.ResponseRecorded","orgId":"org1","projectId":"p1","actorId":"t1","deviceId":"dB","hlc":"000000000000209:000000:dB","payload":{"takeId":"take-new","respondsToTakeId":"take-old","note":"kept card 1"}}
  ]'::jsonb);
  if not r.accepted then raise exception 'translator response should be accepted: %', r.reason; end if;
  select * into r from public.append_events('[
    {"id":"s10","type":"v1.LaneTemplateSelected","orgId":"org1","projectId":"p1","actorId":"t1","deviceId":"dB","hlc":"000000000000210:000000:dB","payload":{"laneId":"L1","templateId":"fia","catalogVersion":1}}
  ]'::jsonb);
  if r.accepted then raise exception 'translator must not select templates'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'lead', false);

-- 10. Step 12: materials and key terms.
select set_config('request.jwt.claim.sub', 't1', false);
do $$ declare r record; begin
  for r in select * from public.append_events('[
    {"id":"m1","type":"v1.MaterialDefined","orgId":"org1","projectId":"p1","actorId":"t1","deviceId":"dB","hlc":"000000000000301:000000:dB","payload":{"materialId":"q-u1","kind":"questions","title":"Unit 1 questions","scope":{"laneId":"L1","unitId":"u1"}}},
    {"id":"m2","type":"v1.MaterialFieldSet","orgId":"org1","projectId":"p1","actorId":"t1","deviceId":"dB","hlc":"000000000000302:000000:dB","payload":{"materialId":"q-u1","fieldId":"q1","text":"Is it clear?"}},
    {"id":"m3","type":"v1.KeyTermDefined","orgId":"org1","projectId":"p1","actorId":"t1","deviceId":"dB","hlc":"000000000000303:000000:dB","payload":{"termId":"kt1","laneId":"L1","term":"Word","gloss":"Logos","unitScope":["u1"]}},
    {"id":"m4","type":"v1.KeyTermLinked","orgId":"org1","projectId":"p1","actorId":"t1","deviceId":"dB","hlc":"000000000000304:000000:dB","payload":{"takeId":"take-new","termId":"kt1","note":"divine sense"}}
  ]'::jsonb) loop
    if not r.accepted then raise exception 'translator material event % refused: %', r.id, r.reason; end if;
  end loop;
  select * into r from public.append_events('[
    {"id":"m5","type":"v1.MaterialDefined","orgId":"org1","projectId":"p1","actorId":"t1","deviceId":"dB","hlc":"000000000000305:000000:dB","payload":{"materialId":"tmf","kind":"tmf","title":"TMF","scope":{}}}
  ]'::jsonb);
  if r.accepted then raise exception 'translator must not define managed material (org privilege path)'; end if;
  select * into r from public.append_events('[
    {"id":"m6","type":"v1.MaterialLocked","orgId":"org1","projectId":"p1","actorId":"t1","deviceId":"dB","hlc":"000000000000306:000000:dB","payload":{"materialId":"q-u1","locked":true}}
  ]'::jsonb);
  if r.accepted then raise exception 'translator must not lock material'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'lead', false);
do $$ declare r record; begin
  for r in select * from public.append_events('[
    {"id":"m7","type":"v1.MaterialLocked","orgId":"org1","projectId":"p1","actorId":"lead","deviceId":"dA","hlc":"000000000000307:000000:dA","payload":{"materialId":"q-u1","locked":true}},
    {"id":"m8","type":"v1.StepQuestionSetLinked","orgId":"org1","projectId":"p1","actorId":"lead","deviceId":"dA","hlc":"000000000000308:000000:dA","payload":{"stepId":"community","materialId":"q-u1"}}
  ]'::jsonb) loop
    if not r.accepted then raise exception 'lead material event % refused: %', r.id, r.reason; end if;
  end loop;
  select * into r from public.append_events('[
    {"id":"m9","type":"v1.KeyTermDefined","orgId":"org1","projectId":"p1","actorId":"lead","deviceId":"dA","hlc":"000000000000309:000000:dA","payload":{"termId":"kt2","laneId":"L1","term":"Spirit","gloss":"x","unitScope":"u1"}}
  ]'::jsonb);
  if r.accepted or r.reason not like 'invalid payload:%' then raise exception 'unitScope must be an array, got %', r; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Invites and join requests (docs/flow-coverage-audit.md 5.B).
-- The org partition exists from section 6; 'lead' holds org_admin there.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'lead', false);
do $$
declare
  v_org text;
  v_hash text := encode(extensions.digest('tok-secret-1', 'sha256'), 'hex');
  n int;
begin
  -- A member with invite_members may issue; the token itself never lands.
  perform public.issue_invite('org1', 'inv1', v_hash, 'lang_lead',
    '{"level":"org"}'::jsonb, now() + interval '7 days');
  select count(*) into n from public.invites where id = 'inv1' and org_id = 'org1';
  if n <> 1 then raise exception 'invite row missing'; end if;
  select count(*) into n from public.events
    where project_id = '_org' and type = 'v1.InviteIssued' and payload->>'inviteId' = 'inv1';
  if n <> 1 then raise exception 'InviteIssued not appended'; end if;
  select count(*) into n from public.events
    where project_id = '_org' and payload::text like '%tok-secret-1%';
  if n <> 0 then raise exception 'the token reached the log'; end if;

  -- An unknown role is refused, so an invite cannot grant something undefined.
  begin
    perform public.issue_invite('org1', 'inv-bad', 'h2', 'no_such_role', '{"level":"org"}'::jsonb, now() + interval '1 day');
    raise exception 'unknown role was accepted';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- A translator holds no invite_members privilege and may not issue.
select set_config('request.jwt.claim.sub', 't1', false);
do $$
begin
  begin
    perform public.issue_invite('org1', 'inv2', 'h3', 'lang_lead', '{"level":"org"}'::jsonb, now() + interval '1 day');
    raise exception 'translator issued an invite';
  exception when sqlstate '42501' then null;
  end;
end $$;

-- A stranger redeems, and becomes a member without ever being granted anything by themselves.
select set_config('request.jwt.claim.sub', 'newbie', false);
do $$
declare v_org text; n int; v_actor text;
begin
  v_org := public.redeem_invite('tok-secret-1');
  if v_org <> 'org1' then raise exception 'redeem returned %', v_org; end if;
  if public.member_role('org1', 'p1', 'newbie') is null then raise exception 'membership not granted'; end if;
  select actor_id into v_actor from public.events
    where project_id = '_org' and type = 'v1.OrgMemberAdded' and payload->>'profileId' = 'newbie';
  if v_actor <> 'service' then raise exception 'membership granted under actor %, not service', v_actor; end if;
  select count(*) into n from public.events
    where project_id = '_org' and type = 'v1.InviteRedeemed' and payload->>'inviteId' = 'inv1';
  if n <> 1 then raise exception 'InviteRedeemed not appended'; end if;

  -- Once only, and a wrong token says the same thing as a used one.
  begin
    perform public.redeem_invite('tok-secret-1');
    raise exception 'invite redeemed twice';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.redeem_invite('not-a-token');
    raise exception 'bogus token accepted';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- No client may forge a redemption through the normal append path.
do $$
declare r record;
begin
  select * into r from public.append_events('[
    {"id":"forge1","type":"v1.InviteRedeemed","orgId":"org1","projectId":"_org","actorId":"newbie","deviceId":"dZ","hlc":"000000000000400:000000:dZ","payload":{"inviteId":"inv1","profileId":"newbie"}}
  ]'::jsonb);
  if r.accepted then raise exception 'a client forged InviteRedeemed'; end if;
end $$;

-- Join requests: a non-member asks, a member decides.
select set_config('request.jwt.claim.sub', 'asker', false);
do $$
declare n int;
begin
  perform public.create_join_request('org1', 'req1', 'please let me in');
  select count(*) into n from public.join_requests where id = 'req1';
  if n <> 1 then raise exception 'join request not stored'; end if;
  -- Nothing reaches the log until someone decides.
  select count(*) into n from public.events where project_id = '_org' and type = 'v1.JoinDecided';
  if n <> 0 then raise exception 'a request wrote to the log'; end if;
  -- An asker cannot admit themselves.
  begin
    perform public.decide_join_request('req1', true, 'org_admin');
    raise exception 'asker admitted themselves';
  exception when sqlstate '42501' then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', 'lead', false);
do $$
declare n int;
begin
  -- Accepting without a role is refused: a membership needs one.
  begin
    perform public.decide_join_request('req1', true, null);
    raise exception 'accepted with no role';
  exception when sqlstate '22023' then null;
  end;
  perform public.decide_join_request('req1', true, 'lang_lead');
  select count(*) into n from public.events
    where project_id = '_org' and type = 'v1.JoinDecided' and payload->>'requestId' = 'req1' and (payload->>'accepted')::boolean;
  if n <> 1 then raise exception 'JoinDecided not appended'; end if;
  if public.member_role('org1', 'p1', 'asker') is null then raise exception 'asker not admitted'; end if;
  select count(*) into n from public.join_requests where id = 'req1';
  if n <> 0 then raise exception 'decided request left open'; end if;
end $$;

select 'smoke ok' as result;
