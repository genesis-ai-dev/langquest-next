# 06 · Recording

The recording workspace (`workspace`): the reference on top, the recorder
below, voice detection that keeps each part by itself (decision 125), verse
labels on parts (decision 82), several drafts (decision 83), Done as a
screen inside the workspace, and what happens when the field interrupts a
recording.

Read with [the README](README.md): the global preconditions G1 to G10, the
fixture and the role matrix apply to every test here.

Code under test: `src/screens/translate.tsx` (Workspace),
`src/simple/{recorder,publish,reference,verseParts,model,parts}.tsx`,
`src/recording/*`, `src/useRecorder.ts`, `src/recordingJournal*.ts`, and the
passage record's published page (`src/screens/passage.tsx`).

**Order and shared state.** Tests run in number order. REC-011 publishes
Version 1 of P-NEW and REC-016 publishes Version 2 of it; later tests in
this file, and REV tests that say so, start from that state. P-Q1 to P-Q4
are used where a test needs a passage nobody has touched. When a test is run
alone, bring its passage to the state its Preconditions name by following
the test that creates it.

**Words used here.**
- "The record" is the passage record (`passage_record`).
- "Speak for N seconds" follows G8.
- A "part" is one stretch of speech that voice detection kept by itself.
- `{TRANS-name}` and similar are the fixture accounts' display names.

---

## Opening the workspace

### REC-001 Record opens the workspace for a passage nobody has recorded
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-NEW is not started (fixture).

Steps:
1. On My Work, tap P-NEW (Luke 13:1-9) in "Next for you", or open it from the Map.
2. On the record, tap "Record". If the main button reads "Study" (the passage has a study guide), tap the "Record" step row under it instead.

Expected:
- The workspace opens. Header title "Luke 13:1-9", sub "Recording Version 1", a ✕ ("Close") on the left. There is no Save button (decision 127); the saved mark on the right shows nothing until a part is kept.
- The divider sits at half: the reference on top, the recorder below.
- The chips over the reference show at least "Bible", "Key words" and "Notes". "Earlier" is not shown, because nothing has been recorded or reviewed yet.
- The "Bible" chip is selected.
- The recorder shows a lit card "Part 1" with "Recording next".
- The line "Tap the red button and speak. Pause between parts: each part is kept by itself." shows under it. There is no "Set up the microphone" link (LAN-82).
- The footer shows "Part 1" on the left, the big red button (accessibility label "Record") in the middle, and "Done" on the right, dimmed and disabled.
- The passage record is unchanged (nothing is written by opening the workspace).

### REC-002 My Work's Start opens the same workspace
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-NEW and P-Q1 to P-Q4 are not started, and COORD's requests to record them are open (fixture). The newest request leads "Next for you" (P-Q4 in the fixture, which asked P-NEW first).

Steps:
1. On My Work, find the "Next for you" card (one of P-NEW, P-Q1 to P-Q4).
2. Tap its "Start".
3. If the record opens, tap "Record" (or the "Record" step row).

Expected:
- The workspace for that passage opens with sub "Recording Version 1".
- Choose the "Notes" chip: COORD's request shows at the top of the notes: "Cora Coordinator asked", with no due date (decision 126).
- Tapping ✕ returns to the screen the test came from (My Work or the record), and nothing is written.

### REC-003 Continue recording opens the draft already on the device
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-DRAFT has TRANS's draft with two parts and no version (fixture).

Steps:
1. Open P-DRAFT (Luke 14:1-14).
2. Tap "Continue recording".

Expected:
- The record's main button reads "Continue recording", and its Record step says "Your parts are recorded, not published yet."
- The workspace opens with sub "Recording Version 1".
- The recorder shows one card "Parts 1–2" with "2 parts · {total length}" and a play button "Play Parts 1–2". The parts show under it by themselves when the pane has room, so its toggle reads "Hide the parts" ("Show the parts" when folded).
- The footer reads "Part 3", and "Done" is enabled.
- The "Tap the red button and speak…" hint is not shown.

---

## Recording parts

### REC-004 Record parts with voice detection
Roles: TRANS · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- REC-001's workspace for P-NEW is open, with nothing recorded.

Steps:
1. Tap the red "Record" button.
2. Speak for 4 seconds, then stay silent for 2 seconds.
3. Speak for 4 seconds, then stay silent for 2 seconds.
4. Speak for 3 seconds, then stay silent for 2 seconds.
5. Tap the red button again ("Stop recording").
6. Tap the check, "Done".

