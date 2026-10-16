# 07 · Reviewing

Review it (`review_capture`): Listen, Questions and Decide, notes at a
moment, Background, "Looks good" and "Needs changes" with "What should
change?". Back translation (`back_translation`), said part by part and
published for the next check. And the translator answering feedback:
"Hear the feedback", then "Record a fix" or "Keep it, say why".

Read with [the README](README.md): the global preconditions G1 to G10, the
fixture and the role matrix apply to every test here. Decision 71's second
amendment (8 October) is the specification for these screens.

Code under test: `src/screens/review.tsx` (ReviewCapture),
`src/simple/{review,reviewVoice,btWorkspace}.tsx`, `src/reviewing/*`,
`src/screens/passage.tsx` (ReviewDetail, KeepPage, the published page) and
`src/screens/translate.tsx` (Workspace when answering feedback).

**Order and shared state.** Tests run in number order.
- P-SUBMITTED gets REV's "Looks good" in REV-003, then a Version 2 (with
  the library's worked study and a note by TRANS) for REV-011.
- P-Q1 (TRANS's Version 1) gets REV's "Needs changes" in REV-005, and
  TRANS keeps it in REV-043.
- P-Q2 (TRANS's Versions 1 and 2, what changed said by voice) gets "Needs
  changes" in REV-006, a fix in REV-042 and a kept reason in REV-045.
- P-Q3 (TRANS's Version 1) gets "Needs changes" with a retelling in REV-007
  and is back-translated in REV-034 to REV-039.
- P-NEW (Versions 1 and 2, what changed typed) is opened in REV-008, REV-010
  and REV-024, which save nothing. P-ASIDE's Peer check is REV-009's. P-S
  (Versions 1 and 2, said by voice) is REV-010's, then REV-022's.
- P-CHECK's Consultant check is used for questions (REV-012 to REV-018) and
  is completed in REV-017.
- P-BT gets its back translation in REV-032.
- P-NEEDS is answered with "Record a fix" in REV-041; "Keep it, say why"
  uses P-Q1's feedback (REV-043), and P-Q1 gets Version 2 in REV-048.
When a test is run alone, bring its passage to the state its Preconditions
name by following the test that creates it. The automated tests
(`e2e/ui/07-reviewing.spec.ts`) make these versions and requests
through the server as the person who would.

**Questions in the fixture.** Peer check has no questions. Consultant check
has four: the three shipped ones (from the organization, so no source line
shows): a 1 to 5 rating "How well does this draft hold up against the
source in the hardest verses?", a Yes/No "Are the key terms aligned with
the language's key terms list?" and a text "Notes for the translation
team"; and the one COORD added on the check (decision 91), a required Yes/No
"Does it carry the meaning of the original?", shown with "Required" and the
source "Language team". Community check has four shipped questions.

**One word for a check (decision 91).** Screens name a review stage with
its check's name: "Peer check", "Consultant check", "Do the peer check".

---

## Review it: Listen

### REV-001 "Do the peer check" opens Review it on Listen
Roles: REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-SUBMITTED has Version 1 by TRANS, and the Peer check is asked of REV (fixture).

Steps:
1. On My Work, find P-SUBMITTED (Luke 15:11-32) and open it.
2. On the record, tap "Do the peer check".

Expected:
- The record's main button reads "Do the peer check" (decision 91: "check" is the one word for a review stage).
- Review it opens. Header title "Luke 15:11-32", sub "Peer check", with ✕.
- Under the header, the step strip shows two steps, "Listen" and "Decide" (no "Questions", because the Peer check has none here). "Listen" is current.
- A large player titled "Version 1 · recorded by {TRANS first name}", with the sub "Listen to all of it first", a timeline, "Back 10 seconds" and "Note".
- If whoever asked left directions, a banner "{name} asked · {due}" with "Play their directions" shows above the player.
- If the check has helps linked to it (decision 91), they are listed under "For Peer check" above Background, each opening its note, guide or Bible.
- A "Background" row whose sub lists what is there, for example "The passage, the team's study, {TRANS first name}'s notes, key words".
- A dashed row "Who is listening?" with "optional".
- The footer is "Next: decide".
- Nothing is written by opening the screen.

### REV-002 My Work's check row opens the same screen
Roles: REV · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- As REV-001.

Steps:
1. On My Work, tap P-SUBMITTED's row under "Then" ("Check Luke 15:11–32", sub "Peer check · asked by {TRANS-name}"), or the "Next for you" card when it is P-SUBMITTED.

Expected:
- Review it opens on Listen for Luke 15:11-32, as in REV-001.
- ✕ returns to My Work.

### REV-003 Looks good
Roles: REV · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- As REV-001. Online.

Steps:
1. Open P-SUBMITTED and tap "Do the peer check".
2. Play the version to the end.
3. Tap "Next: decide".
4. Tap "Looks good".

Expected:
- Step 3 shows Decide: the heading "Is it accurate and natural?" with a speak button, a green "Looks good" card, an amber "Needs changes" card and a dashed row "Say something about it" with the sub "{TRANS first name} hears it with your answer" and "optional".
- The strip shows "Listen" done (green check, accessibility label "Listen, done. Go back").
- Step 4 saves at once, with no further screen. The toast reads "Looks good · sent to {TRANS-name}", with "Undo" (REV-049 takes it back).
- The app returns to P-SUBMITTED's record, where the team's first step reads "Peer check looks good".
- Within 30 seconds nothing waits to upload. TRANS, on a second device after Sync now, sees an update that the Peer check looks good in the Inbox (from the bell), and the record shows it.
- The request to REV is done: P-SUBMITTED leaves REV's My Work.
- Resets: P-SUBMITTED's Peer check is "looks good".

### REV-004 A note at a moment while listening
Roles: REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q1 has Version 1 by TRANS (REC-033), and nobody has reviewed it.

Steps:
1. Open P-Q1 and tap "Do the peer check".
2. Play the version, and at about 0:04 tap "Note".
3. In the sheet "A note at 0:04", tap "Tap and speak", speak for 5 seconds, tap to stop. Close the sheet.
4. Look under the player, then tap "Remove" on the note.
5. Add the note again as in steps 2 and 3.

Expected:
- The sheet's sub reads "Say what you noticed here. {TRANS first name} hears it with your review."
- After step 3 the list under the player shows "Your note at 0:04" with "0:05 · goes with your review", a play button ("Play your note at 0:04") and "Remove".
- Step 4 removes it with no toast.
- Notes at moments are not written until the review is saved; REV-005 saves this one.

### REV-005 Needs changes, said and typed
Roles: REV · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- REV-004 has left one note at 0:04 on P-Q1's Review it, still open on Listen.

Steps:
1. Tap "Next: decide".
2. Tap "Needs changes".
3. Tap "Tap and speak", speak for 5 seconds, tap to stop.
4. Tap "Or type it", type "Verse 12 is too fast".
5. Tap "Send feedback".

Expected:
- Step 2 opens "What should change?": an amber pill "Needs changes", the heading "What should change?", and "Say it in your words. {TRANS first name} will hear it.". The step strip and ✕ are gone; the header's back arrow remains.
- Before steps 3 and 4, "Send feedback" is disabled.
- After step 3 the big mic is replaced by a chip "Your feedback · 0:05" and "Record again".
- Step 4's field has the placeholder "Or type it — what worked, what didn't".
- A dashed row "Record a listener retelling" with "optional" is under it.
- Step 5 shows the toast "Feedback sent to {TRANS-name}", with "Undo", and returns to P-Q1's record.
- The record's first step reads Peer check "needs changes", with REV's name.
- TRANS, on a second device after Sync now, sees an Inbox update that Peer check suggests changes ("… suggests changes — revise, or keep it and say why."), and P-Q1's main button reads "Hear the feedback".
- In TRANS's "Hear the feedback", the voice feedback plays, "“Verse 12 is too fast”" shows, and the note at 0:04 is listed with the review.
- Resets: P-Q1's Version 1 has needs-changes feedback from REV, not yet answered.

### REV-006 "Send feedback" needs words; text alone is enough
Roles: REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q2 has Version 2 by TRANS (REC-017), not yet reviewed by REV.

Steps:
1. Open P-Q2, tap "Do the peer check", then "Next: decide", then "Needs changes".
2. Try "Send feedback".
3. Tap "Or type it" and type a single space.
4. Type "Verse 19 says 'tree' twice".
5. Tap "Send feedback".

Expected:
- Steps 2 and 3: "Send feedback" stays disabled (blank text does not count).
- After step 4 it is enabled without any voice.
- Step 5 shows "Feedback sent to {TRANS-name}" and returns to the record.
- Resets: P-Q2's Version 2 has needs-changes feedback.

### REV-007 A listener retelling with the feedback
Roles: REV · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q3 has a published version by TRANS (publish TRANS's draft from REC-044 if needed), not yet reviewed.

Steps:
1. Open P-Q3, tap "Do the peer check", "Next: decide", "Needs changes".
2. Tap "Record a listener retelling".
3. In its sheet, tap "Tap and record the retelling", speak for 6 seconds, stop.
4. Tap "Remove" on the chip, then record it again.
5. Type "They missed the narrow door", tap "Send feedback".

Expected:
- The sheet's sub reads "Ask someone who listened to tell it back in their own words. It goes with your review."
- After step 3 the row is replaced by a chip "Listener retelling" with "Remove" (accessibility label "Remove the retelling").
- Step 5 saves; TRANS sees the retelling as a recording with the review.

### REV-008 Back from "What should change?" returns to Decide
Roles: REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- A version REV has not reviewed is open in Review it (for example P-NEW's Version 2 from REC-016).

Steps:
1. Tap "Next: decide", then "Needs changes".
2. Type "Too quiet at the start".
3. Tap the header's back arrow.
4. Tap "Needs changes" again.
5. Android only: press the system Back button.

Expected:
- Step 3 returns to Decide, with the strip and ✕ back. Nothing is saved.
- After step 4 the typed text is still in the field.
- Step 5 should return to Decide, as the header's back arrow does.
- Steps 1 to 4 run in Playwright; step 5 is the Maestro flow `flows/REV-008.yaml` (on iOS it uses the header's arrow).

Fixed (2026-10-12): `review.tsx` now handles the phone's Back on "What should change?" (back to Decide), and with anything said asks before leaving (REV-024).

### REV-009 Who is listening
Roles: REV · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-NEW's Version 2 is open in Review it on Listen.

Steps:
1. Tap "Who is listening?".
2. Tap "One more person" three times, then "One fewer person" once.
3. In "Where — e.g. Bor church, after service", type "Bor church".
4. Tap "Done".
5. Tap "Next: decide", then "Looks good".

Expected:
- The sheet is titled "Who is listening?". Its counter reads "2 people" after step 2, and its buttons are labelled "One more person" and "One fewer person".
- After step 4 the row reads "2 people · Bor church" with "Change" on the right.
- Step 5 saves with the toast "Looks good · sent to {TRANS-name}".
- The review on the record shows the badges "2 people" and "Bor church".
- Resets: P-NEW's Version 2 Peer check is "looks good".

### REV-010 What changed in a later version
Roles: REV · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q2's Version 2 was published with what changed said by voice (REC-017).

Steps:
1. Open P-Q2 and review it: "Do the peer check".
2. Read the Listen page under the player.
3. Tap "Play what changed".

Expected:
- A card "What changed in Version 2: said in a voice note" shows under the player.
- Step 3 plays the voice note.
- For a typed note (P-NEW's Version 2) the card reads "What changed in Version 2: Added verse 9 again, slower".

### REV-011 Background
Roles: REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-SUBMITTED has the worked study for Luke 15:11-32 (the local library's "Example study guides (English)", followed by the organization; FIA's own English guides there cover only Genesis 2:4-25), at least one note by TRANS, and a version REV has not reviewed. Review it is open on Listen (the review need not be saved). A later version does not reopen a passage's Peer check once it looks good, so after REV-003 the automated test uses John 3:9–21, which the same worked study covers, with a note and Version 1 by TRANS.

Steps:
1. Tap "Background".
2. Tap each chip: "Passage", "Guide", "Notes · N", "Key words · N", "Earlier · N".
3. On "Passage", select verse 18 and leave a note: tap "Note", type "Is 'heaven' clear here?" and tap "Save note".
4. On "Passage", open the Bible picker, tap "More Bibles", then come back.
5. Close the sheet.

Expected:
- The Background row reads "The passage, the team's study, {TRANS first name}'s notes…".
- A sheet "Background" opens on "Passage": the Bible's player and verses, a Bible picker ("Choose a Bible, now {Bible}") and, in the picker, "More Bibles". The Bible's line reads "The source {TRANS first name} used" when the version records which Bible TRANS played (`v1.ReferencesUsed`), and the Bible's name otherwise.
- "Guide" shows the team's study: "The team's study · {method}" with steps, answers and notes, and "Open the study".
- Empty chips say so: "No notes on this passage yet.", "No key words were tied to this version.".
- "Earlier" lists every version of the passage and what was said about each (decision 91).
- Step 3 shows the toast "Note added — it follows this passage". TRANS sees it on the record.
- Step 4 opens "More Bibles" (STUDY-033); Back returns to Review it, still on Listen, with the sheet closed or open as it was.
- Step 5 returns to Listen. The note at a moment from earlier (if any) is still listed.
- When the review is saved, what Background offered and what was opened goes on the record with it (`v1.ReferencesUsed`).

### REV-012 Questions, one per screen
Roles: REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-CHECK is at Consultant check, with no consultant review (fixture).

Steps:
1. Open P-CHECK (Luke 15:1-10) and tap "Do the consultant check".
2. Tap "Next: questions".
3. On question 1, look at the card, then tap "4".
4. Tap "Next question".
5. On question 2, tap "Yes", then "Next question".
6. On question 3, look at the answer area, then tap "Next question".

Expected:
- The strip shows "Listen", "Questions", "Decide". The Listen footer is "Next: questions".
- Each question has its own screen with dots for the count (four dots, accessibility label "Question 1 of 4"), and the question text. The shipped questions come from the organization and show no source line; the language team's shows "Language team".
- Question 1 is a 1 to 5 rating, with "1 · not at all" and "5 · very well" at the ends. An optional question never holds the way forward: "Next question" is enabled before a value is chosen (only a required question waits, REV-016).
- Question 2 shows "Yes" and "No".
- Question 3 (text) shows a big mic "Tap and record the answer" and "Or type it".
- Question 4 is the required "Does it carry the meaning of the original?".
- The footer has "Skip" on the left and "Next question" on the right; on the last question the right button reads "Next: decide".
- On the web, each question also has "Hear it", which reads it aloud; on iOS and Android "Hear it" is not shown.

### REV-013 A text answer said aloud, or typed
Roles: REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- REV-012 is on question 3.

Steps:
1. Tap "Tap and record the answer", speak for 4 seconds, tap to stop.
2. Tap "Record again", and record 3 seconds instead.
3. Tap "Or type it" and type "Verse 7 'joy in heaven' is clear".
4. Tap "Next question", tap "Yes" on the required question, then "Next: decide".

Expected:
- After step 1 a chip "Their answer · 0:04" and "Record again" show.
- After step 2 the chip reads "Their answer · 0:03".
- Step 3 shows a field with the placeholder "Type the answer"; both the clip and the text are kept.
- Step 4 goes to Decide with the heading "Does it carry the meaning?".

### REV-014 Back to an earlier stage keeps the answers
Roles: REV · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- REV-013 is on Decide.

Steps:
1. Tap "Questions" in the strip ("Questions, done. Go back").
2. Look at question 1.
3. Tap "Listen" in the strip.

Expected:
- Step 1 opens the questions at the first one; question 1 still shows "4" chosen.
- Step 3 opens Listen, and moving forward again reaches Decide with every answer kept.

### REV-015 Skipping an optional question just moves on
Roles: REV · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- REV-014 is on question 2.

Steps:
1. Tap "Skip".

Expected:
- No sheet opens; question 3 shows.
- On Decide, nothing says a question was left, and "Looks good" is enabled.

### REV-016 An open required question holds the way forward
Roles: REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- The Consultant check carries the required Yes/No question "Does it carry the meaning of the original?" that COORD added on the check (fixture, decision 91; stored as `[yesno!] Does it carry the meaning of the original?`).
- P-CHECK's Consultant check has no review yet.

Steps:
1. Open P-CHECK, tap "Do the consultant check", then "Next: questions".
2. Answer or skip the three shipped questions and reach "Does it carry the meaning of the original?".
3. Without answering, look at the footer and the strip.
4. Tap "Yes", then "Next: decide".
5. Tap ✕, then "Leave".

Expected:
- On the required question, the right-hand footer button ("Next: decide") is disabled until it is answered or skipped. "Skip" is enabled.
- "Decide" in the strip cannot be tapped (only finished stages can).
- If Decide is ever reached with a required question still open, it shows "1 required question left — answer, or say why not" (tapping it opens that question), and both "Looks good" and "Needs changes" are dimmed and disabled.
- After step 4 Decide shows no such line, and both cards are enabled.
- Step 5 first asks "Leave without saving?" (an answer was given, REV-024); "Leave" leaves without saving anything.

### REV-017 A required question skipped with a reason
Roles: REV · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- The Consultant check carries the required question "Does it carry the meaning of the original?" (fixture).
- P-CHECK's Consultant check has no review yet (REV-016 saves nothing).

Steps:
1. Open P-CHECK, tap "Do the consultant check", then "Next: questions".
2. Answer or skip the three shipped questions, then reach "Does it carry the meaning of the original?".
3. Tap "Skip".
4. In the sheet, try "Skip question" without a reason.
5. Tap the quick reason "Listeners weren't able to judge this".
6. Tap "Skip question".
7. Tap "Next: decide", then "Looks good".

Expected:
- The question shows a "Required" badge and the source "Language team".
- Step 3 opens the sheet "Leave this question unanswered?" with "Required questions can be skipped — the reason is saved with your review.", the quick reasons "Listeners weren't able to judge this", "Not relevant for this passage" and "Ran out of time in the session", a field "Or type the reason", and "The reason is saved with your review.".
- Step 4: "Skip question" is disabled until there is a reason.
- After step 6 the question reads "Left unanswered: Listeners weren't able to judge this" with "Answer it".
- Step 7 saves with "Looks good · sent to {author-name}".
- The saved review (Versions and history → Reviews by version → the Consultant check) counts "1 left unanswered" on its "Answers to the questions" row; opened, it lists the question with "Left unanswered: Listeners weren't able to judge this".
- Nothing is refused by the server: the Consultant check passes ("looks good" in the app clears the checkpoint).
- Resets: P-CHECK's Consultant check has REV's review.

### REV-018 "Answer it" after skipping
Roles: REV · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- A required question has been skipped, as in REV-017 step 6 (before step 7). The automated test uses P-CHECK's Final approval, open once REV-017 passed the Consultant check, after COORD adds a required Yes/No question to it ("Is it ready to share?").

Steps:
1. Skip the required question with a quick reason, then tap "Answer it".

Expected:
- The reason is cleared; the "Yes" and "No" choices show again.
- "Next: decide" is disabled until it is answered or skipped again.

### REV-019 "Can't answer this?" as the specification names it
Roles: REV · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions:
- A question screen with a required question is open.

Steps:
1. Look for the way to say a question cannot be answered.

Expected:
- `docs/ux/screen-path.md` names it "Can't answer this?" under Review it's rarer actions.

Known issue (2026-10-12): the screen shows "Skip" in the footer and, for a required question, the sheet "Leave this question unanswered?". The "Can't answer this?" string (`review.parts.cantAnswer`) is in the catalog but not on screen. Either the screen or `screen-path.md` should change; record which is intended.

### REV-020 Verdict headings for each kind
Roles: REV · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions:
- Versions waiting for each kind: Peer check (any new version), Community check (P-BT once step 1 is done, after REV-032), Consultant check (P-CHECK), Final approval (a passage at step 4, if one exists).

Steps:
1. Open each kind's Review it and go to Decide.

Expected:
- Peer check: "Is it accurate and natural?".
- Consultant check: "Does it carry the meaning?" (P-CHECK is used up by REV-017; use a fresh fixture or check it there).
- Final approval: "Is it ready to share?".
- Community check: "Is it clear?", and its Listen sub reads "Play it for the group" instead of "Listen to all of it first".
- Community check shows the four shipped questions (two ratings, one Yes/No, one text).

---

## Review it: edges and failures

### REV-021 Nothing to review yet, and kinds that are not verdicts
Roles: REV, COORD · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- COORD has asked REV for Peer check of P-Q4 before any version (if P-Q4 has a version from REC-030, use another passage that is not started, for example Luke 12:35-48).

Steps:
1. REV: open that passage and tap "Do the peer check".

Expected:
- Review it shows "There's no recording to review yet." and "Once a version is published, it can be reviewed here.", with ✕.
- Nothing is written.
- Back translation never opens in Review it: if reached there, it shows "Back translation makes a recording" and "It isn't a verdict, so it isn't reviewed here. Use Back-translate it on the passage's record."

### REV-022 Review offline
Roles: REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q3's version was opened online once, so its audio is on the device (or P-Q3 is kept offline).
- Airplane mode on.

Steps:
1. Open P-Q3, tap "Do the peer check", play it, "Next: decide", "Looks good".
2. Turn airplane mode off and wait 30 seconds.

Expected:
- Step 1 reads exactly as online: the toast "Looks good · sent to {TRANS-name}".
- My Work shows the sync chip until step 2.
- After step 2 nothing waits to upload, and TRANS sees the review after Sync now.
- If the version's audio is not on the device, the player is disabled with a download icon and "Audio is not on this device yet." instead of failing to play.

### REV-023 A review the server refuses is not lost silently
Roles: REV, COORD · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- Two devices. REV on device 1 has a version open in Review it, offline. COORD on device 2.

Steps:
1. Device 2 (COORD): change REV's role at LANG-A to Viewer.
2. Device 1 (REV, still offline): tap "Next: decide", "Looks good".
3. Device 1: go online and wait for sync.

Expected:
- Step 2 saves on the device (the device does not yet know the role changed).
- After step 3, Sync shows the review as refused by the server, with a reason, and the app says so (PLAN.md invariant 1: nothing is dropped silently).
- If the device already knew of the change, step 2 shows "Not saved: {reason}" instead and stays on Decide.
- Resets: COORD gives REV back the Reviewer role; clear the refused item from Sync as the SYNC tests describe.

Fixed (2026-10-13), the Sync screen now reads refusals from the device log: after COORD makes REV a Viewer while REV is offline, the review is refused (the device's events table holds it as rejected), but the Sync screen (Me → More settings → Sync) shows "0 refused by the server" and "0 latest confirmed", as if it read another, unsynced language client. My Work and Me do not say so either (SYNC-019).

### REV-024 ✕ in the middle of a review
Roles: REV · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- A version REV has not reviewed is open in Review it.

Steps:
1. Leave a note at a moment, and answer a question if there are any.
2. Tap ✕.
3. Tap "Keep reviewing", then ✕ again and "Leave".
4. Open the same review again and tap ✕ without saying anything.

Expected:
- Step 2 asks first: a sheet "Leave without saving?" with "What you said and answered here is not saved until you send the review.", "Keep reviewing" and "Leave". A phone's Back does the same.
- "Keep reviewing" keeps everything (the note at a moment is still listed); "Leave" leaves and saves nothing.
- With nothing said, chosen or answered, ✕ leaves at once.

Fixed (2026-10-12): ✕ and the phone's Back now ask before discarding (`review.tsx`). Still open: if the app is killed, voice notes and big-mic recordings are not resumed, because the recording journal only resumes parts that have a passage target (`src/recording/`, REC-023).

### REV-025 A phone call while recording feedback
Roles: REV · Priority: P2 · Platforms: iOS, Android · Run: Device

Preconditions:
- A real phone with a SIM. REV on "What should change?" for a version not yet reviewed.

Steps:
1. Tap "Tap and speak" and speak for 3 seconds.
2. Receive a call, answer it, hang up after 10 seconds, return to LangQuest.

Expected:
- Recording has stopped. Either the 3 seconds are kept as "Your feedback · 0:03", or the big mic is back with nothing kept; in neither case is the phone call recorded.
- No crash, and "Send feedback" works after recording again.

### REV-026 Voice answers and notes sound right
Roles: REV · Priority: P2 · Platforms: iOS, Android · Run: Device

Preconditions:
- A version not yet reviewed is open in Review it.

Steps:
1. Leave a 5-second note at a moment, a 5-second voice feedback and a 5-second retelling, then send the feedback.
2. On a second device as TRANS, play each from "Hear the feedback".

Expected:
- Each plays in full, clearly, with the first and last word intact.
- Each is credited to REV, with its moment ("at 0:04") where it has one.

---

## Who may review

### REV-027 A translator is not offered Review it on their own versions
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Since decision 91 the Translator role holds Review, so TRANS may be on a check and review a teammate's version. TRANS's own versions are still not TRANS's to check.

Preconditions:
- P-SUBMITTED, P-CHECK and P-BT as in the fixture (each is TRANS's Version 1).

Steps:
1. Open each of P-SUBMITTED, P-CHECK and P-BT.
2. Open each step's sheet (tap the team steps).
3. Look at My Work.

Expected:
- No record offers "Do the peer check", "Do the consultant check", "Back-translate it", or "Review it now".
- No step sheet offers a review action. "Ask someone" and "Already happened" may show (TRANS holds Send to reviewers and Translate).
- My Work offers TRANS no review of these passages.
- No screen in this run reaches Review it or Back translation (G10.6).

### REV-028 A viewer sees no record or review controls
Roles: VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- Fixture passages as they are after the tests above.

Steps:
1. From the Map, open P-SUBMITTED, P-NEEDS, P-BT and P-CHECK.
2. Open each review listed under "Versions and history".

Expected:
- No main action that records, reviews, back-translates, answers feedback, asks or logs is offered: no "Record", "Continue recording", "Do the …", "Back-translate it", "Hear the feedback", "Record a fix", "Keep it, say why", "Ask for the …", "Already happened" or "Something else?" actions that change the record.
- Versions and reviews can be played.
- A review opened from the list shows its outcome and feedback with no footer buttons.

### REV-029 A reviewer cannot reach the recording workspace
Roles: REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-NEEDS has REV's needs-changes review, unanswered (fixture).

Steps:
1. Open P-NEEDS (Luke 14:15-24).
2. Open its review from "Versions and history" → reviews.

Expected:
- The record's main button is not "Hear the feedback" (that is the author's). REV sees the step as "needs changes".
- The review shows "Needs changes", REV's own feedback, and no "Record a fix" or "Keep it, say why".
- No route in this run opens the workspace; if one is forced, "You don't have permission to open that." shows (G10.6).

### REV-030 A translator-reviewer reviews their own version
Roles: TREV, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-T (Luke 12:49-59) has Version 1 by TREV (REC-052).
- COORD has asked TREV, by name, for Peer check of P-T (Ask someone → choose TREV).

Steps:
1. TREV: open P-T, tap "Do the peer check".
2. Tap "Next: decide".
3. Tap "Needs changes", read the page, tap the back arrow.
4. Tap "Looks good".

Expected:
- The player reads "Version 1 · recorded by you".
- Decide's "Say something about it" row reads "It goes on the record with your answer".
- "What should change?" reads "Say it in your words. It goes on the record." (no name, because the version is TREV's own).
- Step 4 shows the toast "Looks good · on the record".
- The record shows Peer check "looks good" by TREV.
- Resets: P-T's Peer check is "looks good".

---

## Back translation

### REV-031 "Back-translate it" opens the back translation
Roles: REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-BT has Version 1 by TRANS with Peer check "looks good", and Back translation is asked of REV (fixture). Version 1 has N parts (N is 2 or more).

Steps:
1. Open P-BT (Luke 14:25-35).
2. Tap "Back-translate it".

Expected:
- The record's main button reads "Back-translate it".
- The screen opens split like the workspace. Header title "Luke 14:25-35", sub "Back translation · into English" (on a wide window: "Alpha → English"), with ✕.
- Top: a player "Alpha · Version 1 · part 1" with the sub "{TRANS first name} · drag back and forth as often as you like", and the line "Say each part in English, in your own words. Notes and earlier checks are hidden on purpose, so only the recording shapes what you say."
- Bottom: a card per part, "Part 1" to "Part N". Part 1 is open, with "Saying it next".
- The footer has a big red record button (accessibility label "Record part 1") and "Publish", disabled.
- No notes, earlier reviews or study are shown anywhere on this screen.

Known issue (2026-10-12): `docs/ux/screen-path.md` calls the secondary action "Save back translation", and `flow.ts`'s edge comment says "tap Save back translation". The screen's button reads "Publish" (and the sheet's "Publish back translation"). The test passes on "Publish"; the doc is the issue.

### REV-032 Say each part, then publish the back translation
Roles: REV · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- As REV-031, on the back translation screen with nothing said.

Steps:
1. Tap the player's play button and listen to part 1.
2. Tap "Record part 1". Speak for 4 seconds, pause 2 seconds, speak for 3 seconds, pause 2 seconds.
3. Tap "Stop recording".
4. For each remaining part, listen, then record it the same way.
5. Tap "Publish".
6. In the sheet, type "The word for 'salt' has no match" under "Anything that was hard to say back? Optional".
7. Tap "Publish back translation".

Expected:
- While recording, the bottom shows the red recording view (decision 112, the workspace's too): "Part 1", a pulsing dot and its status, the elapsed time (accessibility label "Recorded for 0:07"), a check "Done", and the live waveform. Its label reads "Part 1. Recording…" while speaking and "Part 1. Listening for you · pause between parts" while silent.
- Every piece said in one recording goes to the part it started on, however many pauses it has.
- The footer shows "Stop recording". (The sensitivity line and the pause choices went in decision 112, with the recording thread's levels learned as you speak.)
- After step 3 Part 1 reads "0:07 in English · record to add more", with "Play your part 1", "Hear what you said" and a trash button "Delete part 1 to say it again". Focus moves to Part 2 ("Saying it next").
- Said parts that are not open read "0:07 in English".
- "Publish" is enabled after the first part is said.
- Step 5 opens the sheet "Publish the back translation?", sub "Of Version 1. The Consultant check listens to it next.", with "✓ N of N parts said".
- Step 7 shows the toast "Back translation published.", with "Undo".
- The record opens on "Back translation published" with "Luke 14:25-35 · saved on this device · sends when you're online".
- Afterwards, the record shows Back translation done ("Back translation recorded") on Version 1, and step 1 is complete.
- COORD, on a second device after Sync now, can play the back translation from the review, in part order, and reads the note.
- Resets: P-BT has its back translation.

Fixed (2026-10-12): a recording started on a part with nothing picked followed "the next part to say", so after its first piece landed every later piece went to the next part (Part 1, 2 and 3 each got a piece of one recording). The session now keeps to the part it started on (`btWorkspace.tsx`). The sheet names the next check by its check name, "Consultant check" (decision 91).

### REV-033 A reviewer who cannot ask is left at "Next, ask for a check"
Roles: REV · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions:
- REV has just published P-BT's back translation (REV-032), on its published page.

Steps:
1. Read the published page.

Expected:
- A reviewer without Send to reviewers or Assign work is not invited to ask: either "Next, ask for a check" is not shown, or it says who will.

Fixed (2026-10-13): the page shows "Next, ask for a check" and the Community check card ("Choose who checks it" or its usual team) even though REV cannot ask; the only button is "Done". The section is shown whenever there is a next check (`passage.tsx`, `page === 'ask'`), without checking `can.ask`.

### REV-034 Delete a part of the back translation, then Undo
Roles: REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- REV has started a back translation of a version with two or more parts and said Part 1 and Part 2, not published. (P-BT's is published by REV-032, so have COORD ask REV for Back translation of another published passage, for example P-Q3.)

Steps:
1. Tap Part 2 to open it, then tap "Delete part 2 to say it again".
2. Tap "Undo" on the toast.
3. Delete Part 2 again and let the toast go.
4. Tap "Record part 2", say it again, stop.

Expected:
- Step 1 shows "Part 2 deleted." with Undo. Part 2 reads "Saying it next".
- Step 2 brings it back ("0:0x in English").
- Step 4 records a new Part 2.
- If the device cannot restore, "Not restored: {reason}"; if it cannot delete, "Not deleted: {reason}".

### REV-035 Notes at a moment, for the consultant
Roles: REV · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- A back translation in progress, as in REV-034.

Steps:
1. Play part 2 of the version and tap "Note" at about 0:07.
2. In the sheet "A note at 0:07 in part 2", say it ("Say it"), tap "Add note".
3. Leave a second note at another moment: type "No word for 'disciple'", tap "Add note".
4. Tap "Publish" and read the sheet.

Expected:
- The sheet's sub reads "What was hard to say here? The Consultant check hears it with your back translation." and its field "Or type it — e.g. a word with no English match". "Add note" is disabled until something is said or typed.
- Under the parts: "2 notes for the Consultant check · they go with it when you publish".
- The publish sheet shows "✓ 2 notes at moments".
- The published note lists each note with its part and time ("Part 2 · 0:07: No word for 'disciple'").
- The second note's sheet, and the publish sheet's "Anything hard to say back?", read "One spoken note per back translation for now: type this one." and offer no "Say it".

Decided (2026-10-13, decisions.md 99, interim): a back translation carries one spoken note; the first said aloud keeps it and later notes are typed. A voice per moment still needs a change to what the event carries.

Known issue (2026-10-12, before the decision): the notes at moments and the publish sheet share one voice recording (`btWorkspace.tsx` `noteHash`). The second voice note replaces the first, the publish sheet opens already holding it, and a voice-only note at a moment is saved as the text "said in the voice note". Notes at moments are also kept only on screen: ✕ or a crash loses them, though the parts are kept. Not fixed here: `produceContent` records one note recording (`commentBlobHash`), and its artifacts are the back translation's own parts, so keeping a voice per moment needs a change to what the event carries (a design decision, PLAN.md section 6).

### REV-036 Publishing with parts not said
Roles: REV · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- A back translation in progress of a version with three or more parts, with only Part 1 said.

Steps:
1. Tap "Publish".

Expected:
- The sheet shows "✓ 1 of N parts said" and, in amber, "Nothing yet for part 2, 3" (the missing parts).
- "Publish back translation" is still enabled; the reviewer may publish what they have.
- ✕ on the sheet returns to the parts.

### REV-037 Parts are kept on the device until published
Roles: REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- A back translation in progress with two parts said.

Steps:
1. Tap ✕.
2. Reopen the back translation from the record.
3. Kill the app (iOS, Android) or reload (Web), relaunch, and reopen it.

Expected:
- After step 2 both parts are there ("Loading your parts…" may show first).
- After step 3 both parts are still there.
- If the device's copy cannot be read, the screen shows "Your earlier parts could not be read on this device (code X). Nothing was deleted." and does not crash.

Known issue (2026-10-12): a part still being spoken when the app is killed is lost, and a back translation piece is not resumed by the recording journal (its entry has no passage target).

### REV-038 Hearing the version while saying a part
Roles: REV · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- A back translation in progress, recording a part.

Steps:
1. While recording, tap the player's play button.
2. Let it play 3 seconds, then pause it.
3. Play it again and tap "Resume now".

Expected:
- During playback the panel reads "Paused while the source plays" with "Recording starts again when the source stops." and "Resume now".
- Nothing of the version's audio is in the part.
- After step 2 recording resumes by itself; step 3 stops playback and resumes at once.

### REV-039 Parts made from an older version
Roles: REV, TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- COORD has asked REV for Back translation of a passage of TRANS's whose latest is Version 1 (for example P-Q3), and REV has said Part 1 without publishing.

Steps:
1. TRANS (second device): open that passage, record one more part and publish Version 2.
2. REV: after sync, reopen the back translation.

Expected:
- An amber banner reads "Your parts were made from Version 1" with "Version 2 is out now, and publishing puts your back translation with it. Listen again and redo any part that changed."
- The player now plays Version 2.

---

## Answering feedback

### REV-040 "Hear the feedback" opens what the reviewer said
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-NEEDS: Version 1 by TRANS, reviewed by REV as needs changes with "Verse 18 is too fast" and a 5-second voice note, not answered (fixture).

Steps:
1. On My Work, open P-NEEDS (Luke 14:15-24).
2. Tap "Hear the feedback".

Expected:
- The record's path shows "Hear the feedback" ("Peer check · needs changes") and "Fix it, or keep it and say why" ("Then it goes back to the check"). The main button reads "Hear the feedback".
- The review opens: header "Luke 14:15-24" with ✕, an amber pill "Peer check · needs changes", REV's picture and name, "{when} · Version 1".
- A feedback card with a player "{REV-name}'s feedback" that plays the 5-second note, and "“Verse 18 is too fast”".
- "Hear Version 1, the version they heard" opens Version 1.
- The footer has "Record a fix" (primary) and "Keep it, say why".

Fixed (2026-10-13): the review's pill reads "Peer Review · needs changes", and a review opened from Versions and history is headed "Peer Review" / "Consultant Check": `ReviewDetail` (`passage.tsx`) names the kind by `kind.name`, not by its check name (`checkName`, decision 91), while the path above it says "Peer check".

### REV-041 Record a fix answers the feedback with Version 2
Roles: TRANS · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- As REV-040, on the review.

Steps:
1. Tap "Record a fix".
2. Look at the workspace.
3. Delete the part with verse 18 (or the last part) and record it again, slower: speak for 4 seconds, pause, stop.
4. Tap "Publish".
5. Look at the Publish screen.
6. Tap "Publish Version 2".

Expected:
- Step 1 opens the workspace with sub "Recording Version 2", on the "Earlier" chip, with REV's needs-changes review highlighted in amber.
- Version 1's parts are in the card, and "These are Version 1's parts. Record a new part or delete one to publish a new version." shows until something changes.
- Step 5: the row already reads "What changed" with "“Revised after the Peer check feedback.”" (prefilled, so "Publish Version 2" is enabled), and a green check line "Answers the Peer check feedback from {REV-name}".
- Step 6 shows "Version 2 published." and the published page "Version 2 published" with "Next, ask for a check" for Peer check.
- Afterwards, the feedback is answered: the record no longer shows "Hear the feedback", and the review shows "{TRANS-name} revised it · {when}" with "Open Version 2".
- REV, on a second device after Sync now, sees the update and can review Version 2; its Listen page shows "What changed in Version 2: Revised after the Peer check feedback.".
- Resets: P-NEEDS has Version 2 answering REV's feedback.

### REV-042 Record a fix offline
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q2's Version 2 has REV's needs-changes feedback (REV-006). Airplane mode on.

Steps:
1. Open P-Q2, "Hear the feedback", "Record a fix".
2. Record a part, "Publish", "Publish Version 3".
3. Go online and wait 30 seconds.

Expected:
- The voice feedback, if not on the device, shows "Audio is not on this device yet." with a disabled player; the typed feedback still shows.
- Step 2 reads as online and publishes Version 3 answering the feedback.
- After step 3 nothing waits to upload; REV sees Version 3 and the answer.

### REV-043 Keep it, say why
Roles: TRANS · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q1's Version 1 has REV's needs-changes feedback (REV-005), unanswered.

Steps:
1. Open P-Q1, tap "Hear the feedback".
2. Tap "Keep it, say why".
3. Try "Keep it".
4. Tap "Tap and say why", speak for 5 seconds, tap to stop.
5. Type "Verse 12 is at the speed the elders asked for" in "Or type it".
6. Tap "Keep it".

Expected:
- Step 2 opens a page: header "Luke 13:10-17" with sub "Keep it, say why" and a back arrow (no ✕), the heading "Keep it as it is?", "Say why. {REV-name} and the team will hear it.", a big mic "Tap and say why" and a field "Or type it".
- Step 3: "Keep it" is disabled until something is said or typed.
- Step 6 shows the toast "Kept · your reason is on the record" with Undo, and returns to the record.
- The record no longer shows "Hear the feedback". The review shows "{TRANS-name} kept it · {when}", the typed reason, and "Their answer, said aloud" playing the voice reason.
- REV, on a second device after Sync now, hears and reads the reason.
- No new version was made.
- Resets: P-Q1's feedback is kept (answered by keeping).

### REV-044 Undo after keeping
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- Run as part of REV-043, at step 6.

Steps:
1. Within 7 seconds of "Kept · your reason is on the record", tap "Undo".

Expected:
- The toast reads "Undone — the feedback is waiting again".
- The record's main button is "Hear the feedback" again, and the review offers "Record a fix" and "Keep it, say why".
- A second device shows the feedback waiting again after Sync now (G10.5).
- Then keep it again (as REV-043) so later tests find it kept.

Fixed (2026-10-13), via `ctx.act`'s new `undone` argument: the toast's Undo said only "Undone." The specific line "Undone — the feedback is waiting again" (`passage.page.undone.keep`) shows only when the keep is undone from the record's history, because `ctx.act` has no way to name what an Undo brings back (`passage.tsx` `keep`, `ctx.ts`). The automated test (a fresh request for changes on P-Q1 first, since REV-043's is kept) fails there.

### REV-045 Keep it: a voice reason alone, and the way back
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q2's Version 3 (REV-042), reviewed by REV as needs changes (have REV send feedback on it first), unanswered.

Steps:
1. Open P-Q2, "Hear the feedback", "Keep it, say why".
2. Tap the header's back arrow.
3. Tap "Keep it, say why" again. Android only: press the system Back button.
4. Tap "Keep it, say why" again, record a 3-second reason by voice only, tap "Keep it".

Expected:
- Step 2 returns to the review, not to the record.
- Step 3 (Android): the system Back button returns to the review too.
- Step 4: "Keep it" is enabled with only the voice reason, and saves with "Kept · your reason is on the record".
- The review shows the voice reason; the stored reason text is "Said by voice".

### REV-046 Only the author answers feedback
Roles: TREV · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- A version by TRANS has unanswered needs-changes feedback (for example P-Q3 after REV-007).

Steps:
1. TREV: open P-Q3.
2. Open the review.

Expected:
- TREV holds Translate, but the version is TRANS's: the record does not offer "Hear the feedback", and the review shows no "Record a fix" or "Keep it, say why".
- TREV may still record a new version from Versions and history; that does not answer TRANS's feedback.

### REV-047 One review screen answers feedback; the older footer is unreachable
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions:
- Any unanswered needs-changes feedback on TRANS's latest version.

Steps:
1. Reach the review by every route: the record's main button, the path's "Hear the feedback" and "Fix it…" rows, Versions and history → reviews, the Inbox update.

Expected:
- Every route opens the same "Feedback came back" layout (REV-040) with "Record a fix" and "Keep it, say why".

Known issue (2026-10-12): `ReviewDetail` also has an older footer ("Keep it" beside "Record a fix") that opens `KeepSheet` ("Keep and send reason"). Whenever the footer would show, the newer layout is returned first, so `KeepSheet` is dead code. Nothing to fail on screen; flag it for removal.

### REV-048 Answering feedback on P-Q1 with a new version
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q1's Version 1 feedback was kept (REV-043). REV has given new needs-changes feedback on Version 1 (review it again from REV's device).

Steps:
1. TRANS: open P-Q1, "Hear the feedback", "Record a fix".
2. Change a part, "Publish", "Publish Version 2".

Expected:
- The Publish screen lists one "Answers the Peer check feedback from {REV-name}" line for each open feedback on Version 1 (only the unanswered one here).
- Version 2 publishes and answers it.
- Resets: P-Q1 has Version 2.

### REV-049 Take back a review
Roles: REV · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- TRANS published P-DRAFT and asked REV for its Peer check.

Steps:
1. Do the peer check on P-DRAFT, tap "Looks good", then "Undo" on the message.
2. Do it again and tap "Looks good". Wait for the message to go, tap the Peer check row under "Then the team", and tap "Undo" in the sheet.
3. Close the sheet. Do it a third time, then open "Versions and history" → "History" and tap "Undo" on the review.

Expected:
- Step 1: "Undone." The record offers "Do the peer check" again.
- Step 2: the sheet shows "Undo" under REV's own check (no one else sees it, decisions.md 111). After it, the row reads "Tom Translator asked you" with "Review it now".
- Step 3: "Undone." Each review taken back stays in the history, crossed out, "undone just now".
- Afterwards P-DRAFT has no peer review that counts, three taken back, and TRANS's request to REV is open: P-DRAFT is back on REV's My Work, and TRANS's "reviewed" update is gone.
- Nothing is refused by the server.
