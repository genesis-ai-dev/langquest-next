# LangQuest Next: the design

This document is the source of truth for *why* this app is shaped the way it
is: what it is for, what we learned, the design in one paragraph, the
invariants every change keeps, and the envelope and conflict rules. Any agent
or person working in this folder reads it first. If code and this document
disagree, fix the code, then update this document in the same change.

How each part works now is in `docs/` (`docs/README.md` lists every doc),
and why each choice was made is in `docs/decisions/`. Sections 6 and 9 to 15
moved out or were removed on 2026-11-19
(`docs/decisions/2026-11-19-each-doc-answers-one-question.md`); each keeps its
number here with a pointer, since code and docs cite them by number.
## 1. What we are building

An oral Bible translation tool. Teams in remote places record audio
translations passage by passage, often fully offline for a month or more, then
sync when they reach a connection. The product's core job is **organizing
audio recordings and their approval state**: who recorded what, when, what
status it is in, who approved it, who has not, and who still needs to.

Core workflows, in priority order:

1. **Record and edit by cards.** Voice activity detection splits speech into
   small audio cards. Editing means re-recording or reordering cards, not
   scrubbing a waveform. A source reader can speak in the background while a
   translator speaks the target live.
2. **Review and approve.** Configurable review steps: who reviews, how many
   steps, optional or required, any / majority / unanimous.
3. **Organize.** Organizations and the target languages they hold
   directly (no project level: docs/decisions.md 63), and a customizable
   structure (books, pericopes, passages) with
   configurable reference material per unit (audio overviews, text, key terms).
4. **See status.** Translators see their passages and what is pending.
   Coordinators see the whole org.

Non-goals for v1: real-time co-editing of one recording, waveform editing,
text-first translation (that is Aquila), public browsing of everything.

## 2. What we learned from Codex, Aquila, and LangQuest v2

These are the mistakes this design exists to avoid. Do not reintroduce them.

- **Sync engines that merge state are where support time goes.** Codex spent
  roughly ninety percent of its support effort on a custom Git merge of
  notebook files. LangQuest v2 has a last-writer-wins upsert with at-least-once
  delivery, patched by tombstone triggers, plus a documented path where a
  rejected upload is dropped from the device.
- **Rollups maintained by triggers blow up.** LangQuest v2's closure tables are
  kept by about ninety Postgres triggers, several of which had to be batched or
  disabled after exceeding the 8 second statement timeout and putting every
  upload into a permanent retry loop.
- **Interdependent row mutations force client-side ordering.** The v2 publish
  flow is a 180-line ordered insert with a mid-transaction network check to
  dodge a race. That exists only because clients ship rows that must satisfy
  foreign keys in order.
- **Coupled schema versions brick clients.** v2 has three version systems
  (Supabase SQL, a client schema version with local migrations, server-side
  upcasters). Two named incidents left users stuck until a new build shipped.
- **Dual local/synced schemas double the surface.** v2 keeps `_local` and
  `_synced` copies of every table joined by generated union views, purely
  because the sync engine owns the synced tables.
- **Offline-first as whole-project replication was the wrong requirement.**
  Aquila found that almost nobody is fully offline; they have a weak
  connection. Big payloads fail; small deltas succeed. LangQuest users are the
  exception that still needs long offline periods, but they still benefit from
  small deltas when they do connect.

Aquila's fix was one boring Postgres database, an append-only event log,
projections derived from it, an outbox on the client, and a single conflict
rule. This app takes the same shape and extends it to true offline.

## 3. The design in one paragraph

Every organization keeps its history in **append-only event streams**: one
organization stream (roles, members, library, and the list of its languages)
and one stream per language (that language's work); each person also has a
small stream of their own (decision 63, `docs/streams-and-languages.md`).
Events are **intents** (`RecordingAdded`, `ReviewRecorded`), not
row mutations, and every event type is **commutative and idempotent** so any
device applying any subset in any order converges. **Audio is immutable and
content-addressed**: cards are blobs named by hash, a take is an ordered list
of card hashes, editing produces a new take. **All status is derived** by a
pure reducer that runs identically on device and server; nothing stores
"approved". Clients materialize state locally the moment they append, so they
never wait for a projection to come down. Sync is push my pending events, pull
the stream's tail from a cursor. Cold start is snapshot plus tail. There is
one state schema, not two; sync status lives on events, not rows.

## 4. Invariants (the things we care about most)

Agents: treat each of these as a test you must not break.

1. **No event is ever lost or silently dropped.** A rejected event stays in the
   local log marked rejected with a reason and is shown to the user.
2. **Fold is deterministic and order-independent.** For any set of events,
   any permutation folds to the same state. Enforced by property tests in
   `packages/core`.
3. **Fold is idempotent.** Applying an event twice equals applying it once.
4. **Audio is never mutated.** Cards and takes are immutable. Any edit is a
   new take that may reference existing cards.
5. **Status is derived, never stored.** No `status` or `approved` column
   anywhere. Ask the reducer.
6. **Streams are self-contained.** An event in stream S references only
   entities in S, the organization's library and identity (which every
   member holds), or blobs by hash. A work event carries no language id: the
   stream it is appended to says which language it belongs to.
