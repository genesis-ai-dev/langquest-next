# Event system performance audit

Date: 2026-10-12. By: Carl Sauder, with Claude. Sources: this repo at
commit `df1ad11`; measurements taken that day on a laptop (Node 24, V8) and
the local Supabase Postgres. Nothing was measured on a phone.

This document answers three questions. How do we measure how fast the event
system is today? What should change to make it faster? And how will each
change be shown to work? It covers the core fold (`packages/core`), the sync
client and on-device storage (`packages/client`, `apps/mobile`), and the
server's write and read paths (`supabase/migrations`, the workers).

Folding events is not the bottleneck. At about 2.4 µs per event, 100k events
fold in 230 ms on a laptop. The time goes to the work around the fold:
SQLite commits, state copies that make every screen rebuild its views,
snapshot reading and writing on both phone and server, and a few refolds and
scans that grow faster than the data. None of it is measured on the slowest
partner Android, which PLAN.md and `flow-coverage-audit.md` (L8) already name
as the gate. So measurement comes first; most of the fixes are small.

## 1. Baseline

Measured 2026-10-12 on a laptop. Hermes on a phone is slower by a factor
nobody has measured yet (section 2.2 measures it).

| What | 1,200 passages (16k events) | 5,000 passages (65k events) | 100k events |
| --- | --- | --- | --- |
| Full fold | 39 ms | 149 ms | 230 ms |
| State as JSON | 3.6 MB | 15 MB | 13.3 MB (1.2 MB gzipped) |
| Read the whole log back and refold | 41 ms | 177 ms | 289 ms |
| Take a snapshot | | | 252 ms |
| Heap | | | 276 MB |
| Apply one event to a large state | 0.02 ms | 0.02 ms | |
| Rebuild views on a new state copy (`buildIndexes` + `languageProgress`) | 8–11 ms | 37–56 ms | |
| `offlineSummary` | 45 ms | 675 ms | |
| One `get_snapshot_chunk` (local Postgres, 15 MB state) | | 60–70 ms each, about 58 chunks | |

The 100k column is `npx tsx scripts/loadtest.ts 100000`. The other columns
come from a synthetic stream: the Standard Bible Flow; per passage, a unit,
two recordings and takes, two submissions, four reviews and two notes. The
chunk timing loaded that state into a temporary table in a rolled-back
transaction and ran the query `get_snapshot_chunk` runs. The scripts for
these columns are not in the repo yet; section 2.1 adds them.

Two of these rows need a second look. `offlineSummary` takes 15× the time
for 4× the passages: it is quadratic (item 6). A full snapshot download
costs the server about 4 s of database CPU (item 4).

## 2. Measuring current performance

### 2.1 Benchmarks in CI

`scripts/loadtest.ts` and `scripts/bench/bootstrap.ts` exist but only run by
hand, and the only timing assertion is the coarse 1000 ms guard in
`packages/core/test/indexes.test.ts:137`.

- Give both harnesses an npm script and JSON output.
- Add benchmarks for what neither covers:
  - the view rebuild per published state;
  - `offlineSummary` at 1,200 and 5,000 passages;
  - snapshot bytes per top-level key of `LanguageState`;
  - append one event, then `languageProgress`.
- Commit a baseline file, and have CI fail on a regression above about 20%.

Node numbers catch regressions. They do not say how fast a phone is.

Done in part (2026-10-12): `npm run bench:core` (`scripts/bench/core.ts`)
times the fold, the view rebuild per published state, `offlineSummary`,
and snapshot size by key, at 1,200 and 5,000 passages. Its numbers are in
`fleet-baselines.md`. Not yet in CI.

### 2.2 The same benchmarks on a phone

Add a dev-menu action (`apps/mobile/src/DevMenu.tsx`) that runs the
benchmarks in Hermes on the device and sends the results as a new `bench`
diagnostics record. Run it on the slowest partner Android before each
release that touches the fold, sync or storage. This is the gate PLAN.md
names, made something a person can actually run.

### 2.3 Field diagnostics

`packages/client/src/diagnostics.ts` records sync, load, snapshot, transfer,
device and error records. It cannot show:

- **which refolds happen:** add a reason to `load` (launch, redaction,
  rejection, membership, snapshot adopt), and split its time into read,
  parse and fold;
- **commit cost:** a `commit` record with ms and row count, for appends and
  pull pages;
