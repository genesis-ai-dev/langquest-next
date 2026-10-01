# Decisions

The architecture decision record (ADR) log for this app. It is the only one:
every architecture or design decision, from any developer or agent, is recorded
here as it is made, so the log reads as the history of how the design got to
where it is. Each entry has the reason and what would change our mind.

## How to write an entry

Write one when a change is hard to reverse, would surprise a reader without
context, and came from a real trade-off. Typical triggers: a new merge shape,
partition, deployable, worker, queue or storage table; a dependency that
carries lock-in; a change to authorization, sync, or what the app keeps
offline; a deliberate departure from PLAN.md, the partner demo or an earlier
entry. A bug fix, a refactor that keeps behaviour, or a new event that fits an
existing merge shape does not need one.

```md
## 35. The decision, stated as a sentence

Date: YYYY-MM-DD · By: Full Name · Status: accepted

Reason: the context, what was chosen and why, naming the code that holds it.
Reverse if: the evidence that would change our mind.
```

- Number entries in order and never renumber; code and docs cite them by
  number ("decisions.md 34").
- `By` is the developer who made the decision, not the agent that typed it.
- `Status` is `accepted`, `superseded by N` or `partly superseded by N`.
- Never rewrite a past entry's reasoning. If a decision changes, add a new
  entry that says "Supersedes N" and set N's status. If it only narrows or
  extends, append a dated paragraph to it:
  `Amended (YYYY-MM-DD, Full Name): what changed and why.`
- Land the entry in the same commit or PR as the change it explains.
  `scripts/decisions.test.ts` checks the format.

## 1. Event log over state replication

Date: 2026-09-14 · By: Ryder Wishart · Status: accepted

Reason: every recurring failure in LangQuest v2 and Codex traces to merging
mutable state. See PLAN.md section 2. Reverse if: a use case appears that needs
real-time co-editing of one artifact, in which case add a CRDT for that
artifact only.

## 2. Intent events with per-type merge rules, not a CRDT library

Date: 2026-09-14 · By: Ryder Wishart · Status: accepted

Reason: the domain's writes are per-actor appends and a few registers. Two
merge shapes cover everything. A library adds a dependency and a mental model
for no gain. Reverse if: more than a handful of event types need non-trivial
merge behaviour.

## 3. Clients materialize alone; server folds are optional and async

Date: 2026-09-14 · By: Ryder Wishart · Status: accepted

Reason: translators must see their own work instantly and offline. Server
folds serve coordinators and cold start only. Reverse if: never; this is the
property that keeps support cost down.

## 4. Content-addressed immutable audio

Date: 2026-09-14 · By: Ryder Wishart · Status: accepted

Reason: makes audio conflict-free and uploads idempotent by construction.
The v2 app already never mutates audio in place; this makes it a rule.

## 5. Hand-rolled sync before LiveStore

Date: 2026-09-14 · By: Ryder Wishart · Status: accepted

Reason: the core is a reducer, a SQLite cache, and two endpoints. LiveStore is
pre-1.0 and its one-log-per-store model only fits now that the partition is
the project. Reverse if: the reactive query layer or multi-tab handling
becomes a real cost, once LiveStore is stable.

## 6. Scale rules from day one (Swarnendu De)

Date: 2026-09-14 · By: Ryder Wishart · Status: accepted

Reason: the advice matched what we had already chosen (read/write separation,
async processing, business logic apart from infrastructure) and exposed two
gaps we then closed: tenant keys and an index plan on every event from the
start, and per-org rate limits and bounded pull pages instead of assuming
"we'll add them later".

## 7. Design language first, then the UX spec's screens

Date: 2026-09-14 · By: Ryder Wishart · Status: superseded by 28

Reason: the UX spec prototype (`ng-langquest-ux`) defines the screen
breakdown and flows, but its purple, text-first styling is a Figma Make
default. We keep its screens, ids, and navigation, and render user screens
in the LangQuest v2 task-first language: one yellow action, icon-encoded
status, 6% tints, colourblind-safe pairs of colour and icon. Admin screens
may use the spec's text density. Reverse if: partner testing shows oral
users need labels after all; then add labels beside icons, never instead.

## 8. Every screen names its avatar

Date: 2026-09-14 · By: Ryder Wishart · Status: superseded by 28

Reason: user and project-manager screens have opposite constraints (icons
versus text, one action versus all options). A comment at the top of each
screen file names the avatar so nobody applies the wrong rules. See
PLAN.md section 12.

## 9. Submission is an explicit event

Date: 2026-09-14 · By: Ryder Wishart · Status: accepted

Reason: UX spec A30. Recordings save the moment they are made; review starts
only when the translator hands the take off. Without `TakeSubmitted`, a
reviewer would see half-finished work. It also gives To Do / Doing / Done
a clean definition: nothing, draft, handed off.

## 10. Reviews suggest, they do not reject

Date: 2026-09-14 · By: Ryder Wishart · Status: partly superseded by 29

Reason: UX spec A11 and the review screens. A reviewer's "suggest changes"
is advisory and returns the passage to the translator as a respond task.
The quorum rule still treats it as a non-approval, so a required step with
enough suggestions leaves the take in `changes_requested` until a new take
is submitted.

## 11. Personas are real users, and a shared device pushes only its actor's events

Date: 2026-09-14 · By: Ryder Wishart · Status: accepted

Reason: a dev persona that only fakes session facets would emit events the
server rejects (actorId must match the caller). So switching persona is a
real sign-in as a seeded account, and "seed demo team" creates those
accounts and their memberships through the same events a coordinator would
use. Consequence for production: a shared phone can hold several users'
queued events; the client pushes only the current actor's, so nobody's
work is refused under someone else's session.

## 12. No accidental sign-out offline

