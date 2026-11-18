# 44. Dashboards read a per-organization snapshot folded by the dashboard's own server

Date: 2026-09-30 · By: Carl Sauder · Status: accepted

Reason: decision 40 had the projection worker write every language's report
into tables (`lane_reports`, `lane_report_days`) for the browser to read
under row-level security. That put a second read model, a schema and a
backfill on the projection worker for one consumer, and made every change
to a report a migration plus a refold on the worker's schedule. Instead the
dashboard's Cloudflare Worker (`apps/web/worker`) gets an API,
`GET /api/orgs/:org/reports`, backed by one Durable Object per organization
(`OrgSnapshot`, named by the org id, so every request for an organization
reaches the same memory). It folds the org partition and each language
partition with the reducer the phones run (`OrgFolder`), starting from the
server snapshots the projection worker already writes (`fetchSnapshot`) and
then the tail through `pull_events` with the service role, the way a phone
starts. Those snapshots are the durable cache, so the object stores nothing
and an eviction only costs a cold start. A request catches up from each
partition's cursor when the state is older than a minute, or at once with
`?fresh=1`, which the page sends after saving a country or target; requests
together share one pass, and a redaction of something already folded
refolds that partition. Reports (core `laneReports`) are cached per
partition by its cursor and the day. The Worker checks the caller's
Supabase access token (`auth.getUser`), and the object returns only the
languages `mayViewLane` allows (`view_status` from an org, partition or
language membership, or a role in the partition's own member list), so a
member scoped to one language still never receives another's numbers; raw
state never leaves the object. The browser loads an organization's reports
once and still sums totals and applies every filter itself, so filters stay
instant. The service-role key lives only in the Worker, encrypted in
`apps/web/.env.production` and pushed by `npm run web:secrets`; the page
keeps reading the mobile app's public env. The report tables and
`may_view_lane` are dropped. Supersedes 40.
Reverse if: one organization's state outgrows a Durable Object's memory or
CPU (then shard it by language, one object per partition), or figures must
be shared across organizations or read without the Worker (then stored rows
again, with a policy).

Amended (2026-10-03, Carl Sauder): the object now keeps a cache in its own
SQLite (`OrgCache`, `apps/web/worker/sqlCache.ts`), because an object is
evicted after a short idle spell and a dashboard is visited now and then, so
nearly every visit was a cold start: `_org` pulled from 0 and every language
read back from its snapshot (about 13 MB at Bible scale) and refolded. The
cache holds, per partition, the reports and member list (written each time
they change) and the fold itself (written when new, after a redaction, and
then every `STATE_SAVE_EVERY` events, like a phone's checkpoint), all tagged
with `REDUCER_VERSION` and `REPORT_VERSION`; a mismatch is ignored and
rebuilt, so the cache is still never the truth. A pass first asks
`partition_heads` (a service-role RPC over `partition_cursors`) and pulls only
the partitions that moved, so an organization nobody wrote to costs one
query, awake or woken. Memory holds every partition's summary but only the
`STATES_IN_MEMORY` most recent folds. The Worker checks tokens with
`getClaims`, which verifies them locally once the project has asymmetric
signing keys. Phones get `?view=summary` (each language's progress alone),
and every answer carries an ETag over its rows and `X-As-Of`, so an
unchanged answer is a 304. `_org` gets no server snapshot: with the cache it
is folded from 0 once per reducer version.

Amended (2026-10-15, Carl Sauder): the folds held in memory are capped by
the size of their serialized text (`STATE_BUDGET_BYTES`, 40 MB, always at
least one) instead of eight by count, a language of 2 MB or more is
refreshed alone while smaller ones still go four at a time, and a large
fold is let go once it is in the cache (`apps/web/worker/orgFolder.ts`). A
14 MB snapshot parses to well over 100 MB in a 128 MB isolate, and every
language is recomputed when the UTC day turns (performance-audit-app.md
V4). The limits are not yet measured against a real isolate.

Amended (2026-10-19, Carl Sauder): a report no longer needs a fold here
when the projection pass has stored the language's report inputs (142):
the object renders the report from them and the organization stream, and
folds only a language with none (before the pass first reaches it, or when
the table cannot be read). The folds this entry describes now serve the
access-token API (70) and that fallback. A plain read lags the pass by up
to its five minutes, and `asOf` says so when a language's stream has moved
past its stored inputs. A catch-up (`?fresh=1`, "Catch up with the
server") still folds the log's tail at once for a language whose stored
inputs are behind, up to 25,000 events (`FOLD_ON_CATCH_UP_EVENTS`), and a
later plain read keeps those newer figures; a larger language answers from
its stored inputs until the next pass. What an admin saves on the
organization stream (a name, country or target) shows at once either way.

Amended (2026-10-20, Carl Sauder): the access-token API (70), MCP, review
links and webhooks (101) no longer fold a language in the object (147).
Each language is sync's own kept client over the object's SQLite
(`LanguageRecordsKeeper`, `apps/web/worker/languageRecords.ts`): what the
whole language shares and its lines in memory, its rows first downloaded
from the server's cut and read a few passages at a time. Reports keep this
entry's folds only for a language of at most 25,000 events the pass has
stored no inputs for (142); a bigger one is "being prepared" until the pass
stores them. Access checks and the webhook scan read the organization
stream alone.
The capped-heap test lists and scans a Bible-size language (4,000 passages
of 15 versions, about 48 MB of fold) inside the isolate; folded whole, the
same language runs out of memory.
