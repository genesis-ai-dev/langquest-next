# 01 Getting in

Signing in, creating an account, the terms, browsing public work, invites,
a helper's sign-in code, the welcome and "What is LangQuest?". IDs `AUTH`.
The test template, the global preconditions G1 to G10, the fixture and the
accounts are in [the README](README.md).

**For this file**
- GUEST tests start on the Sign In screen, signed out. G6 and G7 do not
  apply to them.
- Invites are made on a second device by COORD, unless a test says
  otherwise: Manage → "Invite people" → a role and a language → "One person,
  by name" → "Invite by QR". There, "One person" or "A group", then the
  name. The QR shows; "Or type this code" shows the bare code, and "Share
  invite" gives the link to paste.
- A one-person invite in these tests is labelled "Test Person", for the
  Translator role in LANG-A. A group invite is labelled "UI Test workshop",
  for the Translator role in LANG-A.
- Links take two forms, and both must work:
  - `https://<app host>/invite#org=<org id>&token=<token>`
  - `langquestnext://invite?org=<org id>&token=<token>`
  - A helper's sign-in code uses the same forms with `/signin` and
    `code=<64 hex>`.
- To open a link on a device:
  - iOS: `xcrun simctl openurl booted "<link>"`.
  - Android: `adb shell am start -a android.intent.action.VIEW -d "<link>"`.
  - Web: paste it into the address bar.
- Auto runs read a QR by decoding it from a screenshot (for example with
  `zbarimg`), then open it as a link.
- Accounts made by joining (looked-after accounts) are deleted at the end of
  the run, as the README says for NEW.
- Automation (`e2e/ui/01-getting-in.spec.ts`, and
  `01-getting-in-welcome.spec.ts` for AUTH-056 to 059 on a never-welcomed
  world) issues invites and helpers' codes through the server as the app
  does, and opens links by loading them in the browser. So that one test's
  join does not change the next one's account, AUTH-030 to 032 join UI
  Second Org (invited by its owner) as TRANS, REV and TREV in turn, instead
  of an "UI Admin Org" made by NOORG-013; AUTH-033, 037 and 043 use a fresh
  account with no organization for NOORG, and AUTH-043 uses LADMIN for an
  account with a home. Explore's row for LANG-A is written as the projection
  worker writes it.

## Sign in

### AUTH-001 The Sign In screen offers two ways in
Roles: GUEST · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Fresh install, or signed out with no invite held.

Steps:
1. Open the app.

Expected:
- A language chip shows at the top. Its accessibility label is "Language: English. Change it".
- "LangQuest" and the line "Coordinating Bible translation — draft to approval" show.
- The fields come first:
  - "Email or sign-in name"
  - "Password", hidden as it is typed
  - "Sign In", disabled
  - "By signing in you accept the Terms of Use and Privacy Policy"
- Then "or", then "Scan a code" with the hint "An invite, or a code from someone helping you sign in".
- Then "Don't have an account?" with "Create Account", and "Browse public work".
- No "Sign in to join" banner shows.
- On a preview build, "Switch persona" does not show.
- No tab bar shows.

### AUTH-002 Sign in with email and password
Roles: ADMIN, COORD, LADMIN, TRANS, REV, TREV, VIEW · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Signed out. The account has been welcomed before (it has signed in once).

Steps:
1. Type the account's email in "Email or sign-in name".
2. Type its password in "Password".
3. Tap "Sign In".

Expected:
- While it works, the button reads "Signing in…" and cannot be tapped again.
- The role's home opens, as "Home after sign-in" in the README's role table says. The tab bar matches "Tabs on a phone".
  - ADMIN is also a Translator in UI Second Org. On a device that has never had an organization open, the app opens the first of the account's organizations by name, so ADMIN may land in UI Second Org with Work, Map and Me.
- No welcome shows, because the account was welcomed before.
- Signing in recorded the terms: a second device signed in as the same account shows nothing waiting to send about terms (G10.3).

### AUTH-003 Sign In stays disabled until both fields can be used
Roles: GUEST · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Type "a" in "Email or sign-in name" and "x" in "Password".
2. Change the name field to "nobody" and clear "Password".
3. Type "x" in "Password".
4. Change the name field to "user@example.org".
5. Change the name field to "-bad-name".
6. Change the name field to "Nyibol-482", with mixed case.

Expected:
- Step 1: "Sign In" is disabled. "a" is too short to be a sign-in name and has no "@".
- Step 2: disabled, because the password is empty.
- Step 3: enabled. "nobody" is a possible sign-in name.
- Step 4: enabled.
- Step 5: disabled. A sign-in name cannot start with "-".
- Step 6: enabled. Case does not matter.
- No error text shows at any step.

### AUTH-004 A looked-after account signs in by its sign-in name
Roles: KEPT · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- KEPT has set a password in Edit Profile, for a shared phone. Their sign-in name (for example `kept-123`) is in the tester's notes.
- KEPT is signed out on this device.

Steps:
1. Type KEPT's sign-in name, with no "@", in "Email or sign-in name".
2. Type the password, then tap "Sign In".

