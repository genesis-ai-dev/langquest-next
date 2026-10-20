# 10 People and roles (`PEOPLE`)

Who is on the team and what they may do: members, invites (group code,
email, one person by name), joining on a second device, looked-after
people and sign-in codes, join requests, editing a member, the limits on
granting, roles, a check's people (review teams were dropped by decision
91), and what removal and scope mean on a member's own phone.

Read with: decisions 23 (privileges and scope), 59 and 67 (joining without
a password; whoever holds Invite invites and admits), 65 (admins see who
asks), 71 amended 2026-10-08 (four plain choices, twelve switches, group
code first), 75 (nobody grants more than they hold), and
`docs/invites-and-accounts.md`. The person joining is tested from their
side in [01-getting-in.md](01-getting-in.md) (AUTH) and
[02-no-organization.md](02-no-organization.md) (NOORG); this file checks
both devices.

**Notes for this file**
- Fixture names: ORG "UI Test Org", LANG-A "Alpha", LANG-B "Bravo". The
  roles in ORG: Organization Admin, Coordinator, Translator, Reviewer,
  Viewer (the seed roles), and the custom "Language Lead" and
  "Translator-Reviewer".
- **Granting (decision 75).** To give a role at a scope you need Invite at
  that scope and every privilege of the role. To change or remove someone's
  role you must have been able to grant the role they hold now; otherwise
  the member's page says you are outranked. The server applies the same
  rules (`_grant_refusal`, `issue_invite_v3`, `decide_join_request_v2`).
- What each inviter may give at Alpha, from the fixture:
  - ADMIN: every role, at Alpha, Bravo or "All of them" (the organization).
  - COORD: every role but Organization Admin (it lacks Manage roles).
  - LADMIN: Translator, Reviewer, Translator-Reviewer, Viewer and Language
    Lead, at Alpha only. Not Coordinator (it lacks Override checkpoints),
    not Organization Admin, and nothing at organization scope.
- The four plain choices map to roles (`plainRoleChoices`): "Translate" →
  Translator, "Check recordings" → Reviewer, "Back-translate" →
  Translator-Reviewer (no role is named like "back-translator", so the
  role with Translate and Review that runs nothing is used), "Help run the
  team" → Coordinator, or Language Lead when Coordinator may not be
  granted. The rest are under "Other roles · n".
- **Join requests are read and decided only with Invite at organization
  scope** (`join_requests_read`, `decide_join_request_v2`). LADMIN never
  sees them.
- A second device: another simulator, emulator or browser profile. "Paste
  the link" means Sign In → "Scan a code" → "Or paste the code or link". A
  Device run scans the code with a camera instead.
- NEW accounts are made by the test that needs them and deleted at the end
  of the run (README, Accounts).

**Resets.** Most tests add members or change roles. Each says what it
changes; run this file after the files that read the fixture's members,
or on a fresh fixture.

---

## Members

### PEOPLE-001 Members at organization level, and by language
Roles: ADMIN, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- No pending join requests.

Steps:
1. Org home → People → "Members".
2. Read the list.
3. Under "Expand by", tap "By language".

Expected:
- The header is "Members" with the action "Invite".
- The intro is "Members assigned at organization scope. Expand the groups
  below for the other levels."
- "Organization members · 3": ADMIN (as "You"), COORD and VIEW, each with an
  avatar, "{ORG name} · joined {ago}" and a role badge (Organization Admin,
  Coordinator, Viewer).
