-- Joining by invite with no password, and getting back in with a helper's
-- code (docs/invites-and-accounts.md, decisions.md 59).
--
-- * `redeem_invite_for` is redeem_invite_v2's body for a named account, so
--   the `join` Edge Function can make a looked-after account from an invite
--   and add its membership in one step. redeem_invite_v2 keeps its contract.
-- * `invite_join_requests` makes `join` safe to repeat: a phone that lost the
--   reply asks again with the same request id and gets the same account.
-- * Who may help someone back in: anyone holding Invite at a scope that
--   covers one of the person's memberships, while they hold it. The steward
--   row now only says who to ask; it no longer grants anything.
-- * A sign-in code may say the old phone is lost; the `sign-in-code`
--   function then signs that account out everywhere else.
--
-- No new events: membership still enters the log as v1.OrgMemberAdded and
-- v1.InviteRedeemed.

-- ---------------------------------------------------------------------------
-- Redeem for a named account. Same body as redeem_invite_v2 (20261002010000)
-- with the actor passed in; only the service role may name someone else.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_invite_for(p_actor text, p_token text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_hash text := encode(extensions.digest(p_token, 'sha256'), 'hex');
  v_inv record;
  v_used int;
  v_suffix text;
  v_hlc text;
begin
  if p_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  select * into v_inv from public.invites where token_hash = v_hash for update;
  if not found then raise exception 'invite not found' using errcode = '22023'; end if;
  if exists (select 1 from public.invite_redemptions where invite_id = v_inv.id and profile_id = p_actor) then
    return v_inv.org_id;
  end if;
  select count(*) into v_used from public.invite_redemptions where invite_id = v_inv.id;
  if v_used >= v_inv.max_uses then raise exception 'invite already used' using errcode = '22023'; end if;
  if v_inv.expires_at <= now() then raise exception 'invite expired' using errcode = '22023'; end if;
  if not exists (select 1 from public.org_roles where org_id = v_inv.org_id and role_id = v_inv.role_id and not retired) then
    raise exception 'invite role is no longer available' using errcode = '22023';
  end if;

  insert into public.invite_redemptions (invite_id, profile_id) values (v_inv.id, p_actor);
  update public.invites set
    redeemed_by = coalesce(redeemed_by, p_actor),
    redeemed_at = coalesce(redeemed_at, now()),
    -- A one-person label names that person; it is not needed once used.
    label = case when v_used + 1 >= max_uses and max_uses = 1 then null else label end
  where id = v_inv.id;

  -- Who to ask for help: the inviter, shown to the person. It grants nothing (may_help_sign_in).
  if public.is_managed_account(p_actor) then
    insert into public.account_stewards (profile_id, steward_id)
    values (p_actor::uuid, v_inv.issued_by::uuid) on conflict (profile_id) do nothing;
  end if;

  -- The first use keeps the ids single-use invites always had; later uses
  -- of a group invite carry the person, so each is its own event.
  v_suffix := case when v_used = 0 then '' else ':' || p_actor end;
  v_hlc := public._append_event_as(
    'invitemember:' || v_inv.id || v_suffix, v_inv.org_id, '_org', 'v1.OrgMemberAdded', 'service', 'server',
    jsonb_build_object('profileId', p_actor, 'roleId', v_inv.role_id, 'scope', v_inv.scope));
  if v_hlc is not null then
    perform public._apply_org_event(v_inv.org_id, 'v1.OrgMemberAdded',
      jsonb_build_object('profileId', p_actor, 'roleId', v_inv.role_id, 'scope', v_inv.scope), v_hlc);
  end if;
  perform public._append_event_as(
    'inviteredeem:' || v_inv.id || v_suffix, v_inv.org_id, '_org', 'v1.InviteRedeemed', 'service', 'server',
    jsonb_build_object('inviteId', v_inv.id, 'profileId', p_actor));
  return v_inv.org_id;
end $$;
revoke all on function public.redeem_invite_for(text, text) from public, anon, authenticated;
grant execute on function public.redeem_invite_for(text, text) to service_role;

-- The signed-in person redeems for themselves, as before.
create or replace function public.redeem_invite_v2(p_token text)
returns text language plpgsql security definer set search_path = public as $$
begin
  return public.redeem_invite_for(public.caller_id(), p_token);
end $$;
revoke all on function public.redeem_invite_v2(text) from public, anon;
grant execute on function public.redeem_invite_v2(text) to authenticated;

-- One row per `join` call that made an account; a repeat of the same request
-- id finds it instead of making a second account. Service role only.
create table if not exists public.invite_join_requests (
  request_id uuid primary key,
  profile_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.invite_join_requests enable row level security;
revoke all on public.invite_join_requests from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who may sign a looked-after person back in: whoever could invite them to
-- where they are now. The helper holds Invite (`invite_members`) at the
-- organization, or at the person's language, while they hold it; nobody
-- keeps the power after they leave or lose the role. Only accounts without
-- email are helped, and only by someone with their own email.
-- ---------------------------------------------------------------------------
create or replace function public.may_help_sign_in(p_helper text, p_profile text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_helper is not null and p_helper <> p_profile
    and public.is_managed_account(p_profile)
    and not public.is_managed_account(p_helper)
    and exists (
      select 1
      from public.org_memberships m
      join public.org_memberships h on h.org_id = m.org_id and h.profile_id = p_helper and not h.removed
      join public.org_roles r on r.org_id = h.org_id and r.role_id = h.role_id and not r.retired
      where m.profile_id = p_profile and not m.removed
        and 'invite_members' = any(r.privileges)
        and (h.scope_level = 'org'
          or (h.scope_level = 'partition' and m.scope_level in ('partition', 'lane') and h.partition_id = m.partition_id)
          or (h.scope_level = 'lane' and m.scope_level = 'lane' and h.partition_id = m.partition_id and h.lane_id = m.lane_id))
    );
$$;
revoke all on function public.may_help_sign_in(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sign-in codes that sign the person straight in, and may end the old phone.
-- ---------------------------------------------------------------------------
alter table public.sign_in_codes add column if not exists lost boolean not null default false;

create or replace function public.issue_sign_in_code_v2(p_profile text, p_code_hash text, p_lost boolean)
returns text language plpgsql security definer set search_path = public as $$
declare v_actor text := public.caller_id(); v_email text;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if not public.may_help_sign_in(v_actor, p_profile) then
    raise exception 'not allowed to help this person sign in' using errcode = '42501';
  end if;
  if p_code_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid code' using errcode = '22023'; end if;
  -- One live key per person: a new one replaces any unused one.
  delete from public.sign_in_codes where profile_id = p_profile::uuid and used_at is null;
  insert into public.sign_in_codes (code_hash, profile_id, issued_by, expires_at, lost)
  values (p_code_hash, p_profile::uuid, v_actor::uuid, now() + interval '1 hour', coalesce(p_lost, false));
  select u.email into v_email from auth.users u where u.id = p_profile::uuid;
  return split_part(v_email, '@', 1);
end $$;
revoke all on function public.issue_sign_in_code_v2(text, text, boolean) from public, anon;
grant execute on function public.issue_sign_in_code_v2(text, text, boolean) to authenticated;

-- The old signature (builds in review) makes a code that keeps the old phone.
create or replace function public.issue_sign_in_code(p_profile text, p_code_hash text)
returns text language sql security definer set search_path = public as $$
  select public.issue_sign_in_code_v2(p_profile, p_code_hash, false);
$$;
revoke all on function public.issue_sign_in_code(text, text) from public, anon;
grant execute on function public.issue_sign_in_code(text, text) to authenticated;

-- Service role only (the Edge Function): take a key once, with whether the
-- old phone is lost and who helped, for the person's Settings.
create or replace function public.take_sign_in_code_v2(p_code_hash text)
returns table (profile_id uuid, email text, lost boolean, helper_name text)
language plpgsql security definer set search_path = public as $$
begin
  if public.caller_id() is not null then raise exception 'service role only' using errcode = '42501'; end if;
  return query
    update public.sign_in_codes c set used_at = now()
    from auth.users u
    where c.code_hash = p_code_hash and c.used_at is null and c.expires_at > now()
      and u.id = c.profile_id and public.is_managed_email(u.email::text)
    returning c.profile_id, u.email::text, c.lost,
      (select p.display_name from public.profiles p where p.id = c.issued_by::text);
end $$;
revoke all on function public.take_sign_in_code_v2(text) from public, anon, authenticated;
grant execute on function public.take_sign_in_code_v2(text) to service_role;
