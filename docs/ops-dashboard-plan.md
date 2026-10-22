# Plan: the operations dashboard at next.langquest.org/ops-dashboard

Status: phases 1 to 4 built on `carl/ops-dashboard`; four choices settled · Carl Sauder · 2026-10-21

Written against `origin/main` at `683289d9` (decision 149 is the latest on
`main`). Nothing here is built yet. Section 9 says what is settled and what is open.

## 1. What we are building

One page that support and devops open to see whether LangQuest is healthy,
and to find out why it is not working for one person. It answers:

- Is anything broken right now? (one "Needs attention" list, problems first)
- How are phones and browsers in the field doing? (builds, sync, errors,
  crashes, storage, stuck uploads)
- Who is using it? (accounts, organizations, languages, activity, counted)
- Are the server's own parts healthy? (the Worker, the job container, push
  delivery, the database, R2, Supabase, the v2 import)
- What shipped, and is it live? (main, Workers Builds, EAS, the stores,
  hosted migrations)
- What did people tell us? (in-app feedback, store reviews)
- What happened to *this* phone, error code, organization or person?

It lives at `https://next.langquest.org/ops-dashboard`, so it has one address beside
the app. Production only for now (section 3, step 4).

What this is not:

- Not a way into anyone's work. Reading an organization's content stays the
  app's job, through a Global Viewer (PR 196 and 197). The
  dashboard links there.
- Not a replacement for the providers' own consoles for deep work
  (Cloudflare logs, Supabase SQL). It shows their numbers together and links
  to them.
- Not part of the Expo web export. Every user downloads that bundle and it
  has a size budget (decision 123); staff pages do not belong in it.

## 2. Start from Caleb's admin page, not from scratch

Caleb built most of this on `caleb/admin-page` (2026-10-19, no pull request
yet, 25 commits behind `main`): `apps/admin`, a Worker of its own,
`langquest-next-admin`, on `admin.langquest.org`, with `docs/admin.md` and
a decision entry (numbered 147 on the branch; `main` has since used 147 to
149). It already has:

| Section | Source |
| --- | --- |
| Needs attention | every section's alerts, using `scripts/diagSignals.ts` thresholds |
| Server jobs | `diag.jobs()` (projection, push delivery, v2 import, Worker cron and requests, webhooks, invite email) |
| Phones and browsers | `diag.installs`, `diag.records`: installs, builds in the field, sync outcomes and codes, errors, transfers, sign-in trouble, low disk, lost files, unsent work |
| Database | `pg_stat_database`, `diag.rpc_stats()` |
| v2 import | `diag.v2_import_status()` |
| Feedback | `diag.feedback()`, screenshots and voice notes |
| Look up | an error code, an install's timeline, an organization or language by name |
| Code and deploys | GitHub `main` and workflows, `next.langquest.org/version.json` drift |
| Cloudflare | each Worker's requests, errors, CPU, deploys and Workers Builds |
| Supabase | Next and v2: service health, Edge Functions, 5xx and error counts from logs |
| Vercel, Expo, Google Play, App Store | deploys, EAS builds and updates, Android vitals, App Store review state, store reviews |

It reads `diag` as `diag_reader` (read-only, counts and codes, decision 39),
holds read-only provider tokens, writes nothing, and has unit tests for every
source. Its design choices hold up: a separate Worker keeps the provider
tokens off the Worker that answers the public, and `diag_reader` keeps the
page from writing or seeing content.

This plan keeps all of that and changes three things: the address
(section 3), who may open it (section 4), and what it covers (section 5).
**Caleb should agree before his branch is reworked**; this plan assumes he
does, and that he or Carl lands phase 1.

## 3. The address: `/ops-dashboard` on the app's host, through a service binding

The page is `/ops-dashboard` (and `/ops-dashboard/*` for an organization's
page or a lookup, so a link can be shared), and its API is `/ops/api/*`.
Not `/ops-dashboard`: that name is expected to be a public status page.

The app's Worker owns `next.langquest.org` as a custom domain, and its
static assets answer every path that is not in `run_worker_first`. So:

1. `apps/web/wrangler.jsonc`: add `"/ops-dashboard"`, `"/ops-dashboard/*"`
   and `"/ops/api/*"` to `assets.run_worker_first`, and a service binding,
   `"services": [{ "binding": "OPS", "service": "langquest-next-admin" }]`
   in production only (step 4).
