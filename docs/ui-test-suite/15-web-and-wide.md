# 15. Web and wide windows (WEB)

How the app lays itself out on tablets and wide browsers (decision 55), and
what the web app does as a platform of its own (decision 58): one tab at a
time, the address bar, browser Back, the tab title, leaving with work
unsent, and forgetting the browser on sign-out.

Read [the README](README.md) first: G1 to G10, the fixture and the accounts
apply here.

Widths used below:
- Phone: under 768 px (a phone, or Chrome at 390 px). Tabs in a bar along
  the bottom.
- Tablet: 768 to 1099 px (an iPad in portrait, or Chrome at 900 px). Tabs in
  a rail down the left.
- Desktop: 1100 px and over (Chrome at 1280 px, an iPad Pro in landscape).
  A labelled sidebar, and lists beside what they open.

On the web, set the width with Playwright's viewport or developer tools'
device toolbar, then reload if a step says so.

---

## Layout by width

### WEB-001 Phone width: the bottom bar
Roles: TRANS, VIEW · Priority: P1 · Platforms: Web (390 px), iOS, Android · Run: Auto

Preconditions: None.

Steps:
1. Look at the tabs on the home screen.

Expected:
- A bar along the bottom with an icon and a label per tab: TRANS "Work",
  "Map", "Me"; VIEW "Map", "Inbox", "Me".
- No "Reports" tab, no side rail, no sidebar, no crumbs above titles.
- Content fills the width.

### WEB-002 Tablet width: the rail
Roles: TRANS · Priority: P1 · Platforms: Web (900 px), iPad portrait · Run: Auto

Preconditions: None.

Steps:
1. Look at the tabs. Tap each one.

Expected:
- A rail down the left, about 88 px wide, with each tab's icon and label
  stacked; the lit tab has a tinted pill behind its icon.
- Tabs: "Work", "Map", "Reports", "Me".
- No bottom bar. Screen content sits in a centred column, not stretched.
- Footer buttons stop at about 360 px wide instead of spanning the window.

### WEB-003 Desktop width: the sidebar
Roles: ADMIN, VIEW · Priority: P1 · Platforms: Web (1280 px) · Run: Auto

Preconditions:
- VIEW has an unread update.

Steps:
1. Look at the left side.

Expected:
- A sidebar about 248 px wide. At its top, "UI Test Org" and the account's
  chip (avatar and name), then a line.
- Then the tabs, each an icon and a label in a row: ADMIN "Work", "Map",
  "Reports", "Manage", "Me"; VIEW "Map", "Reports", "Inbox", "Me".
- VIEW's "Inbox" has a red count badge; a screen reader reads "Inbox, {n}".
  A count over 99 shows "99+".
- Below the tabs, "Language explorer" (WEB-005).

### WEB-004 Resizing keeps your place
Roles: TRANS · Priority: P2 · Platforms: Web · Run: Auto

Preconditions: None.

Steps:
1. At 1280 px, open Map, then P-NEEDS.
2. Narrow to 900 px, then to 390 px, then widen to 1280 px.

Expected:
- The same passage stays open at every width. Only the tabs and panes
  change: sidebar, then rail, then no tabs (a phone hides them on a passage,
  WEB-010), then the sidebar again.
- Nothing typed or recorded is lost.
- An open sheet may close when the list moves into a pane (decision 55);
  note it if it does.

### WEB-005 Language explorer opens in a new tab
Roles: TRANS · Priority: P2 · Platforms: Web (1280 px), iPad · Run: Auto

Preconditions: None.

Steps:
1. In the sidebar, find "Language explorer" (screen reader: "Language
   explorer, opens in a new tab").
2. Click it.
3. Run on an iPad at desktop width.

Expected:
- Step 2: `/languages` opens in a new browser tab. The app's tab is
  unchanged.
- The new tab does not take the app's place (it does not open the app's
  database, WEB-012).
- Step 3: no "Language explorer" on the iPad.

### WEB-006 The Inbox and what it opens, side by side
Roles: TRANS · Priority: P1 · Platforms: Web (1280 px), iPad landscape at 1100+ · Run: Auto

