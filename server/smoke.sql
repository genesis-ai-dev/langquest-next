-- Exercises append_events / pull_events on a fresh local database.
-- Run via `npm run db:test`. Fails loudly on any unexpected result.
--
-- org1 has three languages: L1, din and nus. 'lead' is its admin (org
-- scope); 't1' translates L1 only; 'akol' leads din only.

\set ON_ERROR_STOP on

-- Legacy calls below omit p_client_version; allow them, the version check has its own section (5h).
update public.server_config set min_client_version = 0;

-- Simulate an authenticated caller (no auth.uid() outside PostgREST).
select set_config('request.jwt.claim.sub', 'lead', false);

-- 1. Bootstrap: the organization, its roles, its creator, its first
--    language and a translator in it, in one batch.
do $$ declare r record; n int := 0; begin
  for r in select * from public.append_events('[
    {"id":"o1","type":"v1.OrgCreated","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000001:000000:dA","payload":{"name":"Wycliffe"}},
    {"id":"o2","type":"v1.RoleDefined","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000002:000000:dA","payload":{"roleId":"org_admin","name":"Organization Admin","privileges":["manage_structure","invite_members","manage_roles","manage_templates","shape_templates","manage_reference","manage_flows","manage_teams","assign_work","override_checkpoints","translate","fill_reference","send_to_reviewers","review","view_status"]}},
    {"id":"o3","type":"v1.MemberAdded","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000003:000000:dA","payload":{"profileId":"lead","roleId":"org_admin","scope":{"level":"org"}}},
    {"id":"o4","type":"v1.RoleDefined","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000004:000000:dA","payload":{"roleId":"translator","name":"Translator","privileges":["translate","fill_reference","send_to_reviewers","view_status"]}},
    {"id":"o5","type":"v1.RoleDefined","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000005:000000:dA","payload":{"roleId":"lang_lead","name":"Team Leader","privileges":["assign_work","manage_teams","translate","review","view_status"]}},
    {"id":"o6","type":"v1.LanguageAdded","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000006:000000:dA","payload":{"languageId":"L1","name":"Luke Team","code":"fia","sourceCode":"eng"}},
    {"id":"o7","type":"v1.MemberAdded","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000007:000000:dA","payload":{"profileId":"t1","roleId":"translator","scope":{"level":"language","languageId":"L1"}}}
  ]'::jsonb) loop
    if not r.accepted then raise exception 'bootstrap event % refused: %', r.id, r.reason; end if;
    n := n + 1;
  end loop;
  if n <> 7 then raise exception 'expected 7 bootstrap answers'; end if;
  if (select role_id from public.org_memberships where org_id = 'org1' and profile_id = 'lead' and scope_key = 'org') <> 'org_admin' then
    raise exception 'org_memberships row wrong';
  end if;
  if (select role_id from public.org_memberships where org_id = 'org1' and profile_id = 't1' and scope_key = 'language:L1') <> 'translator' then
    raise exception 'language membership row wrong';
  end if;
  if not public.language_listed('org1', 'L1') then raise exception 'L1 should be listed'; end if;
  if public.effective_role_of(public.org_privileges('org1', 't1', 'L1')) <> 'translator' then raise exception 't1 should translate L1'; end if;
  if cardinality(public.org_privileges('org1', 't1', null)) <> 0 then raise exception 't1 holds nothing at org scope'; end if;
end $$;

-- 1b. A language stream accepts events only once the organization lists it.
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"g1","type":"v1.UnitAdded","orgId":"org1","streamId":"L9","actorId":"lead","deviceId":"dA","hlc":"000000000000008:000000:dA","payload":{"unitId":"u1","parentUnitId":null,"kind":"book","label":"Luke","order":"a0"}}
  ]'::jsonb);
  if r.accepted or r.reason <> 'language not listed yet' then raise exception 'unlisted language should be refused, got %', r; end if;
end $$;

-- 2. Duplicate id is accepted idempotently with the same seq.
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"o7","type":"v1.MemberAdded","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000007:000000:dA","payload":{"profileId":"t1","roleId":"translator","scope":{"level":"language","languageId":"L1"}}}
  ]'::jsonb);
  if not r.accepted or r.server_seq <> 7 or r.reason <> 'duplicate' then
    raise exception 'duplicate should be accepted with seq 7, got %', r;
  end if;
end $$;

-- 3. Translator may record but may not choose the flow.
select set_config('request.jwt.claim.sub', 't1', false);
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"e4","type":"v1.RecordingAdded","orgId":"org1","streamId":"L1","actorId":"t1","deviceId":"dB","hlc":"000000000000010:000000:dB","payload":{"recordingId":"rec1","unitId":"u1","kind":"target","cards":[{"hash":"c1","durationMs":100}]}}
  ]'::jsonb);
  if not r.accepted then raise exception 'translator recording should be accepted: %', r.reason; end if;
  if r.server_seq <> 1 then raise exception 'each stream counts from 1, got %', r.server_seq; end if;

  select * into r from public.append_events('[
    {"id":"e5","type":"v1.FlowSelected","orgId":"org1","streamId":"L1","actorId":"t1","deviceId":"dB","hlc":"000000000000011:000000:dB","payload":{"flowId":"quick_check"}}
  ]'::jsonb);
  if r.accepted or r.reason <> 'may not emit v1.FlowSelected' then raise exception 'translator must not choose the flow, got %', r; end if;
end $$;

