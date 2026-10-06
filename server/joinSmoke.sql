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
select public._apply_org_event('join-org','v1.RoleDefined',
  '{"roleId":"admin","name":"Admin","privileges":["invite_members","manage_structure"]}', '999:1:test');
select public._apply_org_event('join-org','v1.RoleDefined',
  '{"roleId":"lead","name":"Lead","privileges":["invite_members","translate"]}', '999:1:test');
select public._apply_org_event('join-org','v1.RoleDefined',
  '{"roleId":"translator","name":"Translator","privileges":["translate"]}', '999:1:test');
select public._apply_org_event('join-org','v1.OrgMemberAdded',
  '{"profileId":"21000000-0000-0000-0000-00000000000a","roleId":"admin","scope":{"level":"org"}}','999:1:test');
select public._apply_org_event('join-org','v1.OrgMemberAdded',
  '{"profileId":"21000000-0000-0000-0000-00000000000b","roleId":"lead","scope":{"level":"lane","projectId":"L-one","laneId":"L-one"}}','999:1:test');
select public._apply_org_event('join-org','v1.OrgMemberAdded',
  '{"profileId":"21000000-0000-0000-0000-00000000000c","roleId":"lead","scope":{"level":"lane","projectId":"L-two","laneId":"L-two"}}','999:1:test');
select public._apply_org_event('join-org','v1.OrgMemberAdded',
  '{"profileId":"21000000-0000-0000-0000-00000000000d","roleId":"admin","scope":{"level":"org"}}','999:1:test');
select public._append_event_as('join-org-created','join-org','_org','v1.OrgCreated','21000000-0000-0000-0000-00000000000a','server','{"name":"Join test"}');
select public._append_event_as('join-lang-one','join-org','_org','v1.ProjectRegistered','21000000-0000-0000-0000-00000000000a','server','{"projectId":"L-one","name":"Languish"}');

-- The admin invites Achol to the first language; the admin who will leave invites Deng.
select set_config('request.jwt.claim.sub','21000000-0000-0000-0000-00000000000a',true);
select public.issue_invite_v3('join-org','31000000-0000-0000-0000-000000000001',
  encode(extensions.digest(repeat('a',64),'sha256'),'hex'),'translator',
  '{"level":"lane","projectId":"L-one","laneId":"L-one"}',now()+interval '1 day','Achol Mabior',1);
select set_config('request.jwt.claim.sub','21000000-0000-0000-0000-00000000000d',true);
select public.issue_invite_v3('join-org','31000000-0000-0000-0000-000000000002',
  encode(extensions.digest(repeat('b',64),'sha256'),'hex'),'translator',
  '{"level":"lane","projectId":"L-one","laneId":"L-one"}',now()+interval '1 day','Deng',1);

-- `join` (the service role) redeems for the account it just made.
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  if public.redeem_invite_for('21000000-0000-0000-0000-00000000000e', repeat('a',64)) <> 'join-org' then
    raise exception 'redeem for a named account'; end if;
  if public.redeem_invite_for('21000000-0000-0000-0000-00000000000e', repeat('a',64)) <> 'join-org' then
    raise exception 'a repeat for the same account must succeed'; end if;
  if public.redeem_invite_for('21000000-0000-0000-0000-00000000000f', repeat('b',64)) <> 'join-org' then
    raise exception 'second join'; end if;
  if not ('translate' = any(public.org_privileges('join-org','21000000-0000-0000-0000-00000000000e','L-one','L-one'))) then
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
select public._apply_org_event('join-org','v1.OrgMemberRemoved',
  '{"profileId":"21000000-0000-0000-0000-00000000000d","scope":{"level":"org"}}','999:2:test');
select public._apply_org_event('join-org','v1.OrgMemberRemoved',
  '{"profileId":"21000000-0000-0000-0000-00000000000b","scope":{"level":"lane","projectId":"L-one","laneId":"L-one"}}','999:2:test');
do $$ begin
  if public.may_help_sign_in('21000000-0000-0000-0000-00000000000d','21000000-0000-0000-0000-00000000000f') then
    raise exception 'the inviter who left must not help'; end if;
  if public.may_help_sign_in('21000000-0000-0000-0000-00000000000b','21000000-0000-0000-0000-00000000000e') then
    raise exception 'a lead without the language any more must not help'; end if;
  if (select steward_id::text from public.account_stewards where profile_id = '21000000-0000-0000-0000-00000000000f')
     <> '21000000-0000-0000-0000-00000000000d' then raise exception 'who to ask should stay recorded'; end if;
end $$;

-- A code that says the old phone is lost, and who helped.
select public._apply_org_event('join-org','v1.OrgMemberAdded',
  '{"profileId":"21000000-0000-0000-0000-00000000000b","roleId":"lead","scope":{"level":"lane","projectId":"L-one","laneId":"L-one"}}','999:3:test');
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
rollback;
