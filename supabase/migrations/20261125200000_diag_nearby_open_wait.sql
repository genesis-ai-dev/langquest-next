-- Field diagnostics: why sharing while LangQuest is open waited (2026-11-25).
-- A phone let in offline shared nothing for about 21 minutes after its join,
-- and no record said why: neither the mode's gate nor a rest after the room's
-- pieces were missing wrote anything. The phone's `nearby` records gain one,
-- `event` `wait` (`mode` `open`), written when the mode was wanted, the app in
-- front and nothing else owning the radios, yet no room ran for a minute or
-- more: `waitMs`; how long each gate input held it (`heldFeatureMs`,
-- `heldSwitchMs`, `heldAllowMs`, `heldRadiosMs`, `heldOfferedMs`,
-- `heldAudioMs`, `heldRestMs`, `heldReadyMs`; never the app lock, which is no
-- wait, since time behind it would say the person uses it) and how long the
-- gate stood open with no room yet (`startingMs`); the rests that began, by
-- cause (`restPieces`, `restStart`, `restRadio`, `restUnwelcome`,
-- `restStopped`); and `why` (`no-key`, `no-certificate`, words the allowlist
-- already holds) when the pieces were missing. Durations, counts and fixed
-- words only: never who, and never what. diag.install_summary's `nearby`
-- gains `openWaits`, their totals; diag.nearby_summary is unchanged.

