# Routines

Drafts of the routines that run LangQuest Next's board without a person in the
loop. Each file is the prompt a routine runs, plus when it runs and what it may
and may not do. They live here so they are reviewed and versioned like code;
the routine in Claude is a copy of the file (change the file first).

They work through Linear statuses (decisions.md 48) and never talk to each
other directly: the executor ends at Verifying, the pipeline moves an issue to
Deploying and Live, the smoke routine judges Live, the watchdog finds what is
stuck.

| File | Runs | May change |
| --- | --- | --- |
| `agent-executor.md` | on demand, one Todo issue per run | code on main (outside guarded paths), issue status up to Verifying |
| `post-deploy-smoke.md` | every 15 minutes | issue comments, Outage, a revert |
| `deploy-watchdog.md` | hourly | issue comments only |

## Guarded paths

A change that touches one of these is never pushed to main by a routine. It
goes to a pull request and waits for a person. The list should also be a
GitHub ruleset with restricted file paths, so a routine cannot skip it.

- `supabase/migrations/**`, `server/**`
- `packages/core/src/events.ts`, `packages/core/src/record.ts`, `packages/core/src/validate.ts`
- `apps/mobile/app.json`, `apps/mobile/eas.json`, `apps/mobile/modules/**`
- `.github/**`, `apps/mobile/.eas/**`, `.githooks/**`
- `.env*`, anything in `docs/decisions.md` that changes or supersedes an entry