Date: 2026-09-14 · By: Ryder Wishart · Status: accepted

Reason: queued events belong to the signed-in user and cannot be sent under
anyone else. Sign-out lives behind a confirmation screen that refuses while
anything is queued or the device is offline, and shows why with icons
rather than words. The old header sign-out icon became the menu.

Amended (2026-09-28, Caleb Koster): being offline alone no longer refuses sign-out, and a
server refusal of this actor never traps them (PLAN.md section 11 step 4).
What refuses is work this session could still deliver: queued project and
org events, account changes and audio not yet uploaded. The screen says
which.

## 13. Two recorders, on purpose

Date: 2026-09-14 · By: Ryder Wishart · Status: accepted

Reason: expo-audio allows one recording at a time and exposes no PCM. v2
solved this with a custom Expo module (`microphone-energy`) that taps raw
PCM for energy and voice-activity segmentation and writes one WAV per card,
while expo-audio writes hold-to-record takes. Both sessions are open during
manual recording. We reuse that module unchanged rather than re-solving the
cold-start and segmentation problems it already solved. Cost: no Expo Go;
a dev client build is required.

## 14. Confirmation is an event, not a column

Date: 2026-09-14 · By: Ryder Wishart · Status: accepted

Reason: v2 stamped `audio_uploaded_at` on rows and needed guard triggers to
stop clients echoing it back. Here the storage trigger appends
`v1.BlobStored` to the project log under the service actor, `append_events`
refuses the type from any client, and devices learn of it through the pull
they already do. Same guarantee, no extra column, no extra sync path.

## 15. Device identity and clocks are persisted

Date: 2026-09-15 · By: Ryder Wishart · Status: accepted

Reason: the fold's last-writer-wins registers depend on HLCs being unique
across devices and monotonic on each one. The first mobile build used the
same device id everywhere and forgot its clock on restart; on a phone whose
clock was corrected backwards, a user's newer decision lost to their older
one. Now `ensureDeviceId` mints one id per install and the client persists
the last clock. The reducer also breaks exact HLC ties by event id, so even a
future id collision cannot make state order-dependent.

## 16. Removal is an event, and validation is the door

Date: 2026-09-15 · By: Ryder Wishart · Status: partly superseded by 47

Reason: the log refuses UPDATE and DELETE, so a malformed or unwanted event
is permanent. `validate_payload` (SQL) and `validateEvent` (core) share one
rule set, the fold skips and counts anything invalid instead of throwing,
and `v1.Redacted` excludes a target from every fold. Reverse if: never; an
append-only log without these is a liability, not a guarantee.

Amended (2026-09-30, Caleb Koster): one edit is now allowed, erasing a
deleted person's name from the event that holds it (decision 47). Everything
else here stands.

## 17. Bytes are verified on both ends, and the bucket is reconciled

Date: 2026-09-15 · By: Ryder Wishart · Status: accepted

Reason: content addressing only helps if someone checks the content. The
downloader hashes before trusting a file. The confirmation carries the size
so a device can detect a short upload. The reconciler is the server's own
independent pass over the bucket: it confirms what the storage trigger
missed and invalidates what hashes wrong, so blob truth never depends on a
trigger on Supabase's managed storage schema. A fetch failure never
invalidates anything; only bytes that were read and hash wrong do.

## 18. Snapshots travel in pieces

Date: 2026-09-15 · By: Ryder Wishart · Status: accepted

Reason: a Bible-scale snapshot is around 13 MB of JSON. One response on a
weak link fails and restarts. 256 KB pieces, each persisted before the next
is requested, make cold start resumable. The same helper feeds the worker
and the reconciler.

## 19. Read indexes are views, never state

Date: 2026-09-15 · By: Ryder Wishart · Status: accepted

Reason: `deriveTasks` at Bible scale took 27 s because every derivation
rescanned all takes and assignments per unit and lane. The fix is one pass
that builds lookup maps (`packages/core/src/indexes.ts`) and derivations that
take it as an argument. It is not stored in `ProjectState`, not snapshotted,
not synced, and every derive function still works without it, so the fold
and the invariants are untouched. Reverse if: never; a cache inside the
state would have to be kept coherent by the reducer, which is exactly the
trigger-maintained rollup PLAN.md section 2 warns against.

## 20. The spec's flow machine is held to by a test, not a review

Date: 2026-09-15 · By: Ryder Wishart · Status: accepted

Reason: the UX spec declares `flow.ts` its single authority; the app copies
it by hand. `scripts/extractSpecFlow.ts` vendors the spec's screens, edges,
modes and gates into `apps/mobile/test/spec-flow.json` and
`specParity.test.ts` fails on any spec edge the app lacks and any app edge
the spec lacks that is not listed with a reason. The spec's role gates are
now data on our edges and `go()` refuses a gated edge the session cannot
take. Reverse if: the spec repo publishes its machine as a package; then
import it instead of vendoring.

## 21. Blockers are derived, like status

Date: 2026-09-15 · By: Ryder Wishart · Status: accepted

Reason: reachability proves a screen exists, not that the work can finish.
A required step with no eligible reviewer, or an assignee who was removed,
leaves a passage waiting forever with nothing on screen saying why. These
are properties of the fold, so `deriveBlockers` computes them and the status
screen can show the one action that clears each. Reverse if: never.

## 22. One sync client, two folds

Date: 2026-09-15 · By: Ryder Wishart · Status: accepted

Reason: the org partition (roles, memberships, catalog, projects) needs the
same log, outbox, cursor, checkpoint and snapshot handling as a project, and
a different reducer. `SyncClient` takes a `Materializer` (empty, apply, fold,
compact, version); the project one is the default and the org one lives in
core `org.ts`. Reverse if: never; a second sync path is the kind of surface
PLAN.md section 2 exists to avoid.

