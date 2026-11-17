# 216. A phone takes at most 70,000 rows and 50 MB of nearby work per signer

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: every phone keeps what it takes, these rows cannot be pruned until
the server settles them, and every load folds them, so one member's flood
of valid events could stop a language opening on every phone in the team
(plan 5.4, A budget per signer, from the security review). Carl kept the
review's numbers (answer 21), from 169: 70,000 rows (the 99th-percentile
day, 1,150 events, times 60 days offline) and 50 MB, as arguments from
JavaScript (`NEARBY_BUDGET` in `packages/core/src/nearbySend.ts`).
`receiveNearby` checks the budget right after parsing a manifest, before
chain and signature work, outside the door, which runs again over counted
rows on a `REDUCER_VERSION` change and would miss unknown types. Batch rows
count against the manifest's actor and claims against the claimer, never
the event's author, so a teammate cannot spend Sam's budget. An over-budget
page is dropped and its number stays open, so nothing is skipped and the work
stays on its author's phone; after 36 dropped pages in one session the phone
says `bye` with `busy`. The count is one grouped query over nearby rows at
session start, then kept in memory, with no new table. So "every phone takes
everything" means room and budget allowing. A runaway bug on an honest phone
is stopped the same way.
What it costs, read on the fleet's `villageMonth` (seed 1, 5 phones, 30 days,
Node on the build machine, not a phone): with one member's notes at 68,000
rows every phone held 70,302 unconfirmed rows (42.7 MB of event JSON, a fold
of 42 MB as JSON) and its app took 6.2 to 6.4 s to open, against 29 to 45 ms
without that member. The fleet's `MemoryStore` reads pages slowly at that
size; the same rows on the app's SQLite store open in 1.03 s. How much slower
a 2 GB phone is has not been measured, so these numbers go to Carl, as plan
5.4 asks, and the budget stands until he decides.
Reverse if: the real-phone test's load and fold times with a month of a
team's nearby rows (plan section 11) do not fit a 2 GB phone; the numbers
then go back to Carl, and are not lowered quietly.

Amended (2026-11-08, Carl Sauder): the final security review found that one
join pass could mint any number of newcomers, each with a budget of its own,
whose bare manifests were then kept and spread for good. So two-link authors
now share one bucket per `passId` (read from the chain kept with the batch,
`passIdOfChain`) for rows, bytes and manifest text, bare manifests included,
which plan 5.4 already asked for from phase 6; a newcomer key that would make
more than the pass's `maxUses` newcomers held under it is dropped as over
budget; a bare manifest from someone the phone no longer lets in (removed, or
let in by an inviter since revoked or removed) is counted but not kept, so it
does not spread; and `countBatch` and `applyFloor` add no key past
`NEARBY_VECTOR_MAX_KEYS`, since a stored vector over that cap read back as
nothing and reset what the phone counted as received.
