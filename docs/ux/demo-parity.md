# Bringing the app to the UX demo

The mobile app follows the partner demo in `ng-langquest-ux` (branch
`caleb-spoken-mobbin-overhaul`): its flow, look and capabilities. This page
is how the port is organised and the conventions every screen keeps. The
demo's `docs/requirements.md` (IDs like REC-3) and `docs/decisions.md`
(ADR-nnn) are the specification; cite them in comments where a rule comes
from them.

## What maps to what

| Demo | Here |
| --- | --- |
| `src/flow.ts` screens and edges | `apps/mobile/src/flow.ts`, generated from `test/spec-flow.json` (`npx tsx scripts/extractSpecFlow.ts ../ng-langquest-ux`); `specParity.test.ts` holds it edge by edge |
| `domain/session.ts` homes and gates | `src/session.ts` (`homeScreenFor`, `manageHomeFor`, `mapScreenFor`, `edgeAllowed`, `tabsFor`) |
| `data.ts` `C`, `TINT`, `ui.tsx`, `screens/shared.tsx` | `src/theme.ts`, `src/kit.tsx`, `src/voiceNote.tsx` |
| `domain/record.ts` (passage state, highlights, progress, timeline, grid, study) | `packages/core/src/passage.ts`, over events in `record.ts` |
| App state `passages`, `requests`, `notes`, `studyDone`, departures | the event log: takes and `v1.TakeSubmitted` (versions), `v1.ReviewRecorded`, `v1.RequestMade`/`Withdrawn`, `v1.DepartureRecorded`/`Undone`, `v1.NoteAdded`, `v1.StudyStepMarked` |
| `REVIEW_KINDS`, `REVIEW_FLOWS` | core `DEFAULT_KINDS`, `FLOWS`; `v1.ReviewKindDefined`, `v2.WorkflowStepSet` |
| a back translation (`ReviewKind.produces`) | `v1.ReviewRecorded` with outcome `recorded` and the cards in `artifactHashes` |
| `toast` / `undoable()` | `ctx.act(specs, message, undo)` and `ctx.toast` |
| `detailsFor(key)` | `ctx.details(key)` |
| `recentByPerson` | `ctx.recent`, `ctx.openPassage` |
| `notifications` | `ctx.inbox` (core `updatesFor`) plus server notifications for join requests |
| `fia.ts`, `bible.ts`, `chapterText.ts`, `studyText.ts` | `src/study/`, `src/scripture.ts` |

Demo-only tools are not ported: the guide and scenarios, the screen map,
partner comments, persona sign-in cards, the Reset button and colour themes.
The dev menu (`src/DevMenu.tsx`) is the app's way to switch persona.

The per-domain briefs the port was done from are in git history
(`docs/ux/port-briefs/`, removed after the port).

## Conventions every screen keeps

