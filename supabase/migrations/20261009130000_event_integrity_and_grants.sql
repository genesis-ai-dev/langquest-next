-- Who may put what in the log, after the 2026-10-09 audit (decisions.md 75).
--
-- 1. Nobody is added to an organization without saying yes. A person's
--    v1.MemberAdded may name only themselves or someone who already joined
--    it (an invite redeemed, a request admitted, or their own creation);
--    newcomers come in by invite or join request, whose memberships are the
--    server's. Helping someone sign in also asks that they joined each
--    organization themselves, and that the helper could grant them every
--    role they hold, everywhere: a sign-in code is the whole account.
-- 2. A grantor grants only what they hold. A role given, invited to or
--    admitted to must carry no privilege the grantor lacks at that scope; a
--    role changed or removed must be one they could have granted; a role
--    defined or retired likewise. An invite redeems only while its issuer
--    could still grant it.
-- 3. One id, one event. A resend of an event is a duplicate; the same id on
--    any other event is refused, and ids the server issues (invite:,
--    removed:, accountdeleted:, ...) are refused from people, so nobody can
--    claim an id the server will use and make its event vanish.
-- 4. One create, one entity. A take, recording, response, review, note,
--    request, departure, rendering or adjustment id is used by one event in
--    its stream; a second one is refused, so nobody can swap the audio
--    under an approved version or replace someone's review with a
--    backdated one. Core's fold keeps the earliest in any order.
-- 5. An organization is bootstrapped only while nobody else has written to
--    it, so an id the server seeded (the library, an import) cannot be
--    claimed.
-- 6. Review links shared with a token close with the token (token_id).
-- 7. A redaction is never redacted. One aimed at another v1.Redacted is
--    refused; core's fold ignores any already in the log, since which
--    redaction stood would otherwise depend on arrival order.

-- ---- what a create-once event creates ---------------------------------------------

-- The entity a creating event names, as kind:id, or null for every other
-- event. core `entityKeyOf` (validate.ts) is the same; the parity script
-- holds them together. The translation guide's material and key terms are
-- left out: two phones define them under the same id by design.
create or replace function public._entity_key(p_type text, p jsonb)
returns text language sql immutable as $$
  select case p_type
    when 'v1.RecordingAdded' then 'recording:' || (p->>'recordingId')
    when 'v1.TakeComposed' then 'take:' || (p->>'takeId')
    when 'v1.ResponseRecorded' then 'response:' || (p->>'takeId')
    when 'v1.ReviewRecorded' then 'review:' || (p->>'reviewId')
    when 'v1.DepartureRecorded' then 'departure:' || (p->>'departureId')
    when 'v1.RequestMade' then 'request:' || (p->>'requestId')
    when 'v1.NoteAdded' then 'note:' || (p->>'noteId')
    when 'v1.KeyTermRenderingAdded' then 'rendering:' || (p->>'termId') || '/' || (p->>'renderingId')
    when 'v1.KeyTermAdjusted' then 'adjustment:' || (p->>'termId') || '/' || (p->>'adjustmentId')
  end;
$$;

create index if not exists events_entity_idx on public.events (org_id, stream_id, public._entity_key(type, payload))
  where public._entity_key(type, payload) is not null;

-- Ids the server and its tools issue. A person may not use one.
create or replace function public._server_event_id(p_id text)
returns boolean language sql immutable as $$
  select p_id ~ '^(invite|invitemember|inviteredeem|joindecided|joinmember|removed|accountdeleted|blob|blobinvalid|pin|seed|timings|v2):'
    or p_id like 'api-%';
$$;

-- Hold a stream's cursor for the rest of the transaction, so the entity
-- check and the append see the same stream (_next_seq then takes it again).
create or replace function public._lock_stream(p_org text, p_stream text)
returns void language plpgsql set search_path = public as $$
begin
  insert into public.stream_cursors (org_id, stream_id) values (p_org, p_stream) on conflict do nothing;
  perform 1 from public.stream_cursors c where c.org_id = p_org and c.stream_id = p_stream for update;
end $$;

-- ---- grants ---------------------------------------------------------------------------

-- The privileges of a live role, or null for a role that is unknown or retired.
create or replace function public._live_role_privileges(p_org text, p_role text)
returns text[] language sql stable security definer set search_path = '' as $$
  select r.privileges from public.org_roles r where r.org_id = p_org and r.role_id = p_role and not r.retired;
