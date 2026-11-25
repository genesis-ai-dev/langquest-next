-- A newcomer let in offline is accepted for 90 days from when their invite link
-- was made, not until their inviter's pass expires (Carl, 2026-11-24;
-- docs/decisions/0240-a-join-pass-lets-a-member.md as amended; docs/nearby-
-- sync-plan.md 5.12 "Expiry" and 14.1). Every pass expires at the end of its
-- 90-day window, the same date for every pass, so a newcomer let in the day
-- before was refused the day after: by every teammate at Hello, and here at
-- first contact unless a relayed batch had already made their account.
--
-- The inviter's phone now signs `madeAt` into the invite link's body (an
-- optional field of invite@1, so older phones read the link as before). The
-- Worker checks the chain and passes `madeAt` as p_made_at, and the pass then
-- stops a first use when the link was made after the pass expired or more
-- than 90 days (7776000000 ms, core's NEARBY_NEWCOMER_MS) ago. With no
-- p_made_at (a link from an older build, or an older Worker) the rule is the
-- one before: the pass's own expiresAt.
--
-- pass_refusal, redeem_pass_for, nearby_join_state and nearby_join_finish
-- each gain `p_made_at bigint default null` as their last argument, so a call
-- that names none still resolves; each is dropped and made again, so no older
-- overload is left beside it. _redeem_invite_row keeps its signature and no
-- longer checks a pass row's own expires_at, which is the pass's: for a pass,
-- pass_refusal has just decided, with the link's time, under the same now().
-- The row's expires_at still says when the pass stopped letting anyone new in.
-- Everything else is restated unchanged from 20261112050000_nearby_join.sql.

-- ---- pass_refusal -------------------------------------------------------------------

drop function public.pass_refusal(jsonb, text);

-- Why this pass no longer lets anyone in under this role, or null (Carl's
-- answer 9, the security reviews' additions to it, a suspended inviter among
-- them, and 14.1's redeem_pass_for steps 2 and 3). Read-only, so the join
-- route asks it before any Auth call and a dead pass makes no account. Words
-- the app reads: 'expired', 'used', 'off'; anything else reads as a role no
-- longer available. p_made_at: the invite link's signed madeAt, in ms, or
-- null for a link with none.
create function public.pass_refusal(p_pass jsonb, p_role text, p_made_at bigint default null)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_shape text := public._pass_body_error(p_pass);
  v_org text;
  v_lang text;
  v_inviter text;
  v_row public.invites;
  v_used int;
  v_privileges text[];
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if v_shape is not null then return v_shape; end if;
  if p_made_at is not null and p_made_at < 0 then return 'not a pass: madeAt'; end if;
  v_org := p_pass->>'orgId';
  v_lang := p_pass->>'languageId';
  v_inviter := p_pass->>'inviter';
  if not public._org_joins_on(v_org) then return 'joining offline is off for this organization'; end if;
  -- Made by the pass's expiry, and 90 days from then not past; with no time of the link's own, the pass's expiry.
  if p_made_at is null then
    if (p_pass->>'expiresAt')::bigint <= v_now then return 'pass expired'; end if;
  elsif p_made_at > (p_pass->>'expiresAt')::bigint or p_made_at + 7776000000 <= v_now then
    return 'pass expired';
  end if;
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

-- ---- _redeem_invite_row --------------------------------------------------------------

-- Restated with one change: a pass's row (token_hash 'pass:<passId>', which
-- no token reaches) is not refused by its own expires_at, since its only
-- caller, redeem_pass_for, asked pass_refusal with the link's madeAt first,
-- and a link made before the pass expired may still redeem for 90 days. An
-- ordinary invite's row is checked as before.
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
  if v_inv.expires_at <= now() and left(v_inv.token_hash, 5) <> 'pass:' then raise exception 'invite expired' using errcode = '22023'; end if;
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

-- ---- redeem_pass_for ---------------------------------------------------------------------

drop function public.redeem_pass_for(text, jsonb, text);

-- Redeem a pass for this person, under the role their invite link chose
-- (14.1, in this order). 1. Someone who already redeemed it gets the
-- organization, before any stop, so a lost reply can be retried after the uses
-- run out, the flag goes off, the key is revoked or the 90 days pass. 2 and 3.
-- pass_refusal, with the link's madeAt, raised as 22023 with its words. 4. On
-- a first use, the invites row (on conflict on its hash, nothing) and, only if
-- this call made it, v1.InviteIssued as the inviter, as issue_invite_v3
-- appends it. 5. _redeem_invite_row, which counts the use under the row's lock.
create function public.redeem_pass_for(p_actor text, p_pass jsonb, p_role text, p_made_at bigint default null)
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
  v_refusal := public.pass_refusal(p_pass, p_role, p_made_at);
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

-- ---- nearby_join_state -------------------------------------------------------------------

drop function public.nearby_join_state(text, text, text, jsonb, text);

-- May the Worker make or reach this newcomer's account, and would the pass
-- take them (14.1, The account, steps 1 to 3)? Read-only. As in
-- 20261112050000, with the link's madeAt passed to pass_refusal.
create function public.nearby_join_state(p_profile text, p_key text, p_salt text, p_pass jsonb, p_role text, p_made_at bigint default null)
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
    'refusal', case when v_state in ('new', 'mine') and not v_redeemed then public.pass_refusal(p_pass, p_role, p_made_at) end);
end $$;

-- ---- nearby_join_finish ------------------------------------------------------------------

drop function public.nearby_join_finish(text, text, text, text, text, jsonb, text, text);

-- After the Worker made the account (or found it 'mine'), in one transaction
-- (14.1, The account, step 5). As in 20261112050000, with the link's madeAt
-- passed to redeem_pass_for.
create function public.nearby_join_finish(
  p_profile text, p_key text, p_salt text, p_install text, p_name text, p_pass jsonb, p_role text, p_token text default null, p_made_at bigint default null
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
      v_org := public.redeem_pass_for(p_profile, p_pass, p_role, p_made_at);
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

-- The service role's alone, as before: new functions default open to every API role.
revoke all on function public.pass_refusal(jsonb, text, bigint) from public, anon, authenticated;
revoke all on function public.redeem_pass_for(text, jsonb, text, bigint) from public, anon, authenticated;
revoke all on function public.nearby_join_state(text, text, text, jsonb, text, bigint) from public, anon, authenticated;
revoke all on function public.nearby_join_finish(text, text, text, text, text, jsonb, text, text, bigint) from public, anon, authenticated;
grant execute on function public.pass_refusal(jsonb, text, bigint) to service_role;
grant execute on function public.redeem_pass_for(text, jsonb, text, bigint) to service_role;
grant execute on function public.nearby_join_state(text, text, text, jsonb, text, bigint) to service_role;
grant execute on function public.nearby_join_finish(text, text, text, text, text, jsonb, text, text, bigint) to service_role;
