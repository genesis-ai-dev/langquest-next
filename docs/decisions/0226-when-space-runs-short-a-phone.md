# 226. When space runs short, a phone frees files in three levels, and a teammate's file is marked, never inferred

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: every phone now takes teammates' recordings (227), so a cheap phone
can fill up, and until now there was only yes or no (`evictableOf`). Carl
chose (2026-11-06) that a backup may go when space runs short (plan 5.6).
Level 1 is today's rule unchanged: files the server has, outside this
person's offline scope, largest first. Level 2 is new: nearby files outside
the offline scope, backups first and files open for review last, the most
known copies first so a last copy goes last, then the largest; it goes only
under 500 MB free once level 1 cannot free enough. Everything else is never
deleted: the person's own unsent files, another person's on a shared phone
(60), needed nearby files, and kept files the server has. A backup may be the
last copy, because the phone it came from may be gone, and it goes before a
kept file the server has safe: the person's own recording has to win, and
deleting a kept file could stop someone working offline. Review files go
last in level 2 rather than being protected, so a team's unreviewed audio
cannot fill a reviewer's phone with no way to free room. A nearby file is
known only by a mark written when it lands (`nearby_files`, beside the
ledger), its group worked out when space is short; no mark means protected,
so nothing a teammate sends can make this phone's own file deletable.
`evictableOf` does not change; level 2 is `nearbyEvictableOf`
(`packages/core/src/nearbyHoldings.ts`), and `reclaim` takes ordered lists
and one limits object and frees them in one pass, so a second call cannot
see the disk still short and delete too many backups. The 2 GB cap leaves
marked files out, level 1 gives way before a nearby file lands, and any
session can free another language's level 2 files from the mark alone; a
mark names one language while the store is global by hash, so this could
delete a file a second language also names, which is rare and accepted.
Building found that the marks, level 2, shedding and the third worker had
to sit behind the nearby entries (`nearbyMarks.ts`, `nearbyFiles.ts`), not in
`fileLedger.ts` and `blobs.ts`, because the web bundle had no room. PLAN.md
section 14 and 60 are amended with it.
Reverse if: field phones lose last copies of teammates' work to level 2
before anyone reaches the server (then the order or the 500 MB line moves).
