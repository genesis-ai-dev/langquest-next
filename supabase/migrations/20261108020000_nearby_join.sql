-- Joining offline, the server's part (docs/nearby-sync-plan.md 14.1, 5.12
-- "The server's names" and "Chains", section 6 "Authors with no account yet",
-- phase 6 step 3). Someone with Invite in an organization with both `nearby`
-- and `nearby_join` on gets a join pass in their certificate answer, for each
-- language their phone named, naming the roles with no manage privilege they
-- may grant (Carl's answers 8, 11, 17, 18). Nothing is written at issue: the
-- first redemption at the server makes the invites row, under the hash
-- `pass:<passId>` that no token can reach, and its v1.InviteIssued, then
-- redeems through the body redeem_invite_for always had (_redeem_invite_row),
-- with the role the invite link chose. A pass stops automatically only
-- (answer 9): expiry, uses, the inviter's Invite or that role lost, the role
-- retired or grown a manage privilege, the inviter's key revoked or account
-- suspended, or either feature turned off.
--
-- The Worker's POST /api/nearby/join and its relay make a newcomer's account
-- with the id their key gives (checkChain, and _newcomer_profile_id here),
-- through nearby_join_state (read-only: may this id be made or reached, and
-- would the pass take them) and nearby_join_finish (the profile, the install
-- key, the redemption, and whether proof of the key may still sign them in).
-- An id that exists is reached only by its own chain key; an id anyone else
-- holds (an account, a membership with no account such as an imported v2
-- person, a profile, a redemption, a join request, a v2 link) or that was
-- deleted (deleted_profile_ids, which _delete_account now writes) is refused.
-- Key sign-in lasts until the key's first session (answer 10, decision 75 as
-- amended): nearby_certificate_facts already closes it, and both
-- take_sign_in_code functions now close it too.
--
-- Every function a store build calls keeps its results (decisions.md 151,
-- 152): redeem_invite_for keeps its signature, its null-actor 42501 first and
-- its answers; take_sign_in_code and take_sign_in_code_v2 keep theirs;
-- _delete_account only also keeps the bare id; nearby_certificate_facts only
-- gains `passes`. Every new function is the service role's alone, because
-- functions default open to every API role.

-- ---- the deleted ---------------------------------------------------------------------

-- The bare id of every account deleted from here on, so a chain cannot bring a
-- deleted newcomer's id back (14.1, step 2 of the account): accountdeleted:
-- events are written only for live memberships. It names nobody once the
-- account is gone (docs/nearby-sync-plan.md section 9).
create table public.deleted_profile_ids (
  profile_id text primary key check (length(profile_id) between 1 and 100)
);
alter table public.deleted_profile_ids enable row level security;
revoke all on table public.deleted_profile_ids from public, anon, authenticated;
grant all on table public.deleted_profile_ids to service_role;

-- ---- what a pass may never grant ---------------------------------------------------

-- Core's MANAGE_PRIVILEGES (packages/core/src/orgTerms.ts), held to it by
-- scripts/record-parity-sql.ts.
create or replace function public._manage_privileges()
returns text[] language sql immutable parallel safe set search_path = '' as $$
  select array['manage_structure', 'invite_members', 'manage_roles', 'manage_templates',
               'manage_reference', 'manage_flows', 'manage_teams', 'assign_work', 'override_checkpoints']::text[];
$$;

