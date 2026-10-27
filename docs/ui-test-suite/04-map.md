# 04 The Map (`MAP`)

All languages ("Progress"), a language's map, a book's chapters, search,
the filter and its key, and the marks for passages kept on this device.

Read with the [README](README.md): its global preconditions G1–G10, the
fixture world and the role matrix hold for every test here.

- `{TRANS}`, `{COORD}` and so on stand for that account's display name.
- "Alpha" is LANG-A, "Bravo" is LANG-B.
- Counts quoted "with the fixture" assume the passage states in the README
  and nothing else recorded in Luke.

With the fixture, Luke's chapters stand like this:

| Chapter | Passages (FIA) | Stage |
| --- | --- | --- |
| 13 | P-NEW, P-Q1..P-Q4 | not started |
| 14 | P-DRAFT, P-NEEDS, P-BT | started (drafting, feedback, in review) |
| 15 | P-CHECK, P-SUBMITTED | started (in review) |
| 16 | P-ASIDE, Luke 16:16-18 (if FIA splits it so), P-DONE | started |
| the rest | not started | not started |

No chapter is done in the fixture. MAP-020 makes one done first.

Sources: `src/screens/map.tsx` (`StatusHome`, `MapHome`, `BookMap`),
`src/simple/mapParts.tsx`, `src/canon.ts` (search and filters) and
`src/offline.tsx` (marks). Decisions 61, 71 and 74.

Layers (decision 102): which Map each role lands on (MAP-001, MAP-010), who
may "Break up differently" (MAP-024) and what a viewer cannot take
(MAP-035) are held by `apps/mobile/test/navMatrix.test.ts`, one `it` per
spec ID. The web tests prove a role or two reaches the glass; tests that
read a screen's contents run once per role.

## All languages

### MAP-001 All languages, per role
Roles: ADMIN, COORD, LADMIN, VIEW · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Tap "Map" (VIEW is already there).
2. Read the screen.
3. Tap "Alpha".

Expected:
- The header is "Progress", with the sub "UI Test Org · All languages" and
  no Back.
