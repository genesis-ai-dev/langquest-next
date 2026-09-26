# Gap analysis: My Work, Map, Passage Record, departures, toasts, highlights

Reference: `ux` clone on branch `caleb-spoken-mobbin-overhaul` (paths below prefixed `ref:`).
Ours: `/Users/ryderwishart/frontierrnd/langquest-next` (paths prefixed `ours:`).
Read-only analysis. No code changed. All line numbers were read, not guessed.

Reference sources read: `ref:AGENTS.md`, `ref:docs/design-principles.md`, `ref:docs/decisions.md` (ADR-003, 004, 007, 009, 012, 013, 014, 015, 016, 017, 020), `ref:src/flow.ts`, `ref:src/screens/work.tsx`, `ref:src/screens/map.tsx`, `ref:src/screens/passage.tsx`, `ref:src/domain/record.ts`, `ref:src/canon.ts`, `ref:src/App.tsx` (actions and render cases), `ref:src/ui.tsx` (`Disclosure`), `ref:src/screens/shared.tsx` (`ReasonSheet`, `StateMark`, `StepMarks`), `ref:src/domain/session.ts`.

Ours read: `ours:apps/mobile/src/flow.ts`, `session.ts`, `passageFlow.ts`, `App.tsx` (nav, tabs), `screens/work.tsx`, `status.tsx`, `translate.tsx`, `passageSlides.tsx`, `obt.tsx`, `review.tsx`, `dynamicBible.tsx`; `ours:packages/core/src/events.ts`, `state.ts`, `workflow.ts`, `tasks.ts`, `status.ts`, `blockers.ts`, `inbox.ts`, `readModels.ts`, `obt.ts`, `reducer.ts` (AssignmentMade, ResponseRecorded), `commands.ts` (submitTake), `org.ts` (privileges), `catalog.ts`; `ours:packages/client/src/queries.ts`; `ours:PLAN.md` sections 4, 6, 12, 13; `ours:docs/ux/README.md`; `ours:docs/ux/one-next-action.html` (My Work and hub slides).

---

## 0. Vocabulary map (read this first)

The reference and our core name the same things differently. Every gap below uses this map.

| Reference term (`ref:src/data.ts`, `record.ts`) | Our term (`ours:packages/core`) | Equivalent? |
| --- | --- | --- |
| Passage | leaf unit on a lane (`unitId`, `laneId`) | Yes. |
| Version (`p.versions`, made by "Save version") | A submitted take (`TakeComposed` + `TakeSubmitted`) | Yes. "Save version" = our hand-off (`commands.submitTake`, `ours:packages/core/src/commands.ts:103-105`). |
| Draft takes (`p.draftTakes`, `draftBy`) | An unsubmitted take (`deriveTakeStatus(...).outcome === 'draft'`, `ours:workflow.ts:72`); author is `state.takes[id].actorId` | Yes. |
| Review kind (`ReviewKind`, e.g. Peer Review) | Workflow step (`WorkflowStep`: `id`, `role`, `teamId`, `required`, `rule`, `label`) | Partly. A reference kind is organization vocabulary; our step is one role or team with a quorum rule. |
| Flow step (`FlowStep { kindIds[], checkpoint }`) | No equivalent. Our steps are one role each and have no grouping. | No. See section 3. |
| Checkpoint (`FlowStep.checkpoint`) | No equivalent. `required` means "counts toward approval", not "locks later steps". | No. |
| Producing kind (`ReviewKind.produces`, back translation) | Only in OBT lanes (`ObtStepRecorded` with `takeId`, `ours:obt.ts:33-36`). A normal flow's `back_translation` step is a verdict step. | No, outside OBT. |
| Review (`PassageReview`: `kindId`, `versionId`, `by`, `via`, `outcome`, `response`, `givenBy`, `people`, `place`, `artifacts`) | `ReviewSubmitted` register per (take, step, actor) (`ours:state.ts:64-69`) | Partly. No `via`, `givenBy`, `people`, `place`, `artifacts`. |
| Response to feedback (`review.response { decision: revised | kept }`) | `ResponseRecorded { takeId, respondsToTakeId }` (`ours:reducer.ts:298-306`), only emitted with a new submitted take (`ours:commands.ts:103`) | Revised: yes. Kept: no. |
| Request / task (`Assignment`: `assigner`, `assignee`, `kind: record | review`, `reviewKindId`, `dueDate`, `note`, `questions`, `external`, `status`) | `AssignmentMade { unitId, laneId, profileId, role, dueDate, instructions }` (`ours:events.ts:107-114`) | Partly. No assigner in state, no step target, no status, no external contact, no questions. |
| Departure (`Departure`: `skip` / `override`, `reason`, `reasonTake`, `undoneAt`) | Nothing. | No. |
| Note (`ContextNote`, many per passage) | `tgMaterialId(laneId)` field per unit: one register, last writer wins (`ours:translate.tsx:190-243`) | Partly. One note per passage, not a list. |
| Toast with Undo | Nothing. `done_await` screen instead (`ours:review.tsx:141-167`). | No. |

Two consequences drive most of the gaps:

1. The reference derives state **per kind across versions** (`ref:src/domain/record.ts:68-77` looks at the latest review of the kind on any version). Our core derives state **per take** (`ours:workflow.ts:55-78`): a new take restarts every step. The reference's "Feedback answered" (`addressed`) state, which completes a non-checkpoint step, cannot exist in our model today.
2. The reference has **departures** (skip, override, keep, undo) and **requests with an asker**. Our event catalog has neither.

---

## 1. Journey checklist

Legend for "Data": **D** = derivable from our core today (function cited). **R** = derivable if the reducer keeps a value that is already in the event envelope (no new event, but a state and reducer change). **N** = needs a new fact (a new versioned event). Facts are named, not designed. The consolidated list is in section 1.9.

### 1.1 My Work (home)

- [ ] **J-WORK-1 Everyone who does or asks for work lands on My Work, admins included; admins reach their org, project or language home through a Manage tab.**
  - Personas: translator, reviewer, consultant, back translator, org/project/language admin. Viewers are excluded (J-MAP-1).
  - Reference: `ref:src/domain/session.ts:118-124` `homeScreenFor`: no org → `intent_chooser`; viewer → `status_home`; admin or worker → `my_work`. Tabs `ref:src/App.tsx:282-288`: "My Work" (badge = `forYou.length`), "Map" (`mapScreen`: `map_home` for workers without admin scope, else `status_home`, `ref:src/domain/session.ts:137-140`), "Manage" (admins only, `manageHomeFor`), "Inbox" (badge = unread), "Settings". Book and passage screens keep the tab bar (`ref:src/App.tsx:289-295`, `MAP_SCREENS = map_home, status_home, book_map, passage_record`). Flow edge `home_hub → my_work` with label "route · trans / review / admin-*" (`ref:src/flow.ts:154`). ADR-017.
  - Ours now: `ours:apps/mobile/src/session.ts:106-113` sends org admins to `org_home`, project admins to `project_home`, lane admins to `language_home`, viewers to `status_home`, workers to `assignments_home`. Tabs (`session.ts:136-143`): home, `status_home`, `inbox_home` only when count > 0, `settings_home`. Tab icons `ours:App.tsx:430-446`. `TAB_SCREENS` (`ours:flow.ts:276-279`) does not include book or passage screens, so the tab bar hides on them (`App.tsx:408`).
  - Gaps: admins do not land on My Work; no Map tab; no Manage tab; Inbox tab hidden at zero (reference always shows it with a badge); no badge on the My Work tab; tab bar hidden on book and passage screens.
  - Changes: `session.ts homeScreenFor`: admins and workers → `my_work`. Add `manageHomeFor(s)` (org/project/lane home by `adminScope`). Add `mapScreenFor(s)` (`map_home` for workers without admin scope, else `status_home`). `tabsFor`: `[my_work (if not viewer), map, manage (if admin), inbox_home, settings_home]`, with badges. `flow.ts`: replace `home_hub → org_home / project_home / language_home` edges with `home_hub → my_work`; keep `home_hub → status_home` and `home_hub → intent_chooser`. Add `my_work`, `map_home`, `book_map`, `passage_record` to `TAB_SCREENS` (the tab bar shows on them). Update the spec-parity drift log.
  - Data: role dispatch **D** (`deriveSession`, `ours:session.ts:51-83`). For-you badge: see J-WORK-2..6.

- [ ] **J-WORK-2 Translator sees feedback on their latest version under "For you" and taps Respond.**
  - Persona: translator (author of the latest version).
  - Reference: `ref:src/domain/record.ts:185-195`: for each passage whose latest version was submitted by me, each review with `outcome === "suggestions"` and no `response` becomes a card: title `Feedback on {Book label}`, sub `{Kind name} · from {feedback source}` (`personName(feedbackSource(r), name, true)`). Card style `ref:src/screens/work.tsx:16`: icon `chat`, amber tint, pill "Respond". Tap → `openHighlight` → `go("passage_record")` (`ref:src/App.tsx:457-460`). Edge `my_work → passage_record` "tap Respond / waiting / recent passage" (`ref:src/flow.ts:161`).
  - Ours now: `ours:packages/core/src/tasks.ts:147-150` makes a `respond` task when the current take's outcome is `changes_requested`. `ours:screens/work.tsx:176-184` shows it as a `TodoRow` (Reply icon, translate tint) that opens `translate_passage` (`work.tsx:181`), not a passage record. Reviewer name and step are not shown.
  - Gaps: (a) our respond task fires only when a **required step fails its quorum** (`workflow.ts:73`), not on any single suggestion; with `rule: 'majority'` one reviewer's suggestion does not create it. (b) It does not check that I authored the latest version (`tasks.ts:147` uses `mayTranslate`, so every translator sees every respond task). (c) One task per passage, not one card per piece of feedback. (d) It opens the recording hub, not the record.
  - Changes: new core derivation `highlightsFor(state, actorId, idx)` (proposed file `ours:packages/core/src/record.ts`) that returns `{ kind: 'respond' | 'record' | 'review' | 'produce' | 'draft', unitId, laneId, takeId?, stepId?, reviewerId?, askedBy?, dueDate?, at }`. `respond` = per (take, step, reviewer) with `decision === 'suggest_changes'`, where take is the current submitted take, `take.actorId === me`, and no answer fact exists (revised by a newer submitted take with `ResponseRecorded.respondsToTakeId`, or kept, see J-REC-4). `my_work` card taps → `passage_record` (params `unitId`, `laneId`).
  - Data: suggestion per reviewer **D** (`state.reviews[takeId][stepId][actorId]`); author **D** (`state.takes[id].actorId`); answered by revision **D** (`state.responses`); answered by keeping **N** (F4).

