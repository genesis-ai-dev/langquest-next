-- Invite keys and stewards (docs/invites-and-accounts.md). Repeatable
-- against a populated database; every test write rolls back.
\set ON_ERROR_STOP on
begin;
-- Two people with their own email, two looked-after accounts.
insert into auth.users (id, email, aud, role) values
  ('20000000-0000-0000-0000-00000000000a', 'keys-admin@example.org', 'authenticated', 'authenticated'),
  ('20000000-0000-0000-0000-00000000000b', 'keys-other-admin@example.org', 'authenticated', 'authenticated'),
  ('20000000-0000-0000-0000-00000000000c', 'nyibol-482@people.langquest.org', 'authenticated', 'authenticated'),
  ('20000000-0000-0000-0000-00000000000d', 'akol-117@people.langquest.org', 'authenticated', 'authenticated');
select public._apply_org_event('keys-org','v1.RoleDefined',
  '{"roleId":"admin","name":"Admin","privileges":["invite_members","manage_structure"]}', '999:1:test');
select public._apply_org_event('keys-org','v1.RoleDefined',
  '{"roleId":"translator","name":"Translator","privileges":["translate","invite_members"]}', '999:1:test');
select public._apply_org_event('keys-org','v1.OrgMemberAdded',
  '{"profileId":"20000000-0000-0000-0000-00000000000a","roleId":"admin","scope":{"level":"org"}}','999:1:test');
select public._apply_org_event('keys-org','v1.OrgMemberAdded',
  '{"profileId":"20000000-0000-0000-0000-00000000000b","roleId":"admin","scope":{"level":"org"}}','999:1:test');
select public._append_event_as('keys-org-created','keys-org','_org','v1.OrgCreated','20000000-0000-0000-0000-00000000000a','server','{"name":"Keys test"}');
select public._append_event_as('keys-lang','keys-org','_org','v1.PartitionRegistered','20000000-0000-0000-0000-00000000000a','server','{"partitionId":"L-keys","name":"Keyish"}');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-00000000000a',true);
-- One person, scoped to one language, with a label; and a group of two.
select public.issue_invite_v3('keys-org','30000000-0000-0000-0000-000000000001',
  encode(extensions.digest(repeat('c',64),'sha256'),'hex'),'translator',
  '{"level":"lane","partitionId":"L-keys","laneId":"L-keys"}',now()+interval '1 day','Nyibol Deng',1);
select public.issue_invite_v3('keys-org','30000000-0000-0000-0000-000000000002',
  encode(extensions.digest(repeat('d',64),'sha256'),'hex'),'translator','{"level":"org"}',now()+interval '1 day','Workshop',2);

-- Signed out: the preview says what the key means.
select set_config('request.jwt.claim.sub','',true);
do $$ declare p jsonb := public.preview_invite(repeat('c',64)); begin
  if p->>'status' <> 'ok' then raise exception 'preview status %', p; end if;
  if p->>'label' <> 'Nyibol Deng' or p->>'roleName' <> 'Translator' or p->>'languageName' <> 'Keyish'
     or p->>'orgName' <> 'Keys test' or p->>'scopeLevel' <> 'lane' then raise exception 'preview wrong: %', p; end if;
  if public.preview_invite(repeat('9',64))->>'status' <> 'not_found' then raise exception 'unknown token should be not_found'; end if;
  if public.preview_invite('not a token')->>'status' <> 'not_found' then raise exception 'malformed token should be not_found'; end if;
end $$;

-- A looked-after account joins: membership, steward, and its label is gone.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-00000000000c',true);
do $$ begin
  if public.redeem_invite_v2(repeat('c',64)) <> 'keys-org' then raise exception 'wrong org'; end if;
  if public.redeem_invite_v2(repeat('c',64)) <> 'keys-org' then raise exception 'second use by the same person must succeed'; end if;
  if public.preview_invite(repeat('c',64))->>'status' <> 'joined' then raise exception 'preview should say joined'; end if;
  if not ('translate' = any(public.org_privileges('keys-org','20000000-0000-0000-0000-00000000000c','L-keys',null))) then
    raise exception 'lane membership missing'; end if;
  if (select steward_id::text from public.account_stewards where profile_id = '20000000-0000-0000-0000-00000000000c')
     <> '20000000-0000-0000-0000-00000000000a' then raise exception 'steward not recorded'; end if;
  if (select label from public.invites where id::text = '30000000-0000-0000-0000-000000000001') is not null then
    raise exception 'a used one-person label must be cleared'; end if;
  -- A looked-after account may not invite, whatever its role says.
  begin
    perform public.issue_invite_v3('keys-org','30000000-0000-0000-0000-000000000003',
      encode(extensions.digest(repeat('e',64),'sha256'),'hex'),'translator','{"level":"org"}',now()+interval '1 day',null,1);
    raise exception 'looked-after account invited';
  exception when insufficient_privilege then null; end;
  begin
    perform public.issue_invite('keys-org','30000000-0000-0000-0000-000000000004',
      encode(extensions.digest(repeat('f',64),'sha256'),'hex'),'translator','{"level":"org"}',now()+interval '1 day');
    raise exception 'looked-after account invited through the old signature';
  exception when insufficient_privilege then null; end;
