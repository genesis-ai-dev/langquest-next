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
- Env files are committed encrypted with dotenvx; set values with
  `npm run env:set`, never commit `.env.keys` or a plaintext value, and change
  hosted settings in repo files, not dashboards (`infrastructure-as-code`).

The parent repository is LangQuest v2. Do not import from it. Its data model is
what this app replaces; see PLAN.md section 2 for why.

## Skills

Skills live in `.agents/skills/` (read by Cursor, Codex and others) and are
symlinked into `.claude/skills/` and `.hermes/skills/`. Third-party skills are
installed with `npx skills` and pinned in `skills-lock.json`; do not edit them
in place, because an update overwrites them. `docs/agent-skills.md` records why
each was chosen and what was rejected.

Project skills, written for this app (use these first):

- `event-sourced-sync`: events, reducer, validation, sync, storage.
- `architecture-tradeoffs`: style, quanta, trade-offs, decisions, fitness functions.
- `error-tracking`: error classes, boundaries, crash reporting, privacy, offline delivery.
- `laws-of-ux`: Fitts, Hick, Jakob and the rest, tuned for field use.
- `infrastructure-as-code`: hosted settings, secrets and env files live in the repo, never only in a dashboard.

Third-party skills, by task:

- Design and structure: `codebase-design`, `domain-modeling`,
  `domain-driven-design-distilled`, `clean-architecture`, `clean-code`,
  `refactoring`, `designing-data-intensive-applications`.
- Tests and debugging: `test-driven-development`, `property-based-testing`,
  `systematic-debugging`, `verification-before-completion`.
- React Native and Expo: `react-native-best-practices`, `react-navigation`,
  `expo-design-system`, `expo-module`, `expo-upgrade`.
- UX and accessibility: `ux-heuristics`, `react-native-accessibility`.
- Security and data: `security-review`, `supabase`,
  `supabase-postgres-best-practices`.

Where a skill and this project disagree, the project wins:

- PLAN.md invariants and `docs/decisions.md` override any skill. Generic
  event-sourcing advice (expected-version checks, ordered projections,
  last-writer-wins rows, stored status) does not apply; see `event-sourced-sync`.
- Record decisions in `docs/decisions.md` in its existing format, not in a new
  `docs/adr/` folder.
- Touch targets are 48pt and primary actions 56pt, not 44pt.
- The partner demo decides screens. Skills that assume Expo Router, NativeWind,
  `@expo/ui` or a web stack do not apply; this app uses react-navigation and
  its own kit (`theme.ts`, `kit.tsx`).
- Tests go where the existing ones are (`packages/*/test`, `apps/mobile/test`),
  whatever layout a skill suggests.
