# 08 · Study and reference

The study (`study_guide` and `study_step`, one reader), its steps, spoken
steps, answers and notes, glossary words, pictures and maps. Key words in
the workspace, the Key Terms list (`key_terms`) and a term's page
(`key_term_detail`): tying a term to a draft, renderings and why. The Bible
beside a passage, the Bible picker, "More Bibles" (`bible_explore`) and
"Add to My Bibles".

Read with [the README](README.md): the global preconditions G1 to G10, the
fixture and the role matrix apply to every test here.

Code under test: `src/screens/study.tsx`, `src/simple/guide.tsx`,
`src/study/ui.tsx`, `src/simple/reference.tsx` (BiblePane, KeyWordsPane,
NotesPane), `src/screens/config.tsx` (KeyTerms, KeyTermDetail),
`src/screens/sources.tsx` (BibleExplore).

**Order and shared state.** Tests run in number order.
- P-SUBMITTED carries FIA's worked study for Luke 15:11-32, six steps:
  "Hear and Heart", "Setting the Stage", "Defining the Scenes", "Embodying
  the Text", "Filling the Gaps", "Speaking the Word"
  (`library/fia/demo_luk-15-11-32.study.json`). This file assumes none of
  its steps is marked done when it starts; STUDY-003 and STUDY-004 mark them.
- STUDY-016 adds the key word "heaven" to LANG-A; later key-term tests use it.
- STUDY-031 adds a Bible to TRANS's My Bibles on one device.
When a test is run alone, bring its passage to the state its Preconditions
name by following the test that creates it.

**What the local library holds (2026-10-12).** FIA's English guides there
cover only Genesis 2:4-25, outside LANG-A's New Testament. The worked study
for Luke 15:11-32 is in LangQuest's "Example study guides (English)" (written
in FIA's format), which also covers John 3:1-21; the automated tests have
ADMIN follow it, so P-SUBMITTED has its study and "John 3:1–8" stands in for
P-S, a passage not started with a guide. Neither guide has recordings of its
steps, pictures or glossary words, so the tests of those (STUDY-008, STUDY-010,
STUDY-011) need FIA's own material and are skipped locally. The Bible beside
a passage is the built-in Berean Standard Bible (BSB, text and audio). The
library has no Bible of its own and Bible Brain is not set up on the local
server, so the tests that need a second Bible, a library Bible or Bible Brain
(STUDY-029 to STUDY-032, STUDY-034) check for it and are skipped when it is
missing.

---

## The study

### STUDY-001 Open the study from the passage record
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-SUBMITTED's study has no step done.

Steps:
1. Open P-SUBMITTED (Luke 15:11-32).
2. Tap the "Study" step row at the top of the path ("FIA guide · 0 of 6 steps").

Expected:
- The study opens. Header title "Luke 15:11-32", sub "Study", with ✕.
- Chips: "Guide" (selected), "Bible", and "Key words" and "Notes · N" when the passage has key words or notes.
- The step bar reads "Previous step" | "1/6 Hear and Heart ▾" | "Next step". Its accessibility label is "Step 1 of 6: Hear and Heart. All steps".
- Step 1's text shows. When the step has a recording (FIA's own guides), its spoken player "This step, spoken" shows above it ("Getting the recording…" while it loads, then "0:42 · English"-style length and language), with "Back 10 seconds" and "Add a note here"; the local library's worked study has none.
- The footer is "Done with this step".
- When the Bible has audio, a dock at the bottom reads "The passage · Luke 15:11-32" with play and Back 10.
- Nothing is written by opening the study.
- On a passage that has not been started and has a guide (P-S, or locally John 3:1–8), the record's main button is "Study", which opens the same reader.

### STUDY-002 Move between steps, and the list of steps
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- STUDY-001's study is open on step 1.

Steps:
1. Tap "Next step" twice.
2. Tap "Previous step".
3. Tap the step title ("2/6 Setting the Stage ▾").
4. In the sheet, tap step 5.

Expected:
- Step 1 goes to "3/6 Defining the Scenes"; step 2 back to "2/6 Setting the Stage". The screen does not change, only the step.
- "Previous step" is disabled on step 1 and "Next step" on step 6.
- Step 3 opens a sheet "Guide · 6 steps" with the sub "0 of 6 done", the steps grouped by phase, each row "Step N: {title}", then the guide's credit and licence, and "What you add while studying stays with this passage. Reviewers see it next to the draft.".
- TRANS does not see "Edit this guide" or "Copy this guide to adapt it" (no Reference material privilege).
- Step 4 closes the sheet and shows "5/6 Filling the Gaps".

