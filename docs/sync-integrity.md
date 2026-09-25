# Version-independent sync

Sync integrity takes precedence over release convenience. An authorized client
can continue uploading its supported events and downloading project history,
regardless of the app or reducer version. New features can require new UI;
they cannot require a global sync cutover. AGENTS.md makes this mandatory.

## Three independent contracts

1. Transport authenticates callers and preserves event envelopes and payloads.
   Append remains idempotent. Pull is ordered and paginated by server sequence.
   The legacy client-version parameter stays accepted, including zero or null.
2. Event schemas describe facts. Shipped schemas and semantics stay supported.
   Introduce a new versioned type instead of changing an existing payload.
   The server still rejects unauthorized, malformed, or unsupported writes.
3. Reducer versions describe disposable caches. An unfamiliar event can have no
   visible effect in an older UI while remaining intact in storage and transport.
   A newer reducer can interpret it later. A version change invalidates caches,
   never the outbox, raw log, membership, or permission to sync.

An older client cannot display every future feature. When a new fact changes
whether an operation is safe, the server validates that operation against current
facts and permissions. Refuse that event with a reason; keep it visible and
retain other queued work. Do not infer that an old UI understands a new workflow.

## Durable history and checkpoints

Devices retain confirmed raw events as well as pending and rejected events.
A local checkpoint caches only the confirmed prefix at its declared sequence.
Loading a matching checkpoint queries only its tail plus pending work. Changing
the reducer replays the retained log locally, including formerly unfamiliar types.
Legacy prune APIs are no-ops. Raw facts do not disappear into a lossy projection.

New installations download raw history in bounded pages even if a server snapshot
exists. A server projection is not a substitute for facts the client may need
later. The server snapshot APIs remain useful to projection workers. They do not
move a device's raw download cursor. This intentionally costs more initial data
and device storage than snapshot-only bootstrap, while keeping warm starts cached.
Future compaction requires a separately reviewed, lossless archival protocol,
not deletion based on a reducer's output.

Pages and cursor updates commit in one local transaction. A redaction invalidates
the local cached fold in that same transaction, so restart cannot restore a stale
view. Redactions change interpretation, not the immutable identity of raw facts.

## Recovering installations from earlier builds

Earlier clients pruned the history covered by checkpoints. This release records
a per-partition raw-history marker. If a legacy checkpoint exists, it clears the
cache and resets the download cursor to zero atomically. Existing pending,
rejected, and retained confirmed events remain intact. Interrupted downloads
resume from the last committed page; duplicate events upsert by immutable ID.

History already deleted from a device needs one network backfill from the
canonical server log. Until then its rebuilt view may be incomplete; local work
is preserved. We cannot recover absent bytes while offline. Subsequent upgrades
can replay the retained history offline. Already-installed old binaries cannot
be retroactively changed, but the server immediately stops refusing them for age.

## Deployment and regression protection

`20260925010058_sync_integrity.sql` replaces the existing version check with a
no-op, resets its legacy setting to zero, and constrains that setting to zero.
It also removes the oral-workflow partition's separate client-version gates.
Existing append/pull signatures, permissions, and validation remain in place.
Historical migrations retain their history; later feature migrations must not
reintroduce a minimum-client gate. The unshipped translation-tools bump is removed.

`20260925011736_sync_error_contract.sql` restores the legacy invalid-payload
prefix and oversized-batch SQLSTATE in the oral-workflow append wrapper.
Older clients use these responses to classify failures. Error contracts need
the same compatibility protection as successful responses.

Before every sync-related release, run mixed-version tests with an unfamiliar
nested payload and an older materializer. Check storage through checkpoint and
restart, then upgrade offline and compare with a full replay. Simulate a failed
page transaction and legacy pruned history with a pending outbox. Run the SQL
smoke test using omitted, null, old, and high version values; verify authorization
and invalid-payload rejection still work. Preserve raw payloads through HTTP and
both SQLite and memory stores. Document any new feature-specific refusal.

## September 24, 2026 release evidence

- Both compatibility migrations are deployed to the hosted database.
- Production accepts old and null protocol values; the minimum remains zero.
  Anonymous append remains prohibited. Legacy validation error formats are restored.
- 347 tests pass; four environment-dependent integration tests are skipped.
  Core, client, and mobile typechecks pass in the frozen release snapshot.
- `smoke.sql`, `syncIntegritySmoke.sql`, `bibleSmoke.sql`, and `obtSmoke.sql`
  pass against an isolated database with the deployed migration sequence.
- The native release uses frozen snapshot commit `6f7a8ca`.
  The follow-up error-format repair changes only the server and does not require
  another native binary.
- iOS **1.0.0 (17)** built successfully using the production App Store profile:
  [EAS build ca516274](https://expo.dev/accounts/rwishart/projects/langquest-next/builds/ca516274-b1e1-4129-9fac-f8d3b5a8c053).
- The exact binary was uploaded with `ship-eas-ipa.sh --yes --no-cancel --id`.
  Apple returned `UPLOAD SUCCEEDED with no errors`.
  Delivery UUID: `ca45eedc-3a17-4c70-a38e-80397f9e27d3`.
  Apple processing follows upload; availability in TestFlight is not yet confirmed.
- The final database security advisor reports zero errors. Its 58 warnings include
  existing function configuration and authenticated security-definer RPC findings.
  The error-contract repair adds no findings. Authorization regression tests pass.
