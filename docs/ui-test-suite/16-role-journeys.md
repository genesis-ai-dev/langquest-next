# 16. Role journeys (JRN)

Each test here is one whole job, done the way a person in that role would
do it. The tests in files 01–15 check each screen on its own; these check
that the screens join up.

Run them last, on a fresh fixture. They change shared state.

**Two devices.** Where a journey needs two people:
- "Device 1 (TRANS)" and "Device 2 (REV)" are separate simulators,
  emulators or browsers.
- Each device is signed in as its own account.
- Both devices are online unless a step says otherwise.
- "Sync" means: pull down on My Work, or Me → More settings → Sync →
  "Sync now". Then wait until "waiting to upload" is 0.

**Words since decision 91.** A review stage is a "check" on every screen,
and a check carries its own people: the fixture's Peer check has REV and
TREV, and "Ask the Peer check team" reaches both. The Review Teams screens
are gone. "Ask someone" on the record is now "Something else?" → "Someone
else should do this".

**Automation (decision 95).** Journeys with Web or Wide run in Playwright,
each in its own file with a fresh world and one browser per person
(`e2e/ui/16-jrn-NNN.spec.ts`, helpers in `16-helpers.ts`). Phone-only
journeys are Maestro flows (`apps/mobile/test/maestro/flows/JRN-NNN.yaml`);
one phone plays each person in turn, signing in after the app is cleared.

## Translator

### JRN-001 A new translator's first day: invited, welcomed, records and asks for a check
Roles: COORD, NEW (becomes a translator) · Priority: P0 · Platforms: iOS, Android · Run: Auto

Preconditions:
- Device 2 is a fresh install, signed out.
- P-NEW has not been asked of anyone else.

Steps:
1. Device 1 (COORD): go to Manage → Members → Invite.
2. Make an invite for one named person:
   - "Ana Test" as Translator for LANG-A.
   - Read the code shown.
3. Device 2: on Sign In, tap "Scan a code".
4. Paste the code into "Or paste the code or link".
5. Tap "Join as Ana".
6. On Welcome, read the points, then tap "Skip for now".
7. Device 1 (COORD): open P-NEW.
8. In "Something else?", choose "Ask someone", ask "Ana Test" to record it, and tap "Send request".
9. Device 2: pull to sync on My Work. Tap "Start" on the "Next for you" card.
10. On the passage record, tap the Record step row. The main button may read "Study", because P-NEW has an FIA guide. In the workspace, tap the red record button.
11. Speak for 8 seconds, pause 2 seconds, speak for 8 seconds, then tap stop.
12. Tap "Publish", then "Publish Version 1".
13. On the ask page, tap "Ask the Peer check team".

Expected:
- Step 5: the invite card read "Invite for Ana Test" with "Translator · Alpha · UI Test Org" before joining.
- Step 6: Welcome says "You're a Translator on the Alpha team at UI Test Org." and lists:
  - "Record passages in your language."
  - "Your team listens and says what to change."
  - "My Work shows what's next for you."
- After Welcome:
  - Tabs are Work, Map and Me.
  - Me → More settings shows "No email yet".
- Step 9: P-NEW is the "Next for you" card, with COORD named as the one who asked.
- Step 11: the parts card shows two parts.
- Step 12: the toast reads "Version 1 published.". The record shows "Version 1 published" and "Next, ask for a check".
- Step 13:
  - The record shows "Peer check · asked the Peer check team".
  - REV and TREV each see the passage in "Next for you" or "Then" after syncing.
- Device 1 (COORD) after syncing: the passage record shows Version 1 by Ana Test, and the request to record is done.

Automation: Maestro `JRN-001.yaml` on one phone. COORD makes the code and copies its typed form ("Or type this code"); the app is cleared and Ana pastes it. Ana has no password, so COORD cannot return to that phone: steps 7-9 and the other devices' checks need a second phone, and run on the web in JRN-011. Ana opens P-NEW from the Map instead.

