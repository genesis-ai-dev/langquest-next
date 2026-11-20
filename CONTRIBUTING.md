# Contributing

How a change gets into `main`, and the rules every contributor keeps,
person or agent. Running the app and the layout of the repository are in
`README.md`; the design every change keeps is `PLAN.md`; what an agent does
on top of this is `AGENTS.md`.

## Where code goes

Each package and app says in its README what it owns and what it may import:
`packages/core` (what the data means, pure TypeScript), `packages/sync`
(keeping it and moving it), `packages/v2-import`, `apps/mobile` (and its
`AGENTS.md`), `apps/web`, `server`. Lint holds what may import what
(`eslint.config.mjs`, decisions.md 104 and 105), and a rule's message says
where the code belongs.

- Templates, flows and reference material are library documents in the
  database, not app code (decision 36, `docs/library.md`).
- An event's shape never changes once shipped; `docs/events.md` says what a
  new one needs.
- `docs/testing.md` says which layer a new test belongs in, and the rules the
  end-to-end suites keep (no sleeps, one role per test, IDs for structure).
- A root npm script gets a line in its group in `scripts/commands.mjs`
  (`npm run help`) and the same place in `package.json`;
  `scripts/commands.test.ts` fails until it has both.

## Guardrails

The `guardrails` workflow (`.github/workflows/guardrails.yml`) runs on every
pull request, on the pull request merged with `main`, not on the branch alone.
A pull request runs the jobs that its changed files need (`scope`,
`scripts/ci-scope.mjs`), and is merged into `main` only when the `gate` job
says that every needed job passed, on the pull request and again in the
merge queue (main with the pull requests ahead of it); `main` takes no
direct push (`.github/rulesets/main.json`, decisions.md 150). The queue runs
no job when `main` has not moved since the pull request's green run of the
last hour, and the push to `main` runs none for the commit the queue passed
(`scripts/ci-tested.mjs`, decisions.md 164). `node scripts/ci-scope.mjs
<file>...` says which jobs some files would run:

| Job | What fails it | Run it here |
| --- | --- | --- |
| `checks` | typecheck; lint (what may import what); a server call that a supported store build makes and this change takes away (`npm run server-calls`, decisions.md 151); the push delivery bundle behind its source | `npm run guardrails` |
| `unit`, `coverage` | a unit, property or model test (over its timeout in `vitest.config.ts`), in three shards (`scripts/unit-shards.ts`); coverage under its threshold, on the shards merged | `npm run guardrails` |
| `server` | SQL smokes, SQL-to-core parity, the client integration test | `npm run guardrails -- --all` (Docker) |
| `web-smoke` | the release web export (and its JavaScript size budget in `apps/mobile/scripts/export-web.mjs`) in Chromium, Firefox, WebKit | `npm run guardrails -- --web` for the build and budget, `npm run test:web-smoke` for the browsers |
| `ui-web` | a `@p0` web UI test on the export (zero retries) | `npm run guardrails -- --all`, or one file: `npm run test:ui:web -- e2e/ui/<file>` |
| `android-native` | the nearby module's Kotlin (`apps/mobile/modules/nearby-link`) in the project `expo prebuild` makes: compile, its JUnit tests (the golden vectors) or Android lint; only when the module, `apps/mobile/package.json` or the root lockfile changes (decisions.md 150, 234) | Not on a machine without a JDK 17 and the Android SDK, which `npm run guardrails` does not need, so mostly CI only. With them: `npx expo prebuild -p android --no-install` in `apps/mobile`, then `./gradlew :nearby-link:compileReleaseKotlin :nearby-link:testDebugUnitTest :nearby-link:lintDebug` in `apps/mobile/android` |
| `ios-native` | the nearby module's Swift (`apps/mobile/modules/nearby-link/ios`): its Swift package's tests (the golden vectors) or the iPhone app's simulator build on a Mac; only when the module's Swift or what both halves share, `apps/mobile/package.json` or the root lockfile changes (decisions.md 150, 256) | CI only on a machine with no Mac. On a Mac: `swift test` in `apps/mobile/modules/nearby-link/ios`, then `node scripts/maestro-build.mjs --platform ios --build-only` |

A new job gets its row here.

### Before pushing

1. Look at what changed in the guardrails and tests on `main` since your
   branch started: `git fetch origin main && git log --oneline HEAD..origin/main
   -- .github .githooks vitest.config.ts e2e scripts/*.test.ts`. A new rule
   or a raised limit there is often why a check fails.
2. Merge `origin/main` and commit, then run `npm run guardrails` (add `--web`
   when the change touches the app's code or dependencies, `--all` when it
   touches the server, sync or a screen a `@p0` test covers). It says when
   the branch is behind `main`.
