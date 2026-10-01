# Cloudflare

Merging to `main` deploys the invite-email Worker and the dashboard through
Cloudflare Workers Builds (decisions.md 43). There is no GitHub Actions
workflow and no API token in GitHub. Cloudflare generates the build token.
The only secret set on each Worker's build is `DOTENV_PRIVATE_KEY_PRODUCTION`,
the private key that decrypts `apps/mobile/.env.production`. The worker env
files use that same public key.

| | Invite email | Dashboard |
| --- | --- | --- |
| Worker name | `langquest-invite-email` | `langquest-dashboard` |
| Root directory | repository root | repository root |
| Production branch | `main` | `main` |
| Preview builds | off | off |
| Build command | | |
| Deploy command | `npm run email:deploy` | `npm run web:deploy` |
| Build secret | `DOTENV_PRIVATE_KEY_PRODUCTION` | `DOTENV_PRIVATE_KEY_PRODUCTION` |
| Include paths | `apps/invite-email/*`, `package.json`, `package-lock.json`, `scripts/cloudflare-deploy.mjs` | `apps/web/*`, `packages/core/*`, `packages/client/*`, `apps/mobile/.env.production`, `package.json`, `package-lock.json`, `scripts/cloudflare-deploy.mjs` |

Leave the default dependency install on. Preview builds stay off: a branch build would deploy production settings.
The token Cloudflare creates has Workers Scripts edit but no email
permission. If the invite-email deploy is refused for its `send_email`
binding, add Email Sending edit to that token (My Profile > API Tokens).

Runtime settings are not typed into Cloudflare. `npm run email:deploy` and
`npm run web:deploy` decrypt the env file and upload every key in it as a
secret with the deploy (`--secrets-file`), so no value reaches the command
line or the build log. Each key must be listed in the wrangler file's
`secrets.required`, which is also where `wrangler types` finds it. The deploy
stops if the env file holds a key the wrangler file does not list, or lacks
one it does.

| Worker | Env file | Keys |
| --- | --- | --- |
| invite email | `apps/invite-email/.env.production` | `INVITE_FROM`, `INVITE_RELAY_SECRET` |
| dashboard | `apps/web/.env.production` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

The dashboard page still reads `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_ANON_KEY` from `apps/mobile/.env.production` at build
time. `npm run web:secrets -- fetch` fills the dashboard file from the linked
project. Set the relay secret with
`npm run env:set -- INVITE_RELAY_SECRET -f apps/invite-email/.env.production`
after that file carries the same `DOTENV_PUBLIC_KEY_PRODUCTION` line.

Guardrails still typecheck (both Workers included) and test every pull
request and merge. Workers Builds does not
wait for that job.
