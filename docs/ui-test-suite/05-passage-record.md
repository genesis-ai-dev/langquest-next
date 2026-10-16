# 05 The passage record (`PASS`)

The passage record and everything one tap from it:
- each fixture passage's main button, per role
- the step sheet ("Then the team") and "Something else?"
- Ask someone, and asking after publishing
- Already happened, set aside, checkpoints and Undo
- "Versions and history", the version and review pages, and the passage's
  reference page

Read with the [README](README.md): its global preconditions G1–G10, the
fixture world and the role matrix hold for every test here.

- `{TRANS}`, `{REV}` and so on stand for that account's display name.
- "Alpha" is LANG-A. TRANS recorded every published fixture passage.
- A check is called by its one name on the record (decision 91,
  `checkName`): "Peer check", "Back translation", "Community check",
  "Consultant check", "Final approval". A button says it in lower case: "Do
  the peer check", "Ask for the back translation". The version and review
  pages say it too. The History entries and Already happened still say the
  library's kind names ("Peer Review", "Back Translation"); see PASS-062.
- "Then the team" lists each check on its own row, with the people on it
  (decision 91). The Peer check and Back translation have {REV} and {TREV}.
- Since decision 91 the Translator role holds Review, so TRANS and KEPT may
  check other people's versions (never their own unless asked).
- Recording, the review screens and the study belong to 06 REC, 07 REV and
  08 STUDY. Here a test only checks that the record's buttons open them, and
  that the record shows the result when they finish. The automated tests
  make the review itself through the server as that person, with a core
  command (`e2e/ui/05-passage-helpers.ts` `actAs`).
- Out of scope: `guest_review` (the "Review by Link" preview). Nothing in the
  app navigates to it (`flow.ts` declares `ask_someone → guest_review` but no
  screen calls it), and replies by link need a server endpoint that is not
  built. Add tests when Ask someone links to it.

Automated in `e2e/ui/05-passage-record.spec.ts` (reading the fixture
as one role per test), `05-passage-asking.spec.ts` and `05-passage-checks.spec.ts`
(each with a world of its own, and spare Luke passages for tests that need a
fresh one), and Maestro flows `PASS-035`, `PASS-036` and `PASS-068`. The
role-by-passage tables (what each role's main button, path, "Then the team",
step sheets, "Something else?" and Versions page show) are held at the
screen-model layer (docs/testing.md, decision 102) in
`apps/mobile/test/passageRecordMatrix.test.ts`, on the fixture world built in
memory (`test/passageWorld.ts`) and read through `src/passage/recordModel.ts`;
the end-to-end test of each such spec reads one role, to prove the model
reaches the screen. A spec run only there says `Run: Auto (model)`.

Sources: `src/screens/passage.tsx`, `src/passage/` (`pathModel.ts`,
`recordModel.ts`, `record.ts`, `versions.tsx`), `src/screens/review.tsx` (Already happened),
`src/screens/reference.tsx` (`PassageReference`), `src/offline.tsx`,
`src/reportSheet.tsx`, and core `passage.ts` (decisions 29, 56, 61, 71, 72,
80, 83).

## The main button for each passage, per role

The footer of every record holds the main button (when there is one), then
the quiet links "Something else?" and "Versions and history". In the tables
below, "none" means only those two links show. ADMIN behaves as COORD, and
KEPT as TRANS where TRANS is not the author, unless a row says otherwise.

### PASS-001 P-NEW: not started, asked of TRANS
Roles: TRANS, REV, TREV, COORD, LADMIN, VIEW · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open Luke 13:1-9 from the Map (Luke → 13 → "Luke 13:1-9").
2. Read the header, the path, "Then the team" and the footer.
3. Tap the main button if there is one. Note the screen it opens, then tap
   ✕.

Expected:
- The header has the title "Luke 13:1-9", the sub "Alpha", and a Back arrow.
- The path shows "Record" lit. Its sub reads:
  - TRANS: "{COORD} asked you · due {Mon d}. Tell it in your language. The
    Bible, key words and notes are beside you while you record."
  - COORD: "You asked {TRANS} · due {Mon d}. Tell it…"
  - Everyone else: "{COORD} asked {TRANS} · due {Mon d}. Tell it…"
- Then "Publish", with the sub "Then ask for the peer check".
- "Then the team" lists one row per check (decision 91): "Peer check" "after
  you publish", "Back translation" "same time", "Community check" "after the
  peer check", "Consultant check" "after the community check" (a lock),
  "Final approval" "after the consultant check" (a lock). The Peer check and
  Back translation rows show their people, "{REV}, {TREV}".
- The main button:

  | Role | Main button | Opens |
  | --- | --- | --- |
  | TRANS, KEPT | "Record" | the recording workspace (06 REC) |
  | TREV, COORD, ADMIN, LADMIN | "Record" | the recording workspace |
  | REV | none | — |
  | VIEW | none | — |

- ✕ in the workspace returns to the record, unchanged.

### PASS-002 P-DRAFT: TRANS's unpublished takes
Roles: TRANS, REV, TREV, COORD, LADMIN, VIEW · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open Luke 14:1-14.
2. Read the "Record" step and the footer.

Expected:
- The "Record" step is lit. Its sub is "Your parts are recorded, not
  published yet." for TRANS, and "Some parts are recorded, not published
  yet." for everyone else.
- The main button:

  | Role | Main button | Opens |
  | --- | --- | --- |
  | TRANS | "Continue recording" | the workspace on TRANS's draft |
  | TREV, COORD, ADMIN, LADMIN, KEPT | "Record" | the workspace, with a draft of their own |
  | REV, VIEW | none | — |

- Nobody but TRANS sees TRANS's takes in their workspace (06 REC holds the
  details).

### PASS-003 P-SUBMITTED: Version 1, Peer check asked of REV
Roles: TRANS, REV, TREV, COORD, LADMIN, KEPT, VIEW · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open Luke 15:11-32.
2. Read the path and the footer. Tap the main button, note where it goes,
   and come back with ✕.

Expected:
- When FIA's study guide for this passage is offered, "Study" shows first,
  as passed ("–"), with the sub "{pattern} guide · {done} of {n} steps". It
  is passed because recording has started.
- "Record" is done, with the sub "Version 1 · {m:ss}". "Publish" is done,
  with the sub "Published {when} · asked {REV}" ("Published just now" when
  it is new; it read "Published Just now", REC-012).
- "Then the team": "Peer check" reads "asked {REV}", "Back translation"
  "same time", "Community check" "after the peer check", "Consultant check"
  "after the community check" with a lock.
- The main button:

  | Role | Main button | Opens |
  | --- | --- | --- |
  | TRANS | "Ask for the back translation" | the ask page (PASS-015) |
  | REV | "Do the peer check" | the review screen, carrying REV's request (07 REV) |
  | TREV, COORD, ADMIN, LADMIN, KEPT | "Do the peer check" | the review screen, without a request |
  | VIEW | none | — |

### PASS-004 P-NEEDS: feedback waiting for TRANS
Roles: TRANS, REV, TREV, COORD, LADMIN, VIEW · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open Luke 14:15-24.
2. Read the path, any amber line, and the footer.

Expected:
- TRANS's path adds two steps after "Publish":
  - "Hear the feedback" (lit), with the sub "Peer check · needs changes".
    Inside it are "{REV}" (with "· 0:05" when the voice note's length is
    known on this device) and the quote "Verse 18 is too fast".
  - "Fix it, or keep it and say why", with the sub "Then it goes back to
    the check".
