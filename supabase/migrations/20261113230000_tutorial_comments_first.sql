-- The comments on the tutorial videos are read first in YouTube's day
-- (apps/web/worker/jobsModel.ts, decisions.md 186 amended 2026-11-13): at
-- midnight in California, before the intake and the uploads after it use up
-- the day's units. Read at 23:50 UTC, the job found none left on 4 to 9
-- November 2026 and read 0 to 11 of the 16 channels. The ops dashboard
-- shows where and when each job runs.
update diag.job_schedule
  set runs_on = 'Cloudflare container behind the app Worker (00:00 Pacific, first in YouTube''s day, before the uploads)'
  where job = 'tutorial_comments';
