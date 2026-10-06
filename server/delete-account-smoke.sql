-- delete_my_account and delete_account_for_email (decisions.md 46, 47).
-- Repeatable; every write rolls back.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
  ('d0000000-0000-0000-0000-00000000000a', 'leaver@example.org'),
  ('d0000000-0000-0000-0000-00000000000b', 'stayer@example.org'),
  ('d0000000-0000-0000-0000-00000000000c', 'emailer@example.org');
select public._apply_org_event('del-test-org','v1.RoleDefined',
  '{"roleId":"admin","name":"Admin","privileges":["invite_members","manage_structure"]}', '000000000000001:000001:test');
-- The leaver made the organization, so the log holds their name.
select public._append_event_as('del-test-add-a','del-test-org','_org','v1.OrgMemberAdded',
  'd0000000-0000-0000-0000-00000000000a','server',
  '{"profileId":"d0000000-0000-0000-0000-00000000000a","roleId":"admin","scope":{"level":"org"},"displayName":"leaver"}');
select public._apply_org_event('del-test-org','v1.OrgMemberAdded',
  '{"profileId":"d0000000-0000-0000-0000-00000000000a","roleId":"admin","scope":{"level":"org"}}','000000000000002:000001:test');
select public._apply_org_event('del-test-org','v1.OrgMemberAdded',
  '{"profileId":"d0000000-0000-0000-0000-00000000000a","roleId":"admin","scope":{"level":"lane","partitionId":"p1","laneId":"l1"}}','000000000000002:000001:test');
select public._apply_org_event('del-test-org','v1.OrgMemberAdded',
  '{"profileId":"d0000000-0000-0000-0000-00000000000b","roleId":"admin","scope":{"level":"org"}}','000000000000002:000001:test');
select public._apply_member_event('del-test-org','p1','v1.MemberAdded',
  '{"profileId":"d0000000-0000-0000-0000-00000000000a","role":"translator"}','000000000000002:000001:test');
-- Work the leaver authored stays with the organization.
select public._append_event_as('del-test-work','del-test-org','p1','v1.NoteAdded',
  'd0000000-0000-0000-0000-00000000000a','dev-a','{"noteId":"n1","unitId":"u1","laneId":"l1","anchor":"passage","text":"kept"}');
-- Snapshots of the organization fold the creator's name in; another partition's do not.
insert into public.snapshots (org_id, partition_id, reducer_version, server_seq, state) values
  ('del-test-org','_org',1,1,'{"members":{"d0000000-0000-0000-0000-00000000000a":{"displayName":"leaver"}}}'),
  ('del-test-org','p1',1,1,'{}');
insert into public.profiles (id, display_name) values
  ('d0000000-0000-0000-0000-00000000000a','Leaver Name'), ('d0000000-0000-0000-0000-00000000000b','Stayer Name');
insert into public.push_tokens (token, profile_id) values
  ('ExponentPushToken[leaver]','d0000000-0000-0000-0000-00000000000a'),
  ('ExponentPushToken[stayer]','d0000000-0000-0000-0000-00000000000b');
insert into public.notifications (id, profile_id, org_id, partition_id, kind, title) values
  ('del-test-n1','d0000000-0000-0000-0000-00000000000a','del-test-org','p1','request','Record this'),
  ('del-test-n2','d0000000-0000-0000-0000-00000000000b','del-test-org','p1','request','Record this');
insert into public.push_receipts (ticket_id, token, notification_id) values
  ('del-test-t1','ExponentPushToken[leaver]','del-test-n1');
insert into public.join_requests (id, org_id, profile_id, message) values
  ('del-test-j1','other-org','d0000000-0000-0000-0000-00000000000a','Hello, I am Leaver');
insert into public.invites (id, org_id, token_hash, role_id, scope, expires_at, issued_by, email) values
  ('del-test-i1','del-test-org',repeat('c',64),'admin','{"level":"org"}',now()+interval '1 day',
   'd0000000-0000-0000-0000-00000000000b','Leaver@Example.org');
insert into diag.installs (install_id, profile_id) values
  ('del-test-install-a','d0000000-0000-0000-0000-00000000000a'), ('del-test-install-b','d0000000-0000-0000-0000-00000000000b');
insert into diag.records (id, install_id, delivered_by, kind, at) values
  ('del-test-r1','del-test-install-a','d0000000-0000-0000-0000-00000000000a','sync',now()),
  ('del-test-r2','del-test-install-b','d0000000-0000-0000-0000-00000000000b','sync',now());

-- Signed out, nobody can call it.
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  begin
    perform public.delete_my_account();
    raise exception 'deleted without a caller';
  exception when sqlstate '42501' then null; end;
end $$;

