-- Field diagnostics, second pass (docs/diagnostics.md, decisions.md 111):
-- the gaps an audit of the app since decision 39 found.
--
-- New kinds: `checkpoint`, `open`, `expected` (noteExpected, tallied per
-- hour), `audio` (recording and playback, tallied per hour) and `auth`
-- (sign-in, renewal, invites, hand-over). New fields on `sync` (rejections by
-- reason, an `unrenewed` outcome, an error's code and phase), `load` (why it
-- ran, read and fold time), `snapshot` (why), `transfer` (where from, and the
-- Worker's refusals by meaning) and `device` (lost files, unsent recordings,
-- the diagnostics queue). All numbers and fixed codes; nothing a person typed.
--
-- diag.summary also reads the organization stream ('_org') and the new kinds,
-- and takes in the installs of the language's members that never delivered a
-- record about the language itself. diag.org_summary and diag.person answer
-- for people who never open a language: no organization yet, a join request
-- waiting, stuck at sign-in.

-- The twin of DIAG_SCHEMA and DIAG_CONTEXT in packages/sync/src/diagnostics.ts;
-- scripts/diagSchema.test.ts holds them equal. Change both together.
create or replace function diag.schema() returns jsonb language sql immutable as $$
select
-- diag-schema:begin
'{"kinds":{"sync":{"n":["ms","pushNetMs","pullNetMs","applyMs","pushed","rejected","pulled","pages","pending","offlineMs","rejNotMember","rejNotAllowed","rejNotListed","rejInvalid","rejClockAhead","rejOther","requeued","more"],"t":{"outcome":["ok","offline","unrenewed","refused","too_old","error"],"error":"token","code":"token","phase":["push","pull","snapshot","checkpoint","load","store"]}},"load":{"n":["ms","events","fromSnapshot","staleCheckpointSeq","readMs","foldMs"],"t":{"reason":["open","rejected","requeue","redaction","snapshot","membership","other"],"checkpoint":["none","ok","old_reducer"]}},"checkpoint":{"n":["ms","kb","seq","pruned"],"t":{"path":["fast","slow"]}},"open":{"n":["ms","syncs","pulled","snapshotMs","loadMs"],"t":{"cold":["yes","no"]}},"snapshot":{"n":["ms","chunks","resumedChunks","bytes","seq"],"t":{"outcome":["ok","none","stale"],"why":["cold","redaction","reducer"]}},"transfer":{"n":["count","bytes","ms","maxMs","signMs","fetchMs","verifyMs","failOffline","failHttp4xx","failHttp5xx","failHash","failDisk","failOther","failAuth","failNotFound","failTooLarge","failBadDigest","failGone"],"t":{"dir":["up","down"],"src":["lang","guide","handover","stream","source","help","study"]}},"device":{"n":["freeDiskMb","totalDiskMb","blobCacheMb","blobsWanted","lostFiles","lostRecordings","journalPending","journalFailed","uploadsWaiting","oldestUnsentMin","wantedStuckMin","streams","localEvents","dbMb","diagQueued","diagDropped"],"t":{}},"error":{"n":[],"t":{"name":"token","where":"token","errorId":"token","fatal":["yes","no"],"code":"token"}},"expected":{"n":["count"],"t":{"where":"token","name":"token","code":"token"}},"audio":{"n":["takes","takeMs","tooShort","micRefused","startFail","stopFail","saveFail","encodeFail","wavKept","interrupted","plays","playFail","playNotHere","streamFail"],"t":{}},"auth":{"n":["ms","status","attempt","ageH","pending","eventsLeft","uploadsLeft","accountLeft","sinceOkMs"],"t":{"op":["sign_in","sign_up","code","v2","redeem","join","renew","ended","courier","outbox","route","delete","org_list"],"outcome":["ok","offline","http","refused","rate_limited","server","expired","used","not_found","retired","needs_name","done","keep","gone","unreachable","retry","failed","home","no_org","org_unknown"],"code":"token","action":"token"}}},"context":["installId","os","osVersion","model","appVersion","runtimeVersion","updateId","channel","embedded","reducerVersion","protocolVersion"]}'
-- diag-schema:end
::jsonb
$$;

-- Unchanged; restated so the newest migration holding the schema holds its
-- token pattern too (scripts/diagSchema.test.ts reads both from one file).
create or replace function diag.is_token(p text) returns boolean language sql immutable as $$
  select p is not null and p ~ '^[A-Za-z0-9 _.:()/#-]{1,80}$'
