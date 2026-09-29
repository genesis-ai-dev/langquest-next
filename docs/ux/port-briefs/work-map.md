# Brief: My Work and the Map

Read `_common.md` first.

## You own
- `apps/mobile/src/screens/work.tsx`: `MyWork` (`my_work`)
- `apps/mobile/src/screens/map.tsx`: `StatusHome` (`status_home`), `MapHome` (`map_home`), `BookMap` (`book_map`)
- `apps/mobile/src/canon.ts` (new): reference search ported from the demo's `src/canon.ts`, over core `BIBLE_BOOKS`
- `apps/mobile/test/canon.test.ts` (new)

## Demo sources
`src/screens/work.tsx`, `src/screens/map.tsx`, `src/canon.ts`, `src/ui.tsx`, `src/screens/shared.tsx`. Requirements ONB-5, ONB-7, WORK-1..4, MAP-1..8. ADR-009, ADR-017.

## Core
`highlightsFor`, `waitingOn`, `upNext`, `languageProgress`, `derivePassage`, `passageSummary`, `unitPlace`, `laneName`, `deriveKinds` (passage.ts); `laneLeafUnits` (indexes.ts); `BIBLE_BOOKS` (catalogData.ts).

## My Work
- Header "My Work" with a small sync chip (cloud icon, `ctx.project.pending`, live state) to `sync_status`.
- For you: `highlightsFor(state, actorId, { canRecord: can('translate'), canReview: can('review') }, idx)`, 5 then "Show all". Buttons: respond opens the record (`ctx.openPassage`); record -> `workspace` (unitId, laneId, requestId); review -> `review_capture` (unitId, laneId, kindId, requestId); produce -> `back_translation` (same); draft -> `workspace` ("Continue"). Respect edge gates.
- Recent: `ctx.recent` up to 5, with `passageSummary` and `StepMarks` (each step -> `{ kinds, checkpoint: step.step.checkpoint }`).
- Waiting on others: `waitingOn`, 3 then "Show all", `dueText`.
- A language label only when lists span several lanes.
- Nothing waiting: Up next via `upNext(state, ctx.laneId, ...)`; point to the Map tab in words (no my_work->map edge).
- Getting started card (ONB-5): hidden flag in AsyncStorage `first-day-hidden:${actorId}`; param `showGettingStarted === '1'` clears it. Rows from real state with a why and one button on the next row, done rows ticked, later dimmed, "N of M done", Hide. Workers: find your passages on the Map (done when `ctx.recent` non-empty); record your first passage (translators; any version by you) or give your first review (reviewers). Admins (`session.isAdmin`): name the org (done), create a project (`new_project`), add a language (`new_language`), choose how passages get checked (`flows_home`; done when `state.laneFlows[laneId]`), decide who can do what (`roles_home`), invite your team (`invite_member`; done with more than one member). No practice passages or coach-mark tours.

## Map
- StatusHome: per lane, `languageProgress`: recorded X of Y, cleared each step (checkpoints with a lock), done; totals; search when more than 5 languages. Tap: `ctx.setLane(laneId)`, `ctx.go('map_home', { laneId })`.
- MapHome (lane from params or `ctx.laneId`): language chips when several lanes; reference search ("joh 3", "ps 23", "1 cor 13:4", "cor" finds both Corinthians; book alone lists books; with a chapter lists passages 25 at a time); counts; filter chips with counts, hidden when empty (All, Feedback waiting, With reviewers, In review, Done, Not recorded); OT/NT toggle; book rows by canon section with progress bar, "N for you" badge and feedback count -> `book_map` (laneId, bookId). Group leaf units by `unitPlace(...).bookId`; no book -> "Other".
- BookMap: chapter tiles coloured by state (done, feedback waiting, in review, recording started, not recorded, no passage). Several units in a chapter -> `Sheet` of parts; one -> its record. Param `filter` fades other tiles. "Edit passages" -> `book_structure` when `can('shape_templates') || can('manage_templates')`. Crumbs back to the language map.
