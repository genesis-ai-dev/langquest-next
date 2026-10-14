# 12. Sync and offline (SYNC)

The Sync screen, work done offline by each role, two devices converging,
Ready for offline, refused work, audio transfer, the update banner and
starting without a connection.

Read [the README](README.md) first: G1 to G10, the fixture and the accounts
apply here. G10.2 (nothing refused) is suspended only in the tests that say
they expect a refusal.

In quoted text, `{TRANS}`, `{REV}` and the like stand for that account's
display name.

How to go offline:
- iOS simulator: turn off the Mac's network for the simulator (Network Link
  Conditioner "100% Loss"), or airplane mode on a device.
- Android emulator: `adb shell svc wifi disable` and `adb shell svc data
  disable` (or airplane mode).
- Web: developer tools, Network, "Offline".

The rules these tests hold (PLAN.md section 4): no event is lost or dropped
silently (a refused one stays on the device, marked, with its reason, and is
shown); any order of the same events folds to the same state; the client
pushes in pages of at most 200 events.

---

## The Sync screen

### SYNC-001 The Sync screen, online
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions: None.

Steps:
1. Tap "Me", then "More settings", then "Sync".
2. Wait 5 seconds.

Expected:
- Header "Sync", with Back.
- A green banner "Live: changes arrive as they happen" (or, before the live
  channel opens, "Checking for changes now and then"). No body text under
  it.
- A card "Ready for offline", then "Always on this device" and "Needs a
  connection" (details in SYNC-017).
- Four tiles: "waiting to upload" 0, "refused by the server" 0, "latest
  confirmed" (a number above 0), "local checkpoint" (a number). On a phone
  they sit two by two.
- Two cards, "Audio uploading" and "Audio downloading", each with a green
  "Up to date" badge.
- No "Waiting" or "Refused" section.
- Under them "{n} events on this device" and the build line (SYNC-004).
- A footer button "Sync now".
- The numbers update by themselves about once a second.

### SYNC-002 The Sync screen, offline
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- The device is offline.

Steps:
1. Open "Sync".
2. Tap "Sync now".

Expected:
- An amber banner "Offline: work is kept on this device".
- Step 2: the button says "Syncing…" briefly, then "Sync now" again. No
  error toast and no crash.
- The tiles keep their values.

Fixed (2026-10-13): going offline is noticed only by the next try to
reach the server. Nothing tries when the network goes (`wake.ts` wakes sync
only when it comes back, decision 90), so until a write or Sync now the
banner still says "Live: changes arrive as they happen". Once a try fails,
the banner now says Offline even while the live channel still looks up
(fixed 2026-10-13 on the Sync screen).

### SYNC-003 Waiting work is listed until it goes
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- The device is offline.

Steps:
1. Add three notes to P-SUBMITTED (PASS).
2. Open "Sync".
3. Go online and watch the screen for 30 seconds.

Expected:
- Step 2: "waiting to upload" is 3 (or the number of events those notes
  made). A section "Waiting · 3" lists one row per event: its type without
  the version prefix and the passage it is about (for example "NoteAdded ·
  Luke 15:11–32", not "v1.NoteAdded"; updated 2026-10-13 for main's change
  labels), and the time it was made, to the second.
- Never more than 20 rows, however many are waiting.
- Step 3: the rows go, "waiting to upload" returns to 0, "latest confirmed"
  rises, and the section disappears.

### SYNC-004 The event count and the build line
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions: None.

Steps:
1. Open "Sync" and scroll to the end.

Expected:
- "{n} events on this device", with {n} above 0.
- The build line says which build is running:
  - A store or preview build with no update applied: "store build" and its
    date and time.
  - A build running an update: "update {first 7 characters of the update
    id}" and the update's date and time.
  - Otherwise: "update unknown".
- It matches the build noted in the run sheet (G1). The line can be
  selected and copied.

### SYNC-005 Sync now
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- Device 2 is signed in as COORD.

Steps:
1. Device 2 (COORD): add a note to P-SUBMITTED.
2. Device 1 (TRANS): open "Sync". Note "latest confirmed". Tap "Sync now".

Expected:
- The button says "Syncing…" and cannot be tapped again until it finishes.
- "latest confirmed" goes up.
- COORD's note shows on P-SUBMITTED on Device 1.

### SYNC-006 An app too old to sync says so
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions:
- On the local stack, the server is set to refuse this client's protocol
  version (the `LQ001` refusal). Ask the developer how for the current
  migration.

