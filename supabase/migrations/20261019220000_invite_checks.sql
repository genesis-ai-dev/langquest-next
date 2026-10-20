-- An invite to a language may put whoever joins with it on some of that
-- language's checks (decisions.md 146): New language, and Invite, ask which
-- checks a code's people will do, and joining puts them there. A check's
-- people are its team's members (`check:<kindId>`, decision 91), so redeeming
-- appends `v1.ReviewTeamMemberSet` to the language's stream as the server,
-- as it appends `v1.MemberAdded` to the organization's. The inviter's phone
-- names each check's team before the code is made (core `checkTeamSpecs`).

alter table public.invites add column if not exists checks text[] not null default '{}';

-- issue_invite_v3, with the checks. Choosing who does a check is managing
-- teams in that language, and only a role that reviews can do one.
create or replace function public.issue_invite_v4(
  p_org text, p_invite_id text, p_token_hash text, p_role_id text, p_scope jsonb, p_expires_at timestamptz,
  p_label text default null, p_max_uses int default 1, p_checks text[] default '{}'
) returns void language plpgsql security definer set search_path = public as $$
declare v_actor text := public.caller_id(); v_checks text[] := coalesce(p_checks, '{}');
begin
  if cardinality(v_checks) > 0 then
    if p_scope->>'level' is distinct from 'language' then
      raise exception 'checks need an invite to one language' using errcode = '22023';
    end if;
    if cardinality(v_checks) > 20 or exists (select 1 from unnest(v_checks) c where c !~ '^[A-Za-z0-9_.:-]{1,80}$') then
      raise exception 'invalid checks' using errcode = '22023';
    end if;
    if v_actor is null or not ('manage_teams' = any(public.org_privileges(p_org, v_actor, p_scope->>'languageId'))) then
      raise exception 'not allowed to choose who does a check' using errcode = '42501';
    end if;
    if not ('review' = any(coalesce(public._live_role_privileges(p_org, p_role_id), '{}'))) then
      raise exception 'that role does not do checks' using errcode = '22023';
    end if;
  end if;
  perform public.issue_invite_v3(p_org, p_invite_id, p_token_hash, p_role_id, p_scope, p_expires_at, p_label, p_max_uses);
  -- The same invite issued again (a retry) has the checks it was first issued with.
  update public.invites set checks = v_checks where id = p_invite_id and issued_by = v_actor and checks = '{}';
end $$;

revoke all on function public.issue_invite_v4 from public, anon;
grant execute on function public.issue_invite_v4 to authenticated, service_role;

-- redeem_invite_for (20261009130000) with the checks: whoever joins is put on
-- each, while whoever made the code may still choose who does checks there.
create or replace function public.redeem_invite_for(p_actor text, p_token text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_hash text := encode(extensions.digest(p_token, 'sha256'), 'hex');
  v_inv record;
  v_used int;
  v_suffix text;
  v_check text;
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
  -- The words the app already reads as a dead invite (heldInvite.ts outcomeOfError).
  if not public._invite_still_granted(v_inv.org_id, v_inv.issued_by, v_inv.role_id, v_inv.scope) then
    raise exception 'invite role is no longer available from whoever sent it' using errcode = '22023';
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

  -- The first use keeps the plain ids; later uses of a group invite carry
  -- the person, so each is its own event.
  v_suffix := case when v_used = 0 then '' else ':' || p_actor end;
  perform public._append_event_as(
    'invitemember:' || v_inv.id || v_suffix, v_inv.org_id, '_org', 'v1.MemberAdded', 'service', 'server',
    jsonb_build_object('profileId', p_actor, 'roleId', v_inv.role_id, 'scope', v_inv.scope));
  perform public._append_event_as(
    'inviteredeem:' || v_inv.id || v_suffix, v_inv.org_id, '_org', 'v1.InviteRedeemed', 'service', 'server',
    jsonb_build_object('inviteId', v_inv.id, 'profileId', p_actor));

  -- Its checks, in the language it is for (after the membership, so the
  -- person is the language's before its stream names them).
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
