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
