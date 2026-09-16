-- Invites and join requests (docs/flow-coverage-audit.md 5.B).
--
-- These are the only writes by people who are not yet members, so they live
-- outside the log, in two small tables with row level security, and enter
-- the log only when a member decides. Nothing here changes a shipped event's
-- shape: redeeming an invite and accepting a request both append the
-- existing v1.OrgMemberAdded, under the deciding member's actor id.
--
-- Appending from SQL goes through _append_org_event, which does exactly what
-- append_events does for an accepted event: bump the partition cursor, insert
-- the row, fold it into org_memberships. Authorization is checked before the
-- call (the issuer held invite_members when the invite was written), so the
-- write path stays a membership lookup, not a fold (invariant 9).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.join_requests (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  profile_id text not null,
  message text not null default '',
  created_at timestamptz not null default now(),
  unique (org_id, profile_id)
);
create index if not exists join_requests_org_idx on public.join_requests (org_id, created_at);
alter table public.join_requests enable row level security;

-- The token itself never enters the database: only its sha256 hash, so a
-- leaked backup cannot be redeemed. One use, then redeemed_by is set.
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  token_hash text not null unique,
  role_id text not null,
  scope jsonb not null default '{"level":"org"}'::jsonb,
  email text,
  expires_at timestamptz not null,
  issued_by text not null,
  created_at timestamptz not null default now(),
  redeemed_by text,
  redeemed_at timestamptz
);
create index if not exists invites_org_idx on public.invites (org_id, created_at);
-- Deny by default: the two RPCs below are the only way in or out.
alter table public.invites enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Does the caller hold invite_members anywhere in this org?
create or replace function public.may_invite(p_org text, p_profile text default null)
returns boolean language sql stable security definer set search_path = public as $$
  select 'invite_members' = any(
    public.org_privileges(p_org, coalesce(p_profile, public.caller_id()), null, null));
$$;

-- Append one event to a partition from the server, with the same effects
-- append_events has for an accepted event. Returns the assigned server_seq.
create or replace function public._append_org_event(
  p_org text, p_project text, p_type text, p_actor text, p_payload jsonb
) returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_seq bigint;
  v_hlc text := lpad(((extract(epoch from clock_timestamp()) * 1000)::bigint)::text, 15, '0')
                || ':000000:server';
  v_invalid text := public.validate_payload(p_type, p_payload);
begin
  if v_invalid is not null then
    raise exception 'invalid payload: %', v_invalid using errcode = '22023';
  end if;
  insert into public.partition_cursors (org_id, project_id) values (p_org, p_project)
    on conflict do nothing;
  update public.partition_cursors c set next_seq = c.next_seq + 1
    where c.org_id = p_org and c.project_id = p_project
    returning c.next_seq - 1 into v_seq;
  insert into public.events (id, org_id, project_id, server_seq, type, actor_id, device_id, hlc, payload)
  values (gen_random_uuid()::text, p_org, p_project, v_seq, p_type, p_actor, 'server', v_hlc, p_payload);
  perform public._apply_org_event(p_org, p_type, p_payload, v_hlc);
  return v_seq;
end $$;

-- ---------------------------------------------------------------------------
-- join_requests policies: anyone signed in may ask; members with the Invite
-- privilege may read and clear them; a requester sees and withdraws their own.
-- ---------------------------------------------------------------------------

drop policy if exists join_requests_insert_self on public.join_requests;
create policy join_requests_insert_self on public.join_requests
  for insert to authenticated with check (profile_id = public.caller_id());

drop policy if exists join_requests_select on public.join_requests;
create policy join_requests_select on public.join_requests
  for select to authenticated
  using (profile_id = public.caller_id() or public.may_invite(org_id));

