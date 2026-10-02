-- Invites, accounts and getting back in (docs/invites-and-accounts.md,
-- decisions.md 54).
--
-- * An invite may name who it is for (`label`) and be used by a group
--   (`max_uses`); each use is a row in `invite_redemptions`.
-- * `preview_invite` says what a key means, to anyone holding it, so the
--   scan screen shows the server's word and never the link's.
-- * Looked-after accounts (no email of their own, address on
--   people.langquest.org) have a steward, may not invite, and can be signed
--   back in by their steward or an organization admin (`may_help_sign_in`,
--   used by the `sign-in-code` Edge Function).
--
-- No new events: membership still enters the log as v1.OrgMemberAdded and
-- v1.InviteRedeemed.

-- ---------------------------------------------------------------------------
-- Looked-after accounts
-- ---------------------------------------------------------------------------

-- The one definition of a looked-after account. The phone has the same rule
-- (apps/mobile/src/accounts.ts MANAGED_DOMAIN).
create or replace function public.is_managed_email(p_email text)
returns boolean language sql immutable as $$
  select coalesce(lower(p_email) like '%@people.langquest.org', false);
$$;

create or replace function public.is_managed_account(p_profile text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select public.is_managed_email(u.email::text) from auth.users u where u.id::text = p_profile), false);
$$;
revoke all on function public.is_managed_account(text) from public, anon, authenticated;

create table if not exists public.account_stewards (
  profile_id uuid primary key references auth.users (id) on delete cascade,
  steward_id uuid not null references auth.users (id) on delete cascade,
  since timestamptz not null default now()
);
alter table public.account_stewards enable row level security;
-- The person and their steward may see the row; nobody writes it from the client.
drop policy if exists account_stewards_read on public.account_stewards;
create policy account_stewards_read on public.account_stewards for select to authenticated
  using (profile_id::text = public.caller_id() or steward_id::text = public.caller_id());
grant select on public.account_stewards to authenticated;

