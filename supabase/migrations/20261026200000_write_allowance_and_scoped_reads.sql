-- What one account may write, and what a language's member may read
-- (decisions.md 169). A security audit (2026-10-26) found:
--
-- 1. append_events and record_user_event bounded each event (decisions.md
--    115) but not how many, so any account, and sign-up is open, could fill
--    a log that never sheds an event. Now a signed-in account writes at most
--    20,000 organization and language events, or 100 MB of their payloads,
--    dated any one UTC day (_append_allowance_refusal). The day is the
--    event's own clock, so weeks of work done offline go up at once, but
--    never before the day the account was made, so a new account cannot
--    date events into the past to write more. An event over it is refused
--    on its own, with the reason, and the rest of the push goes on
--    (invariant 1); the service role's imports and seeds are not counted. A
--    person's stream holds each kind of event once, TermsAccepted once a
--    version and at most 100 versions: a repeat is answered as done, so a
--    phone that sends one again sees no error.
-- 2. redeem_invite_for's `invitecheck:` ids were not reserved, so a member
--    could take one first and the person joining would quietly not join the
--    invite's check team.
-- 3. library_template_users named every language's template to anyone in
--    the organization. Now it names only the languages the caller may read,
--    as language_book_names does. Defining or publishing a library item
--    takes an organization-wide role, which reads every language, so the
--    app's choice between a new version and a copy (breakup/model.ts
--    planChange) is the same for everyone who can make it.
--
-- append_events is restated whole, as `create or replace`, from
-- 20261016050000_event_stream_kind.sql's.

-- What each account has written, by the day its events are dated.
create table public.append_allowance (
  actor_id text not null,
  day date not null,
  events int not null,
  bytes bigint not null,
  primary key (actor_id, day)
);
alter table public.append_allowance enable row level security;
revoke all on public.append_allowance from public, anon, authenticated;

-- Whether one more event, after p_events and p_bytes of this push's own for
-- the day (this event included), goes past the account's allowance for it.
create or replace function public._append_allowance_refusal(p_actor text, p_day date, p_events int, p_bytes bigint)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when coalesce(a.events, 0) + p_events > 20000 then format('this account has written 20000 events dated %s', p_day)
    when coalesce(a.bytes, 0) + p_bytes > 104857600 then format('this account has written 100 MB of events dated %s', p_day)
  end
  from (select 1) one
  left join public.append_allowance a on a.actor_id = p_actor and a.day = p_day;
$$;
revoke all on function public._append_allowance_refusal(text, date, int, bigint) from public, anon, authenticated;

create or replace function public._server_event_id(p_id text)
returns boolean language sql immutable as $$
  select p_id ~ '^(invite|invitemember|inviteredeem|invitecheck|joindecided|joinmember|removed|accountdeleted|blob|blobinvalid|pin|seed|timings|v2):'
    or p_id like 'api-%';
$$;

