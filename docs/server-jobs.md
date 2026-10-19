# Plan: the server's jobs, and where the heavy ones run

Status: step one built (decision 140); the rest proposed · Carl Sauder, with Claude · 2026-10-16

Companion to `docs/big-languages-plan.md`, the phone side, whose option F
(the server folds a language whole and cuts the snapshot by passage) is
assumed here. Section 6 is what the two plans settle for each other.

## 1. The jobs today

| Job | Host | Memory | Cadence | Trigger |
| --- | --- | --- | --- | --- |
| Projection pass, small languages (Inbox rows, listing, snapshots) | Edge Function `stream-projections` | 256 MB, 2 s CPU | 5 min | pg_cron → pg_net |
| Projection pass, large languages | the job container behind the dashboard Worker (was `.github/workflows/projections.yml`, decision 103) | 4 GiB | 10 min | the Worker's cron |
| v2 import | GitHub Actions `v2-import.yml` | 6 GB heap | 15 min, nightly whole | GitHub schedule |
| Push delivery | Edge Function | 256 MB | 1 min | pg_cron |
| Reports and the agent API | Durable Object `OrgSnapshot` | 128 MB isolate (decision 132) | on request | HTTP |
| Verse timings, grant cleanup, webhook catch-up | the Worker's cron | 128 MB | 10 min | the Worker's cron |
| Inbox purge | pg_cron | in Postgres | daily | pg_cron |

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
| **Cloudflare Containers behind the dashboard Worker** | same account, same `wrangler.jsonc`, Workers Builds builds the image with the Worker, same `npm run secrets`, same `diag.job_runs`; up to 12 GiB; billed only while running | GA since 2026-04-13 (Workers Paid plan); a deploy is not atomic (the Worker is live before the image rolls out); local runs need Docker; a run longer than its activity timeout is stopped | chosen |
| Google Cloud Run Jobs | the biggest ceiling (32 GiB, timeouts in days), mature | a third provider: account, IAM, Terraform, a deploy path, a second secrets flow | the fallback |
| A VPS or Fly machine | cheapest, simplest mental model | a pet to patch and watch, one box, not infrastructure-as-code without more tooling | no |
| Make folds fit 256 MB (fold per unit on the server) | would let the Edge Function keep the pass | the big-languages plan chose folding whole and cutting (its 4.3), and the import, whole-log refolds and reducer bumps still need a host | no |
| Cloudflare Workflows or Queues | orchestration | steps still run in 128 MB; `projection_marks` against `stream_cursors` is already the work queue | not needed |
| Fold inside Postgres | no new host | a second reducer to keep in parity with core | no |

## 4. The shape

- **One image**, `apps/web/jobs/Dockerfile`: Node 24 and one bundle per
  job, built by `scripts/build-jobs.mjs` before every deploy and before
  `wrangler dev`. The image installs nothing: the dependency tree is never
  beside the service key. Each job is a bundle the object names as the
  container's entrypoint, so the import is one more bundle later.
- **One Durable Object per job**, `JobRunner` in `apps/web/worker/jobs.ts`,
  named by the job, driving the container through the object's own
  container API (`ctx.container`: `start`, `monitor`, `signal`), not the
  `@cloudflare/containers` class, which starts containers for requests and
  starts a short batch job twice. The object is the lock: a tick that finds
  a run under way starts nothing. It hands the container the Worker's
  `SUPABASE_URL` and service key as environment, nothing new to set. The
  process writes its own `diag.job_runs` row, as it did on GitHub; the
  object writes one only when the process died without the chance (killed,
  out of memory, stopped at the time limit), so a dead run is never silent.
  A pending `monitor` keeps the object in memory for up to 15 minutes, so
  a longer run's exit can go unobserved; its own job run is then the record.
- **The Worker's cron is the trigger.** It already fires every ten
  minutes; the tick starts the job and does not wait for it. The
  container's inactivity timeout and an alarm, both `JOB_TIME_LIMIT_MS`
  (45 minutes), are the pass's time limit, as the workflow's 30 minutes
  were: the alarm sends SIGTERM to a run still going.
