# 03 Home and navigation (`NAV`)

Tabs per role, My Work, the bell and the Inbox, the viewer's overview, flow
gates, Back and ✕, the crash screen, toasts and notification taps.

Read with the [README](README.md): its global preconditions G1–G10, the
fixture world and the role matrix hold for every test here.

- `{TRANS}`, `{COORD}` and so on stand for that account's display name.
- "Alpha" is LANG-A's name, "Bravo" is LANG-B's, and "UI Test Org" is ORG's.
- TRANS recorded every published fixture passage, and COORD made the record
  requests on P-NEW and P-Q1..P-Q4.
- Help mode (the ? in the header) stays off. While it is on, the bell,
  the quiet links and the tiles show a tooltip instead of acting.

Sources: `src/session.ts` (`homeScreenFor`, `mapScreenFor`,
`manageHomeFor`, `tabsFor`, `edgeAllowed`), `src/layout.ts`
(`chromeVisible`), `App.tsx` (navigation guard, tab press, toasts,
`ScreenBoundary`, notification taps), `src/screens/work.tsx`,
`src/simple/home.tsx`, `src/screens/account.tsx` (`InboxHome`) and
`src/screens/map.tsx` (`StatusHome`).

Layers (decision 102): the per-role tables for NAV-001 to NAV-004, NAV-010
and NAV-050 (home, tabs, what the Map and Manage tabs open, the gated edges)
are held by `apps/mobile/test/navMatrix.test.ts`, one `it` per spec ID.
The web tests prove one role each reaches the glass, titled `NAV-00N ROLE`.

## Tabs and where they go

### NAV-001 Tabs on a phone, per role
Roles: ADMIN, COORD, LADMIN, TRANS, REV, TREV, VIEW, KEPT, NOORG · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Fresh install for each role. The first-sign-in welcome has been passed once
  for that account (01 AUTH).

Steps:
1. Sign in as the role.
2. Wait for the home screen to settle (no "Loading your work…" and no
   "Loading…").
3. Read the tab bar from left to right.
4. Note which tab is lit and the header title.

Expected:
- The rows below hold exactly. No other tab shows.

  | Role | Home (header title) | Tabs, left to right | Lit tab |
  | --- | --- | --- | --- |
  | ADMIN | "My Work" | "Work", "Map", "Manage", "Me" | "Work" |
  | COORD | "My Work" | "Work", "Map", "Manage", "Me" | "Work" |
  | LADMIN | "My Work" | "Work", "Map", "Manage", "Me" | "Work" |
  | TRANS | "My Work" | "Work", "Map", "Me" | "Work" |
  | REV | "My Work" | "Work", "Map", "Me" | "Work" |
  | TREV | "My Work" | "Work", "Map", "Me" | "Work" |
  | VIEW | "Progress" | "Map", "Inbox", "Me" | "Map" |
  | KEPT | "My Work" | "Work", "Map", "Me" | "Work" |
  | NOORG | the "Join your team" screen (02 NOORG) | no tab bar | — |

- No "Reports" tab on a phone, for any role.
- Nobody with a "Work" tab has an "Inbox" tab.
- The "Work" tab never carries a count.
- The lit tab is in the brand colour and is announced as selected.
- Fixed (2026-10-13): on the web, no tab is marked selected for a
  screen reader. `NavChrome.tsx` passes `accessibilityState={{ selected }}`,
  which the web export does not turn into `aria-selected`. The Playwright
  tests read the lit tab by its colour meanwhile.

### NAV-002 What the Map tab opens, per role
Roles: ADMIN, COORD, LADMIN, TRANS, REV, TREV, VIEW, KEPT · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. From the home screen, tap "Map".
2. Read the header.
3. Look for a Back arrow in the header.

Expected:
- ADMIN, COORD, LADMIN and VIEW see "Progress" with the sub "UI Test Org · All
  languages", and no Back.
- TRANS, REV, TREV and KEPT see "Alpha", LANG-A's map, with no Back. The
  search field reads "Find “John 3”".
- LADMIN gets All languages because a manage privilege gives it an admin
  scope (`mapScreenFor`), even though it can also record and review.
- The "Map" tab is lit.

### NAV-003 What the Manage tab opens
Roles: ADMIN, COORD, LADMIN · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Tap "Manage".
2. Read the header.
3. Tap "Manage" again.

