# Plan: big languages on a 2 GB phone

Status: E merged onto main as branch `carl/big-languages-e` (decision 143, 2026-10-16); F built on branch `carl/big-languages-f` (decision 147, 2026-10-20), section 4.2 says what was built · Carl Sauder, with Claude · 2026-10-16

Written against `origin/main` at `583f744c` and pull request 120
(`caleb/unit-loading` at `ded635a1`). Companion to the server host plan
(job host sizing for whole-log folds and the v2 import), which is written
elsewhere; section 2 says what this plan takes from it. Section 3 (H) and
section 4.4 weigh two proposals from a parallel review: streams by book,
and cutting the peaks.

## 1. The problem, in numbers

A phone holds a whole language's fold in memory. The fold is one JSON
object (`LanguageState`), and nearly all of it is per passage: recordings,
takes, reviews and notes are the four biggest keys of a Bible-scale
snapshot (3.9, 3.4, 3.4 and 1.9 MB of 14.2 MB in `npm run bench:core`).
What the whole language shares (units, flow, teams, materials, key terms)
is small: Koro Miyan's is 0.13 MB.

| Language | Events / state | Phone, release build, 2 GB emulator | Server |
| --- | --- | --- | --- |
| Koro Miyan (570 passages, 37,000 recordings, 541 versions) | 40 MB snapshot | 182 MB once open, 227 MB at the peak, opens in 8 s | too big for the Edge pass (decision 103) |
| Koro × 4 (a synthetic test) | about 160 MB | 852 MB once open, 1.7 GB at the peak; killed in a debug build | |
| Santhali omt bible | 225,000 events, 61 MB | not measured; a 2 GB phone would not survive it | 850 MB in Node (decision 103) |
| Kuturmi, Halbi | 35 to 61 MB | not measured | `put_snapshot` needed the two-minute timeout |

Partner phones are 2 GB Androids, and the v2 transfer brought languages of
Santhali's size. So the phone needs a design under which what it holds in
memory does not grow with the language, and the server needs one host that
can fold the biggest language whole. The second is the host plan's; this
plan is the first.

## 2. What this plan takes from the host plan

Three things are settled there and assumed here:

1. **A 4 GiB job host folds whole languages.** The one-time refold of every
   language, refolds at reducer bumps and refolds from zero after a
   redaction fold a whole language in memory and then cut it up. No
   streaming fold with spilled state, on day one or later. The cut is
   `partEntries` over a finished fold, which is simple and already written.
2. **The pass is the one producer of per-language aggregates.** Progress,
   people and the report inputs for a language are computed by the pass and
   stored, versioned by `REPORT_VERSION`. The phone's Progress for other
   languages already reads them (decision 57), and the Durable Object reads
   the same rows instead of holding whole folds (performance-audit-app.md
   V4). Nothing in this plan asks a server consumer to fold a whole
   language.
3. **Decision 3 stands.** A phone folds the units it opens from its own
   log and never waits on the server to show its own work. Per-unit loading
   changes what the phone holds, not who it depends on. In particular a
   passage's line (section 4) is worked out on the phone from the phone's
   own fold, never fetched as the truth.

## 3. Options considered

**A. Shrink the state in memory.** Intern repeated strings, store card
hashes once, drop `blobs` for files nothing names, encode registers
smaller. Each derive function and the snapshot format change, and the gain
is a constant factor of perhaps two to four. Koro × 4 would still be
several hundred megabytes. Not the fix; a later tuning at most.

**B. A thin client for big languages.** The phone shows server-computed
lines and views for a language past some size. It breaks decision 3 (a
translator must see their own recording at once, offline), makes two
products, and the host plan's third point rules it out.

**C. The fold in SQLite tables.** The reducer writes rows and derivations
query them. Every reducer case and derive function changes, derivations
become asynchronous or synchronous SQL, and the reducer is no longer the
one shared byte-for-byte with the server (invariant 8). The largest change
with the least reuse.

**D. Keep the whole log on the phone and fold a passage on demand.** A
cold start would pull Santhali's 225,000 events on a 2 KB/s link, decision
110 turned down keeping the whole log on the phone, and once the start is
a snapshot cut by passage this is option E.

