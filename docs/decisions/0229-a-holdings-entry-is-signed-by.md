# 229. A holdings entry is signed by its owner and says whether it holds teammates' recordings

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: each phone keeps, for each install key it has heard from, which
unconfirmed files that phone last said it holds, so phones can choose what
to fetch and what to free first, and whether two phones have anything to swap
(plan 5.11 and 5.12). Holdings pass along after Have, stay in device meta
beside the vector, and never reach the server or the log. An entry is signed
by its owner with a counter, so newer news replaces older and a teammate can
pass one on but cannot forge or wedge it; `copiesOf` counts certified
people, so a false entry naming fifty devices adds at most one copy. What an
owner says of itself can still be false, which changes the deletion order or
puts off an exchange, and on a phone with the row off can make a file go that
it would have kept. Building found (phase 3, steps 1 and 2) that the entry
needs the owner's row: without it the lower-key tie-break made a phone with
"Hold teammates' recordings" off and the lowest key keep every file, even
those teammates with the row on hold. So the signed text is version 2 with a
new prefix and a `hold` field; the counter moves when only `hold` changes, a
tie on files goes to `hold` false, `parseHoldings` and the wire refuse a
non-boolean, and a session drops an entry whose `hold` changed after signing.
The wire was free to change, since no store build had signed version 1.
Reverse if: holdings turn out too stale between exchanges to choose by
(then phones ask instead of trusting them).

Amended (2026-11-08, Carl Sauder): an entry was checked once, when it came,
so one from a key revoked or a person removed since still counted as a copy
(final security review). A session now checks an entry's chain against the
revocation list and drops one whose holder Hello's read gate would refuse,
and the files part reads stored entries through `holdingsInForce`, which
leaves out an entry whose key and holder, or first link's key and person,
are on the list, or whose person has only removed entries in the fold, so
no file is shed or counted as safe for its sake.

Amended (2026-11-10, Carl Sauder): a phone keeps a holdings entry for a key
it does not hold yet only below `NEARBY_HOLDINGS_MAX_KEYS` in all, and a
newcomer's only while its pass has fewer than `maxUses` keys here, as batches
already were (decision 216's amendment). One pass could mint any number of
newcomers offline, and their entries, kept for good and spread, could grow
Have past what a link carries, so every session for the language failed. A
session also ends at more parts for one entry, or more entries, than an
honest phone sends (pre-merge security review).
