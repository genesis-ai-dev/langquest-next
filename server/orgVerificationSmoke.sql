-- Verified organizations (decisions.md 173): an admin asks with a domain and
-- an address at it, confirms the emailed code, and staff grant or decline.
-- Repeatable against a populated database; every test write rolls back.
\set ON_ERROR_STOP on
begin;
-- An admin, a coordinator (no manage_roles) and someone outside.
insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('4a000000-0000-0000-0000-00000000000a', 'ov-admin@example.org', 'authenticated', 'authenticated', '{}'),
  ('4a000000-0000-0000-0000-00000000000b', 'ov-coord@example.org', 'authenticated', 'authenticated', '{}'),
  ('4a000000-0000-0000-0000-00000000000c', 'ov-out@example.org', 'authenticated', 'authenticated', '{}');
insert into public.profiles (id, display_name) values ('4a000000-0000-0000-0000-00000000000a', 'Ov Admin');

select set_config('request.jwt.claim.sub','',true);
do $$ declare r record; begin
  for r in select * from public.append_events('[
    {"id":"ov-o1","type":"v1.OrgCreated","orgId":"ov-org","streamId":"_org","actorId":"4a000000-0000-0000-0000-00000000000a","deviceId":"dV","hlc":"000000000000001:000000:dV","payload":{"name":"Verified Bible Society"}},
    {"id":"ov-o2","type":"v1.RoleDefined","orgId":"ov-org","streamId":"_org","actorId":"4a000000-0000-0000-0000-00000000000a","deviceId":"dV","hlc":"000000000000002:000000:dV","payload":{"roleId":"admin","name":"Admin","privileges":["invite_members","manage_roles","manage_structure"]}},
    {"id":"ov-o3","type":"v1.RoleDefined","orgId":"ov-org","streamId":"_org","actorId":"4a000000-0000-0000-0000-00000000000a","deviceId":"dV","hlc":"000000000000003:000000:dV","payload":{"roleId":"coord","name":"Coordinator","privileges":["invite_members","manage_structure"]}},
    {"id":"ov-o4","type":"v1.MemberAdded","orgId":"ov-org","streamId":"_org","actorId":"4a000000-0000-0000-0000-00000000000a","deviceId":"dV","hlc":"000000000000004:000000:dV","payload":{"profileId":"4a000000-0000-0000-0000-00000000000a","roleId":"admin","scope":{"level":"org"}}},
    {"id":"ov-o5","type":"v1.MemberAdded","orgId":"ov-org","streamId":"_org","actorId":"4a000000-0000-0000-0000-00000000000a","deviceId":"dV","hlc":"000000000000005:000000:dV","payload":{"profileId":"4a000000-0000-0000-0000-00000000000b","roleId":"coord","scope":{"level":"org"}}}
  ]'::jsonb, (select min_client_version from public.server_config)) loop
    if not r.accepted then raise exception 'setup event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;

create function pg_temp.as_caller(p_profile text) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_profile is null then '' else json_build_object('sub', p_profile)::text end, true);
$$;
create temp table smoke_code (code text);

-- 1. Asking (the Edge Function, as the service role): who may, and what is refused.
select pg_temp.as_caller(null);
do $$ declare v jsonb; begin
  v := public.org_verification_begin('4a000000-0000-0000-0000-00000000000c', 'ov-org', 'vbs.example.org', 'me@vbs.example.org');
  if v->>'reason' <> 'not_allowed' then raise exception 'an outsider: %', v; end if;
  v := public.org_verification_begin('4a000000-0000-0000-0000-00000000000b', 'ov-org', 'vbs.example.org', 'me@vbs.example.org');
  if v->>'reason' <> 'not_allowed' then raise exception 'a coordinator: %', v; end if;
  v := public.org_verification_begin('4a000000-0000-0000-0000-00000000000a', 'ov-org', 'gmail.com', 'me@gmail.com');
  if v->>'reason' <> 'public_domain' then raise exception 'a free email service: %', v; end if;
  v := public.org_verification_begin('4a000000-0000-0000-0000-00000000000a', 'ov-org', 'https://vbs.example.org/about', 'me@vbs.example.org');
  if v->>'reason' <> 'bad_domain' then raise exception 'a web address, not a domain: %', v; end if;
  v := public.org_verification_begin('4a000000-0000-0000-0000-00000000000a', 'ov-org', 'vbs.example.org', 'me@other.example.org');
  if v->>'reason' <> 'email_not_at_domain' then raise exception 'an address elsewhere: %', v; end if;
  v := public.org_verification_begin('4a000000-0000-0000-0000-00000000000a', 'ov-org', 'example.org', 'me@vbs.example.org');
  if (v->>'ok')::boolean is not true then raise exception 'an address under the domain: %', v; end if;
  if v->>'code' !~ '^[0-9]{6}$' or v->>'orgName' <> 'Verified Bible Society' then raise exception 'the code and name: %', v; end if;
  insert into smoke_code values (v->>'code');
  v := public.org_verification_begin('4a000000-0000-0000-0000-00000000000a', 'ov-org', 'example.org', 'me@vbs.example.org');
  if v->>'reason' <> 'too_soon' then raise exception 'a second code within the minute: %', v; end if;
  if (select count(*) from public.org_verification_requests where org_id = 'ov-org') <> 1 then raise exception 'one request'; end if;
end $$;

