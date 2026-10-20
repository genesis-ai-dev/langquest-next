-- Where each job runs, as diag.jobs() tells whoever reads a stale flag: the
-- app's Worker, which once served only the reports dashboard and was named
-- for it (decisions.md 144). Described by what it is and its config file,
-- not by its Cloudflare name, so a rename leaves these true.
update diag.job_schedule set runs_on = 'Cloudflare Worker for the app, its ten-minute cron (apps/web/wrangler.jsonc)'
  where job = 'worker_cron';
update diag.job_schedule set runs_on = 'Cloudflare Worker for the app, an organization''s Durable Object (apps/web/worker/agent/dispatch.ts)'
  where job = 'webhook_dispatch';
update diag.job_schedule set runs_on = 'Cloudflare Worker for the app, per isolate, at most once a minute (apps/web/worker/requestTally.ts)'
  where job = 'worker_requests';
update diag.job_schedule set runs_on = 'Cloudflare Worker for the app, its job tick every five minutes (apps/web/worker/index.ts)'
  where job = 'job_starts';
update diag.job_schedule set runs_on = 'Cloudflare container JobRunner projection, from the app Worker''s job tick (apps/web/worker/jobs.ts)'
  where job = 'projection';
update diag.job_schedule set runs_on = 'Cloudflare container JobRunner v2-import, from the app Worker''s job tick (apps/web/worker/jobs.ts)'
  where job = 'v2_import';
