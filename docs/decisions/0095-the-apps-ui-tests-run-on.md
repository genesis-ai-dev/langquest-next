# 95. The app's UI tests run on Maestro on phones and Playwright on the web; Jev stays for journeys judged by outcome

Date: 2026-10-12 · By: Carl Sauder · Status: partly superseded by 102

Reason: `docs/ui-test-suite/` specifies the app's end-to-end UI tests, per
role, and about 550 of them can be automated. Carl chose (2026-10-12):
- **Maestro** for iOS and Android (`apps/mobile/test/maestro/`). It drives
  the dev client or a release build from YAML flows without instrumenting
  the app. It handles permission dialogs, backgrounding, killing the app,
  deep links and two devices, which the recording, sign-out and offline
  tests need. The `run-app` skill already used it.
- **Playwright** for the web export (`smart-tests/ui/`). It already ran the
  web smoke test (58) and hosts Jev's driver, and Chrome plays a WAV file as
  the microphone.
- Each automated test is written once. A test whose platforms include the
  web runs in Playwright, which is faster and runs in parallel. A test of
  phone-only behaviour runs in Maestro. A set of P0 flows runs in Maestro on
  both phones, so the core jobs are also proven on devices.
- One fixture world, built through the real server so every event passes
  validation and permissions like a phone's, serves both
  (`smart-tests/ui/fixture.ts`, `npm run ui:fixture`). Each Playwright file
  and each Maestro run gets a fresh organization, so runs share the local
  database without touching each other.
- Screens get `testID`s on their main action, Back and ✕, and the tabs, so
  flows hold across the app's fifteen languages.

Not chosen:
- **Detox.** It is synchronized with React Native, so it is less flaky. But
  it needs native build configuration and is heavier to keep working.
- **Appium.** It is slow and flaky.
- **Jev as the main framework.** It drives only the web, its runs vary, and
  every step is a paid model call. It cannot check a toast's words, Undo or
  a permission boundary. It stays the tool for journeys judged by their
  outcome in the event log, once it is ported (`smart-tests/README.md`).

Reverse if:
- Maestro's flakiness costs more than Detox's setup would.
- Bugs that only phones show slip through the web runs. Then run the web
  tests' flows on phones too.

Amended (2026-10-13, Carl Sauder): the phone flows run on a test build, not
on the dev client. A dev client loads its JavaScript from Metro after every
clean start, which took about 40 s per flow on iOS. On Android it took 2.5
minutes, because the server's address had to be typed into the launcher.
`npm run test:ui:build` (`scripts/maestro-build.mjs`) makes a Release build
with the JavaScript inside, pointed at the local stack. A clean start then
takes seconds: 31 s and 43 s per flow, sign-in included.
- The build is marked a local release (`EXPO_PUBLIC_LOCAL_RELEASE`, which
  `src/supabase.ts` already allowed for the web export). It bundles from an
  empty Metro cache of its own (`METRO_CACHE_DIR`, `metro.config.js`):
  Expo writes `EXPO_PUBLIC_*` values into files as Metro transforms them,
  and the cache every Metro on a machine shares would otherwise hand the
  build files made with other settings.
- Two settings change only in the generated `ios/` and `android/` folders,
  which version control ignores, so no store build can carry them.
  Over-the-air updates are off, and Android allows plain http to the local
  stack.
- The runner's `--app dev` still runs the flows on a dev client and Metro,
  for working on a flow against live code.