create or replace function public.record_user_event(p_id text, p_type text, p_payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if p_id is null or length(p_id) > 256 or p_id not like v_actor || ':%' then
    raise exception 'invalid event id' using errcode = '22023';
  end if;
  if p_type not in ('v1.TermsAccepted','v1.VisionSeen','v1.WalkthroughDone')
    or p_type is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'invalid user event' using errcode = '22023';
  end if;
  if p_type = 'v1.TermsAccepted' and (
    not public._is_str(p_payload->'version') or length(p_payload->>'version') > 100 or p_payload - 'version' <> '{}'::jsonb
  ) then raise exception 'terms version required' using errcode = '22023'; end if;
  if p_type <> 'v1.TermsAccepted' and p_payload <> '{}'::jsonb then
    raise exception 'invalid user event' using errcode = '22023';
  end if;
  -- Once each: a repeat is answered as done.
  if exists (select 1 from public.events e
             where e.org_id = '_person' and e.stream_id = v_actor and e.type = p_type
               and (p_type <> 'v1.TermsAccepted' or e.payload->>'version' = p_payload->>'version')) then
    return;
  end if;
  if p_type = 'v1.TermsAccepted' and (select count(*) from public.events e
       where e.org_id = '_person' and e.stream_id = v_actor and e.type = p_type) >= 100 then
    raise exception 'too many terms versions' using errcode = '22023';
  end if;
  perform public._append_event_as(p_id, '_person', v_actor, p_type, v_actor, 'server', p_payload);
end $$;

create or replace function public.library_template_users(p_org text)
returns table (language_id text, item_id text, doc_hash text, unit_prefix text, books jsonb)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_actor text := public.caller_id();
begin
  if not public._library_member(p_org, v_actor) then raise exception 'not a member' using errcode = '42501'; end if;
  -- The latest selection in each language stream the caller may read, as the fold keeps it (latest clock, then event id).
  return query
    select distinct on (e.stream_id) e.stream_id, e.payload->>'itemId', e.payload->>'docHash', e.payload->>'unitPrefix', e.payload->'books'
    from public.events e
    where e.org_id = p_org and e.type = 'v1.TemplateSelected' and e.stream_id <> '_org'
      and public.can_read_stream(p_org, e.stream_id, v_actor)
      and not exists (select 1 from public.events r
                      where r.org_id = e.org_id and r.stream_id = e.stream_id and r.type = 'v1.Redacted' and r.payload->>'eventId' = e.id)
    order by e.stream_id, e.hlc collate "C" desc, e.id collate "C" desc;
end $$;

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
  v_today date := (now() at time zone 'utc')::date;
  v_made date;
  v_day date;
  v_size int;
  v_used jsonb := '{}';
begin
  perform public.require_client_version(p_client_version);
  select clock_ahead_tolerance_ms into v_tolerance from public.server_config;
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events must be a jsonb array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) > 500 then
    raise exception 'batch too large: % events (max 500); page the push', jsonb_array_length(p_events) using errcode = '22023';
  end if;
  -- By the primary key (a profile that is not a uuid is no account).
  if v_actor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select (u.created_at at time zone 'utc')::date into v_made from auth.users u where u.id = v_actor::uuid;
  end if;

  for ev in select * from jsonb_array_elements(p_events) loop
    v_id := ev->>'id'; v_org := ev->>'orgId'; v_stream := ev->>'streamId'; v_type := ev->>'type'; v_hlc := ev->>'hlc';

    if not (public._is_str(ev->'id') and public._is_str(ev->'orgId') and public._is_str(ev->'streamId')
            and public._is_str(ev->'type') and public._is_str(ev->'hlc') and public._is_str(ev->'deviceId')
            and public._is_str(ev->'actorId')) or ev->'payload' is null then
      id := v_id; accepted := false; server_seq := null; reason := 'malformed envelope';
      return next; continue;
    end if;
    if public._names_object_member(jsonb_build_array(ev->'id', ev->'orgId', ev->'streamId', ev->'type', ev->'hlc', ev->'deviceId', ev->'actorId')) then
      id := v_id; accepted := false; server_seq := null; reason := 'malformed envelope: a name every object has, such as __proto__';
      return next; continue;
    end if;
    -- Small enough for every phone to fold (decisions.md 115); the service role's imports are its own.
    if v_actor is not null then
      v_invalid := public._event_size_refusal(ev);
      if v_invalid is not null then
        id := v_id; accepted := false; server_seq := null; reason := 'invalid payload: ' || v_invalid;
        return next; continue;
      end if;
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

    -- An organization's events go on its stream, a language's on the
    -- language's; only a redaction goes on either (decisions.md 116).
    if v_actor is not null and v_type <> 'v1.Redacted'
       and (v_stream = '_org') is distinct from (v_type = any (public._org_event_types())) then
      id := v_id; accepted := false; server_seq := null;
      reason := format('invalid payload: %s belongs on %s', v_type, case when v_stream = '_org' then 'a language stream' else 'the organization stream' end);
      return next; continue;
    end if;

    -- A person's stream is written only by record_user_event.
    if v_org = '_person' then
      id := v_id; accepted := false; server_seq := null; reason := format('may not emit %s here', v_type);
      return next; continue;
    end if;

    -- A third-party app's value comes only from the app's Worker (the
    -- service role), as the person behind a live token that holds the
    -- external_values scope and reaches this language (decisions.md 79).
    if v_type = 'v1.ExternalValueSet' and not (v_actor is null
         and public._external_values_token(v_org, v_stream, ev->>'actorId', ev->>'deviceId')) then
      id := v_id; accepted := false; server_seq := null; reason := format('may not emit %s', v_type);
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
      -- A new organization counts against its creator's allowance.
      if v_bootstrap and v_actor is not null and not exists (select 1 from public.org_bootstraps b where b.org_id = v_org) then
        v_invalid := public._org_creation_refusal(v_actor);
        if v_invalid is not null then
          id := v_id; accepted := false; server_seq := null; reason := format('may not emit %s: %s', v_type, v_invalid);
          return next; continue;
        end if;
      end if;
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

    -- What one account writes dated one day (decisions.md 169): the day on
    -- the event's own clock, so work done offline goes up when it reaches
    -- the server, but never before the account was made.
    if v_actor is not null then
      v_day := least(greatest((to_timestamp(v_wall_ms / 1000.0) at time zone 'utc')::date, coalesce(v_made, '-infinity'::date)), v_today);
      v_size := octet_length((ev->'payload')::text);
      v_invalid := public._append_allowance_refusal(v_actor, v_day,
        coalesce((v_used->v_day::text->>0)::int, 0) + 1, coalesce((v_used->v_day::text->>1)::bigint, 0) + v_size);
      if v_invalid is not null then
        id := v_id; accepted := false; server_seq := null; reason := format('may not emit %s: %s', v_type, v_invalid);
        return next; continue;
      end if;
    end if;

    -- From here the stream is locked. The same event pushed again while
    -- this one was in flight (a retry after a lost response) has committed
    -- by now, so it is a duplicate, as above.
    perform public._lock_stream(v_org, v_stream);
    select * into v_prior from public.events e where e.id = v_id;
    if found then
      if v_prior.org_id = v_org and v_prior.stream_id = v_stream and v_prior.actor_id = ev->>'actorId' and v_prior.type = v_type then
        id := v_id; accepted := true; server_seq := v_prior.server_seq; reason := 'duplicate';
      else
        id := v_id; accepted := false; server_seq := null; reason := 'malformed envelope: event id already used';
      end if;
      return next; continue;
    end if;

    -- One create, one entity, checked under the stream's lock.
    v_key := public._entity_key(v_type, ev->'payload');
    if v_key is not null and exists (select 1 from public.events e
         where e.org_id = v_org and e.stream_id = v_stream and public._entity_key(e.type, e.payload) = v_key) then
      id := v_id; accepted := false; server_seq := null;
      reason := format('invalid payload: %s id %s is already used', split_part(v_key, ':', 1), substr(v_key, length(split_part(v_key, ':', 1)) + 2));
      return next; continue;
    end if;

    v_seq := public._next_seq(v_org, v_stream);
    insert into public.events (id, org_id, stream_id, server_seq, type, actor_id, device_id,
                               hlc, parent_event_id, payload)
    values (v_id, v_org, v_stream, v_seq, v_type, ev->>'actorId', ev->>'deviceId',
            v_hlc, ev->>'parentEventId', ev->'payload');
    if v_actor is not null then
      v_used := jsonb_set(v_used, array[v_day::text], jsonb_build_array(
        coalesce((v_used->v_day::text->>0)::int, 0) + 1, coalesce((v_used->v_day::text->>1)::bigint, 0) + v_size));
    end if;

    if v_stream = '_org' then
      perform public._apply_org_event(v_org, v_id, v_type, ev->'payload', v_hlc, ev->>'actorId');
    end if;
    if v_bootstrap and v_actor is not null then
      insert into public.org_bootstraps (org_id, actor_id) values (v_org, v_actor) on conflict do nothing;
    end if;

    id := v_id; accepted := true; server_seq := v_seq; reason := null;
    return next;
  end loop;

  -- Counted against each day's allowance: what was taken, not duplicates or refusals.
  insert into public.append_allowance as a (actor_id, day, events, bytes)
  select v_actor, u.key::date, (u.value->>0)::int, (u.value->>1)::bigint from jsonb_each(v_used) u
  on conflict (actor_id, day) do update set events = a.events + excluded.events, bytes = a.bytes + excluded.bytes;
end $$;