- [ ] **J-WORK-3 Translator sees "Record {passage}" because someone asked them, and taps Record.**
  - Reference: `ref:record.ts:201-204`: open request `kind: "record"`, assignee me, `canRecord` → title `Record {Book label}`, sub `{assigner} asked · due {date}` (or no due). Style `mic`, pill "Record" (`ref:work.tsx:17`). Tap → `openWorkspace` (`ref:App.tsx:465`). Edge `my_work → workspace` "tap Record / Continue", gate `translator` (`ref:flow.ts:158`).
  - Ours now: `AssignmentMade` with a non-reviewer role creates the `translate` task and carries `dueDate` (`tasks.ts:141-145`). But a translate task also exists for **every** passage for every translator (`tasks.ts:147-154`), assigned or not, so "asked" is not distinguishable in the list. Row opens `translate_passage` (`work.tsx:181`).
  - Gaps: no asker shown; no "asked" versus "available" distinction; request is never "done" (assignments have no status); taps open the hub, not recording.
  - Changes: `highlightsFor` `record` item from assignments with a translating role to me, not yet satisfied. "Satisfied" = any take on (unit, lane) submitted after the assignment's clock (reference `saveVersion` closes all open record requests on the passage, `ref:App.tsx:522-523`). Card tap → recording (`quest_assets`, our workspace) via a new edge `my_work → quest_assets` (gate `translator`), or to `passage_record` if we keep the hub between (see section 4 recommendation).
  - Data: assignee, due **D** (`state.assignments`); satisfied **D** (compare `state.submissions[take].hlc` to `assignment.hlc`); asker **R** (F5: reducer must keep `event.actorId` on `Assignment`; `ours:reducer.ts:213-230` drops it today).

- [ ] **J-WORK-4 Reviewer sees "{Kind} · {passage}" asked of them and taps Review.**
  - Reference: `ref:record.ts:206-210`: open review request to me, `canReview` → title `{Kind name} · {Book label}`, sub `{assigner} asked · due {date}`. Style `check`, green tint, pill "Review" (`ref:work.tsx:19`). Tap → `doKind(reviewKindId)` → `review_capture` (`ref:App.tsx:461-472`). Edge `my_work → review_capture` gate `reviewer` (`ref:flow.ts:159`).
  - Ours now: `tasks.ts:157-166` gives a review task per workflow step where I am **eligible** (assignment by role, else team, else role holders, `workflow.ts:126-156`), whether or not anyone asked. Opens `review_passage` (`work.tsx:181`).
  - Gaps: an unasked eligible reviewer gets a task (reference: no request, no highlight; work is still reachable from the Map, ADR-007); no asker; assignment targets a role, not a step, so two steps with the same role cannot be asked for separately.
  - Changes: `review` highlight only from explicit asks to me for a step. Keep eligibility for permissions only. Edge `my_work → review_passage` (rename target to `review_capture` if we adopt reference ids).
  - Data: asks per step **N** (F6: request that names a step). Asker **R** (F5). Done when I have a `ReviewSubmitted` for that step on a take submitted after the ask **D**.

- [ ] **J-WORK-5 Back translator sees "Back-translate {passage}" and taps Start.**
  - Reference: `ref:record.ts:208-209`: a request whose kind has `produces` becomes `kind: "produce"`, title `Back-translate {Book label}` (the action label minus " it"), pill "Start", icon `swap` (`ref:work.tsx:20`). Tap → `back_translation` (`ref:App.tsx:469-472`). Edge `my_work → back_translation` gate `reviewer` (`ref:flow.ts:160`). ADR-015.
  - Ours now: OBT lanes have back translation as stage `back_translation` in `deriveObt` (`ours:obt.ts:96-138`); the hub routes it to `obt_manage` (`ours:obt.tsx:79`), and a back translator in the source-free workspace gets `BackTranslation` (`obt.tsx:224-249`). `obtTasks` gives one task per member per passage (`tasks.ts:207-217`). Non-OBT flows treat `back_translation` as a verdict step (`ours:catalog.ts:161`).
  - Gaps: no "produce" highlight type; non-OBT flows cannot mark a step as producing content.
  - Changes: `highlightsFor` `produce` item for asks on a producing step (OBT: when `obtCanAct` for `back_translation` and I was asked). Icon: Headphones (our OBT back translation icon, `obt.tsx:23-27`).
  - Data: OBT stage **D** (`deriveObt`); producing-step flag for other flows **N** (F12); ask **N** (F6).

- [ ] **J-WORK-6 Translator continues an unsaved draft ("Continue {passage}").**
  - Reference: `ref:record.ts:212-219`: `draftTakes.length > 0 && draftBy === me`, not already listed → title `Continue {Book label}`, sub `{n} take(s) recorded, not saved yet`, pill "Continue" (`ref:work.tsx:18`). Tap → workspace.
  - Ours now: `translate` task with status `doing` when the current take is a draft (`tasks.ts:151-153`), but for **every** translator, not only the draft's author.
  - Changes: `draft` highlight when current take outcome is `draft`, `take.actorId === me`, `cardHashes.length > 0`, and the passage is not already listed.
  - Data: **D** (`currentTake`, `deriveTakeStatus`, `state.takes[id].actorId`, `cardHashes`).

- [ ] **J-WORK-7 "For you" shows 5 cards ranked, "Show all N", and a language label only when the lists span languages.**
  - Reference: `ref:work.tsx:11-12` caps (`FOR_YOU_CAP = 5`, `WAITING_CAP = 3`); `ShowAll` label `Show all {total}` / `Show fewer` (`ref:work.tsx:109-117`); section headers `For you · {count}`, `Recent`, `Waiting on others · {count}` (`ref:work.tsx:53, 73, 91`); ranking `ref:record.ts:220-224` (fresh "Just now" first, then record/review/produce requests, then drafts, then feedback). Language prefix `{Language} · {sub}` only when shown passages span more than one language (`ref:App.tsx:1359-1363`). Header: `My Work`, `{name} · {orgName}` (`ref:work.tsx:49-50`).
  - Ours now: `work.tsx:47-198`: sync chip, project card with `DualProgressBar`, todo/doing/done filter chips, paged `FlatList` of every task, footer "Browse open work" → `pickup_home`, yellow footer = first open task.
  - Gaps: no sections; no caps; done tasks are listed (PLAN section 12 rule "The dashboard is a to-do list. Done items stay visible, struck through" conflicts with reference, which never lists done work; see section 1.10 C2).
  - Changes: rebuild `AssignmentsHome` as `MyWork`: sections For you / Recent / Waiting on others; caps 5 and 3 with Show all; keep sync chip; drop filter chips and open-work footer. Ranking needs a "fresh" notion: use HLC wall time (`decodeHlc`, `ours:packages/core/src/hlc.ts:18`) of the ask, review, or take.
  - Data: **D** from J-WORK-2..6. Multi-language: our session is per project; lanes in a project are the languages (`state.lanes`), so "span languages" = more than one `laneId` in the list **D**.

- [ ] **J-WORK-8 Translator opens My Work and resumes the passage they opened last (Recent).**
  - Reference: `recentByPerson` in App state, updated whenever the screen is `passage_record`, `workspace`, `review_capture` or `back_translation`; newest first, 5 max (`ref:App.tsx:375-382`). My Work lists them minus passages already in For you or Waiting (`ref:App.tsx:1353-1358`). Row: history icon, `{Book label}`, sub `passageSummary(state, kinds, me)` in amber when feedback is mine, trailing `StepMarks` when recorded and the flow has steps (`ref:work.tsx:71-87`). Scenario seeding puts the tour passage there (`ref:App.tsx:896`).
  - Ours now: nothing.
  - Changes: device-local list in AsyncStorage keyed `recent:{orgId}:{projectId}:{actorId}` (per-viewer convenience, like `selection:` in `ours:App.tsx:195-208`), written when `passage_record`, `quest_assets`, `review_passage` or `obt_passage` opens.
  - Data: list is not a project fact and must not be an event. Row summary **D** once `passageRecord` exists (section 3).

- [ ] **J-WORK-9 Coordinator sees what they asked others for under "Waiting on others", most overdue first.**
  - Reference: `ref:record.ts:233-245` `waitingOn`: open requests with assigner me and assignee not me; title `{Book label}`, sub `{Recording | Kind} · {assignee} · due {date}` or `· asked {askedAt}`; sorted by due date, undated last. Row icon `clock` (`ref:work.tsx:94-95`). Tap → `passage_record`.
  - Ours now: nothing. `AssignmentProgressDetail` (`work.tsx:316+`) is reached by long-press on a task.
  - Data: asker **R** (F5); open vs done **D** (as J-WORK-3/4); due date **D**. Due date is a free string (`'Sep 30'`, `ours:work.tsx:261`); sorting needs an ISO date. New asks should write ISO; old strings sort last.

- [ ] **J-WORK-10 Nothing is waiting: empty state points to the Map (or Manage).**
  - Reference: `ref:work.tsx:55-66`: green check tile, "Nothing is waiting on you", sub "Set up people, projects and review flows under Manage, or find any passage on the Map." (admins) / "Find any passage on the Map to keep going." (others).
  - Ours now: `ListEmptyComponent` = a check icon (`work.tsx:171-175`).
  - Changes: icon-only U version: green `CheckCircle2` tile plus a Map-icon button (not yellow unless it is the one next action; see section 4).

