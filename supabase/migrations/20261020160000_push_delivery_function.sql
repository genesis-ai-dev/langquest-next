-- The Edge Function stream-projections is push-delivery now (decisions.md
-- 148): it only sends what the database queued for phones, and the
-- projection pass runs in the app's Worker's job container, on a local stack
-- too (decisions.md 141). Push delivery is rescheduled to the new name, every
-- minute (decisions.md 68). This replaces
-- 20261019110000_projection_pass_in_container.sql as the schedule npm run
-- secrets runs again after setting the Vault secrets, and scripts/local-db.mjs
-- after a reset (scripts/secrets.mjs SCHEDULE_MIGRATION), so it must stay safe
-- to run twice: unscheduling by name first leaves exactly one push job and no
-- projection job, which also takes away the Edge pass an older checkout
-- scheduled on a local stack.
--
-- Supabase's GitHub integration applies this before it deploys the new
-- function, so the job's calls fail for about a minute until push-delivery
-- exists; nothing is claimed until it answers, so the rows wait for the
-- next minute.

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
        where name = 'langquest_project_url') || '/functions/v1/push-delivery',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets
          where name = 'langquest_projection_worker_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 180000
    );
  $job$);
end $$;

-- Where push delivery runs, for whoever reads a stale flag (diag.jobs()).
update diag.job_schedule set runs_on = 'Edge Function push-delivery (pg_cron, every minute)'
  where job = 'push_delivery';
