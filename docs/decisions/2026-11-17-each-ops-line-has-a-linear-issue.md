# Each line of the ops dashboard has a Linear issue, and the page shows its fix and when it should clear

Date: 2026-11-17 · By: Caleb Koster · Status: accepted

Reason: Caleb asked that each problem at the top of the ops dashboard say
whether a fix is out and we wait, when it should clear, or that it cleared,
with resolved problems in a closed list below. A line stays after its fix
merges because its check runs later: the R2 check nightly, a server job's
window two days, a phone's count as phones update. Without that, a fixed
line looks the same as one nobody works on. Caleb also asked that Linear be
the one place where every problem is tracked: the dashboard, Claude, Claude
Board and reports from the app all meet there. So the link is Linear, not a
new tag in pull requests. Decided:
- **Each line has a fixed name.** `apps/admin/src/alertKinds.ts` `KINDS`
  names every kind of line, its part, a few words for the Resolved list and
  when its check runs again (`Recheck`: daily times, every so many minutes
  from the last run, a window of hours, phones that must update, a calendar
  month). Each alert carries its kind and subject (`Alert.key`, `subject`).
  `WORKFLOW_RECHECK` holds each scheduled workflow's cron;
  `apps/admin/test/fixes.test.ts` holds it to the workflow files.
- **The watch files the Linear issue.** A line's watch key is the watch's
  own key when the watch already finds that problem in the records (a job
  that stopped, a Worker route's 5xx, an error on phones), else
  `ops:<kind>[:<subject>]`, a new family. The app Worker asks the admin
  Worker for the `ops:` lines (`OpsLines`, an RPC entrypoint on a second
  service binding, read-only) and passes them to `ops_user_issue_watch`
  (migration `20261117213500_ops_lines_linear.sql`). Claude then files a
  Linear issue or ties the line to one the team has (decisions.md 202). A
  person's own queue (join requests, videos to publish), a nightly line that
  already names its issues, and "Could not read" get none.
- **The fix is the pull request that names the issue.** The rule in
  AGENTS.md already puts the Linear id in each commit and pull request title.
  `/ops/api/fixes` reads the pull requests open or merged in the last 14 days
  that name a `LAN-` id (`sources/fixes.ts`); Linear's own closing pull
  request (the watch reads it every 15 minutes) counts too.
- **The page works out when a line should clear** (`pageFixes.ts`): the
  merge, 30 minutes to deploy, the check's window, then its next run. Each
  line shows its Linear issue and one of: no issue yet, no fix yet, a fix
  that waits on its merge, a fix merged with the time it should clear (in the
  viewer's clock), or still there after that check. A card whose every line
  waits after a merged fix goes last and does not count as needing you.
- **Resolved** is a closed list under the cards: the lines the watch tied to
  Linear in the last 14 days that the page no longer shows, read only from a
  part that answered. It never lists Linear issues that came from elsewhere.

Reverse if: the team stops naming the Linear issue in pull requests (then the
fix needs another link), or Linear stops being where problems are tracked.

Amended (2026-11-17, Caleb Koster): a line that names several Linear issues
(a nightly suite with several failed tests) shows each issue's own fix under
it. One issue's pull request is not the line's fix: the page called PR 396
(LAN-158) the fix for a suite whose other tests were LAN-156 (no fix) and
LAN-248 (PR 409). Such a line waits after a merge only when every issue has
a merged fix; else it says how many of its issues have one. A pull request
names only the issues it fixes or is part of, because the page reads every
id in its title and text as a fix (the rule is in AGENTS.md).
