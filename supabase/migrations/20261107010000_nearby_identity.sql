-- Nearby sync's identity and its flag (docs/nearby-sync-plan.md 5.5, 5.10,
-- 5.12 "The server's names" and "Generations", phase 2). Staff turn nearby on
-- one organization at a time (org_features, off by default); an install's
-- Ed25519 key is kept per person (install_keys) for the Worker's certificate
-- call (nearby_certificate_facts), with section 6's cap columns and a
-- revocation list for phase 4; each language's discovery key rotates as a
-- one-way hash chain of generations, made lazily; a phone asks what the
-- server holds of ids it keeps for teammates (known_events); get_user_state
-- says which features each of the caller's organizations has on; and
-- append_events refuses an id that names another author (5.4, Bound ids).
-- Every function a store build calls keeps its results (decisions.md 151,
-- 152): get_user_state only gains fields, and append_events changes only for
-- ids carrying `by:`, which no build before this one minted.

-- ---- the flag: staff turn a feature on for an organization -------------------------

create table public.org_features (
  org_id text not null,
  -- 'nearby': the exchange between phones. 'nearby_join': joining offline, granted
  -- separately and used only while 'nearby' is on too (5.10).
  feature text not null check (feature in ('nearby', 'nearby_join')),
  granted_at timestamptz not null default now(),
  granted_by text not null check (length(btrim(granted_by)) between 1 and 200),
  -- Kept once revoked, so the history stays.
  revoked_at timestamptz,
  revoked_by text check (revoked_by is null or length(revoked_by) between 1 and 200),
  check ((revoked_at is null) = (revoked_by is null)),
  primary key (org_id, feature)
);
alter table public.org_features enable row level security;
revoke all on table public.org_features from public, anon, authenticated;
grant all on table public.org_features to service_role;

-- Is this feature on for this organization now?
create or replace function public._org_feature_on(p_org text, p_feature text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.org_features f where f.org_id = p_org and f.feature = p_feature and f.revoked_at is null);
$$;

