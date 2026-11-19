# packages/core

What the data means: the event catalog and envelope, the reducer that folds
a stream into state, validation, the commands that make events, and every
derivation a screen or report reads (`passage.ts`, `portfolio.ts` and the
rest). The phone, the Worker, the server jobs and the scripts run the same
code, so a state means the same thing everywhere (PLAN.md section 3).

- Pure TypeScript with no I/O and no runtime dependencies (PLAN.md invariant
  8). If you need SQLite, HTTP or the filesystem, you are in the wrong
  package: keeping and moving data is `packages/sync`, and a platform is the
  app's.
- The fold is deterministic, order-independent and idempotent, and never
  throws (PLAN.md invariants 2, 3 and 11). Property tests in `test/` hold
  each event type to it.
- Status is derived, never stored (invariant 5): ask `passage.ts`.
- A new event type follows `docs/events.md` ("Adding an event").
