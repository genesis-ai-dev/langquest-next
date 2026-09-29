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

Tracked in the section below as domains land.

### Done

- Core record model, server migration, flow machine, session, tokens, kit, shell.

### Not ported yet

See the end of this page once the domains are in.
