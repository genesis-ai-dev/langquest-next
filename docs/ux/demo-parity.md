# Bringing the app to the UX demo

Kind: reference

The mobile app follows the partner demo in `ng-langquest-ux` (branch
`caleb-spoken-mobbin-overhaul`): its flow, look and capabilities. This page
is how the port is organised and the conventions every screen keeps. The
demo's `docs/requirements.md` (IDs like REC-3) and `docs/decisions.md`
(ADR-nnn) are the specification; cite them in comments where a rule comes
from them.

## What maps to what

| Demo | Here |
| --- | --- |
| `src/flow.ts` screens and edges | `apps/mobile/src/shell/flow.ts`, generated from `test/spec-flow.json` (`npx tsx scripts/extractSpecFlow.ts ../ng-langquest-ux`); `specParity.test.ts` holds it edge by edge |
| `domain/session.ts` homes and gates | `src/session.ts` (`homeScreenFor`, `manageHomeFor`, `mapScreenFor`, `edgeAllowed`, `tabsFor`) |
| `data.ts` `C`, `TINT`, `ui.tsx`, `screens/shared.tsx` | `src/theme.ts`, `src/kit.tsx`, `src/voiceNote.tsx` |
| `domain/record.ts` (passage state, highlights, progress, timeline, grid, study) | `packages/core/src/passage.ts`, over events in `record.ts` |
| App state `passages`, `requests`, `notes`, `studyDone`, departures | the event log: takes and `v1.TakeSubmitted` (versions), `v1.ReviewRecorded`, `v1.RequestMade`/`Withdrawn`, `v1.DepartureRecorded`/`Undone`, `v1.NoteAdded`, `v1.StudyStepMarked` |
| `REVIEW_KINDS`, `REVIEW_FLOWS` | library flows (docs/library.md): each `flow@1` document carries its kinds; a language uses one through `v1.ReviewKindDefined`, `v2.WorkflowStepSet`, `v2.LaneFlowSelected` |
| `content.ts` templates, `RefMaterial`, study guides | library items (docs/library.md): `template@1`, `material@1`, `study@1` / `collection@1` documents, published by an organization, shared, copied or followed; LangQuest's starters seeded from `library/` |
| a back translation (`ReviewKind.produces`) | `v1.ReviewRecorded` with outcome `recorded` and the cards in `artifacts` |
| `toast` / `undoable()` | `ctx.act(specs, message, undo)` and `ctx.toast` |
| `detailsFor(key)` | `ctx.details(key)` |
| `recentByPerson` | `ctx.recent`, `ctx.openPassage` |
| `notifications` | `ctx.inbox` (core `updatesFor`) plus server notifications for join requests |
| `fia.ts` | FIA study material in the library through `scripts/fia-adapter.ts`; found per passage by `src/study/guideMatch.ts` |
| `bible.ts`, `chapterText.ts`, `studyText.ts` | `src/study/`, `src/scripture.ts` |

Demo-only tools are not ported: the guide and scenarios, the screen map,
partner comments, persona sign-in cards, the Reset button and colour themes.
Nor is the demo's project level: Project Home and New Project are left out
and an organization holds its languages directly (docs/decisions.md 34;
`DROPPED_SCREENS` in `src/flow.ts`, which both parity tests read).
The dev menu (`src/DevMenu.tsx`) is the app's way to switch persona.

The per-domain briefs the port was done from are in git history
(`docs/ux/port-briefs/`, removed after the port).

## Conventions every screen keeps