$$;

-- Numbers summed per key across records, except `max*` keys (the largest).
-- Lets a summary total a tally kind without listing every field, so a new
-- field shows up without a new migration.
create or replace function diag.totals(p_ns jsonb[]) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(key, v), '{}'::jsonb) from (
    select e.key, case when e.key like 'max%' then max(e.value::numeric) else sum(e.value::numeric) end as v
    from unnest(p_ns) as x(n), jsonb_each_text(x.n) as e
    where jsonb_typeof(x.n -> e.key) = 'number'
    group by e.key
  ) t
$$;

-- What one install recorded over the window, as the language report and the
-- organization report both show it. `p_stream` is the language (null: none).
create or replace function diag.install_summary(p_install text, p_org text, p_stream text, p_since interval)
returns jsonb
language sql stable security definer set search_path = diag, pg_catalog as $$
  with r as (
    select * from diag.records
    where install_id = p_install and at > now() - p_since
      and (
        (org_id = p_org and (stream_id = p_stream or stream_id = '_org' or kind in ('open', 'checkpoint', 'audio')))
        or kind in ('error', 'device', 'auth', 'expected')
        or (kind = 'audio' and org_id is null)
      )
  ),
  lang as (select * from r where org_id = p_org and stream_id is not distinct from p_stream and p_stream is not null),
  orgs as (select * from r where org_id = p_org and stream_id = '_org')
  select jsonb_build_object(
    'sync', (
      select jsonb_build_object(
        'count', count(*),
        'p50Ms', percentile_cont(0.5) within group (order by (n->>'ms')::numeric),
        'p95Ms', percentile_cont(0.95) within group (order by (n->>'ms')::numeric),
        'pushNetMs', sum((n->>'pushNetMs')::numeric), 'pullNetMs', sum((n->>'pullNetMs')::numeric),
        'applyMs', sum((n->>'applyMs')::numeric), 'pages', sum((n->>'pages')::numeric),
        'pushed', sum((n->>'pushed')::numeric), 'pulled', sum((n->>'pulled')::numeric),
        'rejected', sum((n->>'rejected')::numeric), 'maxPending', max((n->>'pending')::numeric),
        'maxOfflineMs', max((n->>'offlineMs')::numeric), 'lastAt', max(at),
        'rejectedBy', diag.totals(array_agg(jsonb_build_object(
          'notMember', n->'rejNotMember', 'notAllowed', n->'rejNotAllowed', 'notListed', n->'rejNotListed',
          'invalid', n->'rejInvalid', 'clockAhead', n->'rejClockAhead', 'other', n->'rejOther', 'requeued', n->'requeued'))),
        'outcomes', (select jsonb_object_agg(o, c) from (select t->>'outcome' as o, count(*) as c from lang where kind = 'sync' group by 1) x),
        'errorCodes', (select jsonb_object_agg(k, c) from (
          select coalesce(t->>'phase', '?') || ':' || coalesce(t->>'code', t->>'error', '?') as k, count(*) as c
          from lang where kind = 'sync' and t->>'outcome' = 'error' group by 1) x)
      ) from lang where kind = 'sync' having count(*) > 0
    ),
    'orgSync', (
      select jsonb_build_object(
        'count', count(*),
        'p95Ms', percentile_cont(0.95) within group (order by (n->>'ms')::numeric),
        'applyMs', sum((n->>'applyMs')::numeric), 'pulled', sum((n->>'pulled')::numeric),
        'rejected', sum((n->>'rejected')::numeric), 'lastAt', max(at),
        'outcomes', (select jsonb_object_agg(o, c) from (select t->>'outcome' as o, count(*) as c from orgs where kind = 'sync' group by 1) x),
        'errorCodes', (select jsonb_object_agg(k, c) from (
          select coalesce(t->>'phase', '?') || ':' || coalesce(t->>'code', t->>'error', '?') as k, count(*) as c
          from orgs where kind = 'sync' and t->>'outcome' = 'error' group by 1) x)
      ) from orgs where kind = 'sync' having count(*) > 0
    ),
    -- Downloads and uploads of the language's own lists, by direction (records
    -- from before `src` count as the language's).
    'transfer', (
      select jsonb_object_agg(dir, j) from (
        select t->>'dir' as dir, diag.totals(array_agg(n)) as j
        from lang where kind = 'transfer' and coalesce(t->>'src', 'lang') = 'lang' group by 1
      ) x
    ),
    -- Every other transfer path (guides, hand-over, streamed play, source
    -- audio, help, study files), by source and direction, any stream.
    'otherTransfer', (
      select jsonb_object_agg(k, j) from (
        select (t->>'src') || ':' || (t->>'dir') as k, diag.totals(array_agg(n)) as j
        from r where kind = 'transfer' and coalesce(t->>'src', 'lang') <> 'lang' group by 1
      ) x
    ),
    'load', (
      select jsonb_build_object(
        'count', count(*),
        'p50Ms', percentile_cont(0.5) within group (order by (n->>'ms')::numeric),
        'p95Ms', percentile_cont(0.95) within group (order by (n->>'ms')::numeric),
        'maxEvents', max((n->>'events')::numeric),
        'readMs', sum((n->>'readMs')::numeric), 'foldMs', sum((n->>'foldMs')::numeric),
        'staleCheckpoints', count(*) filter (where n ? 'staleCheckpointSeq' or t->>'checkpoint' = 'old_reducer'),
        'reasons', (select jsonb_object_agg(k, c) from (select coalesce(t->>'reason', 'open') as k, count(*) as c from lang where kind = 'load' group by 1) x)
      ) from lang where kind = 'load' and coalesce(t->>'reason', 'open') = 'open' having count(*) > 0
    ),
    'checkpoints', (
      select jsonb_build_object(
        'count', count(*),
        'p95Ms', percentile_cont(0.95) within group (order by (n->>'ms')::numeric),
        'maxKb', max((n->>'kb')::numeric), 'pruned', sum((n->>'pruned')::numeric)
      ) from lang where kind = 'checkpoint' having count(*) > 0
    ),
    'opens', (
      select jsonb_agg(jsonb_build_object('at', at, 'streamId', stream_id) || t || n order by at desc)
      from (select * from r where kind = 'open' order by at desc limit 10) o
    ),
    'snapshots', (
      select jsonb_agg(jsonb_build_object('at', at, 'outcome', t->>'outcome', 'why', t->>'why', 'streamId', stream_id) || n order by at desc)
      from r where kind = 'snapshot' and org_id = p_org and (stream_id is not distinct from p_stream or stream_id = '_org')
    ),
    'device', (select n || jsonb_build_object('at', at) from r where kind = 'device' order by at desc limit 1),
    'diagDropped', (select sum((n->>'diagDropped')::numeric) from r where kind = 'device'),
    'errors', (
      select jsonb_agg(jsonb_build_object('name', name, 'where', "where", 'code', code, 'count', c, 'lastErrorId', last_id, 'lastAt', last_at) order by c desc) from (
        select t->>'name' as name, t->>'where' as "where", t->>'code' as code, count(*) as c,
               (array_agg(t->>'errorId' order by at desc))[1] as last_id, max(at) as last_at
        from r where kind = 'error' group by 1, 2, 3
      ) x
    ),
    'expected', (
      select jsonb_agg(jsonb_build_object('where', "where", 'name', name, 'code', code, 'count', c, 'lastAt', last_at) order by c desc) from (
        select t->>'where' as "where", t->>'name' as name, t->>'code' as code, sum((n->>'count')::numeric) as c, max(at) as last_at
        from r where kind = 'expected' group by 1, 2, 3
      ) x
    ),
    -- The language's own recording and playback, with what no language
    -- claimed (a recorder not tied to one); the organization report, with no
    -- language, totals all of it.
    'audio', (
      select diag.totals(array_agg(n)) from r
      where kind = 'audio' and (p_stream is null or stream_id = p_stream or org_id is null) having count(*) > 0
    ),
    'auth', (
      select jsonb_agg(jsonb_build_object('op', op, 'outcome', outcome, 'code', code, 'action', action, 'count', c, 'lastAt', last_at,
                                          'maxMs', max_ms, 'last', last_n) order by last_at desc) from (
        select t->>'op' as op, t->>'outcome' as outcome, t->>'code' as code, t->>'action' as action, count(*) as c, max(at) as last_at,
               max((n->>'ms')::numeric) as max_ms, (array_agg(n order by at desc))[1] as last_n
        from r where kind = 'auth' group by 1, 2, 3, 4
      ) x
    ),
    'releases', (
      select jsonb_agg(jsonb_build_object('updateId', update_id, 'from', f, 'to', l, 'records', c) order by f) from (
        select update_id, min(at) as f, max(at) as l, count(*) as c from r group by 1
      ) x
    ),
    'clockAheadS', (select greatest(0, round(extract(epoch from max(at - received_at)))) from r)
  )
