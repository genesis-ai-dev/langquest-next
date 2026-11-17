# 42. Merging to main deploys the hosted database and Edge Functions

Date: 2026-09-30 · By: Caleb Koster · Status: accepted

Reason: merges to `main` already ship the app to TestFlight, but migrations
and the projection worker only reached the hosted project when someone ran
`npm run db:apply` and deployed the functions by hand. The license and
diagnostics migrations sat merged but unapplied, while the app and a rebuilt
worker bundle that expect them were on their way out. Now
`.github/workflows/deploy-supabase.yml` runs on every merge that touches the
database, the functions or the core the worker bundles: the typecheck and
tests, a check that the committed worker bundle matches its source, then
`supabase db push` and only after it `supabase functions deploy`, so a worker
never writes to a column its migration has not made. It authenticates with
one personal access token as a repository secret; the CLI pushes through a
temporary login role, so no database password is stored. Preview and
production builds point at the same hosted project, so there is one target.
Reverse if: a separate staging project is added (then merges deploy there
and production follows a release), or a migration needs a manual step or
cannot be applied while the app is live.

Amended (2026-09-30, Caleb Koster): Supabase's GitHub integration now does the
deploy, and `.github/workflows/deploy-supabase.yml` is gone. The workflow
needed a personal access token, which expires within a year, belongs to one
person, and on first use lacked database write access. The integration
authenticates through Supabase's GitHub app, so nothing is stored in GitHub
and nothing expires. Its settings live in the dashboard and are recorded in
`server/README.md` (Deploying). The worker bundle check moved into the
guardrails `checks` job. Unconfirmed: that it applies migrations before it
deploys functions; the worker must keep tolerating a migration that has not
landed yet.

Amended (2026-10-01, Caleb Koster): the projection worker's schedule is now a
migration (`20261001000000_schedule_projections.sql`), so merging schedules
it too. It had been a script someone ran by hand, and production never got
it: no snapshots and no server Inbox rows or pushes until it was run on
2026-10-01. The migration enables `pg_cron` and `pg_net` and schedules the
job only where the Vault secrets exist, so local databases and preview
branches stay unscheduled.

Amended (2026-10-01, Carl Sauder): there are now two targets. Merging to
`main` still deploys production; merging to `develop` deploys a persistent
Supabase branch `develop`, the preview environment (decisions.md 50). Secrets
are not part of the integration's deploy: `npm run secrets` sets the Edge
Function and Vault secrets (decisions.md 51).

Amended (2026-10-06, Carl Sauder): the schedule is now
`20261006000001_schedule_projections.sql`, beside the baseline that replaced
the earlier migrations (63), and the worker is the `stream-projections`
Edge Function (job `langquest-stream-projections`; the old job is
unscheduled). Reset databases have no migration history to repair.

Amended (2026-10-06, Carl Sauder): the local stack runs the worker too, every
minute. `npm run db:start` and `npm run db:reset` (`scripts/local-db.mjs`)
write a local-only secret to the ignored `supabase/functions/.env`, set the
two Vault values in the local database and run the schedule migration, as
`npm run secrets` does on a hosted one, and seed the library when there is
none. Testing on simulators against a local database had no server Inbox rows
or snapshots, and we want no extra command to bring a local environment up.
It is not in `seed.sql`: preview branches run that too, where local values
would be wrong; and `npm run db:test` resets with plain `supabase db reset`,
since its smokes count snapshots and Inbox rows.
