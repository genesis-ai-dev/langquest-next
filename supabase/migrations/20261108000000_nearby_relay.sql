-- Nearby sync's delivery phase (docs/nearby-sync-plan.md section 6, phase 4):
-- a phone that reaches the internet sends its teammates' signed work on their
-- behalf, through the Worker's POST /api/relay, which checks each batch's chain
-- and signature and calls relay_append_events once per author and signer's key.
-- That function appends as the author, through append_events, so every
-- per-account check applies, after refusing what the relay must never carry:
-- work dated after its key was revoked (Carl's answer 4), past a revoked key's
-- cap (answer 16), redactions, stamps far ahead, and the organization's and a
-- person's streams. A lost phone's keys are revoked by revoke_install_keys,
-- from New password's "A phone of mine was lost or taken", from a helper's
-- lost-phone code at the person's next sign-in (answer 26), and from staff.
-- Someone who only views may upload a file an accepted event names
-- (blob_named_by). may_emit is restated once: taking back a departure the
-- server lacks needs Override checkpoints.
--
-- Every function a store build calls keeps its results (decisions.md 151,
-- 152): append_events is unchanged; may_emit changes one answer, an undo of a
-- departure the server does not hold, for someone without Override
-- checkpoints, which decision 97's amendment records; take_sign_in_code_v2
-- keeps its signature and answers. Every new function is the service role's
-- alone, because functions default open to every API role.

-- ---- how far ahead the relay takes a stamp ------------------------------------------

-- A stamp more than this past server time is refused by the relay with a reason
-- that reads as final, so a batch stamped 2035 settles instead of waiting as
-- CLOCK_AHEAD for years. Beside clock_ahead_tolerance_ms, so it needs no app
-- update. An author's own push is unchanged: it gets CLOCK_AHEAD and restamps.
alter table public.server_config
  add column relay_ahead_limit_ms bigint not null default 86400000 check (relay_ahead_limit_ms > 0);

-- ---- may_emit, restated once -----------------------------------------------------------

-- Restated from 20261015220000_withdraw_reviews_notes.sql with one rule
-- widened: an undo of an override, or of a departure the server does not have,
-- needs override_checkpoints. "It changes nothing" stopped being true with
-- nearby: a translator holding a coordinator's override from a teammate's
-- batch could push the undo before the override lands, and the override would
-- then read as undone for good. Holders of override_checkpoints keep today's
-- result, and so does an undo of a set-aside the server holds. The lookup is
-- the same one as before, by events_type_idx.
create or replace function public.may_emit(p_org text, p_stream text, p_profile text, p_type text, p jsonb)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_priv text := public.event_privilege(p_type, p);
begin
  if v_priv is null or v_priv = 'bootstrap' then return false; end if;
  if p_type = 'v1.DepartureUndone' and not exists (
    select 1 from public.events e
    where e.org_id = p_org and e.stream_id = p_stream and e.type = 'v1.DepartureRecorded'
      and e.payload->>'departureId' = p->>'departureId' and e.payload->>'type' is distinct from 'override')
  then
    v_priv := 'override_checkpoints';
  end if;
  -- Your own review or note only.
  if p_type = 'v1.ReviewWithdrawn' and not exists (
    select 1 from public.events e
    where e.org_id = p_org and e.stream_id = p_stream and e.type = 'v1.ReviewRecorded'
      and e.payload->>'reviewId' = p->>'reviewId' and e.actor_id = p_profile)
  then
    return false;
  end if;
  if p_type = 'v1.NoteWithdrawn' and not exists (
    select 1 from public.events e
    where e.org_id = p_org and e.stream_id = p_stream and e.type = 'v1.NoteAdded'
      and e.payload->>'noteId' = p->>'noteId' and e.actor_id = p_profile)
  then
    return false;
  end if;
  return string_to_array(v_priv, ',') && public.org_privileges(
    p_org, p_profile,
    case when p_stream = '_org' then public.language_of_org_event(p_type, p) else p_stream end);
end $$;
revoke all on function public.may_emit(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.may_emit(text, text, text, text, jsonb) to service_role;

-- ---- revoking a lost phone's keys -----------------------------------------------------

-- An account by its email or its id; null when neither names one. For staff.
-- PL/pgSQL, so the cast to uuid is never folded into a plan for an email.
create or replace function public._install_key_person(p_who text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if btrim(p_who) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return (select u.id from auth.users u where u.id = btrim(p_who)::uuid);
  end if;
  return (select u.id from auth.users u where lower(u.email) = lower(btrim(p_who)) order by u.created_at limit 1);
end $$;

-- Sets revoked_at and revoked_by on this person's unrevoked install_keys rows,
-- and adds each to the revocation list of every organization the person has a
-- membership in, with `seq` per organization (5.12), in one transaction, so the
-- Worker's certificate facts carry them from the next call. Only the named
-- person: on a shared phone the others' rows stay good (Carl's answer 20), so
-- the list holds (key, person) pairs. It also ends every session of theirs,
-- each time it is called: a taken phone still signed in would otherwise answer
-- the certificate call's `{revoked: true}` with a new key and get a fresh
-- chain, so the revocation would not stick. Each caller signs the person in
-- again afterwards, on the phone they still hold. Idempotent: a second call
-- finds nothing to revoke and adds no row. Answers how many keys it revoked.
-- Each organization's list is numbered under a lock of its own, taken in
-- organization order so two revocations at once cannot deadlock. The body is
-- _revoke_install_keys, which suspend_account also calls.
create or replace function public._revoke_install_keys(p_profile uuid, p_by text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[];
  v_org text;
  v_key text;
  v_at timestamptz := now();
begin
  delete from auth.sessions s where s.user_id = p_profile;
  with revoked as (
    update public.install_keys k set revoked_at = v_at, revoked_by = p_by
    where k.profile_id = p_profile and k.revoked_at is null
    returning k.public_key)
  select coalesce(array_agg(r.public_key order by r.public_key), '{}') into v_keys from revoked r;
  if cardinality(v_keys) = 0 then return 0; end if;

  for v_org in
    select distinct m.org_id from public.org_memberships m where m.profile_id = p_profile::text order by m.org_id
  loop
    perform pg_advisory_xact_lock(hashtext('install_key_revocations:' || v_org));
    foreach v_key in array v_keys loop
      insert into public.install_key_revocations (org_id, seq, public_key, profile_id, revoked_at)
      values (v_org, coalesce((select max(r.seq) from public.install_key_revocations r where r.org_id = v_org), 0) + 1, v_key, p_profile, v_at)
      on conflict (org_id, public_key, profile_id) do nothing;
    end loop;
  end loop;
  return cardinality(v_keys);
end $$;

-- The service role's call (New password's lost choice, a helper's lost-phone
-- code, staff): its id and words checked, then _revoke_install_keys.
create or replace function public.revoke_install_keys(p_profile text, p_by text)
returns int language plpgsql security definer set search_path = '' as $$
begin
  if public.caller_id() is not null then raise exception 'service role only' using errcode = '42501'; end if;
  if p_profile is null or p_profile !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'p_profile must be an account id' using errcode = '22023';
  end if;
  if coalesce(length(btrim(p_by)), 0) not between 1 and 200 then
    raise exception 'say who revokes, in 1 to 200 characters' using errcode = '22023';
  end if;
  return public._revoke_install_keys(p_profile::uuid, btrim(p_by));
end $$;

-- For staff, for someone who cannot reach their email (docs/nearby-sync-plan.md
-- section 6): revokes the person's keys as a lost phone does and ends their
-- sessions, as global_viewer_revoke does, so a taken phone holding a token is
-- signed out too. Answers in words.
create or replace function public.install_keys_staff_revoke(p_who text, p_by text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_n int;
begin
  if public.caller_id() is not null then raise exception 'service role only' using errcode = '42501'; end if;
  if coalesce(btrim(p_by), '') = '' then return 'Say who you are.'; end if;
  v_id := public._install_key_person(p_who);
  if v_id is null then return 'No account has that email or id.'; end if;
  v_n := public.revoke_install_keys(v_id::text, p_by);
  delete from auth.sessions s where s.user_id = v_id;
  return format('revoked %s', v_n);
end $$;

-- For staff: a person's keys with what each revoked key has delivered against
-- its cap (section 6, Carl's answer 16).
create or replace function public.install_key_list(p_who text)
returns table (public_key text, install_id text, created_at timestamptz, last_certified_at timestamptz,
               revoked_at timestamptz, revoked_by text, after_revoked_events int, after_revoked_events_limit int,
               after_revoked_bytes bigint, after_revoked_bytes_limit bigint, after_revoked_raised_by text)
language sql stable security definer set search_path = '' as $$
  select k.public_key, k.install_id, k.created_at, k.last_certified_at, k.revoked_at, k.revoked_by,
         k.after_revoked_events, k.after_revoked_events_limit, k.after_revoked_bytes, k.after_revoked_bytes_limit, k.after_revoked_raised_by
  from public.install_keys k
  where k.profile_id = public._install_key_person(p_who)
  order by k.created_at, k.public_key;
$$;

-- For staff: raise one revoked row's cap, so work a thief's flood got refused
-- can be delivered by Try again. Each limit becomes the greater of what it is
-- and what is given, so this never lowers one. 'raised', 'no_key' or 'say_who'.
create or replace function public.install_key_limit_raise(p_key text, p_profile text, p_events int, p_bytes bigint, p_by text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if public.caller_id() is not null then raise exception 'service role only' using errcode = '42501'; end if;
  if coalesce(length(btrim(p_by)), 0) not between 1 and 200 then return 'say_who'; end if;
  if p_profile is null or p_profile !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return 'no_key'; end if;
  update public.install_keys k
  set after_revoked_events_limit = greatest(k.after_revoked_events_limit, coalesce(p_events, 0)),
      after_revoked_bytes_limit = greatest(k.after_revoked_bytes_limit, coalesce(p_bytes, 0)),
      after_revoked_raised_by = btrim(p_by)
  where k.public_key = p_key and k.profile_id = p_profile::uuid;
  return case when found then 'raised' else 'no_key' end;
end $$;

-- Restated from 20261006000000_baseline.sql with the same signature and
-- answers. When the code taken was marked lost by the helper who issued it,
-- the person's install keys are revoked in the transaction that takes it
-- (Carl's answer 26): a looked-after account has no email, so this is how a
-- helper stops a taken phone's key and its pass, at that person's own next
-- sign-in, with nothing added to any screen. Only that person's rows.
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
  if v_row.was_lost then
    perform public.revoke_install_keys(v_row.who::text, 'a helper''s lost-phone sign-in code');
  end if;
  profile_id := v_row.who; email := v_row.address; lost := v_row.was_lost; helper_name := v_row.helper;
  return next;
end $$;

-- ---- relaying a teammate's signed work ------------------------------------------------

-- What the Worker's POST /api/relay calls, once per author and signer's key and
-- at most 500 events, after it has checked the batch's chain (no expiry: a
-- batch may be carried for months), its signature and every event's digest
-- (docs/nearby-sync-plan.md section 6). Service role only, and in this order:
--
-- 1. 42501 if caller_id() is not null, before anything else, since below it
--    sets the author as the caller.
-- 2. A refusal for every event when the (key, author) row is missing, or the
--    author is suspended (auth.users.banned_until, which only Auth enforces).
-- 3. Per event: one dated at or after its key's revoked_at, or with a clock
--    that cannot be read, is refused; earlier work stands (Carl's answer 4,
--    by the wall part of hlc). A v1.Redacted is refused by name, since a
--    redaction cannot be undone and a copied key must not take the team's
--    work off every phone. A stamp more than relay_ahead_limit_ms past server
--    time is refused for good. The organization's and a person's streams are
--    refused.
-- 4. A revoked key's cap (Carl's answer 16): the row is locked only when
--    revoked_at is set, so ordinary delivery takes no lock, and before the
--    stream's lock, since each call has one key. An id already on the server
--    passes uncounted, so several carriers count once. Otherwise each event
--    adds 1 and its payload's jsonb text size, and only once append_events
--    has taken it, so an event it refuses never uses up room for a later one.
--    When everything still standing fits, one call takes it all. When it
--    might not, append_events is called per event, and an event past either
--    limit of what was taken so far is refused alone, with a reason that
--    reads as NOT_ALLOWED.
-- 5. set_config('request.jwt.claims', ...) local to the transaction, with the
--    author, then append_events: size, actorId, bound and reserved ids, stream
--    kind, grant refusals and the author's daily allowance all apply from the
--    code that holds them, and v1.ExternalValueSet is refused because the
--    caller is then not null. An undo refused because the server lacks its
--    departure answers `departure not here yet`. The cap counts only what
--    append_events took (accepted, not a duplicate), and the claims go back.
--
-- Same columns as append_events. p_client_version is the delivering phone's,
-- so LQ001 gates the caller, as in a push, and says nothing about the author.
create or replace function public.relay_append_events(p_author text, p_key text, p_events jsonb, p_client_version int default 0)
returns table (id text, accepted boolean, server_seq bigint, reason text)
language plpgsql security definer set search_path = '' as $$
declare
  v_claims text;
  v_author uuid;
  v_key public.install_keys;
  v_found boolean;
  v_banned boolean;
  v_revoked_ms bigint;
  v_now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_ahead bigint;
  ev jsonb;
  v_id text;
  v_type text;
  v_hlc text;
  v_wall bigint;
  v_refusal text;
  v_rest jsonb := '[]';
  v_sizes jsonb := '{}';
  v_undoes jsonb := '{}';
  v_events int := 0;
  v_bytes bigint := 0;
  v_size int;
  v_took_events int := 0;
  v_took_bytes bigint := 0;
  v_one_by_one boolean;
  v_call jsonb;
  r record;
begin
  -- 1.
  if public.caller_id() is not null then raise exception 'service role only' using errcode = '42501'; end if;
  perform public.require_client_version(p_client_version);
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'p_events must be a jsonb array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) > 500 then
    raise exception 'batch too large: % events (max 500); page the relay', jsonb_array_length(p_events) using errcode = '22023';
  end if;

  -- 2.
  if p_author ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_author := p_author::uuid; end if;
  select * into v_key from public.install_keys k where k.public_key = p_key and k.profile_id = v_author;
  v_found := found;
  if not v_found then
    return query select e->>'id', false, null::bigint, 'malformed envelope: no key of this author signed it'::text
                 from jsonb_array_elements(p_events) e;
    return;
  end if;
  select u.banned_until is not null and u.banned_until > now() into v_banned from auth.users u where u.id = v_author;
  if v_banned then
    return query select e->>'id', false, null::bigint, format('may not emit %s: its author is suspended', e->>'type')
                 from jsonb_array_elements(p_events) e;
    return;
  end if;

  -- 3.
  select c.relay_ahead_limit_ms into v_ahead from public.server_config c;
  if v_key.revoked_at is not null then
    v_revoked_ms := floor(extract(epoch from v_key.revoked_at) * 1000)::bigint;
    -- 4. Locked before append_events locks the stream; only a revoked row is locked.
    select * into v_key from public.install_keys k where k.public_key = p_key and k.profile_id = v_author for update;
  end if;
  for ev in select * from jsonb_array_elements(p_events) loop
    v_id := ev->>'id'; v_type := ev->>'type'; v_hlc := ev->>'hlc';
    v_wall := case when v_hlc ~ '^[0-9]{15}:[0-9]{6}:[^:]+$' then left(v_hlc, 15)::bigint end;
    v_refusal := case
      when v_id is null or v_type is null then 'malformed envelope'
      when v_wall is null then 'malformed envelope: a clock no phone can read'
      when v_revoked_ms is not null and v_wall >= v_revoked_ms
        then format('key revoked: dated after %s', to_char(v_key.revoked_at at time zone 'utc', 'YYYY-MM-DD'))
      when v_type = 'v1.Redacted' then 'invalid payload: a redaction is not relayed'
      when v_wall > v_now_ms + v_ahead
        then format('stamped too far ahead: %s', to_char(to_timestamp(v_wall / 1000.0) at time zone 'utc', 'YYYY-MM-DD'))
      when coalesce(ev->>'orgId', '') like '\_%' or coalesce(ev->>'streamId', '') like '\_%'
        then 'invalid payload: only a language''s stream is relayed'
    end;
    -- 4. What the cap would count, for a revoked key only: an id the server lacks.
    if v_refusal is null and v_revoked_ms is not null and not exists (select 1 from public.events e where e.id = v_id) then
      v_size := coalesce(octet_length((ev->'payload')::text), 0);
      v_events := v_events + 1;
      v_bytes := v_bytes + v_size;
      v_sizes := v_sizes || jsonb_build_object(v_id, v_size);
    end if;
    if v_refusal is not null then
      id := v_id; accepted := false; server_seq := null; reason := v_refusal;
      return next; continue;
    end if;
    if v_type = 'v1.DepartureUndone' and v_id is not null then
      v_undoes := v_undoes || jsonb_build_object(v_id, jsonb_build_object(
        'departureId', coalesce(ev->'payload'->>'departureId', ''), 'orgId', ev->>'orgId', 'streamId', ev->>'streamId'));
    end if;
    v_rest := v_rest || jsonb_build_array(ev);
  end loop;
  if jsonb_array_length(v_rest) = 0 then return; end if;

  -- 4. Everything fits even if all of it is taken: one call. Otherwise one call per event, so the
  -- cap is checked against what append_events has taken, and a refusal uses up no room.
  v_one_by_one := v_revoked_ms is not null and (v_key.after_revoked_events + v_events > v_key.after_revoked_events_limit
                                                 or v_key.after_revoked_bytes + v_bytes > v_key.after_revoked_bytes_limit);

  -- 5.
  v_claims := current_setting('request.jwt.claims', true);
  -- The author exactly as the Worker checked it against the chain, so actorId must match it as in a push.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_author)::text, true);
  for v_call in select case when v_one_by_one then jsonb_build_array(e) else v_rest end
                from jsonb_array_elements(case when v_one_by_one then v_rest else jsonb_build_array(null) end) e loop
    if v_one_by_one and v_sizes ? (v_call->0->>'id') and (
         v_key.after_revoked_events + v_took_events + 1 > v_key.after_revoked_events_limit
         or v_key.after_revoked_bytes + v_took_bytes + (v_sizes->>(v_call->0->>'id'))::bigint > v_key.after_revoked_bytes_limit) then
      id := v_call->0->>'id'; accepted := false; server_seq := null;
      reason := format('may not emit %s: this revoked key has reached its limit', v_call->0->>'type');
      return next; continue;
    end if;
    for r in select * from public.append_events(v_call, p_client_version) loop
      id := r.id; accepted := r.accepted; server_seq := r.server_seq; reason := r.reason;
      if not r.accepted and r.reason = 'may not emit v1.DepartureUndone' and v_undoes ? r.id and not exists (
           select 1 from public.events e
           where e.org_id = v_undoes->r.id->>'orgId' and e.stream_id = v_undoes->r.id->>'streamId'
             and e.type = 'v1.DepartureRecorded' and e.payload->>'departureId' = v_undoes->r.id->>'departureId') then
        reason := 'departure not here yet';
      end if;
      if r.accepted and r.reason is null and v_sizes ? r.id then
        v_took_events := v_took_events + 1;
        v_took_bytes := v_took_bytes + (v_sizes->>r.id)::bigint;
      end if;
      return next;
    end loop;
  end loop;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  if v_took_events > 0 then
    update public.install_keys k
    set after_revoked_events = k.after_revoked_events + v_took_events, after_revoked_bytes = k.after_revoked_bytes + v_took_bytes
    where k.public_key = p_key and k.profile_id = v_author;
  end if;
end $$;

-- ---- files an accepted event names ---------------------------------------------------

-- The files an event names, as (hash, format): core filesNamedBy
-- (packages/core/src/nearbyFilesNamed.ts), held to this by
-- scripts/record-parity-sql.ts. A recording's cards and a review's artifacts
-- with their format (wav unless said); Clean up's cleaned file with its
-- format; and a voice note field, whose format is null here because it comes
-- from the log's `audioformat:<hash>` row, otherwise m4a (decisions.md 77).
-- Nothing else names a file: not a take's cardHashes, not a verse mark, and
-- not free text.
create or replace function public._event_files(p_type text, p jsonb)
returns table (hash text, format text) language sql immutable parallel safe set search_path = '' as $$
  select distinct f.hash, f.format from (
    select c->>'hash' as hash, coalesce(c->>'format', 'wav') as format
    from jsonb_array_elements(case when p_type = 'v1.RecordingAdded' and jsonb_typeof(p->'cards') = 'array' then p->'cards'
                                   when p_type = 'v1.ReviewRecorded' and jsonb_typeof(p->'artifacts') = 'array' then p->'artifacts'
                                   else '[]'::jsonb end) c
    where jsonb_typeof(c->'hash') = 'string' and c->>'hash' <> ''
    union all
    select p->>'cleanedHash', p->>'cleanedFormat'
    where p_type = 'v1.CardCleanUpSet' and jsonb_typeof(p->'cleanedHash') = 'string' and p->>'cleanedHash' <> ''
      and jsonb_typeof(p->'cleanedFormat') = 'string' and p->>'cleanedFormat' <> ''
    union all
    select p->>v.field, null
    from (values ('v1.ReviewRecorded', 'commentBlobHash'), ('v1.RequestMade', 'noteBlobHash'), ('v1.DepartureRecorded', 'reasonBlobHash'),
                 ('v1.NoteAdded', 'blobHash'), ('v1.ResponseRecorded', 'blobHash'), ('v1.KeyTermAdjusted', 'blobHash'),
                 ('v1.MaterialFieldSet', 'blobHash')) v (type, field)
    where v.type = p_type and jsonb_typeof(p->v.field) = 'string' and p->>v.field <> ''
  ) f;
$$;

-- May this person upload this file by naming this event (the Worker's
-- `x-named-by` header on a PUT)? So that any phone can carry, someone who only
-- views may upload a file an accepted event names: true when they hold any
-- privilege in the language (a Global Viewer holds none), the language is
-- listed, and the event with that primary key is in that stream, is not
-- server-only and is not redacted, and names this file under exactly this
-- name. A recording's bytes PUT as H.wav when phones ask for H.m4a would
-- count as safe on the server and be freed from phones with nothing to fetch
-- back, so the extension must match. A primary-key read of the event, one
-- events_entity_idx read for a voice note's format, and one events_type_idx
-- read for a redaction, as _content_events does: no scan of the stream.
create or replace function public.blob_named_by(p_name text, p_profile text, p_event text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(p_profile, '') <> '' and coalesce(p_event, '') <> ''
    and p_name ~ '^[^/_][^/]*/[^/_][^/]*/[0-9a-f]{64}\.(wav|m4a)$'
    and cardinality(public.org_privileges(k.org, p_profile, k.stream)) > 0
    and public.language_listed(k.org, k.stream)
    and exists (
      select 1 from public.events e
      cross join lateral public._event_files(e.type, e.payload) f
      where e.id = p_event and e.org_id = k.org and e.stream_id = k.stream
        and public.event_privilege(e.type, e.payload) is not null
        and f.hash = k.hash
        and coalesce(f.format, (select a.payload->>'format' from public.events a
                                where a.org_id = e.org_id and a.stream_id = e.stream_id
                                  and public._entity_key(a.type, a.payload) = 'audioformat:' || f.hash
                                limit 1), 'm4a') = k.ext
        and not exists (select 1 from public.events x
                        where x.org_id = e.org_id and x.stream_id = e.stream_id
                          and x.type = 'v1.Redacted' and x.payload->>'eventId' = e.id))
  from (select split_part(p_name, '/', 1) as org, split_part(p_name, '/', 2) as stream,
               split_part(split_part(p_name, '/', 3), '.', 1) as hash, split_part(split_part(p_name, '/', 3), '.', 2) as ext) k;
$$;

-- ---- grants ---------------------------------------------------------------------------

revoke all on function public._install_key_person(text) from public, anon, authenticated;
revoke all on function public._revoke_install_keys(uuid, text) from public, anon, authenticated;
revoke all on function public.revoke_install_keys(text, text) from public, anon, authenticated;
revoke all on function public.install_keys_staff_revoke(text, text) from public, anon, authenticated;
revoke all on function public.install_key_list(text) from public, anon, authenticated;
revoke all on function public.install_key_limit_raise(text, text, int, bigint, text) from public, anon, authenticated;
revoke all on function public.relay_append_events(text, text, jsonb, int) from public, anon, authenticated;
revoke all on function public._event_files(text, jsonb) from public, anon, authenticated;
revoke all on function public.blob_named_by(text, text, text) from public, anon, authenticated;
grant execute on function public._install_key_person(text) to service_role;
grant execute on function public._revoke_install_keys(uuid, text) to service_role;
grant execute on function public.revoke_install_keys(text, text) to service_role;
grant execute on function public.install_keys_staff_revoke(text, text) to service_role;
grant execute on function public.install_key_list(text) to service_role;
grant execute on function public.install_key_limit_raise(text, text, int, bigint, text) to service_role;
grant execute on function public.relay_append_events(text, text, jsonb, int) to service_role;
grant execute on function public._event_files(text, jsonb) to service_role;
grant execute on function public.blob_named_by(text, text, text) to service_role;
-- Restated with create or replace, which keeps grants; said again so this file holds them.
revoke all on function public.take_sign_in_code_v2(text) from public, anon, authenticated;
grant execute on function public.take_sign_in_code_v2(text) to service_role;