-- 'granted', 'no_org' or 'say_who'. Granting again turns a revoked feature back on.
create or replace function public.org_feature_grant(p_org text, p_feature text, p_by text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(btrim(p_by), '') = '' then return 'say_who'; end if;
  if public.org_name(p_org) is null then return 'no_org'; end if;
  insert into public.org_features (org_id, feature, granted_by) values (p_org, p_feature, btrim(p_by))
  on conflict (org_id, feature) do update set granted_at = now(), granted_by = excluded.granted_by, revoked_at = null, revoked_by = null;
  return 'granted';
end $$;

-- 'revoked', 'not_granted' or 'say_who'. Phones drop their certificates and keys the next time they reach the server.
create or replace function public.org_feature_revoke(p_org text, p_feature text, p_by text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(btrim(p_by), '') = '' then return 'say_who'; end if;
  update public.org_features set revoked_at = now(), revoked_by = btrim(p_by)
  where org_id = p_org and feature = p_feature and revoked_at is null;
  return case when found then 'revoked' else 'not_granted' end;
end $$;

-- Every grant, live or revoked, with its organization's name.
create or replace function public.org_feature_list()
returns table (org_id text, org_name text, feature text, granted_at timestamptz, granted_by text, revoked_at timestamptz, revoked_by text)
language sql stable security definer set search_path = '' as $$
  select f.org_id, public.org_name(f.org_id), f.feature, f.granted_at, f.granted_by, f.revoked_at, f.revoked_by
  from public.org_features f order by f.granted_at desc, f.org_id, f.feature;
$$;

-- ---- install keys -------------------------------------------------------------------

-- One install's key for one person. A shared phone's key serves several people,
-- so the key alone is not unique. `install_id` is the phone's deviceId, a label
-- with no uniqueness (5.12). Rows go with the account (on delete cascade), so
-- _delete_account needs no change. Phones never read this table.
create table public.install_keys (
  public_key text not null check (public_key ~ '^[A-Za-z0-9_-]{43}$'), -- an Ed25519 public key, base64url
  profile_id uuid not null references auth.users (id) on delete cascade,
  install_id text not null check (length(install_id) between 1 and 256),
  created_at timestamptz not null default now(),
  last_certified_at timestamptz not null default now(),
  -- When a bearer token for this person first reached the certificate call: after
  -- it, proof of this key signs nobody in (phase 6, decision 75 as amended).
  first_session_at timestamptz,
  revoked_at timestamptz,
  revoked_by text check (revoked_by is null or length(revoked_by) between 1 and 200),
  -- Section 6's cap on what a revoked key may still deliver (Carl's answer 16):
  -- counted one by one by the relay (phase 4), and raised only by staff.
  after_revoked_events int not null default 0 check (after_revoked_events >= 0),
  after_revoked_bytes bigint not null default 0 check (after_revoked_bytes >= 0),
  after_revoked_events_limit int not null default 50000 check (after_revoked_events_limit >= 0),
  after_revoked_bytes_limit bigint not null default 104857600 check (after_revoked_bytes_limit >= 0),
  after_revoked_raised_by text check (after_revoked_raised_by is null or length(after_revoked_raised_by) between 1 and 200),
  check ((revoked_at is null) = (revoked_by is null)),
  primary key (public_key, profile_id)
);
create index install_keys_profile_idx on public.install_keys (profile_id, created_at);
alter table public.install_keys enable row level security;
revoke all on table public.install_keys from public, anon, authenticated;
grant all on table public.install_keys to service_role;

-- The revocation list, one row per organization of the person whose key was
-- revoked, with `seq` per organization (5.12, section 6). Its own table, since a
-- list worked out from current memberships would shrink when someone is
-- removed. Written by revoke_install_keys (phase 4); pairs, not bare keys, so
-- another person on a shared phone is not refused.
create table public.install_key_revocations (
  org_id text not null,
  seq bigint not null check (seq >= 1),
  public_key text not null check (public_key ~ '^[A-Za-z0-9_-]{43}$'),
  profile_id uuid not null references auth.users (id) on delete cascade,
  revoked_at timestamptz not null default now(),
  primary key (org_id, seq),
  unique (org_id, public_key, profile_id)
);
create index install_key_revocations_profile_idx on public.install_key_revocations (profile_id);
alter table public.install_key_revocations enable row level security;
revoke all on table public.install_key_revocations from public, anon, authenticated;
grant all on table public.install_key_revocations to service_role;

-- ---- discovery keys: generations of a one-way hash chain ----------------------------

-- key(g - 1) = SHA-256(utf8('lq-nearby-gen-v1') || key(g)), and key(top) = seed,
-- so a key opens every generation below it and none above (5.12, Generations;
-- Carl's answer 13). Core's twin is packages/core/src/nearbyGenerations.ts, held
-- to this by a golden vector in scripts/record-parity-sql.ts.
create table public.language_discovery_chains (
  org_id text not null,
  language_id text not null,
  top int not null check (top >= 1),
  seed bytea not null check (octet_length(seed) = 32),
  primary key (org_id, language_id)
);
alter table public.language_discovery_chains enable row level security;
revoke all on table public.language_discovery_chains from public, anon, authenticated;
grant all on table public.language_discovery_chains to service_role;

create table public.language_discovery_keys (
  org_id text not null,
  language_id text not null,
  generation int not null check (generation >= 1),
  key bytea not null check (octet_length(key) = 32),
  -- The organization stream's newest seq when this generation was made: a removal
  -- above it covering the language makes the next one due.
  org_seq bigint not null,
  created_at timestamptz not null default now(),
  primary key (org_id, language_id, generation),
  foreign key (org_id, language_id) references public.language_discovery_chains (org_id, language_id)
);
alter table public.language_discovery_keys enable row level security;
revoke all on table public.language_discovery_keys from public, anon, authenticated;
grant all on table public.language_discovery_keys to service_role;

-- A key hashed down `p_steps` generations.
create or replace function public._discovery_key_below(p_key bytea, p_steps int)
returns bytea language plpgsql immutable strict set search_path = '' as $$
declare
  v bytea := p_key;
  v_label constant bytea := convert_to('lq-nearby-gen-v1', 'UTF8');
begin
  for i in 1 .. p_steps loop
    v := sha256(v_label || v);
  end loop;
  return v;
end $$;

-- A language's newest generation, making the chain and a generation when they
-- are due. Called only from nearby_certificate_facts, for a language a phone
-- named: no trigger on the append path. The newest is due when it is over 90
-- days old, when a v1.MemberRemoved on the organization stream above its
-- org_seq covers the organization or this language, or when a revocation in
-- this organization came after it. A due row only a day old or less waits, so
-- there is at most one generation a day. Two calls at once work out the same
-- key and `on conflict do nothing` keeps one. It compares server seqs, not
-- removal clocks, since those are the admin's.
create or replace function public._discovery_generation(p_org text, p_language text)
returns public.language_discovery_keys language plpgsql security definer set search_path = '' as $$
declare
  v_chain public.language_discovery_chains;
  v_newest public.language_discovery_keys;
  v_org_seq bigint := coalesce((select c.next_seq - 1 from public.stream_cursors c where c.org_id = p_org and c.stream_id = '_org'), 0);
begin
  insert into public.language_discovery_chains (org_id, language_id, top, seed)
  values (p_org, p_language, 10000, extensions.gen_random_bytes(32))
  on conflict do nothing;
  select * into strict v_chain from public.language_discovery_chains d where d.org_id = p_org and d.language_id = p_language;

  select * into v_newest from public.language_discovery_keys k
  where k.org_id = p_org and k.language_id = p_language order by k.generation desc limit 1;
  if not found then
    insert into public.language_discovery_keys (org_id, language_id, generation, key, org_seq)
    values (p_org, p_language, 1, public._discovery_key_below(v_chain.seed, v_chain.top - 1), v_org_seq)
    on conflict do nothing;
  elsif v_newest.created_at < now() - interval '1 day' and v_newest.generation < v_chain.top and (
       v_newest.created_at < now() - interval '90 days'
    or exists (select 1 from public.events e
               where e.org_id = p_org and e.stream_id = '_org' and e.type = 'v1.MemberRemoved' and e.server_seq > v_newest.org_seq
                 and (e.payload->'scope'->>'level' = 'org'
                      or (e.payload->'scope'->>'level' = 'language' and e.payload->'scope'->>'languageId' = p_language)))
    or exists (select 1 from public.install_key_revocations r where r.org_id = p_org and r.revoked_at > v_newest.created_at)
  ) then
    insert into public.language_discovery_keys (org_id, language_id, generation, key, org_seq)
    values (p_org, p_language, v_newest.generation + 1,
            public._discovery_key_below(v_chain.seed, v_chain.top - (v_newest.generation + 1)), v_org_seq)
    on conflict do nothing;
  end if;

  select * into v_newest from public.language_discovery_keys k
  where k.org_id = p_org and k.language_id = p_language order by k.generation desc limit 1;
  return v_newest;
end $$;

-- ---- the certificate call's facts (the Worker, as the service role) -------------------

-- What the Worker's POST /api/nearby/certificate signs, in one transaction
-- (5.12). The Worker has checked the bearer token and the proof of key.
--
-- It reads for a revoked row first, then marks every one of this person's keys
-- as past their first session, before any feature check, because a bearer token
-- is a session. A revoked key answers { "revoked": true }. Otherwise it finds
-- the organizations with `nearby` on where the person has a live membership;
-- with none it answers no organizations and adds no row, so open sign-up cannot
-- add rows. With some, it keeps the key: a known key is refreshed, and a new one
-- counts against 5 new keys per person in 24 hours ({ "limited": true } past
-- that, which the Worker answers with 429; nothing is evicted). Then per
-- organization: the organization stream's newest seq, the features on, the
-- person's scopes with resolved privileges, the newest discovery generation and
-- its floor for each language the phone named (`<orgId>/<languageId>`, decision
-- 37) that the person may read, and the revocation list of the last year with
-- the list's highest seq. Keys are hex.
create or replace function public.nearby_certificate_facts(p_profile text, p_install text, p_key text, p_languages text[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_profile uuid;
  v_pid text; -- the account id as org_memberships holds it
  v_orgs text[];
  v_org text;
  v_lang text;
  v_keys jsonb;
  v_newest public.language_discovery_keys;
  v_out jsonb := '[]';
begin
  if p_profile is null or p_profile !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'p_profile must be an account id' using errcode = '22023';
  end if;
  if p_key is null or p_key !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'p_key must be an Ed25519 public key in base64url' using errcode = '22023';
  end if;
  if p_install is null or length(p_install) not between 1 and 256 then
    raise exception 'p_install must be 1 to 256 characters' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_languages), 0) > 500 then
    raise exception 'too many languages: % (max 500)', cardinality(p_languages) using errcode = '22023';
  end if;
  v_profile := p_profile::uuid;
  v_pid := v_profile::text;

  if exists (select 1 from public.install_keys k where k.public_key = p_key and k.profile_id = v_profile and k.revoked_at is not null) then
    update public.install_keys k set first_session_at = now() where k.profile_id = v_profile and k.first_session_at is null;
    return jsonb_build_object('revoked', true);
  end if;
  update public.install_keys k set first_session_at = now() where k.profile_id = v_profile and k.first_session_at is null;

  select coalesce(array_agg(o.org_id order by o.org_id), '{}') into v_orgs
  from (select distinct m.org_id from public.org_memberships m
        where m.profile_id = v_pid and not m.removed and public._org_feature_on(m.org_id, 'nearby')) o;
  if cardinality(v_orgs) = 0 then
    return jsonb_build_object('revoked', false, 'limited', false, 'orgs', '[]'::jsonb);
  end if;

  -- One person's new keys are counted one call at a time.
  perform pg_advisory_xact_lock(hashtext('install_keys:' || v_pid));
  update public.install_keys k set last_certified_at = now(), install_id = p_install
  where k.public_key = p_key and k.profile_id = v_profile and k.revoked_at is null;
  if not found then
    -- Revoked meanwhile, or new.
    if exists (select 1 from public.install_keys k where k.public_key = p_key and k.profile_id = v_profile) then
      return jsonb_build_object('revoked', true);
    end if;
    if (select count(*) from public.install_keys k where k.profile_id = v_profile and k.created_at > now() - interval '24 hours') >= 5 then
      return jsonb_build_object('revoked', false, 'limited', true, 'orgs', '[]'::jsonb);
    end if;
    insert into public.install_keys (public_key, profile_id, install_id, first_session_at)
    values (p_key, v_profile, p_install, now());
  end if;

  foreach v_org in array v_orgs loop
    v_keys := '[]';
    for v_lang in
      select distinct substr(l, length(v_org) + 2) from unnest(p_languages) l
      where left(l, length(v_org) + 1) = v_org || '/' order by 1
    loop
      continue when v_lang = '' or v_lang = '_org' or strpos(v_lang, '/') > 0
        or not public.language_listed(v_org, v_lang)
        or cardinality(public.org_privileges(v_org, v_pid, v_lang)) = 0;
      v_newest := public._discovery_generation(v_org, v_lang);
      v_keys := v_keys || jsonb_build_array(jsonb_build_object(
        'languageId', v_lang,
        'gen', v_newest.generation,
        'floor', (select coalesce(max(k.generation), 1) from public.language_discovery_keys k
                  where k.org_id = v_org and k.language_id = v_lang and k.created_at <= now() - interval '1 year'),
        'key', encode(v_newest.key, 'hex')));
    end loop;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'orgId', v_org,
      'orgSeq', coalesce((select c.next_seq - 1 from public.stream_cursors c where c.org_id = v_org and c.stream_id = '_org'), 0),
      'features', (select coalesce(jsonb_agg(f.feature order by f.feature), '[]') from public.org_features f
                   where f.org_id = v_org and f.revoked_at is null),
      'scopes', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                     'level', m.scope_level, 'languageId', m.language_id, 'roleId', m.role_id,
                     'privileges', to_jsonb(array(select distinct p from unnest(r.privileges) p order by p))))
                   order by m.scope_key), '[]')
                 from public.org_memberships m
                 join public.org_roles r on r.org_id = m.org_id and r.role_id = m.role_id and not r.retired
                 where m.org_id = v_org and m.profile_id = v_pid and not m.removed),
      'discoveryKeys', v_keys,
      'revokedSeq', coalesce((select max(k.seq) from public.install_key_revocations k where k.org_id = v_org), 0),
      'revocations', (select coalesce(jsonb_agg(jsonb_build_object(
                          'seq', k.seq, 'publicKey', k.public_key, 'profileId', k.profile_id::text,
                          'revokedAtMs', floor(extract(epoch from k.revoked_at) * 1000)::bigint) order by k.seq), '[]')
                      from public.install_key_revocations k
                      where k.org_id = v_org and k.revoked_at > now() - interval '1 year')));
  end loop;
  return jsonb_build_object('revoked', false, 'limited', false, 'orgs', v_out);
