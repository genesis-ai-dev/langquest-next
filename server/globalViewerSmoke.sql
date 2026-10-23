-- Global Viewers (decisions.md 158): read every organization on an aal2
-- session, change nothing, belong to no organization. Repeatable against a
-- populated database; every test write rolls back.
\set ON_ERROR_STOP on
begin;
-- An admin with an organization; a Global Viewer with an authenticator; one
-- without yet; one revoked; and someone else.
insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('49000000-0000-0000-0000-00000000000a', 'gv-admin@example.org', 'authenticated', 'authenticated', '{}'),
  ('49000000-0000-0000-0000-00000000000b', 'gv-on@example.org', 'authenticated', 'authenticated', '{}'),
  ('49000000-0000-0000-0000-00000000000c', 'gv-new@example.org', 'authenticated', 'authenticated', '{}'),
  ('49000000-0000-0000-0000-00000000000d', 'gv-gone@example.org', 'authenticated', 'authenticated', '{}'),
  ('49000000-0000-0000-0000-00000000000e', 'gv-other@example.org', 'authenticated', 'authenticated', '{}');
insert into public.profiles (id, display_name) values ('49000000-0000-0000-0000-00000000000a', 'Gv Admin');
insert into public.global_viewers (profile_id, granted_by, note, revoked_at, revoked_by) values
  ('49000000-0000-0000-0000-00000000000b', 'smoke', 'smoke', null, null),
  ('49000000-0000-0000-0000-00000000000c', 'smoke', 'smoke', null, null),
  ('49000000-0000-0000-0000-00000000000d', 'smoke', 'smoke', now(), 'smoke');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('59000000-0000-0000-0000-00000000000b', '49000000-0000-0000-0000-00000000000b', 'phone', 'totp', 'verified', now(), now(), 'x'),
  ('59000000-0000-0000-0000-00000000000d', '49000000-0000-0000-0000-00000000000d', 'phone', 'totp', 'verified', now(), now(), 'x');

select set_config('request.jwt.claim.sub','',true);
do $$ declare r record; begin
  for r in select * from public.append_events('[
    {"id":"gv-o1","type":"v1.OrgCreated","orgId":"gv-org","streamId":"_org","actorId":"49000000-0000-0000-0000-00000000000a","deviceId":"dG","hlc":"000000000000001:000000:dG","payload":{"name":"Viewed Org"}},
    {"id":"gv-o2","type":"v1.RoleDefined","orgId":"gv-org","streamId":"_org","actorId":"49000000-0000-0000-0000-00000000000a","deviceId":"dG","hlc":"000000000000002:000000:dG","payload":{"roleId":"admin","name":"Admin","privileges":["invite_members","manage_roles","manage_structure","translate"]}},
    {"id":"gv-o3","type":"v1.MemberAdded","orgId":"gv-org","streamId":"_org","actorId":"49000000-0000-0000-0000-00000000000a","deviceId":"dG","hlc":"000000000000003:000000:dG","payload":{"profileId":"49000000-0000-0000-0000-00000000000a","roleId":"admin","scope":{"level":"org"}}},
    {"id":"gv-o4","type":"v1.LanguageAdded","orgId":"gv-org","streamId":"_org","actorId":"49000000-0000-0000-0000-00000000000a","deviceId":"dG","hlc":"000000000000004:000000:dG","payload":{"languageId":"L-gv","name":"Viewish","code":"vws","sourceCode":"eng"}}
  ]'::jsonb, (select min_client_version from public.server_config)) loop
    if not r.accepted then raise exception 'setup event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;

-- Who is asking, and at what level.
create function pg_temp.as_caller(p_profile text, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_profile, 'aal', p_aal)::text, true);
$$;

