# Gap analysis: "Do the work" domain

Reference: `ux` clone on `caleb-spoken-mobbin-overhaul` (HEAD `52a3933`), called **REF** below.
Ours: `/Users/ryderwishart/frontierrnd/langquest-next` on `ux/spoken-mobbin-overhaul` (`f948ab4`), called **OURS**.

Paths are relative to each repo root. REF paths start `src/`. OURS paths start `apps/mobile/src/` or `packages/core/src/`.
This analysis is read-only. It changed no code.

Scope: study guides (`study_guide`, `study_step`, PassageReader, anchored study notes, "Done with this step"), the recording workspace (`workspace`, study tray, key terms, save version), back translation (`back_translation`), review capture (`review_capture`, "… to compare", Background disclosures), guest review (`guest_review`), Spoken's stages 0–7 (`src/domain/spoken.ts`), FIA (`src/fia.ts`, `src/domain/fiaStory.ts`), and the scenarios (`src/domain/scenarios.ts`).

Sources I read in full: REF `AGENTS.md`, `docs/design-principles.md`, `docs/decisions.md` (ADR-011, 015, 016, 018, 019, 020), `docs/spoken-feedback.md`, `src/flow.ts`, `src/screens/study.tsx`, `translate.tsx`, `review.tsx`, `src/domain/spoken.ts`, `fiaStory.ts`, `scenarios.ts`, and the relevant parts of `src/App.tsx`, `src/screens/shared.tsx`, `src/screens/passage.tsx`, `src/domain/record.ts`, `src/data.ts`, `src/fia.ts`. OURS: `PLAN.md` sections 4, 6, 12, 13, 16, `docs/ux/README.md`, `docs/ux/spoken-worldwide-workflow.md`, `docs/fia-guided-study.md`, `apps/mobile/src/flow.ts`, `screens/translate.tsx`, `review.tsx`, `recordings.tsx`, `passageSlides.tsx`, `obt.tsx`, `obtCapture.tsx`, `dynamicBible.tsx`, `fia.tsx`, `passageFlow.ts`, `passageResources.ts`, `packages/core/src/events.ts`, `obt.ts`, `fia.ts`, `workflow.ts`, `tasks.ts` (parts), `materials.ts` (parts), `catalog.ts` (flows), `commands.ts` (signatures), `bibleAudio.ts`, `dynamicBible.ts` (parts), `apps/mobile/test/specParity.test.ts` (head), `smart-tests/` layout.

---

## 0. Cross-cutting findings (read these first)

1. **The two apps use different words for the same things.** You must fix this vocabulary before you port a screen, or every journey will be wrong:

   | REF word | REF data | OURS equivalent | OURS data |
   | --- | --- | --- | --- |
   | take (one part of a recording) | `PieceTake` in `version.takes[]` | card (one VAD segment) | `Card` in `v1.RecordingAdded.cards` |
   | version ("Version 2") | `PassageVersion {id, takes, changeNote, submittedBy}` | a kept take, submitted | `v1.TakeComposed` + `v1.TakeSubmitted` |
   | draft takes not saved yet | `passage.draftTakes` | pending cards | `pendingPassageCards()` (`recordingFlow.ts`) |
   | save a version | `saveVersion()` REF `src/App.tsx:499` | keep take, then hand off | `commands.keepTake` + `commands.submitTake` |
   | review (any kind) | `PassageReview {kindId, versionId, outcome}` | review of a take at a step | `v1.ReviewSubmitted {takeId, stepId, decision}` |
   | ask someone | `Assignment` (request) | assignment | `v1.AssignmentMade` (no kind, no external contact) |
   | back translation | a review with `produces` and `artifacts` | OBT step or a standard review step | `v1.ObtStepRecorded{step:'back_translation'}` or `v1.ReviewSubmitted` |
   | study step finished | `StudyCompletion` | FIA progress field | `v1.MaterialFieldSet` on `fia-progress:<lane>`, field `fia-progress:<actor>:<unit>:<stage>` = `complete` |
   | study note / answer | `ContextNote{anchor:{kind:'study', stepId, sectionId?, at?}}` | none | — |
   | verse note | `ContextNote{anchor:{kind:'verse', verse, translation?, at?}}` | none (one passage note per unit) | `tgMaterialId(lane)` field per unit (`materials.ts:47`) |

   Recommendation: in code and copy, use REF's user words ("take", "version", "Save Version 2"). Keep OURS' event names. Put the mapping in a comment at the top of the new `workspace` screen.

2. **Our flow machine is pinned to the old spec.** `apps/mobile/test/specParity.test.ts` checks our `EDGES` against `test/spec-flow.json`. That file came from REF `origin/main`. The REF branch renames or removes most screen ids in this domain (see section 2). Adopting REF screens will fail the parity test until someone re-vendors `spec-flow.json` from the branch's `src/flow.ts`. Plan that as step 1 of the port.

3. **We run two workflow systems. REF runs one.** OURS has the standard review flow (`workflow.ts`, `v1.ReviewSubmitted`) and a separate OBT journey (`obt.ts`, `deriveObt`, six OBT events). REF has one record with review kinds. A kind can produce content (`ReviewKind.produces`, REF `src/data.ts:263`) or withhold context (`withholdsContext`, `data.ts:258`), and a step can be a checkpoint. PLAN.md section 16 already says "OBT is not a separate template". All Spoken journeys below assume we move to REF's model. Keep folding OBT events forever (PLAN 16.1 rule 5). **This is a conflict to surface (Rule 7).** `docs/ux/spoken-worldwide-workflow.md` documents OBT as implemented and shipped (reducer version 3, protocol 2). REF and PLAN 16 are newer and replace it. I recommend REF/PLAN 16. Flag `spoken-worldwide-workflow.md` for rewrite.

4. **Our passage hub does not match PLAN 16.** `screens/translate.tsx:85-101` renders six tiles (Reference, Key terms, Recordings, Hand off, Review question sets, Passage notes). PLAN 16 says three tiles (*Listen & record*, *Reference*, *Hand off*), and review questions move to the reviewer. REF goes further: the record screen (`passage_record`, other domain) is the hub, and `workspace` is one screen. My recommendation (section 3) is to make `workspace` the *Listen & record* tile's screen, the study the *Reference* tile's first item, and put "Save Version N" in the yellow footer.

5. **Most facts in PLAN 16.1 do not exist yet.** grep finds none of `ContentProduced`, `StudyStepFinished`, `ContextItemAdded`, `ReviewKindDefined`, `StepSetAside`, `ShareFeedbackRecorded`, `KeyTermRenderingSet`, `v2.WorkflowStepSet` in `packages/core/src`. Every journey that needs them is marked **needs new fact**.

6. **Dependencies on other domains.** My journeys enter and leave through screens that other analysts own: `my_work` (REF `work.tsx`), `passage_record` / `ask_someone` / `add_record` / `version_detail` / `review_detail` (REF `passage.tsx`), and `key_term_detail` (REF `config.tsx`). I cite them where a journey needs them. I do not specify them.

7. **FIA content licensing.** `docs/fia-guided-study.md` says "The app does not bundle licensed FIA lessons". REF ships FIA's real API content for Genesis 2:4–25 (`src/fixtures/fia-gen-p2.json`, adapter `fiaGuideFromApi`, REF `src/fia.ts:77`). Porting REF's FIA journeys word for word needs a decision: get FIA's permission to use the API content, or let managers keep supplying text and audio per step (OURS today). The screens below work with either source.

8. **Real verse timings are an advantage we have.** REF simulates verse timing (`src/bible.ts`, "timings are estimated from verse length", ADR-019). OURS has real BSB timings (`BSB_HAYS_TIMINGS`, `packages/core/src/bibleAudio.ts:1,31`) and BSB verse text (`bibleText()`, `dynamicBible.ts:62`). The Passage reader should use them. WEB and KJV are not in our data. The reader can start with BSB only and add more translations later.

---

## 1. Journey checklist

Format of each journey:
- **Persona**
- **REF steps**: screen, tap, and copy (verbatim), with file:line
- **OURS now**: file:line
- **Gaps**
- **Changes**: files, screen ids, flow edges
- **Data**: what is derivable today (function or event) and what needs a new fact (the fact name only)

### Study guides (FIA)

