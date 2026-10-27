-- Global Viewers: a few LangQuest people who may read every organization,
-- as a Viewer would, and change nothing (decisions.md 158,
-- docs/global-viewers.md). Only on a session verified with an authenticator
-- code (aal2). Nothing is written to any organization's log: who is a Global
-- Viewer is the server's own state, like a suspension.
--
-- `scripts/global-viewer.ts` grants, revokes and resets them; nothing in the
-- app can. A Global Viewer may also belong to organizations, where their own
-- role applies. Writes still go through `may_emit`, which never asks whether
-- someone is a Global Viewer.

create table public.global_viewers (
  -- Deleting the account (decision 46) deletes the row.
  profile_id uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by text not null check (length(granted_by) between 1 and 200),
  note text not null check (length(note) between 1 and 500),
  -- Kept once revoked, so the account stays known as a Global Viewer account.
  revoked_at timestamptz,
  revoked_by text check (revoked_by is null or length(revoked_by) between 1 and 200),
  check ((revoked_at is null) = (revoked_by is null))
);

alter table public.global_viewers enable row level security;
revoke all on table public.global_viewers from public, anon, authenticated;
grant all on table public.global_viewers to service_role;

-- The assurance level of the request acting for p_profile: the token's
-- `aal` when p_profile is the caller, otherwise unknown (null). A service
-- role caller that knows it (the Worker, from the token it verified) passes
-- it to the function it calls instead.
create or replace function public._request_aal(p_profile text)
returns text language sql stable set search_path = '' as $$
  select case when p_profile is not null and p_profile = public.caller_id()
    then nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal' end;
$$;

-- An account that is a Global Viewer: granted and not revoked. A revoked one
-- is an ordinary account again.
create or replace function public._is_gv_account(p_profile text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.global_viewers g where g.profile_id::text = p_profile and g.revoked_at is null);
$$;

