-- The read policies, as a table (decisions.md 64, 75). Person A runs an
-- organization; person B is a signed-in stranger in another organization.
-- Each row of the matrix names a table, a filter that picks A's rows, and how
-- many of them A and B each see through the API. To cover a new table, add one
-- line. Repeatable; every write rolls back.
\set ON_ERROR_STOP on
begin;
update public.server_config set min_client_version = 0;

insert into auth.users (id, email, aud, role) values
  ('51000000-0000-0000-0000-00000000000a', 'rls-a@example.org', 'authenticated', 'authenticated'),
  ('51000000-0000-0000-0000-00000000000b', 'rls-b@example.org', 'authenticated', 'authenticated'),
  ('51000000-0000-0000-0000-00000000000c', 'rls-c@example.org', 'authenticated', 'authenticated');

-- A administers rls-org; B is a translator in rls-other; C is nobody yet.
select set_config('request.jwt.claim.sub', '', true);
do $$ declare r record; begin
  for r in select * from public.append_events('[
    {"id":"rl-1","type":"v1.OrgCreated","orgId":"rls-org","streamId":"_org","actorId":"51000000-0000-0000-0000-00000000000a","deviceId":"dR","hlc":"000000000000001:000000:dR","payload":{"name":"Rls"}},
    {"id":"rl-2","type":"v1.RoleDefined","orgId":"rls-org","streamId":"_org","actorId":"51000000-0000-0000-0000-00000000000a","deviceId":"dR","hlc":"000000000000002:000000:dR","payload":{"roleId":"admin","name":"Admin","privileges":["invite_members","manage_structure","translate"]}},
    {"id":"rl-3","type":"v1.MemberAdded","orgId":"rls-org","streamId":"_org","actorId":"51000000-0000-0000-0000-00000000000a","deviceId":"dR","hlc":"000000000000003:000000:dR","payload":{"profileId":"51000000-0000-0000-0000-00000000000a","roleId":"admin","scope":{"level":"org"}}},
    {"id":"rl-4","type":"v1.OrgCreated","orgId":"rls-other","streamId":"_org","actorId":"51000000-0000-0000-0000-00000000000b","deviceId":"dR","hlc":"000000000000004:000000:dR","payload":{"name":"Other"}},
    {"id":"rl-5","type":"v1.RoleDefined","orgId":"rls-other","streamId":"_org","actorId":"51000000-0000-0000-0000-00000000000b","deviceId":"dR","hlc":"000000000000005:000000:dR","payload":{"roleId":"translator","name":"Translator","privileges":["translate"]}},
    {"id":"rl-6","type":"v1.MemberAdded","orgId":"rls-other","streamId":"_org","actorId":"51000000-0000-0000-0000-00000000000b","deviceId":"dR","hlc":"000000000000006:000000:dR","payload":{"profileId":"51000000-0000-0000-0000-00000000000b","roleId":"translator","scope":{"level":"org"}}}
  ]'::jsonb) loop
    if not r.accepted then raise exception 'setup event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;

-- A's private rows, and C's join request to A's organization.
insert into public.invites (id, org_id, token_hash, role_id, scope, expires_at, issued_by)
  values ('rls-inv', 'rls-org', 'rls-hash', 'admin', '{"level":"org"}', now() + interval '1 day', '51000000-0000-0000-0000-00000000000a');
insert into public.join_requests (id, org_id, profile_id, message)
  values ('rls-req', 'rls-org', '51000000-0000-0000-0000-00000000000c', 'let me in');
insert into public.notifications (id, profile_id, org_id, kind, title)
  values ('rls-note', '51000000-0000-0000-0000-00000000000a', 'rls-org', 'task', 'for A');
insert into public.profiles (id, display_name) values ('51000000-0000-0000-0000-00000000000a', 'Rls A');
insert into public.user_blocks (blocker_id, blocked_id) values ('51000000-0000-0000-0000-00000000000a', 'someone');
insert into public.account_stewards (profile_id, steward_id)
  values ('51000000-0000-0000-0000-00000000000a', '51000000-0000-0000-0000-00000000000c');
