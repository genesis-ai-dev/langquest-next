-- The projection pass for large languages runs in a container behind the
-- dashboard Worker, started by its cron (docs/server-jobs.md, decisions.md
-- 134), no longer in GitHub Actions (103). Same job and cadence; the slack
-- shrinks from 30 to 15 minutes, since a Worker cron is not delayed the way
-- GitHub's schedule was.
update diag.job_schedule
  set runs_on = 'Cloudflare container JobRunner, from the dashboard Worker''s cron (apps/web/worker/jobs.ts)',
      every = interval '10 minutes',
      slack = interval '15 minutes'
  where job = 'projection_large';