- **checkpoint cost:** a `checkpoint` record with ms and bytes;
- **screen cost:** append to screen updated, and view-rebuild ms;
- **startup:** time from launch until the first language is usable.

Report p50 and p95 per device model in `npm run diag`. Records stay
content-free (decision 39). New fields go through the diagnostics allowlist
in `scripts/playDeclarations.test.ts`; check the Data safety answers in
`play-store-declarations.md` when adding them.

### 2.4 A fleet on simulated time

`npm run fleet` runs many phones against the in-memory server on simulated
time (`fleet-simulation.md`). It measures the clients and the protocol:
agreement, propagation, backlog drain, refolds and snapshot outcomes. Its
`slowLink` scenario reproduces item 5 below.

### 2.5 Server

- Turn on `pg_stat_statements.track = all` locally, so the queries inside
  `append_events` become visible.
- Add a SQL benchmark: two clients each pushing 200-event batches to one
  stream. Record ms per batch and the lock wait.
- Add `EXPLAIN` checks to the smoke tests for the entity-id lookup
  (`events_entity_idx`) and the pull range scan.
- In production, watch `diag.rpc_stats()` for `get_snapshot_chunk` and
  `append_events`.

Done in part (2026-10-12): `npm run bench:server` (`scripts/bench/server.sql`)
times 200-event appends, a pull page and the snapshot RPCs on a 14 MB
snapshot, in one transaction it rolls back. A batch's time is how long it
holds the stream's lock, so how long a second writer waits; the two-writer
run itself comes with item 8. Numbers in `fleet-baselines.md`.

## 3. Improvements, and how each is measured

Ranked by effect for the effort. "Confirmed" means checked against the code
and, where there is a number, measured. "Estimated" means read from the code
but not measured.

### Tier 1: large effect, small change

**1. Every SQLite commit opens a new native connection.** Confirmed.

- `apps/mobile/src/store.ts:51` uses `withExclusiveTransactionAsync`, and
  expo-sqlite's `Transaction.createAsync` opens and initializes a new
  `NativeDatabase` for each call, then closes it.
- `SqliteStore.commit` runs one upsert per event, about 3 bridge round trips
  each, so a 500-event pull page is about 1,500 native calls.
- `pragma synchronous = normal` (`packages/client/src/sqliteStore.ts:45`)
  runs on the main connection only, and SQLite sets it per connection. The
  write connections therefore probably run at the default, FULL. Expo's
  build default is not confirmed.
- **Fix:** one long-lived write connection with the pragmas set, behind the
  existing writer queue. Prepare the upsert once per batch, or insert a page
  in one statement with `json_each`.
- **Measure:** the `commit` record (2.3), ms per append and per 500-event
  page, on the device. `scripts/bench/bootstrap.ts` uses node:sqlite on one
  connection and cannot show this.

**2. Every publish makes every screen rebuild its derived views, 2–3 times
per append.** Confirmed.

- `apps/mobile/src/useLanguage.ts:255` copies the state on every publish,
  including publishes where only `saving` changed. `WriteQueue` publishes on
  enqueue and on settle, and `refresh()` (`useLanguage.ts:138`) copies again.
- `indexesFor` caches by object identity. `recordIndexes`
  (`packages/core/src/passage.ts:254`) also checks `stateRevision`, which is
  keyed by the live object (`reducer.ts:22`), so a copy always misses.
- **Fix:** copy only when `revision` changes, keep `saving` as separate
  state, and drop the second copy in `refresh()`.
- **Measure:** index builds per append (a counter; target 1), and append to
  screen updated. A rebuild costs 8–11 ms on V8 at Bible scale today.

**3. Every sync parses the whole local checkpoint to read one number.**
Confirmed.

- `packages/client/src/syncClient.ts:681` calls `localSnapshot()`, which
  reads and parses the whole checkpoint, to get its `serverSeq`.
- **Fix:** write `serverSeq` under its own meta key, in the same commit as
  the checkpoint.
- **Measure:** `applyMs` on an idle sync drops by the parse time, about
  50 ms on V8 for a 15 MB state.
- **Done (2026-10-12):** the seq is kept as `snapshotSeq:<org>/<stream>`
  in the same commit as the checkpoint; a phone updated from an older app
  reads its checkpoint once and keeps the seq from then on. Only `load()`
  and the slow checkpoint path still parse the checkpoint. In the fleet
  simulator's `normalDay` (`fleet-simulation.md`), 45 phones went from
  55 s to 11 s of real time, and 131 phones from 923 s to 60 s, for the
  same syncs and events.