insert into public.language_visibility (org_id, language_id, listed) values ('rls-org', 'rls-unlisted', false), ('rls-org', 'rls-listed', true);
insert into public.public_languages (org_id, language_id, name) values ('rls-org', 'rls-unlisted', 'Hidden'), ('rls-org', 'rls-listed', 'Shown');

-- table, filter picking A's rows, rows A sees, rows B sees.
-- Unlisted languages are hidden from everyone (their owners use the RPCs);
-- listed ones are public by design, so B sees that row.
create temp table rls_matrix (tbl text, filter text, a_sees int, b_sees int);
insert into rls_matrix values
  ('invites',             $f$org_id = 'rls-org'$f$,                                           1, 0),
  ('join_requests',       $f$org_id = 'rls-org'$f$,                                           1, 0),
  ('notifications',       $f$id = 'rls-note'$f$,                                              1, 0),
  ('profiles',            $f$id = '51000000-0000-0000-0000-00000000000a'$f$,                  1, 0),
  ('user_blocks',         $f$blocker_id = '51000000-0000-0000-0000-00000000000a'$f$,          1, 0),
  ('account_stewards',    $f$profile_id::text = '51000000-0000-0000-0000-00000000000a'$f$,    1, 0),
  ('language_visibility', $f$org_id = 'rls-org' and language_id = 'rls-unlisted'$f$,          0, 0),
  ('language_visibility', $f$org_id = 'rls-org' and language_id = 'rls-listed'$f$,            1, 1),
  ('public_languages',    $f$org_id = 'rls-org' and language_id = 'rls-unlisted'$f$,          0, 0),
  ('public_languages',    $f$org_id = 'rls-org' and language_id = 'rls-listed'$f$,            1, 1);
grant select on rls_matrix to authenticated, anon;

-- Every private table with a read policy is in the matrix, so a new one
-- cannot be forgotten (reference tables open to all are listed here).
do $$ declare v text; begin
  select string_agg(distinct p.tablename, ', ') into v
  from pg_policies p
  where p.schemaname = 'public' and p.cmd = 'SELECT' and not exists (select 1 from rls_matrix m where m.tbl = p.tablename)
    and p.qual is distinct from 'true';
  if v is not null then raise exception 'read policies on tables missing from the RLS matrix: %', v; end if;
end $$;

create function pg_temp.sees(p_who text) returns void language plpgsql as $$
declare r record; n bigint; want int;
begin
  perform set_config('request.jwt.claim.sub', p_who, true);
  for r in select * from rls_matrix loop
    execute format('select count(*) from public.%I where %s', r.tbl, r.filter) into n;
    want := case when p_who like '%00a' then r.a_sees else r.b_sees end;
    if n <> want then raise exception '% sees % rows of % where %, expected %', p_who, n, r.tbl, r.filter, want; end if;
  end loop;
end $$;
grant execute on function pg_temp.sees(text) to authenticated;

set role authenticated;
select pg_temp.sees('51000000-0000-0000-0000-00000000000a');
select pg_temp.sees('51000000-0000-0000-0000-00000000000b');
reset role;

-- Signed out sees only what is public by design.
select set_config('request.jwt.claim.sub', '', true);
set role anon;
do $$ declare t text; n bigint; begin
  foreach t in array array['invites', 'join_requests', 'notifications', 'profiles', 'user_blocks', 'account_stewards'] loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      if n <> 0 then raise exception 'anon sees % rows of %', n, t; end if;
    exception when insufficient_privilege then null;
    end;
  end loop;
  if (select count(*) from public.public_languages where language_id = 'rls-unlisted') <> 0 then raise exception 'anon sees an unlisted language'; end if;
end $$;
reset role;

rollback;