## 23. Authorization is a privilege, scope is on the membership

Date: 2026-09-15 · By: Ryder Wishart · Status: accepted

Reason: UX spec A38. Roles are named privilege sets; a membership grants a
role at org, project or lane scope; an event needs one privilege
(`EVENT_PRIVILEGE`, mirrored in SQL `event_privilege`). The five fixed roles
are seeded as roles with the spec's privilege sets and `effectiveRole` maps
any privilege set back onto them, so workflow steps, eligibility and storage
policies keep speaking `Role`. Reverse if: partners never define a custom
role; then the seed roles are simply all there is. (An event may now need
any one of several privileges: 31.)

## 24. Refusals carry a code, and membership refusals retry themselves

Date: 2026-09-15 · By: Ryder Wishart · Status: accepted

Reason: audit L1. A month of work refused because a role changed offline is
not lost (invariant 1) but was stuck. The server authorizes as of the
event's own clock within a window, and the client re-queues membership
refusals when a pull shows the actor's membership changed. Clock-ahead
refusals re-stamp the clock and keep the event ids. Invalid payloads never
retry.

## 25. Templates instantiate with derived ids, and per-lane settings layer over project settings

Date: 2026-09-15 · By: Ryder Wishart · Status: accepted

Reason: the UX spec applies content templates and review flows per language
(A42) while units and workflow live in the project partition. Deriving
unit and step ids from the catalog (`fia@1/gen-p1`) makes instantiation a
grow-only set: two admins selecting the same template offline emit the same
events and no clone job, ordered insert or server step exists. A lane's
step registers override project-wide ones, which override the old
whole-document config, so nothing existing changes. Reverse if: partners
need one lane to diverge from a template's structure; then hand-added
units already coexist, and a per-lane unit-set event is the next step.

## 26. Reference material is fields, and a question is a field

Date: 2026-09-15 · By: Ryder Wishart · Status: accepted

Reason: audit 5.E. One material with one text register would make two
people filling different blanks of the same document a conflict; per-field
registers make it a merge. Treating a question set as a material whose
fields are the questions means one screen, one lock rule and one scope rule
cover TMF, briefs, guidelines, study material and questions alike, and
`TakeSubmitted.questionSetIds` keeps its shape. Key terms stay grow-only
because every part of a glossary entry is an addition: a rendering, a
recorded adjustment, a link. Reverse if: partners need to edit a rendering
in place; then renderings become registers, and nothing else changes.

## 27. The slideshow mock is the reference for user screens

Date: 2026-09-16 · By: Ryder Wishart · Status: superseded by 28

Reason: "one screen, one task, one main action" is easy to agree with in prose
and easy to drift from in code — the rules that actually bite are the ones
about what happens to a blocked control, where the yellow goes after a step
finishes, and what a recording screen looks like while it is ignoring you.
`docs/ux/one-next-action.html` pins those down in the real tokens and icons,
so a disagreement about an avatar U screen is settled by opening it rather
than by re-reading section 12. It is reference only: not imported, not built,
not tested. Reverse if: partner testing changes the rules; then update the
mock in the same change, or delete it rather than leave it contradicting the
app.

## 28. The partner demo is the reference for screens

Date: 2026-09-28 · By: Caleb Koster · Status: accepted

Reason: partners test the demo in `ng-langquest-ux` and the app must match
what they approved: its flow, look and wording (Caleb, 2026-09-28). Its
design principles ("a record with advice, not a pipeline with gates") also
replace the one-next-action model, so the app follows the demo rather than
restyling it. Supersedes 7, 8 and 27: screens name the demo screens and
requirement IDs they port instead of an avatar, tokens are the demo's
(`theme.ts`, `kit.tsx`), and `flow.ts` is generated from the demo's flow
and held to it by `specParity.test.ts`. `docs/ux/one-next-action.html` is
kept as history only. Reverse if: the demo stops being maintained; then
this repo's screens become the reference and the parity test is retired.

## 29. A passage's record is read against its language's flow, as advice

Date: 2026-09-28 · By: Caleb Koster · Status: accepted