**E. Pull request 120: the phone cuts the server's snapshot by passage.**
The phone reads the server's whole-language snapshot back one piece at a
time without ever holding the whole text or the whole parse
(`stateSplitter`), writes each passage's entries to a `kept_rows` table,
and keeps in memory only what the language shares, the passage on screen
with two on each side, what arrived since the last checkpoint, and one
short line per passage for lists. The tail folds onto that partial state
with the ordinary reducer; at each checkpoint, entries of passages not in
memory are combined with the kept copy by each part's `merge`, which
mirrors the reducer's own choice between two copies, and let go. The
server, snapshots, events and the reducer are unchanged. Measured on the
same emulator: Koro 2 MB once open and 43 MB at the peak, opens in 9 s;
Koro × 4 nothing once open and 59 MB at the peak, opens in 33 s.

**F. The server cuts the snapshot by passage.** The pass, on the 4 GiB
host, folds whole and writes the cut: the shared part, each passage's part
and each passage's line as rows. The phone downloads the shared part and
the lines first (Koro: half a megabyte instead of 40), opens the Map on
them, and fills the passages' rows in behind, the person's own passages
first, the rest in the background. The phone keeps exactly E's structure
(rows per passage, lines, a bounded set of passages in memory, the tail
folded and merged at checkpoints) and ends in E's state, every passage's
rows on disk; what changes is where the rows come from and in what order,
and that a 40 MB text is never cut on the phone. F is a download order
and a server-side cut, not a rule that a phone holds less than the
language (section 4.2 says why).

**G. A coarser unit: the book.** Fewer rows and simpler loading, but lists
still need a line per passage, and a book of a dense language is tens of
megabytes. Granularity is a tuning of E and F, not a third design.

**H. Shard a language into streams by book.** Proposed in a parallel
review as decision 37's argument one level down: a small language head
stream holds what the language shares (flow, teams, key terms, materials,
settings, the list of books), each book is a work stream of its own, and a
phone pulls the books a person works in. Work payloads carry no stream id,
so nothing shipped changes shape; invariant 6 would let an event reference
the head stream as it may the library; existing languages could stay one
stream. This is not G. G loads a book's rows out of one stream; H makes the
book the sync unit, which is the same head-versus-passage partition E
makes in the fold, moved into the sync layer and made at write time. What
it costs and what it leaves undone are in section 4.3.

| | A shrink | B thin client | C SQLite fold | E PR 120 | F server cut | H book streams |
| --- | --- | --- | --- | --- | --- | --- |
| Memory once open | grows with language | flat | flat | flat (12 passages + shared + tail) | flat | grows with the books opened; the whole language for anyone who opens the Map |
| Peak at first download | whole text + parse | small | whole fold once | one piece + a thousand rows | one piece + rows | one book's snapshot at a time |
| First download of Koro | 40 MB, parse it all | lines only | 40 MB | 40 MB, 9 s to open; lines worked out on the phone | 0.5 MB to the first Map; rows fill in behind, own passages first | the head, then a book at a time |
| Offline, own work at once | yes | no | yes | yes | yes | yes |
| Invariants 2, 3, 8 | kept | kept | 8 broken | kept; `merge` is a second statement of the reducer's rules, tested against it | kept; same | kept; 6 amended |
| Server change | none | large | large | none | the pass writes a second cut; a table and two RPCs | a new stream kind through every stream-scoped rule (section 4.3) |
| Fits the host plan | n/a | no | n/a | yes | it is the host plan's "split it into unit snapshots" | smaller folds per stream; the aggregates still per language |
| State of the work | not started | | | on main (decision 143) | built (decision 147, section 4.2) | not started; contradicts decision 63 |

## 4. Recommendation

Land E, then build F on it, in that order. They are one design in two
steps: F changes where a phone's rows come from, not what the phone does
with them, and everything F needs on the phone (the row shape, the merge
at checkpoints, lines, loading on demand, the guard against reading every
passage) is what E builds. E ships the fix for 2 GB phones now, with the
server untouched; F puts the Map on screen seconds into a first download
instead of after a 40 MB transfer, with the person's own passages filled
in first, and it is the piece of the host plan that touches the phone.

Why E is sound, and not only measured: the reducer never drops an event
because its target is absent. Every case keys on its own id with first or
latest wins (`firstWins`, `lww`, `earliestUndo`), and `TakeArchived`
writes a placeholder a later `TakeComposed` fills in. So the tail folded
onto a partial state is a partial fold, the kept copy is another, and
each part's `merge` is the join the reducer itself would reach.
`passageParts.test.ts` checks that on every split of the fixtures'
events, `keptLanguage.test.ts` holds a phone kept on disk equal to one
held in memory on every record and every line through checkpoints,
restarts, a first download, an old checkpoint and a redaction, and
`fleet.test.ts` runs half a fleet on disk for three simulated days.

