# Agent instructions for langquest-next

## Open work on other branches (read before touching orgs, projects or languages)

PR #5 (`project-is-one-language`, stacked on `ux/spoken-mobbin-overhaul`)
drops "language" as a level: org and project are the only buckets, and a
project is exactly one target language. `append_events` refuses a second
`LaneAdded` and new lane-scoped memberships; no event changes shape; the
language home merges into the project home. It also records that org
structure stays in the `_org` event log. See its `docs/decisions.md`
sections 28 and 29.

If your branch already solves this, drop PR #5 and keep yours. Otherwise,
integrate its simplification rather than reintroducing a language level.
Delete this section once PR #5 is merged or closed.

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