Expected:
- My Work opens with Work, Map and Me tabs.
- No email address was typed anywhere.

### AUTH-005 Wrong password or unknown account
Roles: GUEST · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Type TRANS's email and a wrong password, then tap "Sign In".
2. Type "nobody-here@example.org" with any password, then tap "Sign In".
3. Type the sign-in name "nobody-999" with any password, then tap "Sign In".

Expected:
- Each time, "Wrong email, sign-in name or password." shows under the fields, read out as an alert.
- The message does not say which part was wrong.
- The fields keep what was typed.
- The screen stays on Sign In.

### AUTH-006 Too many tries
Roles: GUEST · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions (in addition to the global ones):
- The local auth rate limit for sign-ins is known. Lower it in `supabase/config.toml` for this run if it is high, and restore it afterwards.

Steps:
1. Sign in with TRANS's email and a wrong password, repeatedly, until the server stops counting.

Expected:
- "Too many tries. Wait a few minutes, then try again." shows.
- After the wait, the right password signs in.

### AUTH-007 A suspended account
Roles: GUEST · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions (in addition to the global ones):
- A NEW account exists and is banned on the local server, through the Supabase admin API (`ban_duration`).

Steps:
1. Sign in with that account's email and password.

Expected:
- "This account is suspended." shows.
- The screen stays on Sign In.

### AUTH-008 Signing in with no connection
Roles: GUEST · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- The device is offline: airplane mode, or Chrome's network set to Offline.

Steps:
1. Type TRANS's email and password, then tap "Sign In".
2. Go back online, then tap "Sign In" again.

Expected:
- Step 1: "Not connected. Try again when you are online." shows. The app does not crash or hang on "Signing in…".
- Step 2: My Work opens.

### AUTH-009 Rare refusals still say something plain
Roles: GUEST · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions (in addition to the global ones):
- A proxy (for example mitmproxy) sits in front of the local Supabase auth endpoint. It can answer `/auth/v1/token` with a chosen error code.

Steps:
1. Make the proxy answer with the code `session_not_found`, then sign in as TRANS.
2. Make it answer with an unknown code (for example `unexpected_failure`), then sign in.

Expected:
- Step 1: "Your session ended. Sign in again."
- Step 2: "Could not sign in. Try again."
- If the app faults instead, the text reads "Something went wrong (code …). Nothing was lost." and the code is in the log (G9).

### AUTH-010 A developer build fills in the dev account
Roles: GUEST · Priority: P2 · Platforms: iOS, Android · Run: Manual

Preconditions (in addition to the global ones):
- One dev client built with `EXPO_PUBLIC_DEV_EMAIL` and `EXPO_PUBLIC_DEV_PASSWORD` set, and one preview build.

Steps:
1. Open the dev client, signed out.
2. Open the preview build, signed out.

Expected:
- Dev client: both fields are filled in from the env file. "Switch persona" shows under "Browse public work".
- Preview build: both fields are empty. "Switch persona" is not shown, unless the account is a listed persona tester on a local server.

## Terms & Privacy

### AUTH-011 The terms are one tap from Sign In
Roles: GUEST · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Tap "By signing in you accept the Terms of Use and Privacy Policy".
2. Scroll to the end.
3. Tap the back arrow.

Expected:
- "Terms & Privacy" opens.
- It has four cards, in this order:
  - "Terms of Use", with "Updated 2026-09-30". Its text says "You must be 18 or older."
  - "Not allowed", with "Do not record, write or share:" and nine bullets. The first starts "Hate:" and the last starts "Trying to break into LangQuest".
  - "Reporting and blocking". It says "We act on them within 24 hours." and gives admin@frontierrnd.com.
  - "Privacy Policy", with "Read the full privacy policy".
- The page is read only: it has no checkbox or Accept button.
- Back returns to Sign In, and what was typed in the fields is still there.

### AUTH-012 The full privacy policy opens outside the app
Roles: GUEST · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- On "Terms & Privacy".

Steps:
1. Tap "Read the full privacy policy".

Expected:
- https://next.langquest.org/privacy opens in the system browser, or in a new tab on the web.
- Returning to the app shows "Terms & Privacy" unchanged.

### AUTH-013 The terms line on Create Account and the scan screen
Roles: GUEST · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- A one-person invite exists, and its link is to hand.

Steps:
1. Tap "Create Account". Tap "Creating an account accepts the Terms of Use and Privacy Policy", then go back.
2. Go back to Sign In. Tap "Scan a code" and paste the invite link in "Or paste the code or link".
3. Tap "Joining accepts the Terms of Use and Privacy Policy", then go back.

Expected:
- Each line opens "Terms & Privacy". Back returns to the screen it came from.
- After step 2, the scan screen shows the joining line under the invite card.

## Browse public work

### AUTH-014 A guest browses public work
Roles: GUEST · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- ORG lists LANG-A publicly (fixture).

Steps:
1. Tap "Browse public work".

Expected:
- "Explore" opens, with "Sign In" in the header and a back arrow.
- "Loading…" may show briefly, then the list.
- Under "Listed publicly", LANG-A's card shows:
  - Its name, "Alpha", and its language code under it.
  - The badge "All rights reserved · Only your organization", grey, not green.
  - A progress bar, "Recorded", and a percentage.
