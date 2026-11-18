# 212. `nearby` is a fourth status on the events table, and `via` says how a teammate's row came

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: a teammate's event must be held and folded so it can be reviewed,
and must never be sent as its author from this phone (plan 5.2). Reusing
`pending` with another person's `actorId`, as a shared phone does, would
let `pendingStreamsBy` and the courier (60) push it as that person when they
sign in here, laundering a forged event; the same door exists through retry,
so `requeue` leaves out any row with a `via`. `status` is a plain text column,
so `nearby` needs no migration and invariant 7 holds (PLAN.md section 7 now
lists it). `SqliteStore.open` gains a `via` column and the `nearby_batches` and
`nearby_attests` tables behind its pragma read. Push, the sync count and the
sign-out check read `status = 'pending'` and ignore nearby rows; the fold reads
`status <> 'rejected'` and includes them. The traps in plan 5.4 each have a
rule and a test: `takeCheckpoint`'s fast path and `loadUnits` read
`unconfirmedCount`, so no nearby row reaches a confirmed checkpoint;
`WriteBatch.receive` writes only ids this phone lacks, while a pull still
overwrites and clears `via`; `receiveNearby` drops `serverSeq` by
destructuring; a teammate's clock is received only within 5 minutes
(`clockCloseEnough`). `SyncInspection` has a nearby count, and the fleet's
`caughtUp` requires it to be zero. The cost is that nearby rows, like pending
ones, hold `takeCheckpoint` on its slow path and keep memory from shedding
until the server confirms them (216 has the numbers).
Reverse if: a `pending` or `confirmed` row is ever downgraded by a teammate's
copy, or a nearby row is ever pushed.