-- The twin of DIAG_SCHEMA, NEARBY_DIAG_SCHEMA and DIAG_CONTEXT in
-- packages/sync/src/diagnostics.ts and nearbyDiag.ts; scripts/diagSchema.test.ts
-- holds them equal. Change both together.
create or replace function diag.schema() returns jsonb language sql immutable as $$
select
-- diag-schema:begin
'{"kinds":{"sync":{"n":["ms","pushNetMs","pullNetMs","applyMs","pushed","rejected","pulled","pages","pending","offlineMs","rejNotMember","rejNotAllowed","rejNotListed","rejInvalid","rejClockAhead","rejOther","requeued","more"],"t":{"outcome":["ok","offline","unrenewed","refused","too_old","error"],"error":"token","code":"token","phase":["push","pull","snapshot","checkpoint","load","store"]}},"load":{"n":["ms","events","fromSnapshot","staleCheckpointSeq","readMs","foldMs"],"t":{"reason":["open","rejected","requeue","redaction","snapshot","membership","other"],"checkpoint":["none","ok","old_reducer"]}},"checkpoint":{"n":["ms","kb","seq","pruned"],"t":{"path":["fast","slow"]}},"open":{"n":["ms","syncs","pulled","snapshotMs","loadMs"],"t":{"cold":["yes","no"]}},"snapshot":{"n":["ms","chunks","resumedChunks","bytes","seq"],"t":{"outcome":["ok","none","stale"],"why":["cold","redaction","reducer"]}},"fill":{"n":["ms","msToMap","headKb","passages","rows"],"t":{"event":["start","done","fallback","restart"],"why":["cold","redaction","reducer"],"reason":["no_rpc","no_cut","no_lines","old_lines","error","cut_gone"]}},"transfer":{"n":["count","bytes","ms","maxMs","signMs","fetchMs","verifyMs","failOffline","failHttp4xx","failHttp5xx","failHash","failDisk","failOther","failAuth","failNotFound","failTooLarge","failBadDigest","failGone"],"t":{"dir":["up","down"],"src":["lang","guide","handover","stream","source","help","study"]}},"device":{"n":["freeDiskMb","totalDiskMb","blobCacheMb","blobsWanted","lostFiles","lostRecordings","journalPending","journalFailed","uploadsWaiting","oldestUnsentMin","wantedStuckMin","streams","localEvents","dbMb","diagQueued","diagDropped"],"t":{}},"error":{"n":[],"t":{"name":"token","where":"token","errorId":"token","fatal":["yes","no"],"code":"token"}},"expected":{"n":["count"],"t":{"where":"token","name":"token","code":"token"}},"audio":{"n":["takes","takeMs","tooShort","micRefused","startFail","stopFail","saveFail","encodeFail","wavKept","interrupted","plays","playFail","playNotHere","streamFail","waits","waitMs","maxWaitMs","streamWaits","streamWaitMs","maxWaitLinkMs","maxWaitCopyMs","maxWaitLoadMs","maxWaitBusyMs","maxWaitStreamed"],"t":{}},"auth":{"n":["ms","status","attempt","ageH","pending","eventsLeft","uploadsLeft","accountLeft","sinceOkMs"],"t":{"op":["sign_in","sign_up","code","v2","redeem","join","renew","ended","courier","outbox","route","delete","org_list"],"outcome":["ok","offline","http","refused","rate_limited","server","expired","used","not_found","retired","needs_name","done","keep","gone","unreachable","retry","failed","home","no_org","org_unknown"],"code":"token","action":"token"}},"nearby":{"n":["ms","levelMs","heard","echoed","alone","maybe","taps","maxUnmatched","pipeFails","strangers","busy","noAnswer","sessions","done","fallbacks","events","sent","refused","overBudget","files","served","fileFails","keyRefused","farAhead","noRoom","cutBackups","older","clockOff","newerApp","openMin","scanMin","pauseMin","syncMin","viaDirect","greets","maxMeetMs","docsKept","docsRefused","docsMissing","docsCapped","libHeld","libTheirs","libGot","libServed","granted","exchanged","copyWhole","copyFilled","copyDocsKept","copyDocsMissing","copyDocsRefused","copyParts","copyNos","exchangeOlder","exchangeNoPieces","exchangeLeft","docsUnreadable","copyDocsUnreadable","copyDocsCut","waitMs","heldFeatureMs","heldSwitchMs","heldAllowMs","heldRadiosMs","heldOfferedMs","heldAudioMs","heldRestMs","heldReadyMs","startingMs","restPieces","restStart","restRadio","restUnwelcome","restStopped"],"t":{"event":["room","session","find","blocked","deliver","wait"],"mode":["screen","open","join"],"stop":["asked","idle","wait","run","level","no-key","rest"],"role":["i","r"],"end":["done","silent","no-answer","said","heard","dropped","stalled","failed"],"bye":["done","nothing","busy","protocol","identity","not-member","stopped"],"refusal":["window","revoked","org","expired","pass-expired","other"],"link":["wifi-direct","hotspot","awdl","bluetooth"],"code":["NOT_AVAILABLE","NO_PERMISSION","BLUETOOTH_OFF","WIFI_OFF","BAD_ARGUMENT","ADVERTISE_UNSUPPORTED","ADVERTISE_FAILED","SCAN_FAILED","FIND_NOT_RUNNING","PEER_GONE","PIPE_FAILED","PIPE_TIMEOUT","P2P_UNSUPPORTED","GROUP_BUSY","GROUP_FAILED","HOTSPOT_NO_CHANNEL","HOTSPOT_INCOMPATIBLE","HOTSPOT_TETHERING_DISALLOWED","HOTSPOT_FAILED","JOIN_FAILED","JOIN_TIMEOUT","HOST_TAKEN_DOWN","LINK_UNKNOWN","LINK_CLOSED","LINK_DROPPED","TAG_FAILED","FRAME_TOO_LARGE","MESSAGE_TOO_LARGE","NOT_SECURED","ALREADY_SECURED","OPENING_AFTER_SECURE","TRANSFER_BUSY","FILE_TOO_BIG","FILE_NO_SPACE","FILE_REFUSED","FILE_CANCELLED","FILE_UNREADABLE","FILE_WRITE_FAILED","FILE_SIZE_MISMATCH","STAGING_REFUSED","STOPPED","INTERNAL"],"error":"token","why":["not-in-build","android-too-old","no-bluetooth-le","no-wifi-direct","no-key","no-certificate","read-only","bluetooth-off","wifi-off","location-off","permission-approximate","permission-blocked"],"adv":["yes","no"],"direct":["yes","no"],"hotspot":["yes","no"],"copyNo":["versions","not-filled","not-allowed","not-here","malformed","moved"]}}},"context":["installId","os","osVersion","model","appVersion","runtimeVersion","updateId","channel","embedded","reducerVersion","protocolVersion"]}'
-- diag-schema:end
::jsonb
$$;

-- Unchanged; restated so the newest migration holding the schema holds its
-- token pattern too (scripts/diagSchema.test.ts reads both from one file).
create or replace function diag.is_token(p text) returns boolean language sql immutable as $$
  select p is not null and p ~ '^[A-Za-z0-9 _.:()/#-]{1,80}$'
$$;

