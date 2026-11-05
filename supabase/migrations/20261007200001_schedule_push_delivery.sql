-- Two jobs, as code (decision 42): the projection pass every five minutes,
-- and push delivery every minute, so a join request or report (whose Inbox
-- rows the database makes at once, decisions.md 68) reaches an admin's phone
-- within a minute. Both call the stream-projections Edge Function; the body
-- says which. npm run secrets and scripts/local-db.mjs run this file again
-- after setting the Vault secrets (SCHEDULE_MIGRATION), so it must stay safe
-- to run twice: unscheduling by name first leaves exactly one of each. It
-- replaces 20261006000001_schedule_projections.sql in that role.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
declare job record;
begin
  perform cron.unschedule(j.jobid) from cron.job j
    where j.jobname in ('langquest-stream-projections', 'langquest-push-delivery');
  if not exists (select 1 from vault.decrypted_secrets where name = 'langquest_project_url')
     or not exists (select 1 from vault.decrypted_secrets where name = 'langquest_projection_worker_secret') then
    raise notice 'Projection worker not scheduled: the LangQuest Vault secrets are not set in this database.';
    return;
  end if;
  for job in select * from (values
    ('langquest-stream-projections', '*/5 * * * *', '{}'),
    ('langquest-push-delivery', '* * * * *', '{"task":"pushes"}')
  ) as j(name, schedule, body) loop
    perform cron.schedule(job.name, job.schedule, format($job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets
          where name = 'langquest_project_url') || '/functions/v1/stream-projections',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets
            where name = 'langquest_projection_worker_secret')
        ),
        body := %L::jsonb,
        timeout_milliseconds := 180000
      );
    $job$, job.body));
  end loop;
end $$;
