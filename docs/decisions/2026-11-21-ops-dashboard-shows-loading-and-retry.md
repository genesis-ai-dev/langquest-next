# The ops dashboard shows each box loading at once, and a failed box offers Try again

Date: 2026-11-21 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-11-21, thread "Show loading on every dashboard page"):
"when I load the user issues page, and likely other pages, nothing shows up
for a long time and there's no indication that anything is loading. Even
something like a shimmering skeleton effect would be helpful while loading."
Three causes. The page stayed blank (only its title) until the sign-in check
`/ops/api/me` answered, and only then started to read. After that, each box
said "Loading…" in grey text, easy to miss. And User issues comes in the ops
answer, 32 statements on one database connection, each statement four trips
(begin, its timeout, the statement, commit): the database itself answers
each in a few milliseconds (measured on production 2026-11-21 with
`explain analyze`: 1 to 49 ms), so the wait was the trips one after
another. PR 586's refresh in place (`redraw`) stays as it is; this is the
first load. Decided (`apps/admin/src/pageLoading.ts`):
- **The page shows at once.** `start()` shows the menu, title and boxes
  before the sign-in check answers, and reads every part at the same time
  as the check. Every API call checks the sign-in on its own, so nothing is
  read that a refused sign-in could see; a refused one hides the page.
- **Each box shimmers where its answer will go**: lines, cards, tiles or a
  chart (`skel`), with a turning mark beside the page's sentence and each
  "Loading…" status. Screen readers hear "Loading". With reduced motion the
  shapes stay still.
- **A failed box says why and offers Try again**, which reads that part
  again at once; numbers and charts too. No box stays empty or stays at
  Loading.
- **While a page still loads, the Overview does not say "Nothing needs
  you"**: that is not known yet.
- **One answer's statements run on 6 connections** (`DIAG_CONNECTIONS` in
  `db.ts`), not one. Hyperdrive pools them toward the database, and a page
  load opens two answers (diag and ops), so at most 12.

Reverse if: the shapes make people think an answer came when it did not, or
Hyperdrive or the database refuses the extra connections (then lower
`DIAG_CONNECTIONS`).

Rejected: a spinner over the whole page (it hides what has come already);
splitting User issues into a call of its own (more code for the same gain
as more connections); caching answers in the browser between visits (old
numbers that look current break "status indicators must tell the truth").

Amended (2026-11-23, Caleb Koster): the ops dashboard said "(EMAXCONNSESSION)
max clients reached in session mode - max clients are limited to
pool_size: 20". Production showed diag_reader with 20 open connections, all
of the pooler's session-mode clients for that login. The Worker closes its
own connections, but Hyperdrive keeps its connections to the pooler open
while idle, and its default limit is above 20. Hyperdrive now keeps at most
10 for diag_reader and 5 for each read-gate login (`--origin-connection-limit`,
set by `npm run secrets -- production`). Hyperdrive queues a statement over
its limit. `DIAG_CONNECTIONS` stays 6. Rejected: moving diag_reader to the
pooler's transaction mode (a change of the login's address in
`.env.production`, and the limit alone stops the failure).

Amended (2026-11-23, Caleb Koster): reverted the limit above. After
`npm run secrets -- production` set it at 17:35Z, no Hyperdrive config
opened a connection to the pooler again (the pooler's log has none from
17:44Z to 18:55Z), every dashboard read and every read-gate read timed out,
and the page showed errors everywhere. `npm run secrets` no longer passes
`--origin-connection-limit`; each config goes back to 100, near Cloudflare's
own default for the plan. The 20-client limit of the pooler's session mode
for diag_reader is open again, to fix another way.

Amended (2026-11-23, Caleb Koster): the limit was not the cause of the
outage. Setting every config back to 100 changed nothing, and Supabase had no
banned addresses. The cause: from 17:35Z the Hyperdrive binding's host was
`<id>.workers.alt`, not `<id>.hyperdrive.local`. `db.ts` and `read.ts` chose
TLS for any host they did not know, so postgres.js asked Hyperdrive for TLS
and waited until CONNECT_TIMEOUT. `plainConnection` in `db.ts` now knows both
host names. The limit stays off.
