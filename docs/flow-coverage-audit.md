# Flow coverage audit and gap architecture

Date: 2026-09-14. Sources: `ng-langquest-ux` at HEAD (`src/flow.ts`,
`src/data.ts`, `src/domain/session.ts`, `src/imports/*.flow.md`,
`src/imports/README.md` Q1–Q30 and A1–A43), this repo at commit `1236f07`
plus the uncommitted step 5 work, and LangQuest v2 (`template_structure`,
`constants/templates.ts`, the clone and stage-gating migrations).

This document answers four questions. Has every flow been captured, and how
is that proved? Which flows are not solved yet? What becomes a liability
after weeks with little or no connection? And what architecture closes each
gap without adding cleverness. Where the answer is code, it is in this change
and named; where it is design, it is written so the next change can build it.

## 1. What "captured" means, and what is now proved

"Captured" has three layers. Each is a different kind of proof, and the app
now carries a test for the first two and a derivation for the third.

| Layer | Question | Proof | Status |
| --- | --- | --- | --- |
| Structure | Does every spec screen and transition exist here, with the spec's nav mode? | `apps/mobile/test/specParity.test.ts` against `spec-flow.json`, vendored from the spec's `flow.ts` by `scripts/extractSpecFlow.ts` | 55 of 55 screens, 101 of 101 machine edges (spec edges with mode `back` are Back-button documentation, not machine edges); 6 app-only edges logged with reasons |
| Permission | Can each role take only the affordances the spec gates for it, and can every gate be satisfied by some role? | 30 spec gates ported into `apps/mobile/src/flow.ts`; `edgeAllowed` in `session.ts`; `go()` refuses gated edges; the parity test checks no gate is dead | 1 known dead gate: `home_hub → language_home` (gap G2) |
| Liveness | From every reachable state, can the work actually finish? | `deriveBlockers` in `packages/core/src/blockers.ts` | Four blocker kinds derived from the fold; see section 3 |

What the structural proof found that eyeballing did not:

- The spec's own two sources disagree. `org-setup.flow.md` declares
  `project_open_status` and `language_open_status` (A40: "Open Status row")
  and `review_groups_open_flow`; the spec's `flow.ts`, which the spec calls
  its single authority, has none of them. The app follows the markdown here
  and the parity test logs the three edges as app-only. The spec should add
  them to `flow.ts` or drop them from the markdown.
- `review_groups` (markdown) and `review_teams` (`flow.ts`) are the same
  screen under two names. `flows_home → flow_editor` exists in the app and
  in `org-config.flow.md`'s title ("Edit stages") but the markdown says the
  editor opens only from review groups. One of the two is wrong.
- The spec's `flow.ts` has no gate on `status_home → give_assignment`'s
  companion `piece_status → piece_assign` for viewers of a completed piece
  (markdown: "admin and piece not complete"). Piece completeness is state,
  not role, so it cannot be a gate; it must be a screen rule. Recorded so it
  is not mistaken for coverage.

What is still unproved, and how to prove it next:

- **Screen contracts.** Nothing yet checks that a screen's main action emits
  an event the server would accept for that role. Proof: each screen file
  exports `{ emits: EventType[], reads: DeriveFn[] }`; a test folds the
  fixture, walks every persona through every allowed edge, and asserts each
  `emits` entry passes `role_may_emit` mirrored into core. This is the test
  that would have caught a translator screen offering an assign button.
- **Model-based walk.** Random walks over the flow machine while emitting the
  screen's events against the reducer, with random online/offline toggles and
  a second device, asserting convergence (already property-tested) and that
  no blocker appears unless a member was removed. Cheap to add once screen
  contracts exist.

## 2. Coverage results in numbers

| Item | Spec | App | Note |
| --- | --- | --- | --- |
| Screens | 55 | 55 | identical sets |
| Edges (all) | 123 | 133 | |
| Machine edges (mode ≠ back) | 101 | 107 | 6 app-only, listed in the parity test |
| Gated edges | 32 | 30 | the 2 missing are `back`-mode documentation edges |
| Homes reachable by some role | 6 | 5 | `language_home` unreachable (G2) |
| Screens whose main action emits an event | — | 14 of 55 | the rest render, or write local state only (section 3) |