-- 4. Non-member is rejected; actorId spoofing is rejected.
select set_config('request.jwt.claim.sub', 'stranger', false);
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"e6","type":"v1.RecordingAdded","orgId":"org1","streamId":"L1","actorId":"stranger","deviceId":"dX","hlc":"000000000000012:000000:dX","payload":{}}
  ]'::jsonb);
  if r.accepted or r.reason <> 'not a member' then raise exception 'stranger should be rejected, got %', r; end if;

  select * into r from public.append_events('[
    {"id":"e7","type":"v1.RecordingAdded","orgId":"org1","streamId":"L1","actorId":"t1","deviceId":"dX","hlc":"000000000000013:000000:dX","payload":{}}
  ]'::jsonb);
  if r.accepted then raise exception 'spoofed actorId should be rejected'; end if;
end $$;

-- 5. Pull after cursor is bounded and ordered; non-member cannot pull.
select set_config('request.jwt.claim.sub', 'lead', false);
do $$ declare n int; begin
  select count(*) into n from public.pull_events('org1', '_org', 5, 10);
  if n <> 2 then raise exception 'expected 2 events after seq 5, got %', n; end if;
end $$;
select set_config('request.jwt.claim.sub', 'stranger', false);
do $$ begin
  begin
    perform * from public.pull_events('org1', 'L1', 0, 10);
    raise exception 'stranger pull should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 5b. Pulling a stream that has no events yet is empty, not an error.
select set_config('request.jwt.claim.sub', 'lead', false);
do $$ declare n int; begin
  select count(*) into n from public.pull_events('org1', 'nonexistent', 0, 10);
  if n <> 0 then raise exception 'empty stream should pull 0 rows'; end if;
end $$;

-- 5c. Clients cannot forge a blob confirmation, but a storage object lands one.
do $$ declare r record; n int; begin
  select * into r from public.append_events('[
    {"id":"forged","type":"v1.BlobStored","orgId":"org1","streamId":"L1","actorId":"lead","deviceId":"dA","hlc":"000000000000014:000000:dA","payload":{"hash":"h1","size":1}}
  ]'::jsonb);
  if r.accepted then raise exception 'client must not emit BlobStored'; end if;

  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('blobs', 'org1/L1/abc123.wav', null, '{"size": 4321}'::jsonb);
  select count(*) into n from public.events e
    where e.stream_id = 'L1' and e.type = 'v1.BlobStored' and e.payload->>'hash' = 'abc123' and (e.payload->>'size')::int = 4321;
  if n <> 1 then raise exception 'storage insert should append one BlobStored, got %', n; end if;

  -- A second insert of the same object name (re-upload) must not duplicate it.
  begin
    insert into storage.objects (bucket_id, name, owner, metadata)
    values ('blobs', 'org1/L1/abc123.wav', null, '{"size": 4321}'::jsonb);
  exception when unique_violation then null;
  end;
  select count(*) into n from public.events e where e.stream_id = 'L1' and e.type = 'v1.BlobStored';
  if n <> 1 then raise exception 'BlobStored must be idempotent'; end if;

  -- An upsert that changed the bytes (different size) re-confirms with the new size.
  update storage.objects set metadata = '{"size": 5000}'::jsonb where bucket_id = 'blobs' and name = 'org1/L1/abc123.wav';
  select count(*) into n from public.events e where e.stream_id = 'L1' and e.type = 'v1.BlobStored' and (e.payload->>'size')::int = 5000;
  if n <> 1 then raise exception 'size change should re-confirm, got %', n; end if;
  -- Same size again: no new event.
  update storage.objects set metadata = '{"size": 5000, "x": 1}'::jsonb where bucket_id = 'blobs' and name = 'org1/L1/abc123.wav';
  select count(*) into n from public.events e where e.stream_id = 'L1' and e.type = 'v1.BlobStored';
  if n <> 2 then raise exception 'same size must not re-confirm, got %', n; end if;
end $$;

-- 5c2. Reconciler verdicts: service only; clients cannot forge BlobInvalidated.
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"forgedinv","type":"v1.BlobInvalidated","orgId":"org1","streamId":"L1","actorId":"lead","deviceId":"dA","hlc":"000000000000015:000001:dA","payload":{"hash":"abc123"}}
  ]'::jsonb, 1);
  if r.accepted then raise exception 'client must not emit BlobInvalidated'; end if;
  begin
    perform public.invalidate_blob('org1', 'L1', 'abc123', 'x');
    raise exception 'member must not call invalidate_blob';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', '', false);
do $$ declare n int; begin
  if not public.invalidate_blob('org1', 'L1', 'abc123', 'hash mismatch') then raise exception 'invalidate should append'; end if;
  if not public.record_blob('org1', 'L1', 'zzz', 7) then raise exception 'record_blob should append'; end if;
  if public.record_blob('org1', 'L1', 'zzz', 7) then raise exception 'record_blob must be idempotent'; end if;
  select count(*) into n from public.events e where e.stream_id = 'L1' and e.type = 'v1.BlobInvalidated';
  if n <> 1 then raise exception 'expected one BlobInvalidated, got %', n; end if;
end $$;

