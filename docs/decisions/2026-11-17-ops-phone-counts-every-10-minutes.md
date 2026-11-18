# The ops dashboard's two reads that grow with phones are counted by the database every 10 minutes, from each kind's index and two small tables kept for each install

Date: 2026-11-17 · By: Caleb Koster · Status: accepted

Reason: Caleb asked that the dashboard keep working at tens of thousands of
people (decisions.md 254). At 40,000 installs with a week of records (8.4 million, seeded
locally), "What installs report" took 19 s and "Builds in the field" 33 s, past
the Worker's 15 s statement limit, so both showed "Could not read". Each read
every record of 7 or 14 days, of every kind, into one list first. Decided:
- **Each kind through its index.** `diag.ops_clients()` and `diag.ops_fleet()`
  (migration `20261117200000_ops_phone_counts.sql`) hold the page's SQL, with
  each kind of record read on its own through `diag_records_kind_idx`.
- **Two small tables, kept as records arrive.** `diag.install_updates` (each
  install and each update it ran: first and last seen, last crash; 90 days)
  and `diag.install_device` (each install's last device record; 7 days) take
  the records since the last count. A build's installs and crashes and the
  stuck phones come from them: "Builds in the field" takes 0.2 s. A build's
  first seen is now its first record in 90 days, not in 14.
- **Counted every 10 minutes.** `diag.ops_cache_fill()` (pg_cron
  `langquest-ops-counts`, job `ops_counts`, so a stopped count shows in Server
  jobs) stores both in `diag.ops_cache`. The page reads `diag.ops_cached`: 1 ms
  and 25 ms at 40,000 installs, with "Counted at" under each. A count takes
  about 10 s there, where a tenth of all records are errors; most of it is the
  week's errors and sign-in failures.
- **No install id is kept.** The cache holds counts and update ids. The stuck
  phones are read at once from `diag.install_device`. Both tables go with
  their install (cascade), and a deleted account's records take what they
  said (trigger `diag_records_forget_facts`).
- **A test holds the old answer.** `server/opsCountsSmoke.sql` keeps the
  page's SQL as it was and fails when the new reads answer differently.
Reverse if: a count passes 60 s (then count the week's errors and sign-in
failures as they arrive, as `diag.install_updates` does), or a part of the
page must be fresher than 10 minutes.