-- The log refuses edits before, during and after an erasure.
do $$ begin
  begin
    update public.events set payload = payload - 'displayName' where id = 'del-test-add-a';
    raise exception 'edited the log without an erasure';
  exception when sqlstate '42501' then null; end;
  perform set_config('langquest.erase_profile', 'd0000000-0000-0000-0000-00000000000a', true);
  begin
    update public.events set payload = '{"noteId":"n1","text":"changed"}' where id = 'del-test-work';
    raise exception 'an erasure let another event change';
  exception when sqlstate '42501' then null; end;
  begin
    update public.events set payload = payload || '{"roleId":"viewer"}' where id = 'del-test-add-a';
    raise exception 'an erasure let a role change';
  exception when sqlstate '42501' then null; end;
  begin
    delete from public.events where id = 'del-test-add-a';
    raise exception 'an erasure let an event be deleted';
  exception when sqlstate '42501' then null; end;
  perform set_config('langquest.erase_profile', '', true);
end $$;

select set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-00000000000a',true);
select public.delete_my_account();
-- A retry after a lost response is harmless.
select public.delete_my_account();

do $$
declare a text := 'd0000000-0000-0000-0000-00000000000a'; b text := 'd0000000-0000-0000-0000-00000000000b';
begin
  if exists (select 1 from auth.users where id::text = a) then raise exception 'sign-in kept'; end if;
  if exists (select 1 from public.profiles where id = a) then raise exception 'profile kept'; end if;
  if exists (select 1 from public.push_tokens where profile_id = a) then raise exception 'push token kept'; end if;
  if exists (select 1 from public.push_receipts where token = 'ExponentPushToken[leaver]') then raise exception 'receipt kept'; end if;
  if exists (select 1 from public.notifications where profile_id = a) then raise exception 'inbox kept'; end if;
  if exists (select 1 from public.join_requests where profile_id = a) then raise exception 'join request kept'; end if;
  if exists (select 1 from public.invites where email is not null and lower(email) = 'leaver@example.org') then raise exception 'invite email kept'; end if;
  if exists (select 1 from diag.installs where profile_id = a) or exists (select 1 from diag.records where delivered_by = a) then
    raise exception 'diagnostics kept';
  end if;
  if exists (select 1 from public.org_memberships where profile_id = a and not removed) then raise exception 'org membership kept'; end if;
  if exists (select 1 from public.memberships where profile_id = a and not removed) then raise exception 'language membership kept'; end if;
  if (select count(*) from public.events where type = 'v1.OrgMemberRemoved' and payload->>'profileId' = a) <> 2 then
    raise exception 'expected one removal per scope, once';
  end if;
  if not exists (select 1 from public.events where type = 'v1.OrgMemberRemoved'
      and payload = jsonb_build_object('profileId', a, 'scope', '{"level":"lane","partitionId":"p1","laneId":"l1"}'::jsonb)) then
    raise exception 'lane scope not rebuilt';
  end if;
  if (select count(*) from public.events where type = 'v1.Redacted' and payload->>'eventId' = 'del-test-add-a') <> 1 then
    raise exception 'creator name not redacted';
  end if;
  if not exists (select 1 from public.events where id = 'del-test-work') then raise exception 'authored work lost'; end if;
  if (select payload ? 'displayName' from public.events where id = 'del-test-add-a') then raise exception 'creator name kept in the log'; end if;
  if (select payload->>'roleId' from public.events where id = 'del-test-add-a') is distinct from 'admin' then raise exception 'erasure changed more than the name'; end if;
  if exists (select 1 from public.snapshots where org_id = 'del-test-org' and partition_id = '_org') then raise exception 'snapshot with the name kept'; end if;
  if not exists (select 1 from public.snapshots where org_id = 'del-test-org' and partition_id = 'p1') then raise exception 'unrelated snapshot dropped'; end if;
  -- Nobody else is touched.
  if not exists (select 1 from auth.users where id::text = b) or not exists (select 1 from public.profiles where id = b)
     or not exists (select 1 from public.push_tokens where profile_id = b) or not exists (select 1 from public.notifications where profile_id = b)
     or not exists (select 1 from diag.records where delivered_by = b)
     or not exists (select 1 from public.org_memberships where profile_id = b and not removed) then
    raise exception 'another account was touched';
  end if;
end $$;

-- Staff answer an emailed request; the app cannot.
do $$ begin
  if has_function_privilege('authenticated', 'public.delete_account_for_email(text)', 'execute')
     or has_function_privilege('anon', 'public.delete_account_for_email(text)', 'execute') then
    raise exception 'the app can delete accounts by email';
  end if;
  if not public.delete_account_for_email(' Emailer@Example.org ') then raise exception 'email request not found'; end if;
  if exists (select 1 from auth.users where email = 'emailer@example.org') then raise exception 'email request not deleted'; end if;
  if public.delete_account_for_email('emailer@example.org') then raise exception 'deleted twice'; end if;
  if not exists (select 1 from auth.users where id::text = 'd0000000-0000-0000-0000-00000000000b') then raise exception 'wrong account deleted'; end if;
end $$;
rollback;
