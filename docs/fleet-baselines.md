# Fleet baselines

Date: 2026-10-12. By: Carl Sauder, with Claude. Measured on an Apple M5 Pro
(48 GB, Node 24.18.0) with `npm run fleet:baselines`, at commit `df1ad11`
plus this branch's uncommitted work, which includes the checkpoint seq fix
(`performance-audit.md` item 3). These are the numbers to compare against
before and after the next performance change.

Rerun them, or a subset, with:

```
npm run fleet:baselines
npm run fleet:baselines -- --only=slow --out=/tmp/fleet-after
```

The configurations live in `scripts/fleet/baselines.ts`. Each runs in its own
process, one after another. What the scenarios model and what each column
means is in `fleet-simulation.md`.

## How to compare

- **Counts are exact.** Events, syncs, snapshots taken, pieces fetched,
  minutes and megabytes are the same on every run for a seed. A change to
  any of them means behaviour changed.
- **Times are approximate.** Real seconds and CPU depend on the machine and
  what else it is doing. A rerun of `village-small` measured 31 ms of sync
  CPU while draining where the first run measured 21 ms. Compare the large
  runs, and rerun before reading a small difference as real.
- **Agreement must stay "yes".** Every phone ended with the server's state
  in all 17 runs.
- **The snapshot rule changed after these were taken.** The results below
  are from before decision 88. `npm run fleet:baselines` now runs the
  scenarios with the server's new rule and adds `-oldRule` runs with the
  rule these used; the `-oldRule` runs reproduce these numbers exactly.
- **Runs with a different snapshot rule are close, not identical.** A
  phone that adopts a snapshot instead of pulling learns of the work at a
  different moment, so its persona acts at different moments, and events
  and syncs differ slightly between those pairs.

## Results

### normalDay

| Run | Phones | Passages | Sim days | Real s | Heap MB | Events | Syncs | Sync CPU s | Sync CPU p95 ms | Refolds | MB down | Reach server p95 min | Reach others p95 min | Agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normalDay-default | 14 | 300 | 7 | 2.71 | 44 | 1,415 | 32,288 | 0.5 | 0.04 | 0 | 7.29 | 0.01 | 2,829 | yes |
| normalDay-45 | 45 | 1,000 | 7 | 10.96 | 260 | 4,018 | 116,895 | 2.5 | 0.06 | 0 | 62.92 | 150 | 2,768 | yes |
| normalDay-131 | 131 | 3,000 | 7 | 60.46 | 1,778 | 11,402 | 461,226 | 21.4 | 0.13 | 0 | 511 | 170 | 2,754 | yes |

### villageReconnect

| Run | Phones | Passages | Sim days | Real s | Heap MB | Events | Syncs | Sync CPU s | Sync CPU p95 ms | Refolds | MB down | Reach server p95 min | Reach others p95 min | Agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| village-small | 9 | 300 | 7.29 | 1.25 | 28 | 1,213 | 19,126 | 0.2 | 0.02 | 0 | 4.65 | 9,886 | 9,886 | yes |
| village-default | 17 | 1,200 | 14.29 | 6.34 | 137 | 4,835 | 70,802 | 1.7 | 0.04 | 0 | 35.15 | 19,853 | 19,853 | yes |
| village-large | 66 | 3,000 | 28.29 | 39.29 | 774 | 12,080 | 540,118 | 6.6 | 0.02 | 0 | 343 | 40,115 | 40,116 | yes |

| Run | Backlog at reconnect | Minutes to drain | Append calls to drain | Sync CPU while draining, total ms | p95 ms | max ms |
| --- | --- | --- | --- | --- | --- | --- |
| village-small | 900 | 1 | 5 | 20.6 | 2.7 | 2.7 |
| village-default | 3,600 | 1 | 20 | 174 | 5.96 | 11.28 |
| village-large | 9,000 | 1 | 81 | 1,728 | 6.52 | 16.09 |

### reducerBump

| Run | Phones | Passages | Sim days | Real s | Heap MB | Events | Syncs | Sync CPU s | Sync CPU p95 ms | Refolds | MB down | Reach server p95 min | Reach others p95 min | Agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bump-default | 14 | 600 | 4.38 | 3.54 | 139 | 2,610 | 27,026 | 0.8 | 0.06 | 0 | 22.57 | 0.01 | 0.15 | yes |
| bump-minNew200 | 14 | 600 | 4.38 | 2.54 | 68 | 2,595 | 26,944 | 0.8 | 0.05 | 0 | 22.63 | 0.01 | 0.15 | yes |
| bump-slow5KBps | 14 | 600 | 4.38 | 3.67 | 114 | 2,646 | 27,115 | 0.8 | 0.06 | 0 | 23.45 | 0.02 | 0.54 | yes |
| bump-slow5KBps-minNew200 | 14 | 600 | 4.38 | 2.54 | 89 | 2,633 | 27,017 | 0.8 | 0.05 | 0 | 23.07 | 0.02 | 0.54 | yes |
| bump-large | 66 | 3,000 | 4.38 | 60.46 | 1,169 | 13,045 | 340,327 | 29.6 | 0.18 | 0 | 571 | 0.03 | 0.33 | yes |

