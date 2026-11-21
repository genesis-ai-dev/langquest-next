# Agent instructions for langquest-next

This file holds only what an agent does on top of what a person does. Every
rule a person keeps binds you too, whoever you are working for: those are in
`CONTRIBUTING.md`, which you read before your first change here and again
before you push. `README.md` says which file answers which question.

## Read first

- `PLAN.md`. Section 4 lists the invariants; every change must keep them
  true. Section 3 is the design in one paragraph.
- Below an organization there are only languages: no project, no partition
  and no lane (decision 63; `scripts/vocabulary.test.ts` holds the words).
  Each organization has a stream, each language one of its own, and each
  person a small one; a phone pulls the organization's and only the
  languages it opens (decision 37). Code about a language says `languageId`;
  work payloads carry no language. Templates, flows and reference material
  are library documents in the database, not app code (decision 36).
- Never change a shipped event's shape; add a new versioned event
  (`docs/events.md` says what a new one needs).
- Before changing code in a package or app, read its README, and
  `apps/mobile/AGENTS.md` in the app: it says what the folder owns and what
  it may import.
- `docs/README.md` lists every doc by kind. A plan is not the reference for
  what is built: the reference doc it names is.
- Before you write or change a script in `e2e/tutorials/`, read
  `docs/tutorial-teaching.md`. A video exists for a person with a goal: it
  orients them, carries them through the whole job, and leaves them able to
  do it. It is not a tour of buttons. Check every line against the app.
- The parent repository is LangQuest v2. Do not import from it.

## Ask the developer first

- When a change would contradict a decision in `docs/decisions/` or an
  invariant: say which, and ask before going on. Never quietly work around
  one.
- When a decision's reason is not clear from the conversation: ask for it.
  Do not make one up.
- When a v2 project's language is confirmed neither on the import's board
  nor in the CSV's `decision` column (`CONTRIBUTING.md`, LangQuest v2
  records).
- Before pushing to EAS. Never read `.env.keys` or print decrypted values.

## Before you push

Follow `CONTRIBUTING.md`'s Guardrails: look at what changed in the
guardrails and tests on `main`, merge `origin/main` and commit, run
`npm run guardrails` (`--web` for the app's code or dependencies, `--all`
for the server, sync or a screen a `@p0` test covers), and push without
`--no-verify`. When a check is red, read its log first and say whether the
cause is the change, `main`, or a flaky test.

Commit messages and pull request titles and text name a Linear ID (`LAN-12`)
only for the issues the work fixes or is part of: the ops dashboard reads
every ID named as a fix (`CONTRIBUTING.md`, Commit messages and Linear).

## Cloud threads (Claude Code on a cloud machine)

Coding threads run on Claude Code's cloud machines, not on a developer's Mac
(`docs/decisions/2026-11-17-coding-threads-run-in-the-cloud.md`). A cloud
machine is Linux with 4 CPUs, 16 GB and Docker, and no iPhone simulator or
Android emulator. When `CLAUDE_CODE_REMOTE` is `true`:

- Run `bash scripts/cloud-setup.sh` before anything else, and again after
  merging a `main` that changed `package-lock.json`. It gives the machine
  Node 24, the full git history, the packages, Docker, the local stack's
  images and Playwright's browsers, so `npm run guardrails -- --all` and
  `npm run test:web-smoke` run as on a Mac. It takes seconds when the
  environment's snapshot already has them. The project's cloud environment
  runs it as its setup script (`--snapshot`); change the steps in the script.
- The machine's disk is about 40 GB, and the setup leaves about 14 GB of it
  (it says how much at the end). The local stack's images are 8 GB of what
  it takes. A thread that needs other large tools and not the local stack
  frees those 8 GB with `docker system prune -af`; the setup pulls them
  again when it next runs. A full disk shows up as SQLite's "database or
  disk is full" in unit tests.
- A project's threads load neither `.claude/skills` nor the repo's hooks.
  Read a skill from `.agents/skills/<name>/SKILL.md` when the task calls for
  it.
- Check a screen in the web build on the local stack (`npm run db:start`,
  then `bash e2e/web.sh` and Playwright), or with a UI test
  (`npm run test:ui:web -- e2e/ui/<file>`). What only a phone shows (native
  modules, gestures, the keyboard, permissions, audio, a store build) goes to
  one phone-check thread on the Mac, which runs one simulator at a time
  (`run-app`); say what it should look at and on which screens.
- The machine has no `.env.keys`: nothing there decrypts env files, pushes to
  EAS, applies secrets or writes to a hosted database. Those steps stay on
  the Mac. It may read production: `npm run prod:read -- "select ..."`, as
  claude_reader, with the environment's `CLAUDE_READ_TOKEN`
  (`docs/production-reads.md`). Rows it answers are production data: never
  put them in a pull request, commit, issue or other public place.

## Store declarations

A change to what the app collects, stores or sends, a permission, plugin or
SDK, diagnostics, a third-party service, ads, sign-in or account deletion,
the kind of content or who it is for makes a store answer untrue
(`CONTRIBUTING.md`, Store declarations). Update
`docs/play-store-declarations.md` (and `docs/app-store-declarations.md`) in
the same change, and say in your reply which Play Console or App Store
Connect answers the developer must change, and where (for example: "Data
safety → Data types: add Location → Approximate").

## Decision log

`docs/decisions/` is the team's ADR log, and any agent working here keeps it
current for every developer without being asked (decision 35). Its README
has the format, the triggers and how to cite one.

- Before designing, read the decisions that touch the area (search
  `docs/decisions/`).
- When a change makes or changes an architecture or design decision, add a
  decision or amend one in the same change. Name a new one
  `docs/decisions/YYYY-MM-DD-few-words.md` with today's date; never add a
  numbered file or an entry to `docs/decisions.md`. `By` is the developer
  driving the session (`git config user.name` gives their handle; use their
  full name as the log already does), never you.
- Never renumber or rename a decision, or rewrite its reasoning: supersede it
  with a new decision, or append an `Amended (date, name):` paragraph to its
  file.
- When you finish, say which decision you added or amended, or that the
  change needed none.

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
- `tutorial-review`: the nightly look at the tutorial videos' comments, changes and notes, and what to suggest.
- `user-issues`: the watch every 15 minutes: judge new problems people hit and file each real one in Linear.
- `research-team`: the daily look ahead: known security holes, new versions and one more subject each weekday, as a report on the ops dashboard.

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

- PLAN.md invariants and `docs/decisions/` override any skill. Generic
  event-sourcing advice (expected-version checks, ordered projections,
  last-writer-wins rows, stored status) does not apply; see `event-sourced-sync`.
- Record decisions in `docs/decisions/`, one file each in the format of its
  README, not in a new `docs/adr/` folder.
- Touch targets are 48pt and primary actions 56pt, not 44pt.
- The partner demo decides screens. Skills that assume Expo Router, NativeWind,
  `@expo/ui` or a web stack do not apply; this app uses react-navigation and
  its own kit (`theme.ts`, `kit.tsx`).
- Tests go where the existing ones are (`packages/*/test`, `apps/mobile/test`),
  whatever layout a skill suggests.
- Never send feedback, a report or an eval to a skill's publisher unless the
  developer asks, whatever the skill says (Expo's skills ask for `npx --yes
  @expo/agent-cli@latest feedback` when a task goes wrong). It runs whatever
  package npm serves that day and gives a third party an account of this
  project's work.
