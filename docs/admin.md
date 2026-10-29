# The ops dashboard

`https://next.langquest.org/ops-dashboard` shows staff what is going on
with LangQuest in one page: what phones and browsers report, how the
server's own jobs are doing, and what each service LangQuest runs on says
about its part. Its API is `/ops/api/*` on the same host. It is a Worker of
its own, `langquest-next-admin` (`apps/admin`, decisions.md 160), beside
the app's Worker rather than inside it, so the read tokens it holds never
sit on the Worker that answers the public. It has no address of its own:
the app's Worker hands it those paths through its `OPS` service binding
(`apps/web/worker/ops.ts`), and wrangler's `run_worker_first` keeps the
app's page from ever answering them. Production only: preview has no
database of its own for it to read yet, so `/ops-dashboard` there says it
is not set up.

It reads, with four exceptions (decisions.md 162): marking feedback seen,
done or open again, running a server job now, granting or declining an
organization's blue check request (decisions.md 173, docs/verified-organizations.md),
and connecting a tutorial channel on YouTube and choosing the videos to put
up there (decisions.md 180, below). For those the page posts
to `/ops/api/actions`; this Worker, which holds no writer's key, passes the
action and the person's own token to the app Worker's `OpsActions`
entrypoint (`APP_ACTIONS` binding), which checks the token itself (a live
session, a Global Viewer on an `aal2` session), acts with the service role,
and writes every attempt to `ops.actions`, refused ones too. The Support
queue section lists the latest. A job already running is left alone.
Suspending or deleting an account, moderation and Global Viewer grants stay
in the command-line scripts, run on a call.

## Who can open it

Global Viewers (decision 158, `docs/global-viewers.md`), on a session
verified with their authenticator. That is the whole list: adding someone is
`npm run global-viewer -- grant`, on a call, and removing them is `revoke`,
which signs them out everywhere. No secret names who may open the page.