- [ ] **J-STUDY-1 — The translator starts the FIA study from the passage and answers a Hear and Heart question**
  - **Persona:** Akol Deng, Dinka translator (REF `scenarios.ts:186-199`, "fia-study"). Nyakim is the same persona for Spoken stage 0.
  - **REF steps:**
    1. `my_work` → "Open Genesis 2:4–25 under Recent" → `passage_record` (`scenarios.ts:189`).
    2. Next step card: "Study it first · 6 FIA steps", subline "Next: Hear and Heart. Your team's answers stay with the passage for reviewers." Buttons: **"Start the study"** (primary), **"Record it"** (secondary), and "Ask someone to record it" below (`passage.tsx:416-446`). After some progress the button reads "Continue the study". When the study is finished: "FIA study done · all 6 steps".
    3. `study_guide` (`study.tsx:56-144`). Header `"FIA study"`, sub `"Genesis 2:4–25 · Dinka"`. ViewSwitch has two tabs, **"FIA steps"** and **"Passage"** (`:79`). The summary card shows the pattern badge, the source, `guide.about`, "N of 6 steps done" or "Every step done", the note count, a ProgressBar, and "By Akol Deng and …" or "Nobody has started yet" (`:30-35, 86-100`). Steps are grouped by phase: Familiarize / Internalize / Articulate (`:103-126`). Each row has a StudyStepMark, the title, the purpose, and a line: "Next", "Done by X · Sep 2", "N notes" or "Not started" (`record.ts:372`). The footnote reads "What you add while studying stays with this passage. Reviewers see it next to the draft, so they know the study was done." (`:127-129`). The footer shows **"Start: Hear and Heart"** / **"Continue: {step}"**, or **"Record the first draft"** when every step is done and nothing is recorded (`:132-141`). The footer shows only when `canStudy` (Translate permission).
    4. Tap "Start: Hear and Heart" → `study_step` (`study.tsx:148-291`). Header is the step title, sub `"FIA · step 1 of 6 · Genesis 2:4–25"` (`:191`). ViewSwitch: **"FIA step"** / **"Passage"** (`:192`). A sticky bar has six progress segments and an AudioBar labelled "Listen to this step" / "Playing this step" / "Paused" (`:199-207`). A purpose line follows, with " Tap any part to add a note." (`:218-221`). The step's markdown is split into sections (`studySections`, REF `src/studyText.ts:19`).
    5. Tap a question section (it ends in "?") → it is selected, and the button **"Answer"** appears (mic icon, primary colour). For other sections the button is **"Add a note"** (amber) (`:361-366`).
    6. ContributeSheet: title "Your answer" or "Add a note", sub "It stays with the passage, and reviewers see it with the study." (`:520`). It shows the quoted place (`{step} · {section}`), a VoiceRecorder "Record what the group said", a textarea "Or type it", "Add a photo (a storyboard, a drawing)", and **"Save"** (`:509-541`). Saving calls `addStudyContribution` (REF `App.tsx:714`). The toast reads "Added to the study — reviewers will see it with the passage". The note shows under its section, with an amber count badge (`:355-371`).
    7. Tap **"Done with this step"** (footer, check icon, only when `canStudy && !done`, `:271-272`) → `finishStudyStep` (REF `App.tsx:739-757`). The toast reads "Hear and Heart done · 1 of 6", with undo. The app moves to the next unfinished step on the same screen (no navigation). After the last step it goes to `study_guide`.
    8. When the step is done, the footer shows "✓ Done by You · Just now" and **"Next: {step}"**, or "All steps" (`:266-277`).
  - **OURS now:**
    - Entry is the FIA button on the hub: `FiaGuide` in `fia.tsx:130-218`, mounted in `screens/translate.tsx:83-84` and `screens/obt.tsx:114-116`. It is an outline BookOpen button, "Open FIA guided study". It opens a **Modal**, not a screen, so it is outside `flow.ts`.
    - The modal shows one stage at a time. It has six stage chips (`:185-190`) and a large stage icon (`:191-194`). For Hear only, it plays `PassageSourceAudio` (`:195-196`). Each supplied study field is a card with guidance audio and text (`:197-201`). Nav is Previous / Close.
    - The footer is yellow ArrowRight, "Complete this stage and continue". On Speak it is Mic, "Record the passage" (`:179-182`). Completing writes `v1.MaterialFieldSet` `fia-progress:<actor>:<unit>:<stage>` = `complete` (`:161-167`).
    - Text is plain (`<Text>{f.text}</Text>`). There are no sections, no notes, no answers, no photos, no guide overview, no phases, no "Done by", no Passage tab, no undo.
  - **Gaps:**
    1. No `study_guide` screen (overview, phases, progress, people).
    2. No `study_step` screen. The modal is not a flow node, so the flowchart and parity test cannot see it.
    3. Step text is not split into sections, and sections cannot be tapped.
    4. No answers or notes on sections. No photo.
    5. "Done" is per person and silent. REF shows team progress, "Done by", and a toast with undo.
    6. Completing a stage is the only way to move forward. REF lets you open any step, and "Done with this step" is separate from "Next".
    7. The record screen has no "Study it first" advice card (depends on the `passage_record` domain).
    8. The permission differs: OURS needs `fill_reference`, or `manage_reference` (`fia.tsx:147-148`). REF uses Translate for finishing steps, and Translate, Review or Fill Reference Content for adding notes (REF `App.tsx:1512`).
  - **Changes:**
    - `apps/mobile/src/flow.ts`: add `'study_guide'` and `'study_step'` to `SCREEN_IDS`, `AVATAR` (both **U**), and `TITLES`.
    - Edges, copied from REF `flow.ts` "Studying before drafting":
      - `passage_record→study_guide`
      - `passage_record→study_step`
      - `study_guide→study_step`
      - `study_guide→workspace` (gate `translator`)
      - `study_step→study_guide` (`popTo`)
      - `study_step→key_term_detail`
      - `study_step→workspace` (gate `translator`)
      - `workspace→study_step`
      - `workspace→study_guide`
      - `review_capture→study_guide`
      - `review_capture→study_step`
      - the back edges REF lists
    - Until `passage_record` exists, add temporary edges `translate_passage→study_guide` and `obt_passage→study_guide`, and log them in `specParity.test.ts` `APP_ONLY`.
    - New file `apps/mobile/src/screens/study.tsx` exporting `StudyGuide(ctx)` and `StudyStep(ctx)`, plus `contracts = contractsFor('study_guide','study_step')`.
    - Retire the `FiaGuide` Modal (`fia.tsx:130-218`). Replace it with a Reference-tile entry that calls `ctx.go('study_guide', {unitId, laneId})`.
    - Move REF `src/studyText.ts` (`studySections`, `inlineParts`, `plainText`, `sectionIdFor`, `sectionLabel`, `clock`, `secondsOf`) into `packages/core/src/studyText.ts`. It is pure TypeScript.
    - Add `phase` and `purpose` to `FIA_STAGES` (`packages/core/src/fia.ts:8-15`). Use FIA's names (REF `src/fia.ts:21-32`): Familiarize / Internalize / Articulate, and "Hear and Heart" … "Speaking the Word".
    - Add a `studyStatus(state, laneId, unitId)` read model in core, the equivalent of REF `record.ts:341-362`, built on `fiaStudiesFor` + `fiaStageContent` + progress fields.
  - **Data:**
    - **Derivable today:**
      - The step text and audio per stage: `fiaStudiesFor()` (`core/fia.ts:61`) and `fiaStageContent()` (`:82`). Each stage has one `text` and one `blobHash`, which matches ADR-019's "one document + one audio".
      - Step finished, team-wide: any field `fia-progress:*:<unit>:<stage>` with text `complete`, using `fiaProgressField()` (`:76`). "Done by" is the actor encoded in the fieldId. "at" is the register `hlc`.
      - Undo is another `MaterialFieldSet` with the text `''`. The register is LWW (last writer wins), so this works.
    - **Conflict to surface:** PLAN 16.1 proposes a new `v1.StudyStepFinished`. The existing field mechanism already folds commutatively and supports undo. I recommend keeping it and not adding `StudyStepFinished`, unless the team wants progress outside materials. Flag this for a decision.
    - **Needs new fact:** answers and notes anchored to a section of a study step, or to the step as a whole, with optional voice and photo. The fact is PLAN 16.1's `v1.ContextItemAdded` with anchor `{kind:'study', materialId, stageId, sectionId?, at?}`.
    - Photo blobs already work (`photoHash` jpg in `ObtInteractionSet`, `obtCapture.tsx:90`).
    - **Also a gap:** section ids come from the order of sections (ADR-019 consequence). Store the material field's `eventId` on the note, so a later text edit can be detected and the note re-anchored.

- [ ] **J-STUDY-2 — The translator pauses the step audio and adds a note at 3:12**
  - **Persona:** Akol (REF `scenarios.ts:195`): "Play Setting the Stage, pause it, and add a note at that moment". Spoken stage 0 has fixture note sn10 at "2:05" (`spoken.ts:53-54`).
  - **REF steps:**
    - On `study_step`, the AudioBar plays the step's own file (`useAudio(step.audio.url, step.audio.seconds)`, `study.tsx:176`).
    - While paused with time > 0, an extra button appears: **"Add a note at {m:ss}"** (amber note icon, `:208-214`).
    - The ContributeSheet quote reads "Audio at 3:12".
    - Saved notes list at the top under **"Notes on the audio"** (`:223-239`). Each shows a dark time chip, the text, and "{who} · {when} · voice 1:05". Tapping a note seeks the audio (`audio.seek`).
    - The toast reads "Note added at 3:12 — it stays with the study".
  - **OURS now:**
    - The stage guidance audio is an `AudioClip` (`fia.tsx:198-199`). It has no pause-to-note and no time readout for notes. Notes do not exist.
  - **Gaps:**
    - No note at a moment.
    - No list of timed notes.
    - No seek-to-note.
  - **Changes:**
    - In `StudyStep`, use `AudioClip`, or extend it (`audioClip.tsx:26`) to expose the current time and `seek`. It already has `seekControls` (used at `obt.tsx:243`).
    - Show a secondary button "Add a note at {clock}" when paused.
    - The "Notes on the audio" card sorts by `secondsOf(at)`.
  - **Data:**
    - Audio duration and position: derivable in the client.
    - The note itself **needs new fact:** `ContextItemAdded` with anchor `{kind:'study', …, at:'3:12'}`.

