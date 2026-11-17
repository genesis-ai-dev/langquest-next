# 255. A tapped bucket lists its raw records through one stored filter for each number, which a test holds equal to the totals' own count

Date: 2026-11-17 · By: Caleb Koster · Status: accepted

Reason: Caleb asked that any square, bar or point on the ops dashboard open
the technical detail behind it (254). Totals hold no ids, so that detail can
only come from the raw records, which live 90 days. Each number counts its
records with its own filter (`diag.daily_compute`), and the list behind a bar
must show the same records the bar counted. Decided:
- **One call for a bucket.** `GET /ops/api/<part>/detail?metric=&key=&from=&to=&page=`
  (`diag.ops_detail`, migration `20261117143000_ops_detail.sql`) lists the
  records behind one number in one bucket of at most 32 days, 50 a page,
  newest first. A bucket older than 90 days says it keeps totals only; one
  that starts before then lists from 90 days ago and says so. People are
  counted, never listed, so their numbers have no rows.
- **Filters are rows, run as dynamic SQL.** `diag.detail_filters` holds each
  records or job-runs number's filter and key as SQL text, copied from
  `daily_compute`. `diag.ops_detail_rows` runs that text with `format()`,
  with the key, the bucket and the page as parameters. A security definer
  function that picks its filter with `case` cannot use an index, and two
  indexes (records by kind and time, and refused syncs) only help a query
  that names its filter. At 40,000 installs a day's bucket took 5 to 460 ms
  (`server/dailyTotalsLoad.sql`). Nobody can write the table; `diag_reader`
  can run `ops_detail` and `ops_glance` and nothing under them.
- **A test holds the two copies equal.** `server/opsDetailSmoke.sql` counts
  every kept key of every such number both ways, through its filter and from
  the daily totals, and fails when they differ. It also checks that no row
  holds a feedback body, a name, an email or a report's details.
- **The start page reads one call.** `GET /ops/api/glance`
  (`diag.ops_glance`) gives the last 14 days of one number for each section,
  for its small pictures: 2 ms.
Reverse if: a bucket's list passes 500 ms (add an index for that number), or
the two copies of a filter drift often enough that `daily_compute` should
read its filters from `diag.detail_filters` too.
