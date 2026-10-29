# 14. Reports (RPT)

The Reports section (decision 57): the organization's figures across every
language, read from the reports server. It exists only on a wide window (a
tablet, or a browser 768 px or wider) and only for people who may view
status. A phone never has it.

Read [the README](README.md) first: G1 to G10, the fixture and the accounts
apply here.

Platform for every test: Wide (an iPad simulator, or Chrome at least
1100 px wide), unless the test says otherwise. On the web, server answers
can be faked with Playwright routes on `/api/orgs/{orgId}/reports`.

Reports need a connection. Figures come from the projection worker, which
runs every minute on the local stack, so work done on a device shows after
it syncs and the worker has run; tap "Refresh" to ask again.

---

## The Reports tab

### RPT-001 The Reports tab is there for anyone who may view status
Roles: ADMIN, COORD, LADMIN, TRANS, REV, TREV, VIEW, KEPT · Priority: P1 · Platforms: Wide · Run: Auto

Preconditions: None.

Steps:
1. Look at the rail or sidebar.
2. Tap "Reports".

Expected:
- "Reports" sits right after "Map" in the tabs, with its own icon.
- Step 2 opens the Reports section on "Overview" (RPT-003).
- The tab bar order otherwise matches the README's role table (for
  example TRANS: Work, Map, Reports, Me; VIEW: Map, Reports, Inbox, Me).

### RPT-002 Never on a phone, and not without an organization
Roles: TRANS, NOORG · Priority: P1 · Platforms: iOS, Android, Web, Wide · Run: Auto

Preconditions: None.

Steps:
1. TRANS on an iPhone, an Android phone, and Chrome 767 px wide: look at
   the tabs.
2. TRANS in Chrome 1200 px wide on Reports: narrow the window to 700 px.
3. Widen it again to 1200 px.
4. NOORG on a wide window: look for Reports.

Expected:
- Step 1: no "Reports" tab on any of them.
- Step 2: the app leaves Reports for a screen a phone has, with the bottom
  bar (without "Reports"), and no crash.
- Step 3: "Reports" comes back.
- Step 4: NOORG is on "Join your team" with no tabs, and no way to Reports.

Fixed (2026-10-13): nothing moves the app off Reports when the window
narrows. Reports stays on screen with no tab bar and no Back (it is not a
phone screen), so the person is stuck until they widen the window or
reload. Confirmed on the web (2026-10-13); the fix is in App.tsx.

---

## The Reports section

### RPT-003 Reports opens on Overview
Roles: COORD · Priority: P1 · Platforms: Wide · Run: Auto

Preconditions: None.

Steps:
1. Tap "Reports" and watch it load.

Expected:
- While loading: "Loading reports…".
- Then the header "Overview", with "Reports" under it (the sidebar names the
  organization), and a button "Refresh" (a round arrow and the word) at
  the right.
- Chips that wrap onto a second line rather than run off the edge, all in
  sight: "Overview" (on), "Recent activity", "Languages", "Geography",
  "Field report", "Monthly ledger", "Pace", "Alerts".
- When any alert needs someone, Overview starts with an amber notice
  ("{n} need(s) someone") and a button "Alerts" that opens that section.
- A cluster or country filter row starts with its name ("Cluster",
  "Country"), and a country chosen is named in the header's line too.
- The content is in a centred column, with the sidebar or rail beside it.

### RPT-004 Each chip opens its section
Roles: COORD · Priority: P1 · Platforms: Wide · Run: Auto

Preconditions: None.

Steps:
1. Tap each chip in turn: "Recent activity", "Languages", "Geography",
   "Field report", "Monthly ledger", "Pace", "Alerts", "Overview".

Expected:
- Each tap lights that chip and the header's title becomes the section's
  name.
- No section is blank or shows an error; one with nothing to show says so
  in words.
- If any alert needs someone, the "Alerts" chip shows its count, and a
  screen reader reads "Alerts, {n} need(s) someone". The count equals the
  alerts listed in the Alerts section.
- "Languages" lists LANG-A ("Alpha") and LANG-B ("Bravo"). Tapping Alpha
  opens its page (RPT-013).
- "Field report" has "Copy as text" on the web, "Share as text" on a
  tablet, and the periods "Weekly", "Monthly", "Year to date". On the web,
  copying says "Copied. Paste it into an email or a message."

### RPT-005 The figures match the fixture
Roles: COORD · Priority: P1 · Platforms: Wide · Run: Manual