-- 5d. Malformed payloads are refused at the door (the log cannot be edited later).
select set_config('request.jwt.claim.sub', 't1', false);
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"bad1","type":"v1.RecordingAdded","orgId":"org1","streamId":"L1","actorId":"t1","deviceId":"dB","hlc":"000000000000016:000000:dB","payload":{"recordingId":"recX","unitId":"u1","kind":"target"}}
  ]'::jsonb);
  if r.accepted or r.reason not like 'invalid payload%' then raise exception 'missing cards should be refused, got %', r; end if;
  select * into r from public.append_events('[
    {"id":"bad2","type":"v1.TakeComposed","orgId":"org1","streamId":"L1","actorId":"t1","deviceId":"dB","hlc":"000000000000017:000000:dB","payload":"nope"}
  ]'::jsonb);
  if r.accepted then raise exception 'non-object payload should be refused'; end if;
  select * into r from public.append_events('[
    {"id":"bad3","type":"v1.TakeComposed","orgId":"org1","stream":"L1","actorId":"t1","deviceId":"dB","hlc":"000000000000018:000000:dB","payload":{}}
  ]'::jsonb);
  if r.accepted or r.reason <> 'malformed envelope' then raise exception 'an envelope without streamId should be refused, got %', r; end if;
end $$;

-- 5e. Oversized batches are refused outright; clients must page.
do $$ begin
  begin
    perform * from public.append_events((select jsonb_agg(jsonb_build_object(
      'id', 'big' || i, 'type', 'v1.TakeArchived', 'orgId', 'org1', 'streamId', 'L1', 'actorId', 't1',
      'deviceId', 'dB', 'hlc', '000000000000019:' || lpad(i::text, 6, '0') || ':dB', 'payload', jsonb_build_object('takeId', 'x')))
      from generate_series(1, 501) i));
    raise exception 'batch of 501 should have been refused';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- 5f. Redaction: admins may, translators may not.
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"rd0","type":"v1.Redacted","orgId":"org1","streamId":"L1","actorId":"t1","deviceId":"dB","hlc":"000000000000020:000000:dB","payload":{"eventId":"e4"}}
  ]'::jsonb);
  if r.accepted then raise exception 'translator must not redact'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'lead', false);
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"rd1","type":"v1.Redacted","orgId":"org1","streamId":"L1","actorId":"lead","deviceId":"dA","hlc":"000000000000021:000000:dA","payload":{"eventId":"e4","reason":"wrong passage"}}
  ]'::jsonb);
  if not r.accepted then raise exception 'admin redaction should be accepted: %', r.reason; end if;
end $$;

-- 5g. Snapshots: service writes, members read newest for their version, strangers cannot.
select set_config('request.jwt.claim.sub', '', false);
select public.put_snapshot('org1', 'L1', 1, 3, '{"v":"old"}'::jsonb);
select public.put_snapshot('org1', 'L1', 1, 5, '{"v":"new"}'::jsonb);
do $$ declare n int; begin
  select count(*) into n from public.snapshots where stream_id = 'L1';
  if n <> 1 then raise exception 'put_snapshot should keep one row per version, got %', n; end if;
end $$;
select set_config('request.jwt.claim.sub', 'lead', false);
do $$ declare r record; begin
  select * into r from public.get_snapshot('org1', 'L1', 1);
  if r.server_seq <> 5 or r.state->>'v' <> 'new' then raise exception 'get_snapshot should return the newest, got %', r; end if;
  if (select count(*) from public.get_snapshot('org1', 'L1', 2)) <> 0 then raise exception 'other reducer version must be empty'; end if;
  begin
    perform public.put_snapshot('org1', 'L1', 1, 9, '{}'::jsonb);
    raise exception 'members must not write snapshots';
  exception when insufficient_privilege then null;
  end;
end $$;
-- Chunked read reassembles to the stored state exactly.
do $$ declare m record; v_text text := ''; i int; begin
  select * into m from public.get_snapshot_meta('org1', 'L1', 1);
  if m.server_seq <> 5 or m.chunks <> 1 then raise exception 'meta wrong: %', m; end if;
  for i in 0 .. m.chunks - 1 loop
    v_text := v_text || public.get_snapshot_chunk('org1', 'L1', 1, 5, i);
  end loop;
  if v_text::jsonb <> '{"v":"new"}'::jsonb then raise exception 'chunks do not reassemble: %', v_text; end if;
  if public.get_snapshot_chunk('org1', 'L1', 1, 4, 0) is not null then raise exception 'wrong seq must be null'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'stranger', false);
do $$ begin
  begin
    perform * from public.get_snapshot_meta('org1', 'L1', 1);
    raise exception 'stranger meta read should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.get_snapshot('org1', 'L1', 1);
    raise exception 'stranger snapshot read should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', 'lead', false);

-- 5h. Minimum client version: old clients are refused with a distinct code.
update public.server_config set min_client_version = 2;
do $$ begin
  begin
    perform * from public.pull_events('org1', 'L1', 0, 10, 1);
    raise exception 'old client pull should have been refused';
  exception when sqlstate 'LQ001' then null;
  end;
  begin
    perform * from public.append_events('[]'::jsonb, 1);
    raise exception 'old client append should have been refused';
  exception when sqlstate 'LQ001' then null;
  end;
  perform * from public.pull_events('org1', 'L1', 0, 10, 2);
end $$;
update public.server_config set min_client_version = 0;

-- 6. Append-only is enforced even for the table owner.
do $$ begin
  begin
    update public.events set hlc = 'x' where id = 'o1';
    raise exception 'update should have been refused';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.events where id = 'o1';
    raise exception 'delete should have been refused';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 7. Long-offline liabilities (docs/flow-coverage-audit.md L1, L2, L10).
