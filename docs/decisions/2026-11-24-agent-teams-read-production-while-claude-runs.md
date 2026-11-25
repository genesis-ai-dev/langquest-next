# Agent teams read production while Claude runs, through a relay on the runner

Date: 2026-11-24 · By: Caleb Koster · Status: accepted

Reason: no Claude in an agent team's job could read production. On
2026-11-24 Caleb found the LAN-318 card's answer of 2026-11-21: "This machine
has no access to the hosted database", with SQL for him to run. He said
reading the database is critically important to diagnosing issues.
`claude-code-action` removes the job's OIDC request variables from Claude's
shell, so `prod-read.mjs` failed in every job: the watch, the issue manager,
the research lead and both Claudes of `card-questions.yml`. Their prompts still
told Claude it could read. The fix team's reads before Claude starts
(`docs/decisions/2026-11-23-the-fix-team-reads-production-before-claude-starts.md`)
cost a try for each round, and once a day after ten tries.

- **A relay holds the token, not Claude.** `scripts/prod-read-relay.mjs`
  starts in a step before Claude. It listens on `127.0.0.1` only, takes
  `POST /read` and `POST /read/logs` and nothing else, and asks GitHub for a
  token for the read gate's audience only. Claude gets the gate's answers.
- **The gate still decides.** Every read is agent_reader's, read only, with
  its own limits and log line.
- **It stops before the web.** A step stops the relay after Claude and
  before any Claude with `WebFetch` or `WebSearch`, so a read cannot reach a
  web page. `scripts/prodReadRelay.test.ts` checks both workflows.
- **Prompts say so.** Each Claude that reads is told it can read now, and
  never to give a person a read, SQL or a `diag` command to run.

Supersedes the rejection of a relay in
`docs/decisions/2026-11-23-the-fix-team-reads-production-before-claude-starts.md`.
Its reads before Claude starts stay, for answers a plan waits for.

Reverse if: the action offers a supported way to give Claude a read token,
or the gate's log shows a read through the relay that agent_reader should not
make.