Expected:
- ADMIN and COORD land on the organization's home for "UI Test Org" (09
  SETUP and 10 PEOPLE cover what is on it).
- LADMIN lands on Alpha's language page, not the organization's home.
- LADMIN's page does not offer Bravo or the organization's setup.
- Tapping "Manage" again while on its home does nothing: the screen does not
  flash or reload.

### NAV-004 The Reports tab shows only on wide windows
Roles: ADMIN, TRANS, VIEW · Priority: P1 · Platforms: Wide, Web · Run: Auto

Steps:
1. Sign in on a phone-width window (Web at 390 px) and read the tabs.
2. Widen the browser to 1100 px or more (or use the iPad simulator).
3. Read the rail or sidebar.
4. Narrow the window back to phone width.

Expected:
- At phone width there is no "Reports".
- When wide, "Reports" sits right after "Map": ADMIN "Work", "Map",
  "Reports", "Manage", "Me"; TRANS "Work", "Map", "Reports", "Me"; VIEW
  "Map", "Reports", "Inbox", "Me".
- When the window narrows again, "Reports" goes away. If the Reports screen
  was showing, the app does not crash (14 RPT and 15 WEB cover the screen).

### NAV-005 Pressing a tab resets its stack
Roles: TRANS, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. TRANS: tap "Map", tap "Luke", then tap chapter 15.
2. If a sheet "Luke 15" opens, tap the first passage. The passage record
   opens with no tab bar.
3. Tap Back twice to return to the Luke chapter grid.
4. Tap "Work", then tap "Map".
5. COORD: tap "Map", then "Alpha", then "Luke".
6. Tap "Map".

Expected:
- After step 4, "Map" opens on Alpha's map (the book list), not on Luke's
  chapters.
- After step 6, COORD is back on "Progress", not on Alpha or Luke.
- A tab switch crossfades. It does not slide like a push.

### NAV-006 The tab bar is hidden on a passage and its pages on a phone
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. On My Work, tap "Start" on Next for you. The passage record opens.
2. Tap "Versions and history", then the published version if there is one,
   or go back and open P-SUBMITTED from the Map and tap the Record step.
3. Open "Something else?", then "What helps here".
4. Go back to My Work.

Expected:
- On a phone there is no tab bar on the passage record, the version page,
  the review page or the "Reference" page.
- The tab bar is back on My Work, the language map, a book's chapters and the
  Inbox.
- On a wide window (repeat on Wide) the rail or sidebar stays on the passage
  record and its reading pages.

### NAV-007 Task screens hide the tabs and close with ✕
Roles: TRANS, REV · Priority: P1 · Platforms: iOS, Android, Web, Wide · Run: Auto

