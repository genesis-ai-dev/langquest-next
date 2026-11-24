# Production reads for Claude

Kind: reference

Claude's cloud threads, the agent teams in GitHub Actions and a developer's
laptop can run read-only SQL on the production database. The database holds
them to reading, not an instruction to Claude
(`docs/decisions/2026-11-21-claude-reads-production-through-a-gate.md`).

```
cloud thread ── CLAUDE_READ_TOKEN ─┐
laptop ──────── CLAUDE_READ_TOKEN ─┼─► read gate ──► claude_reader ─┐
agent team ──── GitHub OIDC token ─┘   app.langquest.org      agent_reader ─┴─► production database
                                       /ops/api/read
```

## The two logins

Migration `20261121194800_claude_readers.sql` makes them;
`server/claudeReadersSmoke.sql` holds what follows.

| | claude_reader | agent_reader |
|---|---|---|
| Who | cloud threads, a laptop | the agent teams (`user-issues.yml` and `card-questions.yml` on main) |
| Reads | `public`, `diag`, `ops`, `v2_import` | `diag`'s tables of ids, counts, times and codes; `public.events` without `payload` |
| Never | sign-in codes, password resets, push tokens, webhook secrets, API and invite token hashes, discovery keys, emails; `auth`, `storage`, `vault` | the above, and names, typed text, recordings, `diag.feedback`, every report function |
| Writes | nothing: no grant to insert, update, delete or truncate anywhere | nothing |

Both: every transaction is read-only unless the session turns that off, each
statement stops after 15 s, 5 connections at most (the least Hyperdrive keeps for a config), and BYPASSRLS, because
row level security is written for app users and these logins are none. A
table made later is readable by claude_reader; a migration that adds a
secret column revokes it there, and the smoke test fails on a readable column
whose name looks like a secret or an email until it does.

The agent teams get less because their logs are public (the repository is)
and they read what strangers write: a stranger's text could ask Claude to
look up private data and put it in a public place.

## The read gate

`POST /ops/api/read` on the admin Worker (`apps/admin/src/read.ts`), reached
as `https://app.langquest.org/ops/api/read` through the app Worker's ops
paths. Body: `{"sql": "select ...", "params": [...]}`. Answer:
`{login, columns, rows, truncated, ms}`, or `{error}` with Postgres's
message.

- **Who**: a bearer token. `CLAUDE_READ_TOKEN` reads as claude_reader; the
  Worker keeps only its SHA-256 (`CLAUDE_READ_TOKEN_SHA256`). A GitHub OIDC
  token for the audience `https://app.langquest.org/ops/api/read`, from a
  workflow in `READ_WORKFLOWS` run from main, reads as agent_reader. A fork,
  a branch or a pull request's run gets a token that names itself, and is
  refused.
- **What**: one statement that starts with `select`, `with`, `explain`,
  `values`, `table` or `show`, and no `set_config`. The extended protocol
  takes one statement only.
- **How**: each statement over its own connection, in a read-only
  transaction with a 15 s limit set before it runs, so it cannot change
  either. At most 1,000 rows come back (`truncated` says so); 60 statements
  a minute for each login.
- **Log**: one line for each statement in the Worker's logs (Cloudflare,
  observability): the login, who (the token, or the workflow and its run),
  the outcome, the rows, the time and the first 500 characters of the SQL.
- **Logins**: each in a Hyperdrive config of its own (`READ_CLAUDE`,
  `READ_AGENT`), as diag_reader's is (decision 160): a Worker cannot open TLS
  to Supabase itself. Without one the gate answers 503.

## Using it

```
npm run prod:read -- "select type, count(*) from public.events group by 1 order by 2 desc"
npm run prod:read -- "select * from diag.records where install_id = \$1 order by at desc limit 20" <install id>
npm run prod:read -- --json "select ..."
```

`scripts/prod-read.mjs` sends `CLAUDE_READ_TOKEN` when it is set, or the
job's OIDC token in GitHub Actions. In a cloud thread whose environment keeps
the token as a network secret, it sends a stand-in that the proxy replaces
with the token, so the thread never holds the token. The agent teams run a copy made before Claude starts,
`/home/runner/work/_temp/watch/prod-read.mjs`, the one command their Claude
may run besides git; Claude cannot change that copy, which asks only for the
gate's audience.

### Where answers go

An answer is production data. It stays in the thread or the job that asked.
Never paste rows into a pull request, a commit, a GitHub issue or comment, a
Linear issue, or anything else that is public or shared. Say what was found
in words: "12 phones on build 61 failed the download", not the rows.

### The fix team's reads

`claude-code-action` removes the job's OIDC request variables from Claude's
shell, so the issue manager cannot run `prod-read.mjs` during its run. Its
plan names the reads instead (`fix.json` `next.reads`: at most 6 `select` or
`with` statements, or logs as `--logs <source> name=value ...`). The watch keeps them with the plan
(`ops.user_issue_plans.reads`). At the next try, the step `fix-context` runs
them through the gate, as agent_reader, before Claude starts, and writes the
answers to `.user-issues/reads.json` (at most 200 rows each). The job log
says only how many answered. The file is outside the change, so it never
goes into a pull request
(`docs/decisions/2026-11-23-the-fix-team-reads-production-before-claude-starts.md`).

## Logs

`POST /ops/api/read/logs` on the same Worker (`apps/admin/src/logs.ts`)
hands out the logs Claude needs to find why something failed. The same
tokens get in, as the same two logins. The Worker reads each log with the
provider token it already holds for the ops dashboard (`docs/admin.md`), so
no provider key goes to a cloud thread or to GitHub.