- **Files.** One file per domain under `src/screens/`, as in the demo. Each
  exports its screen components by name and ends with
  `export const contracts = contractsFor(...)` naming its screens
  (`src/screenContracts.ts` declares what each screen may emit; the test
  fails when a screen's code names an event its contract does not).
- **Reading.** Screens read the fold (`ctx.project.state`) through core
  derivations with `indexesFor(state)`: `usePassage(ctx)` from
  `src/passageView.ts` for anything under a passage. Never store a status.
- **Writing.** Screens call core `commands(state, indexesFor(state))` and
  hand the specs to `ctx.act(specs, 'What changed.', undo?)`. Anything sent
  to someone, added to the record, set aside or saved by an admin offers
  Undo (CORE-5): `undo` returns the inverse specs (`undoDeparture`,
  `withdrawRequest`, ...). Never append raw events from a screen when a
  command exists; if one is missing, it belongs in core.
- **Navigating.** Only `ctx.go(screen, params)` along an edge in `flow.ts`,
  `ctx.back()`, and `ctx.openPassage(unitId, laneId)`. Params are strings:
  `unitId`, `laneId` for anything under a passage; `takeId` (version),
  `reviewId`, `kindId`, `requestId`, `stepId`, `bookId`, `termId`,
  `what` (`record` | `review`) as needed.
- **Look.** `src/kit.tsx` only: `Screen`, `Header` (passage crumbs via
  `passageCrumbs`; task screens pass `close`), `Card`, `Group`, `Row`,
  `SectionLabel`, `Disclosure` (with `ctx.details(key)`), `PrimaryBtn` (one
  per screen), `GhostBtn`, `SmallBtn`, `Chip`, `Sheet`, `ReasonSheet` (with
  `voiceFor(ctx, unitId, laneId)`), `StateMark`/`StepMarks`, `KindIcon`,
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

Every screen of the demo exists and follows its flow, look and wording
(`specParity.test.ts` holds the 183 edges). Walked end to end in the iOS
simulator on a local Supabase: sign in, create an organization, a project
and a language, choose a flow, seed a team; as the translator, My Work, the
Map, a passage record, the workspace and the FIA study; as the reviewer,
Review it, the record updating, set aside with a reason, the Inbox. All
events were accepted by the server's validation and permission rules.

### Not ported yet

Demo-only tools are out of scope (see above). Beyond those:

**Needs new events or a server endpoint**
- Dividing a book into passages (TPL-4..7): starting, joining and naming
  passages, FIA's breaks applied, drafts, Review & publish, published
  versions, moving recordings to a changed part. `book_structure` is read-only.
- Template tasks (TPL-8), custom library templates and outline editing (TPL-9).
- Review by link (REV-7): the link is never sent and a guest cannot submit;
  `guest_review` is a preview.
- Undo for a review, a note, a new project or language, a sent invite, a new
  role or material (these events are grow-only or have no inverse yet).
- A spoken reason for a skipped question (`ReviewRecorded.skipped` is text).
- A review team's kind (FLOW-5), deleting a team, a project description,
  roles defined below the organization, the organization's region.
- Joining by QR without an email account (AUTH-3). The scan screen names the
  organization only when the phone already knows it; showing who it's for,
  the role and the inviter needs a server lookup by token (links carry only
  the org and token, so they can't be spoofed or leak names).
- Linking an email, changing email, photo, bio (AUTH-7).

**Needs data the app does not have**
- Recorded prompts for Listen (ONB-1, ONB-2): no Listen buttons.
- Glossary entries on key terms outside a study guide; an FIA marker on key
  terms (the app recognises a `fia:` term id prefix).
- Audio for the BSB/WEB/KJV readings and the Luke 15 and John 3 study steps
  (the reader follows a simulated clock, and says so); passage text beyond
  Genesis 1-3, Luke 14-16, John 2-4 and the guide passages.
- Photos on study notes (no image picker); video in study media.

**Deliberately left out for now**
- Practice passages, coach-mark tours and celebrations (ONB-3, ONB-4, ONB-6
  beyond creating an organization): the Getting started card is built.
- A native date picker when asking someone (chips plus a typed date).

**Events built without a core command**
- Org partition (no core commands exist for it): `v1.OrgCreated`,
  `v1.RoleDefined`, `v1.OrgMemberAdded`/`Removed`, `v1.CatalogItemToggled`,
  `v1.ProjectRegistered`.
- Legacy project roles in Edit Member: `v1.MemberRoleChanged`,
  `v1.MemberRemoved`.
- Structure: `src/orgAdmin.ts` (review teams, adding a language),
  `src/contentTemplates.ts` (template selection and its units), and the dev
  seed.

**Known rough edges**
- Opening a newly created project remounts the workspace under a screen that
  then calls Back; React Navigation logs a dev-only warning.
- A local native build needs an Xcode whose Swift accepts `weak let`
  (`expo-modules-jsi` in Expo 57); Xcode 26.0.1 does not. EAS builds are
  unaffected.
