# 143. A big language keeps each passage's record on the phone's disk; memory holds the passages on screen, and lists read one line per passage

Date: 2026-10-19 · By: Caleb Koster · Status: accepted

Reason: a phone held a whole language in memory. On a 2 GB test emulator
Koro Miyan (37,000 recordings, 541 versions) added about 235 MB once open,
and a language four times its size was killed by Android. Caleb asked for
this to be solved before cheap phones open big projects in the field, all
of it at once rather than in parts. With `keepOnDisk` (on for every
language in the app: `useLanguage` opens `LanguageSession` with it), every
entry of the maps core cuts by passage (`PASSAGE_PARTS` in
`passageParts.ts`: recordings, versions and drafts, submissions,
responses, reviews, departures, requests, notes, study marks, verse marks,
reference links and uses, key-term ties, releases) and the server's
verdict on each audio file go to the phone's `kept_rows` table with each
checkpoint, in the same commit; the checkpoint holds what the whole
language shares (its passages, flow, teams, materials, key terms). An entry
whose passage cannot be found yet (an undo of a departure that has not
arrived) stays with the checkpoint until it can. Rows combine with later
events by each part's `merge`, which mirrors the reducer's own case and is
tested on every split of the fixtures' events, so the phone's language is
the in-memory fold's in any order. A first download is read back one piece
at a time (`stateSplitter`, `SnapshotRows`), so neither the whole text nor
the whole state is ever in memory. Its rows go straight into the table
(moving Koro's 160,000 rows from a staging id took 200 s on the emulator),
and rows with no checkpoint beside them are dropped when a language opens,
so a download cut short is never read; a phone replacing a language it has
(after a redaction) writes the new rows aside and switches with its
checkpoint. A language's syncs, pushes, pulls and refolds take turns on a
phone (`SyncClient.exclusive`), whichever session starts them: two first
downloads at once (the scheduler's and "Sync now") each cleared the rows
the other wrote, and a fresh phone showed recorded passages as not started.

Memory holds the passage on screen, two on each side, and its book and
chapter (`loadUnits`, `shell/usePassagesInMemory.ts`), what arrived since
the last checkpoint, and the verdicts on files anything in memory names. A
passage's screen waits the moment it takes to bring it in
(`shell/usePassageReady.ts`).

Lists read one line per passage (`PassageLine`, core `passageLines.ts`):
Map, Progress, My Work, the Inbox badge, Up next, the overview, Get ready,
set-aside counts, a book's divisions and who usually reviews a check. A
line is core's own `derivePassage` of that one passage, worked out from its
rows and memory (`KeptLines`) whenever an event touches it, and every line
when the flow, its kinds or the teams change. Lines are kept beside the rows
(a few hundred bytes a passage: Koro's 570 are 0.37 MB), and the lines still
owed are written with each checkpoint, which prunes the events that owe
them. The Inbox, a check logged across several passages and a key term's
uses read the few passages they need from disk (`withPassages`); the Inbox
reads a passage again only when its line changed. File planning (what to
send, fetch or free, the offline counts) reads which record names each
file, in which passage (`audio` rows), and the verdicts, never the records
(`LanguageFiles`, core `FilePlan`), so a person who keeps a whole language
offline holds its file list, not its records.

Nothing here needs a migration. The rows are the checkpoint cut up: a new
reducer version drops the checkpoint and its rows together, as before, and
the phone downloads again. Lines are worked out by the app's code, so they
are stamped with the build that worked them out (`appBuild()`: a web page's
commit, a phone's runtime and update) and every line is worked out again
under a new one. Two rules come with it, each held by a test: a new map in
the state says whether it is cut by passage, and if so how to find its
passage and combine two copies (`passageParts.test.ts`); and app code never
loops over passage records or calls one of core's answers about every
passage (`READS_EVERY_PASSAGE`) on the live state, outside a short list
saying why its passages are in memory (`apps/mobile/test/wholeLanguage.test.ts`).

The server, its snapshots, the events and the reducer are unchanged; the
Worker and server jobs hold whole languages in memory as before. Tests: a
phone kept on disk agrees with one held in memory on every record and every
line, through checkpoints, restarts, a first download, an old checkpoint
and a redaction (`keptLanguage.test.ts`), and half of a fleet kept on disk
ends with the server's language and lines and moves all its audio
(`fleet.test.ts`). Koro's part in memory is now 0.13 MB of shared language
and 0.37 MB of lines (as JSON), against 40 MB. Measured on a 2 GB emulator
with a release build, Koro adds 2 MB to the app once open instead of
182 MB (43 MB at the peak instead of 227), and opens in 9 s; a language four
times its size adds nothing once open instead of 852 MB (59 MB at the peak
instead of 1.7 GB), and opens in 33 s.
Reverse if: bringing a passage in from disk makes moving between passages
noticeably slow on a cheap phone, or the lines themselves outgrow cheap
phones (then lists page their lines from disk).

Amended (2026-10-16, Carl Sauder): merged onto main at decision 133 as
`carl/big-languages-e`, option E of `docs/big-languages-plan.md`, which
weighs the alternatives and sets out option F (the server cuts the
snapshot by passage) as the step after. What the merge settled:
`markChanged` is an `all` touch for the incremental views (120); a
checkpoint from another reducer takes the kept rows and lines with it
(110); a review or note taken back is a passage part hanging on what it
takes back (111); two copies of a take keep the first archive's who and
when (124). Closed on the way: a pull of the whole log from the start
(after a reducer bump before the server has a snapshot for it, or a
redaction waited out) skipped every checkpoint until the tail was reached,
so a language of Santhali's size would have been folded whole into memory
before its first cut to rows. A language kept on disk now checkpoints
every `checkpointEvery` events while catching up, each one moving the
passages folded so far onto disk and out of memory, except once a
redaction was pulled in the slice, whose target the refold at the end
undoes from the log (`keptLanguage.test.ts` holds a pull from zero under
the limit throughout). Known cost: a first
download works out every passage's line on the phone (Koro × 4: 33 s; a
language of Santhali's size, an estimated one to two minutes), which F
removes. Still open from the plan: folding the local log in pages rather
than from one array (`store.all`), and moving the whole-language guard
(`apps/mobile/test/wholeLanguage.test.ts`) into lint.

Amended (2026-10-19, Carl Sauder): merged with main again, and the
entry is 143 (main took 134 to 142). A kept language's local checkpoint
leaves its passages out, so a build from before this one (an update rolled
back) would read it as the whole language at the same reducer version,
show passages empty and save that. Carl chose not to bump
`REDUCER_VERSION` for it, since the fold's output is unchanged and option F
changes the local format again soon: two forced downloads of every
language for no change to the fold. Instead the local checkpoint is tagged
`reducerVersion * 100 + KEPT_CHECKPOINT_FORMAT` (`keptCheckpointVersion` in
`packages/sync/src/syncClient.ts`). A build that only knows whole
checkpoints matches no such tag, so it drops the checkpoint with the
stream's cursor (110) and takes the server's snapshot, which keeps the
plain reducer version. This build reads its own tag, and also a whole
checkpoint of its reducer, which it moves onto disk on open, replacing
any rows left from before rather than combining with them, since a
redaction may have come between. `KEPT_CHECKPOINT_FORMAT` is raised
whenever what a kept checkpoint leaves out changes; F raises it.
`keptLanguage.test.ts` holds a rollback and a roll-forward across a
redaction. A reducer bump stays for changes to the fold's output.

Amended (2026-10-20, Carl Sauder): the two items left open are done, and
the live duplicate guard is compacted. The local log is folded a page at a
time (`EventStore.page`, in id order after a cursor, by type when asked;
SQLite indexes `(org_id, stream_id, id)`), on load, on a snapshot adopt
and on the slow checkpoint path, so a phone back from a long offline
stretch never holds its log in one array. Redactions are read first, as a
whole fold applies them, so a target on any page is never applied; the
rest of the fold is order-independent (invariant 2). After a fast
checkpoint of a kept language, the live state's `appliedEventIds` keeps
only the events still in the log, as a relaunch has it: a pull asks for
what is past the cursor, and a refold starts from the checkpoint, whose
guard is empty. Our own events pushed and not yet pulled stay in the log,
so their pull is still skipped. The capped-heap pull of a whole log now
retains 2 MB, down from 11 (`keptMemory.test.ts`). The guard is now lint,
`whole-language/no-every-passage` (`scripts/lint/wholeLanguage.mjs`): it
reads the syntax, so it caught a loop the regular expression missed
(`Object.values(state.kindReviews ?? {})` in `workspaceModel.ts`, which
runs on the passage on screen and is listed). It also reports a listed
read that is gone. `wholeLanguage.test.ts` holds the rule's lists equal to
core's `PASSAGE_PARTS` and `READS_EVERY_PASSAGE`. And a redaction pulled
on the same page as its target no longer reads as one inside the
checkpoint: the pull looked the target up in the store before the page
was written, so the phone waited for a fresh server snapshot, skipped its
checkpoint and asked again on every pull, for a target a refold of its
own log removes. The page's own events are looked at first.