```
npm run prod:read -- --logs                      lists the sources
npm run prod:read -- --logs worker-builds worker=langquest-next
npm run prod:read -- --logs worker-build-log build=<build id>
npm run prod:read -- --logs worker-logs worker=langquest-next minutes=120 level=error search=E-7K2Q
npm run prod:read -- --logs supabase-logs query=postgres-errors
npm run prod:read -- --logs supabase-logs sql="select timestamp, event_message from logs where source = 'function_logs' order by timestamp desc limit 50"
npm run prod:read -- --logs eas-builds
npm run prod:read -- --logs eas-build-log build=<build id>
npm run prod:read -- --logs github-job-log job=<job id>
```

| Source | What | Worker key | claude_reader | agent_reader |
|---|---|---|---|---|
| `worker-builds`, `worker-build-log` | Workers Builds: the build that deploys each Worker on a merge to main, and its log | `ADMIN_CLOUDFLARE_TOKEN` (Workers CI Read) | whole | whole: a build prints code and its own output |
| `worker-logs` | a Worker's own log lines (Workers Logs), the last 24 hours at most | `ADMIN_CLOUDFLARE_LOGS_TOKEN` (Workers role Metadata Read-Only) | every level, whole lines | warn and error only; emails, tokens, long values, phone numbers and query strings taken out (`redact`) |
| `supabase-logs` | Supabase's logs (Logs Explorer SQL) | `ADMIN_SUPABASE_TOKEN` (Logs Read) | any query | only `postgres-errors` and `http-errors`: the ops dashboard's groups, codes and counts, never a message |
| `eas-builds`, `eas-build-log` | the phone app's EAS builds and a build's log | `ADMIN_EXPO_TOKEN` (robot, Viewer) | whole | whole |
| `github-job-log` | a GitHub Actions job's log in this repository | `ADMIN_GITHUB_TOKEN` (Actions Read) | whole | whole: the repository is public |

An answer holds the newest 2,000 lines at most. Each read is a line in the
Worker's log, as a statement is. The rate limit is the read gate's, counted
apart. Log lines are production data too: "Where answers go" below holds.

Every key the Worker reads logs with is read-only. Workers Logs take a token
of their own with the Workers role Metadata Read-Only, so the dashboard's
token keeps its own few grants.

Not here yet: App Store Connect and Google Play crash reports (the ops
dashboard shows them), and langquest.org on Vercel, whose tokens cannot be
made read-only.

## Where each key lives

| Key | Where | Who can read it | Rotate |
|---|---|---|---|
| `CLAUDE_READ_TOKEN` | the cloud environment's network secrets on claude.ai, for `app.langquest.org` | the account owner; a Claude thread sends it through the proxy and never sees it | steps below |
| `CLAUDE_READ_TOKEN` | `.env.production`, encrypted | a computer with `.env.keys` | steps below |
| its SHA-256 | admin Worker secret `CLAUDE_READ_TOKEN_SHA256` | nobody: Cloudflare does not show a secret again | `npm run secrets -- production` |
| claude_reader's and agent_reader's passwords | `.env.production`, encrypted, and the Hyperdrive configs | a computer with `.env.keys`; Cloudflare does not show a config's login | steps below |
| the agent teams' OIDC token | nowhere: GitHub makes one for each job, for about 5 minutes | the job | nothing to rotate |

## Setup, and rotating

On the Mac, with the migration on the hosted database:

1. Run `scripts/claude-read-access.sh`. It gives both logins a new
   password, makes a new `CLAUDE_READ_TOKEN`, keeps all three encrypted in
   `.env.production` and commits that file. The token goes to the
   clipboard; nothing is printed.
2. Run `npm run secrets -- production`. It makes or updates the two
   Hyperdrive configs, writes their ids in `apps/admin/wrangler.jsonc`, and
   sets `CLAUDE_READ_TOKEN_SHA256` on the admin Worker.
3. Commit `apps/admin/wrangler.jsonc` and `.env.production`, and merge them.
   The admin Worker deploys with the new bindings.
4. Paste the token in the project's cloud environment on claude.ai
   (Project settings, then the cloud environment, then its gear), in place
   of the old one: under Network secrets for the host `app.langquest.org`,
   as the bearer token of the `Authorization` header. Where the app offers
   no network secrets, add it as the variable `CLAUDE_READ_TOKEN` instead;
   then every thread in the environment can read it. A new thread picks it
   up.

Running the steps again rotates everything. The old token stops when step 2
sets the new SHA-256; the old passwords stop at step 1.

## Stopping it at once

Any one of these stops it:

- Delete the admin Worker secret `CLAUDE_READ_TOKEN_SHA256`
  (`npx wrangler secret delete CLAUDE_READ_TOKEN_SHA256 -c apps/admin/wrangler.jsonc`):
  no token gets in. The agent teams still do.
- `alter role claude_reader nologin; alter role agent_reader nologin;` on the
  hosted database: neither login opens, whatever holds a key.

## What is left

- A key that leaks lets its holder read what its login reads until it is
  rotated or stopped: for `CLAUDE_READ_TOKEN`, names and what people wrote.
- A statement can still be heavy for 15 s. Five connections and 60
  statements a minute bound how much of the database it takes.
- With a direct connection (not through the gate), a session can turn
  read-only off. It still has no grant to write, but Supabase lets every
  role call `pg_net` to send a web request from the database. The logins in
  `.env.production` are there for the Hyperdrive configs; read through the
  gate.