### 4.1 Conditions on pull request 120 before it merges

1. **Rebase onto `main`, and retarget the pull request.** It is based on
   `caleb/big-language-speed`, which is merged; GitHub shows 191 files
   because the base is stale, while the branch's own change against `main`
   is 75 files (+4,290, −528). A trial merge (`git merge-tree`) conflicts in
   30 files, the real ones being `passage.ts`, `syncClient.ts`,
   `languageSession.ts`, `useLanguage.ts` and the fleet. Its decision is
   numbered 110, which `main` has used; the next free number is 143.
2. **Meet decision 120 (incremental views) in `passage.ts`.** `main` now
   patches passage views per published copy from a change log
   (`changes.ts`, `touchedBy`). The branch's `markChanged`, called when
   rows come into memory or leave it, must count as an `all` touch, or a
   view built before a passage was brought in will keep showing it empty.
   `incrementalViews.test.ts` should get a case with a load and a shed.
3. **Meet decision 110 (a stale checkpoint is dropped).** `main`'s `load()`
   drops a checkpoint from another reducer version and puts the cursor back
   to 0. On the branch the rows and lines belong to that checkpoint, so the
   same write must clear `kept_rows` and the owed-lines key, or the next
   open reads rows of the old reducer beside an empty state.
4. **Classify `main`'s new maps.** Decision 111 added `withdrawnReviews` and
   `withdrawnNotes` (`v1.ReviewWithdrawn`, `v1.NoteWithdrawn`) to
   `RecordState`; the branch's `PASSAGE_PARTS` and `eventPassage` do not
   know them. The "every map says whether it is cut by passage" test will
   fail on the rebase, which is what it is for. A withdrawn review hangs on
   its review; a withdrawn note hangs on its note, which means a `note`
   kind in `hangsOn` and `passageInMemory`, which today know only take,
   review, departure and request. Decision 124's tombstones (`archivedAt`)
   are already in `keptTake`; decision 125 added no map.
5. **Keep one path.** `keepOnDisk` is on for every language in the app, so
   there is one read path in production and the in-memory mode is a test
   twin. Keep it that way; a size threshold would be two products.
6. **Keep `merge` beside the case it mirrors, and keep the fixture list the
   only input.** The permutation and idempotence tests already run on the
   fixture list; `passageParts.test.ts` runs on the same list, so a new
   event needs one fixture and no second test. Write that in the event
   checklist in `AGENTS.md` ("Every new event type needs"): a fixture, and
   a `PASSAGE_PARTS` entry or `eventPassage` case when it touches a map cut
   by passage.