- Everyone else sees no such steps. They see the amber line "Waiting on
  {TRANS} to answer the Peer check feedback.".
- The "Peer check" row of "Then the team" reads "needs changes" in amber.
- The main button:

  | Role | Main button | Opens |
  | --- | --- | --- |
  | TRANS | "Hear the feedback" | the review page, answerable (PASS-018) |
  | REV, TREV, COORD, ADMIN, LADMIN, KEPT | none, until TRANS answers | — |
  | VIEW | none | — |

- Fixed (2026-10-12): reviewers were offered "Do the peer review" on a
  version whose Peer Review already said "needs changes", and every role saw
  "Hear the feedback" and "Fix it" on its path. `openCheckFor` (record.ts)
  offers no check while feedback waits on the translator, and the feedback
  steps are only the author's (`pathModel.ts`).

### PASS-005 P-BT: Back translation asked of REV
Roles: TRANS, REV, TREV, COORD, LADMIN, KEPT, VIEW · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open Luke 14:25-35.
2. Read the first two "Then the team" rows and the footer.

Expected:
- "Peer check" reads "looks good"; "Back translation" reads "asked {REV}".
- The main button:

  | Role | Main button | Opens |
  | --- | --- | --- |
  | REV | "Back-translate it" | the back translation screen, carrying the request |
  | TREV, COORD, ADMIN, LADMIN, KEPT | "Back-translate it" | the back translation screen |
  | TRANS | none (the next check is already asked for) | — |
  | VIEW | none | — |

### PASS-006 P-CHECK: at the Consultant check checkpoint
Roles: TRANS, REV, TREV, COORD, LADMIN, KEPT, VIEW · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open Luke 15:1-10.
2. Read "Then the team" and the footer.

Expected:
- "Peer check", "Back translation" and "Community check" read "looks good".
- "Consultant check" reads "next", with a lock.
- "Final approval" reads "after the consultant check", with a lock.
- The main button:

  | Role | Main button | Opens |
  | --- | --- | --- |
  | TRANS | "Ask for the consultant check" | the ask page |
  | REV, TREV, COORD, ADMIN, LADMIN, KEPT | "Do the consultant check" | the review screen |
  | VIEW | none | — |

- The checkpoint tests are PASS-052 to PASS-057.

### PASS-007 P-ASIDE: Community check set aside
Roles: TRANS, REV, COORD, LADMIN, VIEW · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open Luke 16:1-15.
2. Tap the "Community check" row ("Then the team").
3. Close the sheet and read the footer.

Expected:
- The "Community check" row reads "set aside".
- Its sheet is titled "Community check", with the sub "This step is done.".
  The check's row reads "Community check", "Set aside: No community meeting
  this month", marked "Set aside", with no buttons. VIEW cannot open the
  sheet.
- The main button is the next check nobody has asked for yet (the Peer
  check, since step 1 is open):
  - TRANS: "Ask for the peer check".
  - REV, TREV, COORD, ADMIN, LADMIN, KEPT: "Do the peer check".
  - VIEW: none.

### PASS-008 P-DONE: every check complete
Roles: TRANS, REV, COORD, LADMIN, VIEW · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open Luke 16:19-31.
2. Read "Then the team" and the footer.
3. Tap "Something else?".

Expected:
- Every step reads "looks good" (or "answered").
- No role has a main button.
- "Something else?" offers no "Someone else should do this", "We already
  did this" or "Not now", because nothing is left to do.
- TRANS, COORD and LADMIN are offered "Record a new version". REV and VIEW
  are not.

### PASS-009 The viewer's record is read-only
Roles: VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-SUBMITTED, then P-NEEDS, then P-ASIDE.
2. Tap each path step and each "Then the team" row.
3. Tap "Something else?", then ✕. Tap "Versions and history".

Expected:
- No main button on any of them.
- "Record" and "Publish", when done, open the version page. Steps not done
  do nothing.
- "Then the team" rows do nothing.
- "Something else?" shows only the "What helps here" tile and the offline
  card. It has no "Add a note" tile and no "Say it instead" footer.
- "Versions" has no "New version" button, no "Edit", and no "Your draft".
- Its "History" shows no "Undo" and no "Withdraw".

## The path

### PASS-010 Steps, "Then the team", and what each tap opens
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-SUBMITTED. Tap "Study" (when it shows, PASS-003).
2. Go back and tap "Record" (done).
3. Go back and tap "Publish" (done).
4. Go back and tap the "Peer check" row.

Expected:
- "Study" opens the study (08 STUDY).
- "Record" and "Publish", when done, both open "Version 1" (PASS-064).
- The row opens a sheet titled with the step's checks, "Peer check and back
  translation". An ordinary step has no sub: it is just its checks
  (decision 91).
- On P-NEW, "Record" (not done) opens the workspace. "Publish" (not done,
  with no draft) does nothing.
- On P-NEEDS, "Hear the feedback" and "Fix it, or keep it and say why" both
  open the review page.

## Doing what the main button says

### PASS-011 Record opens the workspace, and the record updates after publishing
Roles: TRANS · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-Q1 (Luke 13:10-17). Tap "Record".
2. Record one part and publish it (06 REC does it step by step).
3. On the page that follows, tap "Not now".

Expected:
- "Record" opens the recording workspace for Luke 13:10-17.
- After publishing, the record shows the page from PASS-012 ("Version 1
  published").
- After "Not now": the path's "Record" is done ("Version 1 · {m:ss}") and
  "Publish" is done ("Published just now").
- My Work no longer lists Luke 13:10-17 for TRANS. COORD's "Waiting on
  others" drops by one.

Resets: P-Q1 now has Version 1.

### PASS-012 Publishing, then asking: the check's people are picked
Roles: TRANS · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- A second device signed in as REV.

Steps:
1. Open P-DRAFT. Tap "Continue recording" and publish the draft (06 REC).
2. Read the page that opens.
3. Tap "Ask the Peer check team".
4. Within 7 seconds, tap "Undo" on the toast.

Expected:
- The page has no header. A big green ✓ is followed by "Version 1
  published", then "Luke 14:1-14 · sent to the team" (or "· sending now"
  while it uploads; "· saved on this device · sends when you're online"
  only offline). Fixed (2026-10-12, REC-034): it always said "saved on this
  device".
- "Next, ask for a check" is followed by a card for each open check of the
  next step, each with its people (decision 91): "Peer check" with "{REV},
  {TREV}", then "Back translation" with the same. The first is picked; with
  more than one they are radios.
- The footer holds "Ask the Peer check team", then the quiet links "Someone
  else" and "Not now".
- Tapping the button returns to the path and shows "Sent to the Peer check
  team — anyone on it will see it on My Work", with "Undo". The "Peer check"
  row reads "asked the Peer check team".
- "Undo" shows "Undone.". The row goes back to "next", and REV's My Work
  (after Sync now) does not list Luke 14:1-14.

Resets: P-DRAFT is now Version 1, with the Peer check not asked.

### PASS-013 Publishing, then asking someone else
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-Q2 (Luke 13:18-21). Record a part and publish it (06 REC).
2. On "Version 1 published", tap "Someone else".

Expected:
- Ask someone opens, titled "Ask for Peer check", with the sub "Luke
  13:18-21 · Alpha" and ✕ (PASS-037).
- ✕ returns to the record's path, not to the publish page.

