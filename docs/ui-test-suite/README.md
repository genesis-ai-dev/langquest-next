# The Expo app's UI test suite

The end-to-end UI tests for the LangQuest app (`apps/mobile`): iOS, Android
and its web export. Each test drives the real app, signed in as a real
account, against a real server. Every role's workflows are covered.

This suite sits on top of the existing automated tests and does not repeat
them:
- `npm test` covers the reducer, validation and the flow parity tests
  (`specParity.test.ts` holds every edge of `src/flow.ts`).
- `npm run test:web` runs the web smoke test.
- `smart-tests/` holds this suite (`ui/`), the web smoke (`web-smoke/`) and their fixtures.

What this suite adds is the check that a person can do each job on a device.
It checks what they see, what they tap, what the app says back, and that the
work reaches the server.

Written 2026-10-12 against `main` at `df1ad11` (after decision 86), and brought up to date with decisions 87 to 92 as the tests were automated (decision 95). The
screens follow the simple redesign (decision 71 and its amendments) and
`docs/ux/screen-path.md`.

## Files

| # | File | Area | IDs | Tests |
| --- | --- | --- | --- | --- |
| 01 | [01-getting-in.md](01-getting-in.md) | Sign in, create an account, terms, browsing public work, invites, sign-in codes, welcome | `AUTH` | 60 |
| 02 | [02-no-organization.md](02-no-organization.md) | "Join your team", starting an organization, asking to join | `NOORG` | 26 |
| 03 | [03-home-and-navigation.md](03-home-and-navigation.md) | Tabs per role, My Work, the bell, the Inbox, the viewer's overview, flow gates | `NAV` | 37 |
| 04 | [04-map.md](04-map.md) | All languages, a language's map, books, chapters, search, filter | `MAP` | 21 |
| 05 | [05-passage-record.md](05-passage-record.md) | The passage record, Something else?, Ask someone, Already happened, versions and history, set aside, checkpoints, Undo | `PASS` | 65 |
| 06 | [06-recording.md](06-recording.md) | The recording workspace, voice detection, parts, Publish, microphone setup, interruptions | `REC` | 52 |
| 07 | [07-reviewing.md](07-reviewing.md) | Review it, questions, verdicts, feedback, back translation, answering feedback | `REV` | 48 |
| 08 | [08-study-and-reference.md](08-study-and-reference.md) | The study, key words, Bibles beside a passage, reference for one passage | `STUDY` | 36 |
| 09 | [09-language-setup.md](09-language-setup.md) | New language, Get ready, templates, dividing books, review flows, reference material, the guide editor, licence | `SETUP` | 66 |
| 10 | [10-people-and-roles.md](10-people-and-roles.md) | Members, invites, join requests, editing members, roles, review teams, the limits on granting | `PEOPLE` | 48 |
| 11 | [11-account-and-settings.md](11-account-and-settings.md) | Me, More settings, profile, notifications, switching organization, app language, help mode, signing out, deleting an account | `ACCT` | 50 |
| 12 | [12-sync-and-offline.md](12-sync-and-offline.md) | The Sync screen, offline work, Ready for offline, handing over, two devices, refused work, the update banner | `SYNC` | 32 |
| 13 | [13-moderation.md](13-moderation.md) | Reporting, blocking, hidden content, removal, reports in the Inbox | `MOD` | 24 |
| 14 | [14-reports.md](14-reports.md) | The Reports section on wide windows | `RPT` | 22 |
| 15 | [15-web-and-wide.md](15-web-and-wide.md) | Wide layouts, panes, one tab at a time, browser history, forgetting the browser | `WEB` | 28 |
| 16 | [16-role-journeys.md](16-role-journeys.md) | Whole jobs per role, and the passage lifecycle across every role | `JRN` | 14 |
| 17 | [17-accessibility-and-field-use.md](17-accessibility-and-field-use.md) | Screen readers, target sizes, text size, colour, RTL, outdoor and low-end use | `A11Y` | 24 |

**658 tests in all.**

## How a test is written

Every test has the same shape:

```
### AREA-NNN Title
Roles: TRANS · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Preconditions (in addition to the global ones):
- …

Steps:
1. …

Expected:
- …
```

- **ID.** The area prefix and three digits. IDs are never renumbered; a
  test that is dropped keeps its number with "(retired)" in the title.
