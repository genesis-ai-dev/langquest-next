# The watch keeps the logs of the moment a failure starts, and a failure that comes back goes to the fix team at once

Date: 2026-11-25 · By: Caleb Koster · Status: accepted

Reason: Caleb asked: "Ideally, the workers in the dashboard should be
seeing there's a failure and immediately diagnosing the issue by reading
logs etc. Is that set up? Why didn't the dashboard workers read the logs
when this issue came up?" The issue was LAN-298, "The v2 import failed for
a project". The watch filed it on 2026-11-17 with no error text. The same
failure came again on 2026-11-22 while the issue was open, and nobody
looked: the watch hands a server job or an ops line to Claude once a week,
and a kind with no people never "grows". The fix team tried the issue for
the first time on 2026-11-25. The Worker logs keep 24 hours, so the logs of
every failure were gone by then.

- **The watch reads the logs at the moment it sees a failure**, in a step of
  its own, before Claude (`scripts/user-issues.mjs logs`): the errors and
  warnings of every Worker and Supabase's errors of the last 2 hours, a day
  of the Worker logs that name a job or a route, and what the watch saw of
  the failure (a job's last run and error class, an ops line's words). It
  does this for each kind Claude looks at now, and for each open issue
  whose server job or ops line fails again now (`ops_user_issue_back()`, at
  most once in 12 hours a kind).
- **The database keeps them with the kind for 30 days**
  (`ops.user_issue_logs`). The run that writes a fix gets them in
  `evidence.logs`, days later too. Code reads them, not Claude: the reads do
  not depend on a Claude that chooses to read, or on a Claude token.
- **Personal data stays out.** The log gate answers the watch as
  agent_reader, which takes emails, IP addresses, phone numbers, tokens and
  long values out of each line; the script and the Worker take the same out
  again before the database keeps them. No log line goes to Linear, to a
  pull request or to the public job log: the job log says counts and keys.
- **A failure that came back goes first**, after the issues a person sent
  and before Linear's priority (`ops_user_issue_order()`, `back`), once for
  each time its logs are kept after the fix team last had the issue. The
  issue gets a Linear comment that says so, with no log line. This amends
  docs/decisions/2026-11-22-the-fix-team-takes-the-most-important-issue-first.md:
  a fresh failure's logs are gone in a day, and the order's other facts are
  still there tomorrow.

Reverse if: the kept logs rarely help the fix team prove a cause, or the
issues that came back crowd out more important ones for days. Then keep the
logs and drop the place in the order.