-- 1. On, on an aal2 session: every stream of every organization, but no person's.
select pg_temp.as_caller('49000000-0000-0000-0000-00000000000b', 'aal2');
do $$ begin
  if public.get_user_state()->>'globalViewer' <> 'on' then raise exception 'state on: %', public.get_user_state(); end if;
  if not public.can_read_stream('gv-org', '_org', '49000000-0000-0000-0000-00000000000b') then raise exception 'org stream'; end if;
  if not public.can_read_stream('gv-org', 'L-gv', '49000000-0000-0000-0000-00000000000b') then raise exception 'language stream'; end if;
  if public.can_read_stream('_person', '49000000-0000-0000-0000-00000000000a', '49000000-0000-0000-0000-00000000000b') then
    raise exception 'a person stream'; end if;
  if (select count(*) from public.pull_events('gv-org', '_org', p_client_version => (select min_client_version from public.server_config))) < 4 then raise exception 'pull the org stream'; end if;
  if not exists (select 1 from public.global_viewer_organizations('viewed') o where o.org_id = 'gv-org' and o.name = 'Viewed Org') then
    raise exception 'find by name'; end if;
  if exists (select 1 from public.global_viewer_organizations('no such org anywhere')) then raise exception 'query ignored'; end if;
  if not exists (select 1 from public.global_viewer_directory('gv-org') d where d.display_name = 'Gv Admin') then
    raise exception 'member names'; end if;
  if not public.profile_visible('49000000-0000-0000-0000-00000000000a') then raise exception 'a member is visible'; end if;
end $$;

-- 1b. The library too (templates, flows, reference material): its read check,
-- not its writes, which ask for a privilege a Global Viewer never holds.
do $$ begin
  if not public._library_member('gv-org', '49000000-0000-0000-0000-00000000000b') then raise exception 'library read'; end if;
  begin
    perform public.library_adopt('gv-org', 'gv-org', 'no-item', repeat('a', 64));
    raise exception 'a Global Viewer adopted a library item';
  exception when insufficient_privilege then null; end;
end $$;

-- 2. It is read-only: may_emit never asks about Global Viewers.
do $$ declare r record; begin
  select * into r from public.append_events(jsonb_build_array(jsonb_build_object(
    'id', 'gv-write', 'type', 'v1.LanguageRenamed', 'orgId', 'gv-org', 'streamId', '_org',
    'actorId', '49000000-0000-0000-0000-00000000000b', 'deviceId', 'dV',
    'hlc', lpad(((extract(epoch from clock_timestamp()) * 1000)::bigint - 1000)::text, 15, '0') || ':000000:dV',
    'payload', jsonb_build_object('languageId', 'L-gv', 'name', 'Renamed'))),
    (select min_client_version from public.server_config));
  if r.accepted then raise exception 'a Global Viewer wrote to an organization'; end if;
end $$;

-- 3. On an aal1 session: nothing.
select pg_temp.as_caller('49000000-0000-0000-0000-00000000000b', 'aal1');
do $$ begin
  if public.get_user_state()->>'globalViewer' <> 'needs_code' then raise exception 'state needs_code'; end if;
  if public._library_member('gv-org', '49000000-0000-0000-0000-00000000000b') then raise exception 'aal1 library read'; end if;
  if public.can_read_stream('gv-org', '_org', '49000000-0000-0000-0000-00000000000b') then raise exception 'aal1 read'; end if;
  if public.profile_visible('49000000-0000-0000-0000-00000000000a') then raise exception 'aal1 names'; end if;
  begin
    perform public.global_viewer_organizations('');
    raise exception 'aal1 listed organizations';
  exception when insufficient_privilege then null; end;
  begin
    perform public.pull_events('gv-org', '_org', p_client_version => (select min_client_version from public.server_config));
    raise exception 'aal1 pulled';
  exception when insufficient_privilege then null; end;
end $$;

-- 4. No authenticator yet; and revoked.
select pg_temp.as_caller('49000000-0000-0000-0000-00000000000c', 'aal1');
do $$ begin
  if public.get_user_state()->>'globalViewer' <> 'needs_setup' then raise exception 'state needs_setup'; end if;
end $$;
select pg_temp.as_caller('49000000-0000-0000-0000-00000000000d', 'aal2');
do $$ begin
  if public.get_user_state()->>'globalViewer' <> 'revoked' then raise exception 'state revoked'; end if;
  if public.can_read_stream('gv-org', '_org', '49000000-0000-0000-0000-00000000000d') then raise exception 'revoked read'; end if;
end $$;

