# App and server performance audit

Date: 2026-10-15. By: Carl Sauder, with Claude. Sources: this repo at
commit `cda46db`; `npm run bench:core` run that day on an Apple Mac (Node,
V8); the web export in `apps/mobile/dist` built the same day; a throwaway
esbuild bundle of the Worker. Nothing was measured on a phone or against the
hosted database.

`performance-audit.md` (2026-10-12) covered the event system: the fold,
SQLite commits, snapshots and refolds. Most of its Tier 1 and 2 items are
done. This audit covers what it did not: how the app draws, how it starts,
the web bundle, the Worker and the server's SQL beyond the write path. It
also re-checks that audit's open items against today's code (section 5).

The short version: the event system is in good shape, and the app around it
is not yet. One status change (a file arriving, a sync counter moving)
re-renders every mounted screen, because the screen context is rebuilt on
every render and nothing is memoized. During a bulk audio download that is
one app-wide redraw per file, each copying a set of every file on the phone.
Next come startup (every screen module runs before the first frame), the
41 ms view rebuild per change (the prior audit's item 10), and a handful of
server items whose cost grows with organizations and people, not with one
language.

## 1. Baseline

`npm run bench:core`, 2026-10-15, V8 on a Mac:

| What | 1,200 passages (15.6k events) | 5,000 passages (65k events) |
| --- | --- | --- |
| Full fold | 35 ms | 147 ms |
| View rebuild per published state | 8.4 ms | 41 ms |
| `offlineSummary` | 2.9 ms | 9.2 ms |
| Snapshot size | 3.4 MB | 14.2 MB |

Biggest keys in the 5,000-passage snapshot: recordings 3.9 MB, kindReviews
3.4 MB, takes 3.4 MB, notes 1.9 MB.

Web export (`apps/mobile/dist`): one main JS file of 6.46 MB, against the
6.25 MiB (6.55 MB) budget in `apps/mobile/scripts/export-web.mjs`, so about
90 KB of room. No code splitting. Worker bundle (esbuild, minified): 777 KB,
of which about 250 KB is the connect and review pages' i18n JSON.

Hermes on the slowest partner Android is still unmeasured. Every millisecond
above is a laptop's.

## 2. The app: rendering

Ranked by effect for the effort. "Confirmed" means read in the code;
"Estimated" means the cost is inferred, not measured.

**R1. One status change re-renders every mounted screen.** Confirmed.

- `App.tsx:421` builds `ctx` as a new object literal on every render of
  `OrgWork`, and `App.tsx:513` passes it to `CtxContext.Provider`. Every
  `Host` (`App.tsx:150`) reads that context and spreads it into its screen.
- `useLanguage` returns a new object every render, and its `blobs` member
  (`apps/mobile/src/sync/useLanguage.ts:241`) is a fresh literal with fresh
  closures.
- `OrgWork` re-renders on every key `LanguageSession.set` changes
  (`packages/sync/src/languageSession.ts`): `pendingUp`, `pendingDown`,
  `present`, `peakUp`, `peakDown`, `live`, `online`, `lastSync`,
  `revision`.
- No component in `apps/mobile/src` is wrapped in `React.memo` (none at
  all), and the native stack keeps every screen under the top one mounted,
  with no `freezeOnBlur`.
- So each tick re-renders the visible screen, the screens below it, the
  pane and `StudyPrefetch`, and re-runs their unmemoized work (R3, R4, R6).
- **Fix:** split the context. Language state, org and session go in one,
  memoized on their inputs. Sync status goes in its own `SyncStatusContext`,
  read only by the sync ring, the account and sync screens, and the few
  screens that show offline marks. Make `blobs` stable (`useMemo`, with
  `uriFor` and friends from refs). Turn on `freezeOnBlur` for the stack, so
  hidden screens skip renders.
- **Measure:** React Profiler commits per second, and JS-thread ms in
  commits, during a 500-file audio download. Target: the visible screen
  only, and only when what it shows changes.

**R2. Every file that lands copies the set of every file on the phone,
several times.** Confirmed.

- `languageSession.ts:179` publishes
  `set({ present: files.snapshot() })` on every file change, and
  `snapshot()` is `new Set(this.present)` (`apps/mobile/src/sync/blobs.ts:210`).
  A new Set is always "different", so every file notifies (R1).
- The same change also runs `reclaim()` (`languageSession.ts:177`), which
  takes another `snapshot()`, copies the scope, and sorts the evictable
  files. Each transfer pass calls `work()` up to three times, each with a
  `snapshot()` (`languageSession.ts:138,147`). `forScope` keys its cache on
  `[...scope].sort().join('\n')`.
- On Koro Miyan's 61,253 files that is several copies of 61k entries, a sort
  and an app-wide redraw per file: O(files²) over a full download.
- **Fix:** expose the live set read-only, with a version number, and publish
  `present` to screens on a trailing timer (about 500 ms). Debounce
  `reclaim()`. Key `forScope` on the scope's revision, not a sorted join.
- **Measure:** Set constructions and `set()` calls per 1,000 downloaded
  files; JS-thread busy time during a bulk download on the Android emulator.

**R3. `StudyPrefetch` recomputes the offline scope on every render.**
Confirmed. `apps/mobile/src/study/StudyPrefetch.tsx:17-21` calls
`defaultOfflineScope`, copies it, adds the kept units, then sorts and joins
it, unmemoized, at the app root. With R1 that runs on every status tick.
**Fix:** `useMemo` on `[state, me, kept]`. **Measure:** Hermes profile
during sync.

**R4. The Map searches and rebuilds on every keystroke.** Confirmed.
`apps/mobile/src/screens/map.tsx:484` runs `mapSearch` (a filter over every
passage, re-parsing the query per passage in `placeMatches`) and `mapShelf`
in render, unmemoized. Book and passage rows get new inline `onPress`
arrows each render (`:516`, `:552`). **Fix:** memoize both, put the query
through `useDeferredValue`, parse it once, and `React.memo` the rows.
**Measure:** Profiler time for one keystroke at 5,000 passages.

**R5. `usePassage` rebuilds the passage view on every render.** Confirmed.
`apps/mobile/src/passage/usePassage.ts:16` returns `passageView(...)`
unmemoized. It re-sorts the review kinds (`deriveKinds`,
`packages/core/src/passage.ts:33`) and returns a new object, which defeats
every downstream `useMemo` keyed on it. There are 8 call sites (passage,
translate, study and review screens). **Fix:** `useMemo` on
`[state, unitId, languageId, orgState]`.

**R6. The chapter list re-renders every visible chapter on any change.**
Confirmed. `apps/mobile/src/screens/content.tsx:1163` passes an inline
`renderItem`, and `ChapterView` is not memoized. Each chapter holds all its
verses and cards. **Fix:** `React.memo(ChapterView)` and a `useCallback`
for `renderItem`.

**R7. The sync details screen polls SQLite every second, and starts over on
every render.** Confirmed. `apps/mobile/src/account/useSyncInspection.ts:36-47`
runs `inspect()` on both sessions plus `readLog` each second. It depends on
`[language, org]`, which are new each render (R1), so the effect
re-subscribes and fires again at once. It also sets four states a second.
**Fix:** depend on stable members, compare before setting, and poll every
3 to 5 s. Only matters while that screen is open.

**R8. Smaller items.**

- Lists that can grow use a `ScrollView` and a "Show more" of 25
  (`apps/mobile/src/ui/kit.tsx:110`, `map/mapModel.ts:21`). The first page
  is cheap, but rows are never unmounted and not memoized. Use `FlatList`
  for the passage lists, the search hits and the history timeline once R1
  is done.
- The toast's progress bar animates `left` with `useNativeDriver: false`
  (`kit.tsx:956`). Use a `transform` with the native driver.
- `useStudyAudio` updates time 4 times a second (`study/useStudyAudio.ts:54`
  and the player's 250 ms interval). Make sure the component that owns it
  is a small leaf.
- Each `Row` calls `useHelpSpot` (`kit.tsx:362`). That is cheap alone, but
  it adds to R1 on every row. `React.memo(Row)` once callers pass stable
  handlers.

## 3. The app: startup and bundle

**S1. Every module runs before the first frame.** Confirmed.

- Expo's Metro config sets `inlineRequires: false`
  (`node_modules/@expo/metro-config/build/ExpoMetroConfig.js:346`), and
  `apps/mobile/metro.config.js` does not change it.
- `App.tsx:33-50` imports all 18 screen modules eagerly, and `SCREENS`
  names about 60 screens. Reports, Config, Org, Content, Study and Sources
  all run their top-level code at launch. That includes the `d3-geo` and
  world-atlas setup in `src/reports/WorldMap.tsx` and the
  `registerLocale` loop over 13 country-name tables in
  `src/reports/countries.ts`.
- **Fix:** turn on `inlineRequires` in `metro.config.js`, then load the
  rarely used screens lazily (`React.lazy` or a `require` inside the
  screen). Reports first: phones never show it (`App.tsx:458-461`).
- **Measure:** `performance.now()` from `index.ts` to the first `Shell`
  render, in a release build on the Android emulator, then on a partner
  phone.

**S2. The web bundle is at its budget, and has no splitting.** Confirmed.

- The main JS is 6.46 MB in one file. The budget has been raised four
  times (4.8, 6, 6.1, 6.25 MB). `React.lazy` and dynamic `import()` appear
  nowhere in `src`.
- The reports code alone brings `d3-geo`, `topojson-client`,
  `world-atlas` (108 KB of JSON) and about 100 KB of country names. The
  biggest sources are `en.json` (361 KB), `core/src/catalogData.ts`
  (139 KB), `screens/org.tsx` (113 KB) and `screens/config.tsx` (104 KB).
- **Fix:** the lazy screens from S1 give Expo's web export separate
  chunks. Load only the current language's country table.
- **Measure:** the main chunk's size in `export-web.mjs`, and a Lighthouse
  mobile run of the first load.

**S3. First paint waits on a serial chain, and draws nothing meanwhile.**
Confirmed.

- `App.tsx:318` renders `null` until the stored session is read and the
  words are ready. Only then does `Shell` mount and `useOrg` start the
  chain: open the database (`store.ts:183-189`), the device id,
  `OrgSession.open`, and `client.load()`, which reads the org log and
  parses its checkpoint.
- **Fix:** start `getStore()` in `index.ts` so the database opens while the
  session is read, and draw a skeleton instead of `null`.
- **Measure:** timing marks around each await; the `load` record in
  `npm run diag`.

**S4. Help audio starts downloading at launch.** Confirmed.
`App.tsx:297` calls `keepHelpAudio()` in the first effect, and it fetches
every line one after another (`src/helpMode/helpAudio.ts:154-158`). On a bad
link that competes with the org's first sync. **Fix:** start it once the
first sync has settled, and on Wi-Fi only.

**S5. Web: the word catalogs are not cached, and the first screen waits on
one.** Confirmed.

- `scripts/webHeaders.mjs:37-47` gives `/_expo/static/*` and `/assets/*`
  a year's immutable caching, but not `/i18n/*`. The catalogs are 290 to
  714 KB, already versioned with `?v=<BUILD_ID>`
  (`src/i18n/catalogs.web.ts:13`), and revalidated on every visit.
- For anyone not using English, the catalog fetch starts only after the
  6.5 MB bundle has run (`src/i18n/start.ts:21-26`), and `App.tsx:318`
  waits for it.
- **Fix:** add `/i18n/*  Cache-Control: public, max-age=31536000, immutable`,
  a one-line change. Preload the chosen catalog from `index.html`.
- **Measure:** the network waterfall of a repeat visit in Hindi or Burmese.

**S6. All 15 word catalogs are in the native bundle.** Confirmed.
`src/i18n/catalogs.ts` loads each one only when it is chosen, so this costs
no startup time. It does add about 6.9 MB of JSON to every binary and
every OTA update. **Fix, if update size matters:** download the other
catalogs as the web does.

Checked and fine: Hermes and the new architecture are on; hashed web assets
are cached immutably and `index.html` is `no-cache`; there is no font
loading; the book icons are small webp files (1 MB in all, at most 10 KB
each); no duplicated or oversized libraries; lucide icons tree-shake on the
web.

## 4. Core and sync: new items

**C1. Every event rebuilds the whole record index.** Confirmed, and the
largest remaining cost per change. This is item 10 of
`performance-audit.md`, now with today's number: 41 ms per change at 5,000
passages on V8, so several hundred ms on a slow Android while someone
records.

- `recordIndexes` (`packages/core/src/passage.ts:256-299`) is keyed on
  `stateRevision`, which the reducer bumps per event (`reducer.ts:35`). A
  miss re-sorts every take, departure, request and note, and empties the
  passage cache, so `languageProgress` re-derives all 5,000 passages.
- The Worker pays the same per poke, in `digestOf`
  (`apps/web/worker/agent/webhooks.ts:136-157`) and `languageReport`.
- **Fix:** have the reducer record which units an event touched, and patch
  only those units' index entries and cached passages. Keep the full
  rebuild for refolds.
- **Measure:** `derivePassage` calls per append (target 1 to 3, not 5,000),
  and a new `bench:core` row, "append one event, then `languageProgress`".

**C2. Adopting a server snapshot parses it twice and stringifies it once.**
Confirmed.

- `syncClient.ts:378-396`: `fetchSnapshot` joins the pieces and parses
  them, `saveSnapshot` stringifies the result again (`:282`), and `load()`
  reads it back and parses it once more.
- At 14 MB that is about 50 ms per parse and about 250 ms for the stringify
  on V8, several times that on Hermes. At the peak the phone holds the
  pieces, the joined text, the object and the new text.
- **Fix:** keep the joined text from `fetchSnapshot` as the checkpoint,
  and fold the local tail onto the object already parsed instead of
  calling `load()`.
- **Measure:** `load` with `fromSnapshot`; peak heap on a 2 GB Android.

**C3. Each checkpoint stringifies the whole state.** Estimated.
`checkpointEvery = 2000` (`syncClient.ts:190`), and each checkpoint
stringifies all 14 MB into one meta row, whatever the 2,000 events were.
On Hermes that is plausibly 1 to 3 s of blocked JS thread during a long
catch-up. **Fix:** scale the interval with the state's size, or write the
checkpoint when the app is idle (`deferCheckpoint` exists). **Measure:** the
`checkpoint` diagnostics record (`performance-audit.md` 2.3).

**C4. Worker reads rebuild the passage list on every request.** Confirmed.
The agent API's views (`apps/web/worker/agent/view.ts:302`, `:332`, `:563`,
`:590`, `:758`) each call `buildIndexes`, a sort over every unit, then
`indexOf` or `includes` on the 5,000-entry list. The app caches the same
thing (`apps/mobile/src/sync/indexes.ts`); the Worker does not. **Fix:**
cache `Indexes` per state and revision in core, and add a position map.

**C5. The blob reconciler downloads and folds every stream on every run.**
Confirmed. `packages/sync/src/blobReconciler.ts:54-56` folds every stream
from `listStreams`, including org and person streams, which have no audio.
That is a full snapshot download and a `structuredClone` per language, with
no head check, and then one `record_blob` RPC per object, one at a time.
**Fix:** skip unchanged streams by their head, skip org and person
streams, drop the clone, and batch the RPCs.

**C6. Smaller items.**

- A language report calls `unitPlace` (three regexes and two scans of the
  66 books) once per passage (`packages/core/src/reports.ts:255`). Memoize
  it per unit and label.
- `languagePeople` calls `privilegesFor` per member, and `orgLanguages`
  sorts with `localeCompare` (slow on Hermes) on every call
  (`packages/core/src/org.ts:612-620`, `:763-772`). They have about 40
  call sites. Cache them per org state.
- `push()` finds each result with `batch.find` (`syncClient.ts:579`), which
  is 200 × 200 per batch. Use a Map.
- `coverage.ts:97`'s cache is never cleared. That is harmless on a phone,
  but it slowly grows in a long-lived Durable Object.

## 5. The server and the Worker

**V1. The Worker likely asks Supabase Auth about every request, and asks
Postgres about every audio file.** Confirmed in code; whether Auth is
called depends on the project's signing keys.

- `apps/web/worker/index.ts:44` verifies tokens with `auth.getClaims`. Its
  comment says it verifies locally only when the project has asymmetric
  signing keys; otherwise it calls Auth. The anon key in
  `apps/web/wrangler.jsonc` is HS256, the legacy shared secret.
- Each blob request then also calls the `blob_access` RPC
  (`apps/web/worker/blobs.ts:205-219`). A phone downloading 61,000 files
  makes two serial round trips per file before R2 answers, each adding
  roughly 100 to 200 ms (Estimated).
- **Fix:** move the project to asymmetric JWT signing keys (in the repo's
  config, per `infrastructure-as-code`), so the Worker checks tokens
  against cached keys. Cache `blob_access` per person, org, stream and
  mode for 30 to 60 s in the isolate. Reuse one service client per
  isolate.
- **Check first:** the hosted project's JWT signing settings.
- **Measure:** Auth `/user` calls per minute; `blob_access` in
  `pg_stat_statements`; Worker timings in `wrangler tail`.

**V2. The projection pass downloads a whole snapshot for every changed
language, every 5 minutes.** Confirmed in code; the volume is Estimated.

- `snapshotOne` (`packages/sync/src/snapshotWorker.ts`) fetches every
  piece and folds, only to compute Inbox rows, even when three events
  arrived. A new snapshot is written at most hourly (decision 88), but the
  download happens every pass.
- `orgState()` (`server/projectionWorker.ts`) pulls each changed org's
  stream from seq 0 every pass. Languages run one at a time, each with
  three serial writes. The `public_languages` upsert writes even when
  nothing changed.
- **Fix:** compute Inbox rows from the new events, or from a fold kept
  between passes, and download a snapshot only when one is due. Keep an
  org-state cursor. Write `public_languages` only when it changed. Run
  small languages three or four at a time.
- **Measure:** `get_snapshot_chunk` calls in `diag.rpc_stats()`; the Edge
  Function's duration and CPU.

**V3. `reconcile_notifications` scans the whole table per language, and the
table never shrinks.** Confirmed. This is item 13 of
`performance-audit.md`, and worse than recorded there.

- The update (`supabase/migrations/20261006000000_baseline.sql:1745-1747`)
  filters on `language_id is not distinct from p_language`, which no btree
  index can serve, and there is no `(org_id, language_id)` index anyway.
- Its `not exists (... jsonb_array_elements(p_rows) ...)` re-expands the
  new rows for every candidate row.
- Inactive rows are never deleted (only account deletion removes rows,
  `baseline.sql:1973`), and the phone's inbox read (`profile_id > cursor`)
  walks them too.
- **Fix, in a new migration:**
  - a partial index on `(org_id, language_id) where active`;
  - split the null and non-null language cases;
  - match ids against an array;
  - purge inactive rows older than N days from cron.
- **Measure:** `EXPLAIN (ANALYZE, BUFFERS)` at a million rows;
  `seq_scan` on `notifications`.

**V4. The Durable Object's memory, and midnight.** Estimated.

- `apps/web/worker/orgFolder.ts:40` keeps up to 8 whole language states,
  and refreshes 4 at a time (`:42`).
- Every summary carries its UTC day, so the first request after midnight
  refolds every language in the org (`:199`). A 14 MB snapshot parses to
  well over 100 MB of V8 heap (the earlier audit measured 276 MB for 100k
  events), in a 128 MB isolate. The failure is an evicted object or a 502
  from reports.
- **Fix:**
  - work out the date-dependent parts of a report from the stored summary
    rather than refolding;
  - cap held state by bytes, not by count;
  - refresh big languages one at a time.
- **Measure:** Durable Object memory and CPU at the first request after
  00:00 UTC, on a staging org with large languages.

**V5. Agent API reads pull events even when nothing moved.** Confirmed.
This is item 13 of `performance-audit.md`, still open.

- `languageState` (`orgFolder.ts:161-170`) always calls `catchUp`, and so
  `pull_events`. A write does this twice (`agent/org.ts:104,116`).
- The webhook scan forces a full pass (`orgSnapshot.ts:139`,
  `orgState(true)`).
- The 10-minute cron wakes every webhook org's object at once, with an
  unbounded `Promise.all`.
- **Fix:** check the stream head first (as `dispatch.ts:141` already does),
  use `orgState(false)` in the scan, and wake the orgs in batches of 20.

**V6. Org inbox rows are rebuilt per row changed, with privileges looked up
per pair.** Confirmed in structure.

- `_org_notification_rows` (`20261007200000_org_inbox_rows_in_sql.sql:21-50`)
  calls `org_privileges` per member, and `_may_moderate` for every report ×
  member pair.
- Its triggers are `for each row` on `join_requests` and
  `content_reports`, so a bulk dismissal or the v2 import rebuilds the
  org's rows once per row.
- **Fix:** look privileges up once in a single join, and use statement-level
  triggers with transition tables.

**V7. Each snapshot is stored twice, and up to about 25 are kept per busy
language.** Confirmed.

- `put_snapshot` writes the state as jsonb in `snapshots` and again as text
  pieces in `snapshot_chunks`. Retention (decision 88) keeps every one
  until its successor is 24 hours old.
- At 14 MB that is up to about 650 MB per busy Bible-scale language, in
  storage, WAL and backups.
- **Fix:** make `snapshots.state` nullable and stop writing it once the
  pieces exist; reconsider how many to keep. This changes decision 88's
  storage, so it needs an amendment there.
- **Measure:** `pg_total_relation_size` of both tables.

**V8. Finding an organization costs an event lookup per listed org, per
keystroke.** Confirmed in structure. `listed_organizations_search` calls
`org_name()`, which looks up the org's latest name event, once per listed
org before filtering, and `listed_organizations` calls it twice per listed
language. **Fix:** keep org names in a small table, maintained where org
events are applied, with a trigram index for the search.

**V9. Push delivery runs every minute, and works one row at a time.**
Confirmed.

- The cron posts to the Edge Function every minute even when nothing is
  waiting (`20261007200001_schedule_push_delivery.sql:25-30`).
- `deliverPushes` then makes one token query, one Expo call per token
  (Expo takes 100 per call) and one update per notification, serially.
- `push_receipts` has no index on `created_at` or `notification_id`.
- **Fix:** have the cron call the function only when a push is waiting;
  fetch tokens in one query; send to Expo in batches of 100; add the two
  indexes.

**V10. Smaller items.**

- The Worker bundle is 777 KB. The connect and review pages' i18n
  (about 250 KB) and the unused Supabase realtime and storage clients load
  on every cold start, including the blob route. Import those pages
  lazily.
- RLS policies call `my_privileges()` and `caller_id()` per row
  (`20261007120000_policies_use_my_privileges.sql:11-17`), and
  `account_stewards_read` casts the key column to text
  (`baseline.sql:3035`). Wrap the calls in `(select ...)` and compare
  without the cast. The tables are small today.
- `events_parent_idx` is written on every insert, but nothing in this
  repo filters on `parent_event_id`. `org_memberships_profile_idx`
  duplicates the primary key's prefix. Drop both if `idx_scan` on
  production says they are unused.

Checked and fine: the RPCs that read `events` use its unique index; function
volatility is right; realtime sends one poke per stream per push; report
endpoints return ETags and 304s; hashed blob responses are immutable.

## 6. The earlier audit's open items

| Item | Status today | Recommendation |
| --- | --- | --- |
| 2.1 Benchmarks in CI | Open: no bench step in `.github/workflows` | Do: run `bench:core` in CI, comparing counts (index builds, copies) rather than times |
| 2.2 Benchmarks on a phone | Partial: the developer menu runs only the storage benchmark (`shell/DevMenu.tsx`) | Do: add fold, view rebuild and `offlineSummary`. Hermes's speed is this audit's biggest unknown |
| 2.3 Diagnostics gaps | Open: `load` has no reason and no read, parse and fold split; no `commit` or `checkpoint` records | Do the `load` reason and `checkpoint` first. Update the allowlist in `scripts/playDeclarations.test.ts` |
| 7 Several refolds per sync | Open, up to 4 (`syncClient.ts:608,645,754,758,768`) | Keep, until `load` by reason shows it matters |
| 7 Not-listed events re-queued per push | Open (`syncClient.ts:554`): reads every refused row each push | Do: filter by reason in SQL |
| 7 Redaction costs every phone a snapshot | Open | Design first; it changes decision 88 or the checkpoint |
| 7 `resume`'s clone | Done in sync; core's `snapshot.ts:44` still clones for the server jobs | Do: drop it for the reconciler and snapshot worker |
| 10 Incremental indexes | Open: C1 | Do: the largest app-side cost left |
| 11 State growth | Open | Keep. The bench now prints bytes by key; takes are 24% |
| 11 `appliedEventIds` in the live state | Open (`reducer.ts:33`), compacted only in the checkpoint | Do: about 65k ids at Bible scale |
| 12 `validateEvent` closures, revision bump per event, `highlightsFor` | Open (`validate.ts:19-74`, `reducer.ts:35`, `passage.ts:635`) | Do: small, covered by existing tests |
| 13 Notifications index | Open: V3 | Do |
| 13 Durable Object cache | Open: V4 | Measure, then cap by bytes |
| 13 Agent reads pull when nothing moved | Open: V5 | Do |

## 7. Order of work

1. **Redraws (R1, R2, R3).** One change in `App.tsx`, `useLanguage.ts`
   and `languageSession.ts`: split the context, stabilize `blobs`,
   throttle `present`, freeze hidden screens. Likely the largest visible
   gain on a slow phone, during exactly the work (audio catch-up) that
   happens on bad links.
2. **Quick wins.**
   - Each is an hour or less, and each is covered by existing tests or
     guardrails: the `/i18n/*` cache header (S5), `inlineRequires` (S1),
     the memoizations (R4, R5, R6), deferring help audio (S4), and the
     notifications index (V3).
   - Also the small core items: `highlightsFor`, `push()`'s Map, the
     not-listed filter, and the server-side clone.
3. **Lazy screens (S1, S2).** Reports first. This also frees room under
   the web budget, which is nearly spent.
4. **Incremental indexes (C1)**, with the bench row and counter first.
5. **Snapshot adopt and checkpoint (C2, C3)**, with the `checkpoint`
   diagnostics record.
6. **Server (V1, V2, V4, V5).** Check the signing keys first; V1 may be
   the cheapest large win on the server.
7. **Measure on a phone (2.2 of the earlier audit).** This runs alongside
   the rest. Every ranking above uses laptop numbers.

Changes that will need a `decisions.md` entry when built: asymmetric JWT
keys (V1), snapshot storage and retention (V7, amends 88), how the
projection pass computes Inbox rows (V2), and lazy loading of screens (S1,
if it changes how screens are registered).
