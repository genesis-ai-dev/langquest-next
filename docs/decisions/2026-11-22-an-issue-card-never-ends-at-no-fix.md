# An issue card never ends at "Claude wrote no fix. A developer decides."

Date: 2026-11-22 · By: Caleb Koster · Status: accepted

Reason: Caleb, on the cards of LAN-303 and LAN-322: "I don't want to keep on
having to write the same thing on these issue cards. If it reports a
problem, I need it to find out on its own why this is happening, or propose
what it needs to implement in the system (client/server/services/whatever)
in order to find out how to fix it." He had typed "prove why, or say what
tools you need" on each card, though the plans of
`2026-11-21-the-issue-manager-proves-the-cause-or-carries-out-a-plan.md`
were live.

What the records showed on 2026-11-22 (production, `ops.user_issue_fixes`
and `ops.user_issue_plans`):

- LAN-322's plan had used its 10 tries (`PLAN_TRIES`), so the watch stopped,
  and the card fell back to "Claude wrote no fix. A developer decides." Its
  last runs ended with no `fix.json`.
- LAN-303 had the verdict `not_a_bug` with Claude's reason, but the card
  showed no reason: only "A developer decides".
- 6 of the 13 plans said the manager could not read production. The
  action that runs Claude (`claude-code-action`) removes the OIDC request
  variables from Claude's shell on purpose, so `prod-read.mjs` has no token
  there. That is not changed here: it waits for Caleb's choice.
- Manager runs ended with `fix.json` missing after about 30 turns with no
  error. The manager starts workers with the Agent tool, which runs a worker
  in the background unless told not to; a run ends when the manager ends its
  turn.

What changes:

- **The watch never stops.** After `PLAN_TRIES` tries an open issue comes
  back once a day, not each 2 hours. The 11-21 limit's reason (one issue
  must not use the Frontier plan's week) still holds at one try a day.
- **No wasted try.** The manager starts each worker with
  `run_in_background: false`. When a run still ends with no `fix.json`, a
  second step resumes the same session once to write the verdict. The job
  log counts the workers left in the background, to prove or rule out that
  cause on the next runs.
- **The card says what Claude found.** With no plan: "Claude found no bug"
  with the reason, "Claude needs your choice" with the choice, or the gate's
  reason with Claude's words. Never "a developer decides" alone.
- **The stuck plans come back.** The migration hands back the plans that
  stopped at 10 tries, and gives a plan to each open issue that ended at
  "not proven" with none.

Reverse if: the once-a-day tries repeat the same plan with no new facts for
a week, or they use a large part of the Frontier plan's week.

Amended (2026-11-24, Caleb Koster): a try also never ends with no result.
From 2026-11-22, GitHub refused to let the workflow open the pull request of
a fix ("GitHub Actions is not permitted to create or approve pull
requests"). The job pushed the branch and wrote no record. Each later try on
that issue found the branch and stopped with "nothing done", again with no
record. Twelve cards (LAN-315 among them) showed "started a try" as their
last step, though the manager had written a fix with its cause proven. Now:
- A refused pull request writes a record (no change, reason `app`, with
  GitHub's answer) and a plan to try again in 6 hours.
- A new try on a branch with no open pull request puts its fix in the
  branch's place and opens the pull request again. A new try on a branch
  with an open draft fix puts its change on that draft.
- A step of the job `open` that fails before the Worker heard of the try
  writes a record with no verdict, and Claude tries again (as when the
  manager wrote no verdict).
- The card says "No result came back from this try" under a try with no
  result after 4 hours, for a run that a person or GitHub cancelled.
