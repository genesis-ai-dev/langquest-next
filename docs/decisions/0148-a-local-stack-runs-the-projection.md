# 148. A local stack runs the projection pass in the job container too, and the Edge Function is push-delivery

Date: 2026-10-20 · By: Carl Sauder · Status: accepted

Reason: after 141 the Edge Function `stream-projections` only delivered
pushes on a hosted project and refused the pass there (410). Only a local
stack still ran the pass through it, every minute (68's amendment of
2026-10-19), on a path production no longer took: small languages only
(`isLarge`, a 10 MB snapshot or 25,000 events past it), stopping at the
first failing language, inside an Edge runtime's memory. So local runs and
the web UI tests checked a pass production did not run, and the function's
name said it projected. Carl chose (2026-10-20) to run the pass locally as
production does:
- `npm run web:dev` and `e2e/ui-web.sh` (the UI suite's Worker, and so CI's
  ui-web job) build the job bundles and start `wrangler dev` with the job
  container under `scripts/job-tick.mjs`, which fires the job tick at
  `/__scheduled` every minute while the Worker runs. Every minute, not the
  Worker's five, so one phone's ask reaches the other soon and the UI tests
  find Inbox rows and listings (68). JobRunner stays the lock. The UI suite's
  Worker runs from the local config copy (`scripts/web-dev-vars.ts`), which
  sends `/__scheduled` to the Worker and points the container at the
  database through `host.docker.internal`; workerd maps that name to the
  host on Linux too.
- `scripts/local-db.mjs` schedules no pass; the schedule migration
  unschedules the one an older checkout left.
- The function is `push-delivery`, built from `server/pushDeliveryEdge.ts`
  and `server/pushDelivery.ts` alone, so its bundle carries no core or fold.
  `isLarge`, `LARGE`, `ProjectionScope` and `ProjectionFailed` are gone; the
  pass always goes on past a failing language. Migration
  `20261020160000_push_delivery_function.sql` reschedules
  `langquest-push-delivery` to `/functions/v1/push-delivery`
  (`scripts/secrets.mjs` `SCHEDULE_MIGRATION`, `CRON_JOB`), and
  `npm run secrets` checks the job calls it. The secret and Vault names
  (`PROJECTION_WORKER_SECRET`, `langquest_projection_worker_secret`) stay,
  so no secret is reset.
Cost: the local pass needs the Worker and Docker running. A database
started alone (`npm run db:start` without `web:dev`) gets push delivery but
no Inbox rows from work, listings or server snapshots; `dev:local` starts
both. The first `web:dev` builds the job image, and CI's ui-web job builds
it on each runner. A `web:dev` left running projects under `npm run
db:test`'s smokes, which count snapshots and Inbox rows, so stop it first.
Cutover: Supabase's GitHub integration applies migrations before it deploys
functions, so for about a minute after the merge the push job calls a
function that does not exist yet, and the rows wait for the next minute.
The integration never deletes a function: `stream-projections` is deleted
by hand once `push-delivery` answers.
Reverse if: the container cannot run on CI's runners reliably, or building
the image makes `web:dev` too slow for daily work; then a local stack goes
back to running `server/projections.ts` (still the container's entry
point) from a Node process the tick starts, not to an Edge pass.

Amended (2026-10-20, Carl Sauder): the secret is named for push delivery
after all, since nothing else reads it: `PUSH_DELIVERY_SECRET` in
`.env.<env>` and as the function's secret, `langquest_push_delivery_secret`
in Vault. Carl chose to rename rather than keep a name that points at the
pass. Its value is new (`npm run env:update`), so no decrypted value was
copied. Migration `20261020170000_push_delivery_secret.sql` renames the
Vault secret in place and reschedules the job to read the new name; until
`npm run secrets -- production` sets the new function secret, the function
also accepts `PROJECTION_WORKER_SECRET`, which `npm run secrets` then
unsets (`RETIRED_FUNCTION_SECRETS`), so push delivery never stops. Between
that run's function secret and its Vault write, a minute's push may be
refused and is delivered the next minute. A local stack's
`supabase/functions/.env` keeps its value under the new name
(`scripts/local-db.mjs`).

Amended (2026-10-26, Carl Sauder): the push delivery job no longer calls the
Edge Function every minute whatever is queued. Each minute it asks
`push_work_waiting()` (a notification a claim could take, or a push receipt
old enough to read) and posts only if so, so `diag.job_schedule` gives it no
schedule (it runs when there is work, like the webhook dispatch). Another
daily job drops `cron.job_run_details` rows over seven days old. The claim
is driven from the people who have a push token (index
`notifications_push_person`) instead of walking past every notification of
someone without one. The schedule is now
`20261026170400_push_delivery_when_waiting.sql`, which `npm run secrets`
runs again. Audit: `docs/performance-audit-2026-10-26.md` item 11.
