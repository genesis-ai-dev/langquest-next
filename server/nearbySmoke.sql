-- Nearby sync's identity and flag (docs/nearby-sync-plan.md 5.4, 5.5, 5.10,
-- 5.12, phase 2): features off by default and staff-only to grant; install
-- keys per person, with the cap's columns; discovery generations made lazily,
-- at most one a day; known_events for members only; get_user_state carrying
-- features; and append_events refusing another author's bound id.
-- Repeatable against a populated database; every test write rolls back.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('4c000000-0000-0000-0000-00000000000a', 'nb-admin@example.org', 'authenticated', 'authenticated', '{}'),
  ('4c000000-0000-0000-0000-00000000000b', 'nb-translator@example.org', 'authenticated', 'authenticated', '{}'),
  ('4c000000-0000-0000-0000-00000000000c', 'nb-outsider@example.org', 'authenticated', 'authenticated', '{}');

-- An admin at organization scope, a translator in L1, and three people to remove later.
select set_config('request.jwt.claim.sub','',true);
do $$ declare r record; begin
  for r in select * from public.append_events('[
    {"id":"nb-o1","type":"v1.OrgCreated","orgId":"nb-org","streamId":"_org","actorId":"4c000000-0000-0000-0000-00000000000a","deviceId":"dN","hlc":"000000000000001:000000:dN","payload":{"name":"Nearby Smoke"}},
    {"id":"nb-o2","type":"v1.RoleDefined","orgId":"nb-org","streamId":"_org","actorId":"4c000000-0000-0000-0000-00000000000a","deviceId":"dN","hlc":"000000000000002:000000:dN","payload":{"roleId":"admin","name":"Admin","privileges":["invite_members","manage_roles","manage_structure","translate"]}},
    {"id":"nb-o3","type":"v1.RoleDefined","orgId":"nb-org","streamId":"_org","actorId":"4c000000-0000-0000-0000-00000000000a","deviceId":"dN","hlc":"000000000000003:000000:dN","payload":{"roleId":"translator","name":"Translator","privileges":["translate"]}},
    {"id":"nb-o4","type":"v1.MemberAdded","orgId":"nb-org","streamId":"_org","actorId":"4c000000-0000-0000-0000-00000000000a","deviceId":"dN","hlc":"000000000000004:000000:dN","payload":{"profileId":"4c000000-0000-0000-0000-00000000000a","roleId":"admin","scope":{"level":"org"}}},
    {"id":"nb-o5","type":"v1.LanguageAdded","orgId":"nb-org","streamId":"_org","actorId":"4c000000-0000-0000-0000-00000000000a","deviceId":"dN","hlc":"000000000000005:000000:dN","payload":{"languageId":"L1","name":"One","code":"fia","sourceCode":"eng"}},
    {"id":"nb-o6","type":"v1.LanguageAdded","orgId":"nb-org","streamId":"_org","actorId":"4c000000-0000-0000-0000-00000000000a","deviceId":"dN","hlc":"000000000000006:000000:dN","payload":{"languageId":"L2","name":"Two","code":"fia","sourceCode":"eng"}},
    {"id":"nb-o7","type":"v1.MemberAdded","orgId":"nb-org","streamId":"_org","actorId":"4c000000-0000-0000-0000-00000000000a","deviceId":"dN","hlc":"000000000000007:000000:dN","payload":{"profileId":"4c000000-0000-0000-0000-00000000000b","roleId":"translator","scope":{"level":"language","languageId":"L1"}}},
    {"id":"nb-o8","type":"v1.MemberAdded","orgId":"nb-org","streamId":"_org","actorId":"4c000000-0000-0000-0000-00000000000a","deviceId":"dN","hlc":"000000000000008:000000:dN","payload":{"profileId":"nb-gone-1","roleId":"translator","scope":{"level":"language","languageId":"L2"}}},
    {"id":"nb-o9","type":"v1.MemberAdded","orgId":"nb-org","streamId":"_org","actorId":"4c000000-0000-0000-0000-00000000000a","deviceId":"dN","hlc":"000000000000009:000000:dN","payload":{"profileId":"nb-gone-2","roleId":"translator","scope":{"level":"language","languageId":"L1"}}},
    {"id":"nb-o10","type":"v1.MemberAdded","orgId":"nb-org","streamId":"_org","actorId":"4c000000-0000-0000-0000-00000000000a","deviceId":"dN","hlc":"000000000000010:000000:dN","payload":{"profileId":"nb-gone-3","roleId":"translator","scope":{"level":"org"}}},
    {"id":"nb-f1","type":"v1.OrgCreated","orgId":"nb-off","streamId":"_org","actorId":"4c000000-0000-0000-0000-00000000000a","deviceId":"dN","hlc":"000000000000011:000000:dN","payload":{"name":"Nearby Off"}},
    {"id":"nb-f2","type":"v1.RoleDefined","orgId":"nb-off","streamId":"_org","actorId":"4c000000-0000-0000-0000-00000000000a","deviceId":"dN","hlc":"000000000000012:000000:dN","payload":{"roleId":"admin","name":"Admin","privileges":["invite_members","manage_structure"]}},
    {"id":"nb-f3","type":"v1.MemberAdded","orgId":"nb-off","streamId":"_org","actorId":"4c000000-0000-0000-0000-00000000000a","deviceId":"dN","hlc":"000000000000013:000000:dN","payload":{"profileId":"4c000000-0000-0000-0000-00000000000a","roleId":"admin","scope":{"level":"org"}}},
    {"id":"nb-f4","type":"v1.LanguageAdded","orgId":"nb-off","streamId":"_org","actorId":"4c000000-0000-0000-0000-00000000000a","deviceId":"dN","hlc":"000000000000014:000000:dN","payload":{"languageId":"L1","name":"Off One","code":"fia","sourceCode":"eng"}},
    {"id":"nb-n1","type":"v1.NoteAdded","orgId":"nb-org","streamId":"L1","actorId":"4c000000-0000-0000-0000-00000000000b","deviceId":"dT","hlc":"000000000000015:000000:dT","payload":{"noteId":"nb-note-1","unitId":"u1","anchor":{"kind":"passage"},"text":"one"}},
    {"id":"nb-n2","type":"v1.NoteAdded","orgId":"nb-org","streamId":"L1","actorId":"4c000000-0000-0000-0000-00000000000a","deviceId":"dN","hlc":"000000000000016:000000:dN","payload":{"noteId":"nb-note-2","unitId":"u1","anchor":{"kind":"passage"},"text":"two"}},
    {"id":"nb-l2-1","type":"v1.NoteAdded","orgId":"nb-org","streamId":"L2","actorId":"4c000000-0000-0000-0000-00000000000a","deviceId":"dN","hlc":"000000000000017:000000:dN","payload":{"noteId":"nb-note-3","unitId":"u1","anchor":{"kind":"passage"},"text":"three"}}
  ]'::jsonb, (select min_client_version from public.server_config)) loop
    if not r.accepted then raise exception 'setup event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;

