---
name: event-sourced-sync
description: Rules for this app's event-sourced, offline-first data design. Use when adding or changing an event type, a reducer case, validation (core or SQL validate_payload / event_privilege), the sync client, outbox, EventStore or Transport adapters, snapshots, projections or read models, or any SQLite / Postgres table that holds app data. Also use when generic event-sourcing or sync advice (optimistic concurrency, ordered projections, last-writer-wins rows, status columns) seems to apply.
license: MIT
---

# Event-sourced offline sync

PLAN.md sections 3 to 9 are the source of truth; this skill is the working
checklist and the list of outside advice that does **not** apply here. If this
file and PLAN.md disagree, PLAN.md wins; fix this file.

## The model in five lines

1. The only write is **appending an intent event** to a stream (an
   organization's, a language's, or a person's).
2. Every event type is **commutative and idempotent**. Any subset, in any order,
   applied any number of times, folds to the same state.
3. **State is derived** by the pure reducer in `packages/core`, identically on
   device and server. Status (approved, done, pending review) is asked of
   `passage.ts`, never stored.
4. The device **materializes on append**, pushes pending events from the
   outbox, and pulls the stream's tail by `serverSeq` cursor. Sync status is a
   column on the events table (`pending | confirmed | rejected`).
5. **Audio is immutable and content-addressed**; blobs sync independently of the
   events that reference them.

## Designing a new event

Ask these in order. If an answer is "no", redesign before writing code.

- **Is it an intent, not a row mutation?** `ReviewRecorded`, not
  `PassageStatusUpdated`. Past tense, domain language, no "set the whole list"
  and no "move X from A to B". Split those into commutative parts.
- **Which merge shape?** Pick from the shapes already in the catalog: once,
  grow-only set (earliest wins where there is a tie), register keyed by an
  explicit tuple (later HLC wins, parent pointer for stale detection), add-wins
  flag or undo. A new merge shape needs a `docs/decisions.md` entry.
- **Does the reducer case write only its own registers?** A case that reads
  existing state to decide what to write breaks order independence (the
  `MemberRemoved` bug in PLAN.md section 6). Derive combinations at read time instead.
- **Is it self-contained in its stream?** It references entities in the same
  stream, the organization's library and identity, or blobs by hash, and a
  work payload never names its language: the stream does (invariant 6).
- **Who may emit it?** Add it to the SQL `event_privilege`; the server's
  membership fold is the only authorization on the write path.
- **What does an old client do with it?** Old reducers must skip unknown types
  without throwing. A changed meaning is a new versioned type (`v2.X`); the old
  materializer stays forever.

Then do the checklist from CLAUDE.md: type in `events.ts` or `record.ts`,
case in `reducer.ts`, case in `validate.ts`, the same rule in SQL
`validate_payload` and `event_privilege` via a **new** migration in
`supabase/migrations/`, fixture in `packages/core/test/fixtures.ts` (the
permutation and idempotence tests then cover it), and
`scripts/record-parity-sql.ts` green.

## Failure handling on the sync path

- **Nothing is dropped** (invariant 1). A server refusal marks the local event
  `rejected` with `rejectReason`; the UI shows it. Classify with `rejectCodeOf`
  in `packages/client/src/types.ts`: `CLOCK_AHEAD` re-stamps, `NOT_MEMBER`
  retries when membership changes, `INVALID` never retries.
- **Offline is not unauthorized.** `OfflineError` means the request never reached the server, so
  queue and retry. `NotAuthorizedError` means the server refused, so tell the user;
  do not show "offline".
- **The fold never throws** (invariant 11). An invalid event lands in
  `state.invalidEvents` and is skipped. Validation happens at the door
  (`validateEvent` on append, `validate_payload` on the server).
- **Requests stay small** (invariant 12). Push in pages of 200; the server
  refuses more than 500. Never let one request grow with the backlog; that is how a
  retry loop is born.
- **Unknown success is normal.** A push can time out after the server
  accepted it. Event ids are client-generated and unique, so a retry is a
  no-op on the server. Never generate a fresh id on retry.

## Storage rules

- **One state schema** (invariant 7). No `_local` / `_synced` table pairs, no
  union views.
- **No `status` / `approved` / `done` columns** anywhere, in SQLite or Postgres.
  Read models (`sqliteReadModels.ts`, server projections) are **derived and
  rebuildable** from the log; they may lag, and they can be thrown away.
- **No trigger-maintained rollups.** Async workers consume the log (PLAN.md
  section 5); the write path is append plus the membership check only.
- **Tenant on every row and every query**: `orgId`, `streamId` (or
  `languageId` on tables about a language). Index plans
  are part of the migration (PLAN.md section 5).
- **Snapshots are tagged with the reducer version**; a client folds the log
  rather than loading a snapshot from another version (invariant 10).

## Outside advice that does NOT apply here

Common event-sourcing and sync guidance assumes ordered streams and a single
writer. Reject it here unless a `docs/decisions.md` entry says otherwise:

| Advice you will see | Why it is wrong here |
| --- | --- |
| Optimistic concurrency with an expected stream version on append | Devices append offline for weeks; there is no current version to expect. Commutative events make it unnecessary. |
| "Projections must process events in order" | The fold is order-independent by construction; requiring order would make a late device's events unrepresentable. |
| Last-writer-wins row upserts | This is the v2 failure mode (PLAN.md section 2). Registers use HLC with parent pointers and keep the loser in history. |
| Aggregates enforce invariants by rejecting commands against current state | The device cannot know current state offline. Record the act; derive consequences; surface conflicts (comply or explain). |
| Sagas / distributed transactions | There is one database of record and one append; there is nothing to coordinate. |
| A CRDT library | Two merge shapes cover the domain (docs/decisions.md 2). |
| Store denormalized status for fast reads | Build a rebuildable read model, or ask the reducer. |
| Delete or edit a bad event | `v1.Redacted`. The log is append-only. |

## Tests to write

- A new event: add it to the fixtures; the permutation and duplication tests
  (`packages/core/test/reducer.test.ts`) must pass for it.
- A new merge rule: add a property test that includes the tie case (same HLC,
  same actor, arrival before its parent). The `property-based-testing` skill
  covers generators and shrinking.
- Client behaviour: `packages/client/test/fakeServer.ts` and
  `syncClient.test.ts` for rejected, duplicate, timeout-after-accept, and
  resume-after-crash cases; `storeContract.test.ts` for any new `EventStore`.

## Further reading

- Kleppmann et al., "Local-first software": https://www.inkandswitch.com/essay/local-first/
- Kleppmann, *Designing Data-Intensive Applications* (the
  `designing-data-intensive-applications` skill applies its rules)
- Fowler, "Event Sourcing": https://martinfowler.com/eaaDev/EventSourcing.html
- Shapiro et al., "Conflict-free Replicated Data Types" (2011), for the merge shapes
