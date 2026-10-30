# 09 Language setup (`SETUP`)

Setting a language up and keeping it set up: the organization's home, a
language's page, New language, Get ready, content templates and dividing
books, a language's checks and the review flows, reference material, the
guide editor, the licence, and renaming. People, invites and roles are in
[10-people-and-roles.md](10-people-and-roles.md).

Read with: decisions 36 (the library), 38 (the licence only opens), 62 and
84 (reference material and its language), 71 and its amendments (Get ready,
four questions, one screen each), 74 and 80 (dividing books, numbering
first), 76 (repeated names), 78 (the language list), 138 (a language's
page: one name for each thing, no More).

**Notes for this file**
- The fixture's names: ORG is "UI Test Org {run}" (written "UI Test Org"
  below), LANG-A is "Alpha" (code ALP, not linked), LANG-B is "Bravo" (BRA).
- The local server has no Bible in its library (no `source@1` is seeded)
  and its language list (languoids) returns nothing. Tests that need either
  say so, run as far as they can, and are completed on the preview
  environment.
- The organization offers FIA's English guides to every language, so a new
  language starts with "What will help them?" answered ("1 of 4").
- Org home is reached from the Manage tab (ADMIN, COORD). LANG-A's page is
  the Manage tab's root for LADMIN, and for others it is reached from Org
  home → Languages → "Alpha". LADMIN reaches Org home from "UI Test Org"
  above Alpha's title, where Back would be (`header-up`, decision 138).
- New language opens on its **six** steps (decision 146), then shows them
  as a bar on every page ("n of 6 · name"): the language, its content, how
  it is split into pieces, its reference material (its languages, then
  what the team will have), its review flow (a flow to start from, then
  its checks on their own pages), and people (the invite, after the
  language is made).
- A language is **ready** when it has a template, a review flow, and either
  someone given a role that translates at that language or an invite issued
  for it. "What will help them" is asked but never required. Organization-
  scope translators do not count (decision 71, amended 2026-10-08).
- **LADMIN and organization-level writes.** Library writes (publishing a
  template or flow version, dividing a book, sharing, archiving, follow,
  copy) and organization recommendations are organization-stream events
  that need organization scope (`languageOfOrgEvent` in core `org.ts`, SQL
  `may_emit`). LADMIN holds the privileges only at LANG-A, so the screens
  do not offer them (library/model.ts `mayWriteLibrary`); LADMIN still
  chooses Alpha's own template, checks and offers. SETUP-062 to SETUP-065.

**Resets.** Tests marked "Resets" change shared state: most put it back,
and those that add languages, templates, flows or material leave them. Run
this file after files 03–08 and 16 have read the fixture, or on a fresh
fixture. SETUP-022 makes LANG-B ready, so run SETUP-004 and SETUP-023
before it. SETUP-060 can never be reversed (the licence only opens): run
it last, and reload the fixture before the next run.

---

## Organization home

### SETUP-001 Org home shows the organization, its languages and its setup
Roles: ADMIN, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Tap the Manage tab.
2. Read the top card.
3. Read the Languages section.
4. Tap "Setup" to open it.
5. Tap the row "Alpha".

Expected:
- After step 1 the header is "UI Test Org".
- The top card says "2 languages · {n} members", where {n} is the number of
  people holding a role in ORG.
- The main button "Invite people" shows. (An organization with no language yet has "Add a language" as its main button instead, and "Invite people" as a row under People: UI audit, finding 50.)
- Languages lists "Alpha" and "Bravo". Alpha's sub-line reads
  "Standard Bible Flow · {recorded} of {total} recorded · {done} done", or,
  before Alpha is on this device, "Open it to bring it onto this device".
- The add row "New language" shows.
- People shows "Members" with the sub "3 in every language · {total} in all".
- "Setup" lists "Content templates", "Reference material", "Review flows",
  "Roles" (sub "{n} roles"). On Org home the first
  three say what the organization's library holds ("{n} in the library"),
  never one language's choice (UI audit, finding 51); on a language's page
  they say what it uses ("FIA passages applied", "1 study guide · 2
  question sets · 40 key words"). The name and licence
  are not in Setup: the card at the top has a pencil beside the name and the
  licence ("All rights reserved") under it (decision 138).
- Step 5 opens Alpha's page ("Content template" is its first row), with a
  Back button.

### SETUP-002 Only an organization admin renames the organization and changes its licence
Roles: COORD, LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- LADMIN reaches Org home from Alpha's page: "UI Test Org" above the title,
  where Back would be (decision 138).

Steps:
1. Open Org home. Look beside the name in the top card.
2. Tap the licence under the name.

Expected:
- There is no pencil beside "UI Test Org" (renaming needs Manage roles at
  organization scope).
- The licence sheet "Who may use your work" opens in view mode with
  "Only an organization admin can change this." and no "Open to …" button.
- For LADMIN, "New language" is not offered on Org home (it needs Manage
  structure for the whole organization).
- For LADMIN, "Invite people" opens "Invite someone" with no "All of them"
  choice (see PEOPLE-033).

### SETUP-003 Rename the organization
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: renames ORG and puts the name back.

Steps:
1. Open Org home → the pencil beside the name in the top card.
2. Clear "Its name". Check the button.
3. Type "UI Test Org Renamed". Tap "Save the name".
4. On a second device signed in as TRANS, tap Sync now and open Me.
5. Rename it back to "UI Test Org".

Expected:
- The sheet is "Rename the organization" with "Its members see the new
  name, and so does anyone asking to join it."
- "Save the name" is disabled while the field is empty or unchanged.
- Toast "Renamed to UI Test Org Renamed." with no Undo.
- The header of Org home shows the new name at once.
- The second device shows the new name after sync.

---

## A language's page

### SETUP-004 A language that is not ready shows the Get ready checklist
Roles: ADMIN, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- LANG-B has nothing chosen (fixture state).

Steps:
1. From Org home, tap "Bravo".
2. Read the checklist.
3. Turn help mode on with the ? in the header, then off.
4. Tap the second question.

Expected:
- The big title is "Get Bravo ready", with "Bravo" above it.
- Four rows in order: "What will they record?", "What will help them?",
  "Who checks the recordings?", "Invite your translators". The first is
  current, the rest later.
- The main button is "What will they record?".
- The quiet link "How this works · 0:40" shows; tapping it turns help on
  and says how the four questions fit together (decision 71, amended
  2026-10-10).
- Under the checklist the page shows "See their work" and "Roles", then
  "Languages" and "Show on the public list". There is no "More" (decision
  138).
- Step 4 opens Get ready at that question (header "Get Bravo ready",
  sub "2 of 4").

### SETUP-005 A ready language shows its summary and "See their work"
Roles: ADMIN, COORD, LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Open Alpha's page (LADMIN: the Manage tab).
2. Read the rows.
3. Tap "Review flow", then "Edit". Go back twice.
4. Tap "Content template". Read it. Tap "Which books". Go back twice.
5. Tap "See their work".

Expected:
- The title is "Alpha" with the green status "Ready · 3 translators"
  (TRANS, TREV and KEPT; people who also assign work are not counted).
- LADMIN sees no Back button: the page is the Manage tab's root, and
  "UI Test Org" sits where Back would be (decision 138).
- Rows: "Content template", "Reference material", "Review flow" with the
  order ("Peer check + back translation → Community check → Consultant
  check → Final approval"), "People" with "3 translators · invite more",
  and "Roles" (decision 138).
- "Review flow" → "Edit" opens "Checks" with the sub "Alpha": "A translator
  records a version", the checks in order, "Add a check" (decision 91).
  Its Review flow page ends with "All review flows".
- "Content template" shows "FIA passages (English)" with "Each book's
  passages" and "Which books", and ends with "All content templates".
- "Which books" opens "What to translate" with "What will Alpha
  translate?" (Get ready, question 1 only).
- "See their work" opens Alpha's map.

### SETUP-006 A ready language's page holds its settings, with no More
Roles: ADMIN, LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Open Alpha's page (LADMIN: the Manage tab). Read the rows and the top.
2. Tap "Roles". Go back.
3. Tap "Content template" → "All content templates". Go back twice.
4. Tap "Reference material" → "All reference material". Go back twice.
5. Tap "Review flow" → "All review flows". Go back twice.
6. Tap "Languages". Tap "They understand". Go back.

Expected:
- Seven rows, in three groups (decision 138): "Content template",
  "Reference material", "Review flow"; "People", "Roles" ("{n} roles");
  "Languages" and "Show on the public list".
- There is no "More", and none of "Members", "Every way to divide the
  work", "Bibles, guides and notes", "Every way to check", "In the
  language list" or "The organization's page". There is no "Review groups"
  row: a check's people are on the check (decision 91).
- A pencil beside the title renames it (SETUP-007). Under the title a chip
  shows its clusters; for ADMIN it reads "Cluster" while it is in none.
- "Roles" opens Roles at "Organization" for ADMIN and at "Language" (view
  only) for LADMIN.
- Each pick ends with the organization's whole shelf: "All content
  templates" opens "Content templates" (with "By language"); "All reference
  material" opens "Reference material" with "What translators are offered";
  "All review flows" opens "Review flows" with "Alpha uses".
- "Languages" opens a sheet with "They translate into" and "They
  understand". "They understand" opens "Which languages should Alpha's
  Bibles and study guides be in?".

### SETUP-007 Rename a language, warned about a repeated name
Roles: ADMIN, LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: renames LANG-A and puts it back.

Steps:
1. Open Alpha's page → the pencil beside its title.
2. Type "Bravo". Read the sheet.
3. Change it to "Alpha Renamed". Tap "Save the name".
4. Rename it back to "Alpha".

Expected:
- The sheet is "Rename Alpha" with "Everyone in UI Test Org sees the new
  name. Its code, {LANG-A code}, stays."
- At step 2 a warning shows: "That name is taken here" with "Bravo ({LANG-B
  code}) already has this name. Two languages with one name are hard to
  tell apart." "Save the name" stays enabled (decision 76: it warns, never
  blocks).
- Toast "Renamed to Alpha Renamed."
- The new name shows on Org home, the map and the Map tab's list.
- LADMIN may rename Alpha (Manage structure at its own language).

### SETUP-008 Link a language to the language list
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- LANG-B is unlinked (fixture state).
- Resets: links LANG-B.

Steps:
1. Open Bravo's page. Tap "Languages". Read "They translate into".
2. Tap it. Type "bra" in "Its name or code".
3. Tap a result. Tap "Link it".
4. Read the row again.

Expected:
- Before: the "Languages" row has an amber "Link it" badge (decision 138).
  In its sheet, "They translate into" reads "Not linked yet: added
  offline, or not found there".
- The sheet title is "Link Bravo", with "Find it by any of its names or its
  code. It keeps the name Bravo here, and takes the list's code."
- Results show under "Is it one of these?"; with nothing found, "Nothing in
  the language list goes by that name."
- Toast "Bravo is linked to {picked name}."
- After: "They translate into" reads "Linked to {picked name} · {CODE}".
  The language keeps the name "Bravo".
- Offline, the search says "Connect to the internet to search it."
- Locally the language list returns nothing, so the test checks the sheet
  and that "Link it" stays disabled; picking an entry runs on preview.

