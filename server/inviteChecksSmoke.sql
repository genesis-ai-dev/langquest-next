-- An invite that names checks (decisions.md 146): whoever joins with it is
-- put on those checks of its language, as the server; only someone who may
-- choose who does checks there may name them, only for a role that reviews,
-- and only on an invite to one language. Every test write rolls back.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('41000000-0000-0000-0000-00000000000a', 'ic-admin@example.org', 'authenticated', 'authenticated', '{}'),
  ('41000000-0000-0000-0000-00000000000b', 'ic-lead@example.org', 'authenticated', 'authenticated', '{}'),
  ('41000000-0000-0000-0000-00000000000c', 'ic-checker@example.org', 'authenticated', 'authenticated', '{}'),
  ('41000000-0000-0000-0000-00000000000d', 'ic-second@example.org', 'authenticated', 'authenticated', '{}'),
  ('41000000-0000-0000-0000-00000000000e', 'ic-viewer@example.org', 'authenticated', 'authenticated', '{}');
-- An admin who sets up checks, a lead who only invites, a reviewer role and a viewer role, one language.
select set_config('request.jwt.claim.sub','',true);
do $$ declare r record; begin
  for r in select * from public.append_events('[
    {"id":"ic-o1","type":"v1.OrgCreated","orgId":"ic-org","streamId":"_org","actorId":"41000000-0000-0000-0000-00000000000a","deviceId":"dI","hlc":"000000000000001:000000:dI","payload":{"name":"Invite checks"}},
    {"id":"ic-o2","type":"v1.RoleDefined","orgId":"ic-org","streamId":"_org","actorId":"41000000-0000-0000-0000-00000000000a","deviceId":"dI","hlc":"000000000000002:000000:dI","payload":{"roleId":"admin","name":"Admin","privileges":["invite_members","manage_structure","manage_teams","manage_flows","review","translate"]}},
    {"id":"ic-o3","type":"v1.RoleDefined","orgId":"ic-org","streamId":"_org","actorId":"41000000-0000-0000-0000-00000000000a","deviceId":"dI","hlc":"000000000000003:000000:dI","payload":{"roleId":"lead","name":"Lead","privileges":["invite_members","review"]}},
    {"id":"ic-o4","type":"v1.RoleDefined","orgId":"ic-org","streamId":"_org","actorId":"41000000-0000-0000-0000-00000000000a","deviceId":"dI","hlc":"000000000000004:000000:dI","payload":{"roleId":"reviewer","name":"Reviewer","privileges":["review"]}},
    {"id":"ic-o5","type":"v1.RoleDefined","orgId":"ic-org","streamId":"_org","actorId":"41000000-0000-0000-0000-00000000000a","deviceId":"dI","hlc":"000000000000005:000000:dI","payload":{"roleId":"viewer","name":"Viewer","privileges":["view_status"]}},
    {"id":"ic-o6","type":"v1.MemberAdded","orgId":"ic-org","streamId":"_org","actorId":"41000000-0000-0000-0000-00000000000a","deviceId":"dI","hlc":"000000000000006:000000:dI","payload":{"profileId":"41000000-0000-0000-0000-00000000000a","roleId":"admin","scope":{"level":"org"}}},
    {"id":"ic-o7","type":"v1.LanguageAdded","orgId":"ic-org","streamId":"_org","actorId":"41000000-0000-0000-0000-00000000000a","deviceId":"dI","hlc":"000000000000007:000000:dI","payload":{"languageId":"L-ic","name":"Toposa","code":"toq","sourceCode":"eng"}},
    {"id":"ic-o8","type":"v1.MemberAdded","orgId":"ic-org","streamId":"_org","actorId":"41000000-0000-0000-0000-00000000000a","deviceId":"dI","hlc":"000000000000008:000000:dI","payload":{"profileId":"41000000-0000-0000-0000-00000000000b","roleId":"lead","scope":{"level":"language","languageId":"L-ic"}}}
  ]'::jsonb, (select min_client_version from public.server_config)) loop
    if not r.accepted then raise exception 'bootstrap event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;

-- 1. The admin makes a group code for reviewers that puts them on two checks.
select set_config('request.jwt.claim.sub','41000000-0000-0000-0000-00000000000a',true);
select public.issue_invite_v4('ic-org','51000000-0000-0000-0000-000000000001',
  encode(extensions.digest(repeat('a',64),'sha256'),'hex'),'reviewer',
  '{"level":"language","languageId":"L-ic"}',now()+interval '1 day','Toposa team',30,array['peer','community']);