$$;

-- What someone holds at exactly one scope now: their role's privileges
-- ('{}' for a role that is retired or unknown), or null with no membership there.
create or replace function public._held_at(p_org text, p_profile text, p_scope_key text)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(public._live_role_privileges(m.org_id, m.role_id), '{}')
  from public.org_memberships m
  where m.org_id = p_org and m.profile_id = p_profile and m.scope_key = p_scope_key and not m.removed;
$$;

-- Why this person may not make this grant, or null when they may. Asked
-- after may_emit, so they already hold the event's privilege at its scope.
-- core mayGrantRole and mayChangeMembership.
create or replace function public._grant_refusal(p_org text, p_actor text, p_type text, p jsonb)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_mine text[] := public.org_privileges(p_org, p_actor, public.language_of_org_event(p_type, p));
  v_role text[];
  v_held text[];
begin
  if p_type in ('v1.MemberAdded', 'v1.InviteIssued') then
    v_role := public._live_role_privileges(p_org, p->>'roleId');
    if v_role is null then return format('there is no role %s', p->>'roleId'); end if;
    if not v_role <@ v_mine then return 'you may only grant a role whose privileges you hold'; end if;
  end if;
  if p_type in ('v1.MemberAdded', 'v1.MemberRemoved') then
    v_held := public._held_at(p_org, p->>'profileId', public._scope_key(p->'scope'));
    if v_held is not null and not v_held <@ v_mine then return 'they hold more there than you do'; end if;
  end if;
  if p_type = 'v1.MemberAdded' and p->>'profileId' <> p_actor and not exists (
    select 1 from public.org_memberships m
    where m.org_id = p_org and m.profile_id = p->>'profileId' and m.role_event <> '') then
    return 'they have not joined this organization; invite them';
  end if;
  if p_type in ('v1.RoleDefined', 'v1.RoleRetired') then
    v_held := public._live_role_privileges(p_org, p->>'roleId');
    if v_held is not null and not v_held <@ v_mine then return 'that role holds more than you do'; end if;
    if p_type = 'v1.RoleDefined' and not array(select jsonb_array_elements_text(p->'privileges')) <@ v_mine then
      return 'you may only give a role privileges you hold';
    end if;
  end if;
  return null;
end $$;

-- Did this person join this organization themselves: redeem an invite to
-- it, have a request admitted, or create it?
create or replace function public._joined_by_consent(p_org text, p_profile text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.events e
    where e.org_id = p_org and e.stream_id = '_org'
      and e.type in ('v1.InviteRedeemed', 'v1.JoinDecided', 'v1.MemberAdded')
      and e.payload->>'profileId' = p_profile
      and case e.type
        when 'v1.InviteRedeemed' then true
        when 'v1.JoinDecided' then e.payload->'accepted' = 'true'::jsonb
        else e.actor_id = p_profile
      end);
$$;

-- ---- append_events --------------------------------------------------------------------
-- The baseline's, with the checks above: the id rules before authorization,
-- the bootstrap rule narrowed, the grant rules after the payload's shape,
-- and the entity rule under the stream's lock.

create or replace function public.append_events(p_events jsonb, p_client_version int default 0)
returns table (id text, accepted boolean, server_seq bigint, reason text)
language plpgsql security definer set search_path = public as $$
declare
  ev jsonb;
  v_actor text := public.caller_id();
  v_org text; v_stream text; v_type text; v_id text; v_hlc text;
  v_seq bigint; v_invalid text; v_key text;
  v_prior public.events;
  v_now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_wall_ms bigint;
  v_tolerance bigint;
  v_ok boolean;
  v_bootstrap boolean;