- [ ] **J-STUDY-3 — The translator switches to the Passage view, plays it in two translations, and adds a verse note**
  - **Persona:** Akol (REF `scenarios.ts:192`): "Tap Passage, play it in two translations, then tap a verse and add a note". Fixture fn10 anchors to verse 2:18 BSB (`fiaStory.ts:49-50`).
  - **REF steps:**
    - ViewSwitch "Passage" → `PassageReader` (`study.tsx:395-426`). Switching pauses the step audio (`:193`).
    - Translation pills: BSB / WEB / KJV (`:414-422`).
    - `TranslationView` (`:428-506`): the AudioBar is labelled `"{passage} · {translation id}"` with the translation name as sub. The playing verse is highlighted and auto-scrolled (`:440-446`).
    - Tap a verse → **"Add a note on {ref}"** (`:479-484`). When paused: **"Add a note at {m:ss} · verse {ref}"** (`:452-458`).
    - Sheet "Add a note", with the place `"{title} · verse {ref} · {translation}{ · at}"` (`:500`).
    - Notes show under their verse, labelled "WEB · 1:05" (`:485-490`).
    - Footnote: "Notes on the passage stay with it, like the rest of the study, and reviewers see them with the team's notes." (`:495-497`).
    - When there is no text: "The demo doesn't have the Bible text for {title}. In the app, it comes from the translations your organization chooses." (`:405-411`).
    - `addPassageNote` (REF `App.tsx:728-737`) toasts "Note added on {verse} — it follows this passage".
  - **OURS now:**
    - Only on the Hear stage, `PassageSourceAudio` plays the source (`fia.tsx:195-196`).
    - `dynamic_bible` shows BSB text as one block (`screens/dynamicBible.tsx:60-61`).
    - There is no verse-by-verse view, no highlighting, no verse notes, and no translation choice.
  - **Gaps:**
    - The whole PassageReader is missing.
    - We have one source Bible at a time (`sourceBibles.ts`).
  - **Changes:**
    - Build `PassageReader` inside `screens/study.tsx`, used by both study screens.
    - Verses come from `bibleText(range)` (`core/dynamicBible.ts:62`) for dynamic units. FIA catalog units need a verse range: map the pericope `itemId` to a range. **Gap:** check that `FIA_PERICOPES` carries verse bounds.
    - Highlight the current verse from real timings (`BSB_HAYS_TIMINGS` via `bsbPassageBounds`, `bibleAudio.ts:31`), and play with `PassageSourceAudio`.
    - Start with one pill per enabled source Bible (`sourceBibleEnabled`, `sourceBibles.ts:17`).
  - **Data:**
    - Text, timing and audio: **derivable today** for BSB.
    - The verse note **needs new fact:** `ContextItemAdded` with anchor `{kind:'verse', verse, translation?, at?}`.
    - The current `tgMaterialId` passage note is a single register per unit (`materials.ts:47`, `translate.tsx:190-244`), so it cannot hold many anchored notes.

- [ ] **J-STUDY-4 — The translator opens a linked picture or map, and a glossary term (FIA Master Glossary)**
  - **Persona:** Akol (REF `scenarios.ts:196`): "Tap a linked picture or map in the text, then go to 5 · Filling the Gaps and tap "Heaven"". Nyakim taps "Sin" (`spoken.ts:131`).
  - **REF steps:**
    - Inline links render as underlined primary-colour buttons with an icon: map / book / camera (`study.tsx:294-311`).
    - A media link opens `MediaSheet` (title, description, low-res images, "FIA media", `:285-288`; `shared.tsx:323`).
    - A term link calls `onOpenTerm(termId)` → `key_term_detail`, which shows a "FIA Master Glossary" card (REF `config.tsx:925-933`).
  - **OURS now:** no inline links, no resources, no media sheet. `key_term_detail` exists as an Avatar P screen.
  - **Gaps:**
    - Resources are not modelled.
    - There is no FIA badge on key terms.
    - There is no glossary entry.
  - **Changes:**
    - Parse `[label](#ref)` with core `inlineParts`.
    - Store the resources of a study material as material fields named `resource:<ref>` (text = JSON title/description/kind/termId, blobHash = image). This is a naming convention, not a new event.
    - Add a `MediaSheet` component to `apps/mobile/src/ui.tsx` or `pui.tsx`.
    - Add edge `study_step→key_term_detail`.
  - **Data:**
    - Resources: derivable from `v1.MaterialFieldSet` by convention.
    - Glossary entry on a key term: the term exists (`v1.KeyTermDefined`). The glossary body, hint and audio have no home. **Needs new fact or convention:** attach them as a material field keyed `glossary:<termId>` on the FIA material, which is derivable, or use `ContextItemAdded` anchored to the term.

- [ ] **J-STUDY-5 — The translator finishes the study and records the first draft**
  - **Persona:** Akol (REF `scenarios.ts:197`): "Go back to the steps, open 6 · Speaking the Word, and tap Record the first draft".
  - **REF steps:**
    - On the last step with `canStudy`, a light card reads "When the group agrees on its version, record it as the first draft." with the button **"Record the first draft"** (mic). It reads **"Open the recording workspace"** if versions exist (`study.tsx:252-260`).
    - On `study_guide` with every step done and nothing recorded, the footer shows "Record the first draft" (`:137-139`).
    - Both lead to `workspace`, where the tray shows the study.
  - **OURS now:** On Speak, the modal footer "Record the passage" closes the modal and calls `onSpeak` → `quest_assets` (`fia.tsx:168`, `translate.tsx:83-84`).
  - **Gaps:**
    - This mostly exists, but the destination differs (`quest_assets` instead of `workspace`).
    - In OURS the Speak stage never records "complete" (`fia.tsx:161`, deliberate). In REF, Speak is completed by "Done with this step" like any other step. Keep OURS' rule that opening the recorder is not completion, and add an explicit "Done with this step" on Speak as well.
  - **Changes:** edges `study_step→workspace` and `study_guide→workspace` (gate `translator`).
  - **Data:** derivable. "Recorded" is `currentTake()` (`workflow.ts:168`).

- [ ] **J-STUDY-6 — The consultant sees the team's study as evidence** (REF scenario "fia-review", `scenarios.ts:200-209`)
  - **Persona:** Peter Lual, consultant.
  - **REF steps:**
    1. `my_work` "Tap Review on Genesis 2:4–25 under For you" → `review_capture`. The request card shows "Akol Deng asked · due Oct 3" with the note "We studied this with FIA first. Our notes on "heavens" and "helper" are in the study." (`fiaStory.ts:66-70`, `review.tsx:79-87`).
    2. The Background label, then the Disclosure **"The team's study"** with summary `"FIA · 6 of 6 steps · 9 notes"` (`review.tsx:164-177`). Inside: "What the team worked through before drafting, and what they said. Tap a step to see their answers and notes in place." Then `StudyStepRows`, then **"Open the study"**.
    3. Tap "5 · Filling the Gaps" → `study_step`. The consultant reads the notes in place. `canStudy` is false, so the footer shows "Next: …" or "All steps" as a Ghost button, never "Done with this step".
    4. Back → `review_capture` → answer the questions → **"Looks good"** → `passage_record`.
  - **OURS now:**
    - `review_passage` (`screens/review.tsx:22-101`) shows play, chips, the terms used, the question button, and Approve / Suggest changes.
    - There is no study, no notes, and no background.
  - **Gaps:** covered by J-REV-1. The study disclosure and the edges `review_capture→study_guide|study_step` are missing.
  - **Changes:** see J-REV-1. `StudyStep` must render read-only for people without Translate, with notes visible.
  - **Data:** progress is derivable (J-STUDY-1). Notes need `ContextItemAdded`.

### Recording workspace