-- 7a. Clock ahead: refused with server time in the reason; nothing stored.
do $$ declare r record; begin
  select * into r from public.append_events(format('[
    {"id":"e7b","type":"v1.LanguageRenamed","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"%s:000000:dA","payload":{"languageId":"L1","name":"x"}}
  ]', lpad(((extract(epoch from now()) * 1000)::bigint + 3600000)::text, 15, '0'))::jsonb);
  if r.accepted or r.reason not like 'clock ahead: server time %' then raise exception 'clock-ahead should be refused, got %', r; end if;
  if exists (select 1 from public.events where id = 'e7b') then raise exception 'refused event must not be stored'; end if;
end $$;

-- 7b. Removal is decided by the membership now: t1's work after removal is
--     refused, whatever its clock says, and accepted again once re-admitted
--     (the phone re-queues it, NOT_MEMBER).
do $$ declare r record; begin
  select * into r from public.append_events(format('[
    {"id":"e7c0","type":"v1.MemberRemoved","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"%s:000000:dA","payload":{"profileId":"t1","scope":{"level":"language","languageId":"L1"}}}
  ]', lpad(((extract(epoch from now()) * 1000)::bigint - 86400000)::text, 15, '0'))::jsonb);
  if not r.accepted then raise exception 'removal should be accepted: %', r.reason; end if;
  if cardinality(public.org_privileges('org1', 't1', 'L1')) <> 0 then raise exception 't1 should be removed now'; end if;
end $$;
select set_config('request.jwt.claim.sub', 't1', false);
do $$ declare r record; begin
  select * into r from public.append_events(format('[
    {"id":"e7c1","type":"v1.TakeSubmitted","orgId":"org1","streamId":"L1","actorId":"t1","deviceId":"dB","hlc":"%s:000000:dB","payload":{"takeId":"take-old"}}
  ]', lpad(((extract(epoch from now()) * 1000)::bigint - 2 * 86400000)::text, 15, '0'))::jsonb);
  if r.accepted or r.reason <> 'not a member' then raise exception 'a removed member''s work should be refused, got %', r; end if;
end $$;
select set_config('request.jwt.claim.sub', 'lead', false);
select * from public.append_events(format('[
  {"id":"e7d0","type":"v1.MemberAdded","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"%s:000000:dA","payload":{"profileId":"t1","roleId":"translator","scope":{"level":"language","languageId":"L1"}}}
]', lpad(((extract(epoch from now()) * 1000)::bigint - 30000)::text, 15, '0'))::jsonb);
select set_config('request.jwt.claim.sub', 't1', false);
do $$ declare r record; begin
  if public.effective_role_of(public.org_privileges('org1', 't1', 'L1')) <> 'translator' then raise exception 't1 should be a translator again'; end if;
  select * into r from public.append_events(format('[
    {"id":"e7c1","type":"v1.TakeSubmitted","orgId":"org1","streamId":"L1","actorId":"t1","deviceId":"dB","hlc":"%s:000000:dB","payload":{"takeId":"take-old"}}
  ]', lpad(((extract(epoch from now()) * 1000)::bigint - 2 * 86400000)::text, 15, '0'))::jsonb);
  if not r.accepted then raise exception 're-pushed work after re-admission should be accepted: %', r.reason; end if;
end $$;
select set_config('request.jwt.claim.sub', 'lead', false);

-- 8. Languages and scopes (decision 63).
-- 8a. An org admin adds two more languages; each stream opens when listed.
do $$ declare r record; begin
  for r in select * from public.append_events('[
    {"id":"o10","type":"v1.LanguageAdded","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000110:000000:dA","payload":{"languageId":"din","name":"Dinka","code":"din","sourceCode":"eng"}},
    {"id":"o11","type":"v1.LanguageAdded","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000111:000000:dA","payload":{"languageId":"nus","name":"Nuer","code":"nus","sourceCode":"eng"}},
    {"id":"d1","type":"v1.UnitAdded","orgId":"org1","streamId":"din","actorId":"lead","deviceId":"dA","hlc":"000000000000112:000000:dA","payload":{"unitId":"u1","parentUnitId":null,"kind":"book","label":"Luke","order":"a0"}}
  ]'::jsonb) loop
    if not r.accepted then raise exception 'org admin language event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;

-- 8b. Earliest LanguageAdded wins; renames are a later-wins register.
do $$ declare r record; l public.languages; begin
  for r in select * from public.append_events('[
    {"id":"o12","type":"v1.LanguageAdded","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000113:000000:dA","payload":{"languageId":"din","name":"Second","code":"xxx","sourceCode":"eng"}},
    {"id":"o13","type":"v1.LanguageRenamed","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000115:000000:dA","payload":{"languageId":"din","name":"Thuɔŋjäŋ"}},
    {"id":"o14","type":"v1.LanguageRenamed","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000114:000000:dA","payload":{"languageId":"din","name":"Older"}}
  ]'::jsonb) loop
    if not r.accepted then raise exception 'language event % refused: %', r.id, r.reason; end if;
  end loop;
  select * into l from public.languages where org_id = 'org1' and language_id = 'din';
  if l.added_name <> 'Dinka' or l.code <> 'din' then raise exception 'earliest LanguageAdded should win, got %', l; end if;
  if public.language_display_name(l) <> 'Thuɔŋjäŋ' then raise exception 'latest rename should win, got %', l; end if;
end $$;

-- 8c. A language-scoped leader works in their language only; a stranger
--     may not touch the organization.
select * from public.append_events('[
  {"id":"o15","type":"v1.MemberAdded","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000116:000000:dA","payload":{"profileId":"akol","roleId":"lang_lead","scope":{"level":"language","languageId":"din"}}}
]'::jsonb);
select set_config('request.jwt.claim.sub', 'akol', false);
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"d2","type":"v1.RequestMade","orgId":"org1","streamId":"din","actorId":"akol","deviceId":"dB","hlc":"000000000000117:000000:dB","payload":{"requestId":"q1","unitId":"u1","what":"record","profileId":"t1"}}
  ]'::jsonb);
  if not r.accepted then raise exception 'language leader should ask in own language: %', r.reason; end if;
  select * into r from public.append_events('[
    {"id":"n1","type":"v1.RequestMade","orgId":"org1","streamId":"nus","actorId":"akol","deviceId":"dB","hlc":"000000000000118:000000:dB","payload":{"requestId":"q2","unitId":"u1","what":"record","profileId":"t1"}}
  ]'::jsonb);
  if r.accepted or r.reason <> 'not a member' then raise exception 'language leader must not work in another language, got %', r; end if;
  select * into r from public.append_events('[
    {"id":"o16","type":"v1.RoleDefined","orgId":"org1","streamId":"_org","actorId":"akol","deviceId":"dB","hlc":"000000000000119:000000:dB","payload":{"roleId":"sneaky","name":"Sneaky","privileges":["manage_roles"]}}
  ]'::jsonb);
  if r.accepted or r.reason <> 'may not emit v1.RoleDefined' then raise exception 'language leader must not define org roles, got %', r; end if;
  perform * from public.pull_events('org1', '_org', 0, 10);
  perform * from public.pull_events('org1', 'din', 0, 10);
  -- A phone cold-starts from a snapshot, so a member of one language must
  -- be able to ask for the organization's too.
  perform * from public.get_snapshot_meta('org1', '_org', 1);
  perform public.get_snapshot_chunk('org1', '_org', 1, 1, 0);
  perform * from public.get_snapshot('org1', '_org', 1);
  perform * from public.get_snapshot_meta('org1', 'din', 1);
  begin
    perform * from public.pull_events('org1', 'nus', 0, 10);
    raise exception 'language leader must not pull another language';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', 'stranger', false);
do $$ begin
  perform * from public.get_snapshot_meta('org1', '_org', 1);
  raise exception 'a stranger must not read the org snapshot';
exception when insufficient_privilege then null;
end $$;
do $$ declare r record; begin
  begin
    perform * from public.pull_events('org1', '_org', 0, 10);
    raise exception 'stranger must not pull the organization stream';
  exception when insufficient_privilege then null;
  end;
  select * into r from public.append_events('[
    {"id":"o17","type":"v1.MemberAdded","orgId":"org1","streamId":"_org","actorId":"stranger","deviceId":"dX","hlc":"000000000000120:000000:dX","payload":{"profileId":"stranger","roleId":"org_admin","scope":{"level":"org"}}}
  ]'::jsonb);
  if r.accepted or r.reason <> 'not a member' then raise exception 'stranger must not join an org that has members, got %', r; end if;
end $$;

-- 8d. Invalid org payloads are refused at the door.
select set_config('request.jwt.claim.sub', 'lead', false);
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"o18","type":"v1.RoleDefined","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000121:000000:dA","payload":{"roleId":"x","name":"X","privileges":["fly"]}}
  ]'::jsonb);
  if r.accepted or r.reason not like 'invalid payload:%' then raise exception 'unknown privilege should be refused, got %', r; end if;
  select * into r from public.append_events('[
    {"id":"o19","type":"v1.MemberAdded","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000122:000000:dA","payload":{"profileId":"x","roleId":"org_admin","scope":{"level":"language"}}}
  ]'::jsonb);
  if r.accepted or r.reason not like 'invalid payload:%' then raise exception 'language scope without languageId should be refused, got %', r; end if;
  select * into r from public.append_events('[
    {"id":"o20","type":"v1.LanguageAdded","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000123:000000:dA","payload":{"languageId":"_org","name":"X","code":"x","sourceCode":"eng"}}
  ]'::jsonb);
  if r.accepted or r.reason not like 'invalid payload:%' then raise exception 'a reserved language id should be refused, got %', r; end if;
end $$;

-- 8e. The organization's license (docs/licensing.md): only the admin sets it,
--     only known licenses, and a later "closing" is accepted but folds to nothing.
select set_config('request.jwt.claim.sub', 'akol', false);
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"lic1","type":"v1.LicenseSet","orgId":"org1","streamId":"_org","actorId":"akol","deviceId":"dB","hlc":"000000000000124:000000:dB","payload":{"license":"CC0-1.0"}}
  ]'::jsonb);
  if r.accepted then raise exception 'a language leader must not open the organization''s license'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'lead', false);
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"lic2","type":"v1.LicenseSet","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000125:000000:dA","payload":{"license":"MIT"}}
  ]'::jsonb);
  if r.accepted or r.reason not like 'invalid payload:%' then raise exception 'an unknown license should be refused, got %', r; end if;
  for r in select * from public.append_events('[
    {"id":"lic3","type":"v1.LicenseSet","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000126:000000:dA","payload":{"license":"CC-BY-SA-4.0"}},
    {"id":"lic4","type":"v1.LicenseSet","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000127:000000:dA","payload":{"license":"all-rights-reserved"}}
  ]'::jsonb) loop
    if not r.accepted then raise exception 'org admin license event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;

