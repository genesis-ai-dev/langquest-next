# Nearby sessions bring Wi-Fi up only for files, space out a pair, ask several things at once, and read what they read once

Date: 2026-11-24 · By: Carl Sauder · Status: accepted

Reason: the review of nearby sync that day (P1 to P13) found the cost of a
session in the radios and the round trips, not in what moved. Every session
over Bluetooth formed a Wi-Fi Direct group before it knew any file was wanted,
and any change in a summary, one review mark, made a session worth having,
with nothing to space out sessions with the same teammate. A newcomer's copy
moved one passage and one document per round trip, 1,525 for FIA's English
guides and 2,000 for a large language, each passage its own commit while the
language was locked. The quiet room re-read every holdings entry and worked
out every find tag each 2-second tick, and the first walk after each launch
read every document the language uses, 65 MB for FIA's English.

So, between phones whose Hellos name `files-when-wanted`, the arrangement over
the pipe still happens before the events, but the link that moves files comes
up only after them, when either phone says in `wants` that files should move
(it lacks a recording it needs or reviews, a backup the other holds, or a
library file its kept passages need, or it holds a file the server lacks that
the other is not known to hold), or at once when one says in `arrange` that a
starting copy is coming (`soon`); holdings go over that link. A room meets a
teammate it finished with less than 2.5 minutes ago (`partnerGapMs`) only when
files wait either way, or documents do. A phone keeps up to three copy asks
out at once, which every build answers in order, so no wire change: a
newcomer takes up to 16 passages a page, three in flight, in one commit, and
over a link that moves files the first parts of the next documents are asked
ahead. Playing or recording holds the quiet room, stopping its finding and
any new session, and recording cuts the one under way; the room finds again
after 15 seconds of quiet, where before each clip stopped the room, cut its
session and wrote a diagnostic. The room's summary is worked out again only
after a write (`SyncClient.writeStamp`) or a minute, and each find tag once
per key and generation. Document heads are kept on disk beside the documents
(`heads-nearby<NEARBY_HEAD_VERSION>.json`), documents hashed by the phone's
own native hash, a teammate's text checked once, and a sent text by its hash
alone. The rest are small: an index on `kept_rows (kind, id)`, each
address's key kept once found, a passage's rows text dropped after its last
part, the files job counted down rather than walked, no space worked out
with room to spare, and the app's rule for a guide set's other languages
applied in core.

No event changes, and `NEARBY_PROTOCOL` stays: an older phone names neither
new ability, so it is sent no `wants` and no `soon`, and its sessions run as
before. The plan (docs/nearby-sync-plan.md 5.12 and 14.1) says how each works.

Reverse if: field diagnostics show sessions that wanted files leaving them
behind because the link came up too late to move them (then the link comes up
as before whenever either phone holds files the server lacks), or teammates
meeting too seldom for events to keep up (then `partnerGapMs` shrinks), or a
sender's in-order answers are found to break with several asks out (then one
at a time again).
