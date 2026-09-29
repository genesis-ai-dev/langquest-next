# Brief: study guides and passage text

Read `_common.md` first.

## You own
- `apps/mobile/src/screens/study.tsx`: `StudyGuide` (`study_guide`), `StudyStep` (`study_step`)
- `apps/mobile/src/study/` (fill in `guides.ts`; keep its exported types and `guideFor` signature; add files), `apps/mobile/src/scripture.ts` (fill in; keep `Verse`, `Reading`, `readingsFor`, `sourceText` signatures)
- `apps/mobile/test/study.test.ts` (new)

Other agents already call `guideFor(state, unitId)`, `studyProgress`, `readingsFor(state, unitId)` and `sourceText(state, unitId)`; do not change their signatures.

## Demo sources
`src/screens/study.tsx`, `src/fia.ts`, `src/fixtures/fia-gen-p2.json`, `src/studyText.ts`, `src/bible.ts`, `src/chapterText.ts`, `src/screens/shared.tsx` (`useAudio`, `AudioBar`, `MediaTile`, `MediaSheet`, `StudyStepRows`). Requirements STUDY-1..7. ADR-018, ADR-019.

## Content
- Port the guides: the FIA Genesis 2:4–25 guide from the fixture (copy the JSON into `src/study/`), and the demo-written Luke 15 and John 3 guides, in the `StudyGuide` shape with stable ids.
- `guideFor`: match a unit to a guide by book and verse overlap (core `unitPlace` for book and chapters; parse the unit label or FIA `verseRange` for verses).
- Port `studyText.ts` (sections, inline parts, `clock`).
- `scripture.ts`: the demo's readings (BSB/WEB/KJV for the guide passages, simulated verse timings) and WEB chapter text (Luke 14–16, Genesis 1–3, John 2–4) so `readingsFor` returns real text for those units. Other units return [].

## StudyGuide (params unitId, laneId)
Steps grouped by phase with the team's progress, who finished each (`ctx.name`), note counts; next step highlighted; Start / Continue -> `study_step` (stepId); "Record it" -> `workspace` for translators. A Passage view toggle (below).

## StudyStep (params unitId, laneId, stepId)
- "Step 3 of 6 · 2 done" with `Segments`.
- The step's audio (play, scrub, back 10 s) using expo-audio `createAudioPlayer` (see `audioClip.tsx` and `audioSession.ts` for session rules). When paused: "Add a note at m:ss". Timed notes listed; tapping one seeks.
- The text broken into sections; tap to select, then Add a note, or Answer a question; notes (text or `VoiceNote`) show under their section. Anchor `{ kind:'study', guideId, stepId, sectionId?, at? }` via `addNote`.
- Inline links: pictures and maps in a `Sheet` (remote `url` with a stand-in fallback), glossary terms in a sheet with the glossary entry (open `key_term_detail` only when a matching key term exists).
- "Done with this step" (translate) -> `markStudyStep` with Undo; moves to the next unfinished step by changing the stepId param (no new screen). The last step hands off to "Record the first draft" -> `workspace`.
- Passage view on both screens: the passage in several translations (`readingsFor`), audio that highlights the verse being read, "Add a note on {verse}" (anchor verse).
