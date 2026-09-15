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
3. **Organize.** Organizations, projects, target languages (lanes), and a
   customizable project structure (books, pericopes, passages) with
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

Every project has one **append-only event log** partitioned by organization
and project. Events are **intents** (`RecordingAdded`, `ReviewSubmitted`), not
row mutations, and every event type is **commutative and idempotent** so any
device applying any subset in any order converges. **Audio is immutable and
content-addressed**: cards are blobs named by hash, a take is an ordered list
of card hashes, editing produces a new take. **All status is derived** by a
pure reducer that runs identically on device and server; nothing stores
"approved". Clients materialize state locally the moment they append, so they
never wait for a projection to come down. Sync is push my pending events, pull
the partition tail from a cursor. Cold start is snapshot plus tail. There is
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
6. **Partitions are self-contained.** An event in project P references only
   entities in P, global reference data, or blobs by hash. Cross-project use
   is an explicit `SourceImported` pin, never a live foreign key.
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
    and skipped. Removal is `v1.Redacted`, never an edit.
12. **Small requests.** The client pushes in pages of 200; the server refuses
    batches over 500. One oversized request can never become a retry loop.

## 5. Scale-up rules from day one

From Swarnendu De's advice on enterprise software: it integrates into
organizations, which means more data, more accounts, more workflows, and if
tenancy, indexing, caching, read/write separation, async processing, and the
separation of business logic from infrastructure are not there on day one, the
first mid-size customer finds the bottleneck. Applied here:

- **Tenant on every row.** Every event carries `orgId` and `projectId`. Every
  query, index, and authorization check is scoped by them. No global scans.
