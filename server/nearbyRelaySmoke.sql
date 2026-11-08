-- Nearby sync's delivery (docs/nearby-sync-plan.md section 6, phase 4):
-- relay_append_events refuses every grantsSmoke refusal as append_events does
-- (or, on the organization's and a person's streams, as a stream the relay
-- does not carry), every type the door refuses by name, a revoked key's later
-- work and its work past the cap, a suspended author, a stamp far ahead; a
-- NUL fails a whole call, which is why the Worker refuses one per event;
-- revoke_install_keys from a helper's lost-phone code, a reset and staff;
-- may_emit's undo rule; and blob_named_by for someone who only views.
-- Repeatable against a populated database; every write rolls back.
\set ON_ERROR_STOP on
begin;
update public.server_config set min_client_version = 0;
insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('5e000000-0000-0000-0000-00000000000a', 'rl-owner@example.org', 'authenticated', 'authenticated', '{}'),
  ('5e000000-0000-0000-0000-00000000000b', 'rl-translator@example.org', 'authenticated', 'authenticated', '{}'),
  ('5e000000-0000-0000-0000-00000000000c', 'rl-viewer@example.org', 'authenticated', 'authenticated', '{}'),
  ('5e000000-0000-0000-0000-00000000000d', 'rl-suspended@example.org', 'authenticated', 'authenticated', '{}'),
  ('5e000000-0000-0000-0000-00000000000e', 'rl-kid@people.langquest.org', 'authenticated', 'authenticated', '{}'),
  ('5e000000-0000-0000-0000-00000000000f', 'rl-kid2@people.langquest.org', 'authenticated', 'authenticated', '{}'),
  ('5e000000-0000-0000-0000-000000000010', 'rl-outsider@example.org', 'authenticated', 'authenticated', '{}'),
  ('5e000000-0000-0000-0000-000000000011', 'rl-email@example.org', 'authenticated', 'authenticated', '{}');

create function pg_temp.as_caller(p_profile text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', '', true),
         set_config('request.jwt.claims', case when p_profile is null then '' else json_build_object('sub', p_profile)::text end, true);
$$;
create function pg_temp.u(p text) returns text language sql immutable as $$ select '5e000000-0000-0000-0000-0000000000' || p $$;
-- An Ed25519 public key's shape, base64url: 43 characters.
create function pg_temp.k(n int) returns text language sql immutable as $$ select rpad('rlk' || n, 43, 'A') $$;
create function pg_temp.h(c text) returns text language sql immutable as $$ select repeat(c, 64) $$;
-- An event in rl-org, at a clock a second behind the server's.
create function pg_temp.ev(p_id text, p_stream text, p_actor text, p_type text, p_payload jsonb, p_org text default 'rl-org') returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'type', p_type, 'orgId', p_org, 'streamId', p_stream, 'actorId', p_actor, 'deviceId', 'dR',
    'hlc', lpad(((extract(epoch from clock_timestamp()) * 1000)::bigint - 1000)::text, 15, '0') || ':000000:dR', 'payload', p_payload);
$$;
-- The same event dated by this offset from now.
create function pg_temp.dated(p_event jsonb, p_offset interval) returns jsonb language sql as $$
  select jsonb_set(p_event, '{hlc}', to_jsonb(lpad(((extract(epoch from now() + p_offset) * 1000)::bigint)::text, 15, '0') || ':000000:dR'));
