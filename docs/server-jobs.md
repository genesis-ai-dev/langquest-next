# Plan: the server's jobs, and where the heavy ones run

Status: steps one to three and the report inputs built (decisions 141, 142); F waits for the big-languages plan · Carl Sauder, with Claude · 2026-10-16, 2026-10-19

Companion to `docs/big-languages-plan.md`, the phone side, whose option F
(the server folds a language whole and cuts the snapshot by passage) is
assumed here. Section 6 is what the two plans settle for each other.

## 1. The jobs

Before this plan (2026-10-16):

| Job | Host | Memory | Cadence | Trigger |
| --- | --- | --- | --- | --- |
| Projection pass, small languages (Inbox rows, listing, snapshots) | Edge Function `stream-projections` | 256 MB, 2 s CPU | 5 min | pg_cron → pg_net |
| Projection pass, large languages | GitHub Actions `projections.yml` (decision 103) | 6 GB heap | 10 min | GitHub schedule |
| v2 import | GitHub Actions `v2-import.yml` | runner's heap | 15 min, nightly whole | GitHub schedule |
| Push delivery | Edge Function | 256 MB | 1 min | pg_cron |
| Reports and the agent API | Durable Object `OrgSnapshot`, folding every language | 128 MB isolate (decision 132) | on request | HTTP |
| Verse timings, grant cleanup, webhook catch-up | the Worker's cron | 128 MB | 10 min | the Worker's cron |
| Inbox purge | pg_cron | in Postgres | daily | pg_cron |

Now, on a hosted project (decisions 141, 142):

| Job | Host | Memory | Cadence | Trigger |
| --- | --- | --- | --- | --- |
| Projection pass, every language (Inbox rows, listing, snapshots, report inputs) | job container `JobRunner` projection | 4 GiB | 5 min | the Worker's job tick |
| v2 import | job container `JobRunner` v2-import | 4 GiB | 15 min, whole at 03:15 UTC | the Worker's job tick |
| Fold canary: three languages folded afresh, compared with their snapshot and passage lines (`server/foldCanary.ts`) | job container `JobRunner` fold-canary | 4 GiB | daily, 04:05 UTC | the Worker's job tick |
| R2 reconciliation without hashing, missing and orphaned files counted (`server/reconcileJob.ts`) | job container `JobRunner` blob-reconcile | 4 GiB | daily, 04:35 UTC | the Worker's job tick |
| Tutorial videos chosen on the ops dashboard, put up on YouTube (`server/tutorialPublish.ts`, decision 180) | job container `JobRunner` tutorial-publish | 4 GiB | on Publish, and daily at 23:40 UTC | the dashboard's Publish; the Worker's job tick |
| Tutorial films the nightly filming on GitHub made, brought into R2 and listed for Publish (`server/tutorialIntake.ts`, decision 183) | job container `JobRunner` tutorial-intake | 4 GiB | daily, 23:10 UTC | the Worker's job tick |
| Comments on the tutorial videos, kept for Claude's nightly look; accepted code changes filed in Linear (`server/tutorialComments.ts`, decision 186) | job container `JobRunner` tutorial-comments | 4 GiB | daily, 23:50 UTC | the Worker's job tick |
| Push delivery | Edge Function `push-delivery` | 256 MB | 1 min | pg_cron |
| Reports | Durable Object `OrgSnapshot`, rendering stored report inputs | 128 MB isolate | on request | HTTP |
| The agent API, MCP, review links, webhooks | Durable Object `OrgSnapshot`, reading each passage's records from the server's cut, never a whole language (decision 147) | 128 MB isolate | on request | HTTP |
| Verse timings, grant cleanup, webhook catch-up | the Worker's cron | 128 MB | 10 min | the Worker's cron |
| Inbox purge | pg_cron | in Postgres | daily | pg_cron |

A local stack runs the same jobs on the same hosts (decision 148), with
one difference: `wrangler dev` fires no cron, so `npm run web:dev` fires the
job tick itself every minute (`scripts/job-tick.mjs`), and the pass runs in
the container in Docker while the Worker runs (`docs/cloudflare.md`). The
Edge Function was named `stream-projections` until it lost the pass.

The same wall shows up three times. A language folds into one state
object, a parsed object costs several times its text, and a Bible-size
one fits neither the function nor the isolate. Only a host with gigabytes
folds it, and under option F that host folds it every pass, for good.

| Language | Events | State as JSON | Heap to fold |
| --- | --- | --- | --- |
| Santhali omt bible | 225,000 | 61 MB | about 850 MB in Node (decision 103) |
| bench, 100k events | 100,000 | | 276 MB (performance-audit.md) |
| Koro Miyan | | 40 MB snapshot | passed the Edge Function only sometimes |

