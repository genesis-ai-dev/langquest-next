# 13. Moderation (MOD)

Reporting what someone made or how they behave, blocking, hidden content,
taking something out of the record, and acting on reports from the Inbox
(decision 48).

Read [the README](README.md) first: G1 to G10, the fixture and the accounts
apply here.

In quoted text, `{TRANS}`, `{REV}` and the like stand for that account's
display name.

Who does what here:
- Anyone signed in can report or block someone else, from the flag on what
  they made. Nobody gets a flag on their own work, and guests get none.
- Reports and blocks are private rows, not events. They wait on the device
  like a profile change and go when connected.
- A moderator is whoever holds Manage structure for that language: ADMIN,
  COORD, and LADMIN for LANG-A. They see "Remove from the record" and the
  content reports in their Inbox.
- Reports about a person go to whoever may invite members across the whole
  organization: ADMIN and COORD, not LADMIN.
- Nobody sees a report about themselves, and moderators never see who sent
  one.

Fixture notes used below: P-SUBMITTED's Version 1 is by TRANS. P-NEEDS has
REV's "needs changes" review with the text "Verse 18 is too fast" and a
voice note.

---

## The flag

### MOD-001 The flag on someone else's version opens Report or block
Roles: REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions: None.

Steps:
1. Open P-SUBMITTED, then its "Version 1".
2. Tap the flag in the header (screen reader: "Report or block {TRANS}").

Expected:
- A sheet "Report or block" with "This version by {TRANS}".
- Three rows:
  - "Report this version", with "It is offensive, harmful or does not
    belong here".
  - "Report {TRANS}", with "For how they behave, not one thing they made".
  - "Block {TRANS}", with "Hide what they add, for you only. They aren't
    told."
- No "Remove from the record" (REV is not a moderator).
- The ✕ closes the sheet and nothing is sent.

### MOD-002 No flag on your own work, and none for guests
Roles: TRANS, GUEST · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- GUEST: signed out, browsing LANG-A from "Look around first" (NOORG,
  Explore).

Steps:
1. TRANS: open P-SUBMITTED's Version 1, then P-SUBMITTED's history.
2. TRANS: open P-NEEDS and REV's review.
3. GUEST: open any published passage of LANG-A.

Expected:
- Step 1: no flag on TRANS's own version or notes.
- Step 2: REV's review has a flag ("Report or block {REV}").
- Step 3: no flag anywhere. (Automated, the guest opens "Browse public
  work" and a listed Alpha; ORG's licence keeps its recordings from guests,
  so the passage pages themselves are checked by hand.)

### MOD-003 Flags on reviews, notes and requests
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- COORD has added the note "Check verse 12" to P-SUBMITTED's whole passage.
- COORD asked TRANS to record P-NEW with a typed note.

Steps:
1. Open P-NEEDS and tap REV's review.
2. Open P-SUBMITTED's history.
3. Open P-NEW's history.
4. Open P-SUBMITTED's study (STUDY) and any note someone else left there.
5. In the recording workspace for P-NEEDS, open the tray's earlier notes.

Expected:
- Step 1: the review page has a flag in the header, "Report or block
  {REV}". Its sheet's sub-line says "This review by {REV}".
- Step 2: COORD's note has a flag at the end of its line; the sheet says
  "This note by {COORD}".
- Step 3: COORD's request with words has a flag; the sheet says "This
  request by {COORD}", and its first row is "Report this request".
- Steps 4 and 5: notes by others have flags; TRANS's own have none.
  (Steps 1 to 3 are automated, with COORD's request made on P-S, which
  nobody had asked of TRANS; steps 4 and 5 are checked by hand.)
- A request with no words of its own has no flag.

---

## Reporting

### MOD-004 Report what someone made
Roles: REV, ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- Device 2 is signed in as ADMIN.

Steps:
1. Device 1 (REV): open P-SUBMITTED's Version 1, tap the flag, then "Report
   this version".
2. Look at the sheet before choosing anything.
3. Tap "Spam or unrelated". Type "Test report" in the box.
4. Tap "Send report".
5. Device 2 (ADMIN): wait two minutes, open My Work's bell.