- The summary card shows "Across 2 languages · {n} passages" (or "1 of 2
  languages counted · …" until the server has Bravo's figures), "{%}
  recorded", "{%} done" and "{n} with reviewers".
- Under "Languages", Alpha's card reads "{n} passages · Standard Bible Flow",
  with a clock count of 2 (P-SUBMITTED and P-BT are with reviewers), a bar,
  and a legend: "Recorded", the four step names (a lock on "Consultant
  Check") and "Done".
- Bravo's card has a download icon and "Open it to bring it onto this
  device" (or "{n} passages · as of {ago}" when the server has figures).
- Tapping Alpha opens its map with a Back arrow to "Progress".
- On a desktop-wide window (Wide), Alpha's map opens beside the list, and
  Alpha's card is marked as the one open.
- LADMIN sees Alpha alone ("Across 1 language · …"): Progress lists only
  the languages a role of the person's covers (NAV-042).

### MAP-002 Finding a language among many
Roles: ADMIN · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- ORG has at least 6 languages (add four more in 09 SETUP), and at least 26
  for the paging step.

Steps:
1. Open "Progress". Type "alp" in "Find a language".
2. Type "zzz".
3. Clear the field and scroll to the end of the list.

Expected:
- "Find a language" shows only with more than 5 languages.
- "alp" leaves Alpha alone. The search matches the name or the 3-letter
  code (the automated test adds languages with codes q00, q01, … and finds
  one by its code).
- "zzz" shows "No language matches “zzz”."
- With more than 25 languages, the list ends with "Show {n} more · {left}
  left", {n} being at most 25: with 26, "Show 1 more · 1 left".

### MAP-003 No languages yet
Roles: NEW · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- NEW is the Organization Admin of "UI Empty Org", which has no language
  (NAV-021).

Steps:
1. Tap "Map".

Expected:
- "Progress" shows "No languages yet" with "Once a language is added, its
  progress shows here."
- No summary card and no footer text.

## A language's map

### MAP-010 The language map's header and Back, per role
Roles: TRANS, REV, TREV, KEPT, COORD · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. TRANS, REV, TREV, KEPT: tap "Map".
2. COORD: tap "Map", then "Alpha".
3. Read the header and the top of the screen.

Expected:
- The title is "Alpha". Workers have no Back. COORD has Back, which returns
  to "Progress".
- On the right of the header is a quiet "Filter" link.
- Under the header is the search field "Find “John 3”", then "Next: {passage}"
  (MAP-013), then the book list.
- No language chips show (each of these roles opens one language here).
- Luke's row shows the book's name, a bar (done in green, recorded in the
  brand colour) and "6/{n}". Its spoken label is "Luke. 6 of {n} recorded, 1
  done." with "{n} for you" and "1 with feedback" where they apply.
- A book with nothing recorded shows no count. Its spoken label says "Not
  started".

### MAP-011 Finding a passage by search
Roles: TRANS, VIEW · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. On Alpha's map, type "Luke 15" in "Find “John 3”".
2. Read the results.
3. Tap "Luke 15:11-32".

Expected:
- While typing, the Next link, the pills, the filter chip and the book list
  are replaced by the results.
- The header line reads "2 passages". The rows are Luke 15:1-10 (P-CHECK)
  and Luke 15:11-32 (P-SUBMITTED), each with its summary, its disc ("2/4"
  style for checks cleared) and step marks.
- Tapping a row opens that passage's record. Back returns to the map with
  the search still typed.
- "luk 15" and "luke 15:3" find the same passages: a book's name is matched
  from its start, and the search works by chapter (a verse narrows nothing).
  Abbreviations that are not the start of the name ("lk") find nothing.

### MAP-012 Searching by book, and no match
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Type "luk".
2. Type "zzz".
3. Type "ruth 1:1".
4. Clear the field.

Expected:
- "luk" shows "1 book · add a chapter number to jump straight to it", and
  Luke's row. Tapping it opens Luke's chapters.
- "zzz" shows "No book by that name in this language".
- "ruth 1:1" shows "No passage matches — try a book name, then a chapter"
  (Alpha's template covers the New Testament only; 1 Corinthians is in it).
- Clearing the field brings back the Next link and the book list.

### MAP-013 Next on the map
Roles: TRANS, REV, TREV, ADMIN, VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open Alpha's map.
2. Read the link above the books.
3. Tap it.

Expected:
- TRANS: "Next: {passage}" with a mic disc, the same passage as My Work's
  Next for you.
- REV: "Next: Luke 15:11-32" or "Next: Luke 14:25-35", with a check or globe
  disc, the same as My Work's Next for you.
- TREV and ADMIN: the first passage nobody has recorded, with a mic.
- VIEW: no Next link.
- Tapping it opens that passage's record.

### MAP-014 Testament pills
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Step 1 is automated; step 2 waits for a way to list an Old Testament book
in Alpha from the test (09 SETUP's book choice).

Preconditions (in addition to the global ones):
- For step 2, an Old Testament book (Ruth) is listed in Alpha, divided or
  waiting (09 SETUP).

Steps:
1. With the fixture, open Alpha's map.
2. With Ruth listed, open it again. Tap "Old Testament", then "New
   Testament".

Expected:
- With only New Testament books, there are no pills.
- With both, the pills "New Testament" and "Old Testament" show, with New
  Testament chosen first.
- Each pill shows only its testament's books.

### MAP-015 The filter, one tap deeper
Roles: TRANS, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. On Alpha's map, tap "Filter".
2. Read the sheet.
3. Tap "Feedback waiting".
4. Read the map, then tap Luke.
5. Back on the map, tap ✕ on the filter chip.

Expected:
- The sheet is titled "Filter", with the sub "Show only the passages that
  match".
- Its lines are "{recorded} of {total} recorded · {done} done · {waiting}
  with reviewers" and "FIA passages (English) · Standard Bible Flow".
- The chips, with the fixture's counts: "All", "Feedback waiting · 1" (with
  a chat icon), "With reviewers · 2", "In review · 5", "Done · 1", "Not
  recorded · {n}". A chip with a count of 0 is not shown.
- Picking a chip closes the sheet.
- The map shows the chip "Feedback waiting" with its count, spoken as
  "Filter: Feedback waiting. Change it", and a ✕ spoken as "Clear filter".
  Only books with a match show. Luke's count reads "1", and its spoken
  label says "1 with feedback" once.
- Fixed (2026-10-12): with the feedback filter set, Luke's spoken label said
  "1 with feedback" twice (`map.tsx` `BookRow`).
- Luke's passages open with the filter set: only the passages that match
  are listed (P-NEEDS, not P-NEW).
- ✕ clears the filter and every book shows again.
- A filter with no match anywhere shows "Nothing here matches this filter."

## A book's passages and chapters

### MAP-020 A book divided into passages lists them, each with its download button
Roles: TRANS, VIEW · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Luke 3's passages are done. If the fixture has none, take every passage of
  one short chapter through all four steps (JRN-09). The automated test
  finishes Luke 3 (three passages) through the server.

Steps:
1. On Alpha's map, tap "Luke".
2. Read the header, the line under it and the list.

Expected:
- The header is "Luke", with the sub "{recorded} of {n} passages" ("9 of 97
  passages" once Luke 3 is done), and Back. On a wide window, crumbs "Alpha"
  › "Luke" show above the title (the kit draws crumbs only there).
- The fixture's template divides Luke into FIA's passages, which can run
  across chapters, so Luke lists its 97 passages as rows, not chapter tiles
  (decision 166). A passage across two chapters (Luke 7:36–8:3) is one row.
- The line over the list reads "{ready} of 97 passages ready on this
  device", with the green download mark.
- Each row has the passage's disc (dashed mic, steps, ✓ when done), its
  title and where it stands, and its download button at the end: an outline
  ("Download for offline"), an arrow wave while it downloads ("Downloading
  for offline · {here} of {total}"), green when it is here ("On this
  device").
- A book whose passages are its chapters one each still shows chapter tiles,
  four across on a phone, each with its download button.

### MAP-021 A book of passages: the filters one tap deeper, and each row says where it stands
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. On Luke's passages, tap "Filter".
2. Read the sheet, then close it.
3. With a screen reader on, move to P-NEEDS, P-NEW and P-DRAFT.

Expected:
- The sheet has the filters, and no "Key" (the key is the chapter tiles').
- Each row's spoken label says where it stands: P-NEEDS "Feedback for you to
  answer. For you", P-NEW "… For you", P-DRAFT "Recording in progress".

### MAP-022 A passage opens from its row, and Back comes to the book
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. On Luke's passages, find Luke 14's.
2. Tap P-NEEDS, then Back.

Expected:
- P-BT shows "{cleared}/{steps}" ("0/4": its Back Translation is still
  asked).
- Tapping a row opens its record; Back comes to Luke's passages.

### MAP-023 A book not broken up yet
Roles: ADMIN, COORD, LADMIN, TRANS, REV, VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- A book of Alpha (for example Jude) is listed but not yet broken up (09
  SETUP). It shows on the map as "Waiting to be broken up" in amber. The
  automated test leaves Jude so by hiding its passages.

Steps:
1. Open Alpha's map. Find the book's row.
2. Tap it.

Expected:
- On the map, the row has no bar. It shows "Waiting to be broken up" in
  amber, and stays shown even while a filter is set.
- The book's header sub reads "Waiting to be broken up".
- The empty state reads "Jude isn't broken up yet".
- ADMIN and COORD read "Choose how Jude is cut into pieces, by chapter,
  FIA's passages or another way. Then it can be recorded." They also get the
  footer button "Break up Jude", which opens book structure at "How should
  Jude be broken up?" (09 SETUP).
- LADMIN, TRANS, REV and VIEW read "A coordinator decides how Jude is cut
  into pieces. Then you can record it." They get no button. Breaking a book
  up publishes the template in the organization's library, which needs the
  privilege at organization scope (decision 74, README role matrix "Library
  writes"; book structure's `canBreak`).
- Fixed (2026-10-12): LADMIN was offered "Break up Jude", which opened book
  structure read-only ("A coordinator breaks up Jude before anyone records
  it.").

### MAP-024 Edit passages ("Break up differently") only for those who shape templates
Roles: ADMIN, COORD, LADMIN, TRANS, TREV, VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open Luke's chapters.
2. Read the quiet links under the grid.

Expected:
- ADMIN, COORD and LADMIN see "Filter" and "Break up differently". The
  second opens book structure for Luke, and its Back returns to the
  chapters.
- TRANS, TREV and VIEW see only "Filter".
- The screen-path doc calls this link "Edit passages". The app's words are
  "Break up differently".

### MAP-025 Passages outside any book ("Other")
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Not automated yet: it needs a passage outside the Bible's books, added in
the template editor (09 SETUP).

Preconditions (in addition to the global ones):
- Alpha has at least one passage outside the Bible's books (for example a
  story added in the template editor, 09 SETUP).

Steps:
1. Open Alpha's map and scroll past the books.
2. Tap the row under "Other".

Expected:
- A section "Other" holds one row, named "Other", with its bar and count.
- It opens a flat list of passages, not a chapter grid. The list honours the
  filter, and shows 25 at a time with "Show 25 more · {left} left".

## Scale, offline and other languages

### MAP-030 A whole Bible's worth of passages
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions (in addition to the global ones):
- A language whose template divides every book of the Bible. Use a sample
  language made by `npm run sample:org`, with TRANS added as its Translator.

Steps:
1. Open its map. Scroll the New Testament, then switch to "Old Testament".
2. Open Psalms. Scroll to chapter 150.
3. Search "john 3", then "ps".

Expected:
- The map lists books per testament. It never renders every passage at
  once.
- Opening the map and switching testaments each take under a second on the
  low-end Android emulator.
- Psalms shows 150 tiles, in rows of 5, without lag while scrolling.
- Any list longer than 25 (passage search results, "Other", outline
  sections) shows 25, then "Show 25 more · {left} left".
- "ps" lists the matching books ("Psalms" among them) as book rows, not
  passages.

### MAP-031 Download buttons for passages kept on this device
Roles: TRANS, VIEW · Priority: P1 · Platforms: iOS, Android · Run: Auto

Steps:
1. TRANS: wait until Sync shows nothing left to download. Open Luke's
   passages.
2. Read Luke 13's rows and their spoken labels.
3. VIEW: open Luke's passages, then P-DONE, and tap its line "Download for
   offline". Go back to the list.

Expected:
- TRANS's five requests in Luke 13 are kept (asked of them): their download
  buttons are green once every file is here, an arrow wave while they
  download. Their spoken labels end "On this device" or "Downloading for
  offline". Others end "Audio not kept on this device", with an outline
  button.
- VIEW at first: P-DONE's row says "Audio not kept on this device".
- After "Download for offline": the toast "Kept on this device. It downloads
  while you are connected.", the line turns green "On this device" once the
  audio is in, and the row's button is green.
- Web: the web app keeps nothing offline (decision 58), though it shows the
  buttons.

### MAP-032 Bravo, a language that is not ready
Roles: COORD, ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. On "Progress", tap "Bravo".
2. Wait for it to load.
3. Read the screen. Tap Back.

Expected:
- "Loading…" shows while Bravo's stream comes down. Alpha's books never show
  under Bravo's name.
- Bravo's map reads "No passages yet" with "Once Bravo has passages to
  record, they show here by book and chapter."
- There is no "Filter" link and no search.
- Back returns to "Progress". Bravo's card now shows its figures, as it is
  open on this device.
- My Work now leads with "Get Bravo ready" (NAV-018).

### MAP-033 Opening a language that is not on this device, offline
Roles: COORD · Priority: P2 · Platforms: iOS, Android · Run: Auto

Preconditions (in addition to the global ones):
- Fresh install, signed in, with Alpha open. Bravo has never been opened on
  this device.

Steps:
1. Turn the network off.
2. On "Progress", tap "Bravo".
3. Wait 30 seconds, then turn the network on.

Expected:
- Offline, the app does not crash and never shows Alpha's content under
  Bravo's name.
- It shows "Bravo isn't on this device yet" with "Connect to the internet
  to bring it here. It opens on its own once you're connected."
- Once online, Bravo loads without leaving the screen ("No passages yet").
- Fixed (2026-10-12): nothing on the map said that the language needs a
  connection to come onto this device; it showed Bravo's empty map. The map
  now says so while the language has not been read from the server and the
  server cannot be reached (`simple/mapModel.ts` `needsConnection`).

### MAP-034 Switching language from the map
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- TRANS also holds Translator at Bravo's scope, and Bravo has a template
  (09 SETUP and 10 PEOPLE). The automated test gives TRANS the role by
  invite and leaves Bravo without a template, so Bravo's map is empty.

Steps:
1. Tap "Map".
2. Read the chips under the header. Tap "Bravo".
3. Tap "Work".

Expected:
- Chips "Alpha" and "Bravo" show, with Alpha on. Chips show only on the Map
  tab's own map, when the person can open more than one language.
- Tapping "Bravo" switches the map in place. The search clears.
- My Work's sub now reads "Bravo · UI Test Org".

### MAP-035 The viewer's map is read-only
Roles: VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. On "Progress", tap "Alpha", then "Luke", then chapter 15, then
   "Luke 15:11-32".
2. Tap each "Then the team" row on the record.
3. Tap "Something else?".

Expected:
- The map has no Next link. The chapter grid has no "Break up differently".
- The record has no main button. Its footer holds only "Something else?" and
  "Versions and history".
- Team rows are not tappable: tapping one opens nothing.
- "Something else?" offers only "What helps here" and the offline card, with
  no "Say it instead" footer (PASS-009).
