# 167. The nightly mutation run is four shards of core's files, dealt by what each costs, and one merged score

Date: 2026-10-26 · By: Carl Sauder · Status: accepted

Reason: Stryker over all of `packages/core` never finished at night (LAN-97).
Core grew from about 10,700 mutants (2026-10-14, 7 minutes on a laptop) to
20,158, and the job ran 7 workers on a 4-core runner, so its own timeouts
killed mutants: on 2026-10-23 it had tested 12% when the job's 40 minutes
ran out, and since the incremental file is written only at the end, no
night ever started further on. Carl chose (2026-10-26) to shard it.
- **Dealt by cost.** `scripts/mutation-shards.mjs` deals core's files to
  four shards, the slowest first, each to the lightest shard so far. A
  file's cost is its mutants times the tests each one runs, measured once
  and listed in `SLOW_SECONDS` (as `scripts/unit-shards.ts` does for the
  unit suite); neither lines nor bytes stood for it (`catalogData.ts` is
  139 kB of static data that Stryker leaves alone).
- **Four, not eight.** A file cannot be split, and `passage.ts` and
  `validate.ts` each take about ten minutes alone on a laptop, so no shard
  ends sooner than they do: eight shards would end no earlier than four,
  on twice the runners. The rest of core fits in the other two.
- **Each shard** runs four workers, has its own incremental file and cache
  key, and 90 minutes. `nightly-mutation` merges their reports into one
  `mutation-core` artifact and one score, and is the job Linear hears about.
- `npm run test:mutation` still runs all of core at once, for a laptop.
Reverse if: a shard runs out of time (then measure again and split the
slow file's tests, or give it its own runner), or Stryker learns to keep
partial results, so one job could carry on from where the last night
stopped.
