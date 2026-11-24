# User reports have their own page on the ops dashboard, and the fix team takes them first

Date: 2026-11-24 · By: Caleb Koster · Status: accepted

Reason: Caleb asked (2026-11-24) for a separate page on the ops dashboard for
the problems that people report from the app, with high priority. Before
this, a report sent from help mode (decisions.md 145, LAN-100) was one card
among the watch's other cards on User issues (decisions.md 202), and the fix
team took it in the same order as a crash that no person wrote about
(`docs/decisions/2026-11-22-the-fix-team-takes-the-most-important-issue-first.md`).
A person who took the time to write is a partner who waits for an answer.
Also, when the watch added a report to an issue it had filed for a phone's
records (verdict `known`, or one issue for several kinds), the card said
"Phones and browsers", not "A person sent it": the tag came from the first
key in name order, and `feedback:` sorts after `audio:`, `auth:`, `error:`
and `expected:` (LAN-220 showed it).

- **A page of its own, User reports, first under Care in the menu**
  (`apps/admin/src/pageReports.ts`). One card for each report of the last
  90 days, in the user issue's card format: what the person said and from
  which screen, the screenshot, and its Linear issue's Wrong, Known and Next.
  Tabs: Open, Not in Linear yet, Ideas, Fixed or closed, Not a problem, All.
  The open problems lead in the fix team's order. The menu line counts the
  open problems and shows Fix soon while one is open. Reports from test
  accounts and the store review accounts (`ops.watch_ignored`) are only
  counted. `diag.ops_user_reports()` reads them for the page; it gives what
  `diag.feedback()` already gives the dashboard, and no name, address,
  install or account.
- **Linear stays the one place for state**
  (`docs/decisions/2026-11-24-a-merge-closes-the-issues-it-fixes.md`). The
  page reads each issue's state from what the watch last read in Linear. The
  talk with Claude stays on the issue's card on User issues: the page's
  "Tell Claude what to do" opens that card, so an issue has one talk.
- **The page raises no line of its own.** Each open problem is a user issue
  already, and a new line kind would make the watch file a second Linear
  issue for the same problem (`docs/decisions/2026-11-17-each-ops-line-has-a-linear-issue.md`).
- **The fix team takes a problem that a person sent before every other
  issue.** `ops_user_issue_order()` sorts by `sent` (any key of the issue is
  `feedback:<id>`) first, then as before: Linear's priority, people, kinds,
  places, times and the oldest. The order's why on the Overview and in the
  job log starts with "A person sent it".
- **The tag "A person sent it" wins over the first key.** `issueSource`
  says it when any key of the issue is a report.

Ideas still never go to Linear; if the team wants to answer ideas too, they
need a Linear path of their own.

Reverse if: reports that are mostly noise (tests, a word sent by mistake)
push real crashes back for days; then a report goes first only after the
watch filed it with a priority of Medium or more.
