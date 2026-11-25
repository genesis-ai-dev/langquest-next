# A checkpoint a phone takes of its own log keeps the rows it drops for claims, in a bounded side table

Date: 2026-11-24 · By: Carl Sauder · Status: accepted

Reason: the review of 2026-11-24 (item 18) found that a phone back from town
takes a checkpoint during its pull (every 2,000 events) and deletes the log
behind it, and claims came only from the log, so once its pull passed that
point it could claim almost nothing below the checkpoint to a teammate,
however little the teammate was behind. Teammates' own work still moved as
batches; what was lost was work by people outside the village, such as a
consultant's reviews. Plan 5.3 had accepted this. Carl chose to keep those
rows claimable. A prune that a checkpoint of the phone's own log makes, on a
client with a nearby half whose phone holds a certificate for the
organization, carries `claimable` (`NEARBY_CLAIMABLE` in
`packages/sync/src/nearbyClient.ts`: the newest 10,000 rows and at most
16 MB of their JSON); the store moves every confirmed row it drops to
`nearby_claimable` and trims the oldest, so what it keeps runs unbroken up to
the checkpoint, and drops an attestation only once all its rows are gone.
`claimableAfter` reads the log and then that table; `nextClaimsOf`,
`attestNearby` (which now asks from the oldest row still held) and
`nearbyHoldsLess` use it. A server snapshot's prune keeps none and empties
the table, since rows below a snapshot may never have been on the phone and
claims must not cross that gap. So does a checkpoint on a phone that holds no
certificate: every phone has a nearby half, but one without a certificate
asks for no attestation, so nothing it kept could ever be claimed. The rows
are confirmed server rows the phone already held, so nothing new is stored
about anyone; the cost is up to 16 MB a language on a phone that holds a
certificate.

Amends 221: answers now go with the rows a checkpoint kept, not with `prune`.

Reverse if: the table's room is needed (then a smaller bound), or teams are
seldom a little behind a carrier (then the table costs more than it gives).
