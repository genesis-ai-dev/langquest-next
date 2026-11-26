# The sync protocol

Kind: reference

How a phone and the server exchange events and files: push what is pending,
pull the stream's tail from a cursor, start cold from a snapshot (PLAN.md
section 3). Moved here from PLAN.md section 9 on 2026-11-19
(`docs/decisions/2026-11-19-each-doc-answers-one-question.md`). The client is
`packages/sync` (its README); files follow `docs/blobs.md`.

The implementation is Postgres RPCs on Supabase
(`append_events`, `pull_events`, see `server/README.md`). The HTTP shape
below is the contract they satisfy; a Workers front end can wrap them later.

- `POST /orgs/:org/streams/:stream/events` with a batch of at most 500
  pending events (`append_events`). Server checks membership fold and
  payload shape, assigns `serverSeq`, returns per-event accept or reject.
- `GET /orgs/:org/streams/:stream/events?after=<serverSeq>&limit=<n>`
  (`pull_events`).
- `GET /orgs/:org/streams/:stream/snapshot?reducerVersion=<v>`
  (`get_snapshot`) returns the newest snapshot for exactly that version.
  `get_snapshot_meta` and `get_snapshot_chunk` serve the same snapshot in
  256 KB pieces; the client persists each piece so a dropped link resumes.
  For a phone that keeps a language on disk, `get_snapshot_head`,
  `get_snapshot_rows` and `get_snapshot_passages` serve the snapshot cut
  by passage and every passage's line, which it fills in behind the Map
  (decisions.md 147).
  `put_snapshot` and `list_streams` are service-role only and are what
  `server/snapshotWorker.ts` uses (`npm run snapshot`).
- Every call carries `CLIENT_PROTOCOL_VERSION`; below
  `server_config.min_client_version` the server answers `LQ001` and the app
  shows an upgrade state with nothing lost.
- Blobs: `PUT /blobs/:hash` idempotent, `GET /blobs/:hash`. Presence of a blob
  is independent of presence of the events that reference it.
- Delivery, since 2026-11-08 (docs/nearby-sync-plan.md
  section 6, decision 236). An event comes from its author, or from a phone
  holding the author's valid signature, unless it is a redaction. The Worker's `POST /api/relay` takes teammates'
  signed batches, checks each chain and signature, and appends them as each
  author through `relay_append_events`, which wraps `append_events`; a phone
  delivers between push and pull. Someone who only views may upload a file
  an accepted event names (`x-named-by` on the blob PUT).

- Every call ends, since 2026-11-26
  (`docs/decisions/2026-11-26-every-request-ends-and-a-network-change-stops-it.md`).
  On a phone, a request that has no full answer, body included, after 2
  minutes fails as offline and is stopped
  (`apps/mobile/src/server/sessionSafeFetch.ts`, `answerWithin`); a file the
  web sends whole gets 2 minutes and 1 second per 4 KB. When the network
  goes or comes back, every request still out is stopped at once and sync
  is woken (`apps/mobile/src/sync/wake.ts`), but a sign-in renewal, which
  keeps only its limit. As a backup, a sync stops waiting for a call after
  150 seconds (`packages/sync/src/requestLimit.ts`) and counts it on the
  `expected` tally (`sync request`, the call, `no_answer`); the app counts
  its own 2-minute stops there too (`request stopped`, `TypeError`,
  `no_answer`). A failed call is offline: the next sync sends it again, and
  every call is safe to repeat.

Migration option: this protocol can be served by PowerSync syncing a single
immutable `events` table bucketed by stream, with the upload queue as the
outbox. Decide by cost, not architecture.