do $$ begin
  if (select checks from public.invites where id = '51000000-0000-0000-0000-000000000001') <> array['peer','community'] then
    raise exception 'the invite did not keep its checks'; end if;
end $$;

-- Issued again as a retry, it keeps them.
select public.issue_invite_v4('ic-org','51000000-0000-0000-0000-000000000001',
  encode(extensions.digest(repeat('a',64),'sha256'),'hex'),'reviewer',
  '{"level":"language","languageId":"L-ic"}',now()+interval '1 day','Toposa team',30,array['peer','community']);

-- 2. Two people join with it; each is on both checks, in the language's stream, as the server.
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  perform public.redeem_invite_for('41000000-0000-0000-0000-00000000000c', repeat('a',64));
  perform public.redeem_invite_for('41000000-0000-0000-0000-00000000000d', repeat('a',64));
  perform public.redeem_invite_for('41000000-0000-0000-0000-00000000000d', repeat('a',64));
  if (select count(*) from public.events where org_id = 'ic-org' and stream_id = 'L-ic' and type = 'v1.ReviewTeamMemberSet'
      and actor_id = 'service' and payload->>'member' = 'true') <> 4 then
    raise exception 'expected each joiner on each check once'; end if;
  if not exists (select 1 from public.events where stream_id = 'L-ic' and type = 'v1.ReviewTeamMemberSet'
      and payload->>'teamId' = 'check:community' and payload->>'profileId' = '41000000-0000-0000-0000-00000000000d') then
    raise exception 'the second joiner is not on the community check'; end if;
  if not ('review' = any(public.org_privileges('ic-org','41000000-0000-0000-0000-00000000000c','L-ic'))) then
    raise exception 'the membership is missing'; end if;
end $$;

-- 3. Who may name checks, for whom, and where.
select set_config('request.jwt.claim.sub','41000000-0000-0000-0000-00000000000b',true);
do $$ begin
  begin
    perform public.issue_invite_v4('ic-org','51000000-0000-0000-0000-000000000002',
      encode(extensions.digest(repeat('b',64),'sha256'),'hex'),'reviewer',
      '{"level":"language","languageId":"L-ic"}',now()+interval '1 day',null,1,array['peer']);
    raise exception 'a lead who cannot set up checks named one';
  exception when insufficient_privilege then null; end;
end $$;
-- The same lead may still invite without checks.
select public.issue_invite_v4('ic-org','51000000-0000-0000-0000-000000000003',
  encode(extensions.digest(repeat('c',64),'sha256'),'hex'),'reviewer',
  '{"level":"language","languageId":"L-ic"}',now()+interval '1 day',null,1,'{}');
select set_config('request.jwt.claim.sub','41000000-0000-0000-0000-00000000000a',true);
do $$ begin
  begin
    perform public.issue_invite_v4('ic-org','51000000-0000-0000-0000-000000000004',
      encode(extensions.digest(repeat('d',64),'sha256'),'hex'),'viewer',
      '{"level":"language","languageId":"L-ic"}',now()+interval '1 day',null,1,array['peer']);
    raise exception 'a role that does no checks was put on one';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.issue_invite_v4('ic-org','51000000-0000-0000-0000-000000000005',
      encode(extensions.digest(repeat('e',64),'sha256'),'hex'),'reviewer',
      '{"level":"org"}',now()+interval '1 day',null,1,array['peer']);
    raise exception 'an invite to the whole organization named checks';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.issue_invite_v4('ic-org','51000000-0000-0000-0000-000000000006',
      encode(extensions.digest(repeat('f',64),'sha256'),'hex'),'reviewer',
      '{"level":"language","languageId":"L-ic"}',now()+interval '1 day',null,1,array['peer"; drop']);
    raise exception 'a check id out of shape was taken';
  exception when invalid_parameter_value then null; end;
end $$;

-- 4. Signed out, nobody issues one.
set local role anon;
do $$ begin
  perform public.issue_invite_v4('ic-org','51000000-0000-0000-0000-000000000007',
    encode(extensions.digest(repeat('9',64),'sha256'),'hex'),'reviewer',
    '{"level":"language","languageId":"L-ic"}',now()+interval '1 day',null,1,'{}');
  raise exception 'a signed-out caller issued an invite';
exception when insufficient_privilege then null;
end $$;
reset role;
rollback;