- Its accessibility label reads "Alpha, {percent}".
- A language listed by an organization under an open licence (any CC licence) shows a green badge, for example "CC BY 4.0 · Any use, with credit".
- Languages are in name order.

### AUTH-015 From Explore a guest is sent to sign in
Roles: GUEST · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- On "Explore", signed out.

Steps:
1. Tap LANG-A's card.
2. Tap "Browse public work" again, then tap "Sign In" in the header.
3. Tap "Browse public work" again, then tap the back arrow.

Expected:
- Each time, the Sign In screen opens.
- Nothing of LANG-A's passages, members or recordings is shown to a guest.

### AUTH-016 Explore offline shows what this device saved
Roles: GUEST · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- AUTH-014 has run on this device, so the list is saved.

Steps:
1. Go offline.
2. Tap "Browse public work".
3. Go online, go back, and tap "Browse public work" again.

Expected:
- Step 2: the saved list shows at once, with the banner "Unable to refresh. Showing what was saved on this device."
- Step 3: the banner is gone, and the list is the server's.

### AUTH-017 Nothing listed yet
Roles: GUEST · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Fresh install, on a server where no organization lists a language (a fresh fixture before ORG lists LANG-A, or LANG-A unlisted for this test).

Resets: list LANG-A again afterwards.

Steps:
1. Tap "Browse public work".

Expected:
- "Nothing listed yet" with "Organizations appear here when they list their work publicly."
- No "Listed publicly" label shows.

### AUTH-018 Explore shows 25 at a time
Roles: GUEST · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- At least 30 languages are listed publicly on the server (seeded for this test).

Steps:
1. Tap "Browse public work" and scroll to the end.
2. Tap "Show 5 more · 5 left", or whatever the count is.

Expected:
- 25 cards show first, then "Show {n} more · {n} left" (n is the number beyond 25, at most 25).
- After the tap, all of them show, and the button is gone.

## Create account

### AUTH-019 Create an account with an email
Roles: NEW · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Signed out. Email confirmation is off on the server (the local default).

Steps:
1. Tap "Create Account".
2. Type the NEW address in "Email".
3. Type an 8-character password in "Password" and again in "Confirm password".
4. Tap "Create Account".

Expected:
- "Create Account" opens with three fields:
  - "Email", with "you@example.com" as its placeholder.
  - "Password", with "Choose a password (6 or more characters)".
  - "Confirm password", with "Re-enter password".
- Under the button is "Creating an account accepts the Terms of Use and Privacy Policy", then "or", "Scan an invite" and "No email or password needed. The invite makes your account and puts you on the team."
- While it works, the button reads "Creating…".
- "Join your team" opens, with no tab bar. No welcome shows: the account belongs to no organization yet.
- The terms are recorded for this account (nothing waits to send after 30 seconds online).

### AUTH-020 Create Account stays disabled until the fields are usable
Roles: GUEST · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- On "Create Account".

Steps:
1. Type "someone" in "Email", and "secret1" in both password fields.
2. Change "Email" to "someone@example.org".
3. Change both password fields to "abc12", 5 characters.

Expected:
- Step 1: "Create Account" is disabled (the email has no "@").
- Step 2: enabled.
- Step 3: disabled. A short line says the password needs 6 or more characters.

Fixed (2026-10-12): "The password needs 6 or more characters." shows under the fields while the password is shorter.

### AUTH-021 Passwords that do not match
Roles: GUEST · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- On "Create Account" with a valid email typed.

Steps:
1. Type "secret12" in "Password" and "secret13" in "Confirm password".
2. Change "Confirm password" to "secret12".

Expected:
- Step 1: "Passwords do not match." shows under the fields, and "Create Account" is disabled.
- Step 2: the message goes, and the button is enabled.

### AUTH-022 An email that already has an account
Roles: GUEST · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Email confirmation is off on the server (the local default).

Steps:
1. On "Create Account", type TRANS's email and a new 8-character password twice.
2. Tap "Create Account".

Expected:
- "There is already an account with this email. Sign in instead." shows.
- No second account is made, and TRANS's password is unchanged: TRANS still signs in with the old one.

### AUTH-023 Creating an account when the email must be confirmed first
Roles: NEW · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions (in addition to the global ones):
- The local server runs with email confirmation on (`enable_confirmations = true` under `[auth.email]` in `supabase/config.toml`). Restore it afterwards.
- The local mail catcher (Mailpit) is open.

Steps:
1. Create an account with a NEW address, as in AUTH-019.
2. Tap the back arrow, then sign in with the new address and password.
3. Open the confirmation email in Mailpit, follow its link, then sign in again in the app.

Expected:
- Step 1: "Account created" with "Open the link we sent to {address}, then sign in. You can create an organization, ask to join one, or scan an invite when you are ready."
- Step 2: "Open the link we sent to your email first, then sign in."
- Step 3: "Join your team" opens.
- With confirmation on, creating an account for an existing address also shows "Account created". The server does not say which addresses exist, and no second account is made.