## 2. Why not GitHub Actions

Carl's call (2026-10-16): no production job runs in GitHub. The reasons
that bite here:

- Scheduled runs are delayed under load, and GitHub says queued jobs can
  be dropped. The 30 minutes of slack `diag.job_schedule` gave the large
  pass was the project pricing that in.
- A public repository's scheduled workflows are switched off silently
  after 60 days without a push. A quiet month on `main` would stop
  snapshots and Inbox rows for every large language.
- The production service-role key sat in a public repository's secrets,
  with the whole dependency tree installed beside it and only
  `--ignore-scripts` in between. Everywhere else the key lives on the
  Worker or in Vault, applied by one person (decision 51).
- A job is capped at 6 hours; the import's nightly whole read asks for
  340 minutes.
- It is a CI system: a fresh checkout and install each run, public logs,
  no choice of memory, `concurrency` as the only lock.

## 3. Options weighed

Against the driving characteristics in `.agents/skills/architecture-tradeoffs`:
support cost, data integrity, evolvability, elasticity per tenant, cost.

| Option | Helps | Hurts | Verdict |
| --- | --- | --- | --- |
| Keep GitHub | nothing to build | every point above; 103 called it temporary | no |
| **Cloudflare Containers behind the app's Worker** | same account, same `wrangler.jsonc`, Workers Builds builds the image with the Worker, same `npm run secrets`, same `diag.job_runs`; up to 12 GiB; billed only while running | GA since 2026-04-13 (Workers Paid plan); a deploy is not atomic (the Worker is live before the image rolls out); local runs need Docker; a run longer than its activity timeout is stopped | chosen |
| Google Cloud Run Jobs | the biggest ceiling (32 GiB, timeouts in days), mature | a third provider: account, IAM, Terraform, a deploy path, a second secrets flow | the fallback |
| A VPS or Fly machine | cheapest, simplest mental model | a pet to patch and watch, one box, not infrastructure-as-code without more tooling | no |
| Make folds fit 256 MB (fold per unit on the server) | would let the Edge Function keep the pass | the big-languages plan chose folding whole and cutting (its 4.3), and the import, whole-log refolds and reducer bumps still need a host | no |
| Cloudflare Workflows or Queues | orchestration | steps still run in 128 MB; `projection_marks` against `stream_cursors` is already the work queue | not needed |
| Fold inside Postgres | no new host | a second reducer to keep in parity with core | no |

## 4. The shape

- **One image**, `apps/web/jobs/Dockerfile`: Node 24 and one bundle per
  job (`projections.mjs`, `v2.mjs`, `canary.mjs`, `reconcile.mjs`, `publish.mjs`, `intake.mjs`), built by `scripts/build-jobs.mjs`
  before every deploy and before `wrangler dev`. No npm package is
  installed: the dependency tree is never beside the service key. Its
  system packages are psql, which the import reads people's names with,
  and ffmpeg, which converts v2's MP3 and WebM files to M4A (decisions.md
  94, amended 2026-10-24).
- **One Durable Object per job**, `JobRunner` in `apps/web/worker/jobs.ts`,
  named by the job, driving the container through the object's own
  container API (`ctx.container`: `start`, `monitor`, `signal`), not the
  `@cloudflare/containers` class, which starts containers for requests and
  starts a short batch job twice. The object is the lock: a tick that finds
  a run under way starts nothing. What a job is, when it is due and what
  its container is handed are pure functions in `jobsModel.ts`. The
  process writes its own `diag.job_runs` row; the object writes one only
  when the process died without the chance (killed, out of memory, stopped
  at the time limit), so a dead run is never silent. An object is held
  only about a minute after a call, and a container's keep-alive belongs
  to one live instance of it, so while a run lasts an alarm brings the
  object back every minute (`heartbeat`): it renews the keep-alive, stops
  a run past its limit, and records one that ended; it watches a run once
  per instance and records one end at a time. The processes drain on
  SIGTERM (the language or project in hand) and record their own row, and
  the pass logs its progress every 25 languages to the container's logs.
  A deploy's rollout leaves a run alone for its first 90 minutes
  (`rollout_active_grace_period`), so the nightly whole read is not cut
  off by evening merges; one stopped all the same resumes.