7. **One state schema.** No local versus synced tables. Pending versus
   confirmed is a column on the events table.
8. **Reducer is pure TypeScript with no I/O**, shared byte-for-byte by the
   mobile app and the server. Infrastructure (SQLite, HTTP, storage) sits
   outside `packages/core`.
9. **Server folds are off the write path.** Accepting an event requires only
   the membership fold for authorization. Dashboards, snapshots, search, and
   integrity checks are async and may lag without affecting translators.
10. **Snapshots are tagged with the reducer version.** A client only loads a
    snapshot produced by its own reducer version. Devices roll their own
    checkpoint every 2000 confirmed events and prune what it covers, so
    replay is bounded by recent history. A checkpoint from another reducer
    version is dropped with the stream's cursor, so the device takes the
    server's snapshot for its version or pulls the log again from the start;
    it never folds the pruned tail as the whole stream (decisions.md 110).
11. **Every event is validated at the door, and the fold never throws.**
    `validate_payload` (SQL) and `validateEvent` (core) are the same rules. A
    malformed event that slips through is counted in `state.invalidEvents`
    and skipped. Removal is `v1.Redacted`, never an edit, with one exception:
    erasing a deleted person's name (decisions.md 47).
12. **Small requests.** The client pushes in pages of 200; the server refuses
    batches over 500. One oversized request can never become a retry loop.

## 5. Scale-up rules from day one

From Swarnendu De's advice on enterprise software: it integrates into
organizations, which means more data, more accounts, more workflows, and if
tenancy, indexing, caching, read/write separation, async processing, and the
separation of business logic from infrastructure are not there on day one, the
first mid-size customer finds the bottleneck. Applied here:

- **Tenant on every row.** Every event carries `orgId` and `streamId`. Every
  query, index, and authorization check is scoped by them. No global scans.
- **Index plan is part of the schema.** Events: `(orgId, streamId,
  serverSeq)` for pulls, `(id)` unique for idempotency, `(orgId, streamId,
  parentEventId)` for stale detection. Snapshots: `(orgId, streamId,
  reducerVersion, serverSeq desc)`.
- **Read/write separation is structural.** Writes are appends to the log.
  Reads are projections and snapshots. They never share a table.
- **Async everything that is not the append.** Folding for dashboards,
  snapshot generation, blob confirmation, notifications, search indexing all
  run as workers consuming the log.
- **Caching is snapshots plus bounded pulls.** Pulls are paginated by
  `serverSeq` with a hard page size. Snapshots are the cache. Per-org rate
  limits on push and pull from the start.
- **Business logic lives in `packages/core`.** It has zero dependencies on
  SQLite, Postgres, Expo, or HTTP. Infrastructure adapters are thin.

## 6. Event catalog

Moved to `docs/events.md`, with what a new event needs.

## 7. Envelope

```ts
{
  id: string;             // client-generated, unique, sortable
  type: 'v1.RecordingAdded';
  orgId: string;
  streamId: string;       // '_org', a language id, or a profile id under org '_person'
  actorId: string;
  deviceId: string;
  hlc: string;            // hybrid logical clock, lexically sortable
  parentEventId?: string; // register-style events only
  payload: {...};
  serverSeq?: number;     // assigned on accept; absent while pending
}
```

Local events table adds `status: 'pending' | 'confirmed' | 'rejected' | 'nearby'`
and `rejectReason`. `nearby` is a teammate's event that came from their phone
and that the server has not confirmed: folded, never pushed, never in a
checkpoint, with `via` saying which signed batch or attested claim brought it
(docs/nearby-sync-plan.md 5.2, decisions.md 212).

## 8. Conflict rules

- Two people compose takes offline: two takes appear. The workflow decides.
- Same-parent register events: later HLC wins, loser is kept in history and
  surfaced as superseded on the losing device.
- Archive versus new take from the archived one: add-wins, the new take
  survives with a note.
- Config edits: register with parent pointer, warn on stale.

## 9. Sync protocol

Moved to `docs/sync-protocol.md`.

## 10. Repository layout

Moved to `README.md` (Repository layout).

## 11. Build order

Removed. It logged what was built when, and had fallen behind the code (it
still named lanes and partitions). Git history and `docs/decisions/` hold
that history.

## 12. Design language

Moved to `docs/ux/principles.md`.

## 13. UX spec to event model

Moved to `docs/ux/demo-parity.md` (The spec's domain in the event log).

## 14. Blobs: the upload and download design

Moved to `docs/blobs.md`, where the rules keep their numbers ("PLAN.md
section 14 rule 2" is rule 2 there).

## 15. Open questions

Removed. Each was settled: the app's flow is generated from the demo's
`flow.ts` (`docs/ux/demo-parity.md`); templates, flows and reference material
are library documents (decision 36); languages and regions are reference
data (decision 73); and the database is Supabase, hosted for preview and
production (decisions 42 and 50). Open work is in Linear.