Preconditions:
- A fresh fixture, with no test in this run having recorded anything yet.
- Two minutes have passed since the fixture was built.

Steps:
1. Tap "Reports", then "Refresh".
2. Open "Languages", then "Alpha".
3. On the device, open the Map for LANG-A and count the passages per state.

Expected (Alpha's page):
- "Passages" is the number of passages in LANG-A's template (the Map's
  count).
- Recorded: 6 (P-SUBMITTED, P-NEEDS, P-BT, P-CHECK, P-ASIDE and P-DONE
  have a published version; P-DRAFT does not).
- Done: 1 (P-DONE).
- "Where passages stand": "Done" 1, "Feedback to answer" 1 (P-NEEDS), "In
  review" 4 (P-SUBMITTED, P-BT, P-CHECK, P-ASIDE), "Being recorded" 1
  (P-DRAFT, once its parts have synced), and "Not started" the rest.
- "Needs attention": "Feedback to answer" 1, "At a checkpoint" 1 (P-CHECK),
  "Open requests" the count of Alpha's open requests (at least the five
  record requests), with no sub line. Tapping it opens the Map filtered to
  waiting passages. There is no "Overdue requests" tile (decision 126).
- "Review flow" lists Standard Bible Flow's four steps in order;
  "Consultant Check" has the "Checkpoint" badge and at least 1 waiting.
- "Bravo" (LANG-B) shows no passages.
- Every figure agrees with the Map in step 3. Note any that does not, with
  both numbers.

### RPT-006 Each role sees the languages its role covers
Roles: VIEW, TRANS, LADMIN · Priority: P1 · Platforms: Wide · Run: Auto

Preconditions: None.

Steps:
1. Tap "Reports", then "Languages".

Expected:
- VIEW (organization scope): Alpha and Bravo.
- TRANS and LADMIN (LANG-A scope): Alpha only.
- Nobody sees a language of ORG2.

### RPT-007 Refresh shows new work
Roles: COORD, TRANS · Priority: P1 · Platforms: Wide · Run: Auto

Preconditions:
- Device 1 (COORD) is on Reports, "Languages".

Steps:
1. Device 2 (TRANS): record and publish Version 1 of P-NEW. Wait until it
   has synced.
2. Wait two minutes. Device 1: tap "Refresh".

Expected:
- While it asks, "Refresh" cannot be tapped again.
- Alpha's recorded count goes up by 1.
- Alpha's page says "Figures as of {when} ({ago}). Work recorded offline
  appears after the device syncs." with a recent time.

Resets: P-NEW has Version 1.

### RPT-008 The country filter
Roles: COORD · Priority: P2 · Platforms: Wide · Run: Auto

Preconditions:
- Alpha's country is set (RPT-019) and Bravo's is a different one.

Steps:
1. Open "Languages" (Geography shows every country itself and has no
   filter; Overview, Recent activity, Field report, Monthly ledger and Pace
   filter too).
2. Tap Alpha's country, then "All countries".

Expected:
- A second row of chips: "All countries" (with a globe), then each country
  by name. It appears only when the languages are in more than one country.
- Choosing a country leaves only its languages in the section.
- "All countries" shows both again.

---

## When it cannot load

### RPT-009 Offline
Roles: COORD · Priority: P1 · Platforms: Wide · Run: Auto

Preconditions:
- The app has not loaded Reports since it started. The device is offline.

Steps:
1. Tap "Reports".
2. Go online and tap "Try again".

Expected:
- Step 1: an amber notice "You are offline" with "Reports need a
  connection. They load when you are back online." and a "Try again"
  button.
- Step 2: "Loading reports…", then Overview.

Fixed (2026-10-13): "Try again" left the error up until the answer came;
it now says "Loading reports…" while it asks.

### RPT-010 The server's answers, each in words
Roles: COORD · Priority: P2 · Platforms: Web (1200 px) · Run: Auto

Preconditions:
- Playwright answers the reports request as each step says.

Steps:
1. Answer 401. Open Reports.
2. Answer 403.
3. Answer 502.
4. Answer 418.
5. A build with no reports server configured.

Expected:
- Each shows a red notice "The reports could not be read" with:
  - 401: "Your session has ended. Sign in again."
  - 403: "You are not a member of this organization."
  - 502: "The server could not read this organization just now. Try
    again."
  - 418: "The server answered 418."
  - No server: "This build does not know where the reports server is."
- Each has "Try again", which asks again.
- No crash screen.

### RPT-011 Figures already shown stay when a refresh fails
Roles: COORD · Priority: P1 · Platforms: Wide · Run: Auto

