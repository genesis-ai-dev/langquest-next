-- Joining offline, the server's part (docs/nearby-sync-plan.md 14.1, section 6
-- "Authors with no account yet", phase 6): passes in the certificate facts
-- only with nearby and nearby_join on, for someone with Invite, looked after
-- or not, over roles with no manage privilege they may grant; every stop of
-- Carl's answer 9 in pass_refusal and redeem_pass_for; a first use's invites
-- row and its one v1.InviteIssued, uses counted, a second newcomer's own role,
-- and a repeat that still answers; no token reaching a pass; the newcomer's
-- id following from their key, and an existing, imported, profiled, linked or
-- deleted id refused; key sign-in until the key's first session; the relay's
-- branch for an author with no account yet; and deleting a newcomer's account.
-- Repeatable against a populated database; every write rolls back.
\set ON_ERROR_STOP on
begin;
update public.server_config set min_client_version = 0;

create function pg_temp.as_caller(p_profile text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', '', true),
         set_config('request.jwt.claims', case when p_profile is null then '' else json_build_object('sub', p_profile)::text end, true);
$$;
create function pg_temp.u(p text) returns text language sql immutable as $$ select '5f000000-0000-0000-0000-0000000000' || p $$;
-- Canonical base64url: a 43-character key and a 22-character salt ending in A have no spare bits set.
create function pg_temp.k(n int) returns text language sql immutable as $$ select rpad('jnk' || n, 43, 'A') $$;
create function pg_temp.salt(n int) returns text language sql immutable as $$ select rpad('jns' || n, 22, 'A') $$;
-- Newcomer n's id, from their key and salt.
create function pg_temp.nid(n int) returns text language sql immutable as $$ select public._newcomer_profile_id(pg_temp.k(n), pg_temp.salt(n)) $$;
create function pg_temp.ev(p_id text, p_stream text, p_actor text, p_type text, p_payload jsonb, p_behind_ms int default 1000) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'type', p_type, 'orgId', 'jn-org', 'streamId', p_stream, 'actorId', p_actor, 'deviceId', 'dJ',
    'hlc', lpad(((extract(epoch from clock_timestamp()) * 1000)::bigint - p_behind_ms)::text, 15, '0') || ':000000:dJ', 'payload', p_payload);
$$;
create function pg_temp.seed(p_events jsonb) returns void language plpgsql as $$
declare r record;
begin
  perform pg_temp.as_caller(null);
  for r in select * from public.append_events(p_events) loop
    if not r.accepted then raise exception 'setup event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;
-- A pass's body as the Worker signs it, for an inviter's key in a language.
create function pg_temp.pass(p_inviter text, p_key text, p_roles text[], p_lang text default 'jn-L', p_uses int default 10,
                             p_expires timestamptz default now() + interval '30 days') returns jsonb language sql as $$
  select jsonb_build_object(
    'passId', md5(p_inviter || p_key || p_lang || array_to_string(p_roles, ',') || p_uses || p_expires::text),
    'orgId', 'jn-org', 'languageId', p_lang, 'inviter', p_inviter, 'inviterKey', p_key,
    'roles', (select jsonb_agg(jsonb_build_object('roleId', r, 'privileges', to_jsonb(public._live_role_privileges('jn-org', r))) order by r) from unnest(p_roles) r),
    'maxUses', p_uses, 'expiresAt', floor(extract(epoch from p_expires) * 1000)::bigint);
$$;
-- What the Worker's createUser makes: a looked-after account with this id and its key as chain_key.
create function pg_temp.account(n int, p_email text default null, p_meta jsonb default null) returns void language sql as $$
  insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data)
  values (pg_temp.nid(n)::uuid, coalesce(p_email, 'jn-new-' || n || '@people.langquest.org'), 'authenticated', 'authenticated',
          coalesce(p_meta, jsonb_build_object('managed', true, 'chain_key', pg_temp.k(n))), '{"has_password":false}');
$$;
create function pg_temp.state(n int, p_pass jsonb, p_role text) returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_caller(null);
  return public.nearby_join_state(pg_temp.nid(n), pg_temp.k(n), pg_temp.salt(n), p_pass, p_role);
end $$;
create function pg_temp.finish(n int, p_pass jsonb, p_role text, p_token text default null) returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_caller(null);
  return public.nearby_join_finish(pg_temp.nid(n), pg_temp.k(n), pg_temp.salt(n), 'dev-n' || n, 'Newcomer ' || n, p_pass, p_role, p_token);
end $$;
-- The whole first contact for newcomer n as the Worker runs it: the state, an account if new and the pass takes them, then finish.
create function pg_temp.join(n int, p_pass jsonb, p_role text) returns jsonb language plpgsql as $$
declare s jsonb := pg_temp.state(n, p_pass, p_role);
begin
  if s->>'state' not in ('new', 'mine') then return jsonb_build_object('refused', s->>'state'); end if;
  if s->>'refusal' is not null and not (s->>'redeemed')::boolean then return jsonb_build_object('refused', s->>'refusal'); end if;
  if s->>'state' = 'new' then perform pg_temp.account(n); end if;
  return pg_temp.finish(n, p_pass, p_role);
end $$;
create function pg_temp.refused(p_pass jsonb, p_role text, p_words text, p_what text) returns void language plpgsql as $$
declare v text := public.pass_refusal(p_pass, p_role);
begin
  if v is distinct from p_words then raise exception '%: expected "%", got "%"', p_what, p_words, v; end if;
