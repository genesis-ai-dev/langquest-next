-- Run after deploying project-projections and configuring matching secrets.
-- Vault secret names: langquest_project_url, langquest_projection_worker_secret.
-- Values belong in Vault, never this file or a client bundle.
-- Requires the pg_cron and pg_net extensions enabled in the hosted project.
do $$ begin
  if not exists(select 1 from vault.decrypted_secrets
    where name='langquest_project_url') or not exists(
    select 1 from vault.decrypted_secrets
    where name='langquest_projection_worker_secret') then
    raise exception 'Configure both LangQuest Vault secrets first';
  end if;
end $$;
select cron.schedule(
  'langquest-project-projections',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
      where name='langquest_project_url') || '/functions/v1/project-projections',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets
        where name='langquest_projection_worker_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 180000
  );
  $job$
);
