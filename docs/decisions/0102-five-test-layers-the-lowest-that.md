# 102. Five test layers, the lowest that can hold a check; end-to-end on the export, with a budget; Jev shelved

Date: 2026-10-14 · By: Carl Sauder · Status: accepted

Reason: a review of the repo's tests on 2026-10-14 (`docs/testing.md`)
found a strong unit and property layer (1,400 tests in under five seconds),
no coverage measurement, no layer between the pure models and the
end-to-end suite, and a 537-test web suite that ran nowhere automatically.
The suite had found about 90 product bugs (95), so the problem was
proportion, not tools: it carried role-by-passage matrices that are pure
functions of state and role, it slept where it could have waited on a
signal (86 fixed waits), it found most things by their English words
(13 `testID`s in the app), it ran on Metro's dev build rather than the
export people get, and a failure mid-file burned a ceiling of up to twenty
minutes. Carl chose (2026-10-14):

- Five layers (unit and property, server, screen models, end-to-end web,
  end-to-end phones), and a check goes in the lowest that can hold it. The
  matrices move down to screen-model tests titled with their spec IDs; one
  end-to-end test per screen proves the model reaches the glass.
- The web suite runs against the release export served by the Worker, the
  way the smoke test does; Metro stays for authoring (`UI_TARGET=dev`).
- Waits are on signals: locators, the device log, and a test-state probe the
  app exposes in test builds. `waitForTimeout` fails the hygiene test unless
  the line says why nothing observable exists.
- One test per role, the default timeout as the ceiling, screens entered
  directly (sections by address; a passage record, which has no address
  by 58, through the entry notifications use, in test builds only),
  structure found by `testID` and copy by catalog key.
- Retries stay at zero (95); a test that fails without a product cause goes
  to `@quarantine` with an owner, and pass rates come from the kept reports.
- `@p0` runs on every PR and before `npm run ship`; the whole suite, a fleet
  scenario and Stryker on core run nightly; phones and the run sheet before a
  store release.
- Coverage is measured with thresholds for core and client; a traceability
  test holds every `Auto` spec to an implementation and every P0 to
  automation, with known gaps listed by reason.
- Jev is shelved: the journeys, driver, bridge and Python environment leave
  the tree, and the manual-dispatch CI job with them. It drove only the web,
  varied between runs, cost a model call per step and could not say what a
  screen showed; its port to the organization-and-language model had been
  waiting since 2026-09-29. Not chosen either: Detox (native setup for a
  flake rate not yet shown to need it), Jest with React Native Testing
  Library (a second runner for screens that hold little logic), screenshot
  comparison (later, once the suite is stable on the export).

Amends 95: the automated tests stay on Maestro and Playwright; Jev no longer
"stays for journeys judged by outcome".

Reverse if: a screen's behaviour cannot be expressed as a model and
end-to-end tests pile up again; Maestro's flake rate stays above a few
percent after the fixes; or a discoverability problem (people cannot find
how to do a job) slips through, which is the one thing a goal-driven agent
checks and scripts do not. Then Jev returns as a nightly signal.

Amended (2026-10-14, Carl Sauder): the folder `smart-tests/` is now
`e2e/`. "Smart" was Jev's word for its journeys; what is left in it is
the web UI suite and the web smoke, both Playwright, the end-to-end
layer of `docs/testing.md`. Not `web-tests/`, which read like a sibling
of `apps/web/test`, the Worker's unit tests.

Amended (2026-10-14, Carl Sauder): the phone runner skips the flows a run
cannot hold and says why, instead of running them to a failure. The first
unattended iOS run reported 10 of 33 flows failed, and every one was a
flow that could not pass as run: seven needed a microphone signal (no
`--voice`), one Android's airplane mode, two a step from outside mid-run.
Failures that are not findings hide the ones that are. So flows carry
tags for what they need (`voice`, `android-only`, `wrapped`), a test holds
the tags to the flows' steps, and `scripts/maestro-plan.mjs` turns the
run's flags into exclusions and a printed list. The flows had been written
to fail rather than pass silently; a skip that is printed keeps that
honesty without the noise. Named flows (`--flow`) still run as asked.

