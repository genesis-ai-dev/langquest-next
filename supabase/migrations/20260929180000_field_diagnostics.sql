-- Field diagnostics (docs/diagnostics.md, docs/decisions.md 39).
--
-- Phones deliver small, content-free records of how sync, snapshots, blob
-- transfers and errors behaved (packages/client/src/diagnostics.ts). They
-- are not events: they never fold, are not scripture work, and are deleted
-- after 90 days, which the append-only log cannot do.
--
-- Everything lives in schema `diag`, which PostgREST does not expose
-- (supabase/config.toml [api] schemas). Phones reach it only through
-- `public.diag_ingest`. Support, and Claude on support's behalf, read it
-- as `diag_reader`: the diag tables plus the report functions below, which
-- return ids, counts and timings, never payloads, names of people, emails
-- or audio.

create schema if not exists diag;
revoke all on schema diag from public, anon, authenticated;

-- ---- the allowlist -------------------------------------------------------

-- The twin of DIAG_SCHEMA and DIAG_CONTEXT in packages/client/src/diagnostics.ts;
-- scripts/diagSchema.test.ts holds them equal. Change both together.
create or replace function diag.schema() returns jsonb language sql immutable as $$
select
-- diag-schema:begin
'{"kinds":{"sync":{"n":["ms","pushNetMs","pullNetMs","applyMs","pushed","rejected","pulled","pages","pending","offlineMs"],"t":{"outcome":["ok","offline","refused","too_old","error"],"error":"token"}},"load":{"n":["ms","events","fromSnapshot"],"t":{}},"snapshot":{"n":["ms","chunks","resumedChunks","bytes","seq"],"t":{"outcome":["ok","none","stale"]}},"transfer":{"n":["count","bytes","ms","maxMs","signMs","fetchMs","verifyMs","failOffline","failHttp4xx","failHttp5xx","failHash","failDisk","failOther"],"t":{"dir":["up","down"]}},"device":{"n":["freeDiskMb","totalDiskMb","blobCacheMb","blobsWanted"],"t":{}},"error":{"n":[],"t":{"name":"token","where":"token","errorId":"token","fatal":["yes","no"]}}},"context":["installId","os","osVersion","model","appVersion","runtimeVersion","updateId","channel","embedded","reducerVersion","protocolVersion"]}'
-- diag-schema:end
::jsonb
$$;

-- Same pattern as DIAG_TOKEN: code-like text, no @, quotes or commas.
create or replace function diag.is_token(p text) returns boolean language sql immutable as $$
  select p is not null and p ~ '^[A-Za-z0-9 _.:()/#-]{1,80}$'
$$;

-- Apply the allowlist to one record, as sanitizeDiag does on the phone.
-- Null when the record is not one we keep.
create or replace function diag.clean(p_record jsonb) returns jsonb
language plpgsql immutable as $$
declare
  v_kind text := p_record->>'kind';
  v_spec jsonb := diag.schema()->'kinds'->v_kind;
  v_n jsonb := '{}';
  v_t jsonb := '{}';
  v_key text;
  v_allowed jsonb;
  v_val jsonb;
  v_stack text;
  v_out jsonb;
