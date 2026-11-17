# 101. Webhooks are nudges, and the change feed is ordered by when the server saw a change, found by comparing what the API shows

Date: 2026-10-13 · By: Ryder Wishart · Status: accepted

Reason: Aquilla imports takes from LangQuest and must notice structure
changes and deletions, which polling `changedSince` misses: hiding a
passage or dividing a book again never moves `updatedAt`. Their request:
a webhook that only nudges, and a feed that stays right after a missed
delivery or a three-day outage. Chosen:
- **The feed** (`GET …/languages/{id}/changes?after=`) is one row per
  passage change, numbered in the order the organization's Durable Object
  saw it (`apps/web/worker/agent/dispatch.ts`). It is not ordered by HLC.
  A phone offline for days pushes events with old clocks, and an HLC
  cursor would skip them for good.
- **Changes are found by comparing digests.** A digest is what the passage
  list shows of each passage (`webhooks.ts` `digestOf`): label, order,
  parent, path, latest take, status, approved take, newest review and
  release. The DO compares the digest before and after the log moves. The
  log has no unit-updated, unit-deleted or language-removed event: a
  passage leaves the list by `v1.UnitHidden`, a template change or a book
  divided again, and a language leaves a token's reach by membership. So
  reading event types would miss them, and a comparison catches every
  path, now and later. The first look at a language only records where
  its feed starts.
- **A webhook belongs to a token.** It needs `read` and stops when the
  token is revoked or expires, after one last `token.revoked`. It is a row
  in Supabase (`api_webhooks`, migration `20261013120000_api_webhooks.sql`,
  service role only) so the database and revocation can see it. Its
  secret is kept as it is: signing needs it. A leaked secret forges only a
  nudge that carries no data.
- **Delivery** happens in the DO, from an outbox in its SQLite:
  - each delivery is signed `t=…,v1=HMAC-SHA256(secret, t.body)` with a
    stable event id;
  - it is retried on a non-2xx or a 10-second timeout, for a day;
  - a webhook whose event still fails after a day is stopped, with a reason.
- **Waking.** `events_notify` already runs once per stream per push. It
  now also posts to `/api/internal/poke` with `pg_net` when the
  organization has a running webhook. The DO's alarm waits three seconds,
  so a recording session becomes one delivery per language and kind, not
  one per take. The Worker's ten-minute cron pokes every such organization
  in case a poke was lost.
Rejected:
- The DO subscribing to Supabase Realtime: an outbound socket keeps the
  object awake around the clock, needs a channel per language, and still
  needs a poll when it drops.
- A Worker cron alone: a minute or more late, and Workers cron cannot run
  more often.
- Webhook payloads with content or audio links: links expire, and
  permissions must be checked when the data is read, not when it is sent.
Reverse if:
- digesting a large language on each look shows up in the DO's CPU (then
  compare only the units the new events touch);
- partners need delivery order or exactly-once (then a queue per webhook);
- the feed is wanted from before a language's first look (then derive it
  from the log itself).