-- 9. A language's template, flow and teams; the respond loop.
do $$ declare r record; begin
  for r in select * from public.append_events('[
    {"id":"s1","type":"v1.TemplateSelected","orgId":"org1","streamId":"din","actorId":"lead","deviceId":"dA","hlc":"000000000000201:000000:dA","payload":{"itemId":"langquest.bible","docHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","unitPrefix":"bible"}},
    {"id":"s2","type":"v1.UnitAdded","orgId":"org1","streamId":"din","actorId":"lead","deviceId":"dA","hlc":"000000000000202:000000:dA","payload":{"unitId":"bible/gen","parentUnitId":null,"kind":"book","label":"Genesis","order":"b0000"}},
    {"id":"s3","type":"v1.FlowSelected","orgId":"org1","streamId":"din","actorId":"lead","deviceId":"dA","hlc":"000000000000203:000000:dA","payload":{"flowId":"quick_check"}},
    {"id":"s4","type":"v1.FlowStepSet","orgId":"org1","streamId":"din","actorId":"lead","deviceId":"dA","hlc":"000000000000204:000000:dA","payload":{"stepId":"quick_check/peer","order":"s00","kindIds":["peer"],"checkpoint":true}},
    {"id":"s5","type":"v1.FlowStepRemoved","orgId":"org1","streamId":"din","actorId":"lead","deviceId":"dA","hlc":"000000000000205:000000:dA","payload":{"stepId":"quick_check/old"}},
    {"id":"s6","type":"v1.ReviewTeamDefined","orgId":"org1","streamId":"din","actorId":"lead","deviceId":"dA","hlc":"000000000000206:000000:dA","payload":{"teamId":"team1","name":"Community"}},
    {"id":"s7","type":"v1.ReviewTeamMemberSet","orgId":"org1","streamId":"din","actorId":"lead","deviceId":"dA","hlc":"000000000000207:000000:dA","payload":{"teamId":"team1","profileId":"r1","member":true}}
  ]'::jsonb) loop
    if not r.accepted then raise exception 'language setup event % refused: %', r.id, r.reason; end if;
  end loop;
  select * into r from public.append_events('[
    {"id":"s8","type":"v1.FlowStepSet","orgId":"org1","streamId":"din","actorId":"lead","deviceId":"dA","hlc":"000000000000208:000000:dA","payload":{"stepId":"x","order":"s00","kindIds":["peer"],"checkpoint":"sometimes"}}
  ]'::jsonb);
  if r.accepted or r.reason not like 'invalid payload:%' then raise exception 'a non-boolean checkpoint should be refused, got %', r; end if;