begin
  if v_spec is null or not diag.is_token(p_record->>'id') or jsonb_typeof(p_record->'at') is distinct from 'number' then
    return null;
  end if;
  -- Milliseconds since 1970, inside what timestamptz holds.
  if (p_record->>'at')::numeric not between 0 and 1e14 then return null; end if;
  for v_key in select jsonb_array_elements_text(v_spec->'n') loop
    v_val := p_record->'n'->v_key;
    if jsonb_typeof(v_val) = 'number' then
      v_n := v_n || jsonb_build_object(v_key, round(greatest(-1e12, least(1e12, v_val::text::numeric))));
    end if;
  end loop;
  for v_key, v_allowed in select key, value from jsonb_each(v_spec->'t') loop
    v_val := p_record->'t'->v_key;
    if jsonb_typeof(v_val) = 'string' and (
      (v_allowed = '"token"'::jsonb and diag.is_token(v_val #>> '{}'))
      or (jsonb_typeof(v_allowed) = 'array' and v_allowed ? (v_val #>> '{}'))
    ) then
      v_t := v_t || jsonb_build_object(v_key, v_val);
    end if;
  end loop;
  v_out := jsonb_build_object('id', p_record->'id', 'kind', v_kind, 'at', round((p_record->>'at')::numeric), 'n', v_n, 't', v_t);
  if diag.is_token(p_record->>'orgId') then
    v_out := v_out || jsonb_build_object('orgId', p_record->'orgId');
    if diag.is_token(p_record->>'projectId') then
      v_out := v_out || jsonb_build_object('projectId', p_record->'projectId');
    end if;
  end if;
  -- Frames only (the message line can carry what someone typed), paths cut to file names.
  if v_kind = 'error' and jsonb_typeof(p_record->'stack') = 'string' then
    select string_agg(regexp_replace(l, '(?:[A-Za-z]+://)?(?:/[^/\s():]+)+/([^/\s():]+)', '\1', 'g'), E'\n' order by i)
      into v_stack
      from (
        select btrim(s.l) as l, s.i
        from regexp_split_to_table(left(p_record->>'stack', 8000), E'\n') with ordinality as s(l, i)
        where btrim(s.l) ~ '^at \S' or btrim(s.l) ~ '^[\w$.<>]*@\S+:\d+:\d+$'
        order by s.i
        limit 40
      ) f;
    if v_stack is not null then v_out := v_out || jsonb_build_object('stack', v_stack); end if;
  end if;
  return v_out;
end $$;

-- ---- storage -------------------------------------------------------------

-- One row per install (the event envelope's deviceId: random, per install,
-- already on every event this phone pushed). `profile_id` is the account
-- that last delivered from it; on a shared phone (decision 11) records may
-- have been captured under someone else.
create table if not exists diag.installs (
  install_id text primary key,
  profile_id text not null,
  context jsonb not null default '{}',
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  day_start date not null default current_date,
  day_count int not null default 0
);
create index if not exists diag_installs_profile_idx on diag.installs (profile_id);

create table if not exists diag.records (
  id text primary key,
  install_id text not null,
  delivered_by text not null,
  org_id text,
  project_id text,
  kind text not null,
  -- The phone's wall clock at capture. Compare with received_at: a record
  -- from the future says the phone's clock runs ahead.
  at timestamptz not null,
  received_at timestamptz not null default now(),
  update_id text,
  n jsonb not null default '{}',
  t jsonb not null default '{}',
  stack text
);
create index if not exists diag_records_partition_idx on diag.records (org_id, project_id, at desc);
create index if not exists diag_records_install_idx on diag.records (install_id, at desc);
create index if not exists diag_records_received_idx on diag.records (received_at);
create index if not exists diag_records_error_idx on diag.records ((t->>'errorId')) where kind = 'error';

-- Names of orgs and languages, for diag.find; the org partition only.
create index if not exists events_org_names_idx on public.events (type, org_id) where project_id = '_org';

-- Delete what is past retention, a bounded amount per call.
create or replace function diag.prune(p_limit int default 1000) returns int
language plpgsql security definer set search_path = diag, pg_catalog as $$
declare v_n int;
begin
  delete from diag.records where id in (
    select id from diag.records where received_at < now() - interval '90 days' order by received_at limit p_limit
  );
  get diagnostics v_n = row_count;
  delete from diag.installs where install_id in (
    select install_id from diag.installs where last_seen < now() - interval '180 days' limit p_limit
  );
  return v_n;
end $$;

-- A record may name an org only if the delivering account belongs to it, so
-- nobody can file diagnostics under someone else's organization.
create or replace function diag.may_tag(p_profile text, p_org text) returns boolean
language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (select 1 from public.org_memberships m where m.org_id = p_org and m.profile_id = p_profile and not m.removed)
      or exists (select 1 from public.memberships m where m.org_id = p_org and m.profile_id = p_profile and not m.removed)
$$;

-- ---- the one door in ------------------------------------------------------

-- Records a phone kept while offline, oldest first, at most 200 per call.
-- Idempotent by record id, so a resend after a dropped link is harmless.
-- Returns how many were new. Capped at 5000 records per install per day.
create or replace function public.diag_ingest(p_context jsonb, p_records jsonb)
returns int
language plpgsql security definer set search_path = public, diag, pg_catalog as $$
declare
  v_actor text := public.caller_id();
  v_install text := p_context->>'installId';
  v_context jsonb := '{}';
  v_key text;
  v_record jsonb;
  v_clean jsonb;
  v_org text;
  v_project text;
  v_inserted int := 0;
  v_row int;
  v_day_count int;
begin
  if v_actor is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not diag.is_token(v_install) or length(v_install) > 64 then
    raise exception 'invalid payload: installId' using errcode = '22023';
  end if;
  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) > 200 then
    raise exception 'invalid payload: at most 200 records' using errcode = '22023';
  end if;
  for v_key in select jsonb_array_elements_text(diag.schema()->'context') loop
    if diag.is_token(p_context->>v_key) then
      v_context := v_context || jsonb_build_object(v_key, p_context->>v_key);
    end if;
  end loop;

  insert into diag.installs as i (install_id, profile_id, context)
  values (v_install, v_actor, v_context)
  on conflict (install_id) do update set
    profile_id = excluded.profile_id,
    context = excluded.context,
    last_seen = now(),
    day_start = current_date,
    day_count = case when i.day_start = current_date then i.day_count else 0 end
  returning day_count into v_day_count;
  if v_day_count >= 5000 then return 0; end if;

  for v_record in select value from jsonb_array_elements(p_records) loop
    continue when length(v_record::text) > 8192;
    v_clean := diag.clean(v_record);
    continue when v_clean is null;
    v_org := v_clean->>'orgId';
    v_project := v_clean->>'projectId';
    if v_org is not null and not diag.may_tag(v_actor, v_org) then
      v_org := null;
      v_project := null;
    end if;
    insert into diag.records (id, install_id, delivered_by, org_id, project_id, kind, at, update_id, n, t, stack)
    values (
      v_clean->>'id', v_install, v_actor, v_org, v_project, v_clean->>'kind',
      to_timestamp((v_clean->>'at')::numeric / 1000.0), v_context->>'updateId',
      v_clean->'n', v_clean->'t', v_clean->>'stack'
    )
    on conflict (id) do nothing;
    get diagnostics v_row = row_count;
    v_inserted := v_inserted + v_row;
  end loop;

  update diag.installs set day_count = day_count + v_inserted where install_id = v_install;
  perform diag.prune(200);
  return v_inserted;
end $$;

revoke all on function public.diag_ingest(jsonb, jsonb) from public, anon;
grant execute on function public.diag_ingest(jsonb, jsonb) to authenticated;

-- ---- reading: what support and Claude use ---------------------------------

-- Orgs and languages whose id or any past name matches, with their current name.
create or replace function diag.find(p_query text)
returns table (kind text, org_id text, project_id text, name text)
language sql stable security definer set search_path = public, pg_catalog as $$
  with names as (
    select 'org'::text as kind, e.org_id, null::text as project_id, e.payload->>'name' as name, e.hlc
      from public.events e where e.project_id = '_org' and e.type = 'v1.OrgCreated'
    union all
    select 'language', e.org_id, e.payload->>'projectId', e.payload->>'name', e.hlc
      from public.events e where e.project_id = '_org' and e.type = 'v1.ProjectRegistered'
    union all
    select 'language', e.org_id, e.payload->>'laneId', e.payload->>'name', e.hlc
      from public.events e where e.project_id = '_org' and e.type = 'v1.LaneNamed'
  ),
  hits as (
    select distinct n.kind, n.org_id, n.project_id from names n
    where n.name ilike '%' || p_query || '%' or n.org_id = p_query or n.project_id = p_query
  )
  select distinct on (n.kind, n.org_id, n.project_id) n.kind, n.org_id, n.project_id, n.name
  from names n join hits h on h.kind = n.kind and h.org_id = n.org_id and h.project_id is not distinct from n.project_id
  order by n.kind, n.org_id, n.project_id, n.hlc desc
$$;

-- The partition as a cold phone meets it: how much there is to pull,
-- whether a snapshot for its reducer exists and how far behind the tail it
-- is, how much audio, and who is in it (by role, as counts).
create or replace function diag.partition_health(p_org text, p_project text, p_reducer_version int)
returns jsonb
language sql stable security definer set search_path = public, pg_catalog as $$
  with ev as (
    select count(*) as events, coalesce(max(server_seq), 0) as "maxSeq",
           count(*) filter (where received_at > now() - interval '7 days') as "events7d",
           max(received_at) as "lastEventAt"
    from public.events where org_id = p_org and project_id = p_project
  ),
  snap as (
    select reducer_version, max(server_seq) as seq, max(created_at) as created_at
    from public.snapshots where org_id = p_org and project_id = p_project
    group by reducer_version
  ),
  blobs as (
    select count(*) as count, coalesce(sum((payload->>'size')::bigint), 0) as bytes,
           coalesce(max((payload->>'size')::bigint), 0) as "maxBytes"
    from public.events where org_id = p_org and project_id = p_project and type = 'v1.BlobStored'
  ),
  roles as (
    select coalesce(role, 'none') as role, count(*) as n from public.memberships
    where org_id = p_org and project_id = p_project and not removed group by 1
    union all
    select coalesce(role_id, 'none') || ' (' || scope_level || ' scope)', count(*) from public.org_memberships
    where org_id = p_org and not removed and (scope_level = 'org' or project_id = p_project or lane_id = p_project)
    group by 1
  )
  select jsonb_build_object(
    'events', (select to_jsonb(ev) from ev),
    'reducerVersion', p_reducer_version,
    'snapshots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reducerVersion', s.reducer_version, 'seq', s.seq, 'createdAt', s.created_at,
        'tail', (select "maxSeq" from ev) - s.seq,
        'bytes', case when s.reducer_version = p_reducer_version then (
          select length(x.state::text) from public.snapshots x
          where x.org_id = p_org and x.project_id = p_project and x.reducer_version = s.reducer_version and x.server_seq = s.seq
        ) end
      ) order by s.reducer_version desc) from snap s), '[]'::jsonb),
    'blobs', (select to_jsonb(blobs) from blobs),
    'roles', coalesce((select jsonb_object_agg(role, n) from roles), '{}'::jsonb)
  )
