# Agent instructions for langquest-next

## Org structure (read before touching orgs, projects or languages)

An organization holds its target languages directly; there is no project
level in the app (`docs/decisions.md` 34). Each language is its own synced
partition, listed in the org's `_org` partition, and a phone pulls only the
languages it opens (decision 37: `orgLanguages`, `partitionOfLane`).
Templates, flows and reference material are library documents in the
database, not app code (decision 36, `docs/library.md`). PR #5
(`project-is-one-language`) took another route and is to be closed rather
than integrated. Delete this section once it is closed.

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

- The web app is the Expo app's web export (decisions.md 58), served with
  the reports API by the Worker in `apps/web` (decision 44); there is no
  separate web page any more. Report screens are the app's Reports section
  (`apps/mobile/src/screens/reports.tsx`, parts in `src/reports/`), and
  report logic is `packages/core/src/portfolio.ts`. Web-only code goes behind
  `Platform.OS === 'web'` or in a `.web.tsx` file, and
  `npm run test:web` (smart-tests/web-smoke) must pass.
- No `status` columns. Status comes from `passage.ts` (and `workflow.ts` for v1 lanes).
- No local versus synced tables. Sync status is a column on the events table.
- Run `npm test` and `npm run typecheck` in this folder before finishing.
- Put the Linear issue ID (`LAN-12`) in the commit message of work that comes
  from an issue. The pipeline moves that issue to Deploying, then Live or
  Outage (`scripts/linear-sync.mjs`, decisions.md 53). No ID, no status change.
- Secrets are committed encrypted with dotenvx in the root `.env.<env>`;
  public settings are plain (`docs/environments.md`). Change either with
  `npm run env:update -- <env> KEY`, never by hand or in a dashboard, and
  apply secrets with `npm run secrets -- <env>`.
  Never read `.env.keys` or print decrypted values, and ask before pushing
  to EAS. Hosted settings live in repo files, not dashboards
  (`infrastructure-as-code`).

## Store declarations (required, whoever you are working for)

`docs/play-store-declarations.md` records every answer given to Google Play
for this app: data safety, content rating, target audience, permissions, app
access, the store listing. Google holds us to those answers.

- A change that alters any of these makes an answer untrue: what the app
  collects, stores or sends; an Android permission or Expo plugin; an SDK in
  `apps/mobile`; diagnostics; a third-party service; ads; sign-in or account
  deletion; the kind of content it shows; who it is for.
- For such a change, update that file in the same change, and say in your
  reply which Play Console answers the developer must change, and where
  (for example: "Data safety → Data types: add Location → Approximate").
- `scripts/playDeclarations.test.ts` catches the mechanical cases
  (permissions, plugins, mobile dependencies, the diagnostics allowlist);
  the rest rely on you. Never update its facts block without checking the
  Play Console answers it stands for.

## Decision log (required, whoever you are working for)

`docs/decisions.md` is the team's ADR log. Any agent working in this repo keeps
it current for every developer, without being asked. The file's header has the
format.

- Before designing, read the entries that touch the area. If the change
  contradicts one, say so and ask the developer before going on. Never quietly
  work around a recorded decision.
- When a change makes or changes an architecture or design decision (the
  header lists the triggers), add or amend the entry in the same change. Put
  the developer driving the session in `By` (`git config user.name` gives
  their handle; use their full name as the log already does) and today's date
  in `Date`.
- If the reason is not clear from the conversation, ask the developer for it.
  Do not make one up.
- Never renumber an entry or rewrite its reasoning. Supersede it with a new
  entry, or append an `Amended (date, name):` paragraph.
- When you finish, say which entry you added or amended, or that the change
  needed none.

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
- `field-diagnosis`: a field report ("slow downloads in this language", an error code) to its cause, from `npm run diag`.
- `run-app`: the app on the iOS simulator and Android emulator, two accounts, Maestro, and the quirks that cost time.
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
