# Team work the server wrote in a language travels between phones as an attested claim, never in a batch

Date: 2026-11-24 · By: Carl Sauder · Status: accepted

Reason: the review of 2026-11-24 (item 16) found that `shouldClaim` dropped
every row whose id only the server makes, and the door refused them even
under a claim. Keeping `v1.BlobStored` and `v1.Redacted` off phones is
deliberate (decision 211, plan 5.1), but the same rule dropped real team
work: listener and review-link reviews (`api-`), which can complete a check
step, releases (`api-release-`) and imports from LangQuest v2 (`v2:`). A
reviewer back in the village never saw them until online. Carl chose to let
them travel as attested claims only. `serverRowMayBeClaimed`
(`packages/core/src/nearbyDoor.ts`) passes a server-written row whose type
this build knows and whose privilege is not null, and that is neither an
organization type nor in `NEARBY_NOT_CARRIED`; `shouldClaim`
(`packages/core/src/nearbySend.ts`) sends it, and the door's step 6 lets it
through only with `claim: true`. The Worker already signs every row of the
stream as the caller reads it (decision 221), so the receiver holds the
server's word for its digest; nothing a phone signs can carry one, and a
batch holding one is refused at step 6 as before. `v1.BlobStored`,
`v1.BlobInvalidated` (null privilege), `v1.Redacted` and
`v1.ExternalValueSet` never travel, and neither does a server row of a type
this build does not know. No event changes, the SQL `_server_event_id` and
its parity are untouched, and the protocol range stays where it is: an older
phone still refuses such a claim at its own door, row by row.

Amends 211, whose "server-only events are refused" now holds for batches and
for what is not team work.

Reverse if: a server-written type that passes turns out to carry something a
teammate's phone must not hold (then it goes on `NEARBY_NOT_CARRIED`), or a
claim of one is found to let a phone shadow real work.
