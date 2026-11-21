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

Migration `20261121031500_claude_readers.sql` makes them;
`server/claudeReadersSmoke.sql` holds what follows.

| | claude_reader | agent_reader |
|---|---|---|
| Who | cloud threads, a laptop | the agent teams (`user-issues.yml` on main) |
| Reads | `public`, `diag`, `ops`, `v2_import` | `diag`'s tables of ids, counts, times and codes; `public.events` without `payload` |
| Never | sign-in codes, password resets, push tokens, webhook secrets, API and invite token hashes, discovery keys, emails; `auth`, `storage`, `vault` | the above, and names, typed text, recordings, `diag.feedback`, every report function |
| Writes | nothing: no grant to insert, update, delete or truncate anywhere | nothing |

Both: every transaction is read-only unless the session turns that off, each
statement stops after 15 s, 3 connections at most, and BYPASSRLS, because
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

`scripts/prod-read.mjs` sends `CLAUDE_READ_TOKEN` when it is set (a cloud
thread has it from its environment), or the job's OIDC token in GitHub
Actions. The agent teams run a copy made before Claude starts,
`/home/runner/work/_temp/watch/prod-read.mjs`, the one command their Claude
may run besides git; Claude cannot change that copy, which asks only for the
gate's audience.

### Where answers go

An answer is production data. It stays in the thread or the job that asked.
Never paste rows into a pull request, a commit, a GitHub issue or comment, a
Linear issue, or anything else that is public or shared. Say what was found
in words: "12 phones on build 61 failed the download", not the rows.

## Where each key lives

| Key | Where | Who can read it | Rotate |
|---|---|---|---|
| `CLAUDE_READ_TOKEN` | the cloud environment's variables on claude.ai | the account owner, and every Claude thread in that environment | steps below |
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
4. Paste the token as `CLAUDE_READ_TOKEN` in the cloud environment's
   variables on claude.ai, in place of the old one.

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
- A statement can still be heavy for 15 s. Three connections and 60
  statements a minute bound how much of the database it takes.
- With a direct connection (not through the gate), a session can turn
  read-only off. It still has no grant to write, but Supabase lets every
  role call `pg_net` to send a web request from the database. The logins in
  `.env.production` are there for the Hyperdrive configs; read through the
  gate.
