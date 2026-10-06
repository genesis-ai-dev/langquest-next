-- Run the projection worker every five minutes, as code (decision 42). npm
-- run secrets runs this file again after setting the Vault secrets, so it
-- must stay safe to run twice: unscheduling by name first leaves exactly one
-- job. The old job name is unscheduled too.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- The stream-projections Edge Function. Its URL and secret come from Vault
-- (langquest_project_url, langquest_projection_worker_secret; set by
-- npm run secrets). Where they are not set (a local database, a preview
-- branch) nothing is scheduled.

do $$
begin
  perform cron.unschedule(j.jobid) from cron.job j
    where j.jobname in ('langquest-stream-projections', 'langquest-project-projections');
  if not exists (select 1 from vault.decrypted_secrets where name = 'langquest_project_url')
     or not exists (select 1 from vault.decrypted_secrets where name = 'langquest_projection_worker_secret') then
    raise notice 'Projection worker not scheduled: the LangQuest Vault secrets are not set in this database.';
    return;
  end if;
  perform cron.schedule(
    'langquest-stream-projections',
    '*/5 * * * *',
    $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets
        where name = 'langquest_project_url') || '/functions/v1/stream-projections',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets
          where name = 'langquest_projection_worker_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 180000
    );
    $job$
  );
end $$;
