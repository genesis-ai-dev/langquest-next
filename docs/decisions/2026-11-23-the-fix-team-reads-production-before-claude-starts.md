# The fix team reads production before Claude starts

Date: 2026-11-23 · By: Caleb Koster · Status: partly superseded by 2026-11-24-agent-teams-read-production-while-claude-runs

Reason: the issue manager could never read production.
`claude-code-action` removes the job's OIDC request variables from Claude's
shell on purpose (`base-action/src/parse-sdk-options.ts`: "so Claude cannot
mint new tokens"), so `prod-read.mjs` found no token in the fix job. On
2026-11-22, 6 of the 13 open plans said so, and their cards waited for a
developer. Caleb chose, of three options: "Reads before Claude starts".

- **The plan names the reads.** `fix.json` `next.reads`: at most 6
  statements, each `select` or `with`, at most 1500 characters, one
  statement each. The Worker checks them; `ops.user_issue_plans.reads`
  keeps them.
- **A step before Claude runs them.** `fix-context` holds the job's OIDC
  token, as every step but Claude's does. It runs the reads through the
  read gate as agent_reader and writes the answers, at most 200 rows each,
  to `.user-issues/reads.json`. The public job log says only how many
  answered.
- **The guard stays.** Claude's shell still gets no token, and the gate
  still holds every read to agent_reader, read only.
- **A new issue** with no answers yet gets `unconfirmed` with its reads and
  `inHours` 0.25: the next run, about 15 minutes later, starts with them.

Rejected: a relay on the runner that passes Claude's statements to the gate
while Claude runs. It gives live reads, but it goes around the action's
guard; a safety check refused to build it without a developer's choice.
Rejected: no production reads, since causes stay unproven.

Reverse if: the action offers a supported way to give Claude a read token,
or tries spend most of their rounds waiting for answers.

Amended (2026-11-23, Caleb Koster): the log reads of PR 657 (`prod-read.mjs --logs`) fail in the fix job for the same reason. A plan's `next.reads` may name logs too, as `--logs <source> name=value ...`, and `fix-context` reads them before Claude starts, with their newest 200 lines in `reads.json`.

Amended (2026-11-24, Caleb Koster): the rejected relay is now built, for every agent team's job
(`docs/decisions/2026-11-24-agent-teams-read-production-while-claude-runs.md`). The reads a plan names still run before
Claude starts, for an answer the plan waits for.
