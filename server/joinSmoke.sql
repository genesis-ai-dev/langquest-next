-- Joining by invite with no password, and who may help someone back in
-- (docs/invites-and-accounts.md, decisions.md 59). Repeatable against a
-- populated database; every test write rolls back.
\set ON_ERROR_STOP on
begin;
-- An org admin, two language leads, an admin who will leave, and two
-- looked-after accounts made by `join`.
insert into auth.users (id, email, aud, role) values
  ('21000000-0000-0000-0000-00000000000a', 'join-admin@example.org', 'authenticated', 'authenticated'),
  ('21000000-0000-0000-0000-00000000000b', 'join-lead-one@example.org', 'authenticated', 'authenticated'),
  ('21000000-0000-0000-0000-00000000000c', 'join-lead-two@example.org', 'authenticated', 'authenticated'),
  ('21000000-0000-0000-0000-00000000000d', 'join-leaver@example.org', 'authenticated', 'authenticated'),
  ('21000000-0000-0000-0000-00000000000e', 'achol-201@people.langquest.org', 'authenticated', 'authenticated'),
  ('21000000-0000-0000-0000-00000000000f', 'deng-202@people.langquest.org', 'authenticated', 'authenticated');
insert into public.profiles (id, display_name) values ('21000000-0000-0000-0000-00000000000b', 'Ryder Lead');
-- The organization, its roles, its admins, two languages and their leads,
-- in one batch.
select set_config('request.jwt.claim.sub','21000000-0000-0000-0000-00000000000a',true);
do $$ declare r record; begin
  for r in select * from public.append_events('[
    {"id":"join-o1","type":"v1.OrgCreated","orgId":"join-org","streamId":"_org","actorId":"21000000-0000-0000-0000-00000000000a","deviceId":"dJ","hlc":"000000000000001:000000:dJ","payload":{"name":"Join test"}},
    {"id":"join-o2","type":"v1.RoleDefined","orgId":"join-org","streamId":"_org","actorId":"21000000-0000-0000-0000-00000000000a","deviceId":"dJ","hlc":"000000000000002:000000:dJ","payload":{"roleId":"admin","name":"Admin","privileges":["invite_members","manage_structure"]}},
    {"id":"join-o3","type":"v1.RoleDefined","orgId":"join-org","streamId":"_org","actorId":"21000000-0000-0000-0000-00000000000a","deviceId":"dJ","hlc":"000000000000003:000000:dJ","payload":{"roleId":"lead","name":"Lead","privileges":["invite_members","translate"]}},
    {"id":"join-o4","type":"v1.RoleDefined","orgId":"join-org","streamId":"_org","actorId":"21000000-0000-0000-0000-00000000000a","deviceId":"dJ","hlc":"000000000000004:000000:dJ","payload":{"roleId":"translator","name":"Translator","privileges":["translate"]}},
    {"id":"join-o5","type":"v1.MemberAdded","orgId":"join-org","streamId":"_org","actorId":"21000000-0000-0000-0000-00000000000a","deviceId":"dJ","hlc":"000000000000005:000000:dJ","payload":{"profileId":"21000000-0000-0000-0000-00000000000a","roleId":"admin","scope":{"level":"org"}}},
    {"id":"join-o6","type":"v1.LanguageAdded","orgId":"join-org","streamId":"_org","actorId":"21000000-0000-0000-0000-00000000000a","deviceId":"dJ","hlc":"000000000000006:000000:dJ","payload":{"languageId":"L-one","name":"Languish","code":"lgs","sourceCode":"eng"}},
    {"id":"join-o7","type":"v1.LanguageAdded","orgId":"join-org","streamId":"_org","actorId":"21000000-0000-0000-0000-00000000000a","deviceId":"dJ","hlc":"000000000000007:000000:dJ","payload":{"languageId":"L-two","name":"Otherish","code":"oth","sourceCode":"eng"}},
    {"id":"join-o8","type":"v1.MemberAdded","orgId":"join-org","streamId":"_org","actorId":"21000000-0000-0000-0000-00000000000a","deviceId":"dJ","hlc":"000000000000008:000000:dJ","payload":{"profileId":"21000000-0000-0000-0000-00000000000b","roleId":"lead","scope":{"level":"language","languageId":"L-one"}}},
    {"id":"join-o9","type":"v1.MemberAdded","orgId":"join-org","streamId":"_org","actorId":"21000000-0000-0000-0000-00000000000a","deviceId":"dJ","hlc":"000000000000009:000000:dJ","payload":{"profileId":"21000000-0000-0000-0000-00000000000c","roleId":"lead","scope":{"level":"language","languageId":"L-two"}}},
    {"id":"join-o10","type":"v1.MemberAdded","orgId":"join-org","streamId":"_org","actorId":"21000000-0000-0000-0000-00000000000a","deviceId":"dJ","hlc":"000000000000010:000000:dJ","payload":{"profileId":"21000000-0000-0000-0000-00000000000d","roleId":"admin","scope":{"level":"org"}}}
  ]'::jsonb, (select min_client_version from public.server_config)) loop
    if not r.accepted then raise exception 'bootstrap event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;