-- As in 20261124090000_diag_nearby_quiet.sql, with `openWaits` in `nearby`.
create or replace function diag.install_summary(p_install text, p_org text, p_stream text, p_since interval)
returns jsonb
language sql stable security definer set search_path = diag, pg_catalog as $$
  with r as (
    select * from diag.records
    where install_id = p_install and at > now() - p_since
      and (
        (org_id = p_org and (stream_id = p_stream or stream_id = '_org' or kind in ('open', 'checkpoint', 'audio', 'nearby')))
        or kind in ('error', 'device', 'auth', 'expected')
        or (kind = 'audio' and org_id is null)
      )
  ),
  lang as (select * from r where org_id = p_org and stream_id is not distinct from p_stream and p_stream is not null),
  near as (select * from r where kind = 'nearby' and org_id = p_org and (p_stream is null or stream_id = p_stream)),
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
    -- A big language's first download by fill (decisions.md 147): start, done, fallback and restart, newest first.
    'fills', (
      select jsonb_agg(jsonb_build_object('at', at, 'event', t->>'event', 'why', t->>'why', 'reason', t->>'reason', 'streamId', stream_id) || n order by at desc)
      from (select * from lang where kind = 'fill' order by at desc limit 20) f
    ),
    -- Share nearby (docs/nearby-sync-plan.md sections 11 and 15): the last rooms
    -- as they stopped, newest first, with the way each ran; totals over the
    -- rooms on Share nearby and, apart, over those while LangQuest was open,
    -- with how many of those met anyone; totals over every session record (a
    -- finished session while open is summed in its room's instead); how
    -- sessions ended (`end` or `end:bye`), why this phone turned phones away
    -- (`mode:refusal`), the links that moved the work, the native codes by
    -- record (`room:PIPE_TIMEOUT`, `find:BLUETOOTH_OFF`), why the screen could
    -- not run, and what delivering teammates' work to the server did. Counts
    -- and codes only, never who was met.
    'nearby', (
      select jsonb_build_object(
        'rooms', (
          select jsonb_agg(jsonb_build_object('at', at, 'stop', t->>'stop', 'mode', t->>'mode', 'code', t->>'code', 'adv', t->>'adv', 'direct', t->>'direct', 'hotspot', t->>'hotspot') || n order by at desc)
          from (select * from near where t->>'event' = 'room' order by at desc limit 10) x
        ),
        'roomTotals', (select diag.totals(array_agg(n)) from near where t->>'event' = 'room' and coalesce(t->>'mode', 'screen') = 'screen' having count(*) > 0),
        'openTotals', (
          select diag.totals(array_agg(n)) || jsonb_build_object('count', count(*), 'met', count(*) filter (where coalesce((n->>'sessions')::numeric, 0) > 0))
          from near where t->>'event' = 'room' and t->>'mode' = 'open' having count(*) > 0
        ),
        -- Waits while LangQuest was open (2026-11-25): how many, the longest, and
        -- what held them and why rests began, summed.
        'openWaits', (
          select diag.totals(array_agg(n)) || jsonb_build_object('count', count(*), 'maxWaitMs', max((n->>'waitMs')::numeric), 'why', (
            select jsonb_object_agg(k, c) from (select t->>'why' as k, count(*) as c from near where t->>'event' = 'wait' and t ? 'why' group by 1) w))
          from near where t->>'event' = 'wait' having count(*) > 0
        ),
        'sessionTotals', (select diag.totals(array_agg(n)) || jsonb_build_object('count', count(*)) from near where t->>'event' = 'session' having count(*) > 0),
        'ends', (select jsonb_object_agg(k, c) from (
          select coalesce(t->>'end', '?') || coalesce(':' || (t->>'bye'), '') as k, count(*) as c from near where t->>'event' = 'session' group by 1) x),
        'refusals', (select jsonb_object_agg(k, c) from (
          select coalesce(t->>'mode', 'screen') || ':' || (t->>'refusal') as k, count(*) as c from near where t->>'event' = 'session' and t ? 'refusal' group by 1) x),
        'links', (select jsonb_object_agg(k, c) from (
          select t->>'link' as k, count(*) as c from near where t->>'event' = 'session' and t ? 'link' group by 1) x),
        'codes', (select jsonb_object_agg(k, c) from (
          select (t->>'event') || ':' || (t->>'code') as k, count(*) as c from near where t ? 'code' group by 1) x),
        'blocked', (select jsonb_object_agg(k, c) from (
          select t->>'why' as k, count(*) as c from near where t->>'event' = 'blocked' and t ? 'why' group by 1) x),
        'deliver', (
          select diag.totals(array_agg(n)) || jsonb_build_object('count', count(*), 'stopped', (
            select jsonb_object_agg(k, c) from (select t->>'error' as k, count(*) as c from near where t->>'event' = 'deliver' and t ? 'error' group by 1) e))
          from near where t->>'event' = 'deliver' having count(*) > 0
        ),
        'lastAt', max(at)
      ) from near having count(*) > 0
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

revoke all on function diag.install_summary from public;
grant execute on function diag.install_summary to diag_reader;