### PASS-014 Publishing, then not now
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Publish a new version of any of TRANS's passages that has an unasked
   next check.
2. On the page, tap "Not now".
3. Read the footer.

Expected:
- "Not now" returns to the path with nothing sent.
- The main button now reads "Ask for the {check}". Tapping it opens the
  same page with the header "Ask for a check" and ✕, and no big ✓.

### PASS-015 Ask for the check from the main button
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-SUBMITTED. Tap "Ask for the back translation".
2. Read the page.
3. Tap "Someone else".

Expected:
- The header is "Ask for a check", with the sub "Luke 15:11-32" and ✕.
- Under "Next, ask for a check" the card reads "Back translation" with its
  people, "{REV}, {TREV}" (decision 91).
- The footer is "Ask the Back translation team" (it sends in one tap, as
  PASS-022), then "Someone else" and "Not now".
- "Someone else" opens Ask someone for the Back translation ("Ask for Back
  translation").
- A check with nobody on it reads "Anyone", and the footer reads "Ask for the
  {check}", which opens Ask someone.
- Retired from this test: "Every check is done." and "The next check is
  already asked for." No button opens this page then (the main button and
  Versions offer it only while a check is open), so it cannot be reached.

### PASS-016 Do the check, and the record afterwards
Roles: REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-SUBMITTED. Tap "Do the peer check".
2. Give the verdict "Looks good" (07 REV).
3. Read the record, then open the "Peer check" row.

Expected:
- The review screen opens on the Peer check for Version 1 (its header is the
  passage, its sub "Peer check").
- Afterwards the record is back on top.
- The sheet shows the Peer check marked "Looks good". The Back translation is
  still "Not yet".
- The "Peer check" row reads "looks good", no longer "asked {REV}".
- REV's My Work no longer lists P-SUBMITTED. TRANS's bell gains "Peer
  Review: looks good" (after Sync).

Resets: P-SUBMITTED's Peer check is done.

### PASS-017 Back-translate it, and the record afterwards
Roles: REV, TREV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. REV: open P-BT. Tap "Back-translate it".
2. Record and publish the back translation (07 REV).
3. TREV: do the same on a Version 1 whose Peer check looks good and whose
   back translation nobody was asked for.

Expected:
- The back translation screen opens for Version 1, with the sub "Back
  translation · into English".
- Afterwards the record shows the page "Back translation published".
- Step 1 is now complete: the "Peer check" and "Back translation" rows read
  "looks good".
- REV holds no Send to reviewers, so the page offers no check to ask for:
  the footer is only "Done".
- TREV is offered the next check: "Next, ask for a check" with the Community
  check, and "Ask {target}" or "Ask for the community check".
- Fixed (2026-10-12): the page showed "Next, ask for a check" with the
  Community Check card to someone who cannot ask. The page now lists checks
  only for someone who can ask.

Resets: P-BT's step 1 is complete.

### PASS-018 Hear the feedback
Roles: TRANS · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-NEEDS. Tap "Hear the feedback".
2. Read the page.
3. Play "{REV}'s feedback".

Expected:
- The page has the title "Luke 14:15-24", ✕ and a report flag.
- An amber pill reads "Peer check · needs changes", with REV's avatar and
  name, and "{when} · Version 1".
- The feedback card has the player "{REV}'s feedback" (0:05) and the quote
  "Verse 18 is too fast".
- "Their answers to the questions" can be expanded, when the review answered
  any.
- The link "Hear Version 1, the version they heard" opens Version 1.
- The footer has "Record a fix" (primary) and "Keep it, say why".

### PASS-019 Record a fix
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- A second device signed in as REV.

Steps:
1. On P-NEEDS's feedback page, tap "Record a fix".
2. Record and publish Version 2 (06 REC).
3. On the page that follows, tap "Not now". Open the "Peer check" row.

Expected:
- The workspace opens on P-NEEDS, tied to REV's review.
- Afterwards the record shows "Version 2 published". The check it offers
  first is the Peer check again, with "Ask the Peer check team": answered
  feedback keeps the check open (decided 2026-10-13, decisions.md 96).
- On the path, "Hear the feedback" and "Fix it…" are gone.
- In the sheet, the Peer check is marked "Feedback answered".
- "Versions and history" → "History" lists "Revised after Peer Review".
- REV's bell shows "{TRANS} revised Luke 14:15-24" with "The new version
  answers your Peer Review feedback."

Resets: P-NEEDS is at Version 2.

### PASS-020 Keep it, say why, and Undo
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- A passage with "needs changes" feedback on TRANS's latest version: P-NEEDS
  before PASS-019, or a fresh one made by REV (07 REV).

Steps:
1. Open the feedback page. Tap "Keep it, say why".
2. Read the page. Try to tap "Keep it".
3. Type "The pace is right for our listeners" in "Or type it". Tap "Keep
   it".
4. Tap "Undo" on the toast.

Expected:
- The page reads "Keep it as it is?" with "Say why. {REV} and the team will
  hear it.", a big "Tap and say why" button, and "Or type it".
- "Keep it" stays disabled until there is a voice note or text.
- The toast reads "Kept · your reason is on the record" with "Undo". The app
  returns to the record. "Hear the feedback" is gone, and the step sheet
  marks Peer Review "Feedback answered".
- "Undo" shows "Undone — the feedback is waiting again" (REV-044), and
  "Hear the feedback" is back.
- Android back on the keep page returns to the feedback page, not the
  record.

## The step sheet ("Then the team")

### PASS-021 What a step offers, per role
Roles: TRANS, REV, TREV, COORD, LADMIN, KEPT, VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-SUBMITTED (before PASS-016). Tap the "Peer check" row.
2. Read each check's sub and buttons.

Expected:
- The sheet's title is the step's checks, "Peer check and back
  translation". An ordinary step has no sub (decision 91).
- The Peer check is marked "Asked" in every case. Its sub is "{TRANS} asked
  you" for REV and "Waiting on {REV}" for everyone else.
- The Back translation is marked "Not yet", with the sub "A bilingual speaker
  records it in English — new content, not a verdict · the Consultant check
  reviews it".
- The buttons:

  | Role | Peer check (asked of REV) | Back translation (not asked) |
  | --- | --- | --- |
  | TRANS (author) | "Already happened", "Set aside" | "Send to the Back translation team" (primary), "Send to someone else", "Already happened", "Set aside" |
  | REV | "Review it now" (primary), "Already happened", "Set aside" | "Back-translate it" (primary), "Already happened", "Set aside" |
  | TREV, COORD, ADMIN, LADMIN, KEPT | "Review it now", "Already happened", "Set aside" | "Back-translate it" (primary), "Already happened", "Ask someone", "Set aside" |
  | VIEW | the sheet does not open | — |

- The author is never offered "Review it now" or "Back-translate it" on
  their own version unless they were asked (the role matrix). Fixed
  (2026-10-12): TRANS was offered both.
- When a check has people (or one person usually does it), its author sees
  "Send to the {check} team" (or the name) as primary, and "Send to someone
  else" beside it, instead of "Ask someone".
- No "Move past this checkpoint…" on an ordinary step.

### PASS-022 Send to the check's people in one tap
Roles: TRANS, REV, TREV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- P-DRAFT is Version 1, with the Peer check not asked (after PASS-012).
- A second device signed in as REV.

Steps:
1. TRANS: open P-DRAFT. Tap the "Peer check" row.
2. Tap "Send to the Peer check team".
3. REV and TREV: tap Sync now, then open My Work.

