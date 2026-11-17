# 211. A nearby phone is not a server: a teammate's work moves phone to phone, and only the server confirms it

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: teams already work offline for a month or more (PLAN.md section 1),
and nobody sees a teammate's work until both have been online. Carl set two
purposes for sharing between phones, in this order: review before anyone is
back online, and one trip to town with protection from a lost or crashed
phone, so every phone ends up holding all the team's unsent work
(`docs/nearby-sync-plan.md` sections 1 and 2). The fold is order-independent
and idempotent (invariants 2 and 3), so a phone can fold a teammate's events
with no merge step and no new event, reducer change or `REDUCER_VERSION`
bump. What keeps every server rule true is that a nearby phone is not a
`Transport` (plan 5.1): only the server moves a cursor, only the server
confirms (a nearby event is never `confirmed`, a nearby file never makes
`isStored` true), and nothing a nearby phone says can delete anything.
Server-only events are refused, and `v1.Redacted` and `v1.ExternalValueSet`
are refused by name in the door (`packages/core/src/nearbyDoor.ts`) and the
sender, since `privilegeFor` would let an admin's through.
`SyncClient.receiveNearby` takes one page at a time under the stream's turn
and runs only part of the pull's path: apply, lines, revision and one commit,
never the cursor, the fill, the redaction branch, the membership retry or a
checkpoint, and the link is never awaited inside that turn. The room's loop
(`NearbyRoom`, `choosePartner`) and the session (`NearbySession`) live in
`packages/sync` behind its `./nearby` entry (104), so the fleet runs the app's
own code and supplies only time and the link (`packages/sync/src/testing/fleet/nearby.ts`).
Phase 1 is the model with no radio and no screen. Held by
`packages/sync/test/nearbyConverges.test.ts` (any split of work, any pairings
with drops, then trips to town: every phone folds to the server's log with
nothing nearby) and the fleet's `villageMonth`, `wrongDate`, `fiveInRoom` and
`lostPhone` scenarios.
Reverse if: a phone back from town ever folds to something the server's log
does not give, or a nearby row is ever found in a checkpoint or the outbox.