- **Roles.** The accounts that run it, from [the accounts](#accounts) below.
  A test that names several roles is run once per role, unless its steps
  say which role does which step.
- **Priority.**
  - P0: a core job that blocks a release when it fails.
  - P1: an important path, error handling, or a permission boundary.
  - P2: polish, rarer paths and copy.
- **Platforms.**
  - iOS: the iPhone simulator.
  - Android: the emulator.
  - Web: the web export in Chrome at phone width.
  - Wide: a tablet, or a browser at least 1100 px wide.
  - A test with no platform note runs on iOS, Android and Web.
- **Run.**
  - Auto: can be scripted, with Maestro on devices and Playwright on the
    web.
  - Device: needs real hardware or a person, for example to judge audio,
    use a camera on a printed code, receive a push, or work outdoors.
  - Manual: a person judges the result, for example wording, layout or
    comprehension.
- **Steps** use the words on the screen. Quoted text is the English UI text
  from `apps/mobile/src/i18n/en.json`. A `{placeholder}` is filled from the
  fixture.
- **Expected** lists what must be true. If any item fails, the test fails.

## Global preconditions

These hold for every test unless the test says otherwise.

**G1. Build**
- The build under test is a dev client or a preview build of the commit
  being tested.
- iOS: an iPhone 17 simulator on iOS 27.
- Android: the `LangQuest_NetTest` emulator on API 36, Google APIs image,
  started with `-dns-server 8.8.8.8,1.1.1.1`.
- Web: the web export served by the `apps/web` Worker, in current Chrome.
- Wide tests: an iPad simulator, or a browser window at least 1100 px wide.
- The build's `/version.json` or update id is noted in the run sheet.

**G2. Server**
- The local stack is running (`npm run dev:local`): Supabase, the Worker on
  :8787, and the projection worker running every minute.
- The library is seeded (`npm run library:seed`).
- A release candidate is run a second time against the preview environment.
- Never run against production or "LangQuest Sample", because Play's
  reviewers use it (`run-app` skill).

**G3. Fixture**
- [The fixture world](#the-fixture-world) below is loaded fresh for each
  run.
- Tests that change shared state say so under "Resets". They are run after
  the tests that read that state, or on a fresh fixture.

**G4. App data**
- At the start of each file, the app's local data is cleared as the
  `run-app` skill describes:
  - iOS: delete `langquest-next.db*`.
  - Android: `pm clear`.
  - Web: clear site data.
- Within a file, tests continue from the state the previous test left,
  unless a test says "fresh install".

**G5. Device settings**
- Language and region: English (US). The app's Language is "Same as this
  phone".
- iOS: Password AutoFill is off.
- Microphone: allowed. Camera: allowed. Notifications: not yet asked.
- Screen reader off, default text size, light appearance.
- Network online. At least 1 GB free storage.
- Device clock within one minute of the server.

**G6. Signed in**
- The test's role is signed in through the Sign In screen with the
  account's email and password.
- On a local server, the developer menu's "Switch persona" may be used
  instead, for the persona accounts.
- The looked-after account is set up by the fixture on its own device
  profile (it has no password to sign in with).

**G7. Starting point**
- The test starts on the role's home screen, with the tab bar showing.
- Nothing is waiting to send: My Work shows no sync chip, and Me shows no
  count on "More settings".
- No toast is showing.

**G8. Audio**
- Recording tests play `smart-tests/fixtures/voice.wav` into the
  microphone:
  - Web: Chrome's `--use-file-for-fake-audio-capture`.
  - Simulators: the host's input device, set to a loopback that plays the
    file.
  - Device runs: a person speaks.
- "Speak for N seconds" means play or say N seconds of speech, then
  silence.

**G9. Evidence**
- Take a screenshot at each Expected block, and keep the device log.
- On failure, add the code shown in any "Something went wrong (code …)"
  message or crash screen.
- These codes can be traced with `npm run diag` (the `field-diagnosis`
  skill).

**G10. Postconditions checked after every test**
These are the invariants a screen can break:
1. No crash screen ("This screen could not open") and no red developer
   error banner.
2. Sync shows "refused by the server" at 0, unless the test expects a
   refusal (PLAN.md invariant 1: nothing is dropped silently).
3. Within 30 seconds online, "waiting to upload" returns to 0.
4. Every write the test made can be seen on a second device signed in as
   another member, after Sync now.
5. Every toast offering Undo really undoes when tapped. This is checked
   where a test says "Undo".
6. Controls the role may not use are not offered. If one is reached by any
   route, the app shows "You don't have permission to open that." and does
   not crash.

## The fixture world

The fixture should be built by a script, run like `npm run sample:org`. It
writes through the ordinary sync path, so every event passes the server's
validation and permission rules. It is built from the library, as
`scripts/sample-org.ts` is.

Until that script exists, build the fixture by hand:
1. Run `npm run sample:org` and use the developer menu's "Seed demo team".
2. Bring each passage below to its state by following the steps of the
   tests that create it (PASS, REC, REV).

### Organizations

| Key | Name | Licence | Notes |
| --- | --- | --- | --- |
| ORG | UI Test Org | All rights reserved | Listed publicly with one language (for Explore and Request Access) |
| ORG2 | UI Second Org | CC BY 4.0 | For switching organization. ADMIN is a Translator here. |

### Languages in ORG

| Key | Name | State |
| --- | --- | --- |
| LANG-A | Alpha (linked to a language-list entry) | **Ready.** Template "FIA passages (English)", with Luke divided into passages. Checks copied from LangQuest's "Standard Bible Flow" (decision 91), so they are the language's own: step 1 is Peer Review and Back Translation (same time), step 2 Community Check, step 3 Consultant Check (must pass), step 4 Final Approval. The Peer Review and Back Translation checks have REV and TREV as their people. Offered material: an English Bible and FIA's English guides. Listed publicly. |
| LANG-B | Bravo | **Not ready.** Added to the organization, with nothing chosen yet. |

### Passages in LANG-A

The FIA passages (`library/fia/pericopes.tsv`). Every other passage has not
been started.

| Key | Passage | State |
| --- | --- | --- |
| P-NEW | Luke 13:1-9 | Not started. COORD asked TRANS to record it, due in 14 days. |
| P-Q1..P-Q4 | Luke 13:10-17, 13:18-21, 13:22-30, 13:31-35 | Not started. Each was asked of TRANS to record, so My Work has a "Then" list longer than three. |
| P-DRAFT | Luke 14:1-14 | TRANS recorded two parts and has not published. |
| P-SUBMITTED | Luke 15:11-32 | TRANS published Version 1. Peer Review was asked of REV. This passage has FIA's worked study. |
| P-NEEDS | Luke 14:15-24 | Version 1 was reviewed by REV as "needs changes", with text ("Verse 18 is too fast") and a 5-second voice note. TRANS has not answered. |
| P-BT | Luke 14:25-35 | Version 1. Peer Review looks good. Back Translation was asked of REV. |
| P-CHECK | Luke 15:1-10 | Steps 1 and 2 are complete. It is at Consultant Check (a checkpoint) with no consultant review. |
| P-ASIDE | Luke 16:1-15 | Version 1. Community Check was set aside with the reason "No community meeting this month". |
| P-DONE | Luke 16:19-31 | All four steps complete. |
| P-S | Luke 12:35-48 | Not started, with an FIA guide and no study steps done. Kept for the study tests (STUDY-004). |
| P-T | Luke 12:49-59 | Not started. Kept for TREV's own recording and review (REC-052, REV-030). |

More about these passages:
- Each published Version 1 above has three parts.
- No study step is marked done on any passage, including P-SUBMITTED.
- LANG-A starts with no key terms of its own. STUDY-016 adds "heaven" for the key-term tests after it.
- COORD has added one required question to the Consultant Check, a yes/no question: "Does it carry the meaning of the original?" The REV tests for required questions need it.
- No chapter starts fully done. MAP-020 takes one through the flow first.
- A passage with an FIA guide leads with "Study", not "Record", until its study is done. Tests that record such a passage tap the Record step row.

### Accounts

Every account except GUEST, NEW and KEPT has an email and password. The
addresses are in the tester's own notes, never in this repository; the
local persona accounts (`src/dev.ts`) may stand in where noted.

| Key | Account | Membership | Persona |
| --- | --- | --- | --- |
| ADMIN | Org admin | Organization Admin, organization scope. Translator in ORG2. | owner |
| COORD | Coordinator | Coordinator, organization scope (every privilege but Manage roles) | coordinator |
| LADMIN | Language lead | Custom role "Language Lead" at LANG-A scope: every privilege except Manage roles and Override checkpoints (so it holds Translate, Review, Fill reference and Send to reviewers too, and may grant Translator, Reviewer, Viewer and Language Lead, but not Coordinator or Organization Admin). | none |
| TRANS | Translator | Translator at LANG-A scope (Translate, Review, Fill reference, Send to reviewers, View status; Review since decision 91) | translator |
| REV | Reviewer | Reviewer at LANG-A scope (Review, View status). One of the Peer Review and Back Translation checks' people. | reviewer |
| TREV | Translator-reviewer | Custom role "Translator-Reviewer" at LANG-A scope: Translate, Review, Fill reference, Send to reviewers, View status (the same privileges as Translator since decision 91, but a role of the organization's own). One of the Peer Review and Back Translation checks' people. | none |
| VIEW | Viewer | Viewer, organization scope (View status only) | viewer |
| KEPT | Looked-after translator | Translator at LANG-A scope. Joined by a one-person invite labelled "Kept Person". No email and no password. | none |
| NOORG | No organization | An account with no membership | noorg |
| GUEST | Signed out | none | none |
| NEW | A new address for each run, `ui-<run>-<n>@example.org` | Made by the test that needs it | none |

Accounts made during a run are deleted at the end, from Me → More settings
→ Delete account.

## Roles at a glance

What each role should see. NAV tests check this table directly; the other
files rely on it.

| | ADMIN | COORD | LADMIN | TRANS | REV | TREV | VIEW | KEPT | NOORG |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Home after sign-in | My Work | My Work | My Work | My Work | My Work | My Work | Overview (status_home) | My Work | Join your team |
| Tabs on a phone | Work, Map, Manage, Me | Work, Map, Manage, Me | Work, Map, Manage, Me | Work, Map, Me | Work, Map, Me | Work, Map, Me | Map, Inbox, Me | Work, Map, Me | none |
| Reports tab (wide) | yes | yes | yes | yes | yes | yes | yes | yes | no |
| Map tab opens | All languages | All languages | All languages | LANG-A's map | LANG-A's map | LANG-A's map | All languages | LANG-A's map | — |
| Manage opens | Org home | Org home | LANG-A's page | — | — | — | — | — | — |
| Record, publish (Translate) | yes | yes | yes | yes | no | yes | no | yes | — |
| Review it, back-translate (Review) | yes | yes | yes | yes (not their own version unless asked) | yes | yes | no | yes | — |
| Ask someone (Send to reviewers or Assign) | yes | yes | yes | yes | no | yes | no | yes | — |
| Already happened (Translate or Review) | yes | yes | yes | yes | yes | yes | no | yes | — |
| Override a checkpoint | yes | yes | no | no | no | no | no | no | — |
| Invite people | yes | yes | yes (LANG-A) | no | no | no | no | no | — |
| See and decide join requests (organization scope only) | yes | yes | no | no | no | no | no | no | — |
| Roles: create or edit | yes | no | no | no | no | no | no | no | — |
| Choose a language's template, flow, own steps; recommend or hide a Bible | yes | yes | yes (LANG-A) | no | no | no | no | no | — |
| Library writes: publish, share, follow, copy, archive, divide a book, add a Bible | yes | yes | no (refused by the server; SETUP-063 to 065) | no | no | no | no | no | — |
| Moderator: remove content from the record | yes | yes | yes (LANG-A content; not reports about a person) | no | no | no | no | no | — |

The table follows `src/session.ts` (`homeScreenFor`, `mapScreenFor`,
`manageHomeFor`, `tabsFor`, `edgeAllowed`) and `SEED_ROLES` in
`packages/core/src/org.ts`.

## Running the suite

The automated tests live beside the app (decision 95):
- **Web:** Playwright specs in `smart-tests/ui/`, one or more files per area
  (`01-getting-in.spec.ts` …). A test's title starts with its ID.
- **Phones:** Maestro flows in `apps/mobile/test/maestro/flows/`, one file
  per test ID (`REC-023.yaml`), plus the P0 smoke set (`P0-*.yaml`, tag
  `smoke`).
- **Fixture:** `smart-tests/ui/fixture.ts` builds a fresh world through the
  real server in about a second (`npm run ui:fixture -- --out world.json`
  writes one to look at). Every web spec file gets its own world, and so
  does every phone run.

Before a run, have the local stack up: `npm run dev:local`, or
`npm run db:start` with `npm run web:dev`. `db:start` also schedules the
projection worker that public listings, the Inbox and Reports need. Then:

```bash
npm run test:ui:web
```

```bash
npm run test:ui:web -- smart-tests/ui/05-passage-record.spec.ts --project phone
```

```bash
npm run test:ui:build -- --platform ios --device <simulator udid>
```

```bash
npm run test:ui:phone -- --platform ios --tags smoke
```

- `test:ui:web` starts the app's web dev server on :8097, or reuses one.
  `UI_WORKERS` sets how many files run at once (4 by default). The `phone`
  project runs everything at 430×932; the `wide` project runs the tests
  tagged `@wide` at 1280×900.
- `test:ui:build` installs a Release build with its JavaScript inside on the
  simulator or emulator (an AVD name such as `Pixel_6` for Android).
  Rebuild after changing app code. `test:ui:phone -- --app dev` runs the
  flows on a dev client and Metro instead.
- Flows that need the microphone need the host's input playing
  `smart-tests/fixtures/voice.wav` (G8). Flows tagged `wrapped` need a step
  from outside mid-run (their headers say which); `android-only` flows turn
  airplane mode on.
- On Android, airplane mode does not cut `adb reverse`, so the runner runs
  `adb root` and, while airplane mode is on, rejects the phone's loopback
  traffic to the local stack (ports 54421 and 8787) with `iptables`. It
  removes the rules when it exits; `adb shell iptables -L OUTPUT` should
  show none afterwards.
- iOS merges a card or row into one accessibility label, so flows match
  most text as `.*words.*`. A toast lives about 3.5 s, so a tap before a
  toast check uses `waitToSettleTimeoutMs: 0`.

**Phone results (2026-10-13, after merging main), test builds:** 23 of 31
flows pass on iOS and 24 of 31 on Android (the two `wrapped` flows run on
their own). SYNC-016 (iOS) and PASS-068 (Android) failed once in the full
run and passed alone. The rest are the flows that need a microphone signal
(JRN-001, JRN-004, REC-023, REC-026, REC-027, REC-043,
P0-translator-publish: the simulator and emulator heard silence on this
host, which has no loopback input), and NOORG-010 on iOS, which is
Android-only by design. Name the simulator with `--device` when an emulator
is also running (the runner otherwise takes the one booted simulator). SYNC-027 needs `pfctl` to
cut the network on iOS, and SYNC-026's "N of M" line passes too fast on a
local stack to catch; both stay manual there.

**When to run what:**
- **Smoke run.** The web suite's `@p0` tests (`--grep @p0`) and
  `--tags smoke` on one phone. Run it on every release candidate.
- **Full run.** The whole web suite, and every flow on iOS and Android. Run
  it before each store release, and after any change to `flow.ts`,
  `session.ts`, the sync client, or a screen's main action.
- **By role.** Filter by the Roles line. For example, every test with TRANS
  is the translator's experience end to end.

**Run order.** Each spec file and each phone run has its own world, so files
never depend on each other. Inside a file, tests run in ID order and may
build on what earlier ones did. A test that changes shared state ends with a
"Resets:" line, saying what it left behind. A failed test does not rebuild
the world under the tests after it: the world is kept for the whole run
(`useWorld`).

**Selectors.** Tests find things by the words on screen and by a few
`testID`s:
- `header-back`, `header-close`, `header-help` for the header buttons.
- `primary-action` for the main button.
- `record-button` and `publish-button` in the recorder.
- `toast` and `toast-undo` for the toast.
- `tab-work`, `tab-map`, `tab-reports`, `tab-manage`, `tab-inbox` and
  `tab-me` for the tabs.
- `feedback-text` for a review's typed feedback.

Maestro's text selectors are regular expressions: escape `? ( ) + .`. A
row's text includes its sub-line, so match `"Members.*"`. Inside `${…}`,
Maestro evaluates JavaScript, but not an expression that itself contains a
`$`.

## Coverage map

Which files exercise each role's jobs:

| Role | Its jobs are in |
| --- | --- |
| GUEST | AUTH, NOORG (Explore), WEB, A11Y |
| NOORG | NOORG, AUTH (joining), ACCT (Delete account), JRN-005 |
| NEW | AUTH (creating an account, joining), JRN-001, JRN-005, JRN-007 |
| TRANS | NAV, MAP, PASS, REC, REV (answering feedback), STUDY, SYNC, MOD, JRN-002, JRN-011, JRN-012, JRN-013 |
| KEPT | AUTH (sign-in codes), ACCT (password, sign out), PEOPLE (helping someone sign in), JRN-014 |
| REV | NAV, PASS, REV, STUDY, MOD, JRN-003, JRN-011 |
| TREV | NAV (both gates), PASS, REC, REV (reviewing one's own work), JRN-004 |
| COORD | NAV, PASS (asking, overriding), SETUP, PEOPLE, MOD, RPT, JRN-005, JRN-006, JRN-011 |
| LADMIN | NAV (Manage opens the language), SETUP, PEOPLE (scope limits), JRN-008 |
| ADMIN | everything COORD does, plus roles, the licence and organizations; JRN-007, JRN-009 |
| VIEW | NAV (overview, Inbox tab), MAP, PASS (read only), RPT, JRN-010 |
| Everyone | ACCT, SYNC, A11Y, JRN-011 (the passage lifecycle across roles) |

## Known issues

Writing and then automating these tests meant reading every screen's code
and running every job. About 90 product bugs were found and fixed on the
way (2026-10-12 and 13). Each fixed one is marked "Fixed (2026-10-13): …" in
its test. Among the larger ones:
- People's names could stay as placeholders under load. The app read every
  profile through a per-row policy; it now reads `my_directory()`.
- "Find your organization" could not find an organization past the first
  500 listed. The search now runs on the server.
- Work the server refused one event at a time showed only on the Sync
  screen. My Work and Me now say "Refused · N" (PLAN.md invariant 1).
- Uploads held back by a recording waited for the next minute's tick.
- Browser Back skipped a screen, and a refresh lost its section.
- A language lead could open a language they hold no role in, and was then
  treated as having no organization.
- A language lead was offered library writes that the server refuses.
- Undo of a removed check did not bring it back.
- Looked-after accounts could not join once a name's thousand sign-in names
  were used.
- Get ready named only the first of two checks made at the same time.
- A passage moved past a checkpoint could never be done: `done` ignored the
  override that decision 29 says clears it (JRN-006).
- Android's Back did nothing on a screen opened from "Something else?": the
  passage page underneath kept a Back handler of its own (NAV-061).
- Me did not count organization changes waiting to send (NOORG-010).
- An invite code typed by hand was read, and refused, at its 32nd of 64
  characters.

Six product questions the tests raised were decided on 2026-10-13
(decisions.md 96 to 100), and the tests now hold them:
- Answering feedback keeps the check open until its reviewer says it looks
  good (96; JRN-002, JRN-011).
- Taking back a checkpoint override needs Override checkpoints, held by the
  server (97; PASS-056).
- An organization always keeps someone who can manage roles, held by the
  server (98; PEOPLE-026).
- For now a back translation carries one spoken note; later notes are typed
  (99; REV-035). A voice note per moment needs a new event.
- "Join your team" has no Back, unlike the demo (100; NOORG-003).
- Web sign-out still forgets everything, a held invite included (decision
  11 as amended on 2026-10-03; AUTH-034).

The tests below still state the intended behaviour, so they fail, or carry a
note, until each is resolved.

| Test | Open issue |
| --- | --- |
| REC-023, REV-037 | A part being spoken when the app is killed is lost. The native recorder keeps the open part in memory, so it needs native work in `modules/microphone-energy`. |
| REC-028 | Suspected: a phone call or other audio interruption is not handled by the native recorder. Only a device run can tell. |
| JRN-014 | A helper's sign-in code is shown only as a QR code, with no typed form to read out or send. |
| JRN-005 | Reports does not name a language's template. A new request is counted only after the projection worker's next pass. |
| PASS-042 | A guest reviewer's link sends nothing to the guest's phone, and their name shows anonymously in summaries. Review by link (REV-7) is not built. |
| STUDY-036 | Offline, a passage whose Bible never came to the device says "No Bible for this passage yet" instead of naming the Bible and saying its audio needs a connection. |
| NOORG-001, WEB-006 | On the web, a card or Inbox row marked current is not announced as current to a screen reader. |
| REV-019, REV-031, REV-047 | The docs and the app disagree. `docs/ux/screen-path.md` still names "Can't answer this?" and "Save back translation"; the app says "Skip" and "Publish". An older review footer that can never show is still in the code. |
| PEOPLE-039 | Retiring a role is not built. |
| NAV-051 | No screen offers a forbidden move, so the permission refusal can only be checked through the dev hook `__langquestGo`. |
| SETUP-026, MOD-018, SYNC-018 | Seen once while automating, not reproduced in the full run of 2026-10-13: a book change followed by Undo upsetting "What helps them"; a removed note showing on a fresh device until the next snapshot (decision 88's design); a translator removed from their only language landing on "Join your team". |

## Run sheets

Specs marked Manual or Device are run by hand against each release candidate.
`run-sheets/TEMPLATE.md` lists them, one table per area. Regenerate it with
`node scripts/run-sheet.mjs > docs/ui-test-suite/run-sheets/TEMPLATE.md`. For a
release candidate, copy the template to `run-sheets/<date>-<build>.md`, fill in
the build, devices and results, and commit it with the results.