Expected:
- The sheet closes. The toast "Sent to the Peer check team — anyone on it
  will see it on My Work" shows, with "Undo".
- The "Peer check" row reads "asked the Peer check team".
- REV and TREV see Luke 14:1-14 on My Work, asked by {TRANS}.
- TRANS's My Work → "Waiting on others" lists it.
- Fixed (2026-10-13): that row names "someone", not the team. It is
  My Work's (NAV-015) and is checked there; REV's and TREV's My Work already
  read "For the Peer check team".

Resets: withdraw the request from History straight away ("Withdraw",
PASS-044), so that PASS-037 finds the Peer check not asked.

### PASS-023 Set a check aside, with a reason, and Undo
Roles: TRANS, REV, COORD · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-SUBMITTED. Tap the "Back translation" row.
2. On the Back translation, tap "Set aside".
3. Read the sheet. Try to tap "Set aside".
4. Tap "Not needed for this passage". Tap "Set aside".
5. Within 7 seconds, tap "Undo".

Expected:
- The step sheet closes, then the sheet "Set aside Back translation?" opens.
- Its sub reads "The flow suggests this step. Setting it aside is fine — say
  why so the next person understands."
- The quick reasons are "No one available for this right now", "Another
  review already covered this" and "Not needed for this passage". There is
  a voice note button and "Or type the reason".
- The footnote reads "This goes in the passage's record with your name. It
  can be undone later; the record keeps both."
- "Set aside" is disabled until a reason is chosen, typed or said.
- After confirming: the toast "Back translation set aside · reason saved"
  with "Undo". The check is marked "Set aside", with "Set aside: Not needed
  for this passage".
- "Undo" shows "Undone.", and the check is "Not yet" again.
- History keeps both acts: "Back Translation set aside · brought back
  {when}".

### PASS-024 Set aside with only a voice note
Roles: TRANS · Priority: P2 · Platforms: iOS, Android · Run: Device

Steps:
1. As PASS-023 steps 1–3, then record a 3-second voice note in the sheet and
   tap "Set aside".
2. Open "Versions and history" → "History".

Expected:
- "Set aside" becomes enabled once the voice note is recorded.
- The kind's line reads "Set aside: Explained in a voice note."
- The History entry plays the voice note.

Resets: undo it from History.

### PASS-025 Bring back a set-aside step from History
Roles: TRANS, REV, TREV, COORD, LADMIN, VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-ASIDE. Tap "Versions and history", then "History".
2. Find "Community Check set aside".
3. Tap "Undo" on it (every role but VIEW).

Expected:
- The entry reads "Community Check set aside", with "{TRANS-or-whoever} ·
  {when} — No community meeting this month".
- TRANS, REV, TREV, COORD and LADMIN see "Undo". VIEW sees none.
- "Undo" shows "Brought back — it's a suggested step again", with no Undo of
  its own.
- On the path, "Community Check" now reads "next" (or "after the …").

Resets: set Community Check aside again with "No community meeting this
month".

## Something else?

### PASS-026 Something else? on a passage nobody has recorded
Roles: TRANS, REV, TREV, COORD, LADMIN, VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-NEW. Tap "Something else?".
2. Read the page.

Expected:
- The header is "Something else?", with the sub "Luke 13:1-9 · Record" and
  ✕.
- "Someone else should do this" ("Ask a person on the team, or someone
  outside by WhatsApp or text") shows for TRANS, TREV, COORD, ADMIN, LADMIN
  and KEPT. Not for REV or VIEW.
- No "We already did this", "Not now" or "Record a new version" (nothing is
  recorded yet).
- Tiles: "Add a note" (everyone but VIEW) and "What helps here" (everyone).
- The offline card is shown (PASS-035).
- The footnote reads "Each check under "Then the team" has its own options
  too: tap it on the path."
- The footer "Say it instead", with "A voice note on this passage. Your team
  hears it here.", shows for everyone but VIEW.

### PASS-027 Something else? on a recorded passage
Roles: TRANS, REV, TREV, COORD, LADMIN, KEPT, VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-BT. Tap "Something else?".

Expected:
- The sub reads "Luke 14:25-35" (no lit step on a recorded passage's own
  path).
- The options (the current check is the Back translation, already asked of
  REV):

  | Option | TRANS, KEPT | REV | TREV, COORD, ADMIN, LADMIN | VIEW |
  | --- | --- | --- | --- | --- |
  | "Someone else should do this" | no (it is already asked) | no | no (it is already asked) | no |
  | "We already did this" ("Say when and how the back translation happened") | yes | yes | yes | no |
  | "Not now" ("Set the back translation aside. Say why") | yes | yes | yes | no |
  | "Record a new version" ("Reviews so far stay with the version they heard") | yes | no | yes | no |
  | "Move past a checkpoint" | no | no | COORD and ADMIN only, and only at a checkpoint | no |

- On a check nobody has been asked for, "Someone else should do this" reads
  "{Check}: ask a person, a group, or someone outside by WhatsApp or text",
  for everyone who may ask.
- Fixed (2026-10-12): when the current check was already asked of someone,
  "Someone else should do this" still opened Ask someone, making a second
  request. It is now offered only for a check nobody has been asked for, as
  the step sheet does (`elseChoices`, record.ts).

### PASS-028 Someone else should record it
Roles: COORD, TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open an unstarted Luke passage nobody was asked to record (P-S, Luke
   12:35-48). Tap "Something else?".
2. Tap "Someone else should do this".

Expected:
- Ask someone opens, titled "Ask someone to record", with the sub
  "{passage} · Alpha".
- The top card reads "Record it", with "They'll find it on their My Work,
  with the source and the study ready."
- There are no "Someone on the team" / "Someone without the app" chips (to
  record, only a team member can be asked) and no "They'll answer".
- The list holds people who can record in Alpha, without the asker: TRANS,
  TREV, KEPT, ADMIN, COORD and LADMIN, less whoever is asking. REV and VIEW
  are not in it.
- The footer is a disabled "Choose someone".
- Retired from this test: "Ask for a new version" on a recorded passage. No
  button asks someone to record a passage that already has a version.

### PASS-029 We already did this
Roles: TRANS, REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-BT. Tap "Something else?", then "We already did this".
2. Read the header. Tap ✕.

Expected:
- Already happened opens on the Back translation. Its header is the passage,
  its sub "Back translation · already happened", and it has ✕ (PASS-047
  onward).
- ✕ returns to "Something else?", with nothing saved.

### PASS-030 Not now, from Something else?
Roles: TREV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open a Version 1 of TRANS's whose Peer check nobody has asked for. Tap
   "Something else?", then "Not now".
2. Choose "No one available for this right now". Tap "Set aside".
3. Tap "Undo".

Expected:
- The sheet "Set aside Peer check?" opens, as in PASS-023.
- The toast reads "Peer check set aside · reason saved" with "Undo". "Undo"
  shows "Undone.".
- The page stays on "Something else?", on every platform.

### PASS-031 Record a new version, or continue
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-DONE. Tap "Something else?", then "Record a new version".
2. Record one part, then tap ✕ without publishing.
3. Read "Something else?" again.

Expected:
- The workspace opens on a new draft.
- Back on "Something else?", the option reads "Continue recording".
- On a passage whose feedback is TRANS's to answer (P-NEEDS before PASS-019),
  neither option shows.

Resets: delete the draft (PASS-060).

### PASS-032 Add a note
Roles: TRANS, REV, VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- A second device signed in as TREV.

Steps:
1. TRANS: open P-SUBMITTED. Tap "Something else?", then "Add a note".
2. Read the sheet. Try "Add note".
3. Type "Watch the names in verse 12" in "Or type it". Tap "Add note".
4. TREV: Sync now, open P-SUBMITTED, and read the path.

Expected:
- The sheet's sub reads "On the whole passage. It follows the passage into
  reviews and later versions." It has "Say it" and "Or type it".
- "Add note" is disabled until there is text or a voice note.
- The toast reads "Note added — it follows this passage", with "Undo".
- TREV's lit "Record" step (if not recorded), or History, shows "{TRANS}'s
  note". In History it is "Note · {anchor}", with a report flag (PASS-066).
  TRANS sees "Undo" on it instead: their own note, which they may take back
  (decisions.md 111).
- REV can add a note. VIEW has no "Add a note" tile.

### PASS-033 Say it instead
Roles: TRANS · Priority: P2 · Platforms: iOS, Android · Run: Device

Steps:
1. Open P-NEW. Tap "Something else?", then "Say it instead".
2. Record a 4-second voice note. Tap "Add note".

Expected:
- The same note sheet opens, with the sub "Say what's going on. It stays on
  this passage, where your team hears it."
- The toast reads "Note added — it follows this passage". The note plays
  back on another device.

### PASS-034 What helps here (the passage's reference)
Roles: TRANS, VIEW, COORD, LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-SUBMITTED. Tap "Something else?", then "What helps here".
2. Read the page.
3. COORD and LADMIN: on a study guide, tap "Hide here", then "Undo".

Expected:
- The header is "What helps here", with the sub "Alpha" and Back. There is no
  tab bar on a phone.
- At the top the passage is one tap away: "{passage} · {Bible}" (Luke
  15:11-32 · BSB), which opens its text with key words and notes marked.
- Each help is a card: its name, its steps and language and where it comes
  from, and what it says on this passage (a guide's first step, a note's
  first words, the key words), above Show here / Hide here. The Bibles come
  last. With nothing recommended or placed here, translators get the study
  from the organization's library ("From your organization's library"). With
  nothing at all the page says "Nothing helps on this passage yet."
- TRANS and VIEW see the cards only, with no "Hide here", "Show here" or
  "Add a help".
- COORD and LADMIN (Reference material) get "Show here" / "Hide here" on each
  card; "Hide here" shows "{name} is hidden on this passage." with "Undo".
  Undo restores the link. They also get "Add a help" (a note for translators
  first, then the library; 08 STUDY covers adding). The automated test checks
  "Hide here" only when a card is offered.
- Back returns to "Something else?".
- Updated (2026-10-13): main's "Decide about a passage with its text open"
  (0a6934c, demo ADR-042, design principles 12 and 13): the page was titled
  "Reference" and listed groups ("Bibles · {n}") with an "Add" footer.

### PASS-035 Keep a passage on this device
Roles: TRANS, VIEW · Priority: P1 · Platforms: iOS, Android · Run: Auto

Steps:
1. Open P-S (Luke 12:35-48: nobody asked for it or worked on it). Tap
   "Something else?". Read the offline card.
2. Tap "Keep offline". Wait for the download.
3. Tap "Stop keeping offline".
4. Open P-NEW's "Something else?" (asked of TRANS).

Expected:
- At first the card reads "Not kept on this device", with "Its text is here,
  but its audio needs a connection. Keep it offline to take it with you."
  and a "Keep offline" button.
- "Keep offline" shows "Kept on this device. It downloads while you are
  connected." There is no Undo. The card shows "Downloading for offline" with
  a bar, then "On this device", with "Its text and audio work without a
  connection. Kept because you chose to keep it."
- "Stop keeping offline" shows "No longer kept. Its audio may be removed to
  make room."
- On P-NEW, TRANS's card reads "On this device" with "Kept because you were
  asked to work on it.", and has no Stop button (only a chosen keep can be
  stopped).