Reason: the demo's method is advice with a few hard stops (its ADR-001,
-004, -005, -016). A flow is steps of review kinds that may happen in either
order; a checkpoint is the only gate. So kinds are organization vocabulary
(`v1.ReviewKindDefined`), steps are `v2.WorkflowStepSet` (kinds and a
checkpoint flag instead of v1's role and quorum), reviews attach to a
version for a kind (`v1.ReviewRecorded`: in the app, by link, or logged
afterwards with who gave it), and departing from the method is recorded
with a reason (`v1.DepartureRecorded`, undone by `v1.DepartureUndone`).
Requests, notes and study marks are records too. Status is still derived
(`passage.ts`), and v1 steps and reviews read as kinds, so older lanes keep
working; for v2 lanes this replaces the quorum rules of 10. A checkpoint
clears only by a review given in the app or by link, or by an override:
a check logged afterwards (which a translator may do) completes ordinary
steps but never a checkpoint, because moving past one without its reviewer
is an override and needs Override Checkpoints. Whether a lane reads v2 steps
is decided by its `v1.LaneFlowSelected` having `catalogVersion` 2 or more
(the v2 flow catalog, `FLOW_CATALOG_VERSION`), so the v1 content catalog
must not reach version 2 without revisiting this. Merge shapes are the existing ones: grow-only with earliest wins,
registers, and an add-wins undo. Reverse if: partners want gates back; then
checkpoints can cover more steps without new events.

## 30. The record's own audio is named by the event that uses it

Date: 2026-09-28 · By: Caleb Koster · Status: accepted

Reason: a back translator usually holds only Review, and a take (or a
`RecordingAdded`) needs Translate. More generally, a voice note, spoken
feedback, a reason or what a producing kind made belongs to the record,
not to the passage's recordings. So that audio is never appended as a
`RecordingAdded`: it waits in the blob store (and, for back-translation
parts, a local draft on the phone) until the event that uses it names it,
and that reference is what uploads it, like the older response and review
comment audio. A back translation is a `v1.ReviewRecorded` with outcome
`recorded` and its parts as `artifacts` (cards with length and format), so
it can never be mistaken for a version, and the kind's step completes by
the recording existing. A voice note someone abandons never reaches the
log. Reverse if: back translations need editing by cards like versions;
then give them their own take-like event.

## 31. An event may need any one of several privileges

Date: 2026-09-28 · By: Caleb Koster · Status: accepted

Reason: the demo lets whoever ran a community check log it, translator or
reviewer (its design principle 5), and lets any contributor set a step
aside. One privilege per event type cannot say that. `EVENT_PRIVILEGE` may
name a list, and SQL `event_privilege` returns it comma-separated for
`may_emit` to test by overlap; `scripts/record-parity-sql.ts` holds the two
together. Reverse if: roles become fine-grained enough that each such act
has its own privilege.

## 32. Flow steps belong to a language's selection and are never removed on a switch

Date: 2026-09-28 · By: Caleb Koster · Status: accepted

Reason: removal is add-wins, so a step id removed once can never come back.
Catalog steps are therefore namespaced by language and flow
(`lane/flow@2/s1`) and choosing another flow only changes the selection;
`deriveFlow` shows the selected flow's steps. Switching back restores the
same steps, and what the record says about them (a checkpoint moved past)
still applies. Hand-edited steps live under the language's `custom` prefix
and new ones get fresh ids. Reverse if: step ids must be shared across
languages; then key overrides and skips by kind instead of step.

## 33. Derived views are cached per state object and revision, outside the state

Date: 2026-09-28 · By: Caleb Koster · Status: accepted

Reason: the Map and My Work derive every passage in a language at
whole-Bible scale, so `passage.ts` indexes the record once per state. The
app publishes a new top-level state object per change, but a client's
live state is mutated in place, so the reducer counts applied events per
object in a module-level WeakMap (`stateRevision`) and the cache keys on
both. Both live outside the state, so snapshots and the permutation tests
never see them, and the fold stays deterministic. Reverse if: the fold
moves to immutable states; then identity alone is enough.

## 34. An organization holds its languages directly, and is the one unit that syncs

Date: 2026-09-28 · By: Caleb Koster · Status: partly superseded by 37

Reason: partners think in organizations and languages; the project level
between them was a grouping nobody asked for, and every screen paid for it
(Caleb, 2026-09-28). The app drops it everywhere: no Project Home, no New
Project, no project scope to grant, no project in crumbs or wording.
Storage keeps its shape, because shipped events and the `(orgId, projectId)`
partition key must not change: each organization has its `_org` partition
plus exactly one work partition that holds its languages. A new
organization gets a fresh id (`createOrganization`), registers
`WORK_PARTITION` (`'work'`) in its own partition, and App writes
`ProjectCreated` as the work partition's first event only after both
partitions have been read from the server this session, so it never races
another device. Orgs from before this open their earliest registered
project (`workPartitionOf`, by clock then event id); `ProjectRegistered` is
earliest-wins so that choice is the same on every device. A membership
scoped to that partition reads as "All languages" and a project-level
catalog toggle still counts, but the app writes neither. Switching,
selection and the inbox are by organization only. Supersedes the demo's
project screens (`DROPPED_SCREENS` in `flow.ts`, held by the parity tests).
Not done: an org that already has several projects keeps only the earliest
visible; moving the others' lanes into it needs a server migration. Reverse
if: one organization needs two separately synced bodies of work; then a
second work partition is a registry entry, not a new event.

## 35. This file is the one ADR log, and agents keep it for every developer

Date: 2026-09-29 · By: Caleb Koster · Status: accepted

Reason: several developers, each working through their own agent sessions,
were making design decisions, and only some of them reached this file. So
every entry now says when it was made, by whom and whether it still holds,
backfilled from git history for 1 to 34. The rule that keeps the file current
lives in AGENTS.md, which every agent reads whoever is driving it. The format
is checked by `scripts/decisions.test.ts`, not just described. We kept one
numbered file rather than a `docs/adr/` folder because code and docs already
cite entries by number, and one file reads as a history. Reverse if: the file
grows too long to scan; then split it into one file per entry and keep the
numbers.

## 36. Templates, flows and reference material live in a library of versioned documents, and versifications line them up

Date: 2026-09-29 · By: Caleb Koster · Status: accepted

Reason: partners make their own content templates, review flows and study
material, and want to share them between organizations, copy them, or
follow another organization's changes (Caleb, 2026-09-29). Shipping them in
the app made every one a release. Each organization now has a library in its
org partition: items (`v1.LibraryItemDefined`) whose versions are immutable
JSON documents named by the SHA-256 of their canonical text
(`v1.LibraryVersionPublished`). The log carries hashes, never documents, so
the org partition stays small and the documents (a whole-Bible template,
FIA in five languages) are fetched once and cached by hash. An owner decides
per item whether other organizations see and may copy it, and separately
whether they may follow it (`v1.LibrarySharingSet`). A copy is the copier's
own item from then on; a subscription follows the owner's versions,
automatically (the server appends `v1.LibraryPinned` when the owner
publishes, and again when the document itself arrives, since a phone may
send the event first) or when someone takes the update. Using another
organization's version first copies access to it and its dependencies
(`library_adopt`), so nothing an organization relies on is a live link
(invariant 6), and unsharing never takes a version away. Languages use a
version through the ordinary events with ids from the item: a template's
units are `<itemId>/<node>` (`GEN.1.1-2.3`), parts a later version drops
are hidden, never deleted (`v1.LaneUnitHidden`, TPL-7), and a flow's steps
sit under the version's own prefix (decision 32). When an item a language
uses moves to a new version, the next phone of someone who may apply it
does. Templates and study material name their versification; the pivot
method of Frontier's versification-tool (every system as differences from
the Original numbering, ranges compared through it) is reimplemented in
core, so FIA's English-numbered guides land on passages a team numbers
another way. The official LangQuest organization (`langquest`) publishes the
starters from `library/` with `scripts/library-seed.ts`; FIA comes in
through an adapter. The canon (book ids and order) stays in core as
reference data; the app's old catalog stays only so languages set up from
it keep their names. Reverse if: documents need collaborative editing field
by field; then a version is a snapshot of per-field registers (decision 26)
taken when publishing, and nothing here changes.

