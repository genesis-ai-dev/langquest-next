# A job start that Cloudflare refuses is recorded at once and tried again, and every job has its own container instance

Date: 2026-11-19 · By: Caleb Koster · Status: accepted

Reason: on 2026-11-19 no tutorial video went up on any YouTube channel. The
job records and the Worker's log give the cause, with no assumption:

- YouTube's day of units ends after about 25 videos, so only the upload run
  that follows the intake at five past midnight in California can put videos
  up (decision 192). The 18 upload runs before it that night each ended in a
  second with `youtube_quotaExceeded`.
- That intake ran (08:05:56 UTC, 77 s, ok). No `tutorial_publish` run
  follows it in `diag.job_runs`.
- The Worker's log, 08:07:13 UTC, in the upload job's object, method `run`:
  "Maximum number of running container instances exceeded. Try again later,
  or try configuring a higher value for max_instances". At 08:07:24, in the
  intake's object: "job tutorial-intake: what follows it did not start".

Two faults met there.

- **The limit of instances was not one per job.** `max_instances` was 4,
  set when the image ran four jobs (decision 141: the pass, the import, the
  canary, the reconciliation). The tutorial publish, intake and comments jobs
  and the organization export came later and the limit stayed. Each job has
  one object and one instance, so the limit is now the number of jobs in
  `apps/web/worker/jobsModel.ts` `JOBS` (8), and
  `scripts/cloudflare-deploy.test.ts` fails when a job is added without it.
  Cloudflare bills a container for the time it runs; its pricing page names
  no charge for the limit.
- **A refused start left no record and no second try.** `JobRunner.run`
  (`apps/web/worker/jobs.ts`) wrote the run's mark, then the start threw
  before the heartbeat alarm was set. The mark stayed, no row was written,
  and the job before it only logged the error. The row came when the next
  run started, as a `stopped` run that seemed to last until then (seen once
  before: `tutorial_publish`, 2026-11-18 23:33 UTC, 1,097 s). Now the object
  takes the mark away, writes a job run at once (`start:max_instances` or
  `start:failed`, `jobsModel.ts` `refusedStart`), and its alarm tries the
  start again every five minutes, for an hour at most (`retryAt`,
  `START_RETRY_MS`, `START_TRIES`). The alarm is also set before the start,
  so a start that breaks the object still leaves a run the next beat records.

Five minutes, because the runs that hold instances at a tick are mostly over
by the next one; an hour, because a start refused for an hour is a fault a
person must see, and each refused try leaves its own row for the ops
dashboard. A whole read of the v2 import that a refused start carried stays
owed (`allDue`).

Extends decisions 141 and 192.

Reverse if: Cloudflare queues a start past the limit instead of refusing it,
or the jobs move off containers.