## 3. Flows not solved yet

Ordered by how much of the product they block. Each names the smallest
architecture that solves it (section 5).

**G1. Nobody outside a project can write anything.** `append_events`
refuses non-members, `pull_events` refuses non-members of a populated
partition. So `request_access`, `invite_member`, `invite_qr`, `scan_qr`,
`create_account` with an invite, and guest `explore_home` have no server
path at all. Today the invite screen adds a member by a typed id, which only
works because the coordinator is already inside. Solve with the request and
invite channel (5.B) and the public projection (5.B).

**G2. Scope and roles.** The spec's model is roles with privilege switches
(A38: Manage Content Templates, Assign Work, Translate, Review, …), scope
chosen per member (org, project, language), catalogs enabled per level (A42).
The app has five fixed roles, per project. Consequences: no language admin
(the dead gate), no custom roles, no org-wide viewer, no per-language member
lists, and the gate mapping in `edgeAllowed` collapses eight privileges onto
`isAdmin`. Solve with the org partition and privilege roles (5.A, 5.C).

**G3. Catalog templating is per project and whole-document.** Content
templates, reference library kinds and review flows are system catalogs
enabled at org, narrowed at project, and selected one-per-language (A42). The
app has a per-project `ProjectConfig` set by one register. Two admins editing
the workflow offline clobber each other with only a stale warning
(`parentEventId`). No org level exists to enable anything at. Solve with the
catalog bundle and deterministic instantiation (5.D) and per-step registers
(5.F).

**G4. Reference material has no template, no fields, no lock, no lane
scope.** `ReferenceAttached` is one text-or-blob on one unit. The spec's
`material_editor` fills blanks in a material that may live at org, project or
language level, may be linked to a template passage or to a review stage, and
may be locked (A7: restricted edit, not hidden). Question sets are reference
material of kind `questions` and the stage-linked set is the default a
reviewer answers. Key terms are a living glossary with renderings, recorded
adjustments (text or audio) tied to the translation they happened during, and
links from a submitted version to the terms it relied on. Today key terms are
one text blob per unit. Solve with the material model and the key-term events
(5.E).

**G5. Review teams are per-unit assignments.** The spec groups a language's
reviewers into named teams tied to stages; the app simulates a team by
appending one `AssignmentMade` per unit per member (bulk assign on 1,200
pericopes for 6 reviewers is 7,200 events from one tap). Solve with team
events and a three-level eligibility rule (5.F).

**G6. Inbox and notifications are not designed.** The inbox derives from
"events addressed to the actor" but no derivation exists, join requests need
an inbox to land in, and nothing reaches a phone that is closed. Solve with
the notification worker (5.G).

**G7. Profiles.** Every screen shows raw profile ids. `profile_edit` has
nowhere to write. Solve with the profile directory (5.H).

**G8. Audits, org status and the org switcher need more than one
partition.** `App.tsx` opens one hard-coded project. Org home, org status
rollups, audits, and the org switcher need an org-level view. Solve with the
org partition plus server summaries (5.A).

**G9. The respond flow has no place for the translator's reasoning.** The
spec's `PieceReviewResponse` carries "what I revised and why I kept the rest"
as text or audio. Here a response is only a new take with `parentTakeId`.
The reviewer's audio comment (`commentTake`) likewise has no field. Solve
with two grow-only events (5.F).

**G10. Terms acceptance and first-run state live only on the device.**
`vision:<actor>` in AsyncStorage. A legal acceptance should be recorded
server-side once online. Solve with a per-user partition (5.I).

**G11. "Add to TG" writes a per-unit note.** The spec's Translation
Guidelines are a language-level material. Same fix as G4.

