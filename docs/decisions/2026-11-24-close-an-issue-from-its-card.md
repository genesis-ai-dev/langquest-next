# An admin closes a user issue from its card, and the card shows Linear's state at once

Date: 2026-11-24 · By: Caleb Koster · Status: accepted

Reason: on LAN-327 Caleb wrote "We resolved this. Please close the issue."
Claude asked Linear for the status "Done", which the LangQuest Next team does
not have (its done status is Live), so Linear refused. Claude's own answer
then said "I closed the issue as Done in Linear" under the line that said it
could not. The card had no way to close the issue, and it learned of a close
in Linear only at the watch's next run, 5 to 25 minutes late. Caleb asked
for a close button on the card, and for the card to change at once.

- **Close on each open issue's card.** It offers two choices: Done (the
  team's first status of the kind `completed`, Live) and Canceled (no fix is
  needed; never Outage). The app Worker closes the issue in Linear with its
  key (`server/linear.ts` `close`; the key is the one of decision 186) and
  keeps the close on the dashboard in the same tap
  (`public.ops_user_issue_states()`, migration
  `20261124200000_user_issue_states_now.sql`). The card's steps and record
  show who closed it (`issue_close` in `ops.actions`).
- **The card reads Linear's state at once.** When the page draws the user
  issues, and at most each 2 minutes while it is in front, it asks the app
  Worker for the states in Linear of the open issues it shows (at most 100,
  one Linear read). A change is kept as the watch keeps it, and the page
  reads the issues again. Only a change is logged. The watch still reads
  every state at each run.
- **Claude's Linear words come from Linear only.** A status word the team
  has no status of goes to the team's status of that kind (Done, Closed and
  Fixed to Live; Won't fix to Canceled; `statusFor` in
  `scripts/user-issues.mjs`), and the skill names the team's statuses. The
  job drops each sentence of the manager's answer that says what it did in
  Linear (`withoutLinearClaims`): the line the job writes from Linear's own
  answer is the only one.

Not chosen: a Linear webhook to the Worker (a close shows the same at once
on the page that is open, and a webhook needs a new secret and a setup step
in Linear); a close that waits for Claude's next run (the reason for this
decision); one Close that always means done (an issue that needs no fix
must not count as a fix).

Reverse if: the reads of Linear's states use too much of Linear's API
limit. Then read them only when the page opens.