end $$;

-- An owner; inviters with Invite in jn-L (A, B, C, and a looked-after one, K);
-- a translator there with no Invite (T); and a v2 person imported with a
-- membership and no account (newcomer 20's id, so the test can aim at it).
insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('5f000000-0000-0000-0000-00000000000a', 'jn-owner@example.org', 'authenticated', 'authenticated', '{}'),
  ('5f000000-0000-0000-0000-00000000000b', 'jn-a@example.org', 'authenticated', 'authenticated', '{}'),
  ('5f000000-0000-0000-0000-00000000000c', 'jn-b@example.org', 'authenticated', 'authenticated', '{}'),
  ('5f000000-0000-0000-0000-00000000000d', 'jn-c@example.org', 'authenticated', 'authenticated', '{}'),
  ('5f000000-0000-0000-0000-00000000000e', 'jn-kid@people.langquest.org', 'authenticated', 'authenticated', '{"managed":true}'),
  ('5f000000-0000-0000-0000-00000000000f', 'jn-t@example.org', 'authenticated', 'authenticated', '{}');
select pg_temp.seed(jsonb_build_array(
  pg_temp.ev('jn-1', '_org', pg_temp.u('0a'), 'v1.OrgCreated', '{"name":"Join Smoke"}'),
  pg_temp.ev('jn-2', '_org', pg_temp.u('0a'), 'v1.RoleDefined', '{"roleId":"admin","name":"Admin","privileges":["manage_structure","invite_members","manage_roles","assign_work","translate","review","view_status"]}'),
  pg_temp.ev('jn-3', '_org', pg_temp.u('0a'), 'v1.RoleDefined', '{"roleId":"lead","name":"Lead","privileges":["invite_members","translate","review","view_status"]}'),
  pg_temp.ev('jn-4', '_org', pg_temp.u('0a'), 'v1.RoleDefined', '{"roleId":"translator","name":"Translator","privileges":["translate","view_status"]}'),
  pg_temp.ev('jn-5', '_org', pg_temp.u('0a'), 'v1.RoleDefined', '{"roleId":"reviewer","name":"Reviewer","privileges":["review","view_status"]}'),
  pg_temp.ev('jn-6', '_org', pg_temp.u('0a'), 'v1.RoleDefined', '{"roleId":"coordinator","name":"Coordinator","privileges":["assign_work","translate","view_status"]}'),
  pg_temp.ev('jn-7', '_org', pg_temp.u('0a'), 'v1.RoleDefined', '{"roleId":"filler","name":"Filler","privileges":["fill_reference","view_status"]}'),
  pg_temp.ev('jn-8', '_org', pg_temp.u('0a'), 'v1.RoleDefined', '{"roleId":"old","name":"Old","privileges":["translate"]}'),
  pg_temp.ev('jn-10', '_org', pg_temp.u('0a'), 'v1.RoleDefined', '{"roleId":"r1","name":"To retire","privileges":["view_status"]}'),
  pg_temp.ev('jn-11', '_org', pg_temp.u('0a'), 'v1.RoleDefined', '{"roleId":"w1","name":"Widened, held","privileges":["view_status"]}'),
  pg_temp.ev('jn-12', '_org', pg_temp.u('0a'), 'v1.RoleDefined', '{"roleId":"w2","name":"Widened, not held","privileges":["view_status"]}'),
  pg_temp.ev('jn-13', '_org', pg_temp.u('0a'), 'v1.RoleDefined', '{"roleId":"w3","name":"Raised to manage","privileges":["view_status"]}'),
  pg_temp.ev('jn-14', '_org', pg_temp.u('0a'), 'v1.MemberAdded', jsonb_build_object('profileId', pg_temp.u('0a'), 'roleId', 'admin', 'scope', '{"level":"org"}'::jsonb)),
  pg_temp.ev('jn-9', '_org', pg_temp.u('0a'), 'v1.RoleRetired', '{"roleId":"old"}'),
  pg_temp.ev('jn-15', '_org', pg_temp.u('0a'), 'v1.LanguageAdded', '{"languageId":"jn-L","name":"Joinish","code":"jnl","sourceCode":"eng"}'),
  pg_temp.ev('jn-16', '_org', pg_temp.u('0a'), 'v1.LanguageAdded', '{"languageId":"jn-L2","name":"Other","code":"jno","sourceCode":"eng"}'),
  pg_temp.ev('jn-17', '_org', pg_temp.u('0a'), 'v1.MemberAdded', jsonb_build_object('profileId', pg_temp.u('0b'), 'roleId', 'lead', 'scope', '{"level":"language","languageId":"jn-L"}'::jsonb)),
  pg_temp.ev('jn-18', '_org', pg_temp.u('0a'), 'v1.MemberAdded', jsonb_build_object('profileId', pg_temp.u('0c'), 'roleId', 'lead', 'scope', '{"level":"language","languageId":"jn-L"}'::jsonb)),
  pg_temp.ev('jn-19', '_org', pg_temp.u('0a'), 'v1.MemberAdded', jsonb_build_object('profileId', pg_temp.u('0d'), 'roleId', 'lead', 'scope', '{"level":"language","languageId":"jn-L"}'::jsonb)),
  pg_temp.ev('jn-20', '_org', pg_temp.u('0a'), 'v1.MemberAdded', jsonb_build_object('profileId', pg_temp.u('0e'), 'roleId', 'lead', 'scope', '{"level":"language","languageId":"jn-L"}'::jsonb)),
  pg_temp.ev('jn-21', '_org', pg_temp.u('0a'), 'v1.MemberAdded', jsonb_build_object('profileId', pg_temp.u('0f'), 'roleId', 'translator', 'scope', '{"level":"language","languageId":"jn-L"}'::jsonb)),
  pg_temp.ev('jn-22', '_org', pg_temp.u('0a'), 'v1.MemberAdded', jsonb_build_object('profileId', pg_temp.nid(20), 'roleId', 'translator', 'scope', '{"level":"language","languageId":"jn-L"}'::jsonb))
));

-- 1. The service role's alone: nobody signed in or out reaches a pass, an
-- account's state or a redemption by row, and the tombstones are out of reach.
do $$ declare v text; begin
  select string_agg(p.proname, ', ' order by p.proname) into v from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = any (array[
     '_manage_privileges', '_org_joins_on', '_newcomer_profile_id', '_pass_body_error', 'pass_refusal', '_redeem_invite_row',
     'redeem_pass_for', 'nearby_join_state', 'nearby_join_finish', 'redeem_invite_for', 'take_sign_in_code_for'])
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('public', p.oid, 'execute') or not has_function_privilege('service_role', p.oid, 'execute'));
  if v is not null then raise exception 'joining functions not the service role''s alone: %', v; end if;
  if has_table_privilege('anon', 'public.deleted_profile_ids', 'select') or has_table_privilege('authenticated', 'public.deleted_profile_ids', 'select') then
    raise exception 'deleted_profile_ids is open to API roles';
  end if;
