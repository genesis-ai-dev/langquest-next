# 141. Server jobs too big for an Edge Function run in a container behind the dashboard Worker, started by its cron, and no production job runs in GitHub Actions

Date: 2026-10-19 · By: Carl Sauder · Status: accepted

Reason: decision 103 put the projection pass for large languages in a
scheduled GitHub Actions workflow as a temporary measure, and the v2 import
runs there too. Carl ruled (2026-10-16) that no production job belongs in
GitHub: a scheduled run is delayed under load and can be dropped; a public
repository's schedules are switched off after 60 days without a push; the
production service-role key sat in the repository's secrets beside a freshly
installed dependency tree; a job is capped at six hours; and it is a CI
system, with public logs and `concurrency` as its only lock. The host chosen
is Cloudflare Containers behind the dashboard Worker (`docs/server-jobs.md`
weighs it against Cloud Run Jobs, a VPS, fitting the fold into 256 MB,
Workflows and folding in Postgres): the same account and `wrangler.jsonc`,
Workers Builds builds the image with the Worker, `npm run secrets` and
`diag.job_runs` are unchanged, and a container is billed only while it
runs. This entry is step one of that plan, the pass for large languages:
- `apps/web/jobs/Dockerfile` is the image: Node 24 and one bundle per job
  (`scripts/build-jobs.mjs`, run by the Worker's build and by `npm run
  web:dev`), nothing installed, so the dependency tree never sits beside
  the key. The object names a job's bundle as the entrypoint, so a later
  job is one more bundle.
- `JobRunner` (`apps/web/worker/jobs.ts`) is one Durable Object per job,
  named by the job, and the lock: the Worker's cron starts it every ten
  minutes, a tick that finds the run under way starts nothing, and the
  tick never waits for the run. It drives the container through the
  object's own container API rather than the `@cloudflare/containers`
  class, which starts containers for requests and ran a sub-second pass
  twice while reporting a failed start. The container gets `SUPABASE_URL`
  and the service key from the Worker's own env. The process writes its
  own job run as before; the object writes one when the process died
  without the chance (`killed:137`, `exit:143` at the 45-minute limit,
  `stopped` without a code), so a dead run is never silent. A pending
  monitor keeps the object in memory for up to 15 minutes, so a longer
  run's exit can go unobserved; its own job run is then the record.
- `standard-1` (4 GiB) with Node's heap at 3 GiB, for Santhali's 850 MB
  fold. Under the big-languages plan's option F the pass will also cut the
  fold into rows, so the peak is measured before F lands and the instance
  type follows it.
- `.github/workflows/projections.yml` is gone, and
  `scripts/workflows.test.ts` holds the allowlist of scheduled workflows to
  `v2-import.yml`, which the import's move empties.
Not changed yet, in order (`docs/server-jobs.md` section 5): one pass for
every language in the container with the Edge Function keeping push
delivery only; the pass as the one producer of per-language aggregates the
Durable Object reads; the v2 import. Supersedes 103.
Reverse if: a run longer than its time limit is needed and cannot be split,
a container is evicted mid-run often enough to matter, or a fold needs more
than 12 GiB; then the same image goes to Cloud Run Jobs, the object keeping
the trigger and the lock. Or if Workers Builds cannot build the image; then
the deploy command builds and pushes it from a laptop, as the Workers are
deployed off Workers Builds today.

Amended (2026-10-19, Carl Sauder): steps two and three are built, in
`docs/server-jobs.md`'s order, without waiting the couple of weeks it gave
step one, at Carl's word. The job tick (`*/5 * * * *`, `jobsModel.ts`
`jobsDue`) starts one pass for every language each time and the v2 import
every 15 minutes, with its whole read at 03:15 UTC; the ten-minute cron
keeps timings, grants and webhooks. Each job has its own object, time limit
(45 minutes for the pass, 340 for the import) and container instance
(`max_instances` 2); the tick leaves a `job_starts` run and each job its
own (`projection`, `v2_import`; `projection_large` is retired). Hosted
projects schedule only push delivery on pg_cron, and the Edge Function
refuses the pass there (410); a local stack keeps the Edge pass every
minute (68). The import's job needs `V2_SUPABASE_ANON_KEY` on the
dashboard Worker, and uses `V2_DATABASE_URL` for people's names when it is
there; `npm run secrets` now puts both there from `.env.production` (94).
psql is the image's one system package, for those names.
`v2-import.yml` is gone, and `scripts/workflows.test.ts` holds that no
workflow holds a production key. The cutover has an order: run
`npm run secrets -- production` from `main` right after the merge, not
before: run from the branch earlier, it would take the pass off pg_cron
before the container is deployed. The import pauses from the merge until
then; `docs/server-jobs.md` section 5 has the steps.

Amended (2026-10-19, Carl Sauder): the first hour in production showed the
job runner's watch does not hold. The tick's call to an object ended after
73 seconds, so nothing was left to record how a run ended; a restarted
object held no keep-alive for its running container (Cloudflare's docs say
to set it again in the constructor), so runs were stopped minutes in, and
neither the pass nor the import wrote a row for an hour. Unpinned, the
containers also started near the cron, in Mumbai, far from the database.
Now: while a run lasts, an alarm brings the object back every minute
(`jobsModel.ts` `heartbeat`, `HEARTBEAT_MS`): it renews the keep-alive for
the time the run has left, sends SIGTERM at the limit, and records a run
that has ended by asking the stopped container how; the constructor renews
the keep-alive too. The pass and the import record their own row when sent
SIGTERM (`sigterm`, exit 0, the code that says the row is written), the
pass logs its progress every 25 languages, and `constraints.regions` pins
the containers to ENAM, beside the database and R2.

Amended (2026-10-19, Carl Sauder): SIGTERM now drains instead of stopping
at once. Every deploy rolls the containers out: SIGTERM, then SIGKILL up to
15 minutes later. A merge's deploy at 03:02 UTC on 2026-10-20 cut off the
whole v2 read begun two minutes earlier, and the object had cleared its
flag at the start, so the read waited a night. Now the pass finishes the
language in hand and the import the project in hand (`PassDeps.stop`, the
`stop` argument of `runProjections`), the rest wait for the next run, and
the import's cursor does not move. The row says `partial` (`error` when
nothing was done) with `sigterm`, and the process exits 75
(`jobsModel.ts` `STOPPED_EARLY`), under 128, so the object writes no row
of its own. A whole read that ends 75, 128 or over, or without a code is
owed again (`stillOwesWholeRead`): the next tick reads everything. The
pass's memory fields are named `maxPeakRssMb`, `maxStartRssMb`,
`maxHeapUsedMb` and `maxHeapLimitMb`, because `diag.totals` keeps the
largest of a `max…` field and sums every other one.

Amended (2026-10-20, Carl Sauder): the object never saw an exit code.
`ctx.container.monitor()` rejects with a plain Error that carries the code
only in its message (`Container exited with unexpected exit code: 75`, or
`Runtime signalled the container to exit: 9`), and `exitCodeOf` read a
property that was not there, so every non-zero exit read as a stop without
a code and the object wrote a false `error` / `stopped` row 0.6 s after the
process's own `partial` / `sigterm` row (six pairs in production on
2026-10-20, from 03:00 to 04:49 UTC, one per deploy rollout; a real OOM
kill would also have shown only as `stopped`, never `killed:137`).
`exitCodeOf` now parses both messages as `@cloudflare/containers` does. The
library passes the number of a signalled stop on as the exit code and does
not say whether it is a signal number or 128 plus one, so a number under
128 there is read as a signal and becomes 128 plus it (9 is 137, 15 is
143); either reading lands at 128 or more, which the object records
(`killed:137`, `exit:143`) and which keeps a whole read owed. An
`exitCode` property, which newer workerd sets, is still read first.

Amended (2026-10-20, Carl Sauder): deploys stop cutting off the nightly
whole v2 read, and a kill gets one row. The whole read took 40 to 70
minutes on GitHub and has never finished in the container: 03:15 UTC is
the team's evening, when merges deploy (five deploys from 03:02 to 04:47
on 2026-10-20), and every rollout stopped it and it began again. The job
container now sets `rollout_active_grace_period` to 5400 seconds: a
rollout leaves a run alone for its first 90 minutes, then sends SIGTERM
and allows 15 more (Cloudflare's rollout docs, which give no maximum),
held by `scripts/cloudflare-deploy.test.ts`. A whole read stopped all the
same resumes where it was (94). The object, tested for the first time
against fakes of the platform's events (`apps/web/test/jobRunner.test.ts`:
made again mid-run, a drain, a kill, the time limit, an end nobody
watched), added a watcher at every minute's beat, so a killed run would
have had a row from each; it now watches once per instance and records
one end at a time, and the second finds the run recorded. The whole read
stays at 03:15 UTC.

Amended (2026-10-20, Carl Sauder): a local stack runs the pass in the
container as well, and the Edge Function, renamed `push-delivery`, keeps
push delivery alone (148).

Amended (2026-10-24, Caleb Koster): ffmpeg joins psql as the image's system
packages, for the v2 import's conversion of MP3 and WebM to M4A (94). Built
locally, the image grows from about 320 MB to 710 MB; with half a CPU it
converts a 20-minute chapter in about 27 seconds.

Amended (2026-10-28, Caleb Koster): the tutorial videos are filmed each
night in GitHub Actions (`.github/workflows/tutorials.yml`, 183), a
scheduled workflow, which this entry keeps from production jobs. It is not
one: it holds the Gemini key and the repository's own token, no production
key, and writes only to the repository's public `tutorials` release, from
which the job container's `tutorial-intake` takes the films into R2.
Filming needs the local stack and a browser, which a runner has and the
job container does not, and a late or dropped run only leaves the videos as
they were a day longer. `scripts/workflows.test.ts` lists it among the
scheduled workflows.