Expected:
- Step 2: the sheet "Report this version" with "What is wrong with it?".
  Six choices, each with a line under it:
  - "Hateful or offensive" ("Insults or attacks on a people, faith or
    group")
  - "Harassment or bullying" ("Aimed at you or someone else")
  - "Sexual content" ("Including anything involving a child")
  - "Violence or threats" ("Threatens or encourages harm")
  - "Spam or unrelated" ("Not part of the translation work")
  - "Something else" ("Say what in the box below")
- A box "Anything else? (optional)", a checkbox "Also block {TRANS}" with
  "Hide what they add, for you only", and "Your organization's admins and
  the LangQuest team see the report. {TRANS} is not told, and your
  organization does not see who sent it."
- "Send report" is disabled until a reason is chosen.
- Step 4: online, the toast "Reported. Thank you." (offline it adds "It
  is sent when you are connected.", MOD-013). The sheet closes. Version 1
  still shows for REV.
- Step 5: ADMIN's Inbox has "A version was reported" (MOD-019).
- TRANS is not told anything.

Fixed (2026-10-12): the toast always said "It is sent when you are
connected.", even online. The sheet now tries to send the report at once
(at most 4 seconds) and says so only when it has not gone.

### MOD-005 "Something else" needs words
Roles: REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions: None.

Steps:
1. Open P-SUBMITTED's Version 1, the flag, "Report this version".
2. Tap "Something else".
3. Type "   " (spaces).
4. Type "Not Luke at all".
5. Close the sheet without sending.

Expected:
- Step 2: the box's placeholder becomes "What is wrong with it?". "Send
  report" stays disabled.
- Step 3: still disabled.
- Step 4: enabled.
- Step 5: nothing is sent (no toast, nothing waiting in the Inbox's
  "Saved account changes").

### MOD-006 Report and block together
Roles: TREV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- TREV has not blocked REV.

Steps:
1. Open P-NEEDS, REV's review, the flag, "Report this review".
2. Choose "Harassment or bullying", tick "Also block {REV}", and tap "Send
   report".
3. Look at P-NEEDS's review and the history.

Expected:
- Step 2: the toast "Reported and blocked {REV}. Thank you."
- Step 3: REV's review text and voice note are hidden (MOD-009).
- Opening the flag again shows "Unblock {REV}", and the report sheet no
  longer offers "Also block".

Resets: TREV unblocks REV (MOD-011).

### MOD-007 Report a person
Roles: REV, ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions: None.

Steps:
1. Device 1 (REV): open P-SUBMITTED's Version 1, the flag, then "Report
   {TRANS}".
2. Choose "Harassment or bullying" and tap "Send report".
3. Device 2 (ADMIN): after two minutes, open the Inbox from the bell.

Expected:
- Step 1: the sheet's title is "Report {TRANS}" with "What is wrong with
  it?" and the same six reasons.
- Step 2: the toast "Reported. Thank you." (online; MOD-004).
- Step 3: "{TRANS} was reported" (MOD-021).

### MOD-008 Block someone, with Undo
Roles: REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- REV has blocked nobody.

Steps:
1. Open P-SUBMITTED's Version 1, the flag, then "Block {TRANS}".
2. Tap "Undo" on the toast.
3. Block {TRANS} again and let the toast go.

Expected:
- Step 1: the sheet closes. The toast "Blocked {TRANS}. What they add is
  hidden for you." with "Undo" (a screen reader hears "… Undo available.").
  It stays about 7 seconds.
- Version 1's words and audio are hidden at once (MOD-009).
- Step 2: TRANS's version shows again. More settings has no "Blocked
  people" row.
- Step 3: blocked. More settings shows "Blocked people" with "1 person".
- TRANS is not told and sees nothing different.

### MOD-009 What a blocked person made is hidden, and Show reveals it once
Roles: REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- REV has blocked TRANS (MOD-008).

Steps:
1. Open P-SUBMITTED. Read its history and its state.
2. Open Version 1.
3. Tap "Show" (screen reader: "Show what {TRANS} added").
4. Go back and open Version 1 again.

Expected:
- Step 1: lines by TRANS with words read "Hidden because you blocked them".
  The passage's state is the same as before the block (TRANS's version
  still counts; a block never stalls the team).
- Step 2: a dashed box "Hidden because you blocked {TRANS}" with "Show" in
  place of the version's note, and another in place of its recording.
- Step 3 (tap each "Show"): the note and the recording show, and play.
- Step 4: hidden again.
- REV can still review Version 1 if asked (REV file).

### MOD-010 A blocked person's updates leave the Inbox
Roles: REV, TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Web added (2026-10-12): the Inbox is the same in a browser. The automated
run uses the updates TRANS already made for REV in the fixture (asking for
the Peer Review of P-SUBMITTED and the back translation of P-BT) in place
of step 1; the rule is the same for any update by a blocked person.

Preconditions:
- REV has blocked TRANS.

Steps:
1. Device 2 (TRANS): answer REV's feedback on P-NEEDS by revising (REV
   file).
