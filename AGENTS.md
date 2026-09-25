# Sync integrity is the highest-priority application contract

**Never require a client upgrade to upload, download, or preserve project events.**
**An event log is durable history. A reducer or snapshot is only a disposable view.**

Read [docs/sync-integrity.md](docs/sync-integrity.md) and PLAN.md section 4
before changing events, sync, storage, snapshots, migrations, or release code.

## Non-negotiable rules for every agent and every release

- Never gate append/pull on app, client-protocol, event-schema, or reducer version.
  Never raise `server_config.min_client_version`. Its database constraint keeps it zero.
- New event types may need new UI. They must not disable unrelated work or sync.
- Preserve unfamiliar event types and their full payloads in the raw log.
  A reducer may ignore an unfamiliar fact; transport and storage must not.
- Never change a shipped event's meaning or required fields. Add a new versioned
  event instead. Keep old event validators and RPC signatures working.
  Preserve error codes and classification prefixes that installed clients use.
- Never delete raw events because a checkpoint or projection contains their effects.
  Never advance a raw-log cursor from a snapshot's sequence number.
- Commit a downloaded page and its cursor atomically. An interrupted transfer
  must retry safely. Preserve pending and rejected work across upgrades and restarts.
- Reducer versions invalidate caches only. Rebuild from retained events, including
  formerly unfamiliar events. Legacy pruned installations must backfill from the
  server without deleting their outbox. Never retain a cursor beyond missing history.
- Keep authentication, membership, server-side privileges, payload validation,
  immutable identities, and per-event refusal reasons. Version tolerance is not
  permission to accept arbitrary or unauthorized writes.
- If an older UI cannot safely perform a new operation, validate/refuse that
  operation specifically. Do not block a project, an outbox, or the entire transport.
- Keep the canonical server log. Old snapshots and clients must never overwrite
  it or become the only surviving copy of facts they cannot interpret.

## Required release evidence

Tests must cover old/new client coexistence, unfamiliar event round-tripping,
checkpoint retention, restart, offline reducer upgrades, interrupted page commits,
legacy backfill with pending work, and unchanged authorization/payload rejection.
Run `npm test`, `npm run typecheck`, and `npm run typecheck -w mobile`.
Run `server/syncIntegritySmoke.sql` in an isolated migrated database for SQL changes.
Also run existing server regression suites; legacy error responses are contracts.
A passing new-client happy path alone is not evidence of sync compatibility.

## Repository architecture

- Read PLAN.md before implementation. Its invariants apply to every change.
- `packages/core` is pure TypeScript with no I/O. Status is derived.
- `packages/client` owns sync through EventStore and Transport interfaces.
- Every new event requires type, validation, reducer, permission, and permutation tests.
- Follow the avatar UI rules in `docs/ux/README.md` for mobile screens.
- Preserve unrelated work. Freeze a reviewed release snapshot before native builds
  when other tasks are editing this workspace.
