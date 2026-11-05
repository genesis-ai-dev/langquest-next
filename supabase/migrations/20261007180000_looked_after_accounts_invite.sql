-- Whoever holds Invite may invite, whether or not their account has an email
-- of its own (decisions.md 67, replacing 54's "looked-after accounts cannot
-- invite"). The body is the baseline's without that refusal. Helping someone
-- sign in still needs an account with its own email (may_help_sign_in).

create or replace function public.issue_invite_v3(
  p_org text, p_invite_id text, p_token_hash text, p_role_id text, p_scope jsonb, p_expires_at timestamptz,
  p_label text default null, p_max_uses int default 1
) returns void language plpgsql security definer set search_path = public as $$
declare v_actor text := public.caller_id(); v_label text := nullif(btrim(coalesce(p_label, '')), '');
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if public._scope_error(p_scope) is not null then raise exception 'invalid scope' using errcode = '22023'; end if;
  if not ('invite_members' = any(public.org_privileges(p_org, v_actor, p_scope->>'languageId'))) then
    raise exception 'not allowed to invite members' using errcode = '42501';
  end if;
  if p_scope->>'level' = 'language' and not public.language_listed(p_org, p_scope->>'languageId') then
    raise exception 'unknown language' using errcode = '22023';
  end if;
  if p_expires_at <= now() then raise exception 'invite already expired' using errcode = '22023'; end if;
  if not exists (select 1 from public.org_roles r where r.org_id = p_org and r.role_id = p_role_id and not r.retired) then
    raise exception 'unknown role %', p_role_id using errcode = '22023';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' or p_expires_at > now() + interval '90 days' then
    raise exception 'invalid invite' using errcode = '22023';
  end if;
  if p_max_uses is null or p_max_uses not between 1 and 50 then raise exception 'invalid number of uses' using errcode = '22023'; end if;
  if length(v_label) > 80 then raise exception 'label too long' using errcode = '22023'; end if;
  if exists (select 1 from public.invites where id = p_invite_id) then
    if exists (select 1 from public.invites where id = p_invite_id
      and issued_by = v_actor and org_id = p_org and token_hash = p_token_hash
      and role_id = p_role_id and scope = p_scope) then return; end if;
    raise exception 'invite id already used' using errcode = '22023';
  end if;
  insert into public.invites (id, org_id, token_hash, role_id, scope, expires_at, issued_by, label, max_uses)
  values (p_invite_id, p_org, p_token_hash, p_role_id, p_scope, p_expires_at, v_actor, v_label, p_max_uses);

  perform public._append_event_as(
    'invite:' || p_invite_id, p_org, '_org', 'v1.InviteIssued', v_actor, 'server',
    jsonb_build_object('inviteId', p_invite_id, 'roleId', p_role_id, 'scope', p_scope,
                       'expiresAt', to_char(p_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
end $$;