- P-DONE is not a "not kept" passage for TRANS: TRANS recorded it, so it is
  "Kept because you've worked on it.".
- Web: record what the card says. The web app keeps no audio offline
  (decision 58).

### PASS-036 Offline indicators on the record
Roles: TRANS · Priority: P1 · Platforms: iOS, Android · Run: Auto

Steps:
1. Turn the network off.
2. Open P-S (not kept), then P-NEW (kept).
3. Read the top of each record, then "Something else?".

Expected:
- Decision 61: each passage says, without scrolling, whether it is on this
  device.
- On "Something else?", P-S reads "Audio not on this device", with "You
  can read it and record, but its audio needs a connection." P-NEW reads "On
  this device".
- The record opens and its text, status and history show while offline.
- Just under the header, the record says "On this device" /
  "Downloading for offline · {here} of {total}" / "Not kept on this device"
  (or "Audio not on this device" offline).
- Fixed (2026-10-12): the one-line indicator (`PassageOfflineLine` in
  `offline.tsx`) was imported by `passage.tsx` but never drawn; it now shows
  under the header on the path.

## Ask someone

### PASS-037 Ask someone for a check: who is listed first
Roles: TRANS · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- P-DRAFT is Version 1, with the Peer check not asked (after PASS-012).

Steps:
1. Open P-DRAFT. Tap the "Peer check" row, then "Send to someone else".
2. Read the page top to bottom.

Expected:
- The title is "Ask for Peer check", with the sub "Luke 14:1-14 · Alpha" and
  ✕. There is no tab bar.
- The top card shows the check's icon, name and description.
- Under "Who" are the chips "Someone on the team" (on) and "Someone without
  the app".
- The check's team comes first (decision 91): "The Peer check team", with
  its people "{REV}, {TREV}". It is picked.
- Then the check's people one by one: REV ("Reviewer") and TREV
  ("Translator-Reviewer").
- Then "Everyone else" who holds Review in Alpha, sorted by name: ADMIN
  ("Organization Admin"), COORD ("Coordinator"), KEPT ("Translator") and
  LADMIN ("Language Lead").
- TRANS (the asker) and VIEW (no Review) are not listed.
- The rows are single-choice radios.
- "They'll answer" lists the questions the check already asks, and takes
  more.
- The footer reads "Ask the Peer check team".

### PASS-038 Ask a person, with directions, a question and a due date
Roles: TRANS, TREV · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- On Ask for Peer check for P-DRAFT, as PASS-037 leaves it.
- A second device signed in as TREV.

Steps:
1. Tap TREV's row.
2. Under "Directions · optional", type "Listen for the parable's ending" in
   "Or type them".
3. Under "They'll answer", type "Is the host's anger clear?" in "Ask
   something specific". Tap "Add question".
4. Under "By when · optional", tap "In a week".
5. Tap "Ask {TREV first name}".
6. TREV: Sync now, then open My Work.

Expected:
- The footer changes to "Ask {first name}" once TREV is picked.
- The question shows under "They'll answer", after the check's own
  questions, with "Yes/No" and ✕ ("Remove question").
- The date line reads "Due {day}".
- After sending, the toast reads "{TREV} will see it on their My Work", with
  "Undo". The app returns to P-DRAFT's record.
- The "Peer check" row reads "asked {TREV}".
- History shows "Asked {TREV} for Peer Review", "You · {when} — due {Mon d}",
  with "Withdraw".
- TREV's My Work lists "Luke 14:1-14", "… asked by {TRANS} · due {Mon d}". In
  the review the directions and the question appear (07 REV).

