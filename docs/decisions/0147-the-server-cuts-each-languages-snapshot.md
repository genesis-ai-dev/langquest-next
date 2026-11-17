# 147. The server cuts each language's snapshot by passage and keeps every passage's line, and a phone's first download fills the passages in behind the Map

Date: 2026-10-20 · By: Carl Sauder · Status: accepted

Reason: under decision 143 a phone holds a big language on its disk, but
its first download still moved the whole snapshot (Koro Miyan: 40 MB, about
five and a half hours at the slow link's 2 KB/s) and worked out every
passage's line on the phone before the language opened (a language four
times Koro's size: 33 s). Carl chose option F of
`docs/big-languages-plan.md` (sections 3, 4.2 and 5), with the host plan's
settled points: the pass folds a whole language on the 4 GiB job host
(141) and then cuts it; it is the one producer of per-language aggregates
(142); decision 3 stands. The cut is the phone's own code: core
`partEntries` places each entry and sync `entryRows` makes its row
(`packages/sync/src/serverCut.ts`), as `SnapshotRows` does reading a
snapshot's text; `serverCut.test.ts` holds the two equal with the text in
jsonb's key order, and the integration test holds Postgres's rows equal to
the phone's cut of the same snapshot's pieces. Two rows the phone keeps are
not stored: which record names an audio file (`audio`, made again on the
phone from the entry), and a file's verdict goes under the passage of the
first record naming it, so it comes with that passage (`''` when none
does).
- Storage (migration `20261020150000_snapshot_units_and_passage_lines.sql`):
  `snapshot_units` holds the rows of each language's newest snapshot, with
  what the whole language shares as one row (kind `shared`, unit `''`). The
  pass sends them in batches of 2,000 to `snapshot_units_staged`
  (`stage_snapshot_units`) and `put_snapshot` moves them in, in the same
  transaction as the snapshot; only the newest snapshot keeps rows, since a
  phone fills from the newest snapshot at or past the one it started from,
  and rows go with their snapshot (88). `passage_lines` holds every
  passage's line of a `LINES_VERSION` (`put_passage_lines`, written each
  time the pass folds the language, rewriting only lines that changed; its
  `''` row is the seq every line holds at). Lines are their own table, not
  rows of the snapshot (the plan's sketch), because they change with every
  pass and with `LINES_VERSION`, not with the snapshot. A phone reads them
  through three RPCs: the head (`get_snapshot_head`: the shared part, each
  passage with rows and how many, and the lines), a few passages' rows a
  page at a time in (unit, kind, id) order (`get_snapshot_rows`), and which
  passage an entry is in (`get_snapshot_passages`). `snapshots.state` is no
  longer written (performance-audit-app.md V7): builds from before and the
  Worker read the pieces (89), and `get_snapshot` and
  `diag.language_health` read the pieces and the size.
- `LINES_VERSION` (core `passageLines.ts`) says what a line says, beside
  `REDUCER_VERSION`; `linesVersion.test.ts` holds it to a hash of
  `passage.ts` and `passageLines.ts`. The pass's `PROJECTION_VERSION`
  includes it, so a bump writes every language's lines on the next pass,
  and a language with nothing new gets the cut and the lines it lacks when
  the pass visits it. A phone takes server lines only of its own
  `LINES_VERSION`, and only lines that hold at or past the snapshot.
- The fill (`packages/sync/src/keptFill.ts`): a first download takes the
  head, keeps the shared part as its checkpoint and the lines as its lines
  in one write, opens the Map, and pulls the tail. Before a pulled page is
  folded, every passage an event past the lines' seq touches is filled
  (an event on a take, review, departure, request or note the phone does
  not hold asks `get_snapshot_passages`); so a line is either the phone's
  own reading of rows it holds or the server's line of a passage nothing
  pulled past that line has touched, and the Map is exact. Then, between
  syncs while online (`SyncClient.fillSome`, outside the pull, so audio
  moves meanwhile): what a screen opens or this phone's own work touches,
  the person's offline scope (61) and the passages whose record concerns
  them, then the rest in the server's order, about 1,000 rows a request.
  Rows from any snapshot at or past the shared part's join what the phone
  holds by each part's `merge` (143), so a snapshot rolling forward
  mid-fill costs nothing. The end state is 143's: every passage's rows on
  disk. The fill's record is kept beside the checkpoint
  (`fill:<org>/<stream>`, and a `filled` row per passage written with its
  last row). Without a cut, without lines of this `LINES_VERSION`, or with
  lines older than the snapshot, the phone downloads the whole snapshot as
  under 143.
- Two transients, both named in the plan. A change to the flow, its kinds
  or the teams past the server's lines changes what every line says: the
  lines of passages not filled in stand until the pass writes new ones
  (taken once they hold at or past the phone's and no further than it has
  pulled) or the fill reaches them. And this phone's own work on a passage
  not filled in yet (a request made from the Map, say) shows in lists once
  the passage fills, which is at once online and on reconnecting offline;
  offline, such a passage opens as its line ("Not on this device yet;
  connect to download"), so no one records into it. A redaction while the
  fill runs, or of an event the fill's rows or the server's lines hold,
  waits for a snapshot past it and starts over from the cut.
- The phone's checkpoint format is 2 (`KEPT_CHECKPOINT_FORMAT`, 143's
  amendment): a build that knows only format 1 drops a partly filled
  checkpoint and downloads the language again; this build reads a format-1
  checkpoint as filled. No `REDUCER_VERSION` bump: the fold is unchanged.
- Screens (decision 61's element, `docs/ux/demo-parity.md`): the Map and
  the Sync screen show "Downloading this language" with how many passages
  are on this device and the progress bar; a kept passage is on this device
  once its rows and its audio are; offline, a passage not reached yet shows
  where it stands, its latest version and by whom, and its open requests,
  with "Not on this device yet".
- The organization's Durable Object (44) reads languages the same way for
  the access-token API (70), MCP, review links and webhooks (101): sync's
  `SyncClient` per language, kept on disk in the object's own SQLite
  (`LanguageRecordsKeeper`, `apps/web/worker/languageRecords.ts`, its
  driver gathering a transaction's statements into `transactionSync`),
  four languages open at once, the fill running between answers. The
  passage list, the webhook digest and a token's writes read slices of 25
  passages (`inSlices`); one passage, a review link and a write read that
  passage; whether a voice note is new reads the kept `audio` and `file`
  rows of the whole language, filled in first. `SqliteStore` hands id
  lists to SQLite as one JSON array, since a Durable Object takes few bound
  parameters. Under the 112 MB heap of `orgFolderMemory.test.ts`, a token
  listing every passage of a Bible-size language (4,000 passages of 15
  versions, about 48 MB of fold) peaks at 80 MB and keeps 18 MB, and a
  webhook scan of it peaks at 97 MB and keeps 20 MB; folded whole, the same
  language runs out of memory. Reports need every passage's record, so
  they are never made from the shared part: they render from the inputs the
  pass stores (142), and a language past 25,000 events with none stored yet
  is named as being prepared rather than folded (142's amendment).
- A small language (at most 2,000 rows to fill) is filled in whole in its
  first sync, right after its Map opens, so it is whole on the device when
  that sync ends, as before the cut; only bigger languages have the fill's
  window.
Numbers. Before its Map opens a phone now downloads the head: for Koro,
the shared part (0.13 MB) and lines (0.37 MB) that 143 measured on Koro
itself, 0.5 MB as JSON, about four minutes at 2 KB/s against 40 MB and five
and a half hours. Santhali (61 MB, eight and a half hours) was not measured:
a synthetic language of its size (3,200 passages, 224,000 events, a 58 MB
state) has a 1.5 MB head, about twelve minutes. `scripts/bench/fill.ts
--org --language` measures a hosted language's head and rows, raw and
gzipped, with the bench's service key. In the capped-heap test (40 MB) a
first download by fill peaks at 21 MB against 23 MB from the snapshot, with
0.7 MB of its 32.7 MB moved before the Map opens; on the job host the cut
and lines take the Santhali-size fold from 318 MB of heap (533 MB
resident) to 353 MB (679 MB) (`scripts/bench/cutPeak.ts`), well inside
`standard-1`.
Not chosen: rows for every retained snapshot (only the newest is ever
read); sending the rows inside `put_snapshot`'s call (a second copy of a
61 MB body in one request); filling only the person's own passages and
showing server lines for the rest (the Map would mix stale lines with
exact ones; section 4.2).
Reverse if: a first download's head outgrows a slow link (then page the
lines too), phones rarely finish a fill and live on transients, or keeping
the rows beside the pieces outgrows the database plan (then the pieces go,
once no build reads them).

Amended (2026-10-20, Carl Sauder): the fill does not narrow decision 3.
Decision 3 leaves cold start to the server, and a cold start is any start
from the server, not only a phone's first download: an update that changes
the reducer or the kept checkpoint's format drops the checkpoint and puts
the cursor back to 0 (110, 143's amendment), as does a redaction the phone
waited out, and a reinstall has nothing at all. Ever since phones prune
their log behind a checkpoint, such a phone held its own unsent events but
not the pruned history (the passages' `UnitAdded`, the flow, earlier
versions), so it could not show that work in place or usefully carry on
until a whole snapshot or the whole log came down: hours on a weak link
for a big language, before 143 and under it. The fill shortens that
window to the head; the one thing it adds, a person's own unsent work on a
passage not filled yet reaching lists once that passage fills, falls
inside it. Heads measured in production on 2026-10-20 (reducer 19, lines
version 1, as JSON; at 2 KB/s): Santhali omt bible 0.18 MB shared and
0.47 MB of lines for 652 passages against a 64.6 MB snapshot, about five
minutes against nine hours; Halbi 0.51 MB against 50.7 MB; Kuturmi Iwingo
EL 0.69 MB against 50.0 MB; Bhujel 1.12 MB (1,173 passages) against
43.8 MB; Meche 0.47 MB against 40.8 MB. Santhali's real head is under half
the 1.5 MB the synthetic language gave. All 370 languages at reducer 19 had
their cut and lines. Snapshots of reducer versions 15 to 18 are still kept
(88 expires older snapshots of the same version only); whether they expire
is open.

Amended (2026-10-20, Carl Sauder): a fill reports itself in field
diagnostics, so support sees one that should have run and did not. A
`fill` record (`DIAG_SCHEMA`, migration `20261020180000_diag_fill.sql`)
says `start` when the Map opens (ms to the Map, head size, passages and
rows to fill, why), `done` once every passage's rows are here (ms since
the start, across sessions), `fallback` when the phone took the whole
snapshot instead (`no_rpc`, `no_cut`, `no_lines`, `old_lines`, `error`),
and `restart` when its cut went away. A fallback is recorded only once the
whole snapshot is taken, so a language with no snapshot at all stays the
`snapshot` record's `none`. `diag.install_summary` carries a phone's last
20, and `scripts/diagSignals.ts` reads them: a fallback the server caused
(no cut or lines) is a problem pointing at the projection pass, other
fallbacks, restarts and a fill unfinished a day on are a watch, and a fill
that took over a day is noted. Field names and values are enums and
counts, so no Play declaration changes.

Amended (2026-10-20, Carl Sauder): the fill puts a page's rows in memory
after its write, for the passages memory holds by then. It used to decide
before the write and then wait for it. A screen that opened a passage in
that wait read the disk before the rows landed and was told the passage
was ready, and the write then marked it filled. The passage read as loaded
with its records in neither memory nor disk's answer, and the passage
screen, which shows a passage once it reads as loaded, drew it as never
recorded. Web UI tests REV-017 and REC-011 failed this way on CI, where
each world has a cut by the time a fresh browser opens its language.
Putting an entry twice is a join, so a passage that also read those rows
from disk loses nothing. `keptFill.test.ts` holds the write open while the
passage opens.

Amended (2026-10-26, Carl Sauder): three storage changes, none of which
changes what a phone receives (migration
`20261026170800_snapshot_cut_storage.sql`). `put_snapshot` counts each
passage's rows once and keeps them on the snapshot (`snapshots.unit_counts`),
so `get_snapshot_head` reads them instead of counting every unit row on a
cold open (a cut from before is counted as it was until its next snapshot;
the migration fills the existing ones). `snapshot_units_staged` is
unlogged: its rows live minutes and are written again into `snapshot_units`,
so keeping them out of the WAL takes about a third off a snapshot's write;
a crash empties it and the next visit stages the cut again. Lines keep a
digest (`passage_lines.digest`) and the pass sends only the lines whose
digest differs from the stored one, and the ids of passages that have none
(`passage_line_digests`, `put_passage_lines_delta`); `put_passage_lines`
remains for a pass that cannot read the digests, and now finds the lines to
drop by a join rather than a scan per stored line. Not changed: the staged
rows are still inserted into `snapshot_units` and the old ones deleted, since
the table is keyed by the snapshot's seq and a new seq is a new row;
decision 88's retention is as it was.

Amended (2026-11-11, Caleb Koster): once a screen has shown "Downloading
this language", the banner stays where it is when the last passage arrives,
as "On this device" with a full bar and the same height, until the person
leaves the screen. Taken away at once, it moved the list under it up by its
height mid-tap: on the web the tap landed on nothing, and on a phone it can
land on the row below (LAN-253, the nightly's STUDY-030).