- [ ] **J-REC-1 — The translator records a first version**
  - **Persona:** Akol (REF tour "loop", `scenarios.ts:73-75`). Sarah asked him to record John 3, and two takes are already on the phone.
  - **REF steps:**
    1. `my_work` "Tap "Record John 3:1–21" under For you" → `workspace` (`flow.ts` `my_work→workspace` "Record / Continue").
    2. `WorkspaceScreen` (`translate.tsx:23-315`). Header: passage title, sub `"{language} · recording Version 1"` (`:96-97`).
    3. The request card "{assigner} asked · due {date}" with its note (`:120-128`).
    4. The **Source** card: "Tap an underlined word" when there are terms, and `SourceText` with key-term words underlined, green when tied (`:140-148, 317-340`). When there is no source: "Source text isn't loaded for this passage in the demo."
    5. **"Your recording"**, with "{n} takes · saved on this phone" (`:151-155`). Takes list with play/pause, waveform, and a trash button per take (`:162-181`). When empty: "No takes yet — tap the mic below to start." While recording, a red row reads "Recording take {n} · m:ss" (`:182-188`).
    6. Bottom: tray tabs Key terms / FIA study `d/6` / Notes / History (`:87-92, 198-207`). Mic button 56px (`:284-288`). **"Save Version 1"** (dark, disabled when there are no takes, nothing changed, or recording is on) (`:294-295`).
    7. The first version saves at once with changeNote "First recording." (no sheet, `:295`). The flow goes `workspace→passage_record` (`popTo`). The toast reads "Version 1 saved to the record" (REF `App.tsx:535`). Scenario event `version_saved`.
  - **OURS now:**
    - `translate_passage` hub (`translate.tsx:48-106`) → tile Recordings → `quest_assets` (`recordings.tsx:19-139`).
    - `quest_assets` has `PassageSourceAudio` docked (`:120-121`), a single yellow 82px mic (`:102-113`) that opens the **VAD takeover** Modal (`:133-136, 149-207`), and after stop: redo (RotateCcw), neutral mic "Record another part", and yellow Check "Keep take and return to passage" (`:97-118`). Keep calls `commands.keepTake` → `v1.TakeComposed`.
    - Then back on the hub, the yellow footer advances to `submit` → `attach_questions` (question-set picker slides, `translate.tsx:129-187`) → `submitTake` → `done_await` (`review.tsx:141-167`), which shows the queued/synced state.
  - **Gaps:**
    1. It is two screens plus a question picker, where REF has one workspace.
    2. The source text with tappable key terms is not on the recording screen. `TranslationOptions` holds source text behind a secondary action (`translationOptions.tsx:27`).
    3. There is no list of parts with per-part play and delete. The takes are one `AudioClip` of all hashes (`recordings.tsx:122-125`).
    4. There is no tray (terms, study, notes, history).
    5. The final action is "Keep" then a separate "Hand off". REF's final action is "Save Version N".
    6. The translator attaches question sets (`attach_questions`). REF and PLAN 16 move questions to the reviewer.
    7. `done_await` is a separate screen. REF pops to `passage_record` with a toast.
  - **Changes:**
    - New screen `workspace` (U) in `screens/translate.tsx`, replacing `TranslatePassage` + `QuestAssets` + `AttachQuestions` as the recording surface:
      - Top: the docked `PassageSourceAudio`, and the source text with underlined terms (`keyTermsForUnit`).
      - Middle: parts list = the pending cards, or the current take's `cardHashes`, each with play and delete.
      - Footer: the tray chips row (neutral), the centred yellow mic that opens the existing `VADTakeover` (move it from `recordings.tsx:149-207` unchanged), and "Save Version N" (see section 3 for the colour rule).
    - Flow:
      - `workspace→passage_record` (`popTo`)
      - `workspace→key_term_detail`
      - `workspace→key_terms`
      - `workspace→study_step`
      - `workspace→study_guide`
      - back edges to `passage_record`, `my_work`, `review_detail`
    - Remove from the machine (or keep as legacy, with a note): `translate_passage→attach_questions`, `attach_questions→done_await`, `translate_passage→quest_assets`.
    - Save = `keepTake` (if pending) + `submitTake` with `questionSetIds: []`.
    - Keep `done_await`'s delivery semantics (`handoffState`, `passageFlow.ts:42`) as an inline cloud chip on the record or workspace (section 3).
  - **Data:**
    - **Derivable:** takes (`currentTake`, `pendingPassageCards`), terms (`keyTermsForUnit`, `materials.ts:205`), tied terms (`keyTermLinksFor`, `:216`, from `v1.KeyTermLinked`), versions (`takesFor`, `workflow.ts:159`, filtered to submitted), "Version N" = the count of submitted takes (ordinal).
    - **Needs new fact:** a version's change note ("Say what changed"). Today only `ResponseRecorded.note` exists (`events.ts`), and only when the take responds to suggestions. Candidate: `ContextItemAdded` anchored to the take, or a dedicated `VersionDescribed {takeId, note?, blobHash?}`. Pick one.
    - **Conflict to flag:** `TakeSubmitted` creates review tasks for every eligible role holder (`tasks.ts:158-169`). REF only puts reviews on My Work when someone is asked. That belongs to the `my_work`/`ask_someone` domain, but "Save version" must not spam reviewers.

- [ ] **J-REC-2 — The translator continues a draft from My Work and adds a translation note in the tray** (Spoken stage 1, `spoken.ts:134-143`)
  - **Persona:** Nyakim.
  - **REF steps:**
    - "Tap Continue on Luke 15:11–32 under For you" → `workspace` with draft takes (`draftTakes`, `spoken.ts:66-69`).
    - "Record another take, then add a note under Notes": tray **Notes** → dashed amber **"Add a note"** (`translate.tsx:253-266`) → `NoteSheet` "Add a note", sub "Anchored to Whole passage. It follows the passage into reviews and later versions.", VoiceRecorder "Say it", "Or type it", **"Save note"** (`:342-353`).
    - The empty text reads "Notes you leave here follow the passage — reviewers and the next translator will see them." Toast: "Note added — it follows this passage".
    - Tray **FIA study** shows the title, "d of 6 steps", a progress bar, `StudyStepRows`, and "Open the study →" (`:236-252`).
    - Tray **History** lists the versions with their change notes, or "This will be the first version." (`:267-277`).
    - "Save Version 1" → "Open Reviews by version, then tap v1" (`version_detail`).
  - **OURS now:**
    - Resuming works: pending cards survive (`recordingJournal`). The hub footer derives `record` (`passageFlow.ts:34`).
    - Notes: the hub tile "Passage notes" → `add_to_tg` (`translate.tsx:99-100, 190-244`). It has a hold-to-record mic (yellow when empty) and an optional written note. It is one note per unit, saved by overwrite (register).
  - **Gaps:**
    - The note is not in a tray on the recording screen.
    - There is one note per passage, not many anchored notes.
    - There is no history of versions on the recording screen.
    - There is no study tray.
  - **Changes:**
    - The workspace tray tabs are Key terms · FIA study · Notes · History.
    - The Notes tab reuses the `add_to_tg` hold-to-record mic inside a bottom sheet (keep the hold gesture and the red-while-held colour from `translate.tsx:230-237`).
    - `add_to_tg` becomes a sheet, not a screen. Keep the id as legacy until the parity file is re-vendored.
  - **Data:**
    - **Needs new fact:** `ContextItemAdded` (a passage note, a verse note, or a word in the draft).
    - Legacy `tgMaterialId` fields must still show as notes (PLAN 16.1 rule 5). The read model merges them.

- [ ] **J-REC-3 — The translator records a fix after feedback** (tour "loop", steps 10–12, `scenarios.ts:82-84`; Spoken stages 3 and 5)
  - **Persona:** Akol or Nyakim.
  - **REF steps:**
    - `passage_record` "Record a fix" → `workspace` in revising mode (`openWorkspace(id, reviewId)`, REF `App.tsx:446`).
    - An amber card **"Revising after {kind}"** with the quoted comment and "{source} · voice feedback 1:40" (`translate.tsx:111-119`).
    - Takes start from the last version's takes (`-d` copies, REF `App.tsx:1488`).
    - The footer hint reads "These are Version 1's takes. Record a new take or delete one to save a new version." (`:280-282`).
    - "Save Version 2" → `SaveSheet`: title "Save Version 2", sub "Say what changed, so reviewers know what to listen for.", prefilled "Revised after the {kind} feedback.", VoiceRecorder "Say what changed", "✓ Answers the {kind} feedback from {source}", "✓ {n} key terms tied to this version" (`:374-398`).
    - Saving answers all open feedback. The toast reads "Version 2 saved · answers the Community Check feedback" (REF `App.tsx:512-535`).
  - **OURS now:**
    - A `respond` task (`tasks.ts:148-150`) → hub. The suggestions show as plain cards (`translate.tsx:67-68, 102`). The hub footer is `record` (`passageFlow.ts:30`).
    - `quest_assets` starts empty for the new take. `AttachQuestions` shows an optional response TextInput when `isResponse` (`translate.tsx:145-146, 183`) → `submitTake` with `responseNote` → `v1.ResponseRecorded`.
  - **Gaps:**
    - No "Revising after" banner with the reviewer's voice.
    - The response note is text only and on the wrong screen.
    - The new version does not start from the previous parts.
  - **Changes:**
    - The workspace reads a `respondsTo` param. The banner uses `v1.ReviewSubmitted.comment` and `v1.ReviewCommentRecorded.blobHash`.
    - Seed the parts list with the previous take's `cardHashes`. Cards are immutable, so the new take reuses the hashes (PLAN invariant 4).
    - The Save sheet records the note (text and voice) as `ResponseRecorded` (`note`, `blobHash`).
  - **Data:** derivable today. `ResponseRecorded {takeId, respondsToTakeId, note?, blobHash?}` exists (`events.ts`), and `parentTakeId` exists on `TakeComposed`.

- [ ] **J-REC-4 — The translator ties a key term while recording** (tour "loop", step 2)
  - **Persona:** Akol.
  - **REF steps:**
    - Tap the underlined "Spirit" in Source → `key_term_detail`. Tie it to this recording, or record why it was adjusted.
    - Back. The tray **Key terms** shows each term with a FIA badge, "{rendering} · …" or "No {language} rendering yet" (amber), and a green "Tied" pill, then "All key terms →" (`translate.tsx:211-235`).
  - **OURS now:**
    - `passage_terms` slide run records term audio (`passageSlides.tsx:137-224`), with a project ring (`ProgressRing`).
    - No tying from the recording screen. `KeyTermLinked` exists in core.
  - **Gaps:**
    - No source-underline entry.
    - No "Tied" state.
    - No rendering display per language.
  - **Changes:**
    - Workspace Source underlines → `key_term_detail`.
    - Keep `passage_terms` (hold-to-record term run, orange reference colour) reachable from the Key terms tray as "Record key terms". It is an OURS feature with no REF equivalent, so keep it.
  - **Data:**
    - Derivable: `KeyTermDefined`, `KeyTermRenderingAdded`, `KeyTermAdjusted`, `KeyTermLinked`, `keyTermLinksFor`.
    - PLAN 16 wants `KeyTermRenderingSet` anchored to a version. That is only required if renderings must be LWW per language.

- [ ] **J-REC-5 — The team records a polished final version** (Spoken stage 6, `spoken.ts:193-202`)
  - **Persona:** Nyakim.
  - **REF steps:**
    - Open Luke 15:11–32 under Recent → `passage_record` → "Tap New version at the bottom" → `workspace`.
    - Record a polished take, save Version 4 with "Polished recording, same words as Version 3".
    - "Open Reviews by version, then tap v4".
    - Hint: "The app suggests Local Check next, but Spoken records the approved wording well first … Steps are advice".
  - **OURS now:**
    - An OBT stage `final_recording` (`obt.ts:5-8`). `obt_passage` → `quest_assets` → select → `ObtStepRecorded{step:'final_recording', takeId}`. Then `final_approval` by the owner.
  - **Gaps:**
    - REF has no final-approval stage. A polished recording is just a version, and Local Check follows.
    - OURS gates the final recording behind consultant approval and requires a different take (`obt.ts:123, 185`).
  - **Changes:**
    - Use the same `workspace`. Final recording is not a flow step (PLAN 16 "Recording").
    - For legacy OBT lanes, leave `obt_passage` in place until the read model merges.
  - **Data:** derivable (a new submitted take).