### AUTH-024 Creating an account with no connection
Roles: NEW · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- The device is offline.

Steps:
1. Fill in "Create Account" correctly and tap "Create Account".
2. Go online and tap it again.

Expected:
- Step 1: "Not connected. Try again when you are online." The fields keep what was typed.
- Step 2: "Join your team" opens.

## Invites

### AUTH-025 A new person joins with a one-person invite, by camera
Roles: GUEST · Priority: P0 · Platforms: iOS, Android · Run: Device

Preconditions (in addition to the global ones):
- Device 2 (COORD) shows a one-person invite QR labelled "Test Person", for Translator in LANG-A.
- Device 1 is a real phone, signed out, with camera permission not yet asked.

Steps:
1. Device 1: tap "Scan a code".
2. Allow the camera when asked.
3. Point the camera at Device 2's QR.
4. Tap "Join as Test".

Expected:
- The scan screen is titled "Scan a code", with "No email or password needed" under it.
- The camera starts by itself once allowed. The hint reads "Point the camera at the code", and the button reads "Stop camera".
- Once the code is read:
  - The camera stops and the hint reads "Code read".
  - The card shows "Invite for Test Person", then "Translator · Alpha · UI Test Org", then "From {COORD's name}".
  - "Joining accepts the Terms of Use and Privacy Policy" shows.
- The footer has "Join as Test" and "I already have an account".
- The button reads "Joining…" while it works. Then the welcome opens, with no email, password or name asked for:
  - "{COORD's name} invited you" over "Welcome, Test".
  - "You're a Translator on the Alpha team at UI Test Org."
  - The "Nothing to remember" banner: "This device keeps you signed in. On a new device, ask {COORD's name} to help you sign in."
  - The translator's three lines (AUTH-056).
- Device 2: after Sync now, Members lists Test Person as a Translator in Alpha.

### AUTH-026 A new person joins by pasting a one-person invite
Roles: GUEST · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- A new one-person invite labelled "Test Person" exists. Its link (from "Share invite") is to hand.

Steps:
1. Tap "Scan a code". On a phone, tap "Stop camera" if the camera started.
2. Paste the link into "Or paste the code or link".
3. Tap "Join as Test".
4. Tap "Get started".

Expected:
- On the web, the camera does not start by itself. The hint reads "Tap Scan to use the camera" and the button reads "Scan QR code".
- As soon as the link is pasted, the field clears, the card shows "Invite for Test Person", and the button reads "Scan a different code".
- Step 3 opens the welcome as in AUTH-025.
- Step 4 opens My Work, with Work, Map and Me tabs.
- Me → More settings shows "No email yet" for this account, never its managed address (decisions.md 59).

### AUTH-027 A bare invite code can be typed or pasted
Roles: GUEST · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- A new one-person invite exists. Its bare code (shown under "Or type this code") is to hand.

Steps:
1. Tap "Scan a code" and paste the bare code into "Or paste the code or link".

Expected:
- The invite card shows "Invite for Test Person" and the same detail as from the link.
- "Join as Test" is offered.

### AUTH-028 A group invite asks for the person's name
Roles: GUEST · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- A group invite labelled "UI Test workshop" exists, for Translator in LANG-A. Its link is to hand.

Steps:
1. Tap "Scan a code" and paste the group link.
2. Tap "Join".
3. Type "Ana Workshop" in "Your name" and tap "Join".

Expected:
- The card's title is "UI Test workshop", as the inviter wrote it, not "Invite for …". The footer button is "Join", not "Join as …".
- Step 2 opens "Join with your invite":
  - "No email or password needed. Your team sees you by this name."
  - The field "Your name", empty.
  - "Join", disabled until a name is typed.
  - "Joining accepts the Terms of Use and Privacy Policy".
- While it works, the button reads "Joining…". Then the welcome opens with "Welcome, Ana" and "You're a Translator on the Alpha team at UI Test Org.", and the "Nothing to remember" banner.
- A second person can join with the same group link on another fresh device.

### AUTH-029 The name screen needs a name
Roles: GUEST · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- On "Join with your invite", from a group invite.

Steps:
1. Type three spaces in "Your name".
2. Tap the back arrow.

Expected:
- Step 1: "Join" stays disabled.
- Step 2: the scan screen shows again with the invite card. The invite is still held.

### AUTH-030 "I already have an account" joins after signing in
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- TRANS is signed out on this device.
- ADMIN has an organization of its own, "UI Admin Org", made as NOORG-013 does (before this file, on a fresh fixture). ADMIN has made a one-person invite there labelled "Translator Two", for the Translator role, and its link is to hand.
- TRANS has been welcomed before.

Steps:
1. Tap "Scan a code" and paste the link.
2. Tap "I already have an account".
3. Sign in as TRANS.
4. Tap "Get started".

Expected:
- Step 2 opens Sign In with the banner "Sign in to join" / "Your invite is saved. You'll join as soon as you sign in."
- Step 3 joins with no further tap. The welcome opens, even though TRANS was welcomed before:
  - "{ADMIN's name} invited you".
  - "Welcome, {TRANS's first name}".
  - "You're a Translator on UI Admin Org."
