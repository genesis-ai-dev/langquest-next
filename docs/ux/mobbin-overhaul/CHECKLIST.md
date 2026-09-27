# Spoken / Mobbin overhaul: journey checklist

Source: `genesis-ai-dev/ng-langquest-ux`, branch `caleb-spoken-mobbin-overhaul`
(commit 52a3933). Branch here: `ux/spoken-mobbin-overhaul`.

**Goal.** Every journey in the reference branch works in this app. Journeys,
screens, structure and copy come from the reference. The look stays ours: one
yellow action, icons carry meaning, words optional on avatar U screens, 6%
tints, and the full-screen VAD takeover (`docs/ux/README.md`, PLAN.md §12).

**Detail lives in the analyses** in this folder. Each item below names its
journey id; search for it there to find reference file:line, our file:line,
gaps, and the data it needs.

- `analysis-entry-account.md`: J-ENTRY, J-ONB, J-HOME, J-INBOX, J-ACCT, J-SHELL
- `analysis-work-map-record.md`: J-WORK, J-MAP, J-REC-1…18, J-TOAST
- `analysis-do-work.md`: J-STUDY, J-REC-1…5 (workspace), J-BT, J-REV, J-GUEST, S0–S7
- `analysis-org-config.md`: J-ORG, J-CFG, J-VIEW
- `analysis-event-model.md`: facts, new events, derivation rules D1–D13

## Decisions (Ryder, 2026-09-25)

- Approvals reset per version: a new version needs fresh reviews, so a checkpoint certifies the audio that ships.
- Spoken: adopt the reference flow (community, peer, back translation, consultant checkpoint, local check by link) as a new flow id; existing `spoken_worldwide` OBT lanes keep working as legacy.
- My Work: For you / Recent / Waiting on others, plus the three most recent done items (struck through) so a returning user can pick up where they left off.
- New events: open. Ryder asked whether record facts can be more generic (indexed fields plus a JSON payload) instead of ~10 specific events. Phase 2 waits on that design.

## Rules for every item

1. Copy from the reference goes into `accessibilityLabel` and audio prompts on
   U screens, and is shown as text on P screens.
2. At most one `colors.action` (yellow) element on screen. Amber from the
   reference becomes review teal plus an icon. Red is for recording only.
3. Status is derived. No new stored status. Sync invariants (PLAN §4, AGENTS.md)
   hold. No shipped event changes shape.
4. Every navigation is a declared edge in `apps/mobile/src/flow.ts`. The spec
   parity test is re-vendored from the reference branch, and each deliberate
   difference is listed in its drift log with a reason.
5. An item is checked only when typecheck and tests pass and the journey has
   been walked (smart-tests or by hand) and the result was recorded.

## Phase 0: foundation (no new events)

- [x] Re-vendor `apps/mobile/test/spec-flow.json` from the reference branch (`scripts/extractSpecFlow.ts`) and rework `APP_ONLY` / `SPEC_RETIRED`
- [x] Screen ids: rename `assignments_home→my_work`, `language_status→map_home`, `book_status→book_map`, `piece_version→version_detail`, `piece_review→review_detail`. Add `passage_record`, `ask_someone`, `add_record`, `workspace`, `review_capture`, `back_translation`, `study_guide`, `study_step`
- [~] Retire `pickup_home`, `give_assignment`, `piece_assign`, `piece_stage`, `progress_home`, `assignment_progress_detail`, `done_await`, `attach_questions` (translator path), `explore_home` (stays retired)
- [x] Gates: add `contributor` (translate‖review) and `asker` (send_to_reviewers‖assign_work)
- [x] J-WORK-1 / J-HOME-2 / J-HOME-3: `homeScreenFor` → my_work for everyone who works, admins included; add `manageHomeFor` and `mapScreenFor`; the three `home_hub` edges
- [x] Tab bar: My Work · Map · Manage (admins) · Inbox (always, badge) · Settings. Icons only, labels as accessibility labels, non-red badges; Map/record screens keep the bar; no bar with no org
- [~] J-SHELL-1 / J-TOAST-1: toast host plus `ctx.toast(text, undo?)`, dark pill with offline state icon

Phase 0 notes: `progress_home` is retired; the other retiring screens stay until their replacements exist (see "RETIRING" in `flow.ts`). The toast host exists but has no offline-state icon yet.

## Phase 1: journeys that need no new events

