# An admin tells Claude what to do with a user issue from its card on the ops dashboard

Date: 2026-11-18 · By: Caleb Koster · Status: accepted

Reason: the ops dashboard is where an admin gives feedback and direction
(`docs/decisions/2026-11-18-ops-dashboard-menu-and-overview.md`). A tutorial
video's card has a box, "Tell Claude what to do" (decisions.md 186). A user
issue's card had none: to change Claude's draft fix (decisions.md 202), an
admin had to go to GitHub or Linear. Now a user issue's card has the same
box, and Claude's answer shows under the admin's words.

- **The dashboard keeps the words.** The page sends `user-issue-note` to the
  app Worker's `OpsActions` (`apps/web/worker/opsActions.ts`, decisions.md
  162): a Global Viewer on an `aal2` session, an open issue of the watch, at
  most 2000 characters, at most three that wait on one issue.
  `ops.user_issue_notes` keeps them (migration
  `20261118073000_user_issue_notes.sql`). `ops.actions` logs the issue and
  the note's id, never the words.
- **The watch hands them to Claude.** No new workflow, job or key. Every 15
  minutes `GET /api/user-issues` also names the open issues with a note that
  waits. `file` adds them to the fix jobs after the new issues, while
  `FIX_MAX` (three a run) has room, and tells the Worker which notes the run
  took. `fix-context` reads the notes (`GET ?notes=<issue>`) and puts the
  issue's draft fix (branch `user-issue/<issue>`) on the checkout of main, so
  Claude starts from it. Claude follows the user-issues skill's part "When an
  admin sent an instruction" and writes `answer` in `fix.json`.
- **An admin's words are the team's, and the limits stay.** Unlike what a
  user wrote, an instruction is one to follow. But the jobs trust each other
  no more than before: Claude still has no key and no shell, the paths a
  draft fix may not change are still refused, what a user sent still may not
  be in the change, and `open` still runs nothing of the patch.
- **`open` changes the draft fix that is there.** When Claude changed it,
  `open` pushes one commit to the branch whose parents are the branch's head
  and main, so the pull request keeps its history and a person's commits. The
  built-in token's push starts no checks, so `open` makes the pull request a
  draft again when it was not: Ready for review then runs CI on the new
  change, after a person read it. With no draft fix yet, the instruction
  gets a new draft pull request. When Claude only answers, nothing is pushed.
- **The answer comes back by the Worker's door.** `open` gets
  `id-token: write` and posts `notes` to `/api/user-issues`, which lets in
  this workflow on main (decisions.md 202). `open` already holds the Linear
  key and a token that writes; it gains no key to production. The card shows
  each note's state: waits, Claude works on it, answered, or stopped (two
  runs took it and neither answered; the admin sends it again).
- **Where the words go.** The admin's words stay in the database and on the
  runner. The workflow writes only Claude's words to GitHub (the commit, the
  pull request's text) and to Linear (that the draft fix changed).

Not chosen: starting the workflow from the Worker at once (the Worker would
hold a GitHub token, and 15 minutes is soon enough); a comment on the pull
request that calls Claude (anyone can write there, and the admin would leave
the dashboard); answers without changes (the admin would then change the
draft fix by hand).

Reverse if: instructions use too much of the Claude plan (each one is a fix
run), or Claude's changes to a draft fix cost a developer more review than
the change by hand. Then keep the answers and stop the changes.

Amended (2026-11-19, Caleb Koster): an instruction that says to merge the draft fix as it is now merges it when its checks pass; the script checks the admin's words and that the draft fix did not change (`docs/decisions/2026-11-19-an-agent-team-fixes-user-issues.md`).
