# LangQuest v2 fix history: which faults could come back in Next

Status: review, 2026-11-06 (LAN-58). Written by Claude for Caleb Koster. No
decision changes; recommended issues are listed in section 4.

## 1. What was read, and what was not

- v2 is `genesis-ai-dev/langquest`, read only, full history (2,198 commits,
  2024-10-09 to 2026-09-19). No code was copied or imported.
- 412 non-merge commits whose subject says fix, bug, crash, revert, regression
  or hotfix were sorted by kind. About 45 of them were read in full (message
  body). The rest were sorted by subject alone.
- About 120 of the 412 are CI, workflow, formatting and typecheck fixes; they
  say nothing about the product and are left out below.
- Many v2 subjects are vague ("some fixes", "Fixed login bug"). A kind that
  hides in those could be missed. The diffs were not read.
- Each kind was checked against Next's code, tests and `docs/decisions.md` by
  search and reading, not by running the app. "Covered" means a rule and a test
  or a design answer exist. "Open" means none was found.

## 2. The kinds of fault, and what Next does about each

| # | Kind of fault in v2 | v2 evidence | In Next | Verdict |
| --- | --- | --- | --- | --- |
| 1 | Transfer work that grows faster than the pile (uploads of thousands of files) | 921, 928, 930; the 10k-file planting script and benchmark in 921 | `transferWorker.ts` stops a pass when a pull starts or the phone goes offline, re-checks before each file, backs off per file. `docs/performance-audit-2026-10-26.md` removed two quadratic loops | Covered in design. **Open: no test at scale** (item A) |
| 2 | Uploads repeated because the server's answer had not arrived yet | 928 | A file leaves the list only on server confirmation; a grace period follows each success (`transferWorker.ts`) | Covered |
| 3 | Signed-out or stuck while offline | 726, 727, 34d1bb43, 24faa6e7 | Decision 87, PR 248 | Covered (Caleb's 2 Nov note) |
| 4 | Local database change locks people out | migration loop 602, 49c259b9, no-op migration in 921, 2h timeout 924, 922 | Local store is an event log with a few `create table if not exists`; snapshots carry the reducer version (invariant 10) | **Open** (item B) |
| 5 | Server work that exceeds the statement timeout and turns every upload into a retry loop | closure triggers: 30c9e6ea, b8cbddee, 922 | No rollup triggers (PLAN section 2). Only `service_role` gets a 2 minute timeout (migration 20261014180000) | Mostly covered. **Open: no test that the biggest push or pull page fits the default timeout** (item C) |
| 6 | Two people create the same thing offline | duplicate books 6d1e2bd9 | Event ids name events; names match once case and spaces are set aside (decisions.md 2706 to 2811) | Covered |
| 7 | Orphans and lost audio when records merge or publish | 9d99893f (audio deleted on merge, foreign key breaks) | Cards and takes are immutable (invariant 4); streams are self-contained (invariant 6) | Covered by design |
| 8 | Wrong content shown because a cache was keyed too loosely | e493deaa (French shown in English) | Files are kept by hash | Covered by design |
| 9 | Screen sleeps, recording cut short, space or interruptions | 72851f37, 222617c5, 2ce39fa2 | Keep-awake and fault codes for no space, interrupted, permission, write (`useRecorder.ts`, `recorderFaultModel.ts`); recording journal finishes an interrupted take next launch | Covered |
| 10 | Audio plays outside its screen; native listeners leak | f9e22f5d, 3e02d6c1, 2ce39fa2 | PR 73; the app-state listener is removed on cleanup | Covered (named in the issue) |
| 11 | Blob URLs stored as if they were files | dba2ae29 | Web recorder hands a blob URL to `blobs.ts`, which reads the bytes, stores them by hash and frees the URL | Covered |
| 12 | List order wrong on first insert | 10e853be, 074bebc5 | Order comes from the reducer, not insertion time | Covered by design |
| 13 | Text cut off in some scripts | 617b51db (descenders clipped; line height removed) | `textStyles.ts` fixes line heights at 18 to 23 points | **Open** (item D) |
| 14 | Store and build config lost or drifting | 84f701b5 (microphone text removed), 005e9800 (runtime version policy), Play fixes | `playDeclarations.test.ts`, `i18n.test.ts` (iOS strings), AGENTS.md store rules | Covered |
| 15 | Invite email abuse and bounces | 5b08e40d (rate limit), 0f5def64 and 21002ee7 (bounces) | Invites are codes and QR; no invite email found | Not applicable today. Watch if email invites return |
| 16 | Public-project rules blocked legitimate submissions; user ids differ by dashes or case | a78cb209, 9deac412 | One read rule (`can_read_stream`); ids come from one generator | Covered by design; not re-tested here |
| 17 | Test accounts fighting each other in parallel UI tests | 914, 915, 7fd635dc | One role per test (`docs/testing.md`) | Covered |

## 3. Faults that can come back, most serious first

### A. A pile of thousands of files has never been tested in Next

v2's worst fault was cost that grew with the square of the pile. Next's design
avoids it, and the audit removed two such loops. But the transfer tests in
`packages/sync/test/transferWorker.test.ts` use a handful of files, and the
sync backlog test uses 450 events. v2 only found its problem when someone
planted 10,000 pending files. Nothing in Next would fail if a later change made
`work()` or a pass cost grow with the whole pile.
Why it matters: a translator who records offline for weeks is the main
user. Cost is a slow phone, not lost data.

### B. A change to the local database has no safe path

`SqliteStore.open` (`packages/sync/src/sqliteStore.ts`) has no stored version.
It has one shape check: if `events` has no `stream_id` column, it drops
`events`, `cursors` and `meta`. That was right for one old shape, but it would
delete unsent work (invariant 1) if the same pattern were copied for the next
change. v2's migration loop, and its no-op migration added to stop a lockout,
came from the same gap: a local change with no rehearsed way through.
Why it matters: this is the only found path that could lose a person's
recordings, and the next local change will meet it.

### C. Server cost of one push or pull is not held under the default timeout

Pages are bounded (200 pushed, 500 refused). The 2 minute timeout covers only
the service role. I found no test that a full push batch or the largest pull
page finishes inside the default timeout when the log is large. `bench:server`
exists, but nothing fails when it slows. v2 learned that a statement over the
limit becomes an endless retry.
Why it matters: low chance now (no triggers), serious if it happens, because it
blocks every upload from one device.

### D. Tall scripts may be clipped

Line heights are fixed numbers. v2 fixed clipped descenders in its own text
and stopped setting line height on large text. Next's labels show in 20 or
more interface languages, and no test or screenshot check covers scripts with
tall stacked marks (Bengali, Amharic, Arabic with marks, Khmer, Burmese if added).
Why it matters: cosmetic, but a clipped label can hide a button's meaning.

### Watch items (no issue yet)

- Email invites, if they come back: bring v2's send limit and bounce handling.
- Any new trigger or rollup on the server: PLAN section 2 already forbids the
  v2 shape; this list is the reason.

## 4. Issues recommended

1. **Add a scale test for pending files.** 10,000 pending files, offline then
   online, with a pull starting mid-run. Assert the number of work-list
   rebuilds and total passes stay linear, and that nothing is re-sent after a
   server answer. Layer: `packages/sync/test` (docs/testing.md).
2. **Give the local database a version and a rule.** Store a version in
   `meta`; each change is a named step; a step may never drop an event that is
   pending or unsent. Test: open a database of the old shape holding pending
   events and see them survive. May need a decision entry when built.
3. **Fail a test when one push or pull page nears the default timeout.** Use
   the `bench:server` data size; set a limit with margin below 8 seconds.
4. **Check text in tall scripts.** One web UI test or screenshot check of key
   screens in the scripts the app ships, looking for cut-off lines.

## 5. Decision log

No entry added or amended. This is a review; each recommended issue that
changes the design should add its own entry.
