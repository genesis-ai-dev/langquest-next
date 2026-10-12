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
  in all 15 runs.
- **Runs with a different `snapshotMinNew` are close, not identical.** A
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
- **`slowLink`:** today's snapshot rule fails slow joiners, and it gets worse
  with size. With a 2.7 MB snapshot (3,000 passages), all 5 joiners' downloads
  went stale (one of them twice). Each then pulled the log: 42 to 51 minutes
  and about 6 MB each. Waiting for 200 new events before a new snapshot
  (`slow-minNew200`) let every joiner adopt it in 6 minutes for 0.9 MB, at
  1,200 passages.