drop policy if exists join_requests_delete on public.join_requests;
create policy join_requests_delete on public.join_requests
  for delete to authenticated
  using (profile_id = public.caller_id() or public.may_invite(org_id));

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Issue a single-use invite. Returns the token exactly once: it is never
-- readable again, because only its hash is stored. The QR carries orgId and
-- this token.
create or replace function public.issue_invite(
  p_org text,
  p_role_id text,
  p_scope jsonb default '{"level":"org"}'::jsonb,
  p_email text default null,
  p_ttl_hours int default 336
) returns table (invite_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := public.caller_id();
  v_token text;
  v_scope_error text := public._scope_error(p_scope);
begin
  if v_actor is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not public.may_invite(p_org, v_actor) then
    raise exception 'invite_members required' using errcode = '42501';
  end if;
  if v_scope_error is not null then raise exception '%', v_scope_error using errcode = '22023'; end if;
  if not exists (select 1 from public.org_roles r
                 where r.org_id = p_org and r.role_id = p_role_id and not r.retired) then
    raise exception 'unknown role %', p_role_id using errcode = '22023';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  return query
    insert into public.invites (org_id, token_hash, role_id, scope, email, expires_at, issued_by)
    values (p_org, encode(extensions.digest(v_token, 'sha256'), 'hex'), p_role_id, p_scope,
            nullif(lower(trim(p_email)), ''),
            now() + make_interval(hours => greatest(1, least(p_ttl_hours, 24 * 90))), v_actor)
    returning invites.id, v_token, invites.expires_at;
end $$;

-- Redeem one, as the person joining. Appends v1.OrgMemberAdded under the
-- issuer's actor id (they are the one who held invite_members), which is the
-- same event an admin would have appended by hand.
create or replace function public.redeem_invite(p_token text)
returns table (org_id text, role_id text, scope jsonb)
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := public.caller_id();
  v_invite public.invites;
  v_name text;
begin
  if v_actor is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_invite from public.invites i
    where i.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    for update;
  if not found then raise exception 'invite not found' using errcode = '22023'; end if;
  if v_invite.redeemed_by is not null and v_invite.redeemed_by <> v_actor then
    raise exception 'invite already used' using errcode = '22023';
  end if;
  if v_invite.expires_at < now() then raise exception 'invite expired' using errcode = '22023'; end if;

  select split_part(u.email, '@', 1) into v_name from auth.users u where u.id::text = v_actor;

  if v_invite.redeemed_by is null then
    perform public._append_org_event(
      v_invite.org_id, '_org', 'v1.OrgMemberAdded', v_invite.issued_by,
      jsonb_strip_nulls(jsonb_build_object(
        'profileId', v_actor, 'roleId', v_invite.role_id,
        'scope', v_invite.scope, 'displayName', v_name)));
    update public.invites i set redeemed_by = v_actor, redeemed_at = now() where i.id = v_invite.id;
    delete from public.join_requests j where j.org_id = v_invite.org_id and j.profile_id = v_actor;
  end if;

  org_id := v_invite.org_id; role_id := v_invite.role_id; scope := v_invite.scope;
  return next;
end $$;

-- Accept a join request: the same OrgMemberAdded, under the accepting
-- member's actor id. Declining is deleting the row (the RLS policy above).
create or replace function public.accept_join_request(
  p_id uuid, p_role_id text, p_scope jsonb default '{"level":"org"}'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor text := public.caller_id();
  v_req public.join_requests;
  v_name text;
begin
  if v_actor is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_req from public.join_requests j where j.id = p_id for update;
  if not found then raise exception 'request not found' using errcode = '22023'; end if;
  if not public.may_invite(v_req.org_id, v_actor) then
    raise exception 'invite_members required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.org_roles r
                 where r.org_id = v_req.org_id and r.role_id = p_role_id and not r.retired) then
    raise exception 'unknown role %', p_role_id using errcode = '22023';
  end if;

  select split_part(u.email, '@', 1) into v_name from auth.users u where u.id::text = v_req.profile_id;
  perform public._append_org_event(
    v_req.org_id, '_org', 'v1.OrgMemberAdded', v_actor,
    jsonb_strip_nulls(jsonb_build_object(
      'profileId', v_req.profile_id, 'roleId', p_role_id,
      'scope', p_scope, 'displayName', v_name)));
  delete from public.join_requests j where j.id = p_id;
end $$;

-- Who is in the org, with the email the admin invited, so the members list
-- shows people rather than uuids. Members only.
create or replace function public.org_member_emails(p_org text)
returns table (profile_id text, email text)
language plpgsql security definer set search_path = public as $$
begin
  if public.caller_id() is null
     or cardinality(public.org_privileges(p_org, public.caller_id(), null, null)) = 0 then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return query
    select m.profile_id, u.email::text
    from public.org_memberships m
    left join auth.users u on u.id::text = m.profile_id
    where m.org_id = p_org and not m.removed;
end $$;

grant execute on function public.issue_invite(text, text, jsonb, text, int) to authenticated;
grant execute on function public.redeem_invite(text) to authenticated;
grant execute on function public.accept_join_request(uuid, text, jsonb) to authenticated;
grant execute on function public.org_member_emails(text) to authenticated;
grant execute on function public.may_invite(text, text) to authenticated;
grant select, insert, delete on public.join_requests to authenticated;