**G12. The give-assignment wizard (type → scope → assignee → work → due)** is
partly built; scope beyond one unit needs the unit-set assignment in 5.F.

## 4. Liabilities in extended low- or no-connection states

These are ranked by blast radius. L1 and L3 can each cost a team a month of
work or a month of bandwidth; both have small fixes.

**L1. A role change while offline rejects the whole backlog.** Authorization
runs against membership *now*. A translator removed, demoted, or whose role
was renamed during a month offline pushes 3,000 events and gets 3,000
`not a member` rejections. Invariant 1 keeps them in the local log, but no
path re-admits them. Fix (server): authorize as of the event's HLC, bounded.
`member_role(org, project, profile, at_hlc)` folds only member events with
`hlc <= at_hlc`; accept if the role at that time may emit, with a maximum
backdate window (90 days) so a stolen old token cannot write into the past
indefinitely. Fix (client): keep the reject *code* (`NOT_MEMBER`,
`ROLE_MAY_NOT_EMIT`, `INVALID`), and when a pull brings a membership change
for the actor, re-push events rejected with a membership code. They are still
in the log, so this is one filter change in `push()`.

**L2. A device with its clock years ahead wins every register forever.**
HLC ties break by wall time. One phone set to 2031 makes all its
`TakeSelected`, config and role changes beat every later, correct decision.
Fix: `append_events` rejects events whose HLC wall time is more than 5
minutes ahead of server time with code `CLOCK_AHEAD`; the client, on that
code, records the server offset (`Date` header) and re-stamps only the
*clock* of pending events (ids and payloads unchanged) before retrying.
Events far in the past are fine and expected.

**L3. One redaction inside a checkpoint re-downloads the whole log.**
`pull()` sets the cursor to 0 and re-pulls everything when a `Redacted`
targets an event the device has already pruned. At Bible scale that is
24 MB per 100k events, on the link that made the team offline in the first
place, once per device, per redaction. Fix: the snapshot worker runs whenever
a partition receives a `Redacted` (it already refolds fully in that case);
the client, before falling back to a full pull, asks for a snapshot at or
past the redaction seq and waits for one (with a visible "updating" state)
rather than re-pulling. Full re-pull stays as the last resort only.

**L4. Pull writes one row per statement, no transaction.** After a month a
device pulls tens of thousands of events; each is a `get` plus a `put`, each
its own SQLite statement. Fix: add `putMany` to `EventStore` (one transaction
per page) and use it in `pull()` and in the bulk paths (`append` of a bulk
assignment). This is also what makes a bulk assign of 1,200 units not freeze
the UI.

**L5. The 15 s sync timer runs a network attempt whether or not there is a
network.** Offline is detected by the failure. On captive portals and
half-open cellular links each attempt can hang for the fetch timeout, every
15 s, all day. Fix: give `SyncClient` the same backoff ladder and two verbs
(`trigger`, `nudge`) the `TransferWorker` already has, and drive both from one
reachability signal. One policy, not two.

**L6. Local storage has no ceiling.** A month of VAD cards at WAV rates plus
every kept-offline unit's downloads, and no eviction. Fix: report bytes on
disk next to the pending counts; evict confirmed-and-not-in-scope blobs
oldest-first past a configurable ceiling; never evict an unconfirmed card.
Server-side garbage collection of unreferenced blobs is still open (PLAN.md
section 14).

**L7. Sign-in state is the auth library's session, not the local
identity.** The JWT expires in an hour; refresh needs network. If the auth
library emits a sign-out on a failed refresh, `App.tsx` resets to `sign_in`
with a full outbox. Decision 12 refuses explicit sign-out offline, but this
path is not explicit. Fix: persist the actor id and treat "signed in" as
"has a local identity"; re-authenticate in place when the refresh fails
online; never route away from work because a token expired.

**L8. A reducer version bump during the offline month forces a full fold on
the slowest phone.** Measured here: 100k events fold in 0.3 s on a laptop; a
weak Android may take 5–10 s at first open. Not a correctness risk. Fix: show
a progress state on first fold after upgrade, and keep the load harness gate
on the slowest partner device.