Steps:
1. Open "Sync".

Expected:
- Under the banner: "Update the app to sync."
- "Sync now" is disabled.
- Work made now still saves on the device and shows as waiting.

Resets: undo the server setting.

### SYNC-007 My Work's sync chip shows only when it matters
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions: None.

Steps:
1. On My Work, look beside the bell.
2. Go offline. Wait 10 seconds.
3. Still offline, add a note to P-SUBMITTED. Return to My Work.
4. Tap the chip.
5. Go online and wait 30 seconds. Return to My Work.

Expected:
- Step 1: no chip.
- Step 2: a chip "Offline".
- Step 3: the chip says "1 to send" (or the number of waiting events).
- Step 4: opens "Sync".
- Step 5: no chip.
- When the server refuses the account (SYNC-018), the chip says "Not
  syncing".
- The chip has a 48pt target and a screen reader reads its words.

Fixed (2026-10-13): step 2's chip does not appear until something
tries the server (a write, Sync now, or the offline poll), as in SYNC-002.

### SYNC-008 Changes from another device arrive by themselves
Roles: TRANS, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- Device 1 (TRANS) shows "Live: changes arrive as they happen" on Sync.

Steps:
1. Device 1 (TRANS): open P-SUBMITTED.
2. Device 2 (COORD): add a note to P-SUBMITTED.

Expected:
- Within 10 seconds, without "Sync now", the note appears on Device 1.
- If Device 1 shows "Checking for changes now and then" instead, the note
  arrives within a minute.

---

## Work done offline, by each role

### SYNC-009 A translator records and publishes offline
Roles: TRANS, COORD · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- Device 1 (TRANS) is offline. Device 2 (COORD) is online.

Steps:
1. Device 1 (TRANS): open P-NEW from My Work, record about 10 seconds in
   two parts, and publish Version 1 (REC).
2. Device 1: open P-NEW's record, then "Sync".
3. Device 1: kill the app and open it again, still offline.
4. Device 1: go online. Wait 30 seconds.
5. Device 2 (COORD): tap "Sync now", open P-NEW and play Version 1.

Expected:
- Step 1: publishing works offline, with no error. P-NEW shows Version 1 on
  Device 1 at once, by "You".
- Step 2: "waiting to upload" is above 0. "Audio uploading" shows "{n} left"
  with a bar.
- Step 3: P-NEW still has Version 1, and it plays.
- Step 4: "waiting to upload" returns to 0, "Audio uploading" to "Up to
  date". "refused by the server" stays 0.
- Step 5: Version 1 is there, by {TRANS}, and the whole recording plays.
  P-NEW's state on Device 2 matches Device 1's.
- Device 2's Inbox shows "{TRANS} recorded Luke 13:1-9" if COORD asked for
  it.

Resets: P-NEW has Version 1.

### SYNC-010 A reviewer reviews offline
Roles: REV, TRANS · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- Device 1 (REV) is offline. Device 2 (TRANS) is online.
- P-SUBMITTED's audio is on Device 1 (REV opened it online before, or it is
  kept because REV was asked to review it).

Steps:
1. Device 1 (REV): from My Work, open the Peer Review of P-SUBMITTED. Tap
   "Do the peer check", listen, and finish with "Looks good" (REV).
2. Device 1: go online. Wait 30 seconds.
3. Device 2 (TRANS): tap "Sync now", then the bell on My Work.

Expected:
- Step 1 works offline. P-SUBMITTED shows the Peer Review as done on
  Device 1.
- Step 2: nothing waits and nothing is refused.
- Step 3: TRANS's Inbox has "Peer Review: looks good" about P-SUBMITTED,
  unread, under "{REV first name} did the Peer Review you asked for". P-SUBMITTED shows the same state on both devices.

Resets: P-SUBMITTED's Peer Review is done.

### SYNC-011 A coordinator asks someone offline
Roles: COORD, TREV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- Device 1 (COORD) is offline. Device 2 (TREV) is online.

Steps:
1. Device 1 (COORD): open Luke 17:11-19 (not started) and use "Ask
   someone" to ask TREV to record it, due in 7 days (PASS).
2. Device 1: go online. Wait 30 seconds.
3. Device 2 (TREV): tap "Sync now". Open My Work and the bell.

Expected:
- Step 1 works offline; Luke 17:11-19's record shows the request at once.
- Step 3: TREV's My Work offers Luke 17:11-19 to record, and the Inbox has
  "{COORD first name} asked you to record".

