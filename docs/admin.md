# The admin page

`https://admin.langquest.org` shows staff what is going on with LangQuest in
one page: what phones and browsers report, how the server's own jobs are
doing, and what each service LangQuest runs on says about its part. It is a
Worker of its own, `langquest-next-admin` (`apps/admin`, decisions.md 159),
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

Done once, in this order, by someone who can sign in to each service
named. Every command runs from the repository root, with `.env.keys`
present and the Supabase CLI linked to production
(`npx supabase link --project-ref xymxnebdwtbkfxlbylch`). Nothing to do
for the address: langquest.org's wildcard record answers for `admin`
until the first deploy adds the Worker's own record, which takes
precedence. Keep the wildcard; other addresses may rely on it.

### 1. Make the Worker and give it its database login

From the admin page's branch (before it merges), run
`npm run secrets -- production`. It compares, lists what it will set
(names only) and asks `Apply to production? [y/N]`; answer `y`. Among the
rest it creates the Worker `langquest-next-admin` and gives it
`DIAG_DATABASE_URL`, diag_reader's read-only login, already in
`.env.production`. The Worker has no code yet, so nothing answers.

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
  `package.json`, `package-lock.json`, `scripts/cloudflare-deploy.mjs`

A build of `main` fails until the admin page's pull request merges
(`main` has no `admin:deploy` yet); that is expected.

### 3. Merge the pull request

Workers Builds then deploys the Worker and attaches `admin.langquest.org`.
The app's Worker rebuilds too, because `package-lock.json` changed; that is
harmless. Check: `curl -s -o /dev/null -w '%{http_code}\n'
https://admin.langquest.org` says `200` (a new address's certificate can
take a few minutes).

### 4. Let yourself in

Open `https://admin.langquest.org` and sign in with your LangQuest account.
The page says no one is on the admin list yet and shows your profile id.
Copy it, then:

1. `npm run env:update -- production ADMIN_PROFILE_IDS`; at the hidden
   prompt paste the id (several people: ids separated by commas). It
   encrypts the value into `.env.production` and commits that file on the
   branch you are on; push it as you push other env changes.
2. `npm run secrets -- production`, answer `y`.
3. Reload the page: the database sections fill in. The others say "Not
   connected" until step 5.

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
- **`ADMIN_SUPABASE_TOKEN`** (Supabase section). supabase.com > Account >
  Access Tokens > Generate new token, as a scoped token: the LangQuest
  Next and LangQuest v2 projects only; Read for Project Settings, Edge
  Functions and Logs; an expiry.
- **`ADMIN_VERCEL_TOKEN`** (Vercel section). vercel.com > Account Settings
  > Tokens > Create. Scope: the FrontierRND team; expiration: up to a year.
  Vercel has no read-only token, so keep it to that team.
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