end $$;

-- Someone else: the one-person key is used up; the group key takes two.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-00000000000d',true);
do $$ begin
  if public.preview_invite(repeat('c',64))->>'status' <> 'used' then raise exception 'preview should say used'; end if;
  begin
    perform public.redeem_invite_v2(repeat('c',64));
    raise exception 'a used invite admitted another person';
  exception when sqlstate '22023' then null; end;
  if public.redeem_invite_v2(repeat('d',64)) <> 'keys-org' then raise exception 'group use 1'; end if;
end $$;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-00000000000c',true);
do $$ begin
  if public.redeem_invite_v2(repeat('d',64)) <> 'keys-org' then raise exception 'group use 2'; end if;
  if (select count(*) from public.events where id like 'invitemember:30000000-0000-0000-0000-000000000002%') <> 2 then
    raise exception 'each group use is its own event'; end if;
end $$;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-00000000000b',true);
do $$ begin
  if public.preview_invite(repeat('d',64))->>'status' <> 'used' then raise exception 'group should be used up'; end if;
  begin
    perform public.redeem_invite_v2(repeat('d',64));
    raise exception 'a third person used a two-person invite';
  exception when sqlstate '22023' then null; end;
end $$;

-- Who may sign a looked-after person back in.
do $$ begin
  if not public.may_help_sign_in('20000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-00000000000c') then
    raise exception 'the steward must be able to help'; end if;
  if not public.may_help_sign_in('20000000-0000-0000-0000-00000000000b','20000000-0000-0000-0000-00000000000c') then
    raise exception 'another org admin must be able to help'; end if;
  if public.may_help_sign_in('20000000-0000-0000-0000-00000000000d','20000000-0000-0000-0000-00000000000c') then
    raise exception 'another translator must not'; end if;
  if public.may_help_sign_in('20000000-0000-0000-0000-00000000000b','20000000-0000-0000-0000-00000000000a') then
    raise exception 'nobody signs in an account with its own email'; end if;
  if public.may_help_sign_in('20000000-0000-0000-0000-00000000000c','20000000-0000-0000-0000-00000000000c') then
    raise exception 'not oneself'; end if;
end $$;

-- Sign-in keys: only a helper may make one, it works once, and only for a looked-after account.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-00000000000a',true);
do $$ begin
  if public.issue_sign_in_code('20000000-0000-0000-0000-00000000000c', repeat('1',64)) <> 'nyibol-482' then
    raise exception 'issue should return the sign-in name'; end if;
  -- A new key replaces the unused one.
  perform public.issue_sign_in_code('20000000-0000-0000-0000-00000000000c', repeat('2',64));
  if exists (select 1 from public.sign_in_codes where code_hash = repeat('1',64)) then raise exception 'old key must go'; end if;
  begin
    perform public.issue_sign_in_code('20000000-0000-0000-0000-00000000000b', repeat('3',64));
    raise exception 'a key for an own-email account';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-00000000000d',true);
do $$ begin
  begin
    perform public.issue_sign_in_code('20000000-0000-0000-0000-00000000000c', repeat('4',64));
    raise exception 'another translator made a key';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.take_sign_in_code(repeat('2',64));
    raise exception 'a signed-in person took a key';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  if (select count(*) from public.take_sign_in_code(repeat('2',64))) <> 1 then raise exception 'key should work once'; end if;
  if (select count(*) from public.take_sign_in_code(repeat('2',64))) <> 0 then raise exception 'key worked twice'; end if;
  perform public.release_sign_in_code(repeat('2',64));
  if (select count(*) from public.take_sign_in_code(repeat('2',64))) <> 1 then raise exception 'a released key should work again'; end if;
end $$;

-- Deleting the steward removes the row; an admin can still help.
delete from auth.users where id = '20000000-0000-0000-0000-00000000000a';
do $$ begin
  if exists (select 1 from public.account_stewards where profile_id = '20000000-0000-0000-0000-00000000000c') then
    raise exception 'steward row must go with the steward'; end if;
  if not public.may_help_sign_in('20000000-0000-0000-0000-00000000000b','20000000-0000-0000-0000-00000000000c') then
    raise exception 'admin must still be able to help'; end if;
end $$;
rollback;
