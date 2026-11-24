# A message to Claude from the ops dashboard starts its run at once

Date: 2026-11-24 · By: Caleb Koster · Status: accepted

Reason: an admin's instruction on a user issue's card waited for the next
scheduled run of the watch (`user-issues.yml`, "each 15 minutes"), and a
question from a card for the next run of `card-questions.yml` ("each 5
minutes"). GitHub starts scheduled runs late: on 2026-11-24 the watch ran
each 12 to 25 minutes and card-questions each 8 to 15. On LAN-256 Caleb sent
"Please close this issue" and the card said only "Claude reads it at the next
run of the watch". He asked that Claude answer right away and start working.

- **The app Worker starts the workflow when it keeps the message.**
  `OpsActions` (`apps/web/worker/opsActions.ts`) keeps the instruction or
  question as before, then asks GitHub to run `user-issues.yml` or
  `card-questions.yml` on main (`apps/web/worker/startRun.ts`), and logs
  what GitHub said in `ops.actions` (`note:<id>:run:started`). Only those
  two workflows, only on main. The runs are the same runs as the schedule's:
  the same OIDC doors let them in, and the concurrency groups keep one run at
  a time, so a message sent while a run works waits for that run to end.
- **The token can only start runs.** `OPS_RUN_GITHUB_TOKEN` is a
  fine-grained GitHub token for this repository alone with only Actions:
  Read and write (docs/admin.md), on the app's Worker, production only
  (`scripts/secrets.mjs`). It reads and writes no code and no secret. The
  ops dashboard's own `ADMIN_GITHUB_TOKEN` stays read-only.
- **The card says what happened.** When the run started, the talk says
  "Claude starts on it now", the box says Claude starts when you send it,
  and the page reads the issues again each minute while Claude owes an
  answer, so "Claude works on it now" and the answer show without a reload
  (`apps/admin/src/pageSends.ts` `markStart`, `issueWaits`). Without the
  token, or when GitHub refuses, nothing changes: the message waits for the
  schedule and the card says when.

- **Claude changes the issue in Linear when the instruction needs it.** On
  LAN-256 Claude answered "I cannot close the issue from here", though the
  watch's job `open` holds the Linear key. Now the manager reads what the
  admin means and lists the changes the issue needs (`linear` in
  `fix.json`: status, priority, title, a comment, a duplicate). `open` makes
  them on this issue only, and only in a run with an admin's instruction,
  so what people reported cannot ask for one. The answer starts with what
  Linear did or refused (docs/agent-team.md). No list of words decides it:
  Caleb asked that Claude know from his instruction, with no words to
  remember.
- **A reply in the bell opens its card and keeps it marked.** A tap on a
  reply scrolls to its card and rings it for 10 minutes, through each
  redraw of the page (`remark` in `apps/admin/src/pageCards.ts`). A tap on
  the reply whose card the address names already finds it again, and a
  tutorial video's reply opens that video's cards, not only the page.

Not chosen: a list of words ("close it", "cancel") that must be in the
instruction before Claude may change Linear (Caleb: the admin must not need
to remember words); giving the manager the Linear key itself (it has no
network and no key, as what people reported can steer it); Claude answering
in the Worker itself (no code, no production
reads, and a Claude key in the Worker); a run that waits all day for
messages (it holds a runner for nothing); the dashboard's read-only GitHub
token with write added (every ADMIN_* token is read-only, docs/admin.md).

Reverse if: the runs started by messages use too much of the Frontier plan
or of GitHub's minutes, or a message starts runs that a schedule would have
joined. Then start runs at most once each few minutes.
