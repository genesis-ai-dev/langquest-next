# 160. Staff see LangQuest's operations on one signed-in page, a Worker of its own that reads diagnostics as diag_reader

Date: 2026-10-22 · By: Caleb Koster · Status: accepted

Reason: Caleb asked (2026-10-19) for one web page, behind credentials,
that shows everything going on with LangQuest's operations: client issues
and every service involved, Cloudflare, Supabase, Vercel and the rest.
Field diagnostics (39) and the server's job runs (112) already held most of
it, but only `npm run diag` on a laptop could read them, and no one looked
at the services' own dashboards together: every Workers Build failed from
2026-10-16 to 10-19, and no page showed it. Chosen:
- **A Worker of its own**, `langquest-next-admin` on `admin.langquest.org`
  (`apps/admin`, `docs/admin.md`), not routes on the app's Worker: the
  read tokens and keys it holds for Cloudflare, Supabase, Vercel, GitHub,
  Expo, Google Play and App Store Connect never sit on the Worker that
  answers the public, and the app Worker's
  static assets answer `/` on every host before the Worker runs. It has no
  preview copy.
- **It reads `diag` as `diag_reader`** (its existing login,
  `DIAG_DATABASE_URL`) over a Postgres connection, one read-only
  transaction per statement, with the `postgres` driver (no dependencies;
  the Worker is its only user). Not the service-role key: diag_reader can
  read `diag` and call its report functions and nothing else, so the page
  cannot write or see content, and no migration was needed.
- **Who may open it**: a LangQuest sign-in, checked with Supabase Auth on
  every call, whose profile id is in `ADMIN_PROFILE_IDS`. The list is kept
  encrypted in `.env.production` with the provider tokens (the repository
  is public); each token is optional and named `ADMIN_*` so none stands in
  for a CLI's own login. A section without its token says what to add.
- **The content rule of 39 holds**: ids, counts, timings and codes; no
  names, emails or usernames from any service, and logs only counted.
  Store reviews are shown without the reviewer's name, being public.
Reverse if: staff need to act from the page (mark feedback, retry a job),
which needs a writer's key and its own decision; or the list of staff
grows past a few people, when it belongs in the database or behind
Cloudflare Access instead of a secret.

Amended (2026-10-22, Carl Sauder): the page is served at
`next.langquest.org/ops-dashboard`, its API at `/ops/api/*`, not on
`admin.langquest.org`. Carl wanted it beside the app, on its host, under a
name nobody takes for a public status page (`/status` was weighed and
dropped for that reason). It stays a Worker of its own, for the reason
above, but without an address of its own: the app's Worker hands it those
paths through a service binding (`OPS`, `apps/web/worker/ops.ts`) and lists
them in `run_worker_first`, so the app's page never answers them, and the
admin Worker cannot be reached any other way. A Workers route on the app's
host would have done it without touching the app's Worker, but it relies on
routes running before a custom domain, which nothing in the repository
states. Still no preview copy: preview has no database of its own for it to
read, and the app's preview Worker answers 503 there. Plan:
`docs/ops-dashboard-plan.md`.

Amended (2026-10-22, Carl Sauder): who may open it is Global Viewers (158)
on a session verified with their authenticator, not `ADMIN_PROFILE_IDS`.
Carl chose it (2026-10-21) because Global Viewers already are LangQuest's
staff accounts: granted on a call by `npm run global-viewer`, with a second
factor and a revoke that signs them out everywhere, where the list was a
secret that needed a commit and a secrets push for each person and let in a
password alone. Each API call asks the database, as the person,
`get_user_state()` and lets in only `globalViewer: 'on'`, remembered for 30
seconds per isolate. The page asks for the authenticator code itself, and
reads (never renews) the web app's session on the same host when it is
already `aal2`. This supersedes the reverse-if about the list growing.

Amended (2026-10-23, Carl Sauder): the Worker reaches the database through
Cloudflare Hyperdrive (the `DIAG` binding, config `langquest-next-diag`,
caching off), not with `DIAG_DATABASE_URL` as its own secret. In
production every database section stayed on "Loading…": the Workers
runtime could not finish TLS with Supabase's pooler or its direct host,
with `postgres` or `pg`, while the same login answered from a laptop in
under two seconds. Hyperdrive holds the TLS connection outside the
Worker, which talks to it in plain text inside Cloudflare; it is included
in the Workers Paid plan. Caching is off because the page shows live
counts. The login now lives in the Hyperdrive config, which cannot be read
back: `npm run secrets -- production` makes or updates it from
`DIAG_DATABASE_URL` and writes its id into `apps/admin/wrangler.jsonc`
(not a secret). Each request also gives up after 25 seconds on the
server and 60 in the page, so a database that does not answer shows an
error instead of Loading. Locally the binding's `localConnectionString`
is the local database, so the page uses the same path everywhere.

Amended (2026-10-26, Carl Sauder): the web app's Global Viewer screen links
to the page ("Operations dashboard", above the organization search), opening
it in a new tab on the same host, where it reads the web app's verified
session. Carl asked for it (2026-10-26) now that the page is in place; the
staff who may open it are the Global Viewers. Phones do not show the link, since their browser would not share the app's
session.
