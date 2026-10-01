# Environments

Three environments, one git branch each, one dotenvx key each (decisions.md 49).

| Environment | Git branch | Supabase | Cloudflare Workers | App (EAS) |
| --- | --- | --- | --- | --- |
| development | your branch | local (`npm run db:start`) | `npm run web:dev` (local) | `npm run app`, development channel |
| preview | `develop` | persistent branch `develop` of the hosted project | `langquest-dashboard-preview`, `langquest-invite-email-preview` | `preview` channel and profile |
| production | `main` | the hosted project `xymxnebdwtbkfxlbylch` | `langquest-dashboard`, `langquest-invite-email` | `production` channel, TestFlight and Play internal |

Pull requests target `develop`. Merging one deploys preview. A release is a
pull request from `develop` to `main`, merged with a merge commit (not
squash, so the branches stay in step), and deploys production. A hotfix
branches from `main`, merges to `main`, then `main` is merged back into
`develop`.

Each platform deploys through its own git integration. GitHub holds no deploy
token and no dotenvx key; guardrails runs on pull requests and on pushes to
both branches.

| Platform | On a push to `develop` | On a push to `main` |
| --- | --- | --- |
| Supabase (GitHub integration) | migrations and functions to the `develop` branch | the same to production (`server/README.md`) |
| Cloudflare (Workers Builds) | `npm run web:deploy:preview`, `npm run email:deploy:preview` | `npm run web:deploy`, `npm run email:deploy` (`docs/cloudflare.md`) |
| EAS workflows | `.eas/workflows/deploy-preview.yml`: update or internal build | `.eas/workflows/deploy-to-testers.yml`: update or store build |

Per-pull-request Supabase branches still open automatically for database
changes. They have their own URL and no function secrets, so they test
migrations, not the app.

## Keys

One key pair per environment. Every file for an environment carries the same
`DOTENV_PUBLIC_KEY_<ENV>`, so `DOTENV_PRIVATE_KEY_<ENV>` opens all of them
and nothing else. A test (`scripts/env-files.test.ts`) and `npm run env:doctor`
refuse a file encrypted with any other key.

| Holder | development | preview | production |
| --- | --- | --- | --- |
| every developer (`.env.keys`) | ✓ | ✓ | |
| maintainers who deploy or read hosted diagnostics (`.env.keys`) | ✓ | ✓ | ✓ |
| Workers Builds secret on the two `-preview` Workers | | ✓ | |
| Workers Builds secret on the two production Workers | | | ✓ |
| GitHub, Supabase, EAS | | | |

Each key is its own password-manager entry, so giving someone preview does not
give them production. EAS gets decrypted copies of the app's files
(`npm run env:push:eas`). Supabase gets its secrets from
`npm run supabase:secrets`, so it never holds a private key.

Production Workers build only `main`, with non-production branch builds off:
Workers Builds secrets apply to every branch a Worker builds, so a branch
build would hand the production key to code that has not been reviewed.

## Files

One file per deploy target and environment, so each platform receives only
its own keys. `EXPO_PUBLIC_*` values become part of the app bundle, and the
service-role key must never land there.

| File | Holds | Reaches |
| --- | --- | --- |
| `apps/mobile/.env.<env>` | `EXPO_PUBLIC_*` (public) | EAS environment of the same name; the dashboard page's build |
| `apps/web/.env.<env>` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | the dashboard Worker, as secrets at deploy |
| `apps/invite-email/.env.<env>` | `INVITE_FROM`, `INVITE_RELAY_SECRET` | the invite-email Worker, as secrets at deploy |
| `supabase/.env.<env>` | `SUPABASE_PROJECT_REF`, `INVITE_RELAY_URL`, `INVITE_RELAY_SECRET`, `PROJECTION_WORKER_SECRET`; production also `DIAG_DATABASE_URL` | Edge Function secrets and Vault (`npm run supabase:secrets`); the ref and diagnostics URL stay local |

Development needs only `apps/mobile/.env.development`: the dashboard and the
local database read `supabase status` (`scripts/web-dev-vars.ts`). The
relay secret appears twice by design (Worker and function); `supabase:secrets`
refuses to push when the two differ.

