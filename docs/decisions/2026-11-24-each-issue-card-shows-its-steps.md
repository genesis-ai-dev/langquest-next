# Each user issue's card shows its steps, also the ones Claude starts alone

Date: 2026-11-24 · By: Caleb Koster · Status: accepted

Reason: after Caleb sent an instruction on a user issue's card, he could not
see what Claude did with it until the answer came, nor tell later whether a
card was new or came from his instruction. From four drawings he chose B:
each step Claude took, on the card. He then asked that the cards show the
same for the work Claude's agent team starts alone: the watch finds an
issue, Claude sets out to prove the cause, reads the field diagnostics and
the Cloudflare logs, writes the fix, and closes it. The issue's tables keep
only the newest state, one row an issue (the fix record, the plan, the last
try), so the way the issue went was lost.

- **The database keeps each step as it happens.** `ops.user_issue_steps`
  (migration `20261124193000_user_issue_steps.sql`) gets a row from a
  trigger on each change to `ops.user_issues` (filed, a new kind of problem,
  more people, Linear's state, closed, open again, the fix merged),
  `ops.user_issue_tries` (a run gave the issue to the fix team, with the
  reads that try runs first), `ops.user_issue_plans` (the plan to prove the
  cause and its reads), `ops.user_issue_fixes` (the fix, the cause, the
  manager's model and effort, the reviewer) and `ops.user_issue_notes` (a
  run took an admin's instruction). Each step has the run's link. No code of
  the watch or the fix team changed: every way into these tables makes the
  step, whoever started the work.
- **A step keeps facts and Claude's words, never a person's words.** A plan's
  reads are kept as counts (field diagnostics, production database) and log
  names, never the statements. An instruction's step keeps only its id.
- **A step never stops the work.** The trigger keeps a step that cannot be
  kept out, with a warning, and the write that made it goes on. One issue
  with many kinds of problem gives the same step once; an issue keeps its
  last 200 steps, and the page reads the last 25 of the last 90 days
  (`diag.ops_user_issue_steps()`).
- **The card shows the steps as a timeline.** "Steps" on each issue card
  (`apps/admin/src/pageSteps.ts`), the oldest first, with up to 10 steps at
  a glance and the earlier ones behind one tap, and whose turn it is now.
  The steps of a run on an admin's instruction show under that instruction,
  between it and Claude's answer, and not again in the card's steps. The
  card's record of taps and answers
  (`2026-11-21-every-dashboard-tap-shows-its-state.md`) is in the same
  timeline on issue cards. Tutorial video cards keep their record as before.

Not chosen: the steps from GitHub's jobs of each run (the dashboard would
read GitHub for each card, a run's jobs say nothing about issues Claude did
not touch, and GitHub keeps logs 90 days); writing each step from the
workflow's scripts (each new way into the tables would need its own write,
and a missed one leaves a gap); a list of all instructions in the bell
(option A) or a tag "new" or "follow-up" on each card (option C).

Reverse if: the steps table grows past what the dashboard reads in time, or
a step shows words a person wrote. Then keep fewer steps or fewer kinds.
