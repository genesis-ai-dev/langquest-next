# server

Local Supabase (Postgres) runs via colima. The repository also links to a
hosted project; local migrations and hosted deployment are separate steps.

The schema is one baseline migration,
`supabase/migrations/20261006000000_baseline.sql` (decision 63, which reset
the databases and squashed the 32 migrations before it), plus the
projection schedule beside it. Later changes are new migrations as before.

- Streams (decision 63): the organization stream (`stream_id = '_org'`), one
  stream per language (`stream_id` = the language's id), and a person's
  stream (org `'_person'`, stream = profile id, written only by
  `record_user_event`).
- `events`: append-only. Triggers refuse UPDATE and DELETE for every role,
  with no exception. Indexes per PLAN.md section 5.
- `stream_cursors`: one row per stream; the append RPC locks it, which
  serializes writes per stream and only per stream.
- `snapshots`: keyed by org, stream, reducer version, server_seq.
- `org_roles`, `org_memberships`, `languages`, the library tables: the only
  folds on the write path, kept by `_apply_org_event` in the same
  transaction as the organization-stream events they come from, with core's
  tie-break (later clock, then event id), so they equal a fold of the log.
- `append_events(jsonb[])`: the entire synchronous write path. Per event:
  envelope, caller is `actorId`, idempotency (a duplicate id returns its
  seq), clock no further ahead than `server_config.clock_ahead_tolerance_ms`
  (`clock ahead: server time <ms>`), authorization (`may_emit`), the language
  gate (a language stream accepts events only once `LanguageAdded` lists it:
  `language not listed yet`), `validate_payload`, then, under the stream's
  lock, the id again (a resend still in flight when the first check ran is
  a duplicate too: `concurrentAppendSmoke.sql`), the entity id, and the
  next seq. The
  organization's creator may bootstrap it while it has no members
  (`OrgCreated`, `RoleDefined`, their own org-scope `MemberAdded`).
- Authorization: `event_privilege` (core `EVENT_PRIVILEGE`) against
  `org_privileges(org, profile, language)`, the union of the org-scope role
  and that language's role. Organization-stream events about one language
  (rename, country, target, a language-scope membership or invite) are
  authorized for that language (`language_of_org_event`); the rest need org
  scope. `can_read_stream` gates every read; `my_privileges(org, language)`
  lets a screen hide edits the server would refuse.
- `pull_events(org, stream, after, limit)`: bounded, ordered page for readers.
- `scripts/record-parity-sql.ts` (part of `npm run db:test`; `node scripts/db-test.mjs --parity` alone)
  holds `validate_payload`, `event_privilege` and `language_of_org_event` to
  core for every event type and its broken variants.

`smoke.sql` exercises all of it; `npm run db:test` resets the db and runs it.

Invitations, join requests, profiles, durable user state, public discovery,
and notification projections now have migrations and app consumers.
See [the rollout checklist](../docs/invitation-rollout.md) before deployment.
`accountSmoke.sql` uses isolated identifiers and rolls back its test writes.
Run it locally, not against production without explicit authorization.

The projection pass (`server/projectionWorker.ts`: Inbox rows, the public
listing, server snapshots and each language's report inputs, decisions.md
68 and 142) runs for every language in the job container behind the
app's Worker, every five minutes, with `server/projections.ts`,
started by the Worker's job tick through the `JobRunner` Durable Object
(`apps/web/worker/jobs.ts`, `docs/server-jobs.md`, decisions.md 141). It
skips languages that have not changed (`projection_marks`).
A local stack runs it the same way: `npm run web:dev` (and `dev:local`)
fires the job tick every minute (`scripts/job-tick.mjs`, decisions.md 148),
so the pass needs the Worker and Docker running; a database alone gets no
Inbox rows from work, listings or snapshots.
`npm run worker:build` bundles `pushDeliveryEdge.ts` and `pushDelivery.ts`
for the `push-delivery` Edge Function, which sends what the database queued
for phones every minute (decisions.md 68). Migration
`20261020170000_push_delivery_secret.sql` schedules that wherever the
Vault secrets `langquest_project_url` and
`langquest_push_delivery_secret` exist, and keeps the pass off pg_cron;
`npm run secrets` sets them and runs it again, which is how preview and
production get the job. Locally, `npm run db:start` and `npm run db:reset`
do the same (`scripts/local-db.mjs`: a local secret in the ignored
`supabase/functions/.env`, the Vault values) and seed the library when there
is none. `npm run db:test` resets with `supabase db reset` directly, so no
push job runs under its smokes; stop a running `web:dev` first, or its pass
will. `select * from cron.job` shows the jobs, `net._http_response` their
answers.
`send-invite` validates the caller and invite before contacting the
Cloudflare email Worker in `apps/invite-email`. The Worker sends through
its email binding as `LangQuest <invites@frontierrnd.com>`. A Durable Object
per invitation prevents concurrent and confirmed-delivery retries from
sending duplicates. Neither service logs invitation tokens.

Field diagnostics (`*_field_diagnostics.sql`, docs/diagnostics.md): schema
`diag`, not exposed by the API. Phones deliver content-free records through
`diag_ingest`; support reads them as `diag_reader` with `npm run diag`.
`diag-smoke.sql` covers it in `npm run db:test`.
The server's own jobs leave one content-free row per run in `diag.job_runs`
(`*_diag_jobs.sql`): the projection passes, push delivery, the v2 import,
webhook dispatch, invite email, and the app's Worker's cron and request
tally. They write through `public.diag_job_ingest` (service role only) with
`server/jobRuns.ts`, which gives up after three seconds and never fails the
job. `diag.jobs()` says which are stale or failing; `diag.job_schedule`
holds each job's schedule, so change it with the file that sets the cron.

Reports (decision 44) are not stored here, only what each
language's report is made from (`language_report_inputs`, decision 142),
which the app's Worker (`apps/web/worker`) renders for the day. It
folds a language itself, from the server snapshots this worker writes and
the tail through `pull_events` with the service role, only when no row is
stored yet, and for the access-token API (there are no report tables,
decision 40 is superseded by 44). For local demo data, `npm run sample:org -- --history` adds
months of back-dated work to the sample org (local database only). Join it
in the dev app with one of the invite codes it prints, and sign in to the
web app (`npm run web:dev`) with the same account.

A language's name, country and target (decision 41) are organization-stream
events (`v1.LanguageRenamed`, `v1.LanguageCountrySet`, `v1.LanguageTargetSet`)
and need `manage_structure` for that language.

Reports and blocks (decision 48) are rows, not
events. Phones send them through the account outbox: `report_content` into
`content_reports`, `set_blocked` into `user_blocks` (each person reads only
their own). An organization's moderators list open reports with
`org_content_reports` (never who reported) and act with `remove_content`,
which appends `v1.Redacted` as them for every event holding the content, or
`dismiss_reports`; the database puts a "Something was reported" row in
their Inbox when the report arrives (`refresh_org_notifications`,
decisions.md 68). Staff see every report, with the reporter, through
`npm run moderation` (`--hosted` for the hosted project, through the
Supabase CLI login): `remove <id>` and `dismiss <id>` call
`staff_resolve_report`, and `suspend <profileId>` sets `banned_until` on the
sign-in. Check the queue at least daily; the terms promise action within 24
hours. Removed audio stays in the bucket (PLAN.md section 14, known gap).
`moderation-smoke.sql` covers it in `npm run db:test`.

Still deferred: profile photos, and the remaining content/audio gaps in
the flow audit.

## Deploying

Merging to `main` deploys the hosted project through Supabase's GitHub
integration (decisions.md 42). No token is stored in GitHub. It applies new
migrations and deploys the functions and storage buckets declared in
`supabase/config.toml`; auth, API and seed settings are not pushed by it.
The guardrails `checks` job refuses a worker bundle behind its source, since
the bundle is what gets deployed. Nobody rebuilds it by hand: the
`pre-commit` and `post-merge` hooks in `.githooks` (enabled by
`npm install`) run `npm run worker:build` when a commit or a merge commit
changes what it is built from, and add the result to it. A rebase, or a
commit made with `--no-verify`, skips them; the guardrails check then says
to run `npm run worker:build`.

The integration's settings live in the Supabase dashboard (Project Settings,
Integrations, GitHub), so they are recorded here. Change them there and here
together:

| Setting | Value |
| --- | --- |
| Repository | `genesis-ai-dev/langquest-next` |
| Working directory | `.` |
| Deploy to production | on, branch `main` |
| Persistent branch | `develop`, following git branch `develop`: the preview environment (`docs/environments.md`, decisions.md 50) |
| Automatic branching | on, limit 3, Supabase changes only (preview branch compute is billed outside the spend cap) |

`npm run db:check` shows whether the hosted migrations match `main`;
`npm run db:apply` still applies them by hand.

### Auth settings in production

The integration does not push auth settings, so production's live in the
dashboard (Authentication) and are recorded here. People are offline for
months (decisions.md 87): any limit on how long a session lasts signs them
out at their next moment online, so these stay as they are. Checked by
Caleb Koster on 2026-10-12.

| Setting (Authentication → Sessions) | Value | Why |
| --- | --- | --- |
| Enforce single session per user | off | A second device would end the first |
| Time-box user sessions | 0 (never) | Would sign everyone out a set time after signing in |
| Inactivity timeout | 0 (never) | Would sign out exactly the people who are offline longest |
| Access token expiry time | 3600 seconds | The app no longer depends on it offline (87) |
| Detect and revoke potentially compromised refresh tokens | on | A renewal whose reply was lost is still accepted |
| Refresh token reuse interval | 10 seconds | Supabase's recommendation |

Rate limits (Authentication → Rate Limits) are Supabase's defaults. A 429
on renewal no longer ends a sign-in (87), so they only slow a renewal down.

The integration does not set secrets. `npm run secrets -- <preview|production>`
sets the Edge Function secrets and the Vault secrets from the root
`.env.<environment>` and schedules the projection job (`docs/environments.md`);
run it after changing that file, and with `--check` to compare digests
without changing anything.