### STUDY-003 Done with this step
Roles: TRANS · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-SUBMITTED's study has no step done. The study is open on step 1.

Steps:
1. Tap "Done with this step".
2. Look at the step bar and footer.
3. Tap "Previous step".
4. Tap "Next step", then "Done with this step" on step 2.
5. Tap "Previous step" to go back to step 2, then tap "Undo" in its footer.

Expected:
- Step 1 shows the toast "Hear and Heart done · 1 of 6", with no Undo, and the reader moves to step 2 ("2/6 Setting the Stage").
- Step 3 shows step 1 with a green line "Done by you · Just now" and "Undo" beside it (another person sees "Done by {TRANS-name} · …"; only people who may translate get the "Undo") in place of the Done button, and a ghost button "Next: Setting the Stage".
- Step 4: the toast reads "Setting the Stage done · 2 of 6", with no Undo, and the reader moves to step 3.
- Step 5: "Undo" shows "Undone." and step 2 is not done again (its footer is "Done with this step"). The step's "Undo" stays as long as the step is done; it does not run out.
- The record's Study row reads "FIA guide · 1 of 6 steps".
- The step bar's sheet lists step 1 with a check and reads "1 of 6 done · by {TRANS-name}".
- A second device as REV sees step 1 done after Sync now (`v1.StudyStepMarked`): REV's reader opens on the next step to do, and its sheet lists "Step 1: Hear and Heart, done" with "1 of 6 done · by {TRANS-name}".

Changed (2026-10-16, decision 134): no toast offers Undo; the step's own "Undo" in its footer takes "done" back.