### JRN-002 A translator answers feedback: one fix, one kept with a reason
Roles: TRANS · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- P-NEEDS has REV's "needs changes" feedback.
- P-SUBMITTED's Version 1 has also been marked "needs changes" by REV, with the text "The start is too quiet" (written through the server before the test).

Steps:
1. On My Work, tap the bell. Open "Feedback on Luke 14:15-24".
2. On the passage record, tap "Hear the feedback".
3. Play the voice note and read the text "Verse 18 is too fast".
4. Tap "Record a fix".
5. In the workspace, check that the Earlier chip is open with the review highlighted.
6. Record one new part (6 seconds). Hold one of Version 1's parts and tap "Delete Part 1" (the fixture's parts carry no verses), then tap "Publish".
7. Open "What changed", empty it, tap "Done"; then say or type "Slowed verse 18", tap "Done", then "Publish Version 2". On the ask page, tap "Not now".
8. Open the bell again. Open the feedback on P-SUBMITTED, then tap "Hear the feedback".
9. Tap "Keep it, say why". Type "The speed matches how elders tell it", then tap "Keep it".

Expected:
- Step 6:
  - "What changed" starts from a first draft, "Revised after the {check} feedback.", which the translator may change. Emptied, "Publish Version 2" is disabled until something is said.
  - The check line reads "Answers the peer check feedback from {REV's name}".
  - Fixed (2026-10-13): the Publish screen, "Hear the feedback", the workspace's Earlier and the Inbox name the kind ("Peer Review"), not the check ("Peer check"), against decision 91's one word on every screen.
- Step 7: the toast reads "Version 2 published.". On the record:
  - Version 2 is current.
  - The feedback shows as answered.
  - "Hear the feedback" is gone.
- Step 9: the toast reads "Kept · your reason is on the record" with Undo. On the record, Versions and history shows the departure and its reason.
- REV, after syncing: the Inbox shows both answers ("{TRANS first} revised {P-NEEDS}" and "{TRANS first} kept {P-SUBMITTED} as is", with the reason), and P-NEEDS offers "Do the peer check" on Version 2.
- Decided (2026-10-13, decisions.md 96): answered feedback keeps the check open, so Version 2 goes back to the peer check, as the record told the translator. The peer check reads "answered · back to the check" until REV passes it.
- Fixed (2026-10-13): playing the feedback, then leaving for the workspace, logs an unhandled "play() request was interrupted by a call to pause()" (web).

## Reviewer

### JRN-003 A reviewer's round: one check, one back translation
Roles: REV · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions: P-SUBMITTED and P-BT are in their fixture states.