- **Files.** One file per domain under `src/screens/`, as in the demo. Each
  exports its screen components by name and ends with
  `export const contracts = contractsFor(...)` naming its screens
  (`src/screenContracts.ts` declares what each screen may emit; the test
  fails when a screen's code names an event its contract does not).
- **Reading.** Screens read the fold (`ctx.language.state`, and the
  organization's `ctx.org.state`) through core
  derivations with `indexesFor(state)`: `usePassage(ctx)` from
  `src/passageView.ts` for anything under a passage. Never store a status.
- **Writing.** Screens call core `commands(state, indexesFor(state))` and
  hand the specs to `ctx.act(specs, 'What changed.', undo?)`. Anything sent
  to someone, added to the record, set aside or saved by an admin offers
  Undo (CORE-5): `undo` returns the inverse specs (`undoDeparture`,
  `withdrawRequest`, ...). Never append raw events from a screen when a
  command exists; if one is missing, it belongs in core.
- **Navigating.** Only `ctx.go(screen, params)` along an edge in `flow.ts`,
  `ctx.back()`, and `ctx.openPassage(unitId, languageId)`. Params are strings:
  `unitId`, `languageId` for anything under a passage; `takeId` (version),
  `reviewId`, `kindId`, `requestId`, `stepId`, `bookId`, `termId`,
  `what` (`record` | `review`) as needed.
- **Look.** `src/kit.tsx` only: `Screen`, `Header` (passage crumbs via
  `passageCrumbs`; task screens pass `close`), `Card`, `Group`, `Row`,
  `SectionLabel`, `Disclosure` (with `ctx.details(key)`), `PrimaryBtn` (one
  per screen), `GhostBtn`, `SmallBtn`, `Chip`, `Sheet`, `ReasonSheet` (with
  `voiceFor(ctx, unitId, languageId)`), `StateMark`/`StepMarks`, `KindIcon`,
  `NoteCard`, `Banner`, `Field`, `SearchField`, `ShowMore`, `Badge`,
  `ProgressBar`, `EmptyState`. Colours from `C` and `TINT`; status colours
  never carry meaning alone (an icon goes with them).
- **Words.** The demo's wording, including "you" for the viewer
  (`ctx.name(id)`), credit to whoever gave feedback (`feedbackSource`),
  "looks good" / "needs changes" / "recorded" (`outcomeText`), times via
  `when(hlc)`.
- **Scale.** Whole Bible: no screen lists every passage; long lists cap and
  offer `ShowMore` (ADR-009).

## Status

Every screen of the demo exists and follows its flow, look and wording,
except the dropped project screens (`specParity.test.ts` holds the edges).
Walked end to end in the iOS simulator on a local Supabase: sign in, create
an organization and a language, choose a flow, seed a team; as the translator, My Work, the
Map, a passage record, the workspace and the FIA study; as the reviewer,
Review it, the record updating, set aside with a reason, the Inbox. All
events were accepted by the server's validation and permission rules.

App-only screens (each edge is in `specParity.test.ts`'s drift log with its
reason): Sync, Delete Account, the Reports section, Write a Guide
(`guide_editor`, from Reference Material and from a study guide's Edit or
Copy to adapt; `src/guides/`, docs/reference-material.md), and Share nearby
(`share_nearby`, from Sync on an Android phone or an iPhone whose organization
has it on, labelled experimental; docs/nearby-sync-plan.md 5.8 and section
7's phase 5; joining without internet and the install file stay Android
only). Share nearby keeps the kit and the conventions above: 48 pt rows, its
one main action a 56 pt button, help lines on every part, and words that
wrap. Joining without
internet adds two more on the same terms (docs/nearby-sync-plan.md 14.1): Let
someone in (`let_someone_in`, from Share nearby for someone holding a pass for
the language), whose code, one tap and two pictures let a new phone in, and
Join without internet (`join_offline`, a guest screen from Scan a code), the
new phone's progress through the ask and the starting copy. Get the install
file (`get_install_file`, from Share nearby, from Let someone in's line
that the new phone needs the app first, and from the install file item on
Sync and offline's Ready for offline list; docs/nearby-sync-plan.md 14.4) is the
part done online before a trip: the start of the file's name (its versions), Get the install file
as its one main button, Check my file, the too-old word and how to pass the
file on. Give the app (`give_app`, from Share nearby and Let someone in;
docs/nearby-sync-plan.md 14.5) hands the file to a new phone over this phone's own Wi-Fi.
Let someone in keeps only the field: role, code, pictures, one tap.

### Not ported yet

Demo-only tools are out of scope (see above). Beyond those:

**Needs new events or a server endpoint**
- Dividing a book into passages (TPL-4..7): starting, joining and naming
  passages, FIA's breaks applied, drafts, Review & publish, published
  versions, moving recordings to a changed part. `book_structure` is read-only.
- Template tasks (TPL-8), custom library templates and outline editing (TPL-9).
- Review by link (REV-7): the link is never sent and a guest cannot submit;
  `guest_review` is a preview.
- Undo for a review, a note, a new language, a sent invite, a new
  role or material (these events are grow-only or have no inverse yet).
- A spoken reason for a skipped question (`ReviewRecorded.skipped` is text).
- A review team's kind (FLOW-5), deleting a team, roles defined below the
  organization, the organization's region.
- Joining by QR without an email account (AUTH-3). The scan screen names the
  organization only when the phone already knows it; showing who it's for,
  the role and the inviter needs a server lookup by token (links carry only
  the org and token, so they can't be spoofed or leak names).
- Linking an email, changing email, photo, bio (AUTH-7).

**Needs data the app does not have**
- Recorded prompts for Listen (ONB-1, ONB-2): no Listen buttons.
- Glossary entries on key terms the team wrote itself (FIA's key words now
  carry FIA's meaning and recording outside a study guide, decision 172).
- Audio for the BSB/WEB/KJV readings and the Luke 15 and John 3 study steps
  (the reader follows a simulated clock, and says so); passage text beyond
  Genesis 1-3, Luke 14-16, John 2-4 and the guide passages.
- Photos on study notes (no image picker); video in study media on phones
  (guides written in the guide editor play films in the web app only).

**Deliberately left out for now**
- Practice passages, coach-mark tours and celebrations (ONB-3, ONB-4, ONB-6
  beyond creating an organization). The Getting started card was built and
  then removed (decision 71); the welcome offers one "Get started".
- A native date picker when asking someone (chips plus a typed date).

**Events built without a core command**
- Organization stream (no core commands exist for it): `v1.OrgCreated`,
  `v1.RoleDefined`, `v1.MemberAdded`/`Removed` with a scope, and
  `v1.LanguageAdded` (New Language lists the language in the organization,
  then picks its template and flow in the language's own stream, decision 63).
- Structure: `src/orgAdmin.ts` (review teams, adding a language),
  `src/templates/contentTemplatesModel.ts` (template selection and its units), and the dev
  seed.

**Known rough edges**
- A local native build needs an Xcode whose Swift accepts `weak let`
  (`expo-modules-jsi` in Expo 57); Xcode 26.0.1 does not. EAS builds are
  unaffected.

## The spec's domain in the event log

Moved here from PLAN.md section 13 on 2026-11-19.

The spec's domain (`ng-langquest-ux/src/data.ts`) maps onto the event log
like this. Where the spec forced a model change, it is noted. The record
model (kinds, flows, reviews by kind, departures, requests, notes, study) is
earlier on this page; the role-based workflow model it replaced is
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
| Assignment: what, who, note | `RequestMade` (record or review; a person, a guest or a team) and `RequestWithdrawn` | **added** `note` (`dueDate` too, but it is no longer set or shown, decision 126; old events may still carry it); a request is done when what it asked for happens |
| To Do / Doing / Done | `upNext`, `highlightsFor` and `waitingOn` (core `passage.ts`) | todo: asked or next; doing: a draft exists; done: the flow is through |
| Piece work status | derived per passage (`derivePassage`: recorded, steps complete, done) | reports (`languageReport`) |
| Bottleneck ("3 in Community Check") | passages by the first step not yet complete (`languageProgress.steps`) | reports |
| Reference material (TMF, Brief, TG, FIA study), key terms | library material (study guides and collections, simple documents, question sets) matched to passages by verses through their versifications; the organization's own working material as `MaterialDefined` + `MaterialFieldSet`; `KeyTerm*` events | a v2 project's source content is imported as material |
| Inbox | `updatesFor` (core `passage.ts`): what concerns the actor on the record, plus server notifications | read state is per device |
| Role gates on edges (`when`) | `Gate` on `Edge` in `apps/mobile/src/shell/flow.ts`, `edgeAllowed` in `session.ts` | one privilege per gate (`session.can`) |
| Roles with privilege switches, member scope (org / language) | organization stream: `RoleDefined`, `MemberAdded { scope }` (core `org.ts`); one role per scope | fixed roles are seed roles; `effectiveRole` maps back |
| Sharing templates, flows and material between organizations | library items: shared / followable per item, copied or followed (`Library*` events, `library_adopt`) | decision 36; recommendations are `ReferenceRecommended` and `ReferenceSet` (decision 62) |
| Who may use an organization's work, and what outsiders see | `v1.LicenseSet` in the organization stream (`orgLicense`, `LICENSE_INFO[..].terms`); outsiders read a projection, never the log | **added**, not in the demo (decision 38, docs/licensing.md); only ever opens |
| Whether this phone sends field diagnostics | Settings › App › Send diagnostics, a switch row (`diag:off` in device meta, `src/diagnosticsSetting.ts`); diagnostics are never events | **added**, not in the demo (decision 39, docs/diagnostics.md); on by default, and off deletes what is waiting |
| Reporting content or a person, and blocking someone | a flag on anything someone else made (`reportSheet.tsx`); `content_reports` and `user_blocks` rows sent through the account outbox, never events; a moderator removes content with `v1.Redacted`, staff act through `npm run moderation`; a blocked person's words and audio are hidden behind Show and their work still counts | **added**, not in the demo (decision 48); Google Play requires it |
| Sharing work between phones with no internet | Share nearby (`share_nearby`), from Sync while the organization has it on, labelled experimental (`src/screens/nearby.tsx`, `src/nearby/`); rows a teammate's phone sent are `nearby` in the events table until the server confirms them, and "Hold teammates' recordings" is `nearbyHold` in device meta; nothing new is an event | **added**, not in the demo (docs/nearby-sync-plan.md 5.8); Android phones and iPhones (section 7's phase 5), through `.native` files, never the web |
| A new person joining a team with no internet | Let someone in (`let_someone_in`), from Share nearby for someone holding a join pass for the language, shows a code holding only how to reach the phone, a secret and a pin; the new phone scans it on Scan a code, types a name on Join without internet (`join_offline`, a guest screen), and one tap beside two matching pictures lets them in under a role with no manage privilege; a starting copy follows; they work as a local person (`nearby-local-person` in the Keystore) until first contact makes their account; Get the install file (`get_install_file`, from Share nearby, from Let someone in, and from Sync's Ready for offline card, which reminds a carrier while online when this phone lacks the file it needs) names the install file this phone's versions need (core `carriedApkName`, the carried build the Worker serves at `/apk/<name>`), which a carrier downloads in the browser while online, checks by name, and passes on outside the app; nothing new is an event | **added**, not in the demo (docs/nearby-sync-plan.md 14.1, 14.4); Android only, through `.android` files, behind `nearby_join` |