### 1.2 Map

- [ ] **J-MAP-1 Viewer (funder) lands on Progress and reads several counts per language.**
  - Reference: `ref:map.tsx:40-126` `StatusHomeScreen`: header `Progress`, sub `{orgName} · {scopeLabel}`; summary card `Across {n} languages · {total} passages`, `{recorded%} recorded`, `{done%} done`, `{waiting} with reviewers`; search "Find a language" when more than 5; per project, per language card: code tile, name, `{scope} · {flowName}`, clock badge with waiting count, `FunnelRows` (Recorded, one row per step `{cleared} of {total}` with a lock icon on checkpoints, Done). Footer text "Each bar counts passages that have cleared that step of the language's review flow. A passage is done when every step is complete — or, with no flow, once it's recorded." Tap language → `map_home` (`ref:flow.ts:178`).
  - Ours now: `ours:status.tsx:25-55` `StatusHome`: header "Status", rows per lane with `{n} pieces · {bottleneck}` and `{percentDone}%`, footer "Give assignment" for admins. ADR-004 replaced the single percent and bottleneck with per-step counts.
  - Gaps: bottleneck and single percent (reference explicitly retired both); no per-step counts; no waiting count; no language search.
  - Changes: rewrite `StatusHome` around a new core `languageProgress(state, laneId, idx)`; remove `bottleneck`/`percentDone` use from screens (keep the core functions until nothing reads them); remove "Give assignment" footer (asking moves to the record, J-REC-10).
  - Data: recorded **D** (a submitted take exists: `state.submissions`); per-step cleared **D** only under our per-take quorum semantics (`deriveTakeStatus(...).steps[i].outcome === 'passed'`); reference semantics (addressed, skipped, checkpoint) **N** (F1, F2, F4, F10); waiting **D** approx (submitted and a step has `waitingOn` eligible reviewers) or exact with asks **N** (F6). Must come from read-model rows at scale, not a fold per render (section 3.4).

- [ ] **J-MAP-2 Translator finds Luke 15 at whole-Bible scale by typing "luk 15".**
  - Reference: `ref:map.tsx:274`: search placeholder `Find a book or chapter — “John 3”`; `parseQuery` / `bookMatches` / `matchesQuery` (`ref:canon.ts:81-106`) forgive abbreviations and numbered books ("1 cor"). Without a chapter: book hits with `{n} book(s) · add a chapter number to jump straight to it`, or `No book by that name in this project` (`ref:map.tsx:281-288`). With a chapter: `{n} passage(s)` or `No passage matches — try a book name, then a chapter`; 25 per page with `ShowMore` (`ref:map.tsx:185, 292-302`). Tap result → `passage_record` (`ref:flow.ts:181`).
  - Ours now: no search anywhere. `DynamicBible` (`ours:dynamicBible.tsx:17-60`) lists all 66 books as rows, then passage choices, only for the `dynamic` template and only to start new passages. Status drill-down lists every piece of a book (`status.tsx:80-105`).
  - Changes: new screen `map_home` with a search field. Port `parseQuery`, `bookMatches`, `matchesQuery`, `chaptersOf`, `canonKey` as pure functions (core is fine: no I/O). Chapter numbers come from our unit labels: chapter units are labelled `{Book} {n}` (`ours:catalog.ts:71`); pericope units carry `verseRange` in catalog data (`ours:catalogData.ts`, `FiaPericope.verseRange`); dynamic units parse with `bibleRangeFromUnit` (`ours:dynamicBible.ts:54-60`). Book metadata (testament, group like "Gospels") is static reference data to add next to `BIBLE_BOOKS`.
  - Data: units and labels **D** (`state.units`, `idx.containerUnits`, `laneLeafUnits`). Per-result state **D** via read rows.

- [ ] **J-MAP-3 Browse: Testament → book with progress → chapter grid → parts sheet → passage record.**
  - Reference: `ref:map.tsx:308-321` count tiles (Recorded `{n} of {total}`, Done, With reviewers); section "Books"; OT/NT segmented toggle with book counts (`ref:map.tsx:326-341`); books grouped by `group` (Law, Gospels, …) (`348-357`); `BookRow` (`388-423`): name, `{n} for you` amber badge, two-colour bar (done green, recorded primary), sub `{recorded} of {total} recorded · {done} done` or `Not started · {n} chapters`, chat badge with feedback count. Tap → `book_map` (`ref:flow.ts:182`). `BookMapScreen` (`505-599`): header `{Book}`, sub `{Language} · {recorded} of {total} recorded`; filter chips; 5-column square tiles coloured by `chapterTone` (done, feedback, review, drafting, todo; dashed border for todo and drafting), step-progress bar inside review tiles, chat icon for feedback, amber dot for "for you", `{n} parts` when several passages share a chapter; legend "The bar on a chapter shows how many review steps it has cleared." plus swatches; a chapter with several parts opens a sheet `{ref} {n}` / `{n} parts — pick one` listing `PassageRow`s. Tile tap with one part → `passage_record` (`ref:flow.ts:184`).
  - Ours now: `LanguageStatus` (`status.tsx:57-78`) lists books with `{n} pieces · {bottleneck}` and percent; `BookStatus` (`80-105`) lists every piece as a row with a status badge (unassigned/doing/waiting/done) and share-audio; `PieceStatus` (`122-151`) is a P screen with stage history and "Assign" footer.
  - Gaps: no testament toggle, groups, chapter grid, parts sheet, for-you marks, or feedback marks. Status words (`doing`, `waiting`) are P vocabulary shown on what should be a U-usable map.
  - Changes: new screens `map_home` and `book_map` (replace `language_status` and `book_status`). Keep "Share approved passages in order" (`status.tsx:88-89`) as a book-level action on `book_map` (it is ours, not in the reference). Chapter tile colours: see section 4.
  - Data: tone per chapter needs per passage `recorded`, `drafting`, `done`, `awaitingResponse` count, steps cleared **D** under per-take semantics (`deriveTakeStatus`), otherwise needs F1/F2/F4/F10. Must be in `PassageRow` (section 3.4).

- [ ] **J-MAP-4 Coordinator filters the map: "Feedback waiting", "With reviewers", "In review", "Done", "Not recorded".**
  - Reference: `ref:map.tsx:130-181`: chips `All`, `Feedback waiting`, `With reviewers`, `In review`, `Done`, `Not recorded` with counts; chips with zero hide unless selected; filter is App state shared by `map_home` and `book_map` (`ref:App.tsx:1374, 1390`); book sub-line changes to `{matching} {noun} · {recorded} of {total} recorded` (`ref:map.tsx:384-386, 408-409`); non-matching chapter tiles fade to 0.28 (`556`). Empty: "Nothing here matches this filter." (`345`).
  - Ours now: none.
  - Data: feedback **D**/(F4), with reviewers **D** approx / exact with F6, in review **D** (submitted, not approved), done **D**/(F1, F2, F4, F10), not recorded **D**.

- [ ] **J-MAP-5 Switch language in place from the map title.**
  - Reference: title button `{Language}` with chevron opens sheet "Switch language" listing languages with code tile and scope, check on the current (`ref:map.tsx:262-266, 362-379`). No navigation.
  - Ours now: a project has lanes (`state.lanes`); `AssignmentsHome` uses the first lane only (`work.tsx:52`). `LanguageStatus` takes `laneId` param.
  - Changes: `map_home` holds `laneId` in params; the sheet swaps it. Languages across projects need the org (`useOrg`) and project switching, which our session model scopes per project; flag if a person works in lanes of several projects.
  - Data: **D** (`state.lanes`).

- [ ] **J-MAP-6 Map marks what is "for you" but does not list it.**
  - Reference: `highlighted = forYouIds` passed to `map_home` and `book_map` (`ref:App.tsx:1371, 1389`); book badge `{n} for you`, tile dot, row inset bar and "For you" pill (`ref:map.tsx:397-399, 432-437, 569`).
  - Data: same as J-WORK-2..6.

- [ ] **J-MAP-7 From Progress, open a language's map; from the language home, open its map.**
  - Reference edges: `status_home → map_home` "tap language"; `map_home → status_home` back; `language_home → map_home` "tap Passage map" (`ref:flow.ts:178-180`).
  - Ours: `status_home → language_status`, `language_home → status_home` (`ours:flow.ts:169, 231`). Rename targets.

### 1.3 Passage record: reading it

- [ ] **J-REC-1 Anyone opens a passage and learns where it stands and whose turn it is.**
  - Personas: all.
  - Reference: `ref:passage.tsx:100-127`. Header `{passage title}`, sub `{Language} · {flow name | "No review flow"}`. `StatusHero` (`243-308`): tone dot (green done, amber feedback, primary otherwise); headline from `heroHeadline` (`218-231`) verbatim: `Done`; `Recording in progress` / `Not recorded yet`; `Your turn: answer the feedback` / `Waiting on {author}`; `Your turn: {step name}` / `Waiting on {a} and {b}` (when every kind of the next step is asked); `Next: {step name}`; `In review`. Right: `{cleared} of {steps} done`. Line `Latest: {event title} · {who} · {at}` from the newest timeline entry (`271-275`, `describeEvent` `739-784`). With no flow and done: "This language collects recordings without reviews — recorded is done." Path: `Recorded` node (mic), then one button per flow step (`280-299`), auto-scrolled to the next step (`252-258`); caption "Tap any step to ask someone, log it, or set it aside." (`303`). Step node states `pathState` (`235-241`): complete, locked, attention (suggestions, or a checkpoint whose feedback was answered but not approved), waiting (asked), current, todo. `PathDot` (`327-355`): check (or flag when overridden), lock, clock, chat, a checkpoint lock badge at the top-right. Labels trimmed by `pathLabel` ("Community Check" → "Community", `215`).
  - Ours now: there is no passage record for everyone. Translators get the hub `TranslatePassage` (`ours:translate.tsx:48-106`): title, `TranslationOptions`, `FiaGuide`, six `TaskTile`s (Reference material, Key terms with ring, Recordings, Hand off, Review question sets, Passage notes), suggestion comments as cards (`translate.tsx:102`), instructions card, yellow footer `ActionButton` chosen by `passageProgress` (`ours:passageFlow.ts:10-39`: reference → terms → record → submit → done). OBT lanes get `ObtPassage` (`ours:obt.tsx:33-164`) with a stage icon and a yellow footer for the current OBT stage. Admins get `PieceStatus` (`status.tsx:122-151`). Reviewers get only `ReviewPassage`.
  - Gaps: no hero/whose-turn, no step path, no latest event, no record for reviewers/admins to act from, three different passage screens by persona.
  - Changes: new `passage_record` screen used by every persona (params `unitId`, `laneId`), replacing `piece_status` and absorbing `translate_passage` (see section 4 for how the hub tiles survive). OBT lanes render the same record with the OBT stage chain as the path (`deriveObt(...).stage`, `OBT_STEPS`).
  - Data: headline and path **D** under per-take semantics; reference semantics need `passageRecord` (section 3) plus F1, F2, F4, F6, F10. "Latest" event and who/when: **D** from HLC wall time and actor on takes, submissions, reviews, responses; asks **R** (F5).