## 37. Each language is its own synced partition, listed in the organization's partition

Date: 2026-09-29 · By: Caleb Koster · Status: accepted

Reason: syncing a whole organization means every member's phone pulls the
history of every language, which grows with the organization rather than
with the person's work (Ryder Wishart and Caleb, 2026-09-29). So a language
is a partition of its own, with the language's id as the partition id, and
the organization's partition lists it (`v1.ProjectRegistered` at creation,
renames as `v1.LaneNamed` there too; `orgLanguages`, `partitionOfLane` in
core `org.ts`). Every member pulls the organization's partition (roles,
members, the library, which languages exist) and a phone pulls only the
language it has open, keeping those it opened before; a screen about another
language opens it in place (`openLanguage` in `apps/mobile/src/languages.ts`).
New Language registers the language and starts its partition with
`ProjectCreated` from someone who manages structure, the server's existing
bootstrap rule, before anyone opens it. A language-level role names that
language's partition, so the server's existing scope check authorizes the
pull. Nothing shipped changes shape. The cost: a language's progress shows
once it is on the phone, so the organization's overview lists every language
but totals only those. Organizations from before this keep their one shared
partition and read as before. Partly supersedes 34 (the organization as one
synced unit). Reverse if: people routinely work across many languages at
once; then sync the languages a person is assigned to in the background, or
let the server fold a progress summary per language.

## 38. An organization's work has one license, and it only opens

Date: 2026-09-29 · By: Caleb Koster · Status: accepted

Reason: partners need to say who may use what their teams record and write,
and that decides what people outside an organization may see (Caleb,
2026-09-29). An organization chooses a license when it is created, starting
at All rights reserved, and may later move only to a more open one: work
that went out under open terms stays out for whoever copied it, so the app
must never offer to close it again. The licenses are a ladder where each rung
allows everything below it (All rights reserved, CC BY-NC-ND, CC BY-NC-SA,
CC BY-SA, CC BY, CC0; `packages/core/src/license.ts`). `v1.OrgLicenseSet`
lives in the org partition and folds as a ratchet, a new merge shape: the
most open license ever set wins, and the earliest event that set it is kept.
It is commutative and idempotent like a register, but a late, more closed
choice from an offline admin changes nothing, so the server accepts it
rather than refusing what a phone could not have known. Only Manage Roles at
organization scope may set it (Organization Admin by default). Outsiders may
look inside an organization's work under any Creative Commons rung and never
under All rights reserved; they read a safe projection, never the log, and
never the record (reviews, notes, names). The demo has no license screen, so
this adds a sheet to Create Organization and Organization Home without new
flow nodes. `REDUCER_VERSION` is 7 so no checkpoint that skipped the event
survives. Design and the plan for public access: `docs/licensing.md`.
Reverse if: partners need a language to be more open than its organization;
then add a per-language license whose floor is the organization's, not a way
to close this one. If they want outsiders to see only CC0 work, move
`outsidersMayView` in `LICENSE_INFO`; the ladder and the event stay.

## 39. Field diagnostics are content-free records in our own database, not events and not a third-party tracker

Date: 2026-09-29 · By: Caleb Koster · Status: accepted

Reason: people using LangQuest far from reliable signal report problems we
cannot see ("downloading is really slow"), and support, increasingly Claude
on support's behalf, needs to find what happened on that phone and on the
server from an org and a language alone, without collecting data about
people we do not need (Caleb Koster, 2026-09-29). So phones keep small
records of how sync, snapshots, blob transfers and faults behaved, limited
to an allowlist of measurements and code-written tags (`DIAG_SCHEMA` in
`packages/client/src/diagnostics.ts`, applied again by `diag.clean` on the
server; `scripts/diagSchema.test.ts` holds them equal), and deliver them,
after their own work, to schema `diag` in our Supabase database through
`diag_ingest`. Records are keyed by the install id (the envelope's
`deviceId`) and the delivering profile id; nothing about content, names or
contact details is kept, 90 days is the retention, and the person can turn
it off. Support reads it as a separate `diag_reader` role through report
functions that join diagnostics to partitions and membership
(`npm run diag`, docs/diagnostics.md). Not events: the log is append-only
and pulled by every member's phone, and diagnostics must be deletable and
must not grow a partition. Not a third-party tracker: it would send device
data to another processor, keep only a few dozen reports offline, and could
not be joined to partitions and memberships, which is what answering the
question needs. Recording is on by default with a switch; the switch and the
privacy notice text are still to be built. Reverse if: a partner
organization or a privacy review requires consent before any collection
(then default off and ask at first sign-in); native crashes turn out to be a
large share of field problems (then add a native crash reporter with the
same allowlist, as its own entry); or the volume outgrows Postgres.

Amended (2026-09-29, Caleb Koster): the switch is built, a "Send diagnostics"
row in Settings, on by default as decided; only the privacy notice text is
still to be written.

