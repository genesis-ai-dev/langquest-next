# Claude reads the production database through a read gate, as one of two logins the database holds to reading

Date: 2026-11-21 · By: Caleb Koster · Status: accepted

Reason: Caleb asked (2026-11-21) that Claude's cloud threads and the agent
teams may run read-only queries on the production database, held to reading
by the database itself, "not just using a sentence instruction to Claude".
Until then a cloud thread had no production key
(`docs/decisions/2026-11-17-coding-threads-run-in-the-cloud.md`), and the
agent teams saw only what the watch's API handed them. Chosen
(`docs/production-reads.md`):
- **Two logins**, migration `20261121194800_claude_readers.sql`:
  claude_reader reads everything but secrets and emails; agent_reader reads
  ids, counts, times and codes (decision 39's rule) and the event log
  without its payload. Neither has a grant to write; each is read-only by
  default with a 15 s limit. Caleb chose the smaller view for the agent
  teams: the repository is public, so their logs are, and they read what
  strangers write, which could ask Claude to look up private data and post
  it.
- **A read gate on the admin Worker** (`apps/admin/src/read.ts`), not a
  connection string in each place: a cloud machine reaches only web
  addresses through its proxy, so it cannot open a Postgres connection
  (tested 2026-11-18); the agent teams need no stored key, since GitHub's
  OIDC token proves the workflow and its branch (decision 186); and one
  Worker secret stops every token at once. The admin Worker already holds
  the read-only diag_reader login through Hyperdrive and no writer's key
  (decisions 160 and 162); each new login has a Hyperdrive config of its
  own. The gate's answers are not the ops dashboard, so decision 160's
  content rule binds agent_reader, not claude_reader.
- **CLAUDE_READ_TOKEN as a network secret** of the cloud environment on
  claude.ai, for `app.langquest.org`: the proxy adds it to the thread's
  requests, so no thread holds it or can print it. A variable only where
  network secrets are not offered. The Worker keeps its SHA-256.

Reverse if: a key leaks or the log shows a statement no thread or team
asked for; a heavy read slows the app for people; or Supabase gives a way to
reach the database from the cloud machines that holds a login to reading
as well, without a Worker between.

Amended (2026-11-23, Caleb Koster): claude_reader and agent_reader may hold 5
connections, not 3 (migration `20261123175000_reader_connection_limit.sql`).
Hyperdrive keeps at least 5 connections for each config, and
`npm run secrets -- production` set each read config to 5 on 2026-11-23.
Postgres then refused connections past 3 ("too many connections for role
claude_reader"), and every read through the gate timed out.

Amended (2026-11-24, Caleb Koster): agent_reader no longer gets the smaller
view. It reads every table claude_reader reads except personal data, and
what people typed through the masked views
(`docs/decisions/2026-11-24-agents-read-everything-but-personal-data.md`).
