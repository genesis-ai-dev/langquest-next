# packages/sync

Keeps the data and moves it (decisions.md 104): `packages/core` says what it
means. Sync owns anything queued for the server: the local event log, push
and pull (`syncClient.ts`, the protocol in `docs/sync-protocol.md`),
snapshots, file transfer (`transferWorker.ts`, the rules in
`docs/blobs.md`), the account outbox, a shared phone's hand-overs,
diagnostics delivery, nearby sync, and the per-language session that runs
them (`languageSession.ts`).

- It runs wherever data is kept or moved: the phone, the Worker, server jobs
  and scripts.
- It imports only core, supabase-js and its own files
  (`test/boundary.test.ts`). A platform gets in as a constructor argument:
  expo-sqlite drivers, file stores, `AsyncStorage` and configured clients
  live in the app that uses them, which never reimplements sync.
- What only servers run (snapshot worker, blob reconciler, R2 files, stream
  list, per-unit cut) is `@langquest-next/sync/server`. Server code imports
  packages by their entry, never `packages/*/src` or `apps/mobile/src` (lint
  holds it).
- Sync status is a column on the events table, not a second table (PLAN.md
  invariant 7).
