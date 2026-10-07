# langquest-next

Oral Bible translation, rebuilt on an append-only event log. Read
[PLAN.md](PLAN.md) first; it is the source of truth for the design.

## Local development

Requires Docker via colima (`colima start`) and Node 24 (npm 11, which the lockfile is written with; CI uses the same).

```bash
npm install
npm run db:start      # local Supabase on http://127.0.0.1:54421, Postgres on 54422
npm run dev:local     # or: db:start, then the web Worker on :8787 (Reports) until Ctrl-C
npm test              # core + client unit tests (integration test skips if db is down)
npm run db:test       # applies migrations to a fresh db and exercises the append/pull RPCs
npm run test:integration  # two real users syncing through local Supabase
npm run db:stop
```

Mobile app: see `apps/mobile/README.md`.

This repo is never linked to a hosted Supabase project. `supabase link` is
not used here; do not run it against the LangQuest v2 projects.