Amended (2026-09-30, Caleb Koster): the privacy notice is written, as part of
the privacy policy (decision 46).

## 40. Dashboards read server projections of the shared reducer; organization totals are summed from visible language rows

Date: 2026-09-29 · By: Carl Sauder · Status: superseded by 44

Reason: coordinators want progress across an organization in a browser,
and the browser should neither sync nor fold a whole Bible per language.
The projection worker already folds every partition off the write path (one
per language since decision 37), so it also writes one report per language (core `laneReports`, built on
`derivePassage` and `languageProgress`, the same derivations as the phone's
Status screen) into `lane_reports`, plus a daily point in
`lane_report_days`. Both are read models: rebuildable, never written by a
user, tagged with `REPORT_VERSION`, and refolded when the partition, the
version or the day changes. Row-level security (`may_view_lane`, the
`view_status` privilege at org, partition or that language's scope) decides
which rows a person reads, and `apps/web` sums those rows itself instead of
reading a stored organization total, so a member scoped to one language
never learns another language's numbers. The web build reads the mobile
app's encrypted env files (only `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_ANON_KEY` reach the bundle), so there is one place to
change the server a build talks to. Figures lag by one projection pass,
and the page says how old they are. Supersedes the deferred
`project_summaries`. Reverse if: someone needs a figure that must be
current to the second; then fold that one partition in the browser from a
snapshot, the way the phone does.

## 41. The portfolio dashboard reads server truth, and a language's country and target are events

Date: 2026-09-30 · By: Carl Sauder · Status: accepted

Reason: a partner built their own reporting tool on LangQuest v2 (upload
recency, coverage of the Gospels and Testaments, a monthly chapter ledger,
pace against a plan, alerts). Rebuilt here on the event log, per
organization (decision 40's row-level security still decides what anyone
sees):

- Uploads are timed by the server's `BlobStored` clock, never a phone's
  (PLAN.md 14.12): a recording counts on the day it reached the cloud.
  Coverage is timed by a passage's first published version and weighted
  by verses of the whole canon (core `coverage.ts`), shown recorded and
  done side by side. A chapter counts in the ledger once, in the month its
  first audio arrived; a month settles five days after it ends.
- Recency bands keep the partner's thresholds (14, 21, 28, 35, 45 days) in
  neutral words; pace compares recorded coverage of a target's scope with a
  straight line from its start to its target date (on pace from 5 points
  behind to 10 ahead; behind languages whose last eight weeks still finish
  in time are "behind", the rest "stalled"). Both are read at view time
  from the stored report, so they never go stale between passes.
- Country and target are registers per lane (`v1.LaneCountrySet`,
  `v1.LaneTargetSet`, `manage_structure`), not columns, so they sync,
  merge and audit like everything else. The web app writes them with a
  `SyncClient` over a memory store and waits for the server: it has no
  offline use, so instead of an outbox it says "not saved" and keeps the
  form (invariant 1 is about the phone's log; nothing here is dropped
  silently). `REDUCER_VERSION` is 8 because an older build ignored these
  events and its snapshots would hide them.
- The partner's weekly field updates and Airtable intake stay out: they
  are not LangQuest data.

Reverse if: a partner needs figures across organizations; then add an
observer grant and a policy, not a second data path.

Amended (2026-09-30, Carl Sauder): the reports no longer come from stored
rows. The dashboard's own server folds each organization and computes them
on request (decision 44), and `mayViewLane` in core, the same rule as the
row-level security it replaces, decides what anyone sees. A report now also
carries its last 90 days of progress (`progressDaily`, `REPORT_VERSION` 3).

## 42. Merging to main deploys the hosted database and Edge Functions

Date: 2026-09-30 · By: Caleb Koster · Status: accepted

Reason: merges to `main` already ship the app to TestFlight, but migrations
and the projection worker only reached the hosted project when someone ran
`npm run db:apply` and deployed the functions by hand. The license and
diagnostics migrations sat merged but unapplied, while the app and a rebuilt
worker bundle that expect them were on their way out. Now
`.github/workflows/deploy-supabase.yml` runs on every merge that touches the
database, the functions or the core the worker bundles: the typecheck and
tests, a check that the committed worker bundle matches its source, then
`supabase db push` and only after it `supabase functions deploy`, so a worker
never writes to a column its migration has not made. It authenticates with
one personal access token as a repository secret; the CLI pushes through a
temporary login role, so no database password is stored. Preview and
production builds point at the same hosted project, so there is one target.
Reverse if: a separate staging project is added (then merges deploy there
and production follows a release), or a migration needs a manual step or
cannot be applied while the app is live.

Amended (2026-09-30, Caleb Koster): Supabase's GitHub integration now does the
deploy, and `.github/workflows/deploy-supabase.yml` is gone. The workflow
needed a personal access token, which expires within a year, belongs to one
person, and on first use lacked database write access. The integration
authenticates through Supabase's GitHub app, so nothing is stored in GitHub
and nothing expires. Its settings live in the dashboard and are recorded in
`server/README.md` (Deploying). The worker bundle check moved into the
guardrails `checks` job. Unconfirmed: that it applies migrations before it
deploys functions; the worker must keep tolerating a migration that has not
landed yet.

Amended (2026-10-01, Caleb Koster): the projection worker's schedule is now a
migration (`20261001000000_schedule_projections.sql`), so merging schedules
it too. It had been a script someone ran by hand, and production never got
it: no snapshots and no server Inbox rows or pushes until it was run on
2026-10-01. The migration enables `pg_cron` and `pg_net` and schedules the
job only where the Vault secrets exist, so local databases and preview
branches stay unscheduled.

## 43. Merging to main deploys the Cloudflare workers

Date: 2026-09-30 · By: Carl Sauder · Status: accepted

Reason: the invite-email worker and the dashboard reached Cloudflare only
when someone ran `npm run email:deploy` or `npm run web:deploy`. The app
already ships on merge to TestFlight, and the database ships through
Supabase's GitHub integration (decisions.md 42).
`.github/workflows/deploy-cloudflare.yml` runs the pre-push typecheck and
tests, then those two commands, and only the worker whose inputs changed:
invite email for `apps/invite-email/**`, the dashboard for `apps/web/**`,
`packages/core/**`, `packages/client/**` and the lockfile. The workflow has
its own concurrency group and does not cancel an in-progress run, so a
second merge waits instead of stopping a deploy halfway. It authenticates
with a Cloudflare API token repository secret. The dashboard build also
needs `DOTENV_PRIVATE_KEY_PRODUCTION` to decrypt the production env file.
Reverse if: a token-free Cloudflare integration can split those two workers
by path and queue a later push behind one already deploying (a token expires
and belongs to one person, the same problem as the Supabase workflow in 42),
or a staging worker is added and production should follow a release.

## 44. Dashboards read a per-organization snapshot folded by the dashboard's own server

Date: 2026-09-30 · By: Carl Sauder · Status: accepted

Reason: decision 40 had the projection worker write every language's report
into tables (`lane_reports`, `lane_report_days`) for the browser to read
under row-level security. That put a second read model, a schema and a
backfill on the projection worker for one consumer, and made every change
to a report a migration plus a refold on the worker's schedule. Instead the
dashboard's Cloudflare Worker (`apps/web/worker`) gets an API,
`GET /api/orgs/:org/reports`, backed by one Durable Object per organization
(`OrgSnapshot`, named by the org id, so every request for an organization
reaches the same memory). It folds the org partition and each language
partition with the reducer the phones run (`OrgFolder`), starting from the
server snapshots the projection worker already writes (`fetchSnapshot`) and
then the tail through `pull_events` with the service role, the way a phone
starts. Those snapshots are the durable cache, so the object stores nothing
and an eviction only costs a cold start. A request catches up from each
partition's cursor when the state is older than a minute, or at once with
`?fresh=1`, which the page sends after saving a country or target; requests
together share one pass, and a redaction of something already folded
refolds that partition. Reports (core `laneReports`) are cached per
partition by its cursor and the day. The Worker checks the caller's
Supabase access token (`auth.getUser`), and the object returns only the
languages `mayViewLane` allows (`view_status` from an org, partition or
language membership, or a role in the partition's own member list), so a
member scoped to one language still never receives another's numbers; raw
state never leaves the object. The browser loads an organization's reports
once and still sums totals and applies every filter itself, so filters stay
instant. The service-role key lives only in the Worker, encrypted in
`apps/web/.env.production` and pushed by `npm run web:secrets`; the page
keeps reading the mobile app's public env. The report tables and
`may_view_lane` are dropped. Supersedes 40.
Reverse if: one organization's state outgrows a Durable Object's memory or
CPU (then shard it by language, one object per partition), or figures must
be shared across organizations or read without the Worker (then stored rows
again, with a policy).

## 45. Merging to main ships Android to Google Play's internal testing track

Date: 2026-09-30 · By: Caleb Koster · Status: accepted

Reason: Android testers should get the app from Google Play, as iOS testers
get it from TestFlight, without the listing being public. It is published
from the organization's Play developer account that distributes LangQuest
v2, so Play's closed-test period for new personal accounts does not apply.
`.eas/workflows/deploy-to-testers.yml` (renamed from
`deploy-to-testflight.yml`) now handles each platform on its own: a matching
native fingerprint ships an over-the-air update on `production`, otherwise it
builds and submits, to the `internal` track named in `eas.json`
(`submit.production.android`). Internal testing takes up to 100 testers by
email with no Play review, so a merge reaches them within minutes. The same
change turns off expo-audio's background playback (`app.json`): nothing played
in the background, recording stops when the app leaves the foreground, and
the foreground-service permission it added makes Play ask for a declaration
and a demo video. The Play service account key lives in EAS credentials, not
in the repo; the one-time Play Console steps are in `apps/mobile/README.md`
(Google Play, once).
Reverse if: testers outgrow 100 or need a group Play manages (move the track
to closed testing, `alpha`), or a feature needs audio to keep playing or
recording in the background (turn the plugin option back on and make the
declaration).

## 46. Deleting an account removes the person and keeps the organization's work

Date: 2026-09-30 · By: Caleb Koster · Status: accepted

Reason: Google Play and the App Store require that anyone who can create an
account in the app can delete it, from inside the app and by a request from
the web, and Play requires a privacy policy at a public address.
`_delete_account` (migration `20260930200000_delete_account.sql`) deletes the
sign-in and everything that names the person: `auth.users`, the profile
name, push tokens and receipts, inbox rows, join requests, the email on
invites, field diagnostics (decision 39) and the uploader mark on stored
audio. It ends every membership with the same `v1.OrgMemberRemoved` and
`v1.MemberRemoved` events an administrator would append, so every phone's
fold drops them, and erases the one name the log held (decision 47). The
events they authored and the audio those name are kept: recordings are the
organization's work under its license (decision 38), and without the
account the actor id on them is a random id that leads to no one. LangQuest
v2 kept contributions on deletion too. The person deletes from the app
(`delete_my_account`; Settings, and the screen for someone with no
organization yet), which waits for unsent work as sign-out does (decision
12). From the web they email a request, and staff run
`delete_account_for_email` in the Supabase SQL editor; the app cannot call
it. The app's Delete Account screen is app-only, beside the demo's
(`test/specParity.test.ts` drift log). The privacy policy and the request
page live on the LangQuest v2 website (langquest-website repository,
`/en/next/privacy` and `/en/next/delete-account`) beside v2's own, because
this repository's web app is not ready to be published; the app links there
(`apps/mobile/src/legal.ts`), and the text must change with what the code
keeps.
Reverse if: a partner, a privacy review or a regulator requires erasing a
person's recordings or words (then the log needs payload erasure beyond
names); or this repository's web app is published (then the policy and a
signed-in deletion page move there, and `legal.ts` and the store listings
follow).

