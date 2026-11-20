# 144. The Worker in `apps/web` is "the app's Worker"; "dashboard" names it only as history

Date: 2026-10-20 · By: Carl Sauder · Status: accepted

Reason: the Worker began as the web dashboard's server (decisions 40, 43,
44) and was named for it, `langquest-next-dashboard`. It now serves the web
app (58), the reports API, recordings and guide media (69), the access-token
API and MCP (70), review links and webhooks (72, 101), and runs the server's
jobs in containers (141). Calling it the dashboard misleads; Carl asked
(2026-10-20) for every leftover to go. Code, docs and the job schedule's
descriptions (migration `20261020100000_job_schedule_names_the_app_worker.sql`)
now say "the app's Worker", the name decision 69 already used, and
`scripts/secrets.mjs` calls it `app`. The one place people saw the word,
Reports' message for a 502, says "The server could not read this
organization just now" in all 15 catalogs. Past entries keep "dashboard":
the log is never rewritten. The Vault key `langquest_dashboard_url` stays,
since it holds the domain, not the name, and renaming it would change two
database functions for nothing.
The Cloudflare names (`langquest-next-dashboard`, its `-preview` copy and
the container application `langquest-next-dashboard-jobrunner`) are not
changed by this entry. A Worker's name is its identity: a renamed Worker is
a new one, and its Durable Objects start empty. The organization objects'
SQLite holds the change feed's numbering, each webhook's position in it,
the outbox and the delivery history (101), which partners rely on. Keeping
that state across a rename needs Cloudflare's transfer handoff (`exports`,
about five deploys by hand, not documented for a class with a container);
a fresh Worker would restart the feed for every partner. Which of those, if
either, is Carl's call; `docs/cloudflare.md` says why the name is old.
Reverse if: never for the words. The Cloudflare names change when a rename
path is chosen; then amend this entry and rename to `langquest-next`, which
matches the domain.

Amended (2026-10-20, Carl Sauder): the Cloudflare names change too, to a
fresh Worker `langquest-next` (its preview `langquest-next-preview`, its
container application `langquest-next-jobrunner`). The only webhook was
Frontier's own EveryBible prototype site, quiet since 2026-10-16, whose
owner will start its change feed over, so Carl chose a fresh Worker over
the transfer handoff. Organizations' report caches rebuild on first use;
webhook state starts over; the webhooks, the domain, R2, the Vault values
and the database carry on. `docs/cloudflare.md`, "Renaming the app's
Worker", is the cutover; `scripts/cloudflare-deploy.test.ts` holds the name.