7. **Move the whole-language guard to lint.** `wholeLanguage.test.ts`
   matches sources with a regular expression. The rule it holds ("app code
   never loops over passage records on the live state, outside a list that
   says why") is the kind `eslint.config.mjs` already holds for imports,
   and a rule's message says where the code belongs. Not a blocker.
8. **Record the first-download cost and where it goes next.** Every
   passage's line is worked out on the phone before the language opens
   (Koro × 4: 33 s; a Santhali-sized language, estimated one to two
   minutes), from rows read 25 passages at a time. It is a first-download
   cost, bounded, and F removes it. Say so in the decision entry's
   "Reverse if".
9. **Close the pull-from-zero hole.** `pullNow` skips the checkpoint while
   `more` pages are coming ("it serializes the whole state"), on `main` and
   on the branch alike, and `load()` reads the whole local log into one
   array (`store.all`). So a phone that pulls a language's log from the
   start, which decision 110 makes it do after a reducer bump until the
   pass has written a snapshot for the new version, and which a redaction
   waiting past its half hour does too, folds the whole language into
   memory before the first checkpoint cuts it into rows. For Santhali that
   is the 850 MB case on a phone. On the branch the reason to skip is gone:
   a checkpoint writes rows and a small shared part, not the whole state.
   So checkpoint every `checkpointEvery` events during a catch-up as well,
   and have `load()` fold the local log in pages by sequence rather than
   from one array, with a `keptLanguage.test.ts` case that pulls a large
   fixture from zero with no server snapshot and holds the passages in
   memory under the limit throughout. Also drop `appliedEventIds` from
   the live state at each checkpoint, as `takeSnapshot` does.

### 4.2 F: the server's cut, after E

Build it as the host plan's "split it into unit snapshots" step, against
E's phone.

- **The cut is core's.** The pass folds whole, then runs the same
  `partEntries` and `entryRows` that E's `SnapshotRows` runs on the phone,
  so the server's rows and the phone's are one code path (`packages/sync`
  runs on the job host already, decision 104). A parity test holds the
  server's rows for a snapshot equal to the phone's cut of its text.
- **Storage.** A `snapshot_units` table beside `snapshot_chunks`: `(org_id,
  stream_id, reducer_version, server_seq, kind, id, unit_id, ref, json)`,
  with the shared part under a reserved unit id and lines under
  `kind = 'line'`. Written by `put_snapshot` in the same transaction, kept
  under decision 88's retention, read by two service-free RPCs: the shared
  part with the lines, and the rows of a list of units. Pieces stay for the
  Worker and the agent view until they read rows too; V7's double storage
  is then three copies, and `snapshots.state` should stop being written
  (performance-audit-app.md V7) in the same change.
- **The phone's local format changes again.** A phone part-way through a
  fill holds only some passages' rows, so F raises `KEPT_CHECKPOINT_FORMAT`
  (decision 143, amended 2026-10-19): an E build rolled back from F drops
  the checkpoint and fetches the stream again, rather than reading a
  partial fill as complete. No `REDUCER_VERSION` bump: the fold's output
  does not change.
- **Lines carry a version.** A line is core's `derivePassage` of its
  passage. E stamps lines with the app's build because a build may read a
  passage differently. Under F a phone that holds only some passages'
  rows cannot work out the rest's lines itself, so the server's lines must
  be the ones the phone would compute: give core a `LINES_VERSION` beside
  `REDUCER_VERSION`, bumped when `passage.ts` or `passageLines.ts` changes
  what a line says, held by a test the way the worker bundle is held to its
  source. A phone takes server lines of its own two versions as the
  starting point for passages whose rows have not arrived yet, and derives
  every line itself once they have. A server line is never stored status
  in invariant 5's sense: the phone can and does rederive it.
- **The fill, and why the phone ends up holding every passage's rows.** A
  first sketch of F had a phone hold only the passages it opens or keeps
  offline, with the server's lines standing in for the rest. That makes
  the Map inaccurate in a way E and today's app are not: the phone pulls
  every event of the language, but for a passage whose rows it lacks it
  cannot rederive the line from a new event (whether a review completes a
  step depends on the whole record), so the Map would show the server's
  line, up to 200 events or an hour old (decision 88), beside the phone's
  own exact lines. That is the mixed-source screen decision 57's "Reverse
  if" names, and it would cut against decision 3 for everyone else's work.
  So under F a phone fills in every passage's rows, in this order:
  - the shared part and the lines (Koro: half a megabyte), on which the
    Map opens;
  - the passages any event in the pulled tail touches (below);
  - the person's offline scope (decision 61: asked of them, worked in,
    chosen with Keep offline), which also drives the audio fetch as today;
  - the rest, in the background, while the phone is online, with the
    progress shown on the Map and in Settings the way decision 61 shows
    audio ("Downloading this language: 1,200 of 5,000 passages").
  The end state is E's: every passage's rows on disk (Koro's 40 MB,
  against its 61,000 audio files), memory flat. On a 2 KB/s link the
  person works on their own passages minutes into a download that takes
  hours to finish, instead of waiting for all of it.
- **Every line on the Map is exact, with one transient.** The rule: before
  a pulled event's passage shows on a list, the phone fetches that
  passage's rows (the pull proves the connection is there), merges them
  with whatever partial fold it already holds for the passage, and derives
  the line itself. Then each line is one of two things: the phone's own
  derivation from rows it holds, which is exact; or the server's line for
  a passage no pulled event has touched since the snapshot that produced
  it, which is also exact, because a record no event has touched since
  the snapshot has not changed. Which snapshot the rows come from is the
  newest, always at or past the one the phone's lines came from; the join
  with the phone's partial rows and tail is `merge` and idempotent
  application (invariant 3), so the seam never double counts and never
  misses. The transient: a change to the flow, its kinds or the teams
  while the fill is still running changes what every line says, and the
  phone cannot rederive the lines of passages not yet filled in. Those
  lines stand until the pass writes new lines (the pass folds every
  changed language every run, so writing lines each run, not only with a
  snapshot, is cheap) or the fill reaches them. Flow and team changes
  happen at setup, and the fill finishes. An event that hangs on a take,
  review, departure or request whose passage the phone does not know yet
  asks the server which passage it is (one small RPC by kind and id), as E
  keeps it unplaced until it can tell.