- **Index plan is part of the schema.** Events: `(orgId, projectId,
  serverSeq)` for pulls, `(id)` unique for idempotency, `(orgId, projectId,
  parentEventId)` for stale detection. Snapshots: `(orgId, projectId,
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
`v2.X` and keep the old materializer forever.

| Event | Shape | Merge rule |
| --- | --- | --- |
| `v1.ProjectCreated` | name, sourceLanguoidId | once |
| `v1.ProjectConfigChanged` | config (full document) | register (LWW by HLC, parent pointer) |
| `v1.MemberAdded` / `v1.MemberRoleChanged` / `v1.MemberRemoved` | profileId, role | register per member |
| `v1.LaneAdded` | laneId, languoidId | grow-only set |
| `v1.UnitAdded` | unitId, parentUnitId, kind, label, order | grow-only set |
| `v1.ReferenceAttached` | unitId, refId, kind, blobHash or text | grow-only set |
| `v1.RecordingAdded` | recordingId, unitId, laneId, cards[{hash, durationMs}], kind | grow-only set |
| `v1.TakeComposed` | takeId, unitId, laneId, cardHashes[], parentTakeId | grow-only set |
| `v1.TakeArchived` | takeId | flag, add-wins |
| `v1.TakeSelected` | unitId, laneId, takeId | register per (unit, lane) |
| `v1.ReviewSubmitted` | takeId, stepId, decision (approve, suggest_changes), comment, answers | register per (take, step, actor) |
| `v1.AssignmentMade` | unitId, laneId, profileId, role, dueDate, instructions | register per (unit, lane, person, role) |
| `v1.SourceImported` | sourceProjectId, sourceSeq, units[] | grow-only set (pin) |
| `v1.BlobStored` | hash, size | register per hash (LWW by clock); server-only; re-issued when the object's size changes |
| `v1.BlobInvalidated` | hash, reason | register per hash; server-only; the reconciler's verdict that stored bytes do not match |
| `v1.Redacted` | eventId, reason | grow-only set; the target is never folded (owner or coordinator) |
| `v1.OrgCreated` | name | once (org partition `_org`) |
| `v1.RoleDefined` / `v1.RoleRetired` | roleId, name, privileges[] | register per role; retired is add-wins |
| `v1.OrgMemberAdded` / `v1.OrgMemberRemoved` | profileId, roleId, scope {level, projectId?, laneId?}, displayName? | register per (profile, scope) |
| `v1.CatalogItemToggled` | kind, itemId, level, projectId?, enabled | register per (kind, item, level, project) |
| `v1.ProjectRegistered` | projectId, name | grow-only set |
| `v1.LaneTemplateSelected` / `v1.LaneFlowSelected` | laneId, templateId or flowId, catalogVersion | register per lane; the selector emits the implied `UnitAdded` / `WorkflowStepSet` with ids derived from the catalog (`fia@1/gen-p1`) |
| `v1.WorkflowStepSet` / `v1.WorkflowStepRemoved` | stepId, laneId?, order, label?, role, teamId?, required, rule | register per step; removal is add-wins; lane steps override project steps override `config.workflow` |
| `v1.ReviewTeamDefined` / `v1.ReviewTeamMemberSet` | teamId, laneId, name / teamId, profileId, member | register per team, register per (team, profile) |
| `v1.ResponseRecorded` | takeId, respondsToTakeId, note?, blobHash? | grow-only (first wins) |
| `v1.ReviewCommentRecorded` | takeId, stepId, blobHash | grow-only per (take, step, actor) |
| `v1.MaterialDefined` | materialId, kind, title, scope {laneId?, unitId?, stepId?}, templateRef? | grow-only (earliest wins); question sets from the catalog get `questions@1/<template>` ids |
| `v1.MaterialFieldSet` | materialId, fieldId, text? / blobHash? | register per (material, field) |
| `v1.MaterialLocked` | materialId, locked | register per material |
| `v1.StepQuestionSetLinked` | stepId, materialId | register per step |
| `v1.KeyTermDefined` / `v1.KeyTermRenderingAdded` / `v1.KeyTermAdjusted` / `v1.KeyTermLinked` | termId, laneId, term, gloss, unitScope[] / renderingId… / adjustmentId, note, blobHash?, duringTakeId? / takeId, termId, note?, adjustmentId? | all grow-only |

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
  projectId: string;      // partition key
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

- `POST /orgs/:org/projects/:project/events` with a batch of at most 500
  pending events (`append_events`). Server checks membership fold and
  payload shape, assigns `serverSeq`, returns per-event accept or reject.
- `GET /orgs/:org/projects/:project/events?after=<serverSeq>&limit=<n>`
  (`pull_events`).
- `GET /orgs/:org/projects/:project/snapshot?reducerVersion=<v>`
  (`get_snapshot`) returns the newest snapshot for exactly that version.
  `get_snapshot_meta` and `get_snapshot_chunk` serve the same snapshot in
  256 KB pieces; the client persists each piece so a dropped link resumes.
  `put_snapshot` and `list_partitions` are service-role only and are what
  `server/snapshotWorker.ts` uses (`npm run snapshot`).
- Every call carries `CLIENT_PROTOCOL_VERSION`; below
  `server_config.min_client_version` the server answers `LQ001` and the app
  shows an upgrade state with nothing lost.
- Blobs: `PUT /blobs/:hash` idempotent, `GET /blobs/:hash`. Presence of a blob
  is independent of presence of the events that reference it.

Migration option: this protocol can be served by PowerSync syncing a single
immutable `events` table bucketed by project, with the upload queue as the
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
4. **Done.** `apps/mobile`: Expo 57 shell in Expo Go, `SqliteStore` on
   expo-sqlite (contract-tested against `MemoryStore` via node:sqlite),
   Supabase auth, auto-sync every 15 s. Every UX spec screen exists
   (`src/flow.ts` registry, `test/flow.test.ts` proves existence and
   reachability), navigation follows declared edges only, session facets
   route each role to its home, and a dev menu switches persona by real
   sign-in and seeds a demo team. Sign-out is refused while events are
   queued or the device is offline. Verified in the iOS simulator.
5. **Built, pending device verification.** Recording: the LangQuest v2
   `microphone-energy` native module (raw PCM tap, energy for the waveform,
   VAD state machine, one WAV per card) plus expo-audio for hold-to-record
   takes, both microphone sessions open at once as in v2. Cards are ingested
   into a content-addressed store (`apps/mobile/src/blobs.ts`), appended as
   `RecordingAdded`, and the draft take is recomposed. Uploads and downloads
   run on `TransferWorker` (packages/client) per section 14, with the server
   storage trigger appending `BlobStored` as the only confirmation. Needs a
   dev client (`npx expo run:ios`); Expo Go cannot load the native module.
6. Review UI driven entirely by `deriveTakeStatus`.
7. **Snapshot worker done** (`packages/client/src/snapshotWorker.ts`,
   incremental, refolds fully when a redaction targets the snapshot). Org
   dashboard as a headless client folding every project in the org: later.
8. Import path from LangQuest v2 rows into v1 events.
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
    scoped memberships, catalog toggles and project registry (core `org.ts`,
    migration 000009, smoke section 8, `apps/mobile/src/useOrg.ts`);
    `SyncClient` is generic over a materializer; session facets are
    privileges and Home follows the admin scope, so `language_home` is
    reachable and the parity test has no known dead gate.
11. **Done:** catalog bundle (`packages/core/src/catalog.ts`, data
    generated from v2's `template_structure` by `scripts/buildCatalog.ts`:
    FIA 1,352 pericopes, Chapter Units 1,189 chapters, Book Overview) with
    deterministic instantiation per lane; per-step workflow registers with
    lane > project > config precedence; review teams with assignment > team
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

## 12. Design language and the two avatars

Ported from the LangQuest v2 task-first prototype (commit 2fe8e1e5) and kept
as a rule set. Every screen declares its avatar in a comment at the top of
its file, and follows that avatar's constraints.

**Avatar U: the user (translator, reviewer).** Often non-literate, working
orally, on a phone, offline. Constraints:

- One screen, one task, one main action. The next action is always the same
  colour (`colors.action`, yellow). Nothing else on the screen is yellow.
- Icons carry meaning; words are optional. Every action, status, and role has
  an icon (`Mic` record, `ListChecks` review, `Check` approve, `X` reject,
  `RotateCcw` redo, `Clock` waiting, `CheckCircle2` done). Text that remains
  is a passage reference or reference material, never an instruction.
- Colour is never the only signal (colourblind-safe): translate is blue
  **and** a mic; review is teal **and** a checklist. Tints at 6% shade a
  card, row, or whole screen so its kind reads before its icon.
- White cards on a warm off-white ground; one dark foreground; a muted grey
  for secondary marks. No other hues besides the four task colours.
- The dashboard is a to-do list. Done items stay visible, struck through,
  so a returning user sees where they left off.

**Avatar P: the project manager or coordinator.** Literate, configuring and
monitoring, usually on a larger screen and online. Constraints:

- Text is fine and expected. Labels, tables, counts, names, timestamps.
- All options at their fingertips: workflow steps, quorum rules, unit kinds,
  reference material, members and roles, assignments, export.
- The same tokens and components, so the two halves feel like one product,
  but density and wording are unconstrained.

**Screen inventory.** Screen ids are the UX spec's (`ng-langquest-ux`,
`src/imports/*.flow.md`). U screens follow the design language above; P
screens follow the spec's layouts (breadcrumb header, sections of rows, one
pinned footer action) with our tokens.

| Spec screen | Avatar | Main action | Status |
| --- | --- | --- | --- |
| `sign_in` | U (text fallback) | sign in | built |
| `assignments_home` (My Work: To Do / Doing / Done, task cards) | U | open a task | built |
| `translate_passage` (instructions, recordings, key terms, reference, submit) | U | record, then submit | built, placeholder take |
| `quest_assets` (takes: play, delete, hold-to-record, VAD) | U | record | step 5 |
| `review_passage` (listen, questions, suggest changes or approve) | U | approve | built, no questions yet |
| `review_questions` | U | save answers | later |
| `done_await` | U | back to My Work | built |
| `pickup_home` (claim open work) | U | claim | later |
| `intent_chooser`, `create_org`, `request_access`, `walkthrough` | U | one per screen | later |
| `status_home` → `language_status` → `book_status` → `piece_status` | P | assign | step 7 (headless fold) |
| `piece_assign`, `give_assignment` | P | send assignment | later |
| `org_home`, `project_home`, `language_home` | P | none (hub) | later |
| `members_list`, `invite_member`, `edit_member`, `invite_qr` | P | invite | later |
| `roles_home`, `role_editor` | P | save role | later |
| `templates_home`, `flows_home`, `flow_editor` | P | apply / save | later |
| `reference_home`, `material_editor`, `key_terms`, `key_term_detail` | P | save | later |
| `review_teams`, `review_team_editor` | P | save team | later |
| `inbox_home`, `settings_home`, `profile_edit`, `org_switcher` | P | varies | later |

## 13. UX spec to event model

The spec's domain (`ng-langquest-ux/src/data.ts`) maps onto the event log
like this. Where the spec forced a model change, it is noted.

| Spec concept | Here | Note |
| --- | --- | --- |
| Org › Project › Language | `orgId` › `projectId` › lane (`LaneAdded`) | a lane is one target language of a project |
| Content template (FIA, OpenBible…) | catalog template selected per lane (`LaneTemplateSelected`); units instantiated with catalog-derived ids | pieces are leaf units; a lane shows its template's units plus hand-added ones |
| Piece / passage | `UnitAdded` with a leaf kind | |
| Version (submitted content) | take (`TakeComposed`) plus `TakeSubmitted` | **added** `TakeSubmitted`: recordings save immediately, submission is the hand-off (A30) |
| Take (audio) | cards (`RecordingAdded`) referenced by a take | |
| Review flow, stages A→B→C→D | catalog flow selected per lane (`LaneFlowSelected`) instantiated as `WorkflowStepSet` registers; `config.workflow` remains the fallback | |
| Review team | `ReviewTeamDefined` + `ReviewTeamMemberSet`; a step's `teamId` | eligibility: per-unit assignment, else team, else role holders |
| Stage round: assigned, submitted, reviewed | derived from assignment, submission, and review events | never stored |
| Verdict approved / suggestions | `ReviewSubmitted.decision` = `approve` or `suggest_changes` | **renamed** from reject: suggestions are advisory (A11) |
| Review questions and answers | `TakeSubmitted.questionSetIds` (material ids), `StepQuestionSetLinked`, `ReviewSubmitted.answers` keyed `materialId#fieldId` | question sets are materials of kind `questions` |
| Translator response to suggestions | a new take with `parentTakeId`, `ResponseRecorded` (note or audio), then `TakeSubmitted` | the `respond` task type |
| Assignment: type, assignee, due, instructions | `AssignmentMade` | **added** `dueDate`, `instructions`; type is derived from role and state |
| To Do / Doing / Done | `Task.status` from `deriveTasks` | todo: nothing; doing: draft exists; done: submitted or decided |
| Piece work status: unassigned / doing / waiting / done | derived per unit from assignments and take status | P dashboard, step 7 |
| Bottleneck ("3 in Community Check") | count of submitted takes by the first pending step | P dashboard, step 7 |
| Reference material (TMF, Brief, TG, FIA study), key terms | `MaterialDefined` + `MaterialFieldSet` per field, scoped to lane, unit or step; `KeyTerm*` events | `ReferenceAttached` is legacy passage notes |
| Roles with privilege switches | fixed `Role` set for now | custom roles and privileges later; `role_may_emit` is the server gate |
| Member scope (org / project / language) | membership is per project; org and lane scope later | |
| Inbox | derived from events addressed to the actor | later |
| Role gates on edges (`when`) | `Gate` on `Edge` in `apps/mobile/src/flow.ts`, `edgeAllowed` in `session.ts` | one privilege per gate (`session.can`) |
| Roles with privilege switches, member scope (org / project / language) | org partition: `RoleDefined`, `OrgMemberAdded { scope }` (core `org.ts`) | fixed roles are seed roles; `effectiveRole` maps back |
| Catalog enable at org, narrow at project (A42) | `CatalogItemToggled` in the org partition; `catalogEnabled` | selection per lane is next |

Kept from the design language, on purpose: the spec prototype is purple and
text-first. We keep its screens and flows but render U screens with the
yellow single action, icon-encoded status, and 6% tints. P screens may use
the spec's text density.

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
   hash every object) lists the bucket independently of the storage trigger,
   confirms anything unconfirmed, and appends `v1.BlobInvalidated` for
   objects whose bytes hash wrong, removing them. A blob is uploaded when the
   server says so. `PUT /blobs/:hash` is idempotent (content-addressed, so a
   re-upload is a byte-identical overwrite). Confirmation arrives as a
   `BlobStored {hash, size, storedAt}` event appended by the server into the
   project log, so it reaches every device through the normal pull. Clients
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
6. **Pacing.** Upload concurrency 4, download 25. Debounce 2 s up, 0.5 s down.
   A 60 s periodic tick as the catch-all. Re-entrancy via a draining/dirty
   flag so a signal mid-pass schedules exactly one more pass.
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

Known v2 gaps to close here: no cache eviction policy, and no server-side
garbage collection of blobs nothing references (a redacted recording's
blobs stay in the bucket until that exists).

Load harness: `npm run loadtest -- 100000` folds a synthetic Bible-scale log.
On a laptop, 100k events replay in 0.2 to 1.3 s with a 13 MB snapshot
(1.1 MB gzipped, which is what HTTP compression sends) and a 250 MB heap.
The gate is the same run on the slowest partner Android.

## 15. Open questions

- The spec's `flow.ts` and its `*.flow.md` files disagree on three edges and
  one screen name (`docs/flow-coverage-audit.md` section 1); ask the UX
  team which is authoritative before step 10 ports more.

- Caleb's workflow demo defines the review model; port its rules into
  `ProjectConfig.workflow` and confirm the quorum semantics with him.
- Global reference data ships as a static bundle (`catalog.ts`, version 1:
  content templates, flow templates, reference kinds, question templates);
  languoids are still open. A catalog bump never rewrites units: a lane
  stays on the version it selected.
- Decided for now: local Supabase (Postgres) via colima, never linked to a
  hosted project. Cloudflare Workers plus Neon remains an option; the protocol fits both.
