-- Repeatable against a populated database; every test write rolls back.
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','audit-admin',true);
select public._apply_org_event('audit-test-org','v1.RoleDefined',
  '{"roleId":"admin","name":"Admin","privileges":["invite_members","manage_structure"]}', '999:1:test');
select public._apply_org_event('audit-test-org','v1.RoleDefined',
  '{"roleId":"translator","name":"Translator","privileges":["translate"]}', '999:1:test');
select public._apply_org_event('audit-test-org','v1.OrgMemberAdded',
  '{"profileId":"audit-admin","roleId":"admin","scope":{"level":"org"}}','999:1:test');
select public._append_event_as('audit-org-created','audit-test-org','_org','v1.OrgCreated','audit-admin','server','{"name":"Audit test"}');
select public.issue_invite('audit-test-org','10000000-0000-0000-0000-000000000001',
  encode(extensions.digest(repeat('a',64),'sha256'),'hex'),'translator','{"level":"org"}',now()+interval '1 day');
-- A retry does not mint another invitation or another log event.
select public.issue_invite('audit-test-org','10000000-0000-0000-0000-000000000001',
  encode(extensions.digest(repeat('a',64),'sha256'),'hex'),'translator','{"level":"org"}',now()+interval '1 day');
select set_config('request.jwt.claim.sub','audit-newcomer',true);
do $$ begin
  if public.redeem_invite_v2(repeat('a',64)) <> 'audit-test-org' then raise exception 'wrong org'; end if;
  if public.redeem_invite_v2(repeat('a',64)) <> 'audit-test-org' then raise exception 'retry failed'; end if;
  if not ('translate'=any(public.org_privileges('audit-test-org','audit-newcomer',null,null))) then raise exception 'membership missing'; end if;
end $$;
select set_config('request.jwt.claim.sub','audit-stranger',true);
do $$ begin
  begin
    perform public.redeem_invite_v2(repeat('a',64));
    raise exception 'reused invite admitted another actor';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.issue_invite('audit-test-org','10000000-0000-0000-0000-000000000002',repeat('b',64),'admin','{"level":"org"}',now()+interval '1 day');
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
    perform public._append_event_as('forged','audit-test-org','_org','v1.OrgMemberAdded','service','server','{}');
    raise exception 'internal helper callable';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','audit-admin',true);
select public.set_project_visibility('audit-test-org','p1',true);
insert into public.public_projects(org_id,project_id,name) values('audit-test-org','p1','Public test'),('audit-private','p1','Private test');
set local role anon;
do $$ begin
  if not exists(select 1 from public.public_projects where org_id='audit-test-org') then raise exception 'public project invisible'; end if;
  if exists(select 1 from public.public_projects where org_id='audit-private') then raise exception 'private project leaked'; end if;
end $$;
reset role;
select 'account smoke passed' as result;
rollback;
