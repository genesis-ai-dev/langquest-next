# 230. A phone keeps who it last finished with and what both said, never when it met anyone

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: partner choice needs to know which teammates this phone has
finished with and what both summaries were, so two phones that finished
together and have not changed do not connect again (plan 5.11, 5.12 The
store). But `nearbyPeers`, `nearbyToday`, the vector and chains sit in plain
SQLite and say who is on the team, and a taken phone gives them up. So
`nearbyPeers:<org>/<stream>` is an ordered list of `{ tag, gen, mine, theirs }`
written at Done, with no time, device or person; `nearbyToday` is one
phone-wide `{ day, tags }` for "today"; both go when this phone takes a new
generation, at the end of any completed sync unless the room is running, and
at any sign-out; and Ready to carry says "today", "since you were last
online" or not, from the vector, holdings and members, with the newest work
held from each (`firstHlc`), not from who met whom. No meeting time is kept
anywhere, and diagnostics name no teammate (235). All that costs is partner
order and perhaps one extra session. Android's backup rules leave the
database out (`configureAndroidBackup`), and a test holds that.
Reverse if: partner order without times makes teams of five take many more
sessions than the fleet's scenarios show.

Amended (2026-11-24, Carl Sauder): one meeting time is now kept. Sharing
while LangQuest is open (2026-11-23-share-while-langquest-is-open) takes only
a teammate whose certificate was signed within 14 days, and a team may be out
of reach for longer, with one person traveling now and then to carry its
work online; that trip renews nobody else's certificate. So on a phone that
may run that mode (the organization's `nearby_open`, the switch on, no
cover), Share nearby's Hello notes the day it met each teammate,
`nearbyMet:<org>`: the install key, `profileId` and the day, nothing else,
and the mode takes a teammate met on a day that began within its window
whatever their certificate's age. A taken phone then gives up which teammates
it met on Share nearby in the last 14 days and on which day, which is what
this decision kept off the phone. Carl accepted that rather than a longer
window, which lets a taken phone work longer and still resets nothing, or a
dated note each phone carries, signed by whoever it met, which would let a
taken phone in with the whole team after one meeting and tell every teammate
it meets quietly who that person last met. The days are kept no longer than
the window and only where the mode may run; they go the moment a cover is
on, at any sign-out and at "Remove me from this phone"; and a quiet meeting
notes none, so a taken phone cannot keep itself in. Offline, where the mode
may run, Sync and offline's Teammates fold says until when the phone shares
with each teammate, worked out from those days and the certificates, so a team
knows when to meet on Share nearby; it shows on screen roughly what the record
holds. `nearbyPeers`, `nearbyToday` and Ready to carry are unchanged, and
diagnostics still name no teammate.

Amended (2026-11-24, Carl Sauder): Let someone in's join notes a meeting
too, on both phones, on the same terms as Share nearby's Hello: the other's
install key and person, and on a phone that may run the quiet mode the day
(the newcomer by the grant's `features`). The newcomer's chain starts with
the inviter's certificate, so it is exactly as old as the inviter's, and the
quiet mode refused the two until they opened Share nearby together, which
defeated handing `nearby_open` on in the grant (review of 2026-11-24, item
8). The join happens on a screen with one tap, never quietly, so a taken
phone still cannot keep itself in; nothing more is kept than a Share nearby
meeting keeps.
