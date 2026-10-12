# Fleet simulation

Many phones and one server in one process, on simulated time. Every phone
runs the app's real sync code: `SyncClient`, `SyncScheduler` and
`Diagnostics` from `packages/client`, wired the way
`apps/mobile/src/useLanguage.ts` wires them. The people on the phones are
personas, the server is the in-memory `FakeServer`, and each phone talks to
it over a shaped link (latency, bandwidth, lost calls, no signal). A month
offline takes seconds.

It answers questions about the clients and the protocol: does every phone
end with the same state, how long does work take to reach the others, what
does a backlog cost to drain, and what happens to cold starts when the
snapshot moves. It does not measure Postgres, the Worker or a phone's
speed. Those are the real-server fleet and the device runs that
`performance-audit.md` (section 2) describes, still to build.

## Running it

```
npm run fleet -- --list
npm run fleet -- normalDay
npm run fleet -- slowLink --snapshotMinNew=200 --json=/tmp/slow.json
```

Every setting a scenario lists can be set with `--name=value`. A run is
deterministic for a seed. `npm run fleet` gives Node a 16 GB heap ceiling
(the default here is about 4 GB). Each phone holds about 18 MB for a
3,000-passage language, so that is room for roughly 800 such phones;
garbage collection stayed near 2% of a run up to 196 phones. It exits non-zero if any phone disagrees with
the server or an error was thrown. `packages/client/test/fleet.test.ts`
runs a small fleet in `npm test` (under 2 seconds) and checks that every
phone agrees with the server, that a seed gives the same run twice, and
that a village that reconnects drains its backlog.

Baseline numbers for every scenario at several sizes are in
`fleet-baselines.md`; `npm run fleet:baselines` reruns them.

## Scenarios

| Scenario | Models | Read |
| --- | --- | --- |
| `normalDay` | A team on mixed links (phone signal, a town trip every 3 days, a patchy slow signal) working office hours for a week | Sync CPU per run, time for work to reach the others, wakes with no signal |
| `villageReconnect` | Everyone sets up in town, works out of reach for two weeks, and comes back into signal on the same morning | Backlog size, minutes to drain it, append calls, sync CPU while draining |
| `reducerBump` | Every phone cold-starts through the server snapshot over an hour, while the team works and the server writes snapshots on its schedule (decision 88) | Snapshot outcomes, minutes to catch up, megabytes |
| `slowLink` | Phones on a 2 KB/s link join a busy language | Whether each joiner's snapshot went `stale`, minutes, megabytes |
| `refoldTriggers` | The language is not listed for its first 10 hours (its events refused and re-queued), then the coordinator redacts notes as it goes | Refolds while unlisted and after, the sync CPU they cost, empty snapshot lookups |

## Reading the report

- **Sync CPU and append CPU** are real milliseconds in this process (Node,
  V8), with network waits taken out. Compare runs with each other, not with
  a phone.
- **Reach others** is the simulated time from an append on one phone to its
  arrival on another; **reach server** is from the append to the server
  accepting it.
- **Refolds** are full refolds of the local log beyond the load at install
  and after adopting a snapshot (audit item 7).
- **Snapshots** counts the outcomes the phones recorded: `none` (no
  snapshot existed), `ok` (adopted), `stale` (the snapshot moved during the
  download, so it was thrown away and the phone pulled the log).
- **Agreement** folds the server's log from scratch and compares every
  phone's state with it, leaving out `appliedEventIds`. This is invariant 2
  across a fleet.

## What it showed first (2026-10-12)

- `slowLink` reproduced audit item 5. With the rule of the time (a new
  snapshot after any new event, the old one deleted at once), every slow
  joiner's download went `stale`, and each then pulled the whole log: 14 to
  29 minutes and 1.8 to 2.7 MB each. Decision 88 changed the rule; the same
  joiners now take 5 to 6 minutes for 0.8 MB (`fleet-baselines.md`). The
  scenarios model the server's rule by default and the old one with
  `--snapshotMinNew=1 --snapshotMaxAgeMin=0 --snapshotRetainHours=0`.
- Bigger teams cost far more than their size, and audit item 3 is why.
  Every append pokes every phone, so syncs grow with phones × appends, and
  every sync that pulls parses the phone's whole checkpoint
  (`syncClient.ts:681`) to read one number. In `normalDay` with 45 phones,
  that parse was 81% of the run. Fixed the same day: the seq is now kept
  beside the checkpoint. With the fix, 45 phones take 11 s instead of 55 s,
  and 131 phones (3,000 passages) 60 s instead of 923 s.
- At 131 phones the run still holds a 2.3 GB heap: every phone keeps its
  state and its checkpoint text in memory (`MemoryStore`). That is the
  simulator's limit on fleet size in one process, not a phone's.
- `villageReconnect`: while the app is open, a phone with no signal wakes
  about every 5 minutes, the scheduler's backoff ceiling. The simulator
  keeps every app open all day, so its count (about 280 a day) is an upper
  bound; a real phone pays it only for the hours the app is open. On a
  phone, sync woke when the app came to the front but not when the
  network returned (`apps/mobile/src/wake.ts` listened for that only on
  the web). Fixed the same day (LAN-47): a phone now wakes sync when its
  network comes back (expo-network, `networkWake.ts`), and the offline poll
  backs off to 30 minutes. `village-small`: 2,962 wakes with no signal
  instead of 16,799, and work reaches the server as soon as before.

- `refoldTriggers` found a hot loop (`performance-audit.md` item 7). While
  a language is not listed, a phone with more than 1,000 queued events
  re-runs sync at once, again and again, each time pushing five refused
  batches and refolding: 73,555 refolds in 10 hours on one phone with a
  1,200-passage template.

## Where the code is

- `packages/client/src/testing/`: the engine, Node only; the app never
  imports it.
  - `fakeServer.ts`: the in-memory server the client tests also use.
  - `virtualTime.ts`: simulated timers.
  - `random.ts`: seeded randomness.
  - `shapedTransport.ts`: a link around any `Transport`.
  - `fleet/links.ts`: link schedules.
  - `fleet/personas.ts`: coordinator, translator, reviewer.
  - `fleet/device.ts`: one phone.
  - `fleet/fleet.ts`: the server's snapshot pass, realtime pokes, settling,
    agreement and the report.
- `scripts/fleet/`: the command (`run.ts`) and the scenarios.

## Limits

- **Every app is open all the time.** A real phone runs sync timers only
  while the app is open; the simulator never closes it. Counts of syncs
  with no signal are upper bounds.
- **One language stream.** No organization stream, memberships or blobs.
  The fake server accepts everything unless a scenario says otherwise
  (`refoldTriggers` refuses the language as not listed for a while).
- **Personas are simple.** Translators record each assigned passage and
  re-record what is sent back; reviewers review submitted versions for
  one kind and sometimes leave a note. A synthetic language's snapshot is
  far smaller than a Bible's, so `--chunkKB` stands in for the number of
  pieces a large one has.
- **Phone storage is MemoryStore, not SQLite.** Commit costs on a device
  (audit item 1) do not show here.
