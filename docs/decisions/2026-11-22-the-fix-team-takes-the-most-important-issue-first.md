# The fix team takes the most important issue first

Date: 2026-11-22 · By: Caleb Koster · Status: accepted

Reason: Caleb asked: "Can there be a strategist agent that determines the
highest priority items or the ones that affect the greatest number of items
and tackles them first?" Each run hands at most `FIX_MAX` (3) issues to the
fix jobs. Before, they went in a fixed order of lists (new issues, plans
whose time came, the research's, then the issues never tried), each list
the oldest first. An issue that 40 people hit could wait behind an issue
that one person hit once.

- **One order for every issue that waits.** `ops_user_issue_order()` puts
  the new issues, the plans whose time came, the research's and the issues
  never tried in one list, sorted by:
  1. Linear's priority: Urgent, High, Medium (or none), Low. Claude sets it
     when it files the issue; a developer who changes it in Linear changes
     the order at the next run (`ops.user_issue_priorities`, read each run
     with the issue's state).
  2. People: the most people of one of its kinds, in 7 days.
  3. Kinds of failure that point to the issue, then places where the
     research found the same mistake: what the issue touches.
  4. Times it happened.
  5. The oldest first.
- **An admin's instruction on a card still goes first**, before the order.
  A pull request that did not get into main keeps its own room, as before.
- **A rule, not a Claude run.** The strategist is this sort, in SQL. It costs
  nothing on the Frontier plan, it gives the same answer each time, and the
  dashboard shows the same order with each issue's reasons. The judgment
  is in the priority that Claude sets when it files an issue and that a
  developer can change. Sorting by these facts one after another needs no
  weights, so no number was made up.
- **The dashboard** shows the next run's issues in this order, each with
  why ("High · 14 people · 2 kinds · 292 times"), and how many wait after
  them (`diag.ops_user_issue_order()`).
- **Before the migration** or when the order cannot be read, the watch uses
  the old lists.

Reverse if: the order often puts issues first that developers move down in
Linear by hand, or a Claude judgment of the whole queue proves the cause of
more issues for the same use of the plan.

Amended (2026-11-25, Caleb Koster): an open issue whose failure came back,
and whose logs the watch kept after the fix team last had it, goes after
the issues a person sent and before Linear's priority, since its logs are
gone in a day
(docs/decisions/2026-11-25-the-watch-keeps-the-logs-of-the-moment-a-failure-starts.md).