end $$;
-- Translator may respond; neither translator may select a template.
select set_config('request.jwt.claim.sub', 't1', false);
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"s9","type":"v1.ResponseRecorded","orgId":"org1","streamId":"L1","actorId":"t1","deviceId":"dB","hlc":"000000000000209:000000:dB","payload":{"takeId":"take-new","respondsToTakeId":"take-old","note":"kept card 1"}}
  ]'::jsonb);
  if not r.accepted then raise exception 'translator response should be accepted: %', r.reason; end if;
  select * into r from public.append_events('[
    {"id":"s10","type":"v1.TemplateSelected","orgId":"org1","streamId":"L1","actorId":"t1","deviceId":"dB","hlc":"000000000000210:000000:dB","payload":{"itemId":"langquest.bible","docHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","unitPrefix":"bible"}}
  ]'::jsonb);
  if r.accepted then raise exception 'translator must not select templates'; end if;
end $$;

-- 10. Materials and key terms.
do $$ declare r record; begin
  for r in select * from public.append_events('[
    {"id":"m1","type":"v1.MaterialDefined","orgId":"org1","streamId":"L1","actorId":"t1","deviceId":"dB","hlc":"000000000000301:000000:dB","payload":{"materialId":"q-u1","kind":"questions","title":"Unit 1 questions","scope":{"unitId":"u1"}}},
    {"id":"m2","type":"v1.MaterialFieldSet","orgId":"org1","streamId":"L1","actorId":"t1","deviceId":"dB","hlc":"000000000000302:000000:dB","payload":{"materialId":"q-u1","fieldId":"q1","text":"Is it clear?"}},
    {"id":"m3","type":"v1.KeyTermDefined","orgId":"org1","streamId":"L1","actorId":"t1","deviceId":"dB","hlc":"000000000000303:000000:dB","payload":{"termId":"kt1","term":"Word","gloss":"Logos","unitScope":["u1"]}},
    {"id":"m4","type":"v1.KeyTermLinked","orgId":"org1","streamId":"L1","actorId":"t1","deviceId":"dB","hlc":"000000000000304:000000:dB","payload":{"takeId":"take-new","termId":"kt1","note":"divine sense"}}
  ]'::jsonb) loop
    if not r.accepted then raise exception 'translator material event % refused: %', r.id, r.reason; end if;
  end loop;
  select * into r from public.append_events('[
    {"id":"m5","type":"v1.MaterialDefined","orgId":"org1","streamId":"L1","actorId":"t1","deviceId":"dB","hlc":"000000000000305:000000:dB","payload":{"materialId":"tmf","kind":"tmf","title":"TMF","scope":{}}}
  ]'::jsonb);
  if r.accepted then raise exception 'translator must not define managed material'; end if;
  select * into r from public.append_events('[
    {"id":"m6","type":"v1.MaterialLocked","orgId":"org1","streamId":"L1","actorId":"t1","deviceId":"dB","hlc":"000000000000306:000000:dB","payload":{"materialId":"q-u1","locked":true}}
  ]'::jsonb);
  if r.accepted then raise exception 'translator must not lock material'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'lead', false);
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"m7","type":"v1.MaterialLocked","orgId":"org1","streamId":"L1","actorId":"lead","deviceId":"dA","hlc":"000000000000307:000000:dA","payload":{"materialId":"q-u1","locked":true}}
  ]'::jsonb);
  if not r.accepted then raise exception 'admin lock refused: %', r.reason; end if;
  select * into r from public.append_events('[
    {"id":"m9","type":"v1.KeyTermDefined","orgId":"org1","streamId":"L1","actorId":"lead","deviceId":"dA","hlc":"000000000000309:000000:dA","payload":{"termId":"kt2","term":"Spirit","gloss":"x","unitScope":"u1"}}
  ]'::jsonb);
  if r.accepted or r.reason not like 'invalid payload:%' then raise exception 'unitScope must be an array, got %', r; end if;
