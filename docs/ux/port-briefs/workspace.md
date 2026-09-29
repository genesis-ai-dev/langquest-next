# Brief: recording and back translation

Read `_common.md` first.

## You own
- `apps/mobile/src/screens/translate.tsx`: `Workspace` (`workspace`), `BackTranslation` (`back_translation`)
- `apps/mobile/src/recording/` (new directory); `apps/mobile/test/workspace.test.ts` (new)

## Demo sources
`src/screens/translate.tsx` (all), `src/screens/shared.tsx`, `src/ui.tsx`. Requirements REC-W1..6, REV-5, TERM-4. ADR-015, ADR-028.

## Also read
`useRecorder.ts`, `audioClip.tsx`, `recordingFlow.ts` (`pendingPassageCards`), `blobs.ts`, `passageSourceAudio.tsx`, `study/guides.ts`, `study/progress.ts`, `scripture.ts` (another agent fills it; code against the API). The previous recorder, removed on this branch: `git show main:apps/mobile/src/screens/recordings.tsx` and `git show main:apps/mobile/src/screens/translate.tsx`. Keep the VAD takeover (60-bar energy history, drag cutoff, pause chips, red full screen, stop) and the durability rules (card ids chosen before saving, journal target, `triggerUpload`). Core: `addRecording`, `keepTake`, `publishVersion`, `produceContent`, `addNote`, `derivePassage`, `keyTermsForUnit`.

## Workspace (params unitId, laneId, optional requestId, reviewId)
- Task screen: `Header` with `close`, passage crumbs.
- Banner: "Revising after {kind} feedback" quoting it, or "{name} asked · due …".
- Source text from `readingsFor` with inline verse numbers, key terms underlined (tap -> `key_term_detail` termId), terms tied to the draft marked. No text: say so and offer `PassageSourceAudio`.
- Card list starts from the draft take or the latest version's cards, plus `pendingPassageCards`. Each card plays and deletes. Every change persists with `keepTake`. Cards saved with `addRecording(kind 'target')`.
- Big red record button (80pt, stop square while recording) opening the VAD takeover (port into `src/recording/`).
- Publish disabled until the list differs from the latest version; confirm sheet ("Your team will be able to hear it and review it."); first version optional note, later versions must say what changed (text or `VoiceNote`); show feedback it answers and key terms tied. `ctx.act(publishVersion)`, then `ctx.go('passage_record', ...)`. Ids via `Crypto.randomUUID()`.
- Study tray: key terms with rendering or "No rendering yet", "Tie to your draft" (append `v1.KeyTermLinked {takeId: draftTakeId, termId}` via `ctx.project.appendMany`; in the contract), study progress with steps -> `study_step`, "Open the study" -> `study_guide`, notes with "Add a note" (`addNote`), older-version notes marked, version history.
- Controls disabled while saving or recording; retry failed saves.

## BackTranslation (params unitId, laneId, kindId, optional requestId)
- Task screen with ✕; banner: record it back into `kind.produces.into` in your own words; notes, terms and history hidden on purpose.
- Listen to the latest version (say which).
- Record cards as `addRecording(kind 'source')`; list with play and delete.
- "Save back translation" with optional note -> `ctx.act(produceContent({fromTakeId: latest.takeId, kindId, cardHashes, note, requestId}))`, then `ctx.go('passage_record', ...)`.