-- A Global Viewer whose access is on: granted, not revoked, and on an aal2 session.
create or replace function public._gv_on(p_profile text, p_aal text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(p_aal = 'aal2', false) and exists (
    select 1 from public.global_viewers g where g.profile_id::text = p_profile and g.revoked_at is null);
$$;

-- The caller's Global Viewer access, for the app (get_user_state). Null for
-- an account that never was one.
create or replace function public._gv_state(p_profile text)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when g.profile_id is null then null
    when g.revoked_at is not null then 'revoked'
    when not exists (select 1 from auth.mfa_factors f where f.user_id = g.profile_id and f.status = 'verified') then 'needs_setup'
    when not public._gv_on(p_profile, public._request_aal(p_profile)) then 'needs_code'
    else 'on'
  end
  from (select 1) one
  left join public.global_viewers g on g.profile_id::text = p_profile;
$$;

-- Who may read a stream, at a known assurance level. can_read_stream is
-- this at the caller's own level; blob_access passes the Worker's.
create or replace function public._can_read_stream_at(p_org text, p_stream text, p_profile text, p_aal text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_org = '_person' then p_stream = p_profile
    when public._gv_on(p_profile, p_aal) then true
    when p_stream = '_org' then exists (
      select 1 from public.org_memberships m
      where m.org_id = p_org and m.profile_id = p_profile and not m.removed)
    else cardinality(public.org_privileges(p_org, p_profile, p_stream)) > 0
  end;
$$;

create or replace function public.can_read_stream(p_org text, p_stream text, p_profile text)
returns boolean language sql stable security definer set search_path = public as $$
  select public._can_read_stream_at(p_org, p_stream, p_profile, public._request_aal(p_profile));
$$;

-- The Worker asks for files with the service role, so it says the token's
-- level (p_aal). Left out, a Global Viewer is refused: a path that forgets
-- it keeps them out rather than letting them in. Writing is unchanged, and
-- a Global Viewer holds no privilege to write with.
drop function public.blob_access(text, text, boolean);
create or replace function public.blob_access(p_name text, p_profile text, p_write boolean, p_aal text default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(p_profile, '') <> '' and case
    when not p_write then
      public._can_read_stream_at(k.org, k.stream, p_profile, coalesce(p_aal, public._request_aal(p_profile)))
      or public._library_media_readable(p_name, p_profile)
    when k.org = '_person' then false
    when k.stream = '_org' then
      public.org_privileges(k.org, p_profile, null) && array['manage_templates', 'manage_flows', 'manage_reference', 'manage_structure']
    else
      public.language_listed(k.org, k.stream)
      and exists (select 1 from unnest(public.org_privileges(k.org, p_profile, k.stream)) p where p <> 'view_status')
  end
  from (select split_part(p_name, '/', 1) as org, split_part(p_name, '/', 2) as stream) k;
$$;

-- Every organization, for a Global Viewer whose access is on: its name and
-- its languages' names, matching the query in either, in pages by name.
create or replace function public.global_viewer_organizations(
  p_query text default '', p_after_name text default null, p_after_org text default null, p_limit int default 50
) returns table (org_id text, name text, languages text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public._gv_on(public.caller_id(), public._request_aal(public.caller_id())) then
    raise exception 'Global Viewer access is off' using errcode = '42501';
  end if;
  return query
    with q as (select lower(btrim(coalesce(p_query, ''))) as q),
    orgs as (
      select c.org_id, coalesce(public.org_name(c.org_id), c.org_id) as name,
        coalesce((select array_agg(l.name order by l.name) from public.public_languages l where l.org_id = c.org_id), '{}') as languages
      from public.stream_cursors c
      where c.stream_id = '_org'
    )
    select o.org_id, o.name, o.languages from orgs o, q
    where (q.q = '' or strpos(lower(o.name), q.q) > 0 or exists (select 1 from unnest(o.languages) n where strpos(lower(n), q.q) > 0))
      and (p_after_name is null or (o.name, o.org_id) > (p_after_name, coalesce(p_after_org, '')))
    order by o.name, o.org_id
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

-- The names of an organization's members, for a Global Viewer whose access
-- is on (members get theirs from my_directory).
create or replace function public.global_viewer_directory(p_org text)
returns table (id text, display_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public._gv_on(public.caller_id(), public._request_aal(public.caller_id())) then
    raise exception 'Global Viewer access is off' using errcode = '42501';
  end if;
  return query
    select p.id, p.display_name from public.profiles p
    where exists (select 1 from public.org_memberships m where m.org_id = p_org and m.profile_id = p.id and not m.removed)
       or exists (select 1 from public.join_requests r where r.org_id = p_org and r.profile_id = p.id);
end $$;

-- A Global Viewer whose access is on sees the names of every organization's
-- members, as its members do.
create or replace function public.profile_visible(p_profile text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.caller_id() is not null and (
    p_profile = public.caller_id() or exists (
      select 1 from public.org_memberships me
      join public.org_memberships other on other.org_id = me.org_id
      where me.profile_id = public.caller_id() and not me.removed
        and other.profile_id = p_profile and not other.removed
    ) or exists (
      select 1 from public.join_requests r
      where r.profile_id = p_profile
        and 'invite_members' = any(public.org_privileges(r.org_id, public.caller_id(), null))
    ) or (
      public._gv_on(public.caller_id(), public._request_aal(public.caller_id()))
      and (exists (select 1 from public.org_memberships o where o.profile_id = p_profile and not o.removed)
           or exists (select 1 from public.join_requests r where r.profile_id = p_profile))
    )
  );
$$;

create or replace function public.get_user_state()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'termsVersion', (select payload->>'version' from public.events
      where org_id = '_person' and stream_id = public.caller_id()
        and type = 'v1.TermsAccepted' order by server_seq desc limit 1),
    'visionSeen', exists(select 1 from public.events where org_id = '_person'
      and stream_id = public.caller_id() and type = 'v1.VisionSeen'),
    'walkthroughDone', exists(select 1 from public.events where org_id = '_person'
      and stream_id = public.caller_id() and type = 'v1.WalkthroughDone'),
    'globalViewer', public._gv_state(public.caller_id()));
$$;

-- Nobody signs a Global Viewer in for them. (A Global Viewer is never a
-- looked-after account either; `grant` refuses one.)
create or replace function public.may_help_sign_in(p_helper text, p_profile text)
returns boolean language sql stable security definer set search_path = public as $$
  with theirs as (
    select m.org_id, m.language_id, m.role_id from public.org_memberships m
    where m.profile_id = p_profile and not m.removed and public._joined_by_consent(m.org_id, p_profile)
  )
  select p_helper is not null and p_helper <> p_profile
    and public.is_managed_account(p_profile)
    and not public.is_managed_account(p_helper)
    and not public._is_gv_account(p_profile)
    and exists (select 1 from theirs)
    and not exists (
      select 1 from theirs t
      where not ('invite_members' = any(public.org_privileges(t.org_id, p_helper, t.language_id))
        and coalesce(public._live_role_privileges(t.org_id, t.role_id), '{}') <@ public.org_privileges(t.org_id, p_helper, t.language_id))
    );
$$;

-- ---- for scripts/global-viewer.ts (service role only) -------------------
-- Each answers in words for the operator. The setup is done on a call with
-- the person (docs/global-viewers.md): emails are on any domain and sign-up
-- proves nothing about owning one, so what counts is that the person signs in
-- on the call and sets up an authenticator while the operator watches
-- `list`. `grant` therefore takes an account with no authenticator, new or
-- old; granting a revoked one again clears its old authenticators and
-- sign-ins first, so nothing from before is trusted.

create or replace function public.global_viewer_grant(p_email text, p_by text, p_note text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_user auth.users%rowtype; v_before public.global_viewers%rowtype;
begin
  if public.caller_id() is not null then raise exception 'service role only' using errcode = '42501'; end if;
  if coalesce(btrim(p_note), '') = '' then return 'Say who asked for it and why (--note).'; end if;
  if length(p_note) > 200 then return 'The note is longer than 200 characters.'; end if;
  if coalesce(btrim(p_by), '') = '' then return 'Say who is granting it.'; end if;
  select * into v_user from auth.users u where lower(u.email) = lower(btrim(p_email));
  if not found then return 'No account has that email. The person signs up in the app first.'; end if;
  select * into v_before from public.global_viewers g where g.profile_id = v_user.id;
  if found and v_before.revoked_at is null then return 'That account is already a Global Viewer.'; end if;
  if public.is_managed_account(v_user.id::text) then return 'That is a looked-after account. A Global Viewer signs in with an email.'; end if;
  if v_user.banned_until is not null and v_user.banned_until > now() then return 'That account is suspended.'; end if;
  if v_before.profile_id is not null then
    -- Granted again after a revoke: nothing from before is trusted.
    delete from auth.mfa_factors f where f.user_id = v_user.id;
    delete from auth.sessions s where s.user_id = v_user.id;
    update public.global_viewers set granted_at = now(), granted_by = btrim(p_by), revoked_at = null, revoked_by = null,
      note = left(btrim(p_note) || ' (before: granted ' || to_char(v_before.granted_at, 'YYYY-MM-DD') || ' by ' || v_before.granted_by
        || ', revoked ' || to_char(v_before.revoked_at, 'YYYY-MM-DD') || ' by ' || v_before.revoked_by || '; ' || v_before.note || ')', 500)
    where profile_id = v_user.id;
    return 'granted';
  end if;
  if exists (select 1 from auth.mfa_factors f where f.user_id = v_user.id) then
    return 'That account already has an authenticator. Someone may have set one up ahead of the person: do not grant it.';
  end if;
  insert into public.global_viewers (profile_id, granted_by, note) values (v_user.id, btrim(p_by), btrim(p_note));
  return 'granted';
end $$;

-- Ends access at once, and every sign-in of the account at its next request.
create or replace function public.global_viewer_revoke(p_email text, p_by text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if public.caller_id() is not null then raise exception 'service role only' using errcode = '42501'; end if;
  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_id is null then return 'No account has that email.'; end if;
  update public.global_viewers set revoked_at = now(), revoked_by = btrim(p_by)
   where profile_id = v_id and revoked_at is null;
  if not found then
    return case when exists (select 1 from public.global_viewers g where g.profile_id = v_id)
      then 'Already revoked.' else 'That account is not a Global Viewer.' end;
  end if;
  delete from auth.sessions s where s.user_id = v_id;
  return 'revoked';
end $$;

-- A lost authenticator: removes every factor and sign-in, so the person sets
-- up a new one on a call. Check who they are first, not by email.
create or replace function public.global_viewer_reset_mfa(p_email text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if public.caller_id() is not null then raise exception 'service role only' using errcode = '42501'; end if;
  select g.profile_id into v_id from public.global_viewers g join auth.users u on u.id = g.profile_id
   where lower(u.email) = lower(btrim(p_email)) and g.revoked_at is null;
  if v_id is null then return 'No Global Viewer has that email.'; end if;
  delete from auth.mfa_factors f where f.user_id = v_id;
  delete from auth.sessions s where s.user_id = v_id;
  return 'reset';
end $$;

create or replace function public.global_viewer_list()
returns table (
  email text, display_name text, granted_at timestamptz, granted_by text, note text,
  revoked_at timestamptz, revoked_by text, authenticators int, authenticator_verified_at timestamptz,
  last_sign_in_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
  if public.caller_id() is not null then raise exception 'service role only' using errcode = '42501'; end if;
  return query
    select u.email::text, p.display_name, g.granted_at, g.granted_by, g.note, g.revoked_at, g.revoked_by,
      (select count(*)::int from auth.mfa_factors f where f.user_id = g.profile_id and f.status = 'verified'),
      (select max(f.updated_at) from auth.mfa_factors f where f.user_id = g.profile_id and f.status = 'verified'),
      u.last_sign_in_at
    from public.global_viewers g
    join auth.users u on u.id = g.profile_id
    left join public.profiles p on p.id = g.profile_id::text
    order by g.revoked_at nulls first, g.granted_at;
end $$;

-- Grants: the helpers are internal; the two lists and get_user_state check the caller themselves.
revoke all on function public._request_aal(text) from public, anon, authenticated;
revoke all on function public._is_gv_account(text) from public, anon, authenticated;
revoke all on function public._gv_on(text, text) from public, anon, authenticated;
revoke all on function public._gv_state(text) from public, anon, authenticated;
revoke all on function public._can_read_stream_at(text, text, text, text) from public, anon, authenticated;
grant execute on function public._request_aal(text) to service_role;
grant execute on function public._is_gv_account(text) to service_role;
grant execute on function public._gv_on(text, text) to service_role;
grant execute on function public._gv_state(text) to service_role;
grant execute on function public._can_read_stream_at(text, text, text, text) to service_role;
revoke all on function public.blob_access(text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.blob_access(text, text, boolean, text) to service_role;
revoke all on function public.global_viewer_organizations(text, text, text, int) from public, anon;
revoke all on function public.global_viewer_directory(text) from public, anon;
grant execute on function public.global_viewer_organizations(text, text, text, int) to authenticated, service_role;
grant execute on function public.global_viewer_directory(text) to authenticated, service_role;
revoke all on function public.global_viewer_grant(text, text, text) from public, anon, authenticated;
revoke all on function public.global_viewer_revoke(text, text) from public, anon, authenticated;
revoke all on function public.global_viewer_reset_mfa(text) from public, anon, authenticated;
revoke all on function public.global_viewer_list() from public, anon, authenticated;
grant execute on function public.global_viewer_grant(text, text, text) to service_role;
grant execute on function public.global_viewer_revoke(text, text) to service_role;
grant execute on function public.global_viewer_reset_mfa(text) to service_role;
grant execute on function public.global_viewer_list() to service_role;
