# 11. Account and settings (ACCT)

Me, More settings, Edit Profile, notifications, switching organization, the
app's language, help mode, signing out and deleting an account.

Read [the README](README.md) first: the global preconditions G1 to G10, the
fixture and the accounts apply to every test here.

In quoted text, `{TRANS}`, `{REV}` and the like stand for that account's
display name, and `{ORG}` for "UI Test Org". Names in other placeholders are
said where they appear.

What works offline here: Me, More settings, a profile name, Blocked people
and the Sync screen. What needs the server: setting a password, turning on
notifications, refreshing the organization list, and deleting the account.
A phone can sign out offline; the web waits for unsent work.

---

## Me

### ACCT-001 Me shows its rows and Sign out
Roles: TRANS, VIEW, ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions: None.

Steps:
1. Tap the "Me" tab.

Expected:
- The header says "Me" and has no Back button.
- One card holds five rows, in this order:
  - The account's display name, with "Name and photo" under it.
  - "Ready for offline", with one of: "Checking this device…", "No passages
    kept on this device yet", "{n} passage(s) on this device", or
    "{ready} of {n} passage(s) ready on this device".
  - "How LangQuest works", with "Listen to a short tour".
  - "Language", with the name of the language the app shows, in that
    language ("English").
  - "More settings", with "Password, notifications, sync, account" and no
    count.
- Below the card, a red "Sign out" link.
- The tab bar shows, with "Me" lit.
- Nothing on Me is about running the organization (no Members, no roles).

### ACCT-002 Me's name falls back to the email, then to "You"
Roles: NEW · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions:
- NEW is a member of ORG (any role; see PEOPLE for invites).
- On the local stack, NEW's `profiles.display_name` is empty (set it in
  Supabase Studio).
- The app's data has been cleared since NEW last had a name, so no name is
  cached.

Steps:
1. Sign in as NEW and tap "Me".
2. Tap "More settings".

Expected:
- Me's first row is the part of NEW's email before "@".
- The card on More settings shows the same text as the name.
- Neither screen shows an id, "null" or an empty row.

Resets: give NEW a name again in Edit Profile.

### ACCT-003 Each row on Me opens its screen, and Back returns
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions: None.

Steps:
1. On Me, tap the name row. Then tap Back.
2. Tap "Ready for offline". Then tap Back.
3. Tap "How LangQuest works". Then tap Back.
4. Tap "Language". Then close the sheet with its ✕.
5. Tap "More settings". Then tap Back.
6. Tap "Sign out". Then tap "Cancel".

Expected:
- Step 1 opens "Edit Profile".
- Step 2 opens "Sync" (the Sync screen; its contents are in SYNC).
- Step 3 opens "What is LangQuest?" with "1 of {n}" under the title.
- Step 4 opens the "Language" sheet over Me.
- Step 5 opens "More settings".
- Step 6 opens the sign-out screen ("Sign out?").
- Each Back, ✕ or "Cancel" returns to Me, with the tab bar showing.
- No step shows "That can't be opened from here." or "You don't have
  permission to open that."

