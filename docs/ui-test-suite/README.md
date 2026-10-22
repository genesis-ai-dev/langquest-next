# The Expo app's UI test suite

The end-to-end UI tests for the LangQuest app (`apps/mobile`): iOS, Android
and its web export. Each test drives the real app, signed in as a real
account, against a real server. Every role's workflows are covered.

This suite sits on top of the existing automated tests and does not repeat
them:
- `npm test` covers the reducer, validation and the flow parity tests
  (`specParity.test.ts` holds every edge of `src/flow.ts`).
- `npm run test:web-smoke` runs the web smoke test.
- `e2e/` holds this suite (`ui/`), the web smoke (`web-smoke/`) and their fixtures.

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
| 05 | [05-passage-record.md](05-passage-record.md) | The passage record, Something else?, Ask someone, Already happened, versions and history, set aside, checkpoints, Undo and Withdraw in History | `PASS` | 64 |
| 06 | [06-recording.md](06-recording.md) | The recording workspace, voice detection, parts, Done, interruptions | `REC` | 51 |
| 07 | [07-reviewing.md](07-reviewing.md) | Review it, questions, verdicts, feedback, back translation, answering feedback | `REV` | 50 |
| 08 | [08-study-and-reference.md](08-study-and-reference.md) | The study, key words, Bibles beside a passage, reference for one passage | `STUDY` | 36 |
| 09 | [09-language-setup.md](09-language-setup.md) | New language and clusters, Get ready, templates, dividing books, review flows, reference material, the guide editor, licence | `SETUP` | 68 |
| 10 | [10-people-and-roles.md](10-people-and-roles.md) | Members, invites, join requests, editing members, roles, review teams, the limits on granting | `PEOPLE` | 48 |
| 11 | [11-account-and-settings.md](11-account-and-settings.md) | Me, More settings, profile, notifications, switching organization, app language, help mode, signing out, deleting an account | `ACCT` | 51 |
| 12 | [12-sync-and-offline.md](12-sync-and-offline.md) | The Sync screen, offline work, Ready for offline, handing over, two devices, refused work, the update banner | `SYNC` | 32 |
| 13 | [13-moderation.md](13-moderation.md) | Reporting, blocking, hidden content, removal, reports in the Inbox | `MOD` | 24 |
| 14 | [14-reports.md](14-reports.md) | The Reports section on wide windows | `RPT` | 22 |
| 15 | [15-web-and-wide.md](15-web-and-wide.md) | Wide layouts, panes, one tab at a time, browser history, forgetting the browser | `WEB` | 28 |
| 16 | [16-role-journeys.md](16-role-journeys.md) | Whole jobs per role, and the passage lifecycle across every role | `JRN` | 14 |
| 17 | [17-accessibility-and-field-use.md](17-accessibility-and-field-use.md) | Screen readers, target sizes, text size, colour, RTL, outdoor and low-end use | `A11Y` | 24 |

**661 tests in all.**

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
- The local stack is running (`npm run dev`): Supabase, and the Worker
  on :8787 running the projection pass every minute in its job container.
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
- Recording tests play `e2e/fixtures/voice.wav` into the
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
5. No toast offers Undo (decision 134): a toast only says what happened,
   with a close ✕. The way back is where the thing is: History's "Undo" or
   "Withdraw" on a passage, a study step's own "Undo", the Undo and Redo
   arrows of the screens where something is built (recording, back
   translation, the guide editor, Divide your own way, a language's checks),
   or the same control again. Where a test says "Undo", it really takes the
   change back.
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
| P-NEW | Luke 13:1-9 | Not started. COORD asked TRANS to record it (no due date). |
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
- **Web:** Playwright specs in `e2e/ui/`, one or more files per area
  (`01-getting-in.spec.ts` …). A test's title starts with its ID.
- **Phones:** Maestro flows in `apps/mobile/test/maestro/flows/`, one file
  per test ID (`REC-023.yaml`), plus the P0 smoke set (`P0-*.yaml`, tag
  `smoke`). A smoke flow names
  the specs it covers on a `# Covers: ID, ID` line, and only what it runs;
  `scripts/uiSuite.test.ts` counts those IDs as implemented.
- **Fixture:** `e2e/ui/fixture.ts` builds a fresh world through the
  real server in about a second (`npm run ui:fixture -- --out world.json`
  writes one to look at). Every web spec file gets its own world, and so
  does every phone run.

Before a run, have the local stack up: `npm run dev`, or
`npm run db:start` with `npm run web:dev`. The Worker runs the projection
pass that public listings, the Inbox and Reports need, every minute in its
job container (Docker must be running); the suite's own Worker
(`e2e/ui-web.sh`) does too. Then:

```bash
npm run test:ui:web
```

```bash
npm run test:ui:web -- e2e/ui/05-passage-record.spec.ts --project phone
```

```bash
npm run test:ui:build -- --platform ios --device <simulator udid>
```

```bash
npm run test:ui:phone -- --platform ios --voice --tags smoke
```

- `test:ui:web` runs on the release export, as people get it (decision 102):
  `e2e/ui-web.sh` exports the app for the local stack (about 20 s)
  and serves it with `/api` from one Worker on :8787, or reuses a Worker
  already there. A reused Worker serves `apps/mobile/dist` as it is, so after
  app changes run `npm run export:web -w mobile -- development` (it refreshes
  a running Worker without a restart), or stop the Worker so the suite starts
  its own. `UI_TARGET=dev` runs on Metro's dev build instead (:8097, plus the
  Worker from `npm run web:dev` on :8787); the two update-banner tests skip
  there, because a dev page has no build id. The tests read the app through
  probes that exist only in test builds (`src/testBuild.ts`: dev, or an export
  with `EXPO_PUBLIC_LOCAL_RELEASE=1`): the log, Sync now, and
  `__langquestTestState` (`testState`, `expectSyncIdle` in `support.ts`).
  `UI_WORKERS` sets how many files run at once (4 by default). The `phone`
  project runs everything at 430×932; the `wide` project runs the tests
  tagged `@wide` at 1280×900.