$$;

-- What each install that worked in this language reported over the window.
-- An install is in scope when it recorded something about the language, or
-- when it belongs to one of the language's members and recorded anything at
-- all: a member whose phone never opened the language (stuck on the
-- organization stream, at sign-in) is exactly who support is asking about.
-- Errors, device samples, auth and expected-failure tallies are per install,
-- not per language.
create or replace function diag.summary(p_org text, p_language text, p_since interval default interval '14 days', p_install text default null)
returns jsonb
language sql stable security definer set search_path = diag, public, pg_catalog as $$
  with people as (
    select distinct m.profile_id from public.org_memberships m
    where m.org_id = p_org and not m.removed and (m.scope_level = 'org' or m.language_id = p_language)
  ),
  scope as (
    select distinct r.install_id from diag.records r
    where r.at > now() - p_since and (p_install is null or r.install_id = p_install)
      and (
        (r.org_id = p_org and r.stream_id = p_language)
        or r.delivered_by in (select profile_id from people)
      )
  )
  select coalesce(jsonb_object_agg(i.install_id, jsonb_build_object(
    'profileId', i.profile_id,
    'context', i.context,
    'lastSeen', i.last_seen
  ) || diag.install_summary(i.install_id, p_org, p_language, p_since)), '{}'::jsonb)
  from diag.installs i join scope using (install_id)