$$;

-- Everyone who can open the partition, by profile id only, with what their
-- phones last did: last event pushed here, which devices pushed it, and
-- whether any install of theirs has delivered diagnostics.
create or replace function diag.members(p_org text, p_project text)
returns table (profile_id text, roles text, devices text[], last_event_at timestamptz, installs text[], last_diag_at timestamptz)
language sql stable security definer set search_path = public, diag, pg_catalog as $$
  with people as (
    select m.profile_id, coalesce(m.role, 'none') as role from public.memberships m
    where m.org_id = p_org and m.project_id = p_project and not m.removed
    union
    select m.profile_id, coalesce(m.role_id, 'none') from public.org_memberships m
    where m.org_id = p_org and not m.removed and (m.scope_level = 'org' or m.project_id = p_project or m.lane_id = p_project)
  ),
  pushed as (
    select e.actor_id, array_agg(distinct e.device_id) as devices, max(e.received_at) as last_at
    from public.events e where e.org_id = p_org and e.project_id = p_project group by e.actor_id
  )
  select p.profile_id,
         string_agg(distinct p.role, ','),
         (select devices from pushed where actor_id = p.profile_id),
         (select last_at from pushed where actor_id = p.profile_id),
         (select array_agg(i.install_id order by i.last_seen desc) from diag.installs i where i.profile_id = p.profile_id),
         (select max(i.last_seen) from diag.installs i where i.profile_id = p.profile_id)
  from people p
  group by p.profile_id
  order by 4 desc nulls last