- `test:ui:build` installs a Release build with its JavaScript inside on the
  simulator or emulator (an AVD name such as `Pixel_6` for Android).
  Rebuild after changing app code. `test:ui:phone -- --app dev` runs the
  flows on a dev client and Metro instead.
- `test:ui:phone` skips the flows the run cannot hold and prints which and
  why (`scripts/maestro-plan.mjs`): flows tagged `voice` without `--voice`
  or `--mic`, `android-only` flows on iOS, and `wrapped` flows without
  `--wrapped`. A skipped flow is not a finding; a failed one is. Flows named
  with `--flow` run as asked.
- Flows tagged `voice` need the host's input playing
  `e2e/fixtures/voice.wav` (G8). Route taken: the host, with
  `--voice` (macOS); `--mic` says the input already carries voice, as on a
  device with a person speaking. The app's capture is native (the local
  `microphone-energy` module for voice detection and expo-audio's recorder
  writing the file), so JavaScript never sees samples and a test-build fake
  input would need native code; the web suite's shim works only because the
  browser exposes `getUserMedia`. `--voice` looks for a virtual audio device
  (`system_profiler SPAudioDataType`), loops the clip with `afplay` for the
  run, and prints what to install when none exists: `brew install --cask
  blackhole-2ch`, make it the Mac's input, and make the output a Multi-Output
  Device that includes it (the emulator also needs "Virtual microphone uses
  host audio input").
- `--shards N` spreads the flows over N devices (`--device a --device b`,
  or N booted simulators on iOS) with Maestro's `--shard-split`. Maestro
  orders flows only inside a shard, so the flows in `config.yaml`'s
  `flowsOrder` run first on the first device, then the rest are split.
  Reports: `report-ordered.xml` and `report.xml`. Flows tagged `wrapped` need a step
  from outside mid-run (their headers say which) and run only with
  `--wrapped`; `android-only` flows turn airplane mode on.
- On Android, the runner turns animations off for the run (window,
  transition and animator scales to 0) and puts them back afterwards.
  Maestro reads a screen once it is idle, and one that animates every frame
  (the header's sync ring during a transfer) is never idle, so a check came
  after the toast had gone or a short clip had finished. React Native reads
  the zero transition scale as Reduce Motion, which the app honours.
- On Android, the runner also sets accessibility's "Time to take action" to
  10 s for the run and puts it back afterwards. A toast lasts as long as that
  setting asks, and under reduce motion runs no bar down (decision 155): the
  bar kept the screen moving, so a Back or tap waited out the whole toast
  before Maestro read the screen. On iOS the runner turns the simulator's
  Reduce Motion on for the run and puts it back, for the same reason.
- On Android, a cold start can be killed as it begins, right after Maestro
  clears the app's data and sets its permissions, leaving a blank window
  (`am_kill … remove task`, then `am_process_start_timeout` in the events
  log). `common/launch.yaml` starts the app again when no first screen shows
  within 20 s; a healthy cold start shows one in under 8 s.
- On Android, airplane mode does not cut `adb reverse`, so the runner runs
  `adb root` and, while airplane mode is on, rejects the phone's loopback
  traffic to the local stack (ports 54421 and 8787) with `iptables`. It
  removes the rules when it exits; `adb shell iptables -L OUTPUT` should
  show none afterwards.
- iOS merges a card or row into one accessibility label, so flows match
  most text as `.*words.*`. A toast lives about 3.5 s on iOS, so a tap before a
  toast check uses `waitToSettleTimeoutMs: 0`, and a flow that only needs what
  the act left checks that instead (the row, History, the kept mark), as
  MAP-031 and JRN-006 do; the web suite checks the toast's words.

**Web results (2026-10-14, the release export, 4 workers):** 666 tests, 654
passed, 5 open, 7 skipped, in 12.9 minutes; median test 1.2 s. The five
were test bugs, fixed the same day; MOD-016 and MOD-020 failed once each
under load afterwards (`node scripts/ui-flakes.mjs` over the kept reports).

**Tests that need a key the local stack lacks:** STUDY-030 (Bible Brain's
language search) skips, saying so, unless the Worker has a real
`BIBLE_BRAIN_ACCESS_KEY`; STUDY-033 is its mirror and runs without one.
The rest of the study file runs on the world's own guide (Luke 15:11-32 with
a recorded step and a glossary word) and Bible (`e2e/ui/study-helpers.ts`).

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

**Quarantine and flake rates.** Retries are off, so a test that fails without
a product cause is tagged `@quarantine` (with an issue and an owner in a
comment), runs on its own in the nightly workflow, and is left out of the
P0 and nightly runs with `--grep-invert @quarantine`. Pass rates per test
come from the kept reports: `node scripts/ui-flakes.mjs keep` after a run
copies its `report.json` into `e2e/results/history/`, and
`node scripts/ui-flakes.mjs` lists every test that did not pass every time
(`docs/testing.md`).

**When to run what** (`docs/testing.md` has the whole table):
- **Every PR.** CI runs the web suite's `@p0` tests on the export
  (`.github/workflows/guardrails.yml`, job `ui-web`), and `npm run ship`
  runs them on the local stack before an update goes out.
- **Nightly.** CI runs the whole web suite, quarantine apart.
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
- `header-back`, `header-close`, `header-help` for the header buttons, and
  `header-up` for the organization's name where Back would be on a language
  lead's language page (decision 138).
- `title-rename` for the pencil beside a language's title, and
  `org-rename` for the one beside the organization's name on Org home.
- `primary-action` for the main button.
- `record-button` and `publish-button` in the recorder.
- `toast` for the toast (it has no Undo; its close ✕ is "Close"), and
  `undo` and `redo` for the Undo and Redo arrows.
- `tab-work`, `tab-map`, `tab-reports`, `tab-manage`, `tab-inbox` and
  `tab-me` for the tabs.
- `feedback-text` for a review's typed feedback.
- Structure, by ID rather than by words (the labels stay for screen readers):
  `path-step-<kind>` (study, record, publish, feedback, fix) and
  `team-row-<kindId>` (peer, bt, community, consultant, final) on the passage
  record; `map-search` on the Map's search field; `row-<unitId>` on a passage
  row, `row-<bookKey>` on a book and `row-<bookKey>-<chapter>` on a chapter
  tile; `sheet` on an open sheet and `sheet-close` on its close button;
  `else-<option>[-<kindId>]` on the Something else? options (`else-note`,
  `else-reference` for its tiles); `person-<profileId>` on a member's row;
  `toggle-must-pass`, `toggle-same-time` and `toggle-required` on the checks
  setup switches; `sync-tile-<waiting|refused|confirmed|checkpoint>` on the
  Sync screen's tiles; `invite-role-<title>` on a role's card in Invite
  someone and `invite-role-<title>-invite` on its Invite (phone
  accessibility trees list the button beside the card, so Maestro's
  `childOf` cannot find it).
- Entering: the web's addresses name sections only (`pathTo` in `support.ts`,
  `openAs(..., { path })`). A passage's record has none, so a test that only
  reads one calls `openRecord` (`05-passage-helpers.ts`), which uses the
  test build's `__langquestOpenPassage` (`enterPassage` in `support.ts`);
  `openRecordBySearch` walks through the Map for the tests of the search
  itself. `gotoApp` loads afresh (a reload keeps the old history depth).

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
- Undo of a removed check did not bring it back. (That was the toast's
  Undo, gone since decision 134; on a language's list of checks the
  header's Undo arrow now brings a removed check back, as a new step of the
  same checks.)
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
| REV-019, REV-031, REV-047 | The docs and the app disagree. `docs/ux/screen-path.md` still names "Can't answer this?" and "Save back translation"; the app says "Skip" and "Done". An older review footer that can never show is still in the code. |
| PEOPLE-039 | Retiring a role is not built. |
| NAV-051 | No screen offers a forbidden move, so the permission refusal can only be checked through the dev hook `__langquestGo`. |
| SETUP-026, MOD-018, SYNC-018 | Seen once while automating, not reproduced in the full run of 2026-10-13: a book change followed by the toast's Undo upsetting "What helps them", now "Reference material" (that Undo is gone since decision 134: SETUP-024 now puts the books back by choosing them again in "Content template" → "Which books", decision 138, and whether that upsets it is not yet known); a removed note showing on a fresh device until the next snapshot (decision 88's design); a translator removed from their only language landing on "Join your team". |

## Run sheets

Specs marked Manual or Device are run by hand against each release candidate.
`run-sheets/TEMPLATE.md` lists them, one table per area. Regenerate it with
`node scripts/run-sheet.mjs > docs/ui-test-suite/run-sheets/TEMPLATE.md`. For a
release candidate, copy the template to `run-sheets/<date>-<build>.md`, fill in
the build, devices and results, and commit it with the results.