Preconditions:
- Reports has loaded once in this run.

Steps:
1. Go offline.
2. Tap "Refresh".
3. Open another section, and Alpha's page.

Expected:
- The figures stay as they were. No error notice replaces them.
- Every section and Alpha's page still show their figures, with their
  "Figures as of …" time unchanged.

### RPT-012 An organization with no languages
Roles: NEW · Priority: P2 · Platforms: Wide · Run: Auto

Preconditions:
- NEW-3 has just started an organization (NOORG, "Start a new one") and
  added no language.

Steps:
1. Tap "Reports".

Expected:
- "No languages to show yet" with "Languages appear here once the
  organization has one and your role lets you view its status. If you
  expected some, ask an administrator which languages your role covers."
- The chips still show; no section crashes.

---

## A language's page

### RPT-013 Alpha's page
Roles: COORD · Priority: P1 · Platforms: Wide · Run: Auto

Preconditions: None.

Steps:
1. Reports, "Languages", tap "Alpha".
2. Tap "Reports" in the crumb above the title. Open Alpha again and tap
   Back.

Expected:
- While loading: "Loading the report…".
- Header "Alpha" with "UI Test Org" under it, and a crumb "Reports" above.
  At the right, "Download the books as CSV" and, on the web, "Print or save
  as PDF".
- A line of badges: Alpha's code, its country (or "No country"), "Review
  flow: Standard Bible Flow", a bottleneck if there is one, an upload
  recency badge (such as "Active"), and a pace badge when a target is set.
- The freshness line "Figures as of {when} ({ago}). Work recorded offline
  appears after the device syncs."
- Then, in this order: the headline figures; "Scripture coverage";
  "Uploads" with "Recordings on the server", "Chapters with audio" and
  "Since the last upload"; "Pace" (only with a target); "Needs attention";
  "Review flow" and "Where passages stand"; "Activity" ("By week.") and
  "Progress over time"; "Books", listing Luke with its counts.
- "Language settings" at the end for COORD (RPT-018).
- Step 2: the crumb and Back both return to Reports, on the section it was
  on.

### RPT-014 Download the books as CSV
Roles: COORD · Priority: P2 · Platforms: Web (1200 px), iPad · Run: Manual

Preconditions: None.

Steps:
1. On Alpha's page, tap "Download the books as CSV".

Expected:
- Web: a CSV file downloads, named after "Alpha books". It opens in a
  spreadsheet with one row per book, column names in the app's language
  (for example "Book", "Passages", "Recorded", "Done"), and Luke's figures
  matching the page.
- iPad: the share sheet opens with the same text.

### RPT-015 Print or save as PDF, on the web only
Roles: COORD · Priority: P2 · Platforms: Web (1200 px), iPad · Run: Manual

Preconditions: None.

Steps:
1. On Alpha's page, tap "Print or save as PDF".

Expected:
- Web: the browser's print dialog opens; the preview shows only the report,
  headed "Alpha": no sidebar, header buttons or "Language settings". The
  field report's "Print" likewise prints only the field report.
- iPad: there is no such button.

### RPT-016 A language whose report you cannot see
Roles: VIEW, ADMIN · Priority: P2 · Platforms: Wide · Run: Auto

Preconditions:
- Device 1 (VIEW) is on Reports, "Languages", showing Alpha and Bravo.

Steps:
1. Device 2 (ADMIN): change VIEW's scope to LANG-A only (PEOPLE). Wait two
   minutes.
2. Device 1 (VIEW): without catching up, tap "Bravo".

Expected:
- After loading: "This language has no report you can see" with "Your role
  may not include this language, or it was added after the reports loaded
  (catch up from Reports to check)." No crash.
- If Bravo's figures show instead, record it (the page may still hold the
  old list).

Fixed (2026-10-13): the language's page also asks the organization's
record on the device, which hears of the role change at once, so a
language the role no longer covers is not shown from the list loaded
before.

Resets: put VIEW back at organization scope.

### RPT-017 A language's page keeps its figures offline
Roles: COORD · Priority: P2 · Platforms: Wide · Run: Auto

Preconditions:
- Reports has loaded online in this run.

Steps:
1. Open Alpha's page. Go offline.
2. Go Back, then open Alpha's page again.

Expected:
- Alpha's figures show both times, with the same "Figures as of …" time.
- No notice replaces them.
- The page's own error notice ("You are offline" with "Reports need a
  connection. They load when you are back online.", or "The report could
  not be read") shows only if the list never loaded, which the page cannot
  be reached without. Record it if seen. Since 2026-10-13 the page's notice
  has its own "Try again".

