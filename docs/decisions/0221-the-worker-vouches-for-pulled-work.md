# 221. The Worker vouches for pulled work, and a phone claims only as far as that runs unbroken

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: a teammate who got someone else's event from the server has no
author's signature for it, and their own word would let any certified phone
write as anyone, or plant a copy that shadows real work (plan 5.5). So after
each pull a phone holding a certificate for that organization asks
`POST /api/nearby/attest`; the Worker reads the rows itself, as the caller
through `pull_events` so `can_read_stream` gates it, computes each digest,
and signs ids, digests and `serverSeq`, at most 200 rows. No digest comes in
the request, or it would sign whatever it was sent. It refuses `_org` and
`_person` streams and answers null while the organization is off. The phone
checks each answer against its own rows as it arrives, keeps answers in
`nearby_attests`, and claims only up to the contiguous attested seq
(`attestNearby`, `packages/sync/src/nearbyUpkeep.ts`). `SupabaseTransport`
knows no Worker address, so the app adds `attest` to its transport
(`apps/mobile/src/server/sync.ts`, from `src/server/nearby.ts`); only a
client given a nearby half, which only the Android app passes
(`src/nearby/nearbyPhone.android.ts`), calls it. Without an attestation the
work waits for the server, so an offline team loses nothing it could have
had. A claim is first-hand only in this release.
Reverse if: attesting costs a phone's syncs more than the claims save
teammates, or a receiver needs to pass a claim on (then an ability in
Hello).

Amended (2026-11-24, Carl Sauder): a checkpoint a phone takes of its own log keeps the rows it drops for claims, bounded, and an answer goes only once all its rows have, so a carrier back from town still claims what its pull checkpointed past (docs/decisions/2026-11-24-a-checkpoint-keeps-its-rows-for-claims.md, review item 18).
