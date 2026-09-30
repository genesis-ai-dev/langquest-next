# server

Local Supabase (Postgres) runs via colima. The repository also links to a
hosted project; local migrations and hosted deployment are separate steps.

Implemented in `supabase/migrations/20260914000001_event_log.sql`:

- `events`: append-only. Triggers refuse UPDATE and DELETE for every role.
  Indexes per PLAN.md section 5.
- `snapshots`: keyed by org, project, reducer version, server_seq.
- `partition_cursors`: one row per project; the append RPC locks it, which
  serializes writes per project and only per project.
- `member_role(org, project, profile)`: the project's `memberships` row
  (maintained by `append_events` from the three member events, migration
  000008), else the fixed role the caller's org privileges amount to
  (`effective_role_of(org_privileges(...))`, migration 000009).
- `memberships`, `org_roles`, `org_memberships`: the only folds on the write
  path, kept as rows in the same transaction as the events they come from,
  always derivable from the log (backfilled on migration).
- Org partition `project_id = '_org'` (migration 000009): `OrgCreated`,
  `RoleDefined`, `RoleRetired`, `OrgMemberAdded/Removed` with a scope (org,
  project, lane), `CatalogItemToggled`, `ProjectRegistered`. `may_emit`
  checks the event's privilege (`event_privilege`, same table as core
  `EVENT_PRIVILEGE`) against the caller's privileges over the partition.
- Step 11 events (migration 000010): `LaneTemplateSelected`,
  `LaneFlowSelected`, `WorkflowStepSet/Removed`, `ReviewTeamDefined`,
  `ReviewTeamMemberSet`, `ResponseRecorded`, `ReviewCommentRecorded`;
  translators may respond, reviewers may comment.
- Step 12 events (migration 000011): `MaterialDefined` (translators only
  for kind `questions`), `MaterialFieldSet`, `MaterialLocked`,
  `StepQuestionSetLinked`, `KeyTerm*`. The fixed-role gate is now
  `role_may_emit_event`: the event's privilege (payload included) must be in
  `fixed_role_privileges(role)`, the SQL twin of core `SEED_ROLES`.
- Long-offline rules (migration 000008): events stamped more than
  `server_config.clock_ahead_tolerance_ms` ahead of server time are refused
  with `clock ahead: server time <ms>`; an actor without a role now is still
  accepted if `member_role_at(..., event hlc)` allowed it within
  `server_config.asof_window_ms`.
- `append_events(jsonb[])`: the entire synchronous write path. Checks the
  caller matches `actorId`, checks membership and role-to-event-type
  permission, assigns `server_seq`, inserts. Duplicate ids return the existing
  seq. Bootstrap exception: an empty project accepts `ProjectCreated` and
  `MemberAdded`.
- `pull_events(org, project, after, limit)`: bounded, ordered page for members.

`smoke.sql` exercises all of it; `npm run db:test` resets the db and runs it.

Invitations, join requests, profiles, durable user state, public discovery,
and notification projections now have migrations and app consumers.
See [the rollout checklist](../docs/invitation-rollout.md) before deployment.
`accountSmoke.sql` uses isolated identifiers and rolls back its test writes.
Run it locally, not against production without explicit authorization.

`npm run worker:build` bundles `projectionEdge.ts` and the shared core for
the `project-projections` Edge Function. Schedule only one projection job.
`schedule-projections.sql` reads its URL and worker credential from Vault.
`send-invite` validates the caller and invite before contacting the
Cloudflare email Worker in `apps/invite-email`. The Worker sends through
its email binding as `LangQuest <invites@frontierrnd.com>`. A Durable Object
per invitation prevents concurrent and confirmed-delivery retries from
sending duplicates. Neither service logs invitation tokens.

Field diagnostics (`*_field_diagnostics.sql`, docs/diagnostics.md): schema
`diag`, not exposed by the API. Phones deliver content-free records through
`diag_ingest`; support reads them as `diag_reader` with `npm run diag`.
`diag-smoke.sql` covers it in `npm run db:test`.

Dashboard reports (migration 20260930000000, decision 40): each projection
pass also writes `lane_reports` (one core `laneReports` row per language,
skipped when the partition, `REPORT_VERSION` and day are unchanged) and
today's `lane_report_days` point. Authenticated members read the rows
`may_view_lane` allows (`view_status` at org, partition or that language);
only the service role writes. `apps/web` reads them. For local demo data,
`npm run sample:org -- --history` adds months of back-dated work to the
sample org (local database only). Join it in the dev app with one of the
invite codes it prints, and sign in to the dashboard with the same account.

A language's country and target (migration 20260930000001, decision 41):
`v1.LaneCountrySet` and `v1.LaneTargetSet` need `manage_structure`;
`validate_payload` and `event_privilege` wrap the versions before it
(kept as `_validate_payload_before_20260930`, `_event_privilege_before_20260930`).
`my_privileges(org, project, lane)` returns the caller's own privileges so
the dashboard can hide edits the server would refuse.

Still deferred: profile photos, and the remaining content/audio gaps in
the flow audit.
