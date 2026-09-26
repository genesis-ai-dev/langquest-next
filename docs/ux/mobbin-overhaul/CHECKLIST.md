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

Entry and account
- [ ] J-ENTRY-1 Sign in → home (subtitle, "Sign In", keep Forgot password)
- [ ] J-ENTRY-2 Terms → Vision (five reference steps, icons, "Continue"); fix the Back loop on terms
- [ ] J-ENTRY-3 Create account (confirm password, invite card, scan returns to create_account)
- [ ] J-ONB-1 "What brings you here?" (QR stays yellow, rows visible, no tabs, sign-out path)
- [ ] J-ONB-2 Create org → walkthrough (six steps) → My Work
- [ ] J-ONB-3 Request access → "Waiting for {org}" card
- [ ] J-ONB-4 Inbox join request → "Assign role & accept" → edit_member
- [ ] J-INBOX-1 Unread / Earlier, type icons, rows open passage_record
- [ ] J-ACCT-1…5 Settings card, Edit profile, Switch organization, Sign out, walkthrough replay

My Work and Map
- [ ] J-WORK-2…10 For you (feedback, asked record, asked review, draft), Recent (device-local), Waiting on others, caps, empty state
- [ ] J-MAP-1 Progress with several counts per language (no bottleneck or percent)
- [ ] J-MAP-2 Search "luk 15" at whole-Bible scale (port canon parsing)
- [ ] J-MAP-3 Testament → book rows → chapter grid → parts sheet → record
- [ ] J-MAP-4…7 Filter chips, switch language, for-you marks (never yellow), edges

Passage record (existing facts: per-take status until Phase 2)
- [ ] J-REC-1 Hero (whose turn), step path tiles, latest event
- [ ] J-REC-3 Record a fix → workspace with respondsTo → popTo record + toast
- [ ] J-REC-8/9 Next step zone, step sheet, parallel steps from equal order
- [ ] J-REC-12…18 Reviews by version, History, version detail, review detail, waiting-on-author, done card, asked step

Doing the work
- [ ] Workspace (do-work J-REC-1…4): one screen replaces translate hub + quest_assets + add_to_tg + attach_questions; VAD takeover moved unchanged; tray (key terms, study, notes, history); Save Version N
- [ ] J-REC-5 Polished final version via the same workspace
- [ ] J-REV-1/2 review_capture: questions inline with types, skip with reason, voice and text feedback, Needs changes needs feedback, Background disclosures, back-translation compare (OBT lanes)
- [ ] J-STUDY-1/5/6 study_guide and study_step screens from existing FIA content and progress (modal retired)
- [ ] J-STUDY-3 PassageReader with BSB text and real timings
- [ ] J-BT-1 back_translation screen for OBT lanes (partition boundary kept)

Organization and configuration
- [ ] J-ORG-0 Manage tab reaches org/project/language homes
- [ ] J-ORG-1…4 Homes with counts and catalog rows; new project = name + description; new language with name + defaults; fix hardcoded `org1` crumb
- [ ] J-ORG-5…8 Members by level, invite with role and scope, QR invite stepper, edit member / approve join
- [ ] J-ORG-9 Review teams without silently rewriting steps
- [ ] J-ORG-10 Roles by level with labels, descriptions, members
- [ ] J-CFG-1/2 Templates and ready-made flows
- [ ] J-CFG-7…9 Reference library by level, key terms, key term detail (FIA glossary card)
- [ ] J-VIEW-1 Viewer progress

## Phase 2: journeys that need new events (awaiting approval)

Proposed in `analysis-event-model.md` §4, in order. Each needs a type, validation
(core and SQL, in one migration), a reducer case, a privilege, and
permutation/idempotence fixtures.

- [ ] `v2.WorkflowStepSet {kindIds, checkpoint}` + seed kinds → J-CFG-3/4/5, parallel kinds, checkpoint lock, done rule
- [ ] `v1.CheckRecorded` → per-kind reviews across versions, feedback answered
- [ ] `v1.StepSetAside`, `v1.CheckpointOverridden`, `v1.DepartureUndone` → J-REC-5/6/7, toast Undo
- [ ] `v1.FeedbackKept` → J-REC-4 "Keep it, say why"
- [ ] `v1.RequestMade`, `v1.RequestWithdrawn` → J-REC-10 ask someone, precise For you / Waiting on others
- [ ] `v1.CheckLogged` → J-REC-11 Log what happened
- [ ] `v1.ContentProduced` → J-BT-1/2 in ordinary lanes, J-REV-1 compare
- [ ] `v1.ContextItemAdded` → J-STUDY-2/3 notes, tray notes, verse notes, version change note
- [ ] `v1.ReviewKindDefined` → J-CFG-6, J-REV-3 withholds context
- [ ] Spoken Oral Method catalog flow (new flow id) → S0–S7

## Phase 3: server work

- [ ] `v1.ShareLinkIssued` + server-only `v1.ShareFeedbackRecorded` + RPC + web page → J-GUEST-1, S7 (needs a security review)

## Existing bug found in passing

- [ ] Core `validateEvent` has no cases for `WorkflowStepSet`, `LaneFlowSelected`, `ResponseRecorded`, `ReviewCommentRecorded`, `Material*`, `KeyTerm*`, `ReviewTeam*`, `StepQuestionSetLinked`, though SQL validates them (invariant 11)