**L9. Whole-document config registers lose concurrent edits.** See G3. Two
coordinators offline each add a stage; the later HLC wins and the other's
stage vanishes with a warning nobody reads. Fix in 5.F: registers per step.

**L10. Membership authorization scans the partition per append.**
`member_role` reads every member event for a profile by walking the
`(org, project, type)` index and filtering on `payload->>'profileId'`. With
thousands of members this is a scan per event per push. Fix: the append RPC
is the one fold allowed on the write path, so let it maintain a `memberships
(org, project, profile, role, removed, hlc)` row in the same transaction it
inserts a member event. Authorization becomes one primary-key read, and the
as-of check in L1 reads the member events only for that one profile.

**L11. Derivations rescanned the whole state per unit and lane.** Fixed in
this change: `packages/core/src/indexes.ts`. Measured at 1,200 pericopes,
3 lanes, 40 translators, 6 reviewers (17.5k events):

| Derivation | Before | After |
| --- | --- | --- |
| `deriveTasks` (one actor) | 27,513 ms | 20 ms |
| `derivePieces` (one lane) | 3,717 ms | 3 ms |
| `deriveProgress` (3 lanes) | 19,566 ms | 6 ms |
| `buildIndexes` (once per fold) | — | ~5 ms |

The index is a view over the fold, built in one pass, never persisted or
synced, and the equivalence test proves every derivation gives the same
answer with and without it. Screens still call the derive functions without
passing an index (they build one per call, which is fine at these sizes); the
next step is for `useProject` to build it once per refresh and hand it to
screens, so the fraction of a second spent at fold time is paid once.

## 5. Architecture that fills the gaps

Design rules carried through: every new event is grow-only or a register with
a stated key; no event reads state to decide what to write; ids that two
offline devices could both mint are derived from the thing they name, so both
mint the same id and the grow-only set merges by construction.

### 5.A Org partition

One extra partition per organization, `projectId = "_org"`, in the same
`events` table with the same RPCs. It holds what the spec puts on org home
and what must exist before a project does.

| Event | Shape | Merge |
| --- | --- | --- |
| `v1.OrgCreated` | name | once |
| `v1.OrgMemberAdded` / `v1.OrgMemberScopeChanged` / `v1.OrgMemberRemoved` | profileId, roleId, scope `{ level: org \| project \| lane, projectId?, laneId? }` | register per (profile, scope) |
| `v1.RoleDefined` | roleId, name, privileges[], definedAt scope | register per roleId |
| `v1.RoleRetired` | roleId | flag, add-wins |
| `v1.CatalogItemEnabled` / `v1.CatalogItemDisabled` | kind (template \| reference \| flow), itemId, level (org \| project), projectId? | register per (kind, item, level, project) |
| `v1.ProjectRegistered` | projectId, name | grow-only |
| `v1.JoinDecided` | requestId, profileId, roleId, scope, accepted | grow-only; the accept also emits `OrgMemberAdded` |
| `v1.InviteIssued` | inviteId, roleId, scope, expiresAt | grow-only (the token itself never enters the log) |

Authorization: `append_events` for a project partition consults the org
membership fold; a member whose scope covers the project (org level, that
project, or a lane in it) may emit what their role's privileges allow.
Project-level `MemberAdded` stays for compatibility and becomes a derived
mirror. The org log is small (members, roles, catalog toggles), so every
device pulls it whole; it is what makes `org_home`, `roles_home`, `members_list`
and the org switcher work offline.

Rollups (`status_home` at org and project level, audits, `projectCount`,
`memberCount`) are server projections: the existing snapshot worker already
folds every partition; add a `project_summaries (org, project, lane,
translatedPct, approvedPct, bottleneck, blockers, updatedAt)` table it writes,
and a `get_org_summary(org)` RPC. Offline, the last pulled summary is shown
with its `updatedAt`. Audits are the same worker listing `ReviewSubmitted`
decisions across projects into `audit_entries`. No fold on the write path,
per invariant 9.