2. `apps/web/worker/index.ts`: a request to any of those three is handed to
   `env.OPS.fetch(request)` unchanged, before anything else. The app Worker
   never reads the admin Worker's secrets; it only passes the request on.
   `ownsResponse` (`securityHeaders.ts`) learns that these paths set their
   own headers.
3. `apps/admin`: serves the page at `/ops-dashboard` and its API at
   `/ops/api/*` instead of `/` and `/api/*`, and answers 404 to anything
   else the binding hands it; its `routes` entry is removed, so the admin
   Worker has no public address of its own and is reachable only through the
   binding. `admin.langquest.org` is not created (or, if it was deployed
   already, its route is removed).
4. No preview copy yet. Preview has no Supabase project of its own
   (`supabase/config.toml` names only `[remotes.production]`), so a preview
   admin Worker would have no database to read and could not deploy without
   its required secret. The app's preview Worker has no `OPS` binding and
   answers 503 on these paths, saying where the dashboard is. When preview
   gets its own database, add `env.preview` to `apps/admin/wrangler.jsonc`
   and the binding to the app's preview config.

Signed out, `/ops-dashboard` shows only the sign-in and says it is for
LangQuest staff; nothing about LangQuest's health is shown or served before
the gate in section 4. The app uses neither path today
(`src/web/webPaths.ts`), and once they are in `run_worker_first` the app's
pages can never answer them.

The page now shares the app's origin. Two consequences, both acceptable:

- It can reuse the web app's Supabase session (same `localStorage` key), so
  someone signed in to the web app as a Global Viewer is signed in to
  `/ops-dashboard`. The page keeps its own sign-in for when they are not.
- A script injection in the web app could call `/ops/api` with a signed-in
  staff member's token. That is no worse than what such a script could
  already do with that token in the app, and every `/ops/api` call still
  needs an `aal2` session (section 4). `/ops-dashboard` keeps its own strict
  CSP with a nonce.

Alternative considered: Workers routes `next.langquest.org/ops-dashboard*`
and `next.langquest.org/ops/api/*` on the admin Worker. Cloudflare runs routes before a custom-domain Worker, so it
would work without touching the app Worker, but the precedence is implicit
and easy to break. The binding states it in the app's own config.

Section 11 says why a Worker hosts the page at all, and which Durable
Objects it may and may not touch.

## 4. Who may open it: Global Viewers on an authenticator session

Caleb's page lets in profile ids listed in the `ADMIN_PROFILE_IDS` secret,
with a password only. Global Viewers (PR 196 and 197; their entry needs a new number, since `main` used 149) already
give LangQuest staff a dedicated account, a grant made on a call
(`npm run global-viewer -- grant`), an authenticator (TOTP, `aal2`) and a
revoke that signs them out everywhere. The dashboard should use the same
gate:

- Every `/ops/api/*` call verifies the token (as now), then asks the
  database, as that person, `get_user_state()`, and lets them in only when
  `globalViewer` is `on` (an active row **and** an `aal2` session). The
  answer is kept for 30 seconds per isolate, like `session_is_live`
  (decision 118). No new migration, no secret to edit to add a person.
- Someone signed in with a password only is asked for their authenticator
  code on the page (`mfa.challengeAndVerify`), as the app does.
- `ADMIN_PROFILE_IDS` goes away. Adding or removing a person is
  `npm run global-viewer -- grant | revoke`, recorded with who did it and why.
- Optional, later: Cloudflare Access in front of `/ops-dashboard*` and `/ops/api/*` for single sign-on.
  The page works the same behind it.

This makes `/ops-dashboard` depend on PR 196 being merged. Until then, phase 1 can ship
with `ADMIN_PROFILE_IDS` and switch over when it lands.

Support and devops see the same page. If later some sections should be for
devops only (provider tokens, the database), a `role` column on
`global_viewers` can split them; not needed now.

## 5. What it covers

Grouped by what they cover. **Built** is on Caleb's branch; **New** is
added by this plan. Everything new is still counts, ids, timings and codes
(decision 39), read through `diag` functions granted to `diag_reader`, in
one new migration per phase. Almost all of it reads what is recorded
already; the few things that must be recorded first say so, and none of
them is collected from people or their phones.

### 5.1 Needs attention (built, extended)

