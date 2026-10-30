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

Amended (2026-10-03, Carl Sauder): on the web a browser may be a shared or
library computer, where the next person could read what the last one left.
So there, signing out (or deleting the account) deletes the databases, the
recordings and library documents, and every saved key, then reloads
(`forgetBrowser.ts`); it runs only after the unsent-work check of 12.
Phones keep the log as before.

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

Amended (2026-10-03, Carl Sauder): on the web, signing out from "What brings
you here?" waits for queued account changes too, since there sign-out
forgets the browser (11, amended); a phone signs out there as before.

Amended (2026-10-05, Caleb Koster): on a phone, unsent work no longer
refuses sign-out; it is handed over and still goes as its author (60). The
count is only the signed-in person's own work, never another person's on the
same phone (`pendingCountBy`). The web keeps the refusal.

## 13. Two recorders, on purpose

Date: 2026-09-14 · By: Ryder Wishart · Status: partly superseded by 106

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

Amended (2026-10-07, Carl Sauder): the confirmation is appended by the
app's Worker through `record_blob` after R2 has stored the bytes, not by a
storage trigger, which is gone with the bucket (decision 69). Same event
and id shape, so devices see no difference.

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

Amended (2026-10-09, Carl Sauder): a redaction is never redacted. The fold
applies every redaction before anything else, in the order they arrived, so
one aimed at another made the outcome depend on that order: the first stood
if it came first and vanished if it came second. `append_events` refuses a
`v1.Redacted` whose target is a `v1.Redacted`, and the fold ignores any
already in the log (reducer version 12). A removal that was a mistake is put
right by recording the thing again, not by redacting the redaction.

## 17. Bytes are verified on both ends, and the bucket is reconciled

Date: 2026-09-15 · By: Ryder Wishart · Status: accepted

Reason: content addressing only helps if someone checks the content. The
downloader hashes before trusting a file. The confirmation carries the size
so a device can detect a short upload. The reconciler is the server's own
independent pass over the bucket: it confirms what the storage trigger
missed and invalidates what hashes wrong, so blob truth never depends on a
trigger on Supabase's managed storage schema. A fetch failure never
invalidates anything; only bytes that were read and hash wrong do.

Amended (2026-10-07, Carl Sauder): the bucket is Cloudflare R2 (decision
69), and R2 now refuses an upload whose bytes do not hash to its name, so a
wrong hash is caught at the door as well as by the downloader. The
reconciler lists and reads R2 through the Worker's service routes
(`workerBlobs`) and still confirms what was never confirmed; `--verify`
remains the check against bytes that change after they were stored.

## 18. Snapshots travel in pieces

Date: 2026-09-15 · By: Ryder Wishart · Status: accepted

Reason: a Bible-scale snapshot is around 13 MB of JSON. One response on a
weak link fails and restarts. 256 KB pieces, each persisted before the next
is requested, make cold start resumable. The same helper feeds the worker
and the reconciler.

Amended (2026-10-14, Caleb Koster): a phone now asks for three pieces at a
time, not one, and saves each as it arrives; every piece is still saved
before the snapshot is put together, so a dropped link resumes from what
arrived (`fetchSnapshot`, `SNAPSHOT_PIECES_IN_FLIGHT` in `syncClient.ts`).
One at a time, a phone 300 ms from the server spends 48 s on round trips
for Koro Miyan's 152 pieces; three at a time, 16 s (measured from a Mac
through a delaying proxy). The pieces are written straight to the store,
not through the writer that tells screens a save is under way: on a 2 GB
test emulator that redrew the whole app twice per piece, and Koro's
download took 46 s instead of 5. The server's projection worker still
fetches one at a time. Reverse if: links drop so often that losing up to
three pieces at once costs more than the round trips it saves.

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

Amended (2026-10-14, Caleb Koster): a phone that keeps a big language on
disk (decision 143) also keeps one line per passage there, so lists never
need every passage's record in memory. The lines are still views: outside
the state, never snapshotted or synced, and worked out by core's own
`derivePassage` from the passage's records whenever an event touches that
passage, so they cannot disagree with it. The reducer never maintains them.

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

Amended (2026-10-06, Carl Sauder): `deriveBlockers` and the blocker rows went
with the role-based v1 workflow model (63). The record model says what a
passage waits on (`waitingOn`) and what concerns a person (`updatesFor`),
which the Inbox and the server's notifications both read.

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

Amended (2026-10-06, Carl Sauder): scope is `org` or `language` (63);
the project and lane levels are gone, and a person holds one role per scope.

Amended (2026-10-09, Carl Sauder): a grantor grants only what they hold (75).
A role given, invited to or admitted to may carry no privilege the grantor
lacks at that scope; a role changed or removed must be one they could have
granted; a role defined or retired likewise. Holding Invite is no longer
enough to make someone, or oneself, Owner.

## 24. Refusals carry a code, and membership refusals retry themselves

Date: 2026-09-15 · By: Ryder Wishart · Status: accepted

Reason: audit L1. A month of work refused because a role changed offline is
not lost (invariant 1) but was stuck. The server authorizes as of the
event's own clock within a window, and the client re-queues membership
refusals when a pull shows the actor's membership changed. Clock-ahead
refusals re-stamp the clock and keep the event ids. Invalid payloads never
retry.

Amended (2026-10-06, Carl Sauder): the server no longer authorizes as of the
event's clock; it decides by the membership it holds now (63), and the
membership-row and as-of paths are gone. The client re-queues `NOT_MEMBER`
and `NOT_ALLOWED` refusals when the organization stream changes a membership
or a role (`onMembershipChanged`), and re-queues `NOT_LISTED` ("language not
listed yet") on every push, since a new language's own events can reach the
server before the organization's `LanguageAdded`.

## 25. Templates instantiate with derived ids, and per-lane settings layer over project settings

Date: 2026-09-15 · By: Ryder Wishart · Status: superseded by 63

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

Amended (2026-10-13, Carl Sauder): undoing an override needs Override
checkpoints too, held by the server (97). Answered feedback no longer
completes an ordinary step (96).

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

Amended (2026-10-06, Carl Sauder): each language now has a stream of its
own (63), so step ids are namespaced by flow version only
(`<flowId>@<v>/<step>`, `custom/<step>`); the add-wins reason still holds.

Amended (2026-10-12, Caleb Koster): a ready-made flow is now copied into the
`custom` prefix (decision 91), so choosing one replaces the language's own
steps; Undo puts them back, under the ids they had.

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

Date: 2026-09-28 · By: Caleb Koster · Status: superseded by 63

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

Amended (2026-10-12, Caleb Koster): languages no longer follow flows.
Using a flow copies its checks into the language as its own (decision 91);
the library keeps flows to start from and to share. Templates and reference
material still follow as above.

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

Amended (2026-10-06, Carl Sauder): a language's identity lives in the
organization stream (`v1.LanguageAdded`, replacing `ProjectRegistered`,
`ProjectCreated`, `LaneAdded` and `LaneNamed`), and a language stream
accepts events only once the organization lists it, which replaces the
bootstrap rule (63). Organizations from before this no longer exist.

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

Amended (2026-10-01, Carl Sauder): there are now two targets. Merging to
`main` still deploys production; merging to `develop` deploys a persistent
Supabase branch `develop`, the preview environment (decisions.md 50). Secrets
are not part of the integration's deploy: `npm run secrets` sets the Edge
Function and Vault secrets (decisions.md 51).

Amended (2026-10-06, Carl Sauder): the schedule is now
`20261006000001_schedule_projections.sql`, beside the baseline that replaced
the earlier migrations (63), and the worker is the `stream-projections`
Edge Function (job `langquest-stream-projections`; the old job is
unscheduled). Reset databases have no migration history to repair.

Amended (2026-10-06, Carl Sauder): the local stack runs the worker too, every
minute. `npm run db:start` and `npm run db:reset` (`scripts/local-db.mjs`)
write a local-only secret to the ignored `supabase/functions/.env`, set the
two Vault values in the local database and run the schedule migration, as
`npm run secrets` does on a hosted one, and seed the library when there is
none. Testing on simulators against a local database had no server Inbox rows
or snapshots, and we want no extra command to bring a local environment up.
It is not in `seed.sql`: preview branches run that too, where local values
would be wrong; and `npm run db:test` resets with plain `supabase db reset`,
since its smokes count snapshots and Inbox rows.

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

Amended (2026-09-30, Carl Sauder): Cloudflare Workers Builds deploys both
workers, and `.github/workflows/deploy-cloudflare.yml` is gone. Cloudflare
generates the build token, so nothing is stored in GitHub. Runtime settings
live in encrypted env files (`apps/invite-email/.env.production`,
`apps/web/.env.production`) that share the production public key with
`apps/mobile/.env.production`. The only secret on each Worker's build is
`DOTENV_PRIVATE_KEY_PRODUCTION`. `npm run email:deploy` and `npm run web:deploy`
decrypt that file and upload every key as a Worker secret with the deploy,
public ones too, so no value is printed in the build log; each key is listed
in the wrangler file's `secrets.required`. Watch paths, so an
email change does not build the dashboard, are recorded in `docs/cloudflare.md`.
Guardrails still runs the typecheck and tests; the build does not wait for it.

Amended (2026-10-01, Carl Sauder): each Worker has a `-preview` copy
(`env.preview` in its wrangler file) that Workers Builds deploys from
`develop` with `apps/<worker>/.env.preview` and `DOTENV_PRIVATE_KEY_PREVIEW`
as its only build secret (decisions.md 50). Branch builds stay off on all
four Workers, because a Worker's build secret reaches every branch it builds.

Amended (2026-10-01, Carl Sauder): deploys no longer upload secrets and no
Worker build holds a key. Public settings are wrangler `vars`, and
`npm run secrets` sets each Worker's secrets, which stay across deploys
(decisions.md 51).

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

Amended (2026-10-03, Carl Sauder): the object now keeps a cache in its own
SQLite (`OrgCache`, `apps/web/worker/sqlCache.ts`), because an object is
evicted after a short idle spell and a dashboard is visited now and then, so
nearly every visit was a cold start: `_org` pulled from 0 and every language
read back from its snapshot (about 13 MB at Bible scale) and refolded. The
cache holds, per partition, the reports and member list (written each time
they change) and the fold itself (written when new, after a redaction, and
then every `STATE_SAVE_EVERY` events, like a phone's checkpoint), all tagged
with `REDUCER_VERSION` and `REPORT_VERSION`; a mismatch is ignored and
rebuilt, so the cache is still never the truth. A pass first asks
`partition_heads` (a service-role RPC over `partition_cursors`) and pulls only
the partitions that moved, so an organization nobody wrote to costs one
query, awake or woken. Memory holds every partition's summary but only the
`STATES_IN_MEMORY` most recent folds. The Worker checks tokens with
`getClaims`, which verifies them locally once the project has asymmetric
signing keys. Phones get `?view=summary` (each language's progress alone),
and every answer carries an ETag over its rows and `X-As-Of`, so an
unchanged answer is a 304. `_org` gets no server snapshot: with the cache it
is folded from 0 once per reducer version.

Amended (2026-10-15, Carl Sauder): the folds held in memory are capped by
the size of their serialized text (`STATE_BUDGET_BYTES`, 40 MB, always at
least one) instead of eight by count, a language of 2 MB or more is
refreshed alone while smaller ones still go four at a time, and a large
fold is let go once it is in the cache (`apps/web/worker/orgFolder.ts`). A
14 MB snapshot parses to well over 100 MB in a 128 MB isolate, and every
language is recomputed when the UTC day turns (performance-audit-app.md
V4). The limits are not yet measured against a real isolate.

Amended (2026-10-19, Carl Sauder): a report no longer needs a fold here
when the projection pass has stored the language's report inputs (142):
the object renders the report from them and the organization stream, and
folds only a language with none (before the pass first reaches it, or when
the table cannot be read). The folds this entry describes now serve the
access-token API (70) and that fallback. A plain read lags the pass by up
to its five minutes, and `asOf` says so when a language's stream has moved
past its stored inputs. A catch-up (`?fresh=1`, "Catch up with the
server") still folds the log's tail at once for a language whose stored
inputs are behind, up to 25,000 events (`FOLD_ON_CATCH_UP_EVENTS`), and a
later plain read keeps those newer figures; a larger language answers from
its stored inputs until the next pass. What an admin saves on the
organization stream (a name, country or target) shows at once either way.

Amended (2026-10-20, Carl Sauder): the access-token API (70), MCP, review
links and webhooks (101) no longer fold a language in the object (147).
Each language is sync's own kept client over the object's SQLite
(`LanguageRecordsKeeper`, `apps/web/worker/languageRecords.ts`): what the
whole language shares and its lines in memory, its rows first downloaded
from the server's cut and read a few passages at a time. Reports keep this
entry's folds only for a language of at most 25,000 events the pass has
stored no inputs for (142); a bigger one is "being prepared" until the pass
stores them. Access checks and the webhook scan read the organization
stream alone.
The capped-heap test lists and scans a Bible-size language (4,000 passages
of 15 versions, about 48 MB of fold) inside the isolate; folded whole, the
same language runs out of memory.

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

Amended (2026-10-22, Caleb Koster): Android builds now go to the production
track for production review, not to internal testing (decisions.md 157).

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

Amended (2026-10-05, Carl Sauder): the web app is published (58), so the
privacy policy and the deletion page move here, as the reverse condition
said: static pages served beside it, `https://next.langquest.org/privacy`
and `/delete-account` (`apps/mobile/public`), plain HTML that opens without
signing in. Signed-in deletion on the web is the app's own Settings, Delete
account, which the deletion page links to (`/settings`). The policy now
covers the web app, what a browser keeps and that sign-out removes it (11,
amended), and Cloudflare in place of Vercel; `legal.ts` and the store
listings follow. The old langquest.org pages should redirect here.

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

Amended (2026-10-06, Carl Sauder): with the catalog restarted at `v1` (63),
no event type has a `displayName` and nothing in the log holds a name, so
`events_immutable` has no exception any more: the log refuses every update
and delete, and account deletion only appends `MemberRemoved` events.

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

## 50. Three environments, one git branch and one dotenvx key each; preview is a persistent stack fed by `develop`

Date: 2026-10-01 · By: Carl Sauder · Status: partly superseded by 51

Reason: the team needs development, preview and production, and until now
preview builds and the dashboard pointed at the production project. Preview
cannot be per pull request. Supabase's automatic branches get a new URL for
each pull request, which neither an installed preview build nor the dashboard
can follow, and Cloudflare makes no version URLs for Workers that hold a
Durable Object, which both of ours do. So preview is a persistent stack fed
by a `develop` branch. Pull requests merge to `develop`, and a release pull
request from `develop` to `main` deploys production, as 42 and 43 anticipated.
Each platform's own git integration does the deploying, so GitHub still
holds no token. Supabase has a persistent branch `develop`. Workers Builds
has `langquest-dashboard-preview` and `langquest-invite-email-preview`, the
`env.preview` of each wrangler file. EAS has
`.eas/workflows/deploy-preview.yml` on the `preview` channel. Secrets use one
dotenvx key pair per environment, shared by every file of that environment,
because dotenvx names the private key after the file's suffix. Per-target
keys would add little: the dashboard Worker already holds the service-role
key at run time. Each deploy target keeps its own file
(`apps/mobile`, `apps/web`, `apps/invite-email`, `supabase`), so a platform
receives only its own keys. That matters most for EAS, whose values end up
in the app bundle. `scripts/env-files.test.ts` refuses a file encrypted with
another key. The production key lives only with maintainers and on the two
production Workers, and the preview key only with developers and the two
preview Workers. A Workers Builds secret reaches every branch the Worker
builds, so branch builds stay off. Supabase gets its secrets from
`npm run supabase:secrets`, which pushes Edge Function secrets, writes the
Vault secrets and schedules the projection job, comparing digests. We do not
use Supabase's own dotenvx support, for three reasons: it would need a
private key stored as a project secret, where every Edge Function can read
it; it is documented for preview branches only; and encrypted values on
persistent branches have a reported bug (supabase/cli#3742). The preview
branch is built from migrations alone, and the scheduling migration
(decision 42) skips a database without the Vault secrets, so
`npm run secrets` runs that migration's body again after writing them. The setup and the commands are in
`docs/environments.md`.
Reverse if: releasing through `develop` delays fixes more than preview
catches problems (then go back to merging straight to `main`, with preview
following it); Supabase deploys dotenvx secrets reliably for persistent
branches and production (then declare them in `config.toml`
`[edge_runtime.secrets]` and `[db.vault]` and drop the script); or Workers
Builds gets per-branch secrets (then a single Worker could serve both
environments).

Amended (2026-10-01, Carl Sauder): the Workers are named after this app,
`langquest-next-dashboard` and `langquest-next-invite-email` (and their
`-preview` copies), so they cannot be taken for LangQuest v2's in the same
Cloudflare account. The dashboard had never been deployed; the invite-email
Worker moved to the new name and the relay URL with it.

## 51. Secrets are applied by a person when they change, never by a deploy; public settings are plain

Date: 2026-10-01 · By: Carl Sauder · Status: accepted

Reason: under 43's amendment and 49, every Cloudflare deploy decrypted an
env file and uploaded its values. That put a private key on each of four
Workers' builds. Each deploy target also had a file per environment, and
most of their values were public: `EXPO_PUBLIC_*`, project URLs and refs, and
the sender address. Those were encrypted only to keep the files uniform
(the infrastructure skill's convention, not a recorded decision). So you
needed a key to see which project preview used, to run the app locally, and
to build the dashboard, whose page carries those values anyway. Secrets also
crossed platforms in pairs (the relay secret in two files) and needed checks
to keep the pairs equal. Now settings are split by kind:
- **Public settings are plain**, in each platform's own file:
  `apps/mobile/.env.<env>`, wrangler `vars`, and `[remotes.<env>]` project
  refs in `supabase/config.toml`.
- **Secrets are encrypted in one file per hosted environment**, the root
  `.env.preview` and `.env.production`.
- **`npm run secrets -- <env>` (`scripts/secrets.mjs`) puts every secret
  where it is used**: Worker secrets, Edge Function secrets, Vault and the
  projection job. One value feeds both ends of the relay and of the
  projection secret, so they cannot drift. The service-role key is read
  from Supabase on each run rather than stored.

Worker secrets stay on the Worker across deploys, and wrangler refuses a
deploy while one in `secrets.required` is missing, so a deploy carries code
and vars only. No build system, CI or platform holds a dotenvx key. There is
no development key, since development has no secrets. `env:check` refuses a
plain secret, a secret in the app's files and a public setting in the
secrets file. This supersedes 50's file per target and the keys on Worker
builds; 50's environments and branches stand. The cost is that a changed
secret takes effect only when someone runs `npm run secrets`. That is rare,
and Supabase secrets already worked this way. Worker secrets cannot be read
back, so the drift check only confirms they exist.
Reverse if: secrets change often enough that a manual apply is forgotten
(then apply them from CI, with the key in a protected CI environment); or a
platform gains a way to read secrets from the repo at deploy without holding
a key.

## 52. The app icon is black and white; the app keeps the demo's purple

Date: 2026-10-01 · By: Caleb Koster · Status: accepted

Reason: Caleb chose a new app icon, three rising bars with a check lying over
the tallest, in white on black, and asked that only the icon change while the
app keeps its theme (Caleb, 2026-10-01). So the icon departs from the demo's
purple brand but the screens do not: `theme.ts`, `theme.css` and the book
tile on the sign-in and welcome screens are unchanged, and 28 still holds for
colour. The icon's source is `apps/mobile/assets/logo.svg`;
`apps/mobile/scripts/render-icons.mjs` renders the app icon, Android adaptive
and monochrome layers, splash image and favicon from it, and the dashboard
uses it as its favicon. Reverse if: the brand is redone across the app; then
redraw the icon to match it.

## 53. Linear status follows the pipeline, and user-facing flags wait until after prototyping

Date: 2026-10-01 · By: Ryder Wishart · Status: accepted

Reason: we ship by trunk-based development: small changes go straight to
`main`, deploys are automatic (decisions 42, 43, 45) and a bad change is
reverted or patched forward in minutes. There is no pull-request or QA
column, so the LangQuest Next team's Linear statuses are In Progress,
Verifying, Deploying, Live and Outage, and the pipeline moves them.
`scripts/linear-sync.mjs` reads the issue IDs (`LAN-12`) in the commits of a
push. `.github/workflows/linear-sync.yml` moves each issue to Deploying and
comments the deploy lanes its changed files reach (ios and
android). Each lane reports back from the EAS workflow, and a failed checks gate
reports from guardrails. Every
lane ok is Live, any failure or a failed checks gate is Outage, and a push
that reaches no lane (docs) is Live at once. The state lives in the issue's
comments, so nothing else is stored and the issue shows progress as it
happens. A revert commit puts the issue it names in Outage. Cloudflare and
Supabase deploy through their own integrations (decisions 42, 51) and cannot
report, so they are not lanes: a change to them alone goes Live when it is
pushed, and a migration that fails to apply leaves nothing for Linear to see.
Reverse if: we need a lane Linear can see for Cloudflare or Supabase (poll `db:check`, or a deploy webhook), or
issues move so often that comments are noise (then use Linear's deployment
releases instead).

Feature flags are not built, on purpose, while the app is a prototype. Once
it is not, user-facing changes (not bug fixes, performance or small quality
of life changes) ship behind a flag. The shape we agreed, so the first one
follows it: a small synced configuration document in the spirit of decision
36, defaults compiled into the app so it behaves the same offline, and per
organization overrides from the server; no third-party flag service, in line
with decision 39. A flag gates screens and behaviour only and never the shape
or validation of an event, since events are permanent. In Linear, a flagged
issue reaches Live when its code ships dark, and a follow-up issue tracks the
rollout and removing the flag. Reverse if: a flag must change what is
synced, or we need percentage rollouts that organizations cannot override.

Amended (2026-10-22, Caleb Koster): small changes still go to `main` on
their own, but through a pull request whose guardrails checks are green;
`main` takes no direct push (decisions.md 150).

## 54. Getting in is a key the phone holds, and an account without email has a steward

Date: 2026-10-01 · By: Caleb Koster · Status: partly superseded by 59

Reason: a signed-out person who scanned a QR invite was sent to Sign In with
no account, had to find the invite again after signing up, and an invite
left in storage went to whoever signed in next. Translators in the field
often have no email, and nobody could recover a lost password, since sign-up
sends no email and the hosted project has no mail server. Every way in is
now a key: an invite key adds a membership, a sign-in key sets a looked-after
person's password. The phone holds one scanned invite with who it is for
(`apps/mobile/src/heldInvite.ts`); one redeemer above the organization uses
it, and screens only read it. Accounts made by invite without email use a
non-delivering address on `people.langquest.org` and a sign-in name; the
inviter becomes their steward (`account_stewards`), and the steward or an
organization admin can show a one-time sign-in QR (`issue_sign_in_code`,
Edge Function `sign-in-code`). Looked-after accounts cannot invite, in the
session and in `issue_invite_v3`. Invites gain a label shown to the scanner
by `preview_invite` and a use count for groups (`invite_redemptions`);
membership still enters the log as `v1.OrgMemberAdded` and
`v1.InviteRedeemed`, so no event changed. The first proposal put the
account at `inviter+name@` the inviter's domain; it was not used because many
providers do not accept `+` addresses, there is no mail server to send
resets, and it would put the inviter's address in another person's account.
Migration `20261002010000_invite_keys_and_stewards.sql`; design and flows in
`docs/invites-and-accounts.md`.
Reverse if: field teams reliably have email (then invites can require an
address and stewards are unneeded), or steward recovery is abused (then
recovery moves to organization admins only, or to proven email alone).

Amended (2026-10-03, Carl Sauder): a key also travels as an https link,
`https://next.langquest.org/invite#org=…&token=…` and `/signin#code=…`,
which a phone with the app opens in the app (universal links, app links)
and anything else opens in the web app (58). The key is after the `#`, so
no server receives it or keeps it in a log, and the web app takes it out
of the address once read. Links use the address when a build has
EXPO_PUBLIC_APP_URL (the invite email: APP_URL); otherwise the
`langquestnext://` link, and both are always read (`inviteCode.ts`).

Amended (2026-10-07, Carl Sauder): "Looked-after accounts cannot invite" is
superseded by 67; their role decides, as for anyone. Helping someone sign
in still needs an account with its own email.

Amended (2026-10-15, Carl Sauder): a looked-after account is one `join`
made, not any address at people.langquest.org. Sign-up is open, so anyone
could make a password account in that domain and be taken as looked-after
by the server, which lets helpers issue it sign-in codes. `join` now sets
`app_metadata.managed`, which only the service role can write, and
`is_managed_account` asks for it as well as the domain (migration
20261016080000; the accounts already in the domain were all made by `join`
and are marked there). The phone still tells a looked-after account by its
domain, which only changes what it shows.

## 55. Wide windows get a centred column, a side rail or sidebar, and list–detail panes; phones are unchanged

Date: 2026-10-01 · By: Carl Sauder · Status: partly superseded by 58

Reason: we are preparing the app for tablets and for publishing on the web.
The partner demo (28) is designed only for a portrait phone, so on an iPad or
in a browser every screen stretched edge to edge and the tab bar spanned the
window. The layout now follows the window's width alone, the same on web and
on native tablets, with breakpoints at 768 and 1100 (`src/layout.ts`,
`breakpoint` and `measure` in `theme.ts`). Phones are always under 768, so
their screens are the demo's exactly: every change is gated on
`useLayout().kind !== 'phone'`, and `layout.test.ts` holds the phone's tab
rule to `TAB_SCREENS`. On a wider window:
- **The kit does the work, not each screen.** `Screen`, `Header`, `Sheet` and
  `ToastView` put content in a centred 720 column. Footer actions stop at
  360 instead of stretching. A sheet becomes a centred dialog. Field sizes
  stay (48/56pt targets, 17pt body), because tablets and touch laptops are
  still touch.
- **The tabs become a rail (768+) or a labelled sidebar (1100+)**
  (`NavChrome.tsx`). On a wide window they also stay on the Manage and
  Settings drill-downs (`WIDE_CHROME`), a deliberate difference from the
  phone. Task screens still hide them (ADR-021).
- **A list and what it opened sit side by side at 1100+**: the Map chain,
  Inbox, the Manage editors, and Org to Language home. The split is read off
  the stack (`panes.ts` `paneFor`), so it adds no screen and no edge. A tap
  in the list pane goes through `goFrom` as `edgeFor(list, to)` with the same
  gates, and `nav.fromRoute` resets the stack as if the list were on top, so
  `flow.ts` and the parity test are unchanged. `panes.test.ts` checks that
  every pair is a push edge the list already has. The list is mounted once,
  in the pane, and its place in the stack shows the "Pick a …" state.
- **Tablets may rotate and phones stay portrait.** iOS is set per idiom in
  `app.json`. Android has one setting for every device, so phones under
  600dp are locked at start (`orientation.ts`). This changes the native
  fingerprint, so testers need new builds.

The costs: a book's grid remounts when it moves into the pane (its filter
survives in params, an open sheet does not); tapping another row discards an
editor's unsaved changes, as Back does on a phone; and the web build is still
not ready to publish (blob storage, camera and notifications have no web
implementation), which this change leaves alone.
Reverse if: tablet testers find the shifting panes confusing; remounts or lost
state in the chain become a real problem; or React Navigation gains a split
view that keeps the edge checks.

Amended (2026-10-23, Carl Sauder): Map and Manage now handle the panes the
same way, which Carl asked for after comparing them on a desktop window.
In Manage, the organization's page and a language's page are lists too
(`SPLITS` in `panes.ts`), so the pane always shows the screen you came from
and the right side what it opened, one level at a time, as Map's Progress,
language and book do: the organization's page beside Members, Members beside
a member, a language's page beside Roles, Roles beside a role. Before,
anything a language's page opened, and anything but a language the
organization's page opened, took the pane over and the page left the
screen. Both hubs (Progress and the organization's page) start beside a
placeholder ("Pick a language", "Pick something to manage") rather than
full width, so the layout does not jump when something opens. The admin
pages' header (`BigTop`) takes the white bar and centred column every other
header has on a wide window. Beside a desktop's sidebar, which names the
organization at its top, headers leave the name out of their subtitles, and
the organization's page is titled Manage, as Progress is titled for Map
(`orgInChrome` on `Layout`). In a split, the list pane leaves the Global
Viewer link and help's ? to the screen open beside it, so each shows once.

## 56. One main action per screen, the passage path runs top to bottom, and recording splits the screen with the source

Date: 2026-10-02 · By: Caleb Koster · Status: accepted

Reason: new people were meeting 8 to 15 kinds of action at the same weight on
the passage record, the recording and review screens, the admin homes and
Settings (the count is in the UX proposal, `UX-FEWER-CHOICES.md`). Caleb chose
Hick's law and progressive disclosure as the rule: each screen has one main
action, at most one or two secondary ones, and everything rarer one labelled
tap away, never deeper (LAN-28). The partner demo took this first (its
ADR-029 and ADR-030, "What's new" v0.7; decision 28 keeps the app on the
demo), and the app follows it:
- **Passage record** (`screens/passage.tsx`, `passage/journey.tsx`): the path
  runs top to bottom, the recording first (play it, open it, flip between
  versions to see which reviews led to which version), then each step as a
  box closed to one line; the current step starts open with each kind's one
  main button and More, and the screen opens scrolled to it (LAN-22).
- **Send to the usual reviewer**: publishing never sends anything; afterwards
  the author's main button is "Send to ‹team or person›". Review teams now
  have a kind (`v1.ReviewTeamKindSet`) and a request can go to a whole team
  (`v2.RequestMade` with `teamId`; v1 is unchanged): any member may take it,
  the first review closes it, and anyone else may still do the step, with the
  record saying who did (comply or explain). `usualTarget` and `requestIsFor`
  in core decide who that is and whose a request is.
- **Recording splits the screen** (`screens/translate.tsx`,
  `recording/SplitPane.tsx`, LAN-23): the source (text, audio, key terms) on
  top, the recorder below, with a divider that snaps to 35/50/65%. Recording
  happens in the bottom pane instead of the full-screen takeover, so the
  source stays readable; playing the source pauses recording and recording
  resumes when it stops, a listen–speak–listen loop. This differs from the
  demo's Listen → Record → Publish stages on purpose: on a phone the source
  and the recorder fit together, and a team member can read while speaking.
- **Reviewing** is Listen → Questions → Your verdict, with one Background;
  Already happened keeps its extras under Add details.
- **My Work** leads with one Next card and a bell replaces the Inbox tab for
  everyone with a My Work. The admin homes lead with Invite people or Open the
  passage map, the rest under Setup. Map filters sit behind one Filter chip.
  Settings puts the likeliest rows first and the rest under Advanced;
  Delete account stays its own row in Settings, where the store answers and
  the App Review notes say it is.

The screen-by-screen path (what each screen shows, its main action, its
secondary ones and the way back) is written out in `docs/ux/screen-path.md`.
The core model the screens teach is the demo's `docs/core-model.md` (LAN-29).
Reverse if: testing with field users shows people can't find the actions
under More or Setup, or that the split recorder is too cramped on small
Android phones.

Amended (2026-10-08, Caleb Koster): the simple redesign (decision 71)
changes three parts of this entry. The record keeps one main action, but it
sits in the path's card, with "Something else?" and "Versions and history"
under it instead of the header's More and the Details cards. "Send to
‹team›" now comes straight after publishing, as a sheet that asks the usual
team for the next check. The recording split takes any reference on top
(Bible, guide, key words, notes, earlier versions) and settles on five snaps,
two of them one-line ends, instead of three.

Amended (2026-10-12, Caleb Koster): a kind's usual team is now the people
put on that check (decision 91), and "Send to ‹team›" reads "Ask the ‹check›
team"; Review Teams are no longer a screen of their own.

## 57. The app shows the organization's reports: a Reports section on wide windows, server totals on a phone's Progress

Date: 2026-10-03 · By: Carl Sauder · Status: accepted

Reason: the Expo app now runs on tablets and in a browser (55), so the
separate web dashboard (`apps/web`, 41, 44) was a second front end with its
own sign-in, routing and charts. Its report pages move into the app as a
Reports section (`src/screens/reports.tsx`, its parts in `src/reports/`): a
tab after Map, shown only when the window is 768 or wider and the person has
`view_status` (`tabsFor`), with the dashboard's sections behind a row of
chips (Overview, Recent activity, Languages, Geography, Field report,
Monthly ledger, Pace, Alerts) and one language's page. Two app-only screens,
`reports_home` and `reports_language`, with one edge each way, are in
`flow.ts` and the parity test's drift log; the demo has no such screens, and
a phone's screens stay the demo's. Their figures are core
`portfolio.ts` (moved from the page) over the rows the dashboard's server
returns, fetched by `packages/client` `fetchOrgReports`; a language's
country and target go straight to the server with `appendConfirmed`, since
that language's partition need not be on the device. A phone gets no
Reports tab, but its Progress overview and organization home now count every
language: the local fold for the language it has open, the server's
`?view=summary` for the rest, labelled with how old they are and kept on the
device for offline (`useOrgSummary`, `orgFigures.ts`). The page in
`apps/web/src` is frozen until the app's web export replaces it behind the
same Worker. The cost: four libraries ship in the app for the map and country
names, and Reports need a connection.
Reverse if: partners want reports on phones (then a phone-shaped Reports
chain, which the demo would need to define), or the server's figures and a
phone's own fold disagree in ways people notice (then show only one source
per screen).

## 58. The web is a published platform: one Worker serves it, and a browser keeps its work like a phone

Date: 2026-10-03 · By: Carl Sauder · Status: accepted

Reason: with the reports in the app (57), the Expo web build replaces the
dashboard page, so it has to hold up as a platform rather than a test target
(55 left blob storage, notifications and publishing aside). What changed:
- Hosting: the dashboard's Worker (`apps/web`, 44) serves the app's web
  export (`npm run export:web`, `output: single`) as its static assets, with
  `/api/*` first, at `next.langquest.org` (preview `next-preview`), custom
  domains on the langquest.org zone in this account. EAS Hosting has
  no Durable Objects and wants Expo Router; Supabase functions have no
  per-organization memory. The Vite page is deleted.
- Durability: recordings and library documents live in the browser's origin
  private file system (`webFiles.ts`), so one not yet uploaded outlives a
  reload as it outlives a restart on a phone; the app asks the browser to
  keep its storage (`navigator.storage.persist`). The database stays
  expo-sqlite's, whose file pool is exclusive to one page.
- One tab: a Web Lock decides which tab holds the database (`tabLock.ts`,
  `storageGate.tsx`); another says so and offers "Use it here", and nothing
  opens storage before the lock is held.
- Honest audio: phones play only what a file's label says, so a browser
  records MP4 when it can and otherwise converts the take to WAV
  (`audioFormat.ts`); `BlobRef.format` stays `wav | m4a`. A tab in the
  background keeps recording; leaving the page warns first.
- Shared computers: sign-out forgets the browser (11, 12 amended).
- Links: one https link per key (54 amended), served `.well-known` files
  from `appLinks.json` for universal links and app links.
- Addresses: the address names the section (`webPaths.ts`), a refresh
  returns to it when the person may open it, Back steps back in the app, and
  the tab title names the screen; navigation still follows `flow.ts` only.
- Headers (`webHeaders.mjs`): a content security policy from what the app
  loads, HSTS and the rest. No cross-origin isolation: the async database
  API needs no SharedArrayBuffer, and isolation would block study images.
- Launch needs a connection (no service worker); work continues offline once
  open. Push notifications stay phone-only for now; the Inbox works on the
  web.
- Updates: each build writes its commit to `/version.json`, and the open app
  offers a reload when the deployed one differs. Diagnostics name the build
  the same way; source maps are kept out of what is served.
- Checks: `smart-tests/web-smoke` runs the release build, served by the
  Worker, in Chromium, Firefox and WebKit on every pull request, with an
  axe accessibility check; the export holds a 5.5 MB JavaScript budget. The
  muted text colour moved from the demo's #7D72A8 to #6E629E, the same hue at
  4.5:1 (WCAG AA), which axe required.
Changing the domain later: the Worker route, EXPO_PUBLIC_APP_URL and APP_URL,
the Supabase redirect URLs and `appLinks.json`, plus a native build listing
both domains; keep the old host serving, then redirecting, until links sent
and work unsent there have drained, since a browser's storage belongs to its
origin.
Reverse if: field use needs the web to open offline (then a service worker
for the app shell), people need several tabs at once (then a shared worker
holds the database), or browsers' storage proves less durable than phones'
in practice (then the web becomes read-mostly and recording stays on phones).

Amended (2026-10-05, Carl Sauder): iOS does not claim the domains yet.
`ios.associatedDomains` in `app.json` failed the App Store build: the
provisioning profile EAS made before it lacks the Associated Domains
capability, and builds from the workflow cannot add one (that needs an Apple
ID with access to Certificates, Identifiers & Profiles, which is being
sorted out). Until then iOS links open the web app; Android app links and
both `.well-known` files are unchanged. To turn it on: enable Associated
Domains on `com.frontierrnd.langquestnext` in the developer portal, make a
new App Store profile (`eas credentials`), and put `associatedDomains` back.

Amended (2026-10-13, Carl Sauder): one tab at a time no longer mistakes a
reload for another tab. After a reload, the page that went still held the
Web Lock for a moment, and about one reload in eight said "LangQuest is open
in another tab". Now a taken lock is asked for again every 250 ms for two
seconds before the page says another tab has it. Stopping releases the lock,
and a page keeps one lock however often its storage gate remounts
(`tabLock.ts`, `storageGate.tsx`).

Amended (2026-10-14, Carl Sauder): the export's JavaScript budget is 6.1 MB
(`apps/mobile/scripts/export-web.mjs`). It was raised from 5.5 to 6 MB with
localization (81), and is raised again because moving the app's logic out of
its screens into feature modules (105) added 57 small modules: Metro wraps
each one, about half a kilobyte apiece, so the move cost 30 KB beyond the
code it moved (5.98 MB on main, 6.01 MB after). The budget still says when
the download grows; one module per concern is worth that half kilobyte.

Amended (2026-10-15, Carl Sauder): the export is now a main file and one
file per screen module that loads when opened, and the budget is two: 5.7
MiB for what a first visit loads, 6.5 MiB for all of it (123).

## 59. Joining by invite needs no password, and whoever can invite you can get you back in

Date: 2026-10-05 · By: Caleb Koster · Status: accepted

Reason: supersedes part of 54. People invited by QR in the field often have
no email and will not remember a sign-in name or a password, so 54's join
(a name, a password twice, a sign-in name to write down) asked them for what
they would lose, and its recovery made them choose a new password anyway.
Caleb chose (2026-10-05) the direction tried in the partner demo (its
ADR-031, branch `caleb-qr-onboarding`):
- Joining by invite makes the account with no password. The `join` Edge
  Function takes the invite from a signed-out phone, makes a looked-after
  account named as the inviter typed (a group invite asks for the name),
  adds the membership through `redeem_invite_for`, and returns a session.
  It is safe to repeat: the phone sends one request id per join
  (`invite_join_requests`). The account's password is random and never
  shown; the person may set one later, for a shared phone.
- Getting back in is a helper's code that signs the person straight in
  (`sign-in-code` without a password returns a session). Whoever holds
  Invite at a scope that covers one of the person's memberships may help,
  while they hold it (`may_help_sign_in`); the steward row now only says
  who to ask. A helper can mark the old phone lost
  (`issue_sign_in_code_v2`), and the code then signs every other session of
  the account out.
- Adding a proven email ends help codes for that person
  (`take_sign_in_code_v2` refuses accounts with their own email); the
  emailed codes that prove an address come next.
Builds from before keep working: `redeem_invite_v2`, `issue_sign_in_code`
and the password path of `sign-in-code` keep their contracts. Migration
`20261005120000_join_without_password.sql`, tests `server/joinSmoke.sql`,
design in `docs/invites-and-accounts.md`.
Reverse if: people lose their way back in more often than helpers can bring
them back (then joining asks for an optional password again), or help codes
are misused (then help narrows to organization admins, as 54 said).

Amended (2026-10-05, Caleb Koster): the app side. Sign In and Create Account
put their fields first, then "or", then the scanner, and the scanner opens
its camera by itself. A one-person invite joins with "Join as {name}"; a
group invite asks the name first. The Welcome says there is nothing to
remember and who helps on a new phone; Settings says who helped and when
(kept on the phone, `signInHelp.ts`), and offers Set a password for a shared
phone (`has_password` in the account's metadata, set false by `join`). A
scanned invite is now held until the invite itself expires, or a week when
it was scanned offline, instead of 24 hours (`heldInvite.ts`): someone who
scans in a village may find a signal days later, and claims already keep it
from the next person on a shared phone.

Amended (2026-10-09, Carl Sauder): "whoever can invite you" now means
everywhere you are (75). A helper must hold, for every membership the
person has in an organization they joined themselves, Invite at that scope
and every privilege of the role; a membership someone else made for them
counts for nothing. A repeated `join` request signs the account in again
only within an hour and while it is still looked after with no password.

## 60. Signing out of a shared phone hands unsent work over, and it still goes as its author

Date: 2026-10-05 · By: Caleb Koster · Status: accepted

Reason: amends 12. A family or a team often shares one phone, and the
people 59 brings in by QR are the least able to wait for a signal before
handing it on. Under 12 the phone refused sign-out while anything was
queued, so the next person could not sign in until the first person's work
had gone, and offline that could be days. Caleb asked (2026-10-05) that
several people's work on one phone be accounted for, and chose this:
- Signing out with work still to send moves the session to its own key on
  the phone with no server call (`signOutHandingOver` in `handOver.ts`), so
  it works offline and the session stays good. The app then shows the
  signed-out screen as for any sign-out; nothing on screen can use the
  kept session.
- A courier runs for the whole app, whoever is signed in
  (`useHandOvers`). When the phone is online it sends that person's queued
  events in every partition (`deliverQueued`, a push-only `SyncClient` that
  never folds or re-stamps), their account changes, the recordings the
  server had not confirmed at sign-out, and the disconnect of their
  notifications, all under their own session, so the server's rule that an
  event comes from its author holds. Then it signs the kept session out and
  forgets it.
- If they sign back in on this phone first, their own session takes over
  and the courier forgets theirs. If the server will not renew the kept
  session, the courier forgets it and the work waits, still queued, for
  their next sign-in; nothing is ever deleted unsent (events are pruned
  only once confirmed, recordings evicted only once the server has them).
- Everyone's events share the phone's one log as before; each session
  pushes and counts only its own (`pendingPage` filtered by actor,
  `pendingCountBy`). A browser forgets everything on sign-out (11), so the
  web keeps 12's refusal.
The kept session is the same kind of secret supabase-js already keeps on
the phone (AsyncStorage), and lasts only until the work has gone.
Recordings in a language other than the one open at sign-out are not
listed; they go when anyone who works in that language opens it here, as
before. Tests `packages/client/test/courier.test.ts`,
`apps/mobile/test/handOver.test.ts`.
Reverse if: kept sessions outlive their work in the field (then they
expire after a set time), or a phone signs work in as the wrong person.

Amended (2026-10-15, Carl Sauder): the signed-in session and the sessions
kept here now live in the iOS Keychain and the Android Keystore through
`expo-secure-store`, not in AsyncStorage; the web build is unchanged and keeps
the browser's storage, which signing out wipes. A security audit found
refresh tokens, ours and other people's, in plaintext AsyncStorage, where a
backup, a rooted phone or a stolen one could read them. A session is longer
than SecureStore's 2 KB guidance, so `apps/mobile/src/server/secureStorageModel.ts`
cuts a value into parts and encodes the key; the list of hand-overs holds
no secret and stays in AsyncStorage. A value found only in the old place
moves over on its first read, so people already signed in, and hand-overs
already waiting, survive the upgrade. The Android backup rules keep the
Keystore-encrypted values out of backups. supabase-js reads its session at
every request, so values are kept in memory once read; an entry the Keystore
can no longer read counts as signed out. Test
`apps/mobile/test/secureStorage.test.ts`.

Amended (2026-10-26, Caleb Koster): with a lock on the phone (168), the
session a hand-over keeps is sealed for its owner too. When the courier has
sent everything it no longer ends that session: it seals the newest copy and
drops the key, so the person can still come back to this phone offline.
Coming back from the lock takes the session back from the courier without
ending it, after any delivery under way stops (`takeBackHandOver`).

## 61. Every passage says whether it is on this phone, and Settings says how ready the phone is for offline

Date: 2026-10-05 · By: Caleb Koster · Status: accepted

Reason: a person can read and play passages while connected and assume they
will still have them in the field, then find out after a long trip that the
audio never came along. The offline scope was already precise (PLAN.md
section 14 rule 10: assigned, worked in, or chosen with `keepOffline`), but
nothing on screen showed it and nothing let anyone choose a passage. Core
`offlineByUnit` and `offlineSummary` (`packages/core/src/blobs.ts`) count, per
passage and for the whole scope, the audio a passage plays (its own and what
it inherits, the same set the downloader fetches), how much is here, what is
still to fetch and what nobody has sent yet. The app shows it in three places
(`apps/mobile/src/offline.tsx`): a line on each passage ("On this phone",
"Downloading for offline" with progress, or "Not kept on this phone" with
Keep offline), a mark on the Map's passage discs and chapter tiles for kept
passages, and a
"Ready for offline" row in Settings that opens the Sync screen, which lists
what is always here and what always needs a connection (unkept audio and
study material, study films, reports, other languages). On a phone, a kept
passage also takes its study guide along: step audio, glossary audio,
pictures and maps (`study/StudyPrefetch.tsx` finds the guides,
`study/studyFiles.ts` keeps the files by a hash of their address and screens
play the local copy first). Films stay online because of their size, and the
web app keeps none, since it needs a connection to open (decision 58). Study
files are not evicted; FIA's are low-resolution copies. A passage is ready when
it is kept and every file the server has is on the phone; a recording not yet
sent from the phone that made it cannot block that, and is named instead.
Text, status and history are not counted: the open language's partition is
always whole on the phone. Keep offline works on the content template's own
units, so it is a chapter where the template splits by chapter and a passage
where it splits by passage; there is no separate chapter-wide switch
(Caleb's call, 2026-10-05).
Reverse if: people keep so many passages that the 2 GB cache evicts kept
audio's neighbours in practice (then the Settings line needs a size budget),
the study file folder grows past what phones can spare (then it needs the
same eviction rules as audio), or teams need films in the field.

Amended (2026-10-07, Carl Sauder): the app runs on phones, tablets and the
web (decisions 55, 58), so the screens say "device" where they said
"phone": "On this device", "Not kept on this device", "Always on this
device", and likewise in sign-in, sync, reports and errors. "Phone" stays
only where it names phones on purpose: phone-number fields, and the guide
editor's note that phones and tablets get a small copy of each picture. The
demo already says "another device". Code identifiers (`onPhone`, the
`'phone'` layout kind) keep their names.

Amended (2026-10-20, Carl Sauder): a phone's first download of a big
language fills its passages in behind the Map (147), so "text, status and
history are always whole on the phone" holds once the fill is done. Until
then each passage's line stands in for its record, the Map and the Sync
screen say "Downloading this language" with how many passages are here,
and "On this device" means a passage's rows and its audio: a kept passage
whose rows have not arrived is not ready, and opened offline it shows its
line and "Not on this device yet". The person's offline scope fills first,
after whatever a screen opens.

## 62. Reference material is library documents placed by coordinates, recommended at three levels, and recorded where it was used

Date: 2026-10-05 · By: Caleb Koster · Status: accepted

Reason: translators need Bible text and audio, study guides and notes beside
the recorder, and the app had a stand-in: a dozen bundled English chapters
with simulated verse timings, two opt-in OpenBible audio editions on the old
catalog toggle, guides matched from every organization's shared material,
and no record of what anyone used (review of 2026-10-05; Genesis 1 played
nothing because no organization had turned a source on). Caleb chose
(2026-10-05): open texts and audio stored by us, Bible Brain content cached
on phones only where its `/download` endpoint allows; organization admins
recommend, language admins narrow or add for their team, translators
choose for themselves and see what works offline and what has audio;
tapping a verse jumps the audio there and plays on; the record keeps what
was offered plus what was opened or played. So: sources are library
documents (`source@1`, `sourceBook@1`), joined to their audio by
`timing@1` documents named by the recording's SHA-256 and versification, so
any text with the same verse numbers can be highlighted against any
recording; recommendations are `v1.ReferenceRecommended` (org partition)
and `v1.LaneReferenceRecommended` (language), hand placement is
`v1.PassageReferenceLinked`, and `v1.ReferencesUsed` names what was in
front of the person on a version or review (`packages/core/src/references.ts`).
Passages take coordinates from their unit ids, never labels. Bible Brain
is reached only through the web Worker, which keeps the key, caches
answers, picks filesets by testament and hands out keyless signed links; we
keep none of their content on our servers. Verse timings Bible Brain lacks
are made by fia-align (genesis-ai-dev/fia), whose model weights (Meta's
MMS, CC BY-NC 4.0) suit a free app; the job takes audio only from filesets
`/download` allows, deletes it afterwards and keeps the timings, and an
admin's app publishes the passing chapters as the source's next version.
Organizations write guides as rich as FIA's in a web editor, as `study@2`
(media by hash, callout kinds, placement by template node). The full design
is `docs/reference-material.md`. Details that follow from it: a passage's
study guides come only from what is recommended, linked to it or the
organization's own (never every shared item); a timing job never replaces
a chapter's existing timing; a Bible added from Bible Brain is the library
item `biblebrain.<bibleId>`; and an organization following one of
LangQuest's sources may ask for its timings, which the web Worker's
scheduled publisher adds to LangQuest's item for everyone who follows it
(the server writes into no other organization's library). The Worker's key
is an optional secret, so deploys never wait on it.
Reverse if: FCBH objects to our timings or to on-device caching (then their
audio plays with FCBH timings only and streams), or field teams find three
levels of recommendation confusing (then the language level goes and
translators pick from the organization's list).

Amended (2026-10-06, Carl Sauder): the three levels stand; the language
level is `v1.ReferenceSet` in the language's stream, and material or
question sets meant for every language are recommended library items,
not copies in the open language (63).

## 63. Below the organization there are only languages, and the sync unit is the stream

Date: 2026-10-06 · By: Carl Sauder · Status: accepted

Reason: the model still carried two levels that no longer existed. The
project left the app in 34 and became one partition per language in 37, yet
the code named it everywhere (`projectId`, `ProjectState`,
`v1.ProjectCreated`, the `project` scope) while SQL and docs called it a
partition; and every partition held exactly one lane with the same id. Most
of the code paid for distinctions that never varied, and where they varied
TypeScript and SQL disagreed: a lane-scoped member was authorized for the
whole partition on any event without a `laneId`, "All languages" materials
reached only the language that was open, and the UI offered language admins
invites the server refused. With three developers and nobody else's data,
we reset the databases instead of migrating (Carl, 2026-10-06). So, as
`docs/streams-and-languages.md` sets out: below an organization there are
only languages; a language's identity (name, code, source code, country,
target) lives in the organization stream (`LanguageAdded`), its work in its
own stream, and a language stream accepts events only once the organization
lists it. The sync unit is the stream (organization, language or person),
named `streamId` only in sync code; everything about a language says
`languageId`, and work payloads carry neither, since the stream an event is
appended to says which language it belongs to. Membership scope is `org` or
`language`, one role per scope, and core and SQL compute privileges the
same way. Settings have two shared levels: the organization's library and
its recommendations, and the language's template, flow and own choices;
material for every language is a recommended library item. The event
catalog keeps one version of each event, restarted at `v1`, without the
ones nothing wrote, and the role-based v1 workflow model is retired in
favour of the record model. The migrations were squashed into one baseline.
Supersedes 25 and 34; amends 23, 32, 37 and 62.
Reverse if: an organization needs one body of work synced across several
languages at once; then a language stream gains members of its own, not a
lane level.

Amended (2026-10-06, Carl Sauder): two choices made while retiring the v1
model. A new language picks its flow when it is added, and a language with no
flow selected has no steps (`deriveFlow`), instead of falling back to a
default workflow. The server's Inbox rows and pushes come from the same
`updatesFor` the phone's Inbox reads, one row per update for each person who
may open the language; the blocker and "translate everything" rows are gone.
Amends 21, 24, 42 and 47.

## 64. A missing caller is the service role only because nobody signed out can reach the function

Date: 2026-10-07 · By: Carl Sauder · Status: accepted

Reason: the log's functions (`append_events`, `pull_events`, the snapshot
reads and `put_snapshot`, the blob and stream service paths) read a missing
JWT `sub` as the service role and skip their checks, which is how the
workers call them. A signed-out caller has no `sub` either, and these were
never revoked from `anon`, so the public key alone could pull any stream,
overwrite a snapshot, invalidate a blob, and append events as any member.
Postgres grants execute to `public`, and Supabase to `anon`, on every new
function, so the rule cannot rest on each function remembering: migration
`20261007000000_no_anonymous_rpcs.sql` revokes them, and `server/smoke.sql`
section 14 fails when any security definer function in `public` that `anon`
may run is missing from its short list (today only `preview_invite`). The
app no longer opens a placeholder organization before it knows the person's
(`App.tsx` `Shell`, `useOrg` with no organization): a guest, or an account
in none, syncs nothing, so it is never refused for an organization it is
not in.
Reverse if: signed-out people need to read a stream; then give that read
its own function that checks the stream is public, not a null caller.

Amended (2026-10-07, Carl Sauder): row-level policies run as the caller,
so a function made service-role only must not appear in one. The read
policies on `invites` and `join_requests` called `org_privileges`, and every
signed-in read of either table failed. They now call `my_privileges` (the
caller's own privileges) instead
(`20261007120000_policies_use_my_privileges.sql`). Granting `org_privileges`
back to `authenticated` was rejected: it answers for any profile in any
organization, so anyone signed in could learn who holds which role
elsewhere. `server/smoke.sql` section 15 reads both tables as a signed-in
caller.

## 65. Whoever may admit people sees the name of each person asking to join

Date: 2026-10-07 · By: Carl Sauder · Status: accepted

Reason: an admin cannot decide on a join request without knowing who is
asking. Profile names were readable only between people who share an
organization (`profile_visible`), and a requester is not a member until
admitted, so every request showed the colour-and-shape placeholder.
`profile_visible` now also lets a caller read the profile of anyone with a
pending request to an organization where the caller holds `invite_members`
at organization level, the same test the `join_requests` read policy uses
(`20261007140000_admins_see_requesters.sql`). The name shows from the
request until it is decided; after that the person is a member (and visible
as one) or, if turned away, no longer visible. `pendingRequests`
(`apps/mobile/src/invites.ts`) reads the names with the requests, since a
request can arrive after the app read everyone's names.
Reverse if: requesters need to stay anonymous until admitted; then the
request itself should carry the name the person chose to give.

## 66. Request Access lists the organizations that list their work; others are joined by invite

Date: 2026-10-07 · By: Carl Sauder · Status: accepted

Reason: opened from the intent chooser, Request Access asked for an
"organization code", which was the organization's id (`org-` and a UUID).
No screen shows anyone that id, so nobody could give it out or type it, and
the demo has no code: it lists organizations to pick from. The screen now
lists, by name and with their listed languages, the organizations that list
at least one language on Explore (`listed_organizations`,
`20261007160000_listed_organizations.sql`), to signed-in people only, as
asking to join is. An organization that lists nothing is not found there;
the screen says to ask its people for an invite. Listing a language already
made it public with its organization behind it (docs/licensing.md, Access),
so this names no organization that had not chosen to be found. A short
code an admin could share was considered and not built: it needs a new
column, a lookup, and protection against guessing, for organizations that
chose not to be found and can invite instead.
Reverse if: organizations that list nothing need people to find them
without an invite; then give each a short code an admin can share.

Amended (2026-10-13, Carl Sauder): the phone receives the first 500 listed
organizations by name, and searching only that list hid every organization
after them. Typing now also asks the server, which searches every listed
organization by its name or any language it lists
(`listed_organizations_search`). What it finds joins the phone's own
matches. Offline, the saved list is searched as before. The UI test suite
found this (JRN-005) once the local database listed more than 500.

Amended (2026-10-26, Carl Sauder): an organization's name is read from the
table `org_names` (the latest `v1.OrgCreated` or `v1.OrgRenamed` by hlc and
id, kept by a trigger on `events` and filled from the log by migration
`20261026170700_org_names.sql`), not found by sorting its name events for
every organization in a listing. `org_name()`, `listed_organizations`,
`listed_organizations_search` (now by trigram index) and
`global_viewer_organizations` (158) read it; their results are unchanged.

## 67. Whoever holds Invite may invite and admit people, with or without an email of their own

Date: 2026-10-07 · By: Carl Sauder · Status: accepted

Reason: supersedes 54's "looked-after accounts cannot invite". Since 59,
joining by QR with no email is how most people in the field get an
account, admins included, so the rule left whole organizations where
nobody could invite anyone or see a join request. A local test showed it:
a looked-after admin's Inbox and Members never asked for the request that
the server had already shown them in an Inbox row, because the session had
removed Invite (`deriveSession`) and both screens gate on it. The rule
added no protection for inviting: both kinds of account stay signed in on
the phone, an email is not yet proven, and a wrong invite or admission is
undone by removing the member, which the log records. So Invite is decided
by permissions alone: `deriveSession` keeps the role's privileges, and
`issue_invite_v3` no longer refuses looked-after accounts
(`20261007180000_looked_after_accounts_invite.sql`). Join requests already
went by permission on the server (`join_requests` read policy,
`decide_join_request`, the projection worker's Inbox rows). Helping
someone sign in is unchanged and still needs an account with its own email
(`may_help_sign_in`): a sign-in code signs a helper in as another person
and can sign that person out everywhere else, a power over someone's
account and recorded work rather than over a team, and it is its own
decision.
Reverse if: invites or admissions from looked-after accounts are abused,
or a stolen phone is used to let people in; then require a proven email
(or a second admin) for those actions rather than removing them from the
role.

## 68. The database makes an organization's Inbox rows when they change, pushes go every minute, and the projection pass skips what has not changed

Date: 2026-10-07 · By: Carl Sauder · Status: accepted

Reason: an admin heard of a join request only after the next projection
pass, every five minutes in production, plus however long the pass took,
and the pass grew with how many organizations and languages exist, not with
how much happened. Every pass folded every organization's whole stream and
downloaded every language's snapshot, changed or not, to rewrite every
member's Inbox rows. Three changes:
- The organization's own rows (join requests, reports) are made by the
  database: `refresh_org_notifications` computes them from tables it
  already keeps (`org_memberships`, `org_roles`, `_may_moderate`), and
  triggers on `join_requests` and `content_reports` call it with the
  change. Their ids are the worker's, so no row is pushed twice. An
  advisory lock per organization keeps two requests from undoing each
  other's rows; the trigger never fails the write (as `events_notify`).
- Push delivery is its own job, every minute (`langquest-push-delivery`,
  the same Edge Function with `{"task":"pushes"}`), so a row reaches the
  phone within a minute. `claim_notification_pushes` is one index lookup
  when nothing waits.
- The projection pass keeps a mark per stream (`projection_marks`: the
  last event projected, the organization event folded, the listing, a
  `PROJECTION_VERSION`) and skips a language whose stream, organization
  and listing are unchanged, without downloading its snapshot. It
  refreshes an organization's own rows only when its stream changed
  (someone became or stopped being an admin). Inbox rows depend on no
  clock (`updatesFor`), so a skipped language has nothing to update.
Locally, a repeat pass went from downloading every snapshot to four small
reads. Migrations `20261007200000_org_inbox_rows_in_sql.sql` and
`20261007200001_schedule_push_delivery.sql`, which now does what
`20261006000001` did for `npm run secrets` and `scripts/local-db.mjs`.
Reverse if: rows that need the folded state (passage updates) start
arriving late because of the five-minute pass; then those want the same
treatment, from the language's events, rather than a faster pass. Or if a
mark lets a language go stale; then bump `PROJECTION_VERSION` and find
what the mark misses.

Amended (2026-10-12, Carl Sauder): the pass also visits a language whose
newest snapshot is behind its stream and an hour old, so it gets a new one
(88); a language whose stream moved is still folded every pass, but its
snapshot is written only on 88's schedule.

Amended (2026-10-15, Carl Sauder): the pass also skips a language whose
stream moved when the organization and the listing are as its mark left
them, no snapshot is due (88's schedule, unchanged), and every event since
the mark, at most 1,000, is of a type that cannot change an Inbox row, a
row's title or the language's progress (`eventsThatCannotChangeInbox`,
`packages/core/src/quiet.ts`, held by a property test). It reads only those
events and moves the mark; the snapshot is not downloaded. A type not
checked is left out and costs a full fold, so a new language event type is
read against the list before it joins it. `public_languages` is written
only when something it shows changed, and the snapshot's age comes from the
list the pass already read (performance-audit-app.md V2). Reverse if a
skipped language's Inbox rows are found stale: take that type out of the
set.

Amended (2026-10-19, Carl Sauder): the pass runs for every language in the
job container behind the dashboard Worker, every five minutes (141), and
pg_cron on a hosted project schedules push delivery alone
(`20261019110000_projection_pass_in_container.sql`). A local stack keeps the
Edge pass every minute, scheduled by `scripts/local-db.mjs`, since wrangler
dev fires no cron and the web UI tests wait for it. The pass also writes
each language's report inputs (142), so a quiet tail must leave those alone
too: it skips a language only when every new event is in
`eventsThatCannotChangeReport`, the quiet list without recordings, cards and
stored files, and moves the stored inputs' position with the mark.

Amended (2026-10-20, Carl Sauder): a local stack no longer keeps the Edge
pass: it runs the pass in the job container too, its tick fired every
minute by `npm run web:dev`, and push delivery's function is
`push-delivery` (148).

Amended (2026-10-26, Carl Sauder): the pass no longer folds a language again
because its organization's stream moved. A mark keeps a fingerprint of what
the language's projection reads from the organization (who may open it, its
name and code, the licence: `orgFingerprint` in `server/projectionWorker.ts`,
`projection_marks.org_fp`); an organization event that leaves it equal (an
invite, a role nobody holds, a join decided for another language) only
moves the mark's `org_seq`. A projection that starts to read something more
from the organization must put it in the fingerprint or bump
`PROJECTION_VERSION`. The pass also reads one snapshot row per stream
(`snapshot_heads_page`) and only the listed languages' visibility rows.

## 69. Recordings and guide media live in Cloudflare R2, behind the app's Worker

Date: 2026-10-07 · By: Carl Sauder · Status: accepted

Reason: cost. Every recording a phone downloads for offline use, and every
guide picture or film, was Supabase Storage egress, billed per gigabyte
after the plan's quota; R2 charges nothing to read data out, and less to
store it. Files keep their keys (`<org>/<stream>/<sha256>.<ext>`), so the
`v1.BlobStored` events already in every log still name the right file.
The dashboard Worker (decisions 44, 58), which phones already reach as
`EXPO_PUBLIC_API_URL`, binds a private bucket (`BLOBS`:
`langquest-next-blobs`, `-preview`, location hint `enam` beside the
Supabase project in us-east-2) and serves `/api/blobs` (`apps/web/worker/blobs.ts`):
- An upload is a `PUT` with the person's access token. The database
  decides who may (`blob_access`, service role only, the same rule the
  bucket policies held: whoever may read a stream may read and upload its
  files, and a guide's media is also readable where a guide naming it is).
  R2 checks the bytes against the hash in the name (`sha256` on `put`) and
  refuses a mismatch, which the Worker answers 422 so the phone stops
  retrying it. The Worker then appends `v1.BlobStored` with `record_blob`
  before it answers 200, replacing the storage trigger (decisions 14, 17).
- A read is a ten-minute link from `/api/blob-urls`, signed with a key
  derived from the service-role key, so players that cannot send a token
  still stream (with Range) and nothing new is kept as a secret. The byte
  path asks the database nothing.
- Scripts and the reconciler present the service-role key to list, read,
  write and remove (`workerBlobs` in packages/client), so they need no R2
  credentials and work against `wrangler dev`'s local bucket the same way.
The old bucket was copied once (`server/copyBlobsToR2.ts`), then emptied
and deleted; migration `20261007220000_blobs_in_r2.sql` drops its policies,
its trigger and `_blob_readable`. Presigned R2 URLs with an R2 event
notification and a Queue to confirm uploads were rejected: more moving
parts, no hash check at the door, and R2 credentials on every script.
Cost: the Worker, until now only reports and Bible lookups, is on the path
of every file the app moves, so transfers need both Cloudflare and Supabase
(for sign-in and `blob_access`); offline-first sync turns an outage of
either into a delay. Each upload and each read link is one database call,
as the bucket policies were. Uploads are capped at 50 MiB, as before, under
the Worker's 100 MB request limit.
Reverse if: Worker CPU or request costs approach what the egress saved, or
films outgrow the request limit (then presigned multipart uploads for large
files only), or Cloudflare availability costs more field time than it saves.

## 70. Apps and agents reach an organization with scoped access tokens, through the app's Worker

Date: 2026-10-07 · By: Ryder Wishart · Status: partly superseded by 72

Reason: partners want their own apps on LangQuest's data. Every
Language's listening app plays approved chapters, lets listeners say
whether a passage sounds right, and marks what is ready to publish; agents
(Claude, ChatGPT and others over MCP) want to read and comment the same way
(LAN-41; the partner calls of 2026-08-24, 09-22 and 10-06). Chosen:
- A token belongs to one person in one organization and is never more than
  that person: every request reads their privileges from the folded log
  today, then narrows by the token's scopes (`read:published`, `read`,
  `feedback`, `publish`) and, if set, a list of languages. Leaving the
  organization or losing a role takes the token's reach with it; nothing
  about access is stored but the narrowing. Only the token's SHA-256 is
  kept (`api_tokens`, migration `20261008000000_api_tokens.sql`), as for
  invites; it never expires unless asked to, and is revoked on the page.
- Tokens are made on `/connect`, a page the Worker serves itself (the Expo
  app's screens follow the partner demo, which has none for this), or asked
  for by an app with the OAuth device flow (RFC 8628): the app gets a code,
  a person opens `/connect?code=…`, sees what the app calls itself marked
  unverified, may narrow but never widen what it asked for, and approves;
  the app's poll then succeeds and its device code is its token, so no
  plaintext secret is ever stored. This is the "poll to create a token" the
  partners asked for, and spares the Aquila lesson of approving every action
  by link.
- The API is `/api/v1/*` on the dashboard Worker, answered by the
  organization's Durable Object from the same folds as the reports
  (decision 44, `apps/web/worker/agent/`), with the same rules as MCP tools
  at `/api/v1/mcp` (stateless streamable HTTP, a bearer header, so any MCP
  client connects with one URL). A `read:published` token sees only a
  passage's approved version, core `approvedVersion`: the newest version
  every step approved by reviews of that very version. `done` is looser (it
  reads each kind's latest review of any version, and an answered "needs
  changes" counts), so a re-recorded passage stays done while its new audio
  is unheard; a listening app keeps playing the version that was approved.
  Audio comes as the ten-minute read links of decision 69. Any origin may
  call it, since the token is a header and never a cookie.
- Writes are ordinary events, appended with `append_events` as the token's
  person from a device of the token's own (`api-<token id>`), so the
  database applies their phone's privilege checks: listener feedback is
  `v1.ReviewRecorded` of kind `listener` given by link, with the listener's
  name in `givenBy` and the app's listener id only as a hash in the review
  id (one answer per listener, version and outcome, against griefing), plus
  600 writes an hour per token (voice-note uploads included), and the
  device endpoints, open to anyone, are rate-limited per address. Ready for
  publication is a review of kind `publication` on the approved version,
  read by core `publicationOf`, so it never outlives that version or its
  approval. Both
  kinds are in no flow: they never complete or block a step. No new event
  type was needed.
Rejected: OAuth with redirects and client registration (more moving parts
than a partner's app or a pasted MCP config needs today); tokens not tied
to a person (a service account would need its own place in the privilege
model, and every write needs an author); a separate API Worker or Supabase
function (it would refold what the Durable Object already holds).
Reverse if: partners need many users of one app to act as themselves (then
OAuth authorization codes with per-user consent), the per-object rate limit
or folds per request show up in Worker CPU, or publication needs to gate
something (then it joins the flow as a checkpoint kind instead).

Amended (2026-10-12, Carl Sauder): the passage list now returns
`{ passages, nextAfter }` a page at a time, picks passages by `unitIds`,
and adds any part of one passage with `include` (85).

Amended (2026-10-13, Carl Sauder): an answered "needs changes" no longer
counts toward `done`: the check stays open until its reviewer passes the
new version (96).

Amended (2026-10-13, Ryder Wishart): a token can revoke itself
(`DELETE /api/v1/token`) and have webhooks, and `/me` names its
organization (101).

## 71. One simpler set of screens for everyone, keeping every capability

Date: 2026-10-08 · By: Caleb Koster · Status: partly superseded by 125

Reason: clients who had watched field translators with little or no
experience with technology preferred Ryder's simplified screens (one task,
big buttons). Caleb chose to simplify the app itself rather than add a
second "simple" view: a Simple/Full split per person was designed and
dropped, because two sets of screens would double what has to be kept
working. The specification is the partner demo's ADR-032 to 040 and
SIMPLE-1 to 16 (ng-langquest-ux, branch `caleb-simple-translator`; notes in
`docs/ux/simple-redesign.md`). Built here:
- The passage record leads with the path's next step; other ways forward are
  under "Something else?" (ask someone, already happened, not now, a new
  version, a note, what helps, keeping it on the device), and the study,
  reviews by version and history under "Versions and history"
  (`screens/passage.tsx`).
- Publish, then ask: publishing (a version or a back translation) returns to
  the record with the usual team for the next check preselected
  (`published` param, `usualTargetFor`).
- The recording workspace's top pane takes any reference by chip, and
  `recording/splitModel.ts` adds one-line ends (`BAR`) to the 35/50/65 snaps.
  The record button stays in the footer, so it is reachable at every snap.
- Ask someone lists the review group for that check first, named
  (`askCandidates`); admins may put people in each group.
- Admins get "Get ‹language› ready": four plain questions on My Work
  (what they record, what helps them, who checks, invite), and the language
  page shows the same three rows in place of Setup. New Language can choose
  books (`booksInScope` with `custom`). Roles read in three groups
  (`PRIVILEGE_GROUPS`), and a new role can be made while inviting or
  admitting someone.
- Help mode: a ? in every header; while on, kit controls explain themselves
  instead of acting (`helpContext.ts`, `helpMode.tsx`), spoken on the web.
- Joining reads "Join your team": scan their code, find your organization,
  start a new one. "Keep it, say why" has no preset reasons.
Not built yet, because each needs model or recorder work: grouping recorded
parts into cards by verse label (needs verse labels on parts), recording
which Bible was playing during each take (today `v1.ReferencesUsed` lists
what was offered and opened), microphone setup by ear (the recorder keeps
its pause and cutoff only for a session), spoken help lines per screen on a
device, notes on a key term, and side-by-side panes on wide windows.
Reverse if: field tests show translators miss what moved behind "Something
else?" or "Versions and history", or admins need the Setup list back.

Amended (2026-10-08, Caleb Koster): Home, the tabs, the Map and Me now look
like the agreed design, not only relabelled. The tabs are Work, Map, Manage
(admins) and Me, with no count on Work; the bell carries the unread count.
My Work leads with one "Next for you" card (Start opens the passage for
recording and feedback, Review it for a check, the back translation for
one), then "Then" (three rows, the rest one tap on) and "Waiting on others"
and "Opened lately" as quiet links that open in place. Getting started is
gone (help mode and the Get ready card replace it); a coordinator's Home
leads with "Get ‹language› ready · n of 4" and the next question, which opens
the Get ready screen at that question (`step` 1 to 4), with join requests and
checks asked of them under it. The sync chip shows only when work waits to
send, the device is offline or sync is refused. A language's map is search,
"Next", testament pills and one row per book with a bar and "25/97"; the stat
tiles, filters and template and flow are behind "Filter". A book's chapters
show three states (done ✓, started •, not started), the seven-tone key one tap
deeper. Settings is Me: name, Ready for offline, Set up the microphone, How
LangQuest works, More settings, then Sign out; More settings holds the rest,
including Delete account (decision 56's "Settings" row; the deletion page and
store declarations now say Me → More settings → Delete account).

Amended (2026-10-08, Caleb Koster): Review it and back translation are the
agreed screens (`screens/review.tsx`, `simple/review.tsx`,
`simple/btWorkspace.tsx`). Review it is Listen, Questions (one per screen),
Decide, then "What should change?" voice first; Background is one sheet
(the passage in the Bible the translator used, the team's study, notes, key
words, earlier checks). No new events; existing fields carry the new parts:
- A note at a moment of the version is a review artifact with `atMs`, as on
  review links.
- An answer said aloud is a review artifact too; `answers` stay text and
  name it ("Said aloud · 0:14 · recording 1"). Tying a clip to its question
  exactly would need a `questionId` on Card (core, SQL `_is_cards`, a
  migration), not done.
- A note on the Bible in Background is a verse note (`verse`, `translation`,
  `at`), as the study and the recorder leave.
- Back translation is said part by part against the parts of the version;
  each piece carries the moment its part starts (`atMs`), which
  `produceContent` now keeps, so the consultant can pair them. Part cards
  say "Part n" until parts have verse labels.

Amended (2026-10-08, Caleb Koster): the admin screens now take the agreed
shape, not only its words (Caleb: "go through the plan we agreed on and
actually do it"). A language's page is the Get ready checklist until the
language is ready, then the same four as a summary with join requests under
them; everything else it had is under More. Ready means something to record,
a way to check it, and someone given a role or a code for that language (the
organization's own translators do not count, since they cover every
language); what helps them is asked but never required. Each question is its
own screen (`get_ready` with `step` 1 to 4, `helps` for What helps them). A
guide or note in the library counts as offered unless the language hides it,
as `reference/offered.ts` already offers it; a Bible only when recommended.
Who checks, from a ready language, edits that language's own steps (core
`saveFlowSteps`), so it stops following the library flow it used; Undo puts
that flow back. New Language is four steps and offers the new team the
organization's own English Bible and study guides, else LangQuest's (followed
first). What someone will do reads as four plain choices given by the
organization's roles (Back-translate gives the checking role unless a role of
its own exists); the rest stay one tap away. A role's fifteen permissions are
twelve switches in three groups: setting up languages covers the structure,
templates and dividing books; choosing who checks covers flows and review
groups. Inviting shows a group code (30 uses) first; email and a code for one
named person are one quiet tap away.

Amended (2026-10-08, Caleb Koster): the recording workspace, Publish, the
study and microphone setup now follow the agreed images (`src/simple/`).
The workspace's header names the passage; its chips are Bible, Guide, Key
words, Notes and Earlier (versions, feedback, voice notes, back
translations), the Bible a small player over its verses with a picker when
there are several; key words play their verse and "Your word" (the latest
voice adjustment) or record one ("Say yours", `adjustKeyTermRendering`), and
"Add a key word" is `defineKeyTerm`. Parts are cards counted "Part 1, 2…"
(still no verse labels), recorded ones under one card; each divider end is a
one-line bar (the Bible bar, the recorder bar with the record button), and
the footer holds the record button and Publish. Publish is a screen inside
the workspace, so nothing offered or recorded is lost on the way. The study
is one reader for `study_guide` and `study_step` (it no longer keeps the tab
bar). Microphone setup measures the room's quiet for the sensitivity, takes
three tries with pauses of 0.7, 1 and 1.5 s, and keeps the pick on the device
(AsyncStorage `mic-setup:v1`), which every voice-detecting recorder starts
from; the pause dots and the cutoff line left the workspace for "Adjust by
hand" there. A voice-detected part now belongs only to the session that
started the detector (`claimVad`), so a recorder left mounted under another
screen keeps nothing it did not record. Still not built: notes on a key term
(no screen writes a `term` note, so "Note on a word" is left out).

Amended (2026-10-09, Caleb Koster): spoken help on a device plays recorded
lines in the app's language, downloaded and kept on the phone (decision 81);
none are recorded yet, so a device still shows the words.

Amended (2026-10-10, Caleb Koster): help mode no longer opens by itself. The
first-time screen intros (demo a-helpFirst) are gone, because opening the
overlay the first time someone reaches each screen was too confusing; help
comes only from the ?. While it is on, the screen dims and every part stays
lit with its number, the ? lit and filled as the way out (the "Help is on"
banner is gone). A tap on a part shows a tooltip beside it, its name and
what it does, with a play button; nothing plays by itself, and the card
that said "Playing" and stepped through the parts with Back and Next part is
gone. The play button shows where there is something to play: a recording
of the line, or the browser's voice on the web. "How this works" still plays
when tapped, in the same tooltip. Every part that explains itself is now
numbered: the controls that used `useHelpPress` explained themselves without
a visible number, and now light up and number like kit's (`useHelpSpot` with
`HelpBadge`). The layer that draws the dim, the numbers and the tooltip
(`helpMode.tsx`) measures each part every frame while help is on, so it
follows scrolling; kit's Screen body and the workspace panes (`HelpClip`)
keep what scrolls inside them from being lit past their edges. Numbers go in
reading order across what is in sight when help comes on, and parts
scrolled into view later take the next numbers, so a number never changes.
Reverse if: field tests show people miss help without the intros (then an
intro behind the ?, not on first open), or the dim hides what people need
to see while exploring.

Amended (2026-10-11, Caleb Koster): New language makes its own answer where
none fits. Question 3 has "I'll choose the steps" (as Get ready does): it
opens the flow editor on a new flow for the organization, named "<language>
checks" and starting from the steps of the way picked before, and the flow
saved there comes back picked. Review flows stay library flows chosen per
language, so the new one is a template other languages can use too.
Question 2's "Make your own" opens the template editor (`new_language` had
no edge to it, so the app said it could not open there). Continue no longer
shows a still "Saving…" button: the screen names each part as it starts
(the passages, the review steps, the Bible and guides offered, listing the
language, saving its passages) under a bar that keeps moving, and ✕ says
to wait until it is done. The wait itself was mostly FIA's English guides:
loading a collection fetched everything it depends on, which for that
collection is 1,525 guides (65 MB), and following it did that before going
on. Opening any passage did the same on every phone, the first time. Now a
collection brings only its numbering, as a Bible source already did
(`loadDocs` in library/docStore.ts), and each guide is fetched by its own
hash when a passage reads it. On a phone-like link (12 Mbit/s down, 4 up,
120 ms) a first language took 60 s and now takes 5 to 7; the first passage
opened fetched 1,524 documents (67 MB) and now fetches its one guide (80
KB). Offline, a phone keeps the guides of the passages it keeps (decision
61, `StudyPrefetch`), not every guide.
Reverse if: teams need every guide on the phone before they go out of
signal, beyond the passages they keep (then a "keep all guides" choice on
Ready for offline, not a download on first open).

Amended (2026-10-13, Carl Sauder): the "seven-tone key one tap deeper" above
is no longer what the app shows. A book's chapters show three states, and
the key under Filter has five lines: done, started, not started, no passage,
and kept on this device. The seven tones survive only in each chapter
tile's spoken label. The UI test suite (decision 95, MAP-021) holds the
app to this.

Amended (2026-10-13, Carl Sauder): the welcome offered "Show me how" and
"Skip for now", which both went to My Work once the Getting started card was
gone. It now offers one "Get started" for every role (AUTH-057). The tour
"Show me how" stood for was never built.

Amended (2026-10-14, Caleb Koster): Switch Organization is no longer only
under More settings, because Caleb and a partner both found it hard to find
there. For someone known to be in more than one organization, Me shows it
as its second row, under their name (`inSeveral` in `account/model.ts`).
My Work does not offer it: Caleb chose Me as the one place. Someone in one
organization, or on a device that has never listed theirs, still finds it
under More settings, where it starts a new one, so Me stays uncluttered for
most translators (the demo's ADR-029 shows it only to people in more than
one). The list is read once per run and shared
(`account/useOrganizations.ts`), so the row does not jump between Me and
More settings.

Amended (2026-10-14, Caleb Koster): every part explains itself. Caleb asked
for help on every element that should have it, with the principle behind it
applied across the app. What deserves help:
1. Everything a person can tap, type in, switch or drag is a part: while help
   is on it lights, takes a number, and explains itself instead of acting.
   Before, about 90 controls outside the kit still acted, as did the kit's
   tappable cards, sections that open in place, Show more, fields, switches,
   Back and the tabs, so a tap in help mode could leave the screen or open the
   keyboard. Back now explains itself too: the ? is the one way out of help.
2. A part says what tapping it does, not only its name. Buttons, chips,
   tappable cards and rows whose label is one word or a name carry a line
   (`help` on the kit's controls; a Row's `sub` unless `help` is given).
3. A mark that means something without words (the sync dot and ring, a
   step's state marks, a bar or a bare count) explains itself (kit's
   `HelpInfo`), or the part it sits in says what it means.
Plain words that say what they are need nothing. Sheets have their own ?: on
a phone a sheet is a window of its own, so help draws inside it and lights
only its parts (`useHelpHost`), and help turns off when a sheet opens or
closes. `apps/mobile/test/helpParts.ts`, run by `helpMode.test.ts`, fails on a
control without its line; a `help-ignore:` comment marks the few that need
none (a sheet's backdrop, toasts, the crash screen, the update banner above
the help layer). The 883 English lines add 59 KB to what a first visit
downloads on the web, so its budget rose from 6.1 to 6.25 MB
(`apps/mobile/scripts/export-web.mjs`, 6.17 MB then).
Reverse if: people stop using help because the extra numbers crowd a screen
(then number only the parts in reach of the ? first), or a line per part
costs more to translate and record than field tests show it saves.

Amended (2026-10-16, Caleb Koster): one row speaks for a list. Caleb, with a
screenshot of the recording screen in help mode ("Holy help references
batman"): every row of the parts list had its own bubbles, 51 numbers on one
screen, and having them "on just one row would be sufficient". The crowding
the entry above warned of had come from lists, where every row repeats the
same parts. Now each row a list draws is a `HelpRow` (`helpBadge.tsx`) naming
its kind (`of`). While help is on, the first row of each kind in sight speaks
for the list (`helpContext.ts` `chooseRows`: a row wholly in sight before one
cut off at an edge, then top to bottom): its parts light and take numbers.
The other rows stay dim and unnumbered, and a tap on one of their parts still
explains it, lighting it with its tooltip, so nothing acts in help mode. The
row keeps speaking while it is on the screen; when a list that draws only
what shows scrolls it away, the next row in sight takes over. In a list in
a list (a guide's sections and their pictures), the first inner row in sight
speaks for its kind, whichever outer row holds it. Lists whose items
each do something different (tabs, filters, crumbs, a menu of actions) keep
a number on every item and say why with a `help-each:` comment.
`apps/mobile/test/helpParts.ts` fails on a list whose rows hold parts with
neither. The recording screen went from 51 numbers to 27.
Reverse if: people miss what a row does because the row that speaks for its
list is not the one they look at (then let the row last tapped speak), or
same-shaped rows turn out to need different explanations.

Amended (2026-10-16, Caleb Koster): one first-time motion, which Caleb asked
for: the first time a phone shows a list of parts, its top part slides right
to show its bin, then back. It has no words, covers nothing and opens no help
(decision 136).

Amended (2026-10-16, Caleb Koster): a ready language's page no longer
summarises the four questions as They record, What helps them, Checks and
People with the rest under More. It names each thing as the organization's
page does (Content template, Reference material, Review flow), with seven
rows and no More; see 138.

Amended (2026-10-21, Carl Sauder): a Global Viewer looking in on an
organization (decision 158) has an eye in every screen's header ("Global
Viewer" beside it on a wide window) that opens the Global Viewer screen:
the organization they are in, then every other one to open instead. It is
chrome, put in the header by the shell (`HeaderExtraContext`), and opens the
screen as the tabs open theirs, so `flow.ts` stays the authority for moving
between screens (decision 20). Their tabs are an admin's without Work and
the Inbox, where nothing ever arrives for them. Carl chose the header link
over a strip across every screen (it cost height and said nothing a header
could not) and over a tab of its own (on a wide window it sat beside a
sidebar line that did the same, and a phone had only the tab).

## 72. Apps, agents and review links take part through reviews and releases; outside reviews never clear a checkpoint

Date: 2026-10-08 · By: Ryder Wishart · Status: partly superseded by 79

Reason: supersedes 70's publishing and scopes. Partners want their own apps on LangQuest's data. Every
Language's listening app plays approved chapters and wants listeners'
reactions back; agents (Claude, ChatGPT, over MCP) want to read and
review; and a team wants to send a passage on WhatsApp to someone with no
account and get a review back (LAN-41; the partner calls of 2026-08-24,
09-22 and 10-06). Chosen:
- Tokens (`lqp_…`) belong to one person in one organization and are never
  more than that person: each request reads their privileges from the
  folded log today, then narrows by scope (`read:published`, `read`,
  `review`, `release`) and, if set, a list of languages. Only the hash is
  kept (`api_tokens`). They are made on `/connect`, a page the Worker
  serves, or asked for by an app with the OAuth device flow (RFC 8628): a
  person approves on `/connect?code=…`, may narrow but never widen, and the
  app's device code becomes its token, so no plaintext secret is stored.
- `/api/v1/*` is answered by the organization's Durable Object from the
  folds the reports use (decision 44), and the same operations are MCP
  tools at `/api/v1/mcp`. A `read:published` token sees only a passage's
  approved version, core `approvedVersion`: the newest version every step
  approved by reviews of that very version. `done` is looser (each kind's
  latest review of any version, and an answered "needs changes" counts), so
  a re-recorded passage stays done while its new audio is unheard.
- Everything written from outside is one of two events, appended with
  `append_events` as a person so the database checks their privileges:
  - `v1.ReviewRecorded` given by link. Through a token it is listener
    feedback (kind `listener`, in no flow, so it never clears or blocks a
    step) or a review of a kind in the language's flow, so a partner's
    sign-off is a flow step rather than a parallel approval.
  - `v1.VersionReleased {takeId, channel, live}`, new: where a version is
    live, a fact rather than a verdict (core `releasesOf`). Going live needs
    the approved version; anything may be taken down. It needs
    `assign_work`. This replaces 70's "ready for publication" mark, which
    was an approval kept outside the flow, and its `feedback` and
    `publish` scopes (migration `20261008140000` renames issued ones).
- Review links: whoever may send work to reviewers (`send_to_reviewers` or
  `assign_work`, configurable per role) and may record a review given by
  link shares `/r/<code>`, one version and one kind, open to many people
  until it expires (14 days by default) or is revoked (`review_links`, hash
  only). The page plays the version and takes any name (kept in the
  browser), looks good or needs changes, an optional comment, and voice
  clips said at a moment of the recording, up to ten, each kept as a
  review artifact with its own format (m4a, or WAV from browsers that
  cannot record MP4) and its moment (`atMs`). The page is one column with
  nothing else on it, and links the privacy policy, which now says what a
  review link and a connected app keep. The sharer chooses per link whether answers
  count toward the step or are listener feedback; whether a step may be
  reviewed by a counting link is the language's setting, new event
  `v1.FlowStepLinksSet` (default: any step but a checkpoint). A review given
  by link is recorded as the sharer, like a check logged from outside the
  app: `review` or `translate` may record it, and, like a logged check, it
  completes ordinary steps but never clears a checkpoint (passage.ts
  `clears`, which decision 29 had let link reviews clear; none existed yet).
  A browser's latest answer stands; a resend records once; a link takes 500
  answers, 10 per browser, and closes when its sharer can no longer record.
- Abuse: 600 writes an hour per token or link, per-address limits on the
  device endpoints and links, voice notes must be new uploads, MCP batches
  hold at most 20.
Moments on clips: `Card` gains an optional `atMs` (core and SQL
`_is_cards`). That adds a field to a shipped event's payload
(`v1.ReviewRecorded.artifacts`, and `v1.RecordingAdded.cards`, which share
the type), which AGENTS.md says never to do. It is additive and optional:
older validators and reducers accept and keep it, and older apps simply
play the clip without its moment. A versioned `v2.ReviewRecorded` would
have meant a second review shape in every reader for one optional number;
notes per clip (`v1.NoteAdded`) would have lost the reviewer's name and
split one answer across events.
Rejected: OAuth with redirects (more than a partner's backend or a pasted
MCP config needs today); service accounts (every write needs an author in
the privilege model); a guest `v1.RequestMade` per link (a guest needs a
WhatsApp or SMS contact, and a group link has none); a separate API Worker
(it would refold what the Durable Object already holds).
Reverse if: partners need each of their users to act as themselves (then
OAuth authorization codes), shared links attract abuse that names and
browser ids cannot contain (then one-person links with a contact), or Worker
CPU from folds per request shows up in cost.

Amended (2026-10-09, Carl Sauder): a link closes for listening, not only
for answering, once its sharer can no longer record; whoever assigns work in
the language may revoke anyone's link; a link made with a token closes with
it, and a person may have 200 open in an organization. Voice notes take
their own budget, 100 an hour per token or link. A review given by link
counts toward a step only while the step takes links, read in the fold, so
turning links off also stops links and tokens already out (75).

Amended (2026-10-13, Carl Sauder): an answered "needs changes" no longer
counts toward `done` (96).

## 73. Languages and regions are LangQuest v2's reference tables, filled from Glottolog itself and kept outside the event log

Date: 2026-10-08 · By: Caleb Koster · Status: partly superseded by 78

Reason: the app had no list of languages. A new language took whatever code
an admin typed (`addLanguage`, "din"), while `import:v2` carried v2's
languoid UUIDs. v2 already has a carefully normalized model, which Caleb
designed: languoids in a tree; aliases written in a label languoid and typed
endonym or exonym (so a language's name can be shown in the reader's app
language); sources (glottocode, ISO 639-3, Wikidata, WALS, …); open
properties; regions with their own aliases and sources; and languoid–region
links with majority, official and native. That model is what lets LangQuest
map the world's languages and their regions from what people enter. So this
app takes v2's nine tables with the same columns and constraints, and fills
them from Glottolog's own release files (one `md.ini` per languoid, plus its
CLDF category and macroareas), shaped as v2's loader shaped them, rather
than copying v2's rows (Caleb, 2026-10-08): `npm run languoids -- explore /
preview / apply` (`scripts/languoids.ts`, `scripts/glottolog.ts`). A
languoid v2 also had keeps v2's id, matched by ISO code or by its names, so
imported v2 projects point at the same language; languoids v2 users made
are not brought over (Caleb, 2026-10-05). Ids are UUIDs because languages
collected in the field may not be in Glottolog yet. Departures from v2:
`download_profiles` is dropped (PowerSync's sync list; nothing syncs these
tables here), `ui_ready` is dropped (v2's interface languages; this app's
will come from published localizations), and the glottocode, which v2
never kept, is a `languoid_source` row so each release merges into the rows
the last one made: added, renamed, moved, or made inactive, never deleted.
The tables are reference data, not events and not in any stream: a language
in the app names its languoid's UUID in `LanguageAdded`, and phones keep no
copy; they search online, and offline a typed name is added unlinked and
linked later. This replaces the "languoid list in a static `catalog@N`
bundle" of `docs/flow-coverage-audit.md` 5.D. `docs/languoids.md` has the
details.
Reverse if: people often need to pick a language they have never searched
for while offline and cannot wait to link it; then phones keep a compact
copy of the names (about 2.7 MB gzipped), and the tables stay the source.

Amended (2026-10-09, Caleb Koster): the language explorer is part of the web app only, at `/languages`, reading `/api/languoids` (the Worker caches `languoid_explorer()` for an hour); the phone app does not show it. Names tagged with an umbrella ISO code take its main language as their label (nine codes, checked by Caleb), names of six words or more are `alias_type = 'description'`, retired ISO entries keep ISO's reason and their replacements as properties, and Glottolog's macroareas are `region.level = 'macroarea'`.

## 74. A Bible template breaks up each book its own way, or not yet, and a change goes to the languages chosen

Date: 2026-10-09 · By: Caleb Koster · Status: partly superseded by 80

Reason: an admin should first say what a language translates (the Bible or
something else), then, if they want, how the Bible is broken up, and a book
has to be broken up before anyone records it (Caleb, 2026-10-09). The ways
are by chapter, FIA's passages, unfoldingWord's chunks and OpenBible.info's
sections where at least 15, 10 or 5 of 20 English Bibles start one; FIA's
way includes FIA's study guides' requirement for how things are divided,
and FIA covers 46 books, not all 66. A `template@1` divides every book one
way, and in its passage form a book with no passages is not listed at all.
So a new document format, `template@2` (`libraryDocs.ts`): each book says
how it is broken up (`divide: chapters | passages`, the part's name, the
passages) or nothing yet, and a book with nothing in it is listed and
waits (`Indexes.waiting`); nobody records in it. Unit ids are
`template@1`'s, so a language moves between the two, and between ways that
agree on a piece, without losing anything; `asTemplateV2` carries a
`template@1` over unchanged. A new format rather than new fields on
`template@1`, because an older app would read such a document with its
one `divide` and hide every part it did not expect; an older app refuses a
format it does not know. The ways are LangQuest library items
(`langquest.bible.*`, `scripts/library-seed.ts` from `library/fia/pericopes.tsv`,
`library/divisions/`), plus "Book by book" with every book waiting; the
existing `langquest.template.*` items are unchanged, because a new version
of them would move the parts of every language that follows them.
Templates stay shared between languages (Caleb, 2026-10-09). What a book is
called in a language is its own register, `v1.BookNameSet` (language
stream, `manage_templates`), read wherever a book's name shows
(`unitTitle`, `unitPlace`). Breaking up a book, or changing one, asks which
of the languages using the template it goes to (`library_template_users`
says which languages use what, since a phone pulls only the languages it
opens), offering only those the person may change: all of them, and it is
the template's next version; some, and the chosen ones move to a copy split
off for them (`v1.LibraryItemDefined` with `copiedFrom`, then the version
they had, then the change), keeping their unit prefix (`TemplateSelected`
`unitPrefix`), so the pieces that did not change keep their recordings.
Offline, who else uses it is unknown, so the change is always a copy.
Changing a book that is already broken up warns first that every recording
and review on its old pieces, including ones on phones that have not
synced, will stop showing and need to be redone; they are hidden, not
deleted (TPL-7). Only `manage_templates` (coordinators and admins) breaks
books up. A guide set says which method it follows (`collection@1`
`pattern`) and a template which one it was made for (`goesWith`), so FIA's
guides say they go with FIA's passages; any later guide set links the same
way. Verse numbers are not asked: a language's numbering is its Bibles',
English when it has none, and when its Bibles disagree the team sees one
verse that shows how (`verseNumbering`), which it may put away.
Reverse if: teams need to break up one book differently from every other
language using the same template, often enough that copies pile up; then a
language keeps its own overrides on top of a shared template instead.


Amended (2026-10-09, Caleb Koster): decision 80 puts the numbering first, for the whole Bible, and replaces the warning that recordings on old pieces "will no longer show": expired sections that overlap current ones stay reachable under "Earlier sections".

Amended (2026-10-12, Caleb Koster): decision 93 drops the choice of what the books a way leaves out get when the template is made (they wait, and are divided from the map), adds dividing a book your own way, and has naming a book offer what the language's Bibles and the organization's other languages call it.
## 75. Nobody is added without joining, nobody grants more than they hold, and one id names one event

Date: 2026-10-09 · By: Carl Sauder · Status: accepted

Reason: a security audit of who may post and read events (2026-10-09) found
that the write path trusted too much of what a phone sends. Anyone who
signed up could make an organization, add any profile id to it, and then,
being an Invite holder who shares an organization with them, issue that
person a sign-in code: a takeover of any looked-after account whose id they
had seen. A Coordinator, who holds Invite but not Manage roles, could make
themselves Owner or remove the Owner. Event ids are chosen by phones and
the server's own are predictable (`removed:<event>`,
`accountdeleted:<person>:<scope>`, `invitemember:<invite>`, the v2
import's), and an id already in the log made the server skip its own
event, so a content author could make a moderator's removal do nothing. A
second `v1.TakeComposed` with a take's id replaced its audio under the
reviews it had, and a backdated clock let a member replace someone else's
review, note or request. Carl chose that the grantor may only grant scopes
and roles they currently hold. Migration
`20261009130000_event_integrity_and_grants.sql`:
- A person's `v1.MemberAdded` may name only themselves or someone who has
  held a membership in that organization; newcomers come in by invite or
  join request, whose memberships the server appends. Sign-in help reads
  only memberships the person joined themselves (`_joined_by_consent`) and
  needs the helper to cover all of them (59).
- `_grant_refusal`: a role given, invited to or admitted to carries no
  privilege the grantor lacks at that scope; a role changed or removed, or
  defined or retired, is one they could have granted. An invite redeems
  only while its issuer could still issue it. Core `mayGrantRole` and
  `mayChangeMembership` say the same, and the role pickers offer only
  those roles.
- An event id names one event: a resend is a duplicate, the same id on
  anything else is refused (`event id already used`), and the server's id
  prefixes are refused from people (`_server_event_id`).
- One create, one entity: a recording, take, response, review, departure,
  request, note, key-term rendering or adjustment id is used by one event in
  its stream (`_entity_key`, core `entityKeyOf`, held together by the
  parity script). The fold keeps the earliest of each in every order, so
  logs that already hold a duplicate fold the same everywhere (reducer
  version 12). The translation guide's material and key terms keep sharing
  ids by design, as do units (two phones applying one template) and a
  take's link to a key term; for those the fold keeps the earliest too, a
  tie settled by author and content, instead of whichever arrived first.
  Submissions, materials, invites and join decisions settle a same-clock
  tie the same way (`ties.ts`).
- A redaction is never redacted (16, amended).
- An organization is bootstrapped only while nobody else has written to it,
  so ids the library seed or an import used cannot be claimed, and the v2
  import refuses an organization someone else created (`--existing-org`).
- Review links and tokens: 72, amended.
The service role (imports, seeds, the Worker) still writes as the actor it
names, as 64 said; these checks are for people. A translator may still log
a check from outside the app (29), which completes ordinary steps; that is
the design, not a gap. SQL tests: `server/grantsSmoke.sql`, and the
takeover in `server/joinSmoke.sql`.
Reverse if: teams need to place people they have not invited (then a
consent step on the person's side, not a direct add), or a partner's
custom roles need someone to grant more than they hold (then a privilege
that says so, held by owners only).

Amended (2026-10-09, Carl Sauder): the audit's low findings that were cheap
to close (migration `20261009140000_audit_low_findings.sql`). `may_emit` is
service-role only, like `org_privileges`, since it answers for any profile.
Writing a file needs more than reading its stream (`blob_access`): a
language's files are written by whoever holds more than View there, once it
is listed; the organization's guide files by whoever manages its library;
a person's stream by nobody, so no upload makes a stream nobody listed. The
language tables hide `creator_id` from everyone but the service role. In
the Worker, a voice note must be stored no more than six hours before it is
attached, since a redaction drops the event but not the file, so a hash
seen before a removal cannot bring the audio back; a closed review link
answers only that it closed; and files are served with `nosniff`.

Amended (2026-10-13, Carl Sauder): the app now offers a write only where
the server will take it. Library events go in the organization's stream,
so they need the privilege at organization scope (`languageOfOrgEvent`,
`may_emit`). A language lead's role in one language does not cover them,
but the screens asked `session.can`, which counts it. So the screens
offered template edits and updates, breaking up a book, new or followed
flows, guides, library material and "Add a Bible", and the server then
refused them, some after a success toast. Those controls are now hidden
from anyone without the privilege at organization scope (`mayWriteLibrary`
in `library/model.ts`, `lib.canWrite`). Choosing one of the organization's
own templates or flows for the language, its own checks, and recommending
or hiding a Bible are the language's own events, and stay available to the
lead. The UI test suite holds this (SETUP-061 to 066, MAP-023).

Amended (2026-10-13, Carl Sauder): nobody may leave the organization
without someone who can manage roles (98).

Amended (2026-10-15, Carl Sauder): a resend is a duplicate even while the
first push is still being inserted. A push that timed out on a weak link
is retried with the first still in flight (the client no longer overlaps
its own pushes, `SyncClient.exclusive`, but a lost response still races on
the server). `append_events` checked the id before it took the stream's
lock, so the retry passed that check, waited on the lock, and found the
entity id taken: it refused the event, and the phone folded out work the
server holds; an event with no entity id failed the whole batch on the
primary key. Every event now takes its stream's lock once it is authorized
and valid (`_next_seq` took it anyway, so nothing waits longer) and checks
the id again under it, answering a stored event of the same organization,
stream, actor and type as `duplicate` with its seq. The lock comes after
authorization so nobody makes or holds a stream they may not write. The
same id pushed to two different streams at once still fails one batch on
the primary key; the retry is then refused (`event id already used`), as
it should be. Migration `20261015180000_append_duplicate_under_lock.sql`;
SQL test `server/concurrentAppendSmoke.sql`, two sessions over dblink.

Amended (2026-10-15, Carl Sauder): the server's own events race the same
way. `_append_event_as` (blob verdicts, invites redeemed, join decisions,
redactions, account deletions, library pins) checked the id before
`_next_seq` locked the stream, so two Worker or projection passes
appending the same id at once failed the second on the primary key and
aborted its caller's transaction. It now takes the stream's lock and
checks the id again under it, returning null as it says it does.
Migration `20261015190000_append_event_as_under_lock.sql`; cases 4 and 5
of `server/concurrentAppendSmoke.sql` (`record_blob` twice at once).

## 76. Names identify nothing: a repeated language is warned about, and an organization can be renamed

Date: 2026-10-09 · By: Carl Sauder · Status: accepted

Reason: organizations and languages are identified by ids made on the
phone (`org-<uuid>` in `createOrg.ts`, `L-<code>-<random>` in
`newLanguageId`), so they can be created offline without asking anyone,
and nothing on the phone or the server refuses a name already in use. Two
people offline can start two organizations with one name, and two admins
can add one language twice to the same organization; each stands, since
no server check on names can reach a phone that is offline. Names stay
labels, and two answers are added instead of a uniqueness rule. Adding a
language warns when the organization already lists one with the same code,
or the same name once case, accents, spaces and punctuation are set aside
(`similarLanguages` in `orgAdmin.ts`, shown on the first step of New
language). It only warns: the admin may still go on. It sees the
languages this phone has synced, so a repeat added on another phone while
both were offline still lands. An organization can be renamed with
`v1.OrgRenamed { name }`, which writes the same name register as
`v1.OrgCreated`, as `MemberAdded` and `MemberRemoved` share `removed`: the
later clock wins, then the higher id. A rename is always stamped after the
creation its phone saw. Only an Organization Admin may rename
(`manage_roles`, as for the license), since the name is how everyone,
Request Access included, tells the organization apart. Every server
reader of the name reads that register (`org_name`, `library_shared_items`,
`diag.find`; migration `20261009160000_org_renamed.sql`). A library
subscription keeps the source's name as it was when subscribed
(`sourceOrgName`). A language is renamed from its page (More, Name)
with the `v1.LanguageRenamed` it always had, by whoever manages its
structure there or for the whole organization (`mayRenameLanguage`), so a
language admin may rename their own; the sheet warns when another
language already has the name. Not built: a way to merge or retire a repeated
language, a check after sync for repeats that landed offline, and a way
to tell same-named organizations apart in Request Access beyond their
listed languages.
Reverse if: repeated languages keep landing despite the warning; then
check for repeats after sync and give admins a way to retire one.

## 77. A voice note's format goes in the log when it is not m4a

Date: 2026-10-09 · By: Ryder Wishart · Status: accepted

Reason: a voice note is named only by the event that uses it (30), and none
of those events has a format field, so core called every voice note m4a.
A browser that cannot record MP4 (Chrome, Firefox) stores its take as WAV
(58), at `<hash>.wav`. Review comments, directions, reasons, notes and
responses recorded there were then looked for as `<hash>.m4a`: the browser
could not read its own file to upload it or play it back, and no other
device or the agent API (70) could fetch it. What changed:
- `v1.AudioFormatSet { hash, format }` says a voice note's format, once per
  hash: the earliest stands and the server refuses a second (75), so nobody
  re-labels someone else's note. The app appends it ahead of the event
  that names the note, in the same batch, when the file on this device is
  not m4a and the log does not say so yet (`useLanguage.ts`, core `audioFormatsFor`). The
  device that has the file is the one that knows its format; `BlobStore`
  keeps each file's extension (`formatOf`).
- Core `referencedBlobs` reads it for every voice-note field
  (`voiceNoteOf` lists them), so uploads, downloads, playback and read
  links use the real name. Without the event a voice note is m4a, as
  phones record it, so nothing already in the log changes meaning.
- Whoever may append an event that names a voice note may append this one.
  `REDUCER_VERSION` is 13 for the new state field.
Rejected: v2 of the seven events that carry a voice note (seven new shapes
for one missing field); converting a browser's take to AAC (no encoder in
Firefox, and a muxer to ship); recording at `<hash>.m4a` whatever the bytes
(58: a phone's player trusts the label); probing the server for either
extension (a round trip per file, and nothing for the uploader).
Reverse if: every supported browser records MP4 (then web voice notes are
m4a and the event is no longer appended), or voice notes get an event of
their own that carries the card, as recordings do.

## 78. A language links to the language list with LanguageCodeSet, and is unlinked until then

Date: 2026-10-09 · By: Caleb Koster · Status: accepted

Reason: partly supersedes 73, which said a language names its languoid's
UUID in `LanguageAdded`. Its `code` is what people and the app read: the
language page and the map show it, reports carry it, and the warning about
a repeated language compares it. A UUID there would show as a code, and
`LanguageAdded`'s shape cannot change. So a new register in the
organization stream, `v1.LanguageCodeSet { languageId, code, languoidId }`,
says which language in the world it is: `languoidId` is a languoid's UUID,
or null, and `code` takes over `LanguageAdded`'s (the languoid's ISO 639-3
code, else its glottocode). The later clock wins, then the higher id. With
no `LanguageCodeSet` a language is unlinked. Adding a language searches the
language list as its name is typed (`search_languoids`, online only, as 73
has it); picking one adds the language with that code and links it in the
same step (`addLanguage`'s `link`). Offline, or when nothing fits, the typed
name and code are added unlinked, and the language's page links it later
(More, In the language list). Whoever may rename the language may link it
(`manage_structure` there or for the organization, `mayRenameLanguage`).
The server keeps the link on `languages` (`code_set`, `languoid_id`, read
through `language_code()`), with no foreign key, since a language may name a
languoid this database does not have yet (migration
`20261009200000_language_code_set.sql`). Linking later changes the code and
the link only: the work belongs to the language, so nothing moves. This
settles the open point in `docs/streams-and-languages.md` on whether a
language's code can change. Caleb agreed to the picker, unlinked languages
and `LanguageCodeSet` (2026-10-09). Not built: sending a missing language to
us as a request, and moving v2 imports, which still put v2's languoid UUID
in `LanguageAdded`'s code, to `LanguageCodeSet`.
Reverse if: a language needs to be in more than one languoid (a project
covering two dialects, say); then the link becomes a set rather than a
register.

Amended (2026-10-12, Caleb Koster): moving v2 imports to `LanguageCodeSet`
is done (decision 94): an imported language's `LanguageAdded` carries the
readable code decided on the import's board, and `LanguageCodeSet` links it.

## 79. Third-party apps keep their own values with a language, as external values LangQuest never acts on

Date: 2026-10-09 · By: Carl Sauder · Status: accepted

Reason: partly supersedes 72, which said everything written from outside
is one of two events. Partners' apps want to keep data of their own with a
language's work, clearly marked as coming from outside LangQuest; Every
Language's listening app is the example (play counts, playlists). Carl
chose a key-value store per language, named so an API user can tell the
values are external to LangQuest (`docs/agent-api.md`). Chosen:
- `PUT`, `GET` and `DELETE /api/v1/languages/{languageId}/external-values/{key}`
  and a list (`keyPrefix`, `changedSince`, `after`) on the access-token API
  (70), and the MCP tools `set_external_value` and `get_external_values`.
  The body is `{ data }`, a JSON object of at most 4 KB, checked by the
  Worker, which is the only writer.
- Each write is `v1.ExternalValueSet { key, data }` in the language stream:
  a register per key, the later clock then the higher id, and `data: null`
  a deleted key. The Worker stamps a write after the value it replaces, so
  two in one millisecond keep their order. Nothing in LangQuest reads it: no
  status, step, report or screen. `REDUCER_VERSION` is 14.
- Only the Worker appends it. `append_events` refuses it from people and
  takes it from the service role only for a device `api-<token id>` that
  is a live token of the author's, with the new `external_values` scope,
  reaching the language (`_external_values_token`, migration
  `20261009220000_external_values.sql`, `server/externalValuesSmoke.sql`).
  The author must translate, review or fill reference material there.
  Reading needs `read` or `external_values`, and each value says which
  token, app and person wrote it.
- One shared store per language: apps keep apart by starting keys with
  their own reverse-domain name. Every token belongs to a member the
  organization trusts, nothing acts on the values, and every member's
  phone downloads the stream anyway, so namespaces per app would hide
  nothing from the people who can see it.
- Nothing points into LangQuest: no passage field. An app that ties a value
  to a passage puts the unit id in the key. Showing values on a passage
  later would need a field added to a shipped event (as 72's `atMs` was)
  or a `v2`. No files yet either.
- Keys are segments of letters, digits and `. _ ~ : @ + -` joined by `/`,
  at most 256 characters, none empty, `.` or `..`, so a key reads back
  unchanged as a URL path (core `externalKeyError`, SQL `validate_payload`).
Rejected: an opaque subject or a namespace per app (key prefixes do the
same with nothing to check); an idempotency key from the caller (the
newest write wins, so a retry reads the same); a sibling stream phones do
not pull (more to build before anyone has seen the cost); `/values` as the
path (it reads as LangQuest's own settings for the language).
Reverse if: external values grow past a set share of a language's events or
slow its downloads (then a sibling stream phones do not pull), partners
that do not trust each other share a language (then a namespace per app),
or values start to drive anything in LangQuest.

## 80. A language's numbering is chosen first, for the whole Bible, and ways of dividing are converted into it

Date: 2026-10-09 · By: Caleb Koster · Status: accepted

Reason: how a book is divided depends on its numbering. "By chapter" has
no meaning until the chapters are known: English Malachi has 4, Hebrew-
numbered Malachi 3. And the numbering decides which books exist. So when a
language translates the Bible, its numbering is chosen first, for the whole
Bible (by its Bible, by name, or with the quiz), and only then are books
divided, all at once or one by one (Caleb, 2026-10-09). A numbering offered
to admins is a source versification with exactly one tradition's books.
FIA, unfoldingWord and OpenBible divide the text, not the numbers, so their
English-numbered sections are converted into the language's numbering, with
four rules: uncovered verses inside a chapter are a section of their own
(Psalm headings included); uncovered verses inside a section split it
(Catholic Daniel 3:19–23, 3:24–90, 3:91–97); a verse two sections want goes
to the earlier one (Douay Judges 21:24); uncovered whole chapters are a
section each (Catholic Daniel 13 and 14). Books a way does not cover wait
for the admin. When divisions change (a way's new version, an admin
dividing a book again, a new numbering), sections expire but are not
deleted: a current section that overlaps an expired one with recordings
shows a warning mark and lists it under "Earlier sections", closed by
default (Caleb, 2026-10-09); this replaces decision 74's "will no longer
show" for an admin's own change. `docs/breaking-up-the-bible.md`
holds the rules with examples. Decision 74 stays as built; this extends it.
The source files are rebuilt first, because their JSON copies lost every
second line of a verse that matches two (96 lines). Five numberings are
offered (English, Hebrew, Vulgate 73 books, Russian Synodal 66 and 77);
every way is published once in each, converted by the seed. A language's
numbering is its template's versification, so no new event is needed; a
language's state keeps every template version it used, to read an expired
section in the numbering it was made in. Changing numbering keeps the
work on sections whose verses stay the same: a converted way marks the
parts whose verses differ from the same numbers in English, and only
those get new ids (`2CO.13~org`). The Septuagint numbering and Catholic
Bibles numbered like the Hebrew are not offered yet.
Reverse if: teams need one section made of two separate ranges (Daniel
3:19–23 with 3:91–97) often enough; then a section holds a list of ranges,
and every reader of a section's verses learns to read one.

## 81. The app's words come from catalogs in the app, in the language chosen on the device or the phone's; English is the source

Date: 2026-10-09 · By: Caleb Koster · Status: accepted

Reason: field teams who do not read English could not use the app (LAN-42);
every word was written into the screens. Chosen (`docs/localization.md`):
- `i18next` and `react-i18next`, with one JSON catalog per language in
  `apps/mobile/src/i18n/` and English the source. Fifteen languages: LAN-42's
  thirteen (`en`, `es`, `pt` in Brazilian wording, `fr`, `ar`, `sw`, `ha`,
  `am`, `hi`, `bn`, `ne`, `id`, `zh-Hans`) and Thai and Burmese from
  LangQuest v2's list. Dates and numbers through `Intl`; plurals by each
  language's own rules (`src/i18n/plurals.ts` stands in where the engine has
  no `Intl.PluralRules`).
- The language is a setting of the device, not an event: Me → Language (and
  a globe on the sign-in screen) keeps it in expo-sqlite's key-value store,
  read before the first screen draws, or the browser's localStorage. Nothing
  to sync and no migration; people sharing a phone share it. Without a
  choice the phone's language is followed (`expo-localization`) for any
  catalog approved for release (`approved` in `src/i18n/languages.ts`). The
  fourteen first catalogs are machine translations Caleb approved as they
  are: the teams who read them are the reviewers there are, and they can
  only say what reads wrong once the app speaks their language. A language
  added later may stay a draft until approved: anyone may pick it, it says
  it is a draft, and the phone's language never switches to it.
- Arabic lays the app out right to left; on a phone the app restarts once to
  change direction (`src/i18n/start.ts`).
- "No hard-coded words" is a test, run by `npm test` and before a push:
  `apps/mobile/test/i18n.test.ts` fails on a word written into the code
  where a person would see it, a key used but missing or defined but unused,
  and a catalog that lacks keys, adds keys, has the wrong plural forms or
  drops a placeholder. `t()` keys are typed, so a wrong key fails the
  typecheck.
- `packages/core` stays English and pure; `src/coreText.ts` says its words
  (review states, shipped kinds unless renamed, a passage's state, command
  errors, licenses, book names). Library documents (36), names people typed,
  and words stored in the event log are shown as written.
- Emails go in the sender's app language: the invite now (the phone sends its
  language; `apps/invite-email/src/i18n/`), and the password reset email's
  words are ready for Forgot password.
- Help mode speaks recorded lines per language: files named by a hash of the
  language and the words, listed and served by the Worker
  (`/api/help-audio`, `npm run help-audio`), kept on the phone once heard.
  A line nobody has recorded shows as words, read aloud on the web.
This departs from `docs/languoids.md`'s proposal that interface translations
be library items an organization publishes: bundled catalogs work offline
from the first launch and need no server; a published localization could
later sit over them. Push notifications' words are still written in English
by the database (the Inbox shows its own words by kind).
Reverse if: translators need to change words between app releases (then the
library localization), or people want their language to follow them to
other devices (then an event in the person stream).

## 82. A recorded part keeps how it relates to its neighbours, and its verse numbers are worked out down the list

Date: 2026-10-09 · By: Caleb Koster · Status: accepted

Reason: The recorder groups parts into cards by verse (demo ADR-036,
SIMPLE-7), which needs verse labels on parts. Caleb asked for labelling
simple enough to need no reading: an empty space on the left of each part
that, when tapped, infers the right verse from the parts above and below,
and a long press for a chosen verse or range. Rules: labels come from the
passage's verses (the template's range in its versification), go up the
list, never overlap, may be one verse or a range, several parts may share
one verse, and verses may be skipped for later. What was chosen:
- A part stores a mark, not a number: `next` (the verse after the label
  above), `join` (the same verses as the part right above), `set` (verses
  chosen, as `chapter:verse` from and to) or `none`. Core `verses.ts`
  derives the numbers down a take's cards, so labelling a part higher up
  renumbers the ones after it and the order cannot break; `tapPart`
  picks the first legal change (next, else join the verse above), and a
  chosen verse wins over the parts after it that no longer fit, which lose
  their mark (`settlePartMarks`).
- One new event, `v1.CardVerseSet { unitId, hash, mark, from?, to? }`, a
  register per (unit, card hash) in the language stream (privilege
  translate; migration `20261010010000_card_verse_set.sql`). Keyed by card,
  not take: every list change composes a new draft take, and a card keeps
  its mark through them and into the version it is published in.
- The workspace (`simple/verseParts.tsx`): tap a space to give the part a
  verse, tap a number to join the part above and again to split it out,
  hold for the verse grid with Auto, None and Delete (each tap applies at
  once), slide down the spaces to number many parts, and a gap left for
  later has Record here, which records into its place as the next verse.
  A unit with no verses keeps the one card of numbered parts.
Rejected: storing numbers on parts (moving or labelling one would leave
the rest out of order); labels on the take (each draft change makes a new
take, so marks would have to be copied forward); separate events for
joins and choices (one register per card is simpler to merge).
Reverse if: the same recording needs different verses in different
versions (then marks belong on the take), or teams want labels from the
audio itself (alignment) rather than taps.

Amended (2026-10-10, Caleb Koster): no grouping by verse for now. The
recorder keeps its one card of parts as before, and each part has its verse
space; a part with the same verse as the part above shows that verse hollow
and grey instead of joining a card; a part's own verse is a soft grey tile
with a dark number, so the labels stay quiet beside the parts. The marks, the event and the tap rules are
unchanged.

Amended (2026-10-14, Caleb Koster): a published version shows its verses
too. Caleb found a version's page listing "Play Version 1 (2 takes)", "Take
1", "Take 2" as three rows that looked the same, with no verses. A take
suggests another try at the same audio; these are pieces that together make
the recording. So a version's page (`passage/versionParts.tsx`) plays the
whole version in the clip player, then lists its parts read only, "Part 1",
"Part 2", each with its verse tile as the recorder draws it (`VerseTile`,
hollow for more of the verse above, read by `readPartVerses`). Nowhere on
screen are parts called takes any more; the words "take" and "takes" for a
part are gone from all 15 catalogs (the demo's REC-W2 says takes; this
departs from it on Caleb's word). A part whose stored verses equal the part
above's reads as more of that verse even when both were chosen, and the
v2 import (decision 94) now records such a part as a join, as the recorder
would.

Verses are shown where they exist and never asked for (Caleb, 2026-10-14:
many teams are not required to number verses, and published work needs no
labelling). A part with no verse shows nothing where its tile would be, a
version with none shows no tile column, and no screen counts or flags
verses still missing. Where a version is shown, its verses show too when it
has them: the reviewer's Listen lists the parts under the player (only when
a part has a verse), each part of a back translation names its verse, and
the passage page and Versions page add "Verses 1–4" (first to last) to the
version's line.

## 83. A person may keep several drafts of a passage, each one the line of takes its changes made

Date: 2026-10-10 · By: Caleb Koster · Status: accepted

Reason: Caleb asked that people can make several versions of a passage and
save, delete, edit, publish and send each for review freely. Until now each
person had one draft per passage: every change composed a new take and
retired their previous draft, so starting over meant losing the last try.
What was chosen:
- No new event. A draft is the line of takes its changes composed
  (`v1.TakeComposed` with `parentTakeId`); the take it started with names
  it. Core `derivePassage` lists every open draft (`drafts`, anyone's, in
  the order started, each with its first take and the version it started
  from), and `keepTake`, `publishVersion` and `discardCards` take the take a
  change continues (`parentTakeId`): the draft open in the workspace (whose
  take is retired), a version to start from, or null for a draft started
  empty. Left out, they continue the person's latest draft as before.
- Deleting a draft is `deleteDraft` (`v1.TakeArchived`, only the person's
  own). Its Undo composes the same parts continuing the deleted take, so it
  is the same draft again.
- A published version never changes. Editing one starts a new draft from its
  parts; it publishes as a new version, as every change does (REC-W3).
- Screens: the passage record's "Versions and history" is now a page: the
  person's drafts (play, Edit, Publish, Delete with Undo), then the
  published versions (play, open, Edit, and on the latest, Ask for its next
  check), "New version" to start empty, then the study, reviews and history
  that used to open in place. Record opens the person's only draft, or the
  page when they keep several. The workspace opens one draft, says which
  ("Draft 2"), and has Save, which says the draft is kept (every change
  already is) and goes back. Publishing then asking for a check is
  unchanged (demo ADR-034).
- Verse marks (decision 82) stay on cards, so drafts that share parts share
  their marks. A mark relative to its neighbours (next, join) still reads
  right in each draft; a chosen verse is the same in all of them.
Rejected: a name per draft (a new event, and typed names suit oral teams
poorly; drafts are numbered in the order started instead); deleting a
published version (reviews and requests point at it; nothing removes one).
Open: a request for review names the passage, not a version, so asking for
a check always means the latest version. Sending an older version for review
would need a new event with the version in it.
Reverse if: teams need drafts others can pick up and change (then a draft
would need an owner other than whoever composed its takes).

Amended (2026-10-16, Caleb Koster): "deleting a published version" is no
longer rejected. Whoever published a version can delete it, as a tombstone
that keeps its number and its checks on the record (decision 124). Deleting a
draft now asks first instead of offering Undo.

Amended (2026-10-15, Caleb Koster): the workspace has no Save any more; a
saved mark in its header turns from a spinner to a check as each part is
kept, and Publish is Done, which asks for the next check in the same tap
(decision 127).

## 84. Reference material says the language it is in, and FIA is chosen with its language

Date: 2026-10-10 · By: Caleb Koster · Status: accepted

Reason: nobody chose the language of the FIA guides a team read. `bestGuide`
preferred English for every team because its one caller passed no language,
and a new language was offered English guides only because `sourceCode` on
`v1.LanguageAdded` is always `eng`. LangQuest publishes FIA as one
collection per language (fourteen of them), so admins saw look-alike rows
for each language. Notes, question sets and other material said nothing
about their language at all. Caleb chose (2026-10-10): turning FIA on asks
which language it should be in, defaulting to the admin's own (the app
language, decision 81), and every piece of reference material is tied to a
language that shows wherever someone chooses it. So:
- The language a team's reference material is in is a setting with a page
  of its own (Caleb, 2026-10-10: "give the language setting its own page
  (for reference material in general)"): step 4 of New language, and the
  first page of What will help them. It lists every language LangQuest or
  the organization has material in, each saying what is there (a guide
  set's passages, Bibles, other guides), and starts on the admin's app
  language when there is anything in it, else English
  (`apps/mobile/src/reference/ReferenceLanguagePage.tsx`). New language
  writes it as `sourceCode` on `v1.LanguageAdded`; changing it later is
  `v1.ReferenceLanguageSet { language }`, a register in the language's
  stream (Manage Reference). It decides what New language offers (a Bible
  and FIA in that language, nothing in a language with none), which
  language FIA follows when the team has FIA on, which Bibles are listed
  first, which other organizations' guides are shown, and which guide a
  passage prefers when several fit as well.
- Collections that follow one method from one organization (`pattern` and
  `language`, such as LangQuest's `langquest.fia.<code>`) form one guide set
  (`apps/mobile/src/reference/guideSets.ts`). What will help them shows the
  set as one row; tapping it opens a sheet listing each language with how
  many passages it covers, for a team that wants FIA in a language other
  than its own.
- Choosing a language writes the team's say in its own log with
  `v1.ReferenceSet`, so there is no new event. The chosen collection is
  recommended (followed from LangQuest first when needed), and the set's
  other collections in the library are hidden. A team has one language per
  set. Passages the chosen language does not cover show no guide rather than
  another language's: `chosenOnly` leaves a set's unchosen languages out of
  the library fallback of decision 62.
- `material@1` gains an optional `language` (ISO 639-3). The library
  material editor, the in-app material editor (when the material goes to
  the library) and the guide editor ask for it, starting with the writer's
  app language. The lists of Bibles, guides and notes, a passage's reference
  page, the library and the translator's Bible picker name each item's
  language, or say "Language not given". LangQuest's seeded question sets
  now say English; production gets that with the next hosted seed.
- Language names come from the catalogs (all fourteen of FIA's), else the
  platform's `Intl.DisplayNames`, else the code.
Toasts stay clear of a screen's buttons on phones too: they sit just above
its footer, show a bar counting down to their going, and have an X.
Reverse if: teams need two languages of one set at once (then the sheet
becomes a pick-many and `bestGuide` ranks the team's languages), or teams
want another language's guide where theirs has none (then `chosenOnly`
keeps the rest of the set as a fallback).

Amended (2026-10-19, Caleb Koster): a language's Bibles on the reference
language page are every Bible the team could add, not only the library's.
Caleb asked why English showed 5 Bibles and other languages 1 when Bible
Brain has more: the page counted only LangQuest's seeded sources. It now
adds Bible Brain's Bibles in that language that the library does not have
(`biblesFor`, each edition counted once; English 21, French 6, Portuguese
12). Wherever a language shows a Bible count from Bible Brain (Add a
Bible's chips, the translator's More Bibles), the count is the length of
the list that opens for it (`useBibleBrainBibles`), because Bible Brain's
language search counts Bibles our key cannot open (English 51, of which
20 open); its number is kept for order only.
Then (Caleb, 2026-10-19: "allow the user to type in the language, but have
a dropdown similar when selecting a language from the glottolog-based
languoid system ... only shows languages ... that have translations"):
Add a Bible, More Bibles and the reference language page's Another
language find a language by typing it, in the language list's own
dropdown (`LanguoidPicker`) narrowed to languages that have something to
pick (`useOfferedLanguageSearch`, `offeredLanguagesModel.ts`). What is on
offer comes from the data: every language Bible Brain has Bibles in
(`/api/bible/languages/all`, kept a day) and the languages the library's
material is in. A language is found by the world list's names and aliases
(Glottolog) and by its own names where a word starts; each says its code
and what it has ("FRA · 6 Bibles"), and one none of whose Bibles open is
dropped. Add a Bible opens on the team's language with its Bibles listed.
Then (Caleb, 2026-10-20: should flows and templates be linked to languages
"in the backend ... yes, absolutely"): `flow@1`, `template@1` and
`template@2` take the same optional `language` as `material@1`, in the
document (no new event). The flow and template editors ask "Written in"
(a new flow starts in the writer's app language). A language's Checks,
review flow page and Get ready's checks offer only flows in the team's
languages or saying none, and always the one in use (`useCheckChoices`).
The organization's Templates and Flows lists name each one's language.
Template choices in New language and Get ready are not narrowed: the
template is picked before the team's languages are asked (Caleb's setup
order). LangQuest's own flows and templates say no language until the
library seed gives them one.

## 85. The passage list pages, picks passages by id, and includes any part of one passage

Date: 2026-10-12 · By: Carl Sauder · Status: accepted

Reason: changes the list 70 shipped. Asking an agent for the review status
of a language's 23 passages in review took 24 calls (the list, then each
passage), about 100 KB, mostly audio links the question did not need. The
list had no pages: Tyap's 1,584 passages were 560 KB. Carl chose one list
that can carry any part of a passage, with pages. Chosen:
- `GET …/languages/{languageId}/passages` (and MCP `list_passages`) returns
  `{ passages, nextAfter }`, as external values already page (79). It was a
  bare array; the API was five days old, so the partners using it are told
  rather than given a second shape. A page holds 100 passages, or `limit`
  up to 500. `after` is the last passage's `unitId`, in display order.
- `include` (`audio`, `reviews`, `steps`, `requests`, `versions`) adds those
  fields of one passage to each passage on the page, built by the same code
  as one passage (`passageOut` in `apps/web/worker/agent/view.ts`), and
  links are signed only for the page. `steps`, `requests` and `versions`
  need `read`, and are refused with `read:published` alone.
- `unitIds` picks passages; in REST it repeats, one id each, because a unit
  id may hold a comma. Ids that do not exist or are hidden from the token
  are left out, not refused.
- `GET …/passages/{unitId}` and `get_passage` stay as they shipped: one
  passage with everything the token may see.
- One parser (`parsePassageQuery`) holds the rules for REST and MCP.
Rejected: steps on every list entry (four to five times larger for callers
that never read them); separate `steps` and `audio` flags (two ways to say
what `include` says); a cap of 50 passages when audio is included instead
of pages; the cursor in a header (MCP has none) or an object only when
paging (a shape that depends on the request, and an unbounded default).
Reverse if: callers lose passages between pages because the order changes
under them (then a cursor on a snapshot), or a page with every include is
too large at 100 (then a smaller default).

## 86. The access-token API is described by an OpenAPI 3.1 document the tests hold it to

Date: 2026-10-12 · By: Carl Sauder · Status: accepted

Reason: the API (70) had a written guide, a list of routes at `GET /api/v1`
and MCP's argument schemas, but nothing a machine could read for the REST
routes, and the response shapes lived only in TypeScript types and prose.
Partners want to generate clients and check what they get; a description
nobody checks drifts. Carl chose an OpenAPI document tied to the code by
tests. Chosen:
- OpenAPI 3.1, written as a TypeScript object in
  `apps/web/worker/agent/openapi.ts` and served without a token at
  `GET /api/v1/openapi.json`. It uses the code's own constants (statuses,
  includes, scopes, kind states, page sizes and limits), so they cannot
  drift. `docs/agent-api.md` stays the guide; the document is the
  reference, and wins on details.
- It covers what apps and agents call. `/session/*` and `/links/*`, which
  only LangQuest's own pages call, with no CORS, are left out.
- Its object schemas are open, so a field added later does not break a
  generated client. The tests close them.
- `apps/web/test/agentApi.test.ts` passes every request it makes through
  `openapiCheck.ts`: the route must be in the document, the response must
  match the schema for its status with no unlisted field, and a request the
  API took must match the request schema. Every operation must be reached
  by some test, and the document must pass the OpenAPI Initiative's own
  schema (copied into `apps/web/test/oas31`). Ajv, a JSON Schema
  validator, is a development dependency of `apps/web` for this; it never
  ships in the Worker.
Rejected: a hand-written YAML file (nothing ties it to the code); types
generated from the document, or the document from the types (a build step
and a generator's opinions for one API of 19 operations); deriving MCP's
argument schemas from it (MCP takes arrays where REST repeats a query
parameter, so they would differ anyway).
Reverse if: the document is often updated only because the tests fail
rather than ahead of the change (then generate it from the types), or a
second API needs one (then a shared generator).

## 87. A phone stays signed in until someone signs out on it or the server ends the sign-in

Date: 2026-10-12 · By: Caleb Koster · Status: accepted

Reason: translators are offline for months and may get a signal for a
second before going offline again. Caleb asked (2026-10-12) that nothing
then signs them out or keeps them from their work. An audit found that
supabase-js reports no one whenever an expired access token (an hour old)
cannot be renewed, and the app took its word: a phone restarted offline
showed a blank screen for 25 seconds and then Sign In. Production's session
settings were already safe (no time-box, no inactivity timeout, no single
session per user; `server/README.md`). Chosen:
- The app starts from the sign-in saved on the phone (`authState.ts`,
  `App.tsx`): supabase-js deletes it only when the server has said no, or
  the person signed out, and says so with `SIGNED_OUT`, the only event that
  makes the person a guest.
- Renewing the sign-in (`sessionSafeFetch.ts`, the fetch of every Supabase
  client): a 429, a 408, a 5xx, or anything that is not Supabase Auth's own
  JSON error reaches supabase-js as a network failure, so it keeps the
  sign-in and tries again. Many phones on one connection, or a page from a
  hotspot or a proxy, no longer end a sign-in.
- While a sign-in waits to renew, a request that would go out with only the
  public key fails as a network failure. It is offline, never a refusal
  (`supabaseTransport.ts` reads it as `OfflineError`).
- supabase-js retries a failed renewal for about 25 seconds and every call
  needing the token waits; offline, a screen waiting on one call stayed
  blank that long. Right after a renewal failed for want of a network,
  `getSession` answers at once from the saved sign-in
  (`answerAtOnceWhileOffline`); supabase-js's own timer keeps renewing in
  the background.
- Signing out ends this device's session only (`signOutCore.ts`): `global`
  ended the person's sign-in on every device, and the hand-overs kept for
  them on shared phones. With an expired token it asks the server nothing,
  so it works offline at once. A browser forgets itself even when the
  server cannot be told (11).
- A phone whose notifications cannot be disconnected offline hands the
  disconnect to the courier (60) instead of refusing sign-out, as 12
  (amended 2026-09-28) says offline alone must not. Offline, the sign-out
  screen says signing back in will need a connection.
Tests `apps/mobile/test/offlineSignIn.test.ts` run supabase-js itself.
Still true: setting a password ends the person's other sessions (Supabase
Auth has no setting for it), and nobody can sign in on a phone that has
never held their sign-in without the server.
Reverse if: a phone keeps acting for an account the server has ended
(then end it on the first refusal of its requests), or Supabase Auth
starts answering a lasting refusal with a status this treats as passing.

Amended (2026-10-26, Caleb Koster): app start read the saved sign-in from
AsyncStorage, where it no longer is once 60 (amended 2026-10-15) moved it to
the Keychain and Keystore; from then on a phone opened offline an hour after
its last connection showed Sign In. It now reads it where supabase-js keeps
it (`savedSignIn`, test `apps/mobile/test/savedSignIn.test.ts`). On a phone,
signing out no longer ends the session on the server and the sign-out screen
no longer says signing back in needs a connection: the session is locked on
the phone instead (168). A browser keeps both as before.

## 88. A language's server snapshot is written after 200 new events or an hour, and the one before stays for 24 hours

Date: 2026-10-12 · By: Carl Sauder · Status: accepted

Reason: the projection pass wrote a new snapshot of every language that had
any new event, every five minutes, and `put_snapshot` deleted the one
before at once. A phone part-way through downloading a snapshot then found
its pieces gone, threw the download away and pulled the whole log; on a
slow link the next try went the same way. The fleet simulator measured it
(`docs/fleet-baselines.md`, `slowLink`): every joiner on a 2 KB/s link went
stale and took 14 to 29 minutes at 1,200 passages, 42 to 51 at 3,000.
Carl chose (2026-10-12, LAN-47):
- The pass still folds every changed language for the Inbox, but writes a
  new snapshot only after 200 new events or once the newest is an hour old
  and the stream has moved (`SNAPSHOT_SCHEDULE`, `shouldWriteSnapshot` in
  `packages/client/src/snapshotWorker.ts`). It writes at once when there is
  none, and when the new events hold a redaction, since a phone whose own
  checkpoint holds the target waits for a snapshot past the redaction
  (whether or not the server's snapshot held it; waiting up to an hour sent
  such phones back to the whole log after 30 minutes). A language
  that went quiet a few events past its snapshot is visited again once the
  hour is up (`snapshotDue`, `server/projectionWorker.ts`).
- A snapshot stays downloadable until the one after it has been out for 24
  hours (`put_snapshot`, migration `20261012120000_snapshot_retention.sql`).
  That covers a 13 MB download at 2 KB/s, about two hours, with a wide
  margin, and a phone that loses its signal and resumes later that day.
A cold start now pulls up to 200 events, or an hour's, after the snapshot.
A busy language keeps up to about 25 snapshots, a quiet one one or two.
Reverse if: snapshot storage grows past what the database plan allows
(then shorten the retention, or keep pieces in object storage), or cold
starts spend more time on the tail than they saved.

Amended (2026-10-20, Carl Sauder): `put_snapshot` also moves in the
snapshot's rows cut by passage (147), which only the newest snapshot keeps,
and the pass writes every passage's line each time it folds a language,
whether or not a snapshot is due. Retention is unchanged; a snapshot's rows
go with it.

## 89. A snapshot's pieces are cut once, when it is written, and kept in their own table

Date: 2026-10-12 · By: Carl Sauder · Status: accepted

Reason: `get_snapshot_chunk` serialized the whole snapshot (`state::text`)
to return each 256 KB piece (18), and `get_snapshot_meta` did it twice to
say how big it was. `npm run bench:server` measured 60 to 80 ms of database
time per piece for a 14 MB snapshot of 55 pieces: about 4 s for each cold
start and each worker read (performance-audit.md item 4). Carl chose
(2026-10-12, LAN-47) to keep the pieces in Postgres rather than R2: the
same RPCs, the same authorization, nothing new to run. `put_snapshot`
serializes the state once, cuts it by bytes into pieces of at most 256 KB
that never split a character, and stores them in `snapshot_chunks`, with
the snapshot's size and piece count on its row (migration
`20261012130000_snapshot_chunks.sql`). Pieces go with their snapshot (a
cascading key), so 88's retention holds for them. A snapshot written
before has no pieces and is read as before until it ages out. Reads now
take under a millisecond; a write takes about 0.3 s instead of 0.1 s, and
88 writes at most one an hour per language. The pieces double a
snapshot's storage beside its `state`, which `get_snapshot` and the
diagnostics (`diag.language_health`) still read.
Reverse if: snapshot storage outgrows the database plan (then the pieces
move to object storage behind the Worker, or `state` stops being kept), or
a snapshot write has to be faster than that.

Amended (2026-10-20, Carl Sauder): `state` is no longer written (147):
the pieces serve builds from before the cut and the Worker, and a cut by
passage (`snapshot_units`) serves phones; `get_snapshot` puts the state
together from the pieces, and the diagnostics read the size from the row.

## 90. A phone wakes sync when its network comes back, and with no signal polls at most every half hour

Date: 2026-10-12 · By: Carl Sauder · Status: accepted

Reason: the fleet simulator showed a phone out of signal woke sync every
five minutes, the scheduler's backoff ceiling, for as long as the app was
open: about 280 times a day on a phone that may be out of reach for weeks.
On a phone nothing woke sync when the network returned (`wake.ts` listened
for that only on the web), so the poll was the only way back. Carl chose
(2026-10-12, LAN-47) to do both: wake on the operating system's network
state (`expo-network`, `apps/mobile/src/networkWake.ts`, at most once in
ten seconds while the signal comes and goes), and let the offline backoff
go on to 10 and then 30 minutes (`SyncScheduler`). The poll stays as the
safety net, since a phone can report a network that cannot reach the
server (a captive portal, a SIM with no data left); it no longer carries
the latency. `expo-network` adds no Android permission and collects
nothing (`play-store-declarations.md`). Fleet `village-small`: 2,962 wakes
with no signal instead of 16,799, and work reached the server as fast.
Reverse if: phones are seen not to report a returning network, so work
waits for the half-hour poll (then a shorter ceiling, or a reachability
check of our own).

Amended (2026-10-13, Carl Sauder): losing the network wakes sync too: a
browser's `offline` event, and on a phone the connected-to-disconnected edge
(`wakeOnReconnect`'s `onLoss`, at most once in ten seconds). The attempt
fails at once, so My Work says "Offline" when the signal goes, instead of
40 to 50 seconds later when the live channel times out (SYNC-002, SYNC-007).
It costs one failing attempt per loss.

## 91. A language's checks carry their own people, questions and helps, and a ready-made flow is copied

Date: 2026-10-12 · By: Caleb Koster · Status: accepted

Reason: the review set-up read as tangled (Caleb, 2026-10-12). One check was
spread over Who checks (steps that hold two kinds), Review Teams under More
(a team that "usually reviews" one kind, or any), questions as Review
Questions material beside the TMF and Brief, and flows a language used,
followed or copied. Only people with the Reviewer role could be on a team or
be asked, so a translator could not do a peer check, and nothing linked a
note or guide to a check. His model: a language has checks in order, made,
reordered or started from a ready-made flow, and that alone carries the work
forward, with anyone on the team asked. People may be put on a check; they
are then the top choices, and "Ask the Peer check team" reaches all of them.
Helps (notes, guides, Bibles) may be linked to a check. From the audit page
(https://claude.ai/artifact/XqndiTYoof96zmrgzMwVgz) he chose:
- People belong to a check. They are review-team records, one team per check
  (`check:<kindId>`, core `checks.ts`), so a request to a team (56) reaches
  them as it did. Older teams still count: one set to the kind, or to any
  kind, puts its people on the check until that check's people are edited,
  when they move onto the check's own team (`checkPeopleSpecs`). The Review
  Teams screens are dropped (flow.ts `DROPPED_SCREENS`).
- The Translator role has Review (`SEED_ROLES`), so a translator can be on a
  check and be asked. An organization whose Translator role still has
  exactly the old seed gets the change once, from an admin's phone
  (`translatorReviewUpgrade`, `useTranslatorReview`); a changed role is left
  alone.
- A ready-made flow is a starting point: using one copies its checks into
  the language as its own steps (`commands.copyFlow`, the `custom` prefix of
  32), from New language, Get ready, Checks and the flow library alike.
  Nothing follows a flow's later versions. Languages already following one
  keep following it until someone changes their checks.
- Checks that happen at the same time stay one step with two kinds (29); the
  screens show each check as its own row, marked "same time"
  (`checks/model.ts`).
- A help is linked by `v1.CheckHelpSet { kindId, itemId | materialId,
  linked }`, a register per (kind, help) in the language stream, under
  manage_flows (migration `20261012200000_check_helps.sql`). Questions keep
  their storage, a question set scoped to the kind (26), but are added and
  edited on the check.
The screens (`screens/checks.tsx`): the language page's Checks row says the
order; Checks lists each check with its people, questions and helps and saves
every change at once, with Undo; one check holds People, Questions, Helps,
Must pass, Same time and Remove. New language's "I'll choose the checks" edits
the same list before the language exists (`checks/draft.ts`). After
publishing, the ask page shows each open check with its people and asks the
check's team; Someone else lists the team first, then everyone else, and the
questions they will answer. The passage path lists each check with its
people, My Work says when a check went to a team, and the review shows the
check's helps on Listen and every earlier version under Background. "Check"
is the one word for a review stage on every screen (`checkName`).
Not yet: an invite that puts whoever joins on a check (the server would have
to write the team membership at redeem time).
Reverse if: teams need someone on a check who must not review anything else
(then a check's people need a grant of their own), or one check needs
several groups with different people (then groups come back, within a check).

Amended (2026-10-13, Carl Sauder): with Review on the Translator role, the
role chooser's "Back-translate" (decision 71) gave the same role as
"Translate". It now gives a role named for back translation if one exists,
else the smallest role that both translates and reviews but runs nothing
(other than Translate's own role), else the checking role. With only the
seed roles, that is Reviewer (`plainRoleChoices` in `simple/adminModel.ts`,
PEOPLE-003).

Amended (2026-10-16, Caleb Koster): no check hosted by LangQuest comes with
premade questions yet (LAN-85). Spoken asked how to change the community
check's questions, which were LangQuest's shipped set and could not be
edited on the check. Caleb (2026-10-16): there should just be a community
check, and the admin puts in their own questions, notes and helps;
LangQuest will do something specific later. So `QUESTION_TEMPLATES`,
`instantiateQuestionSet` and `questionSetMaterialId` are gone from core,
`questionsForKind` returns the language's own question sets for the check
and then the request's, and the library seed no longer publishes LangQuest's
two question sets (the hosted library keeps them until someone removes
them there). Someone who manages flows opens the check from the questions
on the ask page and on Someone else, to change them there. Changes made
on a check's page (its people, its helps, what its step shows) say what
happened without an Undo button (Caleb, 2026-10-16: no timed undo toasts);
each is reversed the way it was made.

## 92. A phone writes down the files it keeps, and a file it loses behind the app's back is an alarm

Date: 2026-10-12 · By: Caleb Koster · Status: accepted

Reason: many phones sold in the field (Nigeria and places like it) claim
more storage than they have, and once the real space runs out they silently
delete files. LangQuest v2 users lost recordings this way among tens of
thousands of files, and nobody knew until the audio was needed. Caleb asked
for a very noticeable alert when a file that should be on the phone
disappears, cheap enough for low-end phones. PLAN.md section 14 rule 9 makes
a missing local file a quiet absence, which is right for a file that was
never here (someone else's unsent recording) but hid a file the phone threw
away. Chosen:
- The file store (`apps/mobile/src/blobs.ts`) writes down every file it
  keeps in a ledger (`packages/client/src/fileLedger.ts`, its own SQLite
  file `langquest-files.db`, one row per file). New files are written down
  in batches a second after they arrive. A file the store deletes itself is
  crossed out before it is deleted, so a crash between the two leaves a stray
  file that the next start keeps again, never a false alarm. The ledger
  drives no work: upload and download lists still come from the fold and the
  folder (rules 1 and 9), so it can disagree with the folder without harm,
  and the disagreement is the signal.
- Phones only. The web keeps no ledger: a browser's SQLite holds at most
  six files open (expo-sqlite's access handle pool), the event log and
  diagnostics already fill them, and a third database made the web fail to
  open its storage. The web app needs a connection anyway (decision 58).
- At startup the listing the store already makes is compared with the
  ledger. While the app is in use, the folder is listed again (names only,
  one native call off the JS thread) when the app comes back on screen and
  when new files arrive, at most every ten minutes, and at once when an
  upload finds its file gone. Before a listing is believed, up to 100 of the
  missing files are checked one by one; if any is there, the listing is not
  trusted and nothing is reported.
- A lost file comes off the index, so a kept passage downloads it again if
  the server has it, and is kept as lost until someone has seen the alert.
- The alert (`apps/mobile/src/lostFiles.tsx`) covers every screen and
  closes only with "I understand". Core `lostFilesView` says, for the open
  language, how many lost files are safe on the server and how many
  recordings were never sent, and names their passages to record again. It
  also tells the person to go online often, because the device may have less
  space than it says.
Not chosen: hashing files to catch damaged contents (a whole read per
file), a persisted queue (v2's lesson stands; this is a record of what was
kept, not of work to do), and field diagnostics for losses (a new kind
needs the server allowlist and Play declarations changed; a later change).
Reverse if: the ledger itself proves unreliable on these phones (false
alarms in the field), or losses turn out to be damaged contents rather than
missing files, in which case add a slow background spot check of hashes.

## 93. A to-do opens its task, making your own comes first, and content is decided with its text, its helps and what others do in view

Date: 2026-10-12 · By: Caleb Koster · Status: accepted

Reason: Caleb tapped My Work's "Divide Romans" and got the list of
languages; the ways to break up a book had no way of his own; and nothing
showed the book's text, its helps or where other Bibles start sections
(2026-10-12). He asked for the principles behind his notes to be applied
across the app (PLAN.md section 12, demo design principles 11–14), then
approved the demo's ADR-041 (dividing a book your own way) and ADR-042
(the same principles on other screens) and asked for all of it to be built.
- A to-do opens the task itself, in its language (11). My Work's Divide row
  opens the waiting book (`book_structure`, an app-only edge in the drift
  log); a notification, an Inbox row from another language, "New in
  <language>", "Record <passage> again" and a report's Needs attention
  open their passage, language or filtered map (`notificationTarget.ts`).
- Making your own comes first and looks different (12), so a growing list
  never buries it: a dashed card (`ChoiceCard own`) heads the ways to break
  up a book, Choose a Template, the checks and the roles, and it can start
  from a preset.
- A book can be divided your own way (`breakup/DivideOwnWay.tsx`, model
  `ownWay.ts`, docs/breaking-up-the-bible.md). The text is a Bible the team
  has, so the editor uses the language's sources (`useSources`). Where many
  of OpenBible.info's 20 English Bibles start a section is shown per verse,
  so the counts are bundled in core (`bibleBreaks.ts`, about 50 KB,
  generated by `scripts/bible-breaks.ts`; CC BY 4.0, credited on the
  screen) rather than fetched: they work offline, as `FIA_PERICOPES` does,
  and are moved into the language's numbering through the Original (80).
  The pane under the text holds the outline (a guide collection's parts),
  notes on the book's verses and the offered guides (`itemRangesIn`).
  Saving makes a one-book way (`ownWayDoc`) and goes through the same path
  as a ready-made way (`useBookChange`: the warning, the languages a shared
  template changes, Undo), so no new event or format. Listening from a
  section is not built yet.
- Books a way leaves out wait, each to be divided from the map when it is
  needed. Choosing the way says which books will wait, and no longer asks
  what they get: the "by chapter or wait" choice is dropped, because the
  list of ways to offer there would only grow (Caleb, 2026-10-13; amends 74
  and 80).
- Naming a book offers what the language's Bibles call it (their `source@1`
  books) and what the organization's other languages call it. A phone pulls
  only the languages it opens (37), so the server answers:
  `language_book_names(p_org, p_book)` (migration
  `20261012213000_language_book_names.sql`), read-only, the latest
  `BookNameSet` per language, only in languages the caller may read.
- What helps here shows the passage's text in a chosen Bible, with key words
  and notes marked, and each help as a card that can be shown or hidden
  there. A note for translators is written on the verses chosen in that
  text, said or typed; it is a passage note (`v1.NoteAdded`, anchored to a
  verse or a run of verses), not library material, because library notes
  have no voice and do not reach the recorder. A key word lists the verses
  of the passage it is in and how the organization's other languages say
  it. Those are read only from languages this phone already holds, so a
  language never opened here is not shown, which keeps the visibility of
  other languages as it is.
- Asking a check's team can add questions before sending, as Someone else
  could (the ask already carries `questions`; 91).
Reverse if: teams divide books by hand so rarely that the bundled counts are
not worth their size (then fetch them with the ways), or people need to see
other languages' key words they have never opened on the phone (then the
server answers, under a visibility rule for languages).

## 94. LangQuest v2 comes over one way and keeps coming, by saying what each v2 project says now, and a v2 account signs in here as itself

Date: 2026-10-12 · By: Caleb Koster · Status: accepted

Reason: v2 keeps running while its users move here, so its data has to come
over and keep coming, one way only (Caleb, 2026-10-12). The first import
(PLAN.md step 8) copied a project once, put v2's languoid UUID in
`LanguageAdded`'s code (78 left that open), made each verse recording a
passage of its own, and treated a Bible project's own recordings as source
material. It could not follow v2 after that, because v2 cannot say what
changed: its `last_updated` is a phone's clock and can be days old when the
row arrives, server jobs change rows without touching it, and rows are
deleted outright. So the import reads each v2 project whole, turns it into
the facts it states now (a member, a unit, a version of a passage, a
review), and compares them with a ledger of what the import last appended
for each fact (`packages/v2-import`, `reconcile.ts`): a new fact is said, a
changed one said again, one v2 no longer has is taken back the way this
app takes things back (hidden, removed, or `v1.Redacted`), and one that
returns is said again. Event ids are the import's own (`v2:<project>:<fact>#<n>`)
and clocks come from v2, never earlier than the import's last word on the
same fact, so passes are idempotent and a pass that dies is finished by
the next; v2's timestamps only choose which projects to read, and a nightly
pass reads all of them. No event changed: v2's work arrives as ordinary
events. Where each v2 project goes is the team's choice on a board (v2 has
no organizations): a project with the Every Language platform account goes
to Every Language, the rest start with their owner's other projects, and a
project comes over only once its organization and its language are
confirmed (`docs/v2-project-languages.md`); a project that has come over
cannot change organization, since its events carry it. A Bible or FIA
chapter or passage quest becomes that passage of LangQuest's Bible (the
organization subscribes to `langquest.bible.chapters` or `.fia`), its verse
recordings one version of it with their verses (`CardVerseSet`), each later
publish a new version; votes become one Community Check per person,
back translations Back Translation reviews, and written work notes until
written translations exist. The plan, ledger, file map and passes live in
a `v2_import` schema only the service role reaches (migration
`20261013000000_v2_import.sql`), so the import is retired by dropping it.
People: a v2 account becomes the account here with the same id, so the
imported work is already theirs. When Sign In does not know an email and
password, `v2-sign-in` asks v2's own sign-in once (and signs that session
out), then makes the account with the v2 id and the same password; ten
wrong tries per email an hour are refused here, since every try reaches v2
from the same servers. An email already here under another id is not taken
over. Design in `docs/v2-import.md`.
Reverse if: v2 gets a reliable change feed (then read changes, not whole
projects), or projects routinely need to move between organizations after
coming over (then a language needs a way to move, which the log does not
have).

Amended (2026-10-12, Caleb Koster): someone who signs in with a v2 account
is welcomed back to their work (demo ADR-043; Caleb agreed to the demo's
screen, 2026-10-12). `v2-sign-in` notes the v2 projects they belong to, as
v2 lists them to that person, and `v2_welcome()` tells the phone which of
those have come over and which are still on their way. It is the one
function in the import's schema a phone may call, and it answers only for
the caller. Their first sign-in lands on Welcome back with or without an
organization here, never on "What brings you here?": until their work
arrives they keep recording in the old app, since everything recorded
there still comes over (`docs/v2-import.md` section 7).

Amended (2026-10-13, Caleb Koster): written work stays in v2 for now. A
translation or transcription hanging off a recording, and a part with words
and no audio, are not brought over (Caleb, 2026-10-13): v2 has 99 of them
in 31 active projects, about half of them tests, and written translations
in this app will want them attached to the version they came from, not as
the Back Translation reviews and notes above. They come over once written
translations exist. An FIA project's team is offered FIA's study guides in
the language it reads, else English, as New language offers them: v2's app
read FIA's guides from FIA, so without them an FIA team would have the
passages and nothing to study.

Amended (2026-10-13, Caleb Koster): a project need not have its language
linked to come over. With none chosen on the dashboard it comes over by its
name, unlinked (a `LanguageAdded` with a code made from the name, as New
language makes one, and no `LanguageCodeSet`), and its admins link it in
Next, as they can any language added unlinked (78). The dashboard's
suggestions are never linked unless someone uses one: v2's own links, which
many suggestions repeat, are often wrong.

Amended (2026-10-14, Caleb Koster): a v2 person whose email already has an
account in Next is linked to it only when someone on the team confirms it
on the dashboard (Same email, Same person). Next does not confirm emails at
sign-up, so an email match alone is no proof, and linking by it would let
anyone claim a translator's work, or an organization, by signing up with
their address first. A confirmed link makes the import name the Next
account wherever it named the v2 one, so memberships and organization
admins move to it at the next sync; work already brought over keeps its v2
author. Changes to who is in an organization are now signed by an admin the
import made there already, and so are take-backs of facts v2 no longer
states, which the import's device id could not sign.

Amended (2026-10-14, Caleb Koster): nothing v2 deletes or turns off is
taken back here ("the point of an event log is that nothing disappears").
Recordings, reviews, notes, units and members that v2 removes stay; a v2
publish without a recording becomes a new version without it, and the
earlier version stays. This replaces taking back by hiding, removing or
`v1.Redacted` above. The import takes back only its own decisions: Leave
out, a link's move, an organization admin dropped on the dashboard, and FIA
guides no longer offered. A member who leaves a v2 project keeps their
place here until an admin removes them.

Amended (2026-10-19, Carl Sauder): the scheduled passes run in the job
container behind the dashboard Worker (141), not GitHub Actions: every 15
minutes from its job tick, and the whole read at 03:15 UTC, owed until a
run starts with it, so a long pass never drops it. The switch is the
Worker's `V2_IMPORT_ENABLED` var ("true" in production, as Caleb set the
GitHub variable on 2026-10-14; "false" in preview). v2's key goes on the
Worker with `npm run secrets`, and the job refuses to start without it;
v2's read-only login is optional there as it was on GitHub, which never
had it, so people come over by id until they sign in. `npm run v2` by
hand and the board are unchanged; `scripts/v2-go-live.sh`, which gave the
workflow its secrets, is gone.

Amended (2026-10-20, Carl Sauder): a whole read resumes, and a file v2
does not have is asked for less often. A whole read records when it began
(cursor `whole`) and when one last finished (`whole_done`); one begun less
than a day ago and not finished skips the projects read since it began,
by it or by a 15-minute pass, since each of those was read whole then, so
a whole read a deploy stops (141) resumes rather than starting over. A
missing file was asked for on every pass for a week, and on 2026-10-20
the 15-minute pass asked again for some 10,000 absent files each time and
took 10 of its 15 minutes. Now one missing under an hour is asked for on
every pass, since a phone's upload can trail its rows; up to a week, only
by the whole read or a transfer someone starts for its project, so about
once a day; older, never, as before (`looksFor` in `pass.ts`).

Amended (2026-10-24, Caleb Koster): v2 audio phones may not play comes over
converted to M4A. Some Every Language teams uploaded whole chapters as MP3,
which v2 took as it was: 573 files in 33 projects, 13 of them Every
Language's, every one in v2's storage (16 are a browser's WebM). The import
read only WAV and M4A, so it wrote each down as not in v2's storage, and
Central Thai SPV, Pwo Eastern Karen and nine more came over with no audio
(Every Language noticed, 2026-10-23). Caleb chose converting over adding
MP3 to what a recording may be, since 58 keeps `wav | m4a` and the app, the
database and the API would all change. ffmpeg, installed in the job image
(141), converts in `server/audioConvert.ts`: AAC in M4A, mono, at a phone's
128 kb/s (106) or the source's rate when that is lower, and lower still if
that is what keeps it under the Worker's 50 MB. It is bit-exact, so a cloned
project's copy converts to the same hash; a copy that comes out different
is not stored there, since R2 refuses bytes that do not hash to their name,
and the log says so instead of the project stopping on every pass. A run
with no ffmpeg leaves such a file out of the file map for one that has it;
a file v2 has that is not audio is reported as unreadable, not as missing.
Migration `20261024013000` forgets the missing marks of files that were
never WAV or M4A, so the next whole read converts them.
Reverse if: teams hear what the re-encode loses, or recordings must keep
v2's own bytes; then add `mp3` to 58's formats instead.

Amended (2026-10-24, Caleb Koster): a project that has come over can come
over again into another organization, as a new language there. Every
Language asked for BIRAT RAJBANSHI, which had come over into its owners'
own organization because the Every Language account was switched off on it
in v2; Caleb: "It needs to be in the everylanguage organization." A
language still cannot move, since its events carry its organization, so
`npm run v2 -- move --project <id> --to <org>` (`v2_import_move`, migration
`20261024053000`) gives the placement the new organization and a new
language id, and records the first copy in `v2_import.moves`. The next pass
reads the project whole into the new language under a ledger scoped by that
id, so its events have ids of their own, and stores its recordings again
for it. The first copy is no longer kept up to date; once the new one is
confirmed and nothing new has appeared in the first, it is removed or made
inaccessible (Caleb). Welcome back names the new language. The board still
never moves a project that has come over.

Amended (2026-10-24, Caleb Koster): a first copy left behind is made
inaccessible by taking back every membership the import gave there, since
Next has no way to delete or archive a language. Caleb, once BIRAT
RAJBANSHI's Every Language copy was confirmed: "please make the old copy
inaccessible". `npm run v2 -- close --org <org> --language <language>`
(`close.ts`) removes the language's members, and the organization's admins
when it holds no other language, signed by one of those admins, who goes
last. It is the service role's append, which no grant rule stops, so the
organization may be left with no admin. The language, its work and its
audio stay, and the memberships can be given again. It refuses a copy the
import still keeps up to date.

Amended (2026-10-29, Caleb Koster): work from a v2 phone that was offline
for weeks waits for its audio, and audio that reaches v2 late still comes
over. A partner asked whether work made offline for weeks comes over. Two
waits of a week were counted from the wrong moment. A version waited for
its files a week from the asset's `created_at`, which is the phone's clock
when it recorded, so for a phone back after three weeks the wait was over
before its rows reached v2, and a version came over without the parts
whose audio was still going up, then again with them. And a file the
import missed was never asked for after a week, even once v2 had it, so
audio a phone sent more than a week after its rows never came over. Now
the wait counts from the segment's `uploaded_at` (v2's server clock, set
when the row arrives), and a missed file is asked for again once v2's
`audio_uploaded_at` for it is later than the miss: on the pass that sees
it arrive, and by every whole read until it is copied (`looksFor`). Only
files v2 says it has are asked for again, so the 15-minute pass does not
go back to asking for the 10,000 absent ones (amended 2026-10-20).

## 95. The app's UI tests run on Maestro on phones and Playwright on the web; Jev stays for journeys judged by outcome

Date: 2026-10-12 · By: Carl Sauder · Status: partly superseded by 102

Reason: `docs/ui-test-suite/` specifies the app's end-to-end UI tests, per
role, and about 550 of them can be automated. Carl chose (2026-10-12):
- **Maestro** for iOS and Android (`apps/mobile/test/maestro/`). It drives
  the dev client or a release build from YAML flows without instrumenting
  the app. It handles permission dialogs, backgrounding, killing the app,
  deep links and two devices, which the recording, sign-out and offline
  tests need. The `run-app` skill already used it.
- **Playwright** for the web export (`smart-tests/ui/`). It already ran the
  web smoke test (58) and hosts Jev's driver, and Chrome plays a WAV file as
  the microphone.
- Each automated test is written once. A test whose platforms include the
  web runs in Playwright, which is faster and runs in parallel. A test of
  phone-only behaviour runs in Maestro. A set of P0 flows runs in Maestro on
  both phones, so the core jobs are also proven on devices.
- One fixture world, built through the real server so every event passes
  validation and permissions like a phone's, serves both
  (`smart-tests/ui/fixture.ts`, `npm run ui:fixture`). Each Playwright file
  and each Maestro run gets a fresh organization, so runs share the local
  database without touching each other.
- Screens get `testID`s on their main action, Back and ✕, and the tabs, so
  flows hold across the app's fifteen languages.

Not chosen:
- **Detox.** It is synchronized with React Native, so it is less flaky. But
  it needs native build configuration and is heavier to keep working.
- **Appium.** It is slow and flaky.
- **Jev as the main framework.** It drives only the web, its runs vary, and
  every step is a paid model call. It cannot check a toast's words, Undo or
  a permission boundary. It stays the tool for journeys judged by their
  outcome in the event log, once it is ported (`smart-tests/README.md`).

Reverse if:
- Maestro's flakiness costs more than Detox's setup would.
- Bugs that only phones show slip through the web runs. Then run the web
  tests' flows on phones too.

Amended (2026-10-13, Carl Sauder): the phone flows run on a test build, not
on the dev client. A dev client loads its JavaScript from Metro after every
clean start, which took about 40 s per flow on iOS. On Android it took 2.5
minutes, because the server's address had to be typed into the launcher.
`npm run test:ui:build` (`scripts/maestro-build.mjs`) makes a Release build
with the JavaScript inside, pointed at the local stack. A clean start then
takes seconds: 31 s and 43 s per flow, sign-in included.
- The build is marked a local release (`EXPO_PUBLIC_LOCAL_RELEASE`, which
  `src/supabase.ts` already allowed for the web export). It bundles from an
  empty Metro cache of its own (`METRO_CACHE_DIR`, `metro.config.js`):
  Expo writes `EXPO_PUBLIC_*` values into files as Metro transforms them,
  and the cache every Metro on a machine shares would otherwise hand the
  build files made with other settings.
- Two settings change only in the generated `ios/` and `android/` folders,
  which version control ignores, so no store build can carry them.
  Over-the-air updates are off, and Android allows plain http to the local
  stack.
- The runner's `--app dev` still runs the flows on a dev client and Metro,
  for working on a flow against live code.

## 96. Answered feedback keeps a check open until its reviewer says it looks good

Date: 2026-10-13 · By: Carl Sauder · Status: accepted

Reason: a check that asked for changes counted as complete as soon as the
translator answered it (a new version, or keeping it with a reason). Core
`isCompleteState` counted `addressed`, so the new version was never offered
to the check again unless someone asked, though the record told the
translator "Then it goes back to the check". The UI test suite found it
(JRN-002, JRN-011). Answering is not a verdict, so the check stays open:
`addressed` is no longer complete, the step is not done, and its reviewer is
offered the new version. A checkpoint already worked this way (72).
- The passage record shows the step as open, "answered · back to the check"
  (`passage/record.ts`, `pathModel.ts`), not ticked green. Older versions
  still show what they heard (`oldStepState`).
- `done` in reports and the API (70, 72) follows: a passage whose last
  feedback was answered is not done until the check passes it.

Reverse if: teams find re-checking every answered note slows them more than
the missed second look costs. Then let a flow mark a check as one that an
answer completes.

## 97. Taking back a checkpoint override needs Override checkpoints

Date: 2026-10-13 · By: Carl Sauder · Status: accepted

Reason: only Override checkpoints may move a passage past a checkpoint (29),
but anyone with Translate, Review or Assign work could undo that override,
because `v1.DepartureUndone` names only the departure and its privilege came
from its own payload. The UI test suite found it (PASS-056). The server's
`may_emit` now looks the departure up in the same stream and asks for
Override checkpoints when it undoes an override
(`20261013140000_override_undo_privilege.sql`, `server/grantsSmoke.sql` 10).
Undoing a set-aside or a kept version keeps the wider list. The app shows
Undo on an override only to those who hold it (`screens/passage.tsx`).
Core `privilegeFor` stays payload-only, so it still names the wide list for
this event; the event's shape did not change.

Reverse if: a team wants translators to bring a checkpoint back themselves.
Then it is a role setting, not a code change.

## 98. An organization always keeps someone who can manage roles

Date: 2026-10-13 · By: Carl Sauder · Status: accepted

Reason: nothing stopped an admin removing themselves, demoting the last
admin, or taking Manage roles off the only role that had it. Then nobody
could give it back except support. The UI test suite found it (PEOPLE-026).
The server refuses any membership or role change that would leave no
org-scope member with a live role holding Manage roles
(`_grant_refusal`, `20261013150000_keep_a_role_manager.sql`,
`server/grantsSmoke.sql` 11). Core `leavesNoRoleManager` mirrors it, so the
member page says "You are the only one who can manage roles" and offers no
Remove or demotion (`screens/org.tsx`). Removing yourself while another
admin remains is still allowed, as before (75).

Reverse if: organizations need to be handed back to support on purpose.
Then that is a support tool, not a gap in the rule.

## 99. For now a back translation carries one spoken note

Date: 2026-10-13 · By: Carl Sauder · Status: accepted

Reason: a back translation's notes at moments each keep their words, but
the event has one voice note (`noteBlobHash`). Every spoken note after the
first was silently replaced by the last one said. The UI test suite found it
(REV-035). Until a versioned event can carry a voice note per moment, the
first note said aloud keeps the voice note, and later notes, including the
publish sheet's, are typed. The sheet says so ("One spoken note per back
translation for now: type this one.", `simple/btWorkspace.tsx`).

Reverse if: the event that carries a voice note per moment ships; this
entry is then superseded by it.

## 100. "Join your team" has no Back to Sign In, unlike the partner demo

Date: 2026-10-13 · By: Carl Sauder · Status: accepted

Reason: the demo's flow has an edge from the intent chooser back to Sign
In. In the app the person is already signed in there, so Back would only
look like signing out without the unsent-work check of 12. Sign out is its
own action on that screen. The edge is dropped deliberately, listed in
`DROPPED_EDGES` (`apps/mobile/src/flow.ts`), and the parity test checks that
it is a real demo edge the app does not have (NOORG-003).

Reverse if: the demo's flow gets a signed-out chooser. Then the edge
belongs back.

## 101. Webhooks are nudges, and the change feed is ordered by when the server saw a change, found by comparing what the API shows

Date: 2026-10-13 · By: Ryder Wishart · Status: accepted

Reason: Aquilla imports takes from LangQuest and must notice structure
changes and deletions, which polling `changedSince` misses: hiding a
passage or dividing a book again never moves `updatedAt`. Their request:
a webhook that only nudges, and a feed that stays right after a missed
delivery or a three-day outage. Chosen:
- **The feed** (`GET …/languages/{id}/changes?after=`) is one row per
  passage change, numbered in the order the organization's Durable Object
  saw it (`apps/web/worker/agent/dispatch.ts`). It is not ordered by HLC.
  A phone offline for days pushes events with old clocks, and an HLC
  cursor would skip them for good.
- **Changes are found by comparing digests.** A digest is what the passage
  list shows of each passage (`webhooks.ts` `digestOf`): label, order,
  parent, path, latest take, status, approved take, newest review and
  release. The DO compares the digest before and after the log moves. The
  log has no unit-updated, unit-deleted or language-removed event: a
  passage leaves the list by `v1.UnitHidden`, a template change or a book
  divided again, and a language leaves a token's reach by membership. So
  reading event types would miss them, and a comparison catches every
  path, now and later. The first look at a language only records where
  its feed starts.
- **A webhook belongs to a token.** It needs `read` and stops when the
  token is revoked or expires, after one last `token.revoked`. It is a row
  in Supabase (`api_webhooks`, migration `20261013120000_api_webhooks.sql`,
  service role only) so the database and revocation can see it. Its
  secret is kept as it is: signing needs it. A leaked secret forges only a
  nudge that carries no data.
- **Delivery** happens in the DO, from an outbox in its SQLite:
  - each delivery is signed `t=…,v1=HMAC-SHA256(secret, t.body)` with a
    stable event id;
  - it is retried on a non-2xx or a 10-second timeout, for a day;
  - a webhook whose event still fails after a day is stopped, with a reason.
- **Waking.** `events_notify` already runs once per stream per push. It
  now also posts to `/api/internal/poke` with `pg_net` when the
  organization has a running webhook. The DO's alarm waits three seconds,
  so a recording session becomes one delivery per language and kind, not
  one per take. The Worker's ten-minute cron pokes every such organization
  in case a poke was lost.
Rejected:
- The DO subscribing to Supabase Realtime: an outbound socket keeps the
  object awake around the clock, needs a channel per language, and still
  needs a poll when it drops.
- A Worker cron alone: a minute or more late, and Workers cron cannot run
  more often.
- Webhook payloads with content or audio links: links expire, and
  permissions must be checked when the data is read, not when it is sent.
Reverse if:
- digesting a large language on each look shows up in the DO's CPU (then
  compare only the units the new events touch);
- partners need delivery order or exactly-once (then a queue per webhook);
- the feed is wanted from before a language's first look (then derive it
  from the log itself).

## 102. Five test layers, the lowest that can hold a check; end-to-end on the export, with a budget; Jev shelved

Date: 2026-10-14 · By: Carl Sauder · Status: accepted

Reason: a review of the repo's tests on 2026-10-14 (`docs/testing.md`)
found a strong unit and property layer (1,400 tests in under five seconds),
no coverage measurement, no layer between the pure models and the
end-to-end suite, and a 537-test web suite that ran nowhere automatically.
The suite had found about 90 product bugs (95), so the problem was
proportion, not tools: it carried role-by-passage matrices that are pure
functions of state and role, it slept where it could have waited on a
signal (86 fixed waits), it found most things by their English words
(13 `testID`s in the app), it ran on Metro's dev build rather than the
export people get, and a failure mid-file burned a ceiling of up to twenty
minutes. Carl chose (2026-10-14):

- Five layers (unit and property, server, screen models, end-to-end web,
  end-to-end phones), and a check goes in the lowest that can hold it. The
  matrices move down to screen-model tests titled with their spec IDs; one
  end-to-end test per screen proves the model reaches the glass.
- The web suite runs against the release export served by the Worker, the
  way the smoke test does; Metro stays for authoring (`UI_TARGET=dev`).
- Waits are on signals: locators, the device log, and a test-state probe the
  app exposes in test builds. `waitForTimeout` fails the hygiene test unless
  the line says why nothing observable exists.
- One test per role, the default timeout as the ceiling, screens entered
  directly (sections by address; a passage record, which has no address
  by 58, through the entry notifications use, in test builds only),
  structure found by `testID` and copy by catalog key.
- Retries stay at zero (95); a test that fails without a product cause goes
  to `@quarantine` with an owner, and pass rates come from the kept reports.
- `@p0` runs on every PR and before `npm run ship`; the whole suite, a fleet
  scenario and Stryker on core run nightly; phones and the run sheet before a
  store release.
- Coverage is measured with thresholds for core and client; a traceability
  test holds every `Auto` spec to an implementation and every P0 to
  automation, with known gaps listed by reason.
- Jev is shelved: the journeys, driver, bridge and Python environment leave
  the tree, and the manual-dispatch CI job with them. It drove only the web,
  varied between runs, cost a model call per step and could not say what a
  screen showed; its port to the organization-and-language model had been
  waiting since 2026-09-29. Not chosen either: Detox (native setup for a
  flake rate not yet shown to need it), Jest with React Native Testing
  Library (a second runner for screens that hold little logic), screenshot
  comparison (later, once the suite is stable on the export).

Amends 95: the automated tests stay on Maestro and Playwright; Jev no longer
"stays for journeys judged by outcome".

Reverse if: a screen's behaviour cannot be expressed as a model and
end-to-end tests pile up again; Maestro's flake rate stays above a few
percent after the fixes; or a discoverability problem (people cannot find
how to do a job) slips through, which is the one thing a goal-driven agent
checks and scripts do not. Then Jev returns as a nightly signal.

Amended (2026-10-14, Carl Sauder): the folder `smart-tests/` is now
`e2e/`. "Smart" was Jev's word for its journeys; what is left in it is
the web UI suite and the web smoke, both Playwright, the end-to-end
layer of `docs/testing.md`. Not `web-tests/`, which read like a sibling
of `apps/web/test`, the Worker's unit tests.

Amended (2026-10-14, Carl Sauder): the phone runner skips the flows a run
cannot hold and says why, instead of running them to a failure. The first
unattended iOS run reported 10 of 33 flows failed, and every one was a
flow that could not pass as run: seven needed a microphone signal (no
`--voice`), one Android's airplane mode, two a step from outside mid-run.
Failures that are not findings hide the ones that are. So flows carry
tags for what they need (`voice`, `android-only`, `wrapped`), a test holds
the tags to the flows' steps, and `scripts/maestro-plan.mjs` turns the
run's flags into exclusions and a printed list. The flows had been written
to fail rather than pass silently; a skip that is printed keeps that
honesty without the noise. Named flows (`--flow`) still run as asked.

Amended (2026-10-15, Carl Sauder): the PR jobs no longer wait for
`checks`, and `ui-web` runs in two shards. A PR waited about 12 minutes:
`checks` (2.4 min), then `ui-web` (8 to 10 min), of which the `@p0` tests
were 5 to 6.5 min on four workers that were busy only 70% of the time,
because the one long `@wide` journey (JRN-005, about 2 min) was queued last
and ran alone. Now the four jobs start together, a job that needs the local
stack starts it in the background while it installs browsers, the `wide`
project is listed first, and each project builds its own fixture world, so
the two can run one file at once. Shards, not more workers: a runner has
four cores and already runs the stack and the Worker beside the browsers.
A failing `checks` no longer saves the other jobs' runner time, which on a
public repository costs nothing. Reverse if: runner minutes start to cost
(a private repository, or a paid plan's limit), or the shards' runs disagree
with an unsharded one.

Amended (2026-10-15, Carl Sauder): coverage thresholds also hold the
mobile screen models (`apps/mobile/src/**/{model,*Model}.ts`), and every
threshold sits about two points under what is measured, raised as coverage
rises. A coverage audit that day found decision logic had grown back into
screens and hooks (Get ready's help items, My Work's to-dos, the break-up
rules) and a model at 0% that nothing flagged; the logic moved into models,
and a threshold keeps it there. Thresholds well under the measured value had
let a gain slip back unnoticed.

Amended (2026-10-16, Carl Sauder): "reported" now means filed in Linear.
The whole web suite had failed on the first two nights (5, then 8 tests)
and nobody knew: a red scheduled run only emails whoever last edited its
cron line. Each nightly job now ends with `scripts/nightly-report.mjs`,
which opens an unassigned issue in the team per failing test (titled
`Nightly: <test> [<project>]`), or one for the whole run when it left no
report or more than 15 tests failed (one cause, such as the stack not
starting), and one per fleet or mutation job that fails. As in decision
53 the state lives in the issues: a failure that persists adds nothing,
and a turn to passing or back to failing is one comment. The reporter
never closes an issue; a fix names it and linear-sync moves it, and a
test that fails again after its issue is closed opens a new one naming
the old. A run off `main` only prints what it would file. Linear rather
than a chat message, because an open issue waits for someone to act on it.
The quarantine job stays unreported: its tests already have an issue.
Reverse if: a night's issues are mostly noise (then raise the bar, or
report a weekly digest from scripts/ui-flakes.mjs instead).

Amended (2026-10-20, Carl Sauder): the `ui-web`, `web-smoke` and nightly
jobs failed for reasons outside the code, found over 144 pull request and
push runs on 2026-10-20, and the workflow changed in four ways.
(1) Concurrency: one group per ref let a push to main cancel the
scheduled run (nightly run 39360456537 was cancelled at 03:02 by push
39362023629). Pull request and push runs still cancel the run they
replace; the scheduled and manual runs have a group of their own and
neither cancel nor are cancelled. (2) Registries: `web-smoke` (run
39473313915, "toomanyrequests: Data limit exceeded") and
`nightly-quarantine` (run 39360456537, "Rate exceeded") failed pulling the
Supabase CLI's images from ECR Public, which rations anonymous pulls per IP
address, shared on a hosted runner; the job container's base image and
wrangler's egress image come from Docker Hub, which does the same. Jobs now
restore the images from `actions/cache` (docker save and load, keyed by the
CLI version and `supabase/config.toml`), save them when the cache was not an
exact hit, retry a start a registry turned away, and leave out the services
no test uses (studio, imgproxy; `SUPABASE_EXCLUDE`). Docker Hub sign-in is
used only if the secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` exist.
(3) Load: each `ui-web` shard ran the stack (about twelve containers),
wrangler dev, the job container and four browsers on 4 vCPUs, and the same
tests ran 2 to 9 times slower than on a laptop (REV-003 2.6 s locally,
14.8 s in CI); the shard with the recording, reviewing, sync and journey
files had 19 of the last 21 `ui-web` failures. `ui-web` now runs four
shards of `UI_WORKERS=2`, so wall time stays about the same with half the
browsers per runner and twice the runners (free on a public repository),
and the shards are cut by recorded duration rather than Playwright's test
count: over three runs the two count-based shards took 160 to 200 s and 250
to 315 s, and the same files dealt by `scripts/ui-shards.mjs` weigh 283 to
286 s of test time in each of four shards. Every UI job keeps `nproc`,
`free -m`, `vmstat` and the busiest processes in its results artifact, so
the next question about load has numbers. (4) Flakes: with retries off a
flake only shows over many runs, and `ui-flakes.mjs` had to be fed by hand;
the nightly job `nightly-flakes` now reads the report artifacts of the last
40 runs, and files the tests under 95% of their runs (seen in at least 5) as
one Linear issue, by the code that files the nightly failures. The weights
table must be refreshed when the suite changes a lot (`docs/testing.md`);
a stale table still shards correctly, only less evenly. Reverse if: the
load files show four shards of two browsers are still starved (then larger
runners, which cost money), or the cache costs more than the pulls it
saves.

Amended (2026-10-23, Carl Sauder): for the browser jobs the cache did cost
more than the pulls it saved. Warm, it made a pull request's run about a
minute longer than pulling (425 seconds against 352 and 374), and the CLI
now takes the images from `ghcr.io` when ECR refuses them. `web-smoke` and
`ui-web` pull, retried by `ci-retry-pull.sh`; `server` and the nightly jobs
keep the cache (decision 164 has the numbers).

## 103. Large languages are projected by a scheduled GitHub job; the Edge pass leaves them out

Date: 2026-10-14 · By: Caleb Koster · Status: superseded by 141

Reason: the projection pass (decisions.md 68) runs in the
`stream-projections` Edge Function, and a run there gets 256 MB and 2 s of
CPU (Supabase's limits). The v2 transfer brought languages far past that:
folding Santhali omt bible (225,000 events, a 61 MB state) took about
850 MB in Node. From 15:30 on 2026-10-14 most passes ended with
`WORKER_RESOURCE_LIMIT` (546), so six of the largest languages had no
server snapshot, and every language the pass reached after them waited for
its Inbox rows and snapshot. Chosen:
- A language is large when its newest snapshot is 10 MB or more, or 25,000
  events or more have arrived since it (its whole log when it has none):
  `isLarge` and `LARGE` in `server/projectionWorker.ts`. Koro Miyan's
  40 MB snapshot did pass in the Edge Function at times; 10 MB leaves room
  for the tail, the indexes and the Inbox rows.
- The Edge pass projects only the small ones (`runProjections(service,
  'small')`) and visits languages smallest first, so a language too big for
  one run holds up only bigger ones.
- `.github/workflows/projections.yml` runs the same pass for the large ones
  every ten minutes with Node's memory (`server/projections.ts`), using the
  service-role secret the v2 import already has. The repository is public,
  so Actions minutes cost nothing, and the log prints counts only.
- Inbox rows in a large language can arrive about ten minutes later than in
  a small one (GitHub can start scheduled runs late). Pushes still go every
  minute once a row exists.
- The service role's requests get two minutes instead of the 8 s they
  inherit from `authenticator` (migration
  `20261014180000_service_role_timeout.sql`): `put_snapshot` for Kuturmi,
  Halbi and Santhali (35 to 61 MB) was cancelled at 8 s. Only the server's
  own jobs use that role; people's requests keep 3 s (anon) and 8 s
  (authenticated). Caleb chose this over writing a snapshot in several calls.
- The large pass goes on past a language that fails and lists it by id, so
  one failure holds up no other language.

Not chosen: a bigger Edge Function (the limit is fixed per run); folding page
by page in the Edge Function (the state alone outgrows 256 MB); a Worker or
server of our own (another deployable to run for what is meant to be
temporary). The lasting fix is loading per unit, so no single fold holds a
whole language (the report "Big languages on phones: what to change").

Reverse if: per-unit state makes every language fit the Edge Function, or
GitHub's schedule lags enough that people in large languages notice late
Inbox updates. Then the pass moves to a host with a steady schedule.

## 104. `packages/client` is `packages/sync`, and it owns anything a device queues for the server

Date: 2026-10-14 · By: Carl Sauder · Status: accepted

Reason: the package began as the client half of the sync protocol (the
first scaffold, PLAN.md section 10), and the name was never written down
or revisited. It since took on jobs that run on servers (`snapshotWorker`,
`blobReconciler`, `workerBlobs`, `v2import`), and is imported by the Worker,
`server/`, the scripts and the tests as well as the phone, while most
readers take "client" to mean "the app". That made its boundary hard to
explain, and two outbound queues had grown up in `apps/mobile` beside it:
the account outbox (`durableOutbox.ts`) and the uploads of a shared phone's
hand-over (`handOverCore.ts`, 60). Carl chose (2026-10-14):

- Three layers, by the question each answers. `core`: what does the data
  mean? `sync`: is it kept, sent, received and current? The apps: what does
  a person do and see, and what runs it on this platform?
- `sync`'s scope is anything queued for the server, not only events and
  their files, so the account outbox, a hand-over's delivery attempt and
  the per-language session (the `SyncClient`, both `TransferWorker`s, the
  scheduler and storage reclaim, formerly built inside `useLanguage`) move
  into it. Each takes its platform pieces as arguments.
- The boundary is held by what a file imports: core, supabase-js and its
  own files, plus Node built-ins under `src/testing`
  (`packages/sync/test/boundary.test.ts`). Drivers, file stores,
  `AsyncStorage` and configured clients stay in the app that uses them.
- The reasons: every runtime that keeps or moves data runs the same queuing
  and transfer code, so none copies it and gets it subtly wrong; everything
  a device queues for the server goes through one tested place; and the
  name now says what the package does. `sync` rather than `eventsync`,
  since not all of it is events, and `core` keeps its name: its contents
  still match it and the no-I/O rule stops it collecting everything shared.

Older entries and records that say `packages/client` mean this package.

Reverse if: a second app needs a different outbound policy than the phone
(the queues would split back into the apps behind a shared interface), or
the server-side jobs grow their own dependencies that the phone must not
carry, which would argue for a separate server package.

Amended (2026-10-26, Carl Sauder): sync has a second entry,
`@langquest-next/sync/server` (`packages/sync/src/server.ts`), for what only
servers run: the snapshot worker, the blob reconciler, the Worker's R2
files, the stream list, the per-unit cut and `foldStream`. The phone and
the web app import `@langquest-next/sync` and no longer carry them. A
separation-of-concerns audit found the single entry had pushed server code
to copy sync instead of importing it: `server/reconcileJob.ts` kept its own
`foldStream`, reconciler wiring and a "missing" count by a different rule
than the reconciler repairs by, so as not to grow the web app's first
visit, and three server jobs imported `packages/sync/src/*` by path. The
reconciler now counts what is missing with core's `isStored` and can stop
early, and the job only builds its deps. ESLint now also reads `server/`,
`apps/web/worker`, `apps/web/jobs`, `apps/admin/src` and
`packages/v2-import/src`, with one rule: packages by their entry, and
nothing from `apps/mobile/src` (shared code goes in core). This is still
one package, not the separate server package the reverse-if names: the
server entry imports only what sync already may.

## 105. In `apps/mobile`, server calls live in `src/server/`, logic outside screens, and folders by feature

Date: 2026-10-14 · By: Carl Sauder · Status: accepted

Reason: a review of `apps/mobile` on 2026-10-14 found the packages well
separated but the app less so. Supabase was called from 28 files, four
screens among them: sign-in's whole policy (a v2 account, recreating the
dev account, recording the terms) sat in a button handler in `entry.tsx`,
and `org.tsx` read and wrote Explore listings and sent invite emails
itself. The largest screens (`config.tsx` 1,738 lines, `org.tsx` 1,639,
`passage.tsx` 1,420, `content.tsx` 1,366) mixed state, rules and layout,
though the pure-model pattern (`configModel.ts`, `adminModel.ts`) already
existed. `OrgWork` in `App.tsx` kept recent passages, Inbox reads,
onboarding, toasts and navigation in one component; the language's sync
engine was built inside `useLanguage`'s effect; and `src/` held about 110
files in one folder, with `simple/` (named for the redesign of 71, not a
concern) imported both ways by half the feature folders. Carl chose
(2026-10-14):

- Every Supabase call is a named function in `src/server/`, one file per
  area, returning supabase-js's `{ data, error }` so each caller keeps
  saying what a refusal means. Nothing else imports the client or calls
  `.rpc(`, `.auth.` or `.functions.invoke(`
  (`apps/mobile/test/serverBoundary.test.ts`). One folder rather than an
  `api.ts` per feature, so RPC names, error handling and offline behaviour
  can be read and checked in one place.
- Screens lay out; rules go in a pure `model.ts` (or `<thing>Model.ts`
  where a folder has several) tested without rendering, and state in
  `use*` hooks. `OrgWork` assembles `Ctx` from hooks of its own.
- The stream engines run outside React (`LanguageSession`, `OrgSession`,
  104); the hooks follow them.
- Folders by feature: `screens/` keeps only the entry files `App.tsx`
  registers, and each concern (auth, account, org, sync, audio, web,
  notifications, ui, shell, and the parts `simple/` held: recording,
  review, helps, admin, mic) gets a folder with its model, hooks, parts
  and anything it needs from `server/`. Pure files are `model.ts` or
  `<thing>Model.ts`; `*Core.ts` names go. The moves wait for the open
  recording and writing branches (pull requests 96 and 97) to land, so
  they rebase onto edits, not moves.
- The reasons: the logic that most often goes wrong (sign-in, membership,
  listing, sync wiring) is tested without rendering; a person or agent
  finds a feature's model, server calls and parts in one place; and every
  server call can be checked in one place, with a test keeping it there.

Reverse if: the thin server functions grow their own policy (retries,
caching) that callers then duplicate, which would argue for a typed
client per area with errors mapped once; or feature folders start
importing each other in a cycle, which would mean a shared layer belongs
below them.

Amended (2026-10-15, Carl Sauder): ESLint holds what may import what
(`eslint.config.mjs`, `npm run lint`, in CI's `checks` job and the
pre-push hook). Core imports nothing; sync only core and supabase-js (its
`src/testing`, Node built-ins too); nothing outside `src/server` imports
the Supabase client or supabase-js (types aside); nothing but `App.tsx`
and other screens imports a screen file; screens import no AsyncStorage,
SQLite, file system or event store; `model.ts` and `*Model.ts` import no
React, React Native, Expo, storage, `server/`, hooks or UI (types aside);
`src/server` imports no React, screens or shell; packages are imported by
their entry. Carl asked for it as strict as is reasonable: an audit after
the restructure found three feature models importing
`screens/configModel.ts` (now `src/config/model.ts`) and three screens
reaching storage themselves, which tests had not caught. React's
rules-of-hooks is on too; exhaustive-deps is not yet, since turning it on
means reviewing 55 effects whose re-runs would change.

Amended (2026-10-15, Carl Sauder): part two is done, earlier than planned.
Carl chose to make the moves while six pull requests were open rather than
wait for the three that overlap (96, 120, 126), so the moves are a codemod:
`scripts/restructure/moves.json` says where each file went and
`node scripts/restructure.mjs` makes the moves and rewrites everything
that names them, and can be run again. A branch made before the moves runs
it, commits, then merges `main`, so the moves meet themselves and only its
own edits are left to merge (`docs/merging-onto-the-restructure.md`). The
src root's files and `simple/` went to `shell`, `ui`, `sync`, `web`,
`audio`, `recording`, `helps`, `helpMode`, `mic`, `admin`, `invites`,
`work`, `map`, `account`, `auth`, `moderation`, `notifications`,
`diagnostics` and the existing feature folders; `recordingJournalCore.ts`
is `recordingJournalModel.ts`; `dev.ts` went to `auth/`, since `src/server`
may not import the shell. The passage record, the Map and reference
material had their rules moved out of their screens as config and content
had. ESLint now also holds `src/ui` as the design system, importing only
itself, `i18n`, `helpMode` and `shell/flow`, and keeps `src/server` from
the UI; `apps/mobile/test/folders.test.ts` keeps code out of the src root
and `simple/` gone.

Amended (2026-10-15, Carl Sauder): each file has one role, and its name
says which. Carl found the roles too loose once code was by feature: a
folder no longer said whether a file held components, hooks or helpers,
and about sixty files mixed them. Rather than go back to folders by kind,
the name carries the role: `screens/*.tsx` are screens; any other `.tsx`
exports components only (`eslint-plugin-react-refresh`); a `use<Thing>.ts`
file exports hooks only, with the contexts they read; `model.ts` and
`<thing>Model.ts` are pure, and never `.tsx`; `src/server/` holds the
server calls; every other `.ts` is a module, which exports no hooks.
`eslint-plugin-boundaries` holds which role may import which, for values
(types may come from anywhere): a component reaches the server through a
hook or module, a hook returns data rather than importing components, a
model or module imports neither components nor hooks, and a screen imports
no other screen, so the checks list the flow editor shows is
`checks/LanguageChecks.tsx`, no longer part of the checks screen. The split is a second codemod
round: the moved hooks and helpers are a hand commit that leaves
re-exports, and `movedExports` in `scripts/restructure/moves.json` repoints
every import of a moved name, on this branch and on any made before it.

Amended (2026-10-15, Carl Sauder): the codemod (`scripts/restructure.mjs`,
`scripts/restructure/moves.json`) and `docs/merging-onto-the-restructure.md`
are removed. Pull requests 126, 125, 123, 121 and 129 merged through it,
and the two still open from before the restructure (96 and 120) will be
redone on the new structure rather than merged across it, so no branch
needs them. Git history keeps where each file went. The layout and the
roles are held by `eslint.config.mjs` and `apps/mobile/test/folders.test.ts`.

Amended (2026-10-15, Carl Sauder): react-hooks/exhaustive-deps is on, as
an error, in the app. Carl chose to turn it on after seeing what it would
take: a hook that reads a value it does not list keeps that value from the
draw it first ran in, and agents write much of the code. Of the 55 hooks it
named, most only spelled their dependencies in a way the rule cannot read
(a method called on an object, a field of a value that is new each draw),
and now read them once instead; two read a value they did not list and
could show it stale (the source reader's language and whether it is
online). The rest list less or more on purpose, because the org and
language folds change their maps in place, because a counter is bumped on
cleanup, or because a key made of the inputs stands for them; each says why
after `--` on its disable comment, which lint now requires
(`@eslint-community/eslint-comments/require-description`), and a disable
that no longer excuses anything is an error.

Amended (2026-10-26, Carl Sauder): the reversal condition ("feature folders
start importing each other in a cycle") came true: 34 of the 41 folders in
`apps/mobile/src` formed one import cycle, because the folders every feature
stands on (`i18n`, `ui`, `helpMode`, `diagnostics`, `server`) imported
features back: `i18n` held a sheet drawn with `ui`, `helpMode` reported to
`diagnostics` and played through `audio`, `diagnostics` read the store in
`sync` and called `server`, and `server` used `auth`, `sync` and
`appVersion`. Carl chose a base layer below the features, held by lint
(`BASE_LAYERS` in `eslint.config.mjs`); feature folders may still import
each other. Lowest first: L0 `i18n`, `build` (the build id and whether it is
a test build); L1 `ui`, `helpMode`; L2 `session` (auth state, sign-out cause,
outcomes, the dev persona, the read-only flag) and `storage` (the on-device
store, stored files: formats, media type, hash); L3 `diagnostics`; L4
`server`. A base folder imports values only from its own level or below
(types from anywhere); features import any of them. What a lower layer needs
from a higher one is handed in once at start (`shell/wiring.ts`: how
diagnostics reach the server, how help audio reports) or sits lower:
`registerPlayback` is `ui/playback.ts` (audio re-exports it), the gate
around the transport is `sync/serverTransport.ts`, `watchRenewals` is
`server/renewalWatch.ts`, `inviteOutcome` is `invites/inviteOutcome.ts`, the
language sheet is `account/uiLanguage.tsx`, and which chrome a screen shows
is `shell/chromeModel.ts`, so `ui` imports no screen id as a value. The
layer is held, not only measured: no base folder is in an import cycle with
a feature folder; `ui` and `helpMode` still import each other, as the design
system's help badges always have. The phone lock's models
(`lockModel.ts`, `sealModel.ts`, decision 168) sit in `session/`, not
`auth/`, because `server/lock.ts` reads them.

Amended (2026-10-26, Carl Sauder): a screen may not import `src/server`
either. The role rules kept components from the server but not screens,
so `screens/globalViewer.tsx` verified codes, mapped their refusals and
paged organizations itself, and `entry.tsx` repeated sign-in's
diagnostics-and-terms tail in three handlers. Screens now reach the
server through hooks and modules (`auth/signInFlow.ts` and
`auth/useSignIn.ts`, `account/useGlobalViewer.ts`), and a screen that
builds an event goes through a named command (`org/orgCommands.ts`,
`config/configCommands.ts`) with the rules in a model. The same audit
gave server refusals one classifier (`diagnostics/refusalModel.ts`), so
callers stop re-reading `error.code`, the reverse-if above.

## 106. A phone records every take with the microphone module, keeps a part going down to half the cutoff, and keeps AAC

Date: 2026-10-14 · By: Caleb Koster · Status: partly superseded by 125

Reason: supersedes 13 in part. Decided 2026-10-12, logged as 106 when it reached main after the restructure. Recording on v3 felt flaky to Caleb, and v2's users had complained
of parts cut out. The detector was v2's unchanged (13), so the causes were
around it, plus one rule v2 had added in January (its #683). A replay of real
speech through `vadCore.ts` (the port of the native rules) showed the rule
at work: a real v2 recording played 3 dB quieter lost both of its parts.
Chosen, all on Caleb's word:
- **A part keeps going down to half the cutoff** (`sustainMultiplier: 0.5`,
  `src/recording/vadModel.ts`, both native modules and `vadCore.ts`).
  Starting still needs the cutoff; once a part is open, a frame above half of
  it counts as voice, for the pause and for the "too little to be speech"
  rule. v2 kept parts going at half the cutoff until #683 replaced that with
  one level for everything. In the replay nothing was lost; parts split a
  little less often, because soft sound fills some pauses.
- **A part too short to keep is said**: the module still deletes a part with
  under 250 ms of voice, and both workspaces now say so, and count it toward
  the "parts keep coming out clipped" hint (`useOnTooShort`).
- **The screen stays on while the microphone is recording**
  (`expo-keep-awake`), as v2 did (its #805). The recorder stops when the app
  leaves the foreground (45), so without it the screen timeout ended
  hands-free sessions. The microphone permission prompt no longer counts as
  leaving.
- **The microphone stays open while the source plays.** Playing the source
  pauses the detector only (`pauseVad`; the open part is kept, untrimmed),
  and when the source stops the detector starts again at once
  (`resumeVad`), with what was heard meanwhile dropped from its head start.
  Before, the recorder stopped and restarted from cold, which lost the first
  words said after the source. While a session holds the microphone,
  playback leaves the audio session in recording mode
  (`holdMicrophone` in `audioSession.ts`) and the source players keep the
  session active when they pause (`LISTEN_PLAYER`), which on iOS would
  otherwise stop the microphone.
- **A phone records hold-to-record takes with the microphone module too**
  (supersedes 13's second recorder on phones): the take is the module's own
  segment, opened as soon as the microphone is, so it no longer waits for
  expo-audio to prepare, and a phone never has two recorders open (Android
  before 10 lets only one capture at a time). Moss Doerksen made the same
  change in v2 on a branch that was never merged. A browser still records
  takes with expo-audio (MP4 where it can).
- **A phone keeps AAC.** A finished WAV is re-encoded to AAC in MP4 (mono,
  128 kb/s, hold-to-record's old bitrate) by the module (`encodeAac`:
  MediaCodec on Android, AVAudioFile on iOS) before it is stored: about
  0.96 MB a minute instead of 5.3 MB. The journal names the AAC copy before
  the WAV is deleted; if encoding fails the WAV is kept. The web keeps WAV.
  Every reader already takes both (58).
- Android reads whole 2048-sample frames from a 0.37 s buffer, and meter
  events no longer make the capture loop wait for the main thread, so a busy
  phone does not drop audio. The cutoff line and the level bars are drawn on
  one scale (`meterHeight`), so a bar reaches the line exactly when the
  detector hears it.
Reverse if: parts run together in noisy rooms (the room's noise reaching
half the cutoff; raise `sustainMultiplier`), AAC encoding fails or is too
slow on low-end phones (keep WAV there), or iOS stops the microphone during
source playback anyway (go back to stopping it, and restart with a larger
head start).

## 107. A template's books are divided where the template is made, as they are from the map, and making your own comes first everywhere

Date: 2026-10-14 · By: Caleb Koster · Status: accepted

Reason: Caleb opened Manage › Content Templates › New template ›
Scripture and found an older editor: a plain list of numberings (old and
new mixed), "Whole books" or "Chapters" for every book at once, and a book
that could only be renamed or removed. A partner (Spoken) chose "Book by
book" for a language and then saw only the ready-made ways when dividing
later. Dividing a book its own way (93) was reachable only from a
language's book. Divisions are the per-book `divide` of a Bible template
(74), so the template editor is a place to make them too.
- New template › Scripture asks what New language asks (80): the Bible the
  team translates from, the quiz, or the list, then how the Bible is
  divided (`useTranslate`, `TranslateQuestion`). The template starts as
  that way divides it (a `template@2`), with the admin's own name.
- The whole-Bible list puts "Divide it your own way" first, set apart
  (design principle 12). It is LangQuest's "Book by book": every book
  waits until someone reads it and chooses where its sections start.
- In the template editor each book says how it is divided ("FIA passages ·
  105 pieces", "Its own way · 17 pieces", "Waiting to be broken up").
  Tapping it opens the same page as from the map (`BreakUpBook`): your own
  way first (`DivideOwnWay`), then the ready-made ways, and "Rename or
  remove". There they change the template being edited (`apply`) rather
  than the language's, and Save publishes them; a template that languages
  use warns before a book divided before is divided again (`RedoSheet`).
  An older `template@1` keeps its "Divide into" choice until one book is
  divided on its own, which makes it a `template@2` with the same unit ids.
  Its numbering cannot be changed in the editor once books divide on their
  own: the ways are made per numbering (80).
- The own-way editor reads a Bible the team has; when the team has none
  (or the template has no team), LangQuest's shared Bibles in the team's
  language stand in (`useSources` `wholeBook`). A book's page shows the
  same words.
- A template is never named as the way its own books are divided, nor
  offered as a way to change itself (`wayNow`, `isItself`): a book divided
  its own way said "Book by book (Kara)".
- A language's template view lists books waiting to be divided, so they
  can be opened there.
- Content Templates and Choose a Template list LangQuest's ways once, in
  the language's numbering, and not its older `langquest.template.*`
  items (kept for the languages that use them) or the same ways in other
  numberings (`sharedTemplateShown`). Another organization's are listed as
  before.
Reverse if: admins need to make a template without any way to start from
(then offer an empty Bible template), or the numbering of a template must
change after books are divided (then convert each book's sections, as 80
does for a language).

## 108. A cluster is a name an organization puts on some of its languages, made while adding them, and never a level

Date: 2026-10-14 · By: Caleb Koster · Status: accepted

Reason: Spoken made a "Spoken Worldwide" organization, then had to make a
second organization, "Dar Khamsa Cluster", for the five languages of one
cluster, because nothing grouped languages. They want everything under the
one organization, and to be asked while setting up whether it is one
language or a cluster, so they can start work on one language or several.
Caleb asked for clusters as tagging and organizing, made when needed, that
do not reorganize the organization and language streams (2026-10-14). So a
cluster is two organization-stream registers (`core/org.ts`):
`v1.ClusterNamed { clusterId, name }`, its name, and
`v1.LanguageClusterSet { languageId, clusterId, inCluster }`, one per
(language, cluster). It is a tag: a language may be in several clusters or
none, two admins tagging offline both land, and a cluster no language is in
any more is gone (`orgClusters`). It is not the project level decision 34
took out, and not a scope (decision 63): no stream, no membership, no
settings and nothing on the server reads it; a phone pulls nothing more.
Grouping is the organization's to do: both events need Manage structure at
org scope, as adding a language does. Screens (demo ADR-045): New language
asks "What are you adding?" with One language picked; one language can
join a cluster, made right there; a cluster takes a name and its languages,
new ones and ones already here, and asks the usual steps once for the new
ones, each of which then owns its copy (decision 91). Manage lists clusters
above the languages in none; a cluster's page shows its languages and their
progress together, adds a new language or ones already here, renames and
ungroups it; a language's page names its clusters and More › Cluster
changes them; All languages on the Map tab filters by cluster. The Reports
dashboard on the web (decision 57) picks all languages, one cluster or
those in none, sums each cluster in Overview, and names a language's
clusters in its row, its page and the CSV; the device filters the rows the
server sent with its own fold of the organization, so the server still
knows nothing of clusters. Inviting stays per language: after a cluster,
the invite offers its new languages as chips. Not built: inviting to every
language of a cluster at once, and settings shared across a cluster.

Reverse if: organizations need a cluster to carry people or settings for
all its languages (an invite or a template for the cluster); then a cluster
gains its own recommendations as the organization has (decision 62), still
not a stream. Or if people put each language in one cluster only and
several clusters confuse them; then the picker becomes a single choice,
with no change to the events.

Amended (2026-10-20, Caleb Koster): Manage no longer lists a cluster as a
row among the languages. Caleb found it confusing that cards under the
"Languages" heading named clusters. With clusters, the organization's home
groups its languages under them instead: one card per cluster with a
heading in amber (its name, how many languages, a chevron that folds them
away and a ⋯ that opens the cluster's page), then "Not in a cluster" in
grey over the rest. A language in two clusters is under both. Groups start
open while the organization has 20 languages or fewer, closed past that,
and each keeps what it was toggled to across Back; a long group shows 20
rows at a time. With no clusters the list is one list, as before. Map and
Reports keep their cluster chips: they filter one list, so nothing there
reads as a language (`clusters/model.ts` `languageGroups`).

## 109. A listening app keeps playing the approved version, hears changes by webhook, and the team sees its listeners on the passage

Date: 2026-10-14 · By: Ryder Wishart · Status: partly superseded by 131

Reason: Ryder asked for the whole EveryBible loop for a stakeholder demo:
a recorded passage goes out for review, reviewers hear it in EveryBible,
approved and published chapters reach every listener, listener feedback
keeps flowing back to the team after publication, and listeners see when a
chapter was updated and its history (meetings of 2026-10-12 and 13 with
Skyler, Caleb and Carl). Changes in one app should show in the other as
fast as possible. The pieces, none of them a new event:
- **The approved version's audio.** The passage API's `approvedAudio`
  include (`view.ts`, needs `read`) gives `approvedVersion`'s cards beside
  `version`'s. A listening app that published version 2 keeps playing it
  while version 3 is in review, instead of dropping the chapter. This is
  the "explicit version read" the unmerged prototype entry of 2026-10-08
  named as its reverse condition. With `read:published` alone, `audio` is
  already the approved version, so the include is refused there.
- **The listening side, in EveryBible's repository.** Its bridge Worker
  registers a webhook (101) when its studio opens, reads the change feed
  after its own cursor and re-reads only the passages named, keeping each
  language in its Durable Object. Phones and the studio hold a WebSocket
  and re-read the catalog when told something changed: about 300 ms from a
  LangQuest change to a phone in the local round trip. Publishing stays
  the team's explicit choice per chapter in the studio (James asked for
  confirmation before publishing). Once a chapter is published, a newer
  version LangQuest approves replaces it on every phone, and the bridge
  reports both releases (`v1.VersionReleased` live and taken down, 72).
- **The team's view.** A passage's Listeners section (`passage.tsx`) lists
  where a version is live (`releasesOf`) and each listener review, newest
  first. Feedback given by link or partner app shows the listener's typed
  name (`feedbackSource`), and its voice clips play where the translator
  answers it.
- **Testing it.** `server/listeningDemo.ts` (`npm run listening:demo`)
  serves the partner API, reducer, change digests (`digestOf`) and webhook
  signatures over a local append-only log, with `/demo/record` and
  `/demo/approve` for the translator's side. EveryBible's
  `scripts/listening-roundtrip.mjs` drives the whole loop against it.
Reviewers in EveryBible still unlock with one shared code; listener
feedback is `listener` kind and never clears a step (72).
Reverse if: teams want approval alone to publish a chapter (then the bridge
publishes on approval, per language), reviewers need their own accounts
(then tie EveryBible sign-in to a LangQuest review link or role), or the
change feed and webhooks prove too slow for live listening (then push from
the organization's Durable Object directly).

## 110. A checkpoint from an older reducer is dropped with its stream's cursor, so the phone fetches the stream again

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

## 111. Whoever gave a review or added a note can take it back, as a new event, and the record keeps the review crossed out

Date: 2026-10-15 · By: Caleb Koster · Status: accepted

Reason: Spoken's tester approved a peer check by accident and found no way
back (LAN-84). A review was grow-only with no inverse: its toast had no
Undo, the record stopped offering the check once it was approved, and only
a moderator's redaction (48) could remove it. Caleb asked for approval to be
undoable, and for the other actions people would want to take back. What
was built:
- **Two events, the shape `v1.RequestWithdrawn` already has.**
  `v1.ReviewWithdrawn { reviewId }` and `v1.NoteWithdrawn { noteId }`,
  add-wins (`withdrawnReviews`, `withdrawnNotes` in `RecordState`). Nothing is
  deleted: the log keeps the review, and `derivePassage` leaves it out of
  every status, so the check is open again, a request it answered is open
  again (back on the reviewer's My Work), feedback stops waiting on the
  translator, and a checkpoint it cleared holds the steps after it again.
  Inbox rows follow, since they are derived (`updatesFor`).
- **Only the author.** A withdrawal counts only when its actor is the
  review's or note's own author (`withdrawnBy`), so a refused or stray one
  changes nothing on a phone, whichever arrives first. The server's
  `may_emit` refuses anyone else's, and one for a review or note it has not
  seen (`20261015220000_withdraw_reviews_notes.sql`, `server/grantsSmoke.sql`
  10b). Removing someone else's words stays a moderator's redaction (48).
- **Where Undo is.** The toast after Looks good, Send feedback, a logged
  check, a back translation and every note. Later: on your own check in its
  step sheet, on your own review's page, and on your own review or note in
  the history. A review taken back stays in the history and on its page,
  crossed out, "undone just now"; a note taken back shows nowhere. No words
  were added to explain any of it (Caleb's rule for this work).
- **A study step marked done** already had a register (`v1.StudyStepMarked`),
  so its Undo after the toast is the same event with `done: false`.
Reducer version 17: the state has two new maps.
Not given an Undo: publishing a version (the "Delete a version" work,
LAN-83, takes that), withdrawing a request or bringing back a set-aside
check (both are two taps to do again), declining a join request (the person
can ask again), renames and library publishes (done again the same way), the
license (final by design, 38), and a key term tie (grow-only, its own topic).
Reverse if: teams need someone else (a coordinator) to take back a
reviewer's verdict, then add a privilege for it beside Override checkpoints;
or a verdict taken back must disappear from the history too, then show it
only to its author.

Amended (2026-10-16, Caleb Koster): on the recording screen and in back translation, Undo is two arrows by the red button, not a toast (decision 133).

Amended (2026-10-16, Caleb Koster): no toast offers Undo anywhere (decision 134); History, the step sheet and the review page keep theirs.

## 112. Diagnostics reach us without waiting on a stuck upload, cover sign-in, recording and the server's own jobs, and stay counts and codes

Date: 2026-10-15 · By: Carl Sauder · Status: accepted

Reason: Carl asked for an audit of what field diagnostics (39) can and
cannot see after the features added since, and for every gap it found to be
closed (2026-10-15). The worst gap was delivery itself: records went out
only after a language sync with no upload waiting, and uploads retry for
ever, so one file the server always refuses (a 413 over 50 MB, a 403 after
removal) kept every record on the phone that support most needed to hear
from; and a phone that never opened a language (no organization yet, a join
request waiting, stuck on the organization stream) never sent anything.
Now records also go when every waiting upload has failed at least once,
after a refused sync, when the organization stream settles and on sign-in.
The rest made failures that were invisible or mislabelled readable, still
within 39's rule that a record is measurements and code-written tags:
- `sync` says why work was rejected, separates a sign-in that could not be
  renewed (a rate limit, a 5xx, a captive portal: it read as offline) and
  carries an error's SQLSTATE or PostgREST code and where it failed;
- `load` says why a fold ran and splits reading from folding; `checkpoint`
  and `open` (first full pull) are new; `snapshot` says why it was fetched;
- `transfer` names its source (guide media, hand-over, streamed play, source
  audio, help, study files were untallied) and the Worker's refusals by
  meaning (401/403, 404, 413, 422), and a file gone before upload;
- `device` adds lost files (92), unsent and unrecoverable recordings, the
  oldest unsent recording, the streams and events held, and the
  diagnostics queue, including records dropped past its bound;
- `error` takes a fixed code (a recorder's `nospace`, a SQLSTATE);
- `expected` tallies per hour what `noteExpected` saw (it only logged), by
  where, class and code; `audio` tallies recording and playback per hour per
  language; `auth` records sign-in, renewal, a sign-out the person did not
  choose, invites, hand-over and the account outbox, never a name, an email,
  an invite or the other person on a shared phone.
On the server, jobs that leave nothing support can read (push delivery,
projection passes, the v2 import, webhooks, invite email, Worker errors)
write counts to `diag.job_runs` through a service-role function, and
`diag.jobs()` flags a job whose last success is too old; `npm run diag` gains
`org`, `person` and `jobs`. Messages are still never kept: they can quote
what someone typed. Turned down: accepting records before sign-in with the
public key (an abuse and privacy cost for a gap that sign-in closes), native
error codes from the microphone module (a native build; the JS side maps its
texts to codes), and a third-party tracker for the Workers (39's reasons
stand). Reverse if: the volume of `expected` or `audio` records outgrows the
5000-a-day cap per install, or Play's Data safety review reads recording and
sign-in outcomes as more than "App info and performance".

## 113. No event may use a name every object already has

Date: 2026-10-15 · By: Carl Sauder · Status: accepted

Reason: the fold keys its maps by the ids in events (`state.takes[takeId]`),
and a security audit showed that a member with `translate` could push
`v1.TakeArchived { takeId: "__proto__" }`: both validators passed it, and
folding it set `archived` on Object.prototype, so every object on every
phone in that language, and in the projection worker, changed, on every
refold, for good, since the log is append-only. Now no string or key at any
depth of a payload, and no envelope field, may be one of the names a plain
object answers to (`OBJECT_MEMBER_NAMES` and `objectMemberNameIn` in
`packages/core/src/validate.ts`; SQL `_names_object_member`, migration
20261016020000). The fold runs `validateEvent` first, so an event like
that already in a log is folded out as invalid. Checking every string, not
only the fields that are ids, holds future event types without a list to
keep; the cost is that a note or comment that is exactly one of these
words, such as "constructor", is refused, while a longer text holding one
is not. Turned down: maps without a prototype (`Object.create(null)`),
which every snapshot load would need to rebuild, and checking only the id
fields. The parity script tries each name in every string field and as a
key; tests `packages/core/test/objectMemberNames.test.ts`, server smoke 5e.
Reverse if: a real text payload that is exactly one of these words is
refused in the field; then check only the fields the folds use as keys.

## 114. How someone joined is the server's to say

Date: 2026-10-15 · By: Carl Sauder · Status: accepted

Reason: `v1.InviteIssued` and `v1.JoinDecided` were open through
`append_events` to anyone holding `invite_members`, though only
`issue_invite_v3` and `decide_join_request` append them, as the server.
A security audit found that `_joined_by_consent` counts any accepted
`JoinDecided` naming a person as their consent, and `may_help_sign_in`
lets a helper issue a sign-in code for a looked-after account that joined
by consent, so an organization's admin could forge the consent that rule
asks for. Both are now server-only, as `v1.InviteRedeemed` was: null in
core's `EVENT_PRIVILEGE` (`packages/core/src/org.ts`) and in SQL
`event_privilege` (migration 20261016030000). The RPCs keep their own
`invite_members` checks and are unchanged; no client emitted either event.
Server smoke: a lead's own JoinDecided and InviteIssued are refused.
Reverse if: a client must issue invites or decide requests offline; then
`_joined_by_consent` must instead require a matching row the server wrote.

## 115. An event is at most 64 KB, and an account creates at most 5 organizations a day and 20 in all

Date: 2026-10-15 · By: Carl Sauder · Status: partly superseded by 169

Reason: a security audit found that `append_events` limited a push to 500
events (invariant 12) but not their size, so one member could push notes
of many megabytes that every phone in the language must download and fold,
into a log that never sheds them, and that any account could create
organizations without end. Now, for signed-in callers, a payload as
Postgres prints it is at most 64 KB and each envelope field at most 256
characters (`eventSizeError` and `jsonbTextBytes` in
`packages/core/src/validate.ts`, SQL `_event_size_refusal`, migration
20261016040000). A recording's cards, the largest real payload, take about
120 bytes each. The app refuses to record a bigger event
(`EventTooLargeError` from `SyncClient.append`), since kept it could never be
sent; the fold does not check size, so nothing already in a log changes
meaning. The creation of an organization, the first event of one nobody has
written to, is refused once its author has created 5 in the last day or 20
in all (`org_bootstraps`, `_org_creation_refusal`); the service role's
imports and seeds are exempt. Turned down: a quota on events per day, which
would refuse a phone pushing weeks of offline work at once, and a size
measured differently on each side, which would refuse at the server what the
app had recorded; the parity script holds the two measures together on
either side of the limit.
Reverse if: real work needs a bigger event (then split it, as cards are), or
someone legitimately runs more than 20 organizations (then raise the
allowance for that account rather than for everyone).

## 116. An event goes on the kind of stream it belongs to

Date: 2026-10-15 · By: Carl Sauder · Status: accepted

Reason: `append_events` asked whether the author held an event's privilege,
not whether the event belonged on that stream. A security audit found that
an organization's events (`RoleDefined`, `MemberAdded`, `InviteIssued`)
could be written into a language's stream by someone holding the privilege
there, past the grant checks that run only on the organization stream
(`_grant_refusal`), and a language's events into the organization stream.
The folds skip foreign types, so they did nothing yet, but a later fold or
report that read them would have believed them. Now, for signed-in callers,
the organization's events (core `ORG_EVENT_TYPES`, SQL `_org_event_types`)
go only on `_org`, every other event only on a language's stream, and
`v1.Redacted` on either (migration 20261016050000; the parity script holds
the two lists together; server smoke 5f). The service role's imports keep
their own rules.
Reverse if: an event needs to live on both kinds of stream; then list it
with `v1.Redacted`.

## 117. A stream's pokes reach only those who may read it

Date: 2026-10-15 · By: Carl Sauder · Status: accepted

Reason: `events_notify` broadcast each push's poke on a public Realtime
channel, `events:<org>/<stream>`, on the reasoning that a poke says only
that a stream moved. A security audit pointed out that anyone holding the
publishable key and a stream's name, and organization and language ids are
not secret, could still watch when and how much a language works. The poke
is now private: a policy on `realtime.messages` lets a signed-in person hear
a stream's channel only when `can_read_stream` says they may read it, asked
through `may_hear_stream`, which answers only for the caller (migration
20261016090000), and the phone joins with `private: true`
(`packages/sync/src/supabaseTransport.ts`). Checked on the local stack: a
member hears the poke and a stranger is refused the channel. An app from
before this change subscribes to the public channel, hears nothing, and
falls back to its poll until it updates.
Reverse if: joining private channels costs phones on weak links noticeably
more than public ones did.

## 118. A Worker request needs a session that is still live

Date: 2026-10-15 · By: Carl Sauder · Status: accepted

Reason: the Worker verifies access tokens itself (`getClaims`), and a
verified token stays valid until it expires, an hour, after its session is
gone. A security audit found that a lost phone signed out from another
(`sign-in-code`'s "sign out my other phones"), or a deleted account, kept
reading recordings and reports, and could mint API tokens, until then. Now
`profileOf` also asks `session_is_live` for the token's `session_id`
(migration 20261016100000), remembering the answer for 30 seconds per
isolate so a run of blob requests asks once (`apps/web/worker/liveSessions.ts`).
When the question cannot be answered, the verified token stands: a
database hiccup must not sign every phone out.
Reverse if: the extra query shows in the Worker's latency; then ask only on
the routes that mint credentials or change data.

## 119. Sync status that ticks is a store of its own, read where it is shown, not part of `ctx`

Date: 2026-10-15 · By: Carl Sauder · Status: accepted

Reason: every screen gets `ctx` (`apps/mobile/App.tsx`), and the native
stack keeps every screen under the top one mounted. `ctx` was a new object
on every render of `OrgWork`, and `OrgWork` rendered whenever a sync or
transfer counter moved, so one file arriving redrew every mounted screen and
re-ran their derived views. Each arrival also copied the set of files on the
phone (61,000 for a big language) to publish it (performance-audit-app.md
R1, R2). Now the counters that tick while syncing (`pending`, `lastSync`,
`pendingUp`, `pendingDown`, `peakUp`, `peakDown`, `present`, the
organization's `pending`) live in a `StatusStore` per session
(`src/sync/syncStatusStore.ts`), read with `useSyncStatus()` by the
components that show them. `ctx`, the language and organization handles and
`blobs` are memoized. Fields that change rarely (`online`, `refused`,
`pulled`, `live`, `revision`, `keptUnits`) stay on `ctx.language`. The
stack freezes blurred screens (`freezeOnBlur`), so audio stops on the
navigation `blur` event rather than on a render. The session reads the file
set in place, tells screens about it at most every 500 ms
(`FILE_NEWS_MS`, `packages/sync/src/languageSession.ts`), reclaims storage
at most that often, and keeps one offline-scope `Set` per fold revision,
which core's plan cache finds by identity. A scope `Set` is never changed
after it is handed to core. Turned down: `React.memo` on every screen (each
needs stable props from callers, and a new `ctx` defeats it anyway).
Reverse if: a screen needs a ticking value to decide what to draw on every
change; read it with `useSyncStatus()` there, rather than putting it back
on `ctx`.

## 120. Passage views are patched per published copy from a change log kept outside the state

Date: 2026-10-15 · By: Carl Sauder · Status: accepted

Reason: the app publishes a shallow copy of the live state after each fold
change (`stateCopier`), and the derived views were cached by state identity
and revision, so every copy re-sorted every take, request and note and
re-derived every passage: 41 ms at 5,000 passages on a laptop, several
hundred ms on a slow phone, after each recording (performance-audit.md item
10, performance-audit-app.md C1). Now, while a view is watching a live
state, the reducer records what each event may change
(`packages/core/src/changes.ts`, `touchedBy`): specific takes, reviews,
departures, requests, notes and passages, nothing, or `all`. The app
publishes with `publishedCopy`, and `recordIndexes` and `indexesOf` build a
copy's views from the previous copy's, re-deriving only touched passages.
The log lives in `WeakMap`s beside the state, never in it or in a snapshot,
and holds at most 1,000 entries; past that, or after any `all`, the next
view rebuilds in full. Any event type not checked against the views is
`all`, the default for new types. `packages/core/test/incrementalViews.test.ts`
holds patched views equal to a full rebuild for every fixture event in
random order. One new take: 2.0 to 2.6 ms instead of 43 at 5,000 passages
(`npm run bench:core`). Equal clocks in `highlightsFor` and `updatesFor`
are now ordered by id. Turned down: maintaining every view per event (too
much to keep correct) and caching passages by a hash of their inputs (about
as costly as deriving them). Reverse if: the views start reading state the
touch rules do not follow (a passage view that reads `recordings`, say)
and keeping `touchedBy` in step costs more than the rebuild it saves.

## 121. The Worker trusts a verified token, and a file-access answer, for up to a minute per isolate

Date: 2026-10-15 · By: Carl Sauder · Status: accepted

Reason: the hosted project still signs with the legacy shared secret, so
`getClaims` (44) asks Supabase Auth about every request, and every audio
file also asked Postgres `blob_access`: two serial round trips per file, for
a phone downloading tens of thousands (performance-audit-app.md V1). Each
isolate now remembers a verified token's claims, keyed by the token's
SHA-256, until the token expires or 60 s pass, and still asks whether its
session is live on every request (118's check and its 30 s cache are
unchanged, so a signed-out phone loses access as 118 says), and each `blob_access`
answer per person, organization, stream and mode for 60 s (a refusal for
10 s); library media in an organization's own stream is per file, as
`_library_media_readable` decides it (`apps/web/worker/isolateCache.ts`).
Both are bounded to 5,000 entries. A member who is removed may keep
opening files from an isolate that already answered for them for up to a
minute; Carl accepted that. Moving the hosted project to
asymmetric signing keys, so tokens are checked without Auth, is a separate
step to take through the repo's Supabase config (`docs/cloudflare.md`).
Reverse if: a removal must cut access at once (a takedown, say); then drop
the access cache, or clear it from the event that removes the member.

Amended (2026-10-26, Carl Sauder): three more answers are kept per isolate,
on the same terms (performance-audit-2026-10-26.md item 10). The agent API's
token records, keyed by the token's hash, for 15 s, so a revoked token can
still be used for up to 15 s from an isolate that already read it, and the
last-used write no longer holds up the response (`ctx.waitUntil`). A
person's organizations, for the reports route only, for 30 s, so someone
removed from an organization may read its reports for up to 30 s; /connect
and links still ask each time. Agent reads trust the organization's stream
heads for up to 3 s and pull only when a head moved past what the object
holds; writes and the read after a write still pull. Reverse if: as above,
or an agent must see another writer's work within a second.

## 122. Inactive Inbox rows are deleted 30 days after they went inactive

Date: 2026-10-15 · By: Carl Sauder · Status: accepted

Reason: `reconcile_notifications` (68) marks a row inactive and never
deleted it, so the table only grew, the pass scanned it per language, and a
phone's Inbox read walked the dead rows (performance-audit-app.md V3). Rows
now record when they last changed (`changed_at`), and a daily pg_cron job
(`langquest-purge-notifications`) deletes rows inactive for 30 days, except
any a push receipt still names. A phone learns a row went away from the
inactive row itself, so one whose Inbox copy has not refreshed in 25 days
starts it over from cursor 0 (`INBOX_COPY_MAX_AGE_MS`,
`apps/mobile/src/notifications/notifications.ts`). Partial indexes serve
the reconcile's language and organization cases. Migration
`20261016120000_notifications_indexes_and_purge.sql`, smoke
`server/notificationsSmoke.sql`. Reverse if: someone needs Inbox history
older than a month (an audit of who was asked what); then archive rows
before deleting them.

## 123. Screens most people never open load when opened, and the web budget measures a first visit

Date: 2026-10-15 · By: Carl Sauder · Status: accepted

Reason: `App.tsx` imported every screen module, and Expo's Metro config
turns inline requires off, so a phone ran all of them before the first
frame: Reports' d3-geo, world map and 13 country-name tables among them,
though phones never show Reports. On the web the export was one file, its
budget raised four times (4.8, 6, 6.1, 6.25 MB) and nearly spent
(performance-audit-app.md S1, S2). Now Reports, Config, Org, Content,
Checks, Sources and Reference are `import()`ed the first time one of their
screens opens (`lazyScreen`, `apps/mobile/src/shell/lazyScreens.tsx`); the
screens on the way to recording stay in the main bundle. The web export
gives each its own file; a phone keeps them in its one bundle. Inline
requires are on for native only (`metro.config.js`): on the web they added
110 KB to the entry file, which a browser parses whole either way. Once the
organization's first sync has settled, the web fetches the lazy files in
the background (`usePrefetchLazyScreens`), so work still continues offline
once the app is open (58); a file that fails to load reaches the error
boundary, and the next open tries again. `apps/mobile/scripts/export-web.mjs`
holds two budgets: 5.7 MiB for the files `index.html` loads (5.41
measured, 6.21 before), and 6.5 MiB for every file together (6.26 once
main's security fixes and field diagnostics merged in; the cap only catches
growth that runs away, and the first-visit budget holds what a visit pays). Help
audio now waits for that first sync, an idle screen, and Wi-Fi or a cable
(`useKeepHelpAudio`), and `/i18n/*` is cached for a year, since the app
asks for it with `?v=<build>`. Turned down: splitting the country names by
language (`countryName()` is synchronous; they now ride in the Reports
file). Reverse if: a lazy screen's first open is slow enough for people to
notice on the slowest partner phone, or the web's background fetch competes
with a first sync on slow links; then move that screen back, or fetch later.

Amended (2026-10-26, Carl Sauder): both budgets lowered, to 3.9 MiB for a
first visit and 4.75 MiB in all. lucide's entry re-exports every one of its
1,800-odd icons and Metro does not shake out the ones no file uses, so the
main file carried 1.5 MB of icons for the 91 the app draws. Icons now come
one file each through `apps/mobile/src/ui/icons.ts`, and lint refuses the
package's entry elsewhere (`noIconBarrel`, `eslint.config.mjs`). A first
visit went from 5.70 to 3.71 MiB and every file together from 6.54 to 4.54
(performance-audit-2026-10-26.md item 1). The budgets keep about 5% of
room, as above, so the space is spent on purpose rather than by drift.

## 124. You choose where the next part is recorded, a whole thing asks before it is deleted, and a deleted version is a tombstone

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Spoken's tester could not find how to delete a version or a part,
or how to say one part again (LAN-83). On a phone at half split the parts
were hidden behind "drag up to see them", and with verse numbers a part's
delete was only in the menu a hold on its number opens. Caleb's rules: no
sentences explaining the screen, the layout carries it; recordings are
parts. What was built:
- **Parts and where the next goes.** The parts card shows at every size
  (closed when the pane is small; opening it gives the recorder the room),
  named "Version N" while its parts are still that version's. Every part has
  a bin. The person taps where the next recording goes: a gap (verses left
  out, decision 82, or a deleted part's place), a part (what is said next
  replaces it, with Undo), or the end, which is lit by default and dashed
  otherwise. The chosen place is tinted with a purple microphone and the
  footer names its number; the red button records there. A deleted part's
  place stays open and chosen, numbered and with its verses; the first part
  said in a place takes its verses and the rest join them
  (`workspaceModel` `slotRows`, `targetNumber`; `screens/translate.tsx`
  `aim` and `hole`; `recording/slots.tsx`). The amber "left for later" row
  and "Record here" are gone, as are the lines "These are Version N's
  parts…", "drag up to see them", "Tap the red button and speak…" and "No
  drafts. Edit a version below…".
- **Asking first.** Deleting a whole version, a draft or every part opens a
  sheet ("Delete Version 2?", what it holds, Delete or Cancel;
  `ui/ConfirmDelete.tsx`) instead of a toast whose Undo runs out. One part is
  still deleted at once, with Undo.
- **A deleted version is a tombstone.** Whoever published a version can
  delete it (`canDeleteVersion`, `deleteVersion`). No new event:
  `v1.TakeArchived` on the submitted take, add-wins, with the first archive's
  clock and actor kept (`Take.archivedAt`, reducer version 18). A reviewer
  may have the version offline and check it a month later, so the version
  keeps its number (`nextVersionN` never reuses one), and checks of it, before
  or after the delete arrived, are kept in `reviewsOfDeleted`: shown in the
  history and on their own page, marked "Version N deleted", and counted for
  nothing (status reads only `reviews` of versions not deleted). Its page
  still opens, as what it was.
- **Recording view.** While recording, the pane below the divider is the
  red recording view, in the workspace and in back translation alike
  (`recording/RecordingView.tsx`, which replaces the back translation's
  `VadTakeover`): the part being said with its verses, the time, a check
  (Done; a cross read as throwing it away) and the live waveform, which the
  "Recordings getting cut off" work (LAN-82) owns (`LiveParts.tsx`). Its
  sensitivity line and pause chips went with it.
Rejected: a new `v1.VersionDeleted` event (an archive is already the
tombstone, and the server accepts it from translators); letting anyone with
a role delete someone else's version.
Reverse if: teams lose work by deleting versions others were relying on
(then deleting would need the checks to be withdrawn first, or a role), or
people miss the end of the list as the default place to record.

Amended (2026-10-16, Caleb Koster): one part is deleted at once with no toast; the recording screen's Undo arrow brings it back, and also a whole set of parts deleted after asking (decision 133).

Amended (2026-10-16, Caleb Koster): one part is deleted by sliding its row
aside and tapping the bin it shows; the rows have no bin of their own
(decision 136).

## 125. Parts split by the room and the voice the microphone hears, nothing said is thrown away, and there is no microphone setup

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Spoken's tester found parts of what she said cut off (LAN-82).
Supersedes 71's microphone setup by ear (demo ADR-037) and, of 106, the
sustain rule and the "too short to keep" message. The detector decided what
to keep: a part started only when a frame passed a fixed cutoff (0.1, about
-20 dB, unless setup had been run), kept about 0.2 s before that, cut half
the pause off its end, and threw away a part with under 0.25 s above half
the cutoff. Setup measured the room for 3 s, never the voice, and its floor
(0.04) was what most rooms got. A real v2 phone recording's speech is
mostly quieter than -20 dB; in the web app, 40 s of speech 6 dB softer made
no part at all. Replaying real speech through both rules: today lost 2.7 to
3.9 % of a drafting session (soft starts, one-word answers) and all of it 6 dB
softer; the new rules lost none. Chosen with Caleb after the report and the
live demo (2026-10-16):
- **Where parts split, not what is kept.** `modules/microphone-energy/src/splitter.ts`,
  ported line for line to `Splitter.kt` and `Splitter.swift` (the three give
  the same parts on the same frames). It learns the room (the quietest
  3-frame median of the last 8 s; exact zeros from a microphone starting are
  not the room) and the voice (the loud end of each part said). A part
  starts at a frame halfway from room to voice, or after 0.3 s of sound out
  of the room; its head reaches back to where the sound rose out of the room,
  up to 3 s, never into the part before. It ends after the pause (1 s,
  growing to 1.5 times the person's own mid-speech pauses, up to 2.5 s) and
  keeps 0.3 s after the last sound. Only sound shorter than a syllable
  (0.12 s: a tap, a bump) makes no part, and nothing is said about it.
- **Nothing to set.** The room, voice and pause are kept on the device
  (`mic-heard:v1`, `src/mic/heardLevels.ts`) so a session's first words are
  judged right. Microphone setup (its screen, Me's row, the workspace link,
  the "parts are coming out very short" box) is gone; so are the cutoff line
  and pause chips (already gone with 124's recording view).
- **What is heard shows while recording.** The live waveform boxes each part
  with its number from the moment it starts (`recording/LiveParts.tsx`,
  built here and carried by 124's PR), with the room as a faint band and
  sound kept in no part shown as not kept; two fingers pinch it nearer or
  farther (about 2 s to 30 s; the bars only grow or shrink).
- **Tapping stop keeps the last word.** A tapped take runs on until the voice
  falls back to the room, up to 0.6 s.
Considered: keeping setup as a fallback (v2's settings were too technical,
and a wrong setting can no longer lose anything, only change where parts
split); recording the whole session and cutting it when the person is done,
with box edges dragged and parts dropped before that (shown in the demo,
left for its own change); a third-party audio library (v2's FFmpegKit was
retired in 2025).
Reverse if: parts run together where other people talk nearby (their voices
are out of the room), taps or bumps start parts often, or a phone's frames
are so long that the head reaches too far (iOS can tap 100 ms buffers; the
splitter counts in that phone's own frames).

Amended (2026-10-16, Caleb Koster): a part is now sound out of the room that a
speech model also calls speech, and the room is how loud it usually is rather
than the quietest moment, so a cafe or a fan is not boxed (135). Without the
model the rules above hold exactly.

## 126. Due dates are gone

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Caleb asked on 2026-10-16 to get rid of the due date feature across
the app. Nobody sets one any more: "Ask someone" has no "By when" section,
no date chips and no typed date. Nothing shows one: My Work's rows and Next
for you read "asked by {name}", Waiting on others lists newest first, the
Inbox body is the passage and its language, the passage's path and its step
rows say only who asked, History shows a request as open, done or
withdrawn, and the review banner reads "{name} asked". Reports replace the
"Overdue requests" tile with "Open requests" (the count of open requests,
still opening the Map filtered to waiting passages), the CSV exports drop
the "Overdue requests" column, and the agent API's requests no longer carry
`dueDate` (`docs/agent-api.md`). Stored data is unchanged: `v1.RequestMade`
keeps its optional `dueDate` in the schema, the validator and the server's
checks, so old events still sync, and an old request's date is simply not
shown. The reports API still sends `attention.overdueRequests: 0` (and the
report version is 5), so an app built before this shows 0 on its old tile,
not NaN. Removing the field from stored events is left for Caleb to decide.
Reverse if: teams need deadlines on requests again; then bring back setting
and showing `dueDate`, which old events still hold.

## 127. What people make has no Save button: it is kept as it is made, private until Done, and Done sends it on

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-15): "It's strange that we would have a save button.
Everything should be automatically saved", with a spinner turning into a
check to show it, and what people make should be "saved but only accessible
by the creator while unpublished, and once published, accessible to
others." He also asked for something clearer than Publish, with the
easiest next step being to send the work to the preferred people for its
next check. The app had about twenty Save or Publish buttons and four
"Leave without saving?" dialogs; a recording's parts were already kept as
they were made (decision 83), while a review in progress, a note being
typed or an editor's changes lived only on the screen. Chosen:
- **The saved mark.** `apps/mobile/src/ui/SavedMark.tsx` sits in a
  header or sheet: a spinner while something is being kept, then a check
  (`useSaveStatus`, at least 600 ms of spinner so the change reads), a
  warning when it failed. It explains itself in help mode.
- **Drafts on the phone, only for their maker.** `apps/mobile/src/drafts/`
  keeps what someone is making in AsyncStorage as it changes
  (`useDraft`, written 400 ms after each change and when the screen
  closes; keys from `draftKey` always name the person, so a shared phone
  never shows one person's draft to another and account deletion removes
  them). Used for a review in progress (answers, voice, moments, who
  listened), notes, key words, a back translation's notes, what is said on
  Done, and the template, flow, material, guide and divide-your-own-way
  editors. A recording's parts stay on the record as before (decision 83).
  No new event: an unfinished thing is not on the record.
- **Finishing is named for what it does for others.** The recorder's and
  back translation's Publish is now Done; a note's button adds it; a
  review's verdicts are unchanged and "Save to the record" is Done; an
  editor's Save or Publish is Done. Leaving keeps the draft, so every
  "Leave without saving?" is gone.
- **Done sends it on.** Done opens one last look at the version (hear it,
  say what changed) whose main button asks whoever usually does the check
  that comes next ("Ask Rebecca Nyibol"), publishing and asking in one
  write with Undo taking the asking back; "Someone else" and "Send later"
  finish it too. `nextAfterDone` (`passage/recordModel.ts`) works out that
  check before publishing, as the record will after it: feedback the new
  version answers goes back to its reviewer, a back translation once made
  is done. The "Version N published" page after publishing is gone, since
  asking happened on Done.
- **Shared settings keep their Save button** (Caleb, 2026-10-16: "we don't
  want the org name dynamically changing with every stroke for every user
  in the org"). An organization's or language's name, a cluster, a role's
  permissions, a member's role, a book's name, a check's questions and
  people, report targets and a profile name change things for everyone, so
  they apply only when saved, as before.
Amends 83: the workspace's Save, which only said the draft was kept, is
gone; the mark says it. What stays as it was: a draft's events still reach
the server and teammates' phones (they see "Recording in progress" and
cannot play it); making a draft private in the sync itself would move it to
the person's stream, which this does not do. Caleb chose to keep it so
(2026-10-16): teammates cannot play a draft, and the server copy is its
backup.
Reverse if: people lose work because a draft lives on one phone (then
drafts move to the person's own stream, which only they can read), or
teams want to look a version over before anyone is asked (then Done
publishes and the asking moves back to the record).
The passage's "Then the team" checks are cards again, each with its state,
status and people and space around it: PR 72 had made them one-line rows
and PR 92 stacked names under them with no room between.

## 128. A review goes on the one passage it is about

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Caleb asked on 2026-10-16 to get rid of applying one review to more
than one passage: "I think it's more confusing than convenient. The user can
go in, passage by passage, and apply reviews where needed." The partner demo's
"Also covered in this session" picker (REV-6, ADR-028) is gone from Already
happened's Add details, with its nearby-passage list, search, "Saves to N
passages" line and "added to N passages" message: a logged check is written
for the passage it was opened on, on the version chosen there
(`screens/review.tsx`), and another passage the session covered gets its own
review from its own record. `reviewing/capture.ts` loses `recordedPassages`,
`nearbyPassages`, `searchPassages`, `matchesQuery` and `loggedTargets`, and a
review draft no longer keeps `also` (one kept by an earlier version still
reads). Stored data and core are unchanged: `recordReview` still takes several
`takeIds`, and reviews an earlier version logged on several passages stay on
each of them.
Reverse if: teams who log community or consultant sessions covering many
passages find going passage by passage too slow; then bring the picker back
(the demo's AlsoCoveredPicker), perhaps as a copy-this-review action on the
record rather than a field of the review.

## 129. A recording session stays open after Stop: its parts are boxes to hear, move or drop, and leaving it cuts them from the room kept around them

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Caleb asked (LAN-82, 2026-10-16) to fix a part's start and end in
the session rather than after it: tap a box to hear it, drag its edges, drop
it with the × in its corner, and "once they leave the session, that's that",
so nothing about a part's edges is ever saved. It extends 125, which left
this for its own change, keeps 124's rule that a deleted part's place
stays for what is said next, and narrows 83 and 127 for a session's parts:
they reach the record when the session is left, not as each is said.
- **Stop is not leaving.** Stop turns the microphone off and the session's
  waveform stays, showing the whole session (as far as the farthest zoom,
  then one finger slides back over it): a tap on a box plays that part as it
  would be cut, its edges drag out into the room around it or in (never into
  another part, never shorter than a fifth of a second), its × drops it and
  the next part said takes its place and number. The big button carries on
  recording in the same session. Done (124's check), leaving the screen, or
  the app's journal on the next launch ends it, and only then are its parts
  cut and saved, in order, as their boxes stand. Uploads and the footer's
  Done (127's, which was Publish) wait until then; while the session is open
  the recording view's Done is the only one. Its ✕ (Caleb, 2026-10-16)
  stops recording and asks "Throw away this recording?" with what the
  session holds; throwing it away saves nothing said in it, and a session
  that kept no part just goes. The same holds in back translation.
- **The room near speech is kept, not the session.** A chunk file opens when
  a part starts, with up to 2 s of what was heard before its head, and closes
  2 s after the last part in it ended (`modules/microphone-energy/src/chunks.ts`,
  ported line for line to `Chunks.kt` and `Chunks.swift`; the three keep the
  same samples on the same frames). Parts close together share a chunk; a
  long silence is never written, so storage grows with speech (about 5 MB a
  minute of it, as a WAV) and memory holds only the ring (about 5 s). The
  module reports each part as where it lies in its chunk; nothing is cut
  until the session is left (`src/audio/wavCut.ts`), then the chunks go.
- **A crash loses nothing said on a phone.** Each part is in the recording
  journal as its chunk and its box (`range`) from the moment it ends, and
  again when an edge is let go; recovery cuts it as it last stood
  (`recordingJournalModel.ts`). The web keeps a session in the page until it
  is left, and the browser asks before the tab closes; a tab killed outright
  mid-session loses that session's parts (the phones were the concern).
Considered: saving each part as it ends and replacing it when its box
changes (it writes recordings nobody keeps, and the draft changes under the
person while they edit); one file for the whole session (an hour of room on
a low-end phone's storage); keeping box edges editable after the session
(Caleb: what is saved is where the boxes were when it was left).
Reverse if: people lose parts by leaving a stopped session open (the app
killed in the background on a phone without its journal entry), the 2 s of
room is too little to reach a cut-off word, or the web's in-page session
loses work people expected kept.

Amended (2026-10-30, Caleb Koster): with the silence switch on (193) a
chunk stays open through every pause until the microphone stops (a stop, or
the source playing), so the room between parts is written whole and kept
as parts of its own. Off, chunks open and close as above.

## 130. Each step says what is on the screen of whoever does it, the recording too, with hearing and reading apart

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Spoken (2026-10-15) does not want translators reading while they
record: they liked that the Bible's text can be folded away, but worry that
if it is there at all it shapes the draft, in FIA recordings too. Caleb
asked that admins control what is available at each step of the review,
including the first recording and recording a back translation (LAN-81).
Before this, a language chose its Bibles and guides for every step at once
(decision 62), a check could only add helps (decision 91), the recorder
always showed a Bible's words (falling back to the English the app
carries), and only Back Translation hid anything, through the kind's
`withholdsContext`, which no screen could set. So a step now says what it
shows: `v1.CheckShowsSet { kindId, what, shown }` in the language stream, a
register per (kind, what), where `what` is one of hearing the Bible,
reading the Bible, hearing the guide, reading the guide, key words, notes
and earlier versions, and `kindId` is a check or `record` for recording a
version (`core/checks.ts` `checkShows`, `RECORD_STEP`). Without a register
everything shows, as before, except at a kind that withholds context,
where nothing does, so Back Translation looks as it did. Setting up a step
is managing the flow (Manage flows). Screens: the language's Checks list
starts with the recording as a card that opens like a check, and every
card says what its step hides (or, when it hides most, what it shows) by
an eye; the recording and each check have "On their screen", one switch
per thing, hearing and reading as separate switches. The recorder, the
study (the drafting team's preparation) and back translation follow their
step: the Bible heard and not read is its player and the verse numbers,
only Bibles with audio are offered and Other Bibles goes; the guide heard
and not read is its spoken step; a check's Background has only what the
check shows and is not there when it shows nothing. Answering feedback
keeps Earlier, where the feedback is. A check's own helps always show,
being chosen for it. The sentences that explained what was hidden are gone
(the review's notice, back translation's line, the passage's "beside you").
Not built: a ready-made flow saying what its steps show (Spoken's own flow
could start with reading off), and translators' own Bible exploring
outside a passage.

Amended (2026-10-15, Caleb Koster): Caleb's second look asked for a shorter
check page and finer choices. A check's page now has People and Questions
as rows that open pages of their own, and "On their screen" has one row
per help: the Bible and the guide open to Audio and Text, key words is a
switch, and notes and earlier versions open to the steps they come from.
`v1.CheckShowsSet` gains `from` (a step: `record` or a check), a register
per (kind, what, from) that falls back to the (kind, what) one, for notes
and earlier versions only. Earlier versions come from a step by what made
them (versions are the recording's, feedback its check's); a note says
where it was written through an optional `kindId` on `v1.NoteAdded`, set
by the recorder, the study, back translation and the review. That adds a
field to a shipped event, as `Card.atMs` did (decision 72): it is additive
and optional, older validators and reducers keep it, and notes without it
count as the recording's. "Same time as" is a choice of any other checks,
which join the check's step where it stands (`checks/model.ts`
`setSameTime`), instead of a switch for the check above. A step that makes
something (back translation) has "Checked at": any check after it, or a
check of its own made right after it, which is `produces.checkedBy` on the
kind, so recording the back translation and reviewing it are two steps
with their own people, questions and screens, and the passage's steps
list both. On the web, switches keep a white thumb when on.

Amended (2026-10-16, Caleb Koster): on a step's page each help is one row
with a switch that turns all of it on or off and a line saying how much is
on ("All", "Audio", "3 of 7"); the row opens the help's own page with a
switch per part (Audio and Text, or each step its notes or earlier versions
were added during, under a label saying so). Choosing material follows the
language its content is in, set once for the language: the team's
reference language (decision 84), asked when the language is set up with
how much is in each language, and changed from the top of What helps them.
What helps them and a check's "Add a help" offer only material in that
language, and what the team already has. Caleb's rule (2026-10-16): the
language of review material is set by the admin for the team, in one place.
Caleb then asked for several languages (2026-10-16: translators will want
Greek and Hebrew beside their own, or other languages): the language
question ticks as many as the team needs. The main language stays
`v1.ReferenceLanguageSet` (what FIA, Bible order and guide matching follow);
each other one is `v1.ReferenceLanguageAdded { language, added }`, a
register per language, so two admins adding different languages offline
both land, and nothing already stored changes. Lists of material take any
of the team's languages.

Reverse if: teams want the same settings on every language of an
organization or cluster; then they move to the organization's
recommendations level (decision 62) with the language's register on top,
with no change to what a step reads.

## 131. For its prototype, EveryBible holds LangQuest tokens on the phone: a reviewer's code is a review token, and listeners hear approved versions

Date: 2026-10-16 · By: Ryder Wishart · Status: accepted

Reason: Ryder wants the Every Language organization linked to EveryBible,
its review and listening app, with no bridge between them, while it is a
prototype. Partly supersedes 109's listening side: EveryBible no longer
goes through its bridge Worker.
- **A reviewer's code is a token.** An Every Language admin makes a token
  with `read` and `review` at `/connect` and shares it with reviewers. The
  phone checks it with `/me` (it must read drafts and review in some
  language), keeps it in the keychain and calls `/api/v1` itself. Revoking
  the token on `/connect` closes it for everyone who holds it. This departs
  from `docs/agent-api.md` ("`review` … tokens belong on a server") on
  purpose: anyone who holds the code can record listener reviews and, where
  a step takes links, reviews that count, as the admin who made it. That is
  acceptable while the code goes only to known reviewers.
- **Listeners use the app's own `read:published` token**, which the docs
  allow in an app: it hears approved versions only. Approved in LangQuest is
  published in EveryBible; no studio step. That token cannot write, so a
  listener without a code cannot send feedback; feedback after approval
  comes from phones with a reviewer code.
- **Freshness without webhooks.** A reviewer's phone reads each language's
  change feed every 4 s while the screen is open and then only the passages
  it names; a listener's token cannot read the feed, so it asks for passages
  changed since its newest `updatedAt` every 30 s, which folds the whole
  language list on LangQuest's side.
- `server/listeningDemo.ts` answers `/me` as LangQuest does and adds a
  `read:published` token (`.listening-demo/listener-token`) for testing.
Reverse if: codes reach people the team does not know, or listeners
without a code must send feedback (then a server holds the review token, as
109's bridge did, or LangQuest issues per-reviewer tokens by the device
flow); or listener polling shows up in LangQuest's load (then a cheaper
published change feed).

## 132. An organization's Durable Object keeps under half its isolate, folds languages of unknown size one at a time, and a capped-heap test holds it there

Date: 2026-10-16 · By: Ryder Wishart · Status: accepted

Reason: on 2026-10-16 `/connect` answered 502 for people in a large
organization. The Worker log said "Durable Object's isolate exceeded its
memory limit and was reset": answering `session/orgs` asks each of the
person's organizations for their access, which on a cold object folds
every language, and one object went past Cloudflare's 128 MB. Two things
let it: the folder kept 40 MB of folds (`STATE_BUDGET_BYTES`, PR #150), and
a parsed fold takes about 1.8 times its serialized size, so a full budget
held about 72 MB before any request's own work; and a language with no
recorded size (a cold object, or a summary written before sizes were
recorded) counted as small, so four large languages were folded at once.
- `STATE_BUDGET_BYTES` is 12 MB (about 22 MB once parsed), and a language
  of unknown size is folded alone (`isLarge`). Once its summary records a
  size, small languages run four at a time again.
- `apps/web/test/memory/orgFolderMemory.test.ts` runs the real `OrgFolder`
  over two large organizations (twelve languages of about 5 MB of fold,
  and six of about 12 MB) in a Node heap capped at 112 MB, below the
  isolate's 128 MB for what it spends outside V8's old space. Events come
  a page at a time and folds are saved to disk, as Postgres and SQLite do
  in production, so the heap holds only what the folder keeps. It fails if
  the folder runs out of memory or keeps 48 MB or more between requests.
  It runs in `npm test`, so in the checks job on every pull request. With
  the 40 MB budget and parallel unknowns it fails both ways.
- Memory is now a property tests hold, like order-independence (102's
  lowest layer that can hold the check: a unit test with a capped heap,
  not a deployed canary).
Reverse if: Cloudflare raises the isolate limit, folds move out of the
heap (then the budget can grow), or production shows an organization the
test's shapes do not cover (then add that shape to the test).

Amended (2026-10-19, Ryder Wishart): the test now holds every memory user
in the object, not only the folder, and its shapes are known not to cover
the largest real organization.
- What `OrgSnapshot` keeps per organization: the folder's org fold,
  per-language summaries and saved cursors (grow with the number of
  languages, small) and its held folds (the 12 MB budget); the folds'
  derived indexes (core's WeakMaps, alive as long as a fold is held and
  outside the budget's count: about 11 MB more on the API path at
  60 × 300); the webhook dispatcher only a promise chain, with digests,
  the feed and the outbox in SQLite, and while scanning one language's
  fold and two digests at a time; `AgentOrg`'s write and upload counters,
  at most an hour of timestamps per key (600 writes, 100 uploads) but one
  key for every token and link that wrote since the object woke, never
  forgotten; and nothing else (no response or link caches). A partner API
  answer is at most 500 passages (0.7 MB of JSON at 5,000 passages a
  language).
- `orgFolderHeap.ts` runs one path per child process (fold, webhooks, api,
  reports, writes) over 12 × 2,000, 6 × 5,000 and 60 × 300 (many small
  languages). Each path also runs against the regression its bound stops
  (no fold budget; a dispatcher that keeps what it compared; a response
  cache; counters that keep every timestamp) and must fail there, so a
  check that can no longer fail fails.
- The budget is not enough on its own. After this decision was deployed,
  `/connect` still failed for Every Language (decision 140): 37 languages,
  ten over 89,000 events, the largest 230,430. In the harness one
  language of that shape no longer fits in 112 MB somewhere between about
  100,000 and 130,000 events (8,000 passages fit, 10,000 do not), however
  few are held. The test's shapes stop at 65,000 events a language, so
  they show the budget and the paths work for organizations up to that
  size, not that every real organization fits. Decision 140 took access
  checks off the full pass; reports, passage reads, writes and webhooks
  for a language past that size still do not fit, and need their own
  decision. When one exists, add a 1 × 18,000 shape (Every Language's
  largest) to the test.
- A post-deploy canary (`docs/routines/do-memory-canary.md`) is proposed
  beside the test, because Every Language showed what only production
  has: it reads a passage page of each of the largest real organizations
  once after each production deploy (every object is cold then) and reads
  the Worker log for "exceeded its memory limit". It is not running; it
  needs per-organization read tokens and a read-only Cloudflare token.

Amended (2026-10-20, Carl Sauder): the budget is now kept before a fold
is made, not only after. `keep` let go of older folds once the new one
was folded, so a fold of about the budget stayed held while the next
language was read from the cache or folded from its events: two folds,
the second's events and its measuring text at once. The fold path at
6 × 5,000 then ran out of its 112 MB heap on 4 runs in 10, on main as on
any branch, and failed pull requests at random. `stateOf` now makes room
for the language's recorded size first (`makeRoom`), counting a size not
recorded yet as large, as `isLarge` does; 16 runs in 16 passed. A unit
test in `worker.test.ts` holds the order: nothing the budget cannot hold
beside the next fold is held while it is folded.

## 133. The recording screen has its own Undo and Redo, parts move by a grip, a place opens on the line between parts, and no Undo there runs out

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-16): "I don't like the undo toast at all": with 7
seconds to read it, and the next toast replacing it, it "induces panic and
frustration"; an Undo toast on a verse label is "silly", as a verse is plain
to see and easy to change. He asked for the recording screen's own undo and
redo (users' earlier feedback), a six-dot grip to drag parts up and down that
takes the moved part's verse off so it can be labelled again, a clean mark on
the line between parts that opens a place to record into, and a subtle shade
on the parts just recorded. Research on Mobbin (the "Undo and redo in
recording" page) found editors keep undo as two arrows that stay on screen,
greyed when empty, and voice recorders (TikTok, Shopee) put them by the
record button. Narrows 111's "Where Undo is" for this screen and 124's "one
part is still deleted at once, with Undo". What was built:
- **Undo and Redo.** Two arrows in the footer left of the red button (where
  the next part's number was; its row says it), and beside the small red
  button when the recorder is one line, grey when there is nothing to take
  back or put back, out of the way while the red recording view is open. One
  step is one thing done: a whole recording session however many parts it
  split into, recording over a part or into a place, one delete, deleting
  every part (which still asks first), one drag, one verse tap, slide or
  choice. Every undo and redo is new events putting the parts as they stood
  (`workspaceModel` `restoreSpecs`: a new take continuing the draft, or the
  draft set aside when it is back to what it started from, and the verse
  marks), never removing any; a verse mark changed since the step (here, or
  in another draft sharing the part) is left as it is. No depth limit. The
  history is kept with the draft on this phone (`useUndoHistory`,
  AsyncStorage `parts-history:v1:…`) through leaving the screen and the app
  being closed, ends when the draft is published, does not sync, and is not
  offered when the draft has moved on elsewhere (`historyFits`). What an undo
  or redo changed is shaded, and a screen reader hears what it was. No toast
  on this screen offers Undo, and the part, verse and move changes say
  nothing on screen (a screen reader is told). Back translation has the same
  arrows for its pieces (a session, or clearing a part; `bt-history:v1:…`).
- **Moving a part.** A grip at the left of each part (`slots.tsx`
  `PartGrip`; `useDragRows`, `dragModel`): the row lifts and the rows it
  passes move out of its way, the pane scrolls near its edges, and a screen
  reader has Move up and Move down. The moved part's verse is taken off;
  every other part keeps the verses it showed, a mark that read them from the
  part above naming them instead (`marksKeepingLabels`), so nothing is
  renumbered by a move.
- **Recording between parts.** A small + on each line between two parts and
  above the first (`InsertMark`) opens a place there, numbered as the part
  will be (`slotRows` `open`); the red button records into it. The + marks
  sit in a rail at the left of the rows, before the grips, so each one's
  48 pt target overlaps nothing a row has to tap (A11Y-009). What is said
  there has no verse, unless it sits inside one verse said in pieces, when it
  is more of that verse; the parts around it keep theirs.
- **Just recorded.** The parts a session added are shaded faintly red (the
  recording view's colour) until the next session starts. The card of parts
  is open at every size of the pane unless closed, and back from the red
  view the first part just said is brought into view (Caleb: "have the list
  of audio segments expanded by default so that when the user leaves the
  waveform recording view, they see the newly added/toned segments"); it
  used to open by itself only when the pane was 360 pt tall.
Considered: an undo history in memory only (phones close apps in the
background; a history that vanishes is the toast's problem again); undo on
the record by walking the draft's takes (verse marks are not in takes, and
redo needs a way forward); a long-press to move parts (nothing shows it can
be done).
Reverse if: people undo by accident (the arrows sit beside the red button),
a history kept on the phone undoes work they expected kept, or the grip is
dragged by mistake while scrolling a long list.

Amended (2026-10-16, Caleb Koster): the grip is now at a part's right end
and the + marks sit on the card's right edge, half off it, not in a rail at
the left; a part is deleted by sliding its row to its bin (decision 136).

## 134. No toast offers Undo: the way back stays with the thing, building screens get their own arrows, and what cannot come back asks first

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-16): "I don't like the undo toast at all. It's
irritating because if I want to undo something, I have 5 seconds or so to
read the toast message and then my chance is gone forever - it induces panic
and frustration with users." He asked for each place to be decided from the
research ("Undo and redo in recording", which lists every place) and common
sense. A toast's Undo lasted 7 seconds and the next toast replaced it, so
after two quick changes the first could not be taken back; Material and
GitLab's design systems took actions out of toasts for the same reason, and
a disappearing button fails people using a screen reader or a magnifier.
Supersedes 111's toast Undo (its History, step-sheet and review-page Undo
stay) and extends 133 beyond the recording screen. What was built:
- **Toasts only say what happened.** `ToastSpec` has no `undo`, `ctx.toast`
  and `ctx.act` take a message and nothing to undo with, and a toast shows
  3.5 s (twice that with a screen reader).
- **The way back is where the thing is.** On a passage it is History's Undo
  and Withdraw (111), the step sheet and the review page; a study step has
  its own Undo, and your own note on a study step now has one on the note
  (`StudyNote`; those notes are not in History). Settings, helps, library
  items, templates, roles and My Bibles change back with the same control; a
  template you stopped following offers Follow again in its options, as the
  library's settings did.
- **Screens where you build something get Undo and Redo** in the header, as
  the recording screen has them by the red button (`ui/undoRedo.tsx`,
  `ui/undoModel.ts`): the guide editor (every change, typing in one field
  joined into one step, kept with the draft on the phone until it is
  published, the newest hundred), Divide your own way (each section start,
  join or outline used, for the visit; it replaces its one Undo link) and a
  language's list of checks (each save of the list or a ready-made set
  used, for the visit, written back with `restoreChecks`; a save made on a
  check's own page opened from the list is a step there too,
  `checks/checksHistory.ts`).
- **What cannot come back asks first.** Removing a member (they come back
  only by joining again) and using a ready-made set of checks over a
  language's own (its own checks cannot be chosen again): a sheet names it
  and waits (`ConfirmDelete`, with `replaces` for the second). Removing one
  of a language's checks asks first too, as a whole thing does (124): its
  way back is the list's Undo, not on the check's page where it was tapped
  (agreed with "Combining check settings", PR 155).
Considered: a toast whose Undo does not go by itself (it still covers the
screen and is still replaced by the next one); asking first everywhere (it
slows down every reversible change to guard a few).
Reverse if: people take back things by accident with the header arrows, or
miss a change made by mistake that the same control would have reversed
because nothing points at it.

## 135. A part is speech, not only sound out of the room: Silero VAD scores what the microphone hears on the phone and the web

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Caleb found a loud cafe, or steady noise, boxed as parts (LAN-82,
2026-10-16): his phone boxed a steady background noise as one long part, and
with chatter around him one box swallowed the whole session. 125's splitter
knows only levels, so any sound out of the room is a part, and a cafe's room
never falls quiet enough to show where speech ends. After a research report
(Silero VAD v6 the lead option) he chose to put it in and try it. Narrows 125:
a part is now sound that is out of the room and that a speech model calls
speech; nothing else changes about where parts split or what is kept.
- **The model.** Silero VAD v6.2.3, the 16 kHz opset-15 file (1.3 MB, MIT,
  `modules/microphone-energy/models/`), scores each 32 ms as speech, 0 to 1.
  The microphone's 44.1 kHz is brought down to 16 kHz with a windowed-sinc
  filter and cut into the model's chunks (`src/speech.ts`, ported line for line
  to `Speech.kt` and `Speech.swift`, the same samples from the same sound); a
  frame's score is the surest chunk that ended in it.
- **The rules with a model** (`src/splitter.ts`, `Splitter.kt`,
  `Splitter.swift`, the same parts from the same frames and scores). A part
  starts when the level would start one and two of the last three frames
  score 0.5 or more; a frame is heard when it is out of the room and scores
  0.35 or more; a part ends on the median of the last five frames' level, or
  when the score falls under 0.35, after the pause. The room is the level a
  fifth of the last 8 s fall under, not the quietest moment; in the first
  0.6 s the room heard now replaces a quieter one remembered, when it is not
  speech; and while a part is open the room stays 10 dB under its loud end, so
  someone who reads on without pausing never becomes the room. Without a
  model (it failed to load, or a test build leaves it out) the rules are 125's
  exactly.
- **Where it runs.** ONNX Runtime: `onnxruntime-android` (Gradle) and
  `onnxruntime-objc` (CocoaPods) in the microphone module, held at 1.22.0
  because from 1.29.0 the runtime starts Microsoft's telemetry at launch (on
  Android a content provider that reads the Android ID and adds the INTERNET
  permission), which docs/play-store-declarations.md rules out; on the web
  `onnxruntime-web` 1.29.0's WebAssembly build, one thread, which has none. The
  phones ship the model in the module; the web export serves it and the
  runtime as files (`/models/`, `/ort/`), outside the JavaScript budgets.
  Every platform starts loading it when a recording screen opens
  (`prepareSpeech`), and the microphone waits for it before opening (on the web
  at most 3 s; on a slow network the model joins at the next stretch), so a
  stretch of listening is judged one way throughout.
- **Costs, measured.** Android arm64: the runtime is 18.2 MB installed, about
  6.5 MB to download (1.29.0 was 32 MB); the iPhone framework is 36.9 MB
  before linking (its share of the app not yet measured); the web fetches
  14 MB of WebAssembly and the model once, when a recording screen first opens.
  Speed on a phone is not yet measured (Silero gives 0.19 ms a chunk on one
  desktop core).
- **Measured on recordings** (real narration over simulated cafe babble and
  clinks, a fan, and a quiet room, through today's rules and the new ones,
  scratch measurements in the LAN-82 thread): in three cafes, 93 s each, today
  makes one part of everything, the new rules 15 or 16 parts with at most
  4.9 s of noise inside them, and 0.19 to 0.65 s of speech edges left outside
  a part (still in the room kept around it, so dragging the edge brings it
  back, 129). A fan or clinks alone: today one or two parts of 3.5 to 13 s,
  now none. A quiet room and 60 s of unbroken reading: the same parts as
  today. A second mix (a Yoruba reading over other readings, 98 s) agrees:
  in a cafe today makes 2 or 3 parts, the longest 59 to 71 s, the model 16,
  none over 6.8 s. In the web app, 40 s of that loud cafe gave two boxes
  over everything today and six with the model; 20 s of fan, one box and
  none.
- **Tests.** The UI tests' microphones are tones, which the model rightly
  hears as no one speaking, so their builds leave the model out
  (`NO_SPEECH_MODEL=1` in `e2e/ui-web.sh` and `e2e/web-smoke.sh`) and their
  parts are timed by level as before; unit tests hold the rules with scores,
  the resampler and chunks, and the shipped model's file and inputs. The
  phones' Maestro flows tagged `voice` play the same tone and will make no
  parts with the model; they need a recorded voice before they run again.
- **Not yet: is it the reader?** The model calls any voice speech, a talker
  at the next table too (the research found Silero marks most loud
  background speech as speech). The simulated cafe's talkers were further and
  duller than the reader and scored low; a clear nearby talker can still be
  boxed. A gate on the reader's own learned level is the next step if that
  shows in the field.
Considered: TEN VAD (smaller, but a license with conditions), WebRTC VAD
(passes noise as speech), neural noise suppression before the splitter (changes the
recording that is kept; masters stay raw), Android's VOICE_RECOGNITION
source (left for its own change), a voice gate on the reader's own level
alone (does not tell speech from a loud fan).
Reverse if: parts miss words a person said in a quiet room, the model's
scores differ by phone so parts differ, the runtime's size or the web's first
download keeps people from recording, or a later ONNX Runtime without
telemetry makes 1.22.0 worth leaving.
## 136. A part's row reads as a voice message: verse, play, its bars and length, and the grip; it slides aside to its bin, and the + hangs off the card's edge

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-16), choosing from the "Recording row order" research
page: "I like replacing the name with a voice message waveform image", with
the verse label, a line, play, the bars and length, a hamburger grip, and
"half-hanging off the end of the card at the line intersections is the small
plus icon". Then: "Can we have the user swipe left/right to trash a
recording? Then we don't have to have a garbage icon on each row at all -
more space then", deletion with a confirmation, a one-time animation of a
part sliding to show the bin, and an opened place that looks "different -
like a pill with space around it". The research found most apps put the grip
at the right and keep delete behind a swipe or a menu, not on every row.
What was built:
- **The row.** The verse space, a line, play, the part's bars and its
  length (`partBars.tsx`; the name is gone from sight, and a screen reader
  still hears "Part 2"), the grip (three lines) at the right end. Tapping
  the bars chooses the part to record over, as tapping its name did.
- **The bars.** Each part's sound in 64 even slices, as tall as its
  loudest allows, a quiet part staying low (`audio/barsModel.ts`), kept on
  the phone by the audio's hash (AsyncStorage `bars:v1:…`, `barsStore.ts`):
  worked out from the WAV when a part is recorded, before a phone encodes it
  to AAC (`useRecorder`), and for a part recorded before, read once from its
  file (`barsOfFile.ts`: a WAV on a phone, anything the browser decodes on
  the web). A phone has no AAC decoder, so an AAC part it did not record
  shows a low even line until a native reader is added. Bars are not
  events: they are worked out again from the audio wherever they are needed.
  They fill from the left as the part plays.
- **Deleting.** A row slides either way, by finger or mouse, to show a red
  bin behind it, and stays open on it (`swipeRow.tsx`); tapping the bin is
  the confirmation, and the footer's Undo brings the part back (133). A tap
  on the open row closes it; one row is open at a time. A screen reader
  opens it from the part's "Delete Part 2" action, and the hold sheet keeps
  its delete. The first time a phone shows a list of parts, the top one
  slides right to show the bin, then back (`useSwipeHint`, once per phone,
  not with reduced motion).
- **The + marks.** On the card's right edge at each line, half off the card.
  Each 48 pt target is centred on the edge: the rows and the header leave
  the 24 points inside it with nothing to tap, the card sits 8 points
  further in from the screen's right edge so the target ends at the screen's
  edge, and the card's box reaches past its drawn edge so a phone delivers
  the taps (A11Y-009). The header keeps a band under its buttons for the
  first +. An opened place is a pill with the microphone and space all
  around it, dashed until chosen.
Considered: a bin on every row, or the no-entry icon at its left (the row
needs the room, and Caleb chose the swipe); deleting on a long swipe with no
bin (no confirmation); bars from the recording session's live levels (they
are gone once the session is left, and older parts never had them); a new
event carrying the bars (they come from the audio, so nothing needs to sync).
Reverse if: people delete by accident while scrolling, cannot find how to
delete without the hint, or the low even line on older phone parts reads as
silence.

Amended (2026-10-17, Caleb Koster): a session's parts take their bars from
the levels the recording screen showed for their boxes (`barsFromLevels`),
read as the session is left, so leaving no longer reads every part's WAV in
JavaScript before saving it. Caleb saw parts fill the list slowly, one by
one, after leaving a session; in Hermes on a Mac that read took about 390 ms
for ten 8 s parts, and the levels take under a millisecond. The live levels
were set aside above because they are gone once the session is left; they
are read just before it goes. A hold-to-record take, and a part found again
after a restart, still read their WAV. The bars are each slice's level from
the frames' loudest samples rather than every sample, so a row can look a
little fuller than one read from its file.

Amended (2026-10-20, Caleb Koster): help mode shows a part's bin. Caleb did
not see the slide on a first recording and asked whether the ? explains
swiping to delete; it did only in the second sentence of the sound bars'
bubble ("Record Part 1 again"), where someone looking for delete would not
tap. While help is on, the list's second part (its only one, when there is
one) stands open on its left-hand bin, so the first row keeps its own
numbers in sight (`helpBinRow`), and the bin has a number of its own: "Slide
any part aside to show its bin, then tap the bin. Undo brings it back." The
row closes when help goes off. The bars' bubble keeps only what a tap on them
does. The slide itself was checked, not changed: on a device that never saw
it, the first recording's parts slide once and it is kept as seen; builds 22
and 23 and every update since carry it, so a phone that recorded on any of
them has had its one showing.

## 137. Android's Back goes one step back, inside a screen's steps too, and leaves the app only from the first screen

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-16): "Sometimes I find myself in the middle of a
multi-step process and the android back navigation will exit me from the
entire process (not what I intended). Also, on some pages back will
completely exit the app (shouldn't be a thing)." Two causes. A tab is
opened by a reset, so a tab's page (Map, Manage, Me, Inbox, Reports), the
practice passage and a link to the scanner had nothing under them, and Back
left the app. And many screens show their steps in place (New language, Get
ready's questions and their pages, reviewing's stages and questions, a
study's steps, the recording view, Divide your own way, invites, a new
template), which the navigator cannot see, so Back popped the whole screen.
What was built:
- **One listener answers Back** (`shell/useRootBack.ts`, added by the
  component that draws the navigator, so it is asked before the navigator's):
  a step open on the screen goes back one step; else the screen underneath
  comes back; with nothing underneath, Back goes to the person's first
  screen (their home, "Join your team", or Sign In signed out) and leaves the
  app only from there, or from the welcome a first sign-in shows
  (`shell/backModel.ts`), and only when pressed twice: the first Back there
  shows "Press Back again to leave LangQuest", and a second one while it
  shows (3.5 seconds) leaves (Caleb, 2026-10-16: "have it say press back
  again to leave"). A Back arrow with nothing under it goes to the first
  screen too.
  `test/hardwareBack.test.ts` keeps every other `BackHandler` listener out.
- **A step registers its own way back** with `useHardwareBack(active, onBack)`
  (`ui/hardwareBack.ts`): the newest step open on the screen showing answers
  first, by when it opened, so a page inside a wizard answers before the
  wizard. Each does what that step's own Back does: the Back under New
  language's steps (and a page of its question first; while it is being
  added, the same "please wait" as ✕), the question before in Get ready and
  in a review (then the stage before; Listen leaves, and the draft stays),
  the step before in a study (as it was reached) and "Back to the guide",
  the recording view's ✓ (it keeps every part), the helps or the verse
  picked in Divide your own way, then its header's arrow. ✕ still leaves a
  task at once.
- **A sheet of several steps** takes `onBack` (Add a Bible, Report, the
  license's "This can't be undone", the lesson on breaking up material):
  Back goes to its step before; otherwise Back closes a sheet, as before.
- Help mode turns off on Back, as its ? does.
Not covered: iOS has no Back button, and its edge swipe still pops a screen
past its steps. NAV-061 now expects the first screen, then the message,
not leaving the app at once.
Reverse if: people expect Back on a tab's page to leave the app, as before,
or find stepping back through a long task slower than they want (✕ still
leaves it at once).

Amended (2026-10-28, Caleb Koster): iOS follows the same rule as far as a
swipe can. While a step registered with `useHardwareBack` is open, the
screen's back swipe is off (`useSwipeBackOff`, iOS only), so only the
header's arrow goes back, one step, and no swipe pops the screen past its
steps. Task screens (`TASK_SCREENS` in `shell/chromeModel.ts`: recording,
back translation, reviewing, a study, Get ready, New language, Ask someone)
take the swipe only from the screen's edge, so a drag on a waveform or a
slider is never a Back. From the UI audit Caleb asked to have fixed
(findings 4 and 16).

Amended (2026-10-28, Caleb Koster): two ✕s no longer leave at once,
because what they leave cannot be had again. New language's ✕ (and Back on
its first step) asks "Leave without adding ‹language›?" once a name or an
answer is in, with Keep going first (`org.tsx`, finding 45). The sign-in
code page for someone with no email asks "Leave the code?" before its Back
or Android's Back throws away a code nobody has scanned, since the code
cannot be shown again; Done, which says they have it, leaves at once
(finding 96). Every other ✕ still leaves a task at once.

## 138. One name for each thing on a language's page: its pick under each, the others and the organization's shelf behind it, and no More

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-16), on a language's page in Manage: under More,
Members, "Every way to divide the work", "Bibles, guides and notes" and
"Every way to check" looked like People, They record, What helps them and
Checks above them, and "The connection between the pairs of options isn't
really obvious in the list." He asked for the name as "a pencil by big title
on top of page", the cluster "below the big page title", one "Languages"
entry, and no organization row ("they can just go back"). Layout research
(apps such as Revolut Business, Notion and Settings show the pick where you
are and open the library from the bottom of the picker) found each pair was
one thing under three names: a language's choice, and the organization's
shelf it picks from. Caleb approved the layout ("Looks great, please go
ahead"). What was built:
- **One name each, everywhere:** Content template(s), Reference material and
  Review flow(s), on a language's page, its pages, and the organization's
  Setup and shelves (which were Content Templates, Reference Material, Review
  Flows). A row's second line is this language's pick, never an explanation.
- **A ready language's page has seven rows and no More** (`LanguageHome`):
  Content template, Reference material and Review flow; People and Roles,
  with join requests under them; Languages and Show on the public list.
  Members (People's own screen), the three shelf rows, the organization's
  row, Name, In the language list, Cluster, and More's progress bars and
  code line are gone; progress is on See their work and the organization's
  list. A language that is not ready keeps its checklist, then See their
  work and Roles, then Languages and the public list.
- **Each pick opens the same way** (get_ready `step` 'template', 'helps',
  'flow'): what it uses on top (`PickCard`: a lit radio, its facts, links
  into it), the others under it as radio rows with an explicit Use (others
  see the choice, so it is not saved on tap), and last a row to the
  organization's whole shelf ("All content templates", "All reference
  material", "All review flows"). The content template's links are Each
  book's passages (the language's books, which was its template view),
  Which books (question 1), and Edit or View; its version and Take update
  moved onto it. The review flow's link is Edit (the Checks screen); using a
  ready-made flow over its own checks asks first (134). Reference material is
  What helps them renamed, ending with its shelf instead of Add more's
  library row. The demo's Choose a Template screen (`template_picker`) is
  dropped: the Content template page lists the choices itself.
- **The name and clusters change where they show:** a pencil beside the big
  title (the rename keeps Save the name, since everyone sees it, 76), and an
  amber chip under it with the clusters it is in, "+ Cluster" for whoever may
  group languages while it is in none (108).
- **Languages** is one row (`LanguagesRow`): its sheet has They translate
  into (its link to the language list) and They understand (the languages
  its Bibles and guides are in, 130).
- **Up instead of a row:** a language lead's Manage tab opens on their
  language with no Back, so the organization's name sits where Back would be
  and opens its page (`BigTop` `up`).
- **The organization's page, the same way:** a pencil beside its name in the
  top card, and its licence under the name opens the licence sheet; Setup
  loses Name and the licence row.
Alternatives: keeping the pairs with standard titles and a line under each
saying what it is (Caleb's first idea): the line repeats on every visit,
must be translated and fit 360 wide in 15 languages, and the project keeps
explanatory text out of the UI; the pick says what the row is about.
Reverse if: people cannot find the organization's templates, reference
material or review flows from a language, or look for the name or clusters
in a More that is no longer there.

## 139. Words are never cut off: a label wraps, side-by-side things move under each other, and a few choices wrap

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-16): on the passage page, under "Continue
recording", "Something else?" and "Versions and …" were cut off; "Go
through the app and look for cutoff text in all languages on all pages and
resolve." Walking every screen reachable from each role at 360 pt in the 15
interface languages (and reading every layout) found cut-off words in the
kit and in 40 screens' and parts' files, many in English too: the kit and screens shortened words with "…"
(`numberOfLines`), left a label beside other things with no room to wrap
(React Native does not shrink a child by default, and Android clips what
runs past its parent), fixed widths that a word in Swahili or Burmese
outgrows, and choices of two or three in a row that scrolls sideways, the
last one past the edge. The rule, in the kit so screens get it by default:
- **The app's own words show in full.** `Row` labels and subs, `Disclosure`
  summaries (still short, but they wrap: this narrows PLAN.md's one-line
  summaries), `Header` titles and subs, `Badge`, and the labels of
  `PrimaryBtn`, `GhostBtn`, `SmallBtn`, `QuietLinks` and `Chip` wrap instead
  of taking "…"; the buttons shrink to their place and their words wrap in
  them. People's own content (names, notes, titles) may still be shortened
  in a list; it shows in full where it opens.
- **Side by side while it fits, else under.** A `Row`'s badge and right-hand
  part keep the label most of the row (`rowBadge`, `rowRight`); a header
  whose action carries words or is wider than one round button puts the
  title on its own line under the buttons; button groups, figures, keys,
  pills and title-with-badge lines wrap.
- **A few choices wrap** (`ChipWrap`), so every option is in sight; a
  `ChipRow` that scrolls sideways stays for filters among many.
- **The reviews grid** sizes every column to the longest word in any head,
  so a head breaks only between words, and a head is a check's whole name
  where two checks share their first word (Spanish "Verificación …"), so no
  two read alike (`gridColumnNames`).
- **The recording screen's collapsed reference bar** (80 pt) shows the
  Bible's name only: its "Drag down for the guide, key words, notes and
  earlier recordings" never fit in any language, and help mode says it.
- **On Android, bold text set with a line height is drawn at weight 600**
  (`ui/text.tsx`). Caleb's cut was Android's own: on an emulator sized like
  his Pixel 10 Pro, "Versions and history" lost "history" at weight 700 with
  `txt.sm`'s line height, kept it at 600 or without the line height, and the
  kit's wrapping alone did not help. Android draws 600 and 700 near enough
  alike in its system font.
The recording screen's part rows and its footer are 136's: they were being
rebuilt alongside this, and its Done and one-line bar now fit their words.
Reverse if: a screen needs a fixed-size label to stay readable at a glance
(a tab bar), and wrapping makes it worse than an abbreviation would.

## 140. Access checks read the organization stream alone, never a pass over its languages

Date: 2026-10-19 · By: Ryder Wishart · Status: accepted

Reason: after decision 132 was deployed, `/connect` still answered 502 for
people in Every Language (`org-v2-everylanguage`, reported 2026-10-18 and
2026-10-19; reproduced 2026-10-19 with the Worker log: "Durable Object's
isolate exceeded its memory limit and was reset" on `agentAccess`). That
organization has 1.75 million events in 37 languages, ten of them over
89,000 events and the largest 230,430. In the memory harness a single
language of that shape stops fitting in 112 MB between about 100,000 and
130,000 events, so no fold budget helps: one language alone is too big.
`/connect` asks only who may see what, which the organization stream
answers, but `AgentOrg.access` read `OrgFolder.orgState()`, which first runs
a full pass that folds every language.
- `OrgFolder.orgOnly()` catches up the organization stream alone (restored
  from the cache, then the log past it when its head moved, at most once a
  minute like a pass) and folds no language.
- `AgentOrg.access` (`/connect`'s `session/orgs`), the `languages` read
  (a token's `/me` and `GET /languages`), `linkOpen` and `mayRevokeLink`
  use it. Reports, passage reads, writes and the webhook dispatcher still
  need language folds and still use the pass.
- `apps/web/test/memory/orgAccess.test.ts` runs those checks over Every
  Language's real shape (its 37 languages' sizes) with a source that fails
  on any read of a language stream. Against the code before this change it
  fails.
This fixes `/connect` and token management only. Every Language's reports,
partner API passage reads and webhooks still fold languages too big for
the isolate; that needs its own decision (fold large languages outside the
object, or keep a smaller fold).
Reverse if: an access check needs something only a language fold has; then
that piece belongs in the organization stream or a summary, not a pass.

## 141. Server jobs too big for an Edge Function run in a container behind the dashboard Worker, started by its cron, and no production job runs in GitHub Actions

Date: 2026-10-19 · By: Carl Sauder · Status: accepted

Reason: decision 103 put the projection pass for large languages in a
scheduled GitHub Actions workflow as a temporary measure, and the v2 import
runs there too. Carl ruled (2026-10-16) that no production job belongs in
GitHub: a scheduled run is delayed under load and can be dropped; a public
repository's schedules are switched off after 60 days without a push; the
production service-role key sat in the repository's secrets beside a freshly
installed dependency tree; a job is capped at six hours; and it is a CI
system, with public logs and `concurrency` as its only lock. The host chosen
is Cloudflare Containers behind the dashboard Worker (`docs/server-jobs.md`
weighs it against Cloud Run Jobs, a VPS, fitting the fold into 256 MB,
Workflows and folding in Postgres): the same account and `wrangler.jsonc`,
Workers Builds builds the image with the Worker, `npm run secrets` and
`diag.job_runs` are unchanged, and a container is billed only while it
runs. This entry is step one of that plan, the pass for large languages:
- `apps/web/jobs/Dockerfile` is the image: Node 24 and one bundle per job
  (`scripts/build-jobs.mjs`, run by the Worker's build and by `npm run
  web:dev`), nothing installed, so the dependency tree never sits beside
  the key. The object names a job's bundle as the entrypoint, so a later
  job is one more bundle.
- `JobRunner` (`apps/web/worker/jobs.ts`) is one Durable Object per job,
  named by the job, and the lock: the Worker's cron starts it every ten
  minutes, a tick that finds the run under way starts nothing, and the
  tick never waits for the run. It drives the container through the
  object's own container API rather than the `@cloudflare/containers`
  class, which starts containers for requests and ran a sub-second pass
  twice while reporting a failed start. The container gets `SUPABASE_URL`
  and the service key from the Worker's own env. The process writes its
  own job run as before; the object writes one when the process died
  without the chance (`killed:137`, `exit:143` at the 45-minute limit,
  `stopped` without a code), so a dead run is never silent. A pending
  monitor keeps the object in memory for up to 15 minutes, so a longer
  run's exit can go unobserved; its own job run is then the record.
- `standard-1` (4 GiB) with Node's heap at 3 GiB, for Santhali's 850 MB
  fold. Under the big-languages plan's option F the pass will also cut the
  fold into rows, so the peak is measured before F lands and the instance
  type follows it.
- `.github/workflows/projections.yml` is gone, and
  `scripts/workflows.test.ts` holds the allowlist of scheduled workflows to
  `v2-import.yml`, which the import's move empties.
Not changed yet, in order (`docs/server-jobs.md` section 5): one pass for
every language in the container with the Edge Function keeping push
delivery only; the pass as the one producer of per-language aggregates the
Durable Object reads; the v2 import. Supersedes 103.
Reverse if: a run longer than its time limit is needed and cannot be split,
a container is evicted mid-run often enough to matter, or a fold needs more
than 12 GiB; then the same image goes to Cloud Run Jobs, the object keeping
the trigger and the lock. Or if Workers Builds cannot build the image; then
the deploy command builds and pushes it from a laptop, as the Workers are
deployed off Workers Builds today.

Amended (2026-10-19, Carl Sauder): steps two and three are built, in
`docs/server-jobs.md`'s order, without waiting the couple of weeks it gave
step one, at Carl's word. The job tick (`*/5 * * * *`, `jobsModel.ts`
`jobsDue`) starts one pass for every language each time and the v2 import
every 15 minutes, with its whole read at 03:15 UTC; the ten-minute cron
keeps timings, grants and webhooks. Each job has its own object, time limit
(45 minutes for the pass, 340 for the import) and container instance
(`max_instances` 2); the tick leaves a `job_starts` run and each job its
own (`projection`, `v2_import`; `projection_large` is retired). Hosted
projects schedule only push delivery on pg_cron, and the Edge Function
refuses the pass there (410); a local stack keeps the Edge pass every
minute (68). The import's job needs `V2_SUPABASE_ANON_KEY` on the
dashboard Worker, and uses `V2_DATABASE_URL` for people's names when it is
there; `npm run secrets` now puts both there from `.env.production` (94).
psql is the image's one system package, for those names.
`v2-import.yml` is gone, and `scripts/workflows.test.ts` holds that no
workflow holds a production key. The cutover has an order: run
`npm run secrets -- production` from `main` right after the merge, not
before: run from the branch earlier, it would take the pass off pg_cron
before the container is deployed. The import pauses from the merge until
then; `docs/server-jobs.md` section 5 has the steps.

Amended (2026-10-19, Carl Sauder): the first hour in production showed the
job runner's watch does not hold. The tick's call to an object ended after
73 seconds, so nothing was left to record how a run ended; a restarted
object held no keep-alive for its running container (Cloudflare's docs say
to set it again in the constructor), so runs were stopped minutes in, and
neither the pass nor the import wrote a row for an hour. Unpinned, the
containers also started near the cron, in Mumbai, far from the database.
Now: while a run lasts, an alarm brings the object back every minute
(`jobsModel.ts` `heartbeat`, `HEARTBEAT_MS`): it renews the keep-alive for
the time the run has left, sends SIGTERM at the limit, and records a run
that has ended by asking the stopped container how; the constructor renews
the keep-alive too. The pass and the import record their own row when sent
SIGTERM (`sigterm`, exit 0, the code that says the row is written), the
pass logs its progress every 25 languages, and `constraints.regions` pins
the containers to ENAM, beside the database and R2.

Amended (2026-10-19, Carl Sauder): SIGTERM now drains instead of stopping
at once. Every deploy rolls the containers out: SIGTERM, then SIGKILL up to
15 minutes later. A merge's deploy at 03:02 UTC on 2026-10-20 cut off the
whole v2 read begun two minutes earlier, and the object had cleared its
flag at the start, so the read waited a night. Now the pass finishes the
language in hand and the import the project in hand (`PassDeps.stop`, the
`stop` argument of `runProjections`), the rest wait for the next run, and
the import's cursor does not move. The row says `partial` (`error` when
nothing was done) with `sigterm`, and the process exits 75
(`jobsModel.ts` `STOPPED_EARLY`), under 128, so the object writes no row
of its own. A whole read that ends 75, 128 or over, or without a code is
owed again (`stillOwesWholeRead`): the next tick reads everything. The
pass's memory fields are named `maxPeakRssMb`, `maxStartRssMb`,
`maxHeapUsedMb` and `maxHeapLimitMb`, because `diag.totals` keeps the
largest of a `max…` field and sums every other one.

Amended (2026-10-20, Carl Sauder): the object never saw an exit code.
`ctx.container.monitor()` rejects with a plain Error that carries the code
only in its message (`Container exited with unexpected exit code: 75`, or
`Runtime signalled the container to exit: 9`), and `exitCodeOf` read a
property that was not there, so every non-zero exit read as a stop without
a code and the object wrote a false `error` / `stopped` row 0.6 s after the
process's own `partial` / `sigterm` row (six pairs in production on
2026-10-20, from 03:00 to 04:49 UTC, one per deploy rollout; a real OOM
kill would also have shown only as `stopped`, never `killed:137`).
`exitCodeOf` now parses both messages as `@cloudflare/containers` does. The
library passes the number of a signalled stop on as the exit code and does
not say whether it is a signal number or 128 plus one, so a number under
128 there is read as a signal and becomes 128 plus it (9 is 137, 15 is
143); either reading lands at 128 or more, which the object records
(`killed:137`, `exit:143`) and which keeps a whole read owed. An
`exitCode` property, which newer workerd sets, is still read first.

Amended (2026-10-20, Carl Sauder): deploys stop cutting off the nightly
whole v2 read, and a kill gets one row. The whole read took 40 to 70
minutes on GitHub and has never finished in the container: 03:15 UTC is
the team's evening, when merges deploy (five deploys from 03:02 to 04:47
on 2026-10-20), and every rollout stopped it and it began again. The job
container now sets `rollout_active_grace_period` to 5400 seconds: a
rollout leaves a run alone for its first 90 minutes, then sends SIGTERM
and allows 15 more (Cloudflare's rollout docs, which give no maximum),
held by `scripts/cloudflare-deploy.test.ts`. A whole read stopped all the
same resumes where it was (94). The object, tested for the first time
against fakes of the platform's events (`apps/web/test/jobRunner.test.ts`:
made again mid-run, a drain, a kill, the time limit, an end nobody
watched), added a watcher at every minute's beat, so a killed run would
have had a row from each; it now watches once per instance and records
one end at a time, and the second finds the run recorded. The whole read
stays at 03:15 UTC.

Amended (2026-10-20, Carl Sauder): a local stack runs the pass in the
container as well, and the Edge Function, renamed `push-delivery`, keeps
push delivery alone (148).

Amended (2026-10-24, Caleb Koster): ffmpeg joins psql as the image's system
packages, for the v2 import's conversion of MP3 and WebM to M4A (94). Built
locally, the image grows from about 320 MB to 710 MB; with half a CPU it
converts a 20-minute chapter in about 27 seconds.

Amended (2026-10-28, Caleb Koster): the tutorial videos are filmed each
night in GitHub Actions (`.github/workflows/tutorials.yml`, 183), a
scheduled workflow, which this entry keeps from production jobs. It is not
one: it holds the Gemini key and the repository's own token, no production
key, and writes only to the repository's public `tutorials` release, from
which the job container's `tutorial-intake` takes the films into R2.
Filming needs the local stack and a browser, which a runner has and the
job container does not, and a late or dropped run only leaves the videos as
they were a day longer. `scripts/workflows.test.ts` lists it among the
scheduled workflows.

## 142. The projection pass stores what each language's report is made from, and the dashboard renders reports from it without folding

Date: 2026-10-19 · By: Carl Sauder · Status: accepted

Reason: the organization's Durable Object folded every language to answer
Reports (44), in a 128 MB isolate that a Bible-size language does not fit
(132), and folded every language again when the UTC day turned, because a
report's windows (53 weeks, 90 days of progress, 35 of uploads, 13 months,
the 14-day stuck alert) end today. `docs/server-jobs.md` makes the pass, on
the job host that folds every language anyway (141), the one producer of
per-language aggregates. A stored report would go stale at midnight for a
language nobody touched, so the pass stores the report's inputs instead:
core `reportInputs` extracts from the fold everything `languageReport`
reads, keyed by day, week and month for all time and with nothing from the
organization stream, and `renderLanguageReport` makes the report for any
day from them; `languageReport` is the two composed, so every report test
holds them equal, and a test holds inputs stored as JSON and rendered up to
400 days later equal to a fold on that day. Two things are summarized where
a list would grow: the upload log keeps only the days it can still show,
and cards already stuck when extracted are a count, the oldest and their
passages (two imported languages held 89,000, 7 MB a row). Rows live in
`language_report_inputs` (service role only), written each time the pass
folds a language; an upload is no longer quiet for the pass (68). The
object renders from them, folding only a language with no row, or, on a
catch-up, one whose row is behind its stream and that has at most 25,000
events (44's amendment), so "Catch up with the server" still shows what
was just done. Checked on
the local database: 105 languages, every stored row renders the report a
fold of the same events gives, today and 20 days on; the largest row was
750 KB of text.
Not chosen: storing the rendered report and refolding every language once
a day (decision 40's way; a daily snapshot download per language, and stale
figures between midnight and the next pass); a per-language people list
(who may see a language comes from the organization stream, which the
object folds itself, small).
Reverse if: the object reads stored inputs often enough to cost more than
the folds did, or the inputs of a language outgrow a few megabytes (then
store them in pieces, as snapshots are, or summarize more of them).

Amended (2026-10-20, Carl Sauder): the object no longer folds a language of
more than 25,000 events (`FOLD_ON_CATCH_UP_EVENTS`) for a report at all
(147). With no stored inputs for this REPORT_VERSION (before the pass first
reaches it, or after a new version until the pass rewrites it), the answer
names it in `preparing` and Reports says its report is being prepared and
shows within a few minutes; it renders from its inputs once the pass stores
them. A Bible-size language folded whole does not fit the isolate, and the
report needs every passage's record, which the shared part of the cut does
not hold. Smaller languages fold as before when they have no inputs.

## 143. A big language keeps each passage's record on the phone's disk; memory holds the passages on screen, and lists read one line per passage

Date: 2026-10-19 · By: Caleb Koster · Status: accepted

Reason: a phone held a whole language in memory. On a 2 GB test emulator
Koro Miyan (37,000 recordings, 541 versions) added about 235 MB once open,
and a language four times its size was killed by Android. Caleb asked for
this to be solved before cheap phones open big projects in the field, all
of it at once rather than in parts. With `keepOnDisk` (on for every
language in the app: `useLanguage` opens `LanguageSession` with it), every
entry of the maps core cuts by passage (`PASSAGE_PARTS` in
`passageParts.ts`: recordings, versions and drafts, submissions,
responses, reviews, departures, requests, notes, study marks, verse marks,
reference links and uses, key-term ties, releases) and the server's
verdict on each audio file go to the phone's `kept_rows` table with each
checkpoint, in the same commit; the checkpoint holds what the whole
language shares (its passages, flow, teams, materials, key terms). An entry
whose passage cannot be found yet (an undo of a departure that has not
arrived) stays with the checkpoint until it can. Rows combine with later
events by each part's `merge`, which mirrors the reducer's own case and is
tested on every split of the fixtures' events, so the phone's language is
the in-memory fold's in any order. A first download is read back one piece
at a time (`stateSplitter`, `SnapshotRows`), so neither the whole text nor
the whole state is ever in memory. Its rows go straight into the table
(moving Koro's 160,000 rows from a staging id took 200 s on the emulator),
and rows with no checkpoint beside them are dropped when a language opens,
so a download cut short is never read; a phone replacing a language it has
(after a redaction) writes the new rows aside and switches with its
checkpoint. A language's syncs, pushes, pulls and refolds take turns on a
phone (`SyncClient.exclusive`), whichever session starts them: two first
downloads at once (the scheduler's and "Sync now") each cleared the rows
the other wrote, and a fresh phone showed recorded passages as not started.

Memory holds the passage on screen, two on each side, and its book and
chapter (`loadUnits`, `shell/usePassagesInMemory.ts`), what arrived since
the last checkpoint, and the verdicts on files anything in memory names. A
passage's screen waits the moment it takes to bring it in
(`shell/usePassageReady.ts`).

Lists read one line per passage (`PassageLine`, core `passageLines.ts`):
Map, Progress, My Work, the Inbox badge, Up next, the overview, Get ready,
set-aside counts, a book's divisions and who usually reviews a check. A
line is core's own `derivePassage` of that one passage, worked out from its
rows and memory (`KeptLines`) whenever an event touches it, and every line
when the flow, its kinds or the teams change. Lines are kept beside the rows
(a few hundred bytes a passage: Koro's 570 are 0.37 MB), and the lines still
owed are written with each checkpoint, which prunes the events that owe
them. The Inbox, a check logged across several passages and a key term's
uses read the few passages they need from disk (`withPassages`); the Inbox
reads a passage again only when its line changed. File planning (what to
send, fetch or free, the offline counts) reads which record names each
file, in which passage (`audio` rows), and the verdicts, never the records
(`LanguageFiles`, core `FilePlan`), so a person who keeps a whole language
offline holds its file list, not its records.

Nothing here needs a migration. The rows are the checkpoint cut up: a new
reducer version drops the checkpoint and its rows together, as before, and
the phone downloads again. Lines are worked out by the app's code, so they
are stamped with the build that worked them out (`appBuild()`: a web page's
commit, a phone's runtime and update) and every line is worked out again
under a new one. Two rules come with it, each held by a test: a new map in
the state says whether it is cut by passage, and if so how to find its
passage and combine two copies (`passageParts.test.ts`); and app code never
loops over passage records or calls one of core's answers about every
passage (`READS_EVERY_PASSAGE`) on the live state, outside a short list
saying why its passages are in memory (`apps/mobile/test/wholeLanguage.test.ts`).

The server, its snapshots, the events and the reducer are unchanged; the
Worker and server jobs hold whole languages in memory as before. Tests: a
phone kept on disk agrees with one held in memory on every record and every
line, through checkpoints, restarts, a first download, an old checkpoint
and a redaction (`keptLanguage.test.ts`), and half of a fleet kept on disk
ends with the server's language and lines and moves all its audio
(`fleet.test.ts`). Koro's part in memory is now 0.13 MB of shared language
and 0.37 MB of lines (as JSON), against 40 MB. Measured on a 2 GB emulator
with a release build, Koro adds 2 MB to the app once open instead of
182 MB (43 MB at the peak instead of 227), and opens in 9 s; a language four
times its size adds nothing once open instead of 852 MB (59 MB at the peak
instead of 1.7 GB), and opens in 33 s.
Reverse if: bringing a passage in from disk makes moving between passages
noticeably slow on a cheap phone, or the lines themselves outgrow cheap
phones (then lists page their lines from disk).

Amended (2026-10-16, Carl Sauder): merged onto main at decision 133 as
`carl/big-languages-e`, option E of `docs/big-languages-plan.md`, which
weighs the alternatives and sets out option F (the server cuts the
snapshot by passage) as the step after. What the merge settled:
`markChanged` is an `all` touch for the incremental views (120); a
checkpoint from another reducer takes the kept rows and lines with it
(110); a review or note taken back is a passage part hanging on what it
takes back (111); two copies of a take keep the first archive's who and
when (124). Closed on the way: a pull of the whole log from the start
(after a reducer bump before the server has a snapshot for it, or a
redaction waited out) skipped every checkpoint until the tail was reached,
so a language of Santhali's size would have been folded whole into memory
before its first cut to rows. A language kept on disk now checkpoints
every `checkpointEvery` events while catching up, each one moving the
passages folded so far onto disk and out of memory, except once a
redaction was pulled in the slice, whose target the refold at the end
undoes from the log (`keptLanguage.test.ts` holds a pull from zero under
the limit throughout). Known cost: a first
download works out every passage's line on the phone (Koro × 4: 33 s; a
language of Santhali's size, an estimated one to two minutes), which F
removes. Still open from the plan: folding the local log in pages rather
than from one array (`store.all`), and moving the whole-language guard
(`apps/mobile/test/wholeLanguage.test.ts`) into lint.

Amended (2026-10-19, Carl Sauder): merged with main again, and the
entry is 143 (main took 134 to 142). A kept language's local checkpoint
leaves its passages out, so a build from before this one (an update rolled
back) would read it as the whole language at the same reducer version,
show passages empty and save that. Carl chose not to bump
`REDUCER_VERSION` for it, since the fold's output is unchanged and option F
changes the local format again soon: two forced downloads of every
language for no change to the fold. Instead the local checkpoint is tagged
`reducerVersion * 100 + KEPT_CHECKPOINT_FORMAT` (`keptCheckpointVersion` in
`packages/sync/src/syncClient.ts`). A build that only knows whole
checkpoints matches no such tag, so it drops the checkpoint with the
stream's cursor (110) and takes the server's snapshot, which keeps the
plain reducer version. This build reads its own tag, and also a whole
checkpoint of its reducer, which it moves onto disk on open, replacing
any rows left from before rather than combining with them, since a
redaction may have come between. `KEPT_CHECKPOINT_FORMAT` is raised
whenever what a kept checkpoint leaves out changes; F raises it.
`keptLanguage.test.ts` holds a rollback and a roll-forward across a
redaction. A reducer bump stays for changes to the fold's output.

Amended (2026-10-20, Carl Sauder): the two items left open are done, and
the live duplicate guard is compacted. The local log is folded a page at a
time (`EventStore.page`, in id order after a cursor, by type when asked;
SQLite indexes `(org_id, stream_id, id)`), on load, on a snapshot adopt
and on the slow checkpoint path, so a phone back from a long offline
stretch never holds its log in one array. Redactions are read first, as a
whole fold applies them, so a target on any page is never applied; the
rest of the fold is order-independent (invariant 2). After a fast
checkpoint of a kept language, the live state's `appliedEventIds` keeps
only the events still in the log, as a relaunch has it: a pull asks for
what is past the cursor, and a refold starts from the checkpoint, whose
guard is empty. Our own events pushed and not yet pulled stay in the log,
so their pull is still skipped. The capped-heap pull of a whole log now
retains 2 MB, down from 11 (`keptMemory.test.ts`). The guard is now lint,
`whole-language/no-every-passage` (`scripts/lint/wholeLanguage.mjs`): it
reads the syntax, so it caught a loop the regular expression missed
(`Object.values(state.kindReviews ?? {})` in `workspaceModel.ts`, which
runs on the passage on screen and is listed). It also reports a listed
read that is gone. `wholeLanguage.test.ts` holds the rule's lists equal to
core's `PASSAGE_PARTS` and `READS_EVERY_PASSAGE`. And a redaction pulled
on the same page as its target no longer reads as one inside the
checkpoint: the pull looked the target up in the store before the page
was written, so the phone waited for a fresh server snapshot, skipped its
checkpoint and asked again on every pull, for a target a refold of its
own log removes. The page's own events are looked at first.

## 144. The Worker in `apps/web` is "the app's Worker"; "dashboard" names it only as history

Date: 2026-10-20 · By: Carl Sauder · Status: accepted

Reason: the Worker began as the web dashboard's server (decisions 40, 43,
44) and was named for it, `langquest-next-dashboard`. It now serves the web
app (58), the reports API, recordings and guide media (69), the access-token
API and MCP (70), review links and webhooks (72, 101), and runs the server's
jobs in containers (141). Calling it the dashboard misleads; Carl asked
(2026-10-20) for every leftover to go. Code, docs and the job schedule's
descriptions (migration `20261020100000_job_schedule_names_the_app_worker.sql`)
now say "the app's Worker", the name decision 69 already used, and
`scripts/secrets.mjs` calls it `app`. The one place people saw the word,
Reports' message for a 502, says "The server could not read this
organization just now" in all 15 catalogs. Past entries keep "dashboard":
the log is never rewritten. The Vault key `langquest_dashboard_url` stays,
since it holds the domain, not the name, and renaming it would change two
database functions for nothing.
The Cloudflare names (`langquest-next-dashboard`, its `-preview` copy and
the container application `langquest-next-dashboard-jobrunner`) are not
changed by this entry. A Worker's name is its identity: a renamed Worker is
a new one, and its Durable Objects start empty. The organization objects'
SQLite holds the change feed's numbering, each webhook's position in it,
the outbox and the delivery history (101), which partners rely on. Keeping
that state across a rename needs Cloudflare's transfer handoff (`exports`,
about five deploys by hand, not documented for a class with a container);
a fresh Worker would restart the feed for every partner. Which of those, if
either, is Carl's call; `docs/cloudflare.md` says why the name is old.
Reverse if: never for the words. The Cloudflare names change when a rename
path is chosen; then amend this entry and rename to `langquest-next`, which
matches the domain.

Amended (2026-10-20, Carl Sauder): the Cloudflare names change too, to a
fresh Worker `langquest-next` (its preview `langquest-next-preview`, its
container application `langquest-next-jobrunner`). The only webhook was
Frontier's own EveryBible prototype site, quiet since 2026-10-16, whose
owner will start its change feed over, so Carl chose a fresh Worker over
the transfer handoff. Organizations' report caches rebuild on first use;
webhook state starts over; the webhooks, the domain, R2, the Vault values
and the database carry on. `docs/cloudflare.md`, "Renaming the app's
Worker", is the cutover; `scripts/cloudflare-deploy.test.ts` holds the name.

## 145. Feedback is sent from help mode as an account change, with the install id, and a screenshot and profile only when switched on

Date: 2026-10-20 · By: Caleb Koster · Status: accepted

Reason: Caleb asked (2026-10-19) that the ? in the corner also let people
send a bug report or a feature request directly, with a non-PII id that
leads to the phone's diagnostics, and optionally their profile and a
screenshot of the screen they were on.
- **Where.** While help is on for a screen (not a sheet), a lit Send
  feedback button waits at the foot of the screen, above the tabs
  (`feedback/FeedbackSheet.tsx`). It is green with a white
  ring and a grip, so it is not taken for one of the screen's own purple
  buttons, and it can be dragged anywhere in the screen's area (kept there
  while the app runs). A screen in help mode ends above a strip it leaves
  at its foot for the button (kit's `Screen`, `HELP_FOOT_ROOM`), its footer
  too, so the button covers nothing where it starts. Like the ?, it acts rather
  than explains (71): it turns help off, takes the window, then opens a
  sheet: a problem or an idea, what happened (typed, said in a voice note
  of up to two minutes, or both), and two switches, both off,
  for the screenshot (its thumbnail) and the person's name and email or
  sign-in name (what would be sent is shown). Help in a sheet has no button:
  a sheet is its own window on Android, so its picture would be the screen
  under it, and the feedback sheet would open over another sheet.
- **The id.** The install id diagnostics already use (39, the event
  envelope's `deviceId`), not a new one. It is pseudonymous: the server also
  knows the account that sent the report, as for diagnostics. With
  diagnostics turned off it still comes, with nothing behind it.
- **Offline and shared phones.** A report is an account change
  (`AccountAction` kind `feedback`): it waits in the account outbox for
  months, holds sign-out like any saved change, goes with a hand-over and is
  sent as its author (60). Its screenshot waits beside it as a file (on the
  web in the browser's storage), not in the outbox, whose single stored row
  would otherwise grow past what Android keeps in one. Written before
  sign-in, it waits in its own list (at most 10) and joins the outbox of
  whoever signs in next: no endpoint takes anything without an account (112;
  Caleb agreed on 2026-10-20 that only signed-in people send feedback).
- **The server.** `diag.feedback`, beside diagnostics but not one of them
  (they stay counts and codes): kind, words, install id, the diag context
  plus the screen and the app's language, the name and email read from the
  account only when shared, the screenshot as a JPEG of about 720 px (at
  most 1 MB) and the voice note (a phone's AAC; the web's WAV written again
  at 16 kHz; at most 4 MB) in the row, so deleting the account (`_delete_account`)
  deletes it with one line and no storage policy or signing key is
  involved. One way in, `public.feedback_submit` (signed in, idempotent by
  id, 20 a day per account, refused with 54000 past that, which the phone
  retries later); read only through `diag.feedback()` and
  `diag.feedback_screenshot()` and `diag.feedback_voice()` (diag_reader: `npm run diag -- feedback`
  and the admin page); New, Seen and Done are `seen_at`/`done_at`, set by
  `public.feedback_set_status` (service role). Kept a year.
- **Stores.** Google Play: no new answer (other in-app messages, photos,
  name, email and device ID are declared, optional, for app functionality;
  docs/play-store-declarations.md). Replying by email would add "Developer
  communications" to Email address. Apple: no new row either. Apple's
  closest type is User Content → Customer Support ("data generated by the
  user during a customer support request"), but these reports are one-way,
  with no support conversation, so they are filed under Other User Content,
  already declared; the screenshot is a picture of the app, not the
  person's photos (Caleb's rule: no change forces a new store declaration;
  he chose this on 2026-10-20). The voice note is Audio Data (Apple) and
  Voice or sound recordings (Play), both declared.
  If replies or a support conversation are ever added, Customer Support
  must be declared first. The privacy
  policy says what is kept, who sees it, for how long, and that deleting
  the account deletes it.
- `react-native-view-shot` takes the picture on a phone: a native module,
  so phones get it with the next store build, not an update. On the web
  `html-to-image` draws the page, loaded only when feedback is sent
  (view-shot's own web drawing, html2canvas, put the web app's chunks
  83 KB over their 6.5 MB cap).
Reverse if: people need to send feedback before they can sign in (a report
that sign-in itself fails would wait); that needs a way in without an
account, which 112 turned down for diagnostics.

## 146. New language shows its six steps first, asks for reference material before the review flow, sets its checks up on their own pages, and its invite can put people on checks

Date: 2026-10-20 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-19): New language felt like an endless set of steps
with no idea of what comes next; its custom review setup still had a switch
joining a check to the one above, unlike a ready language's checks, where
each check picks any others it runs alongside; the review flow came before
the reference material, so it could only be picked, never said what each
check sees; and the last page, "What will they do?", read as choosing one
kind of person. He asked for the material before the review flow, for each
check to choose what of it (and of earlier checks' output) its people see,
for people to be put on checks while inviting (skippable), and for a
slideshow that reveals one thing at a time. Built:
- An overview first: the six steps (Language, Content, Split into pieces,
  Reference material, Review flow, People) down one path, each with a small
  picture, coming in one after another (none of it moves with reduce
  motion), then Start. Every page after it carries the six as a bar, done
  ones ticked and its own lit (`org/NewLanguageStages.tsx`,
  `org/stagesModel.ts`). Help mode says what each step is; the pages carry
  no sentences explaining it.
- Reference material comes before the review flow: the languages it is in
  (decision 130), then what the team will have in them, a tick per Bible,
  set of study guides and note, the old suggestion ticked
  (`org/MaterialPicker.tsx`, `useNewLanguageOffers` in `screens/org.tsx`).
- The review flow: a ready-made flow to start from (only flows in the
  team's languages or saying none, decision 84 as amended 2026-10-20, now
  that those languages are asked first), or none ("I'll choose the
  checks"), then the language's checks on the pages a ready language
  sets them up on (the list with Add a check, each check's page with its
  people, questions, what is on their screen, helps, must pass, same time as
  any others, and checked at). The language does not exist yet, so those
  pages work on a draft: the events it will start with, folded as its stream
  would fold them (`checks/languageDraftModel.ts`, held by `checks/draft.ts`), given
  to the same screen code through a ctx whose language is the draft
  (`checks/draftCtx.ts`, `useDraftAware`; `draft: '1'` on `check_editor`).
  Its people are the organization's own until people are invited. Adding the
  language sends the draft's events in its stream under ids of that language
  (`draftSpecsFor`), each language of a cluster its own copy, in place of
  the flow copied at the end (decision 91). Choosing another flow after
  changing the checks asks first. The draft's old Checks screen
  (`DraftChecks`, its "Same time as" switch) is gone.
- A step that makes something (back translation) says the language it is
  made in, on its check's page and on a library flow's step sheet, from the
  team's reference languages or the language list (`checks/IntoSheet.tsx`):
  `produces.into`, as `v1.ReviewKindDefined` and a flow's kinds already
  carry it; no new event. Caleb asked for this the same day.
- Inviting, here and from Members: "Time to invite people" (New language) or
  "Who are you inviting?" over a card per role, each with what it brings
  ("Translators"), what it lets them do one tap open (its role's switches
  that are on, and where), and its own Invite button; no radio buttons. A
  role that does checks can then be put on some of the open language's
  checks (skippable), and the code carries them: a new invite column
  `checks` and `issue_invite_v4` (migration 20261019220000), which needs
  Manage teams in that language and a role with Review; joining appends
  `v1.ReviewTeamMemberSet` for each check to the language's stream as the
  server (`redeem_invite_for`), while the inviter may still manage teams
  there. The inviter's phone names each check's team first (core
  `checkTeamSpecs`). Email invites and a code for one person by name do not
  carry checks yet.
Not built: per-Bible choices on a check's screen (a check turns the team's
Bibles on or off together, and adds a particular one as its own help);
Get ready's invite question keeps its role chips (it makes a code as it
opens, which is what counts the language as ready).
Reverse if: admins skip the overview so often it is only in the way, or
teams need checks set up before reference material is known; then the order
can change without touching the draft, which works for any step order.

## 147. The server cuts each language's snapshot by passage and keeps every passage's line, and a phone's first download fills the passages in behind the Map

Date: 2026-10-20 · By: Carl Sauder · Status: accepted

Reason: under decision 143 a phone holds a big language on its disk, but
its first download still moved the whole snapshot (Koro Miyan: 40 MB, about
five and a half hours at the slow link's 2 KB/s) and worked out every
passage's line on the phone before the language opened (a language four
times Koro's size: 33 s). Carl chose option F of
`docs/big-languages-plan.md` (sections 3, 4.2 and 5), with the host plan's
settled points: the pass folds a whole language on the 4 GiB job host
(141) and then cuts it; it is the one producer of per-language aggregates
(142); decision 3 stands. The cut is the phone's own code: core
`partEntries` places each entry and sync `entryRows` makes its row
(`packages/sync/src/serverCut.ts`), as `SnapshotRows` does reading a
snapshot's text; `serverCut.test.ts` holds the two equal with the text in
jsonb's key order, and the integration test holds Postgres's rows equal to
the phone's cut of the same snapshot's pieces. Two rows the phone keeps are
not stored: which record names an audio file (`audio`, made again on the
phone from the entry), and a file's verdict goes under the passage of the
first record naming it, so it comes with that passage (`''` when none
does).
- Storage (migration `20261020150000_snapshot_units_and_passage_lines.sql`):
  `snapshot_units` holds the rows of each language's newest snapshot, with
  what the whole language shares as one row (kind `shared`, unit `''`). The
  pass sends them in batches of 2,000 to `snapshot_units_staged`
  (`stage_snapshot_units`) and `put_snapshot` moves them in, in the same
  transaction as the snapshot; only the newest snapshot keeps rows, since a
  phone fills from the newest snapshot at or past the one it started from,
  and rows go with their snapshot (88). `passage_lines` holds every
  passage's line of a `LINES_VERSION` (`put_passage_lines`, written each
  time the pass folds the language, rewriting only lines that changed; its
  `''` row is the seq every line holds at). Lines are their own table, not
  rows of the snapshot (the plan's sketch), because they change with every
  pass and with `LINES_VERSION`, not with the snapshot. A phone reads them
  through three RPCs: the head (`get_snapshot_head`: the shared part, each
  passage with rows and how many, and the lines), a few passages' rows a
  page at a time in (unit, kind, id) order (`get_snapshot_rows`), and which
  passage an entry is in (`get_snapshot_passages`). `snapshots.state` is no
  longer written (performance-audit-app.md V7): builds from before and the
  Worker read the pieces (89), and `get_snapshot` and
  `diag.language_health` read the pieces and the size.
- `LINES_VERSION` (core `passageLines.ts`) says what a line says, beside
  `REDUCER_VERSION`; `linesVersion.test.ts` holds it to a hash of
  `passage.ts` and `passageLines.ts`. The pass's `PROJECTION_VERSION`
  includes it, so a bump writes every language's lines on the next pass,
  and a language with nothing new gets the cut and the lines it lacks when
  the pass visits it. A phone takes server lines only of its own
  `LINES_VERSION`, and only lines that hold at or past the snapshot.
- The fill (`packages/sync/src/keptFill.ts`): a first download takes the
  head, keeps the shared part as its checkpoint and the lines as its lines
  in one write, opens the Map, and pulls the tail. Before a pulled page is
  folded, every passage an event past the lines' seq touches is filled
  (an event on a take, review, departure, request or note the phone does
  not hold asks `get_snapshot_passages`); so a line is either the phone's
  own reading of rows it holds or the server's line of a passage nothing
  pulled past that line has touched, and the Map is exact. Then, between
  syncs while online (`SyncClient.fillSome`, outside the pull, so audio
  moves meanwhile): what a screen opens or this phone's own work touches,
  the person's offline scope (61) and the passages whose record concerns
  them, then the rest in the server's order, about 1,000 rows a request.
  Rows from any snapshot at or past the shared part's join what the phone
  holds by each part's `merge` (143), so a snapshot rolling forward
  mid-fill costs nothing. The end state is 143's: every passage's rows on
  disk. The fill's record is kept beside the checkpoint
  (`fill:<org>/<stream>`, and a `filled` row per passage written with its
  last row). Without a cut, without lines of this `LINES_VERSION`, or with
  lines older than the snapshot, the phone downloads the whole snapshot as
  under 143.
- Two transients, both named in the plan. A change to the flow, its kinds
  or the teams past the server's lines changes what every line says: the
  lines of passages not filled in stand until the pass writes new ones
  (taken once they hold at or past the phone's and no further than it has
  pulled) or the fill reaches them. And this phone's own work on a passage
  not filled in yet (a request made from the Map, say) shows in lists once
  the passage fills, which is at once online and on reconnecting offline;
  offline, such a passage opens as its line ("Not on this device yet;
  connect to download"), so no one records into it. A redaction while the
  fill runs, or of an event the fill's rows or the server's lines hold,
  waits for a snapshot past it and starts over from the cut.
- The phone's checkpoint format is 2 (`KEPT_CHECKPOINT_FORMAT`, 143's
  amendment): a build that knows only format 1 drops a partly filled
  checkpoint and downloads the language again; this build reads a format-1
  checkpoint as filled. No `REDUCER_VERSION` bump: the fold is unchanged.
- Screens (decision 61's element, `docs/ux/demo-parity.md`): the Map and
  the Sync screen show "Downloading this language" with how many passages
  are on this device and the progress bar; a kept passage is on this device
  once its rows and its audio are; offline, a passage not reached yet shows
  where it stands, its latest version and by whom, and its open requests,
  with "Not on this device yet".
- The organization's Durable Object (44) reads languages the same way for
  the access-token API (70), MCP, review links and webhooks (101): sync's
  `SyncClient` per language, kept on disk in the object's own SQLite
  (`LanguageRecordsKeeper`, `apps/web/worker/languageRecords.ts`, its
  driver gathering a transaction's statements into `transactionSync`),
  four languages open at once, the fill running between answers. The
  passage list, the webhook digest and a token's writes read slices of 25
  passages (`inSlices`); one passage, a review link and a write read that
  passage; whether a voice note is new reads the kept `audio` and `file`
  rows of the whole language, filled in first. `SqliteStore` hands id
  lists to SQLite as one JSON array, since a Durable Object takes few bound
  parameters. Under the 112 MB heap of `orgFolderMemory.test.ts`, a token
  listing every passage of a Bible-size language (4,000 passages of 15
  versions, about 48 MB of fold) peaks at 80 MB and keeps 18 MB, and a
  webhook scan of it peaks at 97 MB and keeps 20 MB; folded whole, the same
  language runs out of memory. Reports need every passage's record, so
  they are never made from the shared part: they render from the inputs the
  pass stores (142), and a language past 25,000 events with none stored yet
  is named as being prepared rather than folded (142's amendment).
- A small language (at most 2,000 rows to fill) is filled in whole in its
  first sync, right after its Map opens, so it is whole on the device when
  that sync ends, as before the cut; only bigger languages have the fill's
  window.
Numbers. Before its Map opens a phone now downloads the head: for Koro,
the shared part (0.13 MB) and lines (0.37 MB) that 143 measured on Koro
itself, 0.5 MB as JSON, about four minutes at 2 KB/s against 40 MB and five
and a half hours. Santhali (61 MB, eight and a half hours) was not measured:
a synthetic language of its size (3,200 passages, 224,000 events, a 58 MB
state) has a 1.5 MB head, about twelve minutes. `scripts/bench/fill.ts
--org --language` measures a hosted language's head and rows, raw and
gzipped, with the bench's service key. In the capped-heap test (40 MB) a
first download by fill peaks at 21 MB against 23 MB from the snapshot, with
0.7 MB of its 32.7 MB moved before the Map opens; on the job host the cut
and lines take the Santhali-size fold from 318 MB of heap (533 MB
resident) to 353 MB (679 MB) (`scripts/bench/cutPeak.ts`), well inside
`standard-1`.
Not chosen: rows for every retained snapshot (only the newest is ever
read); sending the rows inside `put_snapshot`'s call (a second copy of a
61 MB body in one request); filling only the person's own passages and
showing server lines for the rest (the Map would mix stale lines with
exact ones; section 4.2).
Reverse if: a first download's head outgrows a slow link (then page the
lines too), phones rarely finish a fill and live on transients, or keeping
the rows beside the pieces outgrows the database plan (then the pieces go,
once no build reads them).

Amended (2026-10-20, Carl Sauder): the fill does not narrow decision 3.
Decision 3 leaves cold start to the server, and a cold start is any start
from the server, not only a phone's first download: an update that changes
the reducer or the kept checkpoint's format drops the checkpoint and puts
the cursor back to 0 (110, 143's amendment), as does a redaction the phone
waited out, and a reinstall has nothing at all. Ever since phones prune
their log behind a checkpoint, such a phone held its own unsent events but
not the pruned history (the passages' `UnitAdded`, the flow, earlier
versions), so it could not show that work in place or usefully carry on
until a whole snapshot or the whole log came down: hours on a weak link
for a big language, before 143 and under it. The fill shortens that
window to the head; the one thing it adds, a person's own unsent work on a
passage not filled yet reaching lists once that passage fills, falls
inside it. Heads measured in production on 2026-10-20 (reducer 19, lines
version 1, as JSON; at 2 KB/s): Santhali omt bible 0.18 MB shared and
0.47 MB of lines for 652 passages against a 64.6 MB snapshot, about five
minutes against nine hours; Halbi 0.51 MB against 50.7 MB; Kuturmi Iwingo
EL 0.69 MB against 50.0 MB; Bhujel 1.12 MB (1,173 passages) against
43.8 MB; Meche 0.47 MB against 40.8 MB. Santhali's real head is under half
the 1.5 MB the synthetic language gave. All 370 languages at reducer 19 had
their cut and lines. Snapshots of reducer versions 15 to 18 are still kept
(88 expires older snapshots of the same version only); whether they expire
is open.

Amended (2026-10-20, Carl Sauder): a fill reports itself in field
diagnostics, so support sees one that should have run and did not. A
`fill` record (`DIAG_SCHEMA`, migration `20261020180000_diag_fill.sql`)
says `start` when the Map opens (ms to the Map, head size, passages and
rows to fill, why), `done` once every passage's rows are here (ms since
the start, across sessions), `fallback` when the phone took the whole
snapshot instead (`no_rpc`, `no_cut`, `no_lines`, `old_lines`, `error`),
and `restart` when its cut went away. A fallback is recorded only once the
whole snapshot is taken, so a language with no snapshot at all stays the
`snapshot` record's `none`. `diag.install_summary` carries a phone's last
20, and `scripts/diagSignals.ts` reads them: a fallback the server caused
(no cut or lines) is a problem pointing at the projection pass, other
fallbacks, restarts and a fill unfinished a day on are a watch, and a fill
that took over a day is noted. Field names and values are enums and
counts, so no Play declaration changes.

Amended (2026-10-20, Carl Sauder): the fill puts a page's rows in memory
after its write, for the passages memory holds by then. It used to decide
before the write and then wait for it. A screen that opened a passage in
that wait read the disk before the rows landed and was told the passage
was ready, and the write then marked it filled. The passage read as loaded
with its records in neither memory nor disk's answer, and the passage
screen, which shows a passage once it reads as loaded, drew it as never
recorded. Web UI tests REV-017 and REC-011 failed this way on CI, where
each world has a cut by the time a fresh browser opens its language.
Putting an entry twice is a join, so a passage that also read those rows
from disk loses nothing. `keptFill.test.ts` holds the write open while the
passage opens.

Amended (2026-10-26, Carl Sauder): three storage changes, none of which
changes what a phone receives (migration
`20261026170800_snapshot_cut_storage.sql`). `put_snapshot` counts each
passage's rows once and keeps them on the snapshot (`snapshots.unit_counts`),
so `get_snapshot_head` reads them instead of counting every unit row on a
cold open (a cut from before is counted as it was until its next snapshot;
the migration fills the existing ones). `snapshot_units_staged` is
unlogged: its rows live minutes and are written again into `snapshot_units`,
so keeping them out of the WAL takes about a third off a snapshot's write;
a crash empties it and the next visit stages the cut again. Lines keep a
digest (`passage_lines.digest`) and the pass sends only the lines whose
digest differs from the stored one, and the ids of passages that have none
(`passage_line_digests`, `put_passage_lines_delta`); `put_passage_lines`
remains for a pass that cannot read the digests, and now finds the lines to
drop by a join rather than a scan per stored line. Not changed: the staged
rows are still inserted into `snapshot_units` and the old ones deleted, since
the table is keyed by the snapshot's seq and a new seq is a new row;
decision 88's retention is as it was.

## 148. A local stack runs the projection pass in the job container too, and the Edge Function is push-delivery

Date: 2026-10-20 · By: Carl Sauder · Status: accepted

Reason: after 141 the Edge Function `stream-projections` only delivered
pushes on a hosted project and refused the pass there (410). Only a local
stack still ran the pass through it, every minute (68's amendment of
2026-10-19), on a path production no longer took: small languages only
(`isLarge`, a 10 MB snapshot or 25,000 events past it), stopping at the
first failing language, inside an Edge runtime's memory. So local runs and
the web UI tests checked a pass production did not run, and the function's
name said it projected. Carl chose (2026-10-20) to run the pass locally as
production does:
- `npm run web:dev` and `e2e/ui-web.sh` (the UI suite's Worker, and so CI's
  ui-web job) build the job bundles and start `wrangler dev` with the job
  container under `scripts/job-tick.mjs`, which fires the job tick at
  `/__scheduled` every minute while the Worker runs. Every minute, not the
  Worker's five, so one phone's ask reaches the other soon and the UI tests
  find Inbox rows and listings (68). JobRunner stays the lock. The UI suite's
  Worker runs from the local config copy (`scripts/web-dev-vars.ts`), which
  sends `/__scheduled` to the Worker and points the container at the
  database through `host.docker.internal`; workerd maps that name to the
  host on Linux too.
- `scripts/local-db.mjs` schedules no pass; the schedule migration
  unschedules the one an older checkout left.
- The function is `push-delivery`, built from `server/pushDeliveryEdge.ts`
  and `server/pushDelivery.ts` alone, so its bundle carries no core or fold.
  `isLarge`, `LARGE`, `ProjectionScope` and `ProjectionFailed` are gone; the
  pass always goes on past a failing language. Migration
  `20261020160000_push_delivery_function.sql` reschedules
  `langquest-push-delivery` to `/functions/v1/push-delivery`
  (`scripts/secrets.mjs` `SCHEDULE_MIGRATION`, `CRON_JOB`), and
  `npm run secrets` checks the job calls it. The secret and Vault names
  (`PROJECTION_WORKER_SECRET`, `langquest_projection_worker_secret`) stay,
  so no secret is reset.
Cost: the local pass needs the Worker and Docker running. A database
started alone (`npm run db:start` without `web:dev`) gets push delivery but
no Inbox rows from work, listings or server snapshots; `dev:local` starts
both. The first `web:dev` builds the job image, and CI's ui-web job builds
it on each runner. A `web:dev` left running projects under `npm run
db:test`'s smokes, which count snapshots and Inbox rows, so stop it first.
Cutover: Supabase's GitHub integration applies migrations before it deploys
functions, so for about a minute after the merge the push job calls a
function that does not exist yet, and the rows wait for the next minute.
The integration never deletes a function: `stream-projections` is deleted
by hand once `push-delivery` answers.
Reverse if: the container cannot run on CI's runners reliably, or building
the image makes `web:dev` too slow for daily work; then a local stack goes
back to running `server/projections.ts` (still the container's entry
point) from a Node process the tick starts, not to an Edge pass.

Amended (2026-10-20, Carl Sauder): the secret is named for push delivery
after all, since nothing else reads it: `PUSH_DELIVERY_SECRET` in
`.env.<env>` and as the function's secret, `langquest_push_delivery_secret`
in Vault. Carl chose to rename rather than keep a name that points at the
pass. Its value is new (`npm run env:update`), so no decrypted value was
copied. Migration `20261020170000_push_delivery_secret.sql` renames the
Vault secret in place and reschedules the job to read the new name; until
`npm run secrets -- production` sets the new function secret, the function
also accepts `PROJECTION_WORKER_SECRET`, which `npm run secrets` then
unsets (`RETIRED_FUNCTION_SECRETS`), so push delivery never stops. Between
that run's function secret and its Vault write, a minute's push may be
refused and is delivered the next minute. A local stack's
`supabase/functions/.env` keeps its value under the new name
(`scripts/local-db.mjs`).

Amended (2026-10-26, Carl Sauder): the push delivery job no longer calls the
Edge Function every minute whatever is queued. Each minute it asks
`push_work_waiting()` (a notification a claim could take, or a push receipt
old enough to read) and posts only if so, so `diag.job_schedule` gives it no
schedule (it runs when there is work, like the webhook dispatch). Another
daily job drops `cron.job_run_details` rows over seven days old. The claim
is driven from the people who have a push token (index
`notifications_push_person`) instead of walking past every notification of
someone without one. The schedule is now
`20261026170400_push_delivery_when_waiting.sql`, which `npm run secrets`
runs again. Audit: `docs/performance-audit-2026-10-26.md` item 11.

## 149. A reviewer notes a moment of the recording, a help, a key word, a verse or a note, and every note goes with the review and its verdict

Date: 2026-10-20 · By: Caleb Koster · Status: accepted

Reason: Caleb asked (2026-10-20) whether reviewers can comment on a
segment of the recording, or on the resources a check makes available, and
said "if not, we really should". On main a reviewer could note a Bible
verse (Background, Passage), on the record at once, and a study step. The
player's Note recorded a voice clip at a time in the whole version, sent as
one of the review's recordings (`artifacts` with `atMs`), and the
translator heard all of them as one clip, with no time or part. Team notes,
key words and the check's helps were read only. A first build listed every
part with its own note button; Caleb found that too cluttered and chose
(2026-10-20):
- Comments stay at moments of the whole recording: the player's Note,
  said or typed. Underneath, each is tied to the part its moment falls in
  and how far into that part, so whoever fixes the passage records over
  that part. The parts are listed only when they have verses, as before.
- The check's helps and Background's key words get a note button (an
  amber bubble with a plus, 48 pt), team notes in Background get Reply,
  and a verse keeps its Note.
- Everything noted while reviewing is part of the one review: it waits in
  the review's draft (decision 127), listed together under the player in a
  dashed amber box "With your review", each with Remove, and the sheets say
  the note goes with the review. Decide and "What should change?" say how
  many notes go with it. Nothing is sent, and nobody sees a note, until the
  verdict is sent; then the notes go in the verdict's batch.
- A sent note is the passage note there already was (`v1.NoteAdded`),
  written at the check (`kindId`, decision 130), with the review it went
  with (`reviewId`). Taking the review back takes its notes back
  (`withdrawReviews` adds a `v1.NoteWithdrawn` for each); only their author
  may (decision 111). History lists them with their review, not as entries
  of their own.
- Where a note points is new optional fields on the anchors there already
  were, not a new kind or event: `{ kind: 'version', takeId, part, at }`
  (`part` is the part's audio hash, `at` how far into it, "0:04");
  `{ kind: 'passage', help }` for one of the check's helps (`item:<id>` or
  `material:<id>`, `checks.ts` `helpKey`); `replyTo` on any anchor for a
  reply, which keeps its note's anchor. The server checks only a note's
  kind, its required field and the fields it checked before, so it needs no
  migration, and an app from before this shows such a note on its version
  or the whole passage. Core reads the new fields only when they are
  strings (`notePart`, `noteHelp`, `replyOf`, `noteReview`) and finds notes
  with `partNotesFor`, `helpNotesFor`, `termNotesFor`, `repliesTo` and
  `reviewNotesFor`.
- A note on a part follows the part's audio: a later version that kept the
  part still has it, a part recorded again starts clean. Notes never force
  a review (decision 128).
- The translator: "Hear the feedback" lists "Notes from <check>", the
  review's notes, each saying what it is on ("Part 2 · 0:04", a verse, a
  help, a key word), with Reply. In the recorder a part a check noted has
  an amber count beside its length that opens its notes
  (`passage/PartNotes.tsx`). The recorder's Notes chip names them ("on Part
  2 · 0:04", "on “What to listen for”", "Reply to Rita").
- Help mode says what each new button does.
Cost: a reviewer's notes reach nobody until the verdict, so a review left
unsent keeps them on that phone only. The web app's cap on all its
JavaScript rose from 6.5 to 6.55 MB (`export-web.mjs`): with this it is
6.51 MB, of which the new lines in 15 languages are about 15 KB; the first
visit stays under its 5.7 MB. Notes on Earlier's versions and feedback are
not offered: Earlier is history, and the version being checked is the one
notes are for.
Reverse if: teams need a reviewer's notes before the verdict (a long
consultant session); then a note could be sent on its own, still carrying
its part and its check.

## 150. A pull request is merged into main only when the checks that its changed files need are green, and main takes no direct push

Date: 2026-10-22 · By: Caleb Koster · Status: accepted

Reason: main had no branch protection and no ruleset, so a pull request
could be merged into main while a guardrails check was red, and every merge
into main deploys (decisions 42, 43, 45). The rule now lives in the repository
as `.github/rulesets/main.json`: a GitHub ruleset on `refs/heads/main` that
requires one check, the guardrails `gate` job, reported by the GitHub Actions
app. Nobody can bypass the ruleset, so a repository admin cannot merge past a
red check either. GitHub applies a required check to pushes as well, and a
pushed commit has no checks yet, so main takes no direct push: every change
reaches main through a pull request, and so does every commit that the
pipeline makes. Caleb chose this over letting admins bypass the ruleset,
because a bypass would also let an admin merge a red pull request.

Caleb also asked (2026-10-22) that a pull request run only the checks that its
changed files need: a pull request that changes only `docs/decisions.md`
does not need the UI tests. A new `scope` job (`scripts/ci-scope.mjs`) reads
the files that the pull request changes since it met main, and says which of
`server`, `web-smoke` and `ui-web` they need; the jobs that are not needed
are skipped. `checks` always runs (about 2.5 minutes), because it holds the
decision log's test and every other unit test. The shared code
(`packages/core`, `packages/sync`), `supabase` (migrations and functions),
`library`, `scripts`, `.github`, `.githooks`, any `package.json` or lockfile,
`vitest.config.ts`, the root `tsconfig` files and any file that no rule names
run every job. The docs, the skills and Markdown files run `checks` alone;
`apps/mobile`, `apps/web`, `e2e` and `app.json` run the two browser jobs; the
SQL smokes in `server` run the `server` job. When `scope` cannot tell, it runs
every job, and a push to main, the nightly run and a manual run run every job.
The jobs still test the pull request merged with main. A required check that
never starts leaves a pull request waiting forever, and GitHub counts a
skipped job as passed, so main requires the `gate` job instead of the jobs
themselves: `gate` runs whatever happened to the others (`if: always()`) and
passes only when `scope` and `checks` passed and every job that `scope` named
passed. `scripts/githubRules.test.ts` fails when a job that runs on a pull
request is missing from `gate`'s needs, so a new job cannot fail without
holding a merge. Of the last 60 pull requests merged into main, 27 would have
skipped `server` and none would have skipped the browser jobs; no `server`
job failed on main in the last 60 runs on main.

This builds on an earlier change that never reached main (branch
`caleb/light-decisions-ci`, 2026-10-20): a push that only merged main and
renumbered its decision, after a run that passed, would run only typecheck,
lint and the decision log's test. That design skipped the full tests of a
code change on top of the newest main, the last such run before a merge
that deploys to production, and that concern still holds, so this change
leaves it out. Choosing jobs by the pull request's whole change does not
have that cost: a pull request that changes code runs the code's jobs on
every push, and a pull request that changes only the docs changes nothing
that the other jobs test.

The ruleset does not require a branch to be up to date with main before the
merge, because guardrails already runs on the pull request merged with main,
and requiring it would rerun up to 12 minutes of checks on every open pull
request after each merge. `npm run github:rules` (`scripts/github-rules.mjs`)
compares each file in `.github/rulesets` with the ruleset of the same name on
GitHub and says what it would change; `npm run github:rules -- --apply` makes
the change and needs a repository admin. Amends 53: small changes still go to
main on their own, but through a pull request.
Reverse if: a fix that cannot wait for the checks is held up often enough to
matter (then add a bypass for a named team with `bypass_mode: pull_request`
and record who may use it); main's run fails in a job that `scope` skipped on
the pull request (then move the file that caused it to a rule that runs that
job); or merges pass checks that were green against an older main and break
it (then turn on `strict_required_status_checks_policy` or a merge queue).

Amended (2026-10-23, Caleb Koster): pull requests merge through GitHub's
merge queue. Two pull requests that were each green against main could still
break it together, for example by taking the same decision number, and the
run on main found that only after the merge. In the queue, `gate` runs again
on main as it will be with the pull requests ahead (the `merge_group`
trigger in guardrails.yml), and a pull request merges only when that run is
green. `scope` measures the files that the queued pull requests change on
main, so a change to the decision log still skips the browser jobs. The
queue tests and merges one pull request at a time, with a merge commit as
before (`.github/rulesets/main.json`): the release-branch job (decision 155)
copies the one merge that a push to main brings, and keeps only one run
waiting, so merges pushed together or seconds apart would leave a copy out.
A pull request waits for the ones ahead of it, about ten minutes each. The strict
up-to-date rule was the other way: it needs no code, but every merge would
make every open pull request update and run its checks again.

Amended (2026-10-23, Carl Sauder): a queue entry runs no job when the pull
request's own green run of the last hour tested the same tree, and a push
to main runs no tests for the commit that the queue passed; `checks` is
three jobs, `checks`, `unit` and `coverage` (decisions 163, 164).

## 151. A pull request may not take away a server call that a supported store build makes

Date: 2026-10-22 · By: Caleb Koster · Status: accepted

Reason: people keep a store build for a long time, and the server and the
app's Worker change on every merge into main (decisions 42, 43), days before
a new build passes store review. Android build 24, built by hand on
2026-10-20 from code of 2026-10-01, called `issue_invite`, which the server
had not had since 2026-10-06. `npm run server-calls` (`scripts/server-calls.mjs`)
now runs in the guardrails `checks` job and in `npm run guardrails`. It reads
the server calls that phones may make: the database functions
(`.rpc('name')`), tables and views (`.from('name')`), Edge Functions
(`functions.invoke('name')`) and the Worker's routes (`/api/<name>`) named in
`apps/mobile/src` and `packages/sync/src`, in each supported store build's
own commit and on every line added on main since the oldest of them. Every
merge into main that changes the app reaches phones as an OTA update or a new
build, so a call named on main since then is a call that some phone may
make. It then checks that each call is still on the server after the pull
request: the migrations, read in order, still create the function, table or
view and do not drop or rename it; the Edge Function's folder is still in
`supabase/functions`; and `apps/web/worker` still names the route. A failure
names the build and the call, for example "Build 25 (Android) still uses the
database function preview_invite". It reads files and git history only, and
takes about 3 seconds for 21 builds. To change a call, add a new one next to
it (a new function name, such as `issue_sign_in_code_v2`) and leave the old
one in place for as long as a supported build uses it. An old call may be
removed once every build that uses it is below the minimum app version,
which the pipeline raises every three weeks to the newest build that has
been public on both stores for at least three weeks (the release pipeline's
"Please update the app" change); a phone below the minimum stops syncing,
so it no longer makes the call.

The store builds and their commits come from EAS, which records the commit of
every build, when the repository secret `EXPO_TOKEN` is set (a token for a
robot user with the Viewer role). Until then they come from
`apps/mobile/store-builds.json`, which lists every finished production build
as EAS had it on 2026-10-22. That file also says which builds are supported:
Android from build 13 and iPhone from build 33, without Android build 24 and
iPhone build 41. The older builds and those two hand builds already fail
against today's server, and newer builds replaced all of them: Android 8
and iPhone 29 and older call functions or tables that the server no longer
has (`issue_invite`, `redeem_invite`, `accept_join_request`,
`org_member_emails`, `set_project_visibility`, `project_visibility` and
`public_projects`), and the sync test of Android 9 to 12 and iPhone 30 to 32
(built 2026-10-06 and 07) finds that today's server refuses their
`v1.MemberAdded` and their recording uploads to Supabase Storage, which
moved to the Worker afterwards. The minimum app version will take the
place of these two numbers.

The check does not see a changed argument, column or response shape; the sync
test from each store build's commit (change 4) runs against the new database
for that. Two more things follow from the gap between the server and phones
on an older build. The server must keep accepting what those phones send, so
validation for an event that a supported build sends never becomes stricter;
a new event version is added instead. And a phone on an older build skips an
event type that its reducer does not know, so it keeps working but cannot
show that work until it gets the reducer change, by a new build or an OTA
update.
Reverse if: the check stops a change often enough that keeping old calls
costs more than asking people to update (then raise the minimum app version
sooner), or a call that phones make is missed because it is built at run
time (then name it in a list that the check reads).

## 152. A pull request that changes the database runs the sync test from every supported store build's commit against it

Date: 2026-10-22 · By: Caleb Koster · Status: accepted

Reason: a migration can keep every server call's name and still break how an
older build syncs, by refusing an event that the build sends or a file that
it uploads, and people keep store builds for a long time. So the guardrails
`server` job, after this checkout's own integration test, runs
`npm run test:old-sync` (`scripts/old-sync-tests.mjs`) when the pull request
changes `supabase/migrations`. For each commit of a supported store build
(the builds and their commits from `storeBuilds()` in
`scripts/server-calls.mjs`, from EAS with `EXPO_TOKEN`, otherwise
`apps/mobile/store-builds.json`), it takes that commit's packages, its
`server` and its Worker code out of git into `.old-sync/<commit>`, and runs
that commit's sync integration test (`packages/sync`, or `packages/client`
before 2026-10-14) with this checkout's dependencies against the database
that the job built from the pull request's migrations. A test that the old
file skips counts as a failure, so a test that did not reach the database
never passes quietly. A failure names the builds, for example "Build 25
(Android) (commit 683289d9): its sync test 1 of 7 tests failed against this
database". The 12 commits took under two minutes locally, in the job that
already holds the stack, so a pull request is no slower than its slowest job
was. It runs only on pull requests, not on main's own run.
The first run, against main on 2026-10-22, found that today's server already
refuses the `v1.MemberAdded` events and the recording uploads to Supabase
Storage of Android builds 9 to 12 and iPhone builds 30 to 32, so the
supported builds start at Android 13 and iPhone 33.
The old test also drives the server code of its own commit (the projection
worker, the Worker's blob routes), which main replaced since; a failure
there is still a finding about that build's test, and is fixed by raising
the supported builds or by keeping the old behaviour.
Reverse if: the old tests fail often for reasons that phones never meet
(then run only the parts of each test that phones run), or the run grows
past the `server` job's other steps (then run the commits in parallel jobs).

## 153. The first launch after install waits up to 5 seconds for the latest OTA update

Date: 2026-10-22 · By: Caleb Koster · Status: accepted

Reason: `app.json` sets expo-updates' `fallbackToCacheTimeout` to 0, so a new
install opens on the code built into the store build, which can be weeks
older than main, and gets the latest OTA update only on its second launch.
Someone who installs the app at a workshop then meets bugs that were fixed
long ago. Raising `fallbackToCacheTimeout` would make every launch wait, and
people often open the app with no connection for months. So only the first
launch after install waits (`apps/mobile/src/shell/useFirstLaunchUpdate.ts`,
the rules in `firstLaunchModel.ts`): on a phone running the code built into
the app, with no `first-launch-update:looked` mark in its storage, the app
sets the mark, then looks for the latest OTA update and downloads it, for at
most `FIRST_LAUNCH_WAIT_MS` (5 seconds). The person sees a spinner and no
words while it waits. When the update arrives in time, the app restarts into
it once; when the phone is offline the check fails at once and the app opens
on its built-in code; when the connection is slow, the app opens at the
5-second limit and the download goes on, and the update banner offers the
restart when it is ready. The mark is set before the app looks, so a launch
killed mid-wait never waits again, and an account's deletion leaves it.
Browsers and development builds never wait. The wait is in the app's code,
so it reaches a new install only in a build whose built-in code has it: the
next new build.
Reverse if: first launches on slow connections time out often enough that
the wait only delays people (then shorten it), or expo-updates gains a
setting that waits on the first launch only (then use that instead).

## 154. The app tells people when a newer version is in the store, and below the minimum version it stops syncing until they update

Date: 2026-10-22 · By: Caleb Koster · Status: accepted

Reason: Expo does not tell people that a new build is in the stores, and in
LangQuest v2 a database flag went up before the store had approved the
build, so people were sent to an update that did not exist yet. Now the
server records a version only once it is live (`public.app_releases`,
migration `20261022200000_app_releases.sql`): the Worker's ten-minute cron,
once an hour, reads the live App Store version from Apple's public lookup
and the live Google Play version from Play's public app page, which list a
version only once people can download it, and writes each with
`record_app_release` (`apps/web/worker/storeReleases.ts`). The app reads
`app_versions()` (`src/server/appVersions.ts`) when someone is signed in, at
most once an hour, and keeps the last answer on the phone
(`src/appVersion/useAppVersion.ts`, rules in `appVersionModel.ts`):
- On an older version than the newest live one, a bar says "New version
  available" with Update, which opens the store page, and a close button
  that hides the bar until a newer version comes out.
- Below the lowest version that may still sync (`server_config`
  `min_version_ios` and `min_version_android`, '0' today, raised only on
  purpose), the phone sends its waiting work first, then stops: every
  stream's transport still sends (`append`, and recordings through their own
  transport), and refuses everything that downloads other people's changes
  as the server does for a client too old (LQ001,
  `src/appVersion/syncGate.ts`). The sync client sends before it downloads,
  so someone back after months offline gets their work to the team even if
  they never update. Caleb chose this (2026-10-22) over stopping all sync
  at once. A send that fails, for example because a server call that the old
  build uses is gone, throws instead of refusing the events, so the work
  stays on the phone marked to send (PLAN.md invariant 1) and goes after the
  update. The whole screen says "Please update the app" with the same
  button; Keep working closes it for that launch, and Account's "Update the
  app to sync." stays.
Versions are compared as numbers, part by part: every store build has a
higher version than the one before (the release pipeline's production
review change gives each the time of its merge), and 1.0.0 is older than all
of them. The app reads its own version with `expo-application`, which every
build already had through `expo-notifications`, so this code ships as an OTA
update. A browser always runs the newest version and is never told.

Android works the same way. Google Play's public app page shows the version
that people can download now, and only once Google has approved it; the
check reads it as update-check libraries such as react-native-version-check
do. Google's Play Developer API cannot say this: it reports a production
release as completed from the moment it is sent, before review
(issuetracker.google.com/208842993). Google's In-App Updates library would
tell the phone itself, but it sends Google device details and the app
version whether diagnostics is on or off, which may change Data safety
answers (`docs/play-store-declarations.md`), so it is not used. If Google
changes the page and the version cannot be found, nothing is recorded and
the cron's job run says so; the app never says an update is there when it
is not. This is beyond the partner demo, which has no update prompt.
Reverse if: people dismiss the bar and stay on old versions long enough to
matter (then show it again after some days), or the In-App Updates question
is settled, or Google's page stops showing the version (then Android asks
the phone, with In-App Updates).

Amended (2026-10-28, Caleb Koster): after Keep working, the app no longer
looks as if the server were at fault. The sync standing has its own
`tooOld` (`sync/syncStanding.ts`, after a refused account and before
refused events): the header's cloud turns amber with a down arrow ("Update
to receive"), and the Sync screen offers Update, which opens the store
page, where Sync now was. Its words say the person's own work still goes
out only below the minimum version; a server that refuses the app's
protocol (LQ001) takes nothing, and it says to update. From the UI audit
Caleb asked to have fixed (findings 24 and 119).

## 155. While a new build is in store review, the public build keeps getting every merge as an OTA update from a release branch

Date: 2026-10-22 · By: Caleb Koster · Status: accepted

Reason: once a merge into main changes a platform's native fingerprint, a
new store build of that platform goes to review, and OTA updates from main
reach only that new build. Until Google or Apple approves it, which can take
days, the public build would get no fixes. Caleb chose (2026-10-22) that the
pipeline, not a person, decides when this happens and copies the merges,
and Carl asked how the branches are made and filled. So
(`scripts/release-branches.mjs`, `.github/workflows/release-branches.yml`):
- After each merge into main, a GitHub Action compares each platform's
  fingerprint before and after the merge, the same fingerprint that the EAS
  workflow uses to choose between an OTA update and a new build. When it
  changed and no release branch exists, the Action starts
  `release/<platform>` from the commit before the merge, which is the code
  of the last OTA update that the public build got, and tags the merge
  `rebuild/<platform>/<commit>`.
- Every later merge into main that does not change that fingerprint is
  copied onto the release branch. The pipeline cannot tell a fix from a
  feature, so it copies every one. Each copy is a pull request that merges
  itself (GitHub auto-merge) once its checks pass; no person merges it. A
  copy with a conflict is labelled `copy-conflict`, and Anthropic's Claude
  GitHub Action (`.github/workflows/release-copy-conflict.yml`) copies it,
  keeping the release branch's code where main's change needs code that the
  public build does not have.
- Every merge into a release branch publishes an OTA update on the
  production channel for that platform
  (`apps/mobile/.eas/workflows/deploy-release-branch.yml`). Its runtime comes
  from the branch's own code, so it reaches the public build and never the
  build in review.
- Every hour the Action deletes a release branch whose new build is public:
  the store's live version, from Apple's public lookup for iPhone and from
  Google Play's public app page for Android (the signals that the app's own
  store check uses), is that build's version or a newer one (each store
  build's version is the time of its merge). A store that cannot be read
  keeps the branch, which only sends the public build fixes that it would
  get anyway. When a later new
  build is already in review, the newly public build gets its own branch,
  started from the commit before that later build, with the merges since
  copied onto it.
- `.github/rulesets/release.json` requires the guardrails `gate` on
  `release/*`, so a copy merges only when green.
A change that needs a new build is never copied, because the public build
cannot run it. It all stays off until the repository variable
`RELEASE_BRANCHES` is `on`, which needs a GitHub App installed on this
repository with Contents and Pull requests write (secrets `RELEASE_APP_ID`
and `RELEASE_APP_PRIVATE_KEY`; a pull request that the built-in token opens
starts no checks), "Allow auto-merge" turned on, and the secret
`ANTHROPIC_API_KEY` for the conflict step.
Reverse if: copies go wrong on the public build often enough that a person
should approve each one (then turn off auto-merge), or a store page stops
showing its live version (then read it from the store's API where one can
say so).

Amended (2026-10-22, Caleb Koster): the conflict step runs without an
Anthropic key too. This repository has none yet, and a key in another
repository cannot be shared. Without `ANTHROPIC_API_KEY`, the step tries the
copy again, comments once on the copy pull request naming the files in
conflict and the steps to finish it, and leaves it open for a person or a
Claude session; nothing fails. With the key, Claude finishes it as before.

Amended (2026-10-23, Caleb Koster): the hourly cleanup now finds the newest
new build that is live. When it is the newest of all, the branch goes and no
other starts; only when an older one went live while a newer one is still in
review does a new branch start, from just before the newer one. Before, it
would have started a branch for a build that was never public. The
repository variable `RELEASE_BRANCH_PLATFORMS` ("android" for now) names
the platforms that keep a branch: no public iPhone build takes OTA updates
from main yet (build 36, 1.0, runs code of 2026-10-16), so an iPhone branch
would only feed TestFlight.


## 156. Store builds come only from the EAS workflow on merges into main

Date: 2026-10-22 · By: Caleb Koster · Status: accepted

Reason: Android build 24 and iPhone build 41 were built by hand on
2026-10-20 from code of 2026-10-01, and build 24 reached Play internal
testing in place of build 23. Testers saw a blank screen, most likely
because its code called a database function that the server had not had
since 2026-10-06. A
store build has to be made from main, where the checks ran, by the pipeline
that the rest of the release plan builds on. So the ways to make or upload a
store build by hand are gone: `npm run android:play` (an `eas build` on the
`production` profile with `--auto-submit`), `npm run ship -- --prod` (which
published OTA updates and iOS builds on production), and
`apps/mobile/scripts/testflight.sh` (an iOS build on a Mac, uploaded to
TestFlight with altool). `npm run ship` now works on `preview` only, and
says so when it is given `--prod`. A person can still type `eas build
--profile production`, so an EAS build hook stops that build:
`apps/mobile/scripts/store-build-guard.mjs`, the app's
`eas-build-pre-install` script, refuses a `production` build unless
`LQ_STORE_BUILD_REF` is `refs/heads/main`, and only the build jobs of
`.eas/workflows/deploy-to-testers.yml`, which runs on merges into main, set
it. `scripts/storeBuildGuard.test.ts` holds the guard, the hook, and the
two build jobs that pass the ref. `apps/mobile/scripts/ship-eas-ipa.sh`
stays: it uploads a build that EAS already made, and EAS now makes store
builds from main only.
Reverse if: a store build has to be made from somewhere else, such as a
release branch for a build that cannot wait (then let the workflow pass that
branch's ref and add it to the guard), or EAS gives a setting that limits a
build profile to a workflow, which would do the guard's job without a hook.

## 157. New builds go to production review on their own, and each is public as soon as Google or Apple approves it

Date: 2026-10-22 · By: Caleb Koster · Status: accepted

Reason: a person promoted each Android build from internal testing to
production, and submitted and released each iPhone build by hand, so a new
build reached people only when someone remembered, and builds were sent
from the wrong place (decision 45 sent Android builds to internal testing
only). Now every new build that a merge into main makes
(`.eas/workflows/deploy-to-testers.yml`) goes to production review, and is
public on the day that the store approves it, with no staged rollout:
- Android: `eas.json` submits to the `production` track with
  `releaseStatus: completed`. A newer build replaces the release that waits
  for review, which is how Play treats a new release on a track. Managed
  publishing stays off in Play Console, so an approved build goes public at
  once. Play takes a version code only once, so a build no longer goes to
  internal testing too; internal testers get it with everyone else.
- iPhone: the build goes to TestFlight as before, and then
  `scripts/app-store-review.mjs` sends it to App Review with release on
  approval. Apple reviews one version at a time, and a version taken out of
  review loses its place in line, so the script never cancels a review or
  changes the build of a version in review: while a review is waiting or
  under way, or a version is approved and not yet out (pending developer or
  Apple release, or processing for the App Store), the build waits in
  TestFlight and is tried again on the next run. A version not yet released
  that can still change (a rejected 1.0) takes the newest build and its
  version number, since Apple keeps one unreleased version at a time.
  `.eas/workflows/app-store-review.yml` runs the same script every hour and
  sends only the newest waiting build once the review ends; a rejected
  version is sent again with the newest build. It fills in "What's New"
  where it is empty ("Bug fixes and improvements.").
- Apple takes one App Store version per version number, so every build
  that goes to review needs a higher one. `apps/mobile/app.config.js` sets
  the version of each store build from the time of the merge commit, which
  the workflow passes as `LQ_STORE_VERSION_TIME`: 2026-10-22T18:30:00Z is
  2026.1022.1830. Other builds keep `app.json`'s 1.0.0. The native
  fingerprint leaves the version out (`apps/mobile/fingerprint.config.js`),
  so a new version number alone never asks for a rebuild. EAS clones only
  the latest commit for a build, so a count of commits was not possible.
The App Store step needs an App Store Connect API key with the App Manager
role, kept as the EAS production secrets `ASC_KEY_ID`, `ASC_ISSUER_ID` and
`ASC_PRIVATE_KEY`; EAS's own submit key only uploads to TestFlight. Until
that key is there, the step says "no App Store Connect key yet" and
succeeds, so iPhone builds stop at TestFlight for a person to send to
review, as before, and the pipeline stays green; Android goes to production
review either way. The
Android step needs the Play service account that EAS submits with to hold
"Release to production, exclude devices, and use Play App Signing".
Amends 45: Android builds go to production review, not internal testing.
Reverse if: a build that passed review hurts people often enough that a
staged rollout or a wait in internal testing is worth the delay (then send
to internal testing first and promote after a set time), or Apple starts
taking a newer build into a version under review without losing its place.

## 158. Global Viewers read every organization, read-only, and only on a session verified with an authenticator

Date: 2026-10-22 · By: Carl Sauder · Status: accepted

Reason: LangQuest's support people need to see any organization to help
it, and until now saw one only by being invited into it (Carl Sauder,
2026-10-14). A Global Viewer may open every organization and read what a
Viewer there would: every stream but people's own, member names, files.
Who is one is the server's own state, not an event: a row in
`public.global_viewers` (migration `20261022210000_global_viewers.sql`),
like a suspension, since a role in every organization's stream would be
pulled by every member's phone and an organization stream holds only that
organization (decision 63). The one read gate, `can_read_stream`, takes it
(`_can_read_stream_at`), so pulls, snapshots and their pieces follow; the
Worker passes the token's `aal` to `blob_access` for files (an unsaid level
refuses a Global Viewer, so a path that forgets it keeps them out), and
`global_viewer_organizations` and `global_viewer_directory` list
organizations and names. Read-only, not a Global Admin: `may_emit` never
asks about Global Viewers, so every write is still explained by the
organization's own log (invariant 9) and decision 98 stays as it is.
Support changing an organization is not part of this (see the amendment).
Named Global Viewer, not admin, because in
this app admin means someone who can change things (Carl, 2026-10-15).
Access works only on an aal2 session (Carl, 2026-10-14): TOTP is switched
on for the project (`[auth.mfa.totp]`), only Global Viewers are shown how
to set it up, and a password alone, a sign-in code or a hand-over gives an
aal1 session that sees nothing; `may_help_sign_in` refuses a Global Viewer
target anyway. A Global Viewer may belong to organizations, where their
own role applies, so support and Frontier staff use their own accounts
(Carl, 2026-10-21); it costs Global Viewer access riding on an everyday
account, signed in on more devices. Accounts are granted on a call
(`npm run global-viewer`, docs/global-viewers.md): emails are on any
domain (Carl, 2026-10-20) and sign-up proves nothing about owning one, so
what counts is that the person, known to the operator, signs in on the
call and sets up an authenticator while the operator watches `list`.
`grant` takes any account with no authenticator, however old (Carl,
2026-10-21: the call, not the account's age, shows whose it is). `revoke`
keeps the row and ends every sign-in, and the account is then an ordinary
one; granting it again clears its old authenticators and sign-ins first,
so nothing from before is trusted. `reset-mfa`, for a lost authenticator,
is run after a call with the person, never on an email. No log of what a Global Viewer opens (Carl, 2026-10-14): the
protection is few accounts, the authenticator and revoking at once.
`supabase config push` brings the auth setting to hosted projects and is
run by hand (Carl, 2026-10-20; docs/environments.md). The Worker may still
answer a file check from its one-minute cache after a revoke (decision
121). No new event type.
Reverse if: a partner or a privacy review needs every look logged (then
log `global_viewer_*` reads and opens of an organization); more than a
handful of people need it (then a staff screen with its own checks, not a
script); or an authenticator proves too weak for the reach (then passkeys,
or a fresh code before each organization).

Amended (2026-10-21, Carl Sauder): a Global Viewer reads an organization as
its admins see it, not only as a Viewer: support questions are mostly about
setup (roles, members, templates, review flows), which a Viewer never sees.
The session shows an Organization Admin's privileges and is read-only: the
organization's and the language's handles refuse every append
(`src/shell/readOnly.ts`), the hooks that write by themselves skip it, and
a server refusing a write says so (Carl chose this over hiding each edit
control screen by screen: one guard covers every screen, including later
ones, at the cost of controls that look live and say nothing can change).
The library's read check, `_library_member`, lets a Global Viewer whose
access is on pass (migration `20261022220000_global_viewers_manage.sql`);
its one write, `library_adopt`, still needs a privilege they never hold.
Letting support change things in an organization, as a membership that ends
by itself, was planned and is not built (Carl, 2026-10-21): it needed a new
versioned event and a clock in every privilege check. Support talks an admin
through a change, and the admin can invite the support person's ordinary
account if hands-on help is ever needed. Reverse if: support often needs to change
things themselves (then a membership with an end, from a join request and a
server timer that removes it, rather than a new event).

Amended (2026-10-23, Carl Sauder): a read-only session no longer gets the
privileges for doing the work (Translate, Review, Fill reference, Send to
reviewers), only an admin's management ones, so a passage offers a Global
Viewer no Edit, Record, review or note. Carl's reason: the one write guard
kept nothing that was recorded, but letting someone record a take that is
then thrown away is bad. The recorder also refuses to open the microphone
in a read-only session (`isReadOnlySession` in `src/shell/readOnly.ts`,
read by `useRecorder`), for any record control left elsewhere. That guard
loads with the recorder, so a first visit's web budget rose to 5.75 MB
(`apps/mobile/scripts/export-web.mjs`).

Amended (2026-10-23, Carl Sauder): a passage's record offers a read-only
session nothing at all (`recordCan` in `src/passage/recordModel.ts`), though
an admin's management privileges still hold Assign work and Override
checkpoints. So a Global Viewer gets no check's sheet (ask someone, already
happened, not now, move past), no Undo or Withdraw in the history, no "Something
else?" way forward beyond what helps and keeping it offline, and no report flag
(`ReportFlag`). Carl's reason: the review screens should not give the
impression that a Global Viewer can take review actions. Manage keeps its
controls under the one write guard, as decided on 2026-10-21.

## 159. A toast lasts as long as Android's "Time to take action" asks and runs no bar down under reduce motion; the phone tests set 10 seconds

Date: 2026-10-22 · By: Carl Sauder · Status: accepted

Reason: a toast showed a fixed 3.5 s (7 s with a screen reader) with a bar
that ran down across it, and the phone flows that check one (NAV-061's "Press
Back again to leave", PASS-068's offline acts) failed on the Android
emulator. Maestro reads the screen once it is idle, and the bar, animated on
the JavaScript side, changed the screen every frame, so a Back or a tap that
waits for the screen to settle waited out the whole toast and then found it
gone (frame captures and logs, 2026-10-21; the app behaved). Two changes, both
settings people already have:
- Reduce motion: the toast draws no bar when it is on (`ToastView` in
  `ui/kit.tsx`, A11Y-8), with the hook the recorder used, now
  `ui/useReduceMotion.ts`. The runner's zero animation scales read as reduce
  motion on Android, and it turns Reduce Motion on in the iOS simulator for
  the run (XCUITest also waits for the app to be idle), so a screen with a
  toast is still.
- "Time to take action" (Android Accessibility, WCAG 2.2.1): `ui/toastTime.ts`
  asks `AccessibilityInfo.getRecommendedTimeoutMillis(3500)` once when the
  toast host mounts, and ToastHost (App.tsx) shows each toast that long,
  still doubled for a screen reader. The second Back that leaves the app
  counts for the same time (`backModel.ts` `leavesNow`). iOS has no such
  setting and keeps 3.5 s. `npm run test:ui:phone` sets both of Android's UI
  timeouts to 10 s while it runs and puts them back afterwards, as it does
  with the animation scales, so a slow emulator still reads a toast in time.
Cost: a test run's toasts stay 10 s, so a flow can find one over what it taps
next; it closes the toast ("Close") or waits for it. A person who chose a long
"Time to take action" sees toasts that long too, and one with reduce motion
on sees no countdown, which is what those settings ask for.
Reverse if: toasts that stay longer get in people's way more than they help
(reports of toasts covering work), or people with reduce motion on miss the
countdown; then the runner's settings can go and the app's stay.

Amended (2026-10-28, Caleb Koster): a toast that says something went wrong
(a save refused, a fault with its code) is a problem toast
(`ctx.toast(message, 'problem')`, `ui/toastModel.ts`): an amber warning
instead of the green check, no bar, and it stays until closed, so its words
and the code a person reads out to support are never gone first; a screen
reader hears it as an alert. While a sheet is open, the sheet on top draws
the toast (`ui/toastLayer.ts`), as one drawn by the screen was hidden under
it. `test/toastModel.test.ts` fails on a failure toast that is not a
problem toast. From the UI audit Caleb asked to have fixed (finding 20).

## 160. Staff see LangQuest's operations on one signed-in page, a Worker of its own that reads diagnostics as diag_reader

Date: 2026-10-22 · By: Caleb Koster · Status: accepted

Reason: Caleb asked (2026-10-19) for one web page, behind credentials,
that shows everything going on with LangQuest's operations: client issues
and every service involved, Cloudflare, Supabase, Vercel and the rest.
Field diagnostics (39) and the server's job runs (112) already held most of
it, but only `npm run diag` on a laptop could read them, and no one looked
at the services' own dashboards together: every Workers Build failed from
2026-10-16 to 10-19, and no page showed it. Chosen:
- **A Worker of its own**, `langquest-next-admin` on `admin.langquest.org`
  (`apps/admin`, `docs/admin.md`), not routes on the app's Worker: the
  read tokens and keys it holds for Cloudflare, Supabase, Vercel, GitHub,
  Expo, Google Play and App Store Connect never sit on the Worker that
  answers the public, and the app Worker's
  static assets answer `/` on every host before the Worker runs. It has no
  preview copy.
- **It reads `diag` as `diag_reader`** (its existing login,
  `DIAG_DATABASE_URL`) over a Postgres connection, one read-only
  transaction per statement, with the `postgres` driver (no dependencies;
  the Worker is its only user). Not the service-role key: diag_reader can
  read `diag` and call its report functions and nothing else, so the page
  cannot write or see content, and no migration was needed.
- **Who may open it**: a LangQuest sign-in, checked with Supabase Auth on
  every call, whose profile id is in `ADMIN_PROFILE_IDS`. The list is kept
  encrypted in `.env.production` with the provider tokens (the repository
  is public); each token is optional and named `ADMIN_*` so none stands in
  for a CLI's own login. A section without its token says what to add.
- **The content rule of 39 holds**: ids, counts, timings and codes; no
  names, emails or usernames from any service, and logs only counted.
  Store reviews are shown without the reviewer's name, being public.
Reverse if: staff need to act from the page (mark feedback, retry a job),
which needs a writer's key and its own decision; or the list of staff
grows past a few people, when it belongs in the database or behind
Cloudflare Access instead of a secret.

Amended (2026-10-22, Carl Sauder): the page is served at
`next.langquest.org/ops-dashboard`, its API at `/ops/api/*`, not on
`admin.langquest.org`. Carl wanted it beside the app, on its host, under a
name nobody takes for a public status page (`/status` was weighed and
dropped for that reason). It stays a Worker of its own, for the reason
above, but without an address of its own: the app's Worker hands it those
paths through a service binding (`OPS`, `apps/web/worker/ops.ts`) and lists
them in `run_worker_first`, so the app's page never answers them, and the
admin Worker cannot be reached any other way. A Workers route on the app's
host would have done it without touching the app's Worker, but it relies on
routes running before a custom domain, which nothing in the repository
states. Still no preview copy: preview has no database of its own for it to
read, and the app's preview Worker answers 503 there. Plan:
`docs/ops-dashboard-plan.md`.

Amended (2026-10-22, Carl Sauder): who may open it is Global Viewers (158)
on a session verified with their authenticator, not `ADMIN_PROFILE_IDS`.
Carl chose it (2026-10-21) because Global Viewers already are LangQuest's
staff accounts: granted on a call by `npm run global-viewer`, with a second
factor and a revoke that signs them out everywhere, where the list was a
secret that needed a commit and a secrets push for each person and let in a
password alone. Each API call asks the database, as the person,
`get_user_state()` and lets in only `globalViewer: 'on'`, remembered for 30
seconds per isolate. The page asks for the authenticator code itself, and
reads (never renews) the web app's session on the same host when it is
already `aal2`. This supersedes the reverse-if about the list growing.

Amended (2026-10-23, Carl Sauder): the Worker reaches the database through
Cloudflare Hyperdrive (the `DIAG` binding, config `langquest-next-diag`,
caching off), not with `DIAG_DATABASE_URL` as its own secret. In
production every database section stayed on "Loading…": the Workers
runtime could not finish TLS with Supabase's pooler or its direct host,
with `postgres` or `pg`, while the same login answered from a laptop in
under two seconds. Hyperdrive holds the TLS connection outside the
Worker, which talks to it in plain text inside Cloudflare; it is included
in the Workers Paid plan. Caching is off because the page shows live
counts. The login now lives in the Hyperdrive config, which cannot be read
back: `npm run secrets -- production` makes or updates it from
`DIAG_DATABASE_URL` and writes its id into `apps/admin/wrangler.jsonc`
(not a secret). Each request also gives up after 25 seconds on the
server and 60 in the page, so a database that does not answer shows an
error instead of Loading. Locally the binding's `localConnectionString`
is the local database, so the page uses the same path everywhere.

Amended (2026-10-26, Carl Sauder): the web app's Global Viewer screen links
to the page ("Operations dashboard", above the organization search), opening
it in a new tab on the same host, where it reads the web app's verified
session. Carl asked for it (2026-10-26) now that the page is in place; the
staff who may open it are the Global Viewers. Phones do not show the link, since their browser would not share the app's
session.

## 161. The ops dashboard counts what the server already sees, adds four counts of its own, and reads job state through one read-only entrypoint

Date: 2026-10-22 · By: Carl Sauder · Status: accepted

Reason: Carl asked (2026-10-21) for the indicators listed in
`docs/ops-dashboard-plan.md` section 5 on the ops dashboard (160): work the
server refused, upload delay, clock skew, a fold canary, backups,
crash-free rate per update, time to a usable Map, version drift, expiry
dates, Global Viewers and limits, moderation and deletions, capacity and
cost, latency per route, webhooks and the agent API. Decided:
- **Read, never collect anew from phones.** Everything comes from what the
  server already receives, read as `diag_reader` through report functions
  that return counts, ids, timings, codes and organization and language
  names (migration `20261023100000_ops_dashboard.sql`); `DIAG_SCHEMA` and
  the Play answers are unchanged. An email lookup answers with the profile
  id only (`diag.lookup_email`), so the page never lists people.
- **Four counts the server did not keep**, each written where the thing
  happens: the projection pass samples what arrived since its last run for
  upload delay and clock skew (`server/arrivals.ts`), because
  `public.events` has no index on `received_at` and adding one would lock
  the log while it builds; the request tally adds time buckets and a `429`
  count per route, with `device`, `links` and `ops` as routes of their own;
  `_delete_account` writes an `account_delete` run with no id, since nothing
  is left to count afterwards; and two nightly jobs in the job container
  (141), the fold canary, which folds three languages afresh and compares
  them with their stored snapshot and passage lines, and the R2 check,
  which runs the reconciler without hashing. The container may now run
  four instances, since four jobs can overlap.
- **Job state through one call.** The app's Worker exports a `JobStatus`
  entrypoint with one method, `jobs()`, reading each `JobRunner`'s state
  without touching its container or alarm; the admin Worker binds to that
  entrypoint only (`APP_JOBS`), not to the object class, so it still cannot
  start or stop anything. It never calls an organization's Durable Object
  (132): those numbers come from Postgres.
Reverse if: the arrivals sample misses too much (a language that is never
sampled because it fails every pass), when the log gets a `received_at`
index built concurrently; or the canary's cost in the container grows past
its 60 minutes, when it takes fewer or smaller languages.

Amended (2026-10-26, Carl Sauder): the dashboard no longer restates rules it
counts. `diag.ops_pipeline` takes the snapshot schedule from its caller,
which passes sync's `SNAPSHOT_SCHEDULE`, so "overdue" is what the snapshot
worker does, and `ops_limits` reads the diagnostics day cap from
`diag._ingest_day_cap()`, whose agreement with `diag_ingest` the ops smoke
checks. The Worker's actions ask `_gv_on` at the session's real level
rather than checking aal2 itself, so that rule is SQL's alone, and they
verify a token through the same helper as every other Worker route
(`apps/web/worker/identity.ts`).

## 162. Staff may mark feedback and run a server job from the ops dashboard, through the app Worker, which checks them again and records every attempt

Date: 2026-10-22 · By: Carl Sauder · Status: accepted

Reason: 160 kept the ops dashboard read-only and said acting from it needs
its own decision. Carl chose (2026-10-21) read-only first, then a few
actions safe to take from a browser: marking feedback seen, done or open
again (the step `docs/diagnostics.md` left to "the admin page"), and running
a server job now (the projection pass, the v2 import, the fold canary, the
R2 check). Decided:
- **The admin Worker still holds no writer's key.** It passes the action and
  the person's own token over a service binding to the app Worker's
  `OpsActions` entrypoint (`apps/web/worker/opsActions.ts`), whose one method
  checks the token itself (verified claims, a live session (118), `aal2`,
  `_gv_on`) and only then acts with the service role. A bug in the admin
  Worker cannot act without a Global Viewer's live, verified session.
- **A closed list.** `parseAction` takes the two kinds with their arguments
  checked (a feedback id and status; a job key from `JOBS`); anything else
  is refused before anyone is asked. Running a job goes through its
  `JobRunner`, which leaves a run already going alone.
- **Every attempt is recorded.** `ops.actions` (migration
  `20261023110000_ops_actions.sql`) holds who (profile id), what, the
  target, the result and a code, refused attempts too; written only by the
  service role through `ops_record_action`, read by `diag_reader` through
  `diag.ops_actions`, kept a year.
- **Not from the page:** suspending or deleting accounts, moderation,
  Global Viewer grants and anything that changes an organization's work.
  Those stay in the command-line scripts, run on a call.
Reverse if: staff need another action often enough that the command line
is in the way; each one is added to the list here, never as a generic
"run this" call.

Amended (2026-10-22, Carl Sauder): the Vercel section is removed. LangQuest
Next runs nothing on Vercel (its web app, API, files and jobs are on
Cloudflare, and the privacy pages left Vercel under 46); the section
watched other FrontierRND projects (the website, the v2 web app, the dev
docs, the partner demo) that support and devops do not look after here.
Vercel has no read-only token, so `ADMIN_VERCEL_TOKEN` would have been a
token that can change the whole team's projects, on a Worker that
otherwise holds only read tokens. If the website needs watching, an
uptime check on its address does it without a token.

Amended (2026-10-26, Caleb Koster): a third kind of action, granting or
declining an organization's blue check request that waits for staff
(decision 173): `verification` in `parseAction`, with the request's id and
`grant` or `decline`, recorded as `verification_grant` or
`verification_decline`. Granting is a staff call about an organization's
identity, not a change to its work; revoking stays in the script
(`npm run org-verification -- revoke`).

Amended (2026-10-29, Caleb Koster): two more kinds, for the feedback on the
tutorial videos (decision 186): `tutorial-note`, a note about a video or one
not made yet, recorded as `tutorial_note`; and `tutorial-suggestion`, a
suggestion Claude made accepted, edited (its text, before a yes or no) or
rejected (with why), recorded as `suggestion_accepted`, `suggestion_edited`
or `suggestion_rejected`. They change only that feedback, never an
organization's work. Accepting a code change also files it in Linear when
the app Worker has `LINEAR_API_KEY`.

## 163. A pull request's guardrails run in about the time of its slowest test job, not of its setup

Date: 2026-10-23 · By: Carl Sauder · Status: accepted

Reason: every guardrails run on a pull request took about 6 minutes, and
three jobs each took about that long, so no single fix made a run shorter.
Carl asked for the run to be cut down (2026-10-23), from the timings of the
last 40 runs.
- **`checks` split three ways.** The unit suite was 190 to 285 seconds of the
  job's 4.5 to 6.7 minutes. It is CPU-bound: 38 seconds on a laptop's 15
  cores, 4.5 minutes of CPU. `checks` keeps typecheck, lint, the store
  builds' server calls and the push delivery bundle; `unit` runs the suite
  in three shards on three runners, each with coverage and a blob report;
  `coverage` merges the reports (`vitest --merge-reports --coverage`) and
  holds the thresholds, which a shard skips (`VITEST_COVERAGE_SHARD`,
  `vitest.config.ts`). Vitest's own `--shard` deals files by a hash of their
  path and put the memory and fleet tests in one shard (39 seconds against
  5 on a laptop); `scripts/unit-shards.ts` deals them by weight, slow files
  first, so the organization folder's memory test runs alone and sets the
  shard's length. `gate` needs all three, and a failure in any of them on
  main tells Linear that `checks` failed, as `checks` did.
- **Setup in the background.** `web-smoke` loaded its 787 MB of cached
  images in the foreground (about 75 seconds) before the stack could start,
  and both browser jobs built the web export only once the stack was up
  (40 to 60 seconds), because `e2e/env.sh` reads its settings from
  `supabase status`. The development export needs only the stack's URL and
  anon key, which are the CLI's fixed local values and are already in
  `apps/mobile/.env.development`. Now each job starts the stack in the
  background (`scripts/ci-background.sh`; it pulls its images, decision
  164), builds the export in the background beside it, and installs the
  browsers meanwhile.
  `e2e/export-web.sh` keeps that export (`WEB_EXPORTED=1`) only when the
  running stack has the same URL and key, and builds it again otherwise.
- **Two smoke workers.** The eight smoke tests ran one at a time, 3 minutes,
  the first 83 seconds while the Worker warmed up. They run two at a time
  (`e2e/web-smoke.config.ts`); each signs up its own account.
Reverse if: `unit` and `coverage` together take longer than the old
`checks` did (three runners setting up for 30 seconds each), or a merged
report covers less than one run of the whole suite does; the early export
is built again often (the CLI's local keys changed, so update
`.env.development`); or the smoke tests fail two at a time and not alone.

## 164. A commit that already passed guardrails is not tested again: the merge queue takes the pull request's run of the same tree, and the push takes the queue's

Date: 2026-10-23 · By: Carl Sauder · Status: accepted

Reason: a merge took about 12 minutes after its pull request was green, and
none of it tested anything new. The queue merges one pull request at a time
with a merge commit (decision 150), so when main has not moved since the
pull request's last run, the queue's entry has the same files as the commit
that run tested (refs/pull/N/merge). Then the queue pushes that same commit
to main, and the push run tested it a third time, on 9 runners. Carl asked
(2026-10-23) to skip both, with a time limit on the first. Amends 150.
- **The queue.** A green pull request run's `gate` uploads an artifact named
  for the tree it tested, `tested-tree-<tree>`, kept a day. In the queue,
  `scope` (`scripts/ci-tested.mjs`) looks for one named for the entry's
  tree, from a guardrails `pull_request` run whose head is the entry's
  second parent (the pull request's head), made in the last 60 minutes.
  Found, `scope` says `tested` and every job, `checks`, `unit` and
  `coverage` too, is skipped; `gate` passes and names that run. The head
  must match, not only the tree: any branch could hold the same files and
  a workflow that skips its tests. The limit is there because some checks
  read things outside the tree: `server-calls` and `test:old-sync` read the
  store builds from EAS, which change without a commit.
- **The push.** A push whose commit has a green `gate` from a guardrails
  `merge_group` or `push` run of that same commit runs no tests. A pull
  request run's `gate` does not count: GitHub puts it on the pull request's
  head, but it tested the head merged with main, so a branch fast-forwarded
  to that head (develop) is tested. Any other push runs every job, as before.
- **Caches.** A pull request can read only its own caches and main's; the
  queue's are its own. The push run was what saved main's Docker images,
  Playwright browsers and npm cache after a key changed. `warm-caches` does
  that on a push that runs no tests: it looks each cache up, and only when
  one is missing pulls and saves it (`.github/actions/docker-images` phase
  `warm`, `.github/actions/playwright` `warm`). The Docker cache key moved
  to `v2`: the v1 job images' cache held only `node:24-slim`, so every
  `ui-web` shard pulled the stack from a registry. When ECR turns the CLI
  away, it pulls the same images from `ghcr.io` (or Docker Hub), and `save`
  looked only for ECR's names (seen in run 39994259704, this change's first).
  `ci-docker-images.sh save` now gives each such copy ECR's name, the one the
  CLI looks for first, and keeps nothing without the database image.
- **No image cache in the browser jobs.** Measured on this change's pull
  request (run 39996890150): with the cache cold and the CLI pulling, the
  runs took 352 and 374 seconds; with it warm, 425. Fetching the 1.2 GB
  archive took 26 to 54 seconds in the foreground, and loading it left the
  `ui-web` shards waiting 76 to 98 seconds for the stack, against 22 to 68
  when they pulled. ECR rate-limited both cold runs, and the CLI took every
  image from `ghcr.io` without a failure. Carl chose (2026-10-23) to drop the
  cache from `web-smoke` and `ui-web`, which set a pull request's length,
  and rely on the CLI's pulls and `scripts/ci-retry-pull.sh`. `server` keeps
  it: it ends minutes before the browser jobs, so the load costs no wall
  time there. So do the nightly jobs, which nobody waits for and which would
  lose a night's results to a refused pull. `warm-caches` keeps both
  caches filled for them.
- **What else read the push run.** The flake tracker counts merge queue runs
  too (`scripts/ui-flake-report.mjs`). `gate` still tells Linear when
  `checks`, `unit` or `coverage` failed on a push that ran them.
Building several queue entries at once was weighed and left out: merges
seconds apart would lose release-branch copies (decision 150, amended
2026-10-23; decision 155), and `scripts/githubRules.test.ts` holds one.
Reverse if: a merge into main breaks main though its queue entry took a
pull request's run (then the tree is not the whole input, and the queue
runs every job again); pull requests miss main's caches after a key
change (then `warm-caches` is not filling them); or a browser job fails
because both ECR and `ghcr.io` refused its pulls (then the browser jobs
restore the image cache again, loading it in the background).

## 165. The sync icon's number counts only what this device has to send; its ring also turns while others' recordings download

Date: 2026-10-23 · By: Carl Sauder · Status: accepted

Reason: the header's sync icon (d5515aae) counted events, uploads and
downloads in one number, and named it "N to send". A phone with one note
waiting said "Offline, 26 to send" while 25 recordings came down, which is
untrue, and the nightly UI suite caught it (NAV-095, WEB-027; LAN-96).
Counting sends only would have hidden downloads from the header: a phone
still receiving would look idle, and someone could go offline before their
team's recordings had arrived. Carl chose (2026-10-23):
- **The number and the spoken name** count events (language and
  organization) and recordings not yet uploaded: "Live, 2 to send"
  (`iconCounts` in `apps/mobile/src/sync/syncStanding.ts`).
- **The ring** turns for anything in flight, recordings coming down too.
  With nothing to send and recordings coming down, the name says
  "Live, receiving recordings" and help mode says the ring is downloads.
- **The Sync screen** keeps "To send" and "To receive" apart, as before.
Reverse if: people read a turning ring with no number as stuck, or ask how
many recordings are still coming (then the icon gets a second count).

## 166. What is on the device and what waits to upload is shown by passage: a download button on every passage, an upload bar while anything waits, and the Sync screen by passage with a record of what went up

Date: 2026-10-25 · By: Caleb Koster · Status: accepted

Reason: a tester asked whether translators can work fully offline and then
sync, after the app "would not load" with the phone offline (a build from
before decision 87). Caleb found the app's answers hard to read: a tiny cloud
mark on chapter tiles said a passage was kept, keeping one was under
"Something else?", a book divided into passages showed chapter tiles although
a passage can run across chapters, nothing said plainly that recordings made
offline wait on the phone or how many, the Sync screen listed event names
("TakeComposed · Luke 13:1–9"), nothing said when work went up, and an update
check that failed offline showed Android's own error ("Unable to resolve host
u.expo.dev"). So:
- **Download buttons.** Every passage's row and every chapter's tile has a
  round download button (`DownloadButton`, sync/offline.tsx): an outline to
  download, an arrow wave moving down while it does (`WaveArrow`,
  sync/transit.tsx), amber when offline and not all here, green once it is. The top of a passage is the same button as a line
  ("Download for offline", "Downloading for offline · 3 of 5", "On this
  device"); the card under "Something else?" is gone. A book says how many of
  its passages are ready on this device. Tapping keeps the passage, stops
  keeping one the person chose, or says why it is kept (asked of them, worked
  on). Decision 61's per-unit choice stands; the cloud marks and the map key's
  "On this device" go.
- **Passages, not chapters.** A book whose passages are not its chapters one
  each (`chaptersAreWhole`, map/mapModel.ts) shows its passages as rows, 25 at
  a time, instead of chapter tiles. Chapter tiles are four across on a phone
  (five before), big enough for a thumb and their download button.
- **The upload bar.** While recordings or changes wait to upload, a bar over
  every screen says how many ("3 recordings waiting to upload", changes only
  when no recording waits), and "Offline" or "Uploading"; it says "All
  uploaded" for four seconds when the last went. While they go up, its arrow
  waves upward. It opens the Sync screen as
  chrome, like a tab or the Global Viewer link (decision 158), not along a
  flow edge, and does not open it from a recording screen.
- **The Sync screen by passage.** It starts with recordings as packages
  between a phone and a cloud (`TransitScene`, sync/transit.tsx), with how
  many wait to go up and to come down: online they leave the phone's belt
  for the cloud and arrive from it; offline the front one rises to a
  no-signal line and drops back (Caleb's idea, 2026-10-25). Then how much
  waits (or "All uploaded" and when the last upload was), then "Waiting to
  upload" by passage ("0 of 3 recordings uploaded", one box per recording
  turning green as it goes, from each passage's most recordings since its
  queue was last empty), then "Uploaded": what this device sent, by day,
  passage and time. The event list stays under Details, for support. The
  motion is transforms and opacity on the native driver and stops under
  reduce motion.
- **A record of what went up.** The language session keeps a short log on
  the device (`packages/sync/src/sentLog.ts`, the store's meta table): files
  as each upload finishes and changes as the server accepts them
  (`SyncClientOptions.onSent`), by passage, a sitting's worth joined into one
  line, at most 300 lines. It is for people to read and drives nothing. It
  starts empty on each device with this build.
- **No update errors.** A failed update check or download shows nothing;
  diagnostics get the reason, and the next return to the app looks again.
  Only "Downloading update…" and "Update ready — tap to restart" show.
Reverse if: people miss the event list (then plain names for each kind join
the passage rows), the bar over every screen crowds small phones (then it
moves into the headers), or teams want a whole book downloaded at once (then
a book gets its own button, which decision 61 left out).

Amended (2026-10-25, Caleb Koster): every line says only what this device
knows. Caleb, after the first build: offline, a passage he had not
downloaded still offered "Download for offline", and tapping it said "Kept
on this device" at once; "Above all, these indicators … must tell the
truth. They cannot assume anything." The old app's false flags had caused
partners and users real trouble. So:
- **Offline is the phone's word as well as the server's.** `ctx.language.online`
  is false as soon as the operating system says there is no network
  (expo-network, `saysOffline`), not only after the next sync attempt fails.
- **Online is only the server's word.** Caleb: some checks "show that the
  phone is online … even if the user has a VPN turned on and they have no
  internet connection". The operating system's "connected" says nothing
  about a VPN with no internet behind it, a hotspot's sign-in page or a SIM
  out of data, and a sync then hangs with no answer while the last result
  still says online. So the app counts what the server itself said
  (`sync/reachModel.ts`, `useServerReach`): each sync it answered
  (`LanguageSessionOptions.onAnswered`), each answer to the live channel's
  heartbeat (every 15 s, `server/supabase.ts`), and, when neither has come
  for 20 s while the app is on screen, a check of its own
  (`server/reachability.ts`: `/auth/v1/health`, counted only when the
  server's own JSON comes back within 8 s). An unanswered check says
  "Offline" at once, unless something answered after it was asked; the
  next answer of any kind clears it and syncs. With the live channel up
  the heartbeat answers, so the check seldom runs; it costs one small
  request every 20 s otherwise, and none off screen or with no network.
  SYNC-034.
- **No download is offered offline.** A passage not kept says "Download
  needs a connection" and does nothing. Keeping one shows no toast: the
  line itself says what happens.
- **"On this device" only once counted.** A passage says it only when the
  session's own count of its files says every one is here (decision 147:
  rows as well as audio); until the count has it, "Checking this device…".
  Kept but not all here: "Only {here} of {total} files on this device".
- **Moving only while moving.** The session publishes which passages have a
  file going up or coming down right now (`uploading`, `downloading`).
  "Uploading", "Downloading for offline", the arrow waves and the packages'
  flights show only then. Work merely waiting is "Saved on this device".
- **"All uploaded" means everywhere.** A phone syncs the language it has
  open, so other languages' work waits on the device: their changes come
  from the event log (`pendingStreamsBy`) and their recordings from each
  session's last count (`files-waiting:<org>/<language>` in the store's
  meta). They count in the bar and show as rows on the Sync screen.
- **Nothing new is not known offline.** "To receive" and the transfers say
  "Offline" there, not "None" or "Up to date"; the top count shows only when
  something is known to wait. Settings' sync line says recordings waiting,
  and offline before "Live".
- **Sent means sent.** Offline, asking someone, a review and a published
  version say who gets it when the device is connected.

## 167. The nightly mutation run is four shards of core's files, dealt by what each costs, and one merged score

Date: 2026-10-26 · By: Carl Sauder · Status: accepted

Reason: Stryker over all of `packages/core` never finished at night (LAN-97).
Core grew from about 10,700 mutants (2026-10-14, 7 minutes on a laptop) to
20,158, and the job ran 7 workers on a 4-core runner, so its own timeouts
killed mutants: on 2026-10-23 it had tested 12% when the job's 40 minutes
ran out, and since the incremental file is written only at the end, no
night ever started further on. Carl chose (2026-10-26) to shard it.
- **Dealt by cost.** `scripts/mutation-shards.mjs` deals core's files to
  four shards, the slowest first, each to the lightest shard so far. A
  file's cost is its mutants times the tests each one runs, measured once
  and listed in `SLOW_SECONDS` (as `scripts/unit-shards.ts` does for the
  unit suite); neither lines nor bytes stood for it (`catalogData.ts` is
  139 kB of static data that Stryker leaves alone).
- **Four, not eight.** A file cannot be split, and `passage.ts` and
  `validate.ts` each take about ten minutes alone on a laptop, so no shard
  ends sooner than they do: eight shards would end no earlier than four,
  on twice the runners. The rest of core fits in the other two.
- **Each shard** runs four workers, has its own incremental file and cache
  key, and 90 minutes. `nightly-mutation` merges their reports into one
  `mutation-core` artifact and one score, and is the job Linear hears about.
- `npm run test:mutation` still runs all of core at once, for a laptop.
Reverse if: a shard runs out of time (then measure again and split the
slow file's tests, or give it its own runner), or Stryker learns to keep
partial results, so one job could carry on from where the last night
stopped.

## 168. Signing out of a phone locks the sign-in on it, and a picture and pattern, or the password, opens it again offline

Date: 2026-10-26 · By: Caleb Koster · Status: accepted

Reason: amends 60 and 87. Every way into the app needed the server (a
password, a helper's code, an invite), so someone who signed out offline
could not get back in, or reach the work kept on the phone, until it was
online, which in the field can be months; on a shared phone nobody else
could get in either. Caleb said (2026-10-12) that signing out and back in
must both work offline: field users will tap Sign Out, and in countries
where Christians are persecuted they may do so on purpose before a phone is
taken. Of the options put to him then he chose an encrypted lock with no
names on Sign In, a swipe pattern rather than digits, and a picture for each
person to find themselves by. That work (pull request 90) was merged into a
branch that had already reached main, so it never shipped; Caleb asked
(2026-10-26) for it on main, with nothing lost and nobody signed out. Little
research covers low-literacy users: less-literate smartphone users already
lock their phones with a PIN or a pattern; patterns are faster and liked,
PINs give fewer errors; text-free designs suit non-literate users. A pattern
needs no reading and no numbers, in any language. Chosen:
- On a phone, Sign Out seals the person's session (AES-256-GCM) with a
  random data key the phone keeps for them while they are signed in, and
  keeps that key only wrapped under their password and, if they drew one, a
  pattern (PBKDF2-SHA256, 10,000 rounds stored per wrap; `@noble/hashes`,
  `@noble/ciphers`) (`apps/mobile/src/auth/sealModel.ts`,
  `apps/mobile/src/server/lock.ts`; the web build takes `lock.web.ts`, which
  does nothing). The lock, the key and the sealed session
  live in the Keychain or Keystore with the session (60, amended
  2026-10-15). It asks the server nothing and no longer ends the session
  there. Neither the password nor the pattern is stored; an email or sign-in
  name is kept only as a hash salted per phone. The rounds are few on
  purpose: plain JavaScript is slow at them (50,000 took 15 seconds on the
  simulator's debug build, 10,000 took 3), and against a copied lock the
  patterns fall whatever the count. The stretching pauses on a timer, so
  "Signing in…" shows and the screen does not freeze.
- The password wrap is made on every online sign-in with a password and
  when a password is set (`rememberPassword`); the same password typed
  again brings back the key it wrapped, so a pattern stays good. Someone
  with no password here (a QR join, a helper's code, or signed in before
  this build) chooses a picture and draws a pattern twice when they first
  sign out; anyone may add or change one there. Two people on one phone
  never share a picture (sixteen things known everywhere, drawn by the
  phone's emoji font); they may share a pattern, since the picture says
  whose lock to open.
- A pattern joins at least five of nine dots, as on the Android lock screen
  (`apps/mobile/src/auth/patternPad.tsx`): dragging and lifting finishes it;
  tapping the dots one at a time and then Done works too, which is also how
  a screen reader enters one.
- Sign In tries a typed password against the lock before the server. While
  someone here can come back with a pattern it shows their pictures, never
  names: tap yours, then draw (`signBackIn`). Wrong guesses count for that
  person's lock: four are free, then each try waits twice as long, from a
  minute up to an hour. Words that explain any of this are in help mode,
  not on the screen.
- Unsent work stays as 60 has it: a hand-over still sends it as its author
  when the phone is online, and its kept session is sealed too. Coming back
  takes the session back from the courier (`takeBackHandOver`); after the
  courier is done the session stays sealed for its owner instead of being
  ended. A session the server ended takes the lock's copy with it.
- Signing in again here by any other way drops an older sealed session of
  theirs (`signedInHere`). A browser forgets everything on sign-out (11), as
  before.
What it guards against: the next person on a shared phone, and someone who
takes the phone and tries patterns in the app. Someone who gets past the
Keychain or Keystore and copies the lock can try all of about 390,000
patterns as fast as their computer allows, so a pattern then holds for
hours, a long password much longer; a pattern is also easier to see over a
shoulder than a PIN. A helper marking the phone lost (59) ends the session
on the server the next time the phone is online. Nothing new leaves the
phone, so no store answer changes (`docs/play-store-declarations.md`).
Tests `apps/mobile/test/lockModel.test.ts`, `lockFlow.test.ts`,
`handOverSend.test.ts`.
Reverse if: people forget their pattern more often than they come back with
it (then offer a helper's code first), or a locked phone is opened by
someone it does not belong to (then a larger grid, or a server-held key).

## 169. An account writes at most 20,000 events or 100 MB dated any one day, a person's stream holds each event once, and a language's member reads only their languages' templates

Date: 2026-10-26 · By: Carl Sauder · Status: accepted

Reason: a security audit (2026-10-26) found that decision 115 bounded each
event but not how many, so any account (sign-up is open and confirms no
email) could fill a log that never sheds an event, through `append_events`
or `record_user_event` with ids of its own choosing. 115 turned down a quota
on events per day because it would refuse a phone pushing weeks of offline
work at once; this one is counted by the day on each event's own clock, so
that work goes up when it reaches the server. Carl chose (2026-10-26):
- **The allowance.** A signed-in account writes at most 20,000 organization
  and language events, or 100 MB of their payloads, dated any one UTC day
  (`append_allowance`, `_append_allowance_refusal`, migration
  20261026200000). In the local data, v2's history included, a person's
  busiest day is about 9,300 events and 1.9 MB, and the 99th percentile
  about 1,150. A day is never earlier than the day the account was made, so
  a new account cannot date events into the past to write more: an abuser
  gets 20,000 events a day of the account's age. Only what was taken
  counts, not duplicates or refusals, and the service role's imports and
  seeds are not counted.
- **An event over it is refused on its own**, `may not emit <type>: this
  account has written 20000 events dated <day>`, which the phone keeps and
  shows (invariant 1, `NOT_ALLOWED`), and the rest of the push goes on.
  Failing the whole push, so the phone would try again, was the first
  choice, made while the allowance was counted by the day the server
  received events; counted by the event's day, an allowance that is used up
  stays used up, so a failed push would have held back that language's
  uploads for good.
- **A person's stream holds each event once.** `VisionSeen` and
  `WalkthroughDone` are kept once, with an empty payload; `TermsAccepted`
  once a version, with only the version, and at most 100 versions. A repeat
  is answered as done, so a phone that sends one again sees no error.
- **`invitecheck:` is the server's.** `redeem_invite_for` puts the person
  joining on the invite's check teams with ids that begin `invitecheck:`,
  which `_server_event_id` did not reserve, so a member who knew the
  invite's id could take one first and the person would quietly not join
  the team.
- **`library_template_users` names only the languages the caller may read**
  (`can_read_stream`), as `language_book_names` does; a language's member
  saw every language's template. Defining or publishing a library item
  takes an organization-wide role, which reads every language, so the
  app's choice between a new version and a copy (`breakup/model.ts`
  `planChange`) is the same for everyone who can make it.
- **Kept on purpose:** `register_push_token` and `diag_ingest` move a push
  token or an install id to whoever registers it. On a shared phone the next
  person must take over the phone's token when the hand-over could not
  unregister it offline, and knowing either id takes the device.
Reverse if: real work dates more than 20,000 events or 100 MB to one day
for one person (then raise the allowance, or count by language), or phones
with clocks set far back start being refused (then measure how far, and
count their events on the day received).

## 170. Reading a language's work and seeing its report are two rules on purpose, and core holds both against SQL

Date: 2026-10-26 · By: Carl Sauder · Status: accepted

Reason: a separation-of-concerns audit found read access written twice with
different answers and nothing comparing them. SQL `_can_read_stream_at`
(and `blob_access` through it) lets anyone with any privilege on a language
read its stream and files; core's `mayViewLanguage`, which the Worker uses
for reports and agent views, needs `view_status`. Every seeded role has
`view_status`, so they disagree only for a custom role without it, but the
file-write rule in `blob_access` existed only in SQL, and
`scripts/record-parity-sql.ts` checked writes of events alone. Carl chose
(2026-10-26) to keep both rules and pin them:

- Reading the work (the stream, its files) needs any privilege on the
  language, or for the organization stream any membership; seeing its
  report needs `view_status`. A custom role without `view_status` may
  record and review a language yet not see its report.
- Core says both: `mayReadLanguage` and `mayWriteFiles` (`org.ts`) mirror
  `_can_read_stream_at` (a person who is not a Global Viewer) and the write
  branch of `blob_access`, beside `mayViewLanguage`, and say why they
  differ.
- `scripts/record-parity-sql.ts` (the `server` guardrail) generates roles,
  memberships and languages and compares the SQL answers with core's, as it
  already did for `role_may_emit_event`.
- No call site changed: the Worker still asks SQL for files and core's
  `mayViewLanguage` for reports.

Reverse if: a role should read a language without being able to see its
progress for a reason the team does not accept, when the report rule
becomes the read rule; or the two rules are found to confuse people (work
visible, report refused), when the screens say why.

## 171. A phone can wear a disguise: a calculator or notepad icon, and in front of the app a calculator or notepad that the person's code opens

Date: 2026-10-26 · By: Caleb Koster · Status: accepted

Reason: some translators work where being found with a Bible translation app
is a danger. The old app had a disguise (v2, July 2026, PRs 900 to 907) and
Caleb asked for it in this one. It works as v2's did, with these choices:
- **Where.** Me → More settings → App icon (`src/disguise/DisguiseRow.tsx`),
  phones only: LangQuest's own icon, or one of five calculators or five
  notepads, our own drawings (`assets/disguise`). The row is called App
  icon, as v2's was, not Disguise.
- **Icon and code together.** Choosing a calculator or notepad asks for a
  code of 4 to 12 digits, then opens that calculator or notepad full screen
  to type it. The disguise goes on only once it has been typed there, so the
  try teaches how the app will open, with no text explaining it. v2 had the
  icon and an App lock switch apart; an icon without the lock opened
  LangQuest from "Calculator", and a lock without the icon was a calculator
  behind LangQuest's own icon, so here there is one choice. LangQuest's own
  tile takes it off.
- **What opens.** A disguised phone opens on a calculator that works or a
  notepad that keeps its note (`src/disguise/faces.tsx`), before sign-in and
  before anything of the app starts (`DisguiseGate`, around everything in
  App.tsx), so nothing of LangQuest shows, asks or sounds. The calculator
  opens the app as the code's last digit is typed, with no = to press; the
  notepad, on a line that is only the code, which then leaves the note. A
  wrong code does what a calculator or notepad would. Android's Back leaves
  it as it would a calculator.
- **Locks when left.** v2 locked again only when the app was closed. Here
  leaving the app (the app going to the background) puts the disguise back,
  so a phone handed over with LangQuest open behind another app opens on the
  calculator. The app stays as it was under it, so the code brings back the
  same screen, sheet or recording. Every modal draws the disguise over itself
  (`ModalCover`, `src/ui/coverContext.ts`), since a modal is above the app's
  own view. The cost: Android counts a permission prompt or the share sheet
  as leaving, so the code is typed again after one.
- **On the phone only.** Which look is kept in the app's key-value store,
  read at once at start; the code only as a salted SHA-256 in the Keychain or
  Keystore (`src/disguise/disguise.ts`). Nothing is sent and no connection is
  needed. Turning it on disconnects this phone's notifications (each would
  say LangQuest), tried again each time the app opens until the server has
  heard, and More settings offers none while it is on.
- **Icons need a store build.** `expo-alternate-app-icons` changes the icon;
  `./plugins/withDisguiseIcons` names each Android alias "Calculator" or
  "Notes" in the phone's language (`native.calculator`, `native.notes`) and
  gives each the app's link filters, since the usual launcher entry is
  turned off while a disguise is on. iOS cannot rename an app, so an iPhone
  shows the new icon over "LangQuest Next", and iOS says that the icon
  changed. A build made before this has no other icons and offers no App
  icon row.
- **Told, not hidden.** v2 hid the feature's names in its public source
  behind an XOR encoding. Apple now removes apps for hidden or undocumented
  features (App Review Guidelines 2.5.19, added 2026-10-16), so this code
  names it plainly, and the App Review notes describe it
  (docs/play-store-declarations.md). Google's Deceptive Behavior policy allows
  a home-screen change the person makes and can undo.
Reverse if: Apple or Google turns a build down for it (then the calculator
and notepad stay and the icon goes, or the reverse), people lose their codes
(then a way back through sign-in is needed, which the disguise must not show),
or typing the code after every permission prompt or share drives people to
turn it off (then leaving for a few seconds does not lock).

Amended (2026-10-29, Caleb Koster): no tutorial video, channel trailer,
YouTube reply or nightly suggestion shows or explains the disguise, or how to
turn it on or open it. Telling the stores is not teaching the public: a public
how-to teaches anyone who picks up the phone to see through it. The web app
the videos are filmed on draws no App icon row (`DisguiseRow.web.tsx`),
`e2e/tutorials/no-disguise.test.ts` fails on a video that names or lights it,
and the nightly look at the videos' feedback is refused whole when a reply or
suggestion names it (`server/tutorialFeedback.ts`, decision 186).

## 172. FIA's key words are a key-word list per language, picked apart from FIA's guides, shown where a passage links or says them, and every reference list can be searched

Date: 2026-10-26 · By: Caleb Koster · Status: accepted

Reason: FIA's guides already carried each passage's Master Glossary words,
but only as tappable words inside a guide step: they never reached the
team's key words, and reviewers never saw them. Caleb (2026-10-20): FIA's
key words should be usable without FIA's guides, a team turning on the
guides should see at once that the words go with them, words should show on
a passage where its verses are linked to them or where a translation says
them, and reference material should be searchable ("FIA" finds FIA's items
among a hundred from twenty organizations).
- **Format.** The library's unused key-word list (`material@1` of kind
  `key_terms`) is filled in rather than a new format made: each word
  (`KeyWordDoc`) may carry its full meaning in markdown (`[mercy](#t91)`
  links another word, as guides link terms), a recording (`MediaRef`) and the
  verses it belongs to (`links`); the list may say the method it goes with
  (`pattern: 'FIA'`, as FIA's guide collections do) and its credit line.
  One document per language holds the whole list (English 752 KB, about
  190 KB compressed), so its words show and search offline once it has
  come; recordings stay on FIA's server and play when tapped, as guide audio
  does.
- **Import.** FIA's `get_terms.py` (genesis-ai-dev/fia) writes every term with
  its translations and linked pericopes; `scripts/fia-terms.ts` makes a list
  per language that has meanings (English 302 words, French 237, Portuguese
  237, Indonesian 236, Mandarin 155, Spanish 10; Russian has names alone and
  is left out), placing each pericope by FIA's passage list. `npm run
  library:seed -- --fia-terms <file>` publishes `langquest.fia-words.<lang>`;
  without it the seed uses the Genesis 2 sample in `library/fia`.
- **Picking.** Key-word lists are their own kind of reference material
  (`RefKind` `words`) with their own row and switch. A method's lists form a
  set by language like its guide collections (`guideSets.ts`, set key
  `<origin>|FIA|words`), chosen with the same per-language
  `v1.ReferenceSet` writes; no new event. A list reaches a team only when
  chosen for it (recommended for the language, or by the organization for
  every language), never by merely being in the library as guides and notes
  do, so a phone fetches only its team's list: of FIA's, the one language its
  admin picked. Items from the same organization
  that follow the same method are related (`HelpItem.family`): turning on
  FIA's guides turns on FIA's key words in the same language (else English),
  and New language ticks them with the guides it suggests; the first row of
  the family that is on says how many related resources came on, and tapping
  that line filters the list to them, each with its own switch. Turning one
  off never turns off the others.
- **Search.** Every list of reference material has a search bar matching
  name, description, organization, language, kind and method, every typed
  word in any order (`matchesHelpItem`). A search reaches past the team's
  language (typing "French" finds French material) and lists what the
  organization does not have yet last, under "Not in your library yet".
  The Key words screen searches the team's words and every list by word,
  short meaning and full meaning.
- **On a passage.** A list's word shows when one of its links meets the
  passage's verses (each side in its own numbering, as guides are matched) or
  when the word or another form of it (the list's `match`, and simple English
  endings) is a whole word in a Bible the team reads in the list's language
  (`keyTerms/listsModel.ts` `wordsOnPassage`). Words the team has made its
  own show with the team's words instead.
- **The team's own.** Adding a list's word makes an ordinary key term whose
  id is `fia:<FIA's id>` (the prefix `isFiaTerm` already read), so the
  team's word and FIA's stay one word and its page shows FIA's meaning.
- **Checks.** A key-word list is a library item, so a check can link it as
  a help (decision 91); the reviewer sees each of the list's words in the
  passage with the team's word, whether the translator marked it in this
  version, or that the team has no word yet.
- **A word's own page.** Key words → a word lists every passage of the
  language the word is in: where its list links it, where the team's chosen
  Bible says it in the book the word belongs to, and where a version marked
  it. Each shows where the team stands (used, not marked, not recorded),
  with chips to keep one kind, and opens that version, or the passage when
  nothing is recorded (a new edge, `key_term_detail` to `passage_record`).
  Below come the notes on the word and the review notes about it from any
  check, newest first, with passage, version and replies; they are read from
  those passages' records, which may not be in memory (decision 143). A
  list's word the team has not taken opens the same page from the Key words
  search or a word's sheet ("Every passage it's in"), with Add to our key
  words at the top and the passages its list links it to
  (`keyTerms/wordPageModel.ts`, `useWordPage.ts`). "Where it's used" folds
  into the passages, and the list's meaning becomes a row under Details.
Cost: about 70 KB more of the web app's code. A word's sheet and a check's
key words load when first opened, and the search helpers live apart from
the recorder's (`keyTerms/searchModel.ts`): a first visit is 3.77 MB of its
3.9 MB budget, and every file together 4.63 of 4.75 MB
(`apps/mobile/scripts/export-web.mjs`, decision 123 amended).
Reverse if: lists grow past what one document per language holds (then a
list goes book by book, as `helps@1` does on the Door43 branch), or teams
need to edit a library list's words one by one (then each word becomes a
register).

## 173. An organization gets a blue check after its name when an admin proves an email address at its website and LangQuest staff grant it

Date: 2026-10-26 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-26) wants publishers such as unfoldingWord and Word
Collective (which owns FIA) to host their own material in organizations of
their own, and people to be able to tell the real organization from a
look-alike, wherever its name shows. He chose that blue checks are granted
by request: the organization gives its domain, and the request comes from an
admin whose email address is at that domain and confirmed, with a
confirmation of its own since LangQuest confirms no email otherwise
(docs/invites-and-accounts.md). Built (docs/verified-organizations.md):
- **Asking.** An admin (manage_roles at the organization's level) names the
  domain and an address at it or under it; free email services are refused
  (the same list in SQL and in `apps/mobile/src/verified/model.ts`). The Edge
  Function `verify-org-email` has the database make a 6-digit code
  (`org_verification_begin`, service role only, so no client holds a code it
  was not emailed) and sends it through the invite-email Worker's
  `/send-code`, in the admin's language. A code lives 30 minutes, five wrong
  tries spend it, and an organization gets a code a minute, five a request
  and ten a day.
- **Staff decide.** A confirmed request waits for LangQuest staff, who open
  the website and check it is this organization, then grant or decline on
  the ops dashboard (162, amended) or with `npm run org-verification`. The
  dashboard shows the address only as its domain (decision 39); the script
  shows it whole. Revoking is the script's alone.
- **Showing.** Any signed-in person may ask which organizations are verified
  (`org_badges`); the phone keeps the answers (asked again after ten minutes)
  and draws one blue seal after the name: My Work, the Manage card (whose
  "Verified · domain" line opens what the check means), Switch Organization,
  Find your organization, the card after scanning an invite, New language's
  review flows and reference material, and the content templates library.
  The seal is not a button of its own. Its sheet says that the check shows
  who is sharing, not that LangQuest reviewed what they share.
- Nothing is written to any organization's log: whether it is verified is
  the server's own state, like a Global Viewer grant (158).
Not yet: the import tools for publishers' own material, and the seal in the
remaining library screens (Reference material and Review flows in Setup,
Get ready's helps).
Reverse if: requests come faster than staff can check them (then a DNS
record could prove the domain, or a confirmed address could grant at once,
in `org_verification_confirm`), or people read the check as LangQuest
vouching for an organization's material.

Amended (2026-10-27, Caleb Koster): staff keep looking at every request
before granting it. Caleb chose this over granting once the email is
confirmed: "one look at each request stops look-alikes, such as someone with
a university email claiming that university." The Manage card loses its
"Ask for a blue check" and "Verified · domain" lines, which Caleb found
cluttered: the check after the name is the button, grey for an admin until
it is granted (it opens the request), blue for every member once it is (it
opens what it means). The long explanation is one sentence in the style of
other sites' notes on their checks: "A blue check means the LangQuest team
has verified this organization. It is not an approval or endorsement of what
the organization publishes."

## 174. Publishers bring their own material in with an importer LangQuest staff turn on for their organization; the server builds it and their admin publishes it

Date: 2026-10-26 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-26) wants publishers to make their own LangQuest
organizations and host their material there, with "special access to a
custom content-importing tool for their own organization's externally stored
content": Word Collective's FIA, unfoldingWord's Door43. LangQuest's library
held copies of both until now (62, 147). Built (docs/publisher-imports.md):
- **Staff turn it on.** `org_importers` names an organization's importer and
  where it reads from (for `fia`, the GitHub owner of Bible Aquifer's FIA
  repositories). Staff grant and revoke it with `npm run publisher-import`,
  after checking that the organization owns that material (its blue check,
  173).
- **The admin asks.** Someone with Manage Reference at the organization's
  level sees "Import from FIA" under Setup → Reference Material, chooses
  languages and starts a run (`import_request`); one open run per importer.
- **The server builds it.** The app Worker's ten-minute schedule takes the
  oldest open run (`import_run_next`, held 15 minutes) and builds one
  language a step from Aquifer's public repositories into the same
  `study@1` guides, with their audio, key terms, pictures and maps, and the
  same `collection@1` per language that the seed makes from fia.bible's API
  (`server/fiaAquifer.ts`). Aquifer is the source because it is public and
  needs no key; Word Collective's own API would need one. A language that
  fails three times fails the run.
- **Nobody reads what a run made until the admin publishes it.** A run keeps
  its documents under its own key in `library_document_access`
  (`_import.<run id>`), so `_library_store` checks them as it checks any
  organization's, and no person is a member of that key. Publish moves the
  rows to the organization (`import_run_accept`), and the admin's app appends
  `v1.LibraryItemDefined` and `v1.LibraryVersionPublished`, shared for
  following unless the admin says not to. So 62 holds: the server writes into
  no organization's library; the events are the admin's.
- Where a run stands is worked out from its times, never stored (invariant 5).
Measured on the local stack: English FIA is 1,523 guides and 47 MB of
documents, built in 48 seconds; French took 27 seconds, 6 seconds of CPU and
a 57 MB heap, inside a Worker's limits.
Not yet: the Door43 importer (its converters are on the unmerged branch
`claude/project-thread-ipwajx`, and 450 MB of documents from zip files need
the job container of 141, not the Worker); and what happens to LangQuest's
own copies of FIA, which teams follow, once Word Collective publishes its own
(Caleb to decide: moving followers changes their data).
Reverse if: a publisher's material sits behind a key (then the importer needs
the organization's secret, kept like the Worker's), or imports outgrow the
Worker's schedule (then they move to a container job).

Amended (2026-10-27, Caleb Koster): Caleb asked that a publisher can tap the
importer again to bring in what its source added, with "some indicator ... of
'detected x new content'". Each language a run builds keeps the source's own
names for the guides it took (`import_run_parts`; Aquifer names a guide with
its version, "eng-1ch-p17-v1.1"). Once a day the Worker's schedule reads the
`metadata.json` of each published language (`checkImports`,
`import_check_next`, `import_check_save`) and counts guides for passages the
import did not have and guides at a new version; the importer's row says
"16 new or updated guides since your last import" with a New badge, and its
sheet ticks those languages. Importing a language again rebuilds it whole,
but unchanged guides are the same documents (they are named by their
content), so only what changed is new, and followers get it as an update.
Publishing a run clears what it took from the count. Only the importer's own
organization sees its importer: unfoldingWord would see its own Door43
importer, once it is built.

## 175. An organization can move a library item to another organization: the other takes it, and the server moves the item's followers to its copy

Date: 2026-10-27 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-27) asked for "some mechanism by which to transfer the
hosting of content from one organization to another", after publishers got
organizations of their own (173, 174): LangQuest's own FIA copies, which
teams follow, should be able to go to Word Collective. Built
(docs/library.md, "Moving an item to another organization"):
- **Offer.** Someone who manages that kind of item at its organization
  offers it to another organization, found by name among those that share
  material, have a blue check or list a language (`library_move_offer`,
  `library_move_targets`). One open offer an item; it can be taken back
  until it is taken.
- **Take.** Someone who manages that kind at the other organization sees it
  under "Offered to you" on the page for that kind, and takes it as a new
  item or in place of one of its own of the same kind, or turns it down
  (`library_move_accept`, `library_move_decline`). As a new item, the server
  gives the organization every version's documents and their app publishes
  them, oldest first, under the old item's name; either way their app shares
  the item for following. If that organization followed the old item, it
  stops and archives the item that followed it: the item is its own now.
- **The server moves the followers.** When the new item's version or sharing
  lands, `_library_move_land` (called from `_apply_library_event`) appends,
  as `server`, a `v1.LibrarySubscribed` to every organization that follows
  the old item, naming the new one (same local item, same settings), a
  `v1.LibraryPinned` to its version for those that take updates
  automatically, and to the old organization `v1.LibrarySharingSet` (not
  shared) and `v1.LibraryItemArchived`. This is how `_library_fan_out` already
  pins automatic updates in followers' streams; both organizations agreed
  and the followers asked to follow the item, so it is not the server
  writing an organization's library on its own (62). Languages that use the
  item keep their item ids. No new event type: the move itself is the
  server's own state (`library_moves`, its state worked out from its times).
- An item that follows a moved item keeps its local id (`sub.<old org>...`),
  so "already following" is now looked up by the subscription's source
  (core `followerItemId`), not worked out from the id.
Not yet: moving several items at once, and a note in a follower's app that
the item moved (its line says the new organization, with its blue check).
Reverse if: an organization objects to its followers being moved without
being asked (then the move would offer each follower the switch instead), or
moves are wanted between organizations that cannot find each other.

## 176. Clean up puts a part's cleaned sound in a new draft in the part's place; the part as recorded stays on the server, and phones do not download it

Date: 2026-10-28 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-27 and 2026-10-28, thread "Choose voice protection and
audio cleanup tools") asked for Clean up: noise removal on one part, behind
the part's ⋯ menu, with a slider for how much, a pick between the cleaned
sound and the original (Use / Not used), and Undo. He chose to keep the
originals: "hold on to those in the background and just tie them together",
so they can be recovered later, while reviewers hear the translator's pick.
This entry is the record and the files; the screens come later.
- **One new event, `v1.CardCleanUpSet { unitId, hash, use, cleanedHash?,
  cleanedFormat?, tool?, limitDb? }`**, a register per (passage, part as
  recorded). `cleaned` names the cleaned file and its format; `original`
  says someone tried and kept the part as recorded, and saves nothing else;
  `none` is Undo. `tool` is what removed the noise (`dfn3`, DeepFilterNet
  3) and `limitDb` the most it may take out. Translate privilege, as for
  verse marks (`20261028030000_card_clean_up.sql`).
- **The audio is never changed (invariant 4).** Using the cleaned sound is
  a new draft that holds it in the part's place, with the part's verse mark
  copied onto it (core `cleanUpPart`); Undo is a draft with the part back
  (`undoCleanUp`). A version already handed on keeps playing the part it
  had, so nobody swaps the audio under a review (75).
- **The cleaned file is a card without a recording.** The note names it, so
  `recordedCard` gives it the part's length and the note's format, and
  players and the Worker's API play it like any card. It is not a
  `RecordingAdded`, so reports do not count it as a new upload.
- **A cleaned file stays named whichever note wins.** The register keeps
  every cleaned file any note on the part named (`keptCleanUp`), so if two
  phones choose for the same part, the sound the first one made still goes
  up and still plays in the draft that holds it.
- **Originals stay on the server and off phones.** The part as recorded
  still uploads like any part. While the note says to use the cleaned
  sound, the part as recorded is left out of what a passage needs offline
  and out of every download (`FilePlan.aside`), and a phone may free it once
  the server has it. A language kept on disk (143) says the same in the
  cleaned file's audio row (`r`), written again when the note changes. The
  server never deletes a file a record names, so the original can be
  recovered later. This keeps "masters stay raw" (135): the cleaned sound
  is a new file, not a change to the recording.
- `REDUCER_VERSION` goes to 20, so phones fetch each stream again once (110).
Reverse if: people listening to an older version offline miss the part as
recorded (a phone fetches it only when it plays online), originals are
never recovered and their storage matters, or teams want to clean a whole
book at once, which would need one note for many parts.

## 177. Tutorial videos are filmed from scripts that play the web export, voiced by Gemini, and made in every app language from one English script

Date: 2026-10-28 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-27 and 2026-10-28, thread "Plan tutorial videos and
keep them current") asked for a short how-to video for each thing a person
does in LangQuest, in all 15 app languages, kept current as the app changes,
and said to make all of them (about 705) and the pipeline that keeps them
current (`docs/tutorial-videos.md`).
- **A video is a script, not a screen recording.** Each is a file in
  `e2e/tutorials/` that plays the app on the web export from the UI tests'
  fixture world (102): who is signed in, what is lit, what is said, what is
  tapped. Chrome's screencast keeps each frame with its time, and
  `compose.ts` puts the frames in a phone (or a browser window) with the
  voice, what the speaker says into the microphone and what the app plays.
  A changed screen is filmed again by running the script, in every language,
  with nobody recording.
- **One computer voice, Gemini's, in every language.** Gemini's
  text-to-speech speaks all 15 app languages in the same voice. Lines go
  through its Batch API (`gemini-voice.mjs`): outside it a project may make
  100 speech requests a day, and the batch has no daily cap and costs half.
  It takes no speaking style, so the voice is a little quicker than an
  unhurried one. A line's recording is named by its words, so only changed
  lines are said again.
- **Other languages come from the English script.** Lines are translated by
  Gemini, told the app's own words for what each line names, so the voice
  says what the screen shows; they are machine translations like the app's
  catalogs (81). What a script finds on the screen is translated as it looks
  (`ui.ts`): its English is looked up in the catalogs and replaced by what
  the film's language says, or kept where the screen shows data as written.
  The scripts stay one readable English text instead of fifteen.
- **The made-up language is read in French** (Louis Segond 1910) by another
  Gemini voice; what the reviewer says in her own words is said in the film's
  language.
Reverse if: partners find the computer voice or the machine-translated lines
hard to follow in a language (then those lines are recorded or checked by a
speaker), or Gemini stops offering batch speech.

## 178. Whoever recorded a version may check it themselves: "Review it myself" sits after asking, and leads when nobody else there holds Review

Date: 2026-10-28 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-20), alone in his organization, finished a recording
and found no way to review it: each check offered Ask someone, Already
happened and Set aside, and Ask someone listed nobody ("Nobody on the team
can do this"). The block was a line in `kindRowActions` from the UI test
suite (PR 109, 2026-10-14), filed as a bug fix after its role matrix ("not
their own version unless asked"); no entry here decided it, and it went
against the demo's design principle 5 ("Any action can be done yourself or
given to someone else") and against Caleb's rule for written work (give
translators more freedom and record what happened). He chose (2026-10-27)
to bring it back:
- **On every check** (passage/recordTextModel.ts `kindRowActions`), the
  version's author who holds Review gets **Review it myself** (a check that
  records gets its own action, "Back-translate it"), after the sending and
  asking buttons. Someone asked to check their own version still gets
  Review it now, as before (REV-030).
- **Alone** (`nobodyElseReviews`: Ask someone would list nobody, because
  nobody else whose role covers the language holds Review), it leads:
  first on the check's sheet with Ask someone beside it, the record's main
  button is "Do the … check" (`recordModel`, `openCheckFor` with `alone`),
  and Done's main button finishes the version and opens its next check
  (`DoneAsk` `checkNow`, the record's `checkNow` param), with Ask someone
  and Send later under it. The back translation's Done does the same.
- **Something else?** offers "I'll do this myself" to the author when the
  main button asks someone (on a team); alone, the main button already does
  it, so it is not offered twice.
- Nothing new is stored. A review of your own version is an ordinary
  `v1.ReviewRecorded` by you on a take you made, so the record and history
  already show who recorded it and who checked it, and it counts like any
  other review, checkpoints included, as an asked one always did. The server
  never refused it.
Reverse if: teams rely on checks being done by someone other than the
recorder (then a check, or a checkpoint, could say "not by its recorder"),
or people on teams check their own work instead of asking.

## 179. Clean up runs DeepFilterNet 3 on the phone, and the person hears each part both ways before picking

Date: 2026-10-28 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-28, thread "Choose voice protection and audio cleanup
tools") said go on Clean up with "the slider rather than the 3 buttons"
(his mockups 11 to 20). Decision 176 made the record; this is the tool and
the screens.
- **DeepFilterNet 3 on the device, never a server.** Partners record
  offline for months, so noise removal runs where the part is: an 8.6 MB
  ONNX model (`models/deepfilter.onnx`, MIT license) in the
  microphone module beside the speech model, run by the same ONNX Runtime
  (1.22.0, 135), and served at `/models` on the web, where its code is a
  chunk of its own that loads when a part is first cleaned. No new
  dependency. It took a steady hiss from −35 to under −75 dB in our tests.
- **One arithmetic, three copies.** `deepFilter.ts` (the feature
  extraction, the model's runs and the resynthesis) is ported line for
  line to Kotlin and Swift; `test/deepFilter.test.ts` holds the TypeScript,
  and the Kotlin was checked against it to the bit. A part is cleaned in
  runs of 10 seconds with 3 seconds to settle and 1 to cross-fade, so a
  long part never sits in memory whole; the part and its cleaned sound wait
  in the phone's cache as 48 kHz floats until the sheet closes.
- **The slider mixes, it does not clean again.** The sound kept is
  g·recorded + (1 − g)·cleaned with g = 10^(−limit/20): the slider's place p
  is a limit of 6·8^p dB (6 at Less, 12 where it starts, no limit at More),
  so moving it costs a mix, not a run of the model. The module hands back
  per-slice sums, so the two-tone bars (amber noise around the purple voice)
  follow the slider without reading audio. The note keeps `limitDb`.
- **Where it is.** The parts card's bin became a ⋯ with Clean up and
  Delete every part. The sheet offers the parts `mayCleanUp` allows: for one
  part, the part as recorded and the cleaned sound with Use or Not used;
  for several, the slider on top and Original or Cleaned for each. The
  button keeps every pick in one change (core `cleanUpParts`: one draft for
  all the cleaned sounds) and the undo history keeps each note
  (`PartsSnap.cleanUps`), so Undo takes the picks back and nothing asks
  "Are you sure?". A part kept as recorded wears a grey ear saying who
  tried it and when.
- **The kept file is a recording's file.** On a phone it is AAC, as parts
  are (106); a browser has no AAC encoder, so the web keeps WAV.
- The native code is new, so this ships in a store build, not an OTA
  update (the runtime is fingerprinted). The iPhone module's podspec moved
  to the module's root (`expo-module.config.json` `podspecPath`), because
  CocoaPods does not follow the `ios/models` symlink it used: the phone
  check on 2026-10-28 found the models bundle empty, in this build and in
  a dev build from 2026-10-26, so iPhones have most likely split parts by
  level alone since 135 (the speech model was missing and the module fell
  back without a word). From this build on, the bundle holds both models.
Reverse if: cleaning takes longer than people will wait on the phones we
support (2 GB Android phones, 30 parts in a passage), voices come out
damaged in languages we did not test, the 8.6 MB matters for downloads, or
people want a whole book cleaned at once.

## 180. Tutorial videos go on YouTube, one channel per app language, connected once from the ops dashboard; a person's Publish chooses what goes up

Date: 2026-10-28 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-27 and 2026-10-28, thread "Plan tutorial videos and
keep them current") chose a YouTube channel for each app language, as
BibleProject has, one Publish press on the ops dashboard to put new videos
up, and YouTube's API only, never a browser driven for it. He made the 15
channels and the OAuth client (`docs/tutorial-videos.md`).
- **One channel per app language**, made by hand: YouTube's API cannot make
  one. Their ids are in `server/youtube.ts`. Each is connected once from the
  dashboard: Google's page asks which channel, and its refresh token goes
  into Vault (`youtube_refresh_<channel>`), which only the service role reads
  back. The state Google carries is signed with the OAuth client's secret
  and names who pressed Connect, so nothing is kept while they are on
  Google's page and only they can finish, within 15 minutes. A channel that
  is not one of LangQuest's is refused and its token handed back.
- **A person chooses what goes up.** Each version filmed is kept in R2 by
  its hash (`tutorials/<language>/<tutorial>/<sha256>.mp4`, served publicly
  at `/api/tutorials/…`) and recorded (`ops_tutorial_made`). The dashboard
  lists each video's newest version not on YouTube, with Watch, and a Global
  Viewer on an aal2 session chooses which go up (OpsActions, 162). A video
  changed by mistake never goes public by itself.
- **The publish job runs in the job container (141)**, started by Publish
  and at 08:10 UTC each day while chosen videos wait. YouTube allows the
  project 100 uploads a day for all channels together, and 10,000 units for
  the rest (a video and its playlist place cost about 100), so the first
  full set of about 705 takes a week. Each video is recorded as up the
  moment it is, so a later failure never puts it up twice.
- **YouTube cannot replace a video's file**, so a new version is a new
  video: it takes the old one's place in its playlist, and the old one is
  unlisted with a first line linking the new, so its links and comments
  keep working. A replacement does not notify subscribers.
- **An upload says what it is**: public, not made for kids, and marked as
  synthetic media, since the voice is a computer's (177).
Reverse if: YouTube's limits or review make publishing this way
impractical, or partners need the videos where YouTube is blocked (then
next.langquest.org serves the same files).

Amended (2026-10-29, Caleb Koster): each channel has a day's limit of its
own as well as the project's 100, counted over the last 24 hours and lower
for a new channel. Caleb's first Publish (242 videos, 2026-10-29) put up 10
in Arabic and stopped: YouTube said Arabic's channel was at its limit
(`uploadLimitExceeded`), and the job took that as the project's day. Now
only that channel waits for the next run and the others go on; the project's
`quotaExceeded` still stops the run. The job puts up English first, then
French, as Caleb asked (they matter most), then each other language in turn
by its place in the plan; it had gone by language code, so Arabic went
first. A video chosen more than a day ago counts as stuck on the dashboard
only while its channel has put up nothing in that time, since a hundred a
day across fifteen channels takes a week by design.

Amended (2026-10-30, Caleb Koster): a person's Publish is no longer needed
for a wide film: the intake chooses it as it takes it in, and the publish
follows each intake (192). Publish stays for a tall film and for putting a
video up again.

## 181. A part with lots of background noise wears an orange warning, measured on the device from its loudness and the room between its words

Date: 2026-10-28 · By: Caleb Koster · Status: accepted

Reason: Caleb's go on Clean up (2026-10-28, 179) took in the warning in his
mockup 12: a noisy part shows an orange triangle, and a tap shows the noise
and offers Clean up for that part. The options doc said the line would be
picked from real recordings, starting near −45 dB.
- **What counts as noisy.** The room between words, heard as it would be
  with the part at −16 LUFS (Apple Podcasts' level, Caleb 2026-10-27),
  louder than −40 dB (`loudnessModel.ts` `NOISY_DB`). Loudness is
  BS.1770's (K-weighted, gated). The room is the 5th percentile of the
  part's 25 ms slices, each slice's spread about its own middle so an
  offset is not taken for noise. On 118 parts of read recordings (FLEURS
  and LibriVox) cut as the recorder cuts them (140 ms before the first
  word, 300 ms after the last), it read at most 5.8 dB over the noise in
  Silero's speech-free stretches (19 parts in 20 at or under it), and
  about 3 dB under it at the middle.
  The first try, a tenth of 50 ms slices, read up to 25 dB high in parts
  with few pauses.
- **The line.** On the 105 FLEURS parts (Hausa, Yoruba, Vietnamese and
  Mandarin, read by native speakers outside a studio), −45 dB marked 54 %,
  −40 marks 26 % and −35 marks 11 %. A warning that says "lots of background
  noise" should not be on half of everything, so the line is −40. The
  trial's part 4, whose noise rose to −38 dB when it was turned up, is
  over it, and a café 5 dB under the voice is −25.
- **Where it is measured.** On the phone that records a part, from its WAV
  while it is encoded to AAC (`useRecorder`), kept by the hash of its audio
  on that phone (`loudnessStore.ts`); the web decodes any part. A phone has
  no AAC decoder in JavaScript, so on a phone a part recorded elsewhere, or
  before this change, has no measure and no warning: only a measured part
  is marked. The measure is never synced or sent. This is JavaScript only,
  so it reaches the builds that have Clean up (179) as an OTA update.
- **What it shows.** The triangle sits where the grey ear does. A part kept
  as recorded shows the ear instead, and a part `mayCleanUp` refuses (a
  cleaned part) shows neither. The note shows the part's bars, amber around
  the purple of the voice (each bar with twice the room's power taken out,
  since the room is read at its quiet end), and "Clean up Part N", which
  opens 179's sheet for that part alone.
Reverse if: partners' own parts show the line marks too many or too few,
people learn to ignore the triangle, or phones need every part measured
(the player that turns parts up to −16 LUFS will decode AAC on phones, and
can measure there).

Amended (2026-10-28, Caleb Koster): a phone now measures any part it has,
AAC included, in the microphone module (182), so a part recorded on
another device or before this change wears the warning too once the phone
shows it. That reaches phones with the store build that brings 182.

## 182. Every recording people make plays at −16 LUFS, from a copy made on the device the first time it plays

Date: 2026-10-28 · By: Caleb Koster · Status: accepted

Reason: Caleb's go on the audio work (2026-10-28, thread "Build audio
clean up in the app") took in loudness evened on every part by default,
with no button, at −16 LUFS (Apple Podcasts' level, Caleb 2026-10-27).
Partners record on different phones, at different distances from the
mouth, so a reviewer turning the volume up and down between parts is the
common case.
- **A copy plays, the recording never changes.** What is uploaded, synced
  and reviewed stays as it was recorded (or cleaned, 179). The player plays
  a copy turned by `playGainDb` (`loudnessModel.ts`): −16 minus the part's
  loudness, never more than 24 dB up (`MAX_BOOST_DB`), since a part that
  quiet is mostly a phone held far away and turning it up further mostly
  turns up the room. A part within half a decibel of −16, or a silent one,
  plays as it is (`levelModel.ts` `needsCopy`). The noise warning (181)
  now reads the room as the part plays (`roomAsPlayed`), with that cap.
- **Peaks held at −1 dB.** Turned up whole, a quiet part's loud syllables
  would clip. A limiter (`levelModel.ts` `limiter`) looks 5 ms ahead and
  bends the gain down before a peak, so no sample goes over −1 dBFS and the
  gain never steps, which would click; it comes back over 100 ms. Holding
  peaks down takes loudness with it (a reading with syllables 20 dB over
  its loudness came out 2.7 dB short), so the copy is measured as it is
  made and made again turned up by what it fell short, at most 3 times in
  all; that reading ends within 1 dB of −16.
- **Made on the device, the first time it plays.** Nothing is uploaded and
  no event is written: every device that plays a part makes its own copy,
  and the measure is kept by the hash of the audio, as 181 keeps it. A
  phone writes a 16-bit WAV to its cache (`levelCopy.ts`, at most 150 MB,
  oldest first; the phone may clear it, and a copy is made again when the
  part next plays). The web keeps a WAV blob in the page's memory (48 MB),
  since a browser's player cannot turn a sound up and Safari on an iPhone
  ignores its volume. While one part plays, the next one's copy is made.
  If a copy cannot be made, the recording itself plays.
- **The phones run it natively.** A phone's JavaScript is too slow for
  every sample of a part, so the meter and the limiter are ported line for
  line to Kotlin and Swift (`Level.kt`, `Level.swift`, in the microphone
  module); `test/levelModel.test.ts` holds the TypeScript, and both ports
  were checked against it on seven test recordings (44.1 and 48 kHz, quiet,
  loud, peaky, short and silent), the same samples to the bit. The module
  decodes AAC too, so phones now measure parts they did not record (181).
- **What plays at even loudness**: parts, voice notes and spoken feedback,
  wherever they play (`levelStore.ts` `playable`), and Clean up's previews
  and the parts heard while recording, as passing copies of which only the
  last four are kept. Source audio, reference material, Bible audio and
  help play as they are: they are mastered by whoever published them. A
  part streamed from the server plays as it is until it is on the device.
- The native code is new, so this ships in a store build, not an OTA
  update.
Reverse if: people hear the limiter (a pumping or a dulled voice), the
first play of a long part waits noticeably on the phones we support, or
partners want parts played as recorded (then a switch in settings, not a
button on each part).

Amended (2026-10-30, Caleb Koster): a part whose loudness stands less than
5 dB over its own room (`VOICELESS_DB`) is room alone, a silence kept as a
part (193) or a voice lost in the room, and plays as recorded: turned up by
up to 24 dB, it would play its hiss as loud as a voice. Room alone measured
3.5 dB at most (white, pink and brown noise, mains hum, a fan); speech 6 dB
over its room, 5.6 dB at least. `Level.kt` and `Level.swift` take the same
line from `LEVEL`, so this too ships in a store build.

## 183. Tutorial videos are filmed each night on GitHub, only those whose screens changed, and the job container brings them in

Date: 2026-10-28 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-28, thread "Plan tutorial videos and keep them
current") asked for the whole pipeline running and chose "GitHub films,
Cloudflare publishes": the filming runs where the local stack and a browser
are, with the Gemini key alone, and production's keys stay in production
(141, amended today).
- **Only what changed is filmed again.** Each night every video is tried
  without voice or film, one at a time, on a fresh local stack, and each
  step's screen is read out as text (Playwright's accessibility tree), once
  it stops changing and without the toast. With what changes from run to
  run though the app did not taken out (made-up addresses, sign-in keys,
  numbers, times, upload status, the order of names in a line and of
  things side by side: `e2e/tutorials/look.ts`), the steps hash to the
  video's look. A video is filmed again when its look differs from its last film's,
  or it has no film. A video that looks changed is tried again, up to twice,
  and is filmed when two tries agree on the new look or the third still
  differs. On 2026-10-28, two runs of all 47 English videos read the same for
  41 before the words were read once steady, without the toast, with things
  side by side sorted and after a projection pass; with them, 46 of 47 read
  the same, and the 47th ("Record a passage") read as before on the next two
  tries. The same day, on main with Clean up, seven videos looked changed
  (the ⋯ menu that replaced a bin), and two of them read differently on a
  second try: a part still saving, and a passage heard a moment earlier
  kept on the device or not yet. Since then a step is read once nothing on
  it is saving, and the app's words about saving, uploading and keeping on
  the device are taken out in the film's language (from its catalog); all
  seven then read the same. Videos for LangQuest staff (the Global Viewer's) are never filmed
  each night or put on YouTube: the channels are for the public (Caleb,
  2026-10-28).
- **The release is the hand-over.** The repository is public, so its
  `tutorials` release (a pre-release, never the latest) holds each video's
  newest film in each language, named by its hash; a manifest per language
  with what YouTube shows (the title, the lines said as the description,
  the playlist of who it is for: `e2e/tutorials/playlists.ts`) and each
  film's look; and each language's voice, so a line is paid for once. New
  films go up before the manifest that names them, older ones come out
  after (`e2e/tutorials/put-in-release.ts`).
- **Each description links to the same video in every other language**
  it is made in (Caleb, 2026-10-28), by a link to the app's Worker,
  `next.langquest.org/v/<language>/<video>`, which goes on to that video's
  newest version on YouTube, or to the language's channel while none is up
  (`ops_tutorial_watch`). A replaced version never leaves stale links
  behind, and no description is edited after upload, which would cost 50
  of YouTube's 10,000 daily units for each of up to 690 videos.
- **The intake job brings them in** (`server/tutorialIntake.ts`, the job
  container at 13:10 UTC): each film R2 lacks is downloaded, its hash
  checked, put through the Worker's service-only `PUT /api/tutorials/…`,
  which R2 checks again, and listed (`ops_tutorial_made`). The dashboard
  shows it for Publish (180); nothing filmed goes public without a person.
- **English each night to begin with** (`NIGHTLY_LANGUAGES`); a language
  joins once its voice can be made (Gemini's batch voice needs the paid
  tier). The Gemini key reaches GitHub through `npm run secrets --
  production`, from `.env.production`. Each language's job files a failure
  in Linear, as the guardrails nightly jobs do.
Reverse if: the look misses changes people notice in the films, or flags
changes nobody can see often enough to burden Publish; or the runners
cannot film reliably (then the job container gets a browser and the stack).

Amended (2026-10-29, Caleb Koster): the tutorial runs moved to the hour when
the fewest people on earth are at work, as Caleb asked: many of the people
who use the app are in Nepal, Nigeria, Thailand and India. By population
and time zone, 23:00 to 00:00 UTC has about 100 million people in working
hours (9 to 5) out of 7 billion: the Americas' west in the afternoon and
Australia's morning (India 4:30 AM, Nepal 4:45 AM, Thailand 6 AM, Nigeria
midnight). The publish run at 08:10 UTC had had about 5.9 billion, and the
intake at 13:10 UTC about 2.3 billion. The intake now
runs at 23:10 UTC and the publish job's daily run (180) at 23:40 UTC, on
YouTube's allowance for that Pacific day; the filming, on GitHub's machines
and touching nothing live, starts at 20:10 UTC so a night's films are in the
release by the intake. Every app language is now filmed each night, English
and French first (Caleb, 2026-10-29: every language is checked for changes
and the changed videos are filmed on the same night), since the Gemini key
is on Tier 1, which the batch voice needs. Five languages film at a time,
each about 50 minutes on a night without new films, so all fifteen finish
before the intake. A first night for a language, which films every video,
can finish after the intake; its films then come in the next day. So that
a line no one has translated yet (a script's new line, or what Ruth says in
the readings, which no language had) never stops a language, the job has
Gemini translate it first (`translate-lines.ts`, the same machine
translation as the committed lines, decision 81) and keeps the file to
commit. A change to the scripts or to how they are filmed is filmed when it
is merged into main, rather than at the next 20:10: a fix to the filming
should not wait a day, or for a person to press Run workflow, since the
agents that work on the videos cannot start or re-run a workflow.

Amended (2026-10-30, Caleb Koster): the intake no longer waits for 23:10
UTC: the filming tells the app when each language's films are in, and the
intake runs then, with the publish after it; the one scheduled intake is at
five past midnight in California, as YouTube's day begins (192).

## 184. The publish job keeps each YouTube channel's description, banner and list of the others; held comments are counted on the dashboard and moderated in Studio

Date: 2026-10-28 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-28, thread "Plan tutorial videos and keep them
current") asked that each channel be set up in its own language, with its
own look, a description and links to the other language channels, and that
inappropriate comments be held for review.
- **The publish job sets each channel's look** (180, `server/youtube.ts`
  `brandChannel`): a description in the channel's language with the app's
  address (`WORDS`, machine translations as the app's catalogs are, 81),
  the channel's language, a banner with the app's mark and "Tutorial
  videos" in that language (`apps/mobile/public/youtube`, drawn by
  `e2e/tutorials/banners.ts`), and the list of the other 14 channels. The
  channel's other settings are sent back as they were. It runs before any
  upload, only for a channel whose hash of all of these (`brandOf`)
  differs from the one last put on it, so it costs about 150 of the day's
  10,000 units once, and again only when the words or a banner change.
  The picture is the one thing YouTube's API cannot set; it is set by hand
  in Studio (`docs/admin.md`).
- **Held comments are counted, not moderated, on the dashboard.** Each
  channel holds comments that may be inappropriate (a Studio setting, set
  by hand). The publish job counts each channel's held comments once a day
  (up to 500), and the dashboard shows each count linked to that channel's
  comments in Studio, with a line in Needs attention when any wait.
  Approving and removing stay in Studio, as moderating stays out of the
  dashboard (162).
Reverse if: YouTube's API stops taking a channel's description, language
or banner; or held comments come often enough that going through Studio
channel by channel is a burden (then the dashboard approves and removes).

Amended (2026-10-29, Caleb Koster): YouTube refused Hausa's look
(`brandingValidationError`) with its language and again without it, and
kept only that code, so nobody could see why. A refused look now goes on
without the channel's own settings as well (its keywords and country, sent
back unchanged until now and cleared then), keeping only the description and
the trailer; one still refused keeps the field YouTube named beside the code
(`ops.youtube_channels.brand_failed`), never YouTube's message.

## 185. The UI audit's fixes: a screen says what it waits for, asks before what cannot be undone, and opens a thing where the same thing opens elsewhere

Date: 2026-10-28 · By: Caleb Koster · Status: accepted

Reason: a UI audit of the app (127 findings, each reproduced on the web
export and judged) found screens that said untrue things, did something
other than what they showed, or threw work away without asking. Caleb
(2026-10-28): "Please fix all of these issues." Most fixes follow rules
already recorded (one name per thing, 138; status indicators tell the
truth; touch targets; no explanatory text, as help on each element); the
ones below change what a screen does, beyond the partner demo or an
earlier entry, and are kept on purpose:
- **Asking before what cannot be undone.** Delete Account's big button is
  Cancel; "Delete My Account" is a red ghost button that asks once more by
  name (`public/delete-account.html` says so). The Inbox's report sheet
  leads with opening what was reported (the version, the review or the
  passage), and Remove is a red ghost button after it. Looks good asks
  before sending words that asked for changes. New language's ✕ and the
  sign-in code page ask before leaving (137 amended).
- **The same thing opens the same way.** An Inbox request for a check
  opens the check, as My Work's row does (`work/homeModel.ts`
  `updateTarget`; flow edges from the Inbox to review and back
  translation). A request done or withdrawn leaves the Inbox and the bell,
  on the phone and in the server's Inbox rows (core `settledUpdate`,
  `server/projectionWorker.ts`). "New in ‹language›" and a language chip on
  the Map say that they switch the whole app, and a toast says "Now in
  ‹language›". Someone with a manage role in one language gets that
  language's map from the Map tab, not a Progress list of one.
- **Saying what it waits for.** My Work says when the language is not on
  this phone yet or has no passages, instead of "Nothing is waiting on
  you". The path draws a check set aside and a checkpoint moved past (with
  its reason) apart from one that passed, and a step behind a locked
  checkpoint waits for it. Asking someone without the app saves the
  request and then offers their message to send yourself, since the app
  sends nothing. Signing out with work waiting shows it sending and opens
  Sync to see what waits. One "waiting to send" number everywhere. A failed
  password change keeps the renamed name and says so.
- **Notifications are a switch** that turns off as well as on, and when the
  phone's settings block them it says so and offers the phone's settings.
- **The sync icon has a glyph per standing** (tick, plain, crossed out,
  warning, down arrow for too old), not colour alone.
- **Finding a passage.** A book lists 25 passages at a time with Show
  more; Filter is in the book's header and the key sits above the chapter
  tiles; on a phone the sub-line names the language; with a filter on,
  chapters outside it are grey and open a sheet instead of a passage; each
  testament's chip counts its matches, and the map opens on the one that
  has them. "Divide differently" opens the chooser at once and is offered
  only to those who may write the organization's library (as MAP-023).
- **Help mode.** On the web, Listen shows only when the browser has a voice
  for the app's language (`helpContext.ts` `voiceFor`), and the tooltip
  tells a screen reader that a tap closes it. Fields and primary buttons
  with the kit's stock help get their own words; a ratchet in
  `test/helpMode.test.ts` holds the count still left (96) and lets it only
  fall.
Not done here: finding 92 (removed content leaves a trace for its author
and in History) needs new state in core and a reducer version; finding 8
and 107 (help and questions spoken on phones) wait on Caleb's choice.
Reverse if: people find the extra asks slow on work they do every day, or
partners expect the demo's flow where it differs here.

## 186. Claude looks each night at what came in about the tutorial videos and suggests changes; a person accepts, edits or rejects each on the ops dashboard

Date: 2026-10-29 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-29, thread "Plan tutorial videos and keep them
current") asked for an AI such as Claude to weigh, for each video, every
input not yet answered (comments on YouTube, code changes, notes the team
leaves on the ops dashboard) and suggest changes to its screens, script or
voice, to the app's code (to Linear), or a new video, with the inputs and
suggestions on the dashboard for a developer to accept, edit or reject. He
chose GitHub Actions signed in to his Claude plan over a routine in his own
account, so the system is in the open for the team: any developer can see
it, and replace the token with their own plan's if his has trouble. Decided:
- **Inputs and suggestions are rows in `ops`** (migration
  `20261029120000_tutorial_feedback.sql`): `ops.tutorial_inputs` (a
  comment, a code change or a note), `ops.tutorial_suggestions` (script,
  screen, voice, code or new) with the inputs each answers, and one
  `ops.tutorial_reviews` row per look. Only the service role writes them;
  the dashboard reads `diag.ops_tutorial_feedback`. An input is open until
  Claude looks at it, or while a suggestion that answers it waits.
  Inputs and answered suggestions over a year old are taken out.
- **The comments job only reads** (`server/tutorialComments.ts`, job
  container, 23:50 UTC): each connected channel's new comments become
  inputs. Making sense of them is the look's. It also files in Linear the
  accepted code changes the Worker could not, 20 a night at most.
- **The look runs on GitHub Actions on a Claude plan**
  (`.github/workflows/tutorial-review.yml`, 10:00 UTC):
  `anthropics/claude-code-action` with `CLAUDE_CODE_OAUTH_TOKEN` from
  `claude setup-token`, kept encrypted in `.env.production` and set as a
  repository secret by `npm run secrets`. It uses the plan's five-hour and
  weekly limits, not an API bill; Caleb chose no cap, as he does not use
  the plan at that hour. Claude follows the `tutorial-review` skill.
- **No production key in GitHub.** The workflow reads what is open and
  sends its look through the app Worker (`/api/tutorial-review`), which
  lets in only this workflow on main by the OpenID Connect token GitHub
  signs for the job: issuer, audience, repository, `workflow_ref` and `ref`
  checked against GitHub's keys (`apps/web/worker/githubOidc.ts`). No
  shared secret to leak or rotate.
- **Comments are untrusted.** Anyone can write one, so Claude gets no
  network, no token and no shell beyond reading git; its one output is a
  file the Worker checks (`parseReview`, `server/tutorialFeedback.ts`) and
  the database checks again; and nothing it suggests happens without a
  person. The replies it writes are shown to copy into Studio, never posted.
- **Code changes come in through the look**, from the changes merged into
  main since the last one, and only where a video's words or steps no
  longer fit; a screen that only looks different is filmed again by the
  nightly filming (183).
- **The dashboard decides** (Tutorial videos → Feedback and suggestions;
  162 amended): Accept, Edit, or Reject with why, which the next look reads
  before suggesting the same again; Add a note. An accepted code change
  becomes a Linear issue.
- **Not yet:** making an accepted script, screen, voice or new-video change
  is by hand. Building it as a pull request with a preview film is a later
  change.
Reverse if: the looks eat into the plan's limits when people need them;
more suggestions are rejected than accepted for weeks (then keep the
inputs and drop the suggestions); or GitHub changes what its OIDC tokens
say.

## 187. Every tutorial video can be downloaded from LangQuest, by a link that lasts and from a page of them all; YouTube's descriptions give both

Date: 2026-10-29 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-29, thread "Plan tutorial videos and keep them
current") asked that every video be available to download from LangQuest,
with download links to LangQuest on the videos on YouTube, kept up to date
along with the videos. The pipeline plan had promised it (real downloads and
links that never break), and nothing had been built. YouTube offers no file
to keep: its offline download works in about 125 countries, stays inside the
YouTube app and needs it to reconnect every 48 hours, and some countries
block YouTube. Decided:
- **A lasting download link per video and language**:
  `next.langquest.org/v/<language>/<video>.mp4`
  (`apps/web/worker/tutorialVideos.ts` `handleDownload`) goes on to the
  newest version a person chose with Publish (`ops_tutorial_download`), as a
  file to keep (`?download` on the R2 file, named
  `langquest-<video>-<language>.mp4`). While none is chosen, or when the
  database cannot say, it opens the language's videos page. Like the watch
  links (decision 183) it is asked about at most every five minutes.
- **The chosen version, not the uploaded one**: Publish is the person's
  choice (decision 180); a download follows it at once instead of waiting for
  YouTube's 100 uploads a day, which takes a week for the first full set. A
  new version can be downloaded before YouTube has it.
- **A page of them all**: `next.langquest.org/videos`
  (`apps/web/worker/videosPage.ts`, `ops_tutorial_list`) in the reader's
  language (`?lang=`, else the browser's), grouped by who each video is for,
  each with Download and its size, Play (the file in the phone's own player,
  so no YouTube is needed) and Watch on YouTube once a version is up. Written
  by the Worker like the review and connect pages, its words in the 15
  catalogs of `apps/web/worker/i18n/`; cached five minutes.
- **YouTube gives both**: each video's description has a download line under
  the app's address (`e2e/tutorials/playlists.ts` `youtubeText`), and each
  channel's description links the page (`server/youtube.ts` `channelAbout`),
  in the channel's language (`WORDS.download`, `WORDS.allVideos`). A
  description is set when a version is uploaded and never changes after, so
  the link had to be one that outlives versions. Changing the channel's
  description changes its look, and the publish job puts it on each channel
  once.
- **Nothing in the app changes**: the help mode play button and Me's videos
  from the pipeline plan are a later change, with the store answers it
  needs.
Reverse if: R2's egress stops being free and downloads cost more than they
help; or the videos move to a host that gives lasting files itself.

## 188. The access-token API gives the server's time of arrival as `uploadedAt`, read from the database's own stamp on each event and file, and LangQuest v2's as `v2UploadedAt`

Date: 2026-10-29 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-29, thread "Give partners server upload times via
API") said partners need the time LangQuest's server received the content
and the recording files, through the API. Every time the API gave was a
phone's clock (`submittedAt`, a review's `at`, `askedAt`, `updatedAt`), so a
phone that was offline for a week showed last week. The server already had
the times: the database stamps every event as it is appended
(`public.events.received_at`, default `now()`, never overwritten, and the
log refuses UPDATE), and every stored file has a `v1.BlobStored` that only
the server appends, on its own clock (69). Nothing needed backfilling: both
hold for everything since the databases were reset (63). Decided:
- **`uploadedAt` beside the phone's time** on `version` and `versions`
  (the first publish of the take to arrive), `reviews`, `requests` and
  `releases`, from `received_times` (migration
  `20261029160000_received_times.sql`, service role only). It reads one
  stream's rows through the indexes the log has: `events_type_idx` for a
  take's `v1.TakeSubmitted`, `events_entity_idx` for a review or request,
  the id for a release. No index is added, since one would lock the log
  while it builds (161).
- **A file's `uploadedAt`** on `audio`, `approvedAudio` and a review's
  `voiceNotes` is its `v1.BlobStored`, already in the language's records,
  so files cost no lookup. It is null while the server holds no good copy,
  which is honest about a version published before its parts finished
  uploading.
- **Asked once a page and remembered.** `apps/web/worker/agent/view.ts`
  builds each item with `uploadedAt: null` and stamps the page with one
  question (`Receipts`). The organization's object keeps the answers
  (`RECEIPTS_KEPT` in `agent/org.ts`): a stamp never changes, so a partner
  reading the same passages again costs the database nothing. A failed
  lookup fails a read (502, try again) rather than answer null, and a
  write's read-back answers `passage: null` rather than an error a client
  would retry.
- **Not in core.** The stamp stays out of the fold: a phone's pending
  event has none, and one event carrying two values would break the
  fold's idempotence and order-independence (PLAN.md section 4).
- **v2's own server time too, as `v2UploadedAt`.** Caleb, the same day:
  "the time that content was uploaded to the v2 db shouldn't be lost, but
  we should also capture when info was brought into next ... This is for
  billing purposes so the partners know how much to pay their
  translators." For work the import brought over, `uploadedAt` is when
  the import appended it, and v2's `created_at`, which becomes
  `submittedAt`, is a phone's. v2's server stamped each segment and vote
  as it arrived (`uploaded_at`) and each segment's audio
  (`audio_uploaded_at`). The import keeps those stamps in
  `v2_import.stamps`, by language and by the key the API asks, before it
  appends the events they are about, and again when they change
  (`Fact.stamps` and the ledger's `stamped` in
  `packages/v2-import/src/reconcile.ts`). The first whole read after this
  merges (03:15 UTC) keeps them for work that came over before. They stay
  beside the log, not in it: they are v2's record, not something anyone
  did here, and a pass may correct one. Retiring the import, which drops
  the `v2_import` schema (94), must keep this table. The API gives `v2UploadedAt` on a file (when v2
  had its audio), a review (its newest vote's stamp) and a version (the
  newest stamp on its parts' segments and audio: when v2 had all of it),
  and null for work made in Next or where v2 has no stamp. The Worker asks
  for them only for work the import made (its clock names the import's
  device) and asks again after a while for one not kept yet
  (`V2_RECHECK_MS` in `agent/org.ts`).
Rejected: R2's own object dates, since an upload is an idempotent overwrite
(a phone's retry moves it) and the copy into R2 on 2026-10-07 reset them;
a `receivedSince` filter on the passage list, which the change feed (101)
already answers in the order LangQuest received things; and v2's stamps in
the log as a new event type, which every phone would fold for a value only
partners read.
Reverse if: a language's `v1.TakeSubmitted` scan shows in the database's
statement times (then a partial index on the take id, built concurrently);
or partners need the stamp in the change feed or webhooks too.

## 189. Each YouTube channel's trailer is a 48-second film of today's app in its language, made each night when it changes, and the publish job sets it

Date: 2026-10-29 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-29, thread "Plan tutorial videos and keep them
current") asked for the team film "From the ground up" to be made again with
today's screens, in each app language, as each channel's landing video, and
for its count to say over a million. Decided:
- **Made from the app, as the videos are** (`e2e/tutorials/trailer/`): a
  capture opens the app in the film's language as the UI tests do and keeps
  Chrome's screencast frames with when each moment starts and where its parts
  are; a page draws every frame from the time alone, on the original's
  timeline and score, cropping those frames into cards; Chromium renders it,
  four moments to a frame for motion blur. No editor and no hand-made screens,
  so the film stays true as the app changes, and the fifteen languages are
  one script.
- **Its own words** (`words.json`): nineteen lines in the fifteen app
  languages. The count is a round number passed, "1,000,000+" as of
  2026-10-29 (`CLIPS`, `AS_OF` in `trailer.ts`).
- **Made again only when it changed** (decision 183): its look is the words
  of the seven screens it shows, made steady by `look.ts`, with its page,
  renderer, capture, score and words; a new look is captured again and made
  when it holds. It goes into the release and the manifest as the video
  `trailer`, so the intake, Publish, the downloads and the links to the other
  languages take it as they take a video.
- **The channel's trailer**: once it is up, the publish job puts it first in
  the playlist for everyone and sets it as the trailer for people who have
  not subscribed (`brandingSettings.channel.unsubscribedTrailer`,
  `server/youtube.ts` `brandChannel`), keeping the channel's other settings.
  A channel's look (decision 184) includes its trailer once one is up
  (`ops_youtube_channels` says which video the newest became), so a trailer
  that could not be set at once is set on the next run. It goes up without YouTube's "altered or synthetic" label, which the videos
  carry for their made voices: the trailer has no voice, only the score and
  the app's own screens.
- **The original's score** (`score.m4a`, 48 seconds, copied without
  encoding it again): the film's timing is built on its beats.
Reverse if: YouTube drops channel trailers or the API's setting for them; or
the trailer's look changes most nights without the app changing, which would
spend a channel's uploads.

## 190. A workflow says what only a person can fix in an annotation titled "Needs you", and the ops dashboard lists it under Needs attention

Date: 2026-10-29 · By: Caleb Koster · Status: accepted

Reason: on 2026-10-29 Gemini's prepaid credit ran out partway through the
first filming of the tutorial videos in all fifteen languages. The ops
dashboard said only that the "tutorials" workflow failed, and Caleb found out
from Claude hours later. He asked (thread "Plan tutorial videos and keep them
current") that a problem like the Gemini billing account, or the Claude token
missing, show on the ops dashboard. Decided:
- **The workflow names the problem**: a script that gets a refusal only a
  person can fix writes it down (`e2e/tutorials/needs-you.mjs`: Gemini's 402
  or "prepayment credits are depleted", a key refused or missing), and the
  job's last step says each once as an error annotation titled "Needs you:
  <what>", its message ending with the page that fixes it.
  `tutorial-review.yml` does the same for a Claude token that is missing, or
  that Claude's own answer says was refused. A refusal is said only when the
  answer says it; anything else stays a plain failure.
- **The dashboard reads it from GitHub** (`apps/admin/src/sources/github.ts`):
  for the latest failed run of each workflow on `main`, the annotations of
  its first three failed jobs (every tutorials job says the same account's
  problem). Each "Needs you" is a problem under Needs attention, with an Open
  link, in place of the plain "failed" line. The next run that works takes
  it away. Only the repository's own runs are read (a push, a schedule, a run
  by hand): a pull request from a fork can name its branch `main`, and its
  words never reach staff.
Rejected: a table and an endpoint the workflow reports to with GitHub's OIDC
token (as `tutorial-review.yml` sends its look), since the run already holds
the words and its failure, and a second store could disagree with GitHub's;
Linear issues alone, since the nightly report files a failure, not its
cause; reading the jobs' logs, which are large and unstructured.
Reverse if: GitHub stops keeping annotations, or a problem needs to show
while the run that met it is not the latest.

## 191. Tutorial videos are wide (16:9), never Shorts; a description says what the video shows in one line, then its links; each channel's home page has a row of the other channels and one for each playlist

Date: 2026-10-30 · By: Caleb Koster · Status: accepted

Reason: on 2026-10-29 Caleb found the channels' video descriptions a mess
(the voice written out line by line, no space between the links), their
links not clickable, and a channel's page showing a single video and no
way to the other languages. The cause was the films' shape: a phone's
video was filmed on a tall 1080x1920 page, and YouTube makes any tall video
under three minutes a Short. 44 of the English channel's 45 videos were
Shorts: links in a Short's description are never clickable (since
2023-08-31), Shorts are listed on their own tab, and the channel's Videos
tab held only the one wide film (See reports on the web). Decided:
- **Every film is wide** (`e2e/tutorials/compose.ts`): the phone on the
  right of a 1920x1080 page, the app's mark and the video's title on the
  left; a film of the web stays in its window under the title. Wide videos
  are listed as videos, keep their links, and can be a channel's rows and
  trailer.
- **A description is read at a glance** (`e2e/tutorials/playlists.ts`
  `youtubeText`): the first sentence the voice says ("Here's how to record
  a passage."), then, each group apart: the download link, the page of
  every video and the app; then the same video in each other language.
  Never the voice line by line.
- **Every film is made again once** (`FRAME` in the release's manifest):
  a film without it is filmed again whatever its look, so the first night
  after the merge films every video in every language, and each new version
  replaces its Short as Publish puts it up. Only a video's newest version
  goes up (`ops_tutorials_due`, migration `*_tutorial_newest_due.sql`): a
  tall version chosen before is not put up once a wide one is made.
- **A channel's home page** (`server/youtube.ts` `setHome`), as BibleProject
  and others lay theirs out: under the trailer, a row of the other 14
  LangQuest channels, then a row for each of its playlists, everyone's
  first (`server/youtubePlaylists.ts` `HOME_ORDER`). The publish job
  brings the rows up to date each run (2 of the day's 10,000 units when
  nothing changed); Connect lays them out at once.
What stays: a description's links are clickable only on a channel with
YouTube's advanced features (support.google.com/youtube/answer/9890437),
English and French on this date; the links under a channel's name can only
be set in YouTube Studio, not through the API.
Rejected: keeping tall films over three minutes (most videos are shorter,
and padding them wastes people's time); filming each video twice, tall for
Shorts and wide for the channel (twice the uploads, against YouTube's 100 a
day, and a Short still cannot link anywhere); a channel's own links in its
description in place of the channels row (YouTube shows a description
cut to one line).
Reverse if: YouTube lets a Short's description link out, or people watch
the videos mostly on phones held upright and ask for tall ones.

## 192. Tutorial videos go up as soon as they are filmed: the filming tells the app, the intake chooses the wide films itself, and the publish follows each intake

Date: 2026-10-30 · By: Caleb Koster · Status: accepted

Reason: on 2026-10-30 Caleb saw the ops dashboard waiting for him to tick
the new videos before they went up, and asked: "I want everything,
including the updated YouTube pages, published as soon as everything is
ready. We won't wait for a scheduled time". Until now a night's films
waited for the intake at 23:10 UTC, then for a person's Publish (180), then
for the publish run at 23:40 UTC (183, amended): up to a day behind the
filming, and never without a person. Decided:
- **The filming says when its films are in.** Each language's job in
  `tutorials.yml`, once its new films are in the release, posts to the
  app Worker's `/api/tutorial-filmed` (`e2e/tutorials/films-in.mjs`,
  `apps/web/worker/tutorialFilmed.ts`), which starts the intake. Only that
  workflow, run from main, gets in, with the OIDC token GitHub gives the
  job, as for the nightly look (186): the workflow still holds no key to
  production. The first job of each run says it too, for films a run
  before it put in without saying (one cut off, or one from before this).
  An intake already running takes the films in once more when it ends.
- **The intake chooses the wide films itself** (`ops_tutorial_made`
  `p_choose`, migration `*_tutorial_choose_on_intake.sql`): a film made
  wide (191) is chosen for YouTube as it is listed, with a time and nobody's
  name, so no Publish is needed. A tall film left from before, whose refilm
  failed, would go up as a Short, so it still waits for a person's Publish,
  which stays on the dashboard for that and for putting one up again.
- **The publish follows each intake** (`AFTER` in
  `apps/web/worker/jobsModel.ts`); if it is running, it runs once more when
  it ends. A run that makes a playlist gives it its row on the channel's
  home page at the end of the same run, not the next.
- **One scheduled time, as YouTube's day begins**: an intake at five past
  midnight in California (07:05 UTC in summer time, 08:05 in winter), with
  the publish after it, takes in what the filming could not say and puts
  up what the day before had no room for. The intake at 23:10 UTC and the
  publish at 23:40 UTC are gone. The filming keeps its 20:10 UTC start.
What stays: YouTube's limits (180, amended): 100 uploads a day for the
project and a lower limit for each new channel, so replacing every video
in every language still takes over a week; the publish goes on with the
rest each day.
Rejected: choosing every film, tall ones too (a tall one goes up as a
Short, whose links cannot be clicked, 191); an intake every hour in place of
the filming saying so (most runs would find nothing, and each publish after
it spends units looking at every channel); keeping the intake and the publish
at 23:00 to 00:00 UTC (183, amended): Caleb asked for no scheduled time,
and that hour delayed a night's films by up to a day.
Reverse if: films go up that should not have (then the intake stops
choosing and Publish is the way again), or the publish runs after each
language spend so much of YouTube's day on looking at the channels that
videos wait for it.

Amended (2026-10-30, Caleb Koster): a tick from before this went live no
longer puts a video up (migration `*_tutorial_old_ticks.sql`). Caleb's
Publish of 2026-10-29 chose tall films; where a video's wide film did not
come out that night (some Spanish ones), its tall one was still chosen and
newest, so the publish would have put it up as a Short. Such a choice now
counts as none: the job skips it, the dashboard lists the video as not
chosen, and a person's Publish can choose it again. No row is changed.

## 193. A switch beside the red button boxes the silence between parts too, and leaving the session keeps each silence as a part of its own

Date: 2026-10-30 · By: Caleb Koster · Status: accepted

Reason: Caleb asked (2026-10-30, thread "Show silence as segments while
recording") for a switch in the red recording view that also captures the
silence between speech as parts of its own, boxed while it is on and not
while it is off, and plain to tell apart from speech once the parts are in
the list. He chose the design from five mockups ("Go").
- **The switch** sits in the footer right of the big red button while a
  session is open, where Done is once it is left (`silenceSwitch.tsx`): a
  picture of speech bars either side of a flat line in a dashed box, and a
  switch, with no words (help mode explains it). The phone keeps it
  (`silenceSetting.ts`, `recording:silence-parts:v1`), and it can be
  flipped at any time in a session, recording or stopped.
- **A silence's box** is dashed, its number in an outlined pill, and it takes
  a part's number in passage order, so the speech after it is numbered on
  (`livePartsModel.ts` `liveSilences`, `liveNumbered`). While recording,
  the silence after the last part grows until the next is said. Stopped, a
  tap plays it; it has no edges or × of its own, since it always fills the
  room between the two parts beside it: it follows their edges, and goes
  when either is dropped. Leaving the session cuts it from the chunk like a
  part (`liveKept`) and it goes into the list as an ordinary part, its bars
  read from its file, so they lie flat.
- **Only silence kept whole is boxed**: two parts said one after the other
  in one chunk, with no stop between them, side by side in the passage, and
  half a second apart at least (`MIN_SILENCE_MS`, the least the room is
  read in). Not the room before the first part or after the last. While the
  switch is on the microphone module keeps the chunk open through every
  pause (`chunks.ts` `keepRoom`, amending 129), so every pause in a stretch
  is on storage; a gap from before the switch was turned on, spread over two
  chunks, is not boxed rather than boxed with its middle missing.
- **A silence plays as recorded**, never turned up to −16 LUFS (182,
  amended): a part that is only room is not given its loudness. So it shows
  no noise warning (181) unless the room itself is loud.
- Storage and memory: with the switch on, a phone writes the whole stretch
  (about 5 MB a minute as a WAV, as 129 says of speech) until the session is
  left, and the web holds it in the page, about 11 MB a minute, until a stop.
- A silence has no journal entry while the session is open, so a phone
  that crashes mid-session gets its speech parts back (129) but not the
  silences between them.
- The chunk change and the loudness line are native, so this ships in a
  store build, not an OTA update.
Rejected: a silence with handles of its own (two edges to drag where one
part's end and the next's start already are); boxing the room before the
first part and after the last (it is not between anything); keeping only
the 2 s of room on each side of speech that chunks already kept (a pause
over 4 s would lose its middle).
Reverse if: people turn it on and lose track of which parts are speech, the
whole stretch fills a low-end phone's storage or the web's memory in long
sessions, or a recording with a voice in it is played unboosted as room.
