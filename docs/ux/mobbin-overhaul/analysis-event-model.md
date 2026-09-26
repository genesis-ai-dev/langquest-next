# Event model analysis: "a passage record with advice" against langquest-next core

Date: 2026-09-25. Read-only analysis.

Sources:
- Ours: `PLAN.md` sections 4, 6, 13, 16 (16.1 already lists proposed facts), `AGENTS.md`, and `packages/core/src/*`.
- Reference: branch `caleb-spoken-mobbin-overhaul`, at `scratchpad/ux`: `docs/design-principles.md`, `docs/decisions.md` (ADR-001 to ADR-020), `src/domain/record.ts`, `src/data.ts`, `src/App.tsx`.

Short paths used below: `ev` = `packages/core/src/events.ts`, `red` = `reducer.ts`, `wf` = `workflow.ts`, `st` = `state.ts`, `val` = `validate.ts`, `org` = `org.ts`, `obt` = `obt.ts`, `mat` = `materials.ts`, `tasks` = `tasks.ts`, `cmd` = `commands.ts`. `ref:record` = the reference's `src/domain/record.ts`, `ref:data` = `src/data.ts`, `ref:App` = `src/App.tsx`.

---

## 0. How our core works today (the questions asked)

**Does workflow.ts hard-block steps?** No, not for normal lanes.
- `deriveTakeStatus` (wf:55-78) evaluates every step on its own. It has no ordering and no lock. The outcome is `approved` when every required step has passed, and `changes_requested` when any required step has failed (wf:73-75).
- `tasksForUnitLane` (tasks:157-166) gives a review task for every step at once, as soon as the take is submitted. So all steps already run in parallel.
- The only command guards are "the take is submitted" and "the take is not submitted twice" (cmd:95-97, cmd:110-111). The server gates by privilege only.
- `derivePieces` (status.ts:48-51) labels a passage's "stage" as the first step that has not passed. This is presentation only.
- **What does gate:**
  - **Eligibility.** Review tasks appear only for eligible reviewers: assignment beats team beats role (wf:126-156). That is the method acting as a permission, which conflicts with ADR-006.
  - **OBT lanes.** OBT is a strict chain. `deriveObt` stops at the first missing step, and it ignores any decision whose `inputId` is not the exact predecessor (obt:96-137). `assertObtStep` throws on a stage mismatch (obt:177-182). OBT is our only real hard gate. It is the opposite of the reference model.

**Review decisions.** `v1.ReviewSubmitted { takeId, stepId, decision: 'approve'|'suggest_changes', comment?, answers? }` (ev:100-106). It folds as an LWW register per (take, step, actor) (red:200-211). A reviewer has one current verdict per take and step. A second session that the same person logs overwrites the first.

**Checkpoint concept.** None. The v1 `required` flag (ev:26) only decides whether a step counts toward `approved`. It does not lock later steps. OBT's `consultant` and `final_approval` behave like checkpoints, but they are hard-coded (obt:88-89).

**"Produces" concept.** Only in OBT. `ObtStepRecorded` with `step: 'back_translation'` carries `takeId` and `language` (obt:33-35). `deriveObt` records it as `backTranslationId` (obt:124, 131). The back-translation audio is a normal `TakeComposed` in the same (unit, lane). On a non-OBT lane it would read as a translator draft.

**Parallel steps.** Normal lanes: every step is effectively parallel, with no suggested order. Steps are sorted by `order` (wf:17-18) only for display. OBT: strictly sequential. Neither has "several kinds inside one step" (ADR-005, ADR-016).

**Respond loop.** A new take with `parentTakeId`, plus `v1.ResponseRecorded { takeId, respondsToTakeId, note?, blobHash? }` (ev:150; red:298-308; cmd:99-104), then `TakeSubmitted`. Reviews are per take, so a new version starts every step from zero. The reference carries earlier approvals forward (see R3).

**Pre-existing parity gap, relevant to every new event.** `validateEvent` has no case for `WorkflowStepSet`, `LaneFlowSelected`, `ResponseRecorded`, `ReviewCommentRecorded`, `Material*`, `KeyTerm*`, `ReviewTeam*` or `StepQuestionSetLinked`. They fall to `default: return null` (val:109-110). SQL `validate_payload` does validate them (e.g. `supabase/migrations/20260914000011_materials_key_terms.sql:69-88`). This breaks invariant 11 ("same rules") today. Every new event below must get a core validator case and a SQL case.

---

## 1. Fact-by-fact table