### 5.B Requests, invites, public browsing

These are the only writes by non-members, so they live outside the log, in
two small tables with row-level security, and enter the log only when a
member decides.

- `join_requests (id, org_id, profile_id, message, created_at)`: any
  authenticated user may insert one per org; org members with the Invite
  privilege may read them. Accepting appends `JoinDecided` plus
  `OrgMemberAdded` under the coordinator's actor. Declining appends
  `JoinDecided { accepted: false }`. `request_access` writes the row when
  online and queues it locally otherwise (a local outbox row, not an event,
  since the requester is not a member of any partition).
- `invites (id, org_id, token_hash, role_id, scope, expires_at, issued_by)`:
  issued by `InviteIssued`; the QR carries `orgId` and the token. A
  `redeem_invite(token)` RPC, run as the redeemer, verifies the hash and
  appends `OrgMemberAdded` under the service actor with `invitedBy`. This is
  how `scan_qr` and `create_account` with an invite land on a home instead of
  `intent_chooser`.
- `public_projects (org_id, project_id, name, languages, translated_pct)`:
  written by the summary worker for projects whose org enabled visibility;
  readable by anyone. `explore_home` reads this table; `pull_events` stays
  members-only. Q2, Q3, Q15 and Q27 in the spec's open questions resolve to:
  public means "listed in this table", nothing more.

### 5.C Roles with privileges

The spec's thirteen privileges become the authorization vocabulary. One table
in `packages/core` maps each event type to the privilege that permits it
(`RecordingAdded → Translate`, `ReviewSubmitted → Review`, `AssignmentMade →
Assign Work`, `MaterialFieldSet → Fill Reference Content`, …) and the SQL
`role_may_emit` is generated from it so the two cannot drift. The five fixed
roles are seeded as `RoleDefined` events when an org is created (Organization
Admin, Project Coordinator, Translator, Reviewer, Viewer) with the spec's
privilege sets, so nothing existing changes behaviour. Session facets become
`can(privilege)`, and `edgeAllowed` maps each gate to its privilege exactly as
the spec's `relevantFlowFor` does. Scope is on the membership, never on the
role (A38).

### 5.D Catalogs and deterministic instantiation

Content templates (v2's `template_structure`: `bible` and `fia` trees of
book → pericope with verse ranges), review-flow templates (Standard Bible
Flow, Quick Check, …), reference kinds (TMF, Brief, TG, FIA study, question
sets) and the languoid list are **global reference data**: a versioned static
bundle `catalog@N` shipped inside the app and fetchable when online. It is
not in any partition. An org enables items from it (5.A); a project narrows;
a lane selects exactly one template and one flow:

| Event | Shape | Merge |
| --- | --- | --- |
| `v1.LaneTemplateSelected` | laneId, templateId, catalogVersion | register per lane |
| `v1.LaneFlowSelected` | laneId, flowId, catalogVersion | register per lane |

Selecting a template instantiates units. The device that selects emits the
`UnitAdded` events itself, with **ids derived from the template**: `unitId =
"${templateId}@${catalogVersion}/${itemId}"` (e.g. `fia@3/gen-p1`). Two
admins who both select FIA offline both emit identical grow-only events; the
fold dedups by id and the log holds them once per id. No clone job, no
ordered insert, no server step. The same rule instantiates workflow steps:
`stepId = "${flowId}@${catalogVersion}/${stageId}"`.

A catalog upgrade never rewrites units: a lane pinned to `fia@3` stays on it;
moving to `fia@4` is a new selection that adds the new ids and archives
nothing. Units are content, and content is append-only.

### 5.E Reference material and key terms

Reference material becomes a small set of grow-only and register events that
cover every kind the spec lists (TMF, Brief, TG, FIA study, question sets) at
every scope, with per-field merging so two people can fill different blanks
of the same material offline.

