-- A `load` record may say an update changed the reducer and the phone dropped
-- its checkpoint (`staleCheckpointSeq`, the seq it covered), so a language that
-- looks empty after an update is answerable from diagnostics (decisions.md 110,
-- docs/diagnostics.md). diag.clean reads diag.schema(), so only these change.

-- The twin of DIAG_SCHEMA and DIAG_CONTEXT in packages/sync/src/diagnostics.ts;
-- scripts/diagSchema.test.ts holds them equal. Change both together.
create or replace function diag.schema() returns jsonb language sql immutable as $$
select
-- diag-schema:begin
'{"kinds":{"sync":{"n":["ms","pushNetMs","pullNetMs","applyMs","pushed","rejected","pulled","pages","pending","offlineMs"],"t":{"outcome":["ok","offline","refused","too_old","error"],"error":"token"}},"load":{"n":["ms","events","fromSnapshot","staleCheckpointSeq"],"t":{}},"snapshot":{"n":["ms","chunks","resumedChunks","bytes","seq"],"t":{"outcome":["ok","none","stale"]}},"transfer":{"n":["count","bytes","ms","maxMs","signMs","fetchMs","verifyMs","failOffline","failHttp4xx","failHttp5xx","failHash","failDisk","failOther"],"t":{"dir":["up","down"]}},"device":{"n":["freeDiskMb","totalDiskMb","blobCacheMb","blobsWanted"],"t":{}},"error":{"n":[],"t":{"name":"token","where":"token","errorId":"token","fatal":["yes","no"]}}},"context":["installId","os","osVersion","model","appVersion","runtimeVersion","updateId","channel","embedded","reducerVersion","protocolVersion"]}'
-- diag-schema:end
::jsonb
$$;

-- Unchanged; restated so the newest migration holding the schema holds its
-- token pattern too (scripts/diagSchema.test.ts reads both from one file).
create or replace function diag.is_token(p text) returns boolean language sql immutable as $$
  select p is not null and p ~ '^[A-Za-z0-9 _.:()/#-]{1,80}$'
$$;