Steps:
1. On My Work, open "Check {P-SUBMITTED}" under "Then". (The newest ask leads the "Next for you" card: P-BT's back translation.)
2. Play Version 1, then tap the main button ("Next: questions", or "Next: decide" when the check has no questions).
3. Answer each question the check has (the fixture's Peer check has none):
   - text: type the answer
   - rating: choose 4
   - yes/no: choose Yes
4. On Decide, tap "Needs changes".
5. Tap "Tap and speak", speak for 5 seconds, then tap again to stop.
6. Tap "Send feedback".
7. Back on My Work, open P-BT's back translation from "Then", or from the card.
8. Tap "Record part 1" and say each part in English (about 4 seconds each); the session moves to the next part at each pause. Stop after the third.
9. Tap "Publish", then "Publish back translation".

Expected:
- Step 1:
  - The screen opens on Listen.
  - The step strip shows Listen · Decide (Listen · Questions · Decide when the check has questions).
  - The player reads "Version 1 · recorded by {TRANS first name}".
- Step 4:
  - The heading reads "Is it accurate and natural?".
  - "Looks good" and "Needs changes" are both enabled, because nothing required is open.
- Step 6:
  - The toast reads "Feedback sent to {TRANS name}".
  - The record shows "Peer check · needs changes", credited to REV ("You" on REV's own device).
- Step 8: the top pane says notes and earlier checks are hidden on purpose.
- Step 9:
  - The toast reads "Back translation published.".
  - The record shows "Back translation published".
  - REV is not offered "Ask …", because REV has no Send to reviewers; only "Done" shows.
  - Fixed (2026-10-13): the page still says "Next, ask for a check" to REV (see PASS-017).
- TRANS, after syncing: the bell has an unread update for P-SUBMITTED's feedback.

### JRN-004 A translator-reviewer records, checks their own work, and checks a colleague's
Roles: TREV, TRANS · Priority: P1 · Platforms: iOS, Android · Run: Auto

Preconditions: P-Q4 is asked of TREV to record.

Steps:
1. Device 1 (TREV): record P-Q4 Version 1 and publish it. On the ask page, tap "Not now".
2. COORD (any device): open P-Q4, tap its "Peer check" row, then "Send to someone else", and ask TREV by name. The record never offers a check of your own version unless someone asks you.
3. Device 1 (TREV): sync. On the passage record, tap "Do the peer check". Play it, then tap "Looks good".
4. Device 2 (TRANS): record P-Q3 Version 1, publish it, then tap "Ask the Peer check team".
5. Device 1 (TREV): sync. Open P-Q3 and tap "Do the peer check", then "Looks good".

Expected:
- Step 1: TREV sees both the "Record" and the check controls on the record. The tabs are Work, Map and Me.
- Step 3: the toast reads "Looks good · on the record". The record credits TREV for a review of their own version.
- Step 5: the toast reads "Looks good · sent to {TRANS name}". TRANS sees the update after syncing.

Automation: Maestro `JRN-004.yaml`, one phone, TREV, COORD, TREV, TRANS and TREV in turn. Recording needs the host's microphone (G8).

## Coordinator and admins

### JRN-005 A coordinator gets a language ready and starts its team
Roles: COORD, NEW, NOORG · Priority: P0 · Platforms: iOS, Android, Wide · Run: Auto

Preconditions: LANG-B is not ready.

Steps:
1. Device 1 (COORD): open Bravo (Map → All languages → Bravo), then the Work tab. My Work leads with "Get Bravo ready · 0 of 4". Tap its question.
2. Answer the four questions, one per screen:
   - What they record: FIA passages, with the Gospels in scope.
   - What helps them: the English Bible and FIA's guides.
   - Who checks: "Community, then retelling" (two checks).
   - Invite: "Translate", then "Share as a link" (the group code's link).
3. Device 2 (NEW): create an account. On "Join your team", choose "Scan their code" and paste the link. The card reads "Translator · Bravo · {ORG}" and "From {COORD}". Tap "Join as {name}" (a new account has no name of its own yet and goes by its address).
4. Device 3 (NOORG): choose "Find your organization", then "Ask to join" on UI Test Org.
5. Device 1 (COORD): sync. Under the Get ready card, open "{NOORG name} wants to join". Under "What will they do?" choose "Check recordings", under "In which language?" choose Bravo, then tap "Let {first} in".
6. Device 1: open a Bravo passage. Choose "Something else?" → "Someone else should do this", ask Ben to record it, and choose "In a week".
7. Device 1 (COORD, wide window): open the Reports tab, then "Languages", then Bravo.

Expected:
- Step 2: the questions count "1 of 4", "2 of 4" and so on. After the fourth answer My Work has no Get ready card, and Bravo's page shows the summary instead of the checklist.
- Step 3: Ben lands on Welcome as "Translator on the Bravo team at UI Test Org", then on My Work with nothing waiting.
- Step 4: Fixed (2026-10-13): "Find your organization" searches, on the phone, the server's first 500 listed organizations by name (`listed_organizations` has `limit 500`). An organization past them cannot be found. A shared test database with hundreds of "UI Test Org …" hits this; the test then sends the request the way the app does and goes on.
- Step 5:
  - The toast reads "{name} is in, as Reviewer in Bravo.".
  - Device 3 leaves "Asked UI Test Org" within 60 seconds or on returning to the app.
  - Device 3 shows Welcome (once per account: a fixture that already welcomed NOORG goes straight on), then My Work in Bravo.
- Step 6: Ben's My Work shows the passage after syncing, with the due date.
- Step 7: Bravo's report lists its template, its flow, and one passage asked ("1 request open in all", once the server's figures catch up).
- Fixed (2026-10-13): Get ready offered the Oral Review Path as "Just the community · One check" and saved two checks. Each check made at the same time is now named and counted ("Community, then retelling · 2 checks"; decision 91). The report still does not name the template.
- Known issue (2026-10-12): Reports still counted "0 requests open in all" for Bravo three minutes after the ask (local run; check the projection worker, G2).

### JRN-006 A coordinator moves a passage past a checkpoint and signs it off
Roles: COORD, TRANS, VIEW · Priority: P0 · Platforms: iOS, Android · Run: Auto

Preconditions: P-CHECK is at Consultant Check, with no consultant review.

Steps:
1. Device 2 (TRANS): open P-CHECK.
2. Device 1 (COORD): open P-CHECK. Tap "Consultant Check", then "Move past this checkpoint…".
3. Type the reason "Consultant visit postponed to March", then tap "Move past checkpoint".
4. Device 1: on the Final Approval step, tap "Do the final approval", then "Looks good".
5. Device 3 (VIEW): sync. Open the Map → Alpha → Luke → chapter 15.

Expected:
- Step 1: TRANS sees that the passage is waiting at a checkpoint, and is not offered a way past it.
- Step 3:
  - The toast reads "Moved past the checkpoint · reason saved", with Undo.
  - The record shows the departure with COORD's name and the reason.
- Step 4: the passage shows as done.
- Step 5:
  - P-CHECK shows as done in chapter 15's list ("{P-CHECK}. Done").
  - Chapter 15 itself shows started (•), because Luke 15:11-32 is not done.
  - Opening P-CHECK shows the override reason.
  - VIEW has no action buttons.

Automation: Maestro `JRN-006.yaml`, one phone, TRANS, COORD and VIEW in turn. It leaves P-CHECK done; in one run it goes after `P0-coordinator-ask-override.yaml`, which undoes its own override.

### JRN-007 An organization admin starts from nothing
Roles: NEW (becomes ADMIN of a new org) · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Create an account with a NEW address.
2. On "Join your team", tap "Start a new one".
3. Name it "Journey Org {run}". Choose the licence "CC BY-NC-SA 4.0", then tap "Use this license".
4. Tap "Create Organization".
5. On My Work, tap "Add a language". Complete New language with the name "Journey Language", the Bible (numbered like the NIV), FIA passages for the New Testament, the Standard Bible Flow and English helps. On "Invite someone", tap "Later".
6. Manage → Setup → Roles → "Role":
   - Name it "Community Checker".
   - Turn on "Check recordings" only, and save.
7. Manage → "Invite people": choose Community Checker (under "Other roles"), then "Show the code to scan".
8. (Decision 91: Review teams are gone.) Manage → Journey Language → Checks: the Standard Bible Flow's checks are the language's own.
9. Me → More settings → Switch Organization: check that only Journey Org is listed (the account has no other).

Expected:
- Step 3: the open-licence warning "People outside can hear your team" shows.
- Step 4:
  - The app lands on My Work with "Get Journey Org {run} ready" and "Add a language".
  - There is no Welcome.
  - The tabs are Work, Map, Manage and Me.
- Step 5:
  - The progress names each part as it starts.
  - It ends on the language.
  - The Map shows the books in scope.
- Step 6: the role is listed. Inviting offers it as a choice.
- Step 8: Checks lists Peer check, Back translation (same time), Community check, Consultant check and Final approval.
- All writes are accepted: Sync shows "refused by the server" at 0.

### JRN-008 A language lead runs one language and meets their limits
Roles: LADMIN · Priority: P1 · Platforms: iOS, Android · Run: Auto

Steps:
1. Tap the Manage tab.
2. Open Members, then Invite. Look at the roles offered.
3. Make a group code for Translator at Alpha.
4. (Decision 91: Review teams are gone.) Alpha → Checks → Peer check → "Add people": tick TRANS, then "Done".
5. Open the Map tab (All languages).
6. Open the Inbox from the bell. Look for join requests.

Expected:
- Step 1: Manage opens Alpha's page, not the organization's home.
- Step 2:
  - Only roles whose privileges LADMIN holds are offered (Translator, Reviewer, Translator-Reviewer, Viewer, Language Lead).
  - Coordinator and Organization Admin are not offered.
  - The organization is not offered as a scope.
- Step 3: the code is made and works for a NEW account (spot check).
- Step 4: TRANS is on the check ("Take {TRANS} off this check" shows).
- Step 5: All languages lists only Alpha ("Across 1 language"): Bravo is outside LADMIN's scope and is not offered, and the tab bar stays.
- The NAV-042 known issue (opening a language outside one's scope drops every privilege) can no longer be reached from the Map; NAV-042 keeps it for other routes.

Automation: Maestro `JRN-008.yaml`.
- Step 6: no join requests are listed (they are organization scope).

### JRN-009 Organization admin switches to the organization where they translate
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Me → More settings → Switch Organization. Tap "UI Second Org".
2. Look at the tabs and My Work.
3. Switch back to "UI Test Org".

Expected:
- Step 1: the blank "Opening your organization" view, then My Work.
- Step 2: the tabs are Work, Map and Me (no Manage). The Map opens the ORG2 language's map.
- Step 3: Manage is back, and My Work shows ORG's items.

## Viewer

### JRN-010 A viewer follows progress
Roles: VIEW · Priority: P0 · Platforms: iOS, Android, Wide · Run: Auto

Steps:
1. Sign in.
2. Open Alpha, then Luke, then chapter 16, then P-DONE.
3. Play Version 1. Open Versions and history.
4. Open the Inbox tab.
5. On a wide window, open the Reports tab, then "Languages", then Alpha.

Expected:
- Step 1:
  - Welcome shows the viewer's points and one "Get started" button.
  - Then the overview of all languages, not My Work.
  - The tabs are Map, Inbox and Me.
- Step 2: the record shows every check as "looks good". No record, review or ask controls show; "Something else?" holds only what a viewer may do (what helps, keeping it offline), with no ask, log, set aside, note or move past.
- Step 4: the Inbox reads "Nothing yet", with no badge: a plain viewer gets no record updates, because nothing is asked of them and they ask for nothing (NAV-033).
- Step 5: the report loads. There is no "Language settings" panel.

## Across every role

### JRN-011 One passage from first recording to done, across every role
Roles: COORD, TRANS, REV, TREV, VIEW · Priority: P0 · Platforms: iOS + Android + Web together · Run: Auto

Preconditions:
- Four devices, signed in:
  - Device 1: COORD on iOS.
  - Device 2: TRANS on Android.
  - Device 3: REV on Web.
  - Device 4: VIEW on iOS.
- Use Luke 15:1-10 reset to not started, or another untouched passage (P-X).

Steps:
1. COORD asks TRANS to record P-X ("Something else?" → "Someone else should do this").
2. TRANS records and publishes Version 1, then asks the Peer check team.
3. REV does the Peer Review: "Needs changes", with text.
4. TRANS taps "Record a fix" and publishes Version 2, saying what changed.
5. REV does the Peer Review on Version 2: "Looks good".
6. REV back-translates Version 2 and publishes it.
7. TRANS logs a Community Check through "Already happened", with outcome "Looks good" and where "Village church".
8. COORD does the consultant check ("Do the consultant check"): "Looks good".
9. COORD does the Final Approval: "Looks good".
10. VIEW opens P-X.

Expected:
- After each step, every other device shows the new state after one sync, with no manual reload.
- Each person's My Work moves on: after step 2, REV and TREV see the check; after step 3, TRANS sees "Hear the feedback".
- Step 7: the Community Check is credited to TRANS as logged, with the place.
- Step 10: the passage is done. The book bar and the chapter mark count it as done.
- On every device: "refused by the server" is 0, and the four histories list the same events in the same order of what happened.
- Step 5: REV is offered the peer check on Version 2 (decided 2026-10-13, decisions.md 96: answering keeps the check open).

Automation: Playwright `16-jrn-011.spec.ts`, five browsers (COORD, TRANS, REV, TREV, VIEW) on the web; P-X is Luke 12:1–12. The device check compares every browser's confirmed events in order.

### JRN-012 A field day with no connection
Roles: TRANS, REV · Priority: P0 · Platforms: iOS, Android · Run: Device

Preconditions: TRANS has used Ready for offline to keep P-Q1, P-Q2 and P-Q3. Every kept passage shows ready on Me.

Steps:
1. Device 1 (TRANS): turn on airplane mode.
2. Do the study for P-Q1 and mark every step done.
3. Record and publish P-Q1, P-Q2 and P-Q3. Ask the Peer check team on each.
4. Close the app fully, then reopen it while still offline.
5. Turn off airplane mode and wait.
6. Device 2 (REV): sync.

Expected:
- Steps 2–3:
  - Every action shows its usual toast.
  - My Work shows the "Offline" chip, then "{n} to send".
- Step 4:
  - The app opens on My Work.
  - The three versions and the requests are still there.
  - Me shows the passages as kept.
- Step 5:
  - The chip goes away within 30 seconds.
  - Sync's "Audio uploading" ends at "Up to date".
- Step 6: REV sees three checks asked. Each version plays all the way through.

### JRN-013 A shared phone: one person's unsent work goes as theirs after they sign out
Roles: TRANS, REV · Priority: P0 · Platforms: iOS, Android · Run: Device

Steps:
1. Turn on airplane mode. As TRANS, record and publish P-Q2.
2. Me → Sign out.
3. Read the message, then tap "Sign Out".
4. Sign in as REV on the same phone. This needs a connection, so turn off airplane mode first.
5. Wait for sync. Open P-Q2.

Expected:
- Step 3: the title reads "Sign out?". The body begins "Still to send:" and says the work "will still be sent, as you, when this device is online". The button is enabled.
- Step 5:
  - P-Q2's new version is credited to TRANS, not REV.
  - REV's Sync shows nothing refused.
  - A third device signed in as COORD sees the version as TRANS's.

The P0 smoke flow `P0-signout-handover.yaml` runs the same hand-over on Android with a note instead of a recording (airplane mode; no microphone needed).

### JRN-014 A looked-after person gets back in on a new phone
Roles: KEPT, COORD · Priority: P1 · Platforms: iOS, Android · Run: Auto

Steps:
1. Device 1 (COORD): Manage → Members → KEPT. Make a sign-in code for them.
2. Device 2 (fresh install): tap "Scan a code" and paste the code. Tap "Sign in".
3. Open Me → More settings.

Expected:
- Step 2:
  - The banner reads "Someone is helping you sign in".
  - After "Sign in", My Work shows KEPT's work.
  - The device where KEPT was signed in before is signed out.
- Step 3: the line reads "Signed in on this device with {COORD's name}'s help · {date}".
- Known issue (2026-10-12): the sign-in code is shown only as a QR code, with no typed form and no share (unlike "Invite by QR"'s "Or type this code"), so it cannot be pasted into "Or paste the code or link". A person whose camera fails cannot use it, and the journey cannot be automated on one phone. It stays a two-device run until the code has a typed form.