-- May p_helper sign p_profile back in? Only a looked-after account, and only
-- its steward or someone holding invite_members organization-wide in an
-- organization the person belongs to (so nobody is stranded when their
-- inviter leaves).
create or replace function public.may_help_sign_in(p_helper text, p_profile text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_helper is not null and p_helper <> p_profile
    and public.is_managed_account(p_profile)
    and not public.is_managed_account(p_helper)
    and (
      exists (select 1 from public.account_stewards s
              where s.profile_id::text = p_profile and s.steward_id::text = p_helper)
      or exists (
        select 1 from public.org_memberships m
        where m.profile_id = p_profile and not m.removed
          and 'invite_members' = any(public.org_privileges(m.org_id, p_helper, null, null))
          and exists (select 1 from public.org_memberships a
                      where a.org_id = m.org_id and a.profile_id = p_helper and not a.removed and a.scope_level = 'org'))
    );
$$;
revoke all on function public.may_help_sign_in(text, text) from public, anon, authenticated;

-- What the app asks before showing "Help them sign in".
create or replace function public.can_help_sign_in(p_profile text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.may_help_sign_in(public.caller_id(), p_profile);
$$;
revoke all on function public.can_help_sign_in(text) from public, anon;
grant execute on function public.can_help_sign_in(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Labels and group invites
-- ---------------------------------------------------------------------------

alter table public.invites add column if not exists label text;
alter table public.invites add column if not exists max_uses int not null default 1;
do $$ begin
  alter table public.invites add constraint invites_max_uses check (max_uses between 1 and 50);
exception when duplicate_object then null;
end $$;

-- invite_id has the type invites.id has here: text on a fresh install, uuid
-- on the hosted project (see 20260917125750).
do $$
declare v_type text := (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
                        where a.attrelid = 'public.invites'::regclass and a.attname = 'id');
begin
  execute format($f$
    create table if not exists public.invite_redemptions (
      invite_id %s not null references public.invites (id) on delete cascade,
      profile_id text not null,
      redeemed_at timestamptz not null default now(),
      primary key (invite_id, profile_id)
    )$f$, v_type);
end $$;
alter table public.invite_redemptions enable row level security;
-- Existing single-use redemptions count as uses.
insert into public.invite_redemptions (invite_id, profile_id, redeemed_at)
select id, redeemed_by, coalesce(redeemed_at, now()) from public.invites where redeemed_by is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Issue. The old signature (builds in review) and the new one share a body.
-- ---------------------------------------------------------------------------
create or replace function public.issue_invite_v3(
  p_org text, p_invite_id text, p_token_hash text, p_role_id text, p_scope jsonb, p_expires_at timestamptz,
  p_label text default null, p_max_uses int default 1
) returns void language plpgsql security definer set search_path = public as $$
declare v_actor text := public.caller_id(); v_id public.invites.id%type; v_label text := nullif(btrim(coalesce(p_label, '')), '');
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if public.is_managed_account(v_actor) then
    raise exception 'add your own email before inviting others' using errcode = '42501';
  end if;
  if not ('invite_members' = any(public.org_privileges(p_org, v_actor, null, null))) then
    raise exception 'not allowed to invite members' using errcode = '42501';
  end if;
  if p_expires_at <= now() then raise exception 'invite already expired' using errcode = '22023'; end if;
  if not exists (select 1 from public.org_roles r where r.org_id = p_org and r.role_id = p_role_id and not r.retired) then
    raise exception 'unknown role %', p_role_id using errcode = '22023';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' or p_expires_at > now() + interval '90 days' then
    raise exception 'invalid invite' using errcode = '22023';
  end if;
  if public._scope_error(p_scope) is not null then raise exception 'invalid scope' using errcode = '22023'; end if;
  if p_max_uses is null or p_max_uses not between 1 and 50 then raise exception 'invalid number of uses' using errcode = '22023'; end if;
  if length(v_label) > 80 then raise exception 'label too long' using errcode = '22023'; end if;
  v_id := p_invite_id;
  if exists (select 1 from public.invites where id = v_id) then
    if exists (select 1 from public.invites where id = v_id
      and issued_by = v_actor and org_id = p_org and token_hash = p_token_hash
      and role_id = p_role_id and scope = p_scope) then return; end if;
    raise exception 'invite id already used' using errcode = '22023';
  end if;
  insert into public.invites (id, org_id, token_hash, role_id, scope, expires_at, issued_by, label, max_uses)
  values (v_id, p_org, p_token_hash, p_role_id, p_scope, p_expires_at, v_actor, v_label, p_max_uses);

  perform public._append_event_as(
    'invite:' || p_invite_id, p_org, '_org', 'v1.InviteIssued', v_actor, 'server',
    jsonb_build_object('inviteId', p_invite_id, 'roleId', p_role_id, 'scope', p_scope,
                       'expiresAt', to_char(p_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
end $$;

create or replace function public.issue_invite(
  p_org text, p_invite_id text, p_token_hash text, p_role_id text, p_scope jsonb, p_expires_at timestamptz
) returns void language sql security definer set search_path = public as $$
  select public.issue_invite_v3(p_org, p_invite_id, p_token_hash, p_role_id, p_scope, p_expires_at, null, 1);
$$;

revoke all on function public.issue_invite_v3(text,text,text,text,jsonb,timestamptz,text,int) from public, anon;
grant execute on function public.issue_invite_v3(text,text,text,text,jsonb,timestamptz,text,int) to authenticated;
revoke all on function public.issue_invite(text,text,text,text,jsonb,timestamptz) from public, anon;
grant execute on function public.issue_invite(text,text,text,text,jsonb,timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Preview: what a key means. Anyone holding the token may ask; the token is
-- 256 random bits, so holding it is the permission. Says nothing about
-- who else used it.
-- ---------------------------------------------------------------------------
create or replace function public.preview_invite(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_inv record;
  v_me text := public.caller_id();
  v_used int;
  v_project text;
  v_status text;
begin
  if p_token is null or p_token !~ '^[0-9a-fA-F]{32,128}$' then return jsonb_build_object('status', 'not_found'); end if;
  select * into v_inv from public.invites
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select count(*) into v_used from public.invite_redemptions r where r.invite_id = v_inv.id;
  v_project := v_inv.scope->>'projectId';
  v_status := case
    when v_me is not null and exists (select 1 from public.invite_redemptions r
      where r.invite_id = v_inv.id and r.profile_id = v_me) then 'joined'
    when v_used >= v_inv.max_uses then 'used'
    when v_inv.expires_at <= now() then 'expired'
    when not exists (select 1 from public.org_roles where org_id = v_inv.org_id and role_id = v_inv.role_id and not retired) then 'retired'
    else 'ok' end;
  return jsonb_build_object(
    'status', v_status,
    'orgId', v_inv.org_id,
    'orgName', (select e.payload->>'name' from public.events e
      where e.org_id = v_inv.org_id and e.project_id = '_org' and e.type = 'v1.OrgCreated' order by e.hlc desc limit 1),
    'roleName', (select r.name from public.org_roles r where r.org_id = v_inv.org_id and r.role_id = v_inv.role_id),
    'scopeLevel', v_inv.scope->>'level',
    'languageName', case when v_project is null then null else (select e.payload->>'name' from public.events e
      where e.org_id = v_inv.org_id and e.project_id = '_org' and e.type = 'v1.ProjectRegistered'
        and e.payload->>'projectId' = v_project order by e.hlc desc limit 1) end,
    'label', v_inv.label,
    'invitedBy', (select p.display_name from public.profiles p where p.id = v_inv.issued_by),
    'group', v_inv.max_uses > 1,
    'expiresAt', v_inv.expires_at
  );
end $$;
revoke all on function public.preview_invite(text) from public;
grant execute on function public.preview_invite(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Redeem. Same contract as before (returns the org; using it again returns
-- the same org), now counted per person, and a looked-after account's first
-- invite records its steward.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_invite_v2(p_token text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_actor text := public.caller_id();
  v_hash text := encode(extensions.digest(p_token, 'sha256'), 'hex');
  v_inv record;
  v_used int;
  v_suffix text;
  v_hlc text;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  select * into v_inv from public.invites where token_hash = v_hash for update;
  if not found then raise exception 'invite not found' using errcode = '22023'; end if;
  if exists (select 1 from public.invite_redemptions where invite_id = v_inv.id and profile_id = v_actor) then
    return v_inv.org_id;
  end if;
  select count(*) into v_used from public.invite_redemptions where invite_id = v_inv.id;
  if v_used >= v_inv.max_uses then raise exception 'invite already used' using errcode = '22023'; end if;
  if v_inv.expires_at <= now() then raise exception 'invite expired' using errcode = '22023'; end if;
  if not exists (select 1 from public.org_roles where org_id = v_inv.org_id and role_id = v_inv.role_id and not retired) then
    raise exception 'invite role is no longer available' using errcode = '22023';
  end if;

  insert into public.invite_redemptions (invite_id, profile_id) values (v_inv.id, v_actor);
  update public.invites set
    redeemed_by = coalesce(redeemed_by, v_actor),
    redeemed_at = coalesce(redeemed_at, now()),
    -- A one-person label names that person; it is not needed once used.
    label = case when v_used + 1 >= max_uses and max_uses = 1 then null else label end
  where id = v_inv.id;

  if public.is_managed_account(v_actor) then
    insert into public.account_stewards (profile_id, steward_id)
    values (v_actor::uuid, v_inv.issued_by::uuid) on conflict (profile_id) do nothing;
  end if;

  -- The first use keeps the ids single-use invites always had; later uses
  -- of a group invite carry the person, so each is its own event.
  v_suffix := case when v_used = 0 then '' else ':' || v_actor end;
  v_hlc := public._append_event_as(
    'invitemember:' || v_inv.id || v_suffix, v_inv.org_id, '_org', 'v1.OrgMemberAdded', 'service', 'server',
    jsonb_build_object('profileId', v_actor, 'roleId', v_inv.role_id, 'scope', v_inv.scope));
  if v_hlc is not null then
    perform public._apply_org_event(v_inv.org_id, 'v1.OrgMemberAdded',
      jsonb_build_object('profileId', v_actor, 'roleId', v_inv.role_id, 'scope', v_inv.scope), v_hlc);
  end if;
  perform public._append_event_as(
    'inviteredeem:' || v_inv.id || v_suffix, v_inv.org_id, '_org', 'v1.InviteRedeemed', 'service', 'server',
    jsonb_build_object('inviteId', v_inv.id, 'profileId', v_actor));
  return v_inv.org_id;
end $$;
revoke all on function public.redeem_invite_v2(text) from public, anon;
grant execute on function public.redeem_invite_v2(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Sign-in keys (flow F): a steward or admin makes a one-time key for a
-- looked-after person who forgot their password or has a new phone. The
-- phone makes the key and shows it as a QR; only its hash is stored. The
-- `sign-in-code` Edge Function takes it with a new password.
-- ---------------------------------------------------------------------------
create table if not exists public.sign_in_codes (
  code_hash text primary key,
  profile_id uuid not null references auth.users (id) on delete cascade,
  issued_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.sign_in_codes enable row level security;

-- Returns the person's sign-in name, for the helper to read out.
create or replace function public.issue_sign_in_code(p_profile text, p_code_hash text)
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
  insert into public.sign_in_codes (code_hash, profile_id, issued_by, expires_at)
  values (p_code_hash, p_profile::uuid, v_actor::uuid, now() + interval '1 hour');
  select u.email into v_email from auth.users u where u.id = p_profile::uuid;
  return split_part(v_email, '@', 1);
end $$;
revoke all on function public.issue_sign_in_code(text, text) from public, anon;
grant execute on function public.issue_sign_in_code(text, text) to authenticated;

-- Service role only (the Edge Function): take a key once. Returns the
-- account and its address, or nothing for a used, expired or unknown key,
-- or one whose account has since got its own email.
create or replace function public.take_sign_in_code(p_code_hash text)
returns table (profile_id uuid, email text) language plpgsql security definer set search_path = public as $$
begin
  if public.caller_id() is not null then raise exception 'service role only' using errcode = '42501'; end if;
  return query
    update public.sign_in_codes c set used_at = now()
    from auth.users u
    where c.code_hash = p_code_hash and c.used_at is null and c.expires_at > now()
      and u.id = c.profile_id and public.is_managed_email(u.email::text)
    returning c.profile_id, u.email::text;
end $$;

-- Give a key back when the password could not be set, so the person can retry.
create or replace function public.release_sign_in_code(p_code_hash text)
returns void language sql security definer set search_path = public as $$
  update public.sign_in_codes set used_at = null where code_hash = p_code_hash and public.caller_id() is null;
$$;
revoke all on function public.take_sign_in_code(text), public.release_sign_in_code(text) from public, anon, authenticated;
grant execute on function public.take_sign_in_code(text), public.release_sign_in_code(text) to service_role;