end $$;

-- ---- what the server holds of some ids (a phone's sweep, 5.7) -----------------------

-- Each of these ids the server holds in this stream, with its seq, clock and
-- author. An id in another stream is not in the answer, so none leaks. At most
-- 500 ids, as a push takes.
create or replace function public.known_events(p_org text, p_stream text, p_ids text[])
returns table (id text, server_seq bigint, hlc text, actor_id text)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is null or not public.can_read_stream(p_org, p_stream, v_actor) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_ids), 0) > 500 then
    raise exception 'too many ids: % (max 500); page the request', cardinality(p_ids) using errcode = '22023';
  end if;
  return query
    select e.id, e.server_seq, e.hlc, e.actor_id from public.events e
    where e.id = any (p_ids) and e.org_id = p_org and e.stream_id = p_stream;
end $$;

-- ---- get_user_state: which features each of my organizations has on -----------------

-- Restated from 20261022210000_global_viewers.sql with two fields more (5.10,
-- 5.12): `orgFeatures`, { "<orgId>": ["nearby", "nearby_join"] } for the
-- caller's organizations with any feature on, and `nearbyRevokedSeq`,
-- { "<orgId>": seq } for those with nearby on and a revocation list, so a phone
-- behind it asks for a certificate at once. Builds before these read only the
-- fields they know.
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
    'globalViewer', public._gv_state(public.caller_id()),
    'orgFeatures', coalesce((
      select jsonb_object_agg(o.org_id, o.features) from (
        select f.org_id, jsonb_agg(f.feature order by f.feature) as features
        from public.org_features f
        where f.revoked_at is null
          and exists (select 1 from public.org_memberships m
                      where m.org_id = f.org_id and m.profile_id = public.caller_id() and not m.removed)
        group by f.org_id) o), '{}'::jsonb),
    'nearbyRevokedSeq', coalesce((
      select jsonb_object_agg(r.org_id, r.seq) from (
        select k.org_id, max(k.seq) as seq
        from public.install_key_revocations k
        where public._org_feature_on(k.org_id, 'nearby')
          and exists (select 1 from public.org_memberships m
                      where m.org_id = k.org_id and m.profile_id = public.caller_id() and not m.removed)
        group by k.org_id) r), '{}'::jsonb));
