# Cloudflare

Cloudflare Workers Builds deploys the invite-email Worker and the app's
Worker, `langquest-next`, which serves the app's web export, the reports
API, every recording and guide file the app moves, the access-token API,
and runs the server's jobs in containers (decisions.md 43, 58, 69, 70,
141). Until 2026-10-20 it was `langquest-next-dashboard`, from when it
served only the reports dashboard (decision 144; "Renaming the app's
Worker" below says how it moved). Workers Builds also deploys the staff
ops dashboard, `langquest-next-admin` (`docs/admin.md`, decisions.md 160),
which has no address of its own: the app's Worker hands it `/ops-dashboard`
and `/ops/api/*` through a service binding.
Merging to `main` deploys the production Workers, and merging to
`develop` deploys their `-preview` copies (decisions.md 50,
`docs/environments.md`); the admin page has none. There is no GitHub Actions workflow and no API token
in GitHub. Cloudflare generates the build token. Builds have no secrets at
all: a deploy carries code and public `vars`, and the Worker keeps the
secrets `npm run secrets` set on it (decisions.md 51).

| | Invite email | App | Invite email preview | App preview | Admin |
| --- | --- | --- | --- | --- | --- |
| Worker name | `langquest-next-invite-email` | `langquest-next` | `langquest-next-invite-email-preview` | `langquest-next-preview` | `langquest-next-admin` |
| Root directory | repository root | repository root | repository root | repository root | repository root |
| Production branch | `main` | `main` | `develop` | `develop` | `main` |
| Non-production branch builds | off | off | off | off | off |
| Build command | | | | | |
| Deploy command | `npm run email:deploy` | `npm run web:deploy` | `npm run email:deploy:preview` | `npm run web:deploy:preview` | `npm run admin:deploy` |
| Build variables and secrets | none | none | none | none | none |
| Include paths | `apps/invite-email/*`, `package.json`, `package-lock.json`, `scripts/cloudflare-deploy.mjs` | `apps/web/*`, `apps/mobile/*`, `packages/core/*`, `packages/sync/*`, `server/*`, `package.json`, `package-lock.json`, `scripts/cloudflare-deploy.mjs`, `scripts/build-jobs.mjs` | as invite email | as app | `apps/admin/*`, `scripts/diagSignals.ts`, `package.json`, `package-lock.json`, `scripts/cloudflare-deploy.mjs` |

The app Worker's include paths cover `server/*` and `scripts/build-jobs.mjs`
because the job image (The job runner, below) is built from them: without
them a change to the pass alone would not rebuild the image. Set on
2026-10-16 with decision 141; check it in the Cloudflare dashboard if a
pass change does not reach the container.

Leave the default dependency install on. It is `npm clean-install` with the
build image's npm, 10.9.2 since Cloudflare's 2026-10-14 image update, not
the npm 11 we use, and npm 10 refuses a lockfile with a peer it would
resolve differently. Every build failed from 2026-10-16 to 2026-10-19 on
`Missing: typescript@5.9.3 from lock file`, because eas-cli's
`@expo/require-utils` asks for TypeScript 5. The `overrides` entry in
`package.json` gives eas-cli our TypeScript, which is what npm 11 already
installed. After changing dependencies, check that npm 10 accepts the
lockfile: `npx npm@10 ci --dry-run --ignore-scripts`. The web app's deploy command builds
the Expo web export first (`npm run export:web`, a few minutes), reading
`apps/mobile/.env.<env>` and the commit from `WORKERS_CI_COMMIT_SHA`; it fails
if the JavaScript is over its budget. Its custom domains,
`next.langquest.org` and `next-preview.langquest.org`, are `routes` in
`apps/web/wrangler.jsonc` on the `langquest.org` zone in this account; a
deploy attaches them. Branch builds stay off so a branch
never deploys over preview or production.

The preview Workers are the `env.preview` section of each wrangler file
(vars, bindings and `secrets.required` are not inherited, so they are
repeated there). `npm run secrets -- preview` creates each one if it does not
exist yet, so its first deploy finds its secrets. If Workers Builds refuses
a deploy because the wrangler file's top-level `name` is not the connected
Worker's, add `"name": "langquest-next-preview"` (or the invite-email
one) to `env.preview`; it is the name `--env=preview` already deploys.

The token Cloudflare creates has Workers Scripts edit but no email
permission. If an invite-email deploy is refused for its `send_email`
binding, add Email Sending edit to that token (My Profile > API Tokens).