begin
  perform public.require_client_version(p_client_version);
  select clock_ahead_tolerance_ms into v_tolerance from public.server_config;
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events must be a jsonb array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) > 500 then
    raise exception 'batch too large: % events (max 500); page the push', jsonb_array_length(p_events) using errcode = '22023';
  end if;

  for ev in select * from jsonb_array_elements(p_events) loop
    v_id := ev->>'id'; v_org := ev->>'orgId'; v_stream := ev->>'streamId'; v_type := ev->>'type'; v_hlc := ev->>'hlc';

    if not (public._is_str(ev->'id') and public._is_str(ev->'orgId') and public._is_str(ev->'streamId')
            and public._is_str(ev->'type') and public._is_str(ev->'hlc') and public._is_str(ev->'deviceId')
            and public._is_str(ev->'actorId')) or ev->'payload' is null then
      id := v_id; accepted := false; server_seq := null; reason := 'malformed envelope';
      return next; continue;
    end if;

    if v_actor is not null and ev->>'actorId' <> v_actor then
      id := v_id; accepted := false; server_seq := null; reason := 'actorId does not match caller';
      return next; continue;
    end if;

    -- One id, one event: the same event again is a duplicate; the id on
    -- anything else is refused, never answered as if it were this one.
    select * into v_prior from public.events e where e.id = v_id;
    if found then
      if v_prior.org_id = v_org and v_prior.stream_id = v_stream and v_prior.actor_id = ev->>'actorId' and v_prior.type = v_type then
        id := v_id; accepted := true; server_seq := v_prior.server_seq; reason := 'duplicate';
      else
        id := v_id; accepted := false; server_seq := null; reason := 'malformed envelope: event id already used';
      end if;
      return next; continue;
    end if;
    if v_actor is not null and public._server_event_id(v_id) then
      id := v_id; accepted := false; server_seq := null; reason := 'malformed envelope: event id reserved for the server';
      return next; continue;
    end if;

    v_wall_ms := nullif(regexp_replace(split_part(v_hlc, ':', 1), '\D', '', 'g'), '')::bigint;
    if v_wall_ms is null then
      id := v_id; accepted := false; server_seq := null; reason := 'malformed envelope';
      return next; continue;
    end if;
    if v_wall_ms > v_now_ms + v_tolerance then
      id := v_id; accepted := false; server_seq := null;
      reason := format('clock ahead: server time %s', v_now_ms);
      return next; continue;
    end if;

    -- A person's stream is written only by record_user_event.
    if v_org = '_person' then
      id := v_id; accepted := false; server_seq := null; reason := format('may not emit %s here', v_type);
      return next; continue;
    end if;

    v_ok := public.may_emit(v_org, v_stream, ev->>'actorId', v_type, ev->'payload');
    v_bootstrap := false;
    if not v_ok and v_stream = '_org' then
      -- The organization's creation: until anyone is a member, and while
      -- nobody else has written to it, its creator may create it, define
      -- its roles and make themselves its first member.
      v_ok := not exists (select 1 from public.org_memberships m where m.org_id = v_org)
        and not exists (select 1 from public.events e where e.org_id = v_org and e.stream_id = '_org' and e.actor_id <> ev->>'actorId')
        and (v_type in ('v1.OrgCreated', 'v1.RoleDefined')
          or (v_type = 'v1.MemberAdded' and ev->'payload'->>'profileId' = ev->>'actorId'
              and ev->'payload'->'scope'->>'level' = 'org'));
      v_bootstrap := v_ok;
    end if;
    if not v_ok then
      id := v_id; accepted := false; server_seq := null;
      reason := case
        when not public.can_read_stream(v_org, v_stream, ev->>'actorId') then 'not a member'
        else format('may not emit %s', v_type)
      end;
      return next; continue;
    end if;

    -- A language stream exists once the organization lists the language. A
    -- phone may push a new language's events before the organization's
    -- (two streams, two outboxes); it retries them (NOT_LISTED).
    if v_stream <> '_org' and not public.language_listed(v_org, v_stream) then
      id := v_id; accepted := false; server_seq := null; reason := 'language not listed yet';
      return next; continue;
    end if;

    v_invalid := public.validate_payload(v_type, ev->'payload');
    if v_invalid is not null then
      id := v_id; accepted := false; server_seq := null; reason := 'invalid payload: ' || v_invalid;
      return next; continue;
    end if;

    -- A redaction is never redacted (rule 7).
    if v_type = 'v1.Redacted' and exists (select 1 from public.events e
         where e.id = ev->'payload'->>'eventId' and e.type = 'v1.Redacted') then
      id := v_id; accepted := false; server_seq := null; reason := 'invalid payload: a redaction cannot be redacted';
      return next; continue;
    end if;

    -- Nobody grants more than they hold (the workers, as the service role, import and seed).
    if v_actor is not null and v_stream = '_org' and not v_bootstrap then
      v_invalid := public._grant_refusal(v_org, v_actor, v_type, ev->'payload');
      if v_invalid is not null then
        id := v_id; accepted := false; server_seq := null; reason := format('may not emit %s: %s', v_type, v_invalid);
        return next; continue;
      end if;
    end if;

    -- One create, one entity, checked under the stream's lock.
    v_key := public._entity_key(v_type, ev->'payload');
    if v_key is not null then
      perform public._lock_stream(v_org, v_stream);
      if exists (select 1 from public.events e
                 where e.org_id = v_org and e.stream_id = v_stream and public._entity_key(e.type, e.payload) = v_key) then
        id := v_id; accepted := false; server_seq := null;
        reason := format('invalid payload: %s id %s is already used', split_part(v_key, ':', 1), substr(v_key, length(split_part(v_key, ':', 1)) + 2));
        return next; continue;
      end if;
    end if;

    v_seq := public._next_seq(v_org, v_stream);
    insert into public.events (id, org_id, stream_id, server_seq, type, actor_id, device_id,
                               hlc, parent_event_id, payload)
    values (v_id, v_org, v_stream, v_seq, v_type, ev->>'actorId', ev->>'deviceId',
            v_hlc, ev->>'parentEventId', ev->'payload');

    if v_stream = '_org' then
      perform public._apply_org_event(v_org, v_id, v_type, ev->'payload', v_hlc, ev->>'actorId');
    end if;

    id := v_id; accepted := true; server_seq := v_seq; reason := null;
    return next;
  end loop;