**4. Each server snapshot chunk serializes the whole snapshot.** Confirmed.

- `get_snapshot_chunk` (`supabase/migrations/20261006000000_baseline.sql`)
  runs `substr(s.state::text, …)` for every 256 KB piece, and
  `get_snapshot_meta` runs `length(s.state::text)` twice.
- Measured: 60–70 ms per chunk on local Postgres for a 15 MB state, about
  58 chunks, so about 4 s of database CPU per full download. It runs on every
  cold start, on every redaction that reaches inside a checkpoint, and in the
  workers.
- **Fix:** build the text pieces once in `put_snapshot` (a chunk table), or
  serve the snapshot from R2 with Range requests.
- **Measure:** `get_snapshot_chunk` mean in `rpc_stats`. Target under 5 ms
  per chunk.
- **Done (2026-10-12, decision 89):** pieces are cut once by `put_snapshot`
  and kept in `snapshot_chunks`. `npm run bench:server` on the 14 MB
  snapshot: a piece 0.1 to 0.3 ms instead of 62 to 77, the size 0.5 ms
  instead of 125, a write 336 ms instead of 125 (at most hourly, decision
  88). Cutting at character offsets first took 1.6 s, because `substr`
  walks UTF-8 text from its start; it cuts by bytes.

**5. Snapshot churn makes slow downloads start over from nothing.**
Confirmed.

- `put_snapshot` deletes older snapshots as soon as a new one lands.
- The 5-minute projection pass re-snapshots a language after a single new
  event. `changed()` (`server/projectionWorker.ts:86`) also counts the
  organization stream, so any org event re-downloads every language
  snapshot in that organization.
- A phone part-way through a download gets `null`
  (`packages/client/src/snapshotFetch.ts:24`) and pulls the whole log from 0.
  At 20 KB/s, 13 MB takes about 11 minutes (estimated), so on the slowest
  links the download may never finish.
- **Fix:** re-snapshot only after K events or T minutes; keep the previous
  snapshot for some hours; decide which languages changed from the language
  head alone.
- **Measure:** `stale` outcomes in snapshot diagnostics, snapshot writes per
  hour, and how many first opens on slow links finish.
- **Done (2026-10-12, decision 88):** a new snapshot after 200 new events
  or an hour (at once when a redaction reaches inside it), and the one
  before kept until its successor is 24 hours old. In the fleet: no stale
  downloads in any run (9 of 66 before in `bump-large`); slow joiners at
  1,200 passages 5 to 6 minutes instead of 14 to 29, at 3,000 passages 25
  to 27 instead of 42 to 51; snapshots written in four and a half days 38
  instead of 351.

### Tier 2

**6. `offlineSummary` is quadratic: units × all blobs.** Confirmed.

- `scopedHashes` (`packages/core/src/blobs.ts:159-180`) walks every
  reference for each unit, and `offlineByUnit` calls it once per unit. It
  runs on transfer-worker passes and on every reclaim.
- **Fix:** group hashes by unit once per revision.
- **Measure:** the core benchmark (2.1). It takes 45 → 675 ms today; target
  linear, under 10 ms at 5,000 passages.

**7. Refolds run more often than they need to.** Confirmed and measured
(2026-10-12) with the fleet's `refoldTriggers` scenario
(`fleet-baselines.md`).

- **A hot loop while a language is not listed.** Refused events are
  re-queued at the start of every push. With more than five batches
  (1,000 events) queued, `push` reports more work, the scheduler runs again
  at once, and every pass is five refused appends and a full refold. A
  1,200-passage template applied before the organization lists the
  language made one phone refold 73,555 times in 10 hours and pull 901 MB.
  With 300 passages, 120 times. **Fixed (2026-10-12):** `push` stops at
  the first batch refused as not listed and does not report more work, so
  sync waits for its next nudge or poll; the refused events are still
  re-queued on every push (decision 24). The same run: 120 refolds while
  unlisted instead of 73,555, and 15 s of real time instead of 286 s.
- Each redaction refolds every phone that pulls it: 21 redactions, 1,277
  refolds across 33 phones.
- A phone whose stream is still empty asks for a server snapshot on every
  sync (77,460 empty lookups in the same run).
- One sync can refold up to 3 times (push, pulled redaction, membership).
- A NOT_LISTED refusal is re-queued on every push (`syncClient.ts:491`). If
  the server keeps refusing it, the phone refolds on every sync (`538`).