Resets: Luke 17:11-19 has an open request.

### SYNC-012 A translator answers feedback offline
Roles: TRANS, REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- Device 1 (TRANS) is offline. Device 2 (REV) is online.

Steps:
1. Device 1 (TRANS): open P-NEEDS, listen to REV's feedback and voice note,
   and revise: record and publish Version 2 (REV file, answering feedback).
2. Device 1: go online. Wait 30 seconds.
3. Device 2 (REV): tap "Sync now", then the bell.

Expected:
- Step 1: REV's 5-second voice note plays offline (P-NEEDS is kept because
  TRANS worked on it).
- Step 3: REV's Inbox has "{TRANS first name} revised Luke 14:15-24" with
  "The new version answers your Peer Review feedback." Version 2 plays.

Resets: P-NEEDS has Version 2.

### SYNC-013 Two devices publish the same passage offline and agree
Roles: TRANS, TREV · Priority: P1 · Platforms: iOS, Android, Web · Run: Device

Preconditions:
- Both devices are offline: Device 1 (TRANS), Device 2 (TREV).
- Luke 17:20-37 is not started.

Steps:
1. Device 1 (TRANS): record and publish a version of Luke 17:20-37.
2. Device 2 (TREV): one minute later, record and publish a version of the
   same passage.
3. Bring Device 2 online first, wait 30 seconds, then Device 1.
4. On both devices, tap "Sync now", then open Luke 17:20-37 and its history.

Expected:
- Before step 3, each device shows its own version as "Version 1".
- After step 4, both devices show the same two versions, numbered the same
  way, by the same people, in the same order, with the same latest version
  and the same state.
- The history lists the same entries in the same order on both.
- Neither device shows anything refused. Repeating step 3 the other way
  round (Device 1 first) on a fresh fixture gives the same result.

Resets: Luke 17:20-37 has two versions.

### SYNC-014 Notes added offline on two devices end in the same order
Roles: REV, TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- Both devices are offline: Device 1 (REV), Device 2 (TRANS).

Steps:
1. Device 1 (REV): add the note "A" to P-BT.
2. Device 2 (TRANS): add the note "B" to P-BT.
3. Device 1: add the note "C".
4. Bring both online. Tap "Sync now" on each.

Expected:
- P-BT's history shows "A", "B" and "C" in the same order on both devices,
  by the order they were made.

---

## Ready for offline

### SYNC-015 Me says how ready the device is
Roles: TRANS · Priority: P1 · Platforms: iOS, Android · Run: Auto

Preconditions:
- Fresh install, signed in as TRANS, online.

Steps:
1. Tap "Me" at once and read "Ready for offline".
2. Wait until the downloads finish (Sync's "Audio downloading" is "Up to
   date"). Read it again.
3. Open the Map for LANG-A and count the passages with the kept mark.

Expected:
- Step 1: "Checking this device…", then "{ready} of {n} passages ready on
  this device" while audio downloads.
- Step 2: "{n} passages on this device".
- {n} equals the count in step 3: P-NEW, P-Q1 to P-Q4 (asked of TRANS) and
  every passage TRANS has worked on, such as P-DRAFT, P-SUBMITTED and
  P-NEEDS.
- An account with no kept passages (VIEW) sees "No passages kept on this
  device yet".
- Tapping the row opens "Sync", which starts with the "Ready for offline"
  card.

### SYNC-016 Keep a passage offline, and stop keeping it
Roles: REV · Priority: P1 · Platforms: iOS, Android · Run: Auto

Preconditions:
- P-ASIDE is not kept on REV's device (REV was not asked to work on it and
  has not worked on it; REV reviewed P-DONE in the fixture, so P-DONE is
  kept already).

Steps:
1. Open P-ASIDE. Read the offline line, then tap "Something else?", where
   the passage's offline card is.
2. Tap "Keep offline".
3. Wait until it finishes. Read the line, then Me's "Ready for offline".
4. Open P-ASIDE again, "Something else?", and tap "Stop keeping offline".

Expected:
- Step 1: "Not kept on this device", with "Its text is here, but its audio
  needs a connection. Keep it offline to take it with you." (on a phone,
  where the passage has a study: "…its audio and study pictures need a
  connection…") and a "Keep offline" button.
- Step 2: the toast "Kept on this device. It downloads while you are
  connected." The line says "Downloading for offline" with "{here} of
  {total}" and a bar, and "Kept because you chose to keep it."