Amended (2026-10-15, Carl Sauder): the PR jobs no longer wait for
`checks`, and `ui-web` runs in two shards. A PR waited about 12 minutes:
`checks` (2.4 min), then `ui-web` (8 to 10 min), of which the `@p0` tests
were 5 to 6.5 min on four workers that were busy only 70% of the time,
because the one long `@wide` journey (JRN-005, about 2 min) was queued last
and ran alone. Now the four jobs start together, a job that needs the local
stack starts it in the background while it installs browsers, the `wide`
project is listed first, and each project builds its own fixture world, so
the two can run one file at once. Shards, not more workers: a runner has
four cores and already runs the stack and the Worker beside the browsers.
A failing `checks` no longer saves the other jobs' runner time, which on a
public repository costs nothing. Reverse if: runner minutes start to cost
(a private repository, or a paid plan's limit), or the shards' runs disagree
with an unsharded one.

Amended (2026-10-15, Carl Sauder): coverage thresholds also hold the
mobile screen models (`apps/mobile/src/**/{model,*Model}.ts`), and every
threshold sits about two points under what is measured, raised as coverage
rises. A coverage audit that day found decision logic had grown back into
screens and hooks (Get ready's help items, My Work's to-dos, the break-up
rules) and a model at 0% that nothing flagged; the logic moved into models,
and a threshold keeps it there. Thresholds well under the measured value had
let a gain slip back unnoticed.

Amended (2026-10-16, Carl Sauder): "reported" now means filed in Linear.
The whole web suite had failed on the first two nights (5, then 8 tests)
and nobody knew: a red scheduled run only emails whoever last edited its
cron line. Each nightly job now ends with `scripts/nightly-report.mjs`,
which opens an unassigned issue in the team per failing test (titled
`Nightly: <test> [<project>]`), or one for the whole run when it left no
report or more than 15 tests failed (one cause, such as the stack not
starting), and one per fleet or mutation job that fails. As in decision
53 the state lives in the issues: a failure that persists adds nothing,
and a turn to passing or back to failing is one comment. The reporter
never closes an issue; a fix names it and linear-sync moves it, and a
test that fails again after its issue is closed opens a new one naming
the old. A run off `main` only prints what it would file. Linear rather
than a chat message, because an open issue waits for someone to act on it.
The quarantine job stays unreported: its tests already have an issue.
Reverse if: a night's issues are mostly noise (then raise the bar, or
report a weekly digest from scripts/ui-flakes.mjs instead).

Amended (2026-10-20, Carl Sauder): the `ui-web`, `web-smoke` and nightly
jobs failed for reasons outside the code, found over 144 pull request and
push runs on 2026-10-20, and the workflow changed in four ways.
(1) Concurrency: one group per ref let a push to main cancel the
scheduled run (nightly run 39360456537 was cancelled at 03:02 by push
39362023629). Pull request and push runs still cancel the run they
replace; the scheduled and manual runs have a group of their own and
neither cancel nor are cancelled. (2) Registries: `web-smoke` (run
39473313915, "toomanyrequests: Data limit exceeded") and
`nightly-quarantine` (run 39360456537, "Rate exceeded") failed pulling the
Supabase CLI's images from ECR Public, which rations anonymous pulls per IP
address, shared on a hosted runner; the job container's base image and
wrangler's egress image come from Docker Hub, which does the same. Jobs now
restore the images from `actions/cache` (docker save and load, keyed by the
CLI version and `supabase/config.toml`), save them when the cache was not an
exact hit, retry a start a registry turned away, and leave out the services
no test uses (studio, imgproxy; `SUPABASE_EXCLUDE`). Docker Hub sign-in is
used only if the secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` exist.
(3) Load: each `ui-web` shard ran the stack (about twelve containers),
wrangler dev, the job container and four browsers on 4 vCPUs, and the same
tests ran 2 to 9 times slower than on a laptop (REV-003 2.6 s locally,
14.8 s in CI); the shard with the recording, reviewing, sync and journey
files had 19 of the last 21 `ui-web` failures. `ui-web` now runs four
shards of `UI_WORKERS=2`, so wall time stays about the same with half the
browsers per runner and twice the runners (free on a public repository),
and the shards are cut by recorded duration rather than Playwright's test
count: over three runs the two count-based shards took 160 to 200 s and 250
to 315 s, and the same files dealt by `scripts/ui-shards.mjs` weigh 283 to
286 s of test time in each of four shards. Every UI job keeps `nproc`,
`free -m`, `vmstat` and the busiest processes in its results artifact, so
the next question about load has numbers. (4) Flakes: with retries off a
flake only shows over many runs, and `ui-flakes.mjs` had to be fed by hand;
the nightly job `nightly-flakes` now reads the report artifacts of the last
40 runs, and files the tests under 95% of their runs (seen in at least 5) as
one Linear issue, by the code that files the nightly failures. The weights
table must be refreshed when the suite changes a lot (`docs/testing.md`);
a stale table still shards correctly, only less evenly. Reverse if: the
load files show four shards of two browsers are still starved (then larger
runners, which cost money), or the cache costs more than the pulls it
saves.

Amended (2026-10-23, Carl Sauder): for the browser jobs the cache did cost
more than the pulls it saved. Warm, it made a pull request's run about a
minute longer than pulling (425 seconds against 352 and 374), and the CLI
now takes the images from `ghcr.io` when ECR refuses them. `web-smoke` and
`ui-web` pull, retried by `ci-retry-pull.sh`; `server` and the nightly jobs
keep the cache (decision 164 has the numbers).