- No "Nothing to remember" banner shows, because TRANS has an email.
- Step 4 opens My Work in UI Admin Org. Me → More settings → "Switch Organization" lists UI Test Org and UI Admin Org.

### AUTH-031 A held invite survives a restart
Roles: GUEST, TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Signed out. A new invite for TRANS, as in AUTH-030, is to hand.

Steps:
1. Tap "Scan a code", paste the link, and tap "I already have an account".
2. Kill the app (on the web, close the tab) and open it again.
3. Sign in as TRANS.

Expected:
- After the restart, Sign In still shows "Sign in to join".
- Signing in joins and opens the welcome, as in AUTH-030.

### AUTH-032 An invite nobody claimed is offered after signing in
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Signed out. A new invite for TRANS, as in AUTH-030, is to hand.

Steps:
1. Tap "Scan a code" and paste the link. Tap neither button.
2. Tap the back arrow to Sign In, and sign in as TRANS.
3. Tap "Not now".

Expected:
- Step 2: Sign In shows no "Sign in to join" banner. After signing in, the app goes to "Scan a code" by itself:
  - The subtitle reads "Invite includes organization, role, and scope".
  - The invite card shows.
  - The footer has "Join as {TRANS's name}" and "Not {TRANS's name}? Sign out first", and "Not now" is under the field.
- Nothing joins without a tap.
- Step 3 drops the invite and opens My Work. Signing out and in again does not offer it again.

### AUTH-033 A signed-in member joins with "Join as"
Roles: NOORG · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- NOORG is signed in, on "Join your team".
- A one-person invite for Translator in LANG-A is to hand.

Steps:
1. Tap "Scan their code".
2. Paste the link in "Or paste the code or link".
3. Tap "Join as {NOORG's name}".

Expected:
- The subtitle reads "Invite includes organization, role, and scope".
- The footer has "Join as {NOORG's name}" and "Not {NOORG's name}? Sign out first". "Not now" shows under the field. No terms line shows.
- While it works, the button reads "Joining…". Then UI Test Org opens on the welcome: "You're a Translator on the Alpha team at UI Test Org."
- No "Nothing to remember" banner shows.

Resets: NOORG is now a member. Remove them from UI Test Org (Members), or use a fresh fixture, before file 02.

### AUTH-034 "Not {me}? Sign out first" keeps the invite for the next person
Roles: TRANS, GUEST · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- TRANS is signed in, and nothing is waiting to send.
- A new one-person invite labelled "Test Person" is to hand.

Steps:
1. Open the invite link on the device. The app opens "Scan a code" with the invite.
2. Tap "Not {TRANS's name}? Sign out first".
3. Tap "Sign Out" on "Sign out?".
4. On Sign In, tap "Scan a code".

Expected:
- Step 2 opens "Sign out?" with "Sign Out" and "Cancel".
- After signing out, Sign In opens.
- Step 4, iOS and Android: the invite card "Invite for Test Person" is still there, with "Join as Test" and "I already have an account". It was not used for TRANS.
- Step 4, web: no invite card. A browser forgets everything at sign-out, the held invite too (decision 11), since its token on a shared computer would let the next person join as someone else. The person scans or opens the invite again.

Decided (2026-10-13): the web keeps decision 11; only phones keep a held invite across sign-out.

### AUTH-035 An invite link opens the app, signed out
Roles: GUEST · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Signed out. Two new one-person invites, A and B.
- On iOS and Android, the build has app links for its https host (`appLinks.json`).

Steps:
1. iOS and Android: open invite A's `langquestnext://invite?...` link.
2. Kill the app. Open invite B's `https://<app host>/invite#...` link.
3. Web: paste invite B's https link into the address bar and load it.
4. Tap the back arrow.

Expected:
- Each time, the app opens straight on "Scan a code" with that invite's card, as in AUTH-025.
- The camera does not start, because an invite is held.
- Web: once the page loads, the address bar no longer shows the token. Reloading the page does not bring it back, and the invite is still held.
- Step 4 opens Sign In. The invite is still held: "Scan a code" shows it again.

Fixed (2026-10-12): opened alone by a link, the scan screen's back arrow (and Android's back) leads to Sign In, or to the account's home when signed in; the invite stays held.

### AUTH-036 An invite link opens the app, signed in
Roles: NOORG · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- NOORG is signed in. A new one-person invite link is to hand.

Steps:
1. Open the link, as in AUTH-035.

Expected:
- The app goes to "Scan a code" with the card and "Join as {NOORG's name}".
- Nothing joins without a tap.

### AUTH-037 Joining with no connection waits, then joins
Roles: NOORG · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- NOORG is signed in, on "Join your team". A new one-person invite link is to hand.

Steps:
1. Go offline.
2. Tap "Scan their code" and paste the link.
3. Tap "Join as {NOORG's name}".
4. Tap the back arrow.
5. Kill and reopen the app, still offline.
6. Go online and wait up to 30 seconds. On a phone, also try bringing the app back from the background.

