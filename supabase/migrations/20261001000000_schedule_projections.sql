-- Run the projection worker every five minutes, as code. It used to be
-- scheduled by hand with server/schedule-projections.sql (done in
-- production on 2026-10-01, after nothing had ever run there), so any other
-- database built from this repository lacked it. This is the same job; on
-- production it replaces the one made by hand.
--
-- The worker is the partition-projections Edge Function. Its URL and the
-- secret it checks come from Vault (langquest_project_url,
-- langquest_projection_worker_secret; the function's PROJECTION_WORKER_SECRET
-- holds the same value). Where they are not set (a local database, a
-- preview branch) nothing is scheduled. Unscheduling by name first makes
-- this safe to run again and leaves exactly one job.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'langquest-partition-projections';
  if not exists (select 1 from vault.decrypted_secrets where name = 'langquest_project_url')
     or not exists (select 1 from vault.decrypted_secrets where name = 'langquest_projection_worker_secret') then
    raise notice 'Projection worker not scheduled: the LangQuest Vault secrets are not set in this database.';
    return;
  end if;
  perform cron.schedule(
    'langquest-partition-projections',
    '*/5 * * * *',
    $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets
        where name = 'langquest_project_url') || '/functions/v1/partition-projections',
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