$$;

-- ---- bound ids (5.4) ------------------------------------------------------------------

-- Whose id this is, or null when it names nobody: core idAuthor
-- (packages/core/src/validate.ts), held to it by scripts/record-parity-sql.ts.
-- New builds mint `by:<actorId>:<random>`; terms may come in front
-- (`take:by:...`), and a key under a key term reads from after the term, which
-- is shared by design (decision 75).
create or replace function public._id_author(p_id text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select (regexp_match(regexp_replace(p_id, '^(?:rendering|adjustment):[^/]*/', ''), '^(?:(?!by:)[a-z]+:)*by:([^:]+):'))[1];
$$;

-- Restated from 20261026200000_write_allowance_and_scoped_reads.sql with one
-- rule more, after "actorId does not match caller" and before the id lookup:
-- for a caller, an event id or the id a create makes that names another author
-- (`by:<x>:` with x not the event's actorId) is refused as a malformed
-- envelope, so a teammate holding Sam's ids from a nearby exchange cannot take
-- them first. `by:` is reserved from here on; any other id behaves as before,
-- so store builds keep their results (decision 152). The service role's
-- imports are its own, as for the other per-caller checks.
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

    -- An id that names its author names this one (docs/nearby-sync-plan.md 5.4, Bound ids).
    if v_actor is not null and (
         coalesce(public._id_author(v_id), v_actor) <> v_actor
      or coalesce(public._id_author(public._entity_key(v_type, ev->'payload')), v_actor) <> v_actor) then
      id := v_id; accepted := false; server_seq := null; reason := 'malformed envelope: id names someone else';
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

-- ---- grants ---------------------------------------------------------------------------

-- New functions default open to every API role: the helpers, the staff
-- functions and the Worker's facts are the service role's alone; known_events
-- checks its caller itself.
revoke all on function public._org_feature_on(text, text) from public, anon, authenticated;
revoke all on function public.org_feature_grant(text, text, text) from public, anon, authenticated;
revoke all on function public.org_feature_revoke(text, text, text) from public, anon, authenticated;
revoke all on function public.org_feature_list() from public, anon, authenticated;
revoke all on function public._discovery_key_below(bytea, int) from public, anon, authenticated;
revoke all on function public._discovery_generation(text, text) from public, anon, authenticated;
revoke all on function public.nearby_certificate_facts(text, text, text, text[]) from public, anon, authenticated;
revoke all on function public._id_author(text) from public, anon, authenticated;
grant execute on function public._org_feature_on(text, text) to service_role;
grant execute on function public.org_feature_grant(text, text, text) to service_role;
grant execute on function public.org_feature_revoke(text, text, text) to service_role;
grant execute on function public.org_feature_list() to service_role;
grant execute on function public._discovery_key_below(bytea, int) to service_role;
grant execute on function public._discovery_generation(text, text) to service_role;
grant execute on function public.nearby_certificate_facts(text, text, text, text[]) to service_role;
grant execute on function public._id_author(text) to service_role;
revoke all on function public.known_events(text, text, text[]) from public, anon;
grant execute on function public.known_events(text, text, text[]) to authenticated;