-- The admin invites Achol to the first language; the admin who will leave invites Deng.
select set_config('request.jwt.claim.sub','21000000-0000-0000-0000-00000000000a',true);
select public.issue_invite_v3('join-org','31000000-0000-0000-0000-000000000001',
  encode(extensions.digest(repeat('a',64),'sha256'),'hex'),'translator',
  '{"level":"language","languageId":"L-one"}',now()+interval '1 day','Achol Mabior',1);
select set_config('request.jwt.claim.sub','21000000-0000-0000-0000-00000000000d',true);
select public.issue_invite_v3('join-org','31000000-0000-0000-0000-000000000002',
  encode(extensions.digest(repeat('b',64),'sha256'),'hex'),'translator',
  '{"level":"language","languageId":"L-one"}',now()+interval '1 day','Deng',1);

-- `join` (the service role) redeems for the account it just made.
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  if public.redeem_invite_for('21000000-0000-0000-0000-00000000000e', repeat('a',64)) <> 'join-org' then
    raise exception 'redeem for a named account'; end if;
  if public.redeem_invite_for('21000000-0000-0000-0000-00000000000e', repeat('a',64)) <> 'join-org' then
    raise exception 'a repeat for the same account must succeed'; end if;
  if public.redeem_invite_for('21000000-0000-0000-0000-00000000000f', repeat('b',64)) <> 'join-org' then
    raise exception 'second join'; end if;
  if not ('translate' = any(public.org_privileges('join-org','21000000-0000-0000-0000-00000000000e','L-one'))) then
    raise exception 'language membership missing'; end if;
  if (select steward_id::text from public.account_stewards where profile_id = '21000000-0000-0000-0000-00000000000e')
     <> '21000000-0000-0000-0000-00000000000a' then raise exception 'who to ask not recorded'; end if;
  begin
    perform public.redeem_invite_for(null, repeat('a',64));
    raise exception 'no account named';
  exception when insufficient_privilege then null; end;
end $$;

-- The signed-in person still redeems for themselves.
select set_config('request.jwt.claim.sub','21000000-0000-0000-0000-00000000000a',true);
select public.issue_invite_v3('join-org','31000000-0000-0000-0000-000000000003',
  encode(extensions.digest(repeat('c',64),'sha256'),'hex'),'translator','{"level":"org"}',now()+interval '1 day',null,2);
select set_config('request.jwt.claim.sub','21000000-0000-0000-0000-00000000000c',true);
do $$ begin
  if public.redeem_invite_v2(repeat('c',64)) <> 'join-org' then raise exception 'redeem_invite_v2 for oneself'; end if;
end $$;

-- Only the service role may name another account, or read join requests.
set local role authenticated;
do $$ begin
  begin
    perform public.redeem_invite_for('21000000-0000-0000-0000-00000000000c', repeat('c',64));
    raise exception 'a signed-in person redeemed for someone else';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.invite_join_requests limit 1;
    raise exception 'join requests readable by a signed-in person';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Who may help: whoever holds Invite where the person is, while they hold it.
do $$ begin
  if not public.may_help_sign_in('21000000-0000-0000-0000-00000000000a','21000000-0000-0000-0000-00000000000e') then
    raise exception 'an org admin must be able to help'; end if;
  if not public.may_help_sign_in('21000000-0000-0000-0000-00000000000b','21000000-0000-0000-0000-00000000000e') then
    raise exception 'the lead of their language must be able to help'; end if;
  if public.may_help_sign_in('21000000-0000-0000-0000-00000000000c','21000000-0000-0000-0000-00000000000e') then
    raise exception 'the lead of another language must not'; end if;
  if not public.may_help_sign_in('21000000-0000-0000-0000-00000000000d','21000000-0000-0000-0000-00000000000f') then
    raise exception 'an admin can help before leaving'; end if;
  if public.may_help_sign_in('21000000-0000-0000-0000-00000000000e','21000000-0000-0000-0000-00000000000f') then
    raise exception 'a looked-after account must not help'; end if;
  if public.may_help_sign_in('21000000-0000-0000-0000-00000000000a','21000000-0000-0000-0000-00000000000b') then
    raise exception 'nobody signs in an account with its own email'; end if;
end $$;
-- The admin who invited Deng leaves, and the lead loses their language:
-- neither can help any more, though the leaver is still recorded as the one
-- who invited Deng.
select public._append_event_as('join-leave-d','join-org','_org','v1.MemberRemoved','21000000-0000-0000-0000-00000000000a','server',
  '{"profileId":"21000000-0000-0000-0000-00000000000d","scope":{"level":"org"}}');
select public._append_event_as('join-leave-b','join-org','_org','v1.MemberRemoved','21000000-0000-0000-0000-00000000000a','server',
  '{"profileId":"21000000-0000-0000-0000-00000000000b","scope":{"level":"language","languageId":"L-one"}}');
