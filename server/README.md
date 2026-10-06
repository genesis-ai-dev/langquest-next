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
  `language not listed yet`), `validate_payload`, then the next seq. The
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
- `scripts/record-parity-sql.ts` (`npm run db:parity`, part of `db:test`)
  holds `validate_payload`, `event_privilege` and `language_of_org_event` to
  core for every event type and its broken variants.

`smoke.sql` exercises all of it; `npm run db:test` resets the db and runs it.

Invitations, join requests, profiles, durable user state, public discovery,
and notification projections now have migrations and app consumers.
See [the rollout checklist](../docs/invitation-rollout.md) before deployment.
`accountSmoke.sql` uses isolated identifiers and rolls back its test writes.
Run it locally, not against production without explicit authorization.

`npm run worker:build` bundles `projectionEdge.ts` and the shared core for
the `stream-projections` Edge Function. Migration 20261006000001 schedules
it every five minutes wherever the Vault secrets `langquest_project_url` and
`langquest_projection_worker_secret` exist (production), and nowhere else;
it replaces the hand-run `schedule-projections.sql`. `npm run secrets` runs it
again after setting them, which is how preview gets its job. `select * from cron.job`
shows the one job, `net._http_response` its answers.
`send-invite` validates the caller and invite before contacting the
Cloudflare email Worker in `apps/invite-email`. The Worker sends through
its email binding as `LangQuest <invites@frontierrnd.com>`. A Durable Object
per invitation prevents concurrent and confirmed-delivery retries from
sending duplicates. Neither service logs invitation tokens.

Field diagnostics (`*_field_diagnostics.sql`, docs/diagnostics.md): schema
`diag`, not exposed by the API. Phones deliver content-free records through
`diag_ingest`; support reads them as `diag_reader` with `npm run diag`.
`diag-smoke.sql` covers it in `npm run db:test`.

Dashboard reports (decision 44) are not stored here. The dashboard's own
Worker (`apps/web/worker`) reads the server snapshots this worker writes and
the tail through `pull_events` with the service role, and computes the
reports itself (there are no report tables, decision 40 is superseded by 44). For local demo data, `npm run sample:org -- --history` adds
months of back-dated work to the sample org (local database only). Join it
in the dev app with one of the invite codes it prints, and sign in to the
dashboard (`npm run web:dev`) with the same account.

A language's name, country and target (decision 41) are organization-stream
events (`v1.LanguageRenamed`, `v1.LanguageCountrySet`, `v1.LanguageTargetSet`)
and need `manage_structure` for that language.

Reports and blocks (decision 48) are rows, not
events. Phones send them through the account outbox: `report_content` into
`content_reports`, `set_blocked` into `user_blocks` (each person reads only
their own). An organization's moderators list open reports with
`org_content_reports` (never who reported) and act with `remove_content`,
which appends `v1.Redacted` as them for every event holding the content, or
`dismiss_reports`; the projection worker puts a "Something was reported"
row in their Inbox. Staff see every report, with the reporter, through
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
the bundle is what gets deployed.

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

The integration does not set secrets. `npm run secrets -- <preview|production>`
sets the Edge Function secrets and the Vault secrets from the root
`.env.<environment>` and schedules the projection job (`docs/environments.md`);
run it after changing that file, and with `--check` to compare digests
without changing anything.