### Back translation

- [ ] **J-BT-1 — The back-translator records a back translation when asked** (Spoken stage 4, `spoken.ts:165-176`; ADR-015)
  - **Persona:** Okello Joseph, a bilingual speaker, with no notes and no source access.
  - **REF steps:**
    1. Nyakim: `passage_record` → under Back Translation "Ask someone" → `ask_someone` ("Ask for Back Translation") → pick Okello → send.
    2. Hand off to Okello: on `my_work`, the highlight card title is **"Back-translate Luke 15:11–32"**, with CTA **"Start"** (`record.ts:207-208`, `work.tsx:154`) → `back_translation`.
    3. `back_translation` = `WorkspaceScreen` in BT mode (REF `App.tsx:1537-1558`):
       - Header sub `"Back translation · Nuer → English"` (`translate.tsx:97`).
       - Light card: **"You're making new content"**, "Listen to Version 2, then say what it means in English, in your own words. You're not judging it — the Consultant Check compares your back translation with the source." (`:100-110`).
       - Request card.
       - "Listen · Nuer Version 2" with the submitter, a `TakePlayList` of the version's takes, and "Notes and earlier reviews are hidden, so only the recording shapes what you say." (`:130-138`).
       - "Your back translation (English)". Empty: "No takes yet — listen to a part, then tap the mic and say it in your own words." Parts are named "English · part n" (`:79`).
       - There are no tray tabs (`tabs = []` when bt, `:87`).
       - Footer: mic + **"Save back translation"** (dark) → `BackTranslationSaveSheet`: title "Save back translation", sub "Of Version 2. The Consultant Check will listen to it next.", "Anything that was hard to say back? Optional", VoiceRecorder "Say it" ("Back translator's note"), placeholder "Or type it — e.g. a word with no English match", button "Save back translation" (`:355-372`).
    4. `saveBackTranslation` (REF `App.tsx:611-635`) adds a review with outcome approved, `artifacts` = the BT takes, `comment` = the note. It closes the request. It notifies the author and asker: "Back translation of Luke 15:11–32 is ready". Toast: "Back translation saved · ready for the Consultant Check". → `passage_record`. The record shows "Back Translation · recorded" (`data.ts:404`).
  - **OURS now:**
    - OBT only. The coordinator uses `obt_manage` "Deliver draft" (back-translator email + language) → server RPC `obt_open_workspace` creates a separate project (`v1.ObtWorkspaceCreated`) (`obtManage.tsx:48-57`).
    - The back-translator's app opens `WorkflowPassage` → `BackTranslation` (`obt.tsx:224-257`): the language text, "Listen to the assigned draft" (with seek controls), and "Listen to your back translation". The footer is yellow Mic "Record back translation" → `quest_assets`, then yellow Send "Submit back translation" → `v1.TakeSubmitted`. There is also an outline "Record another back translation".
    - The coordinator then taps "Collect back translation" (`obt_collect_result`), which writes `ObtStepRecorded{step:'back_translation', takeId, language}`.
    - In non-OBT lanes, back translation is a **review step** (`catalog.ts:160`, role translator), reviewed with Approve / Suggest changes on `review_passage`. That is the exact verdict problem ADR-015 fixes.
  - **Gaps:**
    1. No "You're making new content" framing or copy.
    2. No optional note on what was hard to say back.
    3. Collection is manual by the coordinator.
    4. There is no My Work item "Back-translate {passage}" with "Start" for the back-translator.
    5. Non-OBT lanes treat BT as a verdict.
    6. REF lands the back-translator on `passage_record`. In OURS the back-translator has no membership in the source project (security boundary, `spoken-worldwide-workflow.md` "Back translation").
  - **Changes:**
    - New screen id `back_translation` (U), mounted by `WorkflowPassage` when `state.obt.workspace` is set, and for BT kinds in ordinary lanes.
    - Render `workspace` in BT mode: listen card at the top, parts, VAD takeover, footer "Save back translation" + optional-note sheet.
    - **Keep the partition boundary.** After saving, go to a `done_await`-style confirmation in the BT workspace, not `passage_record`. Log this in `APP_ONLY` as "back-translator is not a member of the source project".
    - Make collection automatic (server-side, on `TakeSubmitted` in the workspace), so the source record shows "Back Translation · recorded" without a coordinator tap. This is a server change (`obt_collect_result`).
    - Flow edges: `my_work→back_translation` (gate reviewer/translator), `passage_record→back_translation`, and `back_translation→passage_record` (`popTo`, same-project case only).
  - **Data:**
    - OBT lanes: derivable (`ObtWorkspaceCreated`, `TakeSubmitted`, `ObtStepRecorded.language`, `deriveObt().backTranslationId`, `obt.ts:132`).
    - The back-translator's note: `ObtStepRecorded.note` exists, but it is written by the collector. The note must be carried in the workspace, for example as `ResponseRecorded` on the BT take, or as `ContextItemAdded`.
    - Ordinary lanes **need new facts:** `v1.ContentProduced {takeId, fromTakeId, kindId, language}` and `v1.ReviewKindDefined {produces, withholdsContext}` (PLAN 16.1). Do not add a field to `TakeComposed` (PLAN 16.1 rule 1).

- [ ] **J-BT-2 — Someone with Review permission back-translates directly from the record**
  - **Persona:** any reviewer.
  - **REF steps:** the step row for Back Translation: "{usualReviewer} records it in English — new content, not a verdict · the Consultant Check reviews it". The primary action is **"Back-translate it"** → `back_translation` (`passage.tsx:604, 609-611`).
  - **OURS now:** none (OBT requires the coordinator to deliver).
  - **Gaps/Changes:** the same screen as J-BT-1. Only possible in the same project when the partner accepts that the back-translator can see the source project. Make this a per-flow policy. The default is the OBT isolation.
  - **Data:** as J-BT-1.

### Review capture

- [ ] **J-REV-1 — The consultant reviews and compares the back translation** (Spoken stage 5, `spoken.ts:177-191`; ADR-015)
  - **Persona:** Peter Lual.
  - **REF steps:**
    1. `my_work` "Tap Review on Luke 15:11–32 under For you" → `review_capture` (`ReviewCaptureScreen`, `review.tsx:31-254`).
    2. Header: kind name "Consultant Check", sub `"{passage} · {language} · Version 2"`. Request card: "Nyakim Gatluak asked · due Sep 30", with the note "Please listen closely to the son's confession in 15:18–21 and the older brother's complaint." (`spoken.ts:97-99`).
    3. **"Listen"**: `TakePlayList` of the version, and "**What changed:** {changeNote}" (`:89-95`).
    4. **"{Back Translation} to compare"** card (primary border, swap icon): "Made for this check: English in the back translator's own words. Compare its meaning with the source." For each BT: "{source} · from Version 2 · {at}". If it was made from an older version, an amber warning reads "Made from Version 1 — you're reviewing Version 2. Check what changed." Then the BT recording, and **"Back translator's note"** (`:104-136`).
    5. The **"Background"** label, then three `Disclosure`s, collapsed (ADR-013):
       - **"From the translator"**, summary "{n} terms · {n} notes": term chips "{term} · {rendering}" → `key_term_detail`, and NoteCards (`:141-162`).
       - **"The team's study"** (J-STUDY-6).
       - **"Earlier reviews"**, summary "{n} · {kind names}": expandable rows "{kind} · looks good/needs changes/recorded", with recordings played in place and the response "Revised: …" or "Kept: …" (`:179-187, 256-288`).
    6. **"Questions"** with "{n} required". Each card shows the source label and a "Required" pill. Inputs: rating 1–5 / Yes-No / text (`:189-223, 290-315`). For a required, unanswered question: **"Can't answer this?"** → `ReasonSheet` "Leave this question unanswered?", sub "Required questions can be skipped — the reason is saved with your review.", quick reasons "Listeners weren't able to judge this" / "Not relevant for this passage" / "Ran out of time in the session", button "Skip question". The skipped state shows "**Left unanswered:** {reason}" + "Answer" (`:25-29, 205-216, 247-251`).
    7. **"Your feedback"**: VoiceRecorder "Record voice feedback" + textarea "Or type it — what worked, what didn't" (`:225-232`).
    8. Footer hints: "{n} required questions left — answer, or say why not", or "To ask for changes, say what to change above" (`:236-237`). Buttons: amber **"Needs changes"** (disabled until ready and something was said) and green **"Looks good"** (disabled until required questions are handled) (`:238-245`).
    9. → `passage_record` (`popTo`). Toast: "Feedback sent to Nyakim" with undo, or "Consultant Check added — looks good".
  - **OURS now:**
    - `review_passage` (`screens/review.tsx:22-101`): review-teal tint screen, back, title, `AudioClip` "Play translation", chips (waiting-on count, status icon), the terms-used card, and a yellow "Answer questions" button → `review_questions` (`:103-139`, every question is Yes / Partly / No). Then outline "Suggest changes" + yellow "Approve", and "Change decision" after.
    - No comment capture: `reviewTake` accepts `comment`, but the UI never sends it.
    - No voice feedback: `ReviewCommentRecorded` exists but is not emitted here.
    - OBT consultant: `obt_passage` review mode shows the `ObtHistory` pager (one item per page, `obt.tsx:166-222`), a text note, a spoken comment via `obt_interaction` `noteOnly`, and "Request changes" / "Approve this version".
  - **Gaps:**
    1. No "to compare" block. OBT shows the BT as one pager item among many.
    2. No older-version warning. `deriveObt` does have the input chain.
    3. No Background disclosures (translator notes, study, earlier reviews with recordings).
    4. Questions are shown on a separate screen with a fixed answer set. Question types (`rating`/`yesno`/`text`, `catalog.ts:214-227`) are ignored, "required" is not modelled, and there is no skip-with-reason.
    5. No voice or text feedback.
    6. No rule that Needs changes needs feedback.
    7. PLAN 16 rule "submit disabled until played once" is not implemented.
    8. No "What changed" line (there is no change-note fact).
  - **Changes:**
    - Rename or rebuild as `review_capture` (U) in `screens/review.tsx`. Fold `review_questions` inline (questions as cards, one question visible at a time if the slideshow rule is kept, see section 3).
    - Edges: `my_work→review_capture` (gate reviewer), `passage_record→review_capture`, `review_capture→passage_record` (`popTo`), `review_capture→key_term_detail`, `review_capture→study_guide`, `review_capture→study_step`.
    - Remove `review_passage→review_questions` and `review_passage→done_await`.
    - Compare block: for OBT lanes, `deriveObt().backTranslationId` plus `ObtStepRecorded.language` and `note`. For ordinary lanes, `ContentProduced` whose kind's `checkedBy` = this kind.
    - Emit `reviewTake({comment})` + `v1.ReviewCommentRecorded` for voice.
  - **Data:**
    - **Derivable:** the version audio, terms used (`keyTermLinksFor`), earlier reviews (`state.reviews[takeId]`), responses (`ResponseRecorded`), question sets (`questionSetsFor`, `questionsOf`), and question type via `QUESTION_TEMPLATES` for catalog sets (`questionsOf` drops the type today, `materials.ts:148-160`; extend `QuestionView` with `type`, a pure code change).
    - **Needs new facts or conventions:**
      - "Required" per question (a template property; add it to `QUESTION_TEMPLATES`, code only).
      - The skip reason: store it as an answer key `"{qid}#skipped"` inside `ReviewSubmitted.answers`, which old clients show as a plain answer and which is still a true fact. The alternative is a new fact. Decide which.
      - The change note (see J-REC-1).
      - `ContentProduced` for non-OBT back translations.
      - Notes and study notes need `ContextItemAdded`.
      - The review kind name ("Consultant Check") needs `ReviewKindDefined`, or a mapping from the step label.