- [ ] **J-REC-16 A non-author sees open feedback as "Waiting on {author} to answer the {Kind}".**
  - Reference: `ref:passage.tsx:107-122`: amber button card, clock icon, `Waiting on {author} to answer the {kind}`, sub `{source} asked for changes: {comment}` or `.`; tap → `review_detail`. Only the latest version's author answers (ADR-012, `feedbackIsMine` `ref:record.ts:119-121`).
  - Ours now: `translate.tsx:67-68, 102` shows every suggestion comment to any translator; any translator can re-record.
  - Data: **D** (author = `state.takes[take].actorId`).

- [ ] **J-REC-17 Done passage: green card, footer offers "New version".**
  - Reference: `ref:passage.tsx:451-459`: green card "Every step of {flow} is complete." or "Recorded — nothing more is suggested."; footer (`168-174`) `New version` / `Continue recording` primary when done, ghost otherwise, shown when `can.record && recorded && !answersMine`.
  - Ours now: hub footer becomes `done` → `done_await` (`translate.tsx:45, 75`).
  - Data: done **D** (`outcome === 'approved'`), reference done rule needs F1/F2/F4/F10 (section 3.3).

- [ ] **J-REC-18 A step already asked shows who it waits on.**
  - Reference: `KindActionRow` sub (`ref:passage.tsx:593-594`): `{asker} asked you · due {d}` / `Waiting on {assignee}` (+ ` · link sent by {WhatsApp|SMS}`) (+ due). Asked rows have no primary or secondary action except "Review it now" for the asked person (`612-614`).
  - Data: asks per step **N** (F6), asker **R** (F5), external **N** (F7).

### 1.4 Passage record: acting on feedback

- [ ] **J-REC-3 Translator answers feedback with "Record a fix".**
  - Reference: `FeedbackToAnswer` card (`ref:passage.tsx:518-562`): heading `{Kind} asked for changes`; reviewer avatar (or group icon for "N listeners at place"), name, comment (3 lines), `Voice feedback · {duration}` chip, `Logged by {x} · {at}` for logged reviews; tap → `review_detail`; text "Record a fix to answer it, or keep this version and say why."; buttons `Keep it, say why` (neutral) and `Record a fix` (primary, mic). Record a fix → `openWorkspace(p.id, reviewId)` (`ref:App.tsx:1423`) → workspace → "Save version" → `saveVersion` (`ref:App.tsx:499-538`): new version answers **all** open feedback (`response.decision = "revised"`, `revisedVersionId`), closes record requests, notifies app reviewers, toast `{Version N} saved · answers the {kinds} feedback` or `{Version N} saved to the record`, returns to `passage_record` (edge `workspace → passage_record` "tap Save version", mode `popTo`, `ref:flow.ts:228`). Also offered on `review_detail` footer (`ref:passage.tsx:1048-1053`: `Keep it` ghost, `Record a fix` primary).
  - Ours now: hub footer `record` when `changes_requested` (`passageFlow.ts:30`) → `quest_assets`, then `attach_questions` with an "Optional response" text box (`translate.tsx:183`) → `submitTake` with `responseNote` (`commands.ts:103`) → `done_await`.
  - Gaps: no per-feedback card; response note typed on a later screen; ends on `done_await`, not the record with a toast; answers only "the take", not named feedback.
  - Changes: `passage_record` shows one feedback card per open (take, step, reviewer) suggestion for the author. "Record a fix" → `quest_assets` with `respondsTo` param. After submit: `popTo passage_record` and a toast. Remove `attach_questions` from the hand-off path (reference has no question attach at save; request-level questions live on `ask_someone`). Flow edges: `passage_record → quest_assets` (gate translator), `quest_assets → passage_record` (popTo), `review_detail → quest_assets` (gate translator).
  - Data: **D** (`ResponseRecorded` + `TakeSubmitted` via `submitTake`). "A new version answers all open feedback" is **D**: any newer submitted take with `parentTakeId` chain. The reviewer voice comment **D** (`state.reviewComments`).

- [ ] **J-REC-4 Translator keeps the version and says why ("Keep it, say why").**
  - Reference: `ReasonSheet` (`ref:shared.tsx:173-210`) with title `Keep it as it is?`, tone amber, sub "No new version is made. Your reason goes back to the reviewer and into the record.", quick reasons `Listeners preferred the current wording` / `Matches our key terms decision` / `The suggestion changes the meaning` (`ref:passage.tsx:40-44`), voice "Say why instead", textarea "Or type the reason", note "This goes in the passage's record with your name. It can be undone later — the record keeps both.", confirm `Keep and send reason`. Action `keepAfterFeedback` (`ref:App.tsx:695-704`): sets `response.decision = "kept"`, notifies the app reviewer `{first} kept {passage} as is` / `Reason: {reason}`, toast `Kept · your reason is on the record` with Undo (`Undone — the feedback is waiting again`).
  - Ours now: impossible. `ResponseRecorded` is only emitted with a new submitted take (`commands.ts:103`).
  - Changes: new command `keepAfterFeedback` emitting F4; `passageRecord` treats kept as answered; a non-checkpoint step counts it complete (ADR-004), a checkpoint does not (ADR-012).
  - Data: **N** (F4: a response that keeps the reviewed take, with reason text or audio, per (take, step, reviewer)). Undo **N** (F3/F13).

### 1.5 Passage record: next step, departures

- [ ] **J-REC-8 Next step card offers every option for the suggested step; while feedback is open it only says "Then: …".**
  - Reference: `NextCard` (`ref:passage.tsx:386-515`). Recorded and not done: title `Next step` (`· can happen together` when several kinds), checkpoint pill `Checkpoint` with lock, line `{later steps} start(s) once this says Looks good.`; one `KindActionRow` per kind; `Move past this checkpoint…` (red text) for people who can override. While feedback on the latest version is open (`466-484`): dashed card `Then: {kinds}` and `After you answer / {author} answers the {kinds} feedback, so it's done on the version you keep. {x} was already asked. To start anyway, tap the step on the path.` (ADR-014). `KindActionRow` (`568-642`): kind icon, name, sub (see states at `593-603`, e.g. `Set aside: {reason}`, `Feedback answered — clears once the reviewer says Looks good`, `Recorded by {x} · the {checker} reviews it`, `Starts after the {checkpoint} checkpoint`, `Best after the {kinds} feedback is answered, so it's done on the version you keep`, `{usual reviewer} records it in {language} — new content, not a verdict`), state mark, and buttons: do it (`Review it now` / `Back-translate it`), `Ask someone` (`Ask again` when addressed), `Log what happened`, `Set aside` (not on checkpoints). Primary = do it for a reviewer, Ask someone for the author (`612`); second = Log; rest as quiet buttons in a 2-column grid (`636`).
  - Ours now: hub footer chooses one of reference/terms/record/submit/done (`passageFlow.ts:28-34`); reviewers act only via `review_passage` (`review.tsx:90-97`: outline "Suggest changes", yellow "Approve").
  - Changes: `passage_record` next-step zone computed by `passageRecord(...).next`; actions per section 4 (one yellow, others outline icons). Edges: `passage_record → review_passage` (gate reviewer, "Review it now"), `passage_record → ask_someone` (new gate `asker`), `passage_record → add_record` (new gate `contributor`).
  - Data: next step and lock **N** (F10 for checkpoints; F1 for skip); per-kind asked **N** (F6).

- [ ] **J-REC-9 Tap a step on the path to see its options (and parallel kinds as lanes, "Either order").**
  - Reference: step sheet (`ref:passage.tsx:176-191`): title `{step name}`; sub `Waits for the {checkpoint} checkpoint.` / `Checkpoint — later steps wait for this one.` / `{n} separate pieces of work, in either|any order. Steps are a suggested order — you can do this now.`; one `KindActionRow` per kind; `Move past this checkpoint…`. Lanes: `StepLanes` (`367-384`) stacks one 28px dot per kind with `Either order` / `Any order` (ADR-016).
  - Data: grouping **D** if we define "steps with the same `order` key are one parallel group" (`WorkflowStepSet.order`, `ours:workflow.ts:17-18` already sorts by it); otherwise **N**. Section 3.2.

- [ ] **J-REC-5 Skip a step with a reason ("Set aside").**
  - Reference: `Set aside` on a non-checkpoint kind row → `ReasonSheet` title `Set aside {Kind}?`, sub "The flow suggests this step. Setting it aside is fine — say why so the next person understands.", quick reasons `No one available for this right now` / `Another review already covered this` / `Not needed for this passage` (`ref:passage.tsx:31-35, 192-197`), confirm `Set aside`. `skipKind` (`ref:App.tsx:675-681`) appends a `skip` departure (by, at, reason, reasonTake); toast `{Kind} set aside · reason saved` with Undo (`Brought back — it's a suggested step again`). Kind state becomes `skipped`, counts complete (non-checkpoint). History entry `{Kind} set aside` + reason (`ref:passage.tsx:767-772`).
  - Ours now: nothing. OBT `deriveObt` is a strict chain (`obt.ts:113-137`); a non-OBT step with no eligible reviewers is a blocker (`blockers.ts:85-87`).
  - Data: **N** (F1). Permission: reference allows anyone who can translate or review (`can.contribute`); our catalog would need a privilege mapping for F1 (`ours:org.ts:110-130` maps each event type to one privilege; `translate` or `review` fits).

