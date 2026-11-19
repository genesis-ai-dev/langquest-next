# langquest-next

Oral Bible translation, rebuilt on an append-only event log. Teams record
audio translations passage by passage, often offline for a month or more,
and sync when they reach a connection. Read [PLAN.md](PLAN.md) first; it is
the source of truth for the design.

## Where things are written down

Each fact has one home; everything else links to it.

| Question | Where |
| --- | --- |
| What must always be true, and why the app is shaped this way | [PLAN.md](PLAN.md) |
| How a part works now, what is planned, what was measured | [docs/](docs/README.md), every doc listed by kind |
| Why each choice was made, by whom, and what would reverse it | [docs/decisions/](docs/decisions/README.md) |
| How a change gets into `main`: guardrails, commit messages, the rules every contributor keeps | [CONTRIBUTING.md](CONTRIBUTING.md) |
| What an agent does differently from a person | [AGENTS.md](AGENTS.md) (`CLAUDE.md` imports it) |
| A package's or app's own rules | its README, and `apps/mobile/AGENTS.md` |

## Local development

Requires Docker via colima (`colima start`) and the Node in `.node-version` (24, with the npm 11 it ships, which writes the lockfile). CI, EAS, Cloudflare and the job image use the same version (decisions.md 247); fnm reads that file.

```bash
npm install
npm run db:start      # local Supabase on http://127.0.0.1:54421, Postgres on 54422
npm run dev           # or: db:start, then the web Worker on :8787 (Reports, the projection pass) until Ctrl-C
npm test              # core + client unit tests (integration test skips if db is down)
npm run db:test       # applies migrations to a fresh db and exercises the append/pull RPCs
npm run test:integration  # two real users syncing through local Supabase
npm run db:stop
```

`npm run help` lists every script by group, with what each is for
(`npm run help -- deploy` narrows it).

Mobile app: see `apps/mobile/README.md`.

A checkout may be linked to one of this app's own hosted Supabase projects
(`npx supabase link --project-ref <ref>`, with the refs under `[remotes.*]` in
`supabase/config.toml` and `docs/environments.md`): `npm run db:apply`,
`db:check`, `secrets` and the staff scripts' `--hosted` need it. Never link
it to a LangQuest v2 project; `scripts/v2-access.sh` reads v2 through a
throwaway working directory, so the checkout's own link is untouched.

## Repository layout

```
packages/core/       what the data means: events, reducer, validation, derivations; pure TypeScript
packages/sync/       keeps it and moves it: the local log, push and pull, snapshots, files (decision 104)
packages/v2-import/  brings LangQuest v2 in, one way, and keeps it coming (decision 94)
apps/mobile/         the Expo app: iOS, Android, and the web export (decision 58)
apps/web/            the Worker that serves the web export, the reports API and files (decisions 44, 69)
apps/admin/          the Worker behind the staff ops dashboard (decision 160, docs/admin.md)
apps/invite-email/   the Worker that sends invitation emails
server/              server jobs and the SQL smoke tests (server/README.md)
supabase/            migrations, Edge Functions and config.toml
library/             what the LangQuest organization publishes (library/README.md)
e2e/                 browser tests and the tutorial videos (e2e/README.md)
eval/                evaluations, such as key terms
scripts/             what the npm scripts run (`npm run help`)
docs/                how each part works, plans, reports, decisions (docs/README.md)
```