- **Instance type** `standard-1` (4 GiB) for now, with Node's heap at
  3 GiB. Under F the pass holds the fold and then builds the rows and
  lines from it, so measure the peak of fold plus cut on a Santhali-size
  fixture before F lands, and move to `standard-2` (6 GiB) if the peak
  passes 3 GiB.
- **Placement.** A container starts near where the cron fires, not near
  the database. The pass reads in pages of a thousand events, so the
  distance costs seconds per large language, not minutes.
- **Cost**, rough, at list prices beside the Workers Paid plan ($5 a
  month): the pass, two minutes every ten on 4 GiB, about $7 a month; the
  import's nightly whole read, five hours on 6 GiB, about $20 at the high
  end.

## 5. Steps, in order with the big-languages plan

| Order | Piece | Waits for |
| --- | --- | --- |
| now, in parallel | **Step one: the large pass into the container, `projections.yml` gone** (decision 140, this branch) | nothing |
| now, in parallel | E: rebase PR 120 and meet the big-languages plan's 4.1 conditions | nothing |
| next | Step two: one pass for every language in the container, every 5 minutes; the Edge Function keeps push delivery only | step one proven for a couple of weeks |
| next | Aggregates: the pass writes each language's progress, people and report inputs, versioned by `REPORT_VERSION`; the object reads them for reports and stops folding for them | step one |
| any time after step one | Step three: the v2 import into the container, the last job out of GitHub: `psql` in the image, v2's two secrets onto the Worker through `scripts/secrets.mjs`, one nightly whole run proven before the workflow is disabled | step one |
| last | F: the server cut, `LINES_VERSION`, `snapshots.state` off, the object reads the cut and a passage's rows | E merged, step two, aggregates |

E merging first puts the cut functions on `main`, so the fold-plus-cut
measurement runs on the job host with real code during step two.
Aggregates landing before F means F's change to the Durable Object is only
the cut.

## 6. The seam with the big-languages plan

What that plan takes from this one (its section 2):

1. A 4 GiB job host folds whole languages: the one-time refold, refolds at
   reducer bumps and refolds from zero after a redaction fold whole and
   then cut. No streaming fold with spilled state.
2. The pass is the one producer of per-language aggregates, versioned by
   `REPORT_VERSION`. No server consumer, the Durable Object included,
   folds a whole language once they exist.
3. Decision 3 stands: a phone folds the units it opens from its own log.

What this plan takes from that one, under F:

- The pass is the unit of work. The container runs one entry point and
  holds no per-language assumption; `isLarge` and the 10 MB threshold go
  with step two, and the cut lands inside `runProjections`.
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
| No production job is scheduled in GitHub Actions (the allowlist shrinks to nothing with step three) | `scripts/workflows.test.ts` | step one |
| The job container, its object and its migration are declared the same way for production and preview, one instance | `scripts/cloudflare-deploy.test.ts` | step one |
| The image installs nothing | `scripts/cloudflare-deploy.test.ts` | step one |
| A process killed, out of memory or stopped at the time limit leaves a job run | `apps/web/test/jobs.test.ts` | step one |
| The job is stale when its last success is older than two ticks plus slack | `diag.jobs()` (`npm run diag -- jobs`) | in place |
| Peak heap of fold plus cut on the biggest language, against the instance's memory | a measurement recorded in `performance-audit.md`, repeated per release | with F |

## 8. Reverse if

A run longer than its time limit is needed and cannot be split, a
container is evicted mid-run often enough to matter, or a fold needs more
than 12 GiB. Then the same image goes to Cloud Run Jobs, the object
keeping the trigger and the lock.

## 9. Decision log

- Decision 140 records step one and supersedes 103.
- Step two amends 140 (one pass, one host) and 68 (the pass's cadence
  and host).
- Aggregates get an entry of their own: the pass as the one producer of
  per-language aggregates, amending 44 (the object reads them).
- Step three amends 94 (where the import runs).
- F's entry is the big-languages plan's (its section 6).