- [ ] **J-REC-6 Undo a departure from the history ("Undo" → "Brought back").**
  - Reference: `TimelineRow` shows an `Undo` button on any active departure for contributors (`ref:passage.tsx:804-812`); `undoDeparture` sets `undoneAt` (`ref:App.tsx:683-686`); toast `Brought back — it's a suggested step again`; history sub gains ` · brought back {at}` (`771`). The departure stays on the record.
  - Data: **N** (F3). Never `v1.Redacted` (owner/coordinator only, and it hides the event, which breaks "the record keeps both").

- [ ] **J-REC-7 Coordinator overrides a checkpoint with a reason ("Move past this checkpoint…").**
  - Reference: shown when `can.override` and the next step (or the tapped step) is an incomplete checkpoint without override (`ref:passage.tsx:184-189, 507-512`). `ReasonSheet` title `Move past the checkpoint?`, tone red, sub "Checkpoints are the flow's hard stops. Your reason is recorded with your name, and anyone can see it on the record.", quick reasons `Consultant visit is months away; church needs it now` / `Checked informally — will record it later` (`36-39`), confirm `Move past checkpoint`. `overrideCheckpoint` (`ref:App.tsx:688-693`): `override` departure; toast `Moved past the checkpoint · reason saved` (no toast Undo; history Undo works). Effect: later steps unlock; the checkpoint step itself stays incomplete (`ref:record.ts:100-102`), so the passage is not done until approval.
  - Ours now: nothing. Permission `Override Checkpoints` does not exist in our privilege list (`ours:org.ts:24-38`).
  - Data: **N** (F2, F10) and a new privilege (org catalog change; F2 maps to it).

### 1.6 Passage record: asking and logging

- [ ] **J-REC-10 Author asks someone for the step they tapped (Ask someone), with a due date, then can Undo from the toast.**
  - Reference: `AskSomeoneScreen` (`ref:passage.tsx:1097-1278`), fixed to the kind whose button opened it (ADR-020). Header `Ask for {Kind}` / `Ask someone to record` / `Ask for a new version`, sub `{passage} · {language}`. Kind card with description (or "They'll find it on their My Work, with the source and the study ready."). `Who`: segmented `Someone on the team` / `Someone without the app` (outside disabled for recording); team list with `Usually does {Kind}` group then `Others who can`; empty "Nobody on the team can do this. Try someone without the app."; outside: name ("Their name — e.g. Pastor Garang"), WhatsApp/SMS chips, phone, message preview. `Directions · optional`: voice "Say what to listen for" + "Or type them". `Your own questions · optional` ("Added to the {Kind} questions your organization and team already ask."; Yes/No, Text, 1–5). `By when · optional`: `No date` chip or native date picker (min today), shows `Due {Mon d}`. Footer `Ask {first name}` / `Send link by {channel}` / `Choose someone`. `sendRequest` (`ref:App.tsx:549-568`): creates open request, notifies assignee (`{first} asked you to {record | do a Kind}`), toast `{assignee} will see it on their My Work` or `Link sent to {name} by {channel}`, both with Undo (`Undone — nothing was sent`); `go("passage_record")` (edge popTo, `ref:flow.ts:204`).
  - Ours now: `PieceAssign` (`ours:status.tsx:153-180`, P only, role picked from `kind` param, fixed dates `Sep 15/Sep 30/Oct 15`), `GiveAssignment` five-step wizard (`ours:work.tsx:255-314`), `PickupHome` claim (`work.tsx:233-252`). All emit `v1.AssignmentMade` with a role, not a step; permission `assign_work` (admin) only (`org.ts:121`).
  - Gaps: asking is admin-only in ours; reference lets anyone with "Ask for Reviews" ask (ADR-006: a translator asks for their own review). No step target, directions voice, request questions, outside person, ISO date picker, undo.
  - Changes: new screen `ask_someone` (params `unitId`, `laneId`, `stepId` or `record`); remove `piece_assign`, `give_assignment`, `pickup_home` (see mapping table; flag if coordinators need bulk assignment). New gate `asker` in `ours:flow.ts` Gate union and `edgeAllowed`.
  - Data: **N** F6 (step target), F7 (outside person), F8 (request questions), F13 (retract a send, for Undo); asker **R** F5; directions **D** (`instructions`, text only; voice directions **N** or a blob hash field on F6); due **D** (string). Privilege: `send_to_reviewers` exists (`org.ts:35`) and fits "Ask for Reviews"; asking to record may need `assign_work` or a new one (flag).

- [ ] **J-REC-11 Someone logs a review that happened outside the app ("Log what happened"), for several passages at once.**
  - Reference: `AddRecordScreen` (`ref:passage.tsx:1367-1490`), header `Log what happened`, sub passage. `Kind of review` chips (flow kinds first, then all others); `Which version was played` (when more than one); `Also covered in this session` picker (`1302-1365`: "The same review is added to each passage you pick.", nearest 4 recorded passages in the same book, search "Find another — “Mark 2”", `Nearby in {book}`); for group kinds (community, retell) a `−` / `+` counter "How many listened?", else "Who reviewed it — e.g. Peter Lual" / "Who made it — e.g. Okello Joseph"; "Where — e.g. Bor church, after service"; `What happened`: voice "Record a summary" + "Or type what people understood and asked about"; producing kind: `The {what}` + "It's what gets checked next, so it's the one thing this entry needs." + voice `Record the {what}`; else `Evidence · optional` + "A retelling or a recorded conversation makes the review easy to trust." + voice "Record a retelling"; `How did it go?` tiles `Looks good` / `Needs changes`. Footer hint: "Choose how it went." / "Say what needs to change — record a summary or type it." / `Record or attach the {what}.`; button `Save to the record` or `Save to {n} passages`. `addRecord` (`ref:App.tsx:651-673`): one review per target with `via: "recorded"`, `givenBy`, `people`, `place`; closes my matching request; toast `{Kind} added to the record` / `{Kind} added to {n} passages` with Undo (`Undone — nothing was added`). History credits the source and says `Logged by you` (`ref:passage.tsx:751-752`).
  - Ours now: only OBT `obt_interaction` captures a community interaction (participant name, draft, comments, clips, photo; `ours:events` `ObtInteractionSet`). Non-OBT: none.
  - Changes: new screen `add_record`; entry from the history disclosure and from each kind row.
  - Data: **N** F9 (logged review: step, take, decision, credited source or people count, place, summary audio, evidence audio; counts toward the step even though the actor is not the reviewer). Our `ReviewSubmitted` is per actor and counts only eligible actors (`workflow.ts:85-91`), so reusing it would credit the wrong person and may not count at all. Undo **N** F13.

### 1.7 Passage record: details on request

- [ ] **J-REC-12 Consultant opens "Reviews by version" and then a version or a review.**
  - Reference: `Details` label, `Disclosure` (`ref:ui.tsx:213-242`: icon tile, title, one-line summary, `Show`/`Hide` with chevron, open state kept per screen key by App `detailsFor`). `Reviews by version`, summary `{n} review(s) across {m} version(s)` or `No reviews yet · {m} versions` (`ref:passage.tsx:141-147, 658-661`); `ReviewGrid` (`676-736`): version rows `v{n}` + date → `version_detail`; per-kind columns with the latest review's state mark and a count badge → `review_detail`; skipped/asked marks in the latest row; legend `Looks good`, `Needs changes`, `Feedback answered`, `Asked`, `Set aside`.
  - Ours now: `PieceStatus` "Stage history" (`status.tsx:143-148`) lists submission and each review for the current take only; `PieceVersion` / `PieceReview` (`status.tsx:201-263`).
  - Data: versions × steps **D** (`takesFor`, `state.submissions`, `state.reviews[take][step]`); asked/skipped marks **N** (F6, F1).

- [ ] **J-REC-13 Anyone opens "History" and sees every entry, newest first, with Log what happened on top.**
  - Reference: `History` disclosure, summary `{n} entries since {first date}` or `· just now` (`ref:passage.tsx:149-163, 669-673`); `Log what happened` row first for contributors when recorded; `recordTimeline` (`ref:record.ts:285-299`) merges study steps done, versions, reviews, responses, requests, departures, notes; `describeEvent` titles: `{Version N} saved`, `{Kind} · looks good|needs changes|recorded`, `Revised after {Kind}` / `Kept after {Kind}`, `Asked {x} to record` / `Asked {x} for {Kind}`, `Moved past a checkpoint`, `{Kind} set aside`, `Note · {anchor}`, `{pattern} step {n} done · {title}` (`739-784`); who line `{who} · {at}`.
  - Ours now: `ObtHistory` pager of cards for OBT (`obt.tsx:166-222`); `AssignmentProgressDetail` (`work.tsx:316+`).
  - Data: takes, submissions, reviews, responses **D** with actor and HLC time; asks **R** F5; departures **N** F1–F4; notes: our passage note is one register (`tgMaterialId` field), so older notes are overwritten; a list needs a per-note fact (out of this domain; flag). Version change note: first versions have none in ours (reference requires one per save); **N** optional.

- [ ] **J-REC-14 Version detail: "What changed", "In response to the {Kind} from {x}", recording, then Key terms / Reviews of this version / Notes disclosures.**
  - Reference: `ref:passage.tsx:839-931`. Empty state "No reviews of this version yet."
  - Ours now: `PieceVersion` (`status.tsx:201-235`): card count, "Re-recorded from an earlier take", key terms from `state.references` of kind `key_terms`, reviews list.
  - Changes: rename `piece_version` → `version_detail`; key terms from `keyTermLinks` (as `review.tsx:35` does), not legacy references; add prompted-by link from `state.responses[take].respondsToTakeId`.
  - Data: **D** except change note on first versions.