- [ ] **J-REV-2 — A peer or community reviewer does a standard review with feedback** (tour "loop", steps 6–8, `scenarios.ts:78-80`; Spoken stage 3 peer)
  - **Persona:** Mary Alier (community) or Gatkuoth (peer).
  - **REF steps:**
    - `my_work` "Tap Review on John 3 under For you" → `review_capture`.
    - "Answer the required question, say what to change, then tap Needs changes". Hint: "Every review has the same shape: listen, context, questions, feedback."
    - → `passage_record`. `review_sent`.
  - **OURS now:** `assignments_home→review_passage` (J-REV-1).
  - **Gaps/Changes/Data:** the same as J-REV-1, without the compare block.

- [ ] **J-REV-3 — A kind that withholds context**
  - **Persona:** a reviewer for a kind with `withholdsContext` and no `produces`.
  - **REF steps:** instead of the Background section, a grey lock card reads "Notes and earlier reviews are hidden for {kind}, so what you hear isn't shaped by what others said. They're still on the record." (`review.tsx:97-103`).
  - **OURS now:** none.
  - **Changes:** include this in `review_capture`.
  - **Data:** **needs new fact** `ReviewKindDefined.withholdsContext`, or a flow-step property in `v2.WorkflowStepSet`.

### Guest review by link

- [ ] **J-GUEST-1 — A pastor reviews by link without an account** (tour "outside", `scenarios.ts:103-117`; Spoken stage 7, `spoken.ts:203-212`)
  - **Persona:** Pastor Garang / Pastor Gatwech. No app, no account.
  - **REF steps:**
    1. Translator: `passage_record` → under Community Check (or Local Check) "Ask someone" → `ask_someone` → "Choose Someone without the app" → WhatsApp or SMS + phone → send (ask_someone is another domain).
    2. The guest opens the link → `guest_review` (`GuestReviewScreen`, `review.tsx:321-398`). No header nav. A LangQuest mark and the pill "No account needed". Title **"{asker} asked you to listen to {passage}"**, sub "{language} · {kind}" (`:358-368`).
    3. The request note in quotes, then a `TakePlayList` of the latest version.
    4. Up to 3 questions (REF `App.tsx:1591`), then **"Tell us what you understood"**: VoiceRecorder "Tap to reply by voice" + "Or type it" (`:383-388`).
    5. Footer: amber **"Some parts unclear"** / green **"Understood it well"** (`:391-395`).
    6. Thanks screen: "Thank you, {last name}", "Your {kind} was added to {passage}. {asker first name} will see it right away. You can close this page." (`:342-354`).
    7. The record gets a review `via: "link"`, credited to the guest (`guestSubmit`, REF `App.tsx:637-648`). The asker is notified: "{name} replied by link".
    8. Back as the translator: History or Reviews by version shows it, marked "by link".
  - **OURS now:** not built. PLAN 16 says so: "Community check by share link (not built)", with its own spec: ask for a name or nickname, take text, audio or a recorded conversation. The OBT alternative is the facilitator capturing each person in `obt_interaction` (`obtCapture.tsx:20-135`: name → play draft → hold-to-record conversation → comments → optional photo).
  - **Gaps:**
    - No public page.
    - No scoped token.
    - No server write path for someone who is not a member.
    - REF does not ask for the guest's name. PLAN 16 does (take PLAN 16's name field: credit goes to whoever gave it).
  - **Changes:**
    - A server RPC that issues a scoped, expiring token for one version (PLAN 16.1 rule 7).
    - A web route for the page, served by the Expo web build or a small static page.
    - A new flow node `guest_review` (U), reachable only from outside (edge `ask_someone→guest_review` "they open the link · no account", documentation only).
    - Reuse the `obt_interaction` voice capture pieces (hold-to-record) for the reply.
    - Keep REF's two outcome buttons, but render them per section 3.
  - **Data:** **needs new fact** `v1.ShareFeedbackRecorded {versionTakeId, giverName, text?, takeId?, tokenId}` (PLAN 16.1), plus server-side token storage (not an event). The request itself (external channel and contact) needs the ask-someone fact (other domain).

### Spoken's eight stages (REF `src/domain/spoken.ts`, story Luke 15:11–32 in Nuer, flow "Spoken Oral Method", REF `data.ts:326-335`: community → peer → bt → consultant (checkpoint) → local)

Common gap: OURS' Spoken flow is `spoken_worldwide` (`catalog.ts:147-156`): community → revision → back_translation → consultant → final_recording → final_approval, driven by OBT events. REF's has **no revision step, no final-recording step, no final approval**. It has **peer review and local check**, and drafting/revision/final recording are just versions. Every stage below needs a decision on which flow wins. I recommend REF's, per PLAN 16 ("Ready-made flows … Spoken oral method (Community, Peer, Back Translation, Consultant as checkpoint, Local)"). This needs `v2.WorkflowStepSet {kindIds[], checkpoint}` and `ReviewKindDefined` (PLAN 16.1) and a new catalog flow, for example `spoken_oral`. Keep `spoken_worldwide` for existing lanes.

Scenario harness: REF's `spokenStoryAt(stage)` (`spoken.ts:34-118`) builds a cumulative fixture per stage. OURS' equivalent is `smart-tests/` (Playwright + Jev, `journeys/*.spec.ts`, seed in `world.ts:62`). Recommend one journey spec per stage (`journeys/spoken-0-exegesis.spec.ts` … `spoken-7-local-check.spec.ts`), with a seed builder `seedSpokenStoryAt(stage)` in `smart-tests/world.ts`. It appends real events through the server. It is test code, not core, because it has I/O. Each oracle judges the event log (for example, stage 4 passes when a `ContentProduced`, or an OBT `back_translation` step, exists for v2 with no notes visible to Okello).

- [ ] **S0 — Exegesis** (`spoken.ts:124-133`)
  - **Persona:** Nyakim.
  - **Steps:**
    1. "Tap Map, then open Luke" (`book_map`).
    2. "Tap chapter 15, then 15:11–32" (`passage_record`). Hint: the chapter was split during exegesis.
    3. "Under Next step, tap Start the study" (`study_guide`).
    4. "Open 2 · Setting the Stage, tap a paragraph, and add the team's conversation" (`study_step`, `note_added`).
    5. "Go back to the steps, open 5 · Filling the Gaps, then tap "Sin"" (`key_term_detail`).
  - **OURS:** Map/book = `dynamic_bible` (other domain). Study = FiaGuide modal (J-STUDY-1). Pericope boundaries are set by `v1.BiblePassageSelected` in `dynamic_bible` (`dynamicBible.tsx:42`).
  - **Gaps:** J-STUDY-1/3/4. Spoken wants to set pericope boundaries during exegesis. OURS' dynamic passage selection already lets translators pick ranges, which is an advantage to keep.
  - **Data:** as J-STUDY-1 + `ContextItemAdded`.

- [ ] **S1 — First draft** (`:134-143`): J-REC-2, then "Save Version 1", then "Open Reviews by version, then tap v1" (`version_detail`, other domain).
  - **OURS:** OBT `first_draft`: record in `quest_assets`, then `obt_passage` select mode "Select this recording and hand off" (`obt.tsx:97-98`) → `ObtRoundStarted`.
  - **Gaps:** this selection step becomes plain "Save Version 1". The note tray is missing.

