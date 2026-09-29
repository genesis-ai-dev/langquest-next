# Brief: the passage record

Read `_common.md` first.

## You own
- `apps/mobile/src/screens/passage.tsx`: `PassageRecord` (`passage_record`), `VersionDetail` (`version_detail`), `ReviewDetail` (`review_detail`), `AskSomeone` (`ask_someone`)
- `apps/mobile/src/passage/` (new directory) for helpers; `apps/mobile/test/passageRecord.test.ts` (new)

## Demo sources
`src/screens/passage.tsx` (all), `src/screens/shared.tsx`, `src/ui.tsx`, `src/domain/record.ts`. Requirements CORE-*, REC-1..10, ASK-1..5. ADR-005, 007, 012, 013, 014, 015, 016, 020, 021.

## Also read
`study/guides.ts` (`guideFor`), `study/progress.ts` (`studyProgress`), `audioClip.tsx`, `UserChip.tsx`; core `derivePassage`, `feedbackIsMine`, `recordTimeline`, `reviewGrid`, `questionsForKind`, `KIND_STATE_LABEL`, `stepName`, `keyTermLinksFor`, `privilegesFor`; commands `depart`, `undoDeparture`, `ask`, `withdrawRequest`, `addNote`.

## PassageRecord
- Hero: headline ("Your turn…", "Waiting on {name}", "Next: {step}", "Done", "Not started", "Feedback for you to answer"), "N of M done", latest event, step path (Recorded then each step: complete, current, to do, locked with checkpoint name, needs attention, waiting; lock for checkpoints, flag for overrides; one lane per kind in a multi-kind step, "Either order"). Steps tappable -> sheet of that kind's actions, "Best after…" while feedback is open (ADR-014).
- Kind actions, all visible: Review it now (`review_capture`, kindId) or a producing kind's own action (`kind.produces.action` -> `back_translation`); Ask someone / Ask again (`ask_someone`, what=review, kindId); Already happened (`add_record`, kindId); Set aside (not on checkpoints) -> `ReasonSheet` with `voiceFor` -> `ctx.act(depart skip, ..., undoDeparture)`. The latest version's author gets Ask as the main button; a reviewer or someone asked gets Review it now. Gate buttons by permission.
- One Next step card: before the first recording "Study it first" when `guideFor` has a guide (-> `study_guide`) with "Record it" (-> `workspace`); while feedback is open only "Then: {kind}, after you answer the feedback"; complete: "Every step of {flow} is complete."
- Feedback cards: only the latest version's author sees "Record a fix" (`workspace` with reviewId) and "Keep it, say why" (depart keep with reviewId; Undo); others see "Waiting on {author}". Credit with `feedbackSource`.
- Checkpoints: with `override_checkpoints`, "Move past this checkpoint" (depart override with stepId; Undo).
- Details as `Disclosure`s with `ctx.details('passage:'+unitId+':…')`: the study (steps, who finished each -> `study_step`), Reviews by version (`reviewGrid`; cells -> `review_detail`), History (`recordTimeline`; withdraw open requests, undo departures). "Add a note" (text or voice, passage anchor).
- "recorded" not "looks good" for producing kinds (`outcomeText`). No flow: recorded is done.

## VersionDetail
"Version N", what changed (voice if any), feedback it answered, playable takes (`AudioClip`), key terms tied (-> `key_term_detail`), reviews of it, notes made on it (`onTakeId`).

## ReviewDetail
Outcome, source (`viaText`), who gave it, people and place, version (-> `version_detail`), feedback text and voice, answers (labels from `questionsForKind`; skipped with reasons), artifacts, the response. The author can answer from here (Record a fix -> `workspace`; Keep it, say why).

## AskSomeone
Fixed to params what=record|review and kindId; no kind switcher. Eligible teammates: project members (`state.members`) and org members covering the project/lane (`privilegesFor(ctx.org.state, id, { projectId, laneId })`) with translate (record) or review (review); ranked "Usually does {kind}" (on a review team for the lane in `state.teams`, or reviewed this kind here before), then everyone else. Someone without the app (reviews only): name, WhatsApp or SMS, phone, message preview. Optional directions (text or `VoiceNote`), own questions (Yes/No, text, 1–5), By when chips (No date, Today, In 3 days, In a week, In 2 weeks) plus a YYYY-MM-DD field. Send -> `ctx.act(ask, ..., withdrawRequest)` then `ctx.go('passage_record', {unitId, laneId})`.
