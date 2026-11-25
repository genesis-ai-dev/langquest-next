# A starting copy comes only from a whole download, from one checkpoint, is whole before its documents, and a document a build cannot read is skipped

Date: 2026-11-24 · By: Carl Sauder · Status: accepted

Reason: the review of 2026-11-24 found four ways a newcomer let in offline
came away with less than its teammate held, without anyone being told.
Carl took the report's fixes, including its recommendation for item 4, which
changes the copy's messages.

A dropped link or a stall during the names and documents (item 3), the longest
part of a join at one round trip each, threw, so the copy was never set
though the person already held everything needed to work, which broke the
plan's "setting the person never waits on documents". The copy is now whole
once its passages are filled: `takeStartingCopy` says so then (`onWhole`), the
session puts it in its report and tells the join (`whole`), and a drop in the
names or documents after that answers `docs.cut` rather than failing the
copy. The session then ends as dropped, with the copy whole, and the person is
set. The inviter knows it too, since a newcomer that names `join-exchange` asks
for names or documents only after a whole copy (`join.copyWhole`), and its
screen says they can start working and any teammate gives the rest, not that
their copy needs finishing.

A copy the inviter began and a teammate at an older checkpoint finished (item
4) took the older rows into passages worked on between the two checkpoints,
or none, marked them filled and called the copy whole; claims start above the
copy, so the gap never closed until first contact. Every `rows` part now says
the seq of the sender's checkpoint (`copy-part` `seq`, an optional field an
older phone ignores, read with the rows in the stream's turn), and a fill
takes rows only of the checkpoint its copy came from. From a teammate at
another checkpoint, or one that says none when the copy was not taken from it
in the same session, the newcomer takes that teammate's whole copy instead:
it asks for it, and only once it has come and been read drops its part-filled
language copy (`dropStartingCopy`, which keeps the log and its unsent work) and
adopts the new one, so a link that goes during the ask leaves the filled
passages as they were; a target that cannot drop refuses it. A teammate whose
rows and state came from two checkpoints, or whose checkpoint moved during the
fill that follows, refuses the copy (`moved`) and the session goes on, where it
once ended failed; a teammate from before then whose state is at the copy's
own checkpoint holds the same copy, so the fill goes on from it with nothing
dropped. A
teammate that cannot give a passage's rows (its own fill unfinished) answers
`copy-no`, which now refuses the copy (`CopyRefused`) where it was a drop that
ended the whole session. `NEARBY_PROTOCOL` does not change.

A teammate part-way through a download (item 27) gave out what it held as a
whole copy: an organization missing roles, members or library items, which
the newcomer kept for good, since it asks for the organization only while it
holds none. A stream now gives a copy only once a pull reached the server's
newest since its cursor last went back to 0 (`downloaded:<org>/<stream>`, in
the same write as the last page's cursor), or while it holds a whole copy
itself. A stream from a build before the mark counts once it holds anything
from the server, as that build gave copies, so an inviter updated offline
still lets people in. Let someone in asks both streams before it shows the
code (`canGiveCopy`, item 5) and, when either cannot give one, shows no code
and says why, with how far a fill has come; the report's other way, a partial
copy with its unfilled passages as the newcomer's remaining fill, was not
taken, since a whole copy from the next teammate does the same with no new
state to carry.

One document in a format this build does not know (item 28; `labels@1` came
without a reducer change) was taken for a forgery: that teammate was asked
nothing more that session, every session, and the next 4 MB came again each
time. A text that hashes to its name and is in canonical form is the document
its name says, however this build reads it, so it is now skipped, counted
(`unreadable`) and remembered under this build (`library-unreadable` in the
app, at most 1,000), and the rest are still taken. Only a wrong hash or a text
not in canonical form ends the asking, as before. Nothing is weakened: a
hostile sender cannot make a text for a hash it does not hold.

Field diagnostics say each of these, as counts and fixed words: `copyNo`
`moved`, `copyDocsCut`, and documents skipped as unreadable
(`copyDocsUnreadable`, `docsUnreadable`; docs/diagnostics.md), so the
Reverse-if below can be read from the field.

Reverse if: field records show newcomers dropping their copy for another
teammate's often enough that the second download costs more than the gap it
closes (then resume from a teammate at a later checkpoint only, with claims
from the earlier seq), or teams report Let someone in refusing on phones
whose copy was in fact whole.
