# 254. The ops dashboard opens on what needs a person, and draws every range of days from totals by hour and day that pg_cron keeps for all time

Date: 2026-11-17 · By: Caleb Koster · Status: accepted

Reason: the ops dashboard (160, 161) shows 34 parts as lists of numbers, and
each read scans up to 14 days of raw records, which cannot hold at tens of
thousands of phones and keeps nothing past the 90 days raw records live.
Caleb compared four designs (thread "Show visual concepts for the ops
dashboard") and picked "What needs you first" on 2026-11-17: the page opens on
a count and a card for each thing that needs a person, and each part with no
alert is one OK line. He asked that all other data stay reachable (14 days and
more), that any square, bar or point open its technical detail, and that the
pictures scale to tens of thousands of people and more over a long time
(`docs/ops-dashboard-plan.md` 5.0). Decided:
- **Pictures read totals, never raw records.** `diag.hourly` (kept 14 days,
  for the 24 h range), `diag.daily` (kept for all time) and `diag.monthly`
  (the days again by month, for All) hold one row for each number of each
  part, each key and each hour, day or month (migration
  `20261117060000_diag_daily.sql`). A number keeps its 30 largest keys a day
  and adds the rest up as `_other`, so a flood of new error kinds cannot grow
  the table without end. `GET /ops/api/<part>?range=24h|14d|90d|1y|all`
  (`diag.ops_series`) reads them in buckets of an hour, a day, a day, a week
  and a month; a week or a month sums a count and shows a level (phones that
  reported, a size, a p95) at its busiest day (`diag.daily_metrics`). With
  40,000 installs and 3 years of totals each call took 7 to 170 ms
  (`server/dailyTotalsLoad.sql`). A part's whole history read from the days
  took 490 to 590 ms, so All reads the months: about 40 ms, one row a month
  however many years.
- **pg_cron fills them, in the database, not the job container.** Every
  number comes from tables in the same database (`diag.records`,
  `diag.job_runs`, accounts, invites, feedback, `cron.job_run_details`), so
  `diag.daily_fill` (`langquest-daily-totals`, every 10 minutes) needs no
  secret and no network, a database reset keeps it, and it records a
  `daily_totals` job run so a stopped fill shows as stale. Each run counts
  the hour now and the one before, today and yesterday once an hour (late
  arrivals land in yesterday), and two days and 24 hours never counted,
  newest first: the 90 days of raw records that exist on the day it lands
  are counted within a few hours. A day's fill at 40,000 installs, 1.2
  million records, takes about 10 s, and each hour counts two (today and
  yesterday).
- **Counts only, so raw retention stays 90 days.** A row is a count or a
  level for the whole fleet by platform, job, error kind, route or update,
  never an install id, a profile id, a name or an email
  (`server/dailyTotalsSmoke.sql` checks it). `diag.prune`, the privacy
  policy's 90 and 180 days and the Play answers are unchanged.
Reverse if: a year by week passes 500 ms (add weekly totals), a fill passes 10 minutes at the fleet's size (fill the day from the
hours), or a number needs a breakdown by install or person, which belongs in
the detail panel's raw records and never in totals.