The alerts from every section, problems first. New: each alert links to the
section and to the runbook line that says what to do, and the same list is
served as JSON at `/ops/api/attention`. In phase 5 the same checks run every
minute in `OpsWatch` (section 11.4), which sends a problem that lasts, and
the deploy watchdog routine stops running `npm run diag` for them.

### 5.2 Phones and browsers (built, extended)

Built: installs heard from (day, week, all), platforms, builds and updates in
the field, sync outcomes and error codes, errors and crashes by E-code,
transfers, recording, sign-in trouble, each phone's latest state.

New:

- **Version adoption**: installs per EAS update and per runtime over the last
  14 days, and installs whose reducer or protocol version is too old
  (`too_old` sync outcomes): who still needs a store update.
- **Stuck phones**: installs with unsent recordings older than a day, a
  download stuck over a day, low disk or lost files, as a list of shortened
  install ids, each opening its timeline.
- **Silent phones**: installs that were active and have not been heard from
  in 3 days while their person's events still arrive from elsewhere
  (diagnostics off, or delivery broken).
- **Time to a usable Map**: a language's first full download (`open` and
  `fill` records, decision 147), p50 and p95 per day, by language size. It
  is the slowest moment a new person has.
- **Version drift**: reducer and protocol versions in the field against the
  server's, and browsers still running an older web commit than
  `version.json` (on the web the runtime version is the commit).

### 5.3 People and organizations (new)

Counted, never listed by name:

- Accounts: total, new per day (14 days), signed in per day and week
  (`diag.installs.last_seen` by distinct profile), suspended and
  looked-after (`is_managed_account`). Global Viewers are in 5.11.
- Organizations and languages: totals, new per week, and the 20 most active
  by events in the last 7 days, shown by id and current name (organization
  and language names are not personal data; `diag.find` already shows them).
- Joining: pending join requests and their oldest age, invites issued and
  redeemed per day, invite emails sent and failed (`invite_email` job).
- Activity: events received per day by stream kind, and passages recorded,
  reviewed and released per day (from `language_report_inputs`).

Each organization row opens an organization page: members by role (counts),
languages with their size and last activity, its Inbox health
(`diag.inbox_health`), sync errors among its installs, and a link that opens
it in the app as a Global Viewer.

### 5.4 Sync, data safety and the pipeline (new)

An offline-first app loses work quietly, so this section comes first after
Needs attention on the page.

- **Rejected work, by reason**: events the server refused, from the rejected
  counts by reason that `sync` records carry, per day, with the installs
  they came from. A refused event can be work that never arrives, so a
  rising count outranks any crash.
- **Upload delay**: how long work takes from being made on a phone to
  reaching the server, the wall-clock part of each event's HLC against its
  `received_at`, p50, p95 and the longest, per day. Long delays are normal
  offline; a jump across every phone is not. `public.events` has no index on
  `received_at`, so the projection pass, which already reads each
  language's new events, records these numbers in its `projection` run
  rather than a query scanning the log.
- **Clock skew**: events stamped more than five minutes later than the
  server's clock when they arrived, counted the same way, with the installs
  they came from. Ordering rests on those clocks (HLC), and a phone with a
  wrong clock shows here first.
- **Fold canary**: a nightly bundle in the job container takes three
  languages at random (and the largest one on Sundays), folds their events
  afresh with the current reducer, and compares the result with the stored
  snapshot at the same `server_seq` and with `passage_lines`. It records a
  `fold_canary` run, and a mismatch names the language. It checks in
  production what the order-independence and idempotence tests check in CI.
- **Projection lag**: per language, `stream_cursors.next_seq` against
  `projection_marks`; the languages furthest behind, and how long the last
  pass took.
- **Snapshots**: languages whose newest snapshot is older than decision 88's
  rule (200 events or an hour), on an old `reducer_version`, or with no
  passage cut yet (decision 147).
- **Largest languages and organizations**: events, snapshot size, the fold's
  peak memory from `projection` runs (`maxPeakRssMb`). This is the
  `diag.largest_orgs` function the proposed DO memory canary asks for.
