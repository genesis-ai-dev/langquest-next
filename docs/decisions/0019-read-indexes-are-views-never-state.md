# 19. Read indexes are views, never state

Date: 2026-09-15 · By: Ryder Wishart · Status: accepted

Reason: `deriveTasks` at Bible scale took 27 s because every derivation
rescanned all takes and assignments per unit and lane. The fix is one pass
that builds lookup maps (`packages/core/src/indexes.ts`) and derivations that
take it as an argument. It is not stored in `ProjectState`, not snapshotted,
not synced, and every derive function still works without it, so the fold
and the invariants are untouched. Reverse if: never; a cache inside the
state would have to be kept coherent by the reducer, which is exactly the
trigger-maintained rollup PLAN.md section 2 warns against.

Amended (2026-10-14, Caleb Koster): a phone that keeps a big language on
disk (decision 143) also keeps one line per passage there, so lists never
need every passage's record in memory. The lines are still views: outside
the state, never snapshotted or synced, and worked out by core's own
`derivePassage` from the passage's records whenever an event touches that
passage, so they cannot disagree with it. The reducer never maintains them.
