# 228. A backup goes, on every phone, as soon as the server confirms it

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: a backup is kept so the phone can carry the team's work and in case
the phone it came from is lost (plan 5.6); once the server holds it, neither
reason stands, and a phone back from town should not keep voices it never
needed. Carl's answer 14 makes this hold whatever "Hold teammates'
recordings" says. At the end of each sync `backupsConfirmedOf`
(`packages/core/src/nearbyHoldings.ts`) lists marked files in the backup
group that the server holds at the size held here, as `evictableOf` asks,
and they go at once; the mark goes with them, and when `discard` forgets a
file. A file that was open for review becomes level 1 and goes only under
space pressure, so up to about 35 hours of teammates' voices a reviewer could
review can stay after that trip; a needed one is kept. This departs from
PLAN.md section 14 and 60's "recordings evicted only once the server has
them" in the other direction too, since the server has these, and both are
amended.
Reverse if: reviewers on the way back from town lose audio they meant to
review (then a backup in a passage open for review waits for space
pressure).