- **Org Durable Objects**: memory resets and refusals counted from the
  Worker's logs through Cloudflare's GraphQL (decision 132's limits).

### 5.5 Server (built, extended)

Built: server jobs, the Worker's requests and errors, Supabase services,
the database's size, connections, cache hits, deadlocks and RPC timings.

New:

- **Job container**: for each `JobRunner`, whether a run is going, since
  when, and its time limit, read from the app Worker through its
  `JobStatus` entrypoint, one read-only call over RPC (section 11.3), beside
  the `diag.job_runs` history.
- **pg_cron**: the last runs and failures of `langquest-push-delivery` and
  `langquest-purge-notifications` (`cron.job_run_details`, through a new
  `diag.cron_runs()`); nothing reads it today.
- **Database detail**: the 10 largest tables and indexes, dead-tuple
  ratio, longest running query and oldest open transaction, and
  `npm run db:check`'s answer (hosted migrations behind `main`), which the
  watchdog checks today by hand.
- **Push and Inbox**: `push_delivery` outcomes and receipt errors over the
  day, pending notifications and the oldest, members with no push token.
- **API latency per route**: the Worker's request tally
  (`worker/requestTally.ts`) counts requests by route and status but does
  not time them. It gains a few duration buckets per route (under 100 ms,
  under 1 s, under 10 s, longer), flushed with the counts, so a slow blob
  or reports endpoint shows before people notice. Recorded first, in phase 3.
- **Integrations**: access tokens by scope, pending device grants, review
  links opened per day (decisions 70, 101), webhook deliveries that
  succeeded and failed and their delay (`webhook_dispatch` runs), and the
  agent API's and MCP's calls and errors by scope.

### 5.6 Storage and backups (new)

- **Backups**: the latest Supabase backup and whether point-in-time
  recovery is on (the Management API's backups list; `ADMIN_SUPABASE_TOKEN`
  needs read access to database backups added). R2 has no second copy of
  recordings today, and the page says so plainly instead of leaving the
  panel out; a copy is its own decision.
- R2: bytes and objects in `langquest-next-blobs`, and growth per week, from
  Cloudflare's R2 analytics.
- Files phones report lost (decision 92) per day.
- The R2 reconciliation (`server/blobReconciler.ts`, today run by hand as
  `npm run reconcile`) moves into the job container nightly and records a
  `blob_reconcile` job run with counts of missing and orphaned objects;
  the dashboard shows the latest.

### 5.7 Releases (built, extended)

Built: `main` and its workflows, `version.json` against `main`, Workers
Builds, EAS builds, store submissions and updates, Play vitals, App Store
review state and store reviews.

New:

- **One timeline** of the last 14 days that puts merges, Worker deploys, EAS
  updates, store releases and hosted migrations on one line with the error
  rate under it, so "it started after the deploy" is visible at a glance.
- **Crash-free rate per EAS update**: the share of installs on each update
  with no fatal error, against the update before it (`diag.records` carry
  `update_id`). It is the signal for an EAS rollback; Play's vitals arrive
  days later.
- **Preview against production**: the commit each host's `version.json`
  serves. (Preview shares production's database today, so there are no
  preview migrations to compare.)

### 5.8 Feedback (built, extended)

Built: bugs and ideas, with screenshots and voice notes. New in phase 4:
Seen and Done (section 6), filters by kind and status, and a link from each
item to its install's timeline.

### 5.9 Look up (built, extended)

Built: an E-code, an install id, an organization or language by name. New:
a profile id (`diag.person`), and an email, which answers with the profile
id and its installs only (section 9).

### 5.10 Expiry dates (new)

One list, soonest first, of what stops working on a date:

- each `ADMIN_*` provider token, with the end date the provider reports for
  it (Cloudflare's token verify, GitHub's token-expiration header, and the
  like);
- Apple distribution certificates and provisioning profiles (App Store
  Connect API);
- where a provider gives no date (a Google service account key, a domain's
  registration if it is not on Cloudflare), a date kept by hand in
  `apps/admin/expiry.json`, so it is reviewed like code.

Anything within 30 days is a warning, within 7 a problem.

### 5.11 Security and limits (new)

Counts only: the Global Viewers plan settled on no access log, and this
keeps to it.

- **Global Viewers and support grants**: active Global Viewers, how many are
  signed in on an `aal2` session now, live support grants and when each
  ends, and failed authenticator codes per day (counted from Supabase's
  Auth logs, as the Supabase section counts its errors).
- **Limits hit**, where each is recorded: organization-creation refusals
  (decision 115, the error code in `sync` records), installs at the
  diagnostics caps (`diag.installs` day counters), failed v2 sign-ins
  (`v2_import.sign_in_failures`), and refusals by the Worker's device-code
  and review-link rate limits. The last two are not counted today; the
  request tally gains a `rate_limited` class for each, in phase 3.
- **New credentials**: access tokens and device grants created this week,
  and webhooks switched off with the reason.

### 5.12 Support's queue (new)

Beside feedback (5.8):

- **Moderation**: open content reports and the oldest one's age (decision
  48), with how many only staff can act on (a report about an admin, or in
  an organization with no moderator for it). The Terms of Use promise action
  within 24 hours; at 20 hours the oldest is a problem in Needs attention.
  Read through a `diag` function that returns counts and ages, never the
  reporter or what was reported. Acting stays in `npm run moderation`.
