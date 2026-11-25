# Claude's agent teams read everything the read-only keys reach, except personal data

Date: 2026-11-24 · By: Caleb Koster · Status: accepted

Reason: Caleb asked (2026-11-24) what else the agents need to find the root
cause of a problem, besides the production database and the Cloudflare
logs, and said: "I don't want their read-only access restricted in any way
(except when accessing using PII)". Until then the agent teams read less
than a cloud thread by design: ids, counts, times and codes in the
database, a Worker's warnings and errors only, and two grouped Supabase
queries
(`docs/decisions/2026-11-21-claude-reads-production-through-a-gate.md`,
`docs/decisions/2026-11-22-claude-reads-logs-through-the-read-gate.md`).
Their answers to cards came back with "a developer's cloud thread can read
the rest". Chosen (`docs/production-reads.md`):
- **Personal data is the only line.** A person's name, email, phone
  number, IP address, picture, voice and screenshot. Secrets stay hidden
  from every login as before.
- **agent_reader reads every table claude_reader reads**, but the columns
  with personal data (migration
  `20261124223000_agent_reader_all_but_personal.sql`). What a person typed
  (event payloads, help-mode feedback, join requests, content reports)
  comes through the views of schema `masked`, with emails, phone numbers and
  IP addresses taken out; the base columns stay closed to it. Both logins
  get `pg_read_all_stats` for slow statements and locks.
- **Every log at every level, any Supabase log query**, for both logins.
  agent_reader's lines still go through `redact`.
- **The provider APIs the admin Worker already holds read-only keys for**
  (`apps/admin/src/logsApis.ts`): Cloudflare's analytics and account API,
  GitHub's API for the repository, Expo's GraphQL, App Store Connect,
  Google Play's reporting and reviews, and the stored files' sizes and
  times through the app Worker's read-only JobStatus entrypoint. Only a GET
  or a GraphQL query, never a mutation. Personal fields and text are taken
  out for both logins, and App Store Connect's lists of people are refused.
  No new key: each is the ops dashboard's own.

The risk Caleb chose to take: the repository is public, so an agent team's
output is too, and it reads what strangers write. A stranger's text could
lead it to look up partners' work (not people) and repeat it in a public
place. Prompts still say never to copy a row or a log line into what it
writes. A cloud thread still reads names, as before.

Reverse if: an agent team's public output shows a partner's words or a
person's data; a masked view leaves a kind of personal data in (add it to
`masked.personal` or close the column); or a provider key turns out to be
able to write, when the source goes until a read-only key replaces it.

Amended (2026-11-24, Caleb Koster): the hosted project would not let
postgres grant `pg_read_all_stats`, so both logins read slow statements and
waits through `masked.slow_statements` and `masked.connections`, functions
that run as postgres (migration `20261124231500_masked_statistics.sql`).

Amended (2026-11-24, Caleb Koster): Caleb chose to turn on App Store
crash reports from people's iPhones. `scripts/app-store-analytics-request.mjs`
makes the one ongoing analytics report request with his Admin key, on the
Mac, the only write in this design; the log gate's `app-store-report` then
reads the reports with the read key.
