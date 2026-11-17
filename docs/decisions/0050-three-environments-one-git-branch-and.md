# 50. Three environments, one git branch and one dotenvx key each; preview is a persistent stack fed by `develop`

Date: 2026-10-01 · By: Carl Sauder · Status: partly superseded by 51

Reason: the team needs development, preview and production, and until now
preview builds and the dashboard pointed at the production project. Preview
cannot be per pull request. Supabase's automatic branches get a new URL for
each pull request, which neither an installed preview build nor the dashboard
can follow, and Cloudflare makes no version URLs for Workers that hold a
Durable Object, which both of ours do. So preview is a persistent stack fed
by a `develop` branch. Pull requests merge to `develop`, and a release pull
request from `develop` to `main` deploys production, as 42 and 43 anticipated.
Each platform's own git integration does the deploying, so GitHub still
holds no token. Supabase has a persistent branch `develop`. Workers Builds
has `langquest-dashboard-preview` and `langquest-invite-email-preview`, the
`env.preview` of each wrangler file. EAS has
`.eas/workflows/deploy-preview.yml` on the `preview` channel. Secrets use one
dotenvx key pair per environment, shared by every file of that environment,
because dotenvx names the private key after the file's suffix. Per-target
keys would add little: the dashboard Worker already holds the service-role
key at run time. Each deploy target keeps its own file
(`apps/mobile`, `apps/web`, `apps/invite-email`, `supabase`), so a platform
receives only its own keys. That matters most for EAS, whose values end up
in the app bundle. `scripts/env-files.test.ts` refuses a file encrypted with
another key. The production key lives only with maintainers and on the two
production Workers, and the preview key only with developers and the two
preview Workers. A Workers Builds secret reaches every branch the Worker
builds, so branch builds stay off. Supabase gets its secrets from
`npm run supabase:secrets`, which pushes Edge Function secrets, writes the
Vault secrets and schedules the projection job, comparing digests. We do not
use Supabase's own dotenvx support, for three reasons: it would need a
private key stored as a project secret, where every Edge Function can read
it; it is documented for preview branches only; and encrypted values on
persistent branches have a reported bug (supabase/cli#3742). The preview
branch is built from migrations alone, and the scheduling migration
(decision 42) skips a database without the Vault secrets, so
`npm run secrets` runs that migration's body again after writing them. The setup and the commands are in
`docs/environments.md`.
Reverse if: releasing through `develop` delays fixes more than preview
catches problems (then go back to merging straight to `main`, with preview
following it); Supabase deploys dotenvx secrets reliably for persistent
branches and production (then declare them in `config.toml`
`[edge_runtime.secrets]` and `[db.vault]` and drop the script); or Workers
Builds gets per-branch secrets (then a single Worker could serve both
environments).

Amended (2026-10-01, Carl Sauder): the Workers are named after this app,
`langquest-next-dashboard` and `langquest-next-invite-email` (and their
`-preview` copies), so they cannot be taken for LangQuest v2's in the same
Cloudflare account. The dashboard had never been deployed; the invite-email
Worker moved to the new name and the relay URL with it.
