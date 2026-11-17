# 208. The phone flows run each night on GitHub's own Android and Mac machines, file each failure in Linear with its screen, and show the night on the ops dashboard

Date: 2026-11-11 · By: Caleb Koster · Status: partly superseded by 209

Reason: Caleb (2026-11-11, thread "Nightly phone UI tests") asked for the
whole app's UI to be tested each night on an iPhone and an Android phone,
not only on the web, with each problem filed as a new Linear issue and a
picture summary on the ops dashboard. Decision 95 wanted the P0 flows on
both phones, but they ran only by hand before a store release. Caleb chose
GitHub's hosted machines over his Mac or a paid device farm: the repository
is public, so they cost nothing, and the team sees every run. Decided
(`.github/workflows/phone-tests.yml`, `scripts/phone-tests.mjs`):
- **Android on Linux, iPhone on a Mac.** The Android emulator runs on
  `ubuntu-latest` (it has KVM) beside the local stack and the Worker, as the
  web suite's jobs do (`scripts/ci-android-emulator.sh`). GitHub's Mac
  machines have no Docker, so the iPhone's stack runs on a Linux job of the
  same run and the Mac reaches it through a Cloudflare quick tunnel. The
  tunnel needs no account or key. A small gate on the Linux side lets in
  only requests with a token it makes for the run, and gives that token
  only to a job that shows an OIDC token GitHub signed for this repository,
  this workflow and this run (`scripts/phone-tunnel.mjs`). A job output or
  a job's env would have shown the token in the public logs (the first run
  did), so it is in neither. The Mac maps the stack's ports
  back to localhost, so the test build is the one `npm run test:ui:build`
  makes (decision 95, amended 2026-10-13).
- **Every flow but `voice`.** The plan's skips stay (`maestro-plan.mjs`),
  and the report lists each flow not run and why. Voice flows need a
  microphone the machines do not have; they come in a later step.
- **Linear like the web nightly.** Each failed flow is one issue per phone,
  "Nightly: <flow> [Android emulator]", under LAN-210, with the failed
  screen's picture uploaded to Linear. The same title is found again, not
  filed twice, and gets a comment when it passes (`scripts/nightly-report.mjs`
  `plan`). More than 10 failures on one phone, or a run that broke before
  its flows, is one issue for that phone's run.
- **Claude says what went wrong.** When a flow fails, Claude (the repository's
  `CLAUDE_CODE_OAUTH_TOKEN`, as in 202) reads the failure and its screen and
  writes one sentence and a cause: the app, the flow, or the test machine.
  The run files and reports without it if it fails.
- **The night is kept in a public release.** `phone-tests` holds
  `summary.json`, `history.json` (30 nights) and the failed screens (14
  days). The ops dashboard's Phone tests section reads it with no new key,
  and passes the pictures on through its own API, because the page shows
  only its own-origin images. The pictures show the test server's made-up
  people only.
- **Not a gate.** A pull request that changes the workflow or its scripts
  runs the `smoke` flows, files nothing and publishes nothing. No PR waits
  for the phones. Nothing here touches production (141).
Reverse if: GitHub's machines make the runs flaky enough that a failure is
more often the machine than the app (then run them on the team's Mac or a
device farm), or the repository goes private and the macOS minutes cost more
than a device farm.
