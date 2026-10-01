# Cloudflare

Cloudflare Workers Builds deploys the invite-email Worker and the dashboard
(decisions.md 43): merging to `main` deploys the production Workers, and
merging to `develop` deploys their `-preview` copies (decisions.md 49,
`docs/environments.md`). There is no GitHub Actions workflow and no API token
in GitHub. Cloudflare generates the build token. Each Worker's one build
secret is the dotenvx private key of its environment, which decrypts that
environment's env files.

| | Invite email | Dashboard | Invite email preview | Dashboard preview |
| --- | --- | --- | --- | --- |
| Worker name | `langquest-invite-email` | `langquest-dashboard` | `langquest-invite-email-preview` | `langquest-dashboard-preview` |
| Root directory | repository root | repository root | repository root | repository root |
| Production branch | `main` | `main` | `develop` | `develop` |
| Non-production branch builds | off | off | off | off |
| Build command | | | | |
| Deploy command | `npm run email:deploy` | `npm run web:deploy` | `npm run email:deploy:preview` | `npm run web:deploy:preview` |
| Build secret | `DOTENV_PRIVATE_KEY_PRODUCTION` | `DOTENV_PRIVATE_KEY_PRODUCTION` | `DOTENV_PRIVATE_KEY_PREVIEW` | `DOTENV_PRIVATE_KEY_PREVIEW` |
| Include paths | `apps/invite-email/*`, `package.json`, `package-lock.json`, `scripts/cloudflare-deploy.mjs`, `scripts/env-files.mjs` | `apps/web/*`, `packages/core/*`, `packages/client/*`, `apps/mobile/.env.production`, `package.json`, `package-lock.json`, `scripts/cloudflare-deploy.mjs`, `scripts/env-files.mjs` | as invite email | as dashboard, with `apps/mobile/.env.preview` |

Leave the default dependency install on. Non-production branch builds stay
off on every Worker: build secrets apply to every branch a Worker builds, so a
branch build would hand that Worker's key to code no one has reviewed.

The preview Workers are the `env.preview` section of each wrangler file
(bindings and `secrets.required` are not inherited, so they are repeated
there). Deploy each once by hand before connecting it, so the Worker exists:
`npm run email:deploy:preview`, `npm run web:deploy:preview`. If Workers
Builds refuses the deploy because the wrangler file's top-level `name` is not
the connected Worker's, add `"name": "langquest-dashboard-preview"` (or the
invite-email one) to `env.preview`; it is the name `--env preview` already
deploys.

The token Cloudflare creates has Workers Scripts edit but no email
permission. If an invite-email deploy is refused for its `send_email`
binding, add Email Sending edit to that token (My Profile > API Tokens).

Runtime settings are not typed into Cloudflare. The deploy commands decrypt
the Worker's env file and upload every key in it as a secret with the deploy
(`--secrets-file`), so no value reaches the command line or the build log.
The env file's name picks the environment: `.env.production` deploys the
top level of the wrangler file, `.env.preview` its `env.preview`. Each key
must be listed in that environment's `secrets.required`, which is also where
`wrangler types` finds it. The deploy stops if the env file holds a key the
wrangler file does not list, lacks one it does, or is encrypted with another
environment's key.

| Worker | Env files | Keys |
| --- | --- | --- |
| invite email | `apps/invite-email/.env.production`, `.env.preview` | `INVITE_FROM`, `INVITE_RELAY_SECRET` |
| dashboard | `apps/web/.env.production`, `.env.preview` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

The dashboard page reads `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_ANON_KEY` from `apps/mobile/.env.<environment>` at build
time. `npm run web:secrets -- fetch <environment>` fills the dashboard and app
files from that environment's Supabase project. Set the other keys with
`npm run env:update -- <environment> invite-email KEY`. The relay secret must
equal the one in `supabase/.env.<environment>`; `npm run supabase:secrets`
checks it.

Guardrails still typecheck (both Workers included) and test every pull
request and every push to `develop` and `main`. Workers Builds does not wait
for that job.