### STUDY-004 The last step, then "Record the first draft"
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- STUDY-003: step 1 is done; steps 2 to 6 are not.
- Use P-S (Luke 12:35-48, not started, with an FIA guide) for the last part; locally, John 3:1–8 (the worked study's other passage, see the top of this file). On P-SUBMITTED, Version 1 exists.

Steps:
1. On P-SUBMITTED, mark steps 2 to 6 done in order.
2. Look at the footer.
3. On P-S's study, mark every step done, then tap the footer's button.

Expected:
- Marking step 6 shows "Every step is done", with no Undo. Step 6's footer then shows "Done by you · Just now" with "Undo", which takes the step back.
- On P-SUBMITTED (a version exists), the footer then reads "Open the recording workspace".
- On P-S (no version), it reads "Record the first draft", and tapping it opens the workspace for P-S ("Recording Version 1").
- The record's Study row reads "FIA guide · done".

Changed (2026-10-16, decision 134): no toast offers Undo; each done step's own "Undo" in its footer takes it back.

### STUDY-005 Reviewers see the next step, not "Done"
Roles: REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-SUBMITTED's study has steps 1 to 6 done (STUDY-004). Choose a guide step that is not done on another passage for the second half (P-S's guide before STUDY-004, or any guide with an open step; the automated test has TRANS take back one of John 3:1–8's steps).

Steps:
1. As REV, open P-SUBMITTED → the Study row.
2. Open a study with a step not done.

Expected:
- On done steps REV sees "Done by {TRANS-name} · {when}".
- On a step not done REV sees no "Done with this step"; the footer is "Next: {next step's title}" (ghost), or nothing on the last step.
- REV may answer and add notes (REV holds Review): "Answer" shows under each question, and "Add a note" under a part REV taps.
- REV never sees "Record the first draft" or "Open the recording workspace".

### STUDY-006 A viewer reads the study and cannot add to it
Roles: VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-SUBMITTED has at least one note (TRANS's from earlier tests).

Steps:
1. As VIEW, open P-SUBMITTED from the Map, then the Study row.
2. Tap a section and a question of the step.
3. Tap the spoken player's note button, if shown.
4. Tap the "Notes" chip.

Expected:
- The study reads normally; no "Done with this step", "Answer", "Add a note" or "Add a note here" is offered.
- Tapping a section does nothing.
- The footer on a step not done is "Next: {title}".

Fixed (2026-10-13): the "Notes" chip in the study shows "Add a note" to everyone (`NotesPane` takes no privilege). For VIEW the save is refused ("Not saved: …"), which breaks G10.6 (controls the role may not use are not offered). The test fails on step 4 until the button is hidden. Confirmed on the web 2026-10-12. The fix is in `simple/reference.tsx` (`NotesPane` needs a way to leave the button out) and `screens/study.tsx` (pass `canContribute`).

### STUDY-007 Answer a question in the guide, by voice
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-SUBMITTED's study is open on a step with a question in its text.

Steps:
1. Tap the question (or the "Answer" under it).
2. In the sheet "Your answer", tap "Record what the group said", speak for 6 seconds, stop.
3. Tap "Or type it", type "The son came to himself", tap "Add your answer".

Expected:
- Every question shows "Answer" under it without a tap first, and a tap on the question opens the same sheet. A plain section, once tapped, lights and shows "Add a note".
- The sheet's sub reads "It stays with the passage, and reviewers see it with the study."
- "Add your answer" is disabled until something is said or typed. What is said or typed is kept on this device as a draft only TRANS sees (the sheet's saved mark), so closing the sheet and answering again brings it back (decision 127).
- Step 3 shows the toast "Added to the study. Reviewers will see it with the passage.", with no Undo.
- The answer shows under the question, labelled "Answer", with a play button for the voice. Its card has "Undo", because it is TRANS's own (someone else's answer has the report flag instead). Do not tap it here: REV-011 uses this answer.
- REV sees it in Review it → Background → "Guide" (REV-011) and in the study.

Changed (2026-10-16, decision 134): no toast offers Undo; the "Undo" on your own answer's card takes it back.

Changed (2026-10-28, UI audit finding 39): "Answer" showed only after a tap on the question, which nothing pointed to; it now shows under every question.

### STUDY-008 A note at a moment of the spoken step
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-SUBMITTED's study on a step whose spoken recording loads. (The world's guide records step 1 with the test voice, four seconds long, so the automated test notes at 0:01 to 0:03 instead of 0:20.)

Steps:
1. Play "This step, spoken" and at about 0:20 tap "Add a note here".
2. Type "Ask the elders about the ring", tap "Add a note".
3. Tap "Undo" on the note's card.

Expected:
- Step 1 pauses the recording and opens "Add a note".
- Step 2 shows "Note added at 0:20. It stays with the study.", with no Undo.
- The note shows under the player, labelled "At 0:20". Its card has "Undo", because it is TRANS's own (someone else's note has the report flag instead).
- Step 3 shows "Undone." and the note is gone from under the player. The card's "Undo" does not run out: it is there whenever TRANS opens the step.

Changed (2026-10-16, decision 134): no toast offers Undo; the "Undo" on your own note's card takes it back.

### STUDY-009 The spoken step without a connection
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q2's study (if it has a guide) has never been opened on this device, and P-Q2 is not kept offline. Airplane mode on.

Steps:
1. Open P-Q2's record and its Study row.

Expected:
- If the guide is on the device, it opens, and the spoken player reads "Couldn't load the recording" (a file from the web) or "Audio is not on this device yet." (one the organization keeps) rather than spinning forever, with its play button grey. Nothing counts time over silence.
- If the guide is not on the device, the study must not claim the passage has no guide: "There's no study guide for this passage." is wrong for a guide that exists but was never downloaded. Record what shows.
- A passage kept offline (Ready for offline) opens its guide offline in full (decision 71, last amendment: a phone keeps the guides of the passages it keeps).

Fixed (2026-10-28, UI audit finding 36): the play button stayed purple, and Play ran a clock over silence when the file could not load; a kept file that could not be fetched said "Getting the recording…" for good (`useStudyAudio.ts`, `guide.tsx`).

### STUDY-010 Glossary words in the guide
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-SUBMITTED's study, on a step whose text has glossary words (dotted). (The world's guide links "inheritance" in step 2, with a recording of its own.)

Steps:
1. Tap a glossary word (accessibility hint "Tap for its meaning").
2. Tap "Listen: {term}".
3. Tap the footer.

Expected:
- A sheet titled with the word, sub "Glossary · the guide · English", with its meaning.
- Step 2 plays the word. If its audio cannot load, the player stops and the sheet says "Couldn't load the recording" (finding 36: it used to play a stand-in clock over silence).
- If the organization has the term among its key terms, the footer reads "Open the key term" and opens its page (STUDY-023). Otherwise it reads "This term isn't in your organization's key terms yet." and is not a button.

