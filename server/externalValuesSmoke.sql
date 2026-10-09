-- External values (decisions.md 79): only the app's Worker appends
-- v1.ExternalValueSet, as the person behind a live access token that holds
-- the external_values scope and reaches the language; that person must
-- contribute there. Repeatable; every write rolls back.
\set ON_ERROR_STOP on
begin;
update public.server_config set min_client_version = 0;

-- A translator and a viewer with accounts (tokens belong to accounts).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'ev-translator@example.test'),
  ('00000000-0000-4000-8000-0000000000e2', 'ev-viewer@example.test');

-- An organization with two languages, set up as the server would (an import).
select set_config('request.jwt.claim.sub', '', true);
do $$ declare r record; begin
  for r in select * from public.append_events('[
    {"id":"ev-1","type":"v1.OrgCreated","orgId":"ev-org","streamId":"_org","actorId":"ev-owner","deviceId":"dE","hlc":"000000000000001:000000:dE","payload":{"name":"Values"}},
    {"id":"ev-2","type":"v1.RoleDefined","orgId":"ev-org","streamId":"_org","actorId":"ev-owner","deviceId":"dE","hlc":"000000000000002:000000:dE","payload":{"roleId":"org_admin","name":"Organization Admin","privileges":["manage_structure","invite_members","manage_roles","manage_templates","shape_templates","manage_reference","manage_flows","manage_teams","assign_work","override_checkpoints","translate","fill_reference","send_to_reviewers","review","view_status"]}},
    {"id":"ev-3","type":"v1.RoleDefined","orgId":"ev-org","streamId":"_org","actorId":"ev-owner","deviceId":"dE","hlc":"000000000000003:000000:dE","payload":{"roleId":"translator","name":"Translator","privileges":["translate","fill_reference","send_to_reviewers","view_status"]}},
    {"id":"ev-4","type":"v1.RoleDefined","orgId":"ev-org","streamId":"_org","actorId":"ev-owner","deviceId":"dE","hlc":"000000000000004:000000:dE","payload":{"roleId":"viewer","name":"Viewer","privileges":["view_status"]}},
    {"id":"ev-5","type":"v1.MemberAdded","orgId":"ev-org","streamId":"_org","actorId":"ev-owner","deviceId":"dE","hlc":"000000000000005:000000:dE","payload":{"profileId":"ev-owner","roleId":"org_admin","scope":{"level":"org"}}},
    {"id":"ev-6","type":"v1.LanguageAdded","orgId":"ev-org","streamId":"_org","actorId":"ev-owner","deviceId":"dE","hlc":"000000000000006:000000:dE","payload":{"languageId":"ev-L","name":"Valueish","code":"vlu","sourceCode":"eng"}},
    {"id":"ev-7","type":"v1.LanguageAdded","orgId":"ev-org","streamId":"_org","actorId":"ev-owner","deviceId":"dE","hlc":"000000000000007:000000:dE","payload":{"languageId":"ev-M","name":"Otherish","code":"oth","sourceCode":"eng"}},
    {"id":"ev-8","type":"v1.MemberAdded","orgId":"ev-org","streamId":"_org","actorId":"ev-owner","deviceId":"dE","hlc":"000000000000008:000000:dE","payload":{"profileId":"00000000-0000-4000-8000-0000000000e1","roleId":"translator","scope":{"level":"org"}}},
    {"id":"ev-9","type":"v1.MemberAdded","orgId":"ev-org","streamId":"_org","actorId":"ev-owner","deviceId":"dE","hlc":"000000000000009:000000:dE","payload":{"profileId":"00000000-0000-4000-8000-0000000000e2","roleId":"viewer","scope":{"level":"org"}}}
  ]'::jsonb) loop
    if not r.accepted then raise exception 'setup event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;

-- The translator's tokens: scoped, read only, revoked, and for the other language only; and the viewer's.
insert into public.api_tokens (id, org_id, profile_id, name, token_hash, scopes, language_ids, created_via, revoked_at) values
  ('00000000-0000-4000-8000-00000000a001', 'ev-org', '00000000-0000-4000-8000-0000000000e1', 'scoped', repeat('1', 64), array['external_values'], null, 'page', null),
  ('00000000-0000-4000-8000-00000000a002', 'ev-org', '00000000-0000-4000-8000-0000000000e1', 'read only', repeat('2', 64), array['read'], null, 'page', null),
  ('00000000-0000-4000-8000-00000000a003', 'ev-org', '00000000-0000-4000-8000-0000000000e1', 'revoked', repeat('3', 64), array['external_values'], null, 'page', now()),
  ('00000000-0000-4000-8000-00000000a004', 'ev-org', '00000000-0000-4000-8000-0000000000e1', 'other language', repeat('4', 64), array['external_values'], array['ev-M'], 'page', null),
  ('00000000-0000-4000-8000-00000000a005', 'ev-org', '00000000-0000-4000-8000-0000000000e2', 'viewer', repeat('5', 64), array['external_values'], null, 'page', null);