Expected:
- Step 2:
  - The card reads "Invitation to join an organization", with "Your role shows once you're connected."
  - No role, language or inviter is claimed.
- Step 3: the banner "Saved on this device" / "You'll join as soon as there's a connection. You can leave this screen." shows. "Join as …" is disabled.
- Steps 4 and 5: "Join your team" shows the banner "Your invite is saved" / "You'll join as soon as there's a connection."
- Step 6: within 30 seconds of the connection returning (at once on coming back to the foreground), the banner reads "Joining with your invite…". Then UI Test Org opens on the welcome.

Resets: as AUTH-033.

### AUTH-038 A new person offline is told joining needs a connection
Roles: GUEST · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Signed out and offline. A new one-person invite link is to hand.

Steps:
1. Tap "Scan a code" and paste the link.
2. Tap the main button, then on the name screen type "Test Person" and tap "Join".
3. Go online. Go back to "Scan a code".
4. Tap "Join as Test".

Expected:
- Step 1: the card reads "Invitation to join an organization" with "Your role shows once you're connected." Under it, "Joining needs a connection. Your invite is saved on this device." The main button reads "Join", because the name on the invite cannot be read offline.
- Step 2: "Joining needs a connection. Your invite is saved on this device." No account is made.
- Step 3: the card now shows "Invite for Test Person", and the button reads "Join as Test".
- Step 4 joins and opens the welcome.

Fixed (2026-10-12): offline, the scan screen says joining needs a connection as soon as the invite is read, and asks the server again every 10 seconds, so the card fills in once there is a connection. The name screen's message now says so too (offline it said "Joining did not work").

### AUTH-039 An expired invite
Roles: GUEST · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- A one-person invite from COORD, expired on the local database (`expires_at` set in the past).

Steps:
1. Tap "Scan a code" and paste its link.
2. Tap "Clear this invite".

Expected:
- An amber banner "This invite can't be used" with "This invite has expired. Ask {COORD's name} for a new one."
- No "Join" or "I already have an account" button shows, and no terms line.
- Step 2: the card and banner go. The scanner shows "Tap Scan to use the camera" (web) or offers "Scan QR code".
- Until then, the banner stays.

Fixed (2026-10-12): the expired invite was let go a moment after it was read (the app held it only until its own expiry date), so the banner and card vanished by themselves.

### AUTH-040 An invite already used by someone else
Roles: GUEST · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- A one-person invite from COORD that another person has already joined with.

Steps:
1. Tap "Scan a code" and paste its link.

Expected:
- "This invite can't be used" with "This invite has already been used. Ask {COORD's name} for a new one."
- "Clear this invite" is offered. No join button shows.

### AUTH-041 An invite that is not valid
Roles: GUEST · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- A made-up code: 64 random hex characters.

Steps:
1. Tap "Scan a code" and paste the made-up code.

Expected:
- The card reads "Invitation to join an organization", with no detail and no "From" line.
- "This invite can't be used" with "This invite isn't valid. Check you scanned the whole code, or ask for a new one."

### AUTH-042 An invite whose role was retired
Roles: GUEST · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- ADMIN made the role "Temp Role", made a one-person invite for it, then retired the role.

Steps:
1. Tap "Scan a code" and paste the invite's link.

Expected:
- "This invite can't be used" with "This invite can no longer be used. Ask {ADMIN's name} for a new one."

### AUTH-043 An invite that dies before it is used
Roles: NOORG, TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Signed out. A new one-person invite (to UI Test Org for NOORG, to UI Admin Org for TRANS, as in AUTH-030).

Steps:
1. Tap "Scan a code", paste the link, and tap "I already have an account".
2. On a second device, another account joins with the same invite.
3. Sign in as the role.

Expected:
- The account is not added by the invite.
- The invite is let go, and the app says why with the reason alone, without the inviter's name: "This invite has already been used. Ask for a new one."
  - NOORG: "Join your team" shows it in an amber banner, "Your invite couldn't be used".
  - TRANS: it shows where TRANS lands, and TRANS can carry on with their work.

Fixed (2026-10-13): an account with a home (TRANS) is believed to land on My Work, where nothing says the invite could not be used. Only "Join your team" and the scan screen show the message. Confirmed on the web (LADMIN); the fix is in `App.tsx`.

### AUTH-044 Scanning a code already used by this account
Roles: KEPT · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- KEPT is signed in on the device where they joined. The invite link they joined with is to hand.

Steps:
1. Open that invite link again.
2. Tap "Clear this invite".
3. Tap the back arrow.

Expected:
- "Scan a code" shows the card and a green banner "You're already in" / "This invite was used by this account."
- No join button is offered. "Clear this invite" is.
- Step 2 clears the card.
- Step 3 returns to KEPT's home, unchanged.