### PASS-039 Ask someone to record, then Undo
Roles: COORD, LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open an unstarted Luke passage nobody was asked to record. Tap "Something
   else?", then "Someone else should do this".
2. Pick KEPT ("Kept Person"). Tap "In 2 weeks". Tap "Ask Kept".
3. Within 7 seconds, tap "Undo".

Expected:
- The toast reads "Kept Person will see it on their My Work" with "Undo".
  The app returns to the record's path, where "Record" reads "You asked Kept
  Person · due {Mon d}. Tell it…".
- "Undo" shows "Undone.". The Record step loses the "asked" line, and
  History shows the request as withdrawn.
- LADMIN can do the same in Alpha (Assign work, Send to reviewers).
- Fixed (2026-10-12): asking from "Something else?" came back to "Something
  else?", not the path (`passage_record` now takes an `asked` param).

### PASS-040 Typing a due date
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. On Ask someone (any), type "12/10/2026" in "Or a date, like
   {today+10}".
2. Type "2026-02-30".
3. Type yesterday's date as YYYY-MM-DD.
4. Type a date 10 days ahead.
5. Clear the field and tap "Today".
6. Tap "No date".

Expected:
- Step 1: "Write the date as YYYY-MM-DD, like 2026-10-07." in red. The
  footer stays disabled.
- Step 2: "That date does not exist."
- Step 3: "Pick today or a later day."
- Step 4: no error. The line reads "Due {day}", and no chip is lit.
- Step 5: "Today" is lit, and the line reads "Due {today}".
- Step 6: "No date" removes the due date.

### PASS-041 Your own questions
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. On Ask someone for any check, check that "Add question" is disabled with
   an empty field.
2. Tap "Answer: Yes/No" three times.
3. Add two questions, then tap ✕ on the first.

Expected:
- "Add question" is disabled until the field has text.
- The answer type cycles "Answer: Yes/No" → "Answer: Text" → "Answer: 1–5" →
  "Answer: Yes/No".
- ✕ removes only that question.

### PASS-042 Ask someone without the app
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- On P-DRAFT, open the "Back translation" row and tap "Send to someone else"
  (or "Ask someone" when nobody is on the check). The page is titled "Ask for
  Back translation".

Steps:
1. Tap "Someone without the app".
2. Type "Pastor Garang" in "Their name — e.g. Pastor Garang". Tap "SMS".
   Type "123" in "Phone number".
3. Type "+211 555 0100".
4. Tap "Ask Pastor".

Expected:
- A preview "SMS preview" reads "Hi Pastor Garang — could you listen to Luke
  14:1-14 in Alpha and tell us what you understood? No account needed:"
  followed by "The request is saved on the record with their name and
  number. Sending the no-account link from the app is not ready yet."
- With "123" the footer stays disabled (more than 3 characters are needed).
- After sending, the toast reads "Asked Pastor Garang · the request is on the
  record", with "Undo".
- The Back translation's sub reads "Waiting on Pastor Garang · by link over
  SMS".
- Known issue (2026-10-12): nothing is sent to the phone, and the link page
  (`guest_review`) is not reachable. In passage summaries (map rows,
  "Opened lately") the guest's name becomes an anonymous colour-and-shape
  name (`coreText.ts` passes it to `ctx.name`). Expected: "Waiting on Pastor
  Garang · Back Translation".

Resets: withdraw the request (PASS-044).

### PASS-043 Who may ask
Roles: TRANS, REV, TREV, COORD, LADMIN, KEPT, VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto (model)

Steps:
1. Open P-BT and P-NEW. Look for every way to ask: the main button, the step
   sheet ("Ask someone", "Send to …"), and "Someone else should do this".

Expected:
- TRANS, TREV, COORD, ADMIN, LADMIN and KEPT are offered a way to ask.
- REV and VIEW are offered none.
- None of them sees "You don't have permission to open that." (G10.6).

### PASS-044 Withdraw a request from History
Roles: TRANS, TREV, COORD, LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- An open request made by TRANS (PASS-042's, to Pastor Garang), and COORD's
  open request to record P-Q4.

Steps:
1. TRANS: open the passage with TRANS's request. Tap "Versions and history"
   → "History".
2. Tap "Withdraw" on TRANS's request.
3. TRANS, then TREV: open P-Q4's History.
4. COORD, then LADMIN: open P-Q4's History. LADMIN taps "Withdraw" on
   COORD's request.

Expected:
- TRANS sees "Withdraw" on its own request. Tapping it shows "Request
  withdrawn", with no Undo, and the entry is marked withdrawn.
- On P-Q4, TRANS and TREV see no "Withdraw" on COORD's request (not theirs,
  and no Assign work).
- COORD and LADMIN (Assign work) can withdraw anyone's request. P-Q4 leaves
  TRANS's My Work after Sync.
- Request rows that carry directions show a report flag instead of
  "Withdraw", for someone who cannot withdraw them.

Resets: P-Q4's record request is withdrawn. Ask TRANS again if the fixture
must hold.

## Already happened

### PASS-047 A check that happened outside the app: Looks good
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- P-DRAFT is Version 1 with Peer Review asked of TREV (PASS-038).

Steps:
1. Open P-DRAFT's first "Then the team" row. On Peer Review, tap "Already
   happened".
2. Read the first stage. In "Who reviewed it?", type "Peter Lual".
3. Tap "Next: questions" (or "Next: decide"), answer or skip each question,
   then tap "Looks good".

Expected:
- The header is "Luke 14:1-14", with the sub "Peer Review · already
  happened" and ✕.
- The stages read "Listen", "Questions" (when the kind has questions) and
  "Decide".
- The intro reads "For a Peer Review that happened outside the app — in
  person, on a call, at church. It goes on the record credited to whoever
  gave it."
- The player is titled "Version 1 · recorded by you".
- The verdict question is "Is it accurate and natural?". "Looks good" and
  "Needs changes" are disabled while a required question is open, with
  "{n} required question(s) left — answer, or say why not".
- Saving shows "Peer Review added to the record", with "Undo" (whoever
  logged a check may take it back, decisions.md 111). The app returns to the
  record.
- Peer Review is marked "Looks good". TREV's request is done, and P-DRAFT
  leaves TREV's My Work after Sync.

### PASS-048 A check that happened outside the app: Needs changes
Roles: REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-DRAFT. Tap the "Community Check" row ("Then the team"), then
   "Already happened".
2. Set "How many listened?" to 12.
3. Go to "Decide". Tap "Needs changes".
4. Try "Send feedback". Then type "Listeners asked who the host was" in "Or
   type what people understood and asked about". Tap "Send feedback".

Expected:
- Community Check has "How many listened?" with a counter, instead of a
  person's name.
- "Needs changes" opens "What should change?", with "Say what they said.
  {TRANS} will hear it."
- "Send feedback" is disabled until something is said or typed.
- Saving shows "Community Check added to the record". The Community Check
  row reads "needs changes".
- TRANS's My Work gains "Feedback to hear", and the bell gains "Feedback on
  Luke 14:1-14".

### PASS-049 Add details: where, which version, and other passages
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. On Already happened for a Peer Review on a passage with two versions (P-NEEDS
   after PASS-019), tap "Add details".
2. Type "Bor church, after service" in "Where". Under "Which version was
   played", choose Version 1. Under other passages, add Luke 14:25-35.
3. Finish with "Looks good".