Amended (2026-09-30, Caleb Koster): deletion also removes the person's
blocks, blocks of them, and the reporter mark on reports they sent
(decision 48). The reports themselves stay, for staff.

## 47. A deleted person's name is erased from the log, the one edit the log allows

Date: 2026-09-30 · By: Caleb Koster · Status: accepted

Reason: creating an organization wrote the creator's name (their email's
local part) into `v1.OrgMemberAdded.displayName`, so deleting the account
could hide the name (a `v1.Redacted`) but not remove it, and the privacy
policy says the name is deleted. Two changes, chosen over disclosing that
the name stays. Names stop entering the log: Create Organization saves the
creator's profile name instead (`profiles`, which deletion removes), and
`createOrganization` no longer takes one; the field stays in the event type
so old events fold. And the one name already in the log can be erased:
`events_immutable` now lets through a single kind of update, removing
`displayName` from an `OrgMemberAdded` whose `profileId` is the person
being deleted, only while `_delete_account` has set
`langquest.erase_profile` to them, and only if nothing else in the row
changes. Every other update and every delete is still refused
(`server/delete-account-smoke.sql`). The event is also redacted, so phones
that already hold it stop showing the name, and that organization's
snapshots are dropped to be rebuilt from the log. Copies on phones keep the
bytes until the app is removed; the fold never shows them. Partly supersedes
16.
Reverse if: event integrity comes to depend on payload bytes (a hash chain
or signatures), which would need erasure designed in (for example,
encrypting personal fields with a per-person key and deleting the key).