The "Proposed" column names are in our `v1.*` style and match PLAN 16.1 where 16.1 already names them. Where I disagree with a 16.1 payload, the row says so.

| # | Reference fact (where) | Our existing event / derivation | Gap | Proposed |
|---|---|---|---|---|
| 1 | Passage (`ref:data` Passage) | `v1.UnitAdded` leaf unit (ev:58-65) × lane (`v1.LaneAdded`, ev:57) | none | — |
| 2 | Version = saved recording, `submittedBy`, `changeNote`, takes (`PassageVersion`; `saveVersion` ref:App:499) | `v1.TakeComposed` (ev:80-86) + `v1.TakeSubmitted` (ev:94; red:185-198, first wins). `changeNote` ≈ `ResponseRecorded.note` (only when answering) or `TakeMetadataSet` (ev:87) | A `changeNote` on the first version has no home. `ResponseRecorded` is written only when a parent was submitted (cmd:101) | Minimal: write `changeNote` into `ResponseRecorded` when there is a parent. Otherwise leave it out. Later: optional `note` on a new `v2.TakeSubmitted` is **not** needed. Use a context item (row 22) anchored to the take |
| 3 | Draft takes not yet saved, `draftBy` (`Passage.draftTakes`) | Derived: takes with no submission (`deriveTakeStatus` → `draft`, wf:72); the actor is `Take.actorId` (st:59) | none. The reference stores it; we derive it | — |
| 4 | "A new version exists only when content changes" / "a save needs an actual change" (ADR-005, ADR-012) | Nothing | Command-level check only | `cmd.submitTake`: refuse when the card hashes equal the previous submitted take. Not an event |
| 5 | Review kind (org vocabulary, `ReviewKind`: name, icon, `withholdsContext`, `produces {what, into, action, checkedBy}`) | None. The closest are v1 step `label` (ev:143) and catalog flows (`LaneFlowSelected`, ev:141) | Missing | `v1.ReviewKindDefined { kindId, name, icon?, withholdsContext?, produces?: { what, language, checkedByKindId } }`, LWW per kindId. **Partition:** org partition (like `RoleDefined`, org:58ff) plus catalog seed kinds with stable ids (`kind@1/peer`). Privilege `manage_flows`. Reducer: org fold `kinds[kindId]` register. Steps reference `kindId`. A missing definition renders the id, never throws (see R6). PLAN 16.1 has `produces?` as a flag. It needs `checkedByKindId` and `language` to drive ADR-015 |
| 6 | Flow = ordered steps; a step holds 1..n kinds (parallel lanes); `checkpoint?` (`FlowStep`, ADR-005, ADR-016) | `v1.WorkflowStepSet { stepId, laneId?, order, label?, role, teamId?, required, rule }` (ev:143; red:264-269), `WorkflowStepRemoved` (add-wins), `deriveWorkflow` (wf:12-27) | No `kindIds[]`, no `checkpoint`. It has role, quorum and team, which the new model drops | `v2.WorkflowStepSet { stepId, laneId?, order, kindIds: string[] (≥1), checkpoint: boolean, label? }`. It shares the `workflowSteps[stepId]` slot with v1, LWW by HLC. `WorkflowStepRemoved` still applies. Privilege `manage_flows`. A v1 step reads as `{ kindIds: [stepId], checkpoint: false, legacy: { role, teamId, required, rule } }` |
| 7 | Language uses one template and one flow (`LanguageSetup`) | `v1.LaneTemplateSelected` / `v1.LaneFlowSelected` (ev:139-141) | none. The ready-made flows (Collect only, One check, Consultant only, Spoken oral) are new catalog entries whose selector emits `v2.WorkflowStepSet` | Catalog data, not events. The Spoken flow **must not** reuse `flowId 'spoken_worldwide'`, because `isObtLane` keys on it (obt:58-59). Use a new id so old OBT lanes keep their chain |
| 8 | Review attached to a version, of a kind, with outcome looks good / needs changes, comment, comment audio, answers, skipped required questions with reasons (`PassageReview`; `captureReview` ref:App:582) | `v1.ReviewSubmitted` (ev:100-106) + `v1.ReviewCommentRecorded { takeId, stepId, blobHash }` (ev:152) | No `kindId`. It is keyed per actor, so the same person cannot record two reviews. No `skippedQuestions`, no `requestId`, no evidence | `v1.CheckRecorded { checkId, unitId, laneId, takeId, kindId, stepId?, outcome: 'looks_good'\|'needs_changes', comment?, commentBlobHash?, answers?, skippedQuestions?: {questionId, reason}[], requestId? }`. Set by `checkId`. Privilege `review`. Validation: needs `comment` or `commentBlobHash` (ADR-012 "needs changes requires saying what"; PLAN 16 "every check needs a voice or text response") |
| 9 | Review logged afterwards by someone else: `via: 'recorded'`, `givenBy`, `people`, `place`, `artifacts` (retellings, recorded conversations); "Logged by you" (`addRecord` ref:App:651; `feedbackSource` ref:data) | Nothing. `ObtInteractionSet` (participantName, clipIds, photo; obt:28-31) is the OBT-only analogue | Missing | `v1.CheckLogged { checkId, unitId, laneId, takeId, kindId, outcome, comment?, commentBlobHash?, givenBy?, people?: number, place?, evidence?: Card[] }`. Set by id. The actor is the logger. The view credits `givenBy` / "N listeners at place". **A separate event type** so it can use a different privilege: `send_to_reviewers` (translators hold it, org:170). This follows principle 5 (a translator logs a self-run check). `CheckRecorded` stays `review`. `addRecord` with `alsoPassageIds` = one event per passage |
| 10 | Guest review by link, no account (`guestSubmit` ref:App:637; ADR-007; PLAN 16 share link) | Invites use the same pattern: `InviteIssued` with the token hash in a private table, and `InviteRedeemed` is server-only (org:72-79) | Missing | `v1.ShareLinkIssued { shareId, unitId, laneId, takeId, kindId, expiresAt, requestId? }` (privilege `send_to_reviewers`; the token hash lives in a private table, never in the log). `v1.ShareFeedbackRecorded { shareId, takeId, kindId, giverName, outcome?, text?, blobHash?, conversationCards?: Card[] }`: **server-only** (`EVENT_PRIVILEGE` null), appended by a security-definer RPC that checks the token. The actor is `share:<shareId>`. It folds exactly like a check whose `via = 'link'`. PLAN 16.1 names `tokenId` in the payload. Use `shareId` so the token is never exposed |
| 11 | Feedback answered by a new version ("any new version answers all open feedback", ADR-012; `saveVersion` mutates `review.response`) | `ResponseRecorded` links take→parent (red:298) | Nothing to add. Derive it | **Derivation, no event:** a `needs_changes` check C on (unit, lane) is *answered* if a take in that (unit, lane) was submitted with submission HLC > C.hlc, **or** a `ResponseRecorded.respondsToTakeId === C.takeId` |
| 12 | Keep it, say why (`keepAfterFeedback` ref:App:695, `response.decision: 'kept'`) | Nothing | Missing | `v1.FeedbackKept { keptId, checkId, reason?, reasonBlobHash? }`. Set by id. Privilege `translate`. The reference mutates the review, which is illegal here (R1). For legacy `ReviewSubmitted` there is no id, so allow `target: { takeId, stepId, reviewerId }` as an alternative to `checkId` |
| 13 | Set a step/kind aside with a reason (`skipKind` ref:App:675; `Departure type 'skip'`) | Nothing | Missing | `v1.StepSetAside { departureId, unitId, laneId, stepId, kindId?, reason?, reasonBlobHash? }`. **PLAN 16.1 leaves out `unitId`/`laneId`. It must be per passage.** Needs `reason` or `reasonBlobHash`. Set by id. Privilege `translate` (see open question Q3) |
| 14 | Override a checkpoint, with a reason (`overrideCheckpoint` ref:App:688; privilege "Override Checkpoints") | Nothing | Missing | `v1.CheckpointOverridden { departureId, unitId, laneId, stepId, reason?, reasonBlobHash? }`. Set by id. Privilege: minimal `manage_flows`; later a new privilege `override_checkpoints` (R7) |
| 15 | Undo of a departure (`undoDeparture` sets `undoneAt`, ref:App:683) | Nothing. `v1.Redacted` (ev:128) is removal from all folds, not an audit-visible undo, and needs owner/coordinator | Missing | `v1.DepartureUndone { undoId, departureId, departureKind: 'set_aside'\|'override', reason? }`. Set by id. A departure named by any undo is inactive; to depart again, write a new departure. `privilegeFor` resolves by `departureKind` (set_aside→`translate`, override→the override privilege), like `by_kind` (org:161-170). The derivation applies the undo only if `departureKind` matches the target's type. That stops a translator from undoing an override by lying about the kind |
| 16 | Out-of-order work and checks done while a checkpoint is uncleared (PLAN 16.1.6) | Nothing | Derivation only | Derived departure "done before checkpoint cleared": see §2 rule D6. It is never refused |
| 17 | Ask someone: record, or a review of a kind; assignee or external contact; `dueDate`; `note`; per-request questions; `status open/done/withdrawn` (`Assignment`; `sendRequest` ref:App:549; ADR-007, ADR-020) | `v1.AssignmentMade { unitId, laneId, profileId, role, dueDate?, instructions? }` (ev:107-114). LWW per (unit, lane, person, role) (red:213-231) | No request id, no kind, no withdraw. Two asks of one person for different kinds collide. The status is stored in the reference | `v1.RequestMade { requestId, unitId, laneId, what: 'record'\|'check', kindId?, assigneeId?, guest?: { label, shareId? }, dueDate? (ISO date), note?, questionSetId? }`. Set by id. Privilege by payload: `record`→`assign_work`, `check`→`send_to_reviewers`. `v1.RequestWithdrawn { requestId, reason? }` (same privilege as the ask; add-wins). **Status is derived** (§2 D8). Legacy `AssignmentMade` folds into the same read model (translator→record request; reviewer→check request with no kind) |
| 18 | Due date change | AssignmentMade LWW re-issue (red:215-217) | — | Minimal: withdraw and ask again. Add `v1.RequestDueDateSet { requestId, dueDate\|null }` (LWW) only if it is asked for |
| 19 | Per-request questions (`Assignment.questions`) | Question sets are materials (`MaterialDefined kind 'questions'`, mat:29-37). Translators may define them (org:166-167). `TakeSubmitted.questionSetIds` (ev:94) | none structurally | `RequestMade.questionSetId` points at a `questions` material |
| 20 | Combined, source-labelled question list, suggested/required (`questionsFor` ref:record:251) | `questionSetsFor` / `questionsOf` (mat:141-160), `StepQuestionSetLinked` per step (ev in mat:36) | Keyed by step, not kind. No `required` flag per question | Derivation: link sets by kind (`StepQuestionSetLinked` with `stepId = kindId` works, since it is an opaque string, or add a `KindQuestionSetLinked` later). `required` is a material field. No new event for the minimum |
| 21 | Back translation = content made from a version, in a language, checked by another kind (`ReviewKind.produces`; `saveBackTranslation` ref:App:611 stores it as a review with outcome `approved` + artifacts) | OBT only: `ObtStepRecorded step 'back_translation' takeId language` (obt:33-35, 124) | Needs to be expressed outside OBT without showing it as a version | `v1.ContentProduced { contentId, unitId, laneId, fromTakeId, kindId, language, cards: Card[], note?, noteBlobHash?, requestId? }`. Set by id. Privilege `review` (the reference's back translator is asked as a reviewer, `highlightsFor` ref:record:205-209). **It carries its cards directly and does not compose a `TakeComposed` in the lane.** Otherwise `currentTake` (wf:168-174) on an old client picks the back translation as the translator's newest take, which is a "wrong shown" (PLAN 16.1.1). `blobs.ts` must learn to list these cards for upload/download. The reference's `outcome: 'approved'` is replaced by kind state `recorded` |
| 22 | Anchored notes: on a verse (+translation, +moment), a key term, a study section / moment in step audio; `versionId`; photo; text or voice (`ContextNote`, `NoteAnchor`; `addNote`, `addPassageNote`, `addStudyContribution` ref:App:706-737) | `v1.ReferenceAttached { unitId, refId, kind, blobHash?, text? }` (ev:66-72; legacy passage notes, no anchor, no author credit beyond the envelope); `KeyTermAdjusted` (note on a term, `duringTakeId`); FIA progress/answers via `MaterialFieldSet` | No anchors, no moment, no version | `v1.ContextItemAdded { itemId, kind: 'note'\|'answer'\|…, home: { level: 'project'\|'lane'\|'unit', laneId?, unitId? }, anchors: Anchor[], text?, blobHash?, photoHash?, aboutTakeId? }`. `Anchor` = `{type:'unit',unitId}` \| `{type:'verse',unitId,verse,translation?,atMs?}` \| `{type:'take',takeId,atMs?,endMs?}` \| `{type:'study',materialId,stepId,sectionId?,atMs?}` \| `{type:'term',termId}`. Immutable; set by id. Privilege `fill_reference`. Times are integer ms, never `"3:12"`. `aboutTakeId` replaces `versionId`. Legacy `ReferenceAttached` folds into the same read model as unit-anchored notes. `ContextItemHidden { hideId, itemId, level, reason }` (PLAN 16.1) is later work |
| 23 | Tie key term to a version (`tieTerm` + `saveVersion` → `keyTermLinks`) | `v1.KeyTermLinked { takeId, termId, note?, adjustmentId? }` (mat:40; red:375) | none | Emit on save, one per tied term. The draft selection before save is local UI state |
| 24 | Key-term concept at org/project; rendering per language; adjustments with why | `KeyTermDefined { termId, laneId, … }` (lane-scoped), `KeyTermRenderingAdded`, `KeyTermAdjusted` (mat:37-39) | The concept is lane-scoped, not project-scoped. No "current rendering" register | Later: `v1.KeyTermRenderingSet` (PLAN 16.1). Not needed for the minimum journeys |
| 25 | Study step finished (who, when), per passage (`StudyCompletion`; `finishStudyStep` ref:App:739; ADR-018/019) | FIA only: `MaterialFieldSet` on `fia_progress` material, field `fiaProgressField(actor, unit, stage)` (fia.ts:29-42, 79-83; used by apps/mobile/src/fia.tsx:150-164). A per-actor register over 6 fixed stages | Generic guides need step ids from the guide; the reference tracks the team, not each person. The register can be blanked, so it is mutable evidence | `v1.StudyStepFinished { finishId, materialId, stepId, unitId, laneId }`. Set by id. Privilege `translate` (ADR-018: "only people who can translate are asked to finish steps"). Undo = `v1.DepartureUndone`-style `v1.StudyStepReopened { finishId }`, or use `Redacted`. Minimal path: keep the FIA register as it is |
| 26 | Study contributions (notes/answers on a section or at a moment) | `MaterialFieldSet` (fia progress) | Covered by row 22 (`anchors: [{type:'study',…}]`) | — |
| 27 | Checkpoint lock, kind/step state, done, next suggestion, progress counts (`passageState`, `languageProgress` ref:record:87-163) | `deriveTakeStatus`, `derivePieces`, `deriveProgress` (tasks:182-205), `bottleneck` (status.ts:79) | Different model | New derivation `derivePassageRecord` (§2). `bottleneck` and single % are replaced by counts (ADR-004) |
| 28 | Highlights "For you" / "Waiting on others" (`highlightsFor`, `waitingOn` ref:record:182-245) | `deriveTasks` (tasks:45), `deriveInbox` (inbox.ts:15) | Tasks are keyed by eligibility, not requests | Derivation over §2 plus requests. No event |
| 29 | Notifications with a read flag (`notify`, `markHandled` ref:App:412-421) | `deriveInbox` is derived (inbox.ts). Server push lives in `account_discovery_notifications` migration | The reference stores `read` | Derive "handled" from facts (request done, feedback answered). "Seen" is local-only per device. No event |
| 30 | Recent passages per person (ADR-017 "Recent") | Nothing | — | **Not an event.** First choice: derive from the actor's own events (latest HLC per unit). Code answers it, with no storage. Second choice: a device-local preference, which is not project state (invariant 7 is about project tables) |
| 31 | 7-second Undo after a send (ADR-008; `undoable` restores a snapshot) | — | A snapshot restore rewrites history. Illegal | Hold the command in a local pre-append buffer for about 7 s and append when it expires. If it was already appended, emit the compensating event (`RequestWithdrawn`, `DepartureUndone`, `Redacted` for one's own check). Never delete from the log |
| 32 | Checkpoint marks and flows managed by "Manage Review Flows" (ADR-004) | `manage_flows` privilege (org:30; `WorkflowStepSet`→`manage_flows`, org:134) | none | — |
| 33 | "Press play once before submit" (PLAN 16) | — | UI only | No event |
| 34 | Withholding context from back translation (`withholdsContext`) | — | UI/read-model filter | A field on `ReviewKindDefined`. It is not access control: the data is still in the partition. PLAN 16's OBT note says back translators never join the source partition. If that privacy is required, it needs the OBT workspace pattern (`ObtWorkspaceCreated`), not a UI filter (R8) |

---

## 2. Derivation changes (`workflow.ts` + new `record.ts`-style module in core)

Keep `deriveTakeStatus` / `deriveStep` exactly as they are for old callers and legacy v1 lanes. Add a new pure `derivePassageRecord(state, unitId, laneId, idx)`. The UI moves to it. Rules:

**D1. Flow in force.** `deriveWorkflow` (wf:12) is extended to return `{ id, order, kindIds, checkpoint, label?, legacy? }`. A v1 register maps to `kindIds: [stepId]`, `checkpoint: false` and `legacy: {role, teamId, required, rule}`. Lane overrides project overrides config, as now. For a v1 step with `required: false`, the step is **optional**: it is shown, but it is excluded from "done". This keeps today's meaning.

**D2. Versions.** Versions = takes in (unit, lane) with a submission and not archived, ordered by submission HLC. `recorded` = at least one version. `latest` = the newest. Drafts = takes without a submission (unchanged). Takes named by `ContentProduced` are never versions. Because `ContentProduced` does not compose takes in the lane (row 21), this holds by construction.

**D3. Checks.** A check is any of these, folded into one list:
- `CheckRecorded` (via app)
- `CheckLogged` (via logged)
- `ShareFeedbackRecorded` (via link)
- legacy `ReviewSubmitted` (via app, `kindId = stepId`, `checkId = eventId`)

Checks attach to `takeId`, and their kind is `kindId`. Redacted checks are gone (as now). A v1-legacy step keeps quorum semantics: its kind state comes from `deriveStep` on the *latest version* (wf:80-118) and is mapped `passed→approved`, `failed→suggestions`, `pending→todo`. Do not blend quorum into v2 steps (R4).

**D4. Kind state** per (unit, lane, kindId). Evaluate in this order and take the first rule that matches. This is the reference's precedence (ref:record:68-77) with our additions.
1. The kind `produces` and a `ContentProduced` exists for this kind → `recorded`. The UI adds `stale: fromTakeId !== latest` ("made from an older version", ADR-015).
2. The latest check (max HLC, tie by event id) of this kind is `looks_good` → `approved`.
3. An open request (D8) for `check` of this kind exists → `asked`.
4. The latest check is `needs_changes`. If it is answered (D5) → `addressed`. Otherwise → `suggestions`.
5. An active `StepSetAside` (D7) exists for (unit, lane, step, kind) or (unit, lane, step, no kind) → `skipped`.
6. Otherwise → `todo`.

"Latest check of the kind" is taken **across versions**, which matches the reference: an approval on v1 still counts after v2. See R3 for the decision this needs.

**D5. Answered feedback.** A `needs_changes` check C is answered if any of these holds:
- (a) there is a `FeedbackKept` with `checkId = C.id` (or a legacy target), or
- (b) a version of the same (unit, lane) has submission HLC > C.hlc, or
- (c) there is a `ResponseRecorded` with `respondsToTakeId = C.takeId`.

`awaitingResponse` = unanswered `needs_changes` checks. They belong to `latest.actorId` (ADR-012 `feedbackIsMine`).

**D6. Checkpoint lock and step completion.** Walk the steps in order, starting with `gate = none`.
- `stepComplete` for a checkpoint step: every kind is `approved`, or `recorded` for a produce kind.
- `stepComplete` for a non-checkpoint step: every kind is in {`approved`, `addressed`, `skipped`, `recorded`}.
- `override` = an active `CheckpointOverridden` for (unit, lane, step).
- Step i is `locked` when `gate` is set. The UI shows `todo` kinds of a locked step as `locked`. It shows a kind that already has checks as its real state, plus `outOfOrder: true` (see below).
- After evaluating step i: if it is a checkpoint, not complete and not overridden, and `gate` is unset → `gate = step i`.
- **Out-of-order departure (derived, PLAN 16.1.6).** A check, content or set-aside on a step after gate step G is flagged `doneBeforeCheckpoint` when its HLC is earlier than G's clearing time. G's clearing time is the min HLC of G's approving check or active override. If G never cleared, every such fact is flagged. These facts still count toward their step. They are never refused.

**D7. Departures.** `StepSetAside` and `CheckpointOverridden` are active unless a `DepartureUndone` names their `departureId` with a matching `departureKind`. The rule is add-wins, so it commutes. Several active departures for the same target are all shown. Any one of them is enough.

**D8. Requests.** A request comes from `RequestMade`, or from a legacy `AssignmentMade` mapped as in row 17. Its state is derived:
- `withdrawn` if any `RequestWithdrawn` names it.
- Else `done`, for `what: 'record'`, if a version in (unit, lane) has submission HLC > request HLC. (The reference closes every open record request on any save, ref:App:522-523.)
- Else `done`, for `what: 'check'`, if a check or `ContentProduced` of `kindId` names `requestId`. Otherwise, if one is by the assignee (or for the guest's `shareId`) with HLC > request HLC.
- Else `open`.
- Legacy `AssignmentMade` for a reviewer is `done` when the assignee has any check on the latest version.

**D9. Done.**
- If there is no flow (zero steps) → `done = recorded` (ADR-004, "Collect only").
- Otherwise `done = recorded && every non-optional step is (stepComplete || override)`.
- **This follows PLAN 16 ("clears … or on an override"), not the reference code.** The reference's `done` ignores overrides (ref:record:104). See R5.
- A step counted by override or set-aside is marked as an exception in the view.

**D10. Next suggestion.**
- If `!recorded`: suggest record. If the unit has a study material with unfinished steps, also suggest the study (ADR-018).
- Else if `awaitingResponse` is on the latest version: the next action is "answer feedback", with a "Then: <next step>" hint (ADR-014).
- Else: the first step that is not complete and not locked, preferring steps without an override (ref:record:105-112).
- This is advice only. Nothing in commands or the server reads it.

**D11. Progress (ADR-004).** Per lane:
- `recorded` count
- `done` count
- per step `cleared` count (`recorded && stepComplete || override`)
- `waiting` = passages with an open check request

Replace `bottleneck` and `percentDone` in the new UI. Keep the old functions for old screens.

**D12. Tasks / inbox eligibility.** For v2 steps, stop using `eligibleReviewers` (wf:126) to decide who *may* review. The privilege `review` decides that, and requests decide who is *asked* (ADR-006, ADR-007). `eligibleReviewers` stays for v1 quorum steps only.

**D13. OBT lanes.** Unchanged. `isObtLane` lanes keep `deriveObt`. PLAN 16 says "OBT is not a separate template" for *new* lanes. Existing OBT facts keep folding (PLAN 16.1.5). Do not reinterpret `ObtStepRecorded` as checks in this pass.

---

## 3. Risks to invariants

- **R1. Stored status and mutation in the reference (invariant 5; the log is append-only).** Each of these must be expressed legally:
  - `Assignment.status` → D8 + `RequestWithdrawn`
  - `Departure.undoneAt` → `DepartureUndone`
  - `PassageReview.response` written into the review (`saveVersion`, `keepAfterFeedback`) → D5 + `FeedbackKept`
  - Back translation stored as `outcome: 'approved'` → `ContentProduced` + kind state `recorded`
  - `Notification.read` → derived or local
  - `Language.progress` / `reviewStage` / `Project.status` / `progress` → D11
  - `Passage.draftTakes` / `draftBy` → D3 (existing)
  - `StudyCompletion` undo by array restore → `StudyStepReopened` or `Redacted`
  - `undoable()` snapshot restore → pre-append hold or compensating event (row 31)
  - `"Just now"` timestamps → HLC
- **R2. Old clients: "less shown", not "wrong shown" (16.1.2).**
  - (a) Back-translation audio must not be a `TakeComposed` in the lane (row 21).
  - (b) An old client ignores `CheckRecorded`, so it shows a take as `in_review` when the new model calls it done. That is "less shown", which is acceptable.
  - (c) An old client ignores `v2.WorkflowStepSet`, so it shows the *older v1 definition* of a step that was edited with v2. That is borderline "wrong shown". Mitigation: new flows use **new stepIds** (never edit a v1 step with v2), so an old client simply sees fewer steps.
  - (d) `RequestMade` is invisible to old clients' task lists. That is "less shown".
- **R3. Carry-over of approvals across versions.** Today each take starts review from zero (per-take `reviews`, st:149). The reference carries the latest check per kind across versions. This changes the meaning of "approved" for existing data only in the new read model. The old `deriveTakeStatus` is untouched. It needs an explicit product decision. The main case: should a consultant's looks-good survive the final recording? The reference says yes. The safer alternative: checkpoint kinds need `looks_good` on a version whose submission HLC ≥ that of the latest *content-changing* version. That needs a "changes content" flag, so it is out of scope.
- **R4. Two review semantics.** v1 quorum steps (role, team, `rule`) and v2 "latest check of the kind" contradict each other. Per Rule 7, pick v2 for all new flows. Keep v1 derivation only for legacy steps, and never mix them in one step. Flag `QuorumRule`, `ReviewTeam*` and `eligibleReviewers` for "hidden until needed" (PLAN 16).
- **R5. Override and "done".** The reference code (ref:record:100-104) does not count an override toward done. PLAN 16 and `data.ts`' comment ("move a passage past it") do. D9 follows PLAN. Confirm with Caleb.
- **R6. Partition self-containment (invariant 6).** `kindId`s defined in the org partition are referenced from project events. Treat them like catalog ids: global reference data by id. The fold must tolerate a missing definition. Alternative: define kinds per project. That duplicates vocabulary but keeps partitions pure.
- **R7. New privilege `override_checkpoints`.** Adding to `PRIVILEGES` (org:24-38) is additive. But existing `RoleDefined` events carry fixed privilege arrays, so custom roles won't get it, and SQL `event_privilege` / `effective_role` must change in step. Minimal: gate the override on `manage_flows` now and split it later.
- **R8. `withholdsContext` is not privacy.** Back translators in the same partition can pull everything. If Spoken requires this, use the OBT workspace isolation, not a UI filter.
- **R9. Share-link writes (16.1.7).** They need a server-only event, a token-hash table, an expiring scope limited to one take and one kind, a rate limit, and an actor id that is not a member. `append_events` must keep refusing clients that emit `ShareFeedbackRecorded`.
- **R10. Validation parity (invariant 11).** Every new event needs `validateEvent` cases, a `validate_payload` SQL case and an `event_privilege` SQL case in a new migration (`create or replace` that keeps every old case). The existing core gap (§0) should be fixed at the same time, or at least not copied.
- **R11. Payload-dependent privileges.** `RequestMade` (by `what`) and `DepartureUndone` (by `departureKind`) extend the `by_kind` pattern (org:161-170). SQL `role_may_emit_event(role, type, payload)` already takes the payload (`20260917130211_account_discovery_notifications.sql:224`), so this is feasible.
- **R12. Permutation tests.** Every new event goes into `packages/core/test/fixtures.ts` (`buildFixture` / `buildStep11Fixture`). Include undo-before-departure, check-before-step-definition, and request-withdrawn-before-request orderings. `REDUCER_VERSION` (red:12) must be bumped.

---

## 4. Minimal-first recommendation (ordered)

Each step unlocks a reference journey without the next one.

1. **`v2.WorkflowStepSet { stepId, laneId?, order, kindIds[], checkpoint, label? }`** + catalog seed kinds (stable ids; `ReviewKindDefined` deferred) + D1/D4/D6/D9/D10/D11 derivations, with legacy `ReviewSubmitted` mapped as checks (`kindId = stepId`) initially.
   - Unlocks: parallel kinds in one step, checkpoint lock, "done", counts, and the ready-made flows (new catalog flow ids, not `spoken_worldwide`).
2. **`v1.CheckRecorded`** (review, set by id, kind-tagged, needs a response) + D5 answered-by-new-version.
   - Unlocks: reviewing by kind, repeat reviews, and the "feedback answered" rule.
3. **`v1.StepSetAside`, `v1.CheckpointOverridden`, `v1.DepartureUndone`** + D7 + the derived out-of-order flag.
   - Unlocks: comply-or-explain, the override journey and undo.
4. **`v1.FeedbackKept`**.
   - Unlocks: "Keep it, say why".
5. **`v1.RequestMade`, `v1.RequestWithdrawn`** + D8.
   - Unlocks: Ask someone, due dates, My Work "For you" / "Waiting on others", "asked" state.
6. **`v1.CheckLogged`** (`send_to_reviewers`; `givenBy`, `people`, `place`, `evidence`).
   - Unlocks: Spoken community check logged by the translator, and "Logged by you".
7. **`v1.ContentProduced`** + `ReviewKindDefined.produces` (or produces on catalog kinds) + `blobs.ts` support.
   - Unlocks: back translation checked by the consultant.
8. **`v1.ContextItemAdded`** (anchors incl. `atMs`) folding legacy `ReferenceAttached`.
   - Unlocks: verse and moment notes, and study notes.
9. **`v1.StudyStepFinished`** (keep the FIA `fia_progress` register until then).
10. **`v1.ShareLinkIssued` + server-only `v1.ShareFeedbackRecorded`** + RPC.
    - This is last because it needs server work and a security review.

Deferred: `ReviewKindDefined` (custom kinds), `ContextItemHidden` / `Anchored` / `Unanchored`, `KeyTermRenderingSet`, `RequestDueDateSet`, `override_checkpoints` privilege.

Not events: recent passages (derive from the actor's events), notification read state, the 7-second undo (pre-append hold), "listened once", draft term ties.

## Open questions to settle before implementing

- **Q1 (R3).** Do approvals carry across versions for checkpoint kinds?
- **Q2 (R5).** Does an override count toward done?
- **Q3.** Who may set a step aside: anyone with `translate`, or only the passage's latest-version author and admins? Principle 3 suggests anyone who can act, with the reason logged.
- **Q4 (R6).** Where do review kinds live: org partition or project partition?
- **Q5 (R8).** Does back-translation context withholding need real isolation?