end $$;

-- 11. Invites and join requests (docs/flow-coverage-audit.md 5.B).
select set_config('request.jwt.claim.sub', 'lead', false);
do $$
declare
  v_hash text := encode(extensions.digest('tok-secret-1', 'sha256'), 'hex');
  n int;
begin
  -- A member with invite_members may issue; the token itself never lands.
  perform public.issue_invite_v3('org1', 'inv1', v_hash, 'lang_lead', '{"level":"org"}'::jsonb, now() + interval '7 days');
  select count(*) into n from public.invites where id = 'inv1' and org_id = 'org1';
  if n <> 1 then raise exception 'invite row missing'; end if;
  select count(*) into n from public.events
    where stream_id = '_org' and type = 'v1.InviteIssued' and payload->>'inviteId' = 'inv1';
  if n <> 1 then raise exception 'InviteIssued not appended'; end if;
  select count(*) into n from public.events
    where stream_id = '_org' and payload::text like '%tok-secret-1%';
  if n <> 0 then raise exception 'the token reached the log'; end if;

  -- An unknown role is refused, so an invite cannot grant something undefined.
  begin
    perform public.issue_invite_v3('org1', 'inv-bad', repeat('b', 64), 'no_such_role', '{"level":"org"}'::jsonb, now() + interval '1 day');
    raise exception 'unknown role was accepted';
  exception when sqlstate '22023' then null;
  end;
  -- So is a language the organization does not have.
  begin
    perform public.issue_invite_v3('org1', 'inv-bad2', repeat('c', 64), 'translator',
      '{"level":"language","languageId":"zzz"}'::jsonb, now() + interval '1 day');
    raise exception 'unknown language was accepted';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- A translator holds no invite_members privilege and may not issue.
select set_config('request.jwt.claim.sub', 't1', false);
do $$
begin
  begin
    perform public.issue_invite_v3('org1', 'inv2', repeat('d', 64), 'lang_lead', '{"level":"org"}'::jsonb, now() + interval '1 day');
    raise exception 'translator issued an invite';
  exception when sqlstate '42501' then null;
  end;
end $$;

-- A stranger redeems, and becomes a member without ever being granted anything by themselves.
select set_config('request.jwt.claim.sub', 'newbie', false);
do $$
declare v_org text; n int; v_actor text;
begin
  v_org := public.redeem_invite_v2('tok-secret-1');
  if v_org <> 'org1' then raise exception 'redeem returned %', v_org; end if;
  if public.effective_role_of(public.org_privileges('org1', 'newbie', 'L1')) is null then raise exception 'membership not granted'; end if;
  select actor_id into v_actor from public.events
    where stream_id = '_org' and type = 'v1.MemberAdded' and payload->>'profileId' = 'newbie';
  if v_actor <> 'service' then raise exception 'membership granted under actor %, not service', v_actor; end if;
  select count(*) into n from public.events
    where stream_id = '_org' and type = 'v1.InviteRedeemed' and payload->>'inviteId' = 'inv1';
  if n <> 1 then raise exception 'InviteRedeemed not appended'; end if;

  -- Redeeming again is a no-op for the same person; a wrong token is refused.
  if public.redeem_invite_v2('tok-secret-1') <> 'org1' then raise exception 'a repeat redeem should answer the org'; end if;
  begin
    perform public.redeem_invite_v2('not-a-token');
    raise exception 'bogus token accepted';
  exception when sqlstate '22023' then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', 'other', false);
do $$ begin
  perform public.redeem_invite_v2('tok-secret-1');
  raise exception 'a single-use invite was used twice';
exception when sqlstate '22023' then null;
end $$;

-- A language-scoped leader with Invite invites into their language only.
select set_config('request.jwt.claim.sub', 'lead', false);
select * from public.append_events('[
  {"id":"o21","type":"v1.RoleDefined","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000401:000000:dA","payload":{"roleId":"inviter","name":"Inviter","privileges":["invite_members","view_status"]}},
  {"id":"o22","type":"v1.MemberAdded","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000402:000000:dA","payload":{"profileId":"akol","roleId":"inviter","scope":{"level":"language","languageId":"nus"}}}
]'::jsonb);
select set_config('request.jwt.claim.sub', 'akol', false);
do $$ begin
  perform public.issue_invite_v3('org1', 'inv3', repeat('e', 64), 'translator',
    '{"level":"language","languageId":"nus"}'::jsonb, now() + interval '1 day');
  begin
    perform public.issue_invite_v3('org1', 'inv4', repeat('f', 64), 'translator',
      '{"level":"language","languageId":"din"}'::jsonb, now() + interval '1 day');
    raise exception 'invited into a language without Invite there';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.issue_invite_v3('org1', 'inv5', repeat('0', 64), 'translator', '{"level":"org"}'::jsonb, now() + interval '1 day');
    raise exception 'invited at org scope with a language role';
  exception when sqlstate '42501' then null;
  end;