create function pg_temp.as_caller(p_profile text) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_profile is null then '' else json_build_object('sub', p_profile)::text end, true);
$$;
-- An Ed25519 public key's shape, base64url: 43 characters.
create function pg_temp.k(n int) returns text language sql immutable as $$ select rpad('nbk' || n, 43, 'A') $$;
-- The certificate call's facts for the admin's key 1, naming these languages.
create function pg_temp.facts(p_profile text, p_key int, p_languages text[] default '{}') returns jsonb language sql as $$
  select public.nearby_certificate_facts(p_profile, 'dev-' || p_key, pg_temp.k(p_key), p_languages)
$$;
create function pg_temp.newest(p_language text) returns public.language_discovery_keys language sql as $$
  select * from public.language_discovery_keys k where k.org_id = 'nb-org' and k.language_id = p_language order by k.generation desc limit 1
$$;
create function pg_temp.remove(p_id text, p_profile text, p_scope jsonb) returns void language plpgsql as $$
declare r record; begin
  perform pg_temp.as_caller(null);
  for r in select * from public.append_events(jsonb_build_array(jsonb_build_object(
      'id', p_id, 'type', 'v1.MemberRemoved', 'orgId', 'nb-org', 'streamId', '_org', 'actorId', '4c000000-0000-0000-0000-00000000000a',
      'deviceId', 'dN', 'hlc', '000000000000100:000000:dN', 'payload', jsonb_build_object('profileId', p_profile, 'scope', p_scope))),
      (select min_client_version from public.server_config)) loop
    if not r.accepted then raise exception 'removal % refused: %', p_id, r.reason; end if;
  end loop;
end $$;