| Event | Shape | Merge |
| --- | --- | --- |
| `v1.MaterialDefined` | materialId, kind, title, scope `{ laneId? , unitId? , stepId? }`, templateRef? (`catalogKind/itemId`), createdBy | grow-only |
| `v1.MaterialFieldSet` | materialId, fieldId, text? \| blobHash? | register per (material, field) |
| `v1.MaterialLocked` / `v1.MaterialUnlocked` | materialId | register per material |
| `v1.StepQuestionSetLinked` | stepId, materialId | register per step |

`ReferenceAttached` stays for existing logs and folds into a material of kind
`legacy` with one field. Fields for a templated material come from the
catalog (the FIA study template lists its blanks; a question-set template
lists its questions), so `material_editor` renders blanks from the catalog and
`blanks` on the library screen is a count of unset registers. `TakeSubmitted.
questionSetIds` already carries the sets a translator attaches; the
stage-linked default set is `StepQuestionSetLinked`. "Add to TG" becomes
`MaterialFieldSet` on the lane's TG material, appending a field whose id is
the unit id, so it is both per-passage and part of the language document.

Key terms are a living glossary (spec: renderings with context, recorded
adjustments, links from versions):

| Event | Shape | Merge |
| --- | --- | --- |
| `v1.KeyTermDefined` | termId, laneId, term, gloss, unitScope[] (book unit ids) | grow-only |
| `v1.KeyTermRenderingAdded` | termId, renderingId, rendering, context | grow-only |
| `v1.KeyTermAdjusted` | termId, adjustmentId, note, blobHash?, duringTakeId? | grow-only |
| `v1.KeyTermLinked` | takeId, termId, note?, adjustmentId? | grow-only, set per take |

Everything is grow-only, so nothing can conflict. The in-translation
shortlist is `unitScope ∩ ancestors(unit)`; the reviewer's "terms the
translator tied in" is `KeyTermLinked` for the take; `key_term_detail`'s
"linked translations" is the inverse index, and the audio explanation is a
blob like any card.

Key terms as content, not only as a supplement: a `key_terms` **unit kind**
in the template (leaf units are terms, ordered by first occurrence) makes an
oral glossary a set of passages: recorded as takes, submitted, reviewed by
the same workflow, shown on the same status map. The two uses share one
model: a term is reference when it informs a passage, content when it is the
passage. A lane can have both, and `KeyTermLinked` ties a glossary take to
the passage takes that cite it.

### 5.F Review flows, teams, and the respond loop

Per-step registers replace the whole-document workflow so concurrent edits
merge:

| Event | Shape | Merge |
| --- | --- | --- |
| `v1.WorkflowStepSet` | stepId, order, role \| teamId, required, rule | register per step |
| `v1.WorkflowStepRemoved` | stepId | flag, add-wins |
| `v1.ReviewTeamDefined` | teamId, laneId, name, stepId? | register per team |
| `v1.ReviewTeamMemberAdded` / `Removed` | teamId, profileId | add-wins set |
| `v1.AssignmentMade` (unchanged) | + optional `unitSetId` in a `v2` when bulk assignment lands | register per (unit, lane, person, role) |
| `v1.ResponseRecorded` | takeId, respondsToTakeId, note?, blobHash? | grow-only |
| `v1.ReviewCommentRecorded` | takeId, stepId, blobHash | grow-only |

Eligibility for a step is the first non-empty of: per-unit assignments for
the step's role, the step's team on that lane, every active member holding
the step's role. `deriveTakeStatus` already implements the first and last;
the team is one line between them. The order (assignment beats team beats
role) is what lets a coordinator pull one consultant onto one passage
without touching the team.

Bulk assignment: one `AssignmentMade` per unit is still right (the register
key is per unit), but the client must append them in one `putMany`
transaction (L4) and the UI must show the count. A future `v2.AssignmentMade`
with `unitIds[]` is only worth it if a log becomes dominated by assignments;
measure first.