## 48. Reports and blocks are private rows, not events, and acting on a report is a redaction

Date: 2026-09-30 · By: Caleb Koster · Status: accepted

Reason: Google Play's user-generated content policy asks that people can
report objectionable content and users from inside the app, that someone
acts on reports, that abusive users can be blocked, and that terms forbid
such content before anyone posts. Reports and blocks stay out of the log:
every member's phone pulls a partition, so a report there would tell the
reported person who reported them, and a block is one person's private
choice. They are rows (`content_reports`, `user_blocks`; migration
`20260930220000_report_and_block.sql`) sent from the account outbox like a
profile name, so they work offline (`report_content`, `set_blocked`). Reports
go to the organization and to LangQuest staff (Caleb, 2026-09-30). An
organization's moderators, whoever holds what `v1.Redacted` needs
(`manage_structure`) for that language, or `invite_members` organization-wide
for a report about a person, see its open reports in the Inbox without who
sent them (`org_content_reports`, and a notification from the projection
worker), never one about themselves. Staff see every report with the
reporter (`npm run moderation`). Acting uses what the log already has:
removing something appends `v1.Redacted` as the moderator for every event
that holds it (`remove_content`; a version is its take, submission,
what-changed note and answer), so every phone's fold drops it and its
passage's status is derived again; removing a person is
`v1.OrgMemberRemoved` from Members; staff can also suspend a sign-in
(`suspend_account`). Blocking hides a person's words, audio and photos on the
blocker's phones behind Show (`Authored` in `reportSheet.tsx`) and keeps
their updates out of the Inbox, but their versions and reviews still count
toward status, so a block never stalls a team (Caleb, 2026-09-30). The
report queue's `resolved_at` and `resolution` columns are an operational
queue on the server, not app state, so the no-status-column rule does not
reach them. No new event type, so `REDUCER_VERSION` is unchanged. The flag,
its sheet and Blocked people are app-only, not in the demo, and not flow
nodes. The Terms of Use now list what is not allowed and promise action on
reports within 24 hours (`TERMS_VERSION` 2026-09-30).
Reverse if: blocking has to stop someone reaching a person (asking them for
work, reviewing their recordings) rather than hide what they add, which
puts blocks on the server's write path; moderators need to know who
reported, which needs the reporter's consent; or report volume outgrows a
script, which calls for a staff screen.

Amended (2026-10-01, Caleb Koster): emailing staff when something is
reported is deferred, not dropped. Until it exists, staff keep the terms'
24-hour promise by checking `npm run moderation -- --hosted` daily, and an
organization's moderators get a server Inbox row from the projection worker,
which now runs every five minutes in production (decision 42). When it is
built, the worker is the sender's natural home: it already reads open
reports each pass and runs where the email relay's secret lives. It needs a
staff address and a sender address chosen first.

## 49. What we told the app stores is kept in the repository and held to the code

Date: 2026-09-30 · By: Caleb Koster · Status: accepted

Reason: Google Play's data safety form, content rating, target audience and
app access answers are commitments Google enforces, and they were entered
by hand in Play Console, where nobody working on the code sees them. A
change that adds a permission, an SDK or a field to diagnostics could make
them untrue without anyone noticing. `docs/play-store-declarations.md`
records every answer and why; `scripts/playDeclarations.test.ts` fails when
the Android permissions, Expo plugins, mobile dependencies or diagnostics
allowlist change without that file's facts block being updated; AGENTS.md
("Store declarations") tells agents to update the file in the same change
and tell the developer which Play Console answers to change. The test
cannot see everything (a new event field with personal data, a new kind of
content), so the instruction to agents carries the rest.
Reverse if: Google offers an API for these declarations (then apply them
from the file, as infrastructure as code), or the guard fails so often on
dependency changes that it is ignored (then narrow it to SDKs that can
collect data).
