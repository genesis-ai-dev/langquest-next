-- One projection pass, every language, in the job container behind the
-- dashboard Worker, started by its job tick every five minutes
-- (decisions.md 141). The Edge Function keeps push delivery, every minute
-- (decisions.md 68). This replaces 20261007200001_schedule_push_delivery.sql
-- as the schedule npm run secrets runs again after setting the Vault
-- secrets (scripts/secrets.mjs SCHEDULE_MIGRATION), so it must stay safe to
-- run twice: unscheduling by name first leaves exactly one push job and no
-- projection job. A local stack schedules its own projection job every
-- minute afterwards (scripts/local-db.mjs), since wrangler dev fires no cron.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  perform cron.unschedule(j.jobid) from cron.job j
    where j.jobname in ('langquest-stream-projections', 'langquest-push-delivery');
  if not exists (select 1 from vault.decrypted_secrets where name = 'langquest_project_url')
     or not exists (select 1 from vault.decrypted_secrets where name = 'langquest_projection_worker_secret') then
    raise notice 'Push delivery not scheduled: the LangQuest Vault secrets are not set in this database.';
    return;
  end if;
  perform cron.schedule('langquest-push-delivery', '* * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets
        where name = 'langquest_project_url') || '/functions/v1/stream-projections',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets
          where name = 'langquest_projection_worker_secret')
      ),
      body := '{"task":"pushes"}'::jsonb,
      timeout_milliseconds := 180000
    );
  $job$);
end $$;

-- Where each job runs, for whoever reads a stale flag (diag.jobs()).
insert into diag.job_schedule (job, every, slack, runs_on) values
  ('job_starts', interval '5 minutes', interval '5 minutes', 'Cloudflare Worker langquest-next-dashboard (job tick cron)')
on conflict (job) do update set every = excluded.every, slack = excluded.slack, runs_on = excluded.runs_on;
update diag.job_schedule
  set runs_on = 'Cloudflare container JobRunner projection, from the dashboard Worker''s job tick (apps/web/worker/jobs.ts)',
      every = interval '5 minutes', slack = interval '10 minutes'
  where job = 'projection';
update diag.job_schedule
  set runs_on = 'Cloudflare container JobRunner v2-import, from the dashboard Worker''s job tick (apps/web/worker/jobs.ts)',
      every = interval '15 minutes', slack = interval '30 minutes'
  where job = 'v2_import';
-- Kept for its old runs, never flagged: the one pass is `projection` now.
update diag.job_schedule
  set runs_on = 'retired 2026-10-19: one pass for every language, job projection (decisions.md 141)', every = null
  where job = 'projection_large';
