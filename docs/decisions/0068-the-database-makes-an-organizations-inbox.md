# 68. The database makes an organization's Inbox rows when they change, pushes go every minute, and the projection pass skips what has not changed

Date: 2026-10-07 · By: Carl Sauder · Status: accepted

Reason: an admin heard of a join request only after the next projection
pass, every five minutes in production, plus however long the pass took,
and the pass grew with how many organizations and languages exist, not with
how much happened. Every pass folded every organization's whole stream and
downloaded every language's snapshot, changed or not, to rewrite every
member's Inbox rows. Three changes:
- The organization's own rows (join requests, reports) are made by the
  database: `refresh_org_notifications` computes them from tables it
  already keeps (`org_memberships`, `org_roles`, `_may_moderate`), and
  triggers on `join_requests` and `content_reports` call it with the
  change. Their ids are the worker's, so no row is pushed twice. An
  advisory lock per organization keeps two requests from undoing each
  other's rows; the trigger never fails the write (as `events_notify`).
- Push delivery is its own job, every minute (`langquest-push-delivery`,
  the same Edge Function with `{"task":"pushes"}`), so a row reaches the
  phone within a minute. `claim_notification_pushes` is one index lookup
  when nothing waits.
- The projection pass keeps a mark per stream (`projection_marks`: the
  last event projected, the organization event folded, the listing, a
  `PROJECTION_VERSION`) and skips a language whose stream, organization
  and listing are unchanged, without downloading its snapshot. It
  refreshes an organization's own rows only when its stream changed
  (someone became or stopped being an admin). Inbox rows depend on no
  clock (`updatesFor`), so a skipped language has nothing to update.
Locally, a repeat pass went from downloading every snapshot to four small
reads. Migrations `20261007200000_org_inbox_rows_in_sql.sql` and
`20261007200001_schedule_push_delivery.sql`, which now does what
`20261006000001` did for `npm run secrets` and `scripts/local-db.mjs`.
Reverse if: rows that need the folded state (passage updates) start
arriving late because of the five-minute pass; then those want the same
treatment, from the language's events, rather than a faster pass. Or if a
mark lets a language go stale; then bump `PROJECTION_VERSION` and find
what the mark misses.

Amended (2026-10-12, Carl Sauder): the pass also visits a language whose
newest snapshot is behind its stream and an hour old, so it gets a new one
(88); a language whose stream moved is still folded every pass, but its
snapshot is written only on 88's schedule.

Amended (2026-10-15, Carl Sauder): the pass also skips a language whose
stream moved when the organization and the listing are as its mark left
them, no snapshot is due (88's schedule, unchanged), and every event since
the mark, at most 1,000, is of a type that cannot change an Inbox row, a
row's title or the language's progress (`eventsThatCannotChangeInbox`,
`packages/core/src/quiet.ts`, held by a property test). It reads only those
events and moves the mark; the snapshot is not downloaded. A type not
checked is left out and costs a full fold, so a new language event type is
read against the list before it joins it. `public_languages` is written
only when something it shows changed, and the snapshot's age comes from the
list the pass already read (performance-audit-app.md V2). Reverse if a
skipped language's Inbox rows are found stale: take that type out of the
set.

Amended (2026-10-19, Carl Sauder): the pass runs for every language in the
job container behind the dashboard Worker, every five minutes (141), and
pg_cron on a hosted project schedules push delivery alone
(`20261019110000_projection_pass_in_container.sql`). A local stack keeps the
Edge pass every minute, scheduled by `scripts/local-db.mjs`, since wrangler
dev fires no cron and the web UI tests wait for it. The pass also writes
each language's report inputs (142), so a quiet tail must leave those alone
too: it skips a language only when every new event is in
`eventsThatCannotChangeReport`, the quiet list without recordings, cards and
stored files, and moves the stored inputs' position with the mark.

Amended (2026-10-20, Carl Sauder): a local stack no longer keeps the Edge
pass: it runs the pass in the job container too, its tick fired every
minute by `npm run web:dev`, and push delivery's function is
`push-delivery` (148).

Amended (2026-10-26, Carl Sauder): the pass no longer folds a language again
because its organization's stream moved. A mark keeps a fingerprint of what
the language's projection reads from the organization (who may open it, its
name and code, the licence: `orgFingerprint` in `server/projectionWorker.ts`,
`projection_marks.org_fp`); an organization event that leaves it equal (an
invite, a role nobody holds, a join decided for another language) only
moves the mark's `org_seq`. A projection that starts to read something more
from the organization must put it in the fingerprint or bump
`PROJECTION_VERSION`. The pass also reads one snapshot row per stream
(`snapshot_heads_page`) and only the listed languages' visibility rows.
