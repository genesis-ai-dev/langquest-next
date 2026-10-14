# 02 No organization

What someone signed in with no organization sees and does: "Join your
team", starting an organization, finding one and asking to join, and what
happens when an admin answers. IDs `NOORG`. The test template, the global
preconditions G1 to G10, the fixture and the accounts are in
[the README](README.md). Joining by invite is in
[01-getting-in.md](01-getting-in.md).

**For this file**
- NOORG starts on "Join your team" (its home), with no join request
  waiting and no invite held. NOORG has never been welcomed: a fresh
  fixture records no `v1.VisionSeen` for it.
- NOORG has a profile name. `{first}` below is its first word, `{name}`
  the whole name.
- Tests that make NOORG a member say so under "Resets". Afterwards, remove
  NOORG from the organization (Manage → Members → NOORG → "Remove from
  organization"), or use a fresh fixture.
- Two-device tests name each device's account: Device 1 (NOORG),
  Device 2 (COORD or ADMIN).
- Organizations made here are named "UI New Org {run}", unless a test says
  otherwise. Delete them, or leave them for the run's clean-up.
- Automation (`smart-tests/ui/02-no-organization.spec.ts`): tests that would
  leave NOORG a member or a request use a fresh account with no
  organization, named in the test, so each starts on "Join your team" with
  nothing asked. LANG-A's row is written as the projection worker writes it.

## Join your team

### NOORG-001 Someone with no organization lands on "Join your team"
Roles: NOORG · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- NOORG is signed out.

Steps:
1. Sign in as NOORG with email and password.

Expected:
- "Join your team" opens, with "Welcome, {first}" under the title. No welcome screen shows first.
- No tab bar shows.
- Three cards, in this order:
  - "Scan their code" / "Someone on your team shows it". It is highlighted as the first choice.
  - "Find your organization" / "Ask them to let you in".
  - "Start a new one" / "For a team leader".
- Quiet links under the cards: "Sign out" and "Delete account".
- The footer holds "Look around first".
- No banner shows.

Known issue (2026-10-12): on the web the highlight is not said to a screen reader: kit's Card passes `accessibilityState`, which react-native-web no longer turns into `aria-selected` (the same holds for the ticked licence in NOORG-008, `aria-checked`). Found by the web run; the fix is in `kit.tsx`.

### NOORG-002 The cards and "Look around first" lead where they say
Roles: NOORG · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Tap "Scan their code", then the back arrow.
2. Tap "Find your organization", then the back arrow.
3. Tap "Start a new one", then the back arrow.
4. Tap "Look around first", then the back arrow.

Expected:
- Step 1: "Scan a code" with "Invite includes organization, role, and scope". On a phone the camera starts by itself (permission is allowed, G5).
- Step 2: "Find your organization" with a search field, "Name or language".
- Step 3: "Create Organization".
- Step 4: "Explore", with no "Sign In" in the header.
- Each back arrow returns to "Join your team", unchanged.

### NOORG-003 There is no way back past "Join your team"
Roles: NOORG · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Look at the header of "Join your team".
2. Android: press the system back button. Web: press the browser's Back.

Expected:
- The header has no back arrow: a signed-in person with no organization leaves only by "Sign out", which asks first. It never leaves a blank screen, and never signs out without saying so.
- Android back and browser Back keep NOORG on "Join your team", or leave the app. They do not show another account's screens or a blank page.

Decided (2026-10-13, decisions.md 100): no back arrow here; the demo's Back edge from this screen is dropped (`DROPPED_EDGES` in `flow.ts`).

### NOORG-004 Sign out from "Join your team"
Roles: NOORG · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Nothing is waiting to send.

Steps:
1. Tap "Sign out".

Expected:
- A "Sign out?" confirmation shows first, as it does from Me, with "Sign Out" and "Cancel".
- After confirming, Sign In opens. Signing in as NOORG again returns to "Join your team".
- On the web, the browser keeps nothing of NOORG's after sign-out.

Fixed (2026-10-13): "Sign out" here opens "Sign out?" (sign_out_confirm); the flow has the edges intent_chooser → sign_out_confirm and sign_out_confirm → intent_chooser (back).

### NOORG-005 On the web, sign-out waits for account changes still to send
Roles: NOORG · Priority: P2 · Platforms: Web · Run: Auto

Preconditions (in addition to the global ones):
- On the web.

Steps:
1. Go offline (Chrome DevTools, Network: Offline).
2. Tap "Find your organization" and tap "Ask to join" on UI Test Org's row. Tap "Done".
3. Tap "Sign out".
4. Go online, wait for "Asked UI Test Org" to say "You'll go straight in when they say yes…", then tap "Sign out".

Expected:
- Step 3: "Still to send: 1 account change. Sign out once they have synced so they are not stranded here." NOORG stays signed in.
- Step 4: NOORG is signed out, and Sign In opens.

Resets: NOORG has a join request to UI Test Org. Decline it (NOORG-023), or use a fresh fixture.

### NOORG-006 Delete account from "Join your team"
Roles: NOORG · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Tap "Delete account".
2. Tap the back arrow.

Expected:
- Step 1: "Delete Account" opens, with "Delete your account?" and "Delete My Account". Deleting is covered in ACCT.
- Step 2: back on "Join your team", unchanged. Nothing was deleted.

## Start a new organization

### NOORG-007 The Create Organization screen
Roles: NOORG · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Tap "Start a new one".
2. Type three spaces in "What's it called?".

Expected:
- "Create Organization" opens with:
  - "Start your organization" / "Your teams will record Scripture in their own languages and check it together. It starts with a name."
  - The field "What's it called?", with "Enter organization name" as its placeholder.
  - Under "Who may use your work", one row: "All rights reserved" / "Only your organization", with a lock icon. Its accessibility label is "License: All rights reserved. Only your organization".
  - The banner "Ready to use" / "You'll get the usual roles and a standard way to check passages. Next, we'll add your first language and team together."
  - The footer button "Create Organization", disabled.
- Step 2: the button stays disabled.

### NOORG-008 Choosing who may use the work
Roles: NOORG · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- On "Create Organization".

Steps:
1. Tap the "All rights reserved" row.
2. Tap "CC BY 4.0".
3. Tap "Read the license", then return to the app.
4. Tap "Use this license".
5. Open the row again, tap "All rights reserved", then "Use this license".

Expected:
- Step 1: a sheet "Who may use your work" with "Who may use what your team records and writes. You can open it up later, but never close it again."
- It lists six licences, in this order, with "All rights reserved" ticked:
  - "All rights reserved", "Only your organization".
  - "CC BY-NC-ND 4.0", "Share unchanged, not for sale".
  - "CC BY-NC-SA 4.0", "Share and adapt, not for sale".
  - "CC BY-SA 4.0", "Share and adapt, same terms".
  - "CC BY 4.0", "Any use, with credit".
  - "CC0 (public domain)", "No conditions".
- The ticked one shows what it means: "Only your members can see and use your work. Nobody else may copy or share it."
- Step 2:
  - "CC BY 4.0" is ticked and shows "Anyone may use, adapt and sell your work for any purpose, as long as they credit you." with "Read the license".
  - The amber banner "People outside can hear your team" / "Anyone will be able to listen to your recordings. If a voice could put someone at risk, keep your work closed." shows.
  - Every licence except "All rights reserved" shows this banner.
- Step 3 opens the licence's page in the browser.
- Step 4: the sheet closes. The row reads "CC BY 4.0" / "Any use, with credit", with a globe icon.
- Step 5: the row reads "All rights reserved" again. Before the organization exists, the choice can be closed again.

### NOORG-009 Start a new organization
Roles: NOORG · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- On "Create Organization".

Resets: NOORG is now the Organization Admin of a new organization. Use a fresh fixture, or a fresh NOORG account, for the tests after this one.

Steps:
1. Type "UI New Org {run}" in "What's it called?".
2. Tap "Create Organization".

Expected:
- While it works, the button reads "Creating…".
- The new organization opens on My Work. No welcome shows: the creator skips it.
- The toast "UI New Org {run} is ready to grow. Next, add your first language and invite your team." shows.
- The tabs are Work, Map, Manage and Me.
- My Work leads with "Get UI New Org {run} ready", then "Add a language" / "The language your team speaks", with the button "Add a language".
- Tapping "Add a language" opens New language (SETUP covers it).
- Manage opens the organization's home, named "UI New Org {run}", with the licence "All rights reserved".
- Signing out and in again goes straight to My Work, with no welcome.
- On a second device after Sync now, NOORG is "Organization Admin" in Members.

Fixed (2026-10-13): the toast is shown just before the app reopens on the new organization, and may never be seen. Verify on a device.

### NOORG-010 Starting an organization with no connection
Roles: NOORG · Priority: P1 · Platforms: iOS, Android · Run: Auto

Preconditions (in addition to the global ones):
- A fresh NOORG-like account (NEW, made in AUTH-019), on "Join your team". The device is offline.

Steps:
1. Tap "Start a new one", type "UI Offline Org {run}", and tap "Create Organization".
2. Tap Manage, then Me → More settings.
3. Go online and wait 30 seconds.

Expected:
- Step 1: the organization is made on the phone. My Work opens with "Get UI Offline Org {run} ready", as in NOORG-009. No error shows.
- Step 2: the organization's home opens offline. More settings shows changes waiting to send.
- Step 3: the waiting count returns to 0 (G10.3). On a second device, the account's "Switch Organization" lists "UI Offline Org {run}".

### NOORG-011 A name already in use is allowed
Roles: NEW · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- A NEW account with no organization, on "Join your team".

Steps:
1. Tap "Start a new one", type "UI Test Org", and tap "Create Organization".

Expected:
- The organization is made, with no warning and no refusal: names identify nothing.
- It has its own id. ORG's members do not see it, and it does not see ORG's languages or people.

### NOORG-012 Backing out of Create Organization makes nothing
Roles: NOORG · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Tap "Start a new one", type a name, choose "CC BY 4.0", and tap the back arrow.
2. Tap "Start a new one" again.

Expected:
- Step 1: back on "Join your team". No organization was made, and nothing waits to send.
- Step 2: the name is empty, and the licence row reads "All rights reserved".

### NOORG-013 A member starts a second organization
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- ADMIN is on My Work in UI Test Org. LANG-A is the open language.

Resets: ADMIN now has "UI Admin Org". AUTH-030 relies on it.

Steps:
1. Me → More settings → "Switch Organization".
2. Tap "New organization", then the back arrow.
3. Tap "New organization" again. Type "UI Admin Org" and tap "Create Organization".
4. Me → More settings → "Switch Organization" → "UI Test Org".
5. Switch to "UI Second Org".

Expected:
- Step 1: "Switch Organization" lists UI Test Org (ticked, read out as "UI Test Org, active") and UI Second Org. Then "New organization" / "You'll be its admin. Your place in the others stays as it is."
- Step 2: "Create Organization" opens. Back returns to "Switch Organization".
- Step 3: UI Admin Org opens on My Work with "Get UI Admin Org ready", and no welcome. Manage opens its home.
- Step 4: UI Test Org opens, with LANG-A as the open language. ADMIN is still Organization Admin there, with all four tabs.
- Step 5: ADMIN is still a Translator in UI Second Org (Work, Map and Me tabs).

## Find your organization

### NOORG-014 Find an organization by name or language
Roles: NOORG · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- ORG lists LANG-A publicly. ORG2 lists nothing.

Steps:
1. Tap "Find your organization".
2. Type "ui test" in "Name or language".
3. Clear it and type "ALPHA".
4. Type "zzzz" instead.
5. Clear the search.

Expected:
- Step 1:
  - "Loading…" may show briefly.
  - Then a row "UI Test Org" with "Alpha" under it, and "Ask to join" on the right. Its accessibility label is "Ask UI Test Org to let you in".
  - UI Second Org is not listed.
  - Under the list: "Not here? Ask someone on your team to show you their code."
- Step 2: UI Test Org stays (the name matches, ignoring case).
- Step 3: UI Test Org stays (its language matches).
- Step 4: no rows, and "No organization or language matches “zzzz”."
- Step 5: the full list returns.
- Nothing has been asked yet.

### NOORG-015 Asking to join from the list
Roles: NOORG · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Online, on "Find your organization".

Resets: NOORG has a join request to UI Test Org. NOORG-021 and NOORG-023 answer it.

Steps:
1. Tap the "UI Test Org" row.
2. Tap "Done".

Expected:
- One tap sends: no confirmation and no message field. The row's right side reads "Asking…" while it saves.
- The screen becomes "Asked", with "Asked UI Test Org" and "You'll go straight in when they say yes. You can close the app; we'll let you know."
- Briefly, before it is sent, the text may read "Saved on this device. It sends when you have a connection."
- The header has a back arrow.
- Step 2: "Join your team" opens, titled "Asked UI Test Org", with no "Welcome, {first}" line.
  - A clock and "Asked UI Test Org", with "You'll go straight in when they say yes. You can close the app; we'll let you know."
  - "Meanwhile" over the same three cards, none highlighted.

Fixed (2026-10-12): the "Asked" screen's back arrow leads to "Join your team", as Done does.

### NOORG-016 Asking with no connection
Roles: NOORG · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- "Find your organization" has been opened online once on this device (NOORG-014), so its list is saved.

Resets: as NOORG-015.

Steps:
1. Go offline. Tap "Find your organization".
2. Tap "UI Test Org".
3. Tap "Done".
4. Kill and reopen the app, still offline.
5. Go online and wait up to 30 seconds.

Expected:
- Step 1: the saved list shows, with the banner "Unable to refresh. Showing what was saved on this device."
- Step 2: "Asked", with "Asked UI Test Org" and "Saved on this device. It sends when you have a connection."
- Steps 3 and 4: "Join your team" is titled "Asked UI Test Org". The body reads "Your request is saved on this device and sends when you have a connection."
- Step 5: the body changes to "You'll go straight in when they say yes. You can close the app; we'll let you know." COORD's My Work shows the request (NOORG-021).

### NOORG-017 More than 25 listed organizations
Roles: NOORG · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- At least 30 organizations list a language on the server (seeded for this test).

Steps:
1. Tap "Find your organization" and scroll to the end.
2. Tap "Show {n} more · {n} left".
3. Type a search that matches fewer than 25.

Expected:
- 25 rows show, then "Show {n} more · {n} left".
- After the tap, all rows show.
- A new search starts again from 25 at most, and the button only shows when more than 25 match.

### NOORG-018 No organization is listed
Roles: NOORG · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- No organization lists a language (LANG-A unlisted for this test), and nothing is saved on the device.

Resets: list LANG-A again afterwards.

Steps:
1. Tap "Find your organization".

Expected:
- No rows.
- "No organizations are listed yet. Ask someone on your team to show you their code."

### NOORG-019 Asking from Explore, with a message
Roles: NOORG · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- No join request is waiting.

Resets: as NOORG-015.

Steps:
1. Tap "Look around first", then LANG-A's card.
2. Type "I am Ana, from the Alpha team in Juba" in "Say something (optional)".
3. Tap "Ask to join".
4. Tap "Done".

Expected:
- Step 1: "Ask UI Test Org" opens, with "They'll let you in, and you'll go straight to your work."
  - The field "Say something (optional)", with "Who you are, and which team" as its placeholder.
  - The footer button "Ask to join".
- Step 3: "Asked" with "Asked UI Test Org".
- Step 4: "Join your team" is titled "Asked UI Test Org".
- COORD sees the message with the request (NOORG-021).

Fixed (2026-10-12): Explore passes only the organization; its name comes from the organizations listed (Find your organization's list), and reads "Ask the organization" until it is known.

### NOORG-020 A request that is not sent
Roles: NOORG · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- No join request is waiting.

Steps:
1. Tap "Look around first", then LANG-A's card.
2. Paste 2,001 characters into "Say something (optional)", and tap "Ask to join".
3. Wait for it to reach the server.
4. Tap "Back".

Expected:
- Step 3: the header reads "Not sent", with "Request not sent" and "The message is too long."
- The footer button is "Back", not "Done".
- Step 4: "Join your team" opens with no "Asked …" title. A failed request is not shown as waiting.
- Other refusals read, when they happen:
  - "That organization was not found."
  - "You are already a member."
  - "Sign in again to send it."
  - For any other reason, "The organization could not take the request."

## When an admin answers

### NOORG-021 An admin lets the person in from My Work
Roles: NOORG, COORD · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Device 1 (NOORG): a request to UI Test Org was sent (NOORG-015), with the message from NOORG-019 if it was asked that way. "Join your team" is open, titled "Asked UI Test Org".
- Device 2 (COORD): signed in, on My Work.

Resets: NOORG is a member of UI Test Org.

Steps:
1. Device 2: pull to refresh, or wait up to a minute.
2. Device 2: tap the row "{name} wants to join".
3. Device 2: under "What will they do?" choose "Translate". Under "In which language?" choose "Alpha". Tap "Let {first} in".
4. Device 1: wait up to 60 seconds, with the app open.
5. Device 1: tap "Get started".

Expected:
- Step 1: My Work shows "{name} wants to join", with the message, or "Asked just now" when there is none.
- Step 2 opens the request:
  - Header "{name} wants to join", with when they asked.
  - The message in quotes, if any.
  - The plain role choices ("Translate", "Check recordings", "Back-translate", "Help run the team").
  - "Let {first} in", and a quiet "Say no".
- Step 3: the toast "{name} is in, as Translator in Alpha." The row leaves My Work.
- Step 4: Device 1 opens UI Test Org on its own, on the welcome, with no tab bar:
  - "Welcome, {first}".
  - "You're a Translator on the Alpha team at UI Test Org."
  - The translator's three lines.
- Step 5: My Work, with Work, Map and Me tabs. LANG-A's work is visible.
- After Sync now on both, COORD's Members lists NOORG as a Translator in Alpha.

### NOORG-022 The answer arrives when the app comes back
Roles: NOORG, ADMIN · Priority: P1 · Platforms: iOS, Android · Run: Auto

Preconditions (in addition to the global ones):
- As NOORG-021, with a fresh request.

Resets: as NOORG-021.

Steps:
1. Device 1: send the app to the background (Home).
2. Device 2 (ADMIN): tap the bell, open the "Join request" update, and tap "Assign role & accept". Choose "Translate" and "Alpha", and tap "Let {first} in".
3. Device 1: bring the app back to the foreground.

Expected:
- Step 2: the Inbox row reads "Join request" / "{name} asked to join UI Test Org. Assign a role to give them access." Its sheet shows the message and "Assign role & accept". The request screen is as in NOORG-021.
- Step 3: at once, without waiting a minute, Device 1 opens UI Test Org on the welcome.

### NOORG-023 An admin turns the request down from the Inbox
Roles: NOORG, ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Device 1 (NOORG): a sent request to UI Test Org, on "Join your team".
- Device 2 (ADMIN): signed in.

Steps:
1. Device 2: open the bell, tap the "Join request" update, and tap "Decline".
2. Device 1: wait up to 60 seconds, or bring the app back to the foreground.
3. Device 1: tap "Find your organization" and ask UI Test Org again.

Expected:
- Step 1: the toast "Declined. They were not given access." The update leaves the Inbox.
- Offline, Decline instead shows "Not declined. Check your connection and try again.", and the request stays.
- Step 2: the title is "Join your team" again. The hero reads "UI Test Org didn't add you" / "An admin there turned down your request. You can ask again below, or ask someone there to show you their code." "Meanwhile" and the three cards stay.
- Step 3: a new request is sent ("Asked UI Test Org"), and ADMIN sees it again.

Fixed (2026-10-12): after asking again, "Join your team" kept showing the turned-down request ("UI Test Org didn't add you"), because it took the request last in the account outbox, which keeps unsent ones first. Requests now carry when they were asked, and the newest counts.

Resets: as NOORG-015.

### NOORG-024 Saying no from the request screen
Roles: NOORG, COORD · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- As NOORG-021, with a fresh request.

Steps:
1. Device 2: open "{name} wants to join" from My Work and tap "Say no".
2. Device 1: wait up to 60 seconds.

Expected:
- Step 1: the toast "You said no to {name}." The row leaves My Work.
- Step 2: "UI Test Org didn't add you", as in NOORG-023.

### NOORG-025 Someone who cannot let people in sees no request
Roles: TRANS, VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- NOORG has a sent request to UI Test Org.

Steps:
1. Open My Work (TRANS) or the Inbox tab (VIEW), and refresh.

Expected:
- No "wants to join" row and no "Join request" update.
- Opening the request any other way shows "You don't have permission to open that.", or "Only people who can invite members let people in." with no "Let … in" button.

### NOORG-026 An invite while asking
Roles: NOORG · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- NOORG has a sent request to UI Test Org, still waiting.
- A new one-person invite to UI Test Org (Translator, LANG-A) is to hand.

Resets: as NOORG-021.

Steps:
1. Tap "Scan their code", paste the invite, and tap "Join as {name}".

Expected:
- NOORG joins by the invite and sees the welcome, as in AUTH-033. The waiting request does not hold the join up.
- If COORD then opens the old request and taps "Let {first} in", the app does not crash, and Members still lists NOORG once.
