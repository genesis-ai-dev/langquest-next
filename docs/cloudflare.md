# Cloudflare

Cloudflare Workers Builds deploys the invite-email Worker and the web app's
Worker, `langquest-next-dashboard`, which serves the app's web export and the
reports API (decisions.md 43, 58): merging to `main` deploys the production Workers, and
merging to `develop` deploys their `-preview` copies (decisions.md 50,
`docs/environments.md`). There is no GitHub Actions workflow and no API token
in GitHub. Cloudflare generates the build token. Builds have no secrets at
all: a deploy carries code and public `vars`, and the Worker keeps the
secrets `npm run secrets` set on it (decisions.md 51).

| | Invite email | Dashboard | Invite email preview | Dashboard preview |
| --- | --- | --- | --- | --- |
| Worker name | `langquest-next-invite-email` | `langquest-next-dashboard` | `langquest-next-invite-email-preview` | `langquest-next-dashboard-preview` |
| Root directory | repository root | repository root | repository root | repository root |
| Production branch | `main` | `main` | `develop` | `develop` |
| Non-production branch builds | off | off | off | off |
| Build command | | | | |
| Deploy command | `npm run email:deploy` | `npm run web:deploy` | `npm run email:deploy:preview` | `npm run web:deploy:preview` |
| Build variables and secrets | none | none | none | none |
| Include paths | `apps/invite-email/*`, `package.json`, `package-lock.json`, `scripts/cloudflare-deploy.mjs` | `apps/web/*`, `apps/mobile/*`, `packages/core/*`, `packages/client/*`, `package.json`, `package-lock.json`, `scripts/cloudflare-deploy.mjs` | as invite email | as dashboard |

Leave the default dependency install on. The web app's deploy command builds
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
Worker's, add `"name": "langquest-next-dashboard-preview"` (or the invite-email
one) to `env.preview`; it is the name `--env=preview` already deploys.

The token Cloudflare creates has Workers Scripts edit but no email
permission. If an invite-email deploy is refused for its `send_email`
binding, add Email Sending edit to that token (My Profile > API Tokens).

| Worker | Public `vars` (wrangler file) | Secrets (`npm run secrets`) |
| --- | --- | --- |
| invite email | `INVITE_FROM` | `INVITE_RELAY_SECRET` |
| dashboard | `SUPABASE_URL` | `SUPABASE_SERVICE_ROLE_KEY` |

A deploy fails while a secret in `secrets.required` is missing on the
Worker; run `npm run secrets -- <environment>`. The dashboard page reads
`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` from the
plain `apps/mobile/.env.<environment>` at build time.

Guardrails still typecheck (both Workers included) and test every pull
request and every push to `develop` and `main`. Workers Builds does not wait
for that job.