2. Device 1 (REV): tap "Sync now", then look at My Work's bell and the
   Inbox.
3. Device 1: unblock TRANS (MOD-011). Look again.

Expected:
- Step 2: no "{TRANS} revised Luke 14:15-24" (nor any other update by
  TRANS) in the Inbox, and the bell's count does not include it.
- Step 3: the update shows, unread, and the bell counts it.
- The passage's state is the same in both steps.

Resets: P-NEEDS has Version 2 (when step 1 was done by hand).

### MOD-011 Unblock from the flag
Roles: REV · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- REV has blocked TRANS.

Steps:
1. Open P-SUBMITTED's Version 1 and tap "Show", then the flag.
2. Tap "Unblock {TRANS}".
3. Tap "Undo" on the toast, then unblock again.

Expected:
- Step 1: the row reads "Unblock {TRANS}" with "Show what they add again".
- Step 2: the toast "Unblocked {TRANS}." with "Undo". The version shows.
- Step 3: Undo blocks again (the version is hidden); unblocking again shows
  it.

### MOD-012 The Blocked people sheet
Roles: REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- REV has blocked TRANS and TREV.

Steps:
1. "Me", "More settings", "Blocked people".
2. Tap "Unblock" beside {TRANS}.
3. Tap "Block again" beside {TRANS}.
4. Tap "Unblock" beside both, then close the sheet.
5. Look at More settings.

Expected:
- Step 1: a sheet "Blocked people" with "What they add is hidden for you.
  They aren't told." Two rows, each an avatar, a name and "Unblock".
- Step 2: {TRANS}'s row stays, with "Unblocked" under the name and a "Block
  again" button.
- Step 3: back to "Unblock".
- Step 5: no "Blocked people" row.
- The empty state ("Nobody blocked", "To block someone, tap the flag on a
  note, version or review they made.") cannot be reached in normal use,
  because the row only shows when someone is blocked. Record it if seen.

### MOD-013 Report and block offline
Roles: REV, ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- Device 1 (REV) is offline.

Steps:
1. Report P-SUBMITTED's Version 1 ("Spam or unrelated").
2. Block {TREV} from a note TREV made.
3. Open My Work's bell.
4. Go online. Wait 30 seconds. Open the Inbox again.
5. Device 2 (ADMIN): after two minutes, open the Inbox.

Expected:
- Step 1: the toast "Reported. Thank you. It is sent when you are
  connected."
- Step 2: TREV's words are hidden at once.
- Steps 3 and 4: the rows waiting to send are not buttons; only one the
  server refused is tapped to try again (MOD-024).
- Step 3: the Inbox starts with "Saved account changes": a "Report" row and
  a "Block" row, each "Waiting to send" with the badge "Saved".
- Step 4: the section is gone.
- Step 5: the report is there.

Resets: REV unblocks TREV.

---

## Taking something out of the record

### MOD-014 Only moderators see "Remove from the record"
Roles: ADMIN, COORD, LADMIN, TRANS, REV, TREV, VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- TREV has added the note "Moderation check" to P-BT.

Steps:
1. Each role except TREV: open P-BT's history, then the flag on TREV's
   note.

Expected:
- ADMIN, COORD, LADMIN: a fourth row "Remove from the record" with "For
  everyone. Needs a connection."
- TRANS, REV, VIEW: three rows, no "Remove from the record".
- LADMIN does not see it on LANG-B's work (LADMIN has no Manage structure
  there).

