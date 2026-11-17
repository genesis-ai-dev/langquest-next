# 110. A checkpoint from an older reducer is dropped with its stream's cursor, so the phone fetches the stream again

Date: 2026-10-15 · By: Carl Sauder · Status: accepted

Reason: a phone checkpoints every 2000 confirmed events and prunes what the
checkpoint covers (invariant 10). An update that bumps `REDUCER_VERSION`,
which happens often, made that checkpoint unreadable, and invariant 10 said
the client then "folds the log", but the log held only the tail after the
checkpoint. `load()` folded that tail from empty state, `pullSlice()` took a
server snapshot only at cursor 0, which the cursor was not, and the next
checkpoint saved the partial state under the new version, so every language
and organization stream that had pruned lost most of its work on the phone
for good (the server's log was intact). The fleet modelled a reducer bump
as a reinstall with an empty store and never saw it. Now `load()` drops a
checkpoint from another reducer version and puts the stream's cursor back
to 0 in one write (`dropStaleCheckpoint` in `packages/sync/src/syncClient.ts`).
The next pull takes the server's snapshot for this reducer, or, when there
is none (the organization stream never has one, 44), pulls the log again from
the start. With nothing below the cursor missing, no checkpoint can be
partial. Until the phone reaches the server it shows the events still in its
log, the person's unsent work among them, as a first download does. The
`load` record carries `staleCheckpointSeq` so support can see it happened
(`docs/diagnostics.md`). The fleet's `reducerBump` scenario and a
`fleet.test.ts` case now update phones that keep their store
(`SimDevice.update`, `Fleet.deployReducer`). Turned down: keeping the whole
log on the phone (the reason for pruning is replay bounded by recent
history), and migrating checkpoints between reducer versions (a migration
per bump, with the risk of a wrong one that the server cannot correct).
Reverse if: phones that update while offline need their language on screen
before they reach the server; then keep the pruned events beside the
checkpoint until a checkpoint from the new reducer replaces it.