-- 1. Off by default: no features, no certificate facts, no key kept, and no
-- discovery key made. A bearer token still ends key sign-in for the person's keys.
select pg_temp.as_caller(null);
insert into public.install_keys (public_key, profile_id, install_id) values (pg_temp.k(9), '4c000000-0000-0000-0000-00000000000a', 'dev-9');
do $$ declare v jsonb; begin
  if exists (select 1 from public.org_feature_list() where org_id in ('nb-org', 'nb-off')) then raise exception 'a feature on by default'; end if;
  v := pg_temp.facts('4c000000-0000-0000-0000-00000000000a', 1, array['nb-org/L1']);
  if v <> '{"revoked": false, "limited": false, "orgs": []}'::jsonb then raise exception 'facts with nearby off: %', v; end if;
  if exists (select 1 from public.install_keys where public_key = pg_temp.k(1)) then raise exception 'a key kept with nearby off'; end if;
  if exists (select 1 from public.language_discovery_chains where org_id = 'nb-org') then raise exception 'a discovery chain made with nearby off'; end if;
  if (select first_session_at from public.install_keys where public_key = pg_temp.k(9)) is null then raise exception 'the certificate call left key sign-in open'; end if;
end $$;
set local role authenticated;
select pg_temp.as_caller('4c000000-0000-0000-0000-00000000000a');
do $$ begin
  if public.get_user_state()->'orgFeatures' <> '{}'::jsonb then raise exception 'orgFeatures with nothing on: %', public.get_user_state(); end if;
  if public.get_user_state()->'nearbyRevokedSeq' <> '{}'::jsonb then raise exception 'nearbyRevokedSeq with nothing on'; end if;
  if public.get_user_state() ? 'globalViewer' is not true then raise exception 'get_user_state lost a field it had'; end if;
end $$;

-- 2. Only staff turn a feature on; nobody signed in or out reaches the
-- functions or the tables.
do $$ begin
  begin perform public.org_feature_grant('nb-org', 'nearby', 'Me'); raise exception 'a member turned nearby on';
  exception when insufficient_privilege then null; end;
  begin perform public.org_feature_revoke('nb-org', 'nearby', 'Me'); raise exception 'a member revoked a feature';
  exception when insufficient_privilege then null; end;
  begin perform public.org_feature_list(); raise exception 'a member listed the features';
  exception when insufficient_privilege then null; end;
  begin perform public.nearby_certificate_facts('4c000000-0000-0000-0000-00000000000a', 'd', pg_temp.k(1), '{}'); raise exception 'a member asked for certificate facts';
  exception when insufficient_privilege then null; end;
  begin perform public._discovery_generation('nb-org', 'L1'); raise exception 'a member made a generation';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.org_features; raise exception 'a member read org_features';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.install_keys; raise exception 'a member read install_keys';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.language_discovery_keys; raise exception 'a member read discovery keys';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.org_feature_grant('nb-org', 'nearby', 'Me'); raise exception 'a signed-out caller turned nearby on';
  exception when insufficient_privilege then null; end;
  begin perform public.known_events('nb-org', 'L1', array['nb-n1']); raise exception 'a signed-out caller asked known_events';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.as_caller(null);
do $$ begin
  if public.org_feature_grant('nb-nowhere', 'nearby', 'Staff') <> 'no_org' then raise exception 'an organization that does not exist'; end if;
  if public.org_feature_grant('nb-org', 'nearby', ' ') <> 'say_who' then raise exception 'staff must say who they are'; end if;
  if public.org_feature_revoke('nb-org', 'nearby', 'Staff') <> 'not_granted' then raise exception 'revoking what was never on'; end if;
  begin perform public.org_feature_grant('nb-org', 'radio', 'Staff'); raise exception 'an unknown feature was kept';
  exception when check_violation then null; end;
  if public.org_feature_grant('nb-org', 'nearby', 'Staff') <> 'granted' then raise exception 'granting nearby'; end if;
  if public.org_feature_grant('nb-off', 'nearby_join', 'Staff') <> 'granted' then raise exception 'granting nearby_join'; end if;
  if (select count(*) from public.org_feature_list() where org_id in ('nb-org', 'nb-off') and revoked_at is null) <> 2 then raise exception 'the list'; end if;
end $$;