### STUDY-011 Callouts, pictures and maps
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions:
- P-SUBMITTED's study.

Steps:
1. Go through all six steps.
2. Tap each picture or map.

Expected:
- Callouts are labelled "Stop here.", "Note.", "Question.", "Culture." or "Careful.", and read as distinct from the text.
- Each picture or map opens a sheet with its title and source ("Guide · English"), full width; a map opens full size when tapped.
- Low-resolution copies say "Low-resolution copies, to save data." (and for maps "Tap the map to open it full size.").
- Without a connection a picture not on the device reads "Not loaded. Check your connection." instead of a broken image.
- On iOS and Android a film says "Films play in the web app for now."

### STUDY-012 The study's other chips
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-SUBMITTED's study, with notes and key words on the passage (the Key words chip shows only once the passage has key words, from STUDY-016).

Steps:
1. Tap "Bible", then "Key words", then "Notes · N".
2. On each, look at the footer.
3. Tap "Back to the guide".

Expected:
- "Bible" shows the passage's verses with the player and the Bible picker; the dock is hidden while on "Bible".
- On every chip but "Guide", the footer is "Back to the guide", and step 3 returns to the same step.
- "Key words" lists the passage's words with "Say yours" (TRANS holds Fill reference).
- "Notes · N" lists notes newest first.

### STUDY-013 The guide from the workspace, and back
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-SUBMITTED's workspace (from "Versions and history" → Edit on Version 1, or the Record row).

Steps:
1. Tap the "Guide" chip.
2. Move to step 3 with "Next step".
3. Tap "Open the study".
4. Tap ✕.

Expected:
- The Guide chip shows the step bar and the step's text, without the spoken player.
- Step 3 opens the study reader on step 3.
- Step 4 returns to the workspace, still on the "Guide" chip, with the parts unchanged.

### STUDY-014 Editing or adapting the guide
Roles: COORD, LADMIN, TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-SUBMITTED's study.

