# Performance audit, 2026-10-26

Date: 2026-10-26. By: Carl Sauder, with Claude. Sources: this repo at
commit `f9814bef`; `npm run bench:core` run on that commit and on
`cda46db` (the commit `performance-audit-app.md` used), interleaved, three
rounds on the same Mac; the web export built that day (`npm run export:web
-w mobile`) and its source maps; the code read by four reviewers (app, core
and sync, SQL and server jobs, Workers), with the top findings of each
checked again by hand. Nothing was measured on a phone or against the
hosted database.

`performance-audit.md` (2026-10-12) covered the event system and
`performance-audit-app.md` (2026-10-15) the app, the Worker and the SQL.
PR 150 (2026-10-16) did most of the second one's list. Since then about
100 pull requests have landed, the largest being big languages (decisions
143 and 147: passages kept on disk, snapshots cut by passage), Global
Viewers (158), the ops dashboard (160 to 162) and the server jobs in
containers (148). This audit re-measures, re-checks the two earlier lists
against today's code (section 4), and ranks what is new (section 3).

The short version:

- **The web app ships every icon in lucide.** The app uses 91 icons, and
  the first-visit bundle carries 1,881 of them: 1.55 MB of the 5.8 MB main
  chunk. Both web budgets are nearly spent again (about 50 KB and 10 KB
  left), and this one change would free about a quarter of the first
  visit.
- **The core fold is fine.** Patching passage views per change (PR 150)
  works: one append then publish costs about 2.5 ms at 5,000 passages
  instead of a 41 ms rebuild. The fold itself is about 13% slower than ten
  days ago.
- **The new costs are in the big-languages machinery and the server's
  passes.** On the phone, the kept-on-disk path does whole-language work
  in places that should touch only a batch: index rebuilds per 25
  passages, a whole-list rewrite per fill page, a scan of every recording
  row per refresh. On the server, one org event refolds every language in
  the org, and several jobs run whether or not there is work.
- **Two quadratic loops** run during the field's most common work. Every
  transferred audio file copies the map of every file's size. And
  recording redraws 128 waveform bars about 21 times a second.

## 1. Baseline

`bench:core`, V8 on a Mac, the median of 5 runs per row, three rounds per
commit, same load (load average about 2.5 on 15 cores):

| What | 5,000 passages, 2026-10-15 (`cda46db`) | 5,000 passages, today (`f9814bef`) | 1,200 passages, today |
| --- | --- | --- | --- |
| Full fold | 137–139 ms | 155–157 ms | 38–40 ms |
| View rebuild per published state | 36–41 ms | 39–41 ms | 8.3–9.2 ms |
| Append one event, then publish and `languageProgress` | (no row) | 2.1–2.6 ms | 0.45–0.5 ms |
| `offlineSummary` | 8.7–10.6 ms | 9.0–9.6 ms | 2.1–2.2 ms |
| Snapshot size | 14.2 MB | 14.2 MB | 3.4 MB |

A first run under a load average of 22 (the reviewers were running)
showed the fold 35 to 80% slower. The interleaved runs above show that
was noise. Compare `bench:core` numbers only within one quiet run.

The fold's 13% is consistent across rounds. The likely cause is the
per-event change log (`countEvent`, `packages/core/src/reducer.ts:36`)
that made per-append patching possible (Estimated: not bisected). That is
a good trade for a phone that appends, but it adds about 20 ms per 5,000
passages to every refold, several times that on Hermes. `bench:core`
does not exercise the kept-on-disk path at all (`KeptLines`, `KeptFill`,
`SnapshotRows`), which is where most of section 3's phone findings are.

Web export, release build:

| What | Today | Budget (`apps/mobile/scripts/export-web.mjs`) | Room |
| --- | --- | --- | --- |
| JavaScript on a first visit | 5.70 MB | 5.75 MB (`:108`) | about 50 KB |
| All chunks | 6.54 MB | 6.55 MB (`:103`) | about 10 KB |