$$;
create function pg_temp.note(p_id text, p_actor text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select pg_temp.ev(p_id, 'rl-L', p_actor, 'v1.NoteAdded', jsonb_build_object('noteId', p_id || '-n', 'unitId', 'u1', 'anchor', '{"kind":"passage"}'::jsonb, 'text', 'x') || p_extra);
$$;
-- The Worker's call, as the service role.
create function pg_temp.relay(p_author text, p_key text, p_events jsonb, p_version int default 0)
returns table (id text, accepted boolean, server_seq bigint, reason text) language plpgsql as $$
begin
  perform pg_temp.as_caller(null);
  return query select * from public.relay_append_events(p_author, p_key, p_events, p_version);
end $$;
create function pg_temp.one(p_author text, p_key text, p_event jsonb) returns record language plpgsql as $$
declare r record;
begin
  select * into r from pg_temp.relay(p_author, p_key, jsonb_build_array(p_event)) x where x.id = p_event->>'id';
  return r;
end $$;
create function pg_temp.refused(p_author text, p_key text, p_event jsonb, p_reason text, p_what text) returns void language plpgsql as $$
declare r record := pg_temp.one(p_author, p_key, p_event);
begin
  if r.accepted or r.reason is distinct from p_reason then raise exception '%: expected "%", got %', p_what, p_reason, r; end if;
end $$;
create function pg_temp.refused_like(p_author text, p_key text, p_event jsonb, p_pattern text, p_what text) returns void language plpgsql as $$
declare r record := pg_temp.one(p_author, p_key, p_event);
begin
  if coalesce(r.accepted or r.reason not like p_pattern, true) then raise exception '%: expected like "%", got %', p_what, p_pattern, r; end if;
end $$;
create function pg_temp.accepted(p_author text, p_key text, p_event jsonb, p_what text) returns void language plpgsql as $$
declare r record := pg_temp.one(p_author, p_key, p_event);
begin
  if r.accepted is not true or r.reason is not null then raise exception '%: not taken: %', p_what, r; end if;
end $$;
-- Appended as the service role (an import), for the state the relay meets.
create function pg_temp.seed(p_events jsonb) returns void language plpgsql as $$
declare r record;
begin
  perform pg_temp.as_caller(null);
  for r in select * from public.append_events(p_events) loop
    if not r.accepted then raise exception 'setup event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;

-- An owner who holds everything, a translator in rl-L (who also reviews), an
-- organization-wide viewer, a suspended translator, two looked-after
-- translators, an email account, and an outsider with a key but no membership.
select pg_temp.seed(jsonb_build_array(
  pg_temp.ev('rl-1', '_org', pg_temp.u('0a'), 'v1.OrgCreated', '{"name":"Relay Smoke"}'),
  pg_temp.ev('rl-2', '_org', pg_temp.u('0a'), 'v1.RoleDefined', '{"roleId":"admin","name":"Admin","privileges":["manage_structure","invite_members","manage_roles","override_checkpoints","translate","review","view_status"]}'),
  pg_temp.ev('rl-3', '_org', pg_temp.u('0a'), 'v1.RoleDefined', '{"roleId":"translator","name":"Translator","privileges":["translate","fill_reference","send_to_reviewers","review","view_status"]}'),
  pg_temp.ev('rl-4', '_org', pg_temp.u('0a'), 'v1.RoleDefined', '{"roleId":"viewer","name":"Viewer","privileges":["view_status"]}'),
  pg_temp.ev('rl-5', '_org', pg_temp.u('0a'), 'v1.MemberAdded', jsonb_build_object('profileId', pg_temp.u('0a'), 'roleId', 'admin', 'scope', '{"level":"org"}'::jsonb)),
  pg_temp.ev('rl-6', '_org', pg_temp.u('0a'), 'v1.LanguageAdded', '{"languageId":"rl-L","name":"Relayish","code":"rly","sourceCode":"eng"}'),
  pg_temp.ev('rl-7', '_org', pg_temp.u('0a'), 'v1.MemberAdded', jsonb_build_object('profileId', pg_temp.u('0b'), 'roleId', 'translator', 'scope', '{"level":"language","languageId":"rl-L"}'::jsonb)),
  pg_temp.ev('rl-8', '_org', pg_temp.u('0a'), 'v1.MemberAdded', jsonb_build_object('profileId', pg_temp.u('0c'), 'roleId', 'viewer', 'scope', '{"level":"org"}'::jsonb)),
  pg_temp.ev('rl-9', '_org', pg_temp.u('0a'), 'v1.MemberAdded', jsonb_build_object('profileId', pg_temp.u('0d'), 'roleId', 'translator', 'scope', '{"level":"language","languageId":"rl-L"}'::jsonb)),
  pg_temp.ev('rl-10', '_org', pg_temp.u('0a'), 'v1.MemberAdded', jsonb_build_object('profileId', pg_temp.u('0e'), 'roleId', 'translator', 'scope', '{"level":"language","languageId":"rl-L"}'::jsonb)),
  pg_temp.ev('rl-11', '_org', pg_temp.u('0a'), 'v1.MemberAdded', jsonb_build_object('profileId', pg_temp.u('0f'), 'roleId', 'translator', 'scope', '{"level":"language","languageId":"rl-L"}'::jsonb)),
  pg_temp.ev('rl-12', '_org', pg_temp.u('0a'), 'v1.MemberAdded', jsonb_build_object('profileId', pg_temp.u('11'), 'roleId', 'translator', 'scope', '{"level":"language","languageId":"rl-L"}'::jsonb)),
  -- Work already on the server: a take and a note by the translator, a review and an override by the owner, a set-aside by the translator.
  pg_temp.ev('rl-w1', 'rl-L', pg_temp.u('0b'), 'v1.TakeComposed', jsonb_build_object('takeId', 'rl-take', 'unitId', 'u1', 'cardHashes', jsonb_build_array(pg_temp.h('a')), 'parentTakeId', null)),
  pg_temp.ev('rl-w2', 'rl-L', pg_temp.u('0b'), 'v1.NoteAdded', '{"noteId":"rl-n","unitId":"u1","anchor":{"kind":"passage"},"text":"x"}'),
  pg_temp.ev('rl-w3', 'rl-L', pg_temp.u('0a'), 'v1.ReviewRecorded', '{"reviewId":"rl-rev","takeId":"rl-take","kindId":"peer","outcome":"needs_changes","via":"app"}'),
  pg_temp.ev('rl-w4', 'rl-L', pg_temp.u('0a'), 'v1.DepartureRecorded', '{"departureId":"rl-dep-o","unitId":"u1","type":"override","stepId":"s1","reason":"Consultant away"}'),
  pg_temp.ev('rl-w5', 'rl-L', pg_temp.u('0b'), 'v1.DepartureRecorded', '{"departureId":"rl-dep-s","unitId":"u1","type":"skip","kindId":"peer","reason":"Done on paper"}')
));
insert into public.install_keys (public_key, profile_id, install_id) values
  (pg_temp.k(1), pg_temp.u('0a')::uuid, 'dev-1'), (pg_temp.k(2), pg_temp.u('0b')::uuid, 'dev-2'), (pg_temp.k(3), pg_temp.u('0c')::uuid, 'dev-3'),
  (pg_temp.k(4), pg_temp.u('0d')::uuid, 'dev-4'), (pg_temp.k(5), pg_temp.u('0e')::uuid, 'dev-5'), (pg_temp.k(6), pg_temp.u('0f')::uuid, 'dev-6'),
  (pg_temp.k(7), pg_temp.u('10')::uuid, 'dev-7'), (pg_temp.k(8), pg_temp.u('11')::uuid, 'dev-8'),
  -- A shared phone: the translator's key also serves the looked-after translator.
  (pg_temp.k(2), pg_temp.u('0e')::uuid, 'dev-2');
select public.org_feature_grant('rl-org', 'nearby', 'Smoke');

-- 1. The service role's alone, with the guard first: a caller who is anyone is refused.
do $$ begin
  perform pg_temp.as_caller(pg_temp.u('0b'));
  begin
    perform * from public.relay_append_events(pg_temp.u('0b'), pg_temp.k(2), jsonb_build_array(pg_temp.note('rl-g1', pg_temp.u('0b'))), 0);
    raise exception 'the relay ran for a caller';
  exception when insufficient_privilege then null; end;
  perform pg_temp.as_caller(null);
  if exists (select 1 from public.events where id = 'rl-g1') then raise exception 'the guard let an event through'; end if;
end $$;
set local role authenticated;
select pg_temp.as_caller('5e000000-0000-0000-0000-00000000000b');
do $$ begin
  begin perform * from public.relay_append_events('5e000000-0000-0000-0000-00000000000b', rpad('rlk2', 43, 'A'), '[]', 0); raise exception 'a member ran the relay';
  exception when insufficient_privilege then null; end;
  begin perform public.revoke_install_keys('5e000000-0000-0000-0000-00000000000a', 'Me'); raise exception 'a member revoked keys';
  exception when insufficient_privilege then null; end;
  begin perform public.install_key_limit_raise(rpad('rlk1', 43, 'A'), '5e000000-0000-0000-0000-00000000000a', 1, 1, 'Me'); raise exception 'a member raised a cap';
  exception when insufficient_privilege then null; end;
  begin perform public.install_keys_staff_revoke('rl-owner@example.org', 'Me'); raise exception 'a member used the staff revoke';
  exception when insufficient_privilege then null; end;
  begin perform public.install_key_list('rl-owner@example.org'); raise exception 'a member listed keys';
  exception when insufficient_privilege then null; end;
  begin perform public.blob_named_by('rl-org/rl-L/' || repeat('a', 64) || '.wav', '5e000000-0000-0000-0000-00000000000b', 'rl-w1'); raise exception 'a member asked blob_named_by';
  exception when insufficient_privilege then null; end;
  begin perform * from public._event_files('v1.NoteAdded', '{}'); raise exception 'a member asked _event_files';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.as_caller(null);

-- 2. A key the author does not hold, and an outsider's key.
select pg_temp.refused(pg_temp.u('0b'), pg_temp.k(99), pg_temp.note('rl-k1', pg_temp.u('0b')), 'malformed envelope: no key of this author signed it', 'a key nobody certified');
select pg_temp.refused(pg_temp.u('0b'), pg_temp.k(1), pg_temp.note('rl-k2', pg_temp.u('0b')), 'malformed envelope: no key of this author signed it', 'another person''s key');
select pg_temp.refused('not-an-account', pg_temp.k(2), pg_temp.note('rl-k3', 'not-an-account'), 'malformed envelope: no key of this author signed it', 'an author who is no account');
select pg_temp.refused(pg_temp.u('10'), pg_temp.k(7), pg_temp.note('rl-k4', pg_temp.u('10')), 'not a member', 'an outsider with a key');
-- Another author's event under this author's key.
select pg_temp.refused(pg_temp.u('0b'), pg_temp.k(2), pg_temp.note('rl-k5', pg_temp.u('0a')), 'actorId does not match caller', 'the owner''s event under the translator''s key');
select pg_temp.refused(pg_temp.u('0b'), pg_temp.k(2), pg_temp.note('by:' || pg_temp.u('0a') || ':x1', pg_temp.u('0b')), 'malformed envelope: id names someone else', 'an id naming the owner');

-- 3. Every refusal in grantsSmoke.sql, through the relay. On a language
-- stream the relay answers as append_events does.
select pg_temp.accepted(pg_temp.u('0b'), pg_temp.k(2), pg_temp.note('rl-e1', pg_temp.u('0b')), 'a translator''s note');
do $$ declare r record; begin
  select * into r from pg_temp.relay(pg_temp.u('0b'), pg_temp.k(2), (select jsonb_build_array(jsonb_build_object('id', e.id, 'type', e.type, 'orgId', e.org_id,
    'streamId', e.stream_id, 'actorId', e.actor_id, 'deviceId', e.device_id, 'hlc', e.hlc, 'payload', e.payload)) from public.events e where e.id = 'rl-e1'));
  if r.accepted is not true or r.reason is distinct from 'duplicate' then raise exception 'a second carrier should get a duplicate, got %', r; end if;
  -- The author's own push of what a teammate delivered.
  perform pg_temp.as_caller(pg_temp.u('0b'));
  select * into r from public.append_events((select jsonb_build_array(jsonb_build_object('id', e.id, 'type', e.type, 'orgId', e.org_id,
    'streamId', e.stream_id, 'actorId', e.actor_id, 'deviceId', e.device_id, 'hlc', e.hlc, 'payload', e.payload)) from public.events e where e.id = 'rl-e1'));
  if r.accepted is not true or r.reason is distinct from 'duplicate' then raise exception 'the author''s push after a relay should be a duplicate, got %', r; end if;
  perform pg_temp.as_caller(null);
end $$;
select pg_temp.refused(pg_temp.u('0b'), pg_temp.k(2), pg_temp.ev('rl-e1', 'rl-L', pg_temp.u('0b'), 'v1.NoteAdded', '{"noteId":"rl-n0","unitId":"u1","anchor":{"kind":"passage"},"text":"x"}'),
  'malformed envelope: event id already used', 'an id reused for another event');
select pg_temp.refused(pg_temp.u('0b'), pg_temp.k(2), pg_temp.ev('rl-1', 'rl-L', pg_temp.u('0b'), 'v1.NoteAdded', '{"noteId":"rl-n9","unitId":"u1","anchor":{"kind":"passage"},"text":"x"}'),
  'malformed envelope: event id already used', 'another person''s id in another stream');
do $$ declare v_id text; begin
  foreach v_id in array array['removed:rl-e9', 'accountdeleted:rl-owner:org', 'invitemember:rl-inv', 'invitecheck:rl-inv:peer:rl-joiner'] loop
    perform pg_temp.refused(pg_temp.u('0b'), pg_temp.k(2), pg_temp.ev(v_id, 'rl-L', pg_temp.u('0b'), 'v1.NoteAdded', jsonb_build_object('noteId', 'n-' || v_id, 'unitId', 'u1', 'anchor', '{"kind":"passage"}'::jsonb, 'text', 'x')),
      'malformed envelope: event id reserved for the server', 'a server id taken first: ' || v_id);
  end loop;
end $$;
select pg_temp.refused(pg_temp.u('0b'), pg_temp.k(2), pg_temp.ev('rl-e2', 'rl-L', pg_temp.u('0b'), 'v1.TakeComposed', jsonb_build_object('takeId', 'rl-take', 'unitId', 'u1',
  'cardHashes', jsonb_build_array(pg_temp.h('f')), 'parentTakeId', null)), 'invalid payload: take id rl-take is already used', 'a second compose of a take');
select pg_temp.refused(pg_temp.u('0b'), pg_temp.k(2), jsonb_set(pg_temp.ev('rl-e3', 'rl-L', pg_temp.u('0b'), 'v1.ReviewRecorded',
  '{"reviewId":"rl-rev","takeId":"rl-take","kindId":"peer","outcome":"looks_good","via":"logged"}'), '{hlc}', '"000000000000001:000000:dR"'),
  'invalid payload: review id rl-rev is already used', 'a backdated review over someone''s');
select pg_temp.refused(pg_temp.u('0b'), pg_temp.k(2), pg_temp.ev('rl-e4', 'rl-L', pg_temp.u('0b'), 'v1.DepartureUndone', '{"departureId":"rl-dep-o"}'),
  'may not emit v1.DepartureUndone', 'a translator undoing an override');
select pg_temp.refused(pg_temp.u('0b'), pg_temp.k(2), pg_temp.ev('rl-e5', 'rl-L', pg_temp.u('0b'), 'v1.ReviewWithdrawn', '{"reviewId":"rl-rev"}'),
  'may not emit v1.ReviewWithdrawn', 'someone taking back another person''s review');
select pg_temp.refused(pg_temp.u('0a'), pg_temp.k(1), pg_temp.ev('rl-e6', 'rl-L', pg_temp.u('0a'), 'v1.ReviewWithdrawn', '{"reviewId":"rl-nobody"}'),
  'may not emit v1.ReviewWithdrawn', 'taking back a review the server has not seen');
select pg_temp.refused(pg_temp.u('0a'), pg_temp.k(1), pg_temp.ev('rl-e7', 'rl-L', pg_temp.u('0a'), 'v1.NoteWithdrawn', '{"noteId":"rl-n"}'),
  'may not emit v1.NoteWithdrawn', 'an owner taking back someone else''s note');
-- The author's daily allowance counts for relayed work (decision 169).
update public.append_allowance set events = 20000 where actor_id = pg_temp.u('0b') and day = (now() at time zone 'utc')::date;
select pg_temp.refused(pg_temp.u('0b'), pg_temp.k(2), pg_temp.note('rl-e8', pg_temp.u('0b')),
  format('may not emit v1.NoteAdded: this account has written 20000 events dated %s', (now() at time zone 'utc')::date), 'a relayed note over the author''s allowance');
update public.append_allowance set events = 0 where actor_id = pg_temp.u('0b');
-- The organization's stream, a person's, and a seeded organization's creation: the relay carries none of them.
do $$ declare e jsonb; begin
  for e in select * from jsonb_array_elements(jsonb_build_array(
    pg_temp.ev('rl-o1', '_org', pg_temp.u('0a'), 'v1.MemberAdded', '{"profileId":"rl-stranger","roleId":"viewer","scope":{"level":"org"}}'),
    pg_temp.ev('rl-o2', '_org', pg_temp.u('0a'), 'v1.MemberRemoved', jsonb_build_object('profileId', pg_temp.u('0a'), 'scope', '{"level":"org"}'::jsonb)),
    pg_temp.ev('rl-o3', '_org', pg_temp.u('0a'), 'v1.MemberAdded', jsonb_build_object('profileId', pg_temp.u('0b'), 'roleId', 'admin', 'scope', '{"level":"org"}'::jsonb)),
    pg_temp.ev('rl-o4', '_org', pg_temp.u('0a'), 'v1.RoleDefined', '{"roleId":"admin","name":"Admin","privileges":["view_status"]}'),
    pg_temp.ev('rl-o5', '_org', pg_temp.u('0a'), 'v1.RoleRetired', '{"roleId":"admin"}'),
    pg_temp.ev('rl-o6', '_org', pg_temp.u('0a'), 'v1.OrgCreated', '{"name":"Mine"}', 'rl-seeded'),
    pg_temp.ev('rl-o7', pg_temp.u('0a'), pg_temp.u('0a'), 'v1.VisionSeen', '{}', '_person')
  )) loop
    perform pg_temp.refused(pg_temp.u('0a'), pg_temp.k(1), e, 'invalid payload: only a language''s stream is relayed', 'not relayed: ' || (e->>'id'));
  end loop;
end $$;

-- 4. Every type the door refuses by name: the organization's types on a
-- language stream, a redaction, and a third-party app's value.
do $$ declare v_type text; begin
  foreach v_type in array public._org_event_types() loop
    continue when v_type = 'v1.Redacted';
    perform pg_temp.refused(pg_temp.u('0a'), pg_temp.k(1), pg_temp.ev('rl-d-' || v_type, 'rl-L', pg_temp.u('0a'), v_type, '{}'),
      format('invalid payload: %s belongs on the organization stream', v_type), 'an organization type on a language stream: ' || v_type);
  end loop;
end $$;
select pg_temp.refused(pg_temp.u('0a'), pg_temp.k(1), pg_temp.ev('rl-d-r', 'rl-L', pg_temp.u('0a'), 'v1.Redacted', '{"eventId":"rl-w2"}'),
  'invalid payload: a redaction is not relayed', 'a coordinator''s signed redaction');
select pg_temp.refused(pg_temp.u('0b'), pg_temp.k(2), pg_temp.ev('rl-d-x', 'rl-L', pg_temp.u('0b'), 'v1.ExternalValueSet', '{"key":"app/x","data":null}'),
  'may not emit v1.ExternalValueSet', 'a third-party app''s value');
do $$ declare r record; begin
  if exists (select 1 from public.events where type = 'v1.Redacted' and payload->>'eventId' = 'rl-w2') then raise exception 'the relayed redaction landed'; end if;
  -- The owner's own push of a redaction still works.
  perform pg_temp.as_caller(pg_temp.u('0a'));
  select * into r from public.append_events(jsonb_build_array(pg_temp.ev('rl-d-own', 'rl-L', pg_temp.u('0a'), 'v1.Redacted', '{"eventId":"rl-w2"}')));
  if r.accepted is not true then raise exception 'the owner''s own redaction was refused: %', r; end if;
  perform pg_temp.as_caller(null);
end $$;

-- 5. An event holding NUL fails a whole call: jsonb cannot keep U+0000, so the
-- good event beside it is not kept either. The Worker refuses such an event on
-- its own before it calls (core nearbyPayloadError).
do $$ begin
  begin
    perform * from pg_temp.relay(pg_temp.u('0b'), pg_temp.k(2),
      ('[' || pg_temp.note('rl-nul-ok', pg_temp.u('0b'))::text || ', {"id":"rl-nul","type":"v1.NoteAdded","payload":{"text":"a\u0000b"}}]')::jsonb);
    raise exception 'jsonb took a NUL';
  exception when untranslatable_character or invalid_text_representation then null; end;
  if exists (select 1 from public.events where id in ('rl-nul-ok', 'rl-nul')) then raise exception 'part of a call holding a NUL was kept'; end if;
end $$;

-- 6. A suspended author, a stamp far ahead and one just ahead, a clock no phone reads, and the version gate.
update auth.users set banned_until = now() + interval '100 years' where id = pg_temp.u('0d')::uuid;
select pg_temp.refused(pg_temp.u('0d'), pg_temp.k(4), pg_temp.note('rl-s1', pg_temp.u('0d')), 'may not emit v1.NoteAdded: its author is suspended', 'a suspended author');
update auth.users set banned_until = null where id = pg_temp.u('0d')::uuid;
select pg_temp.accepted(pg_temp.u('0d'), pg_temp.k(4), pg_temp.note('rl-s2', pg_temp.u('0d')), 'an author let back');
select pg_temp.refused(pg_temp.u('0b'), pg_temp.k(2), pg_temp.dated(pg_temp.note('rl-a1', pg_temp.u('0b')), interval '3 days'),
  format('stamped too far ahead: %s', to_char((now() + interval '3 days') at time zone 'utc', 'YYYY-MM-DD')), 'a stamp three days ahead');
select pg_temp.refused_like(pg_temp.u('0b'), pg_temp.k(2), pg_temp.dated(pg_temp.note('rl-a2', pg_temp.u('0b')), interval '1 hour'),
  'clock ahead: server time %', 'a stamp an hour ahead');
select pg_temp.refused(pg_temp.u('0b'), pg_temp.k(2), jsonb_set(pg_temp.note('rl-a3', pg_temp.u('0b')), '{hlc}', '"123"'),
  'malformed envelope: a clock no phone can read', 'a clock with too few parts');
do $$ begin
  update public.server_config set min_client_version = 50;
  begin
    perform * from pg_temp.relay(pg_temp.u('0b'), pg_temp.k(2), jsonb_build_array(pg_temp.note('rl-v1', pg_temp.u('0b'))), 0);
    raise exception 'a caller below the gate was answered per event';
  exception when sqlstate 'LQ001' then null; end;
  update public.server_config set min_client_version = 0;
end $$;

-- 7. Taking back a departure the server does not have needs Override
-- checkpoints (may_emit, restated), and the relay says why. A set-aside the
-- server holds is undone as before.
select pg_temp.refused(pg_temp.u('0b'), pg_temp.k(2), pg_temp.ev('rl-u1', 'rl-L', pg_temp.u('0b'), 'v1.DepartureUndone', '{"departureId":"rl-dep-none"}'),
  'departure not here yet', 'a translator''s relayed undo of a departure the server lacks');
do $$ declare r record; begin
  perform pg_temp.as_caller(pg_temp.u('0b'));
  select * into r from public.append_events(jsonb_build_array(pg_temp.ev('rl-u2', 'rl-L', pg_temp.u('0b'), 'v1.DepartureUndone', '{"departureId":"rl-dep-none"}')));
  if r.accepted is not false or r.reason is distinct from 'may not emit v1.DepartureUndone' then raise exception 'a translator''s pushed undo of an unknown departure: %', r; end if;
  perform pg_temp.as_caller(null);
end $$;
select pg_temp.accepted(pg_temp.u('0a'), pg_temp.k(1), pg_temp.ev('rl-u3', 'rl-L', pg_temp.u('0a'), 'v1.DepartureUndone', '{"departureId":"rl-dep-none"}'),
  'an override holder''s undo of a departure the server lacks');
select pg_temp.accepted(pg_temp.u('0b'), pg_temp.k(2), pg_temp.ev('rl-u4', 'rl-L', pg_temp.u('0b'), 'v1.DepartureUndone', '{"departureId":"rl-dep-s"}'),
  'a translator undoing a set-aside the server holds');

-- 8. A helper's lost-phone code revokes that person's keys at their sign-in,
-- only theirs, and the revocation list carries them; a code not marked lost
-- leaves keys alone.
insert into public.sign_in_codes (code_hash, profile_id, issued_by, expires_at, lost) values
  (repeat('1', 64), pg_temp.u('0e')::uuid, pg_temp.u('0a')::uuid, now() + interval '1 hour', true),
  (repeat('2', 64), pg_temp.u('0f')::uuid, pg_temp.u('0a')::uuid, now() + interval '1 hour', false);
do $$ declare r record; v jsonb; begin
  select * into r from public.take_sign_in_code_v2(repeat('1', 64));
  if r.profile_id is distinct from pg_temp.u('0e')::uuid or not r.lost then raise exception 'the lost code''s answer: %', r; end if;
  if exists (select 1 from public.install_keys where profile_id = pg_temp.u('0e')::uuid and revoked_at is null) then raise exception 'a lost code left a key unrevoked'; end if;
  if exists (select 1 from public.install_keys where profile_id = pg_temp.u('0b')::uuid and revoked_at is not null) then raise exception 'a lost code revoked another person on the shared phone'; end if;
  if (select count(*) from public.install_key_revocations where org_id = 'rl-org' and profile_id = pg_temp.u('0e')::uuid) <> 2 then
    raise exception 'the list should hold both of the person''s keys';
  end if;
  if (select array_agg(seq order by seq) from public.install_key_revocations where org_id = 'rl-org') <> array[1, 2]::bigint[] then raise exception 'seqs are 1 and 2'; end if;
  v := public.nearby_certificate_facts(pg_temp.u('0a'), 'dev-1', pg_temp.k(1), '{}');
  if (v->'orgs'->0->>'revokedSeq')::int <> 2 or not (v->'orgs'->0->'revocations') @> jsonb_build_array(jsonb_build_object('publicKey', pg_temp.k(5), 'profileId', pg_temp.u('0e'))) then
    raise exception 'the certificate facts do not carry the revocation: %', v;
  end if;
  if public.nearby_certificate_facts(pg_temp.u('0e'), 'dev-5', pg_temp.k(5), '{}')->>'revoked' <> 'true' then raise exception 'a revoked key got a certificate'; end if;
  select * into r from public.take_sign_in_code_v2(repeat('2', 64));
  if r.lost or exists (select 1 from public.install_keys where profile_id = pg_temp.u('0f')::uuid and revoked_at is not null) then raise exception 'a code not marked lost revoked keys'; end if;
  if (select count(*) from public.take_sign_in_code_v2(repeat('1', 64))) <> 0 then raise exception 'a code was taken twice'; end if;
end $$;

-- 9. A revoked key, per event (Carl's answer 4): work dated before revoked_at
-- stands, later work is refused, and so is a backdated redaction.
update public.install_keys set revoked_at = now() - interval '1 hour' where public_key = pg_temp.k(5);
select pg_temp.accepted(pg_temp.u('0e'), pg_temp.k(5), pg_temp.dated(pg_temp.note('rl-r1', pg_temp.u('0e')), interval '-2 hours'), 'a lost phone''s earlier note');
select pg_temp.refused(pg_temp.u('0e'), pg_temp.k(5), pg_temp.note('rl-r2', pg_temp.u('0e')),
  format('key revoked: dated after %s', to_char((now() - interval '1 hour') at time zone 'utc', 'YYYY-MM-DD')), 'a note dated after the revocation');
select pg_temp.refused(pg_temp.u('0e'), pg_temp.k(5), pg_temp.dated(pg_temp.ev('rl-r3', 'rl-L', pg_temp.u('0e'), 'v1.Redacted', '{"eventId":"rl-w3"}'), interval '-2 hours'),
  'invalid payload: a redaction is not relayed', 'a backdated redaction under a revoked key');

-- 10. The cap on a revoked key (Carl's answer 16): counted one by one as
-- append_events took them, duplicates and refusals uncounted, the event past
-- either limit refused alone and read as NOT_ALLOWED; staff raise one row,
-- never lowering it, and Try again then delivers.
do $$ declare v_bytes bigint; r record; begin
  if (select after_revoked_events from public.install_keys where public_key = pg_temp.k(5) and profile_id = pg_temp.u('0e')::uuid) <> 1 then
    raise exception 'the earlier note was not counted';
  end if;
  update public.install_keys set after_revoked_events_limit = 3 where public_key = pg_temp.k(5) and profile_id = pg_temp.u('0e')::uuid;
  for r in select * from pg_temp.relay(pg_temp.u('0e'), pg_temp.k(5), jsonb_build_array(
      pg_temp.dated(pg_temp.note('rl-c1', pg_temp.u('0e')), interval '-2 hours'),
      pg_temp.dated(pg_temp.note('rl-c2', pg_temp.u('0e')), interval '-2 hours'),
      pg_temp.dated(pg_temp.note('rl-c3', pg_temp.u('0e')), interval '-2 hours'))) loop
    if (r.id in ('rl-c1', 'rl-c2')) <> r.accepted then raise exception 'the cap took the wrong events: %', r; end if;
    if r.id = 'rl-c3' and r.reason <> 'may not emit v1.NoteAdded: this revoked key has reached its limit' then raise exception 'the cap''s reason: %', r; end if;
  end loop;
  select sum(octet_length(payload::text)) into v_bytes from public.events where id in ('rl-r1', 'rl-c1', 'rl-c2');
  if (select (after_revoked_events, after_revoked_bytes) from public.install_keys where public_key = pg_temp.k(5) and profile_id = pg_temp.u('0e')::uuid)
     is distinct from (3, v_bytes) then raise exception 'the cap counted something else'; end if;
  -- Another carrier with the same two: duplicates, uncounted.
  for r in select * from pg_temp.relay(pg_temp.u('0e'), pg_temp.k(5), (select jsonb_agg(jsonb_build_object('id', e.id, 'type', e.type, 'orgId', e.org_id,
      'streamId', e.stream_id, 'actorId', e.actor_id, 'deviceId', e.device_id, 'hlc', e.hlc, 'payload', e.payload)) from public.events e where e.id in ('rl-c1', 'rl-c2'))) loop
    if r.accepted is not true or r.reason is distinct from 'duplicate' then raise exception 'a second carrier: %', r; end if;
  end loop;
  if (select after_revoked_events from public.install_keys where public_key = pg_temp.k(5) and profile_id = pg_temp.u('0e')::uuid) <> 3 then raise exception 'duplicates were counted'; end if;
  -- Staff raise the events limit; an event append_events refuses is not counted.
  if public.install_key_limit_raise(pg_temp.k(5), pg_temp.u('0e'), 1000, 0, 'Staff') <> 'raised' then raise exception 'the raise'; end if;
  select * into r from pg_temp.relay(pg_temp.u('0e'), pg_temp.k(5), jsonb_build_array(pg_temp.dated(
    pg_temp.ev('rl-c4', 'rl-L', pg_temp.u('0e'), 'v1.NoteAdded', '{"noteId":"rl-c4-n","anchor":{"kind":"passage"}}'), interval '-2 hours')));
  if r.accepted then raise exception 'a note with no unit was taken'; end if;
  if (select after_revoked_events from public.install_keys where public_key = pg_temp.k(5) and profile_id = pg_temp.u('0e')::uuid) <> 3 then raise exception 'a refusal was counted'; end if;
  -- The bytes limit, then a raise and Try again.
  update public.install_keys set after_revoked_bytes_limit = after_revoked_bytes + 10 where public_key = pg_temp.k(5) and profile_id = pg_temp.u('0e')::uuid;
end $$;
select pg_temp.refused(pg_temp.u('0e'), pg_temp.k(5), pg_temp.dated(pg_temp.note('rl-c3', pg_temp.u('0e')), interval '-2 hours'),
  'may not emit v1.NoteAdded: this revoked key has reached its limit', 'a note past the bytes limit');
do $$ begin
  if public.install_key_limit_raise(pg_temp.k(5), pg_temp.u('0e'), 1, 104857600, 'Staff') <> 'raised' then raise exception 'the bytes raise'; end if;
  if (select (after_revoked_events_limit, after_revoked_bytes_limit, after_revoked_raised_by) from public.install_keys where public_key = pg_temp.k(5) and profile_id = pg_temp.u('0e')::uuid)
     is distinct from (1000, 104857600::bigint, 'Staff'::text) then raise exception 'a raise lowered a limit'; end if;
  if public.install_key_limit_raise(pg_temp.k(98), pg_temp.u('0e'), 1, 1, 'Staff') <> 'no_key' then raise exception 'raising a key nobody holds'; end if;
  if public.install_key_limit_raise(pg_temp.k(5), pg_temp.u('0e'), 1, 1, ' ') <> 'say_who' then raise exception 'a raise must say who'; end if;
end $$;
select pg_temp.accepted(pg_temp.u('0e'), pg_temp.k(5), pg_temp.dated(pg_temp.note('rl-c3', pg_temp.u('0e')), interval '-2 hours'), 'Try again after the raise');
-- An unrevoked key takes no lock: the translator's row was never locked or written by the relay.
do $$ begin
  if (select xmax::text from public.install_keys where public_key = pg_temp.k(2) and profile_id = pg_temp.u('0b')::uuid) <> '0' then
    raise exception 'ordinary delivery locked its key''s row';
  end if;
end $$;

-- 11. An email account's keys through New password's lost choice, and staff:
-- idempotent, the list written once, and later relayed work refused.
do $$ declare v_sessions int; begin
  if public.revoke_install_keys(pg_temp.u('11'), 'New password: a phone was lost') <> 1 then raise exception 'the reset revoked nothing'; end if;
  if public.revoke_install_keys(pg_temp.u('11'), 'New password: a phone was lost') <> 0 then raise exception 'a second revoke revoked again'; end if;
  if (select count(*) from public.install_key_revocations where profile_id = pg_temp.u('11')::uuid) <> 1 then raise exception 'one list row per organization'; end if;
  begin perform public.revoke_install_keys(pg_temp.u('11'), ''); raise exception 'a revoke that says nobody';
  exception when sqlstate '22023' then null; end;
  insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (gen_random_uuid(), pg_temp.u('0f')::uuid, now(), now(), 'aal1');
  if public.install_keys_staff_revoke('rl-kid2@people.langquest.org', 'Staff') <> 'revoked 1' then raise exception 'the staff revoke'; end if;
  select count(*) into v_sessions from auth.sessions where user_id = pg_temp.u('0f')::uuid;
  if v_sessions <> 0 then raise exception 'the staff revoke left sessions'; end if;
  if public.install_keys_staff_revoke('nobody@example.org', 'Staff') <> 'No account has that email or id.' then raise exception 'staff revoke of nobody'; end if;
  if (select count(*) from public.install_key_list(pg_temp.u('0e'))) <> 2 or (select count(*) from public.install_key_list('rl-kid@people.langquest.org')) <> 2 then
    raise exception 'the staff list by id and by email';
  end if;
end $$;
select pg_temp.refused_like(pg_temp.u('11'), pg_temp.k(8), pg_temp.dated(pg_temp.note('rl-m1', pg_temp.u('11')), interval '1 minute'),
  'key revoked: dated after %', 'work after a reset with lost');

-- 12. Someone who only views may upload a file an accepted event names, under
-- exactly its name: each event type, a voice note's format from the log, and
-- not under another extension, by an event that names no file, by a redacted
-- event, outside the stream, or for someone with no privilege there.
select pg_temp.accepted(pg_temp.u('0b'), pg_temp.k(2), pg_temp.ev('rl-f1', 'rl-L', pg_temp.u('0b'), 'v1.RecordingAdded', jsonb_build_object('recordingId', 'rl-rec', 'unitId', 'u1', 'kind', 'target',
  'cards', jsonb_build_array(jsonb_build_object('hash', pg_temp.h('1'), 'durationMs', 5), jsonb_build_object('hash', pg_temp.h('2'), 'durationMs', 5, 'format', 'm4a')))), 'a recording');
select pg_temp.accepted(pg_temp.u('0b'), pg_temp.k(2), pg_temp.ev('rl-f2', 'rl-L', pg_temp.u('0b'), 'v1.ReviewRecorded', jsonb_build_object('reviewId', 'rl-rev2', 'takeId', 'rl-take', 'kindId', 'peer',
  'outcome', 'looks_good', 'via', 'app', 'commentBlobHash', pg_temp.h('4'), 'artifacts', jsonb_build_array(jsonb_build_object('hash', pg_temp.h('3'), 'durationMs', 5)))), 'a review');
select pg_temp.accepted(pg_temp.u('0b'), pg_temp.k(2), pg_temp.ev('rl-f3', 'rl-L', pg_temp.u('0b'), 'v1.AudioFormatSet', jsonb_build_object('hash', pg_temp.h('5'), 'format', 'wav')), 'a voice note''s format');
select pg_temp.accepted(pg_temp.u('0b'), pg_temp.k(2), pg_temp.note('rl-f4', pg_temp.u('0b'), jsonb_build_object('blobHash', pg_temp.h('5'))), 'a wav voice note');
select pg_temp.accepted(pg_temp.u('0b'), pg_temp.k(2), pg_temp.ev('rl-f5', 'rl-L', pg_temp.u('0b'), 'v1.CardCleanUpSet', jsonb_build_object('unitId', 'u1', 'hash', pg_temp.h('1'),
  'use', 'cleaned', 'cleanedHash', pg_temp.h('6'), 'cleanedFormat', 'm4a')), 'a cleaned part');
select pg_temp.accepted(pg_temp.u('0b'), pg_temp.k(2), pg_temp.note('rl-f6', pg_temp.u('0b'), jsonb_build_object('blobHash', pg_temp.h('7'))), 'a voice note later redacted');
select pg_temp.seed(jsonb_build_array(pg_temp.ev('rl-f7', 'rl-L', pg_temp.u('0a'), 'v1.Redacted', '{"eventId":"rl-f6"}')));
do $$
declare
  v text := pg_temp.u('0c');
  f text := 'rl-org/rl-L/';
begin
  if not coalesce(public.blob_named_by(f || pg_temp.h('1') || '.wav', v, 'rl-f1'), false) then raise exception 'a card, wav by default'; end if;
  if public.blob_named_by(f || pg_temp.h('1') || '.m4a', v, 'rl-f1') then raise exception 'a wav card under m4a'; end if;
  if not coalesce(public.blob_named_by(f || pg_temp.h('2') || '.m4a', v, 'rl-f1'), false) then raise exception 'an m4a card'; end if;
  if not coalesce(public.blob_named_by(f || pg_temp.h('3') || '.wav', v, 'rl-f2'), false) then raise exception 'a review''s artifact'; end if;
  if not coalesce(public.blob_named_by(f || pg_temp.h('4') || '.m4a', v, 'rl-f2'), false) then raise exception 'a review''s spoken comment, m4a by default'; end if;
  if public.blob_named_by(f || pg_temp.h('4') || '.wav', v, 'rl-f2') then raise exception 'a spoken comment under wav'; end if;
  if not coalesce(public.blob_named_by(f || pg_temp.h('5') || '.wav', v, 'rl-f4'), false) then raise exception 'a voice note whose format the log says'; end if;
  if public.blob_named_by(f || pg_temp.h('5') || '.m4a', v, 'rl-f4') then raise exception 'a wav voice note under m4a'; end if;
  if not coalesce(public.blob_named_by(f || pg_temp.h('6') || '.m4a', v, 'rl-f5'), false) then raise exception 'a cleaned part'; end if;
  if public.blob_named_by(f || pg_temp.h('1') || '.wav', v, 'rl-f5') then raise exception 'Clean up''s note named the part as recorded'; end if;
  if public.blob_named_by(f || pg_temp.h('a') || '.wav', v, 'rl-w1') then raise exception 'a take names no file'; end if;
  if public.blob_named_by(f || pg_temp.h('5') || '.wav', v, 'rl-f3') then raise exception 'a format names no file'; end if;
  if public.blob_named_by(f || pg_temp.h('7') || '.m4a', v, 'rl-f6') then raise exception 'a redacted event named a file'; end if;
  if public.blob_named_by(f || pg_temp.h('1') || '.wav', pg_temp.u('10'), 'rl-f1') then raise exception 'an outsider'; end if;
  if public.blob_named_by('rl-org/rl-none/' || pg_temp.h('1') || '.wav', v, 'rl-f1') then raise exception 'another stream'; end if;
  if public.blob_named_by('rl-org/_org/' || pg_temp.h('1') || '.wav', pg_temp.u('0a'), 'rl-f1') then raise exception 'the organization stream'; end if;
  if public.blob_named_by(f || pg_temp.h('1') || '.wav', v, 'rl-nothing') then raise exception 'an event nobody sent'; end if;
  if public.blob_named_by(f || pg_temp.h('1') || '.wav', '', 'rl-f1') then raise exception 'nobody'; end if;
  if public.blob_access(f || pg_temp.h('1') || '.wav', v, true) then raise exception 'blob_access changed for a viewer'; end if;
end $$;
rollback;