Steps:
1. Open the step bar's sheet.
2. COORD and LADMIN: tap "Copy this guide to adapt it" (or "Edit this guide" if the guide is the organization's own).

Expected:
- COORD and LADMIN (Reference material) see "Copy this guide to adapt it" for FIA's guide, which opens the guide editor (SETUP covers it).
- TRANS sees neither button.
- No guide is changed by opening the editor and leaving it.

### STUDY-015 No guide for this passage
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- A LANG-A passage outside the FIA guides' range, or a passage of LANG-B (which has no material).

Steps:
1. Reach its study (Versions and history → "Open the study" when offered).

Expected:
- If no study is offered on the record, there is nothing to tap; the record shows no Study row.
- If reached, the study shows "There's no study guide for this passage." and "Guides come with the reference material your organization uses, and cover more passages as it grows.", with ✕.

---

## Key words and key terms

### STUDY-016 Add a key word
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-SUBMITTED's workspace, on "Key words", recorder idle. "heaven" is not a key term of LANG-A yet.

Steps:
1. Tap "Add a key word".
2. Type "heaven" in "The word in the Bible, e.g. shepherd", and "God's dwelling, or God himself" in "What it means (optional)".
3. Try "Add the word".
4. Tap "Say it in Alpha", say a word, stop. (Or type it in "Or type it".)
5. Tap "Add the word".

Expected:
- The sheet's sub reads "A word the team should say the same way every time. It is added to Alpha's key words."
- "Add the word" is disabled until there is a word and a rendering (said or typed).
- Step 5 shows "heaven added.", with no Undo: key terms are grow-only (core `materials.ts`), so a word once added stays on the record.
- "heaven" is listed under Key words, marked in the Bible text (dotted), and appears on a second device after Sync now.
- Resets: LANG-A has the key term "heaven".

### STUDY-017 Key words in the workspace
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-CHECK (Luke 15:1-10) or another passage with key terms in its Bible text. "heaven" exists (STUDY-016).
- TRANS opens the workspace for P-SUBMITTED (Edit on Version 1).

Steps:
1. Tap the "Key words" chip.
2. Tap the listen icon on a word ("Hear {term} in the Bible").
3. Tap the word itself.

Expected:
- Each word shows where it is in the passage (for example "Luke 15:18, 21") and, on the right, "Your word" (a voice rendering), the written rendering, or "Say yours".
- Step 2 switches to the "Bible" chip, selects the verse, and plays from it. In the study the footer then reads "Back to Key words", and it and the phone's Back return to the Key words chip.
- When the Bible's audio has no verse timings (the built-in BSB, so the automated run), no word shows the listen icon. When the word's verse cannot be played, the pane stays and the toast reads "This Bible has no audio for that verse."
- Step 3 opens the term's page (STUDY-023).
- "Add a key word" and "All key words" are at the end of the list.
- With no words, the pane reads "No key words in this passage yet. Add one your team should say the same way every time." (for those who may add) or "No key words in this passage yet." (others).

Fixed (2026-10-28, UI audit finding 41): the listen icon switched to the Bible chip even when nothing could play, and the study's footer then led to the guide, not back to Key words (`reference.tsx`, `study.tsx`, `translate.tsx`, `btWorkspace.tsx`).

### STUDY-018 Say your word for a key word
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- STUDY-017's Key words chip shows a word with "Say yours".

Steps:
1. Tap "Say yours" (accessibility label "Say your word for {term}").
2. In the sheet "Your word for “{term}”", try "Add your word".
3. Tap "Say it", say the word, stop.
4. Tap "Add your word".

Expected:
- The sheet's sub reads "Say how Alpha says it. Your team hears it whenever this word comes up." (with the meaning first when the term has one).
- "Add your word" is disabled until something is said or typed ("Or type it"). Until then what is said is a draft only TRANS sees, kept as it is made (decision 127).
- Step 4 shows "Your word for {term} is saved.", with no Undo (grow-only, as STUDY-016).
- The row now shows "Your word", which plays it.
- The change is recorded with the passage and, when a draft is open, tied to that draft.
- While recording, "Say yours" and "Add a key word" are disabled.

### STUDY-019 Reviewers and viewers cannot change key words
Roles: REV, VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-SUBMITTED has key words.

Steps:
1. REV: open Review it → Background → "Key words". Then the study's "Key words" chip.
2. VIEW: open the study's "Key words" chip.
3. Each: tap a word to open its page.

Expected:
- No "Say yours", "Add a key word", "New term", "Tie to your draft" or "Change or add a word" is offered.
- Words can be heard, and the term's page can be read.

### STUDY-020 The Key Terms list
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- LANG-A has "heaven" (STUDY-016) and, from the library, FIA key terms if the template brings them.

Steps:
1. In P-SUBMITTED's workspace, "Key words" chip, tap "All key words".
2. Type "hea" in "Search terms", then clear it.
3. Tap ✕ or Back.

Expected:
- The screen is "Key Words" with the sub "Luke 15:11-32 · Alpha".
- "New term" is in the header (TRANS holds Fill reference).
- Sections "In this passage · N" (including "heaven") and "Other terms · N".
- Terms without a rendering read "No Alpha rendering yet". FIA terms carry an FIA badge.
- Step 2 narrows the list to "heaven"; a search with no match reads "Nothing matches “…”.".
- Back returns to the workspace with the chip and parts unchanged.
- Opened from a language's reference page (no passage), the sub reads "Alpha renderings" and the one section is "All terms".

### STUDY-021 A new term from the Key Terms list
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- The Key Terms list is open (STUDY-020).

Steps:
1. Tap "New term".
2. Type "compassion" in "Source term, e.g. grace (charis)", and try "Add Term".
3. Type a rendering in "Alpha rendering", and "When the father sees the son" in "When to use it, and why".
4. Tap "Add Term".

Expected:
- The sheet "New key term", sub "Added to Alpha's key terms, with its first rendering.".
- "Add Term" is disabled until both the term and the rendering are filled.
- Step 4 shows "compassion added." and the term is listed.

### STUDY-022 Nobody may add terms without Fill reference
Roles: REV · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- REV can reach the Key Terms list (from a key term's page, Back, or a guide's glossary "Open the key term").

Steps:
1. Look at the header and the empty state of a language with no terms (if any).

Expected:
- No "New term" button.
- An empty list reads "No key terms yet" with "Terms your team adds show here with their renderings." (not the "Add a term…" line).

### STUDY-023 A key term's page
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- "heaven" exists (STUDY-016). TRANS has a draft of P-SUBMITTED (open its workspace, record one part, and leave).

Steps:
1. From P-SUBMITTED's workspace, "Key words" chip, tap "heaven".

Expected:
- Header "Key Term" with "heaven" and its sub ("Alpha key term", or "FIA key term · Alpha" for an FIA term).
- The meaning, or "No meaning written yet.".
- Where it applies: "Appears in {places}", or "Applies to every passage".
- A card "Tie to your draft" with "So reviewers know this term shaped Luke 15:11-32." (because a draft is open and TRANS holds Translate and Fill reference).
- "In Alpha" with the rendering, or an amber "No word yet" with "Add how Alpha says this, and when to use it.".
- "Change or add a word" (or "Add a rendering" when there is none).
- "Why it's rendered this way" and "Where it's used" sections when there is history.

### STUDY-024 Tie a key term to the draft
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- STUDY-023's page is open, from the workspace, with TRANS's draft.

Steps:
1. Tap "Tie to your draft".
2. Go back to the workspace and tap "Publish".

Expected:
- Step 1 shows "Tied heaven to your draft." The card now reads "Tied to your draft" with "Reviewers will see this term and your reasoning.".
- In the workspace, "heaven" in the Bible text shows a check (tied).
- Step 2: the Publish screen shows "1 key word tied to this version".
- After publishing, REV's Review it → Background → "Key words · 1" lists "heaven" with "Their word: …".

### STUDY-025 Tying when a person keeps several drafts
Roles: TRANS, TREV · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-SUBMITTED has an open draft by TREV (started first) and an open draft by TRANS.

Steps:
1. TRANS: open TRANS's draft in the workspace, "Key words", tap "heaven", "Tie to your draft".
2. Open TRANS's draft's Publish screen.

Expected:
- The term is tied to the draft open in the workspace, and the Publish screen counts it.

Fixed (2026-10-12): the term's page now ties to the person's own draft: the one the workspace names (`draftId`), else the one they changed last (`study/keyTermDraft.ts`, tested in `apps/mobile/test/keyTermDraft.test.ts`), never a teammate's. The workspace does not pass `draftId` yet (`translate.tsx`), so with several drafts of one's own the tie goes on the one changed last, which is the one the workspace opens by default.

### STUDY-026 Change or add a word, with why
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- "heaven"'s page is open from P-SUBMITTED's workspace.

Steps:
1. Tap "Change or add a word".
2. Try "Add your word" with nothing.
3. Type a new rendering in "New word (optional)", and "Only for God's dwelling" in "When to use it".
4. Tap "Say why", say 5 seconds, stop. Tap "Add your word".
5. Open the sheet again; this time only type "Elders prefer the older word" in "Or type what changed, and why", and tap "Add your word".

Expected:
- The sheet is titled "Alpha · “heaven”", sub "Recorded as part of Luke 15:11-32, and tied to your draft." (with a draft) or "Every change is recorded with your reason.".
- "Add your word" is disabled until a note is typed or a reason said. What is typed or said is kept as a draft (the sheet's saved mark) until it is added (decision 127).
- Step 4 shows "Added “{rendering}”." The page shows the rendering under "In Alpha".
- Step 5 shows "Change recorded.".
- "Why it's rendered this way" shows "2 changes · latest by {TRANS-name}, {when}", with "Play the explanation" for the voice reason and "Open Version N" where the change was made with a version.
- "Where it's used" lists "Luke 15:11-32 · Version N" rows, the one where it changed badged "Changed here"; more than a few show "Show more".

### STUDY-027 A term that is gone
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- A key term's page reached by an id that is not in LANG-A (for example a stale link after the language reloaded, or a term from another language opened through the Back stack).

Steps:
1. Open the page.

Expected:
- "Key Term" with "This term is not here any more", and Back works. No crash.

Not automated (2026-10-12): no screen on the web links to a term outside the open language, and the web has no address for a screen, so the page cannot be reached with a missing id from the UI. Check it by hand on a phone (open a term, remove the language's data, come back).

---

## Bibles beside a passage

### STUDY-028 The Bible chip in the workspace
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-SUBMITTED's workspace, recorder idle. The organization's English Bible is offered to LANG-A.

Steps:
1. On the "Bible" chip, tap play, wait 10 seconds, tap pause.
2. Tap "Back 10 seconds".
3. Tap verse 20.
4. Tap a dotted key word in the text.
5. Back in the workspace, scroll to the end of the Bible pane.

Expected:
- The player reads "{Bible} · 0:10 / {length}" and pauses.
- Step 3 plays from verse 20 when the Bible has verse timings; otherwise the verse is selected, and the pane says it plays the whole chapter ("Plays the whole chapter: this recording has no verse timings yet.").
- Verses with notes show "● N".
- Step 4 opens that key term's page (STUDY-023); while recording, key words are not links.
- Step 5 shows "Other Bibles" (recordings offered for the passage), the Bible's copyright line, and "Bible Brain terms" (accessibility label "Open the Bible Brain terms of use") for a Bible Brain Bible.
- No audio shows "{Bible} · no audio for this passage", and no Bible at all shows "No Bible for this passage yet".

### STUDY-029 Choose a Bible
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- LANG-A offers at least two Bibles, or TRANS has added one to My Bibles (STUDY-031).

Steps:
1. In the workspace's Bible chip, tap the picker ("Bible: {abbr}. Choose another").
2. Choose another Bible.
3. Open the study's "Bible" chip and Review it → Background → "Passage" on the same device.

Expected:
- The sheet "Choose a Bible", sub "The one you choose plays and shows here, and in the study and reviews on this device.", lists each Bible and ends with "More Bibles" ("Find another Bible and add it").
- Step 2 switches the player and the text at once.
- Step 3 shows the chosen Bible there too.
- The choice is this device's; a second device keeps its own.

### STUDY-030 Find another Bible
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- Online. Bible Brain is set up on the local server (G2) with a real `BIBLE_BRAIN_ACCESS_KEY`. **Needs the key:** the test searches Bible Brain's live catalogue, so it skips (saying so) on a stack without one, which is the default local and CI stack.

Steps:
1. In the Bible picker, tap "More Bibles".
2. Type "s" in "Search for a language".
3. Type "sw" (Swahili's code start), then "Swahili".
4. Type "zzqx".
5. Tap the Swahili row.

Expected:
- The screen "More Bibles", sub "For Luke 15:11-32".
- One letter does not search; two or more do.
- Rows read "{name} · {autonym}" when the autonym differs (for example "Swahili · Kiswahili") with the sub "swh · N Bibles".
- Step 4 shows "No languages found" with "Try the name in English, or its three-letter code.".
- Step 5 lists "Bibles in Swahili", each row "{abbr} · {name}", and under "In your organization's library" the library's Bibles with "Can be kept offline" or "Streams only: needs a connection".
- The footnote reads "Bibles you add are yours, on this device, for this language. Your team's recommended Bibles always come first."
- Back from a Bible returns to the list; Back from the list returns to the workspace.

### STUDY-031 Add to My Bibles, then Remove
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- STUDY-030's list of Swahili Bibles (needs the Bible Brain key, see STUDY-030). The automated test runs the same steps on the organization's own library Bible ("Test Library Bible", TLB, added to each world by `e2e/ui/study-helpers.ts`), which needs no key; the Swahili Bible Brain half is by hand.

Steps:
1. Tap a Bible.
2. Read the detail, choose a chapter.
3. Tap "Add to My Bibles".
4. Open More Bibles again, open the same Bible, and tap "Remove from My Bibles".
5. Tap "Add to My Bibles".

Expected:
- The detail shows its name, "{abbr} · Swahili", a badge "Can be kept offline" or "Streams only", and "No audio for the Old Testament" or "No audio for the New Testament" when the book has none.
- It opens at the passage's book and chapter (Luke 15), with the lit book and chapter chips scrolled into view. Book and chapter chips (or "Previous chapter" and "Next chapter" for a library Bible) change the reader below.
- Step 3 shows "{abbr} added to My Bibles", with no Undo, and returns to the passage.
- In step 4 the reopened Bible shows a disabled "In My Bibles" and the link "Remove from My Bibles". Tapping the link shows "{abbr} removed from My Bibles", the footer turns back to "Add to My Bibles", and the Bible picker no longer lists it.
- After step 5 it shows in the Bible picker, with "My Bible" in the More Bibles list. Reopening it shows a disabled "In My Bibles" and a link "Remove from My Bibles".
- If adding fails, the toast reads "Not added. Try again." and the screen stays.
- Resets: TRANS's device has the Swahili Bible in My Bibles.

Changed (2026-10-16, decision 134): no toast offers Undo; the Bible's "Remove from My Bibles" link takes it out again.

Fixed (2026-10-28, UI audit finding 37): a Bible opened at chapter 1 with the book chips scrolled back to Genesis; it now opens at the passage's chapter and keeps the lit chips in view (`sources.tsx`).

### STUDY-032 Remove from My Bibles
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions:
- STUDY-031 added a Bible.

Steps:
1. Open it in More Bibles and tap "Remove from My Bibles".

Expected:
- It is removed: the footer turns back to "Add to My Bibles", and the Bible picker no longer lists it.
- The toast reads "{abbr} removed from My Bibles", with no Undo. "Add to My Bibles" in the footer adds it back. If removing fails, the toast reads "Not removed. Try again.".

Fixed (2026-10-12): removing shows "{abbr} removed from My Bibles" with Undo, which adds it back, as adding does (`sources.tsx`); "Not removed. Try again." if it fails.

Changed (2026-10-16, decision 134): no toast offers Undo; the footer's "Add to My Bibles" adds it back.

### STUDY-033 More Bibles without Bible Brain, or offline
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- Run twice: once against a server without Bible Brain configured, once in airplane mode with a Bible Brain Bible never opened on this device.

Steps:
1. Open More Bibles from the Bible picker.
2. (Offline) open a Bible Brain Bible.

Expected:
- Without Bible Brain: a build with no server address says "Bible Brain isn't set up on this device" with "Your organization's library still works. Ask whoever runs LangQuest for your team to connect the server."; a build whose server (the Worker) has no Bible Brain key keeps the search, and the list says "Bible Brain is not set up on the server yet." (the local stack). Either way the library's Bibles are still listed, with the footnote "Bibles you add are yours, on this device, for this language. Your team's recommended Bibles always come first.", and Back returns to the workspace.
- Offline: "You're offline, and this isn't on this device yet." No crash, and Back works. (The automated test covers the server without Bible Brain; the offline run is by hand.)

### STUDY-034 "Next chapter" stops at the last chapter
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- More Bibles open on a library Bible (one that shows "Previous chapter" and "Next chapter"), in Luke.

Steps:
1. Tap "Next chapter" until "Chapter 24", then once more.

Expected:
- It opens at "Chapter 15", the passage's (finding 37).
- After Luke 24, "Next chapter" is disabled, or moves to the next book.

Fixed (2026-10-12): "Next chapter" stops at the book's last chapter under the Bible's numbering (`chaptersInBook` of its versification, `sources.tsx`): after Luke 24 it is gone. Run on the organization's own Bible ("Test Library Bible", Luke in English numbering) that the world adds (`e2e/ui/study-helpers.ts`).

### STUDY-035 A note on a verse beside the recorder
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-SUBMITTED's workspace, Bible chip, recorder idle.

Steps:
1. Tap verse 20, then "Add a note here".
2. Say a note by voice, type "Ran: elders never run", tap "Add a note".
3. Open the "Notes" chip.

Expected:
- The sheet names where the note goes ("Luke 15:11-32 · verse 20").
- "Add a note" shows "Note added." and verse 20 shows "● 1" (or one more). Closing the sheet instead keeps what was said as a draft for the next note on that verse (decision 127).
- The "Notes" chip lists it first as "Note on verse 20", with a play button.
- REV sees it in Background → Notes and on the "Passage" chip.

### STUDY-036 The Bible offline
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-SUBMITTED is kept offline (Ready for offline) with its Bible; P-Q2 is not. Airplane mode on.

Steps:
1. Open P-SUBMITTED's workspace and play the Bible.
2. Open P-Q2's workspace and try to play the Bible.

Expected:
- Step 1 plays from the device.
- Step 2: the text shows if it is on the device, and the player is disabled with a download icon and "Audio is not on this device yet."; nothing spins forever, and recording still works.

Known issue (2026-10-12, found automating it): offline, a passage whose Bible was never opened on this device shows "No Bible for this passage yet" in the player and the pane, as if there were none, instead of the Bible with "Audio is not on this device yet." (P-Q2 in the workspace, web). Like STUDY-009, something that exists but has not come to the device must not be called missing.
