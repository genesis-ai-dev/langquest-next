# Testing strategy

How this repo is tested, which layer a new test belongs in, and what runs
where. Decision 102 records why. The UI test suite's own manual is
[ui-test-suite/README.md](./ui-test-suite/README.md); this page is the
strategy above it.

## The shape

Tests sit in five layers. Each layer is cheaper and more precise than the one
below it, so a check goes in the lowest-numbered layer that can hold it.

| Layer | What it proves | Framework | Where | Runs |
| --- | --- | --- | --- | --- |
| 1. Unit and property | Core folds and commands, client sync, mobile models, scripts. The PLAN.md invariants as property tests. | Vitest, with fast-check for the property tests | `packages/*/test`, `apps/*/test`, `scripts/*.test.ts` | every `npm test`, pre-push, CI on every PR |
| 2. Server | SQL smokes, SQL-to-core parity (`validate_payload`, `event_privilege`), the sync integration test, a fleet scenario on simulated time | Plain SQL run by `psql` from a Node script (`scripts/db-test.mjs`); the parity check and the fleet are `tsx` scripts; the integration test is Vitest | `server/*.sql`, `scripts/db-test.mjs`, `packages/sync/test/integration.test.ts`, `scripts/fleet` | CI on every PR (fleet nightly) |
| 3. Screen models | What a screen shows for a state and a role: main button, path steps, team rows, tabs. Pure functions in `apps/mobile/src/<feature>/model.ts` and `*Model.ts`, tested with the core fixtures and `test/sessions.ts`. | Vitest | `apps/mobile/test` | every `npm test` |
| 4. End-to-end, web | A person does a job in the real app, signed in, against the local server: the release web export served by the Worker. | Playwright (Chromium) | `e2e/ui` | `@p0` on every PR; the whole suite nightly and before a store release |
| 5. End-to-end, phones | What only a phone shows: recording, permissions, backgrounding, airplane mode, hand-over, the P0 smoke set. On a Release test build. | Maestro (YAML flows) | `apps/mobile/test/maestro` | before a store release, and after a change to the recorder, sync or sign-in |

Beside them:

- **Web smoke** (`e2e/web-smoke`): the release export in Chromium,
  Firefox and WebKit, checking the platform itself (storage, tabs, headers,
  sign-out). CI on every PR.
- **Lint** (`npm run lint`): what may import what (`eslint.config.mjs`,
  decisions.md 104 and 105): core imports nothing, sync only core and
  supabase-js, only `src/server` reaches Supabase, models stay pure,
  screens keep storage out, and nothing but `App.tsx` imports a screen.
  CI, pre-push.
- **Coverage** (`npm run test:coverage`): V8 coverage of layers 1 to 3 with
  thresholds for `packages/core` and `packages/sync`, which are pure and
  must stay near fully covered. CI fails under the threshold. On 2026-10-14 core was at 95% lines and client at 90%; thresholds are 93 and 88.
- **Mutation testing** (`npm run mutate:core`): Stryker over `packages/core`,
  nightly. Coverage says a line ran; mutation says a test would notice it
  changing. Core holds the invariants, so it gets both. Baseline on 2026-10-14: 52.5%
  over all of `packages/core/src` (5,598 killed, 2,124 survived, 2,937 with no test reaching them), 7 minutes on
  7 workers; `reducer.ts` 77.2%, `passage.ts` 60.8%. The Stryker vitest runner needs the two workarounds in
  `vitest.stryker.config.ts` until it supports vitest 5.
- **Manual and device tests**: the specs in `docs/ui-test-suite` marked
  `Manual` or `Device`. A release candidate gets a run sheet
  (`docs/ui-test-suite/run-sheets/`), committed with its results.
- **Spec traceability** (`scripts/uiSuite.test.ts`): every spec marked
  `Auto` has a test carrying its ID in layer 3, 4 or 5, and every P0 spec is
  automated somewhere. Known gaps are listed in that test with a reason, so
  the list can only shrink on purpose.

Not used, and why:

- **Jev** (model-driven journeys judged by outcome). It drives only the web,
  its runs vary, every step is a paid model call, and it cannot say what a
  screen showed. It was shelved on 2026-10-14 (decision 102); history keeps
  the harness. It returns, if at all, as a nightly discoverability signal,
  never as a gate.
- **Detox**. Steadier than Maestro on React Native but needs native build
  configuration. Reconsidered only if Maestro's flake rate stays above a few
  percent after the fixes below.
- **Rendered component tests** (Jest with React Native Testing Library). A
  second runner. Screens here hold little logic of their own: the models do,
  and layer 3 tests them. Added only if that stops being true.
- **Screenshot comparison**. Later, once the suite is stable on the export.

## Which layer a test belongs in

Ask, in order:

1. Is it a rule about events, folds, commands or sync? Layer 1. If it holds
   "in any order" or "applied twice", it is a property test.
2. Is it about what the server accepts, refuses or derives? Layer 2.
3. Is it "role R on passage in state S sees X"? Layer 3. The role-by-passage
   matrices (PASS, NAV, MAP) live here, titled with their spec ID. One
   end-to-end test per screen then proves the model reaches the glass.
4. Does a person have to tap through it, or does it cross sync, two devices,
   the browser, or the Worker? Layer 4.
5. Does only a phone show it? Layer 5.

A test that could be in a lower layer is moved there in review.

## End-to-end rules (layers 4 and 5)

These keep the suite fast enough to run and stable enough to trust.