- **Suspended accounts**: how many, and suspended this week.
- **Account deletions**: per week, and any that failed. Nothing records a
  deletion today, since the account is gone afterwards: `_delete_account`
  gains one `account_delete` job run per deletion (outcome only, no id), in
  phase 3's migration. Google holds the app to deletion working
  (`docs/play-store-declarations.md`).

### 5.13 Capacity and cost (new)

- **Growth and headroom**: database size and the event log's growth against
  the Supabase plan's limit, and R2's growth, each with the weeks left at
  the current rate.
- **What it costs**: container run-minutes, Workers requests, R2 class A
  and B operations and Durable Object usage (Cloudflare's GraphQL), and
  Supabase usage, each against its plan's allowance.

### 5.14 Not shown, on purpose

- **Location or region.** The app does not collect it, and adding it would
  change the Play data-safety answers.
- **Activity per person.** The page counts. Following one person is the
  lookup by profile id, for one support case.
- **Product analytics** (time from recording to approval, per
  organization): useful, but they belong in Reports, not on an ops page.

## 6. Writing from the page (phase 4, its own decision)

Caleb's entry says the page only reads, and that acting needs a writer's key
and a decision of its own. This plan keeps phases 1 to 3 read-only. Phase 4
adds a short list of actions that are safe to take from a browser:

- Mark feedback Seen or Done (`feedback_set_status`).
- Run a server job now (the projection pass, the v2 import), through the
  app Worker's `JobRunner`, which already refuses a second run.

Each is a service-role call made by the app Worker on the dashboard's
behalf, through its `OpsActions` entrypoint, which checks the person's own
token again before acting (the admin Worker still holds no writer key),
and each attempt writes a row to a new `ops.actions` table: who, what,
when, the result. Built as `apps/web/worker/opsActions.ts` and migration
`20261023110000_ops_actions.sql`. Suspending or
deleting an account, moderation, Global Viewer grants and anything that
changes an organization stay in the CLIs, run on a call.

## 7. Phases

| Phase | What | Depends on |
| --- | --- | --- |
| 1 | Caleb's page merged with `main`, served at `/ops-dashboard` in production through the service binding; decision entry amended | Caleb's agreement |
| 2 | Global Viewer gate (section 4); `ADMIN_PROFILE_IDS` removed | PR 196 merged |
| 3 | New reads: the extensions in 5.2 to 5.7 and sections 5.10 to 5.13, with one migration of `diag` functions; `/ops/api/attention`. The few things recorded first land here too: the projection pass's upload-delay and clock-skew numbers, the fold canary, the request tally's duration buckets and `rate_limited` classes, and `account_delete` runs. Several pull requests, one per group, so each can be reviewed alone | phase 1 |
| 4 | Actions (section 6) and `ops.actions` | phase 2, its decision |
| 5 | History and telling people: a daily rollup (`diag.daily`, by pg_cron) for trends past 7 days, and the `OpsWatch` Durable Object (section 11.4), which sends a problem to Slack or Linear when it stays for 15 minutes | phase 3 |

Each phase is one pull request, with the guardrails green (`--web` for
phase 1, since it touches the app Worker; `--all` for phases with a
migration).

## 8. Tests and checks

- `apps/admin/test`: the existing source tests, plus the `/ops-dashboard` and `/ops/api` paths, the
  Global Viewer gate (`globalViewer` absent, `needs_code`, `on`, `revoked`)
  and the 30-second cache.
- `apps/web/test`: `/ops-dashboard`, `/ops-dashboard/*` and `/ops/api/*` reach the binding and nothing else
  does; the static assets never answer them.
- A SQL smoke for each new `diag` function, run as `diag_reader`, that
  checks it returns no column holding a name, email or payload text. The
  moderation one also checks it never returns a reporter or a reported id.
- The fold canary: a unit test feeds it a language whose snapshot was
  tampered with and checks the run names that language; another checks a
  clean language passes.
- `apps/web/test`: the request tally's duration buckets and `rate_limited`
  classes; the projection pass's upload-delay and clock-skew numbers from a
  fixture of events with known HLCs.
- A SQL smoke that `_delete_account` writes one `account_delete` run with no
  id in it.
- `scripts/record-parity-sql.ts` is untouched: no event changes anywhere in
  this plan.
- `docs/play-store-declarations.md`: no answer changes. The dashboard
  collects nothing new from people or their phones: the new numbers are
  counted on the server (the projection pass, the Worker, `_delete_account`)
  from what it already receives, and the diagnostics allowlist
  (`DIAG_SCHEMA`) is unchanged.

## 9. Settled and open

Settled by Carl on 2026-10-21:

1. **Build on Caleb's admin page**, after asking Caleb.
2. **Global Viewers on an authenticator session** open it (section 4), not
   `ADMIN_PROFILE_IDS` or Cloudflare Access.
3. **Email in, id out.** The lookup takes an email and answers with the
   profile id and its installs, through a `diag` function that returns the id
   only. The page never lists emails or names, so decision 39's rule holds
   for everything it shows.
4. **Read-only first, then a few actions**: phases 1 to 3 read only; phase 4
   adds the short list in section 6, logged in `ops.actions`.

Still open:

5. **Keep `admin.langquest.org` too?** Recommended: no, one address.
6. **Caleb's agreement** to rework his branch, and who lands phase 1.

## 10. Decision log

Phase 1 needs an entry: Caleb's (renumbered to the next free number on
`main`) amended to say the page is served at `/ops-dashboard` on the app's host
through a service binding, not on its own host. Phase 2 amends it again for
the gate, and phase 4 gets its own entry for writing from the page.