Expected:
- The sheet offers "Where — e.g. Bor church, after service", "Which version
  was played" (chips, only with more than one version), the other-passages
  picker ("Saves to 2 passages") and "Evidence · optional".
- The toast reads "Peer Review added to 2 passages".
- Each passage's History shows the review, with the place.

### PASS-050 A back translation that happened outside the app
Roles: REV · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-SUBMITTED's first "Then the team" row. On Back Translation, tap
   "Already happened".
2. Go to the "Record it" stage. Try "Save to the record".
3. Record one part (G8). Tap "Save to the record".

Expected:
- The stages end in "Record it", not "Decide". The heading reads "Record
  the {what}", with "It's what gets checked next, so it's the one thing this
  entry needs."
- "Save to the record" is disabled until there is at least one part. Each
  part shows "Part {n}" and "Remove part {n}".
- Saving shows "Back Translation added to the record". Back Translation is
  marked done on the record.

## Checkpoints

### PASS-052 A checkpoint is a hard stop
Roles: TRANS, REV, TREV, KEPT · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-CHECK. Tap "Final approval" ("Then the team").
2. Close it. Tap "Consultant check".
3. Tap "Something else?".

Expected:
- "Final approval" reads "after the consultant check", with a lock.
- Its sheet's sub reads "Waits for the Consultant check checkpoint.". The
  Final approval is marked "Waits for checkpoint", reads "Starts after the
  Consultant check checkpoint" and has no buttons.
- "Consultant check"'s sheet's sub reads "Checkpoint — later steps wait for
  this one.". It has no "Set aside" button and no "Move past this
  checkpoint…".
- "Something else?" has no "Move past a checkpoint".
- Main buttons as PASS-006.

### PASS-053 A check logged afterwards never clears a checkpoint
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-CHECK. Tap "Consultant check", then "Already happened".
2. Give the verdict "Looks good" and save.
3. Read "Then the team", then open "Consultant check".

Expected:
- "Consultant Check added to the record" shows.
- "Consultant check" still reads "next", and "Final approval" "after the
  consultant check", with a lock.
- The Consultant check is not done: its sheet still offers its buttons, and
  TRANS's main button is still "Ask for the consultant check". Only approval
  given in the app clears a checkpoint (decision 72; core `derivePassage`).
- A reviewer's "Looks good" given in the app (07 REV) does clear it.
- Fixed (2026-10-12): the row read "looks good" and the sheet offered
  nothing after a logged check (`kindCleared`, record.ts).

Resets: P-CHECK has a logged Consultant check review.

### PASS-054 Move past a checkpoint, with a reason
Roles: COORD, ADMIN · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-CHECK. Tap "Something else?" and read it, then ✕.
2. Tap "Consultant check". Tap "Move past this checkpoint…".
3. Read the sheet. Try "Move past checkpoint".
4. Tap "Consultant visit is months away; church needs it now". Tap "Move past
   checkpoint".
5. Read the record. Tap "Consultant check", then "Final approval".

Expected:
- "Move past a checkpoint" is offered on "Something else?" while the
  checkpoint is locked, with "Consultant check is a must-pass step. Say why,
  and it's on the record".
- The button is red. It opens the red sheet "Move past the checkpoint?",
  with "Checkpoints are the flow's hard stops. Your reason is recorded with
  your name, and anyone can see it on the record."
- The quick reasons are "Consultant visit is months away; church needs it
  now" and "Checked informally — will record it later". There is a voice
  note and a typed reason.
- "Move past checkpoint" is disabled until there is a reason.
- The toast reads "Moved past the checkpoint · reason saved", with "Undo".
- "Then the team" reads "Consultant check" "moved past" and "Final approval"
  "next".
- "Consultant check"'s sheet's sub reads "Checkpoint moved past, with a
  reason — later steps can go ahead. Undo it from History."
- "Final approval"'s sheet is no longer locked, and offers its buttons.
- TRANS's main button on P-CHECK becomes "Ask for the final approval".
- History shows "Moved past a checkpoint" with the reason and COORD's name.
- Fixed (2026-10-12): "Then the team" never showed "moved past"
  (`pathModel.ts` `teamSteps` now reads the override).

### PASS-055 A language lead may not move past a checkpoint
Roles: LADMIN · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-CHECK. Tap "Consultant check".
2. Tap "Something else?".

Expected:
- The sheet offers "Review it now", "Already happened" and "Ask someone". It
  has no "Move past this checkpoint…" and no "Set aside".
- "Something else?" has no "Move past a checkpoint".
- Final approval stays locked.
- Its main button is "Do the consultant check" (LADMIN holds Review).

### PASS-056 Undo moving past a checkpoint
Roles: COORD, TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Right after PASS-054, open "Versions and history" → "History".
2. On "Moved past a checkpoint", tap "Undo".
3. TRANS: open the history of a checkpoint COORD has moved past again.

Expected:
- "Undo" shows "The checkpoint is back — later steps wait for it again".
- Final approval is locked again.
- The entry now reads "… · brought back {when}". The record keeps both acts.
- TRANS sees no "Undo" on "Moved past a checkpoint", and the server
  refuses TRANS's undo ("may not emit v1.DepartureUndone"). Decided
  (2026-10-13, decisions.md 97): taking back an override needs Override
  checkpoints, as making one does. Undoing a set-aside does not.

### PASS-057 Not now at a checkpoint
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-CHECK. Tap "Something else?".

Expected:
- "Not now" is not offered at a checkpoint. The step sheet hides "Set aside"
  there, and only an override moves past one.
- Fixed (2026-10-12): "Something else?" offered "Not now" ("Set the
  consultant check aside. Say why") at a checkpoint (`elseChoices`,
  record.ts).

## Versions and history

### PASS-058 The Versions page, per role
Roles: TRANS, REV, COORD, VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-NEEDS. Tap "Versions and history".
2. Read the page. Tap Version 1.

Expected:
- The header is "Versions", with the sub "Luke 14:15-24" and ✕.
- TRANS, with no draft: no drafts section, and the footer "New version"
  (the line "No drafts. Edit a version below, or start a new one." went in
  decision 124).
- "Published" lists the versions newest first. The latest has the badge
  "Latest". Each shows "{name} · {when}", its length, and a summary of its
  reviews. Each has "Edit" for anyone who can record.
- The latest has "Ask for the {check}" when TRANS can ask for one. On
  P-NEEDS that is "Ask for the back translation": the Peer check waits on
  TRANS's answer, so it is not offered again.
- REV and VIEW: no "New version" and no "Edit".
- COORD: "New version" and "Edit".
- Tapping a version opens it (PASS-064). "Edit" opens the workspace started
  from that version (06 REC).

### PASS-059 Several drafts of one passage
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- On P-DONE, TRANS has started two drafts. Use "New version" twice, record a
  part in each, and close with ✕ (06 REC). Do the same on an unstarted
  passage for step 5.

Steps:
1. Open P-DONE. Tap "Something else?", then "Continue recording".
2. Read the page.
3. Tap "Edit" on "Draft 2", then ✕.
4. On the unstarted passage with two drafts, tap the main button, then ✕,
   then the path's "Record" step.

Expected:
- With several drafts, "Continue recording" opens the Versions page to pick
  one, not the workspace. That is the main button where Record is lit, the
  "Record" step, and the "Something else?" option on a finished passage
  (P-DONE).
