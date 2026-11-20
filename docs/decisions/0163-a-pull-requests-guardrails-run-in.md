# 163. A pull request's guardrails run in about the time of its slowest test job, not of its setup

Date: 2026-10-23 · By: Carl Sauder · Status: accepted

Reason: every guardrails run on a pull request took about 6 minutes, and
three jobs each took about that long, so no single fix made a run shorter.
Carl asked for the run to be cut down (2026-10-23), from the timings of the
last 40 runs.
- **`checks` split three ways.** The unit suite was 190 to 285 seconds of the
  job's 4.5 to 6.7 minutes. It is CPU-bound: 38 seconds on a laptop's 15
  cores, 4.5 minutes of CPU. `checks` keeps typecheck, lint, the store
  builds' server calls and the push delivery bundle; `unit` runs the suite
  in three shards on three runners, each with coverage and a blob report;
  `coverage` merges the reports (`vitest --merge-reports --coverage`) and
  holds the thresholds, which a shard skips (`VITEST_COVERAGE_SHARD`,
  `vitest.config.ts`). Vitest's own `--shard` deals files by a hash of their
  path and put the memory and fleet tests in one shard (39 seconds against
  5 on a laptop); `scripts/unit-shards.ts` deals them by weight, slow files
  first, so the organization folder's memory test runs alone and sets the
  shard's length. `gate` needs all three, and a failure in any of them on
  main tells Linear that `checks` failed, as `checks` did.
- **Setup in the background.** `web-smoke` loaded its 787 MB of cached
  images in the foreground (about 75 seconds) before the stack could start,
  and both browser jobs built the web export only once the stack was up
  (40 to 60 seconds), because `e2e/env.sh` reads its settings from
  `supabase status`. The development export needs only the stack's URL and
  anon key, which are the CLI's fixed local values and are already in
  `apps/mobile/.env.development`. Now each job starts the stack in the
  background (`scripts/ci-background.sh`; it pulls its images, decision
  164), builds the export in the background beside it, and installs the
  browsers meanwhile.
  `e2e/export-web.sh` keeps that export (`WEB_EXPORTED=1`) only when the
  running stack has the same URL and key, and builds it again otherwise.
- **Two smoke workers.** The eight smoke tests ran one at a time, 3 minutes,
  the first 83 seconds while the Worker warmed up. They run two at a time
  (`e2e/web-smoke.config.ts`); each signs up its own account.
Reverse if: `unit` and `coverage` together take longer than the old
`checks` did (three runners setting up for 30 seconds each), or a merged
report covers less than one run of the whole suite does; the early export
is built again often (the CLI's local keys changed, so update
`.env.development`); or the smoke tests fail two at a time and not alone.
