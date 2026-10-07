# Environments

Three environments, one git branch each (decisions.md 50). Public settings are
plain, in each platform's own file. Secrets are encrypted in one file per
hosted environment, and a person applies them with one command when they
change; deploys never carry them, so no build system holds a key
(decisions.md 51).

| Environment | Git branch | Supabase | Cloudflare Workers | App (EAS) |
| --- | --- | --- | --- | --- |
| development | your branch | local (`npm run db:start`) | `npm run web:dev` (the Worker, local); `npm run dev:local` starts both | `npm run app`, development channel |
| preview | `develop` | persistent branch `develop` of the hosted project | `langquest-next-dashboard-preview`, `langquest-next-invite-email-preview` | `preview` channel and profile |
| production | `main` | the hosted project `xymxnebdwtbkfxlbylch` | `langquest-next-dashboard`, `langquest-next-invite-email` | `production` channel, TestFlight and Play internal |

Pull requests target `develop`. Merging one deploys preview. A release is a
pull request from `develop` to `main`, merged with a merge commit (not
squash, so the branches stay in step), and deploys production. A hotfix
branches from `main`, merges to `main`, then `main` is merged back into
`develop`.

Each platform deploys code through its own git integration. GitHub holds no
deploy token and no key; guardrails runs on pull requests and on pushes to
both branches.

| Platform | On a push to `develop` | On a push to `main` |
| --- | --- | --- |
| Supabase (GitHub integration) | migrations and functions to the `develop` branch | the same to production (`server/README.md`) |
| Cloudflare (Workers Builds) | `npm run web:deploy:preview`, `npm run email:deploy:preview` | `npm run web:deploy`, `npm run email:deploy` (`docs/cloudflare.md`) |
| EAS workflows | `.eas/workflows/deploy-preview.yml`: update or internal build | `.eas/workflows/deploy-to-testers.yml`: update or store build |

Per-pull-request Supabase branches still open automatically for database
changes. They have their own URL and no secrets, so they test migrations,
not the app.

## Where settings live

| Setting | File | Reaches the platform by |
| --- | --- | --- |
| The app's public config (`EXPO_PUBLIC_*`), plain | `apps/mobile/.env.<env>` | `npm run env:eas -- push <env>` (EAS builds and updates); the web build (`npm run export:web`) reads it too |
| Worker public config, plain | `vars` in each `wrangler.jsonc` (top level is production, `env.preview` is preview) | every deploy |
| Hosted Supabase project refs, plain | `[remotes.<env>] project_id` in `supabase/config.toml` | read by scripts; the dashboard's `SUPABASE_URL` var must match (a test checks) |
| Secrets, encrypted | `.env.preview`, `.env.production` at the repository root | `npm run secrets -- <env>` |

The secrets file holds `INVITE_RELAY_SECRET` and `PROJECTION_WORKER_SECRET`,
and production also `DIAG_DATABASE_URL` (read on a laptop by
`npm run diag -- --hosted`, never pushed). It may also hold
`BIBLE_BRAIN_ACCESS_KEY`, Faith Comes By Hearing's key for the Worker's
Bible routes (`docs/reference-material.md`). That one is optional: it is not
in the Worker's `secrets.required`, so a deploy never waits for it, and
until a person sets it (`npm run env:update -- <env> BIBLE_BRAIN_ACCESS_KEY`,
then `npm run secrets -- <env>`) the Bible routes answer 503.
`npm run secrets` puts each where it is used, as `scripts/secrets.mjs`
declares:

