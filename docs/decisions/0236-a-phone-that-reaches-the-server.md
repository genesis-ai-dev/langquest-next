# 236. A phone that reaches the server delivers teammates' signed work on their authors' behalf

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: Carl's choice (plan section 2): any one phone can upload the whole
team's work, and partners get the first release only with it, so one trip
to town sends everyone's work and a lost phone's work survives on its
teammates' phones (docs/nearby-sync-plan.md section 6). The Worker's
`POST /api/relay` (`apps/web/worker/relay.ts`) checks the caller's token
and that the caller may read the language, then each batch's chain with
expiry skipped (a batch may be carried for months), its signature and every
event's digest, and calls `relay_append_events` once per author and
signer's key, at most 500 events, so a request mixing authors gets separate
transactions and partial success. It does not ask `org_features`, because
the flag gates only the way in. That function refuses a caller before
anything else, then appends as the author through `append_events`, with
`set_config` local to the transaction, so every per-account check (size,
bound and reserved ids, stream kind, grants, the author's daily allowance of
169) applies from the code that holds it; a suspended author
(`banned_until`) and a key row that is missing are refused for every event.
A phone delivers between push and pull (`deliverNearby`,
`packages/sync/src/nearbyDeliver.ts`), so events go first and a month's
catch-up pull does not run on the slow path that 143 exists to stop: per
author, oldest clock first, one batch at a time, saving each batch's
verdicts before the next. Accepted rows are confirmed; a duplicate,
`CLOCK_AHEAD` or `NOT_LISTED` stays nearby for the pull or a later try,
because a duplicate compares only organization, stream, actor and type and
its clock may differ; `NOT_MEMBER` and `NOT_ALLOWED` are refused with Try
again; anything else is the server's word for good. Files go as today, and
someone who only views may upload a file an accepted event names under
exactly that name (`x-named-by`, `blob_named_by`), asked every time and
never through `cachedBlobAccess`, which would open the stream for a minute;
the reconciler copies a file stored under a format the log does not name,
since `v1.BlobStored` records only hash and size. A newcomer's chain (two
links) waits for joining offline (phase 6).
Reverse if: carried work proves to land wrongly attributed or refused for
passing reasons in the field, or the relay's cost on the database outgrows
what delivery saves.

Amended (2026-11-10, Carl Sauder): the relay sends `append_events` only the
envelope its author signed (`nearbyCopy`). A digest hashes a parent only when
truthy, so a carrier could add a false or empty `parentEventId` and the server
kept it as text; and a truthy parent that is not a string is refused, at the
relay and at the door (`nearbyParentError`; pre-merge security review).