3. Push without `--no-verify`. The git hooks in `.githooks` (enabled by
   `npm install`) rebuild the worker bundle and run the fast checks. When
   step 2 passed with nothing uncommitted or untracked and the push sends
   that commit's files, the pre-push hook says so and does not run them
   again (`scripts/guardrails-passed.mjs`); commit after step 2 and it runs
   them.

### When branches collide, or a check is red

Things parallel branches collide on, which only show on the merge with
`main`: a migration's 14-digit version (`scripts/migrations.test.ts`), the
web size budget (two branches can each fit alone and not together), and the
worker bundle. Decisions do not collide: each new one is a file of its own,
named by its date (`docs/decisions/README.md`).

When a check is red, read its log first (`gh run view <run> --log-failed`),
and find whether the cause is the change, `main`, or a flaky test. A test
that fails without a product cause is tagged `@quarantine` with an owner
(`docs/testing.md`), never retried until it passes or skipped quietly.

## Commit messages and Linear

Put the Linear issue ID (`LAN-12`) in the commit message of work that comes
from an issue. The pipeline moves that issue to Deploying, then Live or
Outage (`scripts/linear-sync.mjs`, decisions.md 53). No ID, no status change.
Name there, and in the pull request's title and text, only the issues the
work fixes or is part of: the ops dashboard shows a pull request as the fix
for every `LAN-` id it names (`apps/admin/src/sources/fixes.ts`).

## Secrets and hosted settings

Secrets are committed encrypted with dotenvx in the root `.env.<env>`;
public settings are plain (`docs/environments.md`). Change either with
`npm run env:update -- <env> KEY`, never by hand or in a dashboard, and apply
secrets with `npm run secrets -- <env>`. Hosted settings live in repo files,
not dashboards (the `infrastructure-as-code` skill).

## Store declarations

`docs/play-store-declarations.md` records every answer given to Google Play
for this app: data safety, content rating, target audience, permissions, app
access, the store listing; `docs/app-store-declarations.md` does the same for
Apple. The stores hold us to those answers (decision 49).

- A change that alters any of these makes an answer untrue: what the app
  collects, stores or sends; an Android permission or Expo plugin; an SDK in
  `apps/mobile`; diagnostics; a third-party service; ads; sign-in or account
  deletion; the kind of content it shows; who it is for.
- Such a change updates that file in the same change, and says which store
  answers the developer must change, and where (for example: "Data safety →
  Data types: add Location → Approximate").
- `scripts/playDeclarations.test.ts` catches the mechanical cases
  (permissions, plugins, mobile dependencies, the diagnostics allowlist); the
  rest rely on the person or agent making the change. Never update its facts
  block without checking the Play Console answers it stands for.

## Decisions

`docs/decisions/` is the ADR log, one file per decision; its README says
when to write one, how to name it and how to cite one. A decision lands in
the same pull request as the change it explains, with the developer who made
it in `By`. Before designing, read the decisions that touch the area; a
change that contradicts one says so before going on, and supersedes or
amends it rather than working around it.

## Docs

Each fact has one home, and everything else links to it (`README.md` says
which file answers which question).

- Every doc in `docs/` says its kind on the line under its title: `Kind:
  reference` (how a part works now), `plan` (what is next, with a `Status`),
  `report` (a dated audit or measure, not kept current) or `history` (kept
  for its reasoning). `docs/README.md` lists every doc by kind, and
  `scripts/docs.test.ts` holds both.
- A reference doc changes in the same pull request as the code it describes.
  It is edited in place: it carries no dated amendments, since the history
  of a change is in `docs/decisions/` and git.
- A plan's `Status` is `draft`, `accepted`, `in progress`, `built` or
  `dropped`. The pull request that merges a phase updates that line, and
  moves how the built part works into its reference doc, which the plan
  names. A plan is never the reference for what is built.
- A report keeps the date it was measured and is not updated; a new measure
  is a new report.

## LangQuest v2 records

Many v2 projects carry the wrong language: people picked English (or their
own copy of it, or a national language) and put the real language in the
project name. Before importing or mapping any v2 project, or any record tied
to its language (`project_language_link`, `asset_content_link.languoid_id`),
read `docs/v2-project-languages.md`. Use the language confirmed for that
project on the import's board (`npm run v2 -- board`), or the CSV's
`decision` column; if neither says, ask the developer rather than using v2's
language or the CSV's recommendation. Languoids that v2 users made are never
imported (`docs/languoids.md`). The import itself is `packages/v2-import` and
`docs/v2-import.md` (decision 94); change it there, never by appending v2
events by hand. The parent repository is LangQuest v2: nothing here imports
from it, since its data model is what this app replaces (PLAN.md section 2).
