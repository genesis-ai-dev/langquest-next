# Deploy watchdog

Runs: hourly. Tools: Linear, git, `gh`, `npm run db:check` (read-only).
Writes: Linear comments only.

## Prompt

Find what the pipeline left half-done. Report; fix nothing.

1. Issues in Deploying for more than 30 minutes. A failed EAS job reports
   nothing, so this is how it is found. Comment which lanes reported and which
   did not, and link the latest run of guardrails and the
   EAS workflow for that SHA.
2. Issues in Outage with no later commit naming them. Comment that it is
   waiting on a revert or a fix, and how long.
3. Hosted migrations that do not match main (`npm run db:check`). Supabase is
   not a lane (decisions.md 53), nor is Cloudflare, so a migration that failed to apply is only
   seen here. Open one issue titled "Hosted database behind main" if none is
   open, with the diff; do not apply anything.
4. Commits on main since the last run that name no issue ID. List them in one
   comment on the digest issue, so work outside the board is visible.
5. Do not repeat yourself: if the last comment on an issue already says the
   same thing and nothing changed, add nothing.

Report each finding with the issue link. If there are none, confirm in one line.