end $$;
set local role authenticated;
select pg_temp.as_caller('5f000000-0000-0000-0000-00000000000b');
do $$ begin
  begin perform public.redeem_pass_for('5f000000-0000-0000-0000-00000000000b', '{}', 'translator'); raise exception 'a member redeemed a pass';
  exception when insufficient_privilege then null; end;
  begin perform public._redeem_invite_row('5f000000-0000-0000-0000-00000000000b', 'x', null); raise exception 'a member redeemed a row by its id';
  exception when insufficient_privilege then null; end;
  begin perform public.pass_refusal('{}', 'translator'); raise exception 'a member asked pass_refusal';
  exception when insufficient_privilege then null; end;
  begin perform public.nearby_join_state('x', 'y', 'z', '{}', 'translator'); raise exception 'a member asked an account''s state';
  exception when insufficient_privilege then null; end;
  begin perform public.nearby_join_finish('x', 'y', 'z', 'd', 'n', '{}', 'translator'); raise exception 'a member finished a join';
  exception when insufficient_privilege then null; end;
  begin perform public.take_sign_in_code_for(repeat('a', 64), '5f000000-0000-0000-0000-00000000000b'); raise exception 'a member took a code';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.as_caller(null);

-- 2. Passes in the certificate facts: none with only nearby on; with
-- nearby_join too, for each language named where the person holds Invite,
-- over live roles with no manage privilege whose privileges they hold, for
-- a looked-after inviter too, and for nobody without Invite.
select public.org_feature_grant('jn-org', 'nearby', 'Smoke');
do $$ declare v jsonb; begin
  v := public.nearby_certificate_facts(pg_temp.u('0b'), 'dev-a', pg_temp.k(101), array['jn-org/jn-L', 'jn-org/jn-L2']);
  if v->'orgs'->0->'passes' is distinct from '[]'::jsonb then raise exception 'a pass with nearby_join off: %', v; end if;
