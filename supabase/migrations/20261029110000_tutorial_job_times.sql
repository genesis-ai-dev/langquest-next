-- The tutorial jobs run in the hour when the fewest people on earth are at
-- work, 23:00 to 00:00 UTC (decisions.md 183, amended 2026-10-29): the intake
-- at 23:10 UTC, after the nightly filming on GitHub from 20:10, and the
-- publish job's daily run at 23:40 UTC (apps/web/worker/jobsModel.ts).
update diag.job_schedule
  set runs_on = 'Cloudflare container behind the app Worker (23:10 UTC, after the nightly filming on GitHub)'
  where job = 'tutorial_intake';
update diag.job_schedule
  set runs_on = 'Cloudflare container behind the app Worker (Publish on the ops dashboard, and 23:40 UTC)'
  where job = 'tutorial_publish';