| Run | Cold starts | Never caught up | Worst minutes | Snapshots ok | Snapshots stale | Snapshot pieces fetched | Snapshots taken |
| --- | --- | --- | --- | --- | --- | --- | --- |
| bump-default | 14 | 0 | 0.77 | 14 | 0 | 43 | 356 |
| bump-minNew200 | 14 | 0 | 0.77 | 14 | 0 | 28 | 10 |
| bump-slow5KBps | 14 | 0 | 3.7 | 13 | 1 | 230 | 358 |
| bump-slow5KBps-minNew200 | 14 | 0 | 2.77 | 14 | 0 | 226 | 10 |
| bump-large | 66 | 0 | 7.13 | 57 | 9 | 704 | 398 |

### slowLink

| Run | Phones | Passages | Sim days | Real s | Heap MB | Events | Syncs | Sync CPU s | Sync CPU p95 ms | Refolds | MB down | Reach server p95 min | Reach others p95 min | Agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| slow-default | 14 | 1,200 | 4.38 | 4.09 | 137 | 3,223 | 26,516 | 0.9 | 0.07 | 0 | 23.56 | 0.01 | 0.04 | yes |
| slow-minNew200 | 14 | 1,200 | 4.38 | 2.65 | 76 | 3,249 | 26,720 | 0.8 | 0.07 | 0 | 19.95 | 0.01 | 0.04 | yes |
| slow-8KBps-256KB | 14 | 1,200 | 4.38 | 4.04 | 76 | 3,239 | 26,671 | 0.8 | 0.07 | 0 | 19.85 | 0.01 | 0.04 | yes |
| slow-large | 66 | 3,000 | 4.38 | 59.54 | 999 | 13,070 | 341,897 | 28.8 | 0.18 | 0 | 384 | 0.03 | 0.06 | yes |

| Run | Snapshot KB at join | Joiner minutes | Joiner MB down | Joiner snapshot outcomes | Snapshots taken |
| --- | --- | --- | --- | --- | --- |
| slow-default | 624 | 14, 14, 29 | 1.8, 1.9, 2.7 | stale, stale, stale | 351 |
| slow-minNew200 | 596 | 6, 6, 6 | 0.9, 0.9, 0.9 | ok, ok, ok | 10 |
| slow-8KBps-256KB | 624 | 2, 1, 2 | 0.8, 0.8, 0.8 | ok, ok, ok | 352 |
| slow-large | 2,736 | 43, 48, 42, 43, 51 | 5.8, 6.5, 6, 6, 6.4 | stale, stale, stale, stale, stale+stale | 397 |

### refoldTriggers

| Run | Phones | Passages | Sim days | Real s | Heap MB | Events | Syncs | Sync CPU s | Sync CPU p95 ms | Refolds | MB down | Reach server p95 min | Reach others p95 min | Agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| refold-default | 14 | 300 | 3 | 2.74 | 52 | 1,638 | 18,153 | 1 | 0.06 | 436 | 9.55 | 600 | 600 | yes |
| refold-large | 33 | 1,200 | 3 | 286 | 441 | 4,632 | 142,923 | 236 | 5.3 | 74,271 | 901 | 600 | 600 | yes |

| Run | Hours unlisted | Refolds while unlisted | Worst phone | Redactions | Refolds after listing | Per phone | Sync CPU after listing, ms | Empty snapshot lookups |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| refold-default | 10 | 120 | 120 | 21 | 316 | 23 | 993 | 1,705 |
| refold-large | 10 | 73,555 | 73,555 | 21 | 1,277 | 39 | 13,064 | 77,460 |

## Core and server benchmarks

`npm run bench:core`, synthetic language (per passage: a unit, two
recordings and takes, two submissions, four reviews, two notes), median of
five runs:

| Passages | Events | Fold ms | Rebuild per publish ms | offlineSummary ms | Snapshot KB | Snapshot KB by key |
| --- | --- | --- | --- | --- | --- | --- |
| 1,200 | 15,635 | 31.3 | 8 | 38.45 | 3,369 | recordings 931, takes 804, kindReviews 802, notes 454, submissions 236, units 142 |
| 5,000 | 65,130 | 125.74 | 36.48 | 582.91 | 14,195 | recordings 3,897, kindReviews 3,393, takes 3,371, notes 1,931, submissions 996, units 606 |