-- A value in ev-L from a token's device, at a clock just behind the server's.
create function pg_temp.val(p_id text, p_actor text, p_token text, p_key text) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'type', 'v1.ExternalValueSet', 'orgId', 'ev-org', 'streamId', 'ev-L', 'actorId', p_actor,
    'deviceId', 'api-00000000-0000-4000-8000-00000000' || p_token,
    'hlc', lpad(((extract(epoch from clock_timestamp()) * 1000)::bigint - 1000)::text, 15, '0') || ':000000:api', 'payload',
    jsonb_build_object('key', p_key, 'data', jsonb_build_object('count', 1)));
$$;
-- Append one event, as the Worker (the service role, no caller) or as its actor.
create function pg_temp.push(p_event jsonb, p_as_person boolean) returns record language plpgsql as $$
declare r record;
begin
  perform set_config('request.jwt.claim.sub', case when p_as_person then p_event->>'actorId' else '' end, true);
  select * into r from public.append_events(jsonb_build_array(p_event));
  return r;
end $$;
create function pg_temp.refused(p_event jsonb, p_as_person boolean, p_reason text, p_what text) returns void language plpgsql as $$
declare r record := pg_temp.push(p_event, p_as_person);
begin
  if r.accepted or r.reason <> p_reason then raise exception '%: expected "%", got %', p_what, p_reason, r; end if;
end $$;
create function pg_temp.accepted(p_event jsonb, p_what text) returns void language plpgsql as $$
declare r record := pg_temp.push(p_event, false);
begin
  if not r.accepted then raise exception '%: refused: %', p_what, r.reason; end if;
end $$;

-- 1. The Worker, for a contributor's live token with the scope: stored.
select pg_temp.accepted(pg_temp.val('api-ev-1', '00000000-0000-4000-8000-0000000000e1', 'a001', 'org.example.app/plays/1'), 'the Worker with a scoped token');
-- The same event again is a duplicate, not a second value.
do $$ declare r record := pg_temp.push(pg_temp.val('api-ev-1', '00000000-0000-4000-8000-0000000000e1', 'a001', 'org.example.app/plays/1'), false);
begin if not r.accepted or r.reason <> 'duplicate' then raise exception 'a resend: %', r; end if; end $$;

-- 2. A person, even from the token's own device id, cannot append one: not the LangQuest app, not a script.
select pg_temp.refused(pg_temp.val('ev-person', '00000000-0000-4000-8000-0000000000e1', 'a001', 'org.example.app/plays/2'), true,
  'may not emit v1.ExternalValueSet', 'a person appending directly');

-- 3. A token without the scope, a revoked one, and one that does not reach this language.
select pg_temp.refused(pg_temp.val('api-ev-2', '00000000-0000-4000-8000-0000000000e1', 'a002', 'org.example.app/plays/2'), false,
  'may not emit v1.ExternalValueSet', 'a read-only token');
select pg_temp.refused(pg_temp.val('api-ev-3', '00000000-0000-4000-8000-0000000000e1', 'a003', 'org.example.app/plays/2'), false,
  'may not emit v1.ExternalValueSet', 'a revoked token');
select pg_temp.refused(pg_temp.val('api-ev-4', '00000000-0000-4000-8000-0000000000e1', 'a004', 'org.example.app/plays/2'), false,
  'may not emit v1.ExternalValueSet', 'a token for another language');
-- Someone else's token does not lend its scope.
select pg_temp.refused(pg_temp.val('api-ev-5', '00000000-0000-4000-8000-0000000000e2', 'a001', 'org.example.app/plays/2'), false,
  'may not emit v1.ExternalValueSet', 'another person''s token');

-- 4. A viewer contributes nothing, so their scoped token stores nothing (may_emit).
select pg_temp.refused(pg_temp.val('api-ev-6', '00000000-0000-4000-8000-0000000000e2', 'a005', 'org.example.app/plays/2'), false,
  'may not emit v1.ExternalValueSet', 'a viewer''s token');

-- 5. A key that would not read back as a path is refused at the door.
select pg_temp.refused(pg_temp.val('api-ev-7', '00000000-0000-4000-8000-0000000000e1', 'a001', 'org.example.app//plays'), false,
  'invalid payload: key must be segments of letters, digits and . _ ~ : @ + - joined by /', 'a key with an empty segment');

rollback;