The budget comment shows both caps raised twice since 2026-10-16
(decisions 149 and 158). The main chunk is 5.8 MB, 3,132 modules.
Attributing its output bytes to sources through the source map:
lucide-react-native 1,549 KB, app code 1,404 KB, `packages/core` 355 KB,
react-native-web 276 KB, react-dom 175 KB, `@supabase/auth-js` 123 KB,
`packages/sync` 117 KB. The biggest single modules are lucide's barrel
(613 KB), react-dom (171 KB), `packages/core/src/catalogData.ts` (122 KB)
and `bibleBreaksData.ts` (48 KB). Code splitting works: Reports (451 KB),
the worker (133 KB) and Org (105 KB) are their own chunks.

## 2. How to read the findings

Ranked by effect for the effort. "Confirmed" means the code path was read
and the cost follows from it. "Estimated" means the size of the cost is
inferred, not measured. Line numbers are at `f9814bef`.

## 3. New findings

### Tier 1: large effect, small change

**1. The web bundle carries every lucide icon.** Confirmed and measured.

- The app imports 91 icons from `'lucide-react-native'` (first counted as
  15: `kit.tsx`'s multi-line import was missed), in six files
  (`src/study/studyText.ts:3`, `src/shell/UpdateBanner.tsx:1`,
  `src/shell/NavChrome.tsx:7`, `src/admin/admin.tsx:8`,
  `src/guides/GuideEditor.tsx:26`, and a type import in
  `src/ui/kit.tsx:7`). That entry is a barrel that re-exports all 1,881
  icons, and Metro does not tree-shake it. The 2026-10-15 audit's "lucide
  icons tree-shake on the web" is not true today.
- The native bundle takes the same barrel (its `react-native` export), so
  every binary and OTA update carries the icons too (Estimated: the
  native bundle was not measured).
- **Fix:** import each icon from its own path, which the package exports:
  `import CloudOff from 'lucide-react-native/icons/cloud-off'`. Add a
  `no-restricted-imports` rule for the bare `'lucide-react-native'` in
  `apps/mobile/src` (type imports allowed), so a new screen cannot bring
  the barrel back. Then lower both budgets in `export-web.mjs` in the same
  change, so the room is not quietly spent.
- **Measure:** the first-visit line `export-web.mjs` prints. Expect about
  1.5 MB less (Estimated: the 1,549 KB share less 15 icons).

- **Done (2026-10-26):** a first web visit 5.70 MB to 3.71 MB, every
  file 6.54 MB to 4.54 MB; `apps/mobile/src/ui/icons.ts`, lint rule
  `noIconBarrel`, both budgets lowered to 3.9 and 4.75 MiB (decision 123
  amended).

**2. One org event refolds every language in the org.** Confirmed.

- `skipQuiet` (`server/projectionWorker.ts:171`) gives up when the org
  stream's head differs from the language's mark, and so does `changed`
  (`:122`). Any `_org` event (an invite, a member added, a join decided, a
  role defined) therefore costs every language of that org a full
  snapshot download, fold and line upload on the next 5-minute pass.
- That scales with languages per org × snapshot size: 14 MB per
  Bible-scale language.
- **Fix:** store a fingerprint of what a language's projection reads from
  the org (its people, info and licence) in `projection_marks`, and skip
  when it is unchanged. A new migration adds the column; the rest is in
  the worker.
- **Measure:** `diag.job_history('projection')`, projected against quiet
  languages after an invite in a many-language org; `get_snapshot_chunk`
  calls in `diag.rpc_stats()`.

- **Done (2026-10-26):** `projection_marks.org_fp` holds a fingerprint of
  the language's people, name, code and licence; the pass folds the
  organization once and skips a language whose fingerprint held. A mark
  from before refolds once (decision 68 amended). Not measured on hosted
  data.

**3. Every transferred file copies the size of every file on the phone.**
Confirmed.

- `BlobStore.sizes()` returns `new Map(this.sizeByHash)`
  (`apps/mobile/src/sync/blobs.ts:184`). `metered()` calls it after every
  upload and download to read one size (`src/sync/useLanguage.ts:386`), as
  does each hand-over upload (`src/server/handOver.ts:88`). The language
  session calls it on every work pass and reclaim
  (`packages/sync/src/languageSession.ts:217,505,523,559`).
- On Koro Miyan's 61,253 files that is a 61k-entry Map per file:
  O(files²) over a full download. It undoes half of the 2026-10-15 R2 fix.
- **Fix:** `store.sizeOf(hash)` (`blobs.ts:188`) in `metered()` and the
  hand-over, and a read-only view (as `presentView()` does for `present`)
  for the session.
- **Measure:** Map constructions per 1,000 downloaded files; JS-thread busy
  time during a 500-file download on the Android emulator.

- **Done (2026-10-26):** `sizes()` hands out the live map; `metered()` and
  the hand-over ask `sizeOf()`. Not measured on a device.

**4. Each fill page rewrites the whole fill list.** Confirmed in code;
size Estimated.

- `KeptFill` writes its meta with every page of rows
  (`packages/sync/src/keptFill.ts:342-343`), and the meta carries `todo`,
  one `[unitId, rows]` pair per passage in the language (`:39`, `:161`).
- At 30k passages that is about 1.5 MB stringified and written per page,
  across about 160 pages per fill, on the phone's single writer.
  `KeptFill.next` also builds `new Map(todo)` per batch (`:268`).
- **Fix:** write `todo` once under its own key; keep `rowsSeq` and `stale`
  in a small row. Build the Map once per fill.
- **Measure:** bytes written to `meta` per fill, in the fill diagnostics.

- **Done (2026-10-26):** `todo` under its own meta key, written once; a
  fill begun by an earlier build moves it out on its next save. Rows for a
  passage with nothing kept are written as the server's text.

**5. Working out passage lines rebuilds the whole index for every 25
passages.** Confirmed in code; size Estimated.

- `KeptLines.work` (`packages/sync/src/keptLines.ts:241-252`) builds a
  view per batch of 25 (`kept.view`) and calls `languageLines(view)`
  without an index. The view is a fresh object with no revision, so
  `languageLines` (`packages/core/src/passageLines.ts:145`) falls through
  to `indexesOf(view)` and `recordIndexes(view)`: a sort of every unit
  and a rebuild of every record index, once per batch. `withOwnParts`
  also copies all 18 part maps each time (`passageParts.ts:317-324`).
- A full rebuild is O(P²/25), and it runs for every kept language after
  each app update, because the build is part of the lines' stamp.
- **Fix:** pass the live state's indexes (`languageLines(view,
  indexesOf(live))`; the parameter exists), and copy only the parts being
  added to.
- **Measure:** `buildIndexes` calls per `KeptLines.once()` with `all`, and
  its time at 5k and 30k passages. Add both as `bench:core` rows.

- **Done (2026-10-26):** `languageLines(view, indexesOf(live))`. New
  `npm run bench:kept`: every passage's line from disk at 5,000 passages
  698 ms before, 175 ms after (1,200 passages: 64 to 43 ms), now linear.

**6. Every refresh scans every recording row.** Confirmed.

- `KeptLines.work` starts with `keptUnits(..., ['recording'])`
  (`keptLines.ts:244`), a `select distinct unit_id` over the language's
  whole recording kind (`packages/sync/src/sqliteStore.ts:308-312`). It
  runs on each pull page, each fill step and 150 ms after an append.
- **Fix:** ask only about the batch's units (`unit_id in json_each(?)`, as
  `keptWhere` already does).
- **Measure:** `refresh()` time per page against a 160k-row `kept_rows`.

- **Done (2026-10-26):** `keptUnitsAmong`, a batch's units only (in the
  `bench:kept` numbers above).

**7. Counting refused events reads and parses every one of them.**
Confirmed.

- `refusedCount` is `store.rejected(...).length`
  (`packages/sync/src/syncClient.ts:1814`), called from the session's
  counts after each append and sync. `requeue` (`:1432`) also parses every
  refused row on every push, as the 2026-10-15 audit's table recorded.
- A stuck not-listed backlog makes every append pay for it.
- **Fix:** a `count(*)` in the store, and the reason filter in SQL for
  `requeue`.
- **Measure:** append latency with 2,000 refused rows.

- **Done (2026-10-26):** `rejectedCount` and `rejectedWith` in both stores;
  `refusedCount` counts in SQL, the not-listed requeue reads only those.

### Tier 2

**8. Recording redraws the waveform about 21 times a second.** Confirmed.

- Each microphone energy event makes a new session state
  (`apps/mobile/src/recording/recordingSession.ts:43`, `liveFrame` in
  `livePartsModel.ts:94-100`). `LiveParts` subscribes to every one
  (`LiveParts.tsx:69`) and re-renders 128 bar slots with `liveBars` and
  `liveBoxes` (`livePartsModel.ts:242-267`; a `kept.find` per bar).
- This is the app's main field activity, on a slow Android, on the JS
  thread the recorder's own events use.
- **Fix:** publish the frame to the bars at about 10 Hz, and memoize the
  slots by quantized height. Or draw the bars as one SVG path.
- **Measure:** React Profiler commits per second and ms per commit during
  a 60 s recording.

- **Done (2026-10-26):** frames reach the bars at most every 90 ms; part
  starts, ends and edits publish at once; bar slots memoized; each frame's
  part found once per window. Not profiled on a device.

**9. Waveform bars are read sample by sample in JS, several files at a
time.** Confirmed.

- `barsOfFile` (`apps/mobile/src/audio/barsOfFile.ts:22-31`) reads a WAV
  in 256 KB blocks and calls `getInt16` for every sample, with no yield.
  `useBars` starts one per row that lacks bars, and they run in parallel
  (`barsStore.ts:46-62`). The bars are cached afterwards.
- A first open of a passage with 10 downloaded 30 s takes is about 13M
  iterations on Hermes (Estimated): a visible freeze.
- **Fix:** one file at a time, yield between blocks, and read a strided
  sample (128 bars need a few thousand samples, not every one).
- **Measure:** JS-thread blocking on first open of such a passage.

- **Done (2026-10-26):** each bar sampled from 8 windows of 64 frames
  (within 0.08 of a full read on a 30 s stereo WAV), one file at a time,
  yielding every 8 bars.

**10. The Worker asks the database about the caller on every agent and
reports request.** Confirmed.

- The agent API looks the token up on every `/api/v1/*` and MCP call
  (`apps/web/worker/agent/http.ts:119`), then awaits a `touchToken` write
  at most once per interval (`:125`). The reports route asks for the
  caller's memberships on every call (`apps/web/worker/api.ts:110`), and
  phones poll reports.
- **Fix:** an isolate `TtlCache` for token records (10 to 15 s, so a
  revocation takes effect within that) and for `orgsOf` (30 s, the
  trade-off decision 121 accepted for blob access). Put `touchToken` in
  `ctx.waitUntil`.
- **Measure:** `api_tokens` and `org_memberships` selects in
  `pg_stat_statements`; latency in `wrangler tail`.

- **Done (2026-10-26):** token records 15 s and the reports route's
  memberships 30 s per isolate, `touchToken` through `ctx.waitUntil`
  (decision 121 amended).

**11. Push delivery runs every minute with nothing to send, and its
history is never purged.** Confirmed.

- The cron posts to the Edge Function every minute
  (`supabase/migrations/20261020170000_push_delivery_secret.sql:48-59`):
  1,440 calls and run-detail rows a day. Nothing in `supabase/` deletes
  from `cron.job_run_details`, and `diag.ops_cron` reads it by time.
- Each claim walks past every active notification whose person has no
  phone registered (`claim_notification_pushes`, `baseline.sql:1755-1763`),
  since those stay unpushed for ever at the low end of the index.
- **Fix, in a new migration:** call the function only when a push or a
  receipt is waiting; purge run details older than 7 days daily; insert
  rows for people with no token as already pushed.
- **Measure:** `count(*)` of `cron.job_run_details`; Edge invocations;
  `EXPLAIN (ANALYZE, BUFFERS)` of the claim.

- **Done (2026-10-26):** the cron calls the function only when
  `push_work_waiting()`; run details purged after 7 days; the claim starts
  from people with a token (0.04 ms on 200,000 rows with none, in a
  rolled-back transaction). Decision 148 amended.

**12. Help mode measures every lit part every frame.** Confirmed.

- `apps/mobile/src/helpMode/helpMode.tsx:152-160` runs every registered
  `measure()` (a `measureInWindow` bridge call, `helpBadge.tsx:21`) on
  each animation frame while help is on, and every `Row` registers.
- **Fix:** measure on layout and scroll end, and at most 10 times a
  second.
- **Measure:** bridge calls per second with help on over the Org screen.

- **Done (2026-10-26):** measured on layout, then every 100 ms for a second
  after anything moves and every 300 ms while still. Scroll events are not
  hooked: a scroll that starts while still can lag 300 ms.

**13. Opening passage after passage never frees memory, and rebuilds the
audio plan each time.** Confirmed for the mechanism.

- Entries leave memory only at a checkpoint (`shed`,
  `packages/sync/src/keptLanguage.ts:221`, called from `takeCheckpoint`),
  which needs 2,000 pulled events. Each `bring` marks the state changed
  and then calls `referencedBlobs(state)`, which rebuilds the plan over
  all of memory (`keptLanguage.ts:321`), so opening N passages is O(N²).
- **Fix:** shed a passage as it leaves `open` (its rows are on disk). Key
  the audio plan on audio-touching changes.
- **Measure:** heap and `loadUnits` time after opening 200 passages on
  the 2 GB emulator.

- **Done (2026-10-26), differently:** shedding a passage as it leaves
  `open` is not safe, since memory can hold work newer than its rows. Instead
  a reader's opens take a checkpoint once memory has taken in four times the
  open limit, on the fast path only (nothing unsent), which sheds them.

**14. The server's snapshot path does whole-language work per fold.**
Confirmed in code; sizes Estimated.

- Every fold uploads every passage line (`snapshotWorker.ts:129-130,
  170-174`), and `put_passage_lines` compares every row
  (`20261020150000_snapshot_units_and_passage_lines.sql:190-215`), even
  for three new events.
- `get_snapshot_head` counts every unit row and aggregates every line on
  each cold open (`:240-250`).
- `put_snapshot` stages every row, copies it again into `snapshot_units`
  and deletes the old set (`:134-157`): about 3 to 4 times the data in WAL
  per snapshot, at most hourly per active language.
- **Fix:** send only the lines the tail touched; write the head's counts
  once in `put_snapshot`; move staged rows by updating their seq rather
  than copying. The last amends decision 88's storage.
- **Measure:** request size and mean of `put_passage_lines` and
  `get_snapshot_head` in `diag.rpc_stats()`; WAL bytes per `put_snapshot`.

- **Done in part (2026-10-26):** lines are sent by digest, only those that
  changed (`put_passage_lines_delta`); the head's counts kept in
  `snapshots.unit_counts`; staging unlogged, about a third less WAL
  (decision 147 amended). Not done: moving staged rows by seq, which is no
  cheaper with the seq in the key, and staging in place would show a cut
  before its snapshot exists.

### Tier 3: smaller or rarer

- **Admin dashboard: cold-load stampede.** `apps/admin/src/auth.ts:38-73`
  fills its caches after the await, so the 14 parallel calls of one page
  load each ask Auth and `get_user_state`. Cache the in-flight promise.
  Done: in-flight promise per token digest.
- **`diag.ops_people` is O(accounts²).** `is_managed_account` compares
  `u.id::text = p_profile`
  (`20261016080000_managed_by_the_server.sql:22`), a scan of `auth.users`
  per call, and `ops_dashboard.sql:43` calls it per account. Compare as
  uuid and count with one filter.
  Done: compared as uuid, counted with one filter.
- **Webhook cron.** It wakes every webhook org with an unbounded
  `Promise.all` (`apps/web/worker/index.ts:113-118`); a scan runs
  `stream_heads` twice (`orgSnapshot.ts:143`, `dispatch.ts:191`); a moved
  language rebuilds its whole digest (`dispatch.ts:117-143`). Poke only
  orgs whose heads moved, in batches of 20, and share one heads result.
  Done in part: batches of 20 and one shared heads answer per scan; poking
  only orgs whose heads moved needs a bulk heads query, and a moved
  language's digest is still rebuilt whole: neither is done.
- **Agent reads still pull.** `records(languageId)` calls `pull_events`
  on every read (`apps/web/worker/languageRecords.ts:108`), and builds the
  passage list per call (`:123,130`; `agent/view.ts:337,570,599,855` use
  `includes`). This is the rest of the 2026-10-15 V5 and C4.
  Done: heads trusted for 3 s, pulled only when moved; `indexesOf` and a
  position map in the views.
- **Offline recount** works out the scope four times per settled window
  (`languageSession.ts:574-575`, `languageFiles.ts:71,76`).
  Done: the reasons worked out once and shared.
- **Org listings** still call `org_name()` per org before filtering, now
  also in `global_viewer_organizations`
  (`20261022210000_global_viewers.sql:119-128`). An `org_names` table with
  a trigram index serves all three.
  Done: `org_names`, kept by a trigger on org name events, with trigram
  indexes (decision 66 amended).
- **Fill rows** are parsed and stringified about three extra times each
  (`supabaseTransport.ts:95`, `keptFill.ts:331,338`). Pass `row.json`
  through.
  Done in part: rows with nothing kept are written as the server's text;
  the transport's own stringify stays.
- **Event writes** are one awaited insert per event
  (`sqliteStore.ts:95`); `kept_rows` already uses a `json_each`
  multi-row insert. Unplaced events look their passage up one at a time
  (`keptLines.ts:202`).
  Done: events a few hundred a statement through `json_each`; unplaced
  events looked up one query per kind.
- **Redactions** are found by parsing every row of the log
  (`json_extract(json,'$.type')`, `sqliteStore.ts` `page`). Add an
  expression index or a type column.
  Measured and not done: 4 ms saved per load at 50,000 events, against
  30% more time on every insert.
- **Worker bundle.** The connect and review pages' words (about 195 KB)
  and the unused realtime and storage clients load on every cold start
  (`apps/web/worker/index.ts:2-5`, `env.ts:1`). Import the pages lazily.
  Done in part: the pages load on first use, so their words are built only
  then; wrangler still bundles them into one file, so no bytes are saved.
- **Reports response** is stringified twice, once for the ETag
  (`apps/web/worker/api.ts:118-123`).
  Done: stringified once.
- **Projection pass** reads `projection_marks`, `language_visibility` and
  every retained `snapshots` row in full every 5 minutes
  (`server/projectionWorker.ts:86-117`).
  Done: `snapshot_heads_page` reads one snapshot row per stream; only
  listed visibility rows are read.
- **Web-only VAD** runs inference and a per-sample resampler on the main
  thread (`modules/microphone-energy/src/MicrophoneEnergyModule.web.ts:70-95`,
  `speech.ts:46-63`). Fine for tests; move it to the AudioWorklet before
  real web recording. On iOS it runs off the JS thread; Android was not
  read.
  Not done (the web is a test target).

## 4. The earlier audits' open items

Done since 2026-10-15: R1 (context memoized, `SyncStatusContext`,
`freezeOnBlur`), R2 in the app, R3, R5, S1 (native), S2 (lazy screens),
S4, S5, C1, C2, V3, V4, the `resume` clone, `highlightsFor`, and the
notifications index.

| Item | Status today | Recommendation |
| --- | --- | --- |
| R4 Map search | Partly: `src/screens/map.tsx:523-525` still in render, unmemoized | Do with the next Map change |
| R6 Chapter list | Open: `src/screens/content.tsx:1058` inline `renderItem`; `windowSize` limits it | Do |
| R7 Sync details poll | Partly: still every second (`useSyncInspection.ts:36-47`), and re-subscribes on each published state | Do: 3 to 5 s, compare before setting |
| R8 Toast, rows, lists | Open: `kit.tsx:1033` JS driver; no `React.memo`; members and passage lists are `ScrollView` | Keep |
| S3 First paint | Partly: `App.tsx:355` still renders `null` while words load | Do the skeleton |
| S6 Native catalogs | Open | Keep |
| C3 Checkpoint stringify | Partly: kept-on-disk languages write only the shared part | Keep |
| C5 Blob reconciler | Partly: no clone; still folds every stream with no head check, one RPC at a time | Do the head check |
| C6 `unitPlace`, `languagePeople`, `push` find, coverage cache | Open; `unitPlace` now also runs per recorded card (`reports.ts:399-406`) | Do `unitPlace` memo and `push`'s Map |
| V1 Auth per request | Partly: cached per isolate; asymmetric keys still not set (`supabase/config.toml:167-168`) | Do the keys |
| V2 Projection downloads | Partly: quiet tails skip; `orgState()` still pulls the org from 0 | With item 2 above |
| V6 Org inbox triggers | Open | Keep until a bulk job is slow |
| V7 Snapshot storage | Partly: no jsonb copy; retention unchanged | With item 14 above |
| V8 `org_name` per org | Open, and copied into Global Viewers | Do the `org_names` table |
| V9 Push delivery | Partly: indexes and one token query done | With item 11 above |
| V10 RLS wrapping, unused indexes | Open; tables small | Keep |
| Benchmarks in CI | Open | Do, comparing counts, not times |
| Benchmarks on a phone | Partly: storage only | Do: Hermes speed is still the biggest unknown |
| Diagnostics gaps (`load` reason, `checkpoint`) | Open | Do |
| Redaction costs a snapshot | Open | Design first |
| `appliedEventIds`, `validateEvent` closures | Partly / Open | Keep |

Done on 2026-10-26 from this table: R4 (memoized, a deferred query parsed
once), R6 (`ChapterView` memoized, stable props), R7 (every 3 s, state
set only on change), S3 (the spinner instead of a blank screen), C5 in
part (files listed first, streams with nothing stored skipped, four
confirmations at a time; no head check, since R2 can lose a file without
the log moving), and C6 in part (`push()`'s Map, chapters once per passage
in a report). The rest of the table is as it was.

## 5. Order of work

1. **The icons (item 1).** Six imports, a lint rule and lower budgets.
   It returns about a quarter of the first visit and the room every
   other web change needs.
2. **The quick phone fixes (items 3, 5, 6, 7).** Each is a few lines in
   `blobs.ts`, `useLanguage.ts`, `keptLines.ts` or `syncClient.ts`, with
   existing tests around it. Add the `bench:core` rows for the kept path
   first, so item 5 is measured.
3. **The fill meta (item 4).** A format change for a stored meta key: read
   the old shape once and write the new.
4. **The projection fingerprint (item 2)**, then the push cron (item 11).
5. **Recording and bars (items 8, 9)**, measured on the Android emulator
   with the Profiler.
6. **The Worker caches (item 10)** and the Tier 3 Worker items.
7. **The server snapshot path (item 14)** and memory while browsing (item
   13). These need design; 14 amends decision 88.

## 6. What is left after the work of 2026-10-26

- `npm run db:test` (the SQL smokes and parity on a fresh database) has
  not run on the eight new migrations
  (`20261026170100` to `20261026170800`); each ran only in a transaction
  that was rolled back, against the shared local database. The `server`
  job in CI runs it.
- Nothing was measured on a phone: items 3, 8, 9, 12 and 13 have unit tests
  for their logic, not Profiler or heap numbers.
- Not done: poking only webhook orgs whose heads moved, an incremental
  webhook digest, moving staged snapshot rows by seq, the redaction index
  (measured, not worth it), benchmarks in CI, the phone benchmark,
  the diagnostics records, asymmetric JWT keys, the web speech detector,
  and the design-first items (a redaction costing a snapshot, org inbox
  triggers).

## 7. Not checked

- Any number on a phone or on Hermes. Every time above is a laptop's.
- The native bundle's size and how much of it lucide is.
- Whether the fold's 13% comes from the change log; it was not bisected.
- The sizes marked Estimated in items 4, 5, 9 and 14.
- The hosted project's JWT signing keys and its `cron.job_run_details`
  size.
- Android's speech detector (`Speech.kt`).

Changes that will need a `decisions.md` entry when built: retention or
staging of snapshot rows (item 14, amends 88), and the projection's
fingerprint if it changes what the pass promises (item 2). This audit
itself records no decision.
