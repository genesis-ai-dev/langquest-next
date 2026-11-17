# 22. One sync client, two folds

Date: 2026-09-15 · By: Ryder Wishart · Status: accepted

Reason: the org partition (roles, memberships, catalog, projects) needs the
same log, outbox, cursor, checkpoint and snapshot handling as a project, and
a different reducer. `SyncClient` takes a `Materializer` (empty, apply, fold,
compact, version); the project one is the default and the org one lives in
core `org.ts`. Reverse if: never; a second sync path is the kind of surface
PLAN.md section 2 exists to avoid.