- **What the Map shows while the fill runs.** The same picture it shows
  after: every passage's disc and every chapter tile drawn from its line,
  which is exact under the rule above, and search over every passage,
  since the units are in the shared part. Three things differ. A fill
  banner, the element decision 61 already uses for audio ("Downloading
  for offline" with progress), says "Downloading this language: 1,200 of
  5,000 passages" and then goes away. Decision 61's mark for "on this
  device" on discs and tiles means rows and audio here; a passage whose
  rows have not arrived has no mark, and the person's own passages get
  theirs first because they fill first. And a tap on an unmarked passage
  waits a moment online (`usePassageReady`, as a passage brought in from
  disk does today) and offline opens a passage screen that shows what the
  line knows (status, latest version and by whom, open requests) with
  "Not on this device yet; connect to download" where its versions,
  reviews and history would be. Progress, My Work and Up next read lines,
  so they are exact throughout; the Inbox reads a few passages' rows, and
  those are the passages the pulled tail touched, which fill first. The
  banner is the one new element, and it follows `docs/ux/demo-parity.md`
  as decision 61's lines did.
- **Decision 61's sentence** that text, status and history are always
  whole on the phone becomes: whole once the fill is done; until then a
  passage's line stands in for its record, and the Map says the fill is
  running. "Ready for offline" counts rows held as well as files.
- **The Durable Object and the agent view** read the shared part, the
  lines and the aggregates from the pass (host plan, point 2), and the
  rows of a passage when an agent asks for one. The 40 MB in-memory budget
  and midnight refolds (V4) go away with the whole folds.

Measure after F: bytes downloaded and seconds to first list for Koro and
Santhali on the 2 GB emulator at 2 KB/s, against E's 40 MB; peak memory
unchanged from E.

**What was built (decision 147, branch `carl/big-languages-f`).** As
designed above, with these choices and corrections:

- *The cut* is `packages/sync/src/serverCut.ts` (`cutLanguage`, `cutRows`,
  `languageLinesOf`): core's `partEntries` and the phone's `entryRows`. Two
  phone rows are not stored: `audio` rows (the phone makes them again from
  each entry) and a file verdict's passage, which is the first passage whose
  record names the file, `''` when none does, so verdicts come with the
  passage that plays them.
- *Storage.* `snapshot_units` keeps only the newest snapshot's rows (a phone
  fills from the newest snapshot at or past its own, never an older one),
  with the shared part as one row (kind `shared`, unit `''`). The pass
  stages rows in batches of 2,000 (`stage_snapshot_units`) and
  `put_snapshot` moves them in, in the same transaction, so the call does
  not carry a second copy of the state. Lines are their own table,
  `passage_lines (org_id, stream_id, lines_version, unit_id, server_seq,
  json)`, not `kind = 'line'` rows of the snapshot as sketched above,
  because they change with every pass and with `LINES_VERSION`; the pass
  writes them each time it folds the language, rewriting only those that
  changed, and its `''` row says which seq they hold at. The RPCs are
  `get_snapshot_head`, `get_snapshot_rows` (paged in unit, kind, id order)
  and `get_snapshot_passages` (the "which passage is this" call).
  `snapshots.state` is no longer written. Migration
  `20261020150000_snapshot_units_and_passage_lines.sql`.
- *Versions.* `LINES_VERSION` is in `passageLines.ts`, held by
  `linesVersion.test.ts`; the pass's `PROJECTION_VERSION` includes it.
  `KEPT_CHECKPOINT_FORMAT` is 2; this build reads a format-1 checkpoint as
  filled, so phones on E do not download again when they update.
- *The phone* is `packages/sync/src/keptFill.ts`. Fill order: passages a
  pulled event past the lines' seq touches (before that page is folded), then
  what a screen opens or this phone's own work touches, then the offline scope
  and the passages whose record concerns the person, then the rest. The
  background part runs between syncs (`SyncClient.fillSome`), outside the
  pull, so audio transfers are not held up for hours. A redaction during a
  fill, or of something the fill's rows or the server's lines hold, waits
  for a snapshot past it and starts over from the cut. Without a cut, or
  without lines of this `LINES_VERSION` at or past the snapshot, the phone
  downloads the whole snapshot as under E.