-- 3. get_user_state names each of the caller's organizations' features, and no one else's.
set local role authenticated;
select pg_temp.as_caller('4c000000-0000-0000-0000-00000000000a');
do $$ begin
  if public.get_user_state()->'orgFeatures' <> '{"nb-org": ["nearby"], "nb-off": ["nearby_join"]}'::jsonb then
    raise exception 'the admin''s features: %', public.get_user_state()->'orgFeatures';
  end if;
end $$;
select pg_temp.as_caller('4c000000-0000-0000-0000-00000000000b');
do $$ begin
  if public.get_user_state()->'orgFeatures' <> '{"nb-org": ["nearby"]}'::jsonb then raise exception 'the translator''s features: %', public.get_user_state(); end if;
end $$;
select pg_temp.as_caller('4c000000-0000-0000-0000-00000000000c');
do $$ begin
  if public.get_user_state()->'orgFeatures' <> '{}'::jsonb then raise exception 'an outsider saw features'; end if;
end $$;
reset role;

-- 4. Install keys: kept per person once an organization of theirs is on, a
-- shared phone's key once for each person, nobody else's, with the cap's
-- columns at their limits, and at most 5 new keys a day.
select pg_temp.as_caller(null);
do $$ declare v jsonb; o jsonb; begin
  v := pg_temp.facts('4c000000-0000-0000-0000-00000000000a', 1);
  if jsonb_array_length(v->'orgs') <> 1 or v#>>'{orgs,0,orgId}' <> 'nb-org' then raise exception 'the admin''s organizations: %', v; end if;
  o := v->'orgs'->0;
  if (o->>'orgSeq')::bigint <> (select next_seq - 1 from public.stream_cursors where org_id = 'nb-org' and stream_id = '_org') then raise exception 'orgSeq: %', o; end if;
  if o->'features' <> '["nearby"]' or o->'discoveryKeys' <> '[]' or (o->>'revokedSeq')::int <> 0 or o->'revocations' <> '[]' then raise exception 'the organization: %', o; end if;
  if o->'scopes' <> '[{"level": "org", "roleId": "admin", "privileges": ["invite_members", "manage_roles", "manage_structure", "translate"]}]'::jsonb then
    raise exception 'resolved privileges: %', o->'scopes';
  end if;
  if not exists (select 1 from public.install_keys k where k.public_key = pg_temp.k(1) and k.profile_id = '4c000000-0000-0000-0000-00000000000a'
                 and k.install_id = 'dev-1' and k.first_session_at is not null and k.revoked_at is null
                 and k.after_revoked_events = 0 and k.after_revoked_bytes = 0
                 and k.after_revoked_events_limit = 50000 and k.after_revoked_bytes_limit = 104857600 and k.after_revoked_raised_by is null) then
    raise exception 'the admin''s key row';
  end if;
  v := public.nearby_certificate_facts('4c000000-0000-0000-0000-00000000000b', 'dev-1', pg_temp.k(1), array['nb-org/L1', 'nb-org/L2']);
  if v#>'{orgs,0,scopes}' <> '[{"level": "language", "languageId": "L1", "roleId": "translator", "privileges": ["translate"]}]'::jsonb then
    raise exception 'the translator''s scopes: %', v;
  end if;
  if jsonb_array_length(v#>'{orgs,0,discoveryKeys}') <> 1 or v#>>'{orgs,0,discoveryKeys,0,languageId}' <> 'L1' then raise exception 'a key for a language the translator cannot read: %', v; end if;
  if exists (select 1 from public.language_discovery_chains where org_id = 'nb-org' and language_id = 'L2') then raise exception 'a chain made for a language its caller cannot read'; end if;
  if (select count(*) from public.install_keys where public_key = pg_temp.k(1)) <> 2 then raise exception 'a shared phone''s key is kept for each person'; end if;
  v := pg_temp.facts('4c000000-0000-0000-0000-00000000000c', 1);
  if v->'orgs' <> '[]' or exists (select 1 from public.install_keys where profile_id = '4c000000-0000-0000-0000-00000000000c') then raise exception 'an outsider''s key kept'; end if;
  for i in 2 .. 4 loop
    if (pg_temp.facts('4c000000-0000-0000-0000-00000000000a', i)->>'limited')::boolean then raise exception 'key % limited', i; end if;
  end loop;
  -- Key 9 (step 1) and keys 1 to 4 are this day's five.
  v := pg_temp.facts('4c000000-0000-0000-0000-00000000000a', 5);
  if not (v->>'limited')::boolean or v->'orgs' <> '[]' then raise exception 'a sixth new key in a day: %', v; end if;
  if exists (select 1 from public.install_keys where public_key = pg_temp.k(5)) then raise exception 'a limited key was kept'; end if;
  if (pg_temp.facts('4c000000-0000-0000-0000-00000000000a', 2)->>'limited')::boolean then raise exception 'refreshing a known key counted'; end if;
  begin perform public.nearby_certificate_facts('4c000000-0000-0000-0000-00000000000a', 'd', 'short', '{}'); raise exception 'a key of the wrong shape';
  exception when invalid_parameter_value then null; end;
  begin perform public.nearby_certificate_facts('nb-gone-1', 'd', pg_temp.k(1), '{}'); raise exception 'a profile that is no account';
  exception when invalid_parameter_value then null; end;
  begin perform pg_temp.facts('4c000000-0000-0000-0000-00000000000a', 1, array(select 'nb-org/x' || g from generate_series(1, 501) g)); raise exception '501 languages';
  exception when invalid_parameter_value then null; end;
  -- The cap's columns, as section 6 names them.
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'install_keys' and column_name in
      ('after_revoked_events', 'after_revoked_bytes', 'after_revoked_events_limit', 'after_revoked_bytes_limit', 'after_revoked_raised_by', 'first_session_at')) <> 6 then
    raise exception 'the cap''s columns';
  end if;