-- 2. A client may never ask for a code itself, or decide.
set local role authenticated;
select pg_temp.as_caller('4a000000-0000-0000-0000-00000000000a');
do $$ begin
  begin perform public.org_verification_begin('4a000000-0000-0000-0000-00000000000a', 'ov-org', 'example.org', 'me@example.org');
    raise exception 'a client got a code';
  exception when insufficient_privilege then null; end;
  begin perform public.org_verification_decide(gen_random_uuid(), true, 'me');
    raise exception 'a client decided';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 3. Confirming: only an admin, a wrong code counts, the right one waits for staff.
select pg_temp.as_caller('4a000000-0000-0000-0000-00000000000b');
do $$ begin
  begin perform public.org_verification_confirm('ov-org', '000000'); raise exception 'a coordinator confirmed';
  exception when insufficient_privilege then null; end;
  begin perform public.org_verification_state('ov-org'); raise exception 'a coordinator read the request';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.as_caller('4a000000-0000-0000-0000-00000000000a');
do $$ declare v_code text := (select code from smoke_code); v_wrong text; s jsonb; begin
  v_wrong := lpad(((v_code::int + 1) % 1000000)::text, 6, '0');
  if public.org_verification_confirm('ov-org', v_wrong) <> 'wrong' then raise exception 'a wrong code'; end if;
  if public.org_verification_confirm('ov-org', 'abc') <> 'wrong' then raise exception 'not a code'; end if;
  s := public.org_verification_state('ov-org');
  if s->'request'->>'status' <> 'confirming' or s->'request' ? 'code' then raise exception 'state while confirming: %', s; end if;
  if public.org_verification_confirm('ov-org', v_code) <> 'waiting' then raise exception 'the right code'; end if;
  s := public.org_verification_state('ov-org');
  if s->'request'->>'status' <> 'waiting' or s->'verified' <> 'null'::jsonb then raise exception 'state while waiting: %', s; end if;
  if public.org_verification_confirm('ov-org', v_code) <> 'no_code' then raise exception 'a code used twice'; end if;
end $$;

-- 4. Nobody sees a check yet; staff's list shows the address only as its domain.
select pg_temp.as_caller('4a000000-0000-0000-0000-00000000000c');
do $$ begin
  if exists (select 1 from public.org_badges(array['ov-org'])) then raise exception 'a check before staff grant it'; end if;
end $$;
select pg_temp.as_caller(null);
do $$ declare d jsonb := diag.org_verification_requests(); r jsonb; begin
  select x into r from jsonb_array_elements(d) x where x->>'orgId' = 'ov-org';
  if r->>'status' <> 'waiting' or r->>'emailDomain' <> 'vbs.example.org' or r->>'orgName' <> 'Verified Bible Society' then
    raise exception 'the dashboard row: %', r; end if;
  if d::text like '%me@%' then raise exception 'an address on the dashboard'; end if;
  if (public.org_verification_begin('4a000000-0000-0000-0000-00000000000a', 'ov-org', 'example.org', 'me@vbs.example.org'))->>'reason' <> 'waiting' then
    raise exception 'a new code while waiting'; end if;
end $$;

-- 5. Granted: every signed-in person sees the check and its domain.
do $$ declare v_id uuid := (select id from public.org_verification_requests where org_id = 'ov-org'); begin
  if public.org_verification_decide(v_id, true, 'smoke') <> 'granted' then raise exception 'grant'; end if;
  if public.org_verification_decide(v_id, false, 'smoke') <> 'not_waiting' then raise exception 'decided twice'; end if;
  insert into ops.actions (profile_id, action, target, result) values (gen_random_uuid(), 'verification_grant', v_id::text, 'ok');
end $$;
select pg_temp.as_caller('4a000000-0000-0000-0000-00000000000c');
do $$ begin
  if (select domain from public.org_badges(array['ov-org', 'no-such-org'])) <> 'example.org' then raise exception 'the check after grant'; end if;
end $$;
select pg_temp.as_caller(null);
do $$ begin
  if (public.org_verification_begin('4a000000-0000-0000-0000-00000000000a', 'ov-org', 'example.org', 'me@vbs.example.org'))->>'reason'
     <> 'already_verified' then raise exception 'asking again once verified'; end if;
end $$;

-- 6. Revoked, then asked again and taken back; five wrong codes spend a code.
do $$ declare v jsonb; begin
  if public.org_verification_revoke('ov-org', 'smoke') <> 'revoked' then raise exception 'revoke'; end if;
  if exists (select 1 from public.org_badges(array['ov-org'])) then raise exception 'a check after revoke'; end if;
  v := public.org_verification_begin('4a000000-0000-0000-0000-00000000000a', 'ov-org', 'example.org', 'me@example.org');
  if v->>'ok' <> 'true' then raise exception 'asking again after revoke: %', v; end if;
  update smoke_code set code = v->>'code';
end $$;
select pg_temp.as_caller('4a000000-0000-0000-0000-00000000000a');
do $$ declare i int; v text; v_wrong text := lpad((((select code from smoke_code)::int + 1) % 1000000)::text, 6, '0'); begin
  for i in 1..5 loop v := public.org_verification_confirm('ov-org', v_wrong); end loop;
  if v <> 'too_many' then raise exception 'five wrong codes: %', v; end if;
  if public.org_verification_withdraw('ov-org') <> 'withdrawn' then raise exception 'withdraw'; end if;
  if public.org_verification_withdraw('ov-org') <> 'none' then raise exception 'withdraw twice'; end if;
end $$;

rollback;
\echo org verification smoke ok