## 11. Where it runs, and which Durable Objects it touches

### 11.1 A Worker of its own

The page is a request that fans out and answers: about ten reads per load,
each an HTTP API (Cloudflare, Supabase, GitHub, EAS, Google Play, App Store
Connect) or a short read-only query on the database as `diag_reader`. That
is the work a Worker is made for, and a Worker brings the rest with it:

- **One address.** A service binding from the app's Worker puts it at
  `/ops-dashboard` on `next.langquest.org` (section 3): no new host, domain or vendor.
- **Settings in the repo.** `wrangler.jsonc`, `npm run secrets` and Workers
  Builds, like the app's Worker (`infrastructure-as-code`).
- **Keys kept apart.** Its provider tokens and its database login sit on a
  Worker the public never reaches; the app's Worker holds none of them.
- **Its limits are far off.** A few staff, ten subrequests a load and a
  little CPU to build JSON, against Workers' 1,000 subrequests and
  30 seconds of CPU per request.

Weighed and not chosen:

| Option | Why not |
| --- | --- |
| Grafana or Metabase over Postgres | Better at history and charts, but not at what is LangQuest's own: E-code lookups, `diagSignals` hypotheses, the Global Viewer gate. Another processor reading `diag`, which decision 39 chose to avoid. Another vendor and its dashboards to keep as code. |
| A Supabase Edge Function | Nearer the database, but every provider token would sit beside the project's own keys, and there is no binding to put it under `/ops-dashboard`. |
| The job container | The page itself does nothing heavy. The two heavy jobs it shows, the nightly R2 reconciliation (5.6) and the fold canary (5.4), are bundles in the existing `JobRunner` container. |
| Routes in the app's Worker | The provider tokens would sit on the Worker that answers the public (Caleb's reason for a Worker of its own). |

Each request opens one connection to the database's pooler as
`diag_reader`. For a few people that is fine. If it shows in the page's
time, Cloudflare Hyperdrive pools and caches those connections: a binding
and a line of config, not worth adding before it is needed.

### 11.2 `OrgSnapshot`: never read