Preconditions:
- TRANS has at least two updates (REV's feedback on P-NEEDS, and one more).

Steps:
1. On My Work, tap the bell.
2. Tap the first update.
3. Tap the second update.

Expected:
- Step 1: the Inbox list on the left; on the right, "Pick an update" with
  "What it is about opens here."
- Step 2: the passage record opens on the right. The list stays on the
  left, with that row marked as the current one. The row's unread dot goes.

Known issue (2026-10-13): the row's "current" mark is drawn but not said:
no `aria-selected` reaches the web (kit Row passes it as accessibility
state on a button).
- Step 3: the right side changes to the second passage.
- At 900 px the Inbox is a single column, and an update opens full width
  with Back.

### WEB-007 Sheets become centred dialogs
Roles: TRANS · Priority: P2 · Platforms: Web (390 px and 1280 px), iPad · Run: Manual

Preconditions: None.

Steps:
1. On Me, tap "Language" at each width.

Expected:
- Phone width: the sheet rises from the bottom, full width.
- Tablet and desktop: a centred dialog, about 560 px wide at most, with the
  screen dimmed behind it. ✕ and tapping outside close it.
- Rows keep their 48 pt height at every width.

### WEB-008 Crumbs show only on wide windows
Roles: TRANS · Priority: P2 · Platforms: Web (390 px and 1280 px) · Run: Auto

Preconditions: None.

Steps:
1. Open P-NEEDS, then its "Version 1", at each width.
2. At 1280 px, tap a crumb.
3. On Reports (wide), open Alpha's page.

Expected:
- Phone width: no crumbs, only the title and Back.
- Desktop: a row of tappable crumbs above the title naming where the
  version sits (the passage and the places above it). Tapping one goes
  there.
- Alpha's report has the crumb "Reports".

### WEB-009 Sync's tiles in one row on a wide window
Roles: TRANS · Priority: P2 · Platforms: Web (390 px and 1280 px) · Run: Auto

Preconditions: None.

Steps:
1. Open "Me", "More settings", "Sync" at each width.

Expected:
- Phone width: the four tiles sit two by two.
- Desktop: one row of four.
- The labels "waiting to upload", "refused by the server", "latest
  confirmed" and "local checkpoint" are not cut off.

### WEB-010 Where the tabs show
Roles: TRANS · Priority: P1 · Platforms: Web (390 px and 1280 px), iOS, iPad · Run: Auto

Preconditions: None.

Steps:
1. At each width, open: P-NEEDS's record; its Version 1; "Me", "More
   settings"; "Sync"; "Edit Profile"; the recording workspace for P-NEW;
   "Sign out".

Expected:

| Screen | Phone | Tablet and desktop |
| --- | --- | --- |
| Passage record, Version | no tabs | tabs |
| More settings, Sync, Edit Profile | no tabs | tabs |
| Recording workspace | no tabs | no tabs |
| Sign out | no tabs | no tabs |

- Where the tabs show, the "Map" or "Me" tab is lit as appropriate.
- Pressing a tab from any of these returns to that tab's first screen.

### WEB-011 Phones stay upright, tablets turn
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, iPad, Android tablet · Run: Device

Preconditions: None.

Steps:
1. Rotate each device to landscape on My Work and on a passage.

Expected:
- iPhone and an Android phone (shortest side under 600 dp): the app stays
  portrait.
- iPad and an Android tablet: the app turns, and the layout follows the new
  width (rail or sidebar, WEB-002 and WEB-003).

---

## One tab at a time

### WEB-012 A second tab says LangQuest is open elsewhere
Roles: TRANS · Priority: P1 · Platforms: Web · Run: Auto

Preconditions:
- Tab 1 has the app open on My Work.

Steps:
1. Open the same address in Tab 2.
2. Return to Tab 1.

Expected:
- Tab 2: "LangQuest is open in another tab" with "It works in one tab at a
  time, so your recordings and changes stay in one place. Use it here, or go
  back to the other tab." and a "Use it here" button. No sign-in screen,
  no app.
- Tab 1 works as before.

### WEB-013 "Use it here" moves the app to the new tab
Roles: TRANS · Priority: P1 · Platforms: Web · Run: Auto

Preconditions:
- Tab 1 has the app open, offline, with one note waiting to send.
- Tab 2 shows "LangQuest is open in another tab".

Steps:
1. In Tab 2, tap "Use it here".
2. Look at Tab 1.
3. In Tab 2, go online and wait 30 seconds.
4. In Tab 1, tap "Use it here".

Expected:
- Step 1: Tab 2 says "Moving LangQuest to this tab…" with "The other tab
  saves what it has and steps aside.", then opens the app, signed in.
- Step 2: Tab 1 says "LangQuest moved to another tab", with the same
  explanation and "Use it here".
- Step 3: the note that was waiting in Tab 1 goes from Tab 2 (COORD sees
  it once).
- Step 4: the app moves back to Tab 1 the same way.

### WEB-014 A private window cannot keep LangQuest's files
Roles: TRANS · Priority: P2 · Platforms: Web · Run: Manual

Preconditions:
- A private window in a browser that refuses site storage there (for
  example Firefox private browsing), or Chrome with site data blocked for
  the site.

Steps:
1. Open the app in it.
2. Tap "Try again".

Expected:
- "LangQuest could not open its storage" with "Nothing was deleted. If
  LangQuest is open in another tab or window, close it, then try again. A
  private or incognito window cannot keep LangQuest's files: use a normal
  window." and "Code for your team: {code}".
- "Try again" reloads the page.
- If the app opens normally in that window, record it: storage worked
  there.

### WEB-015 Leaving with work unsent asks first
Roles: TRANS · Priority: P1 · Platforms: Web · Run: Auto

Preconditions: None.

Steps:
1. With nothing waiting, close the tab.
2. Open the app again, go offline, and add a note to P-SUBMITTED.
3. Close the tab, or reload.
4. Choose to stay. Go online, wait until nothing waits, and close the tab.

Expected:
- Step 1: the tab closes with no question.
- Step 3: the browser asks whether to leave the site.
- Step 4: no question this time.
- The same question appears while a recording is still uploading.

---

## The address bar and history

### WEB-016 The browser's Back is the app's Back
Roles: TRANS · Priority: P1 · Platforms: Web · Run: Auto

Preconditions:
- The app was opened from another page in this tab (for example
  `about:blank`, then the app's address).

Steps:
1. On My Work, open P-NEEDS (under "{n} more for you"), then its
   "Version 1" from the record's Record step.
2. Press the browser's Back.
3. Press Back again.
4. Press Back once more.

Expected:
- Step 2: the passage record, as if the app's Back was tapped.
- Step 3: My Work.
- Step 4: the browser leaves the app for the previous page.
- The browser's Forward does not reopen app screens in a broken state; note
  what it does.

Fixed (2026-10-13): step 3 leaves the app instead of returning to My
Work: at Version 1 the history holds one entry for the two screens opened
(`history.length` 3, state `{lq: 2}`), so Back runs out a screen early
(webHistory.ts).

### WEB-017 The address names the section
Roles: ADMIN, TRANS, LADMIN, VIEW · Priority: P1 · Platforms: Web (1280 px) · Run: Auto

Preconditions: None.

Steps:
1. Tap each tab and read the address. Then open a screen inside it.

Expected:
- My Work: `/work`.
- ADMIN's Map (All Languages): `/map`. TRANS's Map (LANG-A's map):
  `/map/language`.
- Reports: `/reports`.
- ADMIN's Manage (the organization's home): `/manage`. LADMIN's Manage
  (LANG-A's page): `/manage/language`.
- VIEW's Inbox: `/inbox`.
- Me: `/settings`.
- A screen opened inside a section keeps the section's address (P-NEEDS
  from My Work stays `/work`). The address never holds an id.
- Screens outside any section, such as "Join your team", are `/`.

### WEB-018 A refresh returns to the section
Roles: TRANS, ADMIN · Priority: P1 · Platforms: Web · Run: Auto

Preconditions: None.

Steps:
1. TRANS: on "Me", open "More settings", then "Sync". Reload.
2. TRANS: open the Map tab. Reload.
3. ADMIN at 1280 px: open Reports, then "Pace". Reload.
4. Signed out: open `/settings` directly, then sign in as TRANS.

Expected:
- Step 1: the app reopens on "Me" (the section), not Sync. Address
  `/settings`.
- Step 2: LANG-A's map. Address `/map/language`.
- Step 3: Reports, on "Overview".
- Step 4: "Sign In" first; after signing in, "Me".

### WEB-019 A refresh never opens a section the person may not open
Roles: TRANS, VIEW, NOORG · Priority: P1 · Platforms: Web · Run: Auto

Preconditions: None.

Steps:
1. TRANS: open `/manage` directly.
2. TRANS at 390 px: open `/reports` directly.
3. VIEW: open `/work` directly.
4. NOORG: open `/settings` directly.

Expected:
- Step 1: My Work; the address becomes `/work`. No error toast.
- Step 2: My Work (Reports needs a wide window).
- Step 3: "All Languages" (VIEW's home); address `/map`.
- Step 4: "Join your team"; address `/`.
- None shows "You don't have permission to open that." or a crash screen.

Fixed (2026-10-13): the check counts Me, Map and Inbox as sections an
account with no organization may open, because its tab list is not empty.
Not reproduced on the web (2026-10-13) with a NOORG account that had seen
the welcome: it landed on "Join your team" at `/`.
A NOORG account that has seen the welcome before (for example, one that
left an organization) lands on that screen with no tabs and no Back. A
brand-new account goes to "Join your team" as expected. Record which kind
of NOORG account was used.

### WEB-020 The tab title names the screen
Roles: TRANS · Priority: P2 · Platforms: Web · Run: Auto

Preconditions: None.

Steps:
1. Open My Work, P-NEEDS, Me, More settings, Sync, and Switch Organization.
   Read the browser tab's title each time.
2. Sign out and read it on Sign In.

Expected:
- "My Work · LangQuest", "Passage Record · LangQuest", "Me · LangQuest",
  "More settings · LangQuest", "Sync · LangQuest", "Switch Org · LangQuest",
  "Sign In · LangQuest".
- The title follows the app's language (in Spanish, the screen's Spanish
  name, then "· LangQuest").
- Note: the switcher's header says "Switch Organization" while its title
  says "Switch Org".

---

## What the web does differently

### WEB-021 No Notifications row on the web
Roles: TRANS · Priority: P1 · Platforms: Web · Run: Auto

Preconditions: None.

Steps:
1. Open "Me", "More settings".

Expected:
- No "Notifications" row. "Switch Organization" is the first row after the
  profile card (or "Set a password" for a looked-after account).
- The Inbox still works from My Work's bell.
- The browser never asks for notification permission.

### WEB-022 Sharing without a share sheet copies instead
Roles: COORD · Priority: P2 · Platforms: Web · Run: Auto

Preconditions:
- A browser without the system share sheet (Firefox on a desktop, or
  Chromium on Linux).

Steps:
1. Make an invite for TRANS-like access to LANG-A (PEOPLE) and tap "Share
   invite".
2. Paste the clipboard into a text field.

Expected:
- The toast "Invite link copied. Paste it into a message."
- The pasted text is the invite's link.
- If copying fails, the toast "Could not share it. Show the code instead."
  (or the invite screen's own wording), and the code is still on screen.

### WEB-023 Signing out forgets this browser
Roles: TRANS, REV · Priority: P0 · Platforms: Web · Run: Auto

Preconditions:
- TRANS has picked "Español" in "Language" on this browser. Nothing is
  waiting.

Steps:
1. Tap "Me", "Sign out".
2. Tap "Sign Out".
3. In developer tools, Application: look at Local storage, Session storage,
   IndexedDB and the origin's file system (Storage → "Storage buckets" or
   the OPFS explorer).
4. Sign in as REV.

Expected:
- Step 1: "Sign out?" with "You can sign back in anytime. This browser
  forgets everything it kept for you, so the next person here sees none of
  it."
- Step 2: "Signing out…", then the page reloads to "Sign In".
- Step 3: no LangQuest data is left: no saved keys, no database, no
  recordings or library files.
- Sign In shows in the browser's language, not Spanish: the language picked
  on this browser is forgotten too.
- Step 4: REV's home loads from the server. Nothing of TRANS's shows: no
  recent passages, no cached Inbox, no saved organization list.

### WEB-024 Signing out of the web offline
Roles: TRANS · Priority: P1 · Platforms: Web · Run: Auto

Preconditions:
- Nothing is waiting. The browser goes offline.

Steps:
1. Tap "Me", "Sign out", "Sign Out".
2. Check the browser's storage as in WEB-023.

Expected:
- The browser's storage is empty, as in WEB-023. Offline, the page that
  forgetting reloads cannot load (WEB-027), so the browser's own offline
  page shows, not "Sign In"; online again, "Sign In" shows.

Fixed (2026-10-13): offline, the sign-out call to the server fails.
The session is still removed in the browser, so "Sign In" shows, but the
app stops before forgetting the browser: the database, files and keys stay
for the next person. Signing out online does forget.
Fixed (decision 87, verified 2026-10-13): offline, the browser keeps nothing (no keys, no IndexedDB, no files, an empty log).

### WEB-025 The browser asks for the microphone
Roles: TRANS · Priority: P1 · Platforms: Web · Run: Manual

Preconditions:
- A fresh browser profile, without Chrome's fake-audio flags, and the site
  has never been given the microphone.

Steps:
1. Open P-NEW and start recording.
2. Allow the microphone in the browser's prompt. Record 5 seconds.
3. Repeat on a fresh profile and block the microphone instead.

Expected:
- Step 1: the browser's own microphone prompt.
- Step 2: recording works; the take plays back.
- Step 3: "Microphone permission is required." No crash, nothing saved.

### WEB-026 The update banner waits while recording
Roles: TRANS · Priority: P2 · Platforms: Web · Run: Auto

Runs against the exported web build only (as SYNC-032).

Preconditions:
- Playwright can switch `/version.json` to a different `build`.

Steps:
1. Open the app. Switch `/version.json` to a new build.
2. Hide the tab (switch to another) and show it again.
3. Open P-NEW and start recording. Read the bar.
4. Stop recording. Tap the banner.

Expected:
- Step 2: the banner "A new version of LangQuest is ready. Reload to use
  it." appears once the tab is shown again.
- Step 3: while recording, the bar is quiet text, "Update ready · it
  restarts when you stop recording", with nothing to tap; the recording
  carries on (UI audit, finding 26).
- Step 4: the page reloads (the leave question from WEB-015 shows first if
  work is waiting).

### WEB-027 The web app needs a connection to open
Roles: TRANS · Priority: P2 · Platforms: Web · Run: Auto

Preconditions:
- The app is open and signed in.

Steps:
1. Go offline. Use the app: open passages, add a note.
2. Reload the page while offline.

Expected:
- Step 1: works, as on a phone (SYNC).
- Step 2: the browser's own offline page. The note is not lost: online
  again, the app opens and the note is still waiting, then sends.

### WEB-028 Toasts on a wide window
Roles: REV · Priority: P2 · Platforms: Web (1280 px) · Run: Manual

Preconditions: None.

Steps:
1. Block {TRANS} from the flag on P-SUBMITTED's Version 1 (MOD-008).
2. Before it goes (about 3.5 seconds), block {TREV} from another flag.

Expected:
- The toast is no wider than about 480 px, not the window's width.
- One toast at a time: the second replaces the first.
- Each has a close ✕ ("Close") and no "Undo", and goes after about 3.5
  seconds, with a bar along its foot counting down. The web never doubles
  it, screen reader or not.

Resets: unblock both (MOD-012).

Changed (2026-10-16, decision 134): no toast offers Undo; "Unblock" (MOD-012) takes a block back, and every toast lasts 3.5 s on the web.