| Destination | Gets |
| --- | --- |
| dashboard Worker | `SUPABASE_SERVICE_ROLE_KEY`, read from Supabase each run, never stored in the repo; `BIBLE_BRAIN_ACCESS_KEY` when the file has it |
| invite-email Worker | `INVITE_RELAY_SECRET` |
| Edge Function secrets | `INVITE_RELAY_SECRET`, `PROJECTION_WORKER_SECRET`, `INVITE_RELAY_URL` (public, derived from the Worker's name) |
| Vault | `langquest_project_url`, `langquest_projection_worker_secret` |
| pg_cron | the projection job: its migration (`20261006000001_schedule_projections.sql`) schedules it only where Vault already has the secrets, so this runs that migration again |

Worker secrets stay on the Worker across deploys, and wrangler refuses a
deploy while one in `secrets.required` is missing, so a forgotten secret
stops the deploy instead of breaking the Worker. `env:check` (run by
`npm test`) refuses a plain secret, a secret in the app's files, and a public
setting in the secrets file.

## Keys

Two private keys, `DOTENV_PRIVATE_KEY_PREVIEW` and
`DOTENV_PRIVATE_KEY_PRODUCTION`, each in its own password-manager entry and in
the `.env.keys` of whoever changes or applies that environment's secrets.
Nothing else holds a key: not GitHub, Cloudflare, Supabase or EAS. Running the
app or the dashboard locally needs none. The Bible routes locally need the
Bible Brain key in your shell when `npm run web:dev` starts
(`scripts/web-dev-vars.ts` copies it into the ignored `apps/web/.dev.vars`
without printing it); without it they answer 503. `npm run db:start` and
`npm run db:reset` also schedule the projection worker locally, every minute,
with a local secret of its own, and seed the library (`server/README.md`).
Plain `supabase start` or `supabase db reset` skip both.

Workers Builds still keeps branch builds off on every Worker, so a branch
never deploys over preview or production.

## Commands

| Task | Command |
| --- | --- |
| Set one value | `npm run env:update -- <env> KEY ['value']`: `EXPO_PUBLIC_*` goes plain into the app's file and on to EAS; anything else is encrypted into `.env.<env>` (asks for the value, hidden, when it is left out) |
| Apply secrets | `npm run secrets -- <env>` (shows what differs, asks); `--check` only compares |
| Push the app's file to EAS | `npm run env:eas -- push <env>` |
| Deploy a Worker by hand | `npm run web:deploy[:preview]`, `npm run email:deploy[:preview]` |
| Check this machine | `npm run env:doctor` |

`npm run secrets` compares Supabase values by digest. Worker secrets cannot be
read back, so it only checks that they exist, and sets them again on every
apply.

## Setting up preview (once)

1. **Git.** Create `develop` from `main`, make it the default branch (so pull
   requests target it), and protect both branches (pull request required,
   guardrails `checks` passing):
   `git push origin main:develop && gh repo edit --default-branch develop`.
2. **Supabase.** Create the persistent branch:
   `npx supabase branches create develop --persistent --git-branch develop --project-ref xymxnebdwtbkfxlbylch`
   (its compute is billed). It starts with the migrations and no data.
3. **Public settings,** with the branch's ref and anon key
   (`npx supabase projects api-keys --project-ref <ref>`):
   - `[remotes.preview]` with `project_id = "<ref>"` in `supabase/config.toml`
   - `"vars": { "SUPABASE_URL": "https://<ref>.supabase.co" }` in `env.preview`
     of `apps/web/wrangler.jsonc`
   - `npm run env:update -- preview EXPO_PUBLIC_SUPABASE_URL https://<ref>.supabase.co`
     and `npm run env:update -- preview EXPO_PUBLIC_SUPABASE_ANON_KEY <anon key>`
4. **Secrets.**
   `npm run env:update -- preview INVITE_RELAY_SECRET "$(openssl rand -hex 32)"`,
   `npm run env:update -- preview PROJECTION_WORKER_SECRET "$(openssl rand -hex 32)"`,
   then `npm run secrets -- preview`. That also creates the two `-preview`
   Workers, so their first deploy finds its secrets.
5. **Cloudflare.** Connect each `-preview` Worker to the repository in Workers
   Builds as `docs/cloudflare.md` lists.
6. **EAS.** Nothing to set: `deploy-preview.yml` runs on the first push to
   `develop` that touches the app. iOS internal builds install only on
   registered devices (`npx eas device:create`).

## Rotating

A leaked secret: set a new value with `env:update`, then `npm run secrets`.
Both ends of the relay and of the projection secret change together, so
nothing is left mismatched. The service-role key is rotated in Supabase; then
run `npm run secrets` for that environment.

A leaked private key: decrypt that environment's `.env.<env>`, delete its
`DOTENV_PUBLIC_KEY_<ENV>` line and the private key, encrypt again (a new pair
is made), share the new key, and rotate every secret in the file as above.
Git history still holds the old ciphertext, which the old key can read.