- Step 3: "On this device". Me's count went up by one.
- Step 4: the toast "No longer kept. Its audio may be removed to make
  room." Me's count goes back down.
- A passage kept because REV was asked to review it says "Kept because you
  were asked to work on it." and has no "Stop keeping offline".

### SYNC-017 The Sync screen lists what is always here and what needs a connection
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions:
- On a phone, at least one kept passage is still downloading.

Steps:
1. Open "Sync" online. Read the "Ready for offline" card.
2. Go offline and read it again.
3. Run the test on the web.

Expected:
- Step 1: "Ready for offline" with the same counts as Me as a sentence,
  then "Stay connected until this finishes." and a bar.
- Step 2: the sentence ends "Connect to finish before you travel."
- "Always on this device": "Every passage's text, status and history in
  Alpha. Audio, study pictures, maps and study audio of passages you were
  asked to work on, have worked on, or chose to keep." (phones).
- "Needs a connection" lists:
  - "Audio and study material of passages you have not kept. Open a
    passage and tap Keep offline to take it with you." (phones)
  - "Study films." (phones)
  - "Reports."
  - "Other languages. Open one while connected to bring it up to date."
- Web: "Always on this device" names only text, status, history and audio;
  "Needs a connection" says "Audio of passages you have not kept. …" and
  "Study pictures, maps and study audio, in the web app." instead of
  "Study films.".
- When a kept passage holds a recording that has not reached the server:
  "1 recording in your kept passages hasn't been sent from the device that
  made it yet, so no device can download it."

### SYNC-018 Work refused after removal is kept and shown
Roles: TRANS, COORD · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto (web; phones by hand)

This test expects a refusal (G10.2 does not apply).

Preconditions:
- Device 1 (TRANS) is offline. Device 2 (COORD) is online.

Steps:
1. Device 1 (TRANS): open P-Q1, record and publish Version 1.
2. Device 2 (COORD): "Manage", "Members", open TRANS, and use "Remove from
   language" for LANG-A (PEOPLE).
3. Device 1: go online. Wait 60 seconds.
4. Device 1: look at My Work, then open "Sync" (from the chip or Me).
5. Device 1: open P-Q1.

Expected:
- Step 4: My Work's chip says "Not syncing". Sync shows "refused by the
  server" above 0 and, if the server refused the whole language, the body
  "The server refused this account for this organization."
- A section "Refused · {n}" lists Version 1's events, each with a red flag
  and the server's reason (for example "not a member").
- "waiting to upload" does not count them, and they are not deleted: "{n}
  events on this device" is not lower than before step 3.
- Me's "More settings" says "This account cannot sync · password,
  notifications, account" when the whole language is refused.
- Step 5: Device 1 no longer shows Version 1 as published (refused work
  leaves the passage), but it is still listed under Refused.
- Device 2 never shows Version 1 of P-Q1.

Known issue (2026-10-12): removing TRANS's only assignment may leave the
device with no privileges once it hears of the removal; the app then routes
to "Join your team", where Sync cannot be opened, so the refused work is
kept but cannot be seen. Record which happens.
Not reproduced on the web (2026-10-13): the device stayed in the
organization, the chip said "Not syncing" and Sync listed the refused
events with "not a member". Fixed (2026-10-13): "{n} events on this device"
now counts refused events too (it left them out, so the count dropped).

Resets: TRANS is not in LANG-A. SYNC-020 puts TRANS back.

### SYNC-019 Work refused after a role change is kept and shown
Roles: TRANS, COORD · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto (web; phones by hand)

This test expects a refusal (G10.2 does not apply).

Preconditions:
- Device 1 (TRANS) is offline. Device 2 (COORD) is online.

Steps:
1. Device 1 (TRANS): open P-Q2, record and publish Version 1.
2. Device 2 (COORD): change TRANS's role at LANG-A from Translator to
   Reviewer (PEOPLE).
3. Device 1: go online. Wait 60 seconds. Tap "Sync now".
4. Device 1: open "Sync".

Expected:
- "refused by the server" above 0. "Refused · {n}" lists Version 1's
  events, each with the reason (for example "may not emit v1.…").
- P-Q2 on Device 1 no longer shows Version 1. Device 2 never does.
- The events are still on Device 1 ("{n} events on this device" did not
  drop).