- **The export, not Metro.** The web suite runs against `npm run export:web`
  served by the Worker (`e2e/ui-web.sh`), the build people get.
  `UI_TARGET=dev` runs it on Metro for working on a test against live code.
- **Signals, not sleeps.** A test waits on something it can observe: a
  locator, the device log, or the test-state probe the app exposes in test
  builds (`__langquestTestState`: sync idle, pending count, last pull).
  `page.waitForTimeout` is forbidden; the hygiene test fails on one unless
  the line carries `// sleep: <why nothing observable exists>`.
- **One test, one role.** A spec that names several roles becomes one test
  per role, titled `ID role`, so each stays under about a minute, failures
  isolate, and files shard. The default timeout (`ui.config.ts`) is the
  ceiling; a test that raises it says why.
- **Enter directly.** A test that only reads a screen opens it directly,
  not by tapping through the Map: sections by their address
  (`pathTo`, `openAs(page, world, who, { path })`), and a passage record,
  which has no address (decision 58), through the entry pushed
  notifications use, exposed in test builds (`enterPassage`). Navigation
  itself is tested once per edge.
- **IDs for structure, words for copy.** Path steps, team rows, list rows,
  sheets, the search field, toggles and the tabs carry `testID`s; tests find
  them by ID and read their words. Assertions on words are for tests about
  the words, and take them from the i18n catalog, not literals.
- **Zero retries, quarantine instead.** `retries: 0` stays. A test that
  fails without a product cause is tagged `@quarantine`, runs in its own job,
  and has an owner and an issue. `scripts/ui-flakes.mjs` reads the kept
  reports and lists pass rates per test.
- **Own world per file, no order between files.** Inside a file, tests may
  build on earlier ones only when the spec says so under "Resets".
- **Phones run the P0 smoke set and phone-only behaviour.** A test that can
  run on the web runs on the web. Maestro runs sharded across simulators
  (`--shards N`) and on a Release test build (`npm run test:ui:build`).
  The runner skips the flows a run cannot hold and prints which: flows
  tagged `voice` without `--voice` or `--mic`, `android-only` flows on iOS,
  `wrapped` flows without `--wrapped`. A skipped flow is not a finding.

## What runs where

| When | What | Budget |
| --- | --- | --- |
| Pre-push hook | typecheck, `npm test`, worker bundle parity | under 30 s |
| `npm run guardrails` | the CI `checks` job here; `--web` adds the export and its budget, `--all` the server and `ui-web` jobs | |
| PR (CI `checks`) | typecheck, `npm test`, coverage thresholds, worker bundle parity | under 10 min |
| PR (CI `server`) | `db:test`, `test:integration` | under 15 min |
| PR (CI `web-smoke`) | the export in three engines | under 20 min |
| PR (CI `ui-web`) | `@p0` web tests on the export | under 20 min |
| Nightly (CI) | the whole web suite, `@quarantine` apart; fleet `normalDay`; Stryker on core | reported, not blocking |
| `npm run ship` | typecheck, then `@p0` web tests on the local stack (`SHIP_UNTESTED=1` skips, loudly) | |
| Store release | full web suite, every Maestro flow on both phones, the run sheet | |

## Adding a test

- Layer 1 to 3: beside the code's existing tests, titled with the spec ID
  when it implements one.
- Layer 4: a `test('ID title @p0', …)` in the area's spec file, using the
  helpers in `e2e/ui/support.ts`. Run the file alone first:
  `npm run test:ui:web -- e2e/ui/<file>`.
- Layer 5: one flow per ID in `apps/mobile/test/maestro/flows`, tagged.
- Every automated spec keeps its line in `docs/ui-test-suite` and its `Run`
  value says which layer holds it (`Auto`, `Auto (model)`, `Device`,
  `Manual`).

## Where it stands

Measured on 2026-10-14, after decision 102 landed, on a MacBook with the
local stack (4 Playwright workers):

| | Before | After |
| --- | --- | --- |
| Unit, property and model tests (`npm test`) | 1,406 in 4.6 s | 1,365 in about 5 s (the matrices moved down are fewer, broader tests; the fast-check properties replaced fixed shuffles) |
| Web UI tests | 537, no automatic run, 18.8 min for the passage-record file alone | 666 (one role per test), 654 passed, 5 open, 7 skipped, 12.9 min for the whole suite; median test 1.2 s, 90th percentile 6.4 s |
| Fixed waits in the web suite | 86 sleeps, 121 raised ceilings | 31 sleeps, each with its reason; 8 ceilings, each with its reason |
| `testID`s in the app | 13 | 33: path steps, team rows, rows, sheets, search, toggles, tiles, menus |
| Coverage | not measured | core 95% lines (threshold 93), client 90% (threshold 88) |
| Mutation score, core | not measured | 52.5%, 7 min |
| CI | unit, server, web smoke | plus `@p0` web UI tests on every PR; whole suite, fleet and Stryker nightly |

The five open tests were test bugs, fixed after that run (a response read
after navigation, three reads before a draw, a book past the first page of
a list, a join request that only the once-a-minute Inbox count fetches).
MOD-016 and MOD-020 failed once each in later runs under load and are the
first candidates for a look, with `scripts/ui-flakes.mjs` over the kept
reports.

Phone flows were not re-run on devices that day: the runner's sharding and
microphone options were checked for their arguments only. The CI jobs were
written but had not run on GitHub yet. Those are the first things to do
before trusting either.