- Editable rows show a chevron. For COORD, ADMIN's row also shows a chevron
  (the outranked check is on the member's page, PEOPLE-028).
- "By language" shows "{n} members" and opens to "Alpha · 5" (LADMIN,
  TRANS, REV, TREV, KEPT) and any other language's groups.

### PEOPLE-002 Members of one language, with higher levels view only
Roles: ADMIN, LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Alpha's page → "People" (or More → "Members").
2. Read the list.
3. Tap VIEW's row under "Higher levels · view only".

Expected:
- The intro is "Members assigned at language scope for this view. Expand
  the groups below for the other levels."
- "Language members · 5": LADMIN (Language Lead), TRANS (Translator), REV
  (Reviewer), TREV (Translator-Reviewer), KEPT (Translator), each "Alpha ·
  joined {ago}".
- "Higher levels · view only" lists ADMIN, COORD and VIEW, greyed with a
  lock; tapping does nothing.
- For LADMIN the Language members rows are editable (chevron).

---

## Inviting

### PEOPLE-003 Invite by group code, and the person joins on a second device
Roles: ADMIN, NEW · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- A second device, fresh install, signed out.
- Resets: adds NEW as Translator at Alpha.

Steps:
1. ADMIN: Alpha's page → "People" → "Invite".
2. Read the screen.
3. On "Translators" tap "Invite". Under "Which checks will they do?" tick
   nothing and tap "Show the code to scan".
4. Tap "Share as a link" and keep the link.
5. Second device: Sign In → "Scan a code" → paste the link.
6. Type the name "UI Joiner {run}". Tap "Join".
7. Second device: read the Welcome. Tap "Get started".
8. ADMIN: tap "Done". Pull to refresh or wait 30 seconds; read Members.
9. ADMIN: open Alpha's page.

Expected:
- Step 2: header "Invite someone" with the sub "Alpha"; "Who are you
  inviting?" with a card per role, "Translators", "Checkers",
  "Back-translators", "Team leads", each with its line, "What they may do"
  and its own "Invite", no radio buttons (decision 144); "Other roles · 3";
  the dashed "Something else: make a new role"; "In which language?" with
  "Alpha" and "Bravo" (from a language's Members an invite is at a
  language; "All of them" is offered from Org home's "Invite people").
- The group code is the first way offered (decisions 71, 144). A role that
  does checks is asked "Which checks will they do?" first; ticking none
  skips it.
- Step 3: "{who} · Alpha" ("Translators · Alpha"), "Making the code…", then
  "Ask them to scan this", a QR, and "No password needed. Works for a whole
  group."; "Done", "Share as a link", "By email", "One person, by name" and
  "Someone else".
- Step 4: the share sheet, or the toast "Invite link copied. Paste it into
  a message."
- Steps 5–6: the card names UI Test Org and the role; a group code asks for
  a name first ("Join with your invite" / "No email or password needed.
  Your team sees you by this name.").
- Step 7: "Welcome, UI" (the first word of the name), "{ADMIN name} invited you", "You're a
  Translator on the Alpha team at UI Test Org." and "Nothing to remember".
  The tabs are Work, Map, Me; the map is Alpha's.
- Step 8: "UI Joiner {run}" is under Language members with "Alpha · joined
  just now" and "Translator".
- Step 9: "Ready · 4 translators".

Fixed (2026-10-13): "Other roles · 4", not 3. Since decision 91 gave
Translator Review, `plainRoleChoices` (simple/adminModel.ts) picks
Translator for "Back-translate" as well as "Translate" (the fewest-privilege
role with Translate and Review), so Translator-Reviewer falls to Other roles.

### PEOPLE-004 A group code works for up to 30 people, for 7 days
Roles: ADMIN, NEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- The link from PEOPLE-003, step 4. A third device, signed out.
- Resets: adds a second NEW member.

Steps:
1. Third device: paste the same link. Type another name. Join.
2. ADMIN: Members.
3. On the server, read the invite row (`invites`) for the code.

Expected:
- The second person joins with the same code, as Translator at Alpha.
- Both appear under Language members.
- The invite has `max_uses` 30, the label "Alpha team", and expires 7 days
  after it was made.

### PEOPLE-005 Invite by email
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Note whether the environment has email set up (`send-invite`).

Steps:
1. Alpha's members → "Invite". Leave "Translate". Tap "By email".
2. Type "not-an-address". Check the button.
3. Type `ui-{run}-mail@example.org`. Tap "Send the invite".
4. Turn the network off and send again.

Expected:
- The sheet is "Invite by email" with the sub "Translator · Alpha", the
  field "Email address" (placeholder "name@example.com").
- "Send the invite" is disabled until the text looks like an address.
- With email set up: toast "Invite sent to ui-{run}-mail@example.org as
  Translator", and the screen goes back.
- Without it: banner "The invite was not sent" with "Email is not set up
  yet. Share the code or the invite link instead."
- Offline: "The invite was not sent" with "Try again when connected."

### PEOPLE-006 Invite one person by name, and they join
Roles: ADMIN, NEW · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- A second device, fresh install, signed out.
- Resets: adds a looked-after Reviewer at Alpha.

Steps:
1. ADMIN: Alpha's members → "Invite". Tap "Check recordings". Tap "One
   person, by name".
2. Read step 2 of 3. Leave "One person". Type "Nyibol {run}". Tap
   "Continue".
3. Read step 3 of 3. Copy the token under "Or type this code".
4. Second device: Sign In → "Scan a code" → paste the code.
5. Tap "Join as Nyibol {run}".
6. ADMIN: tap "Done".
7. Second device: paste the same code again on a third device.

Expected:
- The screen is "Invite by QR" with the sub "Reviewer" and "Step 2 of 3 —
  Name" (the role was carried over, so step 1 is skipped).
- Step 2 offers "One person" ("The code works once") and "A group" ("Up to
  30 people share one code, for a workshop"), with "Their name is shown to
  them when they scan, so they know the code is theirs, and offered as
  their name."
- Step 3: a QR, "Nyibol {run}", "Reviewer · Alpha", "Hold this up for
  them to scan. Tap Done when it has been scanned.", the token, and "Shown
  once: leaving this screen loses the code. It can be used once, until
  {date}." and "Share invite".
- Step 5 joins with no name or password to type; the Welcome says "You're a
  Reviewer on the Alpha team at UI Test Org."
- "Done" goes to Members, where "Nyibol {run}" shows as Reviewer at Alpha.
- Step 7: "This invite has already been used." (with "Ask {name} for a new
  one." when the inviter is known).

### PEOPLE-007 Invite by QR from the start: role first, then a group
Roles: ADMIN · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Role editor for Translator (Roles → Translator) → "Invite someone as
   Translator".
2. Go back to step 1 of 3 with Back. Read it.
3. Pick "Viewer". Continue. Pick "A group". Type "Juba workshop". Continue.
4. Tap Back from step 3.

Expected:
- Step 1 says "Pick the role this person should have. You don't need their
  email." with the banner "Already on the team, with a new device?" / "Open
  them in Members and tap Help them sign in. A new invite would make a
  second account."
- Each role shows "{n} privileges"; "Create a new role" shows for ADMIN.
- With "A group" the field is "Group name" (placeholder "e.g. Juba
  workshop").
- Step 3 says "Shown once: leaving this screen loses the code. Up to 30
  people can use it, until {date}."
- Leaving step 3 loses the code: coming back starts again.

### PEOPLE-008 Invite by QR targets the language chosen, not only the open one
Roles: ADMIN · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Alpha is the open language.

Steps:
1. Org home → "Invite people".
2. Under "In which language?" tap "Bravo".
3. On "Translators" tap "Invite" (and "Show the code to scan" if it asks
   which checks). Tap "One person, by name", name someone, Continue.
4. Read the role line on step 3; check the invite's scope on the server.

Expected:
- The code is for Bravo, and step 3 says "Translator · Bravo".

Fixed (2026-10-13): `InviteQr` now uses the language chosen on Invite
someone (`inviteScope`, orgAdmin.ts) and names it on step 3 instead of
"Language".

### PEOPLE-009 Make a new role while inviting
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: adds a role.

Steps:
1. Alpha's members → "Invite". Tap "Something else: make a new role".
2. Name it "Storyteller {run}". Turn on "Record" and "Ask for checks". Tap
   Save.
3. Back on "Invite someone", read the roles. Tap the new role's "Invite".

Expected:
- The role editor opens on a new role ("What is it called?").
- Toast "Storyteller {run} created."
- "Storyteller {run}" comes back opened ("What they may do": Record, Ask for
  checks), with the other roles shown (the "Other roles · n" link is gone),
  and its Invite shows a code at once (it does no checks).
- Updated (2026-10-13): main's "Ready-made choices come with your own,
  starting from the one picked" (4b9c582, design principle 12): the new role
  used to be found under "Other roles · 4" and tapped.
- COORD and LADMIN do not see "Something else: make a new role".

Fixed (2026-10-13): a code for a role made a moment ago could fail with
"No code was made. Try again when connected." while online, because the
role had not reached the server yet. Invite someone and Invite by QR now send
the organization's own writes before asking for a code.

### PEOPLE-010 No code is made offline
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Turn the network off.
2. Alpha's members → "Invite" → "Translators" → "Invite" → "Show the code
   to scan".
3. Tap "One person, by name" → a name → "Continue".

Expected:
- Step 2: "No code was made. Try again when connected."
- Step 3: banner "No code was made" with "Try again when connected."
- Nothing crashes, and nothing waits to send.

### PEOPLE-011 A signed-in account joins by invite
Roles: ADMIN, NOORG · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- NOORG signed in on a second device, on "Join your team".
- Resets: NOORG becomes a Translator at Alpha (no longer NOORG).

Steps:
1. ADMIN: make a group code for Translate at Alpha and share the link.
2. NOORG: "Scan their code" → paste the link.
3. Tap "Join as you".

Expected:
- The card has "Join as {NOORG name}" and "Not {NOORG name}? Sign out
  first" ("Join as you" / "Not you?" while the name is unknown).
- NOORG lands on the Welcome and then My Work, with Alpha's map.
- ADMIN's Members shows NOORG at Alpha with the same account (no second
  account).

---

## Looked-after people

### PEOPLE-012 Help a looked-after person sign in on a new device
Roles: ADMIN, KEPT · Priority: P1 · Platforms: iOS, Android · Run: Device

Preconditions (in addition to the global ones):
- KEPT's device profile (G6). A second device for KEPT, fresh install.

Steps:
1. ADMIN: Alpha's members → KEPT.
2. Read the card at the top. Tap "Help them sign in".
3. KEPT's new device: Sign In → "Scan a code". Scan the QR.
4. Tap "Sign in".
5. KEPT: Me → More settings.

Expected:
- The card says "Kept has no email. On a new device, show them a sign-in
  code." with the toggle "Their old device is lost or stolen: sign it out".
- After step 2: a QR, "Sign-in code for Kept Person", "On their new device,
  Kept opens LangQuest, taps Scan a code and points it here. It works once,
  for one hour." and "Kept will see in Settings that you helped them sign
  in."
- Step 3 shows "Someone is helping you sign in" with "Nothing to type: this
  signs you in on this device, with all your work."
- KEPT is signed in with their work, and "Signed in with {ADMIN name}'s
  help" shows.
- More settings says "Signed in on this device with {ADMIN name}'s help ·
  {date}".
- The old device stays signed in.

### PEOPLE-013 Help a person whose device is lost: the old one is signed out
Roles: COORD, KEPT · Priority: P1 · Platforms: iOS, Android · Run: Device

Preconditions (in addition to the global ones):
- KEPT signed in on two devices (after PEOPLE-012).

Steps:
1. COORD: Alpha's members → KEPT. Turn on "Their old device is lost or
   stolen: sign it out". Tap "Help them sign in".
2. On a third device, scan it and tap "Sign in".
3. Open the app on KEPT's other devices.

Expected:
- The instruction adds "Using it signs their old device out."
- The third device shows "Signed in. Your old device is signed out."
- KEPT's other devices are signed out, with unsent work handed over as
  decision 60 describes.
- Scanning the same code again: "This code has expired or was already
  used. Ask for a new one."

### PEOPLE-014 Who may help someone sign in
Roles: ADMIN, LADMIN, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. ADMIN: open TRANS (an account with its own email). Look for "Help them
   sign in".
2. LADMIN: open KEPT.
3. Any of them: open Nyibol {run} (PEOPLE-006).

Expected:
- TRANS has no sign-in card: only looked-after accounts with no email get
  one (decision 59).
- LADMIN sees the card for KEPT: LADMIN holds Invite and every Translator
  privilege at Alpha, where KEPT joined (decision 75).
- Nyibol {run}'s card shows for each of them.
- When the server refuses: banner "No code was made" with "You may not help
  this person sign in."

---

## Join requests

### PEOPLE-015 Accept a join request from the Inbox
Roles: ADMIN, NEW · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- A NEW account, signed in on a second device, asked to join: "Join your
  team" → "Find your organization" → UI Test Org → message "Translator from
  Alpha village" → asked (NOORG-file steps).
- Resets: NEW becomes a Translator at Alpha.
- Automation: the request is put in NEW's device outbox and sent by the
  device, because Request Access lists UI Test Org only once the projection
  pass has listed Alpha (decision 66), which a fresh world has not had.

Steps:
1. ADMIN: wait up to 60 seconds or bring the app to the front. Read the
   bell, then open the Inbox.
2. Tap the row "Join request".
3. Tap "Assign role & accept".
4. Read the screen. Leave "Translate" and "Alpha". Tap "Let {first} in".
5. NEW's device: wait, or bring the app to the front.

Expected:
- The bell counts the request.
- The Inbox row is "Join request" with "{name} asked to join UI Test Org.
  Assign a role to give them access." and a date; the requester's name
  shows, not a placeholder (decision 65).
- The sheet is titled "Join request" with "Assign role & accept" and
  "Decline" (red).
- The request screen is "{name} wants to join", sub "Asked just now"
  (or "Asked {n} minutes ago"), the quoted message "“Translator from Alpha
  village”", "What will they do?", "In which language?" with Alpha, Bravo
  and "All of them", the main button "Let {first} in" and the quiet link
  "Say no".
- Toast "{name} is in, as Translator in Alpha." The screen goes back; the
  request is gone from the Inbox, My Work and Members.
- NEW lands on My Work with Alpha's map, as a Translator.

### PEOPLE-016 Join requests on My Work and on the language page
Roles: COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- One pending request from a NEW account (as PEOPLE-015).
- Resets: admits NEW as Reviewer at organization scope.

Steps:
1. Open My Work. Find the row.
2. Open Alpha's page. Read under the rows.
3. Tap "{name} wants to join".
4. Tap "Check recordings" and "All of them". Tap "Let {first} in".

Expected:
- My Work lists "{name} wants to join" with their message, or "Asked just
  now".
- Alpha's page shows "{name} wants to join" / "Tap to let them in" with an
  amber count of 1.
- Toast "{name} is in, as Reviewer." (organization scope names no
  language).
- Members (organization) shows them as Reviewer.

Note: the single-request row on the language page opens the request only
for someone who also holds Assign work (`language_home → edit_member` is
gated on `assigner`). Every fixture role with Invite holds Assign work, so
this is not reached here.

### PEOPLE-017 Several requests, and pending rows in Members
Roles: ADMIN · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Two pending requests from NEW accounts, one with no message.

Steps:
1. Open Alpha's page. Read the requests row.
2. Tap it.

Expected:
- The row reads "2 people want to join" / "Tap to let them in" with an
  amber 2.
- It opens Members, where both show first with an amber "Pending" badge;
  one sub-line is its message, the other "Asked to join".
- The section count includes them (the members at Alpha plus 2).
- Tapping a pending row opens its request screen.

### PEOPLE-018 Decline a request from the Inbox
Roles: ADMIN, NEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- One pending request from a NEW account on a second device.

Steps:
1. ADMIN: Inbox → "Join request" → "Decline".
2. NEW's device: bring the app to the front.
3. ADMIN: decline again with the network off (use a second request).

Expected:
- Toast "Declined. They were not given access." No confirmation and no
  Undo.
- NEW sees "UI Test Org didn't add you" with "An admin there turned down
  your request. You can ask again below, or ask someone there to show you
  their code."
- Offline: "Not declined. Check your connection and try again."

### PEOPLE-019 Say no from the request screen
Roles: COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- One pending request.

Steps:
1. My Work → "{name} wants to join".
2. Tap "Say no".

Expected:
- Toast "You said no to {name}." The screen goes back.
- No confirmation, no Undo (a wrong "no" is answered by the person asking
  again).
- The request is gone from My Work, Members and the Inbox.

### PEOPLE-020 A language-scope admin never sees join requests
Roles: LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- One pending request to ORG.

Steps:
1. Open My Work, the bell and the Inbox.
2. Open Alpha's page and its Members.

Expected:
- No request row anywhere, no count on the bell for it, no "Pending" row
  (decision 65; `join_requests_read` needs Invite at organization scope).
- Nothing says a request is waiting. ADMIN and COORD still see it.

### PEOPLE-021 The request screen offers only roles you may grant
Roles: COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- One pending request.

Steps:
1. Open the request.
2. Tap "Other roles · {n}". Read the list.
3. If "Organization Admin" is listed: choose it, "All of them", and tap
   "Let {first} in".

Expected:
- "Organization Admin" is not offered to COORD (decision 75: the role
  pickers offer only what you may grant).

Fixed (2026-10-13): the request screen reads its roles for the scope
chosen under "In which language?" (`usePlainRoles(ctx, scope)` in
`JoinRequest`), so Organization Admin is not offered to COORD.

### PEOPLE-022 Join requests offline
Roles: ADMIN · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- One pending request, seen once online.

Steps:
1. Turn the network off. Open Members and My Work.
2. Open the request from the Inbox and tap "Let {first} in".

Expected:
- Offline the Members and My Work lists show no requests rather than
  claiming nobody asked; the bell keeps its last count.
- Deciding offline shows the banner "Not saved" with a reason; nothing is
  half done.

---

## Editing a member

### PEOPLE-023 Change a member's role
Roles: ADMIN, COORD · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: changes REV's role and changes it back.

Steps:
1. Alpha's members → REV.
2. Read the page.
3. Choose "Translator-Reviewer". Tap "Save Assignment".
4. On REV's device, Sync now. Open P-DRAFT.
5. Alpha's members → REV again. Choose "Reviewer". Tap "Save Assignment".

Expected:
- The header is REV's name with "Reviewer · Alpha".
- The intro: "Pick a role, then choose the scope this assignment applies
  to. Scope can be this level or below."
- "What will they do?" lists the roles the editor may grant at Alpha, plus
  REV's current one; "Where?" with "Organization" (ADMIN, COORD at
  organization view only) and "Language", "Where this person can use the
  selected role's privileges.", and "Language" with Alpha chosen.
- "Save Assignment" is disabled until something changes. (Fixed
  2026-10-13: it was enabled at once.)
- Toast "{REV name} is now Translator-Reviewer", with no Undo. Step 5
  toasts "{REV name} is now Reviewer".
- REV's device gains the record and publish actions after sync; they go
  again after the change back.

Changed (2026-10-16, decision 134): no toast offers Undo; opening the member again and saving the old role changes it back.

### PEOPLE-024 Move a membership between organization and language scope
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: changes VIEW's scope and changes it back.

Steps:
1. Org home → Members → VIEW.
2. Tap "Language" under "Where?". Choose "Alpha". Tap "Save Assignment".
3. Read Members at organization level and at Alpha.
4. On VIEW's device, Sync now. Open Map → All languages → "Bravo".
5. Org home → Members → VIEW again (now under Alpha). Tap "Organization"
   under "Where?". Tap "Save Assignment".

Expected:
- Toast "{VIEW name} is now Viewer", with no Undo.
- VIEW leaves "Organization members" and appears under Alpha (one
  MemberAdded at Alpha and one MemberRemoved at the organization).
- After sync VIEW sees Alpha's progress, and Bravo's work is no longer
  readable (PEOPLE-047).
- Step 5 puts VIEW back at organization scope (the same toast, "{VIEW
  name} is now Viewer").

Changed (2026-10-16, decision 134): no toast offers Undo; opening the member again and saving the old scope changes it back.

### PEOPLE-025 Remove a member
Roles: ADMIN, LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- UI Joiner {run} is a member at Alpha (PEOPLE-003).
- Resets: removes UI Joiner {run}, for PEOPLE-046. Nothing puts them back:
  to run this again, they join again with a new invite (PEOPLE-003).

Steps:
1. Alpha's members → UI Joiner {run}.
2. Tap "Remove from language".
3. Read the sheet. Tap "Cancel".
4. Tap "Remove from language" again, then "Remove from language" in the
   sheet.

Expected:
- The link "Remove from language" is red and sits under the form, away
  from "Save Assignment". Its help says "Takes away their role here. It
  asks first; to come back, they join again."
- Step 2 removes nothing yet: it asks first, in a sheet titled "Remove UI
  Joiner {run}?" with their role line under it ("{role} · Alpha"), a red
  "Remove from language" and "Cancel".
- "Cancel" closes the sheet; UI Joiner {run} is still a member.
- Step 4: toast "UI Joiner {run} removed at language level", with no
  Undo; the page goes back to Members and the row has left it. Nothing in
  the app puts them back: they come back only by joining again.
- An organization-scope member's link and the sheet's button read "Remove
  from organization", and its toast "… removed at organization level".

Changed (2026-10-16, decision 134): no toast offers Undo; removing a member asks first ("Remove {name}?"), and they come back only by joining again.

### PEOPLE-026 The only one who can manage roles keeps that role
Roles: ADMIN · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- ADMIN is the only member of ORG who can manage roles.

Steps:
1. Org home → Members → ADMIN's own row ("You").
2. Pick "Coordinator", then "Organization Admin". Do not save.

Expected:
- A banner reads "You are the only one who can manage roles" and "Give
  someone else a role with Manage roles first. Then this role can change,
  or be removed." (for someone else's row, "{name} is the only one who can
  manage roles").
- No "Remove from organization"; "Save Assignment" stays disabled for a
  role without Manage roles (and for no change).
- The server refuses the change anyway: removing, demoting, taking Manage
  roles off the only role with it, or retiring that role
  (`server/grantsSmoke.sql` 11).

Decided (2026-10-13, decisions.md 98): an organization always keeps someone
who can manage roles. Before, nothing stopped it, and the toast's Undo was
refused once you no longer held the role.

### PEOPLE-027 A member who holds more than you is view only
Roles: COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Org home → Members → ADMIN.
2. Read the page.

Expected:
- A banner "View only" with "{ADMIN name} holds more here than you do, so
  only someone who holds as much can change this." (decision 75).
- No role choices, no "Save Assignment", no "Remove from organization".

### PEOPLE-028 Opening a member page you may not edit
Roles: VIEW, TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Look for Members anywhere.
2. On the web, type the path of a member's page.

Expected:
- No route to Members or a member's page (no Manage tab).
- A page reached by any route shows "You don't have permission to open
  that." or "That can't be opened from here.", or the banner "View only"
  with "Only people who can invite members change roles.", and does not
  crash (G10.6).

---

## The limits on granting

### PEOPLE-029 A coordinator cannot grant Organization Admin
Roles: COORD · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Org home → "Invite people". Read "Who are you inviting?" and "Other
   roles".
2. On "Team leads" tap "Invite". Tap "One person, by name", then Back. Read
   the role list.
3. Org home → Members → VIEW. Read "What will they do?".

Expected:
- "Other roles · {n}" holds Viewer, Language Lead and any role made
  earlier in this run; Organization Admin is never offered.
- "Team leads" gives Coordinator (COORD holds every privilege of it).
- Invite by QR lists every role but Organization Admin.
- VIEW's page offers every role but Organization Admin.
- The server refuses an Organization Admin invite from COORD with "you may
  only invite people to a role whose privileges you hold" (checked by
  `server/grantsSmoke.sql`; there is no UI route to try it).

### PEOPLE-030 A language lead grants only what they hold, only at their language
Roles: LADMIN · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: changes TRANS's role and changes it back.

Steps:
1. Alpha's page → "People" → "Invite". Read the roles.
2. On "Team leads" tap "Invite" (and "Show the code to scan" if asked which
   checks).
3. Tap "One person, by name", then Back. Read the role list.
4. Back in Members, open TRANS. Read "What will they do?" and "Where?".
5. Choose "Reviewer". Tap "Save Assignment".
6. Open TRANS again. Choose "Translator". Tap "Save Assignment".

Expected:
- The header sub is "Alpha"; there is no "In which language?" (one scope)
  and no "All of them".
- The role cards are "Translators" (Translator), "Checkers" (Reviewer),
  "Back-translators" (Translator-Reviewer), "Team leads" (Language Lead),
  and "Other roles · {n}" (Viewer, and roles made earlier in this run).
  Coordinator and Organization Admin are never offered.
- There is no "Something else: make a new role".
- The code for Language Lead is made; the shown screen's question reads
  "Team leads" (no " · Alpha", as there is one scope).
- Invite by QR lists Language Lead, Reviewer, Translator,
  Translator-Reviewer and Viewer, each "{n} privileges".
- TRANS's page offers only "Language" under "Where?", and the same five
  roles.
- Toast "{TRANS name} is now Reviewer", with no Undo. Step 6 puts it back
  ("{TRANS name} is now Translator").

Changed (2026-10-16, decision 134): no toast offers Undo; opening the member again and saving the old role changes it back.

### PEOPLE-031 A language lead cannot act at organization scope
Roles: LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Alpha's page → "UI Test Org" above its title, where Back would be
   (decision 138). Tap "Invite people".
2. Back on Org home → People → "Members".
3. Tap COORD's row.

Expected:
- "Invite someone" offers Alpha only (no "All of them", no Bravo); a code
  made here is for Alpha.
- Organization members are greyed with a lock and do not open.
- If an organization member's page is reached by any route, it shows the
  banner "View only", with no way to save or remove.

---

## Roles

### PEOPLE-032 Roles, for an organization admin
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Org home → "Setup" → "Roles".
2. Read the list.

Expected:
- The header is "Roles" with the sub "Organization" and the action "Role".
- The intro: "Roles are privilege sets without a fixed scope. Scope is
  chosen when assigning a role to a member. Roles created here can be
  assigned at any level."
- "Defined at Organization": the seed roles first (Organization Admin,
  Coordinator, Translator, Reviewer, Viewer, with the people icon), then
  the custom ones by name (Language Lead, Translator-Reviewer, with a
  star).
- Each sub reads "{n} members · {n} privileges", for example Organization
  Admin "1 member · 15 privileges", Coordinator "1 member · 14
  privileges", Translator "2 members · 5 privileges" (Review since decision
  91), Language Lead "1 member · 13 privileges".
- Retired roles are not listed.

### PEOPLE-033 A role is twelve switches in three groups
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Roles → "Language Lead".
2. Read the switches.
3. Roles → "Translator". Read the switches.

Expected:
- The header is "Language Lead" with "1 person".
- "Do the work": "Record", "Add notes and key words", "Ask for checks".
  "Check the work": "Check recordings", "See everyone’s work". "Run the
  team": "Invite people", "Set up languages", "Choose Bibles and guides",
  "Choose who checks", "Assign work", "Let work past a locked check", "Make
  and change roles".
- Language Lead: every switch on except "Let work past a locked check" and
  "Make and change roles".
- Translator: "Record", "Add notes and key words", "Ask for checks",
  "Check recordings" (decision 91) and "See everyone’s work" on, the rest
  off.
- The footnote: "Where a role applies is chosen for each person: the whole
  organization or one language, when they are invited or let in."

### PEOPLE-034 Make a new role
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: adds a role.

Steps:
1. Roles → "Role".
2. Check Save. Type "Elder {run}" in "What is it called?".
3. Turn on "Check recordings" and "Choose who checks". Tap Save.
4. Open Alpha's members → "Invite" → "Other roles".

Expected:
- The new role reads "New role" / "A new role", with the placeholder "e.g.
  Back-translator".
- Save is disabled until a name is typed.
- Toast "Elder {run} created." with no Undo.
- It is listed with a star and "0 members · 3 privileges" (Choose who
  checks covers flows and review groups).
- It is offered under "Other roles" to ADMIN, COORD and LADMIN (each
  holds Review, Manage flows and Manage teams where they invite).

### PEOPLE-035 Edit a role, partly-on switches, and change it back
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- "Elder {run}" (PEOPLE-034).
- Resets: edits and changes back.

Steps:
1. Open "Elder {run}". Turn "Choose who checks" off and on.
2. Change "Its name" to "Elders {run}". Tap Save.
3. Open "Elders {run}" again. Change "Its name" back to "Elder {run}". Tap
   Save.

Expected:
- Flipping a switch that covers several privileges sets every one of them
  on, or every one off.
- Toast "Elders {run} saved.", with no Undo, and Roles lists the new name.
- Step 3 toasts "Elder {run} saved." and the old name returns.
- A role holding only some of a switch's privileges shows "Only some:
  {labels}" under it (no fixture role does; `npm test` covers
  `flipSwitch`).

Changed (2026-10-16, decision 134): no toast offers Undo; opening the role again and changing it back is the way back.

### PEOPLE-036 Invite someone as a role, and the people who hold it
Roles: ADMIN, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Roles → "Translator". Scroll to "People with this role".
2. Tap TRANS's row. Go back.
3. Tap "Invite someone as Translator".

Expected:
- "People with this role" lists TRANS and KEPT with "Alpha" (and "You"
  for your own row); "Nobody has this role yet." when empty.
- A row opens that member's page.
- "Invite someone as Translator" opens Invite by QR at "Step 2 of 3 —
  Name" with Translator chosen.

### PEOPLE-037 A coordinator cannot make or change roles
Roles: COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Org home → "Setup" → "Roles".
2. Open "Translator". Try a switch.
3. Open "Invite people". Look for a way to make a role.

Expected:
- No "Role" action on Roles.
- The role opens with "View only" / "You do not have permission to edit
  this role.", switches that do not move, and no Save.
- "Invite someone as Translator" and the people list still show (COORD
  assigns work).
- No "Something else: make a new role" anywhere (Manage roles only).

### PEOPLE-038 Roles at a language are view only
Roles: LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Alpha's page → "Roles" (on the page; there is no More, decision 138).
2. Open "Language Lead".

Expected:
- The sub is "Language"; the intro ends "Roles are defined for the whole
  organization, so here they are view only. Edit them from Organization
  Home."
- Each row has a lock, "View only · edit from the level where it was
  defined" and a "View only" badge.
- The role opens with "View only" / "Defined at the organization level.
  Edit it from Organization Home." and no Save.

### PEOPLE-039 Retiring a role
Roles: ADMIN · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Preconditions (in addition to the global ones):
- "Elders {run}" with no members (PEOPLE-035).

Steps:
1. Open Roles → "Elders {run}". Look for a way to retire or delete it.

Expected:
- A role nobody needs can be retired, and it leaves the lists; an invite to
  it then says "This invite can no longer be used".

Known issue (2026-10-12): retiring a role is not built. No screen appends
`v1.RoleRetired` and no string mentions it. The role stays in every list.
Also, seed roles (Organization Admin included) can be edited, and the
switches do not hide privileges the editor lacks (the server's
`_grant_refusal` refuses such a role; ADMIN holds every privilege, so it is
not seen here).

---

## A check's people

Decision 91 dropped the Review Teams screens: people belong to a check, on
the Checks screens (`screens/checks.tsx`). The checks themselves (adding,
ordering, removing, Must pass) are SETUP's; these tests cover only who is on
a check.

### PEOPLE-040 A check's people, for a language
Roles: ADMIN, LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Alpha's page → "Review flow" → "Edit" (decision 138).
2. Read the list. Tap "Peer check".

Expected:
- The list names each check's people: Peer check and Back translation
  "{REV name}, {TREV name}" (either order), a check with nobody "Anyone".
- Peer check is "Check 1 · Alpha"; its People page (a page of its own,
  decision 130) lists TREV (Translator-Reviewer) and REV (Reviewer), each
  with "Take {name} off this check", and "Add people".

### PEOPLE-041 Put someone on a check
Roles: ADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: puts TRANS on the Consultant check.

Steps:
1. Checks → "Consultant check" → "People" → "Add people".
2. Tick TRANS. Tap "Done".
3. Go back to Checks.

Expected:
- Toast "Consultant check: 1 person".
- TRANS is under People, as Translator; the Checks list names TRANS for the
  Consultant check.

### PEOPLE-042 Take someone off a check, and put them back
Roles: ADMIN, LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Resets: takes TREV off the Peer check and puts them back.

Steps:
1. Checks → "Peer check" → "People".
2. Tap "Take {TREV name} off this check".
3. "Add people" → tick TREV → "Done".

Expected:
- Toast "Peer check: 1 person", with no Undo (no timed undo toasts, Caleb
  2026-10-16); TREV leaves People.
- After step 3, toast "Peer check: 2 people": TREV and REV are both on the
  check again.
- LADMIN can do the same (Manage teams at Alpha).

### PEOPLE-043 Deleting a review team (retired)
Roles: ADMIN · Priority: P2 · Platforms: iOS, Android, Web · Run: Manual

Retired (2026-10-13): review teams are gone (decision 91). A check's people
are taken off one by one (PEOPLE-042), and a check is removed on the Checks
screens (SETUP).

### PEOPLE-044 Only people with Review at the language can be put on a check
Roles: ADMIN · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- None.

Steps:
1. Checks → "Final approval" → "People" → "Add people".

Expected:
- Offered: everyone with Review at Alpha: REV, TREV, TRANS and KEPT
  (Translator has Review since decision 91), LADMIN, and the
  organization-scope ADMIN ("You") and COORD. Never VIEW.
- A language with nobody to offer shows "Nobody to add yet" / "Invite
  people to this language first." (not reachable with the fixture: Bravo
  has no checks until it is set up).

