-- An event is at most 64 KB, and an account creates at most 5 organizations
-- a day and 20 in all (decisions.md 115).
--
-- append_events limited a push to 500 events but not their size, so one
-- member could push notes of many megabytes that every phone in the
-- language must download and fold, into a log that never sheds them; and
-- any account could create organizations without end. Now, for signed-in
-- callers (the service role's imports and seeds are exempt):
--
--   * a payload as Postgres prints it (`payload::text`) is at most 64 KB,
--     and each envelope field at most 256 characters. Core's eventSizeError
--     measures the same (jsonbTextBytes) and SyncClient refuses to record a
--     bigger event; scripts/record-parity-sql.ts holds the two together.
--     The fold does not check size, so nothing already in a log changes.
--   * the first event of an organization nobody has written to, which is
--     its creation (append_events' bootstrap rule), is refused once its
--     author has created 5 in the last day or 20 in all. org_bootstraps
--     records who created each, filled here from each organization's first
--     event. An offline phone's backlog is never counted: only creations.
--   * record_user_event takes the same 64 KB limit.
--
-- append_events is restated whole, as `create or replace`, from
-- 20261016020000_object_member_names.sql's; record_user_event from
-- 20261006000000_baseline.sql's.

create table public.org_bootstraps (
  org_id text primary key,
  actor_id text not null,
  created_at timestamptz not null default now()
);
create index org_bootstraps_actor_idx on public.org_bootstraps (actor_id, created_at);
alter table public.org_bootstraps enable row level security;
revoke all on public.org_bootstraps from public, anon, authenticated;

insert into public.org_bootstraps (org_id, actor_id, created_at)
select distinct on (e.org_id) e.org_id, e.actor_id, e.received_at
from public.events e
where e.stream_id = '_org'
order by e.org_id, e.server_seq;

-- Core EVENT_PAYLOAD_MAX_BYTES and EVENT_FIELD_MAX_CHARS (packages/core/src/validate.ts).
create or replace function public._event_size_refusal(ev jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare k text;
begin
  foreach k in array array['id', 'type', 'orgId', 'streamId', 'actorId', 'deviceId', 'hlc', 'parentEventId'] loop
    if jsonb_typeof(ev->k) = 'string' and length(ev->>k) > 256 then
      return format('%s is longer than 256 characters', k);
    end if;
  end loop;
  if octet_length((ev->'payload')::text) > 65536 then
    return format('event too large: %s bytes (max 65536)', octet_length((ev->'payload')::text));
  end if;
  return null;
end $$;

create or replace function public._org_creation_refusal(p_actor text)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when (select count(*) from public.org_bootstraps b where b.actor_id = p_actor) >= 20
      then 'an account creates at most 20 organizations'
    when (select count(*) from public.org_bootstraps b where b.actor_id = p_actor and b.created_at > now() - interval '1 day') >= 5
      then 'an account creates at most 5 organizations a day'
  end;
$$;
revoke all on function public._org_creation_refusal(text) from public, anon, authenticated;

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
  if octet_length(p_payload::text) > 65536 then raise exception 'event too large (max 64 KB)' using errcode = '22023'; end if;
  if p_type = 'v1.TermsAccepted' and (
    not public._is_str(p_payload->'version') or length(p_payload->>'version') > 100
  ) then raise exception 'terms version required' using errcode = '22023'; end if;
  perform public._append_event_as(p_id, '_person', v_actor, p_type, v_actor, 'server', p_payload);
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

    if v_stream = '_org' then
      perform public._apply_org_event(v_org, v_id, v_type, ev->'payload', v_hlc, ev->>'actorId');
    end if;
    if v_bootstrap and v_actor is not null then
      insert into public.org_bootstraps (org_id, actor_id) values (v_org, v_actor) on conflict do nothing;
    end if;

    id := v_id; accepted := true; server_seq := v_seq; reason := null;
    return next;
  end loop;
end $$;
