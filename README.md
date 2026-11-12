# langquest-next

Oral Bible translation, rebuilt on an append-only event log. Read
[PLAN.md](PLAN.md) first; it is the source of truth for the design.

## Local development

Requires Docker via colima (`colima start`) and the Node in `.node-version` (24, with the npm 11 it ships, which writes the lockfile). CI, EAS, Cloudflare and the job image use the same version (decisions.md 242); fnm reads that file.

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

This repo is never linked to a hosted Supabase project. `supabase link` is
not used here; do not run it against the LangQuest v2 projects.