---

## What scope and removal mean on a member's own phone

### PEOPLE-045 A member's new role reaches their phone
Roles: ADMIN, TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- TRANS signed in on a second device.
- Resets: changes TRANS's role and changes it back.

Steps:
1. ADMIN: change TRANS to Viewer at Alpha (Alpha's members → TRANS →
   "Viewer" → "Save Assignment").
2. TRANS: Sync now, then open My Work and a passage.
3. ADMIN: open TRANS again, choose "Translator", tap "Save Assignment".
4. TRANS: Sync now.

Expected:
- Step 1's toast "{TRANS name} is now Viewer" has no Undo; step 3 is the
  way back ("{TRANS name} is now Translator").
- After step 2 TRANS's home and tabs follow the README matrix for VIEW at
  Alpha: no Record or Publish, no Work items asking them to record.
- Work TRANS already recorded stays on the record.
- After step 4 TRANS can record again.

Changed (2026-10-16, decision 134): no toast offers Undo; opening the member again and saving the old role changes it back.

### PEOPLE-046 A removed member's next sync is refused, and they are told
Roles: ADMIN, NEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- UI Joiner {run} (NEW) was removed from Alpha in PEOPLE-025 and holds no
  other role. Their device has one unsent recording made offline before the
  removal.

Steps:
1. NEW's device: turn the network on. Tap Sync now.
2. Read My Work, Me and Me → More settings.
3. Read the Sync screen.