`npm run bench:server`, local Postgres, an empty organization (the best
case for every lookup), one transaction rolled back:

| Measure | ms |
| --- | --- |
| append 200 UnitAdded | 19.3, 16.9, 17.9, 16.3, 16.2 |
| append 200 RecordingAdded | 27, 26.6, 27.7, 31.9, 32.8 |
| pull 500 events | 0.7 |
| put_snapshot | 122.5 |
| get_snapshot_meta | 122.5 |
| get_snapshot_chunk (first, middle, last) | 61.7, 69.1, 77.5 |

## After item 5: the snapshot schedule and retention (decision 88)

Same seeds, same machine, `npm run fleet:baselines -- --only=bump` and
`--only=slow`. Each pair runs the new rule and the rule before it.

| Run | Rule | Snapshots stale | Worst cold start, min | Snapshots written | MB down |
| --- | --- | --- | --- | --- | --- |
| `bump-default` | new | 0 | 0.77 | 38 | 22.42 |
| `bump-oldRule` | old | 0 | 0.77 | 356 | 22.57 |
| `bump-slow5KBps` | new | 0 | 2.73 | 38 | 22.79 |
| `bump-slow5KBps-oldRule` | old | 1 | 3.7 | 358 | 23.45 |
| `bump-large` | new | 0 | 3.69 | 54 | 541 |
| `bump-large-oldRule` | old | 9 | 7.13 | 398 | 571 |

| Run | Rule | Joiner minutes | Joiner MB down | Joiner snapshots |
| --- | --- | --- | --- | --- |
| `slow-default` (1,200 passages) | new | 6, 5, 6 | 0.8 each | ok, ok, ok |
| `slow-oldRule` | old | 14, 14, 29 | 1.8, 1.9, 2.7 | stale, stale, stale |
| `slow-large` (3,000 passages) | new | 26, 27, 27, 25, 25 | 3.8 each | all ok |
| `slow-large-oldRule` | old | 43, 48, 42, 43, 51 | 5.8 to 6.5 | all stale (one twice) |

At 2 KB/s a 2.7 MB snapshot takes about 23 minutes to download, so 25 to
27 minutes is close to what the link allows.

## After item 4: snapshot pieces stored once (decision 89)

`npm run bench:server`, the same 14 MB snapshot of 55 pieces:

| Measure | Before, ms | After, ms |
| --- | --- | --- |
| `put_snapshot` | 122.5 | 335.8 |
| `get_snapshot_meta` | 122.5 | 0.5 |
| `get_snapshot_chunk` (first, middle, last) | 61.7, 69.1, 77.5 | 0.3, 0.1, 0.1 |

A full download goes from about 4 s of database time to under 10 ms. The
fleet's fake server already served pieces from memory, so its numbers do
not change.

## What these show

- **`normalDay`:** sync CPU grows faster than the team. Going from 14 to 131
  phones multiplied phones by 9 and total sync CPU by about 40 (0.5 s to
  21 s): every event pokes every phone, and each sync works over a bigger
  state.
- **`villageReconnect`:** draining is fast on the clients. Even a 9,000-event
  backlog from 66 phones drained within a minute in 81 append calls. What
  this does to the real server's per-stream lock is not measured here
  (`performance-audit.md` item 8). The cost of the offline stretch is the
  wakes: 540,000 syncs over 28 days for 66 phones, nearly all with no
  signal. That assumes every app stays open all day, so it is an upper
  bound.
- **`reducerBump`:** at 600 passages, cold starts are cheap whatever the
  snapshot rule. At 3,000 passages, 9 of 66 phones threw a download away
  (`stale`), and the worst took 7 minutes.
- **`refoldTriggers`:** a hot loop. With a 1,200-passage template queued
  while the language was not listed, one phone refolded 73,555 times in
  10 hours (`performance-audit.md` item 7). Each redaction refolds every
  phone that pulls it.
- **Benchmarks:** `offlineSummary` is quadratic (38 ms at 1,200 passages,
  582 ms at 5,000), and every snapshot piece costs the server as much as
  serializing the whole snapshot (62 to 77 ms each, 55 pieces).
- **`slowLink`:** today's snapshot rule fails slow joiners, and it gets worse
  with size. With a 2.7 MB snapshot (3,000 passages), all 5 joiners' downloads
  went stale (one of them twice). Each then pulled the log: 42 to 51 minutes
  and about 6 MB each. Waiting for 200 new events before a new snapshot
  (`slow-minNew200`) let every joiner adopt it in 6 minutes for 0.9 MB, at
  1,200 passages.