### SETUP-009 Show a language on the public list
Roles: ADMIN, LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Alpha is listed publicly (fixture state).
- Resets: turns the listing off and on again.

Steps:
1. Open Alpha's page. Read "Show on the public list".
2. Turn it off.
3. Signed out on a second device, open Look around first and search
   "Alpha".
4. Turn it back on. Repeat step 3.
5. Turn the network off and flip the switch.

Expected:
- The switch is on. It is a row on the page, with no sub-line (decision
  138).
- There is no toast after flipping it.
- Off: Alpha is not on the public list (`public_languages`, what Explore
  reads, at once). On: the listing is on again (Explore shows it after the
  next projection pass).
- Offline: banner "Could not read or change the listing" with "Try again
  when connected."; the switch keeps its last known state.

---

## New language

### SETUP-010 Create a language end to end
Roles: ADMIN · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Online. The library is seeded (G2).
- Resets: adds a language "Charlie {run}".

Steps:
1. Open Org home and tap "New language or cluster". Read the six steps,
   then tap "Start". Leave "One language" chosen under "What are you
   adding?".
2. Type "Charlie {run}" in "Its name". Do not pick a list entry. Type
   "chr" in "Its code, if it has one". Tap "Continue". Under "Which
   languages do Charlie {run}'s translators use?" leave "English" ticked.
   Tap "Continue".
3. Tap "The Bible". Choose the numbering: type "World English" under "Which
   Bible do you translate from?" and pick it. Pick "FIA passages" (LangQuest's, "Comes with FIA
   study guides"; not "FIA passages (English)", Alpha's) under "How
   should the Bible be divided?". Leave "New Testament" chosen. Tap
   "Continue".
4. Under "What will help Charlie {run}'s team?" leave what is ticked. Tap
   "Continue".