Fixed (2026-10-12): opened alone by a link, the back arrow (and Android's back) leads home. The web run joins as a new person with the link first, then opens it again.

### AUTH-045 Text that is not a code
Roles: GUEST · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- On "Scan a code".

Steps:
1. Paste "hello world" into "Or paste the code or link".
2. Paste "https://example.org/invite#token=xyz".

Expected:
- Each time, "This is not a LangQuest code." shows under the field, read out as an alert.
- Nothing is held, and no card shows.

Fixed (2026-10-12): pasted text (more than one character at once) that is not a code says so.

### AUTH-046 A QR code that is not LangQuest's
Roles: GUEST · Priority: P2 · Platforms: iOS, Android · Run: Device

Preconditions (in addition to the global ones):
- A printed or on-screen QR for a web page (not LangQuest).

Steps:
1. Tap "Scan a code" and point the camera at the other QR.
2. Point it at a LangQuest invite QR.

Expected:
- Step 1: "This QR code is not a LangQuest code." The camera keeps running.
- Step 2: the invite is read, and the message goes.

### AUTH-047 Camera access is off
Roles: GUEST · Priority: P2 · Platforms: iOS, Android · Run: Device

Preconditions (in addition to the global ones):
- Camera permission for LangQuest is denied in the device settings.

Steps:
1. Tap "Scan a code".
2. Tap "Scan QR code".
3. Paste an invite link into "Or paste the code or link".

Expected:
- Step 1: the camera does not start. The hint reads "Tap Scan to use the camera".
- Step 2: "Camera access is off. You can paste the code below."
- Step 3: the invite card shows. Pasting works without the camera.

### AUTH-048 A held invite is let go after a week
Roles: GUEST · Priority: P2 · Platforms: iOS, Android · Run: Manual

Preconditions (in addition to the global ones):
- Offline, signed out. A new invite link is to hand.

Steps:
1. Tap "Scan a code", paste the link, and tap "I already have an account".
2. Set the device clock 8 days ahead. Restart the app, still offline.
3. Restore the clock.

Expected:
- After step 2, Sign In no longer shows "Sign in to join", and "Scan a code" shows no card. The invite was dropped because the server never said when it expires and a week has passed.

## Sign-in codes

### AUTH-049 A looked-after person signs in on a new device with a helper's code
Roles: KEPT, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Device 1: a fresh install, signed out. KEPT has never used it.
- Device 2: COORD, signed in.

Steps:
1. Device 2: Manage → Members → KEPT → "Help them sign in". Leave "Their old device is lost or stolen" off. The code shows.
2. Device 1: tap "Scan a code" and scan the code (Auto: open its `/signin` link).
3. Device 1: tap "Sign in".
4. Device 1: Me → More settings.

Expected:
- Device 2 shows "Sign-in code for {KEPT's name}" and says it works once, for one hour.
- Device 1 after step 2:
  - The subtitle reads "A code from someone helping you sign in".
  - The banner "Someone is helping you sign in" / "Nothing to type: this signs you in on this device, with all your work."
  - "Sign in" and "Cancel". No invite card or camera.
- Step 3: the button reads "Signing in…". Then KEPT's My Work opens. No password or name was typed.
- The toast "Signed in with {COORD's name}'s help" shows.
- Step 4: "Signed in on this device with {COORD's name}'s help · {today's date}".
- KEPT's earlier device stays signed in.

Fixed (2026-10-13): the sign-in toast is shown just before the app restarts as the new account, and may never be seen. Verify on a device.

### AUTH-050 A helper's code that signs the old device out
Roles: KEPT, COORD · Priority: P1 · Platforms: iOS, Android · Run: Auto

Preconditions (in addition to the global ones):
- Device 0: KEPT signed in, nothing waiting to send. Device 1: fresh, signed out. Device 2: COORD.

Steps:
1. Device 2: "Help them sign in" for KEPT with "Their old device is lost or stolen" on.
2. Device 1: scan the code and tap "Sign in".
3. Device 0: bring the app to the foreground and wait for a sync.

Expected:
- Device 1 signs in as KEPT. The toast reads "Signed in. Your old device is signed out."
- Device 0 is signed out within a sync and lands on Sign In.

### AUTH-051 A signed-in person scans a sign-in code
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- TRANS is signed in. A helper's sign-in link for KEPT is to hand, unused.

Steps:
1. Open the sign-in link on TRANS's device.
2. Tap "Scan something else".

Expected:
- "Scan a code" opens with "This is a sign-in code" / "It is for someone signed out. Sign out first, then scan it again."
- No "Sign in" button is offered. TRANS stays signed in.
- Step 2 shows the scanner. The code was not used: KEPT can still use it on another device.

### AUTH-052 A sign-in code used twice, or after an hour
Roles: GUEST · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- A helper's code for KEPT that has already signed a device in. A second code made more than an hour ago (or expired on the local database).

Steps:
1. On a signed-out device, open the used code's link and tap "Sign in".
2. Open the expired code's link and tap "Sign in".

Expected:
- Each time: "This code has expired or was already used. Ask for a new one."
- The device stays signed out, on the sign-in code screen, with "Cancel".

### AUTH-053 A sign-in code that is not valid
Roles: GUEST · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- A made-up link: `langquestnext://signin?code=` followed by 64 random hex characters (on the web, the https form).

Steps:
1. Open the made-up link and tap "Sign in".

Expected:
- "This code has expired or was already used. Ask for a new one." The server cannot tell a made-up code from a spent one; "This code is not valid." is only for a code of the wrong shape, which the scanner never sends.

### AUTH-054 A sign-in code with no connection
Roles: GUEST · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- A fresh helper's code for KEPT. The device is signed out and offline.

Steps:
1. Open the code's link and tap "Sign in".
2. Go online and tap "Sign in" again.

Expected:
- Step 1: "Try again when connected." The code is not spent.
- Step 2: signed in as KEPT.

### AUTH-055 Cancel on a sign-in code
Roles: GUEST · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- A fresh helper's code link for KEPT.

Steps:
1. Open the link. "Someone is helping you sign in" shows.
2. Tap "Cancel".

Expected:
- The scanner shows, with the subtitle "No email or password needed".
- Nobody is signed in. The code still works afterwards.

## Welcome

### AUTH-056 The welcome says each role's job
Roles: ADMIN, COORD, LADMIN, TRANS, REV, TREV, VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- The account has never been welcomed: a fresh fixture records no `v1.VisionSeen` for it, and the device is a fresh install.

Resets: the account is welcomed afterwards. Run this before any other file signs these accounts in.

Steps:
1. Sign in with the account's email and password.

Expected:
- The welcome opens instead of the home screen, with no tab bar.
- The title is "Welcome, {first name}".
- The sentence and lines for each role:

| Role | Sentence | Lines |
| --- | --- | --- |
| ADMIN | "You're an Organization Admin on UI Test Org." | "Add the languages your teams record." · "Choose how passages get checked." · "Invite your team." |
| COORD | "You're a Coordinator on UI Test Org." | the ADMIN lines |
| LADMIN | "You're a Language Lead on the Alpha team at UI Test Org." | the ADMIN lines |
| TRANS | "You're a Translator on the Alpha team at UI Test Org." | "Record passages in your language." · "Your team listens and says what to change." · "My Work shows what's next for you." |
| REV | "You're a Reviewer on the Alpha team at UI Test Org." | "Listen to recordings when someone asks you." · "Say what works and what should change." · "My Work shows who is waiting on you." |
| TREV | "You're a Translator-Reviewer on the Alpha team at UI Test Org." | the TRANS lines |
| VIEW | "You're a Viewer on UI Test Org." | "See how far each language has come." · "Open any passage to hear what happened." |

- The role name is bold.
- "{inviter} invited you" shows over the title only for an account that joined by invite. Then the inviter's avatar replaces the book logo.
- No "Nothing to remember" banner shows, because these accounts have an email.
- "What is LangQuest?" is under the lines.
- Every account here except ADMIN joined by ADMIN's invite, so "{ADMIN's name} invited you" shows for them.
- Footer: one button, "Get started", for every role.