end $$;

-- No client may forge a redemption through the normal append path.
select set_config('request.jwt.claim.sub', 'newbie', false);
do $$
declare r record;
begin
  select * into r from public.append_events('[
    {"id":"forge1","type":"v1.InviteRedeemed","orgId":"org1","streamId":"_org","actorId":"newbie","deviceId":"dZ","hlc":"000000000000400:000000:dZ","payload":{"inviteId":"inv1","profileId":"newbie"}}
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
  select count(*) into n from public.events where stream_id = '_org' and type = 'v1.JoinDecided';
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
    where stream_id = '_org' and type = 'v1.JoinDecided' and payload->>'requestId' = 'req1' and (payload->>'accepted')::boolean;
  if n <> 1 then raise exception 'JoinDecided not appended'; end if;
  if public.effective_role_of(public.org_privileges('org1', 'asker', 'L1')) is null then raise exception 'asker not admitted'; end if;
  select count(*) into n from public.join_requests where id = 'req1';
  if n <> 0 then raise exception 'decided request left open'; end if;
end $$;

-- 12. A language's country and target (decision 41) live in the
--     organization stream: an admin sets them, a language leader without
--     manage_structure may not, and my_privileges says so.
select set_config('request.jwt.claim.sub', 'lead', false);
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"c1","type":"v1.LanguageCountrySet","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000500:000000:dA","payload":{"languageId":"din","country":"SS"}}
  ]'::jsonb);
  if not r.accepted then raise exception 'org admin should set a country: %', r.reason; end if;
  select * into r from public.append_events('[
    {"id":"c2","type":"v1.LanguageTargetSet","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000501:000000:dA","payload":{"languageId":"din","scope":"nt","startDate":"2026-01-01","targetDate":"2027-07-01"}}
  ]'::jsonb);
  if not r.accepted then raise exception 'org admin should set a target: %', r.reason; end if;
  select * into r from public.append_events('[
    {"id":"c3","type":"v1.LanguageTargetSet","orgId":"org1","streamId":"_org","actorId":"lead","deviceId":"dA","hlc":"000000000000502:000000:dA","payload":{"languageId":"din","scope":"nt","startDate":"2027-01-01","targetDate":"2026-01-01"}}
  ]'::jsonb);
  if r.accepted then raise exception 'a target ending before it starts must be refused'; end if;
  if (select country from public.languages where org_id = 'org1' and language_id = 'din') <> 'SS' then raise exception 'country not folded'; end if;
  if (select target->>'targetDate' from public.languages where org_id = 'org1' and language_id = 'din') <> '2027-07-01' then raise exception 'target not folded'; end if;
  if not ('manage_structure' = any(public.my_privileges('org1', 'din'))) then raise exception 'org admin privileges wrong: %', public.my_privileges('org1', 'din'); end if;
end $$;
select set_config('request.jwt.claim.sub', 'akol', false);
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"c4","type":"v1.LanguageCountrySet","orgId":"org1","streamId":"_org","actorId":"akol","deviceId":"dB","hlc":"000000000000503:000000:dB","payload":{"languageId":"din","country":"SD"}}
  ]'::jsonb);
  if r.accepted then raise exception 'a language leader must not set the country'; end if;
  if 'manage_structure' = any(public.my_privileges('org1', 'din')) then raise exception 'language leader must not read as manage_structure'; end if;
  if not ('assign_work' = any(public.my_privileges('org1', 'din'))) then raise exception 'language leader privileges missing in own language'; end if;
  if 'assign_work' = any(public.my_privileges('org1', 'nus')) then raise exception 'language leader privileges leaked to another language'; end if;
  if cardinality(public.my_privileges('org1')) <> 0 then raise exception 'language leader holds nothing at org scope'; end if;
end $$;

-- 13. Navigation and the person stream.
do $$ declare n int; begin
  select count(*) into n from public.my_organizations() where org_id = 'org1' and name = 'Wycliffe';
  if n <> 1 then raise exception 'my_organizations should list org1 once'; end if;
  perform public.record_user_event('akol:t1', 'v1.TermsAccepted', '{"version":"2026-10"}'::jsonb);
  if public.get_user_state()->>'termsVersion' <> '2026-10' then raise exception 'person stream not read back'; end if;
  if not exists (select 1 from public.events where org_id = '_person' and stream_id = 'akol') then raise exception 'person stream row missing'; end if;
end $$;
do $$ declare r record; begin
  select * into r from public.append_events('[
    {"id":"pp1","type":"v1.TermsAccepted","orgId":"_person","streamId":"akol","actorId":"akol","deviceId":"dB","hlc":"000000000000600:000000:dB","payload":{"version":"x"}}
  ]'::jsonb);
  if r.accepted then raise exception 'a person stream is written only by record_user_event'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'lead', false);
do $$ begin
  perform * from public.pull_events('_person', 'akol', 0, 10);
  raise exception 'someone else must not read a person''s stream';
exception when insufficient_privilege then null;
end $$;

select 'smoke ok' as result;