end $$;

-- ---- helping someone sign in (decision 59, amended by 75) ----------------------------
-- A sign-in code is the whole account, so the helper must be able to put
-- the person back everywhere they are: for every membership they hold in
-- an organization they joined themselves, Invite at that scope and every
-- privilege of the role. A membership someone else made for them (in an
-- organization they never joined) counts for nothing either way: it lets
-- its maker help nobody, and it does not stop their own admin helping.
create or replace function public.may_help_sign_in(p_helper text, p_profile text)
returns boolean language sql stable security definer set search_path = public as $$
  with theirs as (
    select m.org_id, m.language_id, m.role_id from public.org_memberships m
    where m.profile_id = p_profile and not m.removed and public._joined_by_consent(m.org_id, p_profile)
  )
  select p_helper is not null and p_helper <> p_profile
    and public.is_managed_account(p_profile)
    and not public.is_managed_account(p_helper)
    and exists (select 1 from theirs)
    and not exists (
      select 1 from theirs t
      where not ('invite_members' = any(public.org_privileges(t.org_id, p_helper, t.language_id))
        and coalesce(public._live_role_privileges(t.org_id, t.role_id), '{}') <@ public.org_privileges(t.org_id, p_helper, t.language_id))
    );
$$;

-- ---- invites and admissions grant only what the grantor holds -------------------------

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
  if not public._live_role_privileges(p_org, p_role_id) <@ public.org_privileges(p_org, v_actor, p_scope->>'languageId') then
    raise exception 'you may only invite people to a role whose privileges you hold' using errcode = '42501';
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

-- May the person who issued this invite still grant it? An invite carries
-- its issuer's authority, so it lapses when they could no longer issue it.
create or replace function public._invite_still_granted(p_org text, p_issuer text, p_role text, p_scope jsonb)
returns boolean language sql stable security definer set search_path = '' as $$
  select 'invite_members' = any(public.org_privileges(p_org, p_issuer, p_scope->>'languageId'))
    and coalesce(public._live_role_privileges(p_org, p_role) <@ public.org_privileges(p_org, p_issuer, p_scope->>'languageId'), false);
$$;