Expected:
- After step 1 the button turns to a stop button (accessibility label "Stop recording"), and the footer's left label turns red: "Part 1…".
- The lit card reads "Listening for you · pause between parts" while silent, and "Recording…" with a moving level meter while speaking.
- Each pause ends a part. Within 2 seconds of each pause the card above counts it: "Part 1", then "Parts 1–2", then "Parts 1–3", and the lit card moves to the next part number.
- After step 5 the session is still open (decision 129): the pane says "Stopped", the waveform shows the three parts boxed and numbered, the title reads "Part 4", the button reads "Record", and the footer has no "Done" (the recording view's check is the only one).
- After step 6 the card reads "Parts 1–3" with "3 parts · 0:1x" (about 11 seconds in total), and the footer reads "Part 4" in grey.
- The footer's "Done" is enabled.
- The saved mark in the header ends on its check ("Saved") once the parts are kept.
- No part is shorter than 1 second, and no part is empty.
- Afterwards, on the record, the main button reads "Continue recording" and the Record step says "Your parts are recorded, not published yet."
- On a second device signed in as COORD, after Sync now, P-NEW's record says "Some parts are recorded, not published yet." (the draft is on the record; G10.4).

Decided (2026-10-13), the docs were stale: decision 71's amendment of 2026-10-08 ("the recording workspace, Publish, the study and microphone setup now follow the agreed images") makes the lit part card and its meter the agreed recording view; the full-screen voice-detection panel (`VadPanel`) is back translation's. This test checks the lit card and the meter.

Changed (2026-10-16, decision 124): while recording, the pane below the divider is the red recording view (`RecordingView.tsx`) in the workspace and in back translation alike: its top row names the part being said ("Part 2", with its verses when it fills a place), the time and a check, Done; the live waveform fills the rest. Its label reads "Part 2. Recording…" or "Part 2. Listening for you · pause between parts"; the parts card returns when recording stops.

Changed (2026-10-16, decision 129): Stop no longer ends the session. Its parts stay boxes on the waveform, to hear, move or drop (REC-053), and are cut and saved, in order, when the session is left: Done, leaving the screen, or on a phone the next launch after a crash.

Fixed (2026-10-13), G10.3: on the web a part recorded while uploads are held back (they wait while the microphone is open) sometimes goes up only at the upload worker's next one-minute tick, so "waiting to upload" can stay above 0 for up to a minute after stop. Fixed in part (2026-10-13): the workspace asks for an upload when a session ends and after publishing (`translate.tsx`); the rest is in `useLanguage.ts` / the transfer worker. The web suite records it as a soft failure naming the recordings.

### REC-005 Parts can be heard together and one by one
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-NEW has TRANS's draft with three parts (REC-004).

Steps:
1. In the workspace, tap the play button on the "Parts 1–3" card ("Play Parts 1–3").
2. While it plays, tap it again ("Pause").
3. Look at the parts under the card (they show by themselves when the pane has room; otherwise tap "Show the parts").
4. Tap the play button on "Part 2 · 0:04" ("Play Part 2").
5. Tap "Hide the parts", then "Show the parts".

Expected:
- Step 1 plays the three parts one after another, without gaps longer than half a second between them.
- Step 2 pauses playback.
- In step 3, each part is a row: its verse space on the left (decision 82), then "Part 1 · 0:04", "Part 2 · 0:04", "Part 3 · 0:03", each with a play button. Deleting a part is in the sheet that holding its verse space opens ("Delete Part 2"; decision 82), not a trash button on the row.
- Step 4 plays Part 2 only.
- Step 5 folds the rows into the card and opens them again.
- No playback starts the microphone. The record button stays "Record".

### REC-006 What was recorded is clear and complete
Roles: TRANS · Priority: P1 · Platforms: iOS, Android · Run: Device

Preconditions:
- A quiet room. The person reads Luke 13:1-3 aloud in three sentences, pausing about a second between them.

Steps:
1. Open P-Q1 (Luke 13:10-17) and tap "Record" to open the workspace.
2. Tap the red button and read the three sentences, pausing between them.
3. Tap stop.
4. Play each part.

Expected:
- Three parts, one per sentence.
- No part cuts off the first or last syllable.
- No part has a click, a gap or a stutter where the device switched between listening and recording.
- The volume is even from part to part.
- Resets: P-Q1 now has TRANS's draft. Delete it from Versions and history before a fresh run.

### REC-007 Delete a part, then Undo
Roles: TRANS · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-NEW has TRANS's draft with three parts (REC-004).

Steps:
1. In the workspace, look at the parts (tap "Show the parts" if they are folded).
2. Hold Part 2's verse space, then tap "Delete Part 2" in the sheet (decision 82).
3. Within 7 seconds, tap "Undo" on the toast.

Expected:
- After step 2, the toast reads "Part 2 deleted." with "Undo", and stays for 7 seconds.
- The card reads "Parts 1–2", "2 parts · 0:07". The rows are "Part 1 · 0:04" and "Part 2 · 0:03" (the old Part 3, renumbered).
- After step 3, the toast reads "Undone.". The card reads "Parts 1–3" again, in the original order. Playing Part 2 plays the second sentence again.
- Every step is on the record: a second device, after Sync now, shows the same three parts in the same order (G10.4, G10.5).

### REC-008 Parts cannot be deleted while recording
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-NEW has TRANS's draft with three parts.

Steps:
1. In the workspace, look at the parts (tap "Show the parts" if they are folded).
2. Tap the red button to start recording, and stay silent.
3. Try to hold Part 1's verse space (where "Delete Part 1" is).
4. Try to tap play on "Part 1 · 0:04".
5. Tap stop.

Expected:
- During steps 3 and 4 the verse spaces and play buttons are dimmed and do nothing: no sheet opens, no toast shows, and no part is removed.
- While recording the footer has no "Done" (the recording view's check is Done); afterwards it is back and the saved mark shows its check.
- After step 5 every control is enabled again, and the draft still has three parts.

### REC-009 Deleting the only part leaves nothing to publish
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q2 (Luke 13:18-21) is not started.

Steps:
1. Open P-Q2 and tap "Record" (or the Record step row).
2. Record one part: speak for 3 seconds, then stop.
3. Hold Part 1's verse space, then tap "Delete Part 1".
4. Tap "Undo" on the toast.

Expected:
- After step 3 the toast reads "Part 1 deleted.". The parts card is gone, the lit card reads "Part 1", the hint "Tap the red button and speak…" is back, and "Done" is disabled.
- After step 4, "Undone." shows, Part 1 is back, and "Done" is enabled.
- Resets: P-Q2 now has TRANS's draft.

### REC-010 Leaving keeps the draft, and the mark says so
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-NEW has TRANS's draft with three parts, and it is TRANS's only draft of P-NEW.

Steps:
1. In the workspace, look at the header.
2. Tap ✕.
3. On the record, tap "Continue recording".

Expected:
- Step 1: the saved mark on the right of the header shows its check ("Saved"); there is no Save button (decision 127).
- Step 2 returns to the record with no toast. Nothing is lost: every part was already kept when it was recorded.
- Step 3 opens the same three parts.

---

## Publishing

### REC-011 Done, then ask the usual people for the peer check
Roles: TRANS · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-NEW has TRANS's draft with three parts (REC-004 and REC-007).
- Online.

Steps:
1. In the workspace, tap "Done".
2. Look at the Done screen without changing anything.
3. Tap "Ask {usual target}".

Expected:
- Step 1 opens the Done screen inside the workspace (decision 127). Header title "Luke 13:1-9", sub "Version 1", with ✕.
- A player for the whole version, titled "Version 1", with the sub "3 parts · 0:11 · recorded with the {abbr} Bible" (the Bible's abbreviation, when one is offered).
- A row "Say something about it" with the sub "Optional · the team hears it with this version". The row has no amber border.
- "Next check", with a card for each check that comes next ("Peer check" and "Back translation", decision 91) and its people (in the fixture "Trevor Both, Rita Reviewer"). No sentence explains publishing.
- The footer offers "Ask {usual target}" (in the fixture "Ask the Peer check team"), enabled, then quiet links "Someone else" and "Send later".
- Step 3 publishes Version 1 and asks for the peer check in one write: the toast reads "Sent to {target} — anyone on it will see it on My Work" (a team) or "Sent to {target} — they will see it on My Work" (a person), with Undo (which takes the asking back, not the version).
- It returns to the record's path; there is no "Version 1 published" page.
- The draft is gone from Versions and history; Version 1 is listed under "Published" with "Latest".
- Within 30 seconds, Sync shows nothing waiting to upload (G10.3). On a second device as REV, after Sync now, P-NEW's record shows Version 1 and its audio plays.
- Resets: P-NEW now has Version 1 by TRANS, and its Peer check is asked.

### REC-012 After Done, the record says who was asked, and they find it on My Work
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- REC-011 has just finished P-NEW's Version 1 and asked for its Peer check; the record shows.

Steps:
1. Look at the record's path.
2. As REV, on a second device, Sync now and open My Work.

Expected:
- The Record step reads "Version 1 · 0:11" and the Done step "Published just now · asked {target}".
- The record does not offer "Ask for the peer check" again.
- REV finds P-NEW on My Work as a Peer check to do.

### REC-013 Done's ✕ and Android back return to the workspace and keep everything
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q2 has TRANS's draft with one part (REC-009).

Steps:
1. Open P-Q2's workspace and tap "Done".
2. Tap "Say something about it", type "Draft for the team", tap "Done".
3. Tap ✕.
4. Tap "Done" again.
5. Android only: press the system Back button.

Expected:
- Step 3 returns to the workspace, not the record. The part is still there, and nothing was published.
- After step 4 the Done screen opens with what was typed kept (decision 127): the row reads "What you said about it" with "“Draft for the team”".
- Step 5 returns to the workspace too; it never leaves past it.
- No version exists on the record.

### REC-014 Say something about Version 1 by voice
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q2 has TRANS's draft with one part.

Steps:
1. In P-Q2's workspace, tap "Done".
2. Tap the row "Say something about it".
3. In the sheet "Say something about it" (sub "Anything the team should know. They hear it with this version."), tap "Say it", speak for 3 seconds, tap to stop.
4. Tap "Done".
5. Tap "Send later".

Expected:
- After step 4 the row reads "What you said about it" with the sub "Voice note", and its icon is a green check.
- Step 5 shows "Version 1 published." and asks nobody: the record's main button reads "Ask for the peer check".
- On the record, Versions and history → Version 1 plays the voice note with the version.
- REV, on a second device, hears the voice note on Version 1 after Sync now.
- Resets: P-Q2 now has Version 1.

### REC-015 A note at a moment of the version, while publishing
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q3 (Luke 13:22-30) has TRANS's draft with two parts (record them as in REC-004).

Steps:
1. In P-Q3's workspace, tap "Done".
2. Play the version, and at about 0:05 tap "Note" on the player.
3. In the sheet, type "verse 24 needs a slower pace", tap "Done".
4. Tap ✕ without publishing.

Expected:
- Step 2 pauses nothing that matters and opens the sheet with its text field already holding "At 0:05: ".
- After step 3 the row reads "What you said about it" with the sub "“At 0:05: verse 24 needs a slower pace”".
- Step 4 returns to the workspace and publishes nothing.

### REC-016 Version 2 needs "what changed"
Roles: TRANS · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-NEW has Version 1 by TRANS (REC-011), and TRANS has no draft of it.

Steps:
1. Open P-NEW. Open Versions and history and tap "Edit" on Version 1. (Once a version is published, the Record step row opens that version, not the workspace.)
2. Look at the workspace before recording.
3. Record one more part: speak for 3 seconds, then stop.
4. Tap "Done".
5. Look at the row under the player, and at the footer.
6. Tap the row, type "Added verse 9 again, slower", tap "Done".
7. Tap "Send later".

Expected:
- Step 1 opens the workspace with sub "Recording Version 2" and Version 1's parts already in the card.
- Step 2 shows "These are Version 1's parts. Record a new part or delete one to publish a new version.", and "Done" is disabled.
- After step 3 that line is gone, the card counts one more part, and "Done" is enabled.
- Step 5: the row reads "Say what changed" with the sub "Needed · since Version 1, so the team knows what to listen for", with an amber border. The footer's "Ask …" is disabled, and "Send later" does nothing.
- The sheet opened in step 6 is titled "What changed?" with the sub "Since Version 1. The team hears it with this version.", and its voice button reads "Say what changed".
- After step 6 the row reads "What changed" with "“Added verse 9 again, slower”", and the footer's "Ask …" is enabled.
- Step 7 shows "Version 2 published." and returns to the record.
- Afterwards, Versions and history lists Version 2 as latest and Version 1 under it. Version 1 is unchanged (decision 83: a published version never changes).
- A reviewer opening Version 2 for review sees "What changed in Version 2:" followed by the typed note (REV-010).
- Resets: P-NEW now has Version 2.

### REC-017 What changed can be said instead of typed
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q2 has Version 1 by TRANS (REC-014).

Steps:
1. Open P-Q2's Versions and history and tap "Edit" on Version 1 (it opens Version 1's parts).
2. Record one more part, then tap "Done".
3. Tap "Say what changed", tap "Say what changed" in the sheet, speak for 3 seconds, stop, tap "Done".
4. Tap "Send later".

Expected:
- After step 3 the row reads "What changed" with the sub "Voice note", and the footer's "Ask …" is enabled with nothing typed.
- Step 4 shows "Version 2 published.".
- REV's review of Version 2 shows "What changed in Version 2: said in a voice note" and a "Play what changed" button that plays it.

### REC-018 Changing a published version's parts makes a new draft
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q2 has Version 2 by TRANS, with at least two parts.

Steps:
1. Open P-Q2's Versions and history and tap "Edit" on Version 2 (it opens Version 2's parts, sub "Recording Version 3").
2. Delete the last part (hold its verse space, "Delete Part 2").
3. Tap ✕.

Expected:
- After step 2 "Done" is enabled, because the list differs from Version 2, and the saved mark shows its check.
- Step 3 goes back to where the workspace was opened from (the Versions page), with the draft kept.
- Version 2 still has all its parts when played from Versions and history.
- Versions and history shows "Your draft" with one fewer part than Version 2. ("from Version N" is added only when the draft started from a version other than the latest; Version 2 is the latest.)

### REC-019 Several drafts of one passage
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q2 has TRANS's draft from REC-018.

Steps:
1. Open P-Q2. Open "Versions and history" and tap "New version".
2. Record one part, then tap ✕.
3. Go back to the record, then open "Versions and history".

Expected:
- Step 1 opens an empty workspace with the header sub "New draft"; once its first part is kept it reads "Draft 2" (the person now keeps more than one).
- Step 2 goes back to the Versions page, which lists "Your drafts" with both (the saved mark had shown the part kept).
- In step 3 the record still leads with "Ask for the peer check" (Version 2 is not asked yet), so "Continue recording" is not offered; Versions and history lists "Your drafts" with both, each with play, Edit, Done and Delete. (Record with several drafts opening this page is PASS-059's.)
- Deleting one shows "{name} deleted." with Undo, and Undo brings it back with the same parts.

---

## Microphone permission

### REC-020 Microphone permission refused
Roles: TRANS · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- Fresh install (G4), so the app has not asked for the microphone yet.
- P-Q4 (Luke 13:31-35) is not started.

Steps:
1. Open P-Q4 and tap "Record" (or the Record step row).
2. Tap the red button.
3. When the system asks for the microphone, choose "Don't Allow" (iOS), "Don't allow" (Android) or "Block" (Chrome).
4. Tap the red button again.

Expected:
- After step 3 the recorder shows "Microphone permission is required." in place of a part.
- The button returns to "Record". No part is made, and "Done" stays disabled.
- Step 4 shows the same message again without a crash. On iOS and Android the system does not ask a second time.
- The app does not hang: ✕ still returns to the record, and nothing is written.
- Automation: phones, `apps/mobile/test/maestro/flows/REC-020.yaml` (Maestro grants permissions at launch, so the app is started again with the microphone denied). Web, `e2e/ui/06-recording-mic.spec.ts`: Chrome runs with `--use-fake-ui-for-media-stream`, which answers every prompt "Allow" even with the site's permission set to denied through DevTools, so "Block" is the page's microphone refusing (getUserMedia fails with NotAllowedError, as after a person blocks it).

### REC-021 Recording works once the microphone is allowed in Settings
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- REC-020 has just refused the microphone.

Steps:
1. Leave the app. In the system Settings (iOS, Android) or the site's settings (Chrome), allow the microphone for LangQuest.
2. Return to the app (on the web, reload the page and reopen P-Q4's workspace).
3. Tap the red button, speak for 3 seconds, then stop.

Expected:
- The error message is gone once recording starts.
- One part is recorded, and "Done" is enabled.
- On Android, if the app restarts when the permission changes, it reopens without a crash and P-Q4's workspace opens normally.

### REC-022 Microphone permission taken away while the app is in the background
Roles: TRANS · Priority: P2 · Platforms: iOS, Android · Run: Device

Preconditions:
- The microphone is allowed. P-Q4's workspace is open with one part.

Steps:
1. Leave the app. In system Settings, turn the microphone off for LangQuest.
2. Return to the app (Android may restart it).
3. Open P-Q4's workspace and tap the red button.

Expected:
- "Microphone permission is required." shows. No crash, no crash screen.
- The earlier part is still in the draft.

---

## Interruptions and field conditions

### REC-023 The app killed mid-recording keeps every part that ended
Roles: TRANS · Priority: P0 · Platforms: iOS, Android · Run: Auto

Preconditions:
- P-Q3 has TRANS's draft with two parts (REC-015).
- `adb shell am force-stop` (Android) or `xcrun simctl terminate` (iOS) is ready, or Maestro's `killApp`.

Steps:
1. Open P-Q3's workspace and tap the red button.
2. Speak for 3 seconds, pause 2 seconds (a third part ends), speak for 3 seconds, pause 2 seconds (a fourth part ends).
3. Start speaking again, and while speaking, kill the app.
4. Launch the app again and open LANG-A's map.
5. Open P-Q3 and tap "Continue recording".

Expected:
- The app starts without a crash and without a "This screen could not open" screen.
- Within 30 seconds of opening the language, the draft holds four parts: the two from before and the two that ended in step 2.
- No part appears twice, and no part is empty or silent.
- Each part plays.
- Within 30 seconds online, Sync shows nothing waiting to upload, and a second device sees four parts after Sync now.

Phones: `apps/mobile/test/maestro/flows/REC-023.yaml`, on P-T (which no other phone flow touches; it starts empty, so the parts that ended are "Parts 1–2").

Known issue (2026-10-12), still open 2026-10-13: the part being spoken when the app is killed (step 3) is lost. A part is written to the recording journal only once voice detection ends it (`useRecorder.ts` `deliver`), so audio still being captured has no journal entry to resume. The fix is native: the microphone module (`modules/microphone-energy`) keeps the open segment in memory; it would have to stream it to a staging file named in the journal when the segment starts, so a restart can ingest what was captured. The test passes if every part that ended before the kill is kept exactly once; it records the lost in-progress part as this known issue.

### REC-024 A part killed while it was being saved is finished on the next launch
Roles: TRANS · Priority: P1 · Platforms: iOS, Android · Run: Device

Preconditions:
- P-Q3 has TRANS's draft with four parts.
- A slow device, or Android's "Don't keep activities" with a large part, so that saving takes a moment.

Steps:
1. In P-Q3's workspace, record one part of about 60 seconds, then tap stop.
2. Within half a second of tapping stop, kill the app.
3. Launch the app and open LANG-A's map, then P-Q3, then "Continue recording".

Expected:
- The 60-second part is in the draft, once, and plays to the end (the journal finished its save: `recordingJournalModel.ts` resumes by recording id).
- No duplicate part, and nothing waits to upload after 30 seconds online.
- If the audio file itself was lost (the device never wrote it), the part is absent and the app does not crash; the journal keeps the entry and does not show an error on every launch.

### REC-025 Web: closing the tab while recording asks first
Roles: TRANS · Priority: P1 · Platforms: Web · Run: Auto

Preconditions:
- P-Q3's workspace is open in Chrome.

Steps:
1. Tap the red button and speak for 3 seconds without pausing.
2. Close the tab (or reload) while still speaking.
3. Cancel the browser's "Leave site?" dialog.
4. Pause for 2 seconds, tap Done, then reload the page and open P-Q3's workspace.
5. Tap the red button again; once a part has ended, tap Done, then close the tab outright, the way a browser that is killed does (no dialog), and open LangQuest again in the same browser and P-Q3's workspace.

Expected:
- Step 2 shows Chrome's "Leave site?" (or "Reload site?") dialog, because recording is in progress.
- After step 3 recording continues.
- After step 4 the part spoken in steps 1 to 4 is in the draft.
- With the recorder idle and nothing waiting to send, closing the tab (or reloading) shows no dialog. (While work waits to send, the web's leave guard asks too, `storageGate.tsx` `useLeaveGuard`; that is intended.)
- After step 5 the part kept when the session was left is in the draft, once (the web keeps its files in the browser; `recordingJournal.ts`).
- Changed (2026-10-16, decision 129): on the web a session not yet left lives in the page, so the browser asks before the tab closes; a tab killed outright before Done loses that session's parts. A phone keeps them in its journal (REC-023).
- Note: on the web, a part that ended but had not yet been stored in the browser before a reload is lost (`recordingJournal.ts`: a blob URL does not outlive the page). This is expected on the web.

### REC-026 Putting the app in the background stops recording and keeps the last part
Roles: TRANS · Priority: P1 · Platforms: iOS, Android · Run: Auto

Preconditions:
- P-Q3's workspace is open. (The phone flow, `flows/REC-026.yaml`, uses P-DRAFT, which no other phone flow touches.)

Steps:
1. Tap the red button and speak for 4 seconds without pausing.
2. While still speaking, press Home (swipe up on iOS).
3. Wait 10 seconds, then return to the app.

Expected:
- Recording has stopped on return: the button reads "Record" and the pane says "Stopped" (decision 129: the session is still open, its parts boxes on the waveform).
- After Done, the part spoken before step 2 is in the draft, as the last part, and plays.
- No part is recorded while the app was in the background (the 10 seconds are not in the draft).
- The OS's "microphone in use" indicator (iOS orange dot, Android green dot) goes off within 2 seconds of step 2.

### REC-027 Pulling down Control Center or the notification shade while recording
Roles: TRANS · Priority: P2 · Platforms: iOS, Android · Run: Device

Preconditions:
- P-Q3's workspace is open.

Steps:
1. Tap the red button and speak for 3 seconds.
2. Pull down Control Center (iOS) or the notification shade (Android), wait 3 seconds, close it.
3. Speak for 3 seconds, pause 2 seconds, then tap stop if still recording.

Expected:
- iOS: the app becomes inactive, so recording stops at step 2 and the part so far is kept in the open session (Done saves it, decision 129). After step 2 the button reads "Record"; step 3 records nothing until the person taps the button again.
- Android: the app stays active, recording continues, and the speech in step 3 becomes a part.
- On both, no part is lost, none is duplicated, and there is no crash.
- If iOS stopping on Control Center is judged a problem in the field, report it against `useRecorder.ts` (it stops on any AppState other than "active").
- A Maestro flow drives the gestures on a simulator or emulator and checks the recorder's state (`flows/REC-027.yaml`, on P-DRAFT); a person confirms the audio on a device.

### REC-028 A phone call during a recording
Roles: TRANS · Priority: P1 · Platforms: iOS, Android · Run: Device

Preconditions:
- A real phone with a SIM, and a second phone to call it.
- P-Q3's workspace is open.

Steps:
1. Tap the red button and speak for 3 seconds.
2. Call the phone from the second phone. Answer, talk for 10 seconds, hang up.
3. Return to LangQuest.

Expected:
- Recording stops when the call comes in. The part spoken before the call is kept and plays.
- Nothing from the phone call (either voice) is in the draft.
- On return the recorder is idle ("Record"), and tapping it records normally.
- No crash, and no "A part did not save." message.

Known issue (2026-10-12), suspected: the recorder stops only on app state changes (`AppState`), and nothing handles the audio session being interrupted or losing audio focus. On Android an incoming call screen may leave the app "active", so the detector may keep running on a muted microphone, or fail with "The microphone could not start." on return. Record what happens on each platform. Reviewed 2026-10-13: still open, and only a device run can tell. A fix belongs in the native microphone module (`modules/microphone-energy`: iOS `AVAudioSession.interruptionNotification`, Android audio-focus loss), emitting an event `useRecorder.ts` stops on as it does for AppState.

### REC-029 A Bluetooth headset's microphone
Roles: TRANS · Priority: P2 · Platforms: iOS, Android · Run: Device

Preconditions:
- A Bluetooth headset with a microphone, paired and connected.

Steps:
1. Open P-Q3's workspace and record two parts, speaking into the headset.
2. Play the parts on the headset.
3. Start recording again, and halfway through a part, switch the headset off.
4. Speak for 3 seconds into the phone, pause, and stop.

Expected:
- Step 1 records from the headset: the parts are audible and not clipped.
- Step 2 plays through the headset.
- Step 3 does not crash the app. Either recording continues from the phone's microphone or it stops with the part so far kept; it never shows "This screen could not open".
- No part is empty or silent.

### REC-030 A five-minute part, and a five-minute session of many parts
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q4 has no draft (delete it from Versions and history if REC-021 left one).
- A 5 minute 20 second speech file with no pause longer than half a second (for the first half), and a 5-minute file with a 1.5-second pause every 10 seconds (for the second half).

Steps:
1. Open P-Q4's workspace and tap the red button.
2. Play the 5:20 file into the microphone, then 2 seconds of silence. Tap stop.
3. Tap the red button again. Play the 5-minute file with pauses, then tap stop.
4. Tap the parts card's play button and listen to the first 10 seconds and the last 10 seconds of Part 1.

Expected:
- After step 2 there is one part of about 5:20 ("Part 1 · 5:20").
- After step 3 there are about 31 parts in all, and the card reads "Parts 1–31" with "31 parts · " and about ten minutes (a little under: most of each pause is trimmed off its part, so 9:3x to 10:xx).
- The workspace stays responsive: the lit card and meter keep moving, and taps answer within half a second, through all ten minutes.
- Part 1 plays from start to end without gaps.
- "Show the parts" lists every part and scrolls smoothly.
- "Done" then "Send later" succeeds, and REV on a second device can play the whole version after Sync now.
- Resets: P-Q4 now has Version 1.

### REC-031 Tapping record and stop very fast
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q1's workspace is open with TRANS's draft (REC-006, or record one part).

Steps:
1. Note the part count.
2. Tap the red button 10 times as fast as possible, with no speech.
3. Wait 3 seconds.
4. Tap the red button once, speak for 3 seconds, pause, tap stop.

Expected:
- After step 3 the button is in one clear state ("Record" or "Stop recording") that matches what the microphone is doing (the OS indicator agrees).
- No empty, silent or zero-length part was added, and the count is unchanged.
- No error message and no crash.
- Step 4 adds exactly one part.

### REC-032 Low storage: a part that cannot be saved says so and can be retried
Roles: TRANS · Priority: P1 · Platforms: Android · Run: Device

Preconditions:
- The Android emulator's storage is filled until under 5 MB is free (for example with `adb shell fallocate` on a large file in /sdcard).
- P-Q1's workspace is open.

Steps:
1. Tap the red button, speak for 20 seconds, pause, tap stop.
2. Free space by deleting the large file.
3. Tap "Retry saving".

Expected:
- The app does not warn before recording; there is no low-storage check today.
- If the part cannot be written, the recorder shows "A part did not save." with "Retry saving". The red button and "Done" are disabled while a part is unsaved.
- If the part was saved but the draft could not be written, the recorder shows "Your takes are saved on this device but not yet in your draft. {reason}" with "Try again".
- After step 3 the part is saved, the message goes away, and the part plays.
- No earlier part was removed to make room (recordings are never evicted).
- If storage cannot be opened at all, the app shows "LangQuest could not open its storage" instead of a crash.

### REC-033 Record and publish in airplane mode
Roles: TRANS · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q1 has TRANS's draft. It was opened online once, so the passage and its Bible text are on the device.
- Airplane mode on (Web: DevTools → Network → Offline).

Steps:
1. Open P-Q1's workspace and record two more parts.
2. Tap "Show the parts", delete one part, tap "Undo".
3. Tap "Done", then "Send later".
4. Turn airplane mode off and wait 30 seconds.

Expected:
- Steps 1 to 3 behave and read exactly as online: the same parts, "Part N deleted.", "Undone.", then "Version 1 published.".
- It returns to the record, where the version shows as published; its events wait on the device until there is a connection.
- My Work shows the sync chip while offline, and Sync shows the events waiting to upload.
- After step 4 nothing waits to upload, and a second device as REV, after Sync now, sees Version 1 and can play every part.
- Sync shows nothing refused (G10.2).
- Resets: P-Q1 now has Version 1.

### REC-034 Nothing says "waits for a connection" while online
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions:
- Online. A passage with a draft ready to publish (for example P-Q3).

Steps:
1. Tap "Done", then "Send later".
2. Read the record and the sync mark.

Expected:
- While online, nothing says the version waits for a connection; the sync mark settles once it has gone.

Changed (2026-10-16, decision 127): Done returns straight to the record, so the published page and its line are gone.

Fixed (2026-10-13): the line always reads "{title} · saved on this device · sends when you're online" (`passage.published.savedHere`), even online, after the upload has finished.

Fixed (2026-10-13): online, the published page reads "{title} · sent to the team" once the upload has gone, and "{title} · sending now" while it is going (`screens/passage.tsx`). Offline it still says it sends when you're online.

### REC-035 A success toast with nothing written while the language is still loading
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions:
- Fresh install (G4). TRANS signed in, on a slow network (Android emulator network speed "EDGE", or Chrome "Slow 3G").

Steps:
1. As soon as My Work shows P-DRAFT, open it, tap "Continue recording", then "Show the parts" and delete a part.
2. Tap "Undo".
3. Wait until loading finishes, then reopen the workspace.

Expected:
- Either the action is not offered until the language has loaded, or it is saved: the draft after step 3 matches what the toasts said.

Fixed (2026-10-13): `language.run` (`useLanguage.ts`) returns without writing when the language's sync client is not ready yet, so `ctx.act` can toast success ("Part 2 deleted.", "Version N published.") for a change that was never written. Record whether the draft matches the toasts. Reported 2026-10-13 with a proposed patch for `useLanguage.ts`: `run`, `append` and `appendMany` throw a "still loading" error when the client is not ready, so `ctx.act` shows a failure toast instead of success.

---

## Listening while recording

### REC-036 Playing the Bible while recording pauses the microphone
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q3's workspace is open on the "Bible" chip. LANG-A's English Bible has audio for Luke 13 (online, or kept offline).

Steps:
1. Tap the red button and speak for 3 seconds, pause 2 seconds.
2. Tap the Bible's play button.
3. Let it play 5 seconds, then pause it.
4. Speak for 3 seconds, pause 2 seconds.
5. Tap play on the Bible again, then tap "Resume" on the lit card.
6. Speak for 3 seconds, pause, tap stop.

Expected:
- During step 2 the lit card reads "Paused while the Bible plays" with an amber "Resume" button (accessibility label "Resume recording now"), and the meter is gone.
- Nothing the Bible plays is recorded as a part.
- After step 3 the card reads "Listening for you · pause between parts" again: recording resumed by itself.
- Step 4 adds a part.
- Step 5 stops the Bible and resumes recording at once; step 6 adds a part.
- Played aloud (Device), none of the parts contain the Bible's audio.
- Web run: skipped when the world offers no Bible with audio. The local library (2026-10-13) holds no English source, so the fixture's "an English Bible" is not offered and the workspace says "No Bible for this passage yet"; the test then reports the precondition rather than passing or failing.

### REC-037 The Bible in the reference pane
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q3's workspace is open on the "Bible" chip, recorder idle.

Steps:
1. Tap the Bible's play button, wait 15 seconds, tap "Back 10 seconds".
2. Tap the Bible picker ("Bible: {abbr}. Choose another").
3. Close the sheet. Tap verse 25's text.
4. Tap "Add a note here", type "Hard to say 'Lord, open to us'", save.
5. Start recording and look for "Add a note here".

Expected:
- Step 1 plays; the player shows "{Bible} · 0:15 / {total}", then about 0:05 after Back 10.
- Step 2 opens the sheet "Choose a Bible", listing each offered Bible, and "More Bibles" at the end.
- Step 3 plays from verse 25 (if the Bible has verse timings) and selects the verse.
- Step 4 shows the toast "Note added." Verse 25 then shows "● 1", and the "Notes" chip's count goes up by one.
- Step 5: "Add a note here" is gone while recording. It comes back after stop.
- The copyright line and "Bible Brain terms" show under the verses when the Bible comes from Bible Brain.
- Web run: skipped when the world offers no Bible, as REC-036.

### REC-038 The reference reaches every chip
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-NEW has Version 2 (REC-016). P-NEW has an FIA study guide (the record shows a Study step).

Steps:
1. Open P-NEW's workspace.
2. Tap each chip in turn: "Bible", "Guide", "Key words", "Notes · N", "Earlier".

Expected:
- All five chips show, in that order.
- "Guide" shows the step bar ("Previous step", "{n}/{total} {title} ▾", "Next step") and the step's text, then "Open the study".
- "Key words" lists the words in the passage, or "No key words in this passage yet. Add one your team should say the same way every time.".
- "Notes · N" lists notes, newest first, with "Add a note" at the end.
- "Earlier" lists Version 2 and Version 1, with "What changed in Version 2".
- On a passage with nothing recorded (P-Q4 before REC-030), "Earlier" is not offered.

Decided (2026-10-13), the docs were stale: decision 71's amendment of 2026-10-08 names the workspace's chips (Bible, Guide, Key words, Notes and Earlier) as the agreed design, so the chips are right and `docs/ux/screen-path.md`'s "Help (key terms, study, notes, history)" tray is out of date. `src/recording/WorkspaceTray.tsx` (the old Help tray) and its `recording.tray.*` words are used by no screen and can go. In the fixture world P-NEW has no FIA guide (no Study step), so "Guide" is not offered there; the web run then checks the other four and notes the precondition.

### REC-039 Notes from the workspace
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q3's workspace is open, recorder idle.

Steps:
1. Tap the "Notes" chip, then "Add a note".
2. In the sheet, tap "Or type it", type "The fig tree means Israel here", tap "Add a note".
3. Start recording and look at "Add a note".

Expected:
- Step 2 shows the toast "Note added." and the note is first in the list, as yours.
- The chip reads "Notes · {N+1}".
- During step 3 "Add a note" is disabled.
- REV sees the note in Background → Notes when reviewing P-Q3 (after it is published).

### REC-040 The divider, its five stops and its one-line ends
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q3's workspace is open with at least three parts.

Steps:
1. Drag the divider all the way up.
2. Tap the Bible bar.
3. Drag the divider all the way down.
4. Tap the red button on the recorder bar, speak 3 seconds, pause, tap it again.
5. Tap the recorder bar's text.
6. Drag the divider to about two thirds down, leave with ✕, reopen the workspace.
7. Screen reader on: focus the divider and swipe up and down.

Expected:
- Step 1 leaves the reference as one line: "Play the Bible", "Bible · {abbr}", "Drag down for the guide, key words, notes and earlier recordings", and Back 10.
- Step 2 opens the divider back to half.
- Step 3 leaves the recorder as one line: "Part 4" with "3 parts recorded", and a 56-point red button. The footer (record and Done) is hidden.
- Step 4 records a part from the bar; the bar reads "Recording…" while capturing.
- Step 5 reopens the divider to half.
- Step 6: the divider snaps to one of 0, 35, 50, 65 or 100 percent, and reopens where it was left (for the rest of this app session).
- Step 7: the divider's label is "Divider between reference and your recording", its hint "Drag up or down to give either one more room", and its value reads "Source 35%" (and so on), "Reference as one line", "Recorder as one line".
- The divider's touch area is at least 48 points tall.
- Fixed (2026-10-13): on the web the divider had no value for a screen reader (react-native-web reads `aria-valuetext`, not `accessibilityValue`); `SplitPane.tsx` now gives both. Step 7's swipes are a device check; the web run checks the label and the value at each stop.
- When the recorder pane is shorter than 360 points, the parts card shows closed ("Parts 1–4, 4 parts · 0:16"); tapping it opens it and gives the recorder the room (the reference goes to one line). Changed (2026-10-16, LAN-83): the card no longer gives way to "Parts 1–4 recorded · drag up to see them".

---

## Verse labels on parts (decision 82)

### REC-041 Tap a part's space to give it the next verse
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q3 has TRANS's draft with at least three parts and no verse labels. LANG-A's Bible names Luke 13:22-30's verses.

Steps:
1. In the workspace, look at the parts (tap "Show the parts" if they are folded).
2. Tap the empty space left of Part 1.
3. Tap the empty space left of Part 2.
4. Tap "Undo" on the toast.
5. Tap Part 2's space again, then tap the number now shown on Part 2.

Expected:
- Each part has an empty space on its left (accessibility label "Part 1, no verse yet", hint "Tap to give it the next verse. Hold to choose.").
- Step 2 shows the toast "Part 1 is verse 22." with Undo; Part 1 shows 22 in a soft grey tile.
- Step 3 shows "Part 2 is verse 23.".
- Step 4 shows "Undone." and Part 2's space is empty again.
- Step 5: the first tap gives 23; tapping the number then makes Part 2 the same verse as the part above ("Part 2 is more of verse 22."), shown hollow and grey.
- Labels are on the record (`v1.CardVerseSet`): a second device shows the same numbers after Sync now.

### REC-042 Hold a part to choose its verses, Auto, None or Delete
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- REC-041's draft.

Steps:
1. Hold Part 3's space.
2. In the sheet "Part 3", tap verse 25, then verse 26.
3. Tap "Auto".
4. Tap "None".
5. Tap "Delete Part 3", then "Undo".

Expected:
- Step 1 opens a sheet titled "Part 3" with the passage's verses as chips, and "Auto", "None" and "Delete Part 3".
- Each tap applies at once with a toast: step 2 ends with "Part 3 is verses 25–26.".
- Step 3 lets the app work it out from the neighbours ("Part 3 follows the order.").
- Step 4 clears it ("Part 3 has no verse.").
- Step 5 deletes the part ("Part 3 deleted.") and Undo restores it.
- A later part whose label no longer fits after a chosen verse loses its label instead of breaking the order.

### REC-043 Slide down the spaces to number many parts
Roles: TRANS · Priority: P2 · Platforms: iOS, Android · Run: Auto

Preconditions:
- P-Q3's draft has at least five parts, with no labels after Part 2. (The phone flow, `flows/REC-043.yaml`, uses P-T after REC-023 and records up to five parts first.)

Steps:
1. Press on Part 3's space and slide down to Part 5's space without lifting.

Expected:
- The toast reads "3 parts numbered." with Undo.
- Parts 3 to 5 take the next verses in order.
- A space that cannot take a verse (every verse is used) shakes when tapped and changes nothing.

### REC-044 A verse left for later, then tap its place and record
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-Q3's draft has Part 1 as verse 22 and Part 2 as verse 24 (choose them by holding).

Steps:
1. Look between Part 1 and Part 2.
2. Tap that place ("Record Part 2 here").
3. Tap the red button, speak for 3 seconds, pause, tap stop.

Expected:
- A row for the place left out shows between the two parts: verse 23's number, a dashed microphone and "Part 2"; the old Part 2 reads "Part 3".
- Step 2 chooses it: it is tinted, its microphone is filled and it reads "Recording next"; the footer reads "Part 2"; the end card is dashed.
- After step 3 the new part sits between Part 1 and the old Part 2, labelled verse 23, and the place is gone.
- Recording again, with nothing chosen, adds parts at the end.

Changed (2026-10-16, decision 124): the amber "Verse 23 · left for later" row and its "Record here" button became a place to tap; the red button records there.

---

## A stopped session (decision 129)

### REC-053 A stopped session: hear a part, move its edge, drop one, carry on, then Done
Roles: TRANS · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- Luke 12:35-48, called P-S below, is not started.

Steps:
1. Open P-S and tap "Record" (or the Record step row).
2. Tap the red button. Speak for 3 seconds, pause, three times.
3. Tap the red button ("Stop recording").
4. Tap part 2's box on the waveform.
5. Drag part 1's right edge to the right.
6. Tap the × in part 3's box.
7. Tap the red button, speak for 3 seconds and pause.
8. Tap the check, "Done".

Expected:
- After step 3 the pane says "Stopped" and the waveform shows the whole session with parts 1 to 3 boxed and numbered, each with handles on its edges and an × in its corner. The footer has no "Done".
- Step 4 plays part 2 as it would be kept, with a line moving through its box; a second tap stops it.
- After step 5 part 1's box is longer; its edge stops at the room kept around it and never runs into part 2.
- After step 6 part 3's box is gone, its sound shows as not kept, and the title reads "Part 3": its place and number are kept for what is said next.
- After step 7 the new part is boxed as part 3.
- After step 8 the card reads "Parts 1–3" with "3 parts", part 1 as long as its box, and part 3 the one said in step 7.

### REC-054 Throw away a session: the ✕ asks first, then nothing said in it is kept
Roles: TRANS · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-DRAFT, TRANS's fixture draft of two parts (REC-003).

Steps:
1. Open P-DRAFT and tap "Continue recording".
2. Tap the red button. Speak for 2.5 seconds, pause, twice.
3. Tap the ✕ at the left of the red view ("Throw away this recording").
4. Tap "Cancel".
5. Tap the ✕ again, then "Throw away".

Expected:
- Step 3 stops recording (the button reads "Record") and asks "Throw away this recording?" with "2 parts · 0:0x", "Throw away" and "Cancel".
- After step 4 the session is still open and stopped, with parts 3 and 4 boxed.
- After step 5 the red view is gone and the card reads "Parts 1–2" as before: nothing said in the session is kept, and no event is written.
- A session that kept no part (nothing said, or only taps) goes at the ✕ without asking.

## Microphone setup

### REC-045 Set up the microphone by ear (retired)
Retired 2026-10-16: decision 125 removed microphone setup (LAN-82). Parts split by the room and the voice the microphone hears, learned while recording (`modules/microphone-energy/src/splitter.ts` and its two native ports, tested in `apps/mobile/test/splitter.test.ts`); nothing is set.

### REC-046 Microphone setup when nothing is heard, or every try sounds bad (retired)
Retired 2026-10-16: decision 125 removed microphone setup (LAN-82). Parts split by the room and the voice the microphone hears, learned while recording (`modules/microphone-energy/src/splitter.ts` and its two native ports, tested in `apps/mobile/test/splitter.test.ts`); nothing is set.

### REC-047 Adjust the microphone by hand (retired)
Retired 2026-10-16: decision 125 removed microphone setup (LAN-82). Parts split by the room and the voice the microphone hears, learned while recording (`modules/microphone-energy/src/splitter.ts` and its two native ports, tested in `apps/mobile/test/splitter.test.ts`); nothing is set.

### REC-048 Microphone setup without microphone permission (retired)
Retired 2026-10-16: decision 125 removed microphone setup (LAN-82). Parts split by the room and the voice the microphone hears, learned while recording (`modules/microphone-energy/src/splitter.ts` and its two native ports, tested in `apps/mobile/test/splitter.test.ts`); nothing is set. REC-020 still covers a refused microphone.

### REC-049 Very short parts suggest setting up the microphone (retired)
Retired 2026-10-16: decision 125 keeps every part with speech in it, a one-word answer included, so there is no "very short" box or "Too short to keep" message; only a tap or a bump makes no part.

### REC-050 Reviewers and viewers are not offered recording
Roles: REV, VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-DRAFT has TRANS's draft; P-NEW has Version 2.

Steps:
1. Open P-DRAFT's record.
2. Open P-NEW's record, then "Versions and history".
3. Tap the Record step row on each.
4. REV only: on My Work, look at every card.

Expected:
- Neither record offers "Record", "Continue recording", "Record a fix", "Edit" on a version, "New version" or a header "More → record a new version".
- Tapping the Record step row does nothing, or opens the version (when one is published); it never opens the workspace.
- No screen in this run reaches "Recording Version …".
- My Work offers REV no recording work.
- VIEW sees the passage read only (G10.6).

### REC-051 A role changed while the record is open
Roles: TREV, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- Two devices: TREV on device 1, COORD on device 2. TREV has Translate (fixture).

Steps:
1. Device 1 (TREV): open P-Q4's record and leave it open.
2. Device 2 (COORD): change TREV's role at LANG-A to Reviewer (PEOPLE tests describe how).
3. Device 1: wait for sync (or pull to refresh), then tap the "Record" step row or "Continue recording" if it is still on screen.

Expected:
- After sync, the record no longer offers recording.
- If the old button is still tapped before the screen updates, the app shows "You don't have permission to open that." and stays on the record. No crash (G10.6).
- Resets: COORD gives TREV back the "Translator-Reviewer" role.

### REC-052 A translator-reviewer records and publishes
Roles: TREV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- TREV holds Translate and Review (fixture, restored after REC-051).
- Luke 12:49-59, called P-T below, is not started (every passage the fixture does not name is untouched).

Steps:
1. Open P-T and tap "Record" (or the Record step row).
2. Record two parts and tap "Done", then "Send later".

Expected:
- The workspace and Done behave exactly as for TRANS (REC-004, REC-011).
- The published page offers "Ask {usual target}".
- REV-030 continues from here (TREV reviewing their own version).
- Resets: P-T has Version 1 by TREV.
