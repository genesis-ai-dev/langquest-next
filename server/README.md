# server

Local Supabase (Postgres) via colima. Never linked to a hosted project.

Implemented in `supabase/migrations/20260914000001_event_log.sql`:

- `events`: append-only. Triggers refuse UPDATE and DELETE for every role.
  Indexes per PLAN.md section 5.
- `snapshots`: keyed by org, project, reducer version, server_seq.
- `partition_cursors`: one row per project; the append RPC locks it, which
  serializes writes per project and only per project.
- `member_role(org, project, profile)`: the membership fold, latest HLC wins
  over the three member events. This is the only fold on the write path.
- `append_events(jsonb[])`: the entire synchronous write path. Checks the
  caller matches `actorId`, checks membership and role-to-event-type
  permission, assigns `server_seq`, inserts. Duplicate ids return the existing
  seq. Bootstrap exception: an empty project accepts `ProjectCreated` and
  `MemberAdded`.
- `pull_events(org, project, after, limit)`: bounded, ordered page for members.

`smoke.sql` exercises all of it; `npm run db:test` resets the db and runs it.

Not yet built: snapshot worker, org dashboard fold, blob storage, integrity
check. All async, all consumers of `events`.
