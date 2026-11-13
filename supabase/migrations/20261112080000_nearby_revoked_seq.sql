-- A revocation list's number only goes up (security review, 2026-11-10;
-- docs/nearby-sync-plan.md 5.12, Revocation; decision 222).
--
-- A new row's seq was max(seq) + 1, and revocations go with a deleted account
-- (on delete cascade, 20261112050000_nearby_join.sql), so when the deleted
-- person held the newest numbers the next revocation reused one. Phones take a
-- list only above the seq they hold, so every phone that held the old list
-- ignored the new one, and a stolen phone's key went on passing Hello there.
-- The number now comes from a counter per organization that deletion never
-- touches; the rows still go with the account, so nothing more is kept.
-- A list may now skip numbers, which phones never assume it does not.

create table public.install_key_revocation_seqs (
  org_id text primary key,
  seq bigint not null check (seq >= 1)
);
alter table public.install_key_revocation_seqs enable row level security;
revoke all on table public.install_key_revocation_seqs from public, anon, authenticated;
grant all on table public.install_key_revocation_seqs to service_role;

insert into public.install_key_revocation_seqs (org_id, seq)
select r.org_id, max(r.seq) from public.install_key_revocations r group by r.org_id;

-- Every row's seq raises its organization's counter, however the row is
-- written (a smoke writes some directly), and a deletion lowers nothing.
create function public._revocation_seq_kept()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.install_key_revocation_seqs as s (org_id, seq) values (new.org_id, new.seq)
  on conflict (org_id) do update set seq = greatest(s.seq, excluded.seq);
  return null;
end $$;
revoke all on function public._revocation_seq_kept() from public, anon, authenticated;
create trigger install_key_revocations_seq_kept after insert on public.install_key_revocations
  for each row execute function public._revocation_seq_kept();

-- An organization's list number: the highest it has ever had.
create function public._revoked_seq(p_org text)
returns bigint language sql stable security definer set search_path = '' as $$
  select greatest(
    coalesce((select s.seq from public.install_key_revocation_seqs s where s.org_id = p_org), 0),
    coalesce((select max(r.seq) from public.install_key_revocations r where r.org_id = p_org), 0));
$$;
revoke all on function public._revoked_seq(text) from public, anon, authenticated;
grant execute on function public._revoked_seq(text) to service_role;

-- Restated from 20261112030000_nearby_relay.sql: the seq is one past
-- _revoked_seq, under the same lock, and a pair already listed takes no number.
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
      continue when exists (select 1 from public.install_key_revocations r
                            where r.org_id = v_org and r.public_key = v_key and r.profile_id = p_profile);
      insert into public.install_key_revocations (org_id, seq, public_key, profile_id, revoked_at)
      values (v_org, public._revoked_seq(v_org) + 1, v_key, p_profile, v_at);
    end loop;
  end loop;
  return cardinality(v_keys);
end $$;

-- Restated from 20261112050000_nearby_join.sql: `revokedSeq` is _revoked_seq.
create or replace function public.nearby_certificate_facts(p_profile text, p_install text, p_key text, p_languages text[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_profile uuid;
  v_pid text; -- the account id as org_memberships holds it
  v_orgs text[];
  v_org text;
  v_lang text;
  v_keys jsonb;
  v_passes jsonb;
  v_joins boolean;
  v_held text[];
  v_roles jsonb;
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
    v_passes := '[]';
    v_joins := public._org_joins_on(v_org);
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

      v_held := public.org_privileges(v_org, v_pid, v_lang);
      if v_joins and 'invite_members' = any (v_held) then
        select coalesce(jsonb_agg(jsonb_build_object(
                 'roleId', r.role_id, 'privileges', to_jsonb(array(select distinct p from unnest(r.privileges) p order by p)))
                 order by r.role_id collate "C"), '[]')
          into v_roles
          from public.org_roles r
         where r.org_id = v_org and not r.retired and cardinality(r.privileges) > 0
           and not (r.privileges && public._manage_privileges())
           and r.privileges <@ v_held;
        if jsonb_array_length(v_roles) > 0 then
          v_passes := v_passes || jsonb_build_array(jsonb_build_object(
            'languageId', v_lang,
            'held', to_jsonb(array(select distinct p from unnest(v_held) p order by p)),
            'roles', v_roles));
        end if;
      end if;
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
      'passes', v_passes,
      'revokedSeq', public._revoked_seq(v_org),
      'revocations', (select coalesce(jsonb_agg(jsonb_build_object(
                          'seq', k.seq, 'publicKey', k.public_key, 'profileId', k.profile_id::text,
                          'revokedAtMs', floor(extract(epoch from k.revoked_at) * 1000)::bigint) order by k.seq), '[]')
                      from public.install_key_revocations k
                      where k.org_id = v_org and k.revoked_at > now() - interval '1 year')));
  end loop;
  return jsonb_build_object('revoked', false, 'limited', false, 'orgs', v_out);
end $$;

-- Restated from 20261112010000_nearby_identity.sql: `nearbyRevokedSeq` reads
-- _revoked_seq, so an organization whose rows all went still says its number.
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
      select jsonb_object_agg(o.org_id, public._revoked_seq(o.org_id)) from (
        select s.org_id from public.install_key_revocation_seqs s
        union
        select k.org_id from public.install_key_revocations k) o
      where public._org_feature_on(o.org_id, 'nearby')
        and exists (select 1 from public.org_memberships m
                    where m.org_id = o.org_id and m.profile_id = public.caller_id() and not m.removed)), '{}'::jsonb));
$$;