### MOD-015 A moderator removes a note, and every device stops showing it
Roles: ADMIN, TREV, VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- TREV's note "Moderation check" is on P-BT (MOD-014).
- Device 2 (TREV) and Device 3 (VIEW) show the note.

Steps:
1. Device 1 (ADMIN): open the flag on the note, then "Remove from the
   record".
2. Tap "Cancel".
3. Tap "Remove from the record" again, then "Remove for everyone".
4. Devices 2 and 3: tap "Sync now" and open P-BT.

Expected:
- Step 1: a sheet "Remove this note?" with "It leaves the record for
  everyone in the organization." and "Use this for content that breaks the
  terms of use. The passage's status is worked out again without it. It
  needs a connection." A red "Remove for everyone" and "Cancel".
- Step 2: back to the "Report or block" menu, not closed.
- Step 3: the toast "Removed from the record. Devices stop showing it when
  they next sync." The note is gone on Device 1.
- Step 4: the note is gone on both, including TREV's, the person who wrote
  it.

Fixed (2026-10-12): Device 1 kept showing the note until its own next
sync; after a removal the moderator's device now fetches it at once.

### MOD-016 Removing a version works the passage out again
Roles: COORD, TREV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- TREV has recorded and published Version 1 of Luke 18:1-17 (not started in
  the fixture).

Steps:
1. Device 1 (COORD): open Luke 18:1-17's Version 1, the flag, "Remove from
   the record", "Remove for everyone".
2. Devices 1 and 2 (TREV): tap "Sync now", open Luke 18:1-17.

Expected:
- On both: no Version 1. The passage is "Not started" again (or whatever it
  was before the version), and My Work and the Map agree.

### MOD-017 Removing needs a connection
Roles: COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- Offline. A note by someone else is on P-BT.

Steps:
1. Open the note's flag, "Remove from the record", "Remove for everyone".

Expected:
- The toast "Not removed: try again when connected".
- The note is still there on every device.

### MOD-018 Removed content stays gone for everyone
Roles: TRANS, REV, VIEW, NEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- MOD-015 removed TREV's note.

Steps:
1. Each role: open P-BT's history and the Sync screen.
2. NEW (a new member of ORG, fresh install): sign in and open P-BT.

Expected:
- Nobody sees the note, in the history, in the workspace tray or in the
  study.
- Nothing about it is refused on any device.
- Step 2: a device that never had it never shows it.

Known issue (2026-10-12): seen in two of three runs, a browser opening P-BT
for the first time after the removal (TRANS, fresh) still listed "Moderation
check" in the history, while devices that had it dropped it. Suspected: a
server snapshot of LANG-A cut between the note and its removal (decisions
88, 89) gives a fresh device a fold that already holds the note, and the
late `v1.Redacted` can only stop events not yet applied (reducer.ts), with
the note's own event not in the device's log to fold again without it.

---

## Reports in the Inbox

### MOD-019 A moderator's Inbox lists content reports
Roles: ADMIN, COORD, LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- MOD-004 has run: REV reported P-SUBMITTED's Version 1 as "Spam or
  unrelated" with "Test report".
- Two minutes have passed (the projection worker runs every minute).

Steps:
1. On My Work, read the bell's label.
2. Tap the bell.
3. Tap "A version was reported".

Expected:
- Step 1: the bell says "Updates, {n} new", and {n} counts the open report.
- Step 2: under "Unread ({n})", a row with a flag icon: "A version was
  reported", with "Spam or unrelated · Luke 15:11–32 · {date}" (one report
  names no count; MOD-013 may have added a second, then "· 2 reports"
  follows the reason).
- Step 3: a sheet with the same title and "Spam or unrelated · {date}".
  The body says "Someone reported this for Spam or unrelated. It was made
  by {TRANS}. Look at it, then remove it from the record or keep it." Then
  "Test report" in quotes, in italics.
- Under it: "Reports never say who sent them. The LangQuest team sees every
  report too."
- Buttons: a red "Remove from the record", "Open the passage", "Keep it".
- Nothing names REV.
- With several reports on one thing, the row says "{n} reports", the
  reasons are listed once each, and at most five comments show.