end $$;

-- 5. Generations: made the first time a language is named, by nobody's
-- append; again when the newest is over 90 days old, after a removal covering
-- the language or a revocation, and at most one a day.
do $$ declare v jsonb; g public.language_discovery_keys; c public.language_discovery_chains; n int; begin
  v := pg_temp.facts('4c000000-0000-0000-0000-00000000000a', 1, array['nb-org/L1', 'nb-org/L9', 'nb-off/L1', 'junk', 'nb-org/', 'nb-org/L1/x']);
  if jsonb_array_length(v#>'{orgs,0,discoveryKeys}') <> 1 then raise exception 'keys for languages not listed or organizations off: %', v; end if;
  g := pg_temp.newest('L1');
  select * into c from public.language_discovery_chains where org_id = 'nb-org' and language_id = 'L1';
  if c.top <> 10000 or octet_length(c.seed) <> 32 then raise exception 'the chain'; end if;
  if g.generation <> 1 or g.key <> public._discovery_key_below(c.seed, 9999) then raise exception 'generation 1 is the seed hashed down from the top'; end if;
  if v#>'{orgs,0,discoveryKeys,0}' <> jsonb_build_object('languageId', 'L1', 'gen', 1, 'floor', 1, 'key', encode(g.key, 'hex')) then
    raise exception 'the answer''s key: %', v#>'{orgs,0,discoveryKeys,0}';
  end if;
  v := pg_temp.facts('4c000000-0000-0000-0000-00000000000a', 1, array['nb-org/L1']);
  if (pg_temp.newest('L1')).generation <> 1 then raise exception 'a second call made a generation'; end if;

  update public.language_discovery_keys set created_at = now() - interval '91 days' where org_id = 'nb-org' and language_id = 'L1' and generation = 1;
  v := pg_temp.facts('4c000000-0000-0000-0000-00000000000a', 1, array['nb-org/L1']);
  g := pg_temp.newest('L1');
  if g.generation <> 2 or (v#>>'{orgs,0,discoveryKeys,0,gen}')::int <> 2 then raise exception 'a key over 90 days old: %', v; end if;
  if sha256(convert_to('lq-nearby-gen-v1', 'UTF8') || g.key) <> (select key from public.language_discovery_keys where org_id = 'nb-org' and language_id = 'L1' and generation = 1) then
    raise exception 'generation 2 does not hash down to generation 1';
  end if;
  update public.language_discovery_keys set created_at = now() - interval '2 days' where org_id = 'nb-org' and language_id = 'L1' and generation = 2;
end $$;
select pg_temp.remove('nb-rm-1', 'nb-gone-1', '{"level":"language","languageId":"L2"}');
select pg_temp.as_caller(null);
do $$ declare v jsonb; begin
  v := pg_temp.facts('4c000000-0000-0000-0000-00000000000a', 1, array['nb-org/L1']);
  if (pg_temp.newest('L1')).generation <> 2 then raise exception 'a removal in another language made a generation'; end if;
  insert into public.install_key_revocations (org_id, seq, public_key, profile_id) values ('nb-org', 1, pg_temp.k(8), '4c000000-0000-0000-0000-00000000000b');
  v := pg_temp.facts('4c000000-0000-0000-0000-00000000000a', 1, array['nb-org/L1']);
  if (pg_temp.newest('L1')).generation <> 3 then raise exception 'a revocation made no generation'; end if;
  if (v#>>'{orgs,0,revokedSeq}')::int <> 1 or (v#>'{orgs,0,revocations,0}') - 'revokedAtMs'
       <> jsonb_build_object('seq', 1, 'publicKey', pg_temp.k(8), 'profileId', '4c000000-0000-0000-0000-00000000000b') then
    raise exception 'the revocation list: %', v#>'{orgs,0}';
  end if;
  -- With the revocation older than generation 3, and the removal in L2 below its org_seq, nothing is due.
  update public.install_key_revocations set revoked_at = now() - interval '3 days' where org_id = 'nb-org' and seq = 1;
  update public.language_discovery_keys set created_at = now() - interval '2 days' where org_id = 'nb-org' and language_id = 'L1' and generation = 3;
  v := pg_temp.facts('4c000000-0000-0000-0000-00000000000a', 1, array['nb-org/L1']);
  if (pg_temp.newest('L1')).generation <> 3 then raise exception 'a generation with nothing due'; end if;
  update public.language_discovery_keys set created_at = now() where org_id = 'nb-org' and language_id = 'L1' and generation = 3;
end $$;
select pg_temp.remove('nb-rm-2', 'nb-gone-2', '{"level":"language","languageId":"L1"}');
select pg_temp.as_caller(null);
do $$ declare v jsonb; begin
  v := pg_temp.facts('4c000000-0000-0000-0000-00000000000a', 1, array['nb-org/L1']);
  if (pg_temp.newest('L1')).generation <> 3 then raise exception 'two generations in a day'; end if;
  update public.language_discovery_keys set created_at = now() - interval '2 days' where org_id = 'nb-org' and language_id = 'L1' and generation = 3;
  v := pg_temp.facts('4c000000-0000-0000-0000-00000000000a', 1, array['nb-org/L1']);
  if (pg_temp.newest('L1')).generation <> 4 then raise exception 'a removal covering the language made no generation'; end if;
  -- The floor is the highest generation at least a year old.
  update public.language_discovery_keys set created_at = now() - interval '400 days' where org_id = 'nb-org' and language_id = 'L1' and generation = 1;
  if (pg_temp.facts('4c000000-0000-0000-0000-00000000000a', 1, array['nb-org/L1'])#>>'{orgs,0,discoveryKeys,0,floor}')::int <> 1 then raise exception 'floor 1'; end if;
  update public.language_discovery_keys set created_at = now() - interval '380 days' where org_id = 'nb-org' and language_id = 'L1' and generation = 2;
  v := pg_temp.facts('4c000000-0000-0000-0000-00000000000a', 1, array['nb-org/L1']);
  if (v#>>'{orgs,0,discoveryKeys,0,floor}')::int <> 2 or (v#>>'{orgs,0,discoveryKeys,0,gen}')::int <> 4 then raise exception 'floor 2 under generation 4: %', v; end if;
end $$;
-- No append makes a generation, even a removal covering the organization.
do $$ declare n int := (select count(*) from public.language_discovery_keys); begin
  perform pg_temp.remove('nb-rm-3', 'nb-gone-3', '{"level":"org"}');
  if (select count(*) from public.language_discovery_keys) <> n then raise exception 'an append made a generation'; end if;
  if exists (select 1 from pg_trigger t where t.tgrelid = 'public.events'::regclass and not t.tgisinternal
             and pg_get_triggerdef(t.oid) ~ 'discovery') then
    raise exception 'a trigger on the append path makes generations';
  end if;
end $$;
select pg_temp.as_caller(null);

-- 6. A revoked key answers revoked, for that person only; the shared phone's
-- other person keeps theirs. nearbyRevokedSeq tells a phone it is behind.
do $$ declare v jsonb; begin
  update public.install_keys set revoked_at = now(), revoked_by = 'smoke'
  where public_key = pg_temp.k(1) and profile_id = '4c000000-0000-0000-0000-00000000000a';
  v := pg_temp.facts('4c000000-0000-0000-0000-00000000000a', 1, array['nb-org/L1']);
  if v <> '{"revoked": true}'::jsonb then raise exception 'a revoked key: %', v; end if;
  v := public.nearby_certificate_facts('4c000000-0000-0000-0000-00000000000b', 'dev-1', pg_temp.k(1), '{}');
  if (v->>'revoked')::boolean or jsonb_array_length(v->'orgs') <> 1 then raise exception 'another person on the revoked key''s phone: %', v; end if;
end $$;
set local role authenticated;
select pg_temp.as_caller('4c000000-0000-0000-0000-00000000000b');
do $$ begin
  if public.get_user_state()->'nearbyRevokedSeq' <> '{"nb-org": 1}'::jsonb then raise exception 'nearbyRevokedSeq: %', public.get_user_state(); end if;
end $$;
reset role;

-- 7. known_events: only someone who may read the stream, at most 500 ids, and
-- only ids in that stream.
set local role authenticated;
select pg_temp.as_caller('4c000000-0000-0000-0000-00000000000b');
do $$ declare k record; begin
  if (select array_agg(e.id order by e.id) from public.known_events('nb-org', 'L1', array['nb-n1', 'nb-n2', 'nb-l2-1', 'nb-o1', 'nb-missing']) e)
       is distinct from array['nb-n1', 'nb-n2'] then
    raise exception 'known_events answers this stream''s ids and no other''s';
  end if;
  select * into k from public.known_events('nb-org', 'L1', array['nb-n2']);
  if k.actor_id <> '4c000000-0000-0000-0000-00000000000a' or k.hlc <> '000000000000016:000000:dN' or k.server_seq is null then
    raise exception 'known_events names the seq, clock and author: %', k;
  end if;
  if exists (select 1 from public.known_events('nb-org', 'L1', '{}')) then raise exception 'no ids, no answer'; end if;
  perform public.known_events('nb-org', 'L1', array(select 'x' || g from generate_series(1, 500) g));
  begin perform public.known_events('nb-org', 'L1', array(select 'x' || g from generate_series(1, 501) g)); raise exception '501 ids';
  exception when invalid_parameter_value then null; end;
  begin perform public.known_events('nb-org', 'L2', array['nb-l2-1']); raise exception 'a language the translator cannot read';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.as_caller('4c000000-0000-0000-0000-00000000000c');
do $$ begin
  begin perform public.known_events('nb-org', 'L1', array['nb-n1']); raise exception 'an outsider asked known_events';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.as_caller(null);
do $$ begin
  begin perform public.known_events('nb-org', 'L1', array['nb-n1']); raise exception 'known_events with no caller';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 8. Bound ids: a caller's id or entity id naming another author is refused as
-- a malformed envelope, before the id lookup; their own bound ids and unbound
-- ids behave as before, and the service role's imports are its own.
set local role authenticated;
select pg_temp.as_caller('4c000000-0000-0000-0000-00000000000b');
do $$ declare r record; got jsonb := '{}'; begin
  for r in select * from public.append_events('[
    {"id":"by:4c000000-0000-0000-0000-00000000000a:r1:0","type":"v1.NoteAdded","orgId":"nb-org","streamId":"L1","actorId":"4c000000-0000-0000-0000-00000000000b","deviceId":"dT","hlc":"000000000000020:000000:dT","payload":{"noteId":"nb-t1","unitId":"u1","anchor":{"kind":"passage"},"text":"x"}},
    {"id":"by:4c000000-0000-0000-0000-00000000000b:r2:0","type":"v1.NoteAdded","orgId":"nb-org","streamId":"L1","actorId":"4c000000-0000-0000-0000-00000000000b","deviceId":"dT","hlc":"000000000000021:000000:dT","payload":{"noteId":"by:4c000000-0000-0000-0000-00000000000a:n2","unitId":"u1","anchor":{"kind":"passage"},"text":"x"}},
    {"id":"nb-n2","type":"v1.NoteAdded","orgId":"nb-org","streamId":"L1","actorId":"4c000000-0000-0000-0000-00000000000b","deviceId":"dT","hlc":"000000000000022:000000:dT","payload":{"noteId":"by:4c000000-0000-0000-0000-00000000000a:n4","unitId":"u1","anchor":{"kind":"passage"},"text":"x"}},
    {"id":"by:4c000000-0000-0000-0000-00000000000b:r3:0","type":"v1.NoteAdded","orgId":"nb-org","streamId":"L1","actorId":"4c000000-0000-0000-0000-00000000000b","deviceId":"dT","hlc":"000000000000023:000000:dT","payload":{"noteId":"by:4c000000-0000-0000-0000-00000000000b:n3","unitId":"u1","anchor":{"kind":"passage"},"text":"x"}},
    {"id":"nb-t-plain","type":"v1.NoteAdded","orgId":"nb-org","streamId":"L1","actorId":"4c000000-0000-0000-0000-00000000000b","deviceId":"dT","hlc":"000000000000024:000000:dT","payload":{"noteId":"nb-plain","unitId":"u1","anchor":{"kind":"passage"},"text":"x"}},
    {"id":"nb-t-plain","type":"v1.NoteAdded","orgId":"nb-org","streamId":"L1","actorId":"4c000000-0000-0000-0000-00000000000b","deviceId":"dT","hlc":"000000000000024:000000:dT","payload":{"noteId":"nb-plain","unitId":"u1","anchor":{"kind":"passage"},"text":"x"}},
    {"id":"nb-n1","type":"v1.NoteAdded","orgId":"nb-org","streamId":"L1","actorId":"4c000000-0000-0000-0000-00000000000b","deviceId":"dT","hlc":"000000000000025:000000:dT","payload":{"noteId":"nb-note-1","unitId":"u1","anchor":{"kind":"passage"},"text":"one"}}
  ]'::jsonb, (select min_client_version from public.server_config)) loop
    got := got || jsonb_build_object(r.id || case when got ? r.id then '#2' else '' end, jsonb_build_array(r.accepted, r.reason));
  end loop;
  if got <> jsonb_build_object(
      'by:4c000000-0000-0000-0000-00000000000a:r1:0', jsonb_build_array(false, 'malformed envelope: id names someone else'),
      'by:4c000000-0000-0000-0000-00000000000b:r2:0', jsonb_build_array(false, 'malformed envelope: id names someone else'),
      'nb-n2', jsonb_build_array(false, 'malformed envelope: id names someone else'),
      'by:4c000000-0000-0000-0000-00000000000b:r3:0', jsonb_build_array(true, null),
      'nb-t-plain', jsonb_build_array(true, null),
      'nb-t-plain#2', jsonb_build_array(true, 'duplicate'),
      'nb-n1', jsonb_build_array(true, 'duplicate')) then
    raise exception 'bound ids: %', got;
  end if;
end $$;
reset role;
select pg_temp.as_caller(null);
do $$ declare r record; begin
  for r in select * from public.append_events('[
    {"id":"by:4c000000-0000-0000-0000-00000000000b:svc:0","type":"v1.NoteAdded","orgId":"nb-org","streamId":"L1","actorId":"4c000000-0000-0000-0000-00000000000a","deviceId":"dN","hlc":"000000000000026:000000:dN","payload":{"noteId":"nb-svc","unitId":"u1","anchor":{"kind":"passage"},"text":"x"}}
  ]'::jsonb, (select min_client_version from public.server_config)) loop
    if not r.accepted then raise exception 'the service role''s import was refused: %', r.reason; end if;
  end loop;
end $$;

-- 9. Turned off, the feature leaves get_user_state and the certificate facts.
do $$ declare v jsonb; begin
  if public.org_feature_revoke('nb-org', 'nearby', 'Staff') <> 'revoked' then raise exception 'revoking nearby'; end if;
  if not exists (select 1 from public.org_feature_list() where org_id = 'nb-org' and feature = 'nearby' and revoked_by = 'Staff') then raise exception 'the history went'; end if;
  v := public.nearby_certificate_facts('4c000000-0000-0000-0000-00000000000b', 'dev-1', pg_temp.k(1), array['nb-org/L1']);
  if v->'orgs' <> '[]' then raise exception 'facts with nearby revoked: %', v; end if;
end $$;
set local role authenticated;
select pg_temp.as_caller('4c000000-0000-0000-0000-00000000000b');
do $$ begin
  if public.get_user_state()->'orgFeatures' <> '{}'::jsonb or public.get_user_state()->'nearbyRevokedSeq' <> '{}'::jsonb then
    raise exception 'a revoked feature in get_user_state: %', public.get_user_state();
  end if;
end $$;
reset role;
rollback;
