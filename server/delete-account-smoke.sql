-- delete_my_account and delete_account_for_email (decisions.md 46, 47).
-- Repeatable; every write rolls back.
\set ON_ERROR_STOP on
begin;
update public.server_config set min_client_version = 0;
insert into auth.users (id, email) values
  ('d0000000-0000-0000-0000-00000000000a', 'leaver@example.org'),
  ('d0000000-0000-0000-0000-00000000000b', 'stayer@example.org'),
  ('d0000000-0000-0000-0000-00000000000c', 'emailer@example.org');
-- The leaver made the organization and its language, holds a role in both
-- scopes, and authored work in the language.
-- Set up as the server would (an import): people here have joined by invite or request (decisions.md 75).
select set_config('request.jwt.claim.sub','',true);
do $$ declare r record; begin
  for r in select * from public.append_events('[
    {"id":"del-test-o1","type":"v1.OrgCreated","orgId":"del-test-org","streamId":"_org","actorId":"d0000000-0000-0000-0000-00000000000a","deviceId":"dev-a","hlc":"000000000000001:000000:dev-a","payload":{"name":"Leaver Org"}},
    {"id":"del-test-o2","type":"v1.RoleDefined","orgId":"del-test-org","streamId":"_org","actorId":"d0000000-0000-0000-0000-00000000000a","deviceId":"dev-a","hlc":"000000000000002:000000:dev-a","payload":{"roleId":"admin","name":"Admin","privileges":["invite_members","manage_structure"]}},
    {"id":"del-test-o4","type":"v1.RoleDefined","orgId":"del-test-org","streamId":"_org","actorId":"d0000000-0000-0000-0000-00000000000a","deviceId":"dev-a","hlc":"000000000000003:000000:dev-a","payload":{"roleId":"translator","name":"Translator","privileges":["translate"]}},
    {"id":"del-test-add-a","type":"v1.MemberAdded","orgId":"del-test-org","streamId":"_org","actorId":"d0000000-0000-0000-0000-00000000000a","deviceId":"dev-a","hlc":"000000000000004:000000:dev-a","payload":{"profileId":"d0000000-0000-0000-0000-00000000000a","roleId":"admin","scope":{"level":"org"}}},
    {"id":"del-test-o5","type":"v1.LanguageAdded","orgId":"del-test-org","streamId":"_org","actorId":"d0000000-0000-0000-0000-00000000000a","deviceId":"dev-a","hlc":"000000000000005:000000:dev-a","payload":{"languageId":"L1","name":"Leaver Language","code":"fia","sourceCode":"eng"}},
    {"id":"del-test-o6","type":"v1.MemberAdded","orgId":"del-test-org","streamId":"_org","actorId":"d0000000-0000-0000-0000-00000000000a","deviceId":"dev-a","hlc":"000000000000006:000000:dev-a","payload":{"profileId":"d0000000-0000-0000-0000-00000000000a","roleId":"translator","scope":{"level":"language","languageId":"L1"}}},
    {"id":"del-test-o7","type":"v1.MemberAdded","orgId":"del-test-org","streamId":"_org","actorId":"d0000000-0000-0000-0000-00000000000a","deviceId":"dev-a","hlc":"000000000000007:000000:dev-a","payload":{"profileId":"d0000000-0000-0000-0000-00000000000b","roleId":"admin","scope":{"level":"org"}}},
    {"id":"del-test-work","type":"v1.NoteAdded","orgId":"del-test-org","streamId":"L1","actorId":"d0000000-0000-0000-0000-00000000000a","deviceId":"dev-a","hlc":"000000000000008:000000:dev-a","payload":{"noteId":"n1","unitId":"u1","anchor":{"kind":"passage"},"text":"kept"}}
  ]'::jsonb) loop
    if not r.accepted then raise exception 'setup event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;
insert into public.profiles (id, display_name) values
  ('d0000000-0000-0000-0000-00000000000a','Leaver Name'), ('d0000000-0000-0000-0000-00000000000b','Stayer Name');
insert into public.push_tokens (token, profile_id) values
  ('ExponentPushToken[leaver]','d0000000-0000-0000-0000-00000000000a'),
  ('ExponentPushToken[stayer]','d0000000-0000-0000-0000-00000000000b');
insert into public.notifications (id, profile_id, org_id, language_id, kind, title) values
  ('del-test-n1','d0000000-0000-0000-0000-00000000000a','del-test-org','L1','request','Record this'),
  ('del-test-n2','d0000000-0000-0000-0000-00000000000b','del-test-org','L1','request','Record this');
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

-- The log refuses edits and deletes, for every row; deletion only appends.
do $$ begin
  begin
    update public.events set payload = payload || '{"roleId":"translator"}' where id = 'del-test-add-a';
    raise exception 'edited the log';
  exception when sqlstate '42501' then null; end;
  begin
    update public.events set payload = '{"noteId":"n1","text":"changed"}' where id = 'del-test-work';
    raise exception 'edited authored work in the log';
  exception when sqlstate '42501' then null; end;
  begin
    delete from public.events where id = 'del-test-add-a';
    raise exception 'deleted an event';
  exception when sqlstate '42501' then null; end;
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
  if exists (select 1 from public.org_memberships where profile_id = a and not removed) then raise exception 'membership kept'; end if;
  if cardinality(public.org_privileges('del-test-org', a, 'L1')) <> 0 then raise exception 'privileges kept in the language'; end if;
  if (select count(*) from public.events where type = 'v1.MemberRemoved' and payload->>'profileId' = a) <> 2 then
    raise exception 'expected one removal per scope, once';
  end if;
  if (select count(*) from public.events where type = 'v1.MemberRemoved' and payload->>'profileId' = a
        and actor_id = 'service' and stream_id = '_org'
        and id in ('accountdeleted:' || a || ':org', 'accountdeleted:' || a || ':language:L1')) <> 2 then
    raise exception 'removals not by the service, one id per scope';
  end if;
  if not exists (select 1 from public.events where type = 'v1.MemberRemoved'
      and payload = jsonb_build_object('profileId', a, 'scope', '{"level":"language","languageId":"L1"}'::jsonb)) then
    raise exception 'language scope not rebuilt';
  end if;
  if not exists (select 1 from public.events where type = 'v1.MemberRemoved'
      and payload = jsonb_build_object('profileId', a, 'scope', '{"level":"org"}'::jsonb)) then
    raise exception 'org scope not rebuilt';
  end if;
  if not exists (select 1 from public.events where id = 'del-test-work') then raise exception 'authored work lost'; end if;
  if (select payload from public.events where id = 'del-test-add-a')
       is distinct from jsonb_build_object('profileId', a, 'roleId', 'admin', 'scope', '{"level":"org"}'::jsonb) then
    raise exception 'deletion changed the log';
  end if;
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
