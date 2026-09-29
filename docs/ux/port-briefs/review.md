# Brief: reviewing

Read `_common.md` first.

## You own
- `apps/mobile/src/screens/review.tsx`: `ReviewCapture` (`review_capture`), `AddRecord` (`add_record`), `GuestReview` (`guest_review`)
- `apps/mobile/src/reviewing/` (new directory); `apps/mobile/test/reviewCapture.test.ts` (new)

## Demo sources
`src/screens/review.tsx` (all), `src/screens/passage.tsx` (`AlsoCoveredPicker` use, add_record), `src/screens/shared.tsx`. Requirements REV-1..8. ADR-005, ADR-015, ADR-028.

## Also read
`audioClip.tsx`, `voiceNote.tsx`, `study/guides.ts`, `study/progress.ts`; core `derivePassage`, `questionsForKind`, `unitPlace`, `recordReview`, `produceContent`, `addRecording`, `keyTermsForUnit`.

## ReviewCapture (params unitId, laneId, kindId, optional requestId, takeId)
- Task screen with ✕, crumbs. Listen to the version (takeId or latest) and what changed.
- For the kind that checks produced content (a kind whose id is some producing kind's `produces.checkedBy`): "Back translation to compare" at the top, playing the latest producing review's `artifactHashes`, warned when made from an older version.
- Background (collapsed `Disclosure`s): notes and key terms from the translator, "The team's study" (`studyProgress`), earlier reviews. When the kind `withholdsContext`, hide them and say so.
- Questions: one list labelled by source (`questionsForKind` with the open request): Yes/No, 1–5, text. A required question must be answered or skipped with a reason ("Can't answer this?" -> `ReasonSheet`).
- Feedback by voice (`VoiceNote`) or text.
- Looks good (every required question handled) / Needs changes (also needs what to change) -> `ctx.act(recordReview({takeIds:[takeId], kindId, outcome, via:'app', comment, commentBlobHash, answers, skipped, requestId}))`, then `ctx.go('passage_record', ...)`. No Undo (a review is grow-only).

## AddRecord (params unitId, laneId, kindId): "Already happened"
- The same screen plus: who gave it, or how many listened; where; which version was played (pick among versions); other passages the same session covered (nearby passages in the same book suggested, search for more).
- Save to every passage picked (each one's latest version) with `recordReview(... via:'logged', givenBy, people, place ...)`.
- A producing kind asks for its recording instead of an outcome: record `source` cards and save with `produceContent({ via:'logged', ... })`.

## GuestReview (preview)
Link reviews need a server endpoint that does not exist yet. Show what someone without the app sees (who asked and their note, the recording, up to 3 questions, voice or text reply, "Understood it well" / "Some parts unclear"), clearly labelled as a preview with submitting disabled and one line saying why.