- [ ] **S2 — Community check** (`:144-153`)
  - **Steps:**
    1. "Open Luke 15:11–32 under Recent".
    2. "Under Community Check, tap Log what happened" (`add_record`).
    3. "Add who was there and what they said, pick Needs changes, and save" (people 14, place, voice summary, retelling artifact, `spoken.ts:76-85`).
    4. "Tap the listeners' feedback to open it" (`review_detail`).
  - **OURS:** `obt_interaction`, one participant at a time (name, conversation, comments, photo), with a minimum count, then the yellow ArrowRight on the hub completes `community`.
  - **Gaps:** REF logs one session with a count of people and a place (the `add_record` domain). OURS logs per participant. Keep both: per-person capture is richer evidence (principle 4). `add_record` can offer "Add a person" using the `obt_interaction` slides.
  - **Data:** OBT interactions are derivable. A logged review with people and place **needs** fields that `ReviewSubmitted` lacks (people, place, givenBy, artifacts). That is the other domain's fact.

- [ ] **S3 — Second draft and peer review** (`:154-164`)
  - **Steps:**
    1. "Tap Respond on "Feedback on Luke 15:11–32" under For you" (`passage_record`).
    2. "Tap Record a fix on the community feedback" (`workspace`).
    3. "Re-record verses 20–24 and save Version 2" (`version_saved`).
    4. "Under Peer Review, tap Ask someone" → "Pick Gatkuoth Riek, then send".
  - **OURS:** OBT `revision`: select mode offers "Send this recording through a new community-checking round" / "Continue with the first draft unchanged" / "Record another attempt" (`obt.tsx:147-149`). There is no peer review.
  - **Gaps:** J-REC-3. There is no peer step in our Spoken flow. OURS' explicit "continue unchanged" is covered in REF by "Keep it, say why" on the record (other domain).

- [ ] **S4 — Back translation** (`:165-176`): J-BT-1 in full.

- [ ] **S5 — Consultant check** (`:177-191`)
  - **Steps:** Peter reviews → "Needs changes" → Nyakim Respond → Record a fix → Version 3 → "Under Consultant Check, tap Ask again" (hint: "The Consultant Check is a checkpoint … he has to hear Version 3 and say Looks good before Local Check can start") → Peter reviews → "Looks good".
  - **OURS:** OBT consultant review mode. "Request changes" sends it back to `revision` (`obt.ts:125-128`). Approve advances.
  - **Gaps:** J-REV-1. "Ask again" belongs to the other domain. The checkpoint as a flow concept **needs** `v2.WorkflowStepSet.checkpoint` (derivation: the step clears only on approve or override).

- [ ] **S6 — Final recording**: J-REC-5.

- [ ] **S7 — Local check** (`:203-212`)
  - **Steps:** "Under Local Check, tap Ask someone" → "Choose Someone without the app, then send" → "Open the link as Pastor Gatwech" (`guest_review`) → "Reply, then see the story done" (`passage_record`, every stage on the record, done).
  - **OURS:** OBT `final_approval` by the owner. There is no local check and no link.
  - **Gaps:** J-GUEST-1. The "local" kind needs `ReviewKindDefined`.

### Other REF scenarios that touch this domain

