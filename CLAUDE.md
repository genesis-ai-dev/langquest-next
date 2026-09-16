# Agent instructions for langquest-next

Read `PLAN.md` before doing anything. Section 4 lists invariants; every change
must keep them true. Section 6 is the event catalog; never change a shipped
event's shape, add a new versioned event instead.

Rules specific to this folder:

- `packages/core` is pure TypeScript with no I/O and no runtime dependencies.
  If you need SQLite, HTTP, or the filesystem, you are in the wrong package.
- `packages/client` owns sync. It talks to storage and the server only through
  the `EventStore` and `Transport` interfaces. Platform code (SQLite, Expo)
  implements those interfaces in `apps/mobile`; it never reimplements sync.
- Every new event type needs: a type in `events.ts`, a case in `reducer.ts`,
  and coverage in the order-independence and idempotence tests. The tests
  generate permutations, so adding the event to the fixture list is enough.
- User-facing screens follow PLAN.md section 12 and the mock in
  `docs/ux/one-next-action.html` (see `docs/ux/README.md` for the rules it
  encodes). Read it before changing an avatar U screen, the passage hub, or
  the VAD recording takeover. It is reference, not shipping code — improve it
  when a rule changes rather than letting it drift.

- No `status` columns. Status comes from `workflow.ts`.
- No local versus synced tables. Sync status is a column on the events table.
- Run `npm test` and `npm run typecheck` in this folder before finishing.

The parent repository is LangQuest v2. Do not import from it. Its data model is
what this app replaces; see PLAN.md section 2 for why.