Legend: `[x]` built and walked; `[~]` built, typecheck and unit tests pass, not yet walked in the app; `[ ]` not built.
Walked so far (smart-tests, 2026-09-25): translator records a passage in the workspace, online and offline with restart and sync; translator saves Version 1 from My Work (TakeComposed + TakeSubmitted confirmed); reviewer opens review_capture from My Work, plays, answers the required question and sends Needs changes with typed feedback (ReviewSubmitted confirmed); translator answers that feedback with Record a fix and saves Version 2 with a what-changed note (TakeSubmitted + ResponseRecorded naming Version 1); coordinator opens an unrecorded passage from the Map and asks the translator to record it, due in a week (AssignmentMade with dueDate confirmed; the existing-facts ask, not Phase 2 J-REC-10); translator searches the Map for "luk 1" and opens a Luke 1 passage (device Recent list). Not walked by these: voice feedback, skip-with-reason, background disclosures, back-translation compare, search at whole-Bible scale.
Partial items and their missing parts are listed in each agent report; the needs-Phase-2 parts are in Phase 2 below.

Entry and account
- [~] J-ENTRY-1 Sign in → home (subtitle, "Sign In", keep Forgot password)
- [~] J-ENTRY-2 Terms → Vision (five reference steps, icons, "Continue"); fix the Back loop on terms
- [~] J-ENTRY-3 Create account (confirm password, invite card, scan returns to create_account)
- [~] J-ONB-1 "What brings you here?" (QR stays yellow, rows visible, no tabs, sign-out path)
- [~] J-ONB-2 Create org → walkthrough (six steps) → My Work
- [~] J-ONB-3 Request access → "Waiting for {org}" card
- [~] J-ONB-4 Inbox join request → "Assign role & accept" → edit_member
- [~] J-INBOX-1 Unread / Earlier, type icons, rows open passage_record
- [~] J-ACCT-1…5 Settings card, Edit profile, Switch organization, Sign out, walkthrough replay

My Work and Map
- [~] J-WORK-2…10 For you (feedback, asked record, asked review, draft), Recent (device-local), Waiting on others, caps, empty state
- [~] J-MAP-1 Progress with several counts per language (no bottleneck or percent)
- [x] J-MAP-2 Search "luk 15" at whole-Bible scale (port canon parsing) — walked with "luk 1" on a three-passage project; whole-Bible scale not walked
- [~] J-MAP-3 Testament → book rows → chapter grid → parts sheet → record
- [~] J-MAP-4…7 Filter chips, switch language, for-you marks (never yellow), edges

Passage record (existing facts: per-take status until Phase 2)
- [~] J-REC-1 Hero (whose turn), step path tiles, latest event
- [x] J-REC-3 Record a fix → workspace with respondsTo → popTo record + toast
- [~] J-REC-8/9 Next step zone, step sheet, parallel steps from equal order
- [~] J-REC-12…18 Reviews by version, History, version detail, review detail, waiting-on-author, done card, asked step

Doing the work
- [x] Workspace (do-work J-REC-1…4): one screen replaces translate hub + quest_assets + add_to_tg + attach_questions; VAD takeover moved unchanged; tray (key terms, study, notes, history); Save Version N
- [~] J-REC-5 Polished final version via the same workspace
- [x] J-REV-1/2 review_capture (walked: required question, typed feedback, Needs changes; the rest by hand still): questions inline with types, skip with reason, voice and text feedback, Needs changes needs feedback, Background disclosures, back-translation compare (OBT lanes)
- [~] J-STUDY-1/5/6 study_guide and study_step screens from existing FIA content and progress (modal retired)
- [~] J-STUDY-3 PassageReader with BSB text and real timings
- [~] J-BT-1 back_translation screen for OBT lanes (partition boundary kept)

Organization and configuration
- [~] J-ORG-0 Manage tab reaches org/project/language homes
- [~] J-ORG-1…4 Homes with counts and catalog rows; new project = name + description; new language with name + defaults; fix hardcoded `org1` crumb
- [~] J-ORG-5…8 Members by level, invite with role and scope, QR invite stepper, edit member / approve join
- [~] J-ORG-9 Review teams without silently rewriting steps
- [~] J-ORG-10 Roles by level with labels, descriptions, members
- [~] J-CFG-1/2 Templates and ready-made flows
- [~] J-CFG-7…9 Reference library by level, key terms, key term detail (FIA glossary card)
- [~] J-VIEW-1 Viewer progress

## Phase 2: journeys that need new events (awaiting approval)