$$;

-- What each install that worked in this partition reported over the window,
-- aggregated per kind. Errors are per install, not per partition: a crash
-- is not tagged with the language that was open.
create or replace function diag.summary(p_org text, p_project text, p_since interval default interval '14 days', p_install text default null)
returns jsonb
language sql stable security definer set search_path = diag, public, pg_catalog as $$
  with scope as (
    select distinct r.install_id from diag.records r
    where r.org_id = p_org and r.project_id = p_project and r.at > now() - p_since
      and (p_install is null or r.install_id = p_install)
  ),
  r as (
    select r.* from diag.records r join scope using (install_id)
    where r.at > now() - p_since
      and ((r.org_id = p_org and r.project_id = p_project) or r.kind in ('error', 'device'))
  ),
  sync as (
    select install_id, jsonb_build_object(
      'count', count(*),
      'p50Ms', percentile_cont(0.5) within group (order by (n->>'ms')::numeric),
      'p95Ms', percentile_cont(0.95) within group (order by (n->>'ms')::numeric),
      'pushNetMs', sum((n->>'pushNetMs')::numeric), 'pullNetMs', sum((n->>'pullNetMs')::numeric),
      'applyMs', sum((n->>'applyMs')::numeric), 'pages', sum((n->>'pages')::numeric),
      'pushed', sum((n->>'pushed')::numeric), 'pulled', sum((n->>'pulled')::numeric),
      'rejected', sum((n->>'rejected')::numeric), 'maxPending', max((n->>'pending')::numeric),
      'maxOfflineMs', max((n->>'offlineMs')::numeric), 'lastAt', max(at)
    ) as j from r where kind = 'sync' group by install_id
  ),
  outcomes as (
    select install_id, jsonb_object_agg(outcome, c) as j from (
      select install_id, t->>'outcome' as outcome, count(*) as c from r where kind = 'sync' group by 1, 2
    ) x group by install_id
  ),
  transfer as (
    select install_id, jsonb_object_agg(dir, j) as j from (
      select install_id, t->>'dir' as dir, jsonb_build_object(
        'count', sum((n->>'count')::numeric), 'bytes', sum((n->>'bytes')::numeric),
        'ms', sum((n->>'ms')::numeric), 'maxMs', max((n->>'maxMs')::numeric),
        'signMs', sum((n->>'signMs')::numeric), 'fetchMs', sum((n->>'fetchMs')::numeric),
        'verifyMs', sum((n->>'verifyMs')::numeric),
        'failOffline', sum((n->>'failOffline')::numeric), 'failHttp4xx', sum((n->>'failHttp4xx')::numeric),
        'failHttp5xx', sum((n->>'failHttp5xx')::numeric), 'failHash', sum((n->>'failHash')::numeric),
        'failDisk', sum((n->>'failDisk')::numeric), 'failOther', sum((n->>'failOther')::numeric)
      ) as j from r where kind = 'transfer' group by 1, 2
    ) x group by install_id
  ),
  loads as (
    select install_id, jsonb_build_object(
      'count', count(*),
      'p50Ms', percentile_cont(0.5) within group (order by (n->>'ms')::numeric),
      'p95Ms', percentile_cont(0.95) within group (order by (n->>'ms')::numeric),
      'maxEvents', max((n->>'events')::numeric)
    ) as j from r where kind = 'load' group by install_id
  ),
  snaps as (
    select install_id, jsonb_agg(jsonb_build_object('at', at, 'outcome', t->>'outcome') || n order by at desc) as j
    from r where kind = 'snapshot' group by install_id
  ),
  device as (
    select distinct on (install_id) install_id, n || jsonb_build_object('at', at) as j
    from r where kind = 'device' order by install_id, at desc
  ),
  errors as (
    select install_id, jsonb_agg(jsonb_build_object('name', name, 'where', "where", 'count', c, 'lastErrorId', last_id, 'lastAt', last_at) order by c desc) as j from (
      select install_id, t->>'name' as name, t->>'where' as "where", count(*) as c,
             (array_agg(t->>'errorId' order by at desc))[1] as last_id, max(at) as last_at
      from r where kind = 'error' group by 1, 2, 3
    ) x group by install_id
  ),
  releases as (
    select install_id, jsonb_agg(jsonb_build_object('updateId', update_id, 'from', f, 'to', l, 'records', c) order by f) as j from (
      select install_id, update_id, min(at) as f, max(at) as l, count(*) as c from r group by 1, 2
    ) x group by install_id
  ),
  clock as (
    select install_id, round(extract(epoch from max(at - received_at))) as ahead_s
    from r group by install_id
  )
  select coalesce(jsonb_object_agg(i.install_id, jsonb_build_object(
    'profileId', i.profile_id,
    'context', i.context,
    'lastSeen', i.last_seen,
    'clockAheadS', greatest(0, (select ahead_s from clock c where c.install_id = i.install_id)),
    'sync', (select s.j || jsonb_build_object('outcomes', o.j) from sync s left join outcomes o using (install_id) where s.install_id = i.install_id),
    'transfer', (select j from transfer x where x.install_id = i.install_id),
    'load', (select j from loads x where x.install_id = i.install_id),
    'snapshots', (select j from snaps x where x.install_id = i.install_id),
    'device', (select j from device x where x.install_id = i.install_id),
    'errors', (select j from errors x where x.install_id = i.install_id),
    'releases', (select j from releases x where x.install_id = i.install_id)
  )), '{}'::jsonb)
  from diag.installs i join scope using (install_id)
