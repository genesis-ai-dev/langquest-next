# The admin page

`https://admin.langquest.org` shows staff what is going on with LangQuest in
one page: what phones and browsers report, how the server's own jobs are
doing, and what each service LangQuest runs on says about its part. It is a
Worker of its own, `langquest-next-admin` (`apps/admin`, decisions.md 141),
beside the app's Worker rather than inside it, so the read tokens it holds
never sit on the Worker that answers the public.

It only reads. It changes nothing in any service.

## Who can open it

Anyone signs in with their LangQuest account (Supabase Auth, the same
accounts as the app). The page lets them in only if their profile id is in
`ADMIN_PROFILE_IDS`. Anyone else is turned away and told their own profile
id, which is how the first person adds themselves (below). The session is
kept in that browser tab only (`sessionStorage`); closing the tab signs out.

Every API call checks the sign-in with Supabase Auth, which also refuses a
session that was signed out elsewhere. The Worker remembers a good token for
a minute. Wrong passwords meet Supabase's own limits, because the page signs
in from the browser, and the page's API allows 120 calls a minute per
address.

## What each section reads

"Needs attention" at the top gathers every section's alerts, problems first.

| Section | From | Needs |
| --- | --- | --- |
| Server jobs | `diag.jobs()`: projections, push delivery, the v2 import, the app Worker's cron and request counts, webhooks, invite email (`docs/diagnostics.md`). Alerts are the CLI's own (`scripts/diagSignals.ts` `jobSignals`). | `DIAG_DATABASE_URL` |
| Phones and browsers | `diag.records` and `diag.installs`, every install together: installs heard from, sync outcomes and error codes, errors and crashes with the latest code a person would read out, transfers and their failures, recording, sign-in trouble, each phone's latest state, builds in the field | `DIAG_DATABASE_URL` |
| Database | size, connections, cache hits and deadlocks (`pg_stat_database`), RPC timings (`diag.rpc_stats()`) | `DIAG_DATABASE_URL` |
| v2 import | `diag.v2_import_status()` | `DIAG_DATABASE_URL` |
| Feedback | `diag.feedback()`, `diag.feedback_screenshot()` and `diag.feedback_voice()`, once the feedback store's migration is on the database; until then the section says so. Screenshots and voice notes load when asked for, and only as JPEG, WAV or m4a | `DIAG_DATABASE_URL` |
| Look up | an error code (`diag.error`), an install's last three days (`diag.timeline`), or an organization or language by name (`diag.find`) | `DIAG_DATABASE_URL` |
| Code and deploys | `main` on GitHub, the latest run of each workflow on `main`, and the commit `next.langquest.org/version.json` says it serves. A web app still behind `main` 45 minutes after a merge is a problem: the deploy failed (as every Workers Build did from 2026-10-16 to 10-19) | nothing; `ADMIN_GITHUB_TOKEN` avoids GitHub's anonymous limit |
| Cloudflare | each Worker's requests, errors and CPU over the last day (GraphQL Analytics), its latest deploy and its latest Workers Build | `ADMIN_CLOUDFLARE_TOKEN` |
| Supabase | for LangQuest Next and LangQuest v2: project status, each service's health, Edge Functions, and counts from the day's logs (API 5xx, Edge Function 5xx, Postgres errors, Auth 5xx) | `ADMIN_SUPABASE_TOKEN` |
| Vercel | the FrontierRND team's projects (the website, the v2 web app, the dev docs, the partner demo): latest production deploy and last failed one | `ADMIN_VERCEL_TOKEN` |
| App builds and updates | EAS builds, store submissions and the newest update on each branch | `ADMIN_EXPO_TOKEN` |
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

Each step is done once, by someone with access to the service named.

1. **The address.** `admin.langquest.org` has an old DNS record pointing at
   Vercel (no FrontierRND Vercel project uses it, and its certificate has
   expired). Delete it in Cloudflare (langquest.org, DNS), so the first
   deploy can attach the address to this Worker, as `next.langquest.org`
   was.
2. **Deploys.** In Workers Builds, connect `langquest-next-admin` to this
   repository as in the table in `docs/cloudflare.md`. Until then,
   `npm run admin:deploy` deploys from a laptop.
