# 190. A workflow says what only a person can fix in an annotation titled "Needs you", and the ops dashboard lists it under Needs attention

Date: 2026-10-29 · By: Caleb Koster · Status: accepted

Reason: on 2026-10-29 Gemini's prepaid credit ran out partway through the
first filming of the tutorial videos in all fifteen languages. The ops
dashboard said only that the "tutorials" workflow failed, and Caleb found out
from Claude hours later. He asked (thread "Plan tutorial videos and keep them
current") that a problem like the Gemini billing account, or the Claude token
missing, show on the ops dashboard. Decided:
- **The workflow names the problem**: a script that gets a refusal only a
  person can fix writes it down (`e2e/tutorials/needs-you.mjs`: Gemini's 402
  or "prepayment credits are depleted", a key refused or missing), and the
  job's last step says each once as an error annotation titled "Needs you:
  <what>", its message ending with the page that fixes it.
  `tutorial-review.yml` does the same for a Claude token that is missing, or
  that Claude's own answer says was refused. A refusal is said only when the
  answer says it; anything else stays a plain failure.
- **The dashboard reads it from GitHub** (`apps/admin/src/sources/github.ts`):
  for the latest failed run of each workflow on `main`, the annotations of
  its first three failed jobs (every tutorials job says the same account's
  problem). Each "Needs you" is a problem under Needs attention, with an Open
  link, in place of the plain "failed" line. The next run that works takes
  it away. Only the repository's own runs are read (a push, a schedule, a run
  by hand): a pull request from a fork can name its branch `main`, and its
  words never reach staff.
Rejected: a table and an endpoint the workflow reports to with GitHub's OIDC
token (as `tutorial-review.yml` sends its look), since the run already holds
the words and its failure, and a second store could disagree with GitHub's;
Linear issues alone, since the nightly report files a failure, not its
cause; reading the jobs' logs, which are large and unstructured.
Reverse if: GitHub stops keeping annotations, or a problem needs to show
while the run that met it is not the latest.