- [ ] **J-REC-15 Review detail: outcome, who, via, captured material, feedback, answers, response; the author can answer from here.**
  - Reference: `ref:passage.tsx:935-1062`: tinted outcome header `Looks good` / `Needs changes` / `{What} recorded`, `{source} · in the app | by link, no account | recorded afterwards · logged by {x}`; producing note "New content made from the version, not a verdict on it. The {checker} compares it with the source."; pills (`{n} people`, place, `Asked by {x}`); `Reviewed {Version}` / `Made from {Version}` link; `Feedback` / `Note from the back translator` card with voice take; `What was captured`; `Answers to the questions` disclosure (with "Left unanswered: {reason}"); response card `{x} revised it | kept it · {at}` + note + take + `Open {Version}`; footer for the author: `Keep it` / `Record a fix`.
  - Ours now: `PieceReview` (`status.tsx:237-263`): Approved/Suggestions card, comment, raw answer ids, version link. No answer actions.
  - Changes: rename `piece_review` → `review_detail`; add author footer; show reviewer voice comment (`state.reviewComments`); map answers to question text via `questionSetsFor` (as `review.tsx:34`).
  - Data: **D** except `via`/`givenBy`/`people`/`place`/evidence (F9), kept response (F4), unanswered-question reasons (**N**, not in `ReviewSubmitted`).

### 1.8 Toasts and undo

- [ ] **J-TOAST-1 Every action ends back on the passage record with a toast that says what changed; sends offer Undo for about 7 seconds; tapping dismisses.**
  - Reference: `setToast(text, undo?)`, timer 7000 ms with undo, 3400 ms without (`ref:App.tsx:143-150`); UI (`ref:App.tsx:1957-1975`): dark pill above the tab bar, green check disc, text, `Undo` button (min 48px), tap anywhere dismisses. `undoable()` snapshots passages, requests and notifications and restores them (`ref:App.tsx:541-547`). Undoable: `sendRequest`, `captureReview`, `saveBackTranslation`, `addRecord`, `skipKind`, `keepAfterFeedback`, study step done. Not undoable in the toast: `saveVersion`, `overrideCheckpoint`, `undoDeparture`, `addNote`. Every mutating action then `go("passage_record")` with `popTo`. ADR-008, ADR-012.
  - Verbatim toasts in this domain: `{Version N} saved · answers the {kinds} feedback`; `{Version N} saved to the record`; `{assignee} will see it on their My Work`; `Link sent to {name} by {channel}`; `{Kind} added — looks good`; `Feedback sent to {first name}`; `Back translation saved · ready for the {checker}`; `{Kind} added to the record`; `{Kind} added to {n} passages`; `{Kind} set aside · reason saved`; `Brought back — it's a suggested step again`; `Moved past the checkpoint · reason saved`; `Kept · your reason is on the record`; `Note added — it follows this passage`; undo texts `Undone — nothing was sent`, `Undone — nothing was added`, `Undone — the feedback is waiting again`.
  - Ours now: no toast. Hand-offs and reviews go to `done_await` (`ours:review.tsx:141-167`), which shows sync delivery (`handoffState`, `ours:passageFlow.ts:42-54`: blocked / queued / sent) and a check button back to My Work.
  - Gaps: no toast component; no undo; actions land on `done_await` not the record.
  - Changes: an app-level toast host in `ours:App.tsx` (beside the tab bar), a `ctx.toast(message, { undo?, icon? })`. Keep the offline truth from `done_await`: the toast icon is `CloudOff`+`Clock` when queued, `CloudCheck` when synced (reuse `handoffState`). Remove `done_await` edges from `review_passage`, `attach_questions`, `obt_passage`; replace with `popTo passage_record`.
  - Undo in an event log: reference restores a snapshot; we cannot delete an appended event (invariant 1). Two options, surfaced not blended (Rule 7): (a) hold the command for 7 s before `project.run` and drop it on Undo; nothing is appended, but a crash or kill in that window loses the action; (b) append at once and append a retraction fact on Undo (F3 for departures, F13 for sends and logs). Recommendation: (b), because departures already need F3, the record then shows "brought back" honestly, and nothing is lost offline. `ReviewSubmitted` is a register per (take, step, actor) so "change decision" already exists (`review.tsx:95-97`), but withdrawing a review needs F13.
  - Data: **N** (F3, F13) for undo; toast text **D**.

### 1.9 New facts needed (names only; each would be a new versioned event with a reducer case and permutation fixtures, per `ours:CLAUDE.md`)

| Id | Fact | Needed by |
| --- | --- | --- |
| F1 | A step was set aside for a passage, with a reason (text or audio) | J-REC-5, done rule, map filters, progress |
| F2 | A checkpoint step was overridden for a passage, with a reason | J-REC-7, lock rule |
| F3 | A departure (F1, F2, F4) was brought back | J-REC-6, toast Undo |
| F4 | Feedback was answered by keeping the take, with a reason | J-REC-4, J-WORK-2, done rule |
| F5 | Who made an assignment (already the envelope `actorId`; the reducer must keep it on `Assignment`) | J-WORK-3/4/9, J-REC-18, history. Not a new event; a state field plus reducer version bump. |
| F6 | A request names a workflow step (not only a role) | J-WORK-4/5, J-REC-8/10/18, "asked" state |
| F7 | A request to a person outside the project (name, channel, contact) | J-REC-10 outside path, `guest_review` (other domain). Privacy decision needed. |
| F8 | Questions attached to one request | J-REC-10 |
| F9 | A review logged on behalf of others (credited source or head count, place, summary audio, evidence audio), counting toward the step | J-REC-11, J-REC-15 |
| F10 | A step is a checkpoint | lock rule, path, J-REC-7, J-MAP-1 lock icons. `WorkflowStepSet` shape cannot change; new fact per step. |
| F11 | Parallel group of steps | Optional: can be derived from equal `order` keys (no new event). |
| F12 | A step produces content (back translation) and which step checks it | J-WORK-5, J-REC-8 sub-lines, J-REC-15 |
| F13 | The actor withdrew their own recent act (request, logged review, review) | toast Undo |
| — | Recent passages | device-local only (AsyncStorage), never an event |

### 1.10 Conflicts to decide (Rule 7: surfaced, not averaged)