-- 5. Anyone else gets nothing more at aal2, and no state.
select pg_temp.as_caller('49000000-0000-0000-0000-00000000000e', 'aal2');
do $$ begin
  if public.get_user_state() ? 'globalViewer' and public.get_user_state()->>'globalViewer' is not null then
    raise exception 'state for an ordinary account'; end if;
  if public.can_read_stream('gv-org', '_org', '49000000-0000-0000-0000-00000000000e') then raise exception 'outsider read'; end if;
  begin
    perform public.global_viewer_directory('gv-org');
    raise exception 'outsider directory';
  exception when insufficient_privilege then null; end;
end $$;

-- 6. Files: the Worker says the token's level. Unsaid, a Global Viewer is refused.
select set_config('request.jwt.claims', '', true);
do $$ begin
  if not public.blob_access('gv-org/L-gv/abc', '49000000-0000-0000-0000-00000000000b', false, 'aal2') then raise exception 'file at aal2'; end if;
  if public.blob_access('gv-org/L-gv/abc', '49000000-0000-0000-0000-00000000000b', false, 'aal1') then raise exception 'file at aal1'; end if;
  if public.blob_access('gv-org/L-gv/abc', '49000000-0000-0000-0000-00000000000b', false) then raise exception 'file, level unsaid'; end if;
  if public.blob_access('gv-org/L-gv/abc', '49000000-0000-0000-0000-00000000000b', true, 'aal2') then raise exception 'file write'; end if;
  if not public.blob_access('gv-org/L-gv/abc', '49000000-0000-0000-0000-00000000000a', false) then raise exception 'a member, level unsaid'; end if;
end $$;

-- 7. Nobody signs a Global Viewer in for them. A Global Viewer may belong to
-- organizations as anyone does: asking to join is open to them.
do $$ begin
  if public.may_help_sign_in('49000000-0000-0000-0000-00000000000a', '49000000-0000-0000-0000-00000000000b') then
    raise exception 'sign-in help for a Global Viewer'; end if;
end $$;
select pg_temp.as_caller('49000000-0000-0000-0000-00000000000b', 'aal2');
do $$ begin
  perform public.create_join_request('gv-org', 'gv-ask', 'let me in');
  if not exists (select 1 from public.join_requests where id = 'gv-ask') then raise exception 'a Global Viewer may ask to join'; end if;
end $$;

-- 8. The table and the helpers are out of the API roles' reach.
set local role authenticated;
do $$ begin
  begin
    perform 1 from public.global_viewers;
    raise exception 'the table is readable';
  exception when insufficient_privilege then null; end;
  begin
    perform public._gv_on('49000000-0000-0000-0000-00000000000b', 'aal2');
    raise exception 'a helper is callable';
  exception when insufficient_privilege then null; end;
  -- The lists themselves are callable, and check the caller.
  if not exists (select 1 from public.global_viewer_organizations('viewed')) then raise exception 'as authenticated'; end if;
end $$;
reset role;
do $$ begin
  if has_function_privilege('anon', 'public.global_viewer_organizations(text, text, text, int)', 'execute') then
    raise exception 'anon may list organizations'; end if;
  if has_function_privilege('authenticated', 'public.blob_access(text, text, boolean, text)', 'execute') then
    raise exception 'authenticated may ask about files'; end if;
end $$;

-- 9. The operator's commands (scripts/global-viewer.ts), as the service role.
select set_config('request.jwt.claims', '', true);
insert into auth.users (id, email, aud, role, raw_app_meta_data, created_at) values
  ('49000000-0000-0000-0000-000000000010', 'gv-fresh@example.org', 'authenticated', 'authenticated', '{}', now()),
  ('49000000-0000-0000-0000-000000000011', 'gv-old@example.org', 'authenticated', 'authenticated', '{}', now() - interval '2 days'),
  ('49000000-0000-0000-0000-000000000012', 'gv-early@example.org', 'authenticated', 'authenticated', '{}', now()),
  ('49000000-0000-0000-0000-000000000013', 'achol-490@people.langquest.org', 'authenticated', 'authenticated', '{"managed": true}', now());
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('59000000-0000-0000-0000-000000000012', '49000000-0000-0000-0000-000000000012', 'theirs', 'totp', 'unverified', now(), now(), 'x');
insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
  ('69000000-0000-0000-0000-00000000000b', '49000000-0000-0000-0000-00000000000b', now(), now(), 'aal2');