- Any `v1.RoleDefined` or `v1.RoleRetired` counts as "your membership
  changed" (`syncClient.ts:641-644`).
- `resume` runs `structuredClone` on an object it has just parsed
  (`syncClient.ts:235`, `packages/core/src/snapshot.ts:44`).
- A redaction inside the checkpoint downloads and parses the server snapshot
  on every sync for 30 minutes before checking whether it is stale
  (`syncClient.ts:304-324`).
- **Fix:** at most one refold per sync; re-queue NOT_LISTED events only once
  the organization lists the language; narrow the role trigger to roles the
  person holds; skip the clone; check `meta.serverSeq` before fetching.
- **Measure:** `load` records by reason (2.3), per install per day.

**8. `append_events` does all its work per event while holding the stream
lock.** Estimated.

- About 7–14 statements per event, so 1,400–2,000 per 200-event page. Every
  event after the first runs under the `stream_cursors` row lock, which is
  held until the call commits, and each row sends its own realtime message.
- `events_pull_idx` (`baseline.sql:56`) duplicates the btree that
  `unique (org_id, stream_id, server_seq)` (`:54`) already creates
  (confirmed), so every insert writes both.
- **Fix:** validate and authorize every event first, caching privileges per
  batch. Then lock once, allocate a range of sequence numbers, and insert
  all rows in one statement. Send one realtime poke per stream. Drop the
  duplicate index.
- **Measure:** the two-writer SQL benchmark (2.5), and the `append_events`
  mean in `rpc_stats`.

**9. `list_streams` silently stops at 1,000 rows.** Confirmed.

- It returns every `stream_cursors` row, one person stream per user
  included, without paging. PostgREST caps results at `max_rows = 1000`
  (`supabase/config.toml`).
- Past 1,000 streams, the snapshot and projection passes skip streams with
  no error. This is a correctness cliff more than a speed problem.
- **Fix:** filter to language streams in SQL, and page by
  `(org_id, stream_id)`.
- **Measure:** a test with more than 1,000 streams.
- **Done (2026-10-12):** `list_streams_page` pages by the table's key and
  the workers ask until a page comes back short (`listStreams`,
  `packages/client/test/listStreams.test.ts` with 2,500 streams behind a
  1,000-row cap). `list_streams()` stays for a worker deployed from before.
  It still includes person streams, which the blob reconciler may need.

### Tier 3: once the above are in

**10. Rebuild only what an event changed.** The derived-view cache keys on
the whole language state, so any event throws away every passage's view.
Make the record indexes incremental, invalidating only the passages an event
names. Measure with the rebuild-per-publish benchmark.

**11. State grows without bound.** Every draft take keeps a full copy of
`cardHashes`; `referencesUsed` copies item names onto every entry; the live
`appliedEventIds` is never compacted. Measure snapshot bytes by top-level
key (2.1) before choosing what to change.

**12. Small CPU items.** Hoist `validateEvent`'s closures to module scope;
bump the revision once per batch instead of once per event
(`reducer.ts:35`); use a `Set` in `highlightsFor` (`passage.ts:633`).

**13. Server odds and ends.**

- `notifications` has no index on `(org_id, language_id)`, so
  `reconcile_notifications` scans the table once per language per pass.
- The Durable Object's org cache (`apps/web/worker/orgFolder.ts:40`) holds up
  to 8 whole language states in a 128 MB isolate.
- Agent API reads call `pull_events` even when the stream heads show nothing
  moved (`orgFolder.ts:284`).

## 4. Found along the way

- **Privacy:** `pull_events` returns the payloads of redacted events; only
  the fold hides them. Worth deciding on its own.
- **Doc drift:**
  - decision 58 gives the web budget as 5.5 MB, while
    `apps/mobile/scripts/export-web.mjs` enforces 6 MB;
  - `diagnostics.md` names a migration that has since been squashed into
    the baseline;
  - PLAN.md section 5 promises per-organization rate limits on push and
    pull, which do not exist.

## 5. Not checked

- The statement counts and lock durations in item 8.
- Whether the snapshot pass fits the Edge Function's CPU and memory limits
  at Bible scale.
- The `synchronous` default on Expo's write connections (item 1).
- How much slower Hermes on a partner phone is than these laptop numbers.

Several fixes will need a `decisions.md` entry when they are built: snapshot
storage and its schedule (items 4 and 5), the write connection (item 1), and
batching in `append_events` (item 8).
