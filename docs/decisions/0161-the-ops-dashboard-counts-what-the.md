# 161. The ops dashboard counts what the server already sees, adds four counts of its own, and reads job state through one read-only entrypoint

Date: 2026-10-22 · By: Carl Sauder · Status: accepted

Reason: Carl asked (2026-10-21) for the indicators listed in
`docs/ops-dashboard-plan.md` section 5 on the ops dashboard (160): work the
server refused, upload delay, clock skew, a fold canary, backups,
crash-free rate per update, time to a usable Map, version drift, expiry
dates, Global Viewers and limits, moderation and deletions, capacity and
cost, latency per route, webhooks and the agent API. Decided:
- **Read, never collect anew from phones.** Everything comes from what the
  server already receives, read as `diag_reader` through report functions
  that return counts, ids, timings, codes and organization and language
  names (migration `20261023100000_ops_dashboard.sql`); `DIAG_SCHEMA` and
  the Play answers are unchanged. An email lookup answers with the profile
  id only (`diag.lookup_email`), so the page never lists people.
- **Four counts the server did not keep**, each written where the thing
  happens: the projection pass samples what arrived since its last run for
  upload delay and clock skew (`server/arrivals.ts`), because
  `public.events` has no index on `received_at` and adding one would lock
  the log while it builds; the request tally adds time buckets and a `429`
  count per route, with `device`, `links` and `ops` as routes of their own;
  `_delete_account` writes an `account_delete` run with no id, since nothing
  is left to count afterwards; and two nightly jobs in the job container
  (141), the fold canary, which folds three languages afresh and compares
  them with their stored snapshot and passage lines, and the R2 check,
  which runs the reconciler without hashing. The container may now run
  four instances, since four jobs can overlap.
- **Job state through one call.** The app's Worker exports a `JobStatus`
  entrypoint with one method, `jobs()`, reading each `JobRunner`'s state
  without touching its container or alarm; the admin Worker binds to that
  entrypoint only (`APP_JOBS`), not to the object class, so it still cannot
  start or stop anything. It never calls an organization's Durable Object
  (132): those numbers come from Postgres.
Reverse if: the arrivals sample misses too much (a language that is never
sampled because it fails every pass), when the log gets a `received_at`
index built concurrently; or the canary's cost in the container grows past
its 60 minutes, when it takes fewer or smaller languages.

Amended (2026-10-26, Carl Sauder): the dashboard no longer restates rules it
counts. `diag.ops_pipeline` takes the snapshot schedule from its caller,
which passes sync's `SNAPSHOT_SCHEDULE`, so "overdue" is what the snapshot
worker does, and `ops_limits` reads the diagnostics day cap from
`diag._ingest_day_cap()`, whose agreement with `diag_ingest` the ops smoke
checks. The Worker's actions ask `_gv_on` at the session's real level
rather than checking aal2 itself, so that rule is SQL's alone, and they
verify a token through the same helper as every other Worker route
(`apps/web/worker/identity.ts`).
