# Claude reads build and server logs through the read gate, with the ops dashboard's tokens

Date: 2026-11-22 · By: Caleb Koster · Status: accepted

Reason: Caleb asked (2026-11-22) how to give the agents read-only access
to the Cloudflare build logs, and to the other logs they need to find why
something failed. The agent team could not read the log of the failed
Workers Build of the web app (2026-11-19) and wrote no fix. Chosen
(`docs/production-reads.md`, Logs):
- **The read gate hands out logs too** (`POST /ops/api/read/logs`,
  `apps/admin/src/logs.ts`), not a provider key in GitHub's secrets or the
  cloud environment. The admin Worker already holds a read token for each
  provider (Cloudflare, Supabase, EAS, GitHub) for the ops dashboard, and
  the gate already knows who asks: CLAUDE_READ_TOKEN, or an agent team's
  GitHub OIDC token (`docs/decisions/2026-11-21-claude-reads-production-through-a-gate.md`).
  The repository is public and the agent teams read what strangers write,
  so a key in their jobs could be led out; through the gate they never hold
  one. A cloud thread's network secret for `/ops/api/read` covers the new
  path, so Caleb adds nothing there.
- **agent_reader gets less**, by the same rule: build logs whole (code and
  the build's own output); a Worker's warnings and errors only, with emails,
  tokens, long values and phone numbers taken out; Supabase only as the
  dashboard's grouped codes and counts.
- **Workers Logs take a token of their own**
  (`ADMIN_CLOUDFLARE_LOGS_TOKEN`): Cloudflare offers only Workers
  Observability Edit for a logs query, so ADMIN_CLOUDFLARE_TOKEN stays
  read-only and the Worker only queries with the new one.

Reverse if: Cloudflare offers a read-only logs permission (then fold the
token into ADMIN_CLOUDFLARE_TOKEN); a log line with a person's data shows up
in an agent team's public output; or the providers' own MCP servers give a
read-only path the agent teams can use without a stored key.

Amended (2026-11-23, Caleb Koster): Cloudflare replaced its Workers
Observability permissions with Workers roles. The logs query takes a token
with the Workers role Metadata Read-Only, tested on production on
2026-11-23, so `ADMIN_CLOUDFLARE_LOGS_TOKEN` is read-only too; it stays a
token of its own.

Amended (2026-11-24, Caleb Koster): agent_reader reads every log at every
level and any Supabase log query, still through `redact`, and both logins
read the provider APIs the Worker holds keys for
(`docs/decisions/2026-11-24-agents-read-everything-but-personal-data.md`).