The dashboard never calls an organization's Durable Object, not to count,
not to list languages, not to warm it. Each one keeps under half its
isolate's memory and folds languages of unknown size one at a time
(decision 132). A staff page that walked every organization would wake
objects nobody is using, could fold big languages for nothing, and could
push one into a memory reset that its own members then feel.

Every number about organizations and languages comes from Postgres instead:
`language_report_inputs` (what the projection pass already stored,
decision 142), `stream_cursors`, `projection_marks`, `snapshots` and
`diag.*`. The object's own health (memory resets, refusals) is read from
Cloudflare's analytics about the app's Worker (5.4), which costs the
objects nothing. A test in `apps/admin/test` holds this: the admin Worker
has no binding to `ORG_SNAPSHOTS`, and its config is checked for it.

### 11.3 `JobRunner`: one narrow read-only call

Whether a job is running, since when, and when it will be stopped is known
only to that job's `JobRunner` object (`apps/web/worker/jobs.ts`);
`diag.job_runs` has a run only once it ends. The dashboard reads it through
one call made for it, not through the object itself:

- The app's Worker exports a named entrypoint, `class JobStatus extends
  WorkerEntrypoint`, with one method, `jobs()`. It asks each job's object
  for `status()` and returns, per job: running or not, started at, the time
  limit, and the last end it recorded. Nothing else.
- `JobRunner.status()` reads the object's storage and whether its container
  is running. It never starts, stops or extends a container, and never
  touches the heartbeat alarm. A unit test calls it on an idle and a
  running object and checks that neither changed.
- The admin Worker binds to that entrypoint only:
  `"services": [{ "binding": "APP_JOBS", "service": "langquest-next",
  "entrypoint": "JobStatus" }]`. An entrypoint is reached over RPC through
  the binding, never over HTTP, so there is no `/api/internal/*` path to
  guard.

Not chosen: binding the admin Worker straight to the `JobRunner` class
(`durable_objects` with `script_name: "langquest-next"`). It works, but it
lets the admin Worker call every method of the object, starting a job
among them, and the admin Worker is meant to hold no power to change
anything. Phase 4's "run a job now" is a second entrypoint, with its own
decision, that logs to `ops.actions`.

The two Workers then bind to each other (the app's to the admin's for
`/ops-dashboard`, the admin's to the app's for `JobStatus`). Both exist in
production, so a deploy of either finds the other; on a fresh account the
admin Worker deploys first, without the `APP_JOBS` binding, and gets it on
its second deploy. `docs/admin.md` says so in its setup steps.

### 11.4 `OpsWatch`, for phase 5 alerting

Phases 1 to 4 need no Durable Object: the page reads, answers and keeps
nothing. Telling someone when a problem has lasted needs memory a Worker
does not have, and the admin Worker cannot write to Postgres as
`diag_reader`. So phase 5 adds one object to the admin Worker:

- **One instance**, `OPS_WATCH.idFromName('production')` (its preview copy
  has its own), with SQLite storage.
- **A one-minute alarm.** Each time, it runs the same checks as
  `/ops/api/attention`, by calling the same function, not the page's API.
  The admin Worker gets a cron (every 10 minutes) that only makes sure the
  alarm is set, so a lost alarm costs at most 10 minutes.
- **Alert state** in a table: the alert's key (the check and what it is
  about), level, first seen, last seen, when it was sent, when it cleared.
  A problem is sent once, when it has held for 15 minutes; its clearing is
  sent once. A problem that flaps is sent again only after an hour.
- **Where it sends**: a Slack channel's webhook or a Linear issue, decided
  in phase 5's entry; its key is one more `ADMIN_*` secret. What it sends is
  the alert's text and a link to `/ops-dashboard`: counts, ids and codes, like the
  page (decision 39).
- **The watchdog's job checks move here.** `docs/routines/deploy-watchdog.md`
  runs `npm run diag -- --hosted` for stale and failing jobs today; once
  `OpsWatch` sends those, the routine drops them and keeps its Linear and
  migration checks. No routine then needs a sign-in to `/ops-dashboard`.

`OpsWatch` keeps alert state only. Trends past a week for numbers that come
from the database go in Postgres, as `diag.daily`, written once a day by a
pg_cron job (phase 5's migration); providers keep their own history and are
asked for a range when the page needs one. The provider answers' one-minute
cache stays per isolate: at a few staff, sharing it through an object saves
nothing worth a round trip.
