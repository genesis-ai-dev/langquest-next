# 215. New ids name their author, and a teammate's phone takes only work whose ids are bound to who wrote it

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: nearby hands teammates event ids and entity ids before the server
has seen them, and the server gives an id to whoever arrives first (plan
5.4, Bound ids). A teammate could push their own events under Sam's ids, or
sign a batch holding them; Sam's real event would then be refused for good,
the pull would overwrite his row with theirs, and nobody would see a
refusal. New builds mint `by:<actorId>:<random>`, a marker no build has used,
since today's ids are already `<uuid>:<n>` and a bare actor prefix could not
be told from one. `commandId` comes from one core helper, `newCommandId`,
held by a lint rule over the command sites, so event ids and the `take:`,
`review:`, `note:`, `req:`, `dep:`, `rendering:` and `adjustment:` ids made
from it inherit it, and `SyncClient.append`'s default id binds too.
`idAuthor` in core refuses an event whose id, or the id a create makes,
names someone else (for `rendering:` and `adjustment:` keys, the part after
the term, shared by design, 75). The door refuses an unbound batch event, and
`signUnsigned` leaves an unbound row out and counts it for the screen, so a
missed site costs sharing, not integrity. `FakeServer` holds the rule now;
`append_events` gets its twin, for callers only and with a reason that reads
as `INVALID`, in phase 2 (152 is amended then). Any other id behaves as
today, so old builds keep their results. Known limits, for the security
review: `audioformat:<hash>` is a content address and cannot be bound, so a
teammate can label one voice note first, and take ids reaching apps through
the agent API now show their author's profile id.
Reverse if: an id over the 256-character limit turns up, or a command site
is found minting ids the lint rule does not see.