do $$ begin
  if public.may_help_sign_in('21000000-0000-0000-0000-00000000000d','21000000-0000-0000-0000-00000000000f') then
    raise exception 'the inviter who left must not help'; end if;
  if public.may_help_sign_in('21000000-0000-0000-0000-00000000000b','21000000-0000-0000-0000-00000000000e') then
    raise exception 'a lead without the language any more must not help'; end if;
  if (select steward_id::text from public.account_stewards where profile_id = '21000000-0000-0000-0000-00000000000f')
     <> '21000000-0000-0000-0000-00000000000d' then raise exception 'who to ask should stay recorded'; end if;
end $$;

-- A code that says the old phone is lost, and who helped.
select public._append_event_as('join-back-b','join-org','_org','v1.MemberAdded','21000000-0000-0000-0000-00000000000a','server',
  '{"profileId":"21000000-0000-0000-0000-00000000000b","roleId":"lead","scope":{"level":"language","languageId":"L-one"}}');
select set_config('request.jwt.claim.sub','21000000-0000-0000-0000-00000000000b',true);
do $$ begin
  if public.issue_sign_in_code_v2('21000000-0000-0000-0000-00000000000e', repeat('5',64), true) <> 'achol-201' then
    raise exception 'issue should return the sign-in name'; end if;
  -- The old signature makes a code that keeps the old phone.
  perform public.issue_sign_in_code('21000000-0000-0000-0000-00000000000f', repeat('6',64));
end $$;
select set_config('request.jwt.claim.sub','',true);
do $$ declare r record; begin
  select * into r from public.take_sign_in_code_v2(repeat('5',64));
  if r.profile_id::text <> '21000000-0000-0000-0000-00000000000e' or not r.lost or r.helper_name <> 'Ryder Lead' then
    raise exception 'take_sign_in_code_v2 wrong: %', r; end if;
  if (select count(*) from public.take_sign_in_code_v2(repeat('5',64))) <> 0 then raise exception 'a code worked twice'; end if;
  select * into r from public.take_sign_in_code_v2(repeat('6',64));
  if r.lost then raise exception 'an old-signature code must keep the old phone'; end if;
end $$;
select set_config('request.jwt.claim.sub','21000000-0000-0000-0000-00000000000a',true);
do $$ begin
  begin
    perform * from public.take_sign_in_code_v2(repeat('7',64));
    raise exception 'a signed-in person took a code';
  exception when insufficient_privilege then null; end;
end $$;

-- Someone asking to join is named to whoever may admit them, and to nobody
-- else, until the request is decided (decisions.md 65).
insert into auth.users (id, email, aud, role) values
  ('21000000-0000-0000-0000-000000000010', 'join-asker@example.org', 'authenticated', 'authenticated');
insert into public.profiles (id, display_name) values ('21000000-0000-0000-0000-000000000010', 'Amira Asker');
select set_config('request.jwt.claim.sub','21000000-0000-0000-0000-000000000010',true);
select public.create_join_request('join-org','join-request-amira','Please let me help');
-- The admin's Inbox row comes with the request (decisions.md 68); only
-- organization-wide Invite gets one.
do $$ begin
  if not exists (select 1 from public.notifications where org_id = 'join-org' and kind = 'join_request' and active
      and profile_id = '21000000-0000-0000-0000-00000000000a') then raise exception 'no Inbox row for the admin'; end if;
  if exists (select 1 from public.notifications where org_id = 'join-org' and kind = 'join_request' and active
      and profile_id in ('21000000-0000-0000-0000-00000000000e', '21000000-0000-0000-0000-00000000000b')) then
    raise exception 'an Inbox row for someone who cannot admit'; end if;
end $$;
set local role authenticated;
-- The org admin; a member with no Invite; a lead who holds Invite only in a language.
select set_config('request.jwt.claim.sub','21000000-0000-0000-0000-00000000000a',true);
do $$ begin
  if not exists (select 1 from public.profiles where id = '21000000-0000-0000-0000-000000000010') then
    raise exception 'an admin must see who is asking to join'; end if;
end $$;
select set_config('request.jwt.claim.sub','21000000-0000-0000-0000-00000000000e',true);
do $$ begin
  if exists (select 1 from public.profiles where id = '21000000-0000-0000-0000-000000000010') then
    raise exception 'a member who cannot admit saw a requester'; end if;
end $$;
select set_config('request.jwt.claim.sub','21000000-0000-0000-0000-00000000000b',true);
do $$ begin
  if exists (select 1 from public.profiles where id = '21000000-0000-0000-0000-000000000010') then
    raise exception 'a language lead saw a requester to the organization'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','21000000-0000-0000-0000-00000000000a',true);
select public.decide_join_request('join-request-amira', false);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.profiles where id = '21000000-0000-0000-0000-000000000010') then
    raise exception 'a turned-away requester stayed visible'; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.notifications where org_id = 'join-org' and kind = 'join_request' and active) then
    raise exception 'a decided request left an Inbox row'; end if;
end $$;
rollback;