### AUTH-057 Leaving the welcome
Roles: TRANS, VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- On the welcome, as in AUTH-056 (a fresh account per step, or the welcome flag cleared).

Steps:
1. TRANS: tap "Get started".
2. VIEW: tap "Get started".

Expected:
- Step 1: My Work opens, with Work, Map and Me tabs.
- Step 2: the overview opens, with Map, Inbox and Me tabs.
- In each case, signing out and in again does not show the welcome.

Fixed (2026-10-12): "Show me how" and "Skip for now" did the same thing, because the Getting started card "Show me how" opened is gone (decision 71, amended 2026-10-08) and the practice tours were never built. The welcome now has one "Get started" for every role, as viewers had; help is the ? on each screen.

### AUTH-058 The welcome is shown once per account
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- TRANS was welcomed on Device 1 (AUTH-056) and Sync showed nothing waiting.

Steps:
1. Device 1: sign out and sign in again.
2. Device 2, a fresh install: sign in as TRANS.

Expected:
- Both open My Work directly. The welcome was recorded for the account, not just the device.

Fixed (2026-10-13): on a new device the welcome sometimes shows again. `App.tsx` routes as soon as it has read this device's flag, before the server has said the account was welcomed (`get_user_state`). Seen on the web in AUTH-008 and AUTH-051; it depends on timing.

### AUTH-059 "What is LangQuest?" from the welcome
Roles: TRANS (automation: TREV, not yet welcomed) · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- On the welcome.

Steps:
1. Tap "What is LangQuest?".
2. Tap "Next".
3. Tap the back arrow.
4. Tap "Next" twice.
5. Tap "Done".

Expected:
- Step 1: "What is LangQuest?" with "1 of 3", three segments, and "Scripture in every language" / "Teams record the Bible in their own language, check it together, and share it."
- Step 2: "2 of 3", "Every passage keeps a record".
- Step 3: back to "1 of 3", still on this screen.
- Step 4: "3 of 3", "Do it, or ask someone". The footer button now reads "Done".
- Step 5: the welcome shows again, unchanged. The account is not yet marked welcomed.

### AUTH-060 "How LangQuest works" from Me
Roles: TRANS · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Me → "How LangQuest works".
2. Tap "Next", "Next", "Done".

Expected:
- "What is LangQuest?" opens on "1 of 3".
- "Done" returns to Me.
- The back arrow on "1 of 3" also returns to Me.
