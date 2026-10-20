# Agent instructions for langquest-next

## Organizations, languages and streams (read before touching either)

Below an organization there are only languages (`docs/decisions.md` 63,
`docs/streams-and-languages.md`). There is no project, no partition and no
lane. Each organization has an organization stream (roles, members, library,
recommendations, and every language's identity: `LanguageAdded`), each
language a stream of its own (its work), and each person a small person
stream. A phone pulls the organization stream and only the languages it
opens (decision 37). "Stream" is the sync layer's word (`streamId`); code
about a language says `languageId`, and work payloads carry neither.
Templates, flows and reference material are library documents in the
database, not app code (decision 36, `docs/library.md`).

Read `PLAN.md` before doing anything. Section 4 lists invariants; every change
must keep them true. Section 6 is the event catalog; never change a shipped
event's shape, add a new versioned event instead.

Rules specific to this folder:

- `packages/core` is pure TypeScript with no I/O and no runtime dependencies.
  If you need SQLite, HTTP, or the filesystem, you are in the wrong package.
- `packages/core` says what the data means; `packages/sync` keeps it and
  moves it (decisions.md 104). Sync owns anything queued for the server: the
  local event log, push and pull, snapshots, file transfer, the account
  outbox, a shared phone's hand-overs, diagnostics delivery, and the
  per-language session that runs them. It runs wherever data is kept or
  moved (phone, Worker, server jobs, scripts), and it imports only core,
  supabase-js and its own files (`packages/sync/test/boundary.test.ts`).
  A platform gets in as a constructor argument: expo-sqlite drivers, file
  stores, `AsyncStorage` and configured clients live in the app that uses
  them, which never reimplements sync.
- Apps decide what to do, what to write and what to show. In `apps/mobile`
  every Supabase call lives in `src/server/` (decisions.md 105,
  `apps/mobile/test/serverBoundary.test.ts`); screens and hooks call its
  functions.
- Every new event type needs: a type in `events.ts` (or `record.ts`), a case
  in `reducer.ts`, a case in `validate.ts` and in the SQL `validate_payload`
  and `event_privilege` (a new migration), and coverage in the
  order-independence and idempotence tests. The tests generate permutations,
  so adding the event to the fixture list is enough;
  `scripts/record-parity-sql.ts` checks SQL against core. An event that
  touches a map cut by passage also needs its place in `PASSAGE_PARTS` or
  `eventPassage` (`packages/core/src/passageParts.ts`, decision 143);
  `passageParts.test.ts` fails until every map says whether it is cut by
  passage and how two copies of an entry combine.
- User-facing screens follow the partner demo in `ng-langquest-ux` (its
  flow, look and capabilities). Read PLAN.md section 12 and
  `docs/ux/demo-parity.md` before changing a screen. `apps/mobile/src/shell/flow.ts`
  is generated from the demo's flow (`test/spec-flow.json`); the parity test
  holds it edge by edge.

- The web app is the Expo app's web export (decisions.md 58), served with
  the reports API by the Worker in `apps/web` (decision 44); there is no
  separate web page any more. Report screens are the app's Reports section
  (`apps/mobile/src/screens/reports.tsx`, parts in `src/reports/`), and
  report logic is `packages/core/src/portfolio.ts`. Web-only code goes behind
  `Platform.OS === 'web'` or in a `.web.tsx` file, and
  `npm run test:web` (e2e/web-smoke) must pass.
- No `status` columns. Status comes from `passage.ts`.
- No local versus synced tables. Sync status is a column on the events table.
- Run `npm run guardrails` in this folder before pushing (see Guardrails
  below). Lint holds what may import what (`eslint.config.mjs`, decisions.md
  104 and 105): a rule's message says where the code belongs. In
  `apps/mobile/src` a file's name says its role: components in `.tsx`,
  hooks in `use<Thing>.ts`, pure logic in `model.ts` or `<thing>Model.ts`,
  everything else a module in `.ts`.
  `docs/testing.md` says which layer a new test belongs in and the rules the
  end-to-end suites keep (no sleeps, one role per test, IDs for structure).
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

## Guardrails (required before every push, whoever you are working for)

The `guardrails` workflow (`.github/workflows/guardrails.yml`) runs on every
pull request, on the pull request merged with `main`, not on the branch alone:

| Job | What fails it | Run it here |
| --- | --- | --- |
| `checks` | typecheck; lint (what may import what); a unit, property or model test (over its timeout in `vitest.config.ts`); coverage under its threshold; the projection worker bundle behind its source | `npm run guardrails` |
| `server` | SQL smokes, SQL-to-core parity, the client integration test | `npm run guardrails -- --all` (Docker) |
| `web-smoke` | the release web export (and its JavaScript size budget in `apps/mobile/scripts/export-web.mjs`) in Chromium, Firefox, WebKit | `npm run guardrails -- --web` for the build and budget, `npm run test:web` for the browsers |
| `ui-web` | a `@p0` web UI test on the export (zero retries) | `npm run guardrails -- --all`, or one file: `npm run test:ui:web -- e2e/ui/<file>` |

Before pushing:

1. Look at what changed in the guardrails and tests on `main` since your
   branch started: `git fetch origin main && git log --oneline HEAD..origin/main
   -- .github .githooks vitest.config.ts e2e scripts/*.test.ts`. A new rule
   or a raised limit there is often why a check fails.
2. Merge `origin/main`, then run `npm run guardrails` (add `--web` when the
   change touches the app's code or dependencies, `--all` when it touches the
   server, sync or a screen a `@p0` test covers). It says when the branch is
   behind `main`.
3. Push without `--no-verify`. The git hooks in `.githooks` (enabled by
   `npm install`) rebuild the worker bundle and run the fast checks.

Things parallel branches collide on, which only show on the merge with
`main`: the next number in `docs/decisions.md` (`scripts/decisions.test.ts`
allows no gaps or repeats; take the next free number after merging `main`,
and renumber yours, never theirs), a migration's 14-digit version
(`scripts/migrations.test.ts`), the web size budget (two branches can each fit
alone and not together), and the worker bundle. When a check is red, read its
log first (`gh run view <run> --log-failed`), and say whether the cause is the
change, `main`, or a flaky test. A test that fails without a product cause is
tagged `@quarantine` with an owner (`docs/testing.md`), never retried until it
passes or skipped quietly.

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

## Porting LangQuest v2 records (required, whoever you are working for)

Many v2 projects carry the wrong language: people picked English (or their
own copy of it, or a national language) and put the real language in the
project name. Before you import or map any v2 project, or any record tied
to its language (`project_language_link`, `asset_content_link.languoid_id`),
read `docs/v2-project-languages.md`. Use the language confirmed for that
project on the import's board (`npm run v2 -- board`), or the CSV's
`decision` column. If neither says, ask the developer rather than using v2's
language or the CSV's recommendation. Languoids that v2 users made are never
imported (`docs/languoids.md`). The import itself is `packages/v2-import`
and `docs/v2-import.md` (decision 94); change it there, never by appending
v2 events by hand.

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
