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
- Every new event type needs: a type in `events.ts` (or `record.ts`), a case
  in `reducer.ts`, a case in `validate.ts` and in the SQL `validate_payload`
  and `event_privilege` (a new migration), and coverage in the
  order-independence and idempotence tests. The tests generate permutations,
  so adding the event to the fixture list is enough;
  `scripts/record-parity-sql.ts` checks SQL against core.
- User-facing screens follow the partner demo in `ng-langquest-ux` (its
  flow, look and capabilities). Read PLAN.md section 12 and
  `docs/ux/demo-parity.md` before changing a screen. `apps/mobile/src/flow.ts`
  is generated from the demo's flow (`test/spec-flow.json`); the parity test
  holds it edge by edge.

- No `status` columns. Status comes from `passage.ts` (and `workflow.ts` for v1 lanes).
- No local versus synced tables. Sync status is a column on the events table.
- Run `npm test` and `npm run typecheck` in this folder before finishing.

The parent repository is LangQuest v2. Do not import from it. Its data model is
what this app replaces; see PLAN.md section 2 for why.