- **The job tick is the trigger**, a second Worker cron, every five
  minutes: the pass each time, the import every 15 minutes, and the
  import's whole read at 03:15 UTC, owed until a run starts with it, the
  fold canary at 04:05 UTC and the R2 reconciliation at 04:35 UTC. The
  tick never waits for a run, and leaves a `job_starts` run of what it
  started, found running, found switched off or could not start. The
  container's inactivity timeout and an alarm are each job's time limit
  (45 minutes for the pass, 340 for the import, 60 for the canary, 120 for
  the reconciliation, all under the platform's six hours): the alarm sends SIGTERM to a run still going.
- **What a container gets**: the Worker's `SUPABASE_URL` and service key,
  and for the import and the reconciliation the Worker's own address (`API_URL`, where files go),
  v2's key (a Worker secret from `npm run secrets`), v2's read-only login
  when it is there (for people's names; GitHub never had it, so without
  it people come over by id) and its concurrency. The import runs only
  while the Worker's `V2_IMPORT_ENABLED` is "true" and refuses to start
  without v2's key.
- **Instance type** `standard-1` (4 GiB) for all four, one instance each
  (`max_instances` 4: pass, import, canary, reconciliation), with Node's heap at 3 GiB. Under F (decision 147)
  the pass holds the fold and then builds the rows, a batch at a time, and
  the lines from it: on a Santhali-size synthetic fixture the peak went from
  318 MB of heap (533 MB resident) to 353 MB (679 MB)
  (`scripts/bench/cutPeak.ts`), so `standard-1` stands; move to
  `standard-2` (6 GiB) if a real language's peak passes 3 GiB. Every pass records its
  peak resident memory, the heap's limit and the language that raised the
  peak in its job run, so production gives the numbers before F does.
- **Report inputs** (decision 142): each time the pass folds a language it
  stores what the language's report is made from (core `reportInputs`) in
  `language_report_inputs`, and the Durable Object renders the report for
  the day from it (`renderLanguageReport`), folding only a language with
  no stored inputs, or on a catch-up ("Catch up with the server") one
  whose inputs are behind its stream and that has at most 25,000 events.
  They hold no date window and nothing from the organization stream, so a
  report never goes stale at midnight and an admin's saved name, country
  or target shows at once.
- **Placement.** Unpinned, a container starts near where the cron fires
  (Mumbai, on the first night), so `constraints.regions` pins both to
  ENAM, beside the database and R2.
- **Cost**, rough, at list prices beside the Workers Paid plan ($5 a
  month): the pass, a minute or two every five on 4 GiB, about $10 a
  month; the import's nightly whole read, up to five hours on 4 GiB, about
  $15 at the high end. The import's uploads to the Worker are container
  egress: free up to 1 TB a month, then $0.025 a GB.

## 5. Steps, in order with the big-languages plan

| Order | Piece | Status |
| --- | --- | --- |
| 1 | Step one: the large pass into the container, `projections.yml` gone | built (141) |
| 2 | Step two: one pass for every language in the container, every 5 minutes; pg_cron keeps push delivery only | built (141, amended 2026-10-19), without the couple of weeks of step one proven alone, at Carl's word |
| 3 | Report inputs: the pass stores each language's, the object renders reports from them | built (142) |
| 4 | Step three: the v2 import into the container, `v2-import.yml` gone | built (141, 94 amended); its cutover follows the order below |
| in parallel | E: rebase PR 120 and meet the big-languages plan's 4.1 conditions | merged (PR 177, decision 143) |
| last | F: the server cut, `LINES_VERSION`, `snapshots.state` off, the object reads the cut and a passage's rows | merged (PR 185); its first pass refolded and cut 369 languages in 9.5 minutes, peak 882 MB |

**The cutover**, in this order:

1. Optional, for people's names (GitHub's runs never had them):
   `scripts/v2-access.sh`, which keeps v2's read-only login in
   `.env.production` as `V2_DATABASE_URL`.
2. Merge. The Supabase integration applies the migrations (the projection
   job leaves pg_cron), and Workers Builds deploys the Worker and the
   image. The job tick starts the pass within five minutes, with the
   service key the Worker already has. GitHub's import workflow is gone,
   and the container's import refuses to start until v2's key is on the
   Worker (`job_starts` counts it as failed).
3. Right after, from the updated `main`: `npm run secrets -- production`.
   It puts `V2_SUPABASE_ANON_KEY` (already in `.env.production`) and
   `V2_DATABASE_URL` when present on the app's Worker, and runs the new
   schedule again. The next 15-minute tick starts the import.
4. `npm run diag -- jobs` shows `projection`, `v2_import` and
   `job_starts` running.
