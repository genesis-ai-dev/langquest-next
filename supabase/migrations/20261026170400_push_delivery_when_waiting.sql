-- Push delivery calls its Edge Function only when something is waiting, and
-- pg_cron's run history is kept for a week (performance-audit-2026-10-26.md
-- item 11). Every minute the job used to post to the function, which
-- claimed nothing on most of them: 1,440 invocations and run-detail rows a
-- day. Now each minute asks push_work_waiting() first (a notification a
-- claim could take, or a push receipt old enough to read) and posts only if
-- so. Nothing deleted cron.job_run_details; a daily job drops rows over
-- seven days old (diag.ops_cron reads recent runs only).
--
-- This replaces 20261020170000_push_delivery_secret.sql as the schedule
-- npm run secrets runs again after setting the Vault secrets, and
-- scripts/local-db.mjs and scripts/db-test.mjs after a reset
-- (scripts/secrets.mjs SCHEDULE_MIGRATION), so it must stay safe to run
-- twice. The Vault secrets' rename stays in that file; it has run
-- everywhere this one can.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- The job no longer runs every minute whatever happens, so the dashboard
-- must not call it late: like the webhook dispatch, it runs when there is work.
update diag.job_schedule set every = null, slack = interval '0',
  runs_on = 'Edge Function push-delivery (pg_cron, each minute something is waiting)'
  where job = 'push_delivery';

do $$
begin
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'langquest-purge-cron-history';
  perform cron.schedule('langquest-purge-cron-history', '41 3 * * *', $job$
    delete from cron.job_run_details where end_time < now() - interval '7 days';
  $job$);

  perform cron.unschedule(j.jobid) from cron.job j
    where j.jobname in ('langquest-stream-projections', 'langquest-push-delivery');
  if not exists (select 1 from vault.decrypted_secrets where name = 'langquest_project_url')
     or not exists (select 1 from vault.decrypted_secrets where name = 'langquest_push_delivery_secret') then
    raise notice 'Push delivery not scheduled: the LangQuest Vault secrets are not set in this database.';
    return;
  end if;
  perform cron.schedule('langquest-push-delivery', '* * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets
        where name = 'langquest_project_url') || '/functions/v1/push-delivery',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets
          where name = 'langquest_push_delivery_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 180000
    )
    where public.push_work_waiting();
  $job$);
end $$;