5. Leave the first card ("Standard Bible Flow", "Suggested · from
   LangQuest") chosen under "How will recordings get checked?". Tap
   "Continue". On "Charlie {run}'s checks" tap "Add Charlie {run}".
6. Wait until "Time to invite people" shows.
7. With "Translators" picked, tap "What they may do". Under "Which checks
   will they do?" tick "Peer check". Tap "Done".
8. Open Org home.

Expected:
- New language opens on its six steps (decision 146): "6 steps", then
  Language, Content, Divide into sections, Reference material, Review flow and
  People, each with a small picture, and "Start".
- Every step after that has the six as a bar under the header, done ones
  ticked, its own lit and named: "1 of 6 · Language" … "6 of 6 · People".
- Reference material comes before the review flow. "What will help Charlie
  {run}'s team?" ticks FIA's study guides in English (and a Bible when the
  library has one).
- "Charlie {run}'s checks" lists Standard Bible Flow's checks under "A
  translator records a version", each opening its own page; the main
  button is "Add Charlie {run}".
- While it is made, see SETUP-016 for the progress screen.
- Toast "Charlie {run} added to UI Test Org."
- "Time to invite people" is one page (LAN-195): a tile per role
  ("Translators", "Checkers", "Back-translators", "Team leads") as radio
  buttons with "Translators" picked, "What they may do" (open: the picked
  role's switches that are on, and "Only in Charlie {run}"), its checks to
  tick, and its code under them; "Done" at the foot.
- After step 7, "Translators" with a "Peer check" tag, "Ask them to scan
  this", a QR code and "Share as a link" show once the server has made the
  code.
- On Org home "Charlie {run}" is listed. Its page shows "Ready · 0
  translators" (it has a template, a flow and an invite).
- Its page → "Languages" says "Not linked yet: added offline, or not found
  there" (decisions 78 and 138).
- Its map ("See their work") lists New Testament books, with Luke divided
  into FIA passages.

### SETUP-011 Pick the language from the language list
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Online.
- Resets: adds a linked language.

Steps:
1. Org home → "New language".
2. Type "H". Then type "Hadiyya".
3. Tap the first result.
4. Tap "Change", then pick it again.
5. Finish the steps as in SETUP-010.
6. On its page → "Languages", read "They translate into".

Expected:
- With one letter typed nothing is searched. From two letters,
  "Searching the language list…" shows, then "Is it one of these?" and
  results.
- When many match: "These are the closest {n}. Type more of its name to
  narrow them."
- After picking: "In the language list", the entry, and "Change". The name
  field takes the entry's name. "Its code, if it has one" is hidden.
- When nothing fits: "Nothing in the language list goes by that name." and
  "Not there? Continue anyway. It is added unlinked, and you can link it
  from its page later."
- After creation "They translate into" says "Linked to {name} · {CODE}"
  (decision 78: linked in the same step).

### SETUP-012 Add a language offline, unlinked, and link it later
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- The library documents for the chosen template and flow are already on
  this device (open New language online once first).
- Resets: adds a language.

Steps:
1. Turn the network off. Org home → "New language".
2. Type "Delta {run}".
3. Finish the steps.
4. Turn the network on. Open its page → "Languages". Read "They translate
   into" and link it.

Expected:
- Step 2 shows the banner "Can't search the language list" with "You can
  still add it. It is added unlinked; link it from its page once you are
  online." and "Try again".
- Continue still works.
- If the template is not on the device: banner "Not added" with "Its
  template is not on this device yet. Try again when connected."
- Offline, the ways the organization already uses are offered (the open
  language's template is known on the device), so "FIA passages
  (English)" can be chosen and the language is added. Offers that need the
  server (following another organization's Bible or guides) are left for
  later: toast "{language} added to UI Test Org. Offer {offers} under What
  helps once you are online."
- Its "Languages" sheet says "Not linked yet: added offline, or not found
  there" (decision 138).
- Once online, linking works as in SETUP-008.

Fixed (2026-10-12): offline, New language offered only LangQuest's ways
(the organization's own followed way showed only when the server said a
language used it), and the language was "Not added" when an offer needed
the server. `breakup/useBreakup.ts` and `NewLanguage.create` (org.tsx).

### SETUP-013 A repeated language is warned about, not refused
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Org home → "New language".
2. Type "alpha" (lower case).
3. Change it to "Álpha!".
4. Clear it. Type "Echo" and, in "Its code, if it has one", type `alp`.
5. Tap "Continue".

Expected:
- Steps 2–4 each show the amber banner "UI Test Org may already have it"
  with "Alpha ({LANG-A code}) is already here. Adding it again makes a
  separate language, and its work stays apart from the first. Go back and
  open that one if it is the same."
- Case, accents, spaces and punctuation are set aside when comparing.
- "Continue" stays enabled and moves to step 2 (decision 76).

### SETUP-014 Choose which books a new language translates
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: adds a language.

Steps:
1. Org home → "New language". Name it "Foxtrot {run}". Continue.
2. Choose "The Bible", a numbering and a way.
3. Under "Which part of the Bible?" tap "Choose books". Tap each chosen
   book to clear it, so no book is chosen.
4. Continue through steps 3 and 4.
5. Go back to step 2 with "Back". Tap "Mark" and "Luke". Continue to the
   end.

Expected:
- The chips are "New Testament" (chosen first), "Old Testament", "Whole
  Bible" and "Choose books". "Choose books" shows one chip per book, with
  every book of the part picked before (the New Testament) already on, to
  change.
- The note "A coordinator can break up any book differently later, from
  the map." shows.
- At the end of step 4 with no book chosen: banner "Not added" with "Choose
  at least one book." Nothing is added.
- After step 5 the language is added and its map has only Mark and Luke.
- Updated (2026-10-13): main's "Ready-made choices come with your own,
  starting from the one picked" (4b9c582, design principle 12): Choose books
  used to start empty.

### SETUP-015 Numbering is chosen first, by Bible, by list or by questions
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None. (Leave New language with ✕ at the end; nothing is added.)

Steps:
1. Org home → "New language". Name it. Continue. Tap "The Bible".
   Continue past "Bibles number verses differently", then tap "Pick your
   Bible".
2. Type "zzzz" under "Which Bible do you translate from?".
3. Tap "Not listed? Answer a few questions". Answer: Psalm 23 "{book} 23",
   "The heading has no number", Malachi 4, Romans 16 ends with verse 27, no
   extra books, "Protestant or evangelical".
4. Tap "Choose another", then "Choose the numbering", and choose
   "Numbered like the Hebrew and Greek".
5. Tap the "How is material divided?" link and step through it.

Expected:
- Before any Bible, "Bibles number verses differently" shows Malachi 4:1 in
  an English Bible and Malachi 3:19 in a Hebrew Bible; then "Find your
  Bible's numbering" offers "Pick your Bible", "Take the quiz" and "Choose
  the numbering" (LAN-193).
- Step 2 says "Not found."
- The quiz asks one question at a time ("Question n") and ends on "Like
  {bible}" with "Verse numbers in LangQuest will match your Bible." and
  "Choose another".
- "Choose the numbering" lists the five numberings with facts per choice
  (books, Malachi's chapters, Psalm headings).
- The ways are offered only after a numbering is chosen (decision 80).
- Where FIA does not cover a book in scope: "FIA has no passages for {n}
  books ({books}). Those books:" with "by chapter" and "wait to be broken
  up".
- The walk-through "How material is broken up" has five steps and "Skip the
  walk-through".

### SETUP-016 Adding a language names each part as it starts, and ✕ says wait
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Network shaped like a phone link (12 Mbit/s down, 120 ms), so the parts
  can be seen.
- Resets: adds a language.

Steps:
1. Set up a new language "Golf {run}" as in SETUP-010, up to its checks
   (step 5).
2. Tap "Add Golf {run}".
3. While the bar moves, tap the header ✕.
4. Wait until it finishes.

Expected:
- The screen is "Setting up Golf {run}" with a moving bar and the parts in
  order: "Getting the passages", "Getting the review steps", "Getting
  {offers}" (only when something is offered), "Adding Golf {run} to UI Test
  Org", "Saving Golf {run}'s passages". Each is marked done, now or later
  as it goes.
- "Keep the app open until this is done." shows under them.
- Step 3 shows the toast "Still adding Golf {run}. Please wait." and the
  screen stays.
- There is no still "Saving…" button.
- It finishes within 15 seconds on this link (decision 71: 5 to 7 s
  measured).

### SETUP-017 "Make your own" opens the template editor from New language
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: adds an outline template.

Steps:
1. Org home → "New language". Name it. Continue.
2. Tap "Something else".
3. Tap "Make your own".
4. In the template editor, make an outline (see SETUP-041) named "Songs
   {run}". Tap "Create template".
5. Back on step 2, read the choices.

Expected:
- "Something else" has the sub "Stories, songs, lessons" and shows "Your
  organization's own" or "There are no ready-made ones for this yet. Make
  your own: folders for how it's organized, and the things people record
  inside them."
- "Make your own" ("Folders, and what to record in them.") opens the
  template editor ("New Template"); it does not say "That can't be opened
  from here." (decision 71, amended 2026-10-11).
- After saving, "Songs {run}" is offered under "Your organization's own".

### SETUP-018 A new language's checks are set up on their own pages before it exists
Roles: ADMIN · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: adds a language "Hotel {run}".

Steps:
1. Org home → "New language" → "Start". Name it "Hotel {run}". Finish the
   steps up to "How will recordings get checked?" as in SETUP-010.
2. Tap "Standard Bible Flow", then "Continue".
3. On "Hotel {run}'s checks" tap "Final approval" → "Remove this check",
   and confirm.
4. "Add a check" → "Retelling".
5. Tap "Community check" → "Same time as" → tick "Retelling" → "Done".
6. Tap "Bible" and switch "Text" off. Go back twice.
7. Tap "Add Hotel {run}". Tap "Done". Open its page.
8. Open "Who checks the recordings?" → "I'll choose the checks" → "Choose
   the checks".

Expected:
- The checks start from Standard Bible Flow's (decision 91), with no
  "Start from a ready-made flow" (the step before chose it).
- A check opens the same page a ready language's check has (decision 146):
  "People" ("Choose them as you invite"), "Questions", "On their screen",
  "Helps", "Must pass", "Same time as" (any other checks, ticked), "Remove
  this check". Removing asks first.
- After step 6 the Community check's card says "Bible text" by a struck eye.
- Its page's "Review flow" reads "Peer check + back translation → Community
  check + retelling → Consultant check", without Final approval. Nothing is
  added to the library: the checks are the language's own.
- Step 8: the Community check's card says "Bible text" by a struck eye.

### SETUP-019 The languages a new team's translators use, right after its name
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- The library is seeded (G2). (Leave with ✕ at the end.)

Steps:
1. Org home → "New language" → "Start". Type "Lima {run}" in "Its name"
   and tap "Continue".
2. Read "Which languages do …".
3. Tap "Another language" and search "French".
4. Tap "Continue". Choose the Bible and FIA passages as in SETUP-010.

Expected:
- Step 2 is still "1 of 6 · Language" (decision 193). The question is
  "Which languages do Lima {run}'s translators use?", with no sentence
  under it; as many languages as the team uses can be ticked (decision
  130).
- Each choice says what is in it, for example "FIA guides for {n} passages
  · {n} Bibles · {n} other guides or notes · Book names".
- The app's own language is marked as yours and chosen first when it has
  anything; otherwise English (decision 84).
- Step 4: "What will help Lima {run}'s team?" under the chip "Bibles and
  guides in English · Change", with FIA's study guides in English ticked
  (decision 146).

### SETUP-020 New language's invite step shows the translators' code at once
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: adds a language.

Steps:
1. Add a language "India {run}" (SETUP-010 steps 1–6).
2. On "Time to invite people", wait for "Share as a link", then tap "Done".
3. Open its page.

Expected:
- Step 2: "Translators" is picked and its code is made without another
  tap (LAN-195).
- The page shows "Ready · 0 translators" once the organization's stream
  has synced: an issued invite counts, as from Get ready's question 4.

### SETUP-021 Only organization-scope setters add languages
Roles: COORD, LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets (COORD): adds a language.

Steps:
1. COORD: Org home → "New language". Add "Juliet {run}" as in SETUP-010.
2. LADMIN: open Org home from Alpha's page: "UI Test Org" above the title,
   where Back would be (decision 138).

Expected:
- COORD can add a language end to end (Coordinator holds every privilege
  but Manage roles).
- LADMIN sees no "New language" row on Org home, and My Work never offers
  "Add a language".
- If LADMIN reaches New language by any route, the create step shows "Not
  added" with "Adding a language needs permission to manage templates and
  review flows for the whole organization."

---

### SETUP-074 A cluster of a new language and one already here, then ungrouped
Roles: ADMIN · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

A cluster is a name an organization puts on some of its languages
(decision 108, demo ADR-045). Nothing about a language changes with it.

Preconditions (in addition to the global ones):
- Online. The library is seeded (G2).
- Resets: adds a language "Kilo {run}" and a cluster "Cluster {run}", then
  ungroups the cluster, so Bravo ends as it began.

Steps:
1. Open Org home, tap "New language or cluster", then "Start".
2. Tap "A cluster of languages". Type "Cluster {run}" in "The cluster's
   name".
3. Type "Kilo {run}" in "Add a language" and tap "Add “Kilo {run}”" (the
   local language list finds nothing). Tap "Bravo" under "Already in UI
   Test Org". Tap "Continue", and "Continue" under the translators'
   languages.
4. Choose the Bible and FIA passages as in SETUP-010. Tap "Continue" under
   what will help, then under "How will recordings get checked?". Tap "Add
   Cluster {run}".
5. Wait for "Time to invite people" and tap "Done".
6. Open Org home. Open the "Cluster {run}" heading if it is closed (groups
   start closed past 20 languages), then tap it to fold it, then tap "⋯"
   ("Open Cluster {run}") on it.
7. Tap "Ungroup", then "Ungroup" in the sheet. Open Org home.

Expected:
- Step 1 asks "What are you adding?" with "One language" chosen and "A
  cluster of languages".
- After step 3: "Its languages · 2", and "Languages already here keep
  everything they have. The new one is set up in the next steps."
- Step 4 says "For the new language in Cluster {run}. It can change its own
  later."
- Toast "1 language added to UI Test Org, in Cluster {run}."
- Org home groups the languages under headings: "Cluster {run}" (amber,
  "2") over Bravo and Kilo {run}, then "Not in a cluster" over the rest;
  Bravo shows once. Tapping the heading folds its two languages away.
- The cluster's page: "Cluster · 2 languages", Bravo and Kilo {run} under
  "Its languages", and "Add a language to it".
- The sheet says "Its 2 languages stay, with their people, recordings and
  checks. Only the name that groups them goes." Toast "Cluster {run}
  ungrouped. Its languages are still here." Org home lists Bravo and Kilo
  {run} again, and no cluster.

## Get ready

### SETUP-022 Get a language ready, question by question
Roles: COORD · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- LANG-B has nothing chosen. COORD has Bravo open (Map → All languages →
  Bravo).
- Resets: LANG-B becomes ready.

Steps:
1. Open Bravo's page. Tap "What will they record?".
2. Tap "The Bible", then "Continue" on "Bibles number verses differently".
   Choose the numbering "Like most English Bibles" (used in Alpha), choose
   "FIA passages", leave "New Testament". Tap "Next".
3. On the language page of the Bibles and guides, leave "English". Tap
   "Next".
4. On "What will help them?", tick one Bible under "Bibles they
   understand". Tap "Next".
5. On "Who checks the recordings?", tap "Standard Bible Flow". Tap "Next".
6. On "Invite your translators", leave "Translate". Wait for the code. Tap
   "Done".
7. Read Bravo's page.

Expected:
- Each question is its own screen, headed "Get Bravo ready" with "1 of 4"
  … "4 of 4" and a ✕. From "2 of 4" on, and on every page after the first
  of a question, the footer has a quiet "Back" that goes one page or
  question back, on iPhone and the web too (UI audit, finding 48).
- No toast in Get ready has Undo: an answer is changed by answering again.
- After step 2: toast "Bravo translates {what}." (to change it later, open
  "Content template" → "Which books", SETUP-024).
- After step 3: toast "Bravo's Bibles and guides are now in English" (or
  no toast if English was already set). Going back to that page and
  choosing another language changes it; once Bravo is ready, a guide set's
  language is changed from "Reference material" (SETUP-026).
- After step 5: toast "{flow title} checks the recordings." Bravo had no
  checks, so nothing asks first. When a language changed its checks so no
  ready-made set has them, it asks "Replace {language}'s own checks with
  {flow title}?" with "Use {flow title}" and "Cancel" (as SETUP-044).
- The local library has no Bible to tick at step 4.
- Step 6 shows the chips "Translate", "Check", "Back-translate", "Help run
  the team", "Other roles · n"; "Making the code…", then "Ask them to scan
  this" and a QR, and the quiet link "Share as a link". The code is made as
  soon as the screen opens.
- Bravo's page now shows "Bravo" with the green status "Ready · 0
  translators" and the rows "Content template", "Reference material",
  "Review flow", "People" (decision 138).
- On TRANS's device after Sync now, nothing about Bravo changes (TRANS has
  no role there).

Changed (2026-10-16, decision 134): no toast offers Undo; each answer is changed by answering it again, and replacing a language's own checks asks first.

### SETUP-023 My Work leads with "Get ‹language› ready · n of 4"
Roles: ADMIN, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- A language with nothing chosen ("Mike", added for this test) is the open
  language (Bravo is ready after SETUP-022).

Steps:
1. Open My Work. Read the first card.
2. Tap "Choose".
3. Answer question 1 (as SETUP-022 step 2). Tap ✕.
4. Read My Work again.
5. Open Alpha (Map → All languages → Alpha). Read My Work.

Expected:
- The card reads "Get Mike ready · 1 of 4" ("What will help them?" is
  answered by the organization's FIA offer) with the title "What will they
  record?", a four-part bar and "Choose".
- "Choose" opens Get ready at question 1.
- After step 3 it reads "Get Mike ready · 2 of 4" with "Who checks the
  recordings?". The language page agrees.
- With Alpha open (ready) there is no Get ready card.
- A screen reader reads the bar as "2 of 4 questions answered".
- TRANS, REV and VIEW never see this card.

### SETUP-024 Change what a ready language translates, and change it back
Roles: ADMIN, LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: changes Alpha's books and changes them back.

Steps:
1. Open Alpha's page (LADMIN: the Manage tab) → "Content template" →
   "Which books".
2. Without changing anything, tap the main button.
3. Open it again. Under "Which part of the Bible?" tap "Whole Bible". Tap
   the main button.
4. Open "Which books" again. Under "Which part of the Bible?" tap "New
   Testament". Tap the main button.
5. Go back to Alpha's page.

Expected:
- "Which books" is the question that chose the template (decision 138).
  The header is "What to translate" with the sub "Alpha".
- With nothing changed the main button reads "Keep it" and only goes back.
- With a change it reads "Use this"; the note "Pieces that stay the same
  keep their recordings. What was recorded on a piece that changes is kept
  under "Earlier sections" on the new pieces." shows.
- Toast "Alpha translates {what}.", with no Undo.
- Step 4 puts the New Testament back (the same toast, with the New
  Testament), and every P-* passage keeps its work.
- Back on Alpha's page the "Content template" row reads "Bible stories ·
  New Testament". Nothing is refused.

Changed (2026-10-16, decision 134): no toast offers Undo; choosing the earlier books again in "They record" changes it back.

Changed (2026-10-16, decision 138): "They record" is now "Content template" → "Which books".

### SETUP-025 A new numbering on a language with work warns first
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Manual

Preconditions (in addition to the global ones):
- Alpha has recordings (fixture).

Steps:
1. Alpha's page → "Content template" → "Which books". Tap the numbering
   chip ("Numbering") and choose "Numbered like the Latin Vulgate".
2. Tap "Use this".
3. Tap "Keep it as it is".
4. Repeat, and tap "Change it anyway".
5. Open "Which books" again, choose the numbering Alpha had ("Numbered
   like most English Bibles"), tap "Use this", then "Change it anyway".

Expected:
- A sheet "Some sections will change" explains that work on changed
  sections moves to "Earlier sections" and says "Nothing is deleted.", with
  "Change it anyway" (red) and "Keep it as it is".
- "Keep it as it is" changes nothing.
- After "Change it anyway", passages whose verses are the same in both
  numberings keep their recordings (decision 80). The toast "Alpha
  translates {what}." has no Undo.
- Step 5 asks the same question, and "Change it anyway" puts the previous
  numbering back.

Changed (2026-10-16, decision 134): no toast offers Undo; choosing the earlier numbering again in "They record" changes it back.

Changed (2026-10-16, decision 138): "They record" is now "Content template" → "Which books".

### SETUP-026 What will help them: FIA's language
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Alpha offers FIA's English guides (fixture).
- Resets: changes FIA's language for Alpha and back.

Steps:
1. Alpha's page → "Reference material". Tap the row "FIA study guides".
2. In the sheet, tap "French", then "Use French".
3. Open the row again; choose "English", "Use English".

Expected:
- The page is "Reference material" (decision 138; it was "What helps
  them").
- The guide set shows as one row, "FIA study guides", its source and
  language, and how many passages it covers.
- The sheet asks "Which language should FIA be in?" with "It comes in 5
  languages. Choose the one Alpha's team reads best.", "Keep English" and
  "Don't offer FIA".
- Toast "FIA study guides are now in French", then "… in English",
  neither with Undo: choosing the language again in the same sheet (step 3)
  is the way back.
- On a ready language the reference-language page (decision 84) opens
  from "Languages" → "They understand" (SETUP-006, decision 138).

Known issue (2026-10-12): run after SETUP-024 (ADMIN, then LADMIN, change
what Alpha translates and Undo), Alpha's "What helps them" shows FIA study
guides off ("In 5 languages") and the row does not open its sheet.
Reproduced twice with SETUP-024 then SETUP-026, never with SETUP-023 then
SETUP-026 or with ADMIN's half of SETUP-024 alone. Not yet diagnosed.

Changed (2026-10-16, decision 134): no toast offers Undo; the guide set's sheet changes its language back.

### SETUP-027 What will help them: Bibles, study guides and notes
Roles: ADMIN, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: changes Alpha's offered Bibles and puts them back.

Steps:
1. Alpha's page → "Reference material".
2. Turn the organization's English Bible off. Turn it on again.
3. If a guide that is not a set is offered ("Example study guides"), turn
   it off, then on.
4. Tap "Add more" → "A Bible".

Expected:
- Each Bible, guide and note offered has a switch.
- Turning the Bible off says it is no longer offered (a toast with no
  Undo, as in SETUP-050); turning it on offers it again.
- Locally there is no Bible in the library: the section says "No Bibles
  yet", and step 2 runs on the preview environment.
- The guide turns off and on with the same row; each toast names it, with
  no Undo.
- "A Bible" opens "Bibles" with "Add a Bible".
- Nothing is refused.

Changed (2026-10-16, decision 134): no toast offers Undo; the same tick or switch changes it back.

### SETUP-028 The "Reference material" page and "Add more"
Roles: ADMIN · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Alpha's page → "Reference material".
2. Read the sections, and the last row.
3. Tap "Add more". Read the sheet. Tap "Key words".

Expected:
- The header is "Reference material" (decision 138; it was "What helps
  them").
- Sections: Bibles, Study guides ("{n} passages covered"), Key words (row
  "Key terms", "{n} words · {n} with a Alpha word"), Notes for translators.
- Empty sections say "No Bibles yet", "No study guides yet" or "No notes
  yet" with "Add more to offer some".
- The page ends with "All reference material", the organization's whole
  shelf (SETUP-049).
- The "Add more" sheet offers "A Bible", "A study guide", "A note for
  translators" and "Key words". "Everything in your library" is gone from
  it (decision 138).
- "Key words" opens Key terms.

### SETUP-029 Invite your translators: other roles, and a new role
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Open Get ready at question 4 for a language that is not ready yet
   (Alpha is ready, so it has no question 4).
2. Tap "Other roles · n".
3. Tap "Check".
4. Tap "Something else: make a new role", call it "Elder …", turn on
   "Record", and tap the primary button.

Expected:
- The dashed row "Something else: make a new role" shows above the roles
  (ADMIN holds Manage roles); "Other roles · n" reveals the other roles as
  chips. Only the dashed row says "Something else" (finding 98, 2026-10-28:
  the chip said "Something else" too).
- Each role change makes a code for that role ("Making the code…", then the
  QR).
- After step 4: toast "Elder … created.", back on question 4 with the new
  role chosen (its chip on) and its code shown (finding 98: it came back
  hidden, with the Translator code still showing).
- Tapping "Done" goes back to the page.
- A session without Invite at Alpha would see "Only people who can invite
  here can show a code" with "Ask someone who runs Alpha's team to invite
  your translators." (not reachable with the fixture's roles; checked by
  `npm test`).

### SETUP-030 What counts as ready
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: adds a language "Kilo".

Steps:
1. Add "Kilo" with nothing chosen. Answer question 1, then close at
   question 2.
2. Question 3: "I'll choose the checks" → "Choose the checks" → "Add a
   check" → "Community check" → "Done"; close.
3. Read its page. (ADMIN, COORD and VIEW hold organization-scope roles.)
4. Tap "Invite your translators", then "Done".

Expected:
- After step 2 Kilo is "Get Kilo ready" with "Invite your translators"
  current: organization-scope members do not make it ready.
- Question 3 done this way comes back to question 3 ("In use · your own
  steps", chosen) without opening question 4. The checks page has "Done"
  when opened from the question, and back on the question the footer reads
  "Next" (finding 100, 2026-10-28: it still read "Choose the checks" and
  opened the checks again).
- Opening question 4 issues a code, and an issued invite counts: the page
  shows "Ready · 0 translators".
- What helps them is never required (here it is already answered by the
  organization's FIA offer).

---

## Content templates

### SETUP-031 Content templates for the organization
Roles: ADMIN, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Org home → "Setup" → "Content templates".
2. Read the cards under "Your organization".
3. Tap "Options" on "FIA passages (English)". Close it.
4. Tap "Edit" on it. Go back.

Expected:
- The header is "Content templates" with the sub "UI Test Org", and the
  action "Template".
- The intro begins "A template is the structure a language records
  against".
- Each card shows its name, source line, levels and "Used by {names}" or
  "Not used here yet". "FIA passages (English)" says "Used by Alpha".
- "FIA passages (English)" is followed from LangQuest: its "Options" are
  "Update automatically", "Stop following" and "Copy to change it", and
  "View" opens it read only ("It follows LangQuest"). A template of the
  organization's own offers "Share with other organizations", "Let them
  follow updates" and "Archive" (SETUP-034), and "Edit".
- "From other organizations" lists what others share, or "Nothing else is
  shared yet."

### SETUP-032 "By language" rows on Content templates
Roles: ADMIN · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Org home → "Setup" → "Content templates".
2. Scroll to "By language". Tap "Alpha".

Expected:
- The row opens Alpha's books, each to divide: "Each book's passages" with
  "Alpha", listing Luke (decision 138).
- It does not say "That can't be opened from here."

Fixed (2026-10-13): `flow.ts` has no `templates_home → templates_home`
edge, so the row shows the toast "That can't be opened from here." and
stays. Alpha's view is reached from Alpha's page → More → "Every way to
divide the work". Needs `e('templates_home', 'templates_home', undefined,
'manageTemplates')` in flow.ts and its drift-log line in specParity.test.ts.

### SETUP-033 Follow or copy a template another organization shares
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Online. LangQuest's seeded templates are shared.
- Resets: adds one followed and one copied template.

Steps:
1. Content templates → "From other organizations". Tap "By chapter".
2. Tap "Follow", then "Update automatically".
3. Under "Your organization", tap "Options" on "By chapter", then "Stop
   following".
4. Tap "Options" on it again, then "Follow again". Open "Options" once
   more and turn "Update automatically" off.
5. Open "OpenBible: long sections". Tap "Copy".
6. Turn the network off and reopen Content templates.

Expected:
- The sheet shows "From LangQuest · {n} versions" with "Follow" ("Use
  LangQuest's versions as they publish them.") and "Copy" ("Make it ours
  to change.").
- Toast "Following {name} from LangQuest.", with no Undo. Its card under
  "Your organization" reads "Following LangQuest · updates automatically".
- Step 3: toast "Stopped following {name}. Languages keep the version
  they use." The card reads "Stopped following LangQuest", and its Options
  sheet offers "Follow again" where "Stop following" was.
- Step 4: "Follow again" toasts "Following LangQuest again." Turning
  "Update automatically" off toasts "You take {name}'s updates." and the
  card reads "Following LangQuest · you take updates".
- After copying: toast "{name} copied. The copy is yours to change." It is
  under "Your organization" with "copied from LangQuest" in its source line.
- A followed template opens read only: "It follows LangQuest" / "Its
  versions come from there. Copy it to change it." with "Copy to change
  it".
- LangQuest's ways are listed once each, in English numbering; its older
  templates ("Bible chapters (English)", "Bible books (English)") and its
  ways in other numberings are not (decision 107).
- Offline: "Could not refresh this list" with "Showing the list this device
  saved."

Changed (2026-10-16, decision 134): no toast offers Undo; the template's Options has "Stop following", and after that "Follow again".

### SETUP-034 Share, let follow, archive a template, and take an update
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: changes sharing and archive state and puts them back.
- For the update step: a template ORG follows with "I'll take updates",
  whose owner published a newer version (SETUP-033 step 4, then publish a
  new version as the owner, or use the preview environment).

Steps:
1. Content templates → "Options" on "OpenBible: long sections" (copied in
   SETUP-033).
2. Turn on "Share with other organizations"; then "Let them follow
   updates". Turn "Let them follow updates" off, then "Share with other
   organizations" off. Turn both on again.
3. Tap "Archive".
4. Open "Archived". Tap "Options" → "Unarchive".
5. On the followed template: read the card, tap "Options" → "Take update".

Expected:
- Toasts "Songs {run} is shared with other organizations.", "Others can
  follow it and get your new versions.", neither with Undo. Turning them
  off toasts "Others can no longer follow it." and "Songs {run} is no
  longer shared. Anyone using it keeps their version."
- "Songs {run} archived. Languages using it keep it.", with no Undo; the
  card moves to the collapsible "Archived" ("1 template · languages using
  them keep them").
- "Unarchive" is the way back: "Songs {run} is back in the list."
- The followed template shows the amber "LangQuest has a newer version.".
  "Take update" toasts "{name} updated. Languages using it move to the new
  version by themselves." (needs an owner who publishes a newer version:
  the preview environment).

Changed (2026-10-16, decision 134): no toast offers Undo; the same switch, or "Unarchive", changes it back.

### SETUP-035 A language's content template, and each book's passages
Roles: ADMIN, LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Alpha's page (LADMIN: the Manage tab) → "Content template".
2. Read the card on top and the rows under it.
3. Tap "Each book's passages".
4. Type "Luk" in "Find a book". Then type "zzz".
5. Clear it and tap "Luke".

Expected:
- The page is "Content template" with the sub "Alpha" (decision 138). On
  top, the template it uses, with its radio lit: "FIA passages (English)",
  "{n} of its {N} books · English versification", "{n} passages · {n}
  recorded" and its version.
- The card's links are "Each book's passages", "Which books" (SETUP-024)
  and "View" (Alpha's is followed from LangQuest; "Edit" for one of the
  organization's own).
- Under it, the organization's other templates to choose from (SETUP-036);
  last, "All content templates".
- "Each book's passages" opens a page of that name with the sub "Alpha":
  the books with "{n} passages", and "Find a book".
- "zzz" says "No book matches “zzz”."
- "Luke" opens Luke ("Alpha · {n} passages"). Books waiting to be divided
  are listed too, as "Waiting to be divided", and open the ways to divide
  them (decision 107).

### SETUP-036 Choose a different template for a language
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: changes Alpha's template and changes it back.

Steps:
1. Alpha's page → "Content template".
2. Tap another template, for example "OpenBible: long sections" (SETUP-033).
3. Read the footer.
4. Tap "Use OpenBible: long sections".
5. Under the one it now uses, tap "FIA passages (English)", then "Use FIA
   passages (English)".
6. Go back to Alpha's page. Tap "See their work".

Expected:
- "FIA passages (English)" is on top, the one in use; the organization's
  others are listed under it to choose from, "OpenBible: long sections"
  among them (decision 138: there is no "Choose a Template" screen or
  "Change template" button any more).
- LangQuest's older templates ("Bible books (English)") and its ways in
  other numberings ("Bible chapters (Russian Orthodox)") are not offered
  (decision 107).
- The footer warns "Alpha's current passages are hidden, not deleted. {n}
  parts have recordings — change back to this template to bring them
  back."
- Toast "Alpha now uses OpenBible: long sections.", with no Undo. The page
  stays, with OpenBible: long sections on top.
- Step 5: toast "Alpha now uses FIA passages (English).", and Alpha's map
  shows FIA passages again with every recording (TPL-7: hidden, never
  deleted). Picking it again uses that template's latest version. Nothing
  is refused.
- For a language with no template: "{lang} will record against {name}. You
  can change it later; nothing recorded is ever deleted." For a shared
  template it adds "Your organization follows it, so {org}'s new versions
  reach {language} by themselves."

Changed (2026-10-16, decision 134): no toast offers Undo; picking the earlier template again in "Change template" changes it back.

Changed (2026-10-16, decision 138): "Change template" and "Choose a Template" are gone; the others are picked on the language's Content template page, under the one it uses.

### SETUP-037 Make a Scripture template
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: adds a template.

Steps:
1. Content templates → "Template".
2. Tap "Scripture". Tap "King James Version", then Continue.
3. Tap "By chapter", then Continue.
4. Type "Gospels {run}" in "Name".
5. Tap "Genesis" → "OpenBible: usual sections" → "Change Genesis".
6. Tap "Exodus" → "Rename or remove Exodus" → "Remove this book".
7. Tap "Create template".

Expected:
- "What will languages record with it?" offers "Scripture" ("Books and
  chapters of the Bible, divided into passages as teams go.") and
  "Something else".
- Scripture asks what New language asks (decision 107): "Bibles number
  verses differently", "Pick your Bible", then "Which Bible do you
  translate from?" with "Not listed? Answer a few questions", then "How
  should the Bible be divided?" with "Divide it your own way" first.
- The editor has no "Whole books" or "Chapters" choice; it says "Tap a book to choose how
  it's divided."
- A book opens "Change how Genesis is broken up" with "Divide it your own
  way" first, then "Or pick a ready-made way", and "Rename or remove
  Genesis". After the change, the toast says "Genesis is divided." (the
  form is kept on this device as it changes, decision 127) and Genesis's
  row says "OpenBible: usual sections · {n} pieces".
- The book sheet has "Name in the language" and "Remove this book" with
  "Languages using the template keep anything recorded in it; its parts are
  set aside, not deleted."; after removing it the list is "Books · 65".
- "Create template" is disabled until there is a name and a book.
- Toast "Gospels {run} created."

### SETUP-038 Edit a template; leaving keeps the draft
Roles: ADMIN · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- "Gospels {run}" exists (SETUP-037).
- Resets: publishes a new version.

Steps:
1. Open "Gospels {run}" → "Edit". Change "What it's for".
2. Tap Back.
3. Open "Edit" again. Tap "Done".

Expected:
- Step 1: the header's saved mark turns from a spinner into a check; the
  change is kept on this device as a draft only ADMIN sees (decision 127).
- Step 2 leaves at once, with nothing to answer first, and publishes
  nothing (no toast).
- Step 3 opens with the change still there ("The four gospels first.").
  "Done" (it was "Save changes") publishes it: toast "Gospels {run} saved
  as version 2." (with "{names} moves to it by itself." when a language
  uses it). No Undo. With nothing changed, "Done" just closes.

### SETUP-039 Make an outline template
Roles: ADMIN · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: adds a template.

Steps:
1. Content templates → "Template" → "Something else".
2. Name it. Tap "Create template" with an empty outline.
3. Add a folder and two items inside it. Rename one item; move it up.
4. Tap "Create template".

Expected:
- With nothing in it "Create template" is disabled ("The outline is
  empty." is what a read-only empty outline says).
- "Add {level} folder" and "Add {level}" add rows; an item's sheet offers
  "Move up", "Move down" and "Remove this item".
- Toast "{name} created."

### SETUP-040 Divide a book that waits, for this language
Roles: ADMIN, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- A language ("Oscar", added for this test) translates the whole Bible with
  LangQuest's "FIA passages": Proverbs waits to be broken up.
- Resets: divides Proverbs for Oscar.

Steps:
1. Oscar's page → "What will they record?": "The Bible", "Like most
   English Bibles", "FIA passages", "Whole Bible". Close Get ready with ✕.
2. Map → Oscar → "Old Testament" → "Proverbs" → "Divide Proverbs".
3. Tap "By chapter" → "Divide Proverbs" (and "Change it for this
   language" when other languages use the template).

Expected:
- Toast "Oscar translates {what}." Oscar is not ready yet, so its page is
  the Get ready checklist, with no "Content template" row: the book is
  divided from the map (decision 107). On a ready language, books that wait
  are also listed under "Content template" → "Each book's passages"
  (SETUP-035, decision 138).
- "How should Proverbs be divided?" with way cards ("By chapter" and
  others, each with a preview).
- When another language uses the template, "Which languages should
  change?" lists Oscar fixed ("The one you're changing") and the others to
  tick, with "The languages you leave out keep the template as it is. The
  ones you choose get their own copy with this change."
- Toast "Proverbs is divided by chapter."; the book shows "Divided".
- Nothing is refused (the template version goes to the organization's
  library: ADMIN and COORD hold organization scope).

### SETUP-041 Dividing a divided book again warns first
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Manual

Preconditions (in addition to the global ones):
- Luke is divided into FIA passages, with recordings (fixture).

Steps:
1. Alpha's page → "Content template" → "Each book's passages" → "Luke".
   Tap "Divide differently".
2. Pick "By chapter". Tap "Change Luke".
3. Tap "Keep it as it is". Repeat and tap "Change it anyway".
4. Open Luke 15 on the map.
5. "Each book's passages" → "Luke" → "Divide differently". Pick "FIA
   passages", tap "Change Luke", then "Change it anyway".

Expected:
- "Change how Luke is broken up" with "Now: FIA passages. Each piece is
  recorded on its own."
- "Change Luke" is disabled while the chosen way is the current one.
- The sheet "Luke will be divided again" counts the cost here: "{n} of
  Luke's sections have recordings here. They move to "Earlier sections"…"
  (red), or, when none has reached this phone, "Nothing recorded on Luke has
  reached this phone yet…" (amber). It still asks either way (decision 74),
  says "Nothing is deleted.", and has "Change it anyway" and "Keep it as it
  is".
- When other languages use the same template, "Which languages should
  change?" comes first, each row saying its recordings on Luke move too;
  the warning then names those languages, and its button reads "Change it
  for {n} languages" (UI audit, findings 47 and 53).
- After the change, the toast "Luke is divided by chapter." has no Undo.
  Luke 15 shows the warning mark and "Earlier sections" with P-CHECK's and
  P-SUBMITTED's recordings (decision 80).
- Step 5 changes it back ("Luke is broken up into FIA passages."), with
  the same warning first, and brings the passages back with their work. A
  book divided its own way has no ready-made way to pick again: it is drawn
  again with "Divide it your own way".

Changed (2026-10-16, decision 134): no toast offers Undo; picking the earlier way again in "Divide differently" changes it back.

### SETUP-042 What a language calls a book, and what translators see
Roles: ADMIN, TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets (ADMIN): names Luke in Alpha.

Steps:
1. ADMIN: Alpha's page → "Content template" → "Each book's passages".
   Find "Luke" with "Find a book" and tap it. Tap "Tap to give it the name
   the team uses".
2. Type "Luka" in the name field (it is labelled with the sheet's title).
   Tap "Save".
3. TRANS: Sync now. Open the map. Open a book still waiting (if any).
4. ADMIN: name it "Luke" again.

Expected:
- The sheet is "What Alpha calls Luke" with "Translators see this name". Under
  the field it offers "What the team's Bibles call it" and "What other
  languages here call it" when there are any, each name with "Use".
- Updated (2026-10-13): main's "Merge books a way leaves out and naming a
  book (demo ADR-042)": the sheet was "What Alpha calls it" with a field
  labelled "Its name".
- Toast "Alpha calls it Luka." with no Undo. The line reads "Called Luka in
  Alpha".
- TRANS sees "Luka" on the map and in passage titles.
- TRANS opening a book that waits sees "A coordinator breaks up {book}
  before anyone records it." and no way to divide it.

---

## A language's checks and the review flows

Since decision 91 a language's checks are its own: a ready-made flow is a
starting point whose checks are copied in, and each check carries its own
people, questions and helps. The language page's "Review flow" row opens
its Review flow page (decision 138): its checks on top, whose "Edit" opens
the Checks screen (`screens/checks.tsx`); the ready-made flows under them;
and last "All review flows", the organization's Review flows. The Review
Teams screens are gone.

### SETUP-043 Review flows home
Roles: ADMIN, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Alpha is open.

Steps:
1. Alpha's page → "Review flow" → "All review flows".
2. Read the current card and "Your organization".
3. Read "From other organizations".

Expected:
- The header is "Review flows" with the sub "Alpha" and the action "New
  flow" (decision 138: it was reached from More's "Every way to check";
  "Flow" until the UI audit, finding 103).
- The card says "Alpha uses" and "Custom flow" (its checks were copied from
  Standard Bible Flow, decision 91), its steps (Peer Review, Back
  Translation, Community Check, Consultant Check, Final Approval), "Edit
  checks and people" (opens Alpha's own checks, where who checks is chosen:
  finding 102) and "Add to your flows".
- A flow the language still follows (from before decision 91) shows an "In
  use" badge, not a button; on the others "Use" sits on its own line under
  the steps, apart from the card's title (finding 103).
- "Your organization · 0" with "No flows here yet. Follow or copy one
  another organization shares, or make your own."
- "From other organizations · {n}" lists LangQuest's flows with "LangQuest ·
  {n} versions" and "Use", "Follow", "Copy".

### SETUP-044 Use a ready-made flow for a language
Roles: ADMIN, COORD · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Alpha's checks are the fixture's (copied from Standard Bible Flow).
- Resets: changes Alpha's checks and puts them back.

Steps:
1. Alpha's page → "Review flow" → "All review flows".
2. Tap "Use" on "Quick Check".
3. Go back to Alpha's page and read the "Review flow" row.
4. "Review flow" → "All review flows" → "Use" on "Standard Bible Flow". Go
   back to Alpha's Review flow page.
5. Tap "Edit" (Checks). Tap Community check's lock ("can be set aside"),
   so it must pass. Tap the Undo arrow in the header, then Redo.
6. Go back. "All review flows" → "Use" on "Quick Check". Read the sheet and
   tap "Cancel".
7. Go back. "Edit" → tap Community check's lock again. Go back.

Expected:
- Alpha's checks are still exactly as Standard Bible Flow made them, so
  that set can be chosen again: "Use" asks nothing. Toast "Alpha now uses
  Quick Check.", with no Undo. Its checks are copied into Alpha (decision
  91): the "Review flow" row reads "Peer check → Final approval" (decision
  138).
- Step 4 puts Standard Bible Flow's checks back, again without a question:
  Alpha's Review flow page shows "Peer check + back translation →
  Community check → Consultant check → Final approval". A check's people,
  questions and helps belong to its kind, so they come back with it.
- In step 5 Undo takes the lock back and Redo puts it on again (the
  Checks list keeps its changes while the screen is open). Alpha's checks
  are then its own (no ready-made set has them), so step 6 asks first: a
  sheet "Replace Alpha's own checks with Quick Check?" with "Use Quick
  Check" and "Cancel". "Cancel" changes nothing.
- Step 7 takes the lock off: Community check can be set aside again, and
  the Review flow page shows the order above.
- Passages read against the new checks; nothing recorded or reviewed is
  lost (decision 32). Sync shows nothing refused.

Changed (2026-10-16, decision 134): no toast offers Undo; "Use" on the earlier flow puts its checks back, and replacing checks a language made its own asks first.

### SETUP-045 Make a review flow in the library
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: adds a flow.

Steps:
1. Alpha's page → "Review flow" → "All review flows" → "New flow".
2. Type "Community first {run}" in "Name" and a line in "Description".
3. Tap "Add a step". Pick "Community Check".
4. Add a step. Under "A new kind" type "Elder check". Tap "Add this kind",
   then pick it.
5. Open step 2. Tap "Move up". Close the sheet.
6. Tap "Done".

Expected:
- The header is "New way to check" with "New · your organization".
- The kind sheet says "Kinds are your organization's vocabulary. Add your
  own if these don't fit."
- The step sheet is "Step 2 of 2" with "Add a check alongside", "Move up"
  and "Remove this step".
- The header's saved mark shows the flow is kept on this device as it is
  made; Back would keep it as a draft, with no "Leave without saving?"
  (decision 127).
- Toast "Community first {run} saved." The flow is listed under "Your
  organization · 1". Nothing is refused.

### SETUP-046 Remove one of a language's checks: it asks first, and the list's Undo puts it back
Roles: ADMIN, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: removes a check and undoes it.

Steps:
1. Alpha's page → "Review flow" → "Edit" (Checks, decision 138).
2. Tap "Community check". Read the page.
3. Tap "Remove this check", then Cancel.
4. Tap "Remove this check", then "Remove this check" in the sheet.
5. Back on Checks, tap the Undo arrow in the header.

Expected:
- The check's page is "Community check" with the sub "Check 2 · Alpha" and
  People, Questions, Helps, "Must pass" and "Remove this check".
- Step 3: a sheet asks "Remove Community check?" with "Check 2 · Alpha", and
  Cancel keeps it.
- Step 4: toast "Community check removed" (no Undo); Checks lists Peer
  check, Back translation, Consultant check, Final approval, and the header's
  Undo reads "Undo: Community check removed".
- Undo brings Community check back in its place, and P-ASIDE keeps its
  set-aside Community check.

Changed (2026-10-16, decision 134): no toast offers Undo; removing a check
asks first, and the Checks list's header Undo, which hears a save made on a
check's own page opened from it, puts it back.

Fixed (2026-10-12): Undo said "Undone." but the check stayed gone. A removed
step is out for good (`FlowStepRemoved` is add-wins) and core `restoreFlow`
put it back under its old id. Undo now puts it back as a new step of the
same check (`checks/undo.ts`, `checksUndo.test.ts`); the same held for Undo
after "Start from a ready-made flow" and Review Flows' "Use".

### SETUP-047 Links from "Who checks" (retired)
Retired 2026-10-12: decision 91 replaced "Who checks" with the Checks screen.
Review Teams are gone, and Checks has no link to Review Flows; a check opens
from its card (SETUP-067 to SETUP-070).

### SETUP-048 Follow, update, stop following and copy a shared flow
Roles: ADMIN · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Online. LangQuest shares followable flows.
- Resets: follows and copies a flow.

Steps:
1. Alpha's page → "Review flow" → "All review flows". Under "From other
   organizations", tap "Follow" on "Oral Review Path" → "I'll take
   updates".
2. Open it.
3. Under "Library": "Stop following", then "Follow again".
4. Tap "Copy to change it".

Expected:
- Toast "Following Oral Review Path. You choose when to take updates."
- The flow opens read only: "Follows LangQuest" / "It changes only when
  they publish a new version. Copy it to make your own changes."
- "Stopped following. The version in use stays."; "Following LangQuest
  again."
- "Oral Review Path copied. It is yours to change."
- "Take update" and the "Update" badge need an owner who publishes a newer
  version (the preview environment).

### SETUP-067 A check's people
Roles: ADMIN, LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Peer check's people are REV and TREV (fixture).
- Resets: adds TRANS to Peer check and takes them off.

Steps:
1. Alpha's page (LADMIN: the Manage tab) → "Review flow" → "Edit"
   (Checks, decision 138). Read Peer check's card.
2. Tap "Peer check". Read its People row. Tap "People".
3. Tap "Add people". Read the list. Tick "Tom Translator". Tap "Done".
4. Tap ✕ beside Tom Translator. Go back twice.

Expected:
- The card names "Rita Reviewer, Trevor Both" with their faces; a check
  with nobody on it says "Anyone".
- The check's People row names them; People opens a page of its own
  (decision 130) listing each person with their role ("Reviewer",
  "Translator-Reviewer").
- "Add people" lists whoever may review at Alpha, Translators included
  (decision 91), and "You" for oneself; Vic Viewer is not offered.
- Toast "Peer check: 3 people", with no Undo (no timed undo toasts,
  Caleb 2026-10-16); then "Peer check: 2 people".

### SETUP-068 A check's questions
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: adds a question and removes it.

Steps:
1. Checks → "Community check". Read its Questions row. Go back.
2. Checks → "Peer check" → "Questions" → "Add a question". Type "Is it
   clear to a child?", tap "Yes / No", turn on "Required", tap "Save".
3. Go back and read the Questions row; go back and read Peer check's card.
4. Open Questions, then the question. Tap "Remove question".

Expected:
- Community check comes with no questions (LangQuest's checks bring none,
  LAN-85): its card shows no count, and its row reads "Questions · No
  questions". Questions is a page of its own (decision 130).
- The question sheet offers "Text", "Yes / No", "1–5" and "Required".
- Toast "Question saved"; the row reads "Yes / No · Required"; the
  check's Questions row and its card say "1 question".
- Toast "Question removed".

### SETUP-069 A check's helps
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: links helps to Peer check and takes them off.

Steps:
1. Checks → "Peer check" → "Add a help". Tick "FIA study guides
   (English)". Tap "Done".
2. "Add a help" → "Write a note". Title "Listen for names", a line of text.
   "Save".
3. Go back and read Peer check's card.
4. Take FIA study guides off; add it again from "Add a help"; take both
   off.

Expected:
- The sheet has "Notes" with "Write a note", and "Guides and Bibles".
- Toast "Added to Peer check" for each, with no Undo.
- The card says "2 helps".
- Toast "Taken off Peer check"; Add a help puts it back.

### SETUP-070 Must pass, and checks at the same time
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: changes and puts back.

Steps:
1. Checks → "Community check". Turn on "Must pass". Go back.
2. Open "Back translation". Tap "Same time as" (it reads "Peer check"),
   untick "Peer check", tap "Done"; then tick it again and "Done".
3. Open "Community check". Tap "Move down", then "Move up". Turn its "Must
   pass" off again.

Expected:
- Toast "Alpha's checks saved"; Community check's card shows the
  lock ("Community check must pass before the next steps"): closed and
  amber when on, open when off, and the list ends with "🔒 = must pass
  before the next steps" (UI audit, finding 105).
- "Move down" makes it "Check 3 · Alpha", "Move up" "Check 2 · Alpha"
  again: a tap does what the card's grip does by dragging (finding 101).
  Dragging a card moves the cards it passes aside, each by its own height.
- "Same time as" is a choice of any other checks (decision 130).
- Back translation is "Check 1 · Alpha" while at the same time as Peer
  check, and "Check 2 · Alpha" on its own ("Same time as · No other
  check").
- Checks reads as the fixture's at the end; nothing refused.

### SETUP-071 Add a check
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: adds two checks and removes them.

Steps:
1. Checks → "Add a check". Tap "Retelling".
2. "Add a check" → under "Something else" type "Elder check" → "Add this
   check".
3. Remove both.

Expected:
- The sheet offers the kinds Alpha does not use yet ("Retelling", "Local
  check") and "Something else".
- Each is added at the end: toast "Alpha's checks saved".
- Removing each asks first ("Remove {check}?"), then toasts "{check} removed".

### SETUP-072 Start from a ready-made flow
Roles: LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: replaces Alpha's checks and undoes it.

Steps:
1. Checks → "Start from a ready-made flow".
2. Tap "Quick Check" → "Use Quick Check".
3. Tap the Undo arrow in the Checks header.

Expected:
- The sheet is "Ready-made flows" with "Replaces Alpha's checks", each flow
  with its checks in a line ("Peer check → Final approval").
- Toast "Alpha now starts from Quick Check", with no Undo; Checks lists
  Peer check and Final approval. The header's Undo arrow is dark,
  labelled "Undo: Alpha now starts from Quick Check"; Redo is grey.
- Step 3 puts back all five checks, with Peer check's people. No toast
  shows; Redo is now dark. The arrows' history lasts until you leave the
  Checks screen.

Changed (2026-10-16, decision 134): no toast offers Undo; the Undo arrow in the Checks header puts the checks back.

### SETUP-073 Move a check to another place in the order
Roles: ADMIN · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: moves a check and undoes it.

Steps:
1. Checks: drag Final approval's grip above Consultant check (a screen
   reader uses the grip's "Move up").
2. Tap the Undo arrow in the Checks header.

Expected:
- Toast "Alpha's checks saved", with no Undo; Final approval comes before
  Consultant check. The header's Undo arrow is labelled "Undo: Alpha's
  checks saved".
- Step 2 puts the order back. Dragging Final approval back below
  Consultant check does the same.

Changed (2026-10-16, decision 134): no toast offers Undo; the Undo arrow in the Checks header, or moving it back, puts the order back.

---

## Reference material

A ready language's "Reference material" row opens its own page: what its
team is offered, each with a switch, and "Add more" (SETUP-026 to SETUP-028).
That page ends with "All reference material", the organization's library as
the language sees it (decision 138). Below, "Alpha's Reference material" is
that last screen: Alpha's page → "Reference material" → "All reference
material".


### SETUP-075 A ready language's Review flow: its checks, the others, and the organization's
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

A ready language's Review flow names its checks as its page does, in order,
with the ready-made flows under them and the organization's shelf last
(decision 138).

Preconditions (in addition to the global ones):
- Alpha's checks are as Standard Bible Flow made them.
- Resets: uses Quick Check's checks, then Standard Bible Flow's again.

Steps:
1. Open Alpha's page and tap "Review flow".
2. Tap "Peer check → Final approval", then "Use these checks".
3. Tap "Peer check + back translation → Community check → Consultant check
   → Final approval", then "Use these checks".
4. Go back to Alpha's page.

Expected:
- Step 1: on top "Peer check + back translation → Community check →
  Consultant check → Final approval", "4 checks", who does each, and
  "Edit"; under it the ready-made flows, among them "Peer check → Final
  approval" with "Quick Check" (its flow's name) in its line under; last
  "All review flows". The footer button reads "Use these checks", and over
  the language's own checks it asks "Replace Alpha’s own checks?" with the
  checks under the question (UI audit, finding 104: the button carried the
  whole chain).
- Step 2: toast "Alpha now starts from Peer check → Final approval"; no
  question first (the checks were still as a ready-made flow made them,
  decision 134).
- Step 3: toast "Alpha now starts from Peer check + back translation …",
  again without asking.
- Step 4: the Review flow row reads "Peer check + back translation →
  Community check → Consultant check → Final approval". Everything is sent
  and nothing refused.

### SETUP-049 Reference material for a language
Roles: ADMIN, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Alpha's page → "Reference material" → "All reference material" (the
   last row).
2. Read "What translators are offered".
3. Read the library and the language's own sections.

Expected:
- The header is "Reference material" with the sub "Alpha", and the main
  button "Add material" (decision 138: it was More's "Bibles, guides and
  notes").
- The intro begins "Alpha's own material adds to what the organization
  recommends; nothing is copied."
- Rows: "Bibles" ("{n} recommended · text, audio, offline use and
  timings"), "Guides and notes" ("{n} recommended guides · {n} notes"),
  "Coverage" ("What reaches each passage in Alpha").
- "Key terms" with "{n} concepts · Alpha renderings".
- "Library · your organization · {n}", each row saying what it
  is ("Study guide · {n} passages", "Bible", …) and its language or
  "Language not given".
- "Add material" asks which kind: "Guidelines, a brief or questions",
  "Write a guide" ("Steps with text and audio, pictures, maps and key
  words") and "A note placed by verses". (Changed 2026-10-28, UI audit
  finding 59: one way to make something, where "New" and a "Write a guide"
  row sat beside it. Someone who may not write the organization's library
  has one kind, and Add material opens it.)
- "Study material", "Review questions" (with "Question sets for the same
  kind add up…") and "General · Alpha".
- "From other organizations" lists what others share (LangQuest's question
  sets and FIA's guides in five languages), with "Follow" and "Copy".

### SETUP-050 Bibles: recommend here, or stop
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- The organization recommends its English Bible to every language
  (fixture). A second Bible, {Bible 2}, is in the library, not recommended.
  Locally there is no Bible (no `source@1`): the test checks both levels'
  intros and empty lists; Recommend here and Stop recommending here run on
  the preview environment.
- Resets: changes recommendations and changes them back.

Steps:
1. Org home → Setup → "Reference material" → "Bibles". Tap "Recommend" on
   {Bible 2}. Tap "Stop recommending" on it.
2. Alpha's page → "Reference material" → "All reference material" →
   "Bibles".
3. On the English Bible tap "Stop recommending here".
4. In "Not recommended here", tap "Recommend here" on it.
5. On {Bible 2} tap "Recommend here".
6. On TRANS's device after Sync now, open a passage's Bible chip.

Expected:
- Organization level: intro "What the organization recommends to every
  language…"; toast "{Bible 2} is recommended to every language.", with
  no Undo. The row's button turns into "Stop recommending", which takes it
  back ("{Bible 2} is no longer recommended.").
- Language level: intro "What this language’s team is offered…";
  sections "Recommended · {n}", "Not recommended here · {n}", "In your
  library, not recommended · {n}".
- Toasts, none with Undo: "{name} is no longer recommended to this
  language's team.", "{name} is recommended to this language's team." (the
  English Bible, then {Bible 2}). Each row has one button, which changes it
  back: "Recommend here" after "Stop recommending here", and the other way.
- TRANS is offered exactly the Bibles recommended for Alpha.

Changed (2026-10-16, decision 134): no toast offers Undo; the row's own button ("Stop recommending", "Follow organization") changes it back.

Changed (2026-10-28, UI audit finding 58, decision 185): one switch in a
language, as on Get ready: "Recommend here" and "Stop recommending here"
replace Hide, Follow organization, Recommend and Stop recommending; the
section and badge read "Not recommended here" in place of "Hidden for this
language".

### SETUP-051 Add a Bible
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Online. The local Worker has a Bible Brain key, or the test notes it has
  none.
- Resets: adds a Bible.

Steps:
1. Alpha's Bibles → "Add a Bible".
2. On "From LangQuest", pick a Bible. Tap "Add and recommend".
3. Open "Add a Bible" again → "Bible Brain". Type "f". Then type "French".
4. Pick a language chip and a Bible. Tap "Add and recommend".
5. Open the added Bible.

Expected:
- The sheet says "It is recommended here once added. Translators see
  whether it has audio and whether it can be kept offline."
- Nothing is searched with one letter.
- A language with none: "Bible Brain has no Bible in this language."
- Without a key: "This server does not offer Bible Brain search yet."
- Added Bibles show under "Recommended".
- The Bible's page ("Bible") shows "What it offers" by testament, its
  offline line, copyright, "Text and audio from Bible Brain (Faith Comes By
  Hearing), under its terms.", and "Verse timings by book".
- With untimed audio and organization-scope Manage reference, "Generate
  verse timings" asks for timings: toast "Asked for verse timings for {n}
  books. Progress shows here." and a job card ("Waiting", "Working",
  "Done" or "Stopped").

### SETUP-052 Guides and notes, filtered
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Alpha's Reference material → "Guides and notes".
2. Tap "Filter". Choose "Guides", language "English", book "Luke", and
   "Covers this language's passages". Apply.
3. Tap "Clear".
4. Tap an FIA guide. Go back. Tap a note.

Expected:
- The header is "Guides and Notes"; the intro explains placement by verses
  or template parts.
- The chip reads "Filter · 4" after step 2, and the list narrows; "Nothing
  matches the filter." when empty.
- Each card names the item's language (decision 84).
- A study guide opens the guide editor; anything else opens the material
  editor.
- The footer offers "New note for translators". It opens a note for the
  organization's library to someone who may write the library; to a
  language's own manager, a note written in that language; to anyone else,
  nothing. "Write a guide" shows only to someone who may write the library,
  and so does opening one of its guides in the guide editor. (Changed
  2026-10-28, UI audit findings 54 and 55: a language lead was sent to an
  empty editor, and told they may not write guides.)

### SETUP-053 Coverage and a passage's reference
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: hides and shows a guide on one passage.

Steps:
1. Alpha's Reference material → "Coverage".
2. Tap "No guide or note". Then "All".
3. Tap Luke 15:11-32 (P-SUBMITTED).
4. On its FIA guide tap "Hide here", then "Show here".
5. Tap "Add a help".

Expected:
- Summary: "{n} passages", "{n} with a Bible · {n} with a guide · {n} with
  a note", and the amber "{n} passages without a guide or note".
- Rows without a guide say "Nothing recommended reaches it" with "No
  guide".
- The passage page is "What helps here": the passage a tap away at the top,
  then a card for each help with Show here / Hide here (PASS-034).
- Toasts "{name} is hidden on this passage." and "{name} shows on this
  passage again.", neither with Undo: the card keeps "Show here" / "Hide
  here", hidden ones too, so the same button changes it back.
- Adding: "Add a help" opens a sheet with "Write a note for translators"
  first, set apart, then "From your library". Placing a library item says
  "{name} is placed on this passage." and shows it with "Placed here by hand".
- Updated (2026-10-13): main's 0a6934c (demo ADR-042): the passage's "Reference"
  page is "What helps here"; "Add" is "Add a help". The automated test checks
  Hide/Show only when a guide is offered on that passage, and only opens and
  closes the Add a help sheet.

Changed (2026-10-16, decision 134): no toast offers Undo; "Show here" and "Hide here" on the card change it back.

### SETUP-054 Write a note and a question set
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: adds material.

Steps:
1. Alpha's Reference material → "Add material" → "Guidelines, a brief or
   questions".
2. Leave "Translation Guidelines". Title it "Names in Luke {run}". Leave
   "Where it applies" on "Alpha". Fill "Body". Tap "Add material".
3. Open it. Tap "Publish to library".
4. "Add material" → "Guidelines, a brief or questions" again → "Review
   Questions". Title it. Pick "For which kind of review" "Peer Review". Add
   a question. Tap "Add material".
6. As REV, open P-SUBMITTED → Review it.

Expected:
- "What kind" offers Translation Management Framework, Translation Brief,
  Translation Guidelines, FIA Study Material and Review Questions (a note
  for translators is written from Guides and Notes' "New note for
  translators"); "Where it applies" offers "Alpha" and "All languages"
  (organization-scope Manage reference only). Kinds of review are listed
  by their kind names ("Peer Review"), not the check names Checks uses.
- Toast "Names in Luke {run} added."
- "Publish to library" puts in any changes not yet written first (as
  "Done" does), then "{title} is in your library. Share it from there."
- REV's Questions include the new required question.

### SETUP-055 Library material: verses, numbering, "Use in reviews"
Roles: ADMIN · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: adds library material.

Steps:
1. Reference material (organization) → "Add material" → "A note placed by
   verses".
2. Type the verses "LUK 15:11-32" and "LUKE fifteen".
3. Fix the second line. Pick "Numbered as in". Tap "Done".
4. Make a question set the same way, then tap "Use in reviews".

Expected:
- A bad line: "Could not read “LUKE fifteen”. Write them like RUT 1:1-16."
- "{title} is in your library."
- "Reviewers doing {kind} now see these questions.", with no Undo.
- There is no lasting way back yet: "Use in reviews" stays as it is (it
  does not turn into "Stop using"), and nothing takes the copy back in one
  step. To take the questions out again, remove each one from the check's
  Questions (Checks → the check → the question → "Remove question").

Changed (2026-10-16, decision 134): no toast offers Undo; no lasting way back yet: each copied question is removed on the check's page.

---

## The guide editor

### SETUP-056 Write a guide and publish it
Roles: ADMIN · Priority: P1 · Platforms: Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: publishes a guide.

Steps:
1. Alpha's Reference material → "Add material" → "Write a guide".
2. Tap "Done" at once.
3. Fix each item: title "The lost son {run}"; "Verses" LUK 15:11-32;
   "Numbered as in" English; "Start with these steps" → FIA (six steps).
4. Open "Steps" and type a line in step 1's text. In "Details", tap "One
   empty step" under "Start with these steps". Tap the Undo arrow in the
   header.
5. Open "Steps". Record step audio for step 1. Use Bold and Link in its
   text.
6. Open "Media". Add a picture and a film. Open "Glossary". Add a term.
7. Tap "Done".
8. As TRANS after Sync now, open P-SUBMITTED's study.

Expected:
- The title is "Write a guide"; panel chips "Details", "Steps (n)", "Media
  (n)", "Glossary (n)".
- Step 2: toast "{n} things to fix before publishing." and an amber
  "Before publishing" list ("Give the guide a title.", "Say where the guide
  applies: a verse range, or a part of a template.", "Add at least one
  step." …); each item jumps to its panel. "Ready to publish." once fixed.
- The header's saved mark turns from a spinner into a check as you type:
  the draft is kept on this device, only for its writer (decision 127).
- A new guide starts with FIA's six steps ("Now: 6 steps."); "One empty
  step" and "FIA's six steps" replace them. Once a step has words or audio
  the line reads "Choosing replaces the steps you have. You can undo it."
- Step 4: choosing "One empty step" shows no toast. The header's Undo
  arrow, beside the saved mark, is labelled "Undo: Steps replaced with one
  empty step." and brings back the six steps with the line typed in step
  1; Redo is then dark. Every change in the editor is a step for Undo
  (typing in one field without a pause joins into one step), kept with the
  draft on this device until it is published. Removing a step, a picture or a term shows no
  toast either; Undo brings it back.
- Busy labels "Uploading {n} of {N}…", then "Publishing…".
- Toast "The lost son {run} is published. Devices get it when they next
  sync."
- TRANS sees the guide on P-SUBMITTED.

Changed (2026-10-16, decision 134): no toast offers Undo; the guide editor's Undo and Redo arrows in the header take changes back.

### SETUP-057 Edit or adapt a guide; a draft is kept
Roles: ADMIN · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- "The lost son {run}" exists (SETUP-056).
- Resets: publishes a version and an adapted copy.

Steps:
1. Open "The lost son {run}" from Guides and Notes. Change a step title.
2. Close the app (or go Back) and reopen the guide.
3. Tap "Done".
4. Open an FIA guide from LangQuest (shared) and choose to adapt it.

Expected:
- The title is "Edit guide". Leaving publishes nothing. After reopening
  the change is there, with the saved mark's check (the "Your draft from
  {time} is open" banner is gone, decision 127). "Done" publishes it.
- If someone published meanwhile: "A newer version was published after you
  started this draft."
- Adapting: title "Adapt a guide", banner "Adapted from someone else's
  guide" with the licence's terms; a share-alike licence is locked.

### SETUP-058 Guide films play only on the web
Roles: ADMIN, TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions (in addition to the global ones):
- "The lost son {run}" has a film (SETUP-056).

Steps:
1. ADMIN on a phone: open the guide in the editor → "Media".
2. TRANS on a phone: open its study step with the film.
3. TRANS on the web: open the same step and play the film.

Expected:
- Phones show "Add pictures, maps and films in the web app." with "Here you
  can rename them and write their captions." and no add buttons.
- On a phone the film says "Films play in the web app for now."
- On the web the film plays.

---

## Licence

### SETUP-059 The licence is shown to everyone who manages, changed by an organization admin
Roles: ADMIN, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- ORG is "All rights reserved" (fixture).

Steps:
1. Org home. Read the licence under the name in the top card.
2. Tap it. ADMIN: tap "CC BY 4.0", then "Back" without confirming.

Expected:
- The licence reads "All rights reserved"; a screen reader hears "License:
  All rights reserved. Only your organization". It is no longer a row in
  Setup (decision 138).
- COORD: view mode, "Only an organization admin can change this.".
- ADMIN: "Who may use your work" with "Opening up is permanent: anyone who
  copies your work keeps these terms." Picking shows "Open to CC BY 4.0";
  for an open licence, "People outside can hear your team" with "Anyone
  will be able to listen to your recordings…".
- Nothing changes when ADMIN goes back.

### SETUP-060 The licence only opens, never closes
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: permanent. Run last in the file; reload the fixture after.

Steps:
1. Org home → the licence under the name in the top card.
2. Tap "CC BY-NC-ND 4.0". Tap "Open to CC BY-NC-ND 4.0".
3. Read the confirmation. Tap "Yes, open to CC BY-NC-ND 4.0".
4. Open the sheet again. Tap "All rights reserved".
5. Signed out on another device, look for ORG's listed language under Look
   around first.

Expected:
- The confirmation is "This can't be undone" with "You will not be able to
  close it again.", "Yes, open to CC BY-NC-ND 4.0" and "Back".
- Toast "Your work is now under CC BY-NC-ND 4.0." with no Undo. The
  licence under the name reads "CC BY-NC-ND 4.0".
- In step 4 "All rights reserved" is locked with "Your work is already more
  open than this"; nothing offers to close it (decision 38).
- Outsiders may now listen to the listed language's work.

---

## Scope limits on setup

### SETUP-061 LADMIN's Manage tab is Alpha's page
Roles: LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Tap the Manage tab.
2. Read the top and the rows.
3. Open Map → All languages → "Bravo".

Expected:
- Alpha's page opens with no Back button. Where Back would be, "UI Test
  Org" opens the organization's page (decision 138).
- The rows are on the page, with no "More": "Content template",
  "Reference material", "Review flow", "People", "Roles", "Languages",
  "Show on the public list". There is no "Members" or "Review groups" row.
  Its name is renamed from the pencil beside the title.
- LADMIN may rename and link Alpha and change its listing (SETUP-007 to
  SETUP-009).
- Bravo shows none of its setup ("Content template", "Get Bravo ready",
  "Who checks the recordings?") and none of its work to LADMIN, who has no
  role there (see PEOPLE-047).

### SETUP-062 LADMIN chooses Alpha's own template and flow
Roles: LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- ORG's library has a second template (ADMIN follows LangQuest's "FIA
  passages" first).
- Resets: changes and changes back.

Steps:
1. Alpha's page → "Review flow" → "All review flows". Tap "Use" on "Quick
   Check" (its checks are copied into Alpha). Then "Use" on "Standard Bible
   Flow".
2. Go back to Alpha's Review flow page → "Edit" → "Final approval" →
   "Remove this check", and "Remove this check" again in the sheet that
   asks. Then "Add a check" → "Final approval".
3. Alpha's page → "Content template" → "FIA passages" → "Use FIA
   passages". Then, from the same list, "FIA passages (English)" → "Use FIA
   passages (English)".
4. Open Sync.

Expected:
- Each change toasts as for ADMIN, with no Undo. "Use" asks nothing:
  Alpha's checks are still as a ready-made set made them (SETUP-044).
- Each second half of a step puts Alpha back: Standard Bible Flow's
  checks, Final approval at the end of the checks again ("Alpha's checks
  saved"), and FIA passages (English).
- The Content template page lists only the organization's own templates
  under the one in use (no LangQuest template such as "By chapter"): using another
  organization's would follow it, a library write (decision 138).
- Sync shows "refused by the server" at 0: these are Alpha's own events,
  which LADMIN may write at Alpha.

Changed (2026-10-16, decision 134): no toast offers Undo; each change is put back by choosing the earlier flow, check or template again.

### SETUP-063 LADMIN is not offered the organization's library writes
Roles: LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Alpha's page → "Content template". Open "Each book's passages" →
   "Luke". Go back twice. Open "View".
2. Alpha's page → "Review flow" → "All review flows".
3. Org home ("UI Test Org" above Alpha's title, where Back would be) →
   Setup → Content templates. Open a shared template ("Bible chapters
   (English)").
4. Open Sync.

Expected:
- The Content template page offers "View" and "Each book's passages",
  never "Edit" (decision 138). Luke reads "Called Luke in Alpha" and
  offers no "Divide differently". "View" opens the template read only:
  no "Copy to change it", "Create template", "Done" or saved mark.
- Review flows offers "Use" (Alpha's own checks) but no "New flow",
  "Follow", "Copy" or "Add to your flows".
- Content templates offers "View" but no "Options" or "Template"; a shared
  template's sheet offers no "Follow" or "Copy".
- Nothing goes to the organization's stream to be refused (G10.2).

Fixed (2026-10-12): the screens asked `session.can`, which counts LADMIN's
Alpha role, so they offered library writes the server refuses (some with a
success toast first). They now ask `mayWriteLibrary` (library/model.ts):
the privilege at organization scope, as core `languageOfOrgEvent` and SQL
`may_emit` do. Unit test in `libraryModel.test.ts`.

### SETUP-064 LADMIN's Bibles: Recommend and Hide work, "Add a Bible" is refused
Roles: LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Online.
- Resets: changes Alpha's recommendations and undoes them.

Steps:
1. Alpha's page → "Reference material" → "All reference material" →
   "Bibles".
2. "Stop recommending here" on the organization's English Bible; then
   "Recommend here" on it.
3. "Recommend here" on a library Bible that is not recommended.
4. "Add a Bible" → "From LangQuest" → pick one → "Add and recommend".
5. Open Sync.

Expected:
- "Bibles" reads "What this language’s team is offered".
- Steps 2–3 work, each toast with no Undo ("… is no longer recommended to
  this language's team.", "… is recommended to this language's team."):
  these are Alpha's own events. The row's one button changes each back
  ("Recommend here", "Stop recommending here"). (No Bible locally: preview
  environment.)
- "Add a Bible" is not offered: it follows LangQuest's Bible or publishes
  Bible Brain's in the organization's library.

Fixed (2026-10-12): "Add a Bible" is offered only with organization-scope
Manage reference (`mayWriteLibrary`).

Changed (2026-10-16, decision 134): no toast offers Undo; the row's own button changes it back.

### SETUP-065 LADMIN's guides and organization-wide material
Roles: LADMIN · Priority: P2 · Platforms: Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Alpha's page → "Reference material" → "All reference material". Look
   for "Write a guide" and "Follow".
2. Tap "Add material": with one kind to make, it opens at once. Look for
   "Where it applies".
3. Make a note for Alpha. Tap "Add material".
4. Open it. Look for "Publish to library".

Expected:
- "Where it applies" is not offered (it needs organization-scope Manage
  reference), so the material is Alpha's own. Step 2 saves: "{title}
  added."
- "Publish to library", "Write a guide", "A note placed by verses",
  "Follow" and "Copy" are not offered.

Fixed (2026-10-12): those publish library versions, which need
organization scope; they now ask `mayWriteLibrary`.

### SETUP-066 Members without setup privileges never reach setup screens
Roles: TRANS, REV, TREV, VIEW, KEPT · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Look for a Manage tab.
2. On the web, type the path of a setup screen (for example the language
   page or Content templates) into the address bar.
3. Open a passage's "What helps" and the study; look for setup controls.

Expected:
- No Manage tab, and no setup rows anywhere (README role matrix): the
  language page's address shows no "Content template", "Review flow" or
  "Reference material".
- A setup screen reached by any route shows "You don't have permission to
  open that." or "That can't be opened from here." and does not crash
  (G10.6).
- No "Get ‹language› ready" card on My Work.