---

## Language settings

### RPT-018 Only people who manage the language see its settings
Roles: ADMIN, COORD, LADMIN, TRANS, REV, VIEW · Priority: P1 · Platforms: Wide · Run: Auto

Preconditions: None.

Steps:
1. Open Alpha's page and scroll to the end.

Expected:
- ADMIN, COORD, LADMIN: a panel "Language settings" with "Where this
  language's work happens, and what it aims to record by when. Only people
  who manage the organization's structure see this."
- TRANS, REV, VIEW: no such panel.
- Bravo's page: ADMIN and COORD see it; LADMIN cannot open Bravo (RPT-006).

### RPT-019 Choose and save a country
Roles: COORD · Priority: P1 · Platforms: Wide · Run: Auto

Preconditions:
- Alpha has no country, or a different one from the one chosen below.

Steps:
1. In "Language settings", look at "Country" and "Save country".
2. Tap the country button ("Choose a country"; screen reader: "Country: not
   chosen. Change it.").
3. Scroll to the end of the list. Then type "ken" in "Find a country".
4. Tap "Kenya".
5. Tap "Save country".

Expected:
- Step 1: "Save country" is disabled until a different country is chosen.
- Step 2: a sheet "Country" with "Alpha" under it and a search field "Find a
  country". 60 countries are listed, then "Type to find the other {n}."
- Step 3: only matching countries ("Kenya").
- Step 4: the sheet closes; the button says "Kenya" (screen reader:
  "Country: Kenya. Change it."). "Save country" is enabled.
- Step 5: "Saving…", then a green notice "Saved.". The page's country
  badge says "Kenya", and "Save country" is disabled again.
- Another device's Reports shows Kenya after "Refresh".

Resets: Alpha's country is Kenya.

### RPT-020 Set a target, with dates checked
Roles: LADMIN · Priority: P1 · Platforms: Wide · Run: Auto

Preconditions:
- Alpha has no target.

Steps:
1. In "Language settings", look at "Target".
2. Tap "Gospels".
3. Tap "18 months: {date}". Then change "Start (YYYY-MM-DD)" to
   "2026-13-01".
4. Change it to "2026-10-01", and "Finish by (YYYY-MM-DD)" to "2026-09-01".
5. Change "Finish by" to "2027-12-31". Tap "Save target".

Expected:
- Step 1: chips "Gospels", "New Testament", "Old Testament", "Whole Bible",
  with "New Testament" on. "Start" and "Finish by" are empty, "Save
  target" is disabled, and a button "18 months: {date}" is under them.
- Step 3: the button fills "Start" with today and "Finish by" about 18
  months ahead, and "Save target" is enabled; then the bad start shows the
  error.
- Step 2: "Gospels" is on.
- Steps 3 and 4: red text "Write both dates as YYYY-MM-DD, with the finish
  after the start." "Save target" is disabled.
- Step 5: the error goes; "Saving…", then "Saved.". A "Pace" panel appears
  with a badge (such as "On pace {gap} pts") and "Gospels from {start} to
  {finish}. …", the dates written out.
- Reports' "Pace" section now counts Alpha as having a target ("1 of 1
  language has a target" for LADMIN, whose role covers Alpha only).

Resets: Alpha has a Gospels target.

### RPT-021 Saving settings offline
Roles: COORD · Priority: P1 · Platforms: Wide · Run: Auto

Preconditions:
- Alpha's page is open, loaded. Then the device goes offline.

Steps:
1. Choose another country and tap "Save country".
2. Fill in a start and a finish, and tap "Save target".

Expected:
- Each shows an amber notice "No connection. Nothing was saved; try again
  when you are back online."
- Nothing waits to send: the settings go only online (the Sync screen's
  "waiting to upload" is unchanged).
- Online again, saving works.

### RPT-022 Saving settings the server turns down
Roles: COORD · Priority: P2 · Platforms: Web (1200 px) · Run: Auto

Preconditions:
- Playwright fakes the server's answer to the append request in each step.

Steps:
1. Answer with the event refused. Tap "Save country".
2. Answer with the event neither accepted nor refused. Tap again.
3. Answer with a server error. Tap again.

Expected:
- Step 1: a red notice "Not saved: the server refused it."
- Step 2: "Not saved: the server did not confirm it. Try again."
- Step 3: "Not saved: the server did not answer."
- In each case the page's figures and badges are unchanged.