- [ ] **SC-TOUR-loop** (`scenarios.ts:65-86`): J-REC-1 → J-REC-4 → (ask, other domain) → J-REV-2 → (respond, other domain) → J-REC-3. Its last step: "Record a new take, save Version 2, then open it under Reviews by version".
- [ ] **SC-TOUR-outside** (`:102-117`): J-GUEST-1.
- [ ] **SC-FIA-study** (`:185-199`): J-STUDY-1 → J-STUDY-3 → J-STUDY-1 step 7 (Done with this step: "Setting the Stage opens next") → J-STUDY-2 → J-STUDY-4 → J-STUDY-5.
- [ ] **SC-FIA-review** (`:200-209`): J-STUDY-6 → J-REV-1 (no compare block, because the BT fixture `fr2` is an ordinary approved review with artifacts, `fiaStory.ts:59-61`; the consultant's compare block still shows it because `bt.produces.checkedBy === 'consultant'`).
- The other tour scenarios (`self-run`, `track`, `method`, `checkpoint`, `setup`) belong to other domains.

---

## 2. Screen-id mapping: REF → OURS → action

| REF id (REF file) | OURS id(s) today (file) | Action |
| --- | --- | --- |
| `study_guide` (`screens/study.tsx:56`) | none. The `FiaGuide` modal (`fia.tsx:130`) | **Add** `study_guide`, U. Retire the modal. |
| `study_step` (`study.tsx:148`) | none. The `FiaGuide` modal stage page | **Add** `study_step`, U, with `PassageReader` inside. |
| (PassageReader, inside both study screens) | `PassageSourceAudio` on Hear only (`fia.tsx:195`), text in `dynamic_bible` | **Add** as a view. BSB text + real timings from core. |
| `workspace` (`translate.tsx:23`) | `translate_passage` (hub, `translate.tsx:48`) + `quest_assets` (`recordings.tsx:19`) + `add_to_tg` (`translate.tsx:190`) + `attach_questions` (`translate.tsx:129`) | **Add** `workspace`. `quest_assets`' VAD takeover moves in unchanged. `add_to_tg` becomes the tray Notes sheet. `attach_questions` is **removed** from the translator path (questions go to the reviewer, PLAN 16). `translate_passage` shrinks to PLAN 16's 3-tile hub, or is replaced by `passage_record` (other domain). |
| (workspace tray: Key terms) | `passage_terms` (`passageSlides.tsx:137`) | **Keep** `passage_terms` as "Record key terms" from the tray (OURS-only; log in APP_ONLY). |
| (reference run) | `passage_references` (`passageSlides.tsx:91`) | **Keep** under the Reference tile. REF has no equivalent. The study guide becomes the first reference item. |
| `back_translation` (`App.tsx:1537`, WorkspaceScreen in BT mode) | `obt_passage` → `BackTranslation` (`obt.tsx:224`) in the BT workspace project, + `quest_assets` | **Add** `back_translation`, U. Render the workspace in BT mode. Keep the partition. Save lands on a done confirmation in the BT project. |
| `review_capture` (`review.tsx:31`) | `review_passage` (`review.tsx:22`) + `review_questions` (`review.tsx:103`); OBT consultant mode in `obt_passage` (`obt.tsx:152-157`) | **Replace** with `review_capture`. Fold the questions inline. Retire `review_questions`. The OBT consultant review uses `review_capture` with the compare block. |
| `guest_review` (`review.tsx:321`) | none; the facilitator uses `obt_interaction` (`obtCapture.tsx:20`) | **Add** `guest_review` as a public web page, plus a server RPC. Keep `obt_interaction` as "Add a person" in logged checks. |
| (toast + popTo `passage_record`) | `done_await` (`review.tsx:141`) | **Demote.** Keep the delivery chip (queued / synced / blocked) inline on the landing screen. Keep `done_await` only as the BT-workspace end screen, and as the sync detail screen. |
| `key_term_detail` (other domain) | `key_term_detail` (Avatar P) | Keep. Add the FIA glossary card and the "Tied" action (J-STUDY-4, J-REC-4). |
| `material_editor` (REF shows guide steps, parts count, "stops for discussion", resources, `review.tsx:430-460`) | `material_editor` (`review.tsx:170`); FIA fields + `FiaGuidanceRecorder` | Keep. Add a guide summary using `studySections` (P screen, text allowed). |
| `obt_manage` | `obt_manage` | Other domain (flows). Delivery becomes automatic (J-BT-1). |
| `obt_passage` | `obt_passage` | **Legacy.** Keep for existing `spoken_worldwide` lanes until the read model merges OBT facts into the record. New Spoken lanes use the record + `workspace`. |
| `dynamic_bible` | `dynamic_bible` | Other domain (`map_home` / `book_map`). |

Flow bookkeeping:
- Re-vendor `apps/mobile/test/spec-flow.json` from the REF branch `src/flow.ts`.
- Every kept OURS-only edge (`passage_terms`, `passage_references`, `obt_*`, `dynamic_bible`, `sync_status`) goes into `APP_ONLY` in `specParity.test.ts` with a reason.
- `screenContracts.ts` needs entries:
  - `workspace` emits `RecordingAdded`, `TakeComposed`, `TakeArchived`, `TakeSubmitted`, `ResponseRecorded`, `KeyTermLinked`, `KeyTermAdjusted`, `TakeMetadataSet`, plus the new note fact.
  - `study_step` emits `MaterialFieldSet` and the new note fact.
  - `review_capture` emits `ReviewSubmitted` and `ReviewCommentRecorded`.
  - `back_translation` emits `RecordingAdded`, `TakeComposed`, `TakeSubmitted`, plus the note fact.

---

## 3. Keeping our visual language while adopting REF screens

Our rules (PLAN 12, `docs/ux/README.md`):
- One yellow action per screen. On the hub, the footer owns it.
- Icons carry meaning, and words are optional on U screens. The only text is a passage reference or reference material.
- Colour is never alone.
- Blocked controls stay on screen: grey, dashed, struck through.
- The VAD takeover is full-screen red from start to stop, with a draggable cutoff line.
- Record starts from one centred yellow mic. The review row after recording is redo · neutral mic · yellow keep.
- Term recording is hold-to-record.

REF's copy is English prose. Rule for porting copy: **REF copy goes into `accessibilityLabel` and the spoken prompt audio (the `obt-prompts` pattern, `obt.tsx:28-32`), never into visible instruction text on U screens.** Reference material (FIA step text, glossary, Bible text) is allowed on screen, because it is reference material.

| Screen | Yellow action (exactly one) | Keep from REF (structure) | Render our way |
| --- | --- | --- | --- |
| `study_guide` | Footer ArrowRight = "Start/Continue: {step}" (label only). When all are done and nothing is recorded: yellow Mic = "Record the first draft". | Phase groups, per-step rows, progress, who finished each step, Passage tab. | Rows = the FIA stage icon (`fia.tsx:24-25` icons) + a check when done + an avatar chip (`Byline`, `UserChip.tsx`) for "Done by". Phase names and step titles are reference material, so they can show. The progress bar is beads (`passageSlides.tsx:119-121` style). The ViewSwitch uses icons (Sparkles/BookOpen) with text as the a11y label. The about text is reference material, so show it collapsed. The next step's row gets the 6% reference-orange tint, not yellow. |
| `study_step` | Footer: yellow Check = "Done with this step" (only for Translate). Otherwise a neutral ArrowRight "Next" / Grid "All steps". | Sections are tappable. Notes stay under their section. Timed notes list. Pause → note at the moment. Passage tab. Links to media, maps and terms. | The step text is reference material, so show it. The selected section gets an outline, not yellow. "Add a note" / "Answer" = an **outline** Mic button (hold-to-record, like `add_to_tg`); a text field is optional behind a Pencil icon. The note badge uses the neutral foreground plus a MessageSquare icon (REF uses amber, which is too close to our action yellow). The step's audio uses the existing `AudioClip` with seek. The "Add a note at 3:12" button is outline, with MessageSquare + a Clock icon + the time. "Stop here" boxes use the reference-orange 6% tint + a Pause icon. The last step's "Record the first draft" is an outline Mic, because the footer already owns yellow. |
| PassageReader | none (a view inside the study screens) | Translation pills, verse highlight while playing, tap a verse → note, pause → note. | Translation pills = source-Bible codes (text allowed: a reference). The playing verse gets the reference-orange tint. Verse-note buttons are outline Mic. |
| `workspace` | Before any take: the centred yellow mic (the existing `recordings.tsx:102-113` styling). After stopping: the existing review row, redo (outline) · neutral mic · **yellow Check "Keep"**. When kept and changed: the footer's yellow Send = "Save Version N". Never two yellows: while parts are pending, Save is hidden. | One screen: source + parts + tray + save. The "Revising after" banner. The request card. Save sheet (what changed). First version saves without a sheet. | Source = the docked `PassageSourceAudio` (keep "starting recording pauses playback"). Source *text* with underlined terms sits under the player, behind a BookOpen toggle (text is optional on U). Parts list = play buttons numbered by icon order, each with an outline Trash. Tray chips = icons with count badges: KeyRound (reference orange), Sparkles/BookOpen (study, orange), MessageSquare (notes, foreground), History (foreground). The "Revising after" banner = a review-teal 6% card with the reviewer's `AudioClip` (voice first) and the text comment as optional reference. "Save what changed" sheet = hold-to-record mic first, text optional. The VAD takeover is **unchanged**. Delivery state = the cloud chip from `done_await` (CloudOff / CloudCheck / CloudAlert) inline after save. |
| `back_translation` | As `workspace`: mic → keep → yellow Send "Save back translation". | "You're making new content" framing. Listen to the version only. Optional note on what was hard. No tray. | Header tint = review teal 6% (the BT is for the checker). The framing becomes a spoken prompt (`ObtPrompt`, stage `back_translation`) + a Headphones→Mic icon pair, not prose. The listen card = `AudioClip` with `seekControls` (as `obt.tsx:243`). "Notes are hidden" = a Lock icon with an a11y label only. The optional note = an outline hold-to-record mic in the save sheet. The language is shown as its code (reference text). |
| `review_capture` | Footer: yellow Check = "Looks good". "Needs changes" = outline MessageSquare (review teal). Both are disabled (dashed, struck through) until the version has been played once (PLAN 16) and required questions are handled. Needs changes is also disabled until voice or text feedback exists. | Listen + "What changed". The "{BT} to compare" block at the top. Background: translator notes/terms, the team's study, earlier reviews, all collapsed. Required questions with "Can't answer this?". Voice/text feedback. Withheld-context lock. | Keep the review-teal tinted screen (`review.tsx:48`). The compare block = a Headphones card with a swap icon, the BT `AudioClip`, and the back-translator's note clip. The older-version warning = an amber-free alert: Clock + a version badge "v1 ≠ v2" + an a11y sentence. Background disclosures = three icon rows (KeyRound+MessageSquare, Sparkles, ListChecks) with counts, collapsed. Questions: keep our slideshow, one question per slide (like `attach_questions`), with the answer control by type: 1–5 dots / Check-X / hold-to-record for text. "Can't answer" = an outline SkipForward with quick reasons as icon chips plus an a11y label. Feedback = a hold-to-record mic (outline) + an optional text field. |
| `guest_review` | "Understood it well" = yellow Check. "Some parts unclear" = outline MessageSquare. | No account, the asker's note, play, ≤3 questions, reply by voice, thanks screen. Add a name/nickname field (PLAN 16). | This is a web page for outsiders, so it can use text (it is closer to Avatar P for literacy? No: treat it as U). Use a large play button, then a hold-to-record reply, then the two buttons. Short visible text is acceptable only for the asker's name and the passage reference. Thanks = a big CheckCircle2 in done green. |
| `material_editor` (P) | P screen: footer Save. | The guide summary: steps, parts count, "stops for discussion", linked resources. | Text is fine (Avatar P). |

Words-optional checklist for implementers (each U screen above):
1. Every button has an icon and an `accessibilityLabel` that carries REF's verbatim label.
2. No visible instruction prose. REF hints become recorded prompts (`obt-prompts:<lane>` fields, `ObtPrompt`) or are dropped.
3. Status is icon + colour + shape (dashed or struck through when blocked).
4. At most one `colors.action` element is visible at a time. Add a render test per screen that counts yellow elements, in the same spirit as `screenContracts.test.ts`.
5. The VAD takeover component is moved, not rewritten. Its tests (`vadCore.test.ts`, `recordingFlow.test.ts`, `recordingJournal.test.ts`) must pass unchanged.

---

## 4. New facts needed (names only), grouped by journey

| Fact (PLAN 16.1 name where one exists) | Needed by | Note |
| --- | --- | --- |
| `v1.ContextItemAdded` (+ anchors: study section / study moment / verse+translation+moment / take / term; body text, voice, photo) | J-STUDY-1, 2, 3, 6; J-REC-2; J-REV-1 | The core of anchored notes. Legacy `tgMaterialId` notes merge into the read model. |
| Version change note (`ContextItemAdded` on the take, or a dedicated fact) | J-REC-1, J-REC-3, J-REV-1 "What changed" | Decide which. `ResponseRecorded` covers only responses. |
| `v1.ContentProduced {takeId, fromTakeId, kindId, language}` | J-BT-1, J-BT-2, J-REV-1 (ordinary lanes) | OBT lanes already derive it from `ObtStepRecorded`. |
| `v1.ReviewKindDefined {produces, withholdsContext}` | J-BT, J-REV-1, J-REV-3, S0–S7 | Or catalog-only kinds, if orgs cannot define kinds yet. |
| `v2.WorkflowStepSet {kindIds[], checkpoint}` | S3 (peer), S5 (checkpoint), S7 (local) | A new Spoken flow template in `catalog.ts`. |
| `v1.ShareFeedbackRecorded` + server token | J-GUEST-1, S7 | PLAN 16.1 rule 7. |
| `v1.StudyStepFinished` | J-STUDY-1 | **Recommend not adding.** The existing `fia-progress` field register already works (see J-STUDY-1). Decide. |
| Question skip reason | J-REV-1 | Answer-key convention or a new fact. Decide. |
| Ask for a specific kind or external contact (ask_someone domain) | J-BT-1 step 1, J-GUEST-1 step 1, S3, S5, S7 | Owned by the other analyst. My journeys depend on it. |

Every new fact needs a type in `events.ts`, a case in `reducer.ts`, and a fixture in the order-independence and idempotence tests (CLAUDE.md). Nothing may store status (PLAN invariant 5).

---

## 5. Suggested order of work (this domain)

1. Re-vendor `spec-flow.json`. Add the screen ids and edges with stub screens. Update `APP_ONLY`.
2. `workspace` (J-REC-1/2/3/4), with the VAD takeover moved in. No new facts are needed except the change note.
3. `review_capture` with comment/voice, question types, and the compare block for OBT lanes (J-REV-1/2). Derivable today, apart from the skip-reason decision.
4. `study_guide` / `study_step` with core `studyText` and progress from the existing fields (J-STUDY-1/5). Notes wait for `ContextItemAdded`.
5. `ContextItemAdded` → notes everywhere (J-STUDY-2/3/6, J-REC-2, Background disclosures).
6. `back_translation` screen for the OBT workspace (J-BT-1), then `ContentProduced` + `ReviewKindDefined` + `v2.WorkflowStepSet` for the REF Spoken flow (S3/S5/S7, J-BT-2, J-REV-3).
7. `guest_review` + server token (J-GUEST-1, S7).
8. A `smart-tests` journey per checklist item, starting with J-REC-1 (it extends the existing `translator-records.spec.ts`).

Open decisions to take to Ryder:
- (a) REF Spoken flow vs our shipped OBT flow (section 0, item 3).
- (b) FIA content licensing (section 0, item 7).
- (c) `StudyStepFinished` vs the existing progress fields.
- (d) BT partition boundary vs REF's same-project back translation (J-BT-1/2).
- (e) `TakeSubmitted` creating role-wide review tasks vs request-driven My Work (J-REC-1).
- (f) The skip-reason representation.
