# 43. Merging to main deploys the Cloudflare workers

Date: 2026-09-30 · By: Carl Sauder · Status: accepted

Reason: the invite-email worker and the dashboard reached Cloudflare only
when someone ran `npm run email:deploy` or `npm run web:deploy`. The app
already ships on merge to TestFlight, and the database ships through
Supabase's GitHub integration (decisions.md 42).
`.github/workflows/deploy-cloudflare.yml` runs the pre-push typecheck and
tests, then those two commands, and only the worker whose inputs changed:
invite email for `apps/invite-email/**`, the dashboard for `apps/web/**`,
`packages/core/**`, `packages/client/**` and the lockfile. The workflow has
its own concurrency group and does not cancel an in-progress run, so a
second merge waits instead of stopping a deploy halfway. It authenticates
with a Cloudflare API token repository secret. The dashboard build also
needs `DOTENV_PRIVATE_KEY_PRODUCTION` to decrypt the production env file.
Reverse if: a token-free Cloudflare integration can split those two workers
by path and queue a later push behind one already deploying (a token expires
and belongs to one person, the same problem as the Supabase workflow in 42),
or a staging worker is added and production should follow a release.

Amended (2026-09-30, Carl Sauder): Cloudflare Workers Builds deploys both
workers, and `.github/workflows/deploy-cloudflare.yml` is gone. Cloudflare
generates the build token, so nothing is stored in GitHub. Runtime settings
live in encrypted env files (`apps/invite-email/.env.production`,
`apps/web/.env.production`) that share the production public key with
`apps/mobile/.env.production`. The only secret on each Worker's build is
`DOTENV_PRIVATE_KEY_PRODUCTION`. `npm run email:deploy` and `npm run web:deploy`
decrypt that file and upload every key as a Worker secret with the deploy,
public ones too, so no value is printed in the build log; each key is listed
in the wrangler file's `secrets.required`. Watch paths, so an
email change does not build the dashboard, are recorded in `docs/cloudflare.md`.
Guardrails still runs the typecheck and tests; the build does not wait for it.

Amended (2026-10-01, Carl Sauder): each Worker has a `-preview` copy
(`env.preview` in its wrangler file) that Workers Builds deploys from
`develop` with `apps/<worker>/.env.preview` and `DOTENV_PRIVATE_KEY_PREVIEW`
as its only build secret (decisions.md 50). Branch builds stay off on all
four Workers, because a Worker's build secret reaches every branch it builds.

Amended (2026-10-01, Carl Sauder): deploys no longer upload secrets and no
Worker build holds a key. Public settings are wrangler `vars`, and
`npm run secrets` sets each Worker's secrets, which stay across deploys
(decisions.md 51).