Expected:
- The refusal is shown, never silent (PLAN.md invariant 1): My Work's chip
  reads "Not syncing"; Me reads "This account cannot sync · password,
  notifications, account"; More settings reads "This account cannot sync
  this organization"; Sync says "The server refused this account for this
  organization."
- The unsent recording stays on the device, counted, not dropped: the
  server refuses its events ("not a member") and the device keeps them as
  refused (SYNC covers what happens to refused work).
- Signing out shows "This account cannot sync this organization: the
  server refused it. Signing out is safe; anything queued stays on this
  device."
- See SYNC (refused work) for what happens to queued events.

### PEOPLE-047 A member at Alpha cannot see Bravo's work
Roles: TRANS, LADMIN · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- Bravo has passages with recordings (after SETUP-022 and some work by
  ADMIN in Bravo). Automated with the fixture's Bravo (no work yet): the
  server's refusal to sync Bravo's stream to TRANS and LADMIN is checked
  directly.

Steps:
1. Open the Map tab. Look for Bravo (LADMIN: All languages).
2. If Bravo is listed, open it.
3. Open Sync.

Expected:
- Bravo's name may be listed (a language's identity is in the
  organization's stream, decision 63), but none of its passages,
  recordings, reviews, progress or members are shown.
- Opening it shows no work and does not crash; nothing of Bravo's stream
  is downloaded (`can_read_stream` refuses it).
- TRANS's Map opens Alpha's map directly.
- Record what opening Bravo shows; if it reads as a sync refusal of the
  whole account, raise it against SYNC.

### PEOPLE-048 Moderation by scope: what a language lead may remove
Roles: LADMIN, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- REV reported a note TREV left on P-NEEDS, and reported TREV as a
  person (MOD-file steps).
- Resets: removes TREV's note from the record.

Steps:
1. LADMIN: open the Inbox. Open the content report.
2. Tap "Remove from the record" (and "Remove for everyone" if asked).
3. LADMIN: look for the report about TREV as a person.
4. COORD: open the Inbox.

Expected:
- LADMIN sees the content report and may remove it: Manage structure at
  Alpha (`_may_moderate` with the language). Toast "Removed from the record.
  Devices stop showing it when they next sync."
- LADMIN does not see the person report: acting on a person needs Invite at
  organization scope.
- COORD sees the person report with "Open Members".