Proposed in `analysis-event-model.md` §4, in order. Each needs a type, validation
(core and SQL, in one migration), a reducer case, a privilege, and
permutation/idempotence fixtures.

- [~] `v2.WorkflowStepSet {kindIds, checkpoint}` + seed kinds → J-CFG-3/4/5, parallel kinds, checkpoint lock, done rule (core, SQL `20260927000001_flow_kinds.sql`, flow editor and record UI; journey "admin builds a flow" added, see verdict in the 2b-A report)
- [~] `v1.CheckRecorded` → per-kind reviews (reset per version), feedback answered (core, SQL `20260927000002_check_recorded.sql`, review_capture emits it on v2 steps; journey "reviewer checks a kind" added)
- [~] `v1.StepSetAside`, `v1.CheckpointOverridden`, `v1.DepartureUndone` → J-REC-5/6/7, toast Undo (core, SQL `20260927000003_departures.sql`, passage_record ReasonSheet, Set aside per kind, Move past this checkpoint…, history Undo / Brought back; journey "translator sets a step aside" written, not run: local stack down)
- [~] `v1.FeedbackKept` → J-REC-4 "Keep it, say why" (core, SQL `20260927000004_feedback_kept.sql`, feedback card and review_detail, inbox "Kept as is"; no undo fact yet; journey "translator keeps the version" written, not run)
- [~] `v1.RequestMade`, `v1.RequestWithdrawn` → J-REC-10 ask someone, precise For you / Waiting on others (core, SQL `20260927000005_requests.sql`, ask_someone fixed to step and kind with toast Undo, My Work; outside-person asks are Phase 3; journey "translator asks for a kind check" written, coordinator ask oracle moved to RequestMade, not run)
- [~] `v1.CheckLogged` → J-REC-11 Log what happened (add_record: kind, version played, also covered = one event per passage, how many / who, where, voice-first summary, evidence, outcome; credited, never the typist; no Undo — v1.Redacted needs manage_structure). Journey written, not run
- [~] `v1.ContentProduced` → J-BT-1/2 in ordinary lanes, J-REV-1 compare (never a TakeComposed in the source lane; kind state recorded, stale on an older version; add_record asks for "the {what}"). Journey written, not run
- [~] `v1.ContextItemAdded` → J-STUDY-2/3 notes, tray notes, verse notes, version change note (multi-note sheet; legacy ReferenceAttached and guideline note fold in; notes in record History and review Background; OBT lanes keep the guideline note). Journey written, not run
- [~] `v1.ReviewKindDefined` → J-CFG-6 (project partition; new kinds from the flow editor picker). J-REV-3 withholds context: [~] grey lock card on review_capture and back_translation (a UI filter, not privacy: R8)
- [~] Spoken Oral Method catalog flow (`spoken_oral_method`, v2 steps) → S0–S7 journeys not walked

## Phase 3: server work

- [ ] `v1.ShareLinkIssued` + server-only `v1.ShareFeedbackRecorded` + RPC + web page → J-GUEST-1, S7 (needs a security review)

## Existing bug found in passing

- [~] Re-selecting a flow (or flows_home Undo) left its steps removed: step ids were reused and `WorkflowStepRemoved` is add-wins; two lanes on one flow also shared step ids. Fixed by fresh step ids per application (`flowSelectionEvents`, core), pinned by `packages/core/test/catalog.test.ts`; not walked

- [ ] Core `validateEvent` has no cases for `WorkflowStepSet`, `LaneFlowSelected`, `ResponseRecorded`, `ReviewCommentRecorded`, `Material*`, `KeyTerm*`, `ReviewTeam*`, `StepQuestionSetLinked`, though SQL validates them (invariant 11)
- [x] `popTo` into a screen already in the stack dropped its params (React Navigation 7 POP_TO without `merge`), so saving in the workspace, deciding in review_capture or sending an ask landed on "Passage not found" whenever passage_record was already open. Fixed in `apps/mobile/src/nav.ts` (`popToAction`), pinned by `apps/mobile/test/nav.test.ts`.
- [x] The person-chip id popover's full-screen dismiss had a label but no role, so assistive tech (and Jev) could not find "Close". Fixed in `apps/mobile/src/UserChip.tsx`.
- [x] passage_record's step path has no reference caption "Tap any step to ask someone, log it, or set it aside." (rule 1: reference copy goes in accessibility labels). Without it the coordinator journey could not find "Ask someone to record"; its goal now states the caption. (fixed: the step path carries it as its accessibility hint)
