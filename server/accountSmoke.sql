-- Repeatable against a populated database; every test write rolls back.
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','audit-admin',true);
do $$ declare r record; begin
  for r in select * from public.append_events('[
    {"id":"audit-o1","type":"v1.OrgCreated","orgId":"audit-test-org","streamId":"_org","actorId":"audit-admin","deviceId":"dU","hlc":"000000000000001:000000:dU","payload":{"name":"Audit test"}},
    {"id":"audit-o2","type":"v1.RoleDefined","orgId":"audit-test-org","streamId":"_org","actorId":"audit-admin","deviceId":"dU","hlc":"000000000000002:000000:dU","payload":{"roleId":"admin","name":"Admin","privileges":["invite_members","manage_structure"]}},
    {"id":"audit-o3","type":"v1.RoleDefined","orgId":"audit-test-org","streamId":"_org","actorId":"audit-admin","deviceId":"dU","hlc":"000000000000003:000000:dU","payload":{"roleId":"translator","name":"Translator","privileges":["translate"]}},
    {"id":"audit-o4","type":"v1.MemberAdded","orgId":"audit-test-org","streamId":"_org","actorId":"audit-admin","deviceId":"dU","hlc":"000000000000004:000000:dU","payload":{"profileId":"audit-admin","roleId":"admin","scope":{"level":"org"}}},
    {"id":"audit-o5","type":"v1.LanguageAdded","orgId":"audit-test-org","streamId":"_org","actorId":"audit-admin","deviceId":"dU","hlc":"000000000000005:000000:dU","payload":{"languageId":"L1","name":"Audit language","code":"aud","sourceCode":"eng"}}
  ]'::jsonb, (select min_client_version from public.server_config)) loop
    if not r.accepted then raise exception 'bootstrap event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;
select public.issue_invite_v3('audit-test-org','10000000-0000-0000-0000-000000000001',
  encode(extensions.digest(repeat('a',64),'sha256'),'hex'),'translator','{"level":"org"}',now()+interval '1 day');
-- A retry does not mint another invitation or another log event.
select public.issue_invite_v3('audit-test-org','10000000-0000-0000-0000-000000000001',
  encode(extensions.digest(repeat('a',64),'sha256'),'hex'),'translator','{"level":"org"}',now()+interval '1 day');
do $$ begin
  if (select count(*) from public.invites where id = '10000000-0000-0000-0000-000000000001') <> 1
     or (select count(*) from public.events where id = 'invite:10000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'a retried invite minted twice'; end if;
end $$;
select set_config('request.jwt.claim.sub','audit-newcomer',true);
do $$ begin
  if public.redeem_invite_v2(repeat('a',64)) <> 'audit-test-org' then raise exception 'wrong org'; end if;
  if public.redeem_invite_v2(repeat('a',64)) <> 'audit-test-org' then raise exception 'retry failed'; end if;
  if not ('translate'=any(public.org_privileges('audit-test-org','audit-newcomer',null))) then raise exception 'membership missing'; end if;
end $$;
select set_config('request.jwt.claim.sub','audit-stranger',true);
do $$ begin
  begin
    perform public.redeem_invite_v2(repeat('a',64));
    raise exception 'reused invite admitted another actor';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.issue_invite_v3('audit-test-org','10000000-0000-0000-0000-000000000002',repeat('b',64),'admin','{"level":"org"}',now()+interval '1 day');
    raise exception 'stranger invited an admin';
  exception when sqlstate '42501' then null; end;
end $$;
select public.create_join_request('audit-test-org','10000000-0000-0000-0000-000000000003','Please admit me');
select public.create_join_request('audit-test-org','10000000-0000-0000-0000-000000000003','Please admit me');
select set_config('request.jwt.claim.sub','audit-admin',true);
select public.decide_join_request('10000000-0000-0000-0000-000000000003',true,'translator');
select public.decide_join_request('10000000-0000-0000-0000-000000000003',true,'translator');
select set_config('request.jwt.claim.sub','audit-stranger',true);
select public.create_join_request('audit-test-org','10000000-0000-0000-0000-000000000003','retry after lost response');
-- Account ownership and cross-account privacy.
select public.save_profile('A real name');
select public.record_user_event('audit-stranger:terms','v1.TermsAccepted','{"version":"2026-09-17"}');
select public.record_user_event('audit-stranger:vision','v1.VisionSeen','{}');
select public.record_user_event('audit-stranger:vision','v1.VisionSeen','{}');
do $$ begin
  if not (public.get_user_state()->>'visionSeen')::boolean then raise exception 'vision missing'; end if;
  if (select count(*) from public.events where id='audit-stranger:vision') <> 1 then raise exception 'duplicate user event'; end if;
end $$;
select set_config('request.jwt.claim.sub','audit-outsider',true);
set local role authenticated;
do $$ begin
  if (public.get_user_state()->>'visionSeen')::boolean then raise exception 'private state leaked'; end if;
  if exists(select 1 from public.profiles where id='audit-stranger') then raise exception 'profile leaked'; end if;
  begin
    perform public._append_event_as('forged','audit-test-org','_org','v1.MemberAdded','service','server','{}');
    raise exception 'internal helper callable';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','audit-admin',true);
select public.set_language_visibility('audit-test-org','L1',true);
insert into public.public_languages(org_id,language_id,name) values('audit-test-org','L1','Public test'),('audit-private','L1','Private test');
set local role anon;
do $$ begin
  if not exists(select 1 from public.public_languages where org_id='audit-test-org') then raise exception 'public language invisible'; end if;
  if exists(select 1 from public.public_languages where org_id='audit-private') then raise exception 'private language leaked'; end if;
end $$;
reset role;
-- Cursor stability, privacy, and exclusive push leases.
select public.reconcile_notifications('audit-test-org','L1',
  '[{"id":"audit-notification","profile_id":"audit-stranger","kind":"assignment","title":"Translate"}]');
do $$ declare original_seq bigint; begin
  select seq into original_seq from public.notifications where id='audit-notification';
  perform public.reconcile_notifications('audit-test-org','L1',
    '[{"id":"audit-notification","profile_id":"audit-stranger","kind":"assignment","title":"Translate"}]');
  if (select seq from public.notifications where id='audit-notification')<>original_seq then
    raise exception 'unchanged inbox advanced cursor';
  end if;
  perform public.reconcile_notifications('audit-test-org','L1','[]');
  if (select active or seq<=original_seq from public.notifications where id='audit-notification') then
    raise exception 'removed inbox entry did not advance cursor';
  end if;
end $$;
select public.reconcile_notifications('audit-test-org','L1',
  '[{"id":"audit-notification","profile_id":"audit-stranger","kind":"assignment","title":"Translate"}]');
select set_config('request.jwt.claim.sub','audit-outsider',true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.notifications where id='audit-notification') then
    raise exception 'inbox leaked across accounts';
  end if;
  begin
    perform public.claim_notification_pushes();
    raise exception 'phone can claim worker deliveries';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into public.push_tokens(token,profile_id) values('ExponentPushToken[audit]','audit-stranger');
do $$ begin
  if not exists(select 1 from public.claim_notification_pushes() where id='audit-notification') then
    raise exception 'push was not claimed';
  end if;
  if exists(select 1 from public.claim_notification_pushes() where id='audit-notification') then
    raise exception 'push lease permits duplicate worker';
  end if;
end $$;
select 'account smoke passed' as result;
rollback;