Fixed (2026-10-13): outside the Sync screen nothing says work was
refused: My Work's chip and Me's "More settings" count only waiting work and
whole-account refusals. A person who never opens Sync is not told
(PLAN.md invariant 1 asks that it be shown). Confirmed on the web
(2026-10-13); the fix needs a refused-event count on the language handle
(useLanguage.ts) for My Work's chip and Me. The Sync screen now reads
refused events from the device's log for every language of the
organization, not only from the open language's client (2026-10-13).

Resets: TRANS is a Reviewer at LANG-A. SYNC-020 puts TRANS back.

### SYNC-020 Refused work goes again when access returns
Roles: TRANS, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto (web; phones by hand)

Preconditions:
- SYNC-018 or SYNC-019 has just run, with work refused on Device 1.

Steps:
1. Device 2 (COORD): give TRANS the Translator role at LANG-A again.
2. Device 1 (TRANS): wait 60 seconds, then tap "Sync now" on Sync twice.
3. Device 2: tap "Sync now" and open P-Q1 and P-Q2.

Expected:
- Step 2: the refused events move back to "Waiting", then go. "refused by
  the server" returns to 0. My Work has no chip.
- Step 3: Version 1 of each is there, by {TRANS}, and plays.
- If they stay refused, record the reasons shown.

---

## Audio transfer

### SYNC-021 Upload progress
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- The network is slowed to about 256 kbit/s up (Network Link Conditioner,
  the emulator's network speed, or Chrome's throttling).

Steps:
1. Record and publish 60 seconds on P-Q3.
2. Open "Sync" at once.

Expected:
- "Audio uploading" shows "{n} left · {speed}" (speed in "B/s", "KB/s" or
  "MB/s") and a bar that fills.
- A screen reader reads the card as "Audio uploading: {done} of {total},
  {speed}".
- When done, the card says "Up to date". COORD can play the recording.

### SYNC-022 An upload cut off by the network carries on
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Device

Preconditions:
- Slow network, as in SYNC-021.

Steps:
1. Record and publish 60 seconds on P-Q4. Open "Sync".
2. When the bar is about half full, go offline for 2 minutes.
3. Go online.

Expected:
- Step 2: the card still says how many are left. Nothing is marked refused.
  The banner turns amber.
- Step 3: the upload carries on by itself without "Sync now", and ends at
  "Up to date". COORD can play the whole recording, with no gap or repeat.

### SYNC-023 Killing the app during an upload
Roles: TRANS · Priority: P1 · Platforms: iOS, Android · Run: Device

Preconditions:
- Slow network, as in SYNC-021.

Steps:
1. Record and publish 60 seconds on Luke 17:1-10. Open "Sync".
2. While "Audio uploading" shows files left, kill the app.
3. Open the app again.

Expected:
- The work is still there: Luke 17:1-10 shows the version, which plays from
  the device.
- "Audio uploading" shows the files still to go and carries on, then
  "Up to date".
- COORD can play the whole recording.

### SYNC-024 A large backlog goes in pages
Roles: ADMIN · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions:
- Offline. More than 200 events waiting (watch "waiting to upload"): make
  them by repeated work, such as notes and "Already happened" with Undo, or
  any developer tool that writes ordinary events.

Steps:
1. Note "waiting to upload" (for example 250).
2. Go online and watch Sync.
3. Read the Worker or Supabase log for the append requests.

Expected:
- "waiting to upload" falls to 0 within a few minutes, in steps.
- No single request carries more than 200 events.
- "refused by the server" stays 0. COORD sees all of the work.

### SYNC-025 Kept audio plays offline, other audio says it needs a connection
Roles: TRANS · Priority: P1 · Platforms: iOS, Android · Run: Device

Preconditions:
- Me says every kept passage is on this device. Then the device goes
  offline.

Steps:
1. Open P-NEEDS (kept) and play Version 1 and the feedback's voice note.
2. Open P-DONE (not kept by TRANS, unless TRANS worked on it) and try to
   play it.

Expected:
- Step 1: both play.
- Step 2: the offline line says "Audio not on this device" with "You can
  read it and record, but its audio needs a connection." (or "…its audio
  and study pictures need a connection."). Playing fails with a message,
  such as "Audio could not load. Check your connection and try again.",
  and no crash.

### SYNC-026 Audio another device made comes down by itself
Roles: TRANS, REV · Priority: P2 · Platforms: iOS, Android · Run: Auto

Automated as a Maestro flow; REV's voice note is made beside it with
`npx tsx e2e/ui/sync-wrap.ts rev-voice-note <world.json>`.