Steps:
1. TRANS: open P-ASIDE (its Peer check is not asked yet, so "Someone else
   should do this" is offered; PASS-027). Tap "Something else?".
2. Tap "Someone else should do this". Ask someone opens.
3. Tap ✕.
4. On "Something else?", tap ✕.
5. REV: open P-SUBMITTED, tap "Do the peer check", then ✕ on the review
   screen.

Expected:
- "Something else?", Ask someone and the review screen show ✕ at the top
  left, not a Back arrow.
- There is no tab bar on them on a phone. Ask someone and the review screen
  have none at any width, Wide included. "Something else?" is a page of the
  passage record, so on a wide window it keeps the rail like the record
  (decision 55, NAV-006).
- Each ✕ returns to where it was opened, with nothing saved: Ask someone's
  to "Something else?", and "Something else?"'s to the record's path
  (screen-path: "✕ to the passage").
- The passage record itself has a Back arrow, not ✕.

### NAV-008 Which tab is lit
Roles: TRANS, VIEW · Priority: P2 · Platforms: Wide, Web · Run: Auto

Steps:
1. TRANS on a wide window: tap the bell on My Work. The Inbox opens.
2. Go back. Tap "Map", tap "Luke", then a chapter.
3. VIEW: tap a language on "Progress", then a book, then a passage.

Expected:
- With the Inbox open from the bell, "Work" stays lit.
- On the chapter grid and the passage opened from it, "Map" is lit.
- For VIEW, "Map" stays lit all the way down to the passage.

## My Work

### NAV-010 My Work's header
Roles: ADMIN, COORD, LADMIN, TRANS, REV, TREV, KEPT · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open "Work".
2. Read the header.

Expected:
- Title "My Work", sub "Alpha · UI Test Org".
- No Back arrow.
- On the right is the bell, spoken as "Updates" or "Updates, {n} new".
- No sync chip, while everything is sent and the device is online (G7).

### NAV-011 Next for you: a record request opens the passage
Roles: TRANS · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open My Work.
2. Read the first card.
3. Tap "Start".

Expected:
- The card is labelled "Next for you". Its title is the newest request:
  requests lead newest first (core `highlightsFor`). With the fixture that
  is P-Q4, Luke 13:31–35, asked after P-NEW.
- The sub reads "Record it · asked by {COORD}". No due date shows
  (decision 126).
- "Start" opens that passage's record, with "Record" as its main button
  (PASS-001).
- Back on the record returns to My Work.

### NAV-012 Then: three rows, and the rest one tap on
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open My Work.
2. Read the section under Next for you.
3. Tap "{n} more for you".
4. Tap "Fewer".

Expected:
- The section is labelled "Then", with exactly three rows: P-Q3, P-Q2 and
  P-Q1.
- The toggle reads "3 more for you". TRANS has 7 highlights: 5 record
  requests, the P-DRAFT draft and P-NEEDS feedback. One leads and 6 are
  listed.
- Requests come first, then drafts, then feedback.
- Record rows have a mic icon and the sub "Record · asked by {COORD}".
- The P-DRAFT row's sub reads "Finish recording".
- The P-NEEDS row has an amber chat icon and reads only "Feedback to hear".
- After "3 more for you", all 6 show and the toggle reads "Fewer". "Fewer"
  goes back to three.
- Tapping P-NEEDS opens its record, with "Hear the feedback" as its main
  button. Tapping P-DRAFT opens its record with "Continue recording".

### NAV-013 Next for you: a check, and a back translation
Roles: REV · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open My Work.
2. Read the Next for you card and the "Then" row.
3. Tap the "Then" row. Note where it opens, then tap ✕.
4. Tap "Start" on the card. Note where it opens, then tap ✕.

Expected:
- One of P-SUBMITTED (Peer Review) and P-BT (Back Translation) leads, the
  newer request first. The other is the only "Then" row.
- Each check goes by its one name (decision 91, `checkName`). The review's
  sub reads "Peer check · asked by {TRANS}". As a "Then" row, its title is
  "Check Luke 15:11–32" with a check icon.
- The back translation's sub reads "Back translation · asked by {TRANS}".
  As a row it has a globe icon.
- With the fixture P-BT leads: TRANS asked its Back Translation after the
  Peer Review of P-SUBMITTED.
- "Start", or tapping the row, opens the review screen ("Review it", 07 REV)
  straight away for the Peer Review. For the Back Translation it opens the
  back translation screen. Neither passes through the passage record.
- ✕ returns to My Work.

### NAV-014 A good place to start, when nothing is asked
Roles: TREV, KEPT · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open My Work.
2. Read the first card and tap "Start".

Expected:
- The card is labelled "A good place to start". Its title is the first
  passage in Alpha that nobody has recorded and nobody is drafting
  ("Matthew 1:1–17" with the fixture).
- The sub reads "Nobody has recorded it yet · you don't need to be asked".
- The section under it, if any, is labelled "Also for you", not "Then".
- "Start" opens that passage's record, with "Record" as its main button
  ("Study" while a passage's FIA study is not done).
- "Everything in Alpha" shows among the quiet links and opens Alpha's map.

### NAV-015 Waiting on others opens in place
Roles: COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open My Work.
2. Tap "Waiting on others · {n}".
3. Read the rows.
4. Tap the P-NEW row.

Preconditions (in addition to the global ones):
- COORD asked the Peer check's team (decision 91: "Ask the Peer check team")
  for P-ASIDE's Peer check.
- Resets: P-ASIDE's Peer check is asked of its team.

Expected:
- The toggle reads "Waiting on others · 6": the five record requests and the
  team request.
- It expands under itself. No new screen opens.
- Each row has a clock icon, the passage title, and the sub "Recording ·
  {TRANS} · asked {when}".
- The team request reads "Peer check · the Peer check team · asked {when}":
  the check by its one name, and the team, never "someone".
- Rows are newest first. No due date shows (decision 126).
- Tapping P-NEW opens its record. Back returns to My Work with the list
  still open.
- Fixed (2026-10-12): a request made to a check's team named "someone"
  (`work.tsx` `waitingText`). It now names the team, by the check's name for
  a check's own team (`homeModel.ts` `waitingWho`).

### NAV-016 Opened lately opens in place
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Fresh install.

Steps:
1. From the Map, open P-SUBMITTED, P-CHECK, P-ASIDE, P-DONE, P-S, P-T and
   Luke 12:22–34, going Back after each.
2. Open My Work. Tap "Opened lately · {n}".
3. Tap the first row.

Expected:
- The toggle reads "Opened lately · 5". It expands in place.
- Rows are newest first: Luke 12:22–34, P-T, P-S, P-DONE, P-ASIDE. The cap
  is five (P-CHECK drops off), and passages already on My Work are left out
  (P-SUBMITTED is under "Waiting on others": TRANS asked its Peer Review).
- Each row's sub is the passage summary, for example "Not started" or
  "Recorded · done", with step marks on the right for recorded passages.
- Tapping a row opens that passage.

### NAV-017 Nothing is waiting on you
Roles: REV, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- REV: REV has done the Peer Review on P-SUBMITTED and the Back Translation
  on P-BT (07 REV), and checked P-ASIDE, which nobody had. Every recorded
  passage in Alpha now has a review (otherwise "A good place to start"
  offers the first one without).
- The REV half is automated (03-home-and-navigation-b.spec.ts). The COORD
  half needs Bravo given a template in 09 SETUP and is run by hand.
- COORD: Bravo was given a template whose books are all still waiting to be
  divided, and a review flow and translators (09 SETUP), so it is ready and
  has no passages. COORD has Bravo open.
- Resets: REV's two requests are done.

Steps:
1. Open My Work.
2. Read the card and the quiet links.

Expected:
- REV sees a green check card: "Nothing is waiting on you" with "Find any
  passage on the Map to keep going."
- COORD sees the same title with "Set up people, languages and review flows
  under Manage, or find any passage on the Map."
- COORD also sees "Divide {book}" with the reason it waits (NAV-022).
- "Everything in Alpha" (or "Everything in Bravo") shows, and opens the Map
  tab's screen.

### NAV-018 The coordinator's Get ready card
Roles: COORD, ADMIN · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Tap "Map", then "Bravo". Wait for its map to load.
2. Tap "Work".
3. Read the first card.
4. Tap "Choose".

Expected:
- My Work's sub reads "Bravo · UI Test Org".
- The first card is labelled "Get Bravo ready · {done} of 4", with a
  four-segment bar spoken as "{done} of 4 questions answered".
- The title is the first open question, in this order: "What will they
  record?", "What will help them?", "Who checks the recordings?", "Invite
  your translators". With the fixture it is "What will they record?".
- The button is "Choose". It opens Get ready at that question (09 SETUP):
  the header "Get Bravo ready", "{done} of 4", and the question as the
  screen words it, "What will Bravo translate?".
- No "Next for you" card shows while Get ready leads. Anything else is under
  "Also for you".
- The card goes away once template, flow and people are answered, even
  while "What will help them?" is still open. That is intended: decision 71
  (amended 2026-10-08) says what helps them "is asked but never required"
  (`adminModel.ts` readiness). The earlier known-issue note is retired.

### NAV-019 Join requests on My Work, for organization-scope admins only
Roles: ADMIN, COORD, LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- NOORG has asked to join ORG with the message "I translate for Alpha" (02
  NOORG).

Steps:
1. Open My Work (with Alpha open, and again with Bravo open).
2. Look at the list under the lead card.
3. ADMIN: tap the join row.

Expected:
- ADMIN and COORD see the row first in the list: "{NOORG} wants to join"
  with the sub "I translate for Alpha". Without a message, it reads "Asked
  just now" or "Asked {when}".
- The list is labelled "Also for you" under Get ready or a suggestion, and
  "Then" under Next for you.
- The bell's count includes the request.
- LADMIN sees no join row, and the bell does not count it. Join requests are
  read at organization scope only.
- Tapping the row opens the request, titled "{NOORG} wants to join", with
  the message in quotes ("“I translate for Alpha”") and "Let {first name}
  in" (10 PEOPLE).
- Offline, the row is gone but the bell keeps its count (not automated).

### NAV-020 A check asked of the admin, under Get ready
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Not automated yet: it needs a passage recorded in Bravo, which needs Bravo
given a template through 09 SETUP first.

Preconditions (in addition to the global ones):
- In Bravo, COORD chose a template and a review flow but invited no
  translators (09 SETUP), so Bravo is not ready.
- COORD recorded and published one passage in Bravo and asked ADMIN for its
  first check (PASS-038).

Steps:
1. ADMIN: open Bravo from the Map, then tap "Work".

Expected:
- The lead card is "Get Bravo ready · {done} of 4", titled with the first
  open question ("What will help them?" or "Invite your translators").
- Under it, "Also for you" lists "Check {passage}" with "{kind} · asked by
  {COORD}".
- Tapping the row opens the review screen.
- My Work lists only the open language. With Alpha open, this row is not
  shown. That is by design (decision 37: a phone works in one language at a
  time).

### NAV-021 An organization with no language: Add a language
Roles: NEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- NEW made a new organization, "UI Empty Org", from the no-organization
  screen (02 NOORG), and has no language yet.

Steps:
1. Open My Work.
2. Tap "Add a language".

Expected:
- The card is labelled "Get UI Empty Org ready", titled "Add a language",
  with the sub "The language your team speaks" and the button "Add a
  language".
- The header sub is "UI Empty Org" alone.
- The button opens New language (09 SETUP). Its Back returns to My Work.

### NAV-022 Divide a book from My Work
Roles: ADMIN, COORD, LADMIN, TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- At least one book of Alpha is listed but not yet broken up (MAP-023).
  The automated test leaves Jude so by hiding its passages.

Steps:
1. Open My Work.
2. Tap the "Divide …" row.

Expected:
- ADMIN, COORD and LADMIN see "Divide {book}" with a scissors icon, and
  the reason it waits: "{way} has no sections for {book}." (Alpha's way is
  FIA, which has none for Jude), followed by "{n} more books wait too." when
  there are several. A way chosen as "book by book" has no reason, so the row
  says "Waiting to be divided before anyone records it" (or "{n} books are
  waiting to be divided before anyone records them").
- Tapping it opens that book's screen in the open language (the book's
  header, e.g. "Jude").
- Updated (2026-10-13): main's decision 93 and "My Work: the reason a book
  waits fits beside it" (85934a9); the row used to open the Map tab's screen.
- TRANS does not see the row.

## The bell and the Inbox

### NAV-030 The bell's count and the Inbox, from My Work
Roles: TRANS · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Fresh install, so no update has been read on this device.

Steps:
1. On My Work, read the bell's badge and its spoken label.
2. Tap the bell.
3. Read the Inbox.
4. Tap Back.

Expected:
- The badge is amber and shows the count: at least 6 (five record requests
  and REV's feedback on P-NEEDS). Its spoken label is "Updates, {n} new".
- The Inbox opens with the header "Inbox" and a Back arrow. The tab bar
  shows on a phone, with "Work" lit.
- The first section is "Unread ({n})". It includes "{COORD's first name}
  asked you to record" ("Cora asked you to record"), with the body "Luke
  13:1–9 (Alpha)", and "Feedback on Luke 14:15–24" with
  "{REV}: Peer Review suggests changes — revise, or keep it and say why."
- None of the rows is TRANS's own act.
- Back returns to My Work.

### NAV-031 An update opens its passage and is marked read
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Tap the bell. Note "Unread ({n})".
2. Tap "Feedback on Luke 14:15-24".
3. Tap Back twice.

Expected:
- The update opens P-NEEDS's record.
- Back to the Inbox: the row has moved to "Earlier" and the unread count is
  one less.
- Back on My Work, the bell's count is one less.
- Read state is kept per device. A second device signed in as TRANS still
  counts it as unread.

### NAV-032 The Inbox when there is nothing
Roles: VIEW · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Tap "Inbox".

Expected:
- The header reads "Inbox" with no Back arrow (it is a tab).
- The empty state reads "Nothing yet" with "Requests and feedback about your
  passages show up here."

### NAV-033 The viewer's Inbox tab and its badge
Roles: VIEW, NEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- NEW holds a custom role "Asking viewer" at LANG-A scope, with Send to
  reviewers and View status only (10 PEOPLE makes the role and the invite).
  It counts as a viewer: home on "Progress", with an "Inbox" tab.
- From a passage's "Then the team" row, NEW asked REV for a check nobody had
  asked for yet, such as P-ASIDE's next check (PASS-038). REV then did it
  (07 REV).

Steps:
1. VIEW: read the "Inbox" tab.
2. NEW: read the "Inbox" tab and its spoken label.
3. NEW: tap "Inbox", then the unread update.

Expected:
- VIEW's tab has no badge. A plain viewer gets no record updates, because
  nothing is asked of them and they ask for nothing.
- NEW's tab shows a red badge "1", spoken as "Inbox, 1".
- The update reads "{REV's first name} did the {kind} you asked for"
  ("Rita did the Back Translation you asked for"). Tapping it opens the
  passage and the badge goes away.
- Automated with OWNER2 (of ORG2) standing in for NEW, asking REV for
  P-ASIDE's Back Translation (03-home-and-navigation-b.spec.ts).
- The Inbox has no Back arrow (it is a tab).

## The viewer's overview

### NAV-040 Progress, the viewer's home
Roles: VIEW · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Sign in as VIEW.
2. Read the screen top to bottom.

Expected:
- The header is "Progress", with the sub "UI Test Org · All languages" and
  no Back.
- The summary card reads "Across 2 languages · {n} passages" (or "{k} of 2
  languages counted · {n} passages" before the server has Bravo's figures).
  Under it are the big "{%} recorded" and "{%} done", and "{n} with
  reviewers", over a bar.
- The section "Languages" lists "Alpha" and "Bravo", sorted by name.
- Alpha's card shows the code tile, "{n} passages · Standard Bible Flow", a
  clock count when passages are with reviewers, and a bar with a legend.
  The legend has "Recorded", each step name (with a lock on "Consultant
  Check") and "Done".
- Alpha's card is spoken as "Alpha: {recorded} of {total} recorded. Open its
  map."
- The footer text begins "Each bar layers the steps of the language's review
  flow".
- No "Find a language" field shows (2 languages, not more than 5).

### NAV-041 Drilling into a language from Progress
Roles: VIEW, ADMIN · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. On "Progress", tap "Alpha".
2. Tap "Luke", then a chapter, then a passage if a sheet opens.
3. Tap Back until "Progress" shows.

Expected:
- Alpha's map opens with the title "Alpha" and a Back arrow.
- VIEW sees no "Next: …" link (no Translate or Review). ADMIN does.
- The passage opens read-only for VIEW, with no main button (PASS-009).
- Each Back returns one level: the chapters, then the map, then "Progress".
- "Map" stays lit throughout.

### NAV-042 A language lead opening a language outside its scope
Roles: LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Tap "Map". "Progress" lists Alpha and Bravo.
2. Tap "Bravo".
3. Look at the tab bar, then tap Back.

Expected:
- Intended: LADMIN either does not see Bravo, or sees it read-only, and
  keeps its tabs.
- Fixed (2026-10-12): Progress lists only the languages a role of the
  person's covers (`simple/mapModel.ts` `openableLanguages`), so LADMIN sees
  Alpha alone. Before, tapping Bravo made it the open language with no
  privileges (`hasNoOrg`): the tab bar went, and on the web the storage gate
  showed "LangQuest is open in another tab". The session itself still
  collapses if such a language is opened another way (a saved choice, a
  link); `languages.ts` `openLanguage` should prefer languages the person
  holds a role in (reported for the shared files).

## Permission gates

### NAV-050 Controls a role may not use are never offered
Roles: ADMIN, COORD, LADMIN, TRANS, REV, TREV, VIEW, KEPT · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Open P-SUBMITTED from the Map.
2. Read the main button, then open "Something else?" and read the options.
3. Tap the "Then the team" row for the first step and read its buttons.
4. Open P-CHECK and its Consultant Check row.

Expected:
- Each role sees only what the README role matrix allows:

  | Role | "Record" or "Record a new version" | "Review it now" or "Review it myself" | "Ask someone" or "Send to …" | "Already happened" | "Move past this checkpoint…" |
  | --- | --- | --- | --- | --- | --- |
  | ADMIN, COORD | yes | yes | yes | yes | yes |
  | LADMIN | yes | yes | yes | yes | no |
  | TRANS | yes | yes: "Review it myself", their own version (decisions.md 176) | yes | yes | no |
  | KEPT | yes | yes (Translator has Review, decision 91) | yes | yes | no |
  | REV | no | yes | no | yes | no |
  | TREV | yes | yes | yes | yes | no |
  | VIEW | no | no | no | no | no (team rows are not tappable) |

- No role is shown a control and then refused with "You don't have
  permission to open that." The refusal is never the way a role learns that
  it may not do something.
- The "Manage" tab shows only for ADMIN, COORD and LADMIN.

### NAV-051 Forced navigation is refused without a crash
Roles: TREV, VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Manual

Preconditions (in addition to the global ones):
- A second device signed in as ADMIN.

Steps:
1. TREV: open P-SUBMITTED and tap its first "Then the team" row. The step
   sheet shows "Review it now".
2. On the second device, ADMIN changes TREV's role to "Translator" (10
   PEOPLE).
3. Before TREV's sheet redraws, tap "Review it now".
4. As VIEW on web, type a deep address such as `/map/language`, then a
   screen's address that VIEW may not open.

Expected:
- If the gate is reached, the app shows the toast "You don't have permission
  to open that." and stays where it was.
- An undeclared move shows "That can't be opened from here.", unless the
  target is a tab screen, which the app resets to.
- The app never crashes, and never opens a screen the session may not use.
- A web address VIEW may not open falls back to VIEW's home.
- Known issue (2026-10-12): no screen offers a gated control by design, so
  steps 1–3 only reach the guard if the role change lands between the sheet
  drawing and the tap. Add a dev-only hook to drive `go()` so this runs on
  every build. `flow.test.ts` covers the guard meanwhile.
- Step 4 is automated on the web: VIEW opening "/manage", "/work" and
  "/manage/language" lands on "Progress" with no crash.

## Back, ✕ and the hardware back button

### NAV-060 Header Back and ✕
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. On My Work, tap "Start" on Next for you. Read the header.
2. Tap "Versions and history". Read the header.
3. Tap ✕, then tap "Something else?". Read the header, then tap ✕.
4. Tap Back on the record.

Expected:
- The passage record has a Back arrow: the title is the passage, and the
  sub is "Alpha".
- "Versions" and "Something else?" have ✕. Each returns to the record's
  path.
- The record's Back returns to the screen it came from (My Work here, the
  chapter grid or the map otherwise).
- On iOS, a swipe from the left edge does the same as Back on the record.

### NAV-061 Android's back button
Roles: TRANS · Priority: P1 · Platforms: Android · Run: Auto

Steps:
1. Open P-ASIDE from Alpha's map (Luke, chapter 16). Tap "Something else?".
2. Press the system back button.
3. Tap "Versions and history", then press back.
4. Tap "Something else?", "Someone else should do this", then press back
   twice.
5. Press back on the record, then on the chapter grid, then on the map.
6. Press back on My Work, then again straight away.

Expected:
- Back from "Something else?" and from "Versions" returns to the record's
  path. It does not leave the record.
- Back from Ask someone returns to "Something else?", where it was opened,
  with nothing sent; back again returns to the path.
- Back from the record returns to the chapter grid, then to the map.
- Back on a tab's own page (the map, which is TRANS's Map tab) goes to My
  Work, TRANS's first screen (decision 137). It never leaves the app or
  shows a blank screen.
- The first back on My Work stays and says "Press Back again to leave
  LangQuest" above the tab bar, covering no button; the second, while those
  words show, leaves the app. Sign In, Join your team and the welcome do the
  same.
- Inside a screen's steps (New language, Get ready, a review's questions, a
  study's steps, the recording view), back goes one step back, as the
  step's own Back does; on the first step it leaves the screen. ✕ leaves at
  once.

## The crash screen

### NAV-070 A screen that cannot draw offers a way out
Roles: TRANS, VIEW · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions (in addition to the global ones):
- A dev build with a temporary change that throws while drawing the passage
  record (never committed). No other way to force a render error exists.

Steps:
1. Open any passage.
2. Read the screen.
3. Tap "Go back". Open the passage again, and tap "Go to My Work".

Expected:
- The screen reads "This screen could not open", then "Your recordings and
  everything you saved are safe on this device.", then "If it keeps
  happening, tell your team this code: {code}". The code can be selected.
- The tab bar, if the screen had one, still works.
- "Go back" returns to the previous screen. "Go to My Work" resets to the
  role's home.
- For VIEW, "Go to My Work" opens "Progress". Fixed (2026-10-13): the
  label says My Work for a role that has none. It should read "Go home" or
  the home's name (`App.tsx` `ScreenBoundary`; a patch is reported for the
  shared file).
- The code is found by `npm run diag` (G9).

## Toasts

### NAV-080 How long a toast stays
Roles: TRANS · Priority: P1 · Platforms: iOS, Android · Run: Device

Steps:
1. Open P-SUBMITTED. Open "Versions and history" → "History" and tap
   "Withdraw" on the open request. Time the toast.
2. Open P-Q4 (Luke 13:31-35). Tap its first "Then the team" row and set the
   Back translation aside with "Not needed for this passage" (PASS-023). Time
   the toast without tapping it.
3. Turn on VoiceOver (iOS) or TalkBack (Android). Repeat step 2 on P-Q3, and
   time the toast again.
4. Still on P-Q3, open "Versions and history" → "History" and tap "Undo" on
   "Back translation set aside".

Resets: undo P-Q4's set aside from "Versions and history" → "History", and
ask REV again for P-SUBMITTED's Peer check.

Expected:
- Every toast lasts about 3.5 s: "Request withdrawn" and "Back translation
  set aside · reason saved" alike. Neither has "Undo": each has only a close
  ✕ ("Close"), and a bar along its foot counts down until it goes.
- With a screen reader on, the toast lasts about 7 s, twice as long. The
  reader speaks the message only, "Back translation set aside · reason
  saved", with nothing about Undo.
- Step 4 brings the step back: the toast reads "Brought back — it's a
  suggested step again", and the entry reads "… · brought back just now"
  (G10.5).
- On web, toasts are never doubled (the web cannot tell if a screen reader
  is on).

Changed (2026-10-16, decision 134): no toast offers Undo; every toast lasts 3.5 s (7 s with a screen reader on a phone), and History's Undo brings a set-aside step back.

### NAV-081 A toast never covers the main button
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Steps:
1. On P-NEEDS's record, set a check aside so that its toast shows.
2. While it shows, look at the footer.

Expected:
- The toast sits above the footer. "Something else?" and "Versions and
  history" stay visible and can be tapped.
- A new toast replaces the old one. They do not stack.

Changed (2026-10-16, decision 134): no toast offers Undo; any toast will do here, and History's Undo brings the check back.

## Notifications

### NAV-090 Tapping a push notification
Roles: TRANS, VIEW · Priority: P1 · Platforms: iOS, Android · Run: Device

Preconditions (in addition to the global ones):
- Notifications allowed on a real phone (11 ACCT).
- TRANS: COORD asks TRANS to record Luke 16:16-18 from a second device.
- VIEW: a notification that reaches a viewer, for example a test push sent
  from the server to VIEW's device.

Steps:
1. Put the app in the background.
2. Wait for the notification. Tap it.
3. Repeat with the app killed.

Expected:
- TRANS: the app opens on the Inbox over My Work, with a Back arrow to My
  Work. The new request is under "Unread".
- VIEW: the app opens on the "Inbox" tab.
- The tap never opens the passage directly. That is the current design:
  every notification opens the Inbox.
- From a killed state, the app opens after sign-in is restored, not on Sign
  In.

## Sync chip

### NAV-095 The sync chip on My Work
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Turn the network off. Read My Work's header.
2. Open P-NEW, add the note "offline note" from "Something else?", and go
   back to My Work.
3. Turn the network on and wait 30 seconds.

Expected:
- Offline, a small chip reads "Offline" beside the bell.
- With the note waiting, it reads "1 to send".
- Tapping the chip opens Sync (12 SYNC).
- Back online, the chip goes away once the note is sent (G10.3).
