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