## Commands

| Task | Command |
| --- | --- |
| Set one value | `npm run env:update -- <env> [mobile\|web\|invite-email\|supabase] KEY` (asks, hidden; commits that file) |
| Fill URL and keys from a hosted project | `npm run web:secrets -- fetch <env>` (reads `SUPABASE_PROJECT_REF`, writes the web and mobile files) |
| Push the app's file to EAS | `npm run env:push:eas -- <env>` |
| Push function and Vault secrets, schedule projections | `npm run supabase:secrets -- <env>` (`--check` only compares) |
| Deploy a Worker by hand | `npm run web:deploy[:preview]`, `npm run email:deploy[:preview]` |
| Check this machine | `npm run env:doctor` |

## Setting up preview (once)

1. **Git.** Create `develop` from `main`, make it the default branch (so pull
   requests target it), and protect both branches (pull request required,
   guardrails `checks` passing):
   `git push origin main:develop && gh repo edit --default-branch develop`.
2. **Supabase.** Create the persistent branch:
   `npx supabase branches create develop --persistent --git-branch develop --project-ref xymxnebdwtbkfxlbylch`
   (its compute is billed). It starts with the migrations and no data. Note
   its project ref.
3. **Preview settings.**
   - `npm run env:update -- preview supabase SUPABASE_PROJECT_REF` (the branch's ref)
   - `npm run web:secrets -- fetch preview` (dashboard and app URL and keys)
   - `npm run env:push:eas -- preview`
   - `npm run env:update -- preview invite-email INVITE_FROM` (for example `LangQuest Preview <invites@frontierrnd.com>`)
   - one random relay secret in both files:
     `s=$(openssl rand -hex 32); npm run env:update -- preview invite-email INVITE_RELAY_SECRET "$s"; npm run env:update -- preview supabase INVITE_RELAY_SECRET "$s"; unset s`
   - `npm run env:update -- preview supabase INVITE_RELAY_URL` (`https://langquest-invite-email-preview.<subdomain>.workers.dev/send-invite`)
   - `npm run env:update -- preview supabase PROJECTION_WORKER_SECRET "$(openssl rand -hex 32)"`
4. **Cloudflare.** Deploy each preview Worker once by hand
   (`npm run email:deploy:preview`, `npm run web:deploy:preview`), then
   connect each to the repository in Workers Builds as `docs/cloudflare.md`
   lists, with `DOTENV_PRIVATE_KEY_PREVIEW` as its only build secret.
5. **Supabase secrets.** `npm run supabase:secrets -- preview`.
6. **EAS.** Nothing to set: `deploy-preview.yml` runs on the first push to
   `develop` that touches the app. iOS internal builds install only on
   registered devices (`npx eas device:create`).

## Re-keying a file

When a file was encrypted with a key its environment's other files do not
use (the test lists it in `PENDING_REKEY`), recreate it with the right key:

1. Note its keys: `grep -oE '^[A-Z][A-Z0-9_]*=' <file>`.
2. Replace the file with the public key line of `apps/mobile/.env.<env>`
   only, and commit that.
3. Set each value again with `npm run env:update -- <env> <target> KEY`.
   A value that also lives in another file can be copied without showing it:
   `npm run env:update -- <env> <target> KEY "$(npx dotenvx get KEY -f <other file> -fk .env.keys)"`.
   A credential no one can read any more is regenerated (`npm run
   diag:access` rotates `DIAG_DATABASE_URL`).
4. Delete the file from `PENDING_REKEY` in `scripts/env-files.test.ts`.

## Rotating a key

After a leak, or when someone who held it leaves: decrypt every file of that
environment, delete their `DOTENV_PUBLIC_KEY_<ENV>` lines and the private key,
encrypt the first file again (a new pair is made), put the new public key in
the others and encrypt them, share the new private key, update the Workers
Builds secrets, and rotate the secrets themselves at their providers. Git
history still holds the old ciphertext, which the old key can read.
