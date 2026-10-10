# LangQuest Next: high-level plan

This document is the source of truth for *why* this app is shaped the way it
is. Any agent or person working in this folder reads it first. If code and this
document disagree, fix the code, then update this document in the same change.

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
    snapshot produced by its own reducer version; otherwise it folds the log.
    Devices roll their own checkpoint every 2000 confirmed events and prune
    what it covers, so replay is bounded by recent history.
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

## 6. Event catalog v1

Names are versioned (`v1.X`). Never change a shipped event's schema; add
`v2.X` and keep the old materializer forever. The catalog restarted at `v1`
when the databases were reset (decision 63); nothing older survives.

**Organization stream** (`streamId` `_org`):

| Event | Shape | Merge rule |
| --- | --- | --- |
| `v1.OrgCreated` / `v1.OrgRenamed` | name | one register for both: later clock wins (decision 76) |
| `v1.RoleDefined` / `v1.RoleRetired` | roleId, name, privileges[] / roleId | register per role; retired is add-wins |
| `v1.MemberAdded` / `v1.MemberRemoved` | profileId, roleId, scope / profileId, scope; scope is `{ level: 'org' }` or `{ level: 'language', languageId }` | register per (profile, scope); one role per scope |
| `v1.InviteIssued` / `v1.InviteRedeemed` | inviteId, roleId, scope, expiresAt / inviteId, profileId | issue fields latest wins; redeemed is server-only |
| `v1.JoinDecided` | requestId, profileId, accepted | latest wins |
| `v1.LicenseSet` | license (all-rights-reserved, CC-BY-NC-ND-4.0, CC-BY-NC-SA-4.0, CC-BY-SA-4.0, CC-BY-4.0, CC0-1.0) | ratchet: the most open license ever set wins (docs/licensing.md, decision 38) |
| `v1.LanguageAdded` | languageId, name, code, sourceCode | earliest wins; the language's stream accepts events only after this |
| `v1.LanguageRenamed` | languageId, name | register per language |
| `v1.LanguageCodeSet` | languageId, code, languoidId (a languoid's UUID, or null) | register per language; takes over `LanguageAdded`'s code and links the language to the language list; none means unlinked (decision 78) |
| `v1.LanguageCountrySet` | languageId, country (ISO 3166-1 alpha-2) | register per language; the dashboard's geography (decision 41) |
| `v1.LanguageTargetSet` | languageId, scope (gospels, nt, ot, bible), startDate, targetDate | register per language; the dashboard's pace (decision 41) |
| `v1.ReferenceRecommended` | itemId, recommended | register per item; recommended to every language (decision 62) |
| `v1.LibraryItemDefined` | itemId, kind (template, flow, material, versification, source, sourceBook, timing…), name, description, copiedFrom? | kind and copiedFrom earliest wins, name and description registers (docs/library.md) |
| `v1.LibraryVersionPublished` | itemId, kind, docHash, note? | grow-only per (item, hash), earliest wins; numbered by clock |
| `v1.LibrarySharingSet` / `v1.LibraryItemArchived` | itemId, kind, shared, subscribable / archived | register per item; subscribable implies shared |
| `v1.LibrarySubscribed` / `v1.LibraryPinned` | itemId, kind, sourceOrgId, sourceOrgName, sourceItemId, name, autoUpdate, active / docHash | register per item; the server writes the pin for automatic updates |
| `v1.Redacted` | eventId, reason | grow-only set; the target is never folded; a redaction is never itself redacted (decisions.md 16) |

**Language stream** (`streamId` the language id; no payload names a language):

| Event | Shape | Merge rule |
| --- | --- | --- |
| `v1.TemplateSelected` | itemId, docHash, unitPrefix, books? | register; the selector emits `UnitAdded` (`<itemId>/GEN.1.1-2.3`) and `UnitHidden` |
| `v1.UnitAdded` | unitId, parentUnitId, kind, label, order | grow-only set |
| `v1.UnitHidden` | unitId, hidden | register per unit; a part the template's version no longer has |
| `v1.BookNameSet` | book, name | register per book (USFM); what this language calls a Bible book, whatever its template calls it (decision 74) |
| `v1.FlowSelected` | flowId, itemId, docHash, name | register; the selector emits kinds and `FlowStepSet` under `<flowId>/` |
| `v1.FlowStepSet` / `v1.FlowStepRemoved` | stepId, order, kindIds[], checkpoint / stepId | register per step; removal is add-wins; kinds in one step run in parallel, a checkpoint is the only gate |
| `v1.ReviewKindDefined` | kindId, name, description?, usualReviewer?, withholdsContext?, produces? | register per kind; overrides the shipped kind of the same id |
| `v1.ReviewTeamDefined` / `v1.ReviewTeamMemberSet` / `v1.ReviewTeamKindSet` | teamId, name / teamId, profileId, member / teamId, kindId (null = any) | register per team, per (team, profile), per team |
| `v1.RecordingAdded` | recordingId, unitId, cards[{hash, durationMs}], kind | grow-only set; one event per id, earliest wins (decisions.md 75) |
| `v1.TakeComposed` / `v1.TakeArchived` | takeId, unitId, cardHashes[], parentTakeId / takeId | grow-only set, one event per id, earliest wins (decisions.md 75) / flag, add-wins |
| `v1.TakeSelected` | unitId, takeId | register per unit |
| `v1.TakeSubmitted` | takeId, questionSetIds? | grow-only; the first submission counts |
| `v1.ResponseRecorded` | takeId, respondsToTakeId, note?, blobHash? | grow-only (first wins) |
| `v1.ReviewRecorded` | reviewId, takeId, kindId, outcome (looks_good, needs_changes, recorded), via (app, link, logged), comment?, commentBlobHash?, answers?, skipped?, people?, place?, givenBy?, requestId?, artifactHashes? | grow-only (earliest wins) |
| `v1.FlowStepLinksSet` | stepId, allowed | register per step; may the step be reviewed by a shared link that counts (default: any step but a checkpoint; decision 70) |
| `v1.VersionReleased` | takeId, channel, live, url? | register per (version, channel); where a version is published, a fact not a verdict (decision 72) |
| `v1.DepartureRecorded` / `v1.DepartureUndone` | departureId, unitId, type (skip, override, keep), kindId? / stepId? / reviewId?, reason, reasonBlobHash? / departureId | grow-only / add-wins undo |
| `v1.RequestMade` / `v1.RequestWithdrawn` | requestId, unitId, what (record, review), kindId?, exactly one of profileId, guest, teamId, dueDate?, note?, noteBlobHash?, questions? / requestId | grow-only / add-wins; done is derived from the record |
| `v1.NoteAdded` | noteId, unitId, anchor (passage, version, verse, study, term), text? / blobHash? / photoHash?, onTakeId? | grow-only |
| `v1.StudyStepMarked` | unitId, guideId, stepId, done | register per (unit, guide, step) |
| `v1.MaterialDefined` / `v1.MaterialFieldSet` / `v1.MaterialLocked` | materialId, kind, title, scope {unitId?, stepId?}, templateRef? / materialId, fieldId, text? / blobHash? / materialId, locked | earliest wins / register per (material, field) / register per material |
| `v1.KeyTermDefined` / `v1.KeyTermRenderingAdded` / `v1.KeyTermAdjusted` / `v1.KeyTermLinked` | termId, term, gloss, unitScope[] / renderingId… / adjustmentId, note, blobHash?, duringTakeId? / takeId, termId, note?, adjustmentId? | all grow-only |
| `v1.ReferenceSet` | itemId, state (recommended, hidden, inherit) | register per item; the language's say on a library item (decision 62) |
| `v1.PassageReferenceLinked` | unitId, itemId, linked | register per (unit, item) |
| `v1.ReferencesUsed` | unitId, takeId? or reviewId?, items[] | grow-only |
| `v1.BlobStored` / `v1.BlobInvalidated` | hash, size / hash, reason | register per hash (LWW by clock); server-only |
| `v1.CardVerseSet` | unitId, hash, mark (next, join, set, none), from?, to? | register per (unit, card); which verses a recorded part holds, worked out down a take's cards (verses.ts, decisions.md 82) |
| `v1.AudioFormatSet` | hash, format | one event per hash, earliest wins (decisions.md 75); a voice note's format when not m4a (decisions.md 77) |
| `v1.ExternalValueSet` | key, data (object or null) | register per key (later clock, then higher id); a third-party app's own value, kept and never acted on; only the app's Worker appends it, for a token with the `external_values` scope (decisions.md 79) |
| `v1.Redacted` | eventId, reason | grow-only set; the target is never folded; a redaction is never itself redacted (decisions.md 16) |

**Person stream** (org `_person`, `streamId` the profile id; written only by
`record_user_event`): `v1.TermsAccepted`, `v1.VisionSeen`,
`v1.WalkthroughDone`.

Smells to catch in review:

- Any event phrased as "set the whole list" or "move X from A to B". Split it
  into commutative parts.
- A reducer case that **reads existing state to decide what to write**. The
  first version of `MemberRemoved` copied the member's current role, so a
  removal that arrived before the add produced a different role. The
  permutation test caught it. Each event writes only its own registers.

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

Local events table adds `status: 'pending' | 'confirmed' | 'rejected'` and
`rejectReason`.

## 8. Conflict rules

- Two people compose takes offline: two takes appear. The workflow decides.
- Same-parent register events: later HLC wins, loser is kept in history and
  surfaced as superseded on the losing device.
- Archive versus new take from the archived one: add-wins, the new take
  survives with a note.
- Config edits: register with parent pointer, warn on stale.

## 9. Sync protocol

Current implementation is two Postgres RPCs on local Supabase
(`append_events`, `pull_events`, see `server/README.md`). The HTTP shape
below is the contract they satisfy; a Workers front end can wrap them later.

- `POST /orgs/:org/streams/:stream/events` with a batch of at most 500
  pending events (`append_events`). Server checks membership fold and
  payload shape, assigns `serverSeq`, returns per-event accept or reject.
- `GET /orgs/:org/streams/:stream/events?after=<serverSeq>&limit=<n>`
  (`pull_events`).
- `GET /orgs/:org/streams/:stream/snapshot?reducerVersion=<v>`
  (`get_snapshot`) returns the newest snapshot for exactly that version.
  `get_snapshot_meta` and `get_snapshot_chunk` serve the same snapshot in
  256 KB pieces; the client persists each piece so a dropped link resumes.
  `put_snapshot` and `list_streams` are service-role only and are what
  `server/snapshotWorker.ts` uses (`npm run snapshot`).
- Every call carries `CLIENT_PROTOCOL_VERSION`; below
  `server_config.min_client_version` the server answers `LQ001` and the app
  shows an upgrade state with nothing lost.
- Blobs: `PUT /blobs/:hash` idempotent, `GET /blobs/:hash`. Presence of a blob
  is independent of presence of the events that reference it.

Migration option: this protocol can be served by PowerSync syncing a single
immutable `events` table bucketed by stream, with the upload queue as the
outbox. Decide by cost, not architecture.

## 10. Repository layout

```
langquest-next/
  PLAN.md            this file
  CLAUDE.md          agent entry point
  packages/core/     events, reducer, workflow, HLC, snapshot; pure TS + tests
  packages/client/   SyncClient (local log, fold on append, outbox push, cursor
                     pull), EventStore and Transport interfaces, MemoryStore,
                     SupabaseTransport; unit tests on a fake server plus an
                     integration test against local Supabase
  apps/mobile/       Expo app; SQLite EventStore, blob store, screens
  apps/web/          the Cloudflare Worker that serves the app's web export
                     (decisions 57, 58) and the reports API: one Durable
                     Object per org folds its streams and serves the
                     reports each person may view (decision 44)
  server/            supabase migrations (events, snapshots, RPCs), smoke.sql
  docs/              decisions
```

## 11. Build order

1. **Done.** `packages/core`: envelope, catalog, reducer, workflow, property
   tests for order-independence and idempotence.
2. **Done.** `server`: `append_events` with the membership fold, `pull_events`
   by cursor, append-only triggers, local Supabase via colima. `npm run
   db:test` runs `server/smoke.sql`.
3. **Done.** `packages/client`: `SyncClient` with fold-on-append, outbox push
   that keeps rejected events, paged pull, offline no-op. Verified by
   `npm run test:integration` with two real users.
4. **Done.** `apps/mobile`: Expo 57 shell, `SqliteStore` on
   expo-sqlite (contract-tested against `MemoryStore` via node:sqlite),
   Supabase auth, auto-sync every 15 s. Every UX spec screen exists
   (`src/flow.ts` registry, `test/flow.test.ts` proves existence and
   reachability), navigation follows declared edges only, session facets
   route each role to its home, and a dev menu switches persona by real
   sign-in and seeds a demo team. Sign-out is refused only while this
   session still has queued events it could deliver: not merely because the
   device is offline, and never when the server has refused this actor
   (a refusal cannot be queued out of, so trapping the user would leave a
   reinstall as the only escape). The screen says which case it is.
   Verified in the iOS simulator.
5. **Built, pending device verification.** Recording: the LangQuest v2
   `microphone-energy` native module (raw PCM tap, energy for the waveform,
   VAD state machine, one WAV per card) plus expo-audio for hold-to-record
   takes, both microphone sessions open at once as in v2. Cards are ingested
   into a content-addressed store (`apps/mobile/src/blobs.ts`), appended as
   `RecordingAdded`, and the draft take is recomposed. Uploads and downloads
   run on `TransferWorker` (packages/client) per section 14, through the
   app's Worker into R2 (decisions.md 69), which appends `BlobStored` as the
   only confirmation. Needs a
   dev client (`npm run ios`, which decrypts the env file); Expo Go cannot load the native module.
6. Review UI driven entirely by `deriveTakeStatus`.
7. **Snapshot worker done** (`packages/client/src/snapshotWorker.ts`,
   incremental, refolds fully when a redaction targets the snapshot). Org
   dashboard: step 14, folded by the dashboard's own server (decision 44).
8. **Done.** Import path from LangQuest v2 rows into v1 events:
   `server/importV2.ts` (`npm run import:v2`) reads v2 anonymously, copies
   audio by content hash into R2 through the Worker, and appends deterministic
   events (`packages/client/src/v2import.ts`), so re-runs are duplicates.
   Text-only v2 translations have no oral equivalent and are counted, not
   imported. Verified on three production projects in the simulator.
9. **Done in part.** Flow coverage proof and read indexes
   (`docs/flow-coverage-audit.md`): `apps/mobile/test/specParity.test.ts`
   holds the app's flow machine to the spec's, edge by edge, with the spec's
   role gates now declared on edges and enforced by `go()`;
   `packages/core/src/indexes.ts` makes every derivation linear (27 s to
   20 ms for `deriveTasks` at Bible scale); `deriveBlockers` names the
   states nobody can leave. **Done:** batched store writes (`putMany`, one
   transaction per pull page), as-of authorization and membership-coded
   refusals that re-queue on re-admission, clock-ahead refusal with client
   re-stamping, snapshot-first handling of a redaction inside a checkpoint
   (migration 000008, `syncClient.ts`, smoke section 7).
10. **Done:** org partition (`_org`) with roles as privilege sets,
    scoped memberships, catalog toggles and partition registry (core `org.ts`,
    migration 000009, smoke section 8, `apps/mobile/src/useOrg.ts`);
    `SyncClient` is generic over a materializer; session facets are
    privileges and Home follows the admin scope, so `language_home` is
    reachable and the parity test has no known dead gate.
11. **Done:** catalog bundle (`packages/core/src/catalog.ts`, data
    generated from v2's `template_structure` by `scripts/buildCatalog.ts`:
    FIA 1,352 pericopes, Chapter Units 1,189 chapters, Book Overview) with
    deterministic instantiation per lane; per-step workflow registers with
    lane > partition > config precedence; review teams with assignment > team
    > role eligibility; the respond note and spoken review comment events
    (migration 000010, smoke section 9, `templates_home`, `flows_home`,
    `flow_editor`, `review_teams`, `review_team_editor`, `attach_questions`).
12. **Done:** reference material as per-field registers with scope, lock
    and catalog templates; question sets as materials (a step's default set
    via `StepQuestionSetLinked`, plus what the translator attaches); key
    terms as a living glossary with renderings, recorded adjustments and
    links both ways (core `materials.ts`, migration 000011, smoke section
    10; `reference_home`, `material_editor`, `key_terms`,
    `key_term_detail`, `attach_questions`, `review_questions`, `add_to_tg`).
    `ReferenceAttached` remains as legacy passage notes. Next: requests,
    invites, public projection, notifications, profiles
    (`docs/flow-coverage-audit.md` sections 5 and 6).
13. **Done:** the passage record and the UX demo's flow (`docs/ux/demo-parity.md`).
    Core `record.ts` and `passage.ts` port the demo's record model: review
    kinds, flows of parallel kinds with checkpoints, reviews by kind in the
    app, by link or logged, back translations as review artifacts,
    departures with a reason, requests, anchored notes, study marks
    (migration 20260928000001, `scripts/record-parity-sql.ts`). The mobile
    app's flow machine, tokens and screens are the demo's.
14. **Done:** web progress dashboard (`apps/web`, decisions 40 and 43). Core
    `reports.ts` derives one report per language from the passage record,
    with 90 days of progress. The dashboard's Worker keeps one Durable
    Object per organization (`apps/web/worker`) that starts from the server
    snapshots, catches up from the log's tail, and returns the reports
    `mayViewLane` allows; the page sums them into organization totals, with
    CSV export and print. `npm run web:dev` runs both against the local
    database. (The first version stored reports in `lane_reports`; migration
    20260930120000 drops them.)
15. **Done:** portfolio dashboard (decision 41), after a partner's own
    reporting tool. Report version 2 adds verse-weighted coverage of the
    Gospels, New Testament and Old Testament (core `coverage.ts`),
    uploads timed by the server's `BlobStored`, a day-by-day log, a
    chapter ledger by month, milestones and stuck-audio alerts. Two new
    events, `LaneCountrySet` and `LaneTargetSet` (migration
    20260930000001, smoke section 11), are set from the web app, which
    now has Overview, Recent activity, Languages (recency bands and a
    watch list), Geography, Field report, Monthly ledger, Pace and Alerts,
    a sidebar and a dark mode.

## 12. Design language

The app follows the partner demo in `ng-langquest-ux` (its flow, look and
capabilities; `docs/ux/demo-parity.md` maps it onto this repository). The
demo's `docs/design-principles.md`, `docs/requirements.md` (REC-3 and so on)
and `docs/decisions.md` (ADR-nnn) are the specification for screens. In
short:

- **A record with advice, not a pipeline with gates.** Each passage builds
  up a record; the language's review flow advises what should be in it.
  People may skip a step, work out of order, or keep a version despite
  feedback, and each departure is recorded with a reason ("comply or
  explain"). Checkpoints are the only hard stops, and someone with Override
  Checkpoints can move past one, with the reason logged.
- **Permissions and method are separate.** Permissions (edge gates, the
  server's `may_emit`) say who may act; the flow never does.
- **One place for what's next.** Everyone who does or asks for work lands
  on My Work; the Map finds any passage at whole-Bible scale; the passage
  record is where every loop closes, with a toast (and Undo) after every
  action.
- **Simple on the surface, deep in the record.** One next step and one main
  button; background and history behind one-line summaries.
- **Built for the field.** 48pt targets, 56pt primary actions, 13pt minimum
  text, status colours that never change and never carry meaning alone.

Tokens are `apps/mobile/src/theme.ts` (the demo's `C` and `TINT`);
primitives are `apps/mobile/src/kit.tsx`. `docs/ux/one-next-action.html`
records the earlier task-first design. Recording now splits the screen with
the source instead of taking it over (decisions.md 56). Each screen's main
action, secondary actions and way back are in `docs/ux/screen-path.md`.

## 13. UX spec to event model

The spec's domain (`ng-langquest-ux/src/data.ts`) maps onto the event log
like this. Where the spec forced a model change, it is noted. The record
model (kinds, flows, reviews by kind, departures, requests, notes, study) is
in `docs/ux/demo-parity.md`; the role-based workflow model it replaced is
gone (decision 63).

| Spec concept | Here | Note |
| --- | --- | --- |
| Org › Language | `orgId` › one stream per language (`streamId` = the language's id), listed by `LanguageAdded` in the organization stream (`orgLanguages`) | no project and no lane (decision 63); a phone pulls the languages it opens (decision 37) |
| Content template (FIA, OpenBible…) | a library item's version (docs/library.md) used by the language (`TemplateSelected`); units `<itemId>/<node>`, parts a later version drops hidden (`UnitHidden`); a `template@2` Bible breaks up each book its own way or not yet (decision 74) | pieces are leaf units; a language shows its template's units in the books it covers, plus hand-added ones; a book with none waits to be broken up |
| Piece / passage | `UnitAdded` with a leaf kind | |
| Version (submitted content) | take (`TakeComposed`) plus `TakeSubmitted` | **added** `TakeSubmitted`: recordings save immediately, submission is the hand-off (A30) |
| Take (audio) | cards (`RecordingAdded`) referenced by a take | |
| Review flow, stages A→B→C→D | a library flow's version used by the language (`FlowSelected`) instantiated as `FlowStepSet` registers with the kinds it brings | |
| Review team | `ReviewTeamDefined` + `ReviewTeamMemberSet`, `ReviewTeamKindSet` (the kind it usually does) | a request may go to a team (`RequestMade.teamId`); `usualTarget` suggests one |
| Stage round: asked, submitted, reviewed | derived from requests, submissions and reviews (`derivePassage`) | never stored |
| Verdict looks good / needs changes | `ReviewRecorded.outcome` = `looks_good`, `needs_changes` or `recorded` (a producing kind), by kind | suggestions are advisory (A11); a checkpoint step is passed or overridden (`DepartureRecorded`) |
| Review questions and answers | `TakeSubmitted.questionSetIds` (material ids), the kind's questions (`questionsForKind`) or a request's own, `ReviewRecorded.answers` | question sets are materials of kind `questions` |
| Translator response to suggestions | a new take with `parentTakeId`, `ResponseRecorded` (note or audio), then `TakeSubmitted` | the `respond` task type |
| Assignment: what, who, due, note | `RequestMade` (record or review; a person, a guest or a team) and `RequestWithdrawn` | **added** `dueDate`, `note`; a request is done when what it asked for happens |
| To Do / Doing / Done | `upNext`, `highlightsFor` and `waitingOn` (core `passage.ts`) | todo: asked or next; doing: a draft exists; done: the flow is through |
| Piece work status | derived per passage (`derivePassage`: recorded, steps complete, done) | reports (`languageReport`) |
| Bottleneck ("3 in Community Check") | passages by the first step not yet complete (`languageProgress.steps`) | reports |
| Reference material (TMF, Brief, TG, FIA study), key terms | library material (study guides and collections, simple documents, question sets) matched to passages by verses through their versifications; the organization's own working material as `MaterialDefined` + `MaterialFieldSet`; `KeyTerm*` events | a v2 project's source content is imported as material |
| Inbox | `updatesFor` (core `passage.ts`): what concerns the actor on the record, plus server notifications | read state is per device |
| Role gates on edges (`when`) | `Gate` on `Edge` in `apps/mobile/src/flow.ts`, `edgeAllowed` in `session.ts` | one privilege per gate (`session.can`) |
| Roles with privilege switches, member scope (org / language) | organization stream: `RoleDefined`, `MemberAdded { scope }` (core `org.ts`); one role per scope | fixed roles are seed roles; `effectiveRole` maps back |
| Sharing templates, flows and material between organizations | library items: shared / followable per item, copied or followed (`Library*` events, `library_adopt`) | decision 36; recommendations are `ReferenceRecommended` and `ReferenceSet` (decision 62) |
| Who may use an organization's work, and what outsiders see | `v1.LicenseSet` in the organization stream (`orgLicense`, `LICENSE_INFO[..].terms`); outsiders read a projection, never the log | **added**, not in the demo (decision 38, docs/licensing.md); only ever opens |
| Whether this phone sends field diagnostics | Settings › App › Send diagnostics, a switch row (`diag:off` in device meta, `src/diagnosticsSetting.ts`); diagnostics are never events | **added**, not in the demo (decision 39, docs/diagnostics.md); on by default, and off deletes what is waiting |
| Reporting content or a person, and blocking someone | a flag on anything someone else made (`reportSheet.tsx`); `content_reports` and `user_blocks` rows sent through the account outbox, never events; a moderator removes content with `v1.Redacted`, staff act through `npm run moderation`; a blocked person's words and audio are hidden behind Show and their work still counts | **added**, not in the demo (decision 48); Google Play requires it |

## 14. Blobs: the upload and download design for step 5

Carried over from the LangQuest v2 attachment rewrite (August 2026, PRs 921,
928, 930), which replaced a persisted attachment queue with derived work
lists after the queue kept disagreeing with disk and database. Every rule
below was earned in production there.

1. **No persisted queue.** The upload list is derived on every pass from the
   fold: card hashes referenced by `RecordingAdded` events that the server has
   not confirmed, intersected with files present on this device. Recording a
   card *is* the enqueue. Only disposable in-memory retry state exists, and
   losing it costs one idempotent attempt.
2. **The server confirms, never the client, and the bytes are checked.** A
   blob is uploaded when the server says so. The confirmation carries the
   stored size; a device whose file differs in size uploads again. Every
   download is hashed before the file is trusted; a mismatch is deleted and
   retried. `server/blobReconciler.ts` (`npm run reconcile`, `--verify` to
   hash every object) lists R2 through the Worker independently of the
   confirmation each upload gets, confirms anything unconfirmed, and appends
   `v1.BlobInvalidated` for objects whose bytes hash wrong, removing them.
   `PUT /api/blobs/<org>/<stream>/<hash>.<ext>` on the app's Worker is
   idempotent (content-addressed, so a re-upload is a byte-identical
   overwrite), and R2 refuses bytes that do not hash to their name
   (decisions.md 69). Confirmation arrives as a
   `BlobStored {hash, size, storedAt}` event appended by the server into the
   language's stream, so it reaches every device through the normal pull. Clients
   have no way to write it: `append_events` refuses `BlobStored` from any
   non-service caller.
3. **Grace, not flags.** After a successful PUT the uploader leaves the hash
   alone for a grace window (10 min in v2) and then re-derives; if the
   confirmation never arrived, it re-uploads. Lost confirmations self-heal.
4. **Two wake-up verbs.** `trigger()` clears backoff waits (reconnect, app
   foreground, after recording); `nudge()` asks for a pass without touching
   backoff or grace. Confusing the two caused retry storms in v2.
5. **Backoff ladder, never terminal.** Upload 30 s, 1 m, 5 m, 30 m cap;
   download 30 s, 2 m, 10 m cap. Failure counts survive a trigger; only the
   wait is cleared.
6. **Pacing.** Upload concurrency 1, download 2, plus a shared bytes-in-flight
   budget (`TransferBudget`, 24 MB) across every worker on the device; v2 ran
   4 and 25 with whole files in memory, which is the peak-memory risk on a
   weak phone. Tune upward only from measurements on a representative
   device. Debounce 2 s up, 0.5 s down. A 60 s periodic tick as the
   catch-all. Re-entrancy via a draining/dirty flag so a signal mid-pass
   schedules exactly one more pass. Transfers also pause while the
   microphone is open or a recording is being saved (`isDeferred`).
7. **Stop while pulling.** No transfers while a pull is in progress, and the
   check repeats before each file inside a batch: a batch of thousands of
   stale entries after an upgrade must end early, not run to completion on a
   metered link. This was the "runaway train" incident.
8. **Offline is honest and quiet.** Report the pending count, attempt
   nothing, leave backoff untouched. Online means HTTPS reachability, not the
   sync channel being connected.
9. **Local file index.** One directory listing at startup, additive after.
   The on-disk path is a pure function of the hash; no table maps names to
   paths. A missing local file is simply absent from the upload list and
   surfaces as a visible pending count, never an error state.
10. **Download by scope, not by demand.** Confirmed blobs for the units the
    user is assigned to or has worked in (`defaultOfflineScope`) plus units
    they chose to keep offline (`keepOffline`); playback resolves the local
    path or streams. Nothing marks a download done except the file being on
    disk.
11. **Audio is immutable.** Already invariant 4. It is what makes the
    confirmation monotonic and the upsert safe; v2 had to document the
    re-record-in-place case as unhandled.
12. **Measure from server truth.** Load tests count confirmed blobs on the
    server and files on disk, never client counters, so the same harness
    works across rewrites.

Cache eviction (closing a v2 gap): the device keeps 500 MB free for
recording and caps the blob cache at 2 GB. Only files core `evictableBlobs`
names may go: referenced by this language, confirmed intact on the server,
outside the offline scope, and not upload work. Unsynced recordings, kept
units, and other languages' files are never touched. Downloads land in a
`.part` staging name and are renamed only after their hash matches;
startup deletes leftover staging files.

Known v2 gap still open: no server-side garbage collection of blobs nothing
references (a redacted recording's blobs stay in the bucket until that
exists).

Load harness: `npx tsx scripts/loadtest.ts 100000` folds a synthetic Bible-scale log.
On a laptop, 100k events replay in 0.2 to 1.3 s with a 13 MB snapshot
(1.1 MB gzipped, which is what HTTP compression sends) and a 250 MB heap.
The gate is the same run on the slowest partner Android.

## 15. Open questions

- The spec's `flow.ts` and its `*.flow.md` files disagree on three edges and
  one screen name (`docs/flow-coverage-audit.md` section 1); ask the UX
  team which is authoritative before step 10 ports more.

- Content templates, flows and reference material are library documents in
  the database (decision 36, docs/library.md). The
  canon (book ids and order) and the versification engine are core
  reference data. Languoids are still open.
- Decided for now: local Supabase (Postgres) via colima, never linked to a
  hosted project. Cloudflare Workers plus Neon remains an option; the protocol fits both.
