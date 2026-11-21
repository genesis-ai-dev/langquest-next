# On its way shows only what moves without a person, in time order, and Claude tries every issue it never tried

Date: 2026-11-21 · By: Caleb Koster · Status: accepted

Reason: Caleb asked what the Overview's "On its way" cards mean: whether
Claude takes care of them, whether he must act, whether they run all at once
or a few at a time, and why some are yellow and some purple. On 2026-11-21
the group had 21 cards. Only 2 were on their way: merged fixes that wait for
the check that clears their problem. The other 19 were open Linear issues
nobody worked on: 5 where the agent team looked and changed nothing, and 15
that Claude never tried, because the fix jobs took a new issue only in the
run that filed it, at most 3 a run (`FIX_MAX`). The colours meant nothing
fixed: yellow came from the problem's level, purple from the Linear list.
The status said more than was true (decisions on truthful status). Caleb
chose, from before and after pictures in the project files (`on-its-way/`),
the new view and that Claude also tries the old issues. Decided:
- **On its way holds only what moves without a person, in time order.** Each
  row starts with when: Now (Claude works on it), the next run (the issues
  Claude takes, the oldest first, and how many wait after them), when its
  checks pass (Claude's fix that merges alone), the time its check should
  clear the problem (a merged fix), then a developer's issue in Linear and a
  store's review, which have no time. A time shows only where the page knows
  it (`wayItems` in `apps/admin/src/pageOverview.ts`).
- **A row's colour is who acts next**, with a key under the title: purple
  Claude, green a check that shows the fix works, yellow a developer, grey
  Apple or Google.
- **What waits for a developer is a choice for this week.** An issue where
  Claude stopped, where its draft fix waits to be read, or where Claude
  started and gave no answer in 2 hours goes under "This week, you decide",
  with Claude's reason and a button to tell Claude what to do or read the
  fix (`claudeWork`, `CLAUDE_GROUP` in `apps/admin/src/pageStart.ts`).
- **Claude tries every open issue it never tried.** After the new issues,
  the instructions and the research, each run gives the room left in
  `FIX_MAX` to the open issues with no fix record that no run handed over,
  the oldest first (`ops_user_issue_untried`, `untriedToTake` in
  `scripts/user-issues.mjs`). Each run records which issues it handed to the
  fix jobs (`ops.user_issue_tries`), so an issue is not tried twice this way
  and the dashboard knows when Claude started. An issue a developer has In
  Progress or In Review in Linear is left alone. A try uses the agent team's
  Frontier Claude plan, as a new issue does.
Reverse if: the old issues use too much of the Frontier Claude plan, or most
tries of old issues end in no fix (then hand them over only on an admin's
instruction); or a person must see every open issue in one list (then show
them on User issues, not under On its way).