- *One limit beyond the plan's transient:* this phone's own work on a passage
  not filled in yet shows in lists once the passage fills (at once online,
  on reconnecting offline). Offline such a passage opens as its line with
  "Not on this device yet", so nobody records into it; work made on it from
  another screen (a request from the Map) waits for the fill to show.
- *The organization's Durable Object* reads languages as a phone does: a
  kept `SyncClient` per language over its own SQLite
  (`apps/web/worker/languageRecords.ts`), first downloaded from the cut. The
  access-token API, MCP, review links and webhooks read a few passages at a
  time; Reports keep their stored inputs (decision 142). A Bible-size
  language (4,000 passages of 15 versions) lists and scans inside the
  isolate's heap; folded whole it runs out of memory
  (`apps/web/test/memory/orgFolderMemory.test.ts`).
- *Not done here:* the emulator measurement below.
- *Measured.* Koro's head is the shared part and lines decision 143 measured
  on Koro (0.13 + 0.37 MB): about four minutes to the first Map at 2 KB/s,
  against 40 MB and five and a half hours. Santhali was not measured on its
  own data; a synthetic language of its size (3,200 passages, 224,000 events,
  58 MB) has a 1.5 MB head, about twelve minutes, against 61 MB and eight and
  a half hours. `scripts/bench/fill.ts --org --language` measures a hosted
  language (raw and gzipped); the 2 GB emulator run at 2 KB/s is still to do.
  The pass's peak for a Santhali-size fold went from 318 MB of heap (533 MB
  resident) to 353 MB (679 MB) with the cut and lines
  (`scripts/bench/cutPeak.ts`).

### 4.3 Not chosen

- Blocking E on F. Phones in the field hit this now; F is additive and the
  server work sits on the host plan's schedule.
- Folding per unit on the server. The host has 4 GiB; folding whole and
  cutting is simpler and uses the fold the pass makes anyway.
- Shipping lines from the server as the truth for the open language
  (option B in a smaller coat). Decision 3.
- A book as the unit. Lines are per passage whatever the unit, and a
  passage with its neighbours is what a screen shows.