- The page shows "Your drafts", with "Draft 1" and "Draft 2" in the order
  started. Each has a play button, "{n} parts · {m:ss} · from Version {n}"
  (or without "from"), "Saved {when}", "Edit", "Publish" and a trash
  button.
- "Publish" is disabled on a draft whose parts are the same as the latest
  version.
- "Edit" opens the workspace on that draft, named "Draft 2".
- Fixed (2026-10-12): the path's "Record" step skipped the picker and opened
  the workspace on the latest draft (`passage.tsx` `onStep`). (On P-DONE the
  done "Record" step opens the version, as it should.)

Resets: delete the unstarted passage's drafts.

### PASS-060 Delete a draft, asked first
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. On P-DONE's Versions page (PASS-059), tap the trash on "Draft 1".
2. Tap "Cancel".
3. Tap the trash again, then "Delete Draft 1" in the sheet.

Expected:
- The trash is spoken "Delete Draft 1". Tapping it opens the sheet
  "Delete Draft 1?" with what it holds, "Delete Draft 1" and "Cancel".
- "Cancel" keeps both drafts.
- Step 3 shows "Draft 1 deleted." with no Undo, and the draft goes away.
  "Draft 2" is now the only draft, named "Draft".
- Only TRANS's own drafts have a trash button.

Changed (2026-10-16, decision 124): a whole draft, a whole version or every
part asks first instead of offering Undo.

Resets: delete both drafts.

### PASS-061 Reviews by version
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. On P-NEEDS's Versions page (two versions), expand "Reviews by version".
2. Tap a version label, then a cell.

Expected:
- The summary reads "{n} reviews across 2 versions" (or "No reviews yet · {n}
  versions").
- A grid has rows "v2" and "v1" with when, and a column per kind.
- A cell shows the latest review's mark ("Looks good", "Needs changes" or
  "Feedback answered"), with a count badge when there are several. It is
  spoken "{check} from {who}" ("Peer check from {REV}") or "{check} from
  {who} (latest of {n})".
- In the newest row, kinds set aside or asked show their mark.
- The legend lists "Looks good", "Needs changes", "Feedback answered",
  "Asked", "Set aside" and "{check} recorded" ("Back translation recorded").
- A version opens its page. A cell opens that review.

### PASS-062 History
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-ASIDE's Versions page and expand "History".
2. Tap a version entry, then a review entry.

Expected:
- The summary reads "{n} entries since {when}" (or "{n} entries · just
  now"). 20 entries show, then "Show 20 more · {left} left".
- The entries include "Version 1 published", "Asked {who} for {kind}" (with
  open, due, done or withdrawn), "{Kind} · looks good" and "Community Check
  set aside".
- Each sub reads "{who} · {when} — {detail}".
- A version entry opens the version. A review entry opens the review.
- History still names checks by the library's kind names ("Community Check",
  "Peer Review"), as does Already happened.
  Decision 91 makes "check" and `checkName` the one word on every screen, so
  these should become "Community check". Left for a change that also moves
  07 REV's screens (`passage/record.ts` `kindName`, `screens/review.tsx`).

### PASS-063 The study, from Versions
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-SUBMITTED's Versions page.
2. Expand "{pattern} study". Tap a step row, then go back and tap "Open the
   study".

Expected:
- The disclosure's summary is the study's progress, or "Not started".
- A step row opens that study step. "Open the study" opens the study guide
  (08 STUDY).
- Passages with no study guide show no study disclosure.

## The version and review pages

### PASS-064 A version
Roles: TRANS, TREV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-NEEDS (Version 2, after PASS-019). Tap "Record" on the path.
2. Read the page. Tap "Reviews of this version", then "Key terms".
3. Tap the passage name in the crumbs (wide), or Back (phone).

Expected:
- The title is "Version 2", with crumbs "Luke 14:15-24" › "Version 2" and the
  sub "{TRANS} · {when}". There is no tab bar on a phone.
- The card is labelled "What changed". It shows the change note, or "No note
  on what changed.", and "In response to the Peer check from {REV}". The
  link opens that review. On Version 1, the card is labelled "Note" and
  reads "First recording."
- "Recording": "Version 2" with "{n} parts · {m:ss}", then "Part {n}" rows
  and the sources-used line.
- "Details": "Key terms" ("{n} terms tied · …"), "Reviews of this version"
  (or "No reviews of this version yet.") and "Notes".
- The crumb (wide windows; crumbs are not drawn on a phone) or Back returns
  to the record.
- The report flag: TREV sees it, TRANS (the author) does not (PASS-066).

### PASS-065 A review that is not yours to answer
Roles: COORD, VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-NEEDS's Versions page. Expand "Reviews by version" and tap the
   Peer check cell on v1.
2. Read the page.
3. Repeat on P-CHECK's Back translation (made by REV).

Expected:
- The title is "Peer check" (decision 91), with crumbs and the sub {when}.
- The outcome band reads "Needs changes", with "{REV} · in the app".
- Badges show the place and "Asked by {name}" where known. "Reviewed
  Version 1" opens Version 1.
- The "Feedback" card holds the voice note and "Verse 18 is too fast".
  "Answers to the questions" shows "{n} answers · {n} left unanswered",
  each with its source, when there are any.
- After PASS-019, the response card reads "{TRANS} revised it", with "Open
  Version 2".
- There is no "Record a fix" or "Keep it, say why" for COORD or VIEW.
- For the Back translation: "New content made from the version, not a
  verdict on it. The Consultant check compares it with the source.", a player, "Made
  from Version 1", and "Note from the back translator".

### PASS-066 Report flags on other people's work only
Roles: TRANS, REV, VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. TRANS: open P-NEEDS's Version 1, then REV's review of it.
2. REV: open the same two pages.
3. TRANS: open History on P-SUBMITTED and find a note by someone else.
4. Tap a flag.

Expected:
- TRANS sees no flag on Version 1 (TRANS's own), and a flag on REV's review.
- REV sees a flag on Version 1, and none on REV's own review.
- Notes by others in History carry a flag. TRANS's own notes do not.
- A request row with directions, by someone else, carries a flag.
- The flag opens "Report or block", with "Report this version" (or review,
  note, request), "Report {name}" and "Block {name}" (13 MOD).
- VIEW sees the flags too. "Remove from the record" shows only for
  moderators (ADMIN, COORD, LADMIN).

### PASS-067 A passage that is missing or still loading
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Steps:
1. Fresh install. Sign in and open a passage from "Opened lately" before
   Alpha has finished loading (slow network, 12 SYNC).
2. Open a passage of another language from the Inbox while Alpha is open.

Expected:
- While the language loads: "Loading the language…".
- "This passage isn't in this language." shows only when it truly is not.
  It may flash while another language's stream opens. Note any flash longer
  than a second.

## Working offline on the record

### PASS-068 Asking, setting aside and noting offline
Roles: TRANS · Priority: P1 · Platforms: iOS, Android · Run: Auto

Steps:
1. Turn the network off. My Work's chip reads "Offline".
2. Open P-SUBMITTED. Set Back Translation aside with a reason.
3. Add a note.
4. Ask TREV for something on another passage.
5. Read My Work's chip. Turn the network on and wait 30 seconds.

Expected:
- Each act shows its usual toast at once, with Undo where it is offered.
  None of them waits for the network.
- The record shows each change straight away.
- My Work's chip reads "{n} to send" while offline.
- Online, the chip goes away. A second device sees every change (G10.3,
  G10.4).
- "refused by the server" stays 0 (G10.2).

Resets: undo the set aside, and withdraw the request.