Preconditions:
- Device 1 (TRANS) is on Sync.

Steps:
1. Device 2 (REV): record a 30-second voice note as feedback on P-SUBMITTED
   (REV).
2. Watch Device 1's "Audio downloading" card.

Expected:
- It shows "{n} left · {speed}" with a bar, then "Up to date" (P-SUBMITTED
  is kept on TRANS's device).
- The voice note then plays on Device 1 offline.

---

## Starting without a connection

### SYNC-027 The app opens offline where it was
Roles: TRANS, VIEW · Priority: P1 · Platforms: iOS, Android · Run: Auto

Automated for TRANS as a Maestro flow in three parts (PART=a, b, c); the
local server is cut between them (its header says how). VIEW stays manual.

Preconditions:
- Signed in, and the home screen was reached online at least once.
- One note is waiting to send.

Steps:
1. Kill the app. Go offline.
2. Open the app.

Expected:
- It opens on the remembered home: TRANS on "My Work", VIEW on "All
  Languages". It does not wait on a spinner or go to Sign In.
- My Work shows the chip "1 to send" (TRANS).
- Passages, the Map and Me work from what is on the device.
- Going online sends the note.
- Web: a reload needs a connection to load the page (no offline start on
  the web, decision 58).

### SYNC-028 Storage that will not open says so
Roles: TRANS · Priority: P2 · Platforms: iOS, Android · Run: Manual

Preconditions:
- A way to make the database fail to open (for example, on a debug build,
  a database file replaced by an unreadable one). Ask the developer.

Steps:
1. Open the app.
2. Tap "Try again".

Expected:
- A screen "LangQuest could not open its storage" with "Nothing was
  deleted. Try again; if it keeps happening, restart the app." and "Code for
  your team: {code}", the code selectable.
- "Try again" opens storage again; once the cause is gone, the app opens.
- No crash screen and no endless spinner.
- The web's version is WEB-014.

---

## The update banner

These need a build with updates turned on (a preview build, not a dev
client). Publishing an update is a release step: publish only to the
preview channel, with the developer's go-ahead (AGENTS.md: ask before
pushing to EAS).

### SYNC-029 A new update downloads and restarts on a tap
Roles: TRANS · Priority: P1 · Platforms: iOS, Android · Run: Manual

Preconditions:
- A newer update has been published to the build's channel.

Steps:
1. Open the app (or bring it back to the foreground).
2. Watch the top of the screen.
3. Tap the banner when it says the update is ready.

Expected:
- Step 2: a line "Downloading update…" (or "Downloading update… {percent}")
  with a spinner, then a coloured banner "Update ready — tap to restart".
- Step 3: "Restarting…", then the app opens on the new update. Sync's build
  line names the new update id.
- Work waiting before the restart is still waiting after it.
- With nothing new, no banner shows.

### SYNC-030 The update banner offline
Roles: TRANS · Priority: P2 · Platforms: iOS, Android · Run: Manual

Preconditions:
- The device is offline when the app comes to the foreground.

Steps:
1. Put the app in the background and bring it back.
2. Go online and tap the red bar.

Expected:
- Step 1: a red bar with a crossed-out cloud and no words. A screen reader
  reads "Offline — tap to retry".
- Step 2: the app checks again; the bar goes (or a download starts).

### SYNC-031 A failed update says why
Roles: TRANS · Priority: P2 · Platforms: iOS, Android · Run: Manual

Preconditions:
- The update server answers with an error that is not a lost connection
  (for example, a broken update on the channel).

Steps:
1. Bring the app to the foreground.
2. Tap the banner.

Expected:
- "Update failed: {reason} — tap to retry", with the update library's own
  reason.
- Tapping checks again. The app keeps working on the running build.

### SYNC-032 The web offers a reload for a new version
Roles: TRANS · Priority: P1 · Platforms: Web · Run: Auto

Runs against the exported web build only: the dev server's page has no
build id and never asks for `/version.json` (the test skips there).

Preconditions:
- Playwright answers `/version.json` with a `build` different from the
  running page's.

Steps:
1. Load the app. Wait for My Work.
2. Tap the banner.

Expected:
- Step 1: a banner "A new version of LangQuest is ready. Reload to use it."
- Step 2: the page reloads.
- The page never reloads by itself.
- The check runs again when the tab is shown again and every hour.
- While recording, the tap does nothing (WEB-026).