- Streams by book (H). Three reasons, in order of weight.
  - It does not by itself fix the phone. Map, Progress, My Work, Up next,
    the Inbox badge and who usually reviews a check read every passage of
    the language (the `READS_EVERY_PASSAGE` list), so a phone that shows
    them needs every book stream, and then it holds the whole language
    again unless it also has E's lines and rows. H needs E; E does not
    need H. Decision 37 accepted "a language's progress shows once it is
    on the phone"; "a book's passages show once the book is on the phone"
    would take the Map's whole-Bible search away from the partner demo
    (PLAN.md section 12).
  - It is a new level below the language, which decision 63 and the first
    paragraph of `AGENTS.md` removed on purpose ("there is no project, no
    partition and no lane") and decision 108 refused again for clusters.
    Every rule that is scoped by stream would learn the new kind: the
    organization stream listing book streams, decision 63's "a language
    stream accepts events only once the organization lists it",
    `may_emit` and the scope checks, pokes (117), Inbox rows (68), access
    tokens (70), the change feed (101), webhooks (109), the v2 import's
    routing (94), the agent view, and `derivePassage` reading a composite
    of head and book. Key-term links are the hard spot the review names;
    `referencesUsed`, `releases`, `studyMarks` and materials scoped to a
    unit are the same kind of cross-stream key. Under `AGENTS.md`, a
    change that contradicts a recorded decision is put to the developer
    first, never worked around.
  - Leaving existing languages as one stream means two language shapes
    in production for as long as they live. Decision 37's amendment chose
    the other way for organizations: migrate, keep one shape.
  What H would buy on the server, folds small enough for the Edge pass and
  the Durable Object, the host plan buys with the 4 GiB host and the
  aggregates, and F buys for the download. Reconsider H only if a
  person's working set proves to be a few books and F's per-passage
  download is not enough.

### 4.4 Independent of the choice: peaks and bytes

The same review proposed cutting the peaks to about 1.2 times the state:
parse pieces into the state without a joined string, or store a snapshot
one row per top-level key and parse key by key; load the log in pages by
sequence instead of one array; skip the stringify-then-parse round trip
when adopting a server snapshot; and performance-audit.md item 11
(duplicate card hashes on draft takes, item names copied onto every
`referencesUsed` entry, uncompacted applied ids). None needs a decision
entry, and the review is right that on `main` they move the ceiling a few
times and leave the asymptote alone. Against E:

- Parsing pieces without a joined string is what the branch's
  `stateSplitter` does, one piece and one entry at a time, into rows finer
  than a top-level key. Done by E.
- The stringify-then-parse round trip: `main` already keeps the joined
  text as it came (`onJoined`) for the checkpoint, and on the branch the
  kept path never joins. Done by E.
- Loading the log in pages: not done by E, and the hole in condition 9.
  Take it.
- Item 11 shrinks the state and the snapshot: fewer bytes to download
  (until F), to store twice on the server (V7), to fold on the job host and
  in the Durable Object. Worth doing on its own schedule; it changes the
  phone's memory under E very little, since the phone no longer holds the
  state.

The asymptote point holds for `main` and for A. Under E the phone's memory
does not grow with a language's history; its disk does, as the log and the
checkpoint already did.

## 5. Fitness functions

| Holds | Where | Status |
| --- | --- | --- |
| Every map of the state says whether it is cut by passage, and how two copies combine | `passageParts.test.ts` | on the branch |
| Combining two halves of any split of the fixtures equals folding all | `passageParts.test.ts` (fast-check) | on the branch |
| A phone kept on disk equals one in memory on every record and line | `keptLanguage.test.ts` | on the branch |
| Half a fleet on disk ends with the server's language and lines | `fleet.test.ts` | on the branch |
| App code never reads every passage from memory outside the list | `wholeLanguage.test.ts`, later a lint rule | on the branch |
| Loading or shedding a passage counts as an `all` touch for incremental views | `incrementalViews.test.ts` | done |
| A stale checkpoint takes its rows and lines with it; a build rolled back drops a kept checkpoint | `keptLanguage.test.ts`, `fleet.test.ts` | done |
| A pull from zero with no server snapshot keeps the passages in memory under the limit throughout | `keptLanguage.test.ts` | done |
| A first download reads the snapshot in the server's jsonb key order, and in an order that puts what hangs on another entry first | `keptLanguage.test.ts` | done |
| A checkpoint with unsent work (the slow path) keeps the passages on disk | `keptLanguage.test.ts` | done |
| The server's rows for a snapshot equal the phone's cut of its text | `serverCut.test.ts` (jsonb, insertion and reversed key order), `integration.test.ts` (Postgres's rows against its own pieces) | done |
| `LINES_VERSION` changes when what a line says changes | `packages/core/test/linesVersion.test.ts` | done |
| During a fill, every line a list shows is the phone's own derivation, or the server's for a passage no pulled event has touched since its snapshot | `keptFill.test.ts`: a fill cut at every request for rows, against the server's log and the in-memory twin | done |
| An E build drops a partly filled checkpoint; F reads E's | `keptFill.test.ts` | done |
| A fleet whose phones take their first download by fill ends with the server's language and lines | `fleet.test.ts` | done |
| A first download by fill stays inside the 40 MB heap | `packages/sync/test/memory/keptMemory.test.ts` | done |
| The organization object answers the API and webhooks for a Bible-size language inside its isolate, as a whole fold answers | `apps/web/test/memory/orgFolderMemory.test.ts`, `apps/web/test/languageRecords.test.ts` | done |
| A kept phone opens a 30 MB-snapshot language in a 40 MB heap, by snapshot and by log; held whole it runs out of memory there | `packages/sync/test/memory/keptMemory.test.ts` | done |
| Peak memory on the 2 GB emulator, release build, Koro and Koro × 4 | a measurement recorded in `performance-audit-app.md`, repeated per release | manual |

## 6. Decision log

- Pull request 120's entry becomes 143 on the rebase; its amendment to 19
  (lines are views kept on the phone) stands.
- F is decision 147: the server cuts the snapshot by passage, lines carry
  `LINES_VERSION`, and `snapshots.state` stops being written. It amends 88
  and 89 (what a snapshot is stored as), 61 (what "on this device" means
  while a fill runs) and 44 (the object reads languages from the cut).
- The host plan's entry (the job host, and the pass as the one producer of
  aggregates) is the host plan's to add.
