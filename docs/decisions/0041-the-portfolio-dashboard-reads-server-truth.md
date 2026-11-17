# 41. The portfolio dashboard reads server truth, and a language's country and target are events

Date: 2026-09-30 · By: Carl Sauder · Status: accepted

Reason: a partner built their own reporting tool on LangQuest v2 (upload
recency, coverage of the Gospels and Testaments, a monthly chapter ledger,
pace against a plan, alerts). Rebuilt here on the event log, per
organization (decision 40's row-level security still decides what anyone
sees):

- Uploads are timed by the server's `BlobStored` clock, never a phone's
  (PLAN.md 14.12): a recording counts on the day it reached the cloud.
  Coverage is timed by a passage's first published version and weighted
  by verses of the whole canon (core `coverage.ts`), shown recorded and
  done side by side. A chapter counts in the ledger once, in the month its
  first audio arrived; a month settles five days after it ends.
- Recency bands keep the partner's thresholds (14, 21, 28, 35, 45 days) in
  neutral words; pace compares recorded coverage of a target's scope with a
  straight line from its start to its target date (on pace from 5 points
  behind to 10 ahead; behind languages whose last eight weeks still finish
  in time are "behind", the rest "stalled"). Both are read at view time
  from the stored report, so they never go stale between passes.
- Country and target are registers per lane (`v1.LaneCountrySet`,
  `v1.LaneTargetSet`, `manage_structure`), not columns, so they sync,
  merge and audit like everything else. The web app writes them with a
  `SyncClient` over a memory store and waits for the server: it has no
  offline use, so instead of an outbox it says "not saved" and keeps the
  form (invariant 1 is about the phone's log; nothing here is dropped
  silently). `REDUCER_VERSION` is 8 because an older build ignored these
  events and its snapshots would hide them.
- The partner's weekly field updates and Airtable intake stay out: they
  are not LangQuest data.

Reverse if: a partner needs figures across organizations; then add an
observer grant and a policy, not a second data path.

Amended (2026-09-30, Carl Sauder): the reports no longer come from stored
rows. The dashboard's own server folds each organization and computes them
on request (decision 44), and `mayViewLane` in core, the same rule as the
row-level security it replaces, decides what anyone sees. A report now also
carries its last 90 days of progress (`progressDaily`, `REPORT_VERSION` 3).