3. **Its database login.** `npm run secrets -- production` puts
   `DIAG_DATABASE_URL` (diag_reader's read-only login, already in
   `.env.production`) on the Worker.
4. **Who may open it.** Open the page and sign in. It says your profile id.
   Then `npm run env:update -- production ADMIN_PROFILE_IDS` (it asks for
   the value: ids separated by commas) and `npm run secrets -- production`.
5. **Tokens, each optional.** Make each one read-only and only as wide as it
   needs, with an expiry where the service allows one, then
   `npm run env:update -- production <NAME>` (it asks for the value, hidden)
   and `npm run secrets -- production`:
   - `ADMIN_CLOUDFLARE_TOKEN`: a **user** API token (My Profile > API
     Tokens; the Builds API refuses account tokens) for this account with
     Account Analytics Read, Workers Scripts Read and Workers CI Read.
   - `ADMIN_SUPABASE_TOKEN`: a scoped access token (Account > Access
     Tokens) for the LangQuest Next and v2 projects, read only, with
     Project Settings, Edge Functions and Logs.
   - `ADMIN_VERCEL_TOKEN`: a token scoped to the FrontierRND team, with an
     expiry. Vercel has no read-only token.
   - `ADMIN_GITHUB_TOKEN`: a fine-grained token for
     genesis-ai-dev/langquest-next with Actions: read and Contents: read.
   - `ADMIN_EXPO_TOKEN`: an access token for a robot user on the Expo
     account that owns the app.
   - `ADMIN_GOOGLE_PLAY_KEY`: a Google Cloud service account with the
     Google Play Developer Reporting API and the Google Play Android
     Developer API turned on, invited in Play Console (Users and
     permissions) for this app with "View app information (read-only)".
     Google's guide asks for "Reply to reviews" as well before the API
     lists reviews; add it only if you want reviews here, knowing it lets
     the key reply. Without it the section shows vitals and says reviews
     were refused. Its key file is JSON on several lines, so
     pass it as one line: `npm run env:update -- production
     ADMIN_GOOGLE_PLAY_KEY "$(jq -c . key.json)"`, then delete the file.
   - `ADMIN_APP_STORE_KEY`: an App Store Connect API key (Users and Access,
     Integrations) with the Developer role, the least that reads builds,
     versions and reviews (no key role is read-only), as JSON: `npm run env:update -- production ADMIN_APP_STORE_KEY "$(jq -cn
     --arg i <issuer id> --arg k <key id> --rawfile p AuthKey_<key id>.p8
     '{issuerId: $i, keyId: $k, privateKey: $p}')"`, then delete the .p8.

For sign-in from a single-sign-on account and a second factor on top of the
password, Cloudflare Access can sit in front of `admin.langquest.org`; the
page works unchanged behind it.

## Locally

`apps/admin/.dev.vars` (ignored by git) overrides the vars: `SUPABASE_URL`
and `SUPABASE_ANON_KEY` of a local stack, `DIAG_DATABASE_URL` for its
database, and `ADMIN_PROFILE_IDS` with a local account's id. On a local
stack diag_reader has no login; give it one there only
(`alter role diag_reader with login password '…'`) so the page reads with
the same grants as in production. Then `npm run admin:dev` serves
`http://localhost:8791`.

## Adding a source

A module in `apps/admin/src/sources` returns a `Section` (`src/section.ts`):
its data, its alerts, `off(setup)` until its token is there. Keep the parts
that decide alerts pure, test them with a fetch that answers by URL
(`apps/admin/test/sources.test.ts`), add a renderer in `src/page.ts`, and
add its token to `ADMIN_KEYS` in `scripts/secrets.mjs`.

Not tried against the real services yet (no keys were at hand): Play's
rates are read as fractions (0.0109 is 1.09%), and the first real answer
should confirm it.

## Not built yet

- iOS crash counts: App Store Connect gives them only as daily analytics
  reports, which have to be requested once and read the next day.
- Seen and Done on feedback (needs `public.feedback_set_status` and the
  service-role key, which this Worker does not hold).
- History: every section shows now and the last day or week, not trends.
- Telling anyone: the page shows problems to whoever opens it; nothing
  sends them.