$$;

-- The organization as a whole: every member's installs over the window, with
-- the organization stream's syncs, sign-in and hand-over, errors and the
-- device; and the members who never delivered anything (their phones never
-- reached the server with a build that records, or diagnostics are off).
create or replace function diag.org_summary(p_org text, p_since interval default interval '14 days')
returns jsonb
language sql stable security definer set search_path = diag, public, pg_catalog as $$
  with people as (
    select m.profile_id, string_agg(distinct coalesce(m.role_id, 'none') || case when m.scope_level = 'language' then '@' || m.language_id else '' end, ',') as roles
    from public.org_memberships m where m.org_id = p_org and not m.removed group by m.profile_id
  ),
  scope as (
    select distinct r.install_id from diag.records r
    where r.at > now() - p_since and (r.org_id = p_org or r.delivered_by in (select profile_id from people))
  )
  select jsonb_build_object(
    'installs', coalesce((
      select jsonb_object_agg(i.install_id, jsonb_build_object(
        'profileId', i.profile_id,
        'roles', (select roles from people p where p.profile_id = i.profile_id),
        'context', i.context,
        'lastSeen', i.last_seen,
        'languages', (
          select jsonb_object_agg(stream_id, c) from (
            select stream_id, count(*) as c from diag.records x
            where x.install_id = i.install_id and x.org_id = p_org and x.stream_id <> '_org' and x.at > now() - p_since group by 1
          ) l
        )
      ) || diag.install_summary(i.install_id, p_org, null, p_since))
      from diag.installs i join scope using (install_id)
    ), '{}'::jsonb),
    'silent', coalesce((
      select jsonb_agg(jsonb_build_object('profileId', p.profile_id, 'roles', p.roles) order by p.profile_id)
      from people p where not exists (select 1 from diag.installs i where i.profile_id = p.profile_id)
    ), '[]'::jsonb)
  )
$$;

-- One account's installs and what they recorded, whatever organization: for
-- someone in none yet, or waiting on a join request. Profile id only.
create or replace function diag.person(p_profile text, p_since interval default interval '14 days')
returns jsonb
language sql stable security definer set search_path = diag, pg_catalog as $$
  select coalesce(jsonb_object_agg(i.install_id, jsonb_build_object(
    'context', i.context,
    'firstSeen', i.first_seen,
    'lastSeen', i.last_seen,
    'orgs', (select jsonb_agg(distinct x.org_id) from diag.records x where x.install_id = i.install_id and x.org_id is not null and x.at > now() - p_since)
  ) || diag.install_summary(i.install_id, '', null, p_since)), '{}'::jsonb)
  from diag.installs i
  where i.install_id in (select r.install_id from diag.records r where r.delivered_by = p_profile)
     or i.profile_id = p_profile
$$;

do $$
declare f text;
begin
  foreach f in array array['totals', 'install_summary', 'summary', 'org_summary', 'person'] loop
    execute format('revoke all on function diag.%I from public', f);
    execute format('grant execute on function diag.%I to diag_reader', f);
  end loop;
end $$;