Someone signed in to the web app on this host as a Global Viewer who has
entered their code is let in at once: the page reads the app's session
(read only; renewing it here would spend the app's refresh token). Anyone
else signs in on the page with email and password, then enters the 6-digit
code from their authenticator. That session is kept in the browser tab only
(`sessionStorage`); closing the tab signs out. A Global Viewer with no
authenticator yet is told to set one up in the app (Me, then Global Viewer);
anyone else is told only that the page is for Global Viewers.

Every API call checks the sign-in with Supabase Auth, which also refuses a
session that was signed out elsewhere, then asks the database, as that
person, `get_user_state()`: only `globalViewer: 'on'` (an active grant and an
`aal2` session) gets in. The Worker remembers a good token for a minute and
the Global Viewer answer for 30 seconds, so a revoke shuts the page within
half a minute. Wrong passwords meet Supabase's own limits, because the page signs
in from the browser, and the page's API allows 120 calls a minute per
address.

## What each section reads

"Needs attention" at the top gathers every section's alerts under three
levels (`apps/admin/src/section.ts` `Level`):

- **Act now** (`urgent`): people are blocked or their work is at risk:
  recordings lost, work refused as invalid, a fold that disagrees with
  its snapshot, R2 missing a recording, no recent backup, the site or a
  Supabase service down, an update crashing enough to roll back, a token
  already expired.
- **Fix soon** (`problem`): broken, but nobody loses work while it waits:
  a failed deploy, a job past its time limit, server errors on a route,
  a slow RPC people wait on, a token about to expire, a database past
  90% of its disk.
- **Watch** (`watch`): worth a look; it may be nothing. A part that could
  not be read is here too.

An alert says only what someone could act on. A merge that changes nothing
the web app is built from, notifications for people with no push token
(they stay in the Inbox), RPCs only the server's jobs call, an average over
fewer than 20 calls, the v2 import's backdated events, browsers going
quiet, and an overage costing under $5 this month raise none; each figure
still shows in its section. The same list is JSON at
`/ops/api/attention`, with a count per level. Each section collapses to its
title and status (OK, urgent, problems, to watch, not connected, could not
read): it starts closed when it is fine and open when something needs a
look, and a section someone opens or closes stays that way in their
browser. Expand all and Collapse all are at the top. Hovering over (or
tabbing to) a section's title, a figure, a column or a sub-heading shows
what it means, from `apps/admin/src/pageHelp.ts`.

Every figure says the time it covers, under its label unless the label
already does: `last 24 h`, `last 7 days`, `since 3 Oct` for a count from a
known start (the billing month, the last reset of Postgres' counters, the
first nightly size), `oldest 2 days ago` for a queue, `now` for a state,
`all time` for a total. A count whose start is not known says so.

The page has thirteen sections, each about one subject (`apps/admin/src/pageOps.ts`
`GROUPS`): Look up, Sync and data safety, Phones and browsers, Releases,
Server jobs, Database, Workers and traffic, Storage and capacity, People and
organizations, Support, Access and integrations, App stores, and Tutorial
videos. A section
gathers the parts below (one source's answer each) under sub-headings, and
each figure is shown in one place only: the database's size with Capacity,
deploy times in Releases' timeline, the live commit in Code and deploys,
whether a job runs now in the Jobs table, what was made this week in
Integrations. A section's status is its parts' together, and a part that is
not connected says so under its own sub-heading. A test holds every source
the page loads to exactly one section.

| Part | From | Needs |
| --- | --- | --- |
| Server jobs | `diag.jobs()`: projections, push delivery, the v2 import, the app Worker's cron and request counts, webhooks, invite email (`docs/diagnostics.md`). Alerts are the CLI's own (`scripts/diagSignals.ts` `jobSignals`). | `DIAG_DATABASE_URL` |
| Phones and browsers | `diag.records` and `diag.installs`, every install together: installs heard from, sync outcomes and error codes, errors and crashes with the latest code a person would read out, transfers and their failures, recording, sign-in trouble, each phone's latest state, builds in the field | `DIAG_DATABASE_URL` |
| Database | size, connections, cache hits and deadlocks (`pg_stat_database`), RPC timings (`diag.rpc_stats()`), each counted since its own last reset (`diag.ops_counts_since()`) | `DIAG_DATABASE_URL` |
| v2 import | `diag.v2_import_status()` | `DIAG_DATABASE_URL` |
| Feedback | its open count from `diag.ops_feedback_open()` (migration `20261026120000_ops_feedback_and_since.sql`; `diag_reader` cannot read the table); `diag.feedback()`, `diag.feedback_screenshot()` and `diag.feedback_voice()`, once the feedback store's migration is on the database; until then the section says so. Screenshots and voice notes load when asked for, and only as JPEG, WAV or m4a | `DIAG_DATABASE_URL` |
| Look up | an error code (`diag.error`), an email (`diag.lookup_email`: the profile id and its installs, never the address back), a profile id (`diag.person`), an install's last three days (`diag.timeline`), or an organization or language by name (`diag.find`) | `DIAG_DATABASE_URL` |
| Sync and data safety | work the server refused, by reason (`sync` records); what arrived and how late, and events stamped ahead of the clock (the projection pass's sample); the nightly fold canary; languages behind the projection pass, overdue snapshots and the largest languages (`diag.ops_pipeline`) | `DIAG_DATABASE_URL`, migration `20261023100000_ops_dashboard.sql` |
| Builds and stuck phones | each update in the field with its crash-free share (a rollback alert), reducer and protocol versions, browsers by web commit, time to a usable Map, stuck phones and phones gone quiet | `DIAG_DATABASE_URL` |
| Release health | merges on `main`, Worker deploys and EAS updates over 14 days against errors phones reported; the commit each host serves; hosted migrations against `main` (`diag.migrations_applied` and the files on GitHub) | `DIAG_DATABASE_URL`; the Cloudflare, Expo and GitHub tokens add to the timeline |
| Job container | each server job's object, asked through the app Worker's read-only `JobStatus` entrypoint (`APP_JOBS` binding): running or not, since when, its limit | the binding |
| Scheduled database jobs, Database detail, Push and Inbox, Integrations, Support queue, Security and limits | `diag.ops_cron`, `ops_database`, `ops_push`, `ops_integrations`, `ops_support`, `ops_limits`, and job runs (`push_delivery`, `webhook_dispatch`, `account_delete`, `worker_requests` for the rate limits' refusals). The longest query and oldest transaction name their role, client and wait (never the query's text) and leave out background work that always runs: every backend that is not a client's (autovacuum, WAL senders, pg_cron's and pg_net's workers) and Realtime's sessions, listed apart (migration `20261026160000_ops_database_who.sql`). To see its text, "Which query is it" below | `DIAG_DATABASE_URL`, the migration |
| App Worker | requests by route, server errors, rate-limit refusals and time taken, from the request tally | `DIAG_DATABASE_URL` |
| Tutorial videos | `diag.ops_tutorials`: each app language's YouTube channel and when it was connected, each video's newest version not on YouTube (ready, or chosen and waiting, with the last failure's code), and the count up in each language; never a token (migration `20261028090000_tutorial_videos.sql`) | `DIAG_DATABASE_URL`, the migration; Connect and Publish need `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` on the app's Worker |
| People and organizations | `diag.ops_people` and `ops_orgs`, counted, never named; an organization opens its own page at `/ops-dashboard/org/<id>` (`diag.ops_org` and its installs' sync errors) | `DIAG_DATABASE_URL`, the migration |
| Storage and backups | Supabase's backups and point-in-time recovery, R2's size (`r2StorageAdaptiveGroups`), files lost on phones, the nightly R2 check | `DIAG_DATABASE_URL`; `ADMIN_SUPABASE_TOKEN` with read access to database backups; `ADMIN_CLOUDFLARE_TOKEN` |
| Expiry dates | each provider token's end date where its provider reports one (Cloudflare, GitHub), Apple's certificates and provisioning profiles, and the dates in `apps/admin/expiry.json` | the tokens; the file needs nothing |
| Capacity and cost | the database's size and growth (the fold canary records sizes nightly) against its provisioned disk (`SUPABASE_DB_LIMIT_GB`, 64 GB), R2's growth, and this month's Workers, Durable Object and R2 usage against the plan's allowance (`apps/admin/src/sources/storage.ts` `ALLOWANCE`) | `DIAG_DATABASE_URL`; `ADMIN_CLOUDFLARE_TOKEN` |
| Code and deploys | `main` on GitHub, the latest run of each workflow on `main`, and the commit `next.langquest.org/version.json` says it serves. A web app still behind `main` 45 minutes after a merge that changed a file it is built from (its watch paths, `docs/cloudflare.md`) is a problem: the deploy failed (as every Workers Build did from 2026-10-16 to 10-19) | nothing; `ADMIN_GITHUB_TOKEN` avoids GitHub's anonymous limit |
| Cloudflare | each Worker's requests, errors and CPU over the last day (GraphQL Analytics), its latest deploy and its latest Workers Build | `ADMIN_CLOUDFLARE_TOKEN` |
| Supabase | for LangQuest Next (`SUPABASE_PROJECTS`; v2 is left off): project status, each service's health, Edge Functions, and counts from the day's logs (API 5xx, Edge Function 5xx, Postgres errors, Auth 5xx), with the errors grouped: a Postgres error by its SQLSTATE (named), role, client and the RPC a PostgREST call named; a server error by method, the path's first parts (ids hidden) and status. Never a log message, which can quote what someone typed | `ADMIN_SUPABASE_TOKEN` |
| App builds and updates | EAS builds, store submissions and the newest update on each branch | `ADMIN_EXPO_TOKEN` |
| Update adoption | for each channel, platform and runtime the phones run: the newest update EAS published there and how many installs active in the last 7 days run it, an older update, or their build's embedded one. EAS gives each update's id per platform, the id a phone reports in its diagnostics (`Updates.updateId`), so they match exactly; a channel serving two branches (a rollout) takes the newer. Browsers are left out, and a phone with diagnostics off is not counted (`apps/admin/src/sources/adoption.ts`) | `ADMIN_EXPO_TOKEN`; `DIAG_DATABASE_URL` |
| Google Play | Android vitals for the last 7 days Play has (user-perceived crash and ANR rates, 7-day user-weighted as Play Console shows them, against Play's bad-behaviour lines, 1.09% and 0.47%), the top crash and ANR clusters, and the last week's reviews | `ADMIN_GOOGLE_PLAY_KEY` |
| App Store | each recent App Store version and where it stands in review, the latest builds and whether Apple processed them, TestFlight testers' crash reports (device and system only), recent customer reviews | `ADMIN_APP_STORE_KEY` |

A section without its token says "Not connected" and what to add; one whose
service fails says "Could not read" and why. Neither holds up the others.
Provider answers are kept a minute per Worker isolate; Refresh skips that.

## What it never shows

The same rule as diagnostics (decisions.md 39): ids, counts, timings and
codes. No email, username or name from any service: deploy and build
authors, workflow actors, reviewers' names and log lines are left out, and
logs are only counted, because a log line can quote what someone typed.
Store reviews are shown, since they are public already, without the name. Feedback shows a
person's name and email only when they chose to share them. Install and
project ids are shortened on screen.

## Setting it up

Done once, in this order, by someone who can sign in to each service
named. Every command runs from the repository root, with `.env.keys`
present and the Supabase CLI linked to production
(`npx supabase link --project-ref xymxnebdwtbkfxlbylch`). Nothing to do
for the address: langquest.org's wildcard record answers for `admin`
until the first deploy adds the Worker's own record, which takes
precedence. Keep the wildcard; other addresses may rely on it.

### 1. Make the Worker and its database connection

From the admin page's branch (before it merges), run
`npm run secrets -- production`. It compares, lists what it will set
(names only) and asks `Apply to production? [y/N]`; answer `y`. Among the
rest it:

- creates the Worker `langquest-next-admin` with the `ADMIN_*` tokens
  `.env.production` holds (step 5). The Worker has no code yet, so nothing
  answers.
- makes the Hyperdrive config `langquest-next-diag` from
  `DIAG_DATABASE_URL`, diag_reader's read-only login, with caching off, and
  writes its id into `apps/admin/wrangler.jsonc` in place of
  `made-by-npm-run-secrets`. Commit that file on the branch. The id is not
  a secret; the login stays in the Hyperdrive config, which cannot be read
  back.

The Worker reads the database only through that config (the `DIAG`
binding): the Workers runtime cannot finish TLS with Supabase's pooler
itself, so a Worker given the login directly waits until the request
times out (decision 160, amended). Running `npm run secrets -- production`
again after `DIAG_DATABASE_URL` changes updates the same config; there is
nothing to redeploy.

### 2. Connect it to Workers Builds

In the Cloudflare console (the LangQuest account): Workers & Pages >
`langquest-next-admin` > Settings > Build > Connect, then:

- Git repository: `genesis-ai-dev/langquest-next`
- Production branch: `main`; builds for other branches: off
- Root directory: empty (the repository root)
- Build command: empty
- Deploy command: `npm run admin:deploy`
- Build variables and secrets: none
- Build watch paths, include: `apps/admin/*`, `scripts/diagSignals.ts`,
  `packages/core/*` (the page checks phones and snapshots against core's
  `REDUCER_VERSION`), `package.json`, `package-lock.json`,
  `scripts/cloudflare-deploy.mjs`

A build of `main` fails until the admin page's pull request merges
(`main` has no `admin:deploy` yet); that is expected.

### 3. Merge the pull request

Workers Builds then deploys both Workers. The app's Worker binds
`langquest-next-admin` (`services` in `apps/web/wrangler.jsonc`), and a
deploy fails while the Worker it binds does not exist, so step 1 must come
first. Until the dashboard's own code is deployed (`npm run admin:deploy`,
or its Workers Build), that Worker is only the placeholder step 1 makes,
and `/ops-dashboard` answers 503 saying it is not deployed. The admin Worker binds back to the app Worker's `JobStatus`
entrypoint (`APP_JOBS`); until the app Worker with that entrypoint is
deployed, the Job container section says it could not ask. Check: `curl -s -o /dev/null -w '%{http_code}\n'
https://next.langquest.org/ops-dashboard` says `200`.

### 4. Let yourself in

You need a Global Viewer account with its authenticator set up
(`docs/global-viewers.md`). Open `https://next.langquest.org/ops-dashboard`
and sign in with it, then enter your code. The database sections fill in;
the others say "Not connected" until step 5.

### 5. Tokens, each optional

Each one fills in one section. Make each read-only, as narrow as the
service allows and with an expiry where it offers one. Store each with
`npm run env:update -- production <NAME>`, which asks for the value
without showing it, and once you have the ones you want, run
`npm run secrets -- production` and Refresh the page.

- **`ADMIN_CLOUDFLARE_TOKEN`** (Cloudflare section). My Profile > API
  Tokens > Create Token > Create Custom Token. It must be a token on your
  user profile, not an account token: the Builds API refuses those.
  Permissions, all Account-level: Account Analytics Read, Workers Scripts
  Read, Workers CI Read. Account Resources: include only the LangQuest
  account. Set an end date.
- **`ADMIN_SUPABASE_TOKEN`** (Supabase section, and backups in Storage).
  supabase.com > Account > Access Tokens > Generate new token, as a scoped
  token: the LangQuest Next project only; Read for
  Project Settings, Edge Functions, Logs and Database backups; an expiry.
  Supabase gives no API for a token's end date, so put it in
  `apps/admin/expiry.json` for the Expiry section.
- **`ADMIN_GITHUB_TOKEN`** (Code and deploys; works without one, but a
  Worker shares GitHub's anonymous limit). github.com > Settings >
  Developer settings > Fine-grained tokens > Generate. Resource owner
  `genesis-ai-dev` (the organization may have to approve it); only the
  `langquest-next` repository; Repository permissions: Actions Read and
  Contents Read; an expiry.
- **`ADMIN_EXPO_TOKEN`** (App builds and updates). On expo.dev, open the
  account that owns LangQuest Next > Settings > Robot users > Create
  robot, role Viewer (if builds then show "Could not read", give it
  Developer), then create an access token for it.
- **`ADMIN_GOOGLE_PLAY_KEY`** (Google Play).
  1. Google Cloud console, the project linked to Play Console (Play
     Console > Setup > API access names it): APIs & Services > Library,
     enable "Google Play Developer Reporting API" and "Google Play Android
     Developer API".
  2. IAM & Admin > Service accounts > Create service account, for example
     `langquest-admin-page`, with no roles. Open it > Keys > Add key >
     Create new key > JSON; a key file downloads.
  3. Play Console > Users and permissions > Invite new users: the service
     account's email; App permissions: add LangQuest Next with "View app
     information (read-only)". Add "Reply to reviews" only if you want
     reviews on the page (Google's guide asks for it before the API lists
     them; it also lets the key reply). Invite. Google can take up to a
     day to let a new service account in.
  4. The key file is JSON on several lines, so store it as one:
     `npm run env:update -- production ADMIN_GOOGLE_PLAY_KEY "$(jq -c . ~/Downloads/<key file>.json)"`,
     then delete the key file.
- **`ADMIN_APP_STORE_KEY`** (App Store).
  1. App Store Connect > Users and Access > Integrations > App Store
     Connect API > Team Keys > Generate API Key (an Admin or the Account
     Holder can). Name it, Access: Developer, the least role that reads
     builds, versions and reviews; no role is read-only.
  2. Download the `.p8` (Apple offers it once) and note its Key ID and the
     Issuer ID shown above the list.
  3. Store the three together:
     `npm run env:update -- production ADMIN_APP_STORE_KEY "$(jq -cn --arg i <issuer id> --arg k <key id> --rawfile p ~/Downloads/AuthKey_<key id>.p8 '{issuerId: $i, keyId: $k, privateKey: $p}')"`,
     then delete the `.p8`.

A section whose token is refused says "Could not read" with the service's
answer, usually a missing permission.

For sign-in from a single-sign-on account and a second factor on top of the
password, Cloudflare Access can sit in front of `/ops-dashboard*` and
`/ops/api/*`; the page works unchanged behind it.

## Tutorial videos on YouTube

The how-to videos (`docs/tutorial-videos.md`) go on YouTube, one channel
for each app language (decisions.md 180). The channels were made by hand;
their ids are in `server/youtube.ts`.

- **Connect**, once per channel. Google's page opens: sign in with the
  account that owns the channels and choose that language's channel. Back
  on the dashboard the channel shows as connected, and its home page gets a
  list of the other LangQuest channels. Google sends the person back to
  `/ops/api/youtube/callback`, which must be the OAuth client's redirect
  address. Connect again when a channel's videos fail with a sign-in code
  such as `youtube_invalid_grant`; the dashboard says so under Needs
  attention.
- **Watch** a video before choosing it: it opens the file the filming made.
  New films come in each day at 23:10 UTC, from the nightly filming on
  GitHub (`tutorial_intake` in Server jobs; `docs/tutorial-videos.md`, Each
  night); Run now starts the intake at once.
- **Publish** the ones chosen. The publish job starts at once, and again at
  23:40 UTC each day while chosen videos wait: YouTube takes 100 uploads a
  day for all channels together. A new version of a video already up takes
  its place in the playlist, and the old one is unlisted with a link to the
  new. The job's runs are in Server jobs (`tutorial_publish`).
- **How each channel looks** is the publish job's too: before any video,
  each channel whose description, language, banner or list of the other
  channels differs from what `server/youtube.ts` says (`WORDS`, and the
  banners in `apps/mobile/public/youtube`, made by
  `npx tsx e2e/tutorials/banners.ts`) gets them, about 150 of the day's
  10,000 units each. The channels table shows "on" once it has them.
- **Held comments**: each channel holds comments that may be
  inappropriate for a person to approve or remove (YouTube Studio →
  Settings → Community → Defaults: "Hold potentially inappropriate comments
  for review", with Increase strictness). The publish job counts them each day; the channels
  table shows each channel's count, linked to its comments in Studio, and
  Needs attention says when any wait. Approving and removing stay in Studio.
- **The picture** (the round one beside the name) is the one thing YouTube
  lets nobody but a person set: in YouTube Studio, on each channel,
  Customization → Branding → Picture → Upload, `apps/mobile/assets/icon.png`.

The OAuth client is a Web application client in the Google Cloud project
that has the YouTube Data API v3 on, with the redirect address above. Store
its id and secret with `npm run env:update -- production YOUTUBE_CLIENT_ID`
and `YOUTUBE_CLIENT_SECRET`, then `npm run secrets -- production`.

## Which query is it

The page names a long query's role and client but never shows its text,
which can hold what someone sent. To see it, open the Supabase SQL Editor
for the project (it runs as the owner) and run:

```sql
select pid, now() - query_start as running_for, usename as role, application_name as client,
       backend_type, wait_event_type, wait_event, left(query, 300) as query
from pg_stat_activity
where datname = current_database() and state = 'active' and pid <> pg_backend_pid()
order by query_start
limit 10;
```

`select pg_cancel_backend(<pid>);` stops a query that is stuck;
`pg_terminate_backend` drops its connection, as a last resort. The slowest
queries over time are in `extensions.pg_stat_statements` (order by
`max_exec_time`) and in the project's Query Performance report.

## Locally

`apps/admin/.dev.vars` (ignored by git) overrides the vars: `SUPABASE_URL`
and `SUPABASE_ANON_KEY` of a local stack, `DIAG_DATABASE_URL` for its
database (the copy below makes it the `DIAG` binding's
`localConnectionString`, so the page reads locally the way it does in
production, through the binding). Sign in with a local account made a Global Viewer with
`npm run global-viewer -- grant <email> --note local` (no `--hosted`), its
authenticator set up in the app. On a local
stack diag_reader has no login; give it one there only
(`alter role diag_reader with login password '…'`) so the page reads with
the same grants as in production. Provider tokens go in the same file
under their production names (`ADMIN_CLOUDFLARE_TOKEN=...`, the two JSON
keys each on one line). Wrangler loads from `.dev.vars` only the secrets a
config requires, and these are optional, so `scripts/admin-dev-config.ts`
writes `apps/admin/.wrangler.dev.jsonc` (ignored by git), a copy that also
requires each `ADMIN_*` the file holds and points `DIAG` at your
database; `npm run admin:dev` runs it first.
Restart after adding a token. Then `npm run admin:dev` serves
`http://localhost:8791/ops-dashboard`. Started beside `npm run web:dev`,
the app's Worker on :8787 finds it through wrangler's local registry, so
`http://localhost:8787/ops-dashboard` works too; without it, the app's
Worker answers 503 there.

Or run both Workers in one `wrangler dev`, which needs no local registry
and leaves another checkout's Worker on :8787 alone (run
`npx tsx scripts/web-dev-vars.ts` and `npx tsx scripts/admin-dev-config.ts`
first; they write the two local config copies):

```bash
cd apps/web && npx wrangler dev -c .wrangler.dev.jsonc -c ../admin/.wrangler.dev.jsonc --port 8797
```

The page is then `http://localhost:8797/ops-dashboard`. No job runs on a
schedule there (no job tick); Run now still starts one in Docker.

## Adding a source

A module in `apps/admin/src/sources` returns a `Section` (`src/section.ts`):
its data, its alerts, `off(setup)` until its token is there. Keep the parts
that decide alerts pure, test them with a fetch that answers by URL
(`apps/admin/test/sources.test.ts`), add a renderer in `src/page.ts` (or `src/pageOps.ts`), a line for each new
label in `src/pageHelp.ts`, and
add its token to `ADMIN_KEYS` in `scripts/secrets.mjs`.

Not tried against the real services yet (no keys were at hand): Play's
rates are read as fractions (0.0109 is 1.09%), and the first real answer
should confirm it.

## Not built yet

- iOS crash counts: App Store Connect gives them only as daily analytics
  reports, which have to be requested once and read the next day.
- History past what `diag` keeps (90 days of runs and records): a daily
  rollup, phase 5 of `docs/ops-dashboard-plan.md`.
- Telling anyone: the page shows problems to whoever opens it; nothing
  sends them (`OpsWatch`, phase 5).
- Container time in Capacity and cost: Cloudflare's public analytics do not
  give it; read it in the Cloudflare dashboard.
- Not tried against the real services yet: the R2, usage, backups,
  certificates and token-expiry calls are written from each provider's
  documentation and tested with fakes. The first real answer should
  confirm each field.