| Worker | Public `vars` (wrangler file) | Secrets (`npm run secrets`) |
| --- | --- | --- |
| invite email | `INVITE_FROM` | `INVITE_RELAY_SECRET` |
| app | `SUPABASE_URL` | `SUPABASE_SERVICE_ROLE_KEY` |
| admin | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, which account, projects, team and app each section reads | `DIAG_DATABASE_URL`; optional provider tokens and keys (`ADMIN_*`) |

## The job runner (containers)

The app's Worker also runs the server jobs too big for an Edge
Function (`docs/server-jobs.md`, decisions.md 141): the projection pass
for every language (`server/projections.ts`) and the v2 import
(`server/v2.ts`). `apps/web/jobs/Dockerfile` is the image: Node 24 and one
bundle per job from `scripts/build-jobs.mjs` (`npm run build:jobs`, run by
the Worker's build and by `npm run web:dev`), and psql for the import. No
npm package is installed, so the dependency tree is never beside the
service key. `wrangler deploy` builds the image with Docker and pushes it
to Cloudflare's registry, on Workers Builds as on a laptop. The Worker goes
live before the image rolls out, so a tick in between may find the old
image; the next tick finds the new one.

The job tick, the Worker's `*/5 * * * *` cron, starts the pass every time
and the import every 15 minutes, with its whole read at 03:15 UTC
(`worker/jobsModel.ts`). One `JobRunner` Durable Object per job
(`worker/jobs.ts`) starts that job's container, one instance each
(`standard-1`, 4 GiB; containers need the Workers Paid plan), and starts
nothing while a run is going. A container gets `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` from the Worker's own env; the import also
gets the Worker's `API_URL` and the optional secrets `V2_SUPABASE_ANON_KEY`
and `V2_DATABASE_URL` (`npm run secrets`), and runs only while the var
`V2_IMPORT_ENABLED` is "true" (production; preview is "false"). A run
that is killed or reaches its limit (45 minutes for the pass, 340 for the
import) leaves a job run with `sigterm`, `killed:137` or `stopped` as
its error class, and each tick a `job_starts` run (`npm run diag -- jobs`).
While a run lasts, an alarm wakes its object every minute to renew the
container's keep-alive and to record the run's end: an object is held only
about a minute after a call, and a restarted one holds no keep-alive until
it sets it again. The containers are pinned to ENAM (`constraints.regions`),
beside the database and R2. Their own output, including the pass's
`progress:` lines, is in the Worker's logs in the dashboard
(Observability), since `wrangler` has no command for container logs.

Locally, `npm run web:dev` needs Docker Desktop running: `wrangler dev`
builds the image, the container reaches the local database through
`host.docker.internal` (`JOBS_SUPABASE_URL` and `JOBS_API_URL`, vars
`scripts/web-dev-vars.ts` adds to the local config copy; unset in
production), the import is off (no v2 keys locally; `npm run v2` imports by
hand), and `scripts/job-tick.mjs` fires the job tick every minute at
wrangler's `/__scheduled`, which the copy sends to the Worker ahead of the
page. That is the local stack's projection pass (decision 148): nothing
else runs it locally. `e2e/ui-web.sh` does the same for the UI tests. To
fire it once more by hand:

```bash
curl 'http://localhost:8787/__scheduled?cron=*/5+*+*+*+*'
```

## Recordings and guide media (R2)

The app's Worker binds one private R2 bucket as `BLOBS`
(`apps/web/wrangler.jsonc`, decisions.md 69): `langquest-next-blobs` for
production, `langquest-next-blobs-preview` for preview, both with the
location hint Eastern North America (`enam`), beside the Supabase project.
`npm run r2:buckets -- <environment>` creates whichever does not exist yet
and leaves the rest alone; run it before the first deploy that binds one.
Public access and the `r2.dev` address stay off: everything goes through
`/api/blobs` (`apps/web/worker/blobs.ts`). Read links are signed with a key
derived from `SUPABASE_SERVICE_ROLE_KEY`, so the bucket adds no secret; a
rotated service-role key only ends the links already handed out (ten
minutes at most). `wrangler dev` keeps a local bucket in
`apps/web/.wrangler/state`, so `npm run web:dev` needs nothing from
Cloudflare.

The Supabase Storage bucket that held the files before was copied once,
then emptied and deleted (decisions.md 69); the script that did it is in
git history (`server/copyBlobsToR2.ts`).

A deploy fails while a secret in `secrets.required` is missing on the
Worker; run `npm run secrets -- <environment>`. The web app reads
`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` from the
plain `apps/mobile/.env.<environment>` at build time.

Guardrails still typecheck (both Workers included) and test every pull
request and every push to `develop` and `main`. Workers Builds does not wait
for that job.

## Caches in a Worker isolate (`worker/isolateCache.ts`)

A phone downloading a language's audio sends thousands of file requests, and
each needed two serial round trips before R2 answered: the token check and
the `blob_access` call. An isolate now remembers both for a short time. The
caches are per isolate, bounded (5,000 entries, oldest dropped), and lost
with the isolate, so they are an optimization, not state.

- **Token to person.** Keyed by the SHA-256 of the token (the raw token is
  not kept). Only successful checks are kept, until the sooner of the
  token's own expiry and 60 s.
- **File access.** Keyed by person, organization, stream and read or write
  (library media in an organization's own stream, `<org>/_org/<hash>`, is
  keyed per file because the database decides it per file). A yes is kept
  60 s, a no 10 s, an error not at all. A member who is removed may keep
  opening files for up to 60 s from an isolate that already answered for
  them; the developer accepted this.
- **Service client.** One per isolate, reused by every call.

Not done yet, and separate from the above: the hosted Supabase project still
signs with the legacy shared (HS256) secret, so `auth.getClaims` makes
supabase-js call Auth for each token that is not cached. Moving the project
to asymmetric JWT signing keys lets the Worker verify tokens locally against
cached public keys. As with every hosted setting (`infrastructure-as-code`)
this is done through the repo's Supabase config and the CLI
(`supabase/config.toml` `signing_keys_path`, `supabase gen signing-key`,
then the repo's way of applying Supabase config), never the dashboard. Switching
rotates the keys, so existing sessions get new tokens on their next refresh;
rotate the legacy secret out only after clients have refreshed.

## Renaming the app's Worker

A Worker's name is its identity: a deploy under a new name makes a new
Worker, with its own empty Durable Objects, its own secrets, its own
container application and its own Workers Builds connection. The app's
Worker moved from `langquest-next-dashboard` to `langquest-next` this way
on 2026-10-20 (decision 144). What starts over: each organization's object
(its report cache rebuilds on first use; stored report inputs make that
quick) and its webhook state, the change feed's numbering, each webhook's
position, the outbox and the delivery history (decision 101). The webhooks
themselves are rows in Supabase and carry on. The R2 bucket, the domain,
the Vault values and the database are the same.

The cutover, in order:

1. The change that stops calling it the dashboard in code and docs
   (decision 144) merges first, so the rename's pull request changes only
   the name.
2. Tell whoever runs the change feed's consumers to start over after the
   cutover: drop the saved cursor and list the passages again. On
   2026-10-20 that was EveryBible's prototype site, the only webhook.
3. From the branch that renames, put the secrets on the new Worker; the
   script creates the Worker when it does not exist yet:
   `npm run secrets -- production`, then
   `npm run secrets -- production --check`.
4. In the Cloudflare console, connect Workers Builds to `langquest-next`
   with the settings in the table above (production branch `main`,
   deploy command `npm run web:deploy`, the same include paths,
   non-production branch builds off), and disconnect it from the old
   Worker. Until the merge, a build of `main` for the new Worker refuses,
   because `main`'s config still names the old one.
5. Merge. Workers Builds deploys `langquest-next`; a deploy that is not
   interactive moves the custom domain to it in the same call, so
   `next.langquest.org` never points nowhere. The first deploy also creates
   the container application `langquest-next-jobrunner`.
6. Check the new Worker answers and runs its jobs:
   `curl -s -o /dev/null -w '%{http_code}\n' https://next.langquest.org/api/v1`
   (200), `npx wrangler deployments list --name langquest-next`,
   `npx wrangler containers list` (the new application), then within ten
   minutes `npm run diag -- --hosted jobs`: `job_starts` and `projection`
   from the new Worker, `v2_import` at the next quarter hour.
7. Stop the old Worker, which still ticks its crons and would start a
   second pass beside the new one: delete its container application
   (`npx wrangler containers list`, then
   `npx wrangler containers delete <its id>`), then the Worker
   (`npx wrangler delete langquest-next-dashboard`). Both are permanent:
   its logs, its objects and their webhook history go with it.

Until step 7, going back is a redeploy of the old name from the commit
before the rename (`npm run web:deploy`, which asks before moving the
domain back). After it, fix forward.