end $$;
select public.org_feature_grant('jn-org', 'nearby_join', 'Smoke');
do $$ declare v jsonb; p jsonb; begin
  v := public.nearby_certificate_facts(pg_temp.u('0b'), 'dev-a', pg_temp.k(101), array['jn-org/jn-L', 'jn-org/jn-L2']);
  p := v->'orgs'->0->'passes';
  if jsonb_array_length(p) <> 1 or p->0->>'languageId' <> 'jn-L' then raise exception 'one pass, for the language with Invite: %', p; end if;
  if p->0->'held' <> '["invite_members","review","translate","view_status"]'::jsonb then raise exception 'held: %', p->0->'held'; end if;
  if (select jsonb_agg(r->>'roleId' order by o) from jsonb_array_elements(p->0->'roles') with ordinality x (r, o))
     <> '["r1","reviewer","translator","w1","w2","w3"]'::jsonb then
    raise exception 'the roles a pass may name (no manage privilege, none retired, all held): %', p->0->'roles';
  end if;
  if p->0->'roles'->2 <> '{"roleId":"translator","privileges":["translate","view_status"]}'::jsonb then raise exception 'a role''s privileges: %', p->0->'roles'->2; end if;
  -- The other inviters, the looked-after one among them (Carl's answer 18), and a translator with no Invite.
  perform public.nearby_certificate_facts(pg_temp.u('0c'), 'dev-b', pg_temp.k(102), '{}');
  perform public.nearby_certificate_facts(pg_temp.u('0d'), 'dev-c', pg_temp.k(103), '{}');
  v := public.nearby_certificate_facts(pg_temp.u('0e'), 'dev-k', pg_temp.k(104), array['jn-org/jn-L']);
  if jsonb_array_length(v->'orgs'->0->'passes') <> 1 then raise exception 'a looked-after inviter holds a pass: %', v; end if;
  v := public.nearby_certificate_facts(pg_temp.u('0f'), 'dev-t', pg_temp.k(105), array['jn-org/jn-L']);
  if v->'orgs'->0->'passes' <> '[]'::jsonb then raise exception 'a translator with no Invite holds a pass: %', v; end if;
end $$;

-- 3. A first use makes the invites row under `pass:<passId>`, with the fields
-- 14.1 lists, and one v1.InviteIssued as the inviter; the newcomer joins
-- under the role their link chose, with the inviter as steward; a second
-- newcomer under the same pass gets their own role and no second
-- v1.InviteIssued; a repeat answers the organization.
do $$ declare
  p jsonb := pg_temp.pass(pg_temp.u('0b'), pg_temp.k(101), array['reviewer', 'translator']);
  v jsonb; r public.invites;
begin
  v := pg_temp.state(1, p, 'translator');
  if v <> '{"state":"new","redeemed":false,"member":false,"keyed":false,"refusal":null}'::jsonb then raise exception 'a new newcomer: %', v; end if;
  v := pg_temp.join(1, p, 'translator');
  if v->>'orgId' <> 'jn-org' or v->>'email' <> 'jn-new-1@people.langquest.org' or not (v->>'signIn')::boolean then raise exception 'joined: %', v; end if;
  select * into strict r from public.invites i where i.token_hash = 'pass:' || (p->>'passId');
  if r.org_id <> 'jn-org' or r.role_id <> 'translator' or r.scope <> '{"level":"language","languageId":"jn-L"}'::jsonb
     or r.issued_by <> pg_temp.u('0b') or r.max_uses <> 10 or r.label is not null or r.email is not null
     or r.expires_at <> to_timestamp((p->>'expiresAt')::bigint / 1000.0) or r.redeemed_by <> pg_temp.nid(1) then
    raise exception 'the first use''s row: %', r;
  end if;
  if (select count(*) from public.events e where e.type = 'v1.InviteIssued' and e.payload->>'inviteId' = r.id) <> 1
     or not exists (select 1 from public.events e where e.id = 'invite:' || r.id and e.actor_id = pg_temp.u('0b') and e.payload->>'roleId' = 'translator') then
    raise exception 'one v1.InviteIssued, as the inviter';
  end if;
  if not exists (select 1 from public.events e where e.id = 'invitemember:' || r.id and e.type = 'v1.MemberAdded'
                   and e.payload->>'profileId' = pg_temp.nid(1) and e.payload->>'roleId' = 'translator')
     or not exists (select 1 from public.events e where e.id = 'inviteredeem:' || r.id) then
    raise exception 'the membership and the redemption';
  end if;
  if not exists (select 1 from public.org_memberships m where m.org_id = 'jn-org' and m.profile_id = pg_temp.nid(1) and m.role_id = 'translator' and not m.removed) then
    raise exception 'no membership';
  end if;
  if (select a.steward_id::text from public.account_stewards a where a.profile_id = pg_temp.nid(1)::uuid) is distinct from pg_temp.u('0b') then
    raise exception 'the inviter is the steward';
  end if;
  if (select display_name from public.profiles where id = pg_temp.nid(1)) <> 'Newcomer 1' then raise exception 'the profile'; end if;
  if not exists (select 1 from public.install_keys k where k.public_key = pg_temp.k(1) and k.profile_id = pg_temp.nid(1)::uuid
                   and k.install_id = 'dev-n1' and k.first_session_at is null and k.revoked_at is null) then
    raise exception 'the newcomer''s key row';
  end if;

  v := pg_temp.join(2, p, 'reviewer');
  if v->>'orgId' <> 'jn-org' then raise exception 'a second newcomer: %', v; end if;
  if not exists (select 1 from public.events e where e.id = 'invitemember:' || r.id || ':' || pg_temp.nid(2) and e.payload->>'roleId' = 'reviewer') then
    raise exception 'the second newcomer''s own role';
  end if;
  if (select count(*) from public.events e where e.type = 'v1.InviteIssued' and e.payload->>'inviteId' = r.id) <> 1 then raise exception 'a second v1.InviteIssued'; end if;

  v := pg_temp.state(1, p, 'translator');
  if v <> '{"state":"mine","redeemed":true,"member":true,"keyed":true,"refusal":null}'::jsonb then raise exception 'reached by its key: %', v; end if;
  if pg_temp.finish(1, p, 'translator')->>'orgId' <> 'jn-org' then raise exception 'a repeat'; end if;
  if (select count(*) from public.invite_redemptions x where x.invite_id = r.id) <> 2 then raise exception 'a repeat counted a use'; end if;
end $$;

-- 4. Uses: the third of two is refused with no account and no row for it, and
-- the first still answers once they run out.
do $$ declare
  p jsonb := pg_temp.pass(pg_temp.u('0b'), pg_temp.k(101), array['translator'], 'jn-L', 2);
  v jsonb;
begin
  perform pg_temp.join(3, p, 'translator');
  perform pg_temp.join(4, p, 'translator');
  perform pg_temp.refused(p, 'translator', 'pass already used', 'uses');
  v := pg_temp.join(5, p, 'translator');
  if v->>'refused' <> 'pass already used' or exists (select 1 from auth.users u where u.id = pg_temp.nid(5)::uuid) then raise exception 'a third use: %', v; end if;
  if pg_temp.finish(3, p, 'translator')->>'orgId' <> 'jn-org' then raise exception 'a repeat after the uses ran out'; end if;
  -- Made in a race for the last use: the account stays, holding nothing, and the redemption answers refused.
  perform pg_temp.account(5);
  v := pg_temp.finish(5, p, 'translator');
  if v->>'refused' <> 'pass already used' then raise exception 'a race for the last use: %', v; end if;
  if not exists (select 1 from auth.users u where u.id = pg_temp.nid(5)::uuid)
     or not exists (select 1 from public.install_keys k where k.profile_id = pg_temp.nid(5)::uuid)
     or exists (select 1 from public.org_memberships m where m.profile_id = pg_temp.nid(5)) then
    raise exception 'after a refused redemption, the account and its key stay and it holds no membership';
  end if;
end $$;

-- 5. Every stop of Carl's answer 9 and the security review's: past expiry; a
-- role off the pass; either feature off; the inviter's key revoked; the
-- inviter lost Invite; the role retired, widened past what the inviter holds,
-- or raised to a manage privilege. A role widened within what the inviter
-- holds still redeems. A refused first use leaves no row and no event.
do $$ declare
  pa jsonb := pg_temp.pass(pg_temp.u('0b'), pg_temp.k(101), array['r1', 'translator', 'w1', 'w2', 'w3']);
  pb jsonb := pg_temp.pass(pg_temp.u('0c'), pg_temp.k(102), array['translator']);
  pc jsonb := pg_temp.pass(pg_temp.u('0d'), pg_temp.k(103), array['translator']);
  v jsonb;
begin
  perform pg_temp.refused(pg_temp.pass(pg_temp.u('0b'), pg_temp.k(101), array['translator'], 'jn-L', 10, now() - interval '1 minute'), 'translator', 'pass expired', 'expired');
  perform pg_temp.refused(pb, 'reviewer', 'role is not on the pass', 'a role off the pass');
  perform pg_temp.refused(pg_temp.pass(pg_temp.u('0b'), pg_temp.k(999), array['translator']), 'translator', 'pass inviter''s key revoked', 'a key the inviter never certified');
  perform pg_temp.refused(pg_temp.pass(pg_temp.u('0b'), pg_temp.k(101), array['translator'], 'jn-L9'), 'translator', 'pass language unknown', 'a language the organization does not list');
  perform pg_temp.refused(pg_temp.pass(pg_temp.u('0b'), pg_temp.k(101), array['translator'], 'jn-L2'), 'translator', 'pass role is no longer available from whoever sent it', 'a language the inviter has no Invite in');
  perform pg_temp.refused(pa || '{"maxUses":0}', 'translator', 'not a pass: maxUses', 'a body the Worker would not sign');

  perform public.org_feature_revoke('jn-org', 'nearby_join', 'Smoke');
  perform pg_temp.refused(pb, 'translator', 'joining offline is off for this organization', 'nearby_join off');
  perform public.org_feature_grant('jn-org', 'nearby_join', 'Smoke');
  perform public.org_feature_revoke('jn-org', 'nearby', 'Smoke');
  perform pg_temp.refused(pb, 'translator', 'joining offline is off for this organization', 'nearby off, nearby_join on');
  -- A repeat by someone already in still answers with the flag off.
  if pg_temp.finish(1, pg_temp.pass(pg_temp.u('0b'), pg_temp.k(101), array['reviewer', 'translator']), 'translator')->>'orgId' <> 'jn-org' then
    raise exception 'a repeat with the flag off';
  end if;
  perform public.org_feature_grant('jn-org', 'nearby', 'Smoke');
  perform pg_temp.refused(pb, 'translator', null, 'back on');

  -- A suspended inviter's pass lets nobody in, and nor does it once they are let back, since suspending revoked their key.
  update auth.users set banned_until = now() + interval '1 day' where id = pg_temp.u('0c')::uuid;
  perform pg_temp.refused(pb, 'translator', 'pass inviter suspended', 'a suspended inviter');
  update auth.users set banned_until = null where id = pg_temp.u('0c')::uuid;
  perform pg_temp.refused(pb, 'translator', null, 'a ban that ended');

  perform pg_temp.seed(jsonb_build_array(pg_temp.ev('jn-30', '_org', pg_temp.u('0a'), 'v1.MemberRemoved',
    jsonb_build_object('profileId', pg_temp.u('0c'), 'scope', '{"level":"language","languageId":"jn-L"}'::jsonb), 500)));
  perform pg_temp.refused(pb, 'translator', 'pass role is no longer available from whoever sent it', 'the inviter removed');

  if public.revoke_install_keys(pg_temp.u('0d'), 'Smoke') <> 1 then raise exception 'revoking C''s key'; end if;
  perform pg_temp.refused(pc, 'translator', 'pass inviter''s key revoked', 'the inviter''s key revoked');

  perform pg_temp.seed(jsonb_build_array(
    pg_temp.ev('jn-31', '_org', pg_temp.u('0a'), 'v1.RoleRetired', '{"roleId":"r1"}', 500),
    pg_temp.ev('jn-32', '_org', pg_temp.u('0a'), 'v1.RoleDefined', '{"roleId":"w1","name":"Widened, held","privileges":["translate","view_status"]}', 500),
    pg_temp.ev('jn-33', '_org', pg_temp.u('0a'), 'v1.RoleDefined', '{"roleId":"w2","name":"Widened, not held","privileges":["fill_reference","view_status"]}', 500),
    pg_temp.ev('jn-34', '_org', pg_temp.u('0a'), 'v1.RoleDefined', '{"roleId":"w3","name":"Raised to manage","privileges":["assign_work","view_status"]}', 500)));
  perform pg_temp.refused(pa, 'r1', 'pass role retired', 'a retired role');
  perform pg_temp.refused(pa, 'w2', 'pass role is no longer available from whoever sent it', 'a role widened past the inviter');
  perform pg_temp.refused(pa, 'w3', 'pass role grants a manage privilege', 'a role raised to a manage privilege');
  perform pg_temp.refused(pa, 'w1', null, 'a role widened within what the inviter holds');
  v := pg_temp.join(6, pa, 'w1');
  if v->>'orgId' <> 'jn-org' then raise exception 'a widened role redeems: %', v; end if;

  -- Refused first uses left nothing behind.
  if exists (select 1 from public.invites i where i.token_hash in ('pass:' || (pb->>'passId'), 'pass:' || (pc->>'passId')))
     or exists (select 1 from public.events e where e.type = 'v1.InviteIssued' and e.actor_id in (pg_temp.u('0c'), pg_temp.u('0d'))) then
    raise exception 'a refused first use left a row or a v1.InviteIssued';
  end if;
  -- And redeem_pass_for raises the same words.
  begin
    perform public.redeem_pass_for(pg_temp.nid(7), pc, 'translator');
    raise exception 'redeemed under a revoked key';
  exception when sqlstate '22023' then
    if sqlerrm <> 'pass inviter''s key revoked' then raise; end if;
  end;
end $$;

-- 6. A looked-after inviter's pass works, and a helper's lost-phone code stops it.
do $$ declare p jsonb := pg_temp.pass(pg_temp.u('0e'), pg_temp.k(104), array['translator']); begin
  if pg_temp.join(13, p, 'translator')->>'orgId' <> 'jn-org' then raise exception 'a looked-after inviter''s pass'; end if;
  insert into public.sign_in_codes (code_hash, profile_id, issued_by, expires_at, lost)
  values (repeat('7', 64), pg_temp.u('0e')::uuid, pg_temp.u('0a')::uuid, now() + interval '1 hour', true);
  if (select count(*) from public.take_sign_in_code_v2(repeat('7', 64))) <> 1 then raise exception 'the lost-phone code'; end if;
  perform pg_temp.refused(p, 'translator', 'pass inviter''s key revoked', 'after a helper''s lost-phone code');
end $$;

-- 7. No token reaches a pass: preview_invite and redeem_invite_v2 find no row
-- from a pass's fields, and issue_invite_v3 refuses a `pass:` hash.
do $$ declare p jsonb := pg_temp.pass(pg_temp.u('0b'), pg_temp.k(101), array['reviewer', 'translator']); begin
  if public.preview_invite(p->>'passId')->>'status' <> 'not_found' then raise exception 'preview_invite reached a pass'; end if;
  perform pg_temp.as_caller(pg_temp.u('0f'));
  begin
    perform public.redeem_invite_v2(p->>'passId');
    raise exception 'redeem_invite_v2 reached a pass';
  exception when sqlstate '22023' then
    if sqlerrm <> 'invite not found' then raise; end if;
  end;
  perform pg_temp.as_caller(pg_temp.u('0b'));
  begin
    perform public.issue_invite_v3('jn-org', 'jn-squat', 'pass:' || (p->>'passId'), 'translator', '{"level":"language","languageId":"jn-L"}', now() + interval '1 day');
    raise exception 'issue_invite_v3 took a pass: hash';
  exception when sqlstate '22023' then null;
  end;
  perform pg_temp.as_caller(null);
end $$;

-- 8. Whose id: it must follow from the key and salt; an account with
-- another key or none, a membership with no account (an imported v2
-- person), a profile or a v2 link holds it; only its own chain key reaches
-- an account.
do $$ declare p jsonb := pg_temp.pass(pg_temp.u('0b'), pg_temp.k(101), array['translator']); v jsonb; begin
  begin
    perform public.nearby_join_state(pg_temp.nid(1), pg_temp.k(2), pg_temp.salt(2), p, 'translator');
    raise exception 'an id that does not follow from the key';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.nearby_join_state(upper(pg_temp.nid(30)), pg_temp.k(30), pg_temp.salt(30), p, 'translator');
    raise exception 'an upper-case id';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.nearby_join_state(pg_temp.nid(30), pg_temp.k(30), rpad('jns30', 21, 'A') || 'B', p, 'translator');
    raise exception 'a salt that is not canonical';
  exception when sqlstate '22023' then null;
  end;
  -- An ordinary account with this id: no chain key, so no state but taken and no finish.
  perform pg_temp.account(10, 'jn-ordinary@example.org', '{}');
  if pg_temp.state(10, p, 'translator')->>'state' <> 'taken' then raise exception 'an ordinary account'; end if;
  begin
    perform pg_temp.finish(10, p, 'translator');
    raise exception 'finished an ordinary account';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.account(11, null, jsonb_build_object('managed', true, 'chain_key', pg_temp.k(12)));
  if pg_temp.state(11, p, 'translator')->>'state' <> 'taken' then raise exception 'an account with another chain key'; end if;
  if pg_temp.state(20, p, 'translator')->>'state' <> 'taken' then raise exception 'an imported v2 person with no account'; end if;
  insert into public.profiles (id, display_name) values (pg_temp.nid(21), 'Someone');
  if pg_temp.state(21, p, 'translator')->>'state' <> 'taken' then raise exception 'a profile'; end if;
  insert into v2_import.people_links (v2_id, next_id, confirmed_by) values (pg_temp.nid(22), pg_temp.u('0a'), 'Smoke');
  if pg_temp.state(22, p, 'translator')->>'state' <> 'taken' then raise exception 'a v2 link'; end if;
  v := pg_temp.join(20, p, 'translator');
  if v->>'refused' <> 'taken' or exists (select 1 from auth.users u where u.id = pg_temp.nid(20)::uuid) then raise exception 'joined as the imported person: %', v; end if;
end $$;

-- 9. Key sign-in lasts until the key's first session: the certificate call,
-- either sign-in code, or a revoked key ends it; the organization still
-- answers; a session never comes without a membership.
do $$ declare p jsonb := pg_temp.pass(pg_temp.u('0b'), pg_temp.k(101), array['translator']); v jsonb; begin
  perform pg_temp.join(7, p, 'translator');
  perform pg_temp.join(8, p, 'translator');
  perform pg_temp.join(9, p, 'translator');
  if not (pg_temp.finish(7, p, 'translator')->>'signIn')::boolean then raise exception 'a lost reply retried'; end if;

  perform public.nearby_certificate_facts(pg_temp.nid(7), 'dev-n7', pg_temp.k(7), '{}');
  v := pg_temp.finish(7, p, 'translator');
  if (v->>'signIn')::boolean or v->>'orgId' <> 'jn-org' then raise exception 'after the certificate call: %', v; end if;

  insert into public.sign_in_codes (code_hash, profile_id, issued_by, expires_at) values
    (repeat('8', 64), pg_temp.nid(8)::uuid, pg_temp.u('0b')::uuid, now() + interval '1 hour'),
    (repeat('9', 64), pg_temp.nid(9)::uuid, pg_temp.u('0b')::uuid, now() + interval '1 hour');
  if (select count(*) from public.take_sign_in_code_v2(repeat('8', 64))) <> 1 then raise exception 'a helper''s code'; end if;
  if (pg_temp.finish(8, p, 'translator')->>'signIn')::boolean then raise exception 'after a helper''s code on another phone'; end if;
  if (select count(*) from public.take_sign_in_code(repeat('9', 64))) <> 1 then raise exception 'an older build''s code'; end if;
  if (pg_temp.finish(9, p, 'translator')->>'signIn')::boolean then raise exception 'after an older build''s code'; end if;

  perform pg_temp.join(14, p, 'translator');
  perform public.revoke_install_keys(pg_temp.nid(14), 'Smoke');
  if (pg_temp.finish(14, p, 'translator')->>'signIn')::boolean then raise exception 'a revoked key'; end if;

  -- A failure between createUser and the key row recovers on retry, and the row is never un-revoked.
  delete from public.install_keys k where k.profile_id = pg_temp.nid(13)::uuid;
  if pg_temp.state(13, p, 'translator')->>'keyed' <> 'false' then raise exception 'no key row'; end if;
  perform pg_temp.finish(13, p, 'translator');
  if pg_temp.state(13, p, 'translator')->>'keyed' <> 'true' then raise exception 'the key row added again'; end if;
  if not exists (select 1 from public.install_keys k where k.profile_id = pg_temp.nid(14)::uuid and k.revoked_at is not null) then
    raise exception 'a retry un-revoked a key';
  end if;
end $$;

-- 9b. A local person's phone names its id with a helper's code: a code made
-- for someone else is refused and stays unspent, with that person's key
-- sign-in still open; their own is taken as take_sign_in_code_v2 takes it.
do $$ declare p jsonb := pg_temp.pass(pg_temp.u('0b'), pg_temp.k(101), array['translator']); r record; begin
  perform pg_temp.join(40, p, 'translator');
  perform pg_temp.join(41, p, 'translator');
  insert into public.sign_in_codes (code_hash, profile_id, issued_by, expires_at) values
    (repeat('a', 64), pg_temp.nid(40)::uuid, pg_temp.u('0b')::uuid, now() + interval '1 hour');
  begin
    perform * from public.take_sign_in_code_for(repeat('a', 64), pg_temp.nid(41)::uuid);
    raise exception 'a code made for someone else was taken';
  exception when sqlstate '28000' then null;
  end;
  if exists (select 1 from public.sign_in_codes c where c.code_hash = repeat('a', 64) and c.used_at is not null) then raise exception 'a refused code was spent'; end if;
  if not (pg_temp.finish(40, p, 'translator')->>'signIn')::boolean then raise exception 'a refused code closed its person''s key sign-in'; end if;
  begin perform * from public.take_sign_in_code_for(repeat('a', 64), null); raise exception 'a code taken for nobody named';
  exception when sqlstate '22023' then null; end;
  if (select count(*) from public.take_sign_in_code_for(repeat('b', 64), pg_temp.nid(40)::uuid)) <> 0 then raise exception 'a code that does not exist'; end if;
  select * into r from public.take_sign_in_code_for(repeat('a', 64), pg_temp.nid(40)::uuid);
  if r.profile_id is distinct from pg_temp.nid(40)::uuid or r.lost then raise exception 'their own code: %', r; end if;
  if (pg_temp.finish(40, p, 'translator')->>'signIn')::boolean then raise exception 'their own code left key sign-in open'; end if;
  if (select count(*) from public.take_sign_in_code_for(repeat('a', 64), pg_temp.nid(40)::uuid)) <> 0 then raise exception 'a code taken twice'; end if;
end $$;

-- 10. Someone a pass no longer takes is let in with an ordinary invite for
-- the chain's organization, never another's.
do $$ declare
  dead jsonb := pg_temp.pass(pg_temp.u('0b'), pg_temp.k(101), array['translator'], 'jn-L', 10, now() - interval '1 minute');
  v jsonb;
begin
  perform pg_temp.account(15);
  v := pg_temp.finish(15, dead, 'translator');
  if v->>'refused' <> 'pass expired' then raise exception 'a dead pass: %', v; end if;
  perform pg_temp.as_caller(pg_temp.u('0b'));
  perform public.issue_invite_v3('jn-org', 'jn-plain', encode(extensions.digest('a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 'sha256'), 'hex'), 'translator',
                                 '{"level":"language","languageId":"jn-L"}', now() + interval '1 day');
  v := pg_temp.finish(15, dead || '{"orgId":"jn-elsewhere"}', 'translator', 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1');
  if v->>'refused' <> 'invite not found' then raise exception 'an invite for another organization: %', v; end if;
  v := pg_temp.finish(15, dead, 'translator', 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1');
  if v->>'orgId' <> 'jn-org' or not (v->>'signIn')::boolean then raise exception 'let in by an invite: %', v; end if;
  if not exists (select 1 from public.org_memberships m where m.org_id = 'jn-org' and m.profile_id = pg_temp.nid(15) and not m.removed) then
    raise exception 'no membership from the invite';
  end if;
end $$;

-- 11. The relay's branch for an author with no account yet: until the
-- Worker makes it there is no key row, and the relay takes nothing; a dead
-- pass gives a refusal and no account; once made, the work goes as theirs,
-- and an old batch still passes after their first session.
do $$ declare
  p jsonb := pg_temp.pass(pg_temp.u('0b'), pg_temp.k(101), array['translator']);
  dead jsonb := pg_temp.pass(pg_temp.u('0b'), pg_temp.k(101), array['translator'], 'jn-L', 10, now() - interval '1 minute');
  note jsonb := pg_temp.ev('jn-e1', 'jn-L', pg_temp.nid(16), 'v1.NoteAdded', '{"noteId":"jn-n1","unitId":"u1","anchor":{"kind":"passage"},"text":"x"}');
  r record; v jsonb;
begin
  select * into r from public.relay_append_events(pg_temp.nid(16), pg_temp.k(16), jsonb_build_array(note), 0);
  if r.accepted or r.reason <> 'malformed envelope: no key of this author signed it' then raise exception 'before an account: %', r; end if;
  v := pg_temp.state(16, dead, 'translator');
  if v->>'state' <> 'new' or v->>'refusal' <> 'pass expired' then raise exception 'a dead pass at the relay: %', v; end if;
  if exists (select 1 from auth.users u where u.id = pg_temp.nid(16)::uuid) then raise exception 'an account from a dead pass'; end if;

  perform pg_temp.join(16, p, 'translator');
  select * into r from public.relay_append_events(pg_temp.nid(16), pg_temp.k(16), jsonb_build_array(note), 0);
  if not r.accepted or r.reason is not null then raise exception 'the newcomer''s work: %', r; end if;
  if (select e.actor_id from public.events e where e.id = 'jn-e1') <> pg_temp.nid(16) then raise exception 'appended as someone else'; end if;
  perform public.nearby_certificate_facts(pg_temp.nid(16), 'dev-n16', pg_temp.k(16), '{}');
  select * into r from public.relay_append_events(pg_temp.nid(16), pg_temp.k(16), jsonb_build_array(
    pg_temp.ev('jn-e2', 'jn-L', pg_temp.nid(16), 'v1.NoteAdded', '{"noteId":"jn-n2","unitId":"u1","anchor":{"kind":"passage"},"text":"y"}')), 0);
  if not r.accepted then raise exception 'an old batch after the first session: %', r; end if;
end $$;

-- 12. Deleting a newcomer's account takes their key rows, profile and
-- revocation rows, keeps the bare id, and no chain makes it again.
do $$ declare p jsonb := pg_temp.pass(pg_temp.u('0b'), pg_temp.k(101), array['translator']); v jsonb; begin
  perform pg_temp.join(12, p, 'translator');
  perform public.revoke_install_keys(pg_temp.nid(12), 'Smoke');
  if not exists (select 1 from public.install_key_revocations r where r.profile_id = pg_temp.nid(12)::uuid) then raise exception 'no revocation row'; end if;
  perform public._delete_account(pg_temp.nid(12));
  if exists (select 1 from public.install_keys k where k.profile_id = pg_temp.nid(12)::uuid)
     or exists (select 1 from public.install_key_revocations r where r.profile_id = pg_temp.nid(12)::uuid)
     or exists (select 1 from public.profiles x where x.id = pg_temp.nid(12))
     or exists (select 1 from public.account_stewards a where a.profile_id = pg_temp.nid(12)::uuid) then
    raise exception 'a deleted newcomer''s rows stayed';
  end if;
  if not exists (select 1 from public.deleted_profile_ids d where d.profile_id = pg_temp.nid(12)) then raise exception 'no tombstone'; end if;
  if (select count(*) from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'deleted_profile_ids') <> 1 then
    raise exception 'deleted_profile_ids keeps only the bare id';
  end if;
  v := pg_temp.state(12, p, 'translator');
  if v->>'state' <> 'deleted' then raise exception 'a deleted id: %', v; end if;
  if pg_temp.join(12, p, 'translator')->>'refused' <> 'deleted' then raise exception 'a deleted id joined again'; end if;
end $$;

rollback;