-- Joining offline is on only with both features (Carl's answer 11, section 14.1).
create or replace function public._org_joins_on(p_org text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public._org_feature_on(p_org, 'nearby') and public._org_feature_on(p_org, 'nearby_join');
$$;

-- A newcomer's id from their key and salt: core newcomerProfileId
-- (packages/core/src/nearbyChain.ts), held to its golden vector by
-- scripts/record-parity-sql.ts. The first 16 bytes of
-- SHA-256('lq-nearby-newcomer-v1\n' || key || salt), with UUID version 4 and
-- variant bits set, in lower case. Null for a key or salt that is not
-- canonical base64url of 32 and 16 bytes.
create or replace function public._newcomer_profile_id(p_key text, p_salt text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v_key bytea;
  v_salt bytea;
  v_h bytea;
  v_x text;
begin
  if p_key is null or p_key !~ '^[A-Za-z0-9_-]{43}$' or p_salt is null or p_salt !~ '^[A-Za-z0-9_-]{22}$' then return null; end if;
  v_key := decode(translate(p_key, '-_', '+/') || '=', 'base64');
  v_salt := decode(translate(p_salt, '-_', '+/') || '==', 'base64');
  -- Canonical only: spare bits in the last character would give a second spelling of one key.
  if rtrim(translate(encode(v_key, 'base64'), '+/', '-_'), '=') <> p_key
     or rtrim(translate(encode(v_salt, 'base64'), '+/', '-_'), '=') <> p_salt then
    return null;
  end if;
  v_h := substring(sha256(convert_to(E'lq-nearby-newcomer-v1\n', 'UTF8') || v_key || v_salt) from 1 for 16);
  v_h := set_byte(v_h, 6, (get_byte(v_h, 6) & 15) | 64);
  v_h := set_byte(v_h, 8, (get_byte(v_h, 8) & 63) | 128);
  v_x := encode(v_h, 'hex');
  return substr(v_x, 1, 8) || '-' || substr(v_x, 9, 4) || '-' || substr(v_x, 13, 4) || '-' || substr(v_x, 17, 4) || '-' || substr(v_x, 21, 12);
end $$;

-- ---- passes ----------------------------------------------------------------------------

-- Why this is not a pass's body as the Worker signs it (core JoinPass['body']),
-- or null. PL/pgSQL, so no cast is ever folded into a plan for a value the
-- check before it refused.
create or replace function public._pass_body_error(p jsonb)
returns text language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p) is distinct from 'object' then return 'not a pass'; end if;
  if jsonb_typeof(p->'passId') is distinct from 'string' or p->>'passId' !~ '^[0-9a-f]{32}$' then return 'not a pass: passId'; end if;
  if jsonb_typeof(p->'orgId') is distinct from 'string' or length(p->>'orgId') not between 1 and 256 or left(p->>'orgId', 1) = '_' then
    return 'not a pass: orgId';
  end if;
  if jsonb_typeof(p->'languageId') is distinct from 'string' or length(p->>'languageId') not between 1 and 256 or left(p->>'languageId', 1) = '_' then
    return 'not a pass: languageId';
  end if;
  if jsonb_typeof(p->'inviter') is distinct from 'string' or p->>'inviter' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return 'not a pass: inviter';
  end if;
  if jsonb_typeof(p->'inviterKey') is distinct from 'string' or p->>'inviterKey' !~ '^[A-Za-z0-9_-]{43}$' then return 'not a pass: inviterKey'; end if;
  if jsonb_typeof(p->'expiresAt') is distinct from 'number' or p->>'expiresAt' !~ '^[0-9]{1,16}$' then return 'not a pass: expiresAt'; end if;
  if jsonb_typeof(p->'maxUses') is distinct from 'number' or p->>'maxUses' !~ '^[0-9]{1,2}$' then return 'not a pass: maxUses'; end if;
  if (p->>'maxUses')::int not between 1 and 50 then return 'not a pass: maxUses'; end if;
  if jsonb_typeof(p->'roles') is distinct from 'array' then return 'not a pass: roles'; end if;
  return null;
end $$;

-- Why this pass no longer lets anyone in under this role, or null (Carl's
-- answer 9, the security reviews' additions to it, a suspended inviter among
-- them, and 14.1's redeem_pass_for steps 2 and 3). Read-only, so the join route asks it before any Auth call
-- and a dead pass makes no account. Words the app reads: 'expired', 'used',
-- 'off'; anything else reads as a role no longer available.
create or replace function public.pass_refusal(p_pass jsonb, p_role text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_shape text := public._pass_body_error(p_pass);
  v_org text;
  v_lang text;
  v_inviter text;
  v_row public.invites;
  v_used int;
  v_privileges text[];
begin
  if v_shape is not null then return v_shape; end if;
  v_org := p_pass->>'orgId';
  v_lang := p_pass->>'languageId';
  v_inviter := p_pass->>'inviter';
  if not public._org_joins_on(v_org) then return 'joining offline is off for this organization'; end if;
  if (p_pass->>'expiresAt')::bigint <= (extract(epoch from now()) * 1000)::bigint then return 'pass expired'; end if;
  select * into v_row from public.invites i where i.token_hash = 'pass:' || (p_pass->>'passId');
  if found then
    if v_row.org_id is distinct from v_org then return 'pass not found'; end if;
    select count(*) into v_used from public.invite_redemptions r where r.invite_id = v_row.id;
    if v_used >= v_row.max_uses then return 'pass already used'; end if;
  end if;
  -- Suspended: their account signs in nowhere, so their pass lets nobody in either.
  if exists (select 1 from auth.users u where u.id = v_inviter::uuid and u.banned_until > now()) then
    return 'pass inviter suspended';
  end if;
  -- Revoked, or gone with its account: the stop that holds for a taken phone.
  if not exists (select 1 from public.install_keys k
                 where k.public_key = p_pass->>'inviterKey' and k.profile_id = v_inviter::uuid and k.revoked_at is null) then
    return 'pass inviter''s key revoked';
  end if;
  if p_role is null or not exists (select 1 from jsonb_array_elements(p_pass->'roles') r
                                   where jsonb_typeof(r) = 'object' and r->>'roleId' = p_role) then
    return 'role is not on the pass';
  end if;
  v_privileges := public._live_role_privileges(v_org, p_role);
  if v_privileges is null then return 'pass role retired'; end if;
  -- Raised to a manage privilege since: refused. Widened with none still redeems, capped below at what the inviter holds.
  if v_privileges && public._manage_privileges() then return 'pass role grants a manage privilege'; end if;
  if not public.language_listed(v_org, v_lang) then return 'pass language unknown'; end if;
  if not public._invite_still_granted(v_org, v_inviter, p_role, jsonb_build_object('level', 'language', 'languageId', v_lang)) then
    return 'pass role is no longer available from whoever sent it';
  end if;
  return null;
end $$;

-- The body of redeem_invite_for, split out, with the role to grant given:
-- the row's own role when p_role is null (an invite), the one the invite link
-- chose for a pass. Used, expired, retired and no longer granted are checked
-- against that role under the row's lock, as before; the first use keeps the
-- plain event ids and later uses carry the person.
create or replace function public._redeem_invite_row(p_actor text, p_invite_id text, p_role text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.invites;
  v_role text;
  v_used int;
  v_suffix text;
  v_check text;
begin
  if p_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  select * into v_inv from public.invites i where i.id = p_invite_id for update;
  if not found then raise exception 'invite not found' using errcode = '22023'; end if;
  v_role := coalesce(p_role, v_inv.role_id);
  if exists (select 1 from public.invite_redemptions r where r.invite_id = v_inv.id and r.profile_id = p_actor) then
    return v_inv.org_id;
  end if;
  select count(*) into v_used from public.invite_redemptions r where r.invite_id = v_inv.id;
  if v_used >= v_inv.max_uses then raise exception 'invite already used' using errcode = '22023'; end if;
  if v_inv.expires_at <= now() then raise exception 'invite expired' using errcode = '22023'; end if;
  if not exists (select 1 from public.org_roles r where r.org_id = v_inv.org_id and r.role_id = v_role and not r.retired) then
    raise exception 'invite role is no longer available' using errcode = '22023';
  end if;
  -- The words the app already reads as a dead invite (heldInvite.ts outcomeOfError).
  if not public._invite_still_granted(v_inv.org_id, v_inv.issued_by, v_role, v_inv.scope) then
    raise exception 'invite role is no longer available from whoever sent it' using errcode = '22023';
  end if;

  insert into public.invite_redemptions (invite_id, profile_id) values (v_inv.id, p_actor);
  update public.invites i set
    redeemed_by = coalesce(i.redeemed_by, p_actor),
    redeemed_at = coalesce(i.redeemed_at, now()),
    -- A one-person label names that person; it is not needed once used.
    label = case when v_used + 1 >= i.max_uses and i.max_uses = 1 then null else i.label end
  where i.id = v_inv.id;

  -- Who to ask for help: the inviter, shown to the person. It grants nothing (may_help_sign_in).
  if public.is_managed_account(p_actor) then
    insert into public.account_stewards (profile_id, steward_id)
    values (p_actor::uuid, v_inv.issued_by::uuid) on conflict (profile_id) do nothing;
  end if;

  v_suffix := case when v_used = 0 then '' else ':' || p_actor end;
  perform public._append_event_as(
    'invitemember:' || v_inv.id || v_suffix, v_inv.org_id, '_org', 'v1.MemberAdded', 'service', 'server',
    jsonb_build_object('profileId', p_actor, 'roleId', v_role, 'scope', v_inv.scope));
  perform public._append_event_as(
    'inviteredeem:' || v_inv.id || v_suffix, v_inv.org_id, '_org', 'v1.InviteRedeemed', 'service', 'server',
    jsonb_build_object('inviteId', v_inv.id, 'profileId', p_actor));

  -- Its checks, in the language it is for (decision 146), after the membership.
  if cardinality(v_inv.checks) > 0 and v_inv.scope->>'level' = 'language'
     and 'manage_teams' = any(public.org_privileges(v_inv.org_id, v_inv.issued_by, v_inv.scope->>'languageId')) then
    foreach v_check in array v_inv.checks loop
      perform public._append_event_as(
        'invitecheck:' || v_inv.id || ':' || v_check || ':' || p_actor, v_inv.org_id, v_inv.scope->>'languageId',
        'v1.ReviewTeamMemberSet', 'service', 'server',
        jsonb_build_object('teamId', 'check:' || v_check, 'profileId', p_actor, 'member', true));
    end loop;
  end if;
  return v_inv.org_id;
end $$;

-- Restated from 20261019220000_invite_checks.sql as a wrapper on
-- _redeem_invite_row: the same signature, the null-actor 42501 first, and the
-- same answers. A pass's row is never found here, since no SHA-256 hex
-- equals `pass:<passId>`.
create or replace function public.redeem_invite_for(p_actor text, p_token text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_id text;
begin
  if p_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  select i.id into v_id from public.invites i where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if not found then raise exception 'invite not found' using errcode = '22023'; end if;
  return public._redeem_invite_row(p_actor, v_id, null);
end $$;

-- Redeem a pass for this person, under the role their invite link chose
-- (14.1, in this order). 1. Someone who already redeemed it gets the
-- organization, before any stop, so a lost reply can be retried after the uses
-- run out, the flag goes off or the key is revoked. 2 and 3. pass_refusal,
-- raised as 22023 with its words. 4. On a first use, the invites row (on
-- conflict on its hash, nothing) and, only if this call made it,
-- v1.InviteIssued as the inviter, as issue_invite_v3 appends it. 5.
-- _redeem_invite_row, which counts the use under the row's lock.
create or replace function public.redeem_pass_for(p_actor text, p_pass jsonb, p_role text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_refusal text := public._pass_body_error(p_pass);
  v_hash text;
  v_inv public.invites;
  v_id text;
  v_expires timestamptz;
  v_scope jsonb;
begin
  if p_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if v_refusal is not null then raise exception '%', v_refusal using errcode = '22023'; end if;
  v_hash := 'pass:' || (p_pass->>'passId');
  -- 1.
  select * into v_inv from public.invites i where i.token_hash = v_hash;
  if found and exists (select 1 from public.invite_redemptions r where r.invite_id = v_inv.id and r.profile_id = p_actor) then
    return v_inv.org_id;
  end if;
  -- 2 and 3.
  v_refusal := public.pass_refusal(p_pass, p_role);
  if v_refusal is not null then raise exception '%', v_refusal using errcode = '22023'; end if;
  -- 4.
  v_expires := to_timestamp((p_pass->>'expiresAt')::bigint / 1000.0);
  v_scope := jsonb_build_object('level', 'language', 'languageId', p_pass->>'languageId');
  insert into public.invites (id, org_id, token_hash, role_id, scope, expires_at, issued_by, max_uses)
  values (gen_random_uuid()::text, p_pass->>'orgId', v_hash, p_role, v_scope, v_expires, p_pass->>'inviter', (p_pass->>'maxUses')::int)
  on conflict (token_hash) do nothing
  returning id into v_id;
  if v_id is not null then
    perform public._append_event_as(
      'invite:' || v_id, p_pass->>'orgId', '_org', 'v1.InviteIssued', p_pass->>'inviter', 'server',
      jsonb_build_object('inviteId', v_id, 'roleId', p_role, 'scope', v_scope,
                         'expiresAt', to_char(v_expires at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  else
    select i.id into strict v_id from public.invites i where i.token_hash = v_hash;
  end if;
  -- 5.
  return public._redeem_invite_row(p_actor, v_id, p_role);
end $$;

-- ---- a newcomer's account (the Worker's accountFromChain) -----------------------------

-- May the Worker make or reach this newcomer's account, and would the pass
-- take them (14.1, The account, steps 1 to 3)? Read-only. The Worker has
-- checked the chain and the proof of key; this checks the id again from the
-- key and salt. `state`:
--   'mine'    an account with this id whose app_metadata.chain_key is this key
--   'taken'   an account with another key or none, or an id someone holds
--             with no account: a membership (an imported v2 person), a
--             profile, a redemption, a join request or a v2 link
--   'deleted' an account deleted with this id
--   'new'     none of these
-- with `redeemed` (this person has redeemed this pass), `member` (a live
-- membership in the pass's organization), `keyed` (this key's install_keys
-- row exists) and `refusal`, pass_refusal's words, asked only for 'new' and
-- 'mine' when not yet redeemed.
create or replace function public.nearby_join_state(p_profile text, p_key text, p_salt text, p_pass jsonb, p_role text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_chain_key text;
  v_state text;
  v_redeemed boolean := false;
  v_shape text := public._pass_body_error(p_pass);
begin
  if p_profile is null or p_profile !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'p_profile must be a newcomer''s id' using errcode = '22023';
  end if;
  if public._newcomer_profile_id(p_key, p_salt) is distinct from p_profile then
    raise exception 'the id does not follow from the key' using errcode = '22023';
  end if;
  if v_shape is not null then raise exception '%', v_shape using errcode = '22023'; end if;

  select u.raw_app_meta_data->>'chain_key' into v_chain_key from auth.users u where u.id = p_profile::uuid;
  if found then
    v_state := case when v_chain_key = p_key then 'mine' else 'taken' end;
  elsif exists (select 1 from public.deleted_profile_ids d where d.profile_id = p_profile) then
    v_state := 'deleted';
  elsif exists (select 1 from public.org_memberships m where m.profile_id = p_profile)
     or exists (select 1 from public.profiles p where p.id = p_profile)
     or exists (select 1 from public.invite_redemptions r where r.profile_id = p_profile)
     or exists (select 1 from public.join_requests j where j.profile_id = p_profile)
     or exists (select 1 from v2_import.people_links l where l.v2_id = p_profile or l.next_id = p_profile) then
    v_state := 'taken';
  else
    v_state := 'new';
  end if;

  v_redeemed := exists (select 1 from public.invites i join public.invite_redemptions r on r.invite_id = i.id
                        where i.token_hash = 'pass:' || (p_pass->>'passId') and r.profile_id = p_profile);
  return jsonb_build_object(
    'state', v_state,
    'redeemed', v_redeemed,
    'member', exists (select 1 from public.org_memberships m
                      where m.org_id = p_pass->>'orgId' and m.profile_id = p_profile and not m.removed),
    'keyed', exists (select 1 from public.install_keys k where k.public_key = p_key and k.profile_id = p_profile::uuid),
    'refusal', case when v_state in ('new', 'mine') and not v_redeemed then public.pass_refusal(p_pass, p_role) end);
end $$;

-- After the Worker made the account (or found it 'mine'), in one transaction
-- (14.1, The account, step 5): the profile under the name the invite link
-- carries, if it has none; the install_keys row, added again if missing so a
-- failure between the two calls recovers on retry, and never un-revoked; then
-- the redemption, of the pass, or of an ordinary invite's token for someone a
-- pass no longer takes (14.1, After), which must be for the chain's
-- organization. A refused redemption keeps the account, the profile and the
-- key row, and answers { refused } unless the person is already a live member
-- there. Otherwise { orgId, email, signIn }, signIn being whether proof of
-- the key may still sign them in (Carl's answer 10): this key's row has had
-- no first session and is not revoked, the account is looked after and not
-- suspended, and its chain_key is this key. It never writes first_session_at.
create or replace function public.nearby_join_finish(
  p_profile text, p_key text, p_salt text, p_install text, p_name text, p_pass jsonb, p_role text, p_token text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user record;
  v_org text;
  v_refusal text;
  v_name text := left(btrim(coalesce(p_name, '')), 100);
  v_shape text := public._pass_body_error(p_pass);
begin
  if public.caller_id() is not null then raise exception 'service role only' using errcode = '42501'; end if;
  if p_profile is null or public._newcomer_profile_id(p_key, p_salt) is distinct from p_profile then
    raise exception 'the id does not follow from the key' using errcode = '22023';
  end if;
  if v_shape is not null then raise exception '%', v_shape using errcode = '22023'; end if;
  if p_install is null or length(p_install) not between 1 and 256 then
    raise exception 'p_install must be 1 to 256 characters' using errcode = '22023';
  end if;
  select u.email::text as email, u.raw_app_meta_data->>'chain_key' as chain_key,
         (u.banned_until is not null and u.banned_until > now()) as banned
    into v_user from auth.users u where u.id = p_profile::uuid;
  if not found or v_user.chain_key is distinct from p_key then
    raise exception 'not this key''s account' using errcode = '42501';
  end if;

  if v_name <> '' then
    insert into public.profiles (id, display_name) values (p_profile, v_name) on conflict (id) do nothing;
  end if;
  insert into public.install_keys (public_key, profile_id, install_id) values (p_key, p_profile::uuid, p_install)
  on conflict (public_key, profile_id) do nothing;

  begin
    if p_token is not null then
      if not exists (select 1 from public.invites i
                     where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and i.org_id = p_pass->>'orgId') then
        raise exception 'invite not found' using errcode = '22023';
      end if;
      v_org := public.redeem_invite_for(p_profile, p_token);
    else
      v_org := public.redeem_pass_for(p_profile, p_pass, p_role);
    end if;
  exception when sqlstate '22023' then
    v_refusal := sqlerrm;
  end;
  if v_refusal is not null and not exists (select 1 from public.org_memberships m
       where m.org_id = p_pass->>'orgId' and m.profile_id = p_profile and not m.removed) then
    return jsonb_build_object('refused', v_refusal);
  end if;

  return jsonb_build_object(
    'orgId', coalesce(v_org, p_pass->>'orgId'),
    'email', v_user.email,
    'signIn', not v_user.banned and public.is_managed_account(p_profile)
      and exists (select 1 from public.install_keys k
                  where k.public_key = p_key and k.profile_id = p_profile::uuid
                    and k.first_session_at is null and k.revoked_at is null));
end $$;

-- ---- the certificate call's facts, with passes ------------------------------------------

-- Restated from 20261107010000_nearby_identity.sql with one field more per
-- organization: `passes`, when both features are on there (_org_joins_on),
-- for each language the phone named where the person holds Invite, looked
-- after or not (Carl's answer 18): `held`, their privileges there, and
-- `roles`, each live role with privileges, none of them a manage privilege,
-- all of them held there (answer 8, _invite_still_granted's rule). The
-- Worker runs core's passRoles over the same, as phones do, and signs the pass
-- with an id and expiry of its own working out (answer 17). Only the languages
-- this phone named: a pass is no use for a language the phone does not hold,
-- since the starting copy comes from it. Everything else is unchanged.
create or replace function public.nearby_certificate_facts(p_profile text, p_install text, p_key text, p_languages text[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_profile uuid;
  v_pid text; -- the account id as org_memberships holds it
  v_orgs text[];
  v_org text;
  v_lang text;
  v_keys jsonb;
  v_passes jsonb;
  v_joins boolean;
  v_held text[];
  v_roles jsonb;
  v_newest public.language_discovery_keys;
  v_out jsonb := '[]';
begin
  if p_profile is null or p_profile !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'p_profile must be an account id' using errcode = '22023';
  end if;
  if p_key is null or p_key !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'p_key must be an Ed25519 public key in base64url' using errcode = '22023';
  end if;
  if p_install is null or length(p_install) not between 1 and 256 then
    raise exception 'p_install must be 1 to 256 characters' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_languages), 0) > 500 then
    raise exception 'too many languages: % (max 500)', cardinality(p_languages) using errcode = '22023';
  end if;
  v_profile := p_profile::uuid;
  v_pid := v_profile::text;

  if exists (select 1 from public.install_keys k where k.public_key = p_key and k.profile_id = v_profile and k.revoked_at is not null) then
    update public.install_keys k set first_session_at = now() where k.profile_id = v_profile and k.first_session_at is null;
    return jsonb_build_object('revoked', true);
  end if;
  update public.install_keys k set first_session_at = now() where k.profile_id = v_profile and k.first_session_at is null;

  select coalesce(array_agg(o.org_id order by o.org_id), '{}') into v_orgs
  from (select distinct m.org_id from public.org_memberships m
        where m.profile_id = v_pid and not m.removed and public._org_feature_on(m.org_id, 'nearby')) o;
  if cardinality(v_orgs) = 0 then
    return jsonb_build_object('revoked', false, 'limited', false, 'orgs', '[]'::jsonb);
  end if;

  -- One person's new keys are counted one call at a time.
  perform pg_advisory_xact_lock(hashtext('install_keys:' || v_pid));
  update public.install_keys k set last_certified_at = now(), install_id = p_install
  where k.public_key = p_key and k.profile_id = v_profile and k.revoked_at is null;
  if not found then
    -- Revoked meanwhile, or new.
    if exists (select 1 from public.install_keys k where k.public_key = p_key and k.profile_id = v_profile) then
      return jsonb_build_object('revoked', true);
    end if;
    if (select count(*) from public.install_keys k where k.profile_id = v_profile and k.created_at > now() - interval '24 hours') >= 5 then
      return jsonb_build_object('revoked', false, 'limited', true, 'orgs', '[]'::jsonb);
    end if;
    insert into public.install_keys (public_key, profile_id, install_id, first_session_at)
    values (p_key, v_profile, p_install, now());
  end if;

  foreach v_org in array v_orgs loop
    v_keys := '[]';
    v_passes := '[]';
    v_joins := public._org_joins_on(v_org);
    for v_lang in
      select distinct substr(l, length(v_org) + 2) from unnest(p_languages) l
      where left(l, length(v_org) + 1) = v_org || '/' order by 1
    loop
      continue when v_lang = '' or v_lang = '_org' or strpos(v_lang, '/') > 0
        or not public.language_listed(v_org, v_lang)
        or cardinality(public.org_privileges(v_org, v_pid, v_lang)) = 0;
      v_newest := public._discovery_generation(v_org, v_lang);
      v_keys := v_keys || jsonb_build_array(jsonb_build_object(
        'languageId', v_lang,
        'gen', v_newest.generation,
        'floor', (select coalesce(max(k.generation), 1) from public.language_discovery_keys k
                  where k.org_id = v_org and k.language_id = v_lang and k.created_at <= now() - interval '1 year'),
        'key', encode(v_newest.key, 'hex')));

      v_held := public.org_privileges(v_org, v_pid, v_lang);
      if v_joins and 'invite_members' = any (v_held) then
        select coalesce(jsonb_agg(jsonb_build_object(
                 'roleId', r.role_id, 'privileges', to_jsonb(array(select distinct p from unnest(r.privileges) p order by p)))
                 order by r.role_id collate "C"), '[]')
          into v_roles
          from public.org_roles r
         where r.org_id = v_org and not r.retired and cardinality(r.privileges) > 0
           and not (r.privileges && public._manage_privileges())
           and r.privileges <@ v_held;
        if jsonb_array_length(v_roles) > 0 then
          v_passes := v_passes || jsonb_build_array(jsonb_build_object(
            'languageId', v_lang,
            'held', to_jsonb(array(select distinct p from unnest(v_held) p order by p)),
            'roles', v_roles));
        end if;
      end if;
    end loop;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'orgId', v_org,
      'orgSeq', coalesce((select c.next_seq - 1 from public.stream_cursors c where c.org_id = v_org and c.stream_id = '_org'), 0),
      'features', (select coalesce(jsonb_agg(f.feature order by f.feature), '[]') from public.org_features f
                   where f.org_id = v_org and f.revoked_at is null),
      'scopes', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                     'level', m.scope_level, 'languageId', m.language_id, 'roleId', m.role_id,
                     'privileges', to_jsonb(array(select distinct p from unnest(r.privileges) p order by p))))
                   order by m.scope_key), '[]')
                 from public.org_memberships m
                 join public.org_roles r on r.org_id = m.org_id and r.role_id = m.role_id and not r.retired
                 where m.org_id = v_org and m.profile_id = v_pid and not m.removed),
      'discoveryKeys', v_keys,
      'passes', v_passes,
      'revokedSeq', coalesce((select max(k.seq) from public.install_key_revocations k where k.org_id = v_org), 0),
      'revocations', (select coalesce(jsonb_agg(jsonb_build_object(
                          'seq', k.seq, 'publicKey', k.public_key, 'profileId', k.profile_id::text,
                          'revokedAtMs', floor(extract(epoch from k.revoked_at) * 1000)::bigint) order by k.seq), '[]')
                      from public.install_key_revocations k
                      where k.org_id = v_org and k.revoked_at > now() - interval '1 year')));
  end loop;
  return jsonb_build_object('revoked', false, 'limited', false, 'orgs', v_out);
end $$;

-- ---- sign-in codes close key sign-in ------------------------------------------------

-- Restated from 20261006000000_baseline.sql with the same signature and
-- answers; a code taken also ends key sign-in for every key of that person
-- (Carl's answer 10), since the password it sets is a way in of its own. A
-- code the helper marked lost revokes the person's keys and ends their
-- sessions, as take_sign_in_code_v2 does (answer 26), so a build that still
-- sets a password with the code cannot leave a taken phone's key standing.
create or replace function public.take_sign_in_code(p_code_hash text)
returns table (profile_id uuid, email text) language plpgsql security definer set search_path = public as $$
declare v_who uuid; v_address text; v_lost boolean;
begin
  if public.caller_id() is not null then raise exception 'service role only' using errcode = '42501'; end if;
  update public.sign_in_codes c set used_at = now()
  from auth.users u
  where c.code_hash = p_code_hash and c.used_at is null and c.expires_at > now()
    and u.id = c.profile_id and public.is_managed_email(u.email::text)
  returning c.profile_id, u.email::text, c.lost into v_who, v_address, v_lost;
  if not found then return; end if;
  update public.install_keys k set first_session_at = now() where k.profile_id = v_who and k.first_session_at is null;
  if v_lost then
    perform public.revoke_install_keys(v_who::text, 'a helper''s lost-phone sign-in code');
  end if;
  profile_id := v_who; email := v_address;
  return next;
end $$;

-- Restated from 20261108000000_nearby_relay.sql with the same signature and
-- answers; a code taken also ends key sign-in for every key of that person
-- (14.1, The session), so a helper's code on another phone ends it too.
create or replace function public.take_sign_in_code_v2(p_code_hash text)
returns table (profile_id uuid, email text, lost boolean, helper_name text)
language plpgsql security definer set search_path = public as $$
declare v_row record;
begin
  if public.caller_id() is not null then raise exception 'service role only' using errcode = '42501'; end if;
  update public.sign_in_codes c set used_at = now()
  from auth.users u
  where c.code_hash = p_code_hash and c.used_at is null and c.expires_at > now()
    and u.id = c.profile_id and public.is_managed_email(u.email::text)
  returning c.profile_id as who, u.email::text as address, c.lost as was_lost,
    (select p.display_name from public.profiles p where p.id = c.issued_by::text) as helper
  into v_row;
  if not found then return; end if;
  update public.install_keys k set first_session_at = now() where k.profile_id = v_row.who and k.first_session_at is null;
  if v_row.was_lost then
    perform public.revoke_install_keys(v_row.who::text, 'a helper''s lost-phone sign-in code');
  end if;
  profile_id := v_row.who; email := v_row.address; lost := v_row.was_lost; helper_name := v_row.helper;
  return next;
end $$;

-- ---- account deletion keeps the bare id ------------------------------------------------

-- Restated whole from 20261023100000_ops_dashboard.sql's; the only change is
-- the bare id kept in deleted_profile_ids before the account goes, so no
-- chain can bring it back. install_keys and install_key_revocations go with
-- the account (on delete cascade).
create or replace function public._delete_account(p_actor text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  m record;
begin
  if p_actor is null or p_actor = '' then raise exception 'no account' using errcode = '22023'; end if;
  select u.email into v_email from auth.users u where u.id::text = p_actor;

  for m in select om.org_id, om.scope_key, om.scope_level, om.language_id
             from public.org_memberships om
            where om.profile_id = p_actor and not om.removed loop
    perform public._append_event_as('accountdeleted:' || p_actor || ':' || m.scope_key,
      m.org_id, '_org', 'v1.MemberRemoved', 'service', 'server',
      jsonb_build_object('profileId', p_actor, 'scope', jsonb_strip_nulls(jsonb_build_object(
        'level', m.scope_level, 'languageId', m.language_id))));
  end loop;

  delete from public.push_receipts r using public.push_tokens t
    where r.token = t.token and t.profile_id = p_actor;
  delete from public.push_tokens where profile_id = p_actor;
  delete from public.notifications where profile_id = p_actor;
  delete from public.join_requests where profile_id = p_actor;
  delete from public.profiles where id = p_actor;
  if v_email is not null then
    update public.invites set email = null where lower(email) = lower(v_email);
  end if;
  delete from diag.records where delivered_by = p_actor;
  delete from diag.installs where profile_id = p_actor;
  -- Feedback they sent, with its screenshots, voice notes and the name and email they shared.
  delete from diag.feedback where profile_id = p_actor;
  update storage.objects set owner = null, owner_id = null where owner_id = p_actor;
  delete from public.user_blocks where blocker_id = p_actor or blocked_id = p_actor;
  update public.content_reports set reporter_id = null where reporter_id = p_actor;
  -- What the v2 import knows of this account: what Welcome back listed, and a link from a v2 person to it, turned off so the import
  -- names the v2 person again rather than an account that is gone.
  delete from v2_import.arrivals where profile_id = p_actor;
  update v2_import.people_links set active = false, email = null, confirmed_at = now() where next_id = p_actor;
  if v_email is not null then delete from v2_import.sign_in_failures where email = lower(v_email); end if;

  -- The bare id, so a chain cannot make this account again (docs/nearby-sync-plan.md 14.1).
  insert into public.deleted_profile_ids (profile_id) values (left(p_actor, 100)) on conflict do nothing;
  delete from auth.users where id::text = p_actor;

  insert into diag.job_runs (job, started_at, ms, outcome, n) values ('account_delete', now(), 0, 'ok', '{}');
end $$;

-- ---- grants ---------------------------------------------------------------------------

-- An invite id is no secret and new functions default open, so these are the
-- service role's alone (14.1); server/surfaceSmoke.sql holds it.
revoke all on function public._manage_privileges() from public, anon, authenticated;
revoke all on function public._org_joins_on(text) from public, anon, authenticated;
revoke all on function public._newcomer_profile_id(text, text) from public, anon, authenticated;
revoke all on function public._pass_body_error(jsonb) from public, anon, authenticated;
revoke all on function public.pass_refusal(jsonb, text) from public, anon, authenticated;
revoke all on function public._redeem_invite_row(text, text, text) from public, anon, authenticated;
revoke all on function public.redeem_pass_for(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.nearby_join_state(text, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.nearby_join_finish(text, text, text, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public._manage_privileges() to service_role;
grant execute on function public._org_joins_on(text) to service_role;
grant execute on function public._newcomer_profile_id(text, text) to service_role;
grant execute on function public._pass_body_error(jsonb) to service_role;
grant execute on function public.pass_refusal(jsonb, text) to service_role;
grant execute on function public._redeem_invite_row(text, text, text) to service_role;
grant execute on function public.redeem_pass_for(text, jsonb, text) to service_role;
grant execute on function public.nearby_join_state(text, text, text, jsonb, text) to service_role;
grant execute on function public.nearby_join_finish(text, text, text, text, text, jsonb, text, text) to service_role;
-- Restated with create or replace, which keeps grants; said again so this file holds them.
revoke all on function public.redeem_invite_for(text, text) from public, anon, authenticated;
revoke all on function public.nearby_certificate_facts(text, text, text, text[]) from public, anon, authenticated;
revoke all on function public.take_sign_in_code(text) from public, anon, authenticated;
revoke all on function public.take_sign_in_code_v2(text) from public, anon, authenticated;
revoke all on function public._delete_account(text) from public, anon, authenticated;
grant execute on function public.redeem_invite_for(text, text) to service_role;
grant execute on function public.nearby_certificate_facts(text, text, text, text[]) to service_role;
grant execute on function public.take_sign_in_code(text) to service_role;
grant execute on function public.take_sign_in_code_v2(text) to service_role;
grant execute on function public._delete_account(text) to service_role;