5. Afterwards, delete the GitHub secrets `V3_SERVICE_ROLE_KEY` and
   `V2_SUPABASE_ANON_KEY` and the variables `V2_IMPORT_ENABLED` and
   `V2_IMPORT_CONCURRENCY`: nothing reads them.

Not before the merge: run from the branch, the script would apply the new
schedule to production at once and take the pass off pg_cron while the
container that replaces it is not yet deployed, leaving small languages
with no pass until the merge; run from `main`, it would not know v2's key
belongs on the Worker. After the merge the only gap is the import's, from
the merge until the secrets are set plus up to one tick. The import says
what v2 says now (decision 94), so the next pass picks up whatever changed
in the gap. A GitHub import run still going at the merge may overlap
the container's first: both name each event the same way
(`v2:<project>:<fact>#<n>`, docs/v2-import.md) and the server takes an id
once (decision 75), so the overlap repeats work and appends nothing twice.

## 6. The seam with the big-languages plan

What that plan takes from this one (its section 2):

1. A 4 GiB job host folds whole languages: the one-time refold, refolds at
   reducer bumps and refolds from zero after a redaction fold whole and
   then cut. No streaming fold with spilled state.
2. The pass is the one producer of per-language aggregates, versioned by
   `REPORT_VERSION`: the report inputs (decision 142). No server consumer
   folds a whole language for a report; the agent view still does until F
   gives it a passage's rows.
3. Decision 3 stands: a phone folds the units it opens from its own log.

What this plan takes from that one, under F:

- The pass is the unit of work. The container runs one entry point and
  holds no per-language assumption (`isLarge` and the 10 MB threshold are
  gone with the local Edge pass, decision 148), and the cut lands inside
  `runProjections`.
- Fold plus cut sizes the instance (section 4).
- A snapshot write under F carries the state, the pieces and the unit
  rows until `snapshots.state` stops being written: tens of megabytes
  through one RPC with a 2-minute statement timeout. The container can
  hold a direct database connection for batched writes, which the Edge
  Function never used. That is F's lever and one more Worker secret.
- The agent view reads a passage's rows from the cut, so the object never
  folds a language for it. (Under E alone the object would have to cut a
  snapshot into its own SQLite, the way E's phone does.)

## 7. Fitness functions

| Holds | Where | Status |
| --- | --- | --- |
| No workflow holds a production key; the scheduled ones are the test runs | `scripts/workflows.test.ts` | in place |
| The job container, its object, the job tick and the import's switch are declared for production and preview, one instance per job | `scripts/cloudflare-deploy.test.ts` | in place |
| The image installs no npm package; psql and ffmpeg are its system packages | `scripts/cloudflare-deploy.test.ts` | in place |
| Which jobs a tick starts, what each container gets, and that a process killed, out of memory or stopped at the time limit leaves a job run | `apps/web/test/jobs.test.ts` | in place |
| The object, made again mid-run, drained, killed or past its limit, writes one row only when the process could not, and keeps a cut-off whole read owed | `apps/web/test/jobRunner.test.ts` | in place |
| A rollout leaves a run alone longer than the whole read takes | `scripts/cloudflare-deploy.test.ts` | in place |
| A whole read stopped within a day resumes; a missing file is asked for every pass only in its first hour | `packages/v2-import/test/resume.test.ts` | in place |
| Hosted projects schedule only push delivery on pg_cron | `server/cronSmoke.sql`, `scripts/secrets.test.ts` | in place |
| Stored report inputs, rendered on any later day, equal the report folded that day | `packages/core/test/reports.test.ts` | in place |
| A tail the pass skips cannot change the report inputs | `packages/core/test/quiet.test.ts` | in place |
| The object renders stored inputs without folding, and folds a language without them | `apps/web/test/worker.test.ts` | in place |
| A job is stale when its last success is older than two ticks plus slack | `diag.jobs()` (`npm run diag -- jobs`) | in place |
| Peak memory of every pass against the heap's limit, and the language that set it | the `projection` job run (`maxPeakRssMb`, `maxHeapLimitMb`, its language), `npm run diag -- jobs` | in place; F's fold plus cut shows in it |

## 8. Reverse if

A run longer than its time limit is needed and cannot be split, a
container is evicted mid-run often enough to matter, or a fold needs more
than 12 GiB. Then the same image goes to Cloud Run Jobs, the object
keeping the trigger and the lock.

## 9. Decision log

- Decision 141 records the job container, supersedes 103, and is amended
  on 2026-10-19 for step two and the import; 68 and 94 are amended with it.
- Decision 142 records the report inputs, and amends 44.
- F's entry is the big-languages plan's (its section 6).