$$;

-- One install's records in order: the timeline around a complaint.
create or replace function diag.timeline(p_install text, p_since interval default interval '2 days', p_limit int default 200)
returns table (at timestamptz, received_at timestamptz, kind text, org_id text, project_id text, update_id text, n jsonb, t jsonb, stack text)
language sql stable security definer set search_path = diag, pg_catalog as $$
  select r.at, r.received_at, r.kind, r.org_id, r.project_id, r.update_id, r.n, r.t, r.stack
  from diag.records r
  where r.install_id = p_install and r.at > now() - p_since
  order by r.at desc
  limit least(p_limit, 2000)
$$;

-- The code a person read out ("E-7K2Q"): the error, its install, and what
-- that install recorded just before it.
create or replace function diag.error(p_error_id text)
returns jsonb
language sql stable security definer set search_path = diag, pg_catalog as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'installId', e.install_id,
    'at', e.at,
    'receivedAt', e.received_at,
    'updateId', e.update_id,
    't', e.t,
    'stack', e.stack,
    'context', (select i.context from diag.installs i where i.install_id = e.install_id),
    'before', (
      select jsonb_agg(jsonb_build_object('at', b.at, 'kind', b.kind, 'projectId', b.project_id, 'n', b.n, 't', b.t) order by b.at)
      from (select * from diag.records b where b.install_id = e.install_id and b.at <= e.at and b.id <> e.id order by b.at desc limit 30) b
    )
  ) order by e.at desc), '[]'::jsonb)
  from diag.records e
  where e.kind = 'error' and e.t->>'errorId' = p_error_id