The respond loop becomes: reviewer `ReviewSubmitted { suggest_changes }` (+
`ReviewCommentRecorded` for audio) → translator `TakeComposed { parentTakeId }`
→ `ResponseRecorded` → `TakeSubmitted`. The spec's stage-round history
(`piece_stage`, `piece_version`, `piece_review`) is fully derivable from those
five events per round; nothing is stored.

### 5.G Notifications and inbox

A server worker (the snapshot worker's loop) folds each partition tail and
writes `notifications (profile_id, seq, kind, org, project, unit, lane, take,
actor, created_at)` for the addressed cases: assigned to you, review
requested of you (you became eligible for a submitted take), suggestions on
your take, join request for an org you can admit to, blocker in a project you
coordinate. The phone pulls `notifications` by its own cursor (small, one
row per event of interest) and shows Expo push for new rows. Offline, the
inbox is derived from the local fold with the same rules in core
(`deriveInbox`), so it never goes blank. Read state is local (`meta`), synced
later if it ever matters. Q20 resolves to: push and inbox rows, email only
for invites.

### 5.H Profiles

`profiles (id, display_name, avatar_blob, updated_at)` in Postgres, owned by
the user, readable by anyone who shares an org with them (policy joins the
org membership fold). The org pull carries `OrgMemberAdded.displayName` as a
snapshot so names render offline the moment membership syncs; a later
`profiles` pull refreshes them. `profile_edit` writes the table when online
and queues the write in `meta` otherwise.

### 5.I Per-user partition

`orgId = "_user"`, `projectId = profileId`: `v1.TermsAccepted { version }`,
`v1.VisionSeen`, `v1.WalkthroughDone`, and later preferences. Written by the
user only, read by the user only; it turns first-run state into a durable
record without a new table.

### 5.J Performance rules that follow from this

- **Fold once, index once, derive many.** `buildIndexes` after each fold or
  append; every derive call takes it. Cost at 17.5k events: about 5 ms.
- **Batch every write path.** `putMany` in one transaction per pull page and
  per bulk append (L4).
- **No full scans on the server write path.** The membership row (L10)
  replaces the per-append event scan; `partition_cursors` already serializes
  per project only.
- **Bounded catch-up.** Snapshot on redaction (L3), paged pulls as now, and
  the org log kept small enough to pull whole.
- **One reachability signal, one backoff policy** for sync and transfers
  (L5).

## 6. Recommended additions to the build order

To append to PLAN.md section 11 after item 8:

9. **Done.** Store `putMany`; batched pull and bulk append (L4). Membership
   row on the append path (L10). Clock-ahead rejection (L2). As-of
   authorization and membership-coded rejections with automatic re-push
   (L1). Snapshot on redaction before full re-pull (L3). Verified by
   `syncClient.test.ts` ("after a long offline stretch"), smoke section 7,
   and the integration test.
10. **Done.** Org partition, roles with privileges, catalog toggles (5.A,
    5.C) in core `org.ts` and migration 000009; session facets from
    privileges; `language_home` reachable; the dead-gate entry in the parity
    test removed. Not yet: server summaries (`project_summaries`) and
    audits, which need the worker.
11. **Done.** Catalog bundle and deterministic instantiation (5.D);
    templates_home and flows_home select per lane; per-step workflow
    registers and review teams (5.F); `ResponseRecorded` and
    `ReviewCommentRecorded`. Not yet: recording audio for a response or a
    review comment (the events accept a blob hash; the screens capture text
    only until the recorder is wired there).
12. **Done.** Reference material and key terms (5.E); material_editor,
    key_terms, key_term_detail, attach_questions, review_questions and
    add_to_tg on real events. Audio for adjustments and material fields is
    accepted by the events; the screens capture text until the recorder is
    wired there. "Key terms as content" (a `key_terms` unit kind) is not
    started.
13. Requests, invites, public projection (5.B); notifications and inbox
    (5.G); profiles (5.H); per-user partition (5.I).
14. Screen contracts test, then the model-based walk (section 1).