- **C1 Where admins land.** Ours (`session.ts:106-110`, from the older spec A34) sends admins to their Manage home. Reference ADR-017 (newer, accepted) sends them to My Work with a Manage tab. Pick the reference (newer, and it is the requested direction). Clean up `homeScreenFor` tests and the spec-parity drift log.
- **C2 Done work on My Work.** `ours:PLAN.md` section 12: "The dashboard is a to-do list. Done items stay visible, struck through" (and the mock's My Work slide, `ours:docs/ux/one-next-action.html:523-533`). Reference My Work never lists done work; done shows on the Map. The user asked for reference journeys with our visual language. Recommendation: follow the reference and update PLAN section 12 and the mock (the README says "improve it when a rule changes").
- **C3 Per-take versus per-kind status.** Our `deriveTakeStatus` restarts every step on each new take. Reference keeps a kind's latest verdict across versions and counts answered feedback as complete. Pick one before building the record; section 3.
- **C4 OBT is a gated chain.** `ours:obt.ts:113-137` advances only in order and refuses decisions by the wrong role; PLAN section 6 calls these stages. The reference models Spoken as advice with one checkpoint (ADR-011) and allows set-aside and out-of-order work. Departures on OBT lanes would need `deriveObt` changes. Recommendation: render OBT lanes in the new record (path = OBT stages), but defer departures on OBT lanes until Spoken confirms (ADR-011 is still "Proposed").
- **C5 Who may ask.** Ours: `AssignmentMade` requires `assign_work` (admin). Reference: "Ask for Reviews" or "Assign Work". Translators asking for their own peer review is a core reference journey.
- **C6 Hand-off question sets.** Ours attaches question sets at hand-off (`attach_questions`, `TakeSubmitted.questionSetIds`). Reference attaches questions per request on `ask_someone` and inherits org/project/language sets. Removing `attach_questions` from the save path changes which questions reviewers see; confirm.

---

## 2. Screen-id mapping (reference → ours → action)

| Reference id (`ref:src/flow.ts`) | Ours today (`ours:apps/mobile/src/flow.ts`) | Action |
| --- | --- | --- |
| `my_work` | `assignments_home` | **Rename** to `my_work` and rebuild (J-WORK-*). Update `AVATAR`, `TITLES`, `TAB_SCREENS`, every edge naming `assignments_home` (`flow.ts:94, 121, 137, 147, 159-167, 207-208, 267`). |
| `status_home` | `status_home` | **Keep id**, rewrite content (J-MAP-1). |
| `map_home` | `language_status` | **Rename + rebuild** (search, counts, filters, testament, grouped books, language switch). |
| `book_map` | `book_status` | **Rename + rebuild** (chapter tile grid, parts sheet). Keep our share-audio action. |
| `passage_record` | `piece_status` (P), `translate_passage` (U hub), `obt_passage` hub mode | **New id; merge** all three. `translate_passage` hub tiles move into it (section 4). `obt_passage` stays as the OBT stage workspace or folds in (C4). |
| `version_detail` | `piece_version` | **Rename** and extend (J-REC-14). |
| `review_detail` | `piece_review` | **Rename** and extend (J-REC-15). |
| `ask_someone` | `piece_assign`, `give_assignment` | **New**; **remove** both old screens (C5). |
| `add_record` | none (OBT `obt_interaction` is similar) | **New**. |
| (none) | `piece_stage` | **Remove**; its content is History and Reviews by version. |
| (none) | `pickup_home` | **Remove**; the Map finds any passage and "anyone who can record can start — no assignment needed" (`ref:passage.tsx:412`). |
| (none) | `progress_home`, `assignment_progress_detail` | **Remove**; history lives on the record. |
| (none) | `done_await` | **Remove**; replaced by toast + `popTo passage_record` (keep `handoffState` for the toast icon). |
| (none) | `attach_questions` | **Remove from the save path** (C6); question browsing can stay as a record detail. |
| `workspace` | `quest_assets` | Keep ours (other domain); add edges `passage_record → quest_assets`, `quest_assets → passage_record` (popTo), `review_detail → quest_assets`, `my_work → quest_assets`. |
| `review_capture` | `review_passage` | Keep ours (other domain); add `passage_record → review_passage` (reviewer), `my_work → review_passage`, and return with `popTo passage_record` instead of `done_await`. |
| `back_translation` | `obt_passage` / `obt_manage` / `BackTranslation` | Other domain; `my_work` needs an edge to wherever back translation starts. |
| `study_guide`, `study_step` | `FiaGuide` component inside the hub (`ours:fia.tsx`) | Other domain; the record needs an entry. |
| `dynamic_bible` | `dynamic_bible` | **Keep** (ours only). Entry moves from `assignments_home` to `map_home` for dynamic-template lanes ("Find a book" → choose a new passage). |

New flow edges (reference labels in quotes, `ref:src/flow.ts` line):
`home_hub → my_work` (154); `my_work → quest_assets` "tap Record / Continue" translator (158); `my_work → review_passage` "tap Review" reviewer (159); `my_work → {back translation entry}` "tap Start" (160); `my_work → passage_record` (161); `passage_record → my_work` back (162); `status_home → map_home` (178); `map_home → status_home` back (179); `language_home → map_home` (180); `map_home → passage_record` (181); `map_home → book_map` (182); `book_map → map_home` back (183); `book_map → passage_record` (184); `passage_record → book_map` back (185); `passage_record → map_home` back (188); `passage_record → quest_assets` translator (189); `passage_record → review_passage` reviewer (190); `passage_record → ask_someone` asker (192); `passage_record → add_record` contributor (193); `passage_record → version_detail` (196); `passage_record → review_detail` (197); `version_detail ↔ review_detail`, `version_detail → key_term_detail` (198-200); `review_detail → quest_assets` translator (203); `ask_someone → passage_record` popTo / back (204-205); `add_record → passage_record` popTo / back (207-208); `inbox_home → passage_record` (303).
New gates: `asker`, `contributor` (reference `EdgeGate`, `ref:flow.ts:120-123`); map them in `ours:session.ts edgeAllowed`.
Edges to delete: all `home_hub → org_home / project_home / language_home`, `assignments_home → pickup_home / assignment_progress_detail`, `status_home → give_assignment`, `piece_*` edges, `* → done_await`, `done_await → assignments_home`, `translate_passage → attach_questions / done_await`.

---

## 3. Derived-state model: reference versus ours

### 3.1 Reference (`ref:src/domain/record.ts`)

- **Kind state** `kindStatus` (`68-77`), first match wins:
  1. latest review of the kind on **any** version is `approved` → `approved`;
  2. an open request for this kind → `asked`;
  3. latest review is `suggestions` → `addressed` if it has a response (revised or kept), else `suggestions`;
  4. an active (not undone) `skip` departure → `skipped`;
  5. else `todo`.
  Labels (`17-25`): Not yet, Asked, Needs changes, Feedback answered, Looks good, Set aside, Waits for checkpoint.
- **Step complete** (`100`): every kind complete, where complete = `approved | addressed | skipped`; for a checkpoint step only `approved`.
- **Checkpoint lock** (`90-102`): walking steps in order, the first checkpoint that is not complete and not overridden sets `gate`; every later step gets `lockedBy = gate` and its `todo` kinds show `locked`. Asked, suggestions and approved kinds keep their state under a lock.
- **Override** (`93`): an active `override` departure on the step clears the gate for later steps. It does **not** make the step complete.
- **Next** (`105, 112`): among steps not complete and not locked, the first without an override, else the first; undefined when not recorded.
- **Done** (`104`): recorded and every step complete. No flow → recorded is done. An overridden checkpoint keeps the passage not done until approval.
- **awaitingResponse** (`113`): every review with suggestions and no response, on any version. `feedbackIsMine` (`119-121`): any awaiting and the latest version's author is me.
- **passageSummary** (`124-137`): `Recorded · done` / `Done` / `Recording in progress` / `Not started` / `Feedback for you to answer` / `Waiting on {author} to answer feedback` / `Your turn: {kind}` / `Waiting on {assignee} · {kind}` / `Next: {step}` / `Version {n}`.
- **highlightsFor** (`182-225`): see J-WORK-2..6; ranking fresh → requests → drafts → feedback.
- **waitingOn** (`233-245`): see J-WORK-9.
- **languageProgress** (`150-163`): `total`, `recorded`, `done`, `steps[{name, cleared (recorded && step complete), checkpoint}]`, `waiting` (passages with an open review request).
- **Map-only derivations** (`ref:map.tsx`): `matchesFilter` (`141-149`), `chapterTone` (`497-503`: feedback > done > review > drafting > todo), chapter `cleared` = minimum steps cleared among the chapter's parts when all are recorded (`526-530`).

### 3.2 Ours (`ours:packages/core/src`)

- **Step outcome** `deriveStep` (`workflow.ts:80-118`): per take and step, eligible reviewers (assignment for the step's role > team > role holders, `126-156`), counts approve and suggest_changes by eligible actors only, applies `any | majority | unanimous`. No eligible reviewers: required → `pending` forever, optional → `passed`.
- **Take outcome** (`workflow.ts:70-75`): `archived` > `draft` (not submitted) > `changes_requested` (any required step failed) > `approved` (every required step passed) > `in_review`.
- **Current take** (`workflow.ts:168-174`): selected > newest approved > newest (may be a draft).
- **Tasks** (`tasks.ts:129-168`): translators get `translate` (todo/doing/done) or `respond` for every passage; eligible reviewers get `review` per step once submitted. OBT: one task per member per passage (`207-217`).
- **Pieces** (`status.ts:27-76`): `stage` = 'Not started' | 'Draft' | first non-passed step id; `status` unassigned | doing | waiting | done; `bottleneck`, `percentDone`, `nextAction` ("Assign translation" / "Assign {stepId}").
- **Progress** (`tasks.ts:182-205`, `readModels.ts:134-156`): `translatedPct` (submitted), `approvedPct`.
- **OBT** (`obt.ts:96-138`): single linear stage; `changes_requested` at consultant jumps back to revision, at final approval back to final recording; evidence must match the exact predecessor event.
- **Read rows** (`readModels.ts:38-104`): per passage `takeId`, `outcome`, `submitted`, `cardCount`, `steps[{stepId, eligible, decided}]`, `assignees`. No decisions (approve vs suggest) per step, no take author, no drafting flag, no per-step outcome.

### 3.3 Precise diff

| Concept | Reference | Ours | Consequence / change |
| --- | --- | --- | --- |
| Unit of status | Kind, across all versions | Step, per take | A new take in ours resets approvals from earlier takes; in the reference an approval on v1 still counts after v2. Choose (C3). If we keep per-take (safer for audio integrity: the approved audio is the audio that shipped), the "addressed" state must mean "suggestion on an older take answered by this take" and the step is re-reviewed. If we adopt per-kind, the approval no longer certifies the current audio. Recommendation: keep per-take for approval, but import the reference's **addressed completes a non-checkpoint step** rule only for non-required steps; surface to the user. |
| Complete | approved, addressed, skipped (checkpoint: approved) | `passed` by quorum | Add skipped (F1) and kept/addressed (F4, responses). Quorum stays ours (reference has no quorum). |
| Failed / needs changes | any latest `suggestions` review of the kind | required step with quorum of rejections | Reference: one reviewer's suggestion opens feedback. Ours with `majority` needs a majority. The feedback card should come from individual suggestions (`state.reviews`), even when the step has not failed. |
| Asked | open request for the kind outranks suggestions | assignment only changes eligibility | Needs F6 and a "done" rule (J-WORK-3/4). |
| Skipped | active skip departure | none | F1, F3. |
| Locked | behind the first incomplete, non-overridden checkpoint | no ordering effect at all | Needs F10 (+ F2). Order keys already exist. |
| Parallel kinds | `FlowStep.kindIds[]` | none | Derive groups from equal `order` keys (F11 optional). |
| Next | first open unlocked non-overridden step | `status.ts nextAction` = first non-passed step id (admin wording) | New `passageRecord().next`. |
| Done | recorded ∧ all steps complete; no flow → recorded | `outcome === 'approved'` (all required steps passed); no workflow → `every([])` true → approved once submitted | "No flow = recorded is done" already holds (`workflow.ts:74` with empty steps). Optional steps: ours treat non-required as ignorable; reference has no optional steps (every step counts, but can be set aside). Keep `required: false` as "complete unless it has open feedback"? Decide. |
| Recorded | any version | submitted take exists | Equivalent (section 0). |
| Drafting | draft takes exist | current take outcome `draft` with cards | Equivalent **D**. |
| Feedback mine | latest version author = me | not modelled (`tasks.ts:147`) | Use `state.takes[current].actorId`. |
| Checkpoint approval only by Looks good | yes (ADR-012) | n/a | With F10: complete iff quorum `passed`; answered feedback does not complete it. |
| Override | unlocks later steps, step stays incomplete | none | F2; privilege needed. |
| Highlights | derived from requests, reviews, drafts, with author checks | tasks for everyone eligible | New `highlightsFor`, `waitingOn`. |
| Progress | recorded, per-step cleared, done, waiting | translated %, approved %, bottleneck | New `languageProgress`; retire bottleneck in UI (ADR-004). |
| OBT | modelled as a flow (Spoken, ADR-011) | separate strict chain | Render with the same record shell; keep `deriveObt` (C4). |

### 3.4 Where these derivations should live

- One pure function in core, proposed `ours:packages/core/src/record.ts`: `passageRecord(state, unitId, laneId, actorId, idx)` returning `{ recorded, drafting, latestTakeId, latestAuthor, steps: [{ stepIds (group), checkpoint, kinds: [{ stepId, state, reviewers, askedBy?, askedOf?, departure? }], complete, lockedBy?, override? }], next, done, feedback: [{ takeId, stepId, reviewerId, comment?, commentHash? }], asks: [...] }`, plus `highlightsFor`, `waitingOn`, `languageProgress`, `recordTimeline`. It must read only its own facts and never depend on fold order (invariant 2): sort by HLC then event id, as `readModels.ts:77` does.
- Map and My Work must not fold 1,200 passages per render (the persisted-rows design in `ours:work.tsx:53-57`). Extend `PassageRow` (`readModels.ts:38-51`) with the fields the map and highlights need: `recorded`, `drafting`, `latestAuthor`, `done`, `awaitingResponse` count, `stepsCleared`, `stepsTotal`, `asks[{profileId, askedBy, stepId?, due}]`, `feedback[{reviewerId, stepId}]`. `affectedPassages` must list the new events. Add client queries: `listHighlights(actorId)`, `listWaiting(actorId)`, `languageCounts(laneId)`, `bookSummaries(laneId, filter)`, `searchPassages(laneId, query, limit)`. This is `packages/client` work (it owns rows, per `ours:CLAUDE.md`).
- Every new event needs `events.ts` type, `reducer.ts` case, `validate.ts` rule (and the SQL mirror), a privilege in `org.ts`'s event→privilege map, and fixtures in the order-independence and idempotence tests.

---

## 4. Reconciling the reference record with our visual rules

Our rules (`ours:PLAN.md` section 12, `ours:docs/ux/README.md`): Avatar U screens use one yellow action, owned by the footer on the hub; icons carry meaning and words are optional (only the passage reference is text); colour is never alone (icon + hue); four task hues only (translate blue + Mic, review teal + ListChecks, reference orange, done green); 6% tints; blocked controls stay on screen, grey, dashed, struck through; the grid never changes shape between passages. Reference record: hero "Your turn…", step path with lanes, Next step card with up to four buttons, Details disclosures, amber feedback colour.

### 4.1 Recommended layout for `passage_record` (Avatar U, with P text on request)

Top to bottom, one screen, scrolling:

1. **Header**: back button, passage reference (the only required text), language code chip. Reference sub-line `{Language} · {flow}` becomes an icon + code for U; full text in the accessibility label.
2. **Status strip (hero)**, a white card:
   - Left: the whose-turn glyph. `Your turn: …` = the user's avatar chip (`UserChip`) + the action icon (Mic for record/fix, ListChecks for review, Headphones for back translation). `Waiting on {name}` = that person's avatar chip + `Clock`. `Done` = `CheckCircle2` in done green. `Not recorded yet` = dashed `Mic` ring in muted grey. The reference headline text is the accessibility label and appears as small text only for avatar P or when the UI language setting shows text.
   - Right: a `ProgressRing` (existing `ours:ui.tsx`) showing `{cleared} of {steps}`, replacing "{n} of {m} done".
   - "Latest: …" becomes one row: event icon + actor avatar + relative time; tap opens History.
3. **Step path**: a horizontal row of step tiles, one per step group, each at least 48×48 and pressable (ADR-020: steps are buttons). Tile = the step's icon (by role/kind: Users community, ListChecks peer/review, Headphones back translation, ShieldCheck consultant/approval, Mic final recording; reuse `STAGE_ICONS`, `ours:obt.tsx:23-27`) with a state corner mark:
   - complete: done-green tint, `CheckCircle2` corner (override: `Flag` corner);
   - current (next): foreground ring and chevron, **not yellow** (the footer owns yellow);
   - asked/waiting: `Clock` corner + assignee avatar dot;
   - attention (feedback): review-teal tint + `MessageSquare` corner. The reference uses amber; our palette has no amber that is not the action yellow or reference orange, and feedback comes from review, so teal + chat icon keeps "colour never alone";
   - skipped: `SkipForward` corner, muted, not struck (it is complete, per ADR-004);
   - locked: grey, dashed border, `Lock` corner, struck through (our blocked rule).
   - Checkpoint: a small `Lock` badge on the tile's top edge in all states (reference `PathDot` badge).
   - Parallel group (ADR-016): two half-height tiles stacked in one column joined by an `ArrowUpDown` glyph ("Either order" as icon; text in the accessibility label).
   - The row never changes shape for the same flow; steps behind a checkpoint stay visible as blocked tiles.
   - Tapping a tile opens a bottom sheet with that step's kind rows (below).
4. **Feedback card** (author only, J-REC-3/4): review-teal 6% tint, reviewer avatar (or `Users` + count for logged group feedback), the voice comment as an `AudioClip` first, text second and optional. Two controls: outline `Keep` button (icon `Hand` or `ShieldCheck`, label optional) that opens our reason sheet; `Record a fix` is **the footer's yellow action** (`Mic` + `Reply`). Non-authors see the same card without controls and a `Clock` + author avatar ("Waiting on {author}").
5. **Next step zone** (J-REC-8): the next step's kind rows, each a white row: step icon, state corner, and its secondary actions as outline icon buttons with fixed positions: `UserPlus` Ask someone, `ClipboardPlus` Log what happened, `SkipForward` Set aside (hidden on checkpoints, shown blocked-dashed rather than removed to keep shape), and `Flag` "Move past this checkpoint…" in `danger` for people with the override privilege. The primary action of the next step (Review it now / Back-translate it / Ask someone for the author) is **the footer yellow**, so the row itself never shows yellow. ADR-014's "every option visible" holds: all options are on screen as icons. ADR-014's "Then: …" state (feedback open) = the next step's row rendered dashed with a `Clock` + `MessageSquare` badge and no action buttons; the footer stays on Record a fix.
6. **Preparation tiles** (keeps our hub): the existing 6-tile grid from `translate.tsx:85-101` (Reference material, Key terms with ring, Recordings, Study/FIA, Questions, Notes), shown when the user can translate and the passage is not done. The "Hand off" tile disappears because "Save version" in the recording screen is the hand-off (section 0), or stays as the blocked-dashed tile until a draft exists, to keep the grid shape. Decide one; recommendation: replace "Hand off" with "Study" (FIA), which the reference suggests before the first recording (ADR-018), so the grid keeps six tiles.
7. **Details** (ADR-013): three collapsed rows at the bottom, each an icon tile + count badge + chevron, with the reference's one-line summary as the text line for avatar P and the accessibility label for U: `Sparkles` Study (`{done} of {n} steps`), `Grid3x3` Reviews by version (`{n} reviews across {m} versions`), `History` History (`{n} entries since {date}`). Open state per passage kept in App state (like `detailsFor`), so Back from a version returns with it open.
8. **Footer**: exactly one yellow `ActionButton`, chosen by one pure function `recordNextAction(passageRecord, session)`:
   - feedback is mine → Record a fix (`Mic`);
   - not recorded, can record → Record it (`Mic`), or Study (`Sparkles`) if the study is unfinished and no draft (ADR-018 advice; recording stays one tap away in the tiles);
   - I was asked for the next step → Review it now (`ListChecks`) / Back-translate it (`Headphones`);
   - I authored the latest version and the next step is not asked → Ask someone (`UserPlus`);
   - done and can record → New version (`Mic` + `Plus`), else back to My Work (`ArrowRight`);
   - nothing mine → no yellow footer; the status strip shows whose turn it is.
   This is the same "derived, never stored" rule the README requires for the yellow.

### 4.2 Other screens

- **My Work**: keep our to-do row look (tinted row, task icon, passage reference, trailing mark) for For you cards. Kind → icon and tint: Respond = review teal + `MessageSquare`; Record = translate blue + `Mic`; Review = review teal + `ListChecks`; Back-translate = `Headphones`; Continue = translate blue + `Mic` with a partial ring. Reference pills ("Respond", "Record", "Review", "Start", "Continue") become the trailing icon; text only for P. The yellow footer is the top For-you card's action (as `ours:work.tsx:187-195` already does with `next`). Section headers ("For you", "Recent", "Waiting on others") can be icons (`Inbox`, `History`, `Clock`) with counts. Waiting rows show the assignee avatar + `Clock` + due date.
- **Map / book map**: P-leaning but also used by translators to find work. Chapter tiles use our hues with icons: done = green + check; feedback = teal + chat; in review = teal 6% + step bar; drafting = blue dashed + mic; not recorded = muted dashed. "For you" = a small yellow dot is **not allowed** (yellow is reserved); use the user's avatar dot or a `Star`/`Inbox` corner. Filter chips and counts are text (P).
- **Ask someone / Log what happened**: P-leaning forms, but voice-first inputs stay first (directions, summary, evidence), matching our `VoiceRecorder`/hold-to-record patterns (`ours:translate.tsx:230-237`). Quick reasons in reason sheets become icon + short text chips; "Say why" by voice is the primary input (principles, "The cost of explaining").
- **Toast**: dark pill above the tab bar, never yellow; leading icon = what happened (Send, CheckCircle2, SkipForward, Flag) plus `CloudOff`+`Clock` when queued offline; `RotateCcw` Undo button 48px for 7 s.
- **Disclosure**: port `ref:ui.tsx:213-242` to a React Native `Disclosure` in `ours:apps/mobile/src/pui.tsx` or `ui.tsx` with our tokens (white card, icon tile in the section's hue, chevron, `Show`/`Hide` text optional for U).

### 4.3 Things that do not fit and need a decision

- Reference Next step rows can show four text buttons (ADR-014). Our U rule is one main action per screen. Recommendation above: one yellow footer + outline icon buttons. Test icon comprehension for Ask someone / Log / Set aside with translators before shipping (the README already asks for this kind of test).
- Reference copy is instructional prose ("Record a fix to answer it, or keep this version and say why."). Our U rule: instructions are audio, never prose. Every reference sentence in this domain needs an audio prompt (like `ObtPrompt`, `ours:obt.tsx:28-32`) or appears only for avatar P.
- Amber as "attention" has no slot in our palette. Proposed: review teal + chat icon for feedback; `danger` only for override.