### ACCT-004 Waiting work shows on Me's "More settings" row
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- The device is offline (airplane mode, or the network turned off in the
  browser's developer tools).

Steps:
1. Add a note to P-SUBMITTED ("Something else?", "Add a note"). Recording
   and publishing a version of P-NEW, as in REC, works the same way.
2. Tap "Me".
3. Turn the network back on and wait 30 seconds.

Expected:
- After step 2, "More settings" has a count badge {n} (the events waiting:
  1 for the note), and its sub-line says "{n} waiting to send · password,
  notifications, sync, account".
- After step 3, the badge is gone and the sub-line is "Password,
  notifications, sync, account" again.

Resets: P-SUBMITTED has one more note.

---

## More settings

### ACCT-005 The profile card names the account, its role and the organization
Roles: TRANS, VIEW, LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions: None.

Steps:
1. Tap "Me", then "More settings".

Expected:
- The header says "More settings", with Back.
- A card shows an avatar, the display name, and the account's email.
- Under the email, "{role} · UI Test Org":
  - TRANS: "Translator · UI Test Org".
  - VIEW: "Viewer · UI Test Org".
  - LADMIN: "Language Lead · UI Test Org".
- Rows follow: "Switch Organization" (these accounts are in one
  organization; ACCT-010), then the section "This device" with
  "Sync" and "Send diagnostics", then a red "Delete account" with "Your
  account and your name, for good".
- On iOS and Android there is also "Notifications" with "Hear about
  requests and feedback". On the web there is none (WEB-021).
- No "Set a password" row (these accounts have email).
- No "Blocked people" row (nobody is blocked yet).
- The tab bar is hidden on a phone.

### ACCT-006 A looked-after account sees how to get back in
Roles: KEPT · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Web added (2026-10-12): a browser shows a looked-after account the same
screens, and KEPT, having no password, can be opened there from the
fixture's session, which a phone flow cannot do without a helper's code.

Preconditions:
- KEPT has never set a password.
- KEPT signed in on this device with a sign-in code shown by COORD (PEOPLE).

Steps:
1. Tap "Me", then "More settings".

Expected:
- Under the name, amber text "No email yet" (never the made-up address
  behind the account).
- "Translator · UI Test Org".
- "New device? {inviter} or an admin can help you sign in.", where
  {inviter} is the name of whoever made KEPT's invite. If that person
  cannot be found: "New device? The person who invited you or an admin can
  help you sign in."
- "Signed in on this device with {COORD}'s help · {date}", with today's
  date.
- A "Set a password" row with "If other people use this device". Tapping it
  opens "Edit Profile".

### ACCT-007 Notifications can be turned on
Roles: TRANS · Priority: P1 · Platforms: iOS, Android · Run: Device

Preconditions:
- The app has never asked for notification permission on this device.

Steps:
1. Tap "Me", "More settings", then "Notifications".
2. Allow notifications in the system prompt.
3. Android only: open the system settings for LangQuest's notifications.
4. Go Back to Me, then open "More settings" again.

Expected:
- Step 1 shows the system's permission prompt.
- After step 2, the row's sub-line says "Notifications are on."
- Android: the app has a notification channel named "Work updates".
- After step 4, the sub-line is "Hear about requests and feedback" again
  (the message is not kept).
- COORD asking TRANS to record a passage (PASS) now brings a push to this
  device. Tapping it opens the Inbox over My Work, with Back (NAV).

### ACCT-008 Notifications refused in the system prompt
Roles: TRANS · Priority: P1 · Platforms: iOS, Android · Run: Auto

Preconditions:
- Fresh install, so the system has not been asked. The Maestro flow
  (`flows/ACCT-008.yaml`) sets the permission to "deny" first, which is
  what refusing in the prompt leaves behind; a person refusing in the
  prompt itself is still a device check.

Steps:
1. Tap "Me", "More settings", then "Notifications".
2. Refuse in the system prompt.
3. Open My Work and tap the bell.

Expected:
- After step 2, the sub-line says "Notifications are off. Your inbox still
  works."
- Nothing else changes, and no error code is shown.
- Step 3 opens the Inbox as usual.

### ACCT-009 Notifications offline
Roles: TRANS · Priority: P2 · Platforms: iOS, Android · Run: Device

Preconditions:
- Notification permission is already granted in the system.
- The device is offline.

Steps:
1. Tap "Me", "More settings", then "Notifications".

Expected:
- The sub-line says "Notifications could not be turned on. Try again when
  connected."
- Tapping again once online says "Notifications are on."

### ACCT-010 Switch Organization says which organization is active, on Me for someone in several
Roles: ADMIN, TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions: None.

Steps:
1. Tap "Me". Wait for the organization list to load.
2. Tap "More settings".

Expected:
- ADMIN (in ORG and ORG2): Me's second row, under the name, is "Switch
  Organization" with "UI Test Org (active)". More settings has no "Switch
  Organization" row (decision 71, amended 2026-10-14).
- TRANS (in ORG only): Me has no "Switch Organization" row. More settings
  has "Switch Organization" with "UI Test Org · or start a new one".

### ACCT-011 The Sync row says how sync stands
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions: None.

Steps:
1. Tap "Me", then "More settings". Read the "Sync" row.
2. Turn the network off. Wait 10 seconds and read it again.
3. Still offline, add a note to P-SUBMITTED (PASS). Return to More settings.
4. Turn the network on and wait 30 seconds.

Expected:
- Step 1: "Live: changes arrive as they happen", or "Up to date" if the
  live channel is not open.
- Step 2: "Offline: work is kept on this device". A browser has no network
  signal the app listens to: there the row turns when the live channel's
  heartbeat goes unanswered, after up to a minute.
- Step 3: "{n} change(s) waiting to send", with a count badge {n} on the row.
- Step 4: back to "Live: changes arrive as they happen" or "Up to date",
  with no badge.
- Tapping the row at any point opens "Sync".

### ACCT-012 Send diagnostics is on by default and can be turned off
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Manual

Preconditions:
- Fresh install.

Steps:
1. Tap "Me", "More settings". Look at "Send diagnostics".
2. Tap it to turn it off.
3. Kill the app and open it again (web: reload). Open More settings.
4. Use the app for two minutes (open passages, play audio, sync).
5. On the computer, run `npm run diag` for this device's install id.
6. Turn "Send diagnostics" on again and repeat steps 4 and 5.

Expected:
- Step 1: the switch is on, with "Sends speed and error reports, never
  recordings, what you type or names." It cannot be flipped until it has
  read its saved value (it is greyed for a moment at most).
- Step 2: the switch shows off at once.
- Step 3: it is still off.
- Step 5: no diagnostics from this device are newer than step 2. Any that
  were waiting on the device at step 2 never arrive.
- Step 6: new diagnostics arrive again.
- If saving the choice fails, the switch flips back and a toast says
  "Something went wrong (code {code}). Nothing was lost."

### ACCT-013 Blocked people appears only once someone is blocked
Roles: REV · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- REV has blocked nobody.

Steps:
1. Tap "Me", "More settings". Look for "Blocked people".
2. Block TRANS from the flag on a version of P-SUBMITTED (MOD-008).
3. Return to More settings.
4. Block TREV too, from the flag on anything TREV made, and return.

Expected:
- Step 1: no "Blocked people" row.
- Step 3: "Blocked people" with "1 person", below "Send diagnostics".
- Step 4: "2 people".
- Tapping it opens the "Blocked people" sheet (MOD-012).

Resets: unblock both from the sheet (MOD-012).

### ACCT-014 The Testing section shows only to testers on a local build
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions:
- Run A: a dev client against the local stack, signed in with a persona.
- Run B: a preview build against the preview environment.

Steps:
1. In each run, tap "Me", then "More settings", and scroll to the end.

Expected:
- Run A: a section "Testing" with "Switch persona" and "Sign in as a demo
  translator, reviewer or admin". Tapping it opens the developer sheet.
- Run B: no "Testing" section.

---

## Edit Profile

### ACCT-015 Change your name
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- Device 2 is signed in as COORD.

Steps:
1. Device 1 (TRANS): tap "Me", then the name row.
2. Change "Full Name" to "{TRANS} Test" and tap "Save Profile".
3. Device 2 (COORD): open P-SUBMITTED's history after "Sync now".

Expected:
- Step 1: "Edit Profile" shows an avatar, "Full Name" holding the current
  name, "Email" with the account's address, and "Save Profile". There is no
  password field.
- Step 2: the button says "Saving…" briefly. A toast says "Profile saved.
  It syncs when you are connected." The app returns to where Edit Profile
  was opened from.
- Me's first row and the More settings card show "{TRANS} Test".
- Step 3: within a minute, P-SUBMITTED's Version 1 is by "{TRANS} Test".

Fixed (2026-10-12): Me and More settings kept the old name until the app
reopened; they now show a name still waiting to send, and read the
server's again once it has gone.

Resets: change the name back.

### ACCT-016 A name cannot be blank
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions: None.

Steps:
1. Open "Edit Profile" and clear "Full Name".
2. Type three spaces.

Expected:
- After step 1, the field shows the placeholder "Your name" and "Save
  Profile" is disabled.
- After step 2, "Save Profile" is still disabled.

### ACCT-017 A name changed offline is saved and sent later
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- The device is offline.

Steps:
1. Open "Edit Profile", change the name, and tap "Save Profile".
2. Open "Edit Profile" again.
3. Go to My Work, tap the bell.
4. Turn the network on and wait 30 seconds. Look at the Inbox again.

Expected:
- Step 1: the toast "Profile saved. It syncs when you are connected." Me
  shows the new name at once.
- Step 2: a banner "Saved on this device" with "It sends when you are
  connected." The field holds the new name.
- Step 3: the Inbox starts with "Saved account changes", a row "Profile"
  with "Waiting to send" and the badge "Saved".
- Step 4: the "Saved account changes" section is gone, and Edit Profile has
  no banner.
- While the change waits, signing out on the web is blocked by "1 account
  change" (ACCT-040).

### ACCT-018 A name the server refuses says why
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions: None.

Steps:
1. Open "Edit Profile" and paste a name of 101 characters.
2. Tap "Save Profile" and wait 30 seconds online.
3. Open "Edit Profile" again, then the Inbox from My Work's bell.

Expected:
- Step 3: Edit Profile shows the amber banner "Your last change was not
  accepted" with "Use a name between 1 and 100 characters."
- The Inbox's "Saved account changes" has "Profile" with "Use a name
  between 1 and 100 characters. · Tap to try again" and the badge "Not
  sent".
- If the field stops typing at 100 characters, record that: the case is
  then unreachable, which is also a pass.

### ACCT-019 A looked-after account's password must be 6 or more characters
Roles: KEPT · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto (Web added as for ACCT-006)

Preconditions:
- KEPT has no password.

Steps:
1. Tap "Me", "More settings", "Set a password".
2. Type "abc12" in "Password (optional)" and tap "Save Profile".

Expected:
- Step 1: "Edit Profile" shows "Email" with "No email yet", and a field
  "Password (optional)" with the placeholder "6 or more characters" and the
  hint "Set one if other people use this device, so you can sign back in
  after they do."
- Once something is typed, the hint becomes "You sign in with {handle} and
  this password. Write the name down." ({handle} is KEPT's sign-in name.)
- Step 2: red text "Choose a password of 6 or more characters." The screen
  stays open and nothing is saved.

### ACCT-020 Setting a password needs a connection
Roles: KEPT · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto (Web added as for ACCT-006)

Preconditions:
- KEPT has no password. The device has been online once (its name is
  known), and is now offline.

Steps:
1. Open "Set a password", type "kept-pass-1", and tap "Save Profile".

Expected:
- Red text "Setting a password needs a connection."
- The screen stays open. "Set a password" is still on More settings.

### ACCT-021 A looked-after account sets a password
Roles: KEPT · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto (Web added as for ACCT-006; its own world, `11-account-kept-password.spec.ts`)

Preconditions:
- KEPT has no password. Online.

Steps:
1. Open "Set a password", type a password of 8 characters, and tap "Save
   Profile".
2. Open "More settings", then "Edit Profile" again.
3. Go to Me and tap "Sign out".

Expected:
- Step 1: the toast "Saved. You can sign in with your sign-in name and this
  password." The app goes back.
- Step 2: no "Set a password" row on More settings. Edit Profile's field is
  now "New password (optional)" with the hint "You sign in with {handle}
  and this password. Write the name down."
- Step 3: the sign-out screen no longer mentions a code from anyone (see
  ACCT-041).
- Signing out and back in on Sign In with the sign-in name and the new
  password works (AUTH).

Fixed (2026-10-12): More settings, still open under Edit Profile, kept
offering "Set a password" after one was set; it now reads the account
again when it changes.

Resets: KEPT has a password. ACCT-006, ACCT-019, ACCT-020 and ACCT-041 need a
fresh KEPT.

---

## Switch Organization

### ACCT-022 Switching organization changes the role and the tabs
Roles: ADMIN · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- ADMIN is Organization Admin in ORG and a Translator in ORG2.

Steps:
1. Tap "Me", "Switch Organization".
2. Tap "UI Second Org".
3. Tap "Me", then "More settings", then Back.
4. Open "Switch Organization" again and tap "UI Test Org".

Expected:
- Step 1: the header says "Switch Organization", with Back. Two cards,
  "UI Test Org" with a check mark (screen reader: "UI Test Org, active")
  and "UI Second Org" without one. Then a "New organization" card with
  "You'll be its admin. Your place in the others stays as it is."
- Step 2: a blank screen (screen reader: "Opening your organization") for a
  moment, then ORG2's My Work. The tabs are "Work", "Map", "Me". There is
  no "Manage".
- Step 3: More settings' card says "Translator · UI Second Org", and Me's
  "Switch Organization" says "UI Second Org (active)".
- Nothing from ORG shows in ORG2 (no LANG-A, no ORG passages in My Work).
- Step 4: back in ORG, the tabs are "Work", "Map", "Manage", "Me", and
  "Manage" opens ORG's home.
- No work waiting in one organization is lost by switching (G10.3).

### ACCT-023 The organization list works offline
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- ADMIN has opened "Switch Organization" once online on this device.
- The device is offline.

Steps:
1. Open "Switch Organization" from Me.
2. Tap "UI Second Org".

Expected:
- Step 1: an amber banner "Unable to refresh. Saved organizations remain
  available." Both organizations are listed, as saved.
- Step 2: ORG2 opens from what the device already holds, if ORG2 was opened
  here before. If it was never opened here, record what the screen shows:
  it must not be a crash screen.

### ACCT-024 Tapping the active organization opens it again
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions: None.

Steps:
1. Open "Switch Organization".
2. Tap "UI Test Org" (the only card with a check).

Expected:
- Step 1: one organization card, checked, and "New organization".
- Step 2: a blank screen for a moment, then My Work, with the tabs.
- Nothing waiting is lost, and the open language is the same as before.

### ACCT-025 New organization opens Create Organization
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions: None.

Steps:
1. Open "Switch Organization" and tap "New organization".
2. Tap Back.

Expected:
- Step 1 opens "Create Organization" (its use is in NOORG).
- Step 2 returns to "Switch Organization".

---

## The app's language

### ACCT-026 The Language sheet lists fifteen languages
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- The device's language is English (US). The app follows it.

Steps:
1. Tap "Me", then "Language".

Expected:
- A sheet titled "Language" with "Choose the language LangQuest speaks to
  you in."
- The first row is "Same as this phone" (web: "Same as this browser") with
  "Now English", and a check.
- Then fifteen rows, each named in its own language: "English", "Español",
  "Português (Brasil)", "Français", "العربية", "Kiswahili", "Hausa",
  "አማርኛ", "हिन्दी", "বাংলা", "नेपाली", "Bahasa Indonesia", "简体中文", "ไทย",
  "မြန်မာ".
- Each row except "English" has its English name under it ("Spanish",
  "Portuguese (Brazil)", … "Burmese").
- No row has a "Draft" badge, and there is no draft note at the foot.
- The rows are radio buttons for a screen reader.

### ACCT-027 Picking a language restarts the app in it
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- One note is waiting to send (add it offline, then stay offline). On the
  web the page itself needs its server to reload (decision 58), so there
  only the sync server is out of reach (Playwright aborts its requests).

Steps:
1. Tap "Me", "Language", then "Español".
2. Wait for the app to open again.
3. Kill the app and open it again (web: close the tab and open the site).
4. Go online and wait 30 seconds.

Expected:
- Step 1: the sheet says "Changing the language…", then the app restarts
  (web: the page reloads).
- Step 2: the app opens in Spanish on TRANS's home. The tabs, My Work and
  Me are in Spanish. Me's "Language" row says "Español".
- Step 3: still Spanish.
- The note that was waiting is still waiting after the restart, and goes
  in step 4.
- Names people typed (passage notes, the organization's name) and library
  documents are shown as written, not translated.

Resets: set the language back to "Same as this phone".

### ACCT-028 Every language opens without missing words
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions: None.

Steps:
1. For each of the fifteen languages: pick it in Me → "Language", then
   visit My Work, a passage record, Me, More settings and Sync.
2. Set the language back to "Same as this phone".

Expected:
- Every screen shows words in that language. No screen shows a raw key
  (text like `account.me.title`) or `{{`.
- Counts read naturally ("1 passage", "2 passages" in that language's own
  plural forms).
- Dates and numbers use that language's format.
- No text is cut off so that a button cannot be read. Note any that is.

### ACCT-029 Arabic lays the app out right to left
Roles: TRANS · Priority: P1 · Platforms: iOS, Android · Run: Device

Preconditions: None. `flows/ACCT-029.yaml` automates the restarts, the
Arabic words and the way back to English, and takes screenshots; whether
the layout runs right to left is still judged on them by eye.

Steps:
1. Tap "Me", "Language", then "العربية".
2. Wait for the app to open again. Note whether it restarted once or twice.
3. Kill and open the app.
4. Switch back to "English" from the same row.

Expected:
- Step 2: the app restarts once more by itself to turn the layout right to
  left, then opens. It does not keep restarting.
- The tab bar runs right to left, rows put their icon on the right and
  their chevron on the left, and Back points right.
- Step 3: it opens right to left at once, with no extra restart.
- Step 4: the app returns to left to right after its restart.

### ACCT-030 "Same as this phone" follows the device
Roles: TRANS · Priority: P2 · Platforms: iOS, Android · Run: Manual

Preconditions:
- The app follows the phone ("Same as this phone" is checked).

Steps:
1. Set the device's language to French. Open the app.
2. Set it to Chinese (Traditional, Taiwan). Open the app.
3. Android only: set it to Indonesian (shown to apps as `in`). Open the app.
4. Set it back to English (US).

Expected:
- Step 1: the app shows French. The sheet's first row says "Now Français"
  (in French).
- Step 2: the app shows English (Traditional Chinese has no catalog), not
  Simplified Chinese.
- Step 3: the app shows Indonesian.
- Step 4: English.

### ACCT-031 The language chip on Sign In
Roles: GUEST · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- Signed out, on "Sign In".

Steps:
1. Find the language chip (screen reader: "Language: English. Change it").
2. Tap it and pick "Français".
3. Sign in as TRANS.

Expected:
- Step 2 opens the same "Language" sheet as Me. The app restarts in French
  on Sign In.
- Step 3: the app stays in French after signing in, and Me's "Language" row
  says "Français".

Resets: set the language back to "Same as this phone" (web: see WEB-023,
signing out forgets it).

### ACCT-032 On the web, the page reloads in the language and sets its direction
Roles: TRANS · Priority: P1 · Platforms: Web · Run: Auto

Preconditions: None.

Steps:
1. Tap "Me", "Language". Note the first row.
2. Pick "العربية".
3. In developer tools, read the `<html>` element's `lang` and `dir`.
4. With Playwright, block `/i18n/fr.json`, then pick "Français".
5. Unblock it and pick "Same as this browser".

Expected:
- Step 1: the first row is "Same as this browser".
- Step 2: "Changing the language…", then the page reloads once, in Arabic,
  right to left.
- Step 3: `lang="ar"` and `dir="rtl"`.
- Step 4: after the reload the app is in English (the catalog could not be
  fetched), with no crash and no raw keys.
- Step 5: English, `dir="ltr"`.

### ACCT-033 Picking the language already showing
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- The app follows the phone, which is English.

Steps:
1. Tap "Me", "Language", then "English".
2. Wait 5 seconds, then close the sheet with ✕.

Expected:
- Either the app restarts in English, or the sheet closes; the "English"
  row is checked next time.
- The sheet does not stay on "Changing the language…".

Fixed (2026-10-12): picking the language already showing saves the choice
and closes the sheet (`uiLanguageChoice.ts`); it no longer waits on a
restart that never comes.

---

## Help mode

### ACCT-034 The ? explains each part of the screen
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions: None.

Steps:
1. On Me, tap the "?" in the header (screen reader: "Help: explain this
   screen").
2. Tap the "More settings" row.
3. Tap the tooltip.
4. Tap the red "Sign out" link.
5. Tap the "?" again (screen reader: "Turn help off").

Expected:
- Step 1: the screen dims. Each part (at least the five rows and "Sign out")
  stays lit with a number, in reading order, top to bottom. The "?" stays
  lit, so help can be turned off.
- Step 2: a tooltip beside the row says "More settings" and its sub-line
  "Password, notifications, sync, account". The app does not open More
  settings.
- Step 3: the tooltip closes. Help stays on.
- Step 4: the tooltip says "Sign out" and "Leaves this account on this
  device. Work not yet sent is kept until it is." The app does not leave Me.
- Step 5: the dimming and numbers go. Tapping a row works again.
- A main button anywhere says "The main thing to do on this screen." in its
  tooltip, and a quiet link says "Another way forward, less often needed."
  (check on My Work and on a passage record).

### ACCT-035 Help speaks a part aloud
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Device

Preconditions:
- The app's language has recorded help lines on the server (`npm run
  help-audio`), or the test runs on the web.

Steps:
1. Open the app online once, then turn the network off.
2. On Me, turn help on and tap "Ready for offline".
3. Tap "Listen" in the tooltip, then "Stop" while it plays.

Expected:
- Step 2: the tooltip has a "Listen" button.
- Step 3: the line is spoken (phone: the recorded voice, offline, since
  lines are kept at start; web: the browser's voice). "Listen" becomes
  "Stop", and "Stop" ends it.
- A line nobody recorded shows no "Listen" on a phone.

### ACCT-036 Help mode where there is no header, and right to left
Roles: TRANS · Priority: P2 · Platforms: iOS, Android · Run: Manual

Preconditions: None.

Steps:
1. Tap "Me", then "Sign out". Tap the "?", then "Sign Out".
2. Tap the "?", then "Cancel". Switch the app to "العربية" (ACCT-029).
3. On Me, tap the "?".

Expected:
- Step 1: the sign-out screen has no header, but its "?" sits alone at the
  top on the reading end. With help on, "Sign Out" and "Cancel" are
  numbered, and "Sign Out" explains itself instead of signing out.
- Step 2: the "?" turns help off; "Cancel" goes back to Me.
- Step 3: numbers run in reading order for Arabic: the header first, then
  the rows; in the tab bar, the rightmost tab has the lowest number.

Resets: set the language back to "Same as this phone".

### ACCT-051 In a list, one row takes the help numbers
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions: None.

Steps:
1. Tap "Map", then "Luke". Tap the "?" in the header.
2. Tap chapter 5.
3. Tap the "?" again.

Expected:
- Step 1: only the first chapter in sight has a number; the other chapters
  stay dim with none. The same holds on any list (passages, people, parts
  on the recording screen): one row speaks for the rest.
- Step 2: chapter 5 lights, and a tooltip says what it is and what tapping
  it does. The app does not open the chapter.
- Step 3: the dimming and numbers go.

---

## Signing out

### ACCT-037 Sign out of a phone with nothing waiting
Roles: TRANS · Priority: P0 · Platforms: iOS, Android · Run: Auto

Preconditions: None.

Steps:
1. Tap "Me", then "Sign out".
2. Tap "Cancel".
3. Tap "Sign out" again, then "Sign Out".

Expected:
- Step 1: no header and no tabs, but a "?" at the top. A red person icon,
  the title "Sign out?", and "You can sign back in anytime." A red "Sign
  Out" button and "Cancel".
- Step 2: back on Me.
- Step 3: the button says "Signing out…", then "Sign In" shows.
- The device's language data stays (a phone keeps the log for others).
  Signing in as REV on this phone works and shows REV's home.

### ACCT-038 Sign out of a shared phone with work waiting hands it over
Roles: TRANS, REV, COORD · Priority: P0 · Platforms: iOS, Android · Run: Device

Preconditions:
- Device 1 is a phone signed in as TRANS. Device 2 is signed in as COORD.
- Device 1 is offline.

Steps:
1. Device 1 (TRANS): open P-NEW, record and publish Version 1 (REC).
2. Device 1: tap "Me", then "Sign out".
3. Device 1: tap "Sign Out".
4. Device 1: stay offline for 2 minutes. Then go online and, on "Sign In",
   sign in as REV.
5. Wait 60 seconds. Device 2 (COORD): tap "Sync now" on Sync, then open
   P-NEW.
6. Device 1 (REV): open P-NEW and play Version 1.

Expected:
- Step 2: an amber cloud icon, the title "Sign out?", and "Still to send:
  {n} changes, {m} recording(s). All of it will still be sent, as you, when
  this device is online." "Sign Out" is enabled.
- Step 3: works offline. "Sign In" shows.
- Step 5: Device 2 shows Version 1 of P-NEW by {TRANS}, not by {REV}. Its
  audio plays.
- Device 2's Inbox or P-NEW's history says {TRANS} recorded it.
- Step 6: REV can play it.
- On the server, every event of Version 1 has TRANS's actor id
  (`npm run diag` or Supabase Studio, `events`).
- Nothing was refused (Sync on device 1, as REV, shows "refused by the
  server" at 0).

The P0 smoke flow `P0-signout-handover.yaml` covers the sign-out message, the
hand-over and "refused" at 0 on Android with a note instead of a recording
(airplane mode; no second device, so not the COORD or server-actor checks).

### ACCT-039 Signing back in on the same phone takes the work back
Roles: TRANS · Priority: P1 · Platforms: iOS, Android · Run: Device

Preconditions:
- Device 1 is offline, signed in as TRANS, with nothing waiting.

Steps:
1. Add a note to P-SUBMITTED. Tap "Me", "Sign out", "Sign Out".
2. Go online and sign in as TRANS again at once.
3. Open My Work and look beside the bell. Wait 30 seconds.

Expected:
- Step 3: if the note had not gone yet, the chip shows "1 to send" briefly,
  then goes. The note reaches the server once, as TRANS (COORD sees one
  note, not two).

### ACCT-040 On the web, sign-out waits for work to send
Roles: TRANS · Priority: P0 · Platforms: Web · Run: Auto

Preconditions:
- The browser is offline (developer tools: Network → Offline).

Steps:
1. Add a note to P-SUBMITTED.
2. Tap "Me", then "Sign out".
3. Go online and wait 30 seconds without leaving the screen.
4. Tap "Sign Out".

Expected:
- Step 2: an amber cloud icon, the title "Not yet", and "Still to send: 1
  change. This device is offline. Sign out once they have synced so they
  are not stranded here." "Sign Out" is disabled. "Cancel" works.
- If the browser is online but the work has not gone yet, the text is
  "Still to send: 1 change. Sign out once they have synced so they are not
  stranded here."
- Step 3: the title becomes "Sign out?" with "You can sign back in anytime.
  This browser forgets everything it kept for you, so the next person here
  sees none of it." "Sign Out" is enabled.
- Step 4: the page reloads to "Sign In" (what is forgotten is in WEB-023).

### ACCT-041 A looked-after account is warned before signing out
Roles: KEPT · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto (Web added as for ACCT-006; the hand-over case below is phones only, as a browser waits for the work instead)

Preconditions:
- KEPT has no password. Nothing is waiting.

Steps:
1. Tap "Me", then "Sign out".

Expected:
- "Sign out?" with "To sign back in, you'll need a code from {inviter} or an
  admin. If other people use this device, set a password in Edit Profile
  first."
- If the inviter cannot be found: "To sign back in, you'll need a code from
  the person who invited you or an admin. If other people use this device,
  set a password in Edit Profile first."
- With work waiting (offline, after recording), the text is the hand-over
  sentence followed by the code sentence.
- "Sign Out" is enabled.

### ACCT-042 An account the server refuses can sign out
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Device

Preconditions:
- TRANS has a refused organization, as set up in SYNC-018 (removed while
  offline, with work queued).

Steps:
1. Tap "Me". Read "More settings". Tap "Sign out".

Expected:
- "More settings" says "This account cannot sync · password,
  notifications, account".
- The sign-out screen says "This account cannot sync this organization:
  the server refused it. Signing out is safe; anything queued stays on this
  device." "Sign Out" is enabled, also on the web.
- The refused work is not counted as waiting.

### ACCT-043 Sign out offline after turning on notifications
Roles: TRANS · Priority: P1 · Platforms: iOS, Android · Run: Device

Preconditions:
- Notifications were turned on (ACCT-007), so the device holds a push token.
- Nothing is waiting. The device is offline.

Steps:
1. Tap "Me", "Sign out", then "Sign Out".

Expected:
- Before step 1's last tap, the screen says "This device is offline, so
  signing back in will have to wait for a connection."
- "Sign In" shows, as when nothing is waiting online. Push notifications
  for TRANS stop on this device once it is online again (the hand-over
  disconnects them as TRANS, decision 87).

Fixed (2026-10-12, decision 87): offline, a phone whose notifications
cannot be disconnected hands the disconnect to the courier and signs out
(`SignOutConfirm`, `tryUnregisterNotifications`); it no longer shows
"Something went wrong". Confirmed from the code; still to be seen on a
device.

---

## Deleting an account

Run these with NEW accounts only. Accounts made during a run are deleted at
the end this way (README).

### ACCT-044 The Delete Account screen says what goes and what stays
Roles: NEW · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- NEW-1 is a Translator at LANG-A (joined by an invite, PEOPLE).

Steps:
1. Tap "Me", "More settings", then "Delete account".
2. Tap "Cancel".

Expected:
- Step 1: header "Delete Account" with Back. A heading "Delete your
  account?". Two rows: "Deleted" with "Your sign-in, email, name,
  notifications, blocks and diagnostics. You leave every organization.",
  and "Kept by your organization" with "Recordings, reviews and notes you
  made stay part of its work, without your name."
- "This cannot be undone. To use LangQuest again you would create a new
  account."
- A red "Delete My Account" button, enabled, and "Cancel".
- No banner. No tabs.
- Step 2: back on More settings.

### ACCT-045 Deleting needs a connection
Roles: NEW · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- NEW-1 as in ACCT-044, with nothing waiting. The device is offline.

Steps:
1. Open "Delete account".

Expected:
- An amber banner "You're offline" with "Connect to the internet to delete
  your account."
- "Delete My Account" is disabled.
- Going online removes the banner and enables the button within a few
  seconds.

### ACCT-046 Deleting waits for work to send
Roles: NEW · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- NEW-1 as in ACCT-044. The device is offline.

Steps:
1. Add a note to P-SUBMITTED. (Recording and publishing a version of Luke
   17:1-10, not started in the fixture, also adds "1 recording" to the
   list; ACCT-047 needs that version.)
2. Open "Delete account".
3. Go online and wait until the Sync screen shows "waiting to upload" at 0.
   Open "Delete account" again.

Expected:
- Step 2: an amber banner "Send your work first" with "Still to send: 1
  change. Delete your account once they have synced, so your organization
  gets them." (with a recording: "{n} changes, 1 recording"). It shows
  instead of the offline banner. "Delete My Account" is disabled.
- Step 3: no banner; the button is enabled.

Resets: P-SUBMITTED has a note by NEW-1 (and LANG-A a version of Luke
17:1-10 if it was recorded).

### ACCT-047 One tap deletes the account, and the work stays without a name
Roles: NEW, COORD · Priority: P0 · Platforms: iOS, Android, Web · Run: Device

Preconditions:
- NEW-1 published Luke 17:1-10 Version 1 (REC, or ACCT-046 with a
  recording) and it reached the server.
- Device 2 is signed in as COORD.

Steps:
1. Device 1 (NEW-1): on "Delete Account", tap "Delete My Account" once.
2. Device 1: on "Sign In", sign in with NEW-1's email and password.
3. Device 2 (COORD): tap "Sync now", restart the app, and open Luke
   17:1-10. Then open "Manage" → Members.

Expected:
- Step 1: the button says "Deleting…". No second question is asked. "Sign
  In" shows (web: the page reloads to it, and the browser's data is gone as
  in WEB-023).
- Step 2: sign-in fails as for an unknown account (AUTH).
- Step 3: Version 1 is still there and plays. Its author shows as a colour
  and shape name (for example "Teal Hexagon"), never NEW-1's name or email.
- Members does not list NEW-1.
- The passage's status is unchanged by the deletion.

### ACCT-048 A server error on delete keeps you signed in
Roles: NEW · Priority: P2 · Platforms: Web · Run: Auto

Preconditions:
- A fresh NEW account in ORG. Playwright answers the `delete_my_account`
  request with HTTP 500.

Steps:
1. Open "Delete account" and tap "Delete My Account".

Expected:
- Red text "Something went wrong (code {code}). Nothing was lost."
- Still signed in, on "Delete Account", with the button enabled again.

### ACCT-049 Deleting from "Join your team"
Roles: NEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions:
- NEW-2 has just created an account and belongs to no organization, so it
  is on "Join your team" (NOORG).

Steps:
1. Tap "Delete account" on "Join your team".
2. Tap Back.
3. Tap "Delete account" again, then "Delete My Account".

Expected:
- Step 1: the same "Delete Account" screen as ACCT-044.
- Step 2: back on "Join your team".
- Step 3: "Sign In" shows. NEW-2 can no longer sign in.

---

## Other rows on Me

### ACCT-050 The tour and the microphone open from Me
Roles: REV · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions: None.

Steps:
1. Tap "Me", then "How LangQuest works". Step forward to the end, then back
   to the start, and tap Back.
2. Tap "Set up the microphone", then Back.

Expected:
- Step 1: "What is LangQuest?" with "1 of {n}"; the count follows each step.
  Back on the first step returns to Me. Nothing is marked or changed.
- Step 2: "Set up your microphone" (what it does is in REC). Back returns to
  Me.
- Neither screen shows the tab bar on a phone.

### ACCT-057 A disguised phone opens on its calculator, and the code opens LangQuest
Roles: TRANS · Priority: P1 · Platforms: iOS, Android · Run: Auto

Preconditions: LangQuest's own icon (decisions.md 171). The Maestro flow
(`flows/ACCT-057.yaml`) takes the disguise off again at the end.

Steps:
1. Tap "Me", "More settings", "App icon", then "Calculator 1".
2. Type 2468 as the code and tap "Next".
3. Type 2, 4, 6, 8 on the calculator. On iPhone, tap OK on the system's
   message.
4. Leave the app and open it again (on Android, from the new icon).
5. Type 2, 4, 6, 8 on the calculator.
6. Tap "Me" if it shows, "More settings", "App icon", then "LangQuest".

Expected:
- Step 2: "Type your code" over a working calculator.
- Step 3: the disguise goes on. iOS says the icon changed and the app stays
  on More settings, whose App icon row says "Calculator" and which shows no
  Notifications row. Android closes the app; its launcher lists "Calculator"
  with the calculator icon and no LangQuest Next.
- Step 4: the calculator opens, not LangQuest; nothing of the app shows.
- Step 5: LangQuest opens (on Android at its home screen).
- Step 6: LangQuest's own icon is back (Android closes the app again), and
  App icon says "LangQuest".

---

## Global Viewers

A Global Viewer is LangQuest support: an account that belongs to no
organization and reads any of them as a Viewer would, once it has entered a
code from an authenticator app (decisions.md 158, docs/global-viewers.md).
Each test makes its own account and grants it as an operator does
(`global_viewer_grant`). Codes are worked out from the authenticator's key,
as the app on a phone would.

### ACCT-052 A new Global Viewer sets up an authenticator on What brings you here?
Roles: GV (new) · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions: A new account, granted, with no authenticator yet.

Steps:
1. Sign in.
2. Tap "Global Viewer", then "Set up authenticator".
3. Type the code for the key shown, and tap "Check code".

Expected:
- Step 1: "Global Viewer" says "Set up your authenticator to begin", first,
  above the usual ways to join or start an organization.
- Step 2: a code to scan and the key to type, in groups of four.
- Step 3: "You can read every organization", with a search for one.

### ACCT-053 A wrong code is refused and opens nothing
Roles: GV (new) · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions: A granted account with an authenticator, signed in with its
password only.

Steps:
1. Tap "Global Viewer". Type a code that is not the authenticator's, and tap
   "Check code".

Expected:
- "That code is not right. Type the code your authenticator shows now." No
  organizations are listed.

### ACCT-054 A Global Viewer opens another organization and only views it
Roles: GV (new) · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions: As ACCT-053.

Steps:
1. Tap "Global Viewer", type the authenticator's code, and tap "Check code".
2. Search for ORG by its name and tap it, then tap the eye in the header.

Expected:
- Step 1: on the web, "Operations dashboard" is above the search, and
  opens /ops-dashboard in a new tab. A phone does not show it.
- Step 2: ORG opens on the overview. The tabs are Map, Manage and Me (no
  Work, no Inbox), and every header has an eye ("Global Viewer" beside it
  on a wide window). A passage, such as P-NEW, offers no Edit or Record.
  One waiting on a check, such as P-SUBMITTED, offers no review action: its
  "Then the team" rows open no sheet, there is no report flag, and
  "Something else?" has only "What helps here" and keeping it offline. The
  eye opens Global Viewer: ORG under "Viewing now", and
  the search for another organization below it.

### ACCT-055 A Global Viewer reads Manage as its admins see it, and changes nothing
Roles: GV (new) · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions: As ACCT-053.

Steps:
1. Enter the code, open ORG as in ACCT-054, then tap "Manage".
2. Tap "Members".

Expected:
- Step 1: ORG's page, as its admins see it. The organization's name has no
  rename pencil.
- Step 2: ORG's members, ADMIN among them. Anything tried that would change
  ORG says "You're viewing as a Global Viewer: nothing here can be changed."
  and nothing changes.

### ACCT-056 A revoked Global Viewer account is an ordinary one
Roles: GV (new) · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions: A granted account, then revoked (`npm run global-viewer --
revoke`), which ended its sign-ins.

Steps:
1. Sign in with its password.

Expected:
- "What brings you here?" says "Global Viewer access has ended" at the top,
  and offers the usual ways to join or start an organization. There is no
  "Global Viewer" card.