### MOD-020 A moderator acts on a content report
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- Two open content reports: P-SUBMITTED's Version 1 (MOD-004), and a
  report on a disposable note by TREV on P-BT.

Steps:
1. Open the version's report and tap "Open the passage".
2. Go back to the Inbox. Open the same report and tap "Keep it".
3. Open the note's report and tap "Remove from the record".
4. Check REV's and COORD's Inboxes.

Expected:
- Step 1: P-SUBMITTED's record opens (on a desktop-wide window, beside the
  Inbox).
- Step 2: the toast "Kept. The report is closed." The row leaves the Inbox,
  and the bell's count drops by one. Version 1 is unchanged.
- Step 3: asked once more, as from the flag (MOD-015): "It leaves the
  record for everyone in the organization." and the reason it is for, with
  a red "Remove for everyone" and "Cancel". After "Remove for everyone",
  the toast "Removed from the record. Devices stop showing it when they
  next sync." The row leaves the Inbox. The note is gone on every device
  after sync.

Fixed (2026-10-12): the Inbox's "Remove from the record" acted at once,
without the confirmation the flag's path asks for.
- Step 4: COORD no longer sees either report.

### MOD-021 Reports about a person
Roles: ADMIN, COORD, LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- MOD-007 has run: REV reported {TRANS} for "Harassment or bullying".

Steps:
1. ADMIN: open the bell and tap "{TRANS} was reported".
2. Tap "Open Members".
3. Go back, open the report again and tap "Close the report".
4. COORD and LADMIN: open the Inbox.

Expected:
- Step 1: the sheet says "Someone reported {TRANS} for Harassment or
  bullying. You can remove them from the organization under Members." and
  "Reports never say who sent them. The LangQuest team sees every report
  too." Buttons "Open Members" and "Close the report".
- Step 2: "Members" opens.
- Step 3: the toast "Kept. The report is closed." The row leaves the Inbox.
- Step 4, before step 3: COORD sees the report; LADMIN never does (LADMIN
  invites only at LANG-A). After step 3, COORD no longer sees it.

### MOD-022 Nobody sees a report about themselves
Roles: TREV, COORD, ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- COORD has added the note "Moderator's own note" to P-BT.

Steps:
1. TREV: report COORD's note ("Hateful or offensive").
2. After two minutes, COORD and ADMIN open their Inboxes.

Expected:
- ADMIN sees "A note was reported", made by {COORD}.
- COORD sees nothing about it, and COORD's bell count does not include it.
- Neither sees TREV's name anywhere in the report.

### MOD-023 Reports need a connection to read and to act on
Roles: ADMIN · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- An open content report exists. ADMIN opened the Inbox online after the
  projection worker noticed it, so the device has its notification.

Steps:
1. Go offline. Open the Inbox.
2. Tap the report row.
3. Go online, open the report, go offline, then tap "Keep it".

Expected:
- Step 1: a row "Something was reported" with "Connect to see what was
  reported."
- Step 2: the toast "Connect to the internet to see what was reported."
- Step 3: the toast "Not saved: try again when connected". The report stays
  open.
- If the server refuses (for example, ADMIN's role changed meanwhile), the
  toast is "Not saved: the server did not allow it."

Step 3 is automated. Steps 1 and 2 wait on the projection worker's
notification reaching the device, so they are checked by hand.

### MOD-024 A report or block the server turns down says why
Roles: REV, COORD · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions:
- Device 1 (REV) is offline.

Steps:
1. Device 1 (REV): report {TREV} as a person.
2. Device 2 (COORD): remove TREV from the organization (PEOPLE).
3. Device 1: go online, wait 30 seconds, and open the Inbox.
4. Tap the "Report" row.
5. On a fresh day, as REV, send 51 reports online.

Expected:
- Step 3: "Saved account changes" has "Report" with "That person is not in
  this organization. · Tap to try again" and the badge "Not sent".
- Step 4: it tries again and fails the same way; nothing crashes.
- Step 5: the 51st shows "That is a lot of reports for one day. Email
  admin@frontierrnd.com instead. · Tap to try again", badge "Not sent".
- "You cannot block yourself." and "You cannot report yourself." cannot be
  reached: there is no flag on your own work.

Resets: TREV is no longer in ORG. Put TREV back (PEOPLE) before JRN.
