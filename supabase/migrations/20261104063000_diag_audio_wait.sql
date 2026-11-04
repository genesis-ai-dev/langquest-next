-- How long a play of a recording waits for its first sound (decisions.md 182,
-- amended 2026-11-04; docs/diagnostics.md): the hourly `audio` tally gains
-- `waits` (plays that reached sound), `waitMs` (their waits added up) and
-- `maxWaitMs` (the longest). A slow phone waited seconds before a part
-- played, with nothing recorded to show it (LAN-224). Numbers only.

-- The twin of DIAG_SCHEMA and DIAG_CONTEXT in packages/sync/src/diagnostics.ts;
-- scripts/diagSchema.test.ts holds them equal. Change both together.
create or replace function diag.schema() returns jsonb language sql immutable as $$
select
-- diag-schema:begin
'{"kinds":{"sync":{"n":["ms","pushNetMs","pullNetMs","applyMs","pushed","rejected","pulled","pages","pending","offlineMs","rejNotMember","rejNotAllowed","rejNotListed","rejInvalid","rejClockAhead","rejOther","requeued","more"],"t":{"outcome":["ok","offline","unrenewed","refused","too_old","error"],"error":"token","code":"token","phase":["push","pull","snapshot","checkpoint","load","store"]}},"load":{"n":["ms","events","fromSnapshot","staleCheckpointSeq","readMs","foldMs"],"t":{"reason":["open","rejected","requeue","redaction","snapshot","membership","other"],"checkpoint":["none","ok","old_reducer"]}},"checkpoint":{"n":["ms","kb","seq","pruned"],"t":{"path":["fast","slow"]}},"open":{"n":["ms","syncs","pulled","snapshotMs","loadMs"],"t":{"cold":["yes","no"]}},"snapshot":{"n":["ms","chunks","resumedChunks","bytes","seq"],"t":{"outcome":["ok","none","stale"],"why":["cold","redaction","reducer"]}},"fill":{"n":["ms","msToMap","headKb","passages","rows"],"t":{"event":["start","done","fallback","restart"],"why":["cold","redaction","reducer"],"reason":["no_rpc","no_cut","no_lines","old_lines","error","cut_gone"]}},"transfer":{"n":["count","bytes","ms","maxMs","signMs","fetchMs","verifyMs","failOffline","failHttp4xx","failHttp5xx","failHash","failDisk","failOther","failAuth","failNotFound","failTooLarge","failBadDigest","failGone"],"t":{"dir":["up","down"],"src":["lang","guide","handover","stream","source","help","study"]}},"device":{"n":["freeDiskMb","totalDiskMb","blobCacheMb","blobsWanted","lostFiles","lostRecordings","journalPending","journalFailed","uploadsWaiting","oldestUnsentMin","wantedStuckMin","streams","localEvents","dbMb","diagQueued","diagDropped"],"t":{}},"error":{"n":[],"t":{"name":"token","where":"token","errorId":"token","fatal":["yes","no"],"code":"token"}},"expected":{"n":["count"],"t":{"where":"token","name":"token","code":"token"}},"audio":{"n":["takes","takeMs","tooShort","micRefused","startFail","stopFail","saveFail","encodeFail","wavKept","interrupted","plays","playFail","playNotHere","streamFail","waits","waitMs","maxWaitMs"],"t":{}},"auth":{"n":["ms","status","attempt","ageH","pending","eventsLeft","uploadsLeft","accountLeft","sinceOkMs"],"t":{"op":["sign_in","sign_up","code","v2","redeem","join","renew","ended","courier","outbox","route","delete","org_list"],"outcome":["ok","offline","http","refused","rate_limited","server","expired","used","not_found","retired","needs_name","done","keep","gone","unreachable","retry","failed","home","no_org","org_unknown"],"code":"token","action":"token"}}},"context":["installId","os","osVersion","model","appVersion","runtimeVersion","updateId","channel","embedded","reducerVersion","protocolVersion"]}'
-- diag-schema:end
::jsonb
$$;

-- Unchanged; restated so the newest migration holding the schema holds its
-- token pattern too (scripts/diagSchema.test.ts reads both from one file).
create or replace function diag.is_token(p text) returns boolean language sql immutable as $$
  select p is not null and p ~ '^[A-Za-z0-9 _.:()/#-]{1,80}$'
$$;
