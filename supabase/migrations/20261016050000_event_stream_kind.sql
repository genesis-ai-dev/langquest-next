-- An event goes on the kind of stream it belongs to (decisions.md 116).
--
-- append_events asked only whether the author held the event's privilege,
-- not whether the event belonged on that stream, so an organization's
-- events (RoleDefined, MemberAdded, InviteIssued) could be written into a
-- language's stream by someone holding the privilege there, past the grant
-- checks that run only on the organization stream, and a language's events
-- into the organization stream. The folds ignore foreign types, so these
-- did nothing yet; any later fold or report that read them would have
-- believed them. Now a signed-in caller's organization events go only on
-- `_org`, everything else only on a language's stream, and a redaction on
-- either. _org_event_types is core's ORG_EVENT_TYPES
-- (packages/core/src/org.ts); scripts/record-parity-sql.ts holds them
-- together.
--
-- append_events is restated whole, as `create or replace`, from
-- 20261016040000_event_size_and_org_quota.sql's.

create or replace function public._org_event_types()
returns text[] language sql immutable set search_path = '' as $$
  select array['v1.OrgCreated', 'v1.OrgRenamed', 'v1.RoleDefined', 'v1.RoleRetired', 'v1.MemberAdded', 'v1.MemberRemoved', 'v1.InviteIssued', 'v1.InviteRedeemed', 'v1.JoinDecided', 'v1.LicenseSet', 'v1.LanguageAdded', 'v1.LanguageRenamed', 'v1.LanguageCodeSet', 'v1.LanguageCountrySet', 'v1.LanguageTargetSet', 'v1.ClusterNamed', 'v1.LanguageClusterSet', 'v1.ReferenceRecommended', 'v1.LibraryItemDefined', 'v1.LibraryVersionPublished', 'v1.LibrarySharingSet', 'v1.LibraryItemArchived', 'v1.LibrarySubscribed', 'v1.LibraryPinned'];
$$;

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