create or replace function public.redeem_invite_for(p_actor text, p_token text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_hash text := encode(extensions.digest(p_token, 'sha256'), 'hex');
  v_inv record;
  v_used int;
  v_suffix text;
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
  return v_inv.org_id;
end $$;

-- What a key means; an invite whose issuer can no longer grant it reads as retired.
create or replace function public.preview_invite(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_inv record;
  v_me text := public.caller_id();
  v_used int;
  v_status text;
begin
  if p_token is null or p_token !~ '^[0-9a-fA-F]{32,128}$' then return jsonb_build_object('status', 'not_found'); end if;
  select * into v_inv from public.invites
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select count(*) into v_used from public.invite_redemptions r where r.invite_id = v_inv.id;
  v_status := case
    when v_me is not null and exists (select 1 from public.invite_redemptions r
      where r.invite_id = v_inv.id and r.profile_id = v_me) then 'joined'
    when v_used >= v_inv.max_uses then 'used'
    when v_inv.expires_at <= now() then 'expired'
    when not exists (select 1 from public.org_roles where org_id = v_inv.org_id and role_id = v_inv.role_id and not retired) then 'retired'
    when not public._invite_still_granted(v_inv.org_id, v_inv.issued_by, v_inv.role_id, v_inv.scope) then 'retired'
    else 'ok' end;
  return jsonb_build_object(
    'status', v_status,
    'orgId', v_inv.org_id,
    'orgName', public.org_name(v_inv.org_id),
    'roleName', (select r.name from public.org_roles r where r.org_id = v_inv.org_id and r.role_id = v_inv.role_id),
    'scopeLevel', v_inv.scope->>'level',
    'languageName', (select public.language_display_name(l) from public.languages l
      where l.org_id = v_inv.org_id and l.language_id = v_inv.scope->>'languageId'),
    'label', v_inv.label,
    'invitedBy', (select p.display_name from public.profiles p where p.id = v_inv.issued_by),
    'group', v_inv.max_uses > 1,
    'expiresAt', v_inv.expires_at
  );
end $$;

create or replace function public.decide_join_request_v2(
  p_request_id text, p_accepted boolean, p_role_id text default null, p_scope jsonb default '{"level":"org"}'
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor text := public.caller_id();
  v_req record;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  select * into v_req from public.join_requests where id = p_request_id for update;
  if not found then
    if exists (select 1 from public.events where id = 'joindecided:' || p_request_id and actor_id = v_actor) then return; end if;
    raise exception 'request not found' using errcode = '22023';
  end if;
  if not ('invite_members' = any(public.org_privileges(v_req.org_id, v_actor, null))) then
    raise exception 'not allowed to admit members' using errcode = '42501';
  end if;
  if p_accepted then
    if p_role_id is null or not exists (
        select 1 from public.org_roles r where r.org_id = v_req.org_id and r.role_id = p_role_id and not r.retired) then
      raise exception 'a role is required to accept' using errcode = '22023';
    end if;
    if public._scope_error(p_scope) is not null then raise exception 'invalid scope' using errcode = '22023'; end if;
    if p_scope->>'level' = 'language' and not public.language_listed(v_req.org_id, p_scope->>'languageId') then
      raise exception 'unknown language' using errcode = '22023';
    end if;
    if not public._live_role_privileges(v_req.org_id, p_role_id) <@ public.org_privileges(v_req.org_id, v_actor, p_scope->>'languageId') then
      raise exception 'you may only admit people to a role whose privileges you hold' using errcode = '42501';
    end if;
  end if;

  perform public._append_event_as(
    'joindecided:' || p_request_id, v_req.org_id, '_org', 'v1.JoinDecided', v_actor, 'server',
    jsonb_build_object('requestId', p_request_id, 'profileId', v_req.profile_id, 'accepted', p_accepted));
  if p_accepted then
    perform public._append_event_as(
      'joinmember:' || p_request_id, v_req.org_id, '_org', 'v1.MemberAdded', v_actor, 'server',
      jsonb_build_object('profileId', v_req.profile_id, 'roleId', p_role_id, 'scope', p_scope));
  end if;
  delete from public.join_requests where id = p_request_id;
end $$;

-- ---- review links made with a token close with it ------------------------------------

alter table public.review_links add column if not exists token_id uuid references public.api_tokens (id) on delete cascade;
create index if not exists review_links_token on public.review_links (token_id) where token_id is not null;

-- ---- privileges -----------------------------------------------------------------------
-- The helpers run inside security definer functions; nobody calls them directly.

do $$
declare f text;
begin
  foreach f in array array[
    '_entity_key(text, jsonb)', '_server_event_id(text)', '_lock_stream(text, text)',
    '_live_role_privileges(text, text)', '_held_at(text, text, text)', '_grant_refusal(text, text, text, jsonb)',
    '_joined_by_consent(text, text)', '_invite_still_granted(text, text, text, jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