do $$ declare v text; begin
  if public.global_viewer_grant('GV-Fresh@example.org', 'smoke', '') not like 'Say who asked%' then raise exception 'a note is needed'; end if;
  if public.global_viewer_grant('nobody@example.org', 'smoke', 'n') not like 'No account%' then raise exception 'unknown email'; end if;
  if public.global_viewer_grant('gv-early@example.org', 'smoke', 'n') not like '%already has an authenticator%' then
    raise exception 'an authenticator set up ahead'; end if;
  if public.global_viewer_grant('achol-490@people.langquest.org', 'smoke', 'n') not like '%looked-after%' then raise exception 'managed'; end if;
  -- An old account, and one in an organization: a staff member's own account (2026-10-21).
  if public.global_viewer_grant('gv-old@example.org', 'smoke', 'n') <> 'granted' then raise exception 'an old account'; end if;
  if public.global_viewer_grant('gv-admin@example.org', 'smoke', 'n') <> 'granted' then raise exception 'a member'; end if;
  -- A revoked one again: its old authenticator is not trusted, and the note keeps what came before.
  v := public.global_viewer_grant('gv-gone@example.org', 'smoke2', 'back on LAN-9');
  if v <> 'granted' then raise exception 'regrant: %', v; end if;
  if exists (select 1 from auth.mfa_factors where user_id = '49000000-0000-0000-0000-00000000000d') then raise exception 'old authenticator kept'; end if;
  if not exists (select 1 from public.global_viewers where profile_id = '49000000-0000-0000-0000-00000000000d'
                 and revoked_at is null and granted_by = 'smoke2' and note like 'back on LAN-9 (before: granted % by smoke, revoked % by smoke; smoke)') then
    raise exception 'regrant row: %', (select row_to_json(g) from public.global_viewers g where profile_id = '49000000-0000-0000-0000-00000000000d'); end if;
  v := public.global_viewer_grant('GV-Fresh@example.org', 'smoke', 'LAN-1, asked by Mary');
  if v <> 'granted' then raise exception 'grant: %', v; end if;
  if public.global_viewer_grant('gv-fresh@example.org', 'smoke', 'n') not like '%already a Global Viewer%' then raise exception 'twice'; end if;
  if not exists (select 1 from public.global_viewer_list() l where l.email = 'gv-fresh@example.org' and l.authenticators = 0 and l.note = 'LAN-1, asked by Mary') then
    raise exception 'list the new one'; end if;
  if not exists (select 1 from public.global_viewer_list() l where l.email = 'gv-on@example.org' and l.authenticators = 1) then
    raise exception 'list one with an authenticator'; end if;

  if public.global_viewer_reset_mfa('gv-on@example.org') <> 'reset' then raise exception 'reset'; end if;
  if exists (select 1 from auth.mfa_factors where user_id = '49000000-0000-0000-0000-00000000000b') then raise exception 'factors kept'; end if;
  if exists (select 1 from auth.sessions where user_id = '49000000-0000-0000-0000-00000000000b') then raise exception 'sessions kept on reset'; end if;

  insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
    ('69000000-0000-0000-0000-00000000001b', '49000000-0000-0000-0000-00000000000b', now(), now(), 'aal1');
  if public.global_viewer_revoke('gv-on@example.org', 'smoke') <> 'revoked' then raise exception 'revoke'; end if;
  if exists (select 1 from auth.sessions where user_id = '49000000-0000-0000-0000-00000000000b') then raise exception 'sessions kept on revoke'; end if;
  if public.global_viewer_revoke('gv-on@example.org', 'smoke') <> 'Already revoked.' then raise exception 'revoke twice'; end if;
  if public.global_viewer_revoke('gv-other@example.org', 'smoke') <> 'That account is not a Global Viewer.' then raise exception 'revoke other'; end if;
  -- A revoked account is an ordinary one again.
  if public._is_gv_account('49000000-0000-0000-0000-00000000000b') then raise exception 'a revoked account is still a Global Viewer'; end if;
end $$;
-- Only the service role runs them.
select pg_temp.as_caller('49000000-0000-0000-0000-00000000000e', 'aal2');
do $$ begin
  perform public.global_viewer_grant('gv-other@example.org', 'me', 'me');
  raise exception 'a signed-in person granted';
exception when insufficient_privilege then null;
end $$;

rollback;