$$;

-- How the sync RPCs are doing server-side, all orgs together (pg_stat_statements).
create or replace function diag.rpc_stats()
returns table (rpc text, calls bigint, mean_ms numeric, max_ms numeric, total_s numeric, rows_per_call numeric)
language sql stable security definer set search_path = extensions, pg_catalog as $$
  select substring(s.query from '(append_events|pull_events|get_snapshot_meta|get_snapshot_chunk|diag_ingest)') as rpc,
         sum(s.calls)::bigint,
         round((sum(s.total_exec_time) / nullif(sum(s.calls), 0))::numeric, 1),
         round(max(s.max_exec_time)::numeric, 1),
         round((sum(s.total_exec_time) / 1000)::numeric, 1),
         round((sum(s.rows)::numeric / nullif(sum(s.calls), 0)), 1)
  from extensions.pg_stat_statements s
  where s.query ~ '(append_events|pull_events|get_snapshot_meta|get_snapshot_chunk|diag_ingest)'
    and s.query !~ 'pg_stat_statements'
  group by 1
  order by 5 desc
$$;

-- ---- who may read ---------------------------------------------------------

-- A read-only role for support tooling (scripts/diag.ts) and for Claude.
-- NOLOGIN here: a password is not something a migration may hold. Enabling
-- it for a hosted database is in docs/diagnostics.md.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'diag_reader') then
    create role diag_reader nologin;
  end if;
end $$;

revoke all on all functions in schema diag from public;
grant usage on schema diag to diag_reader;
grant select on all tables in schema diag to diag_reader;
grant execute on function
  diag.schema(), diag.is_token(text), diag.clean(jsonb),
  diag.find(text), diag.partition_health(text, text, int), diag.members(text, text),
  diag.summary(text, text, interval, text), diag.timeline(text, interval, int),
  diag.error(text), diag.rpc_stats()
  to diag_reader;
