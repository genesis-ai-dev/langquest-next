-- Push delivery's secret is named for push delivery (decisions.md 148): the
-- Vault secret langquest_projection_worker_secret becomes
-- langquest_push_delivery_secret, and the Edge Function's
-- PROJECTION_WORKER_SECRET becomes PUSH_DELIVERY_SECRET. Nothing else ever
-- read it once the projection pass left pg_cron (decisions.md 141).
--
-- The Vault secret is renamed in place, keeping its value, so the job keeps
-- matching the function, which accepts the old name until `npm run secrets`
-- sets the new one (server/pushDeliveryEdge.ts). Where both exist (npm run
-- secrets already wrote the new one), the old one goes.
--
-- This replaces 20261020160000_push_delivery_function.sql as the schedule
-- npm run secrets runs again after setting the Vault secrets, and
-- scripts/local-db.mjs after a reset (scripts/secrets.mjs
-- SCHEDULE_MIGRATION), so it must stay safe to run twice.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
declare
  old_id uuid := (select id from vault.secrets where name = 'langquest_projection_worker_secret');
  new_id uuid := (select id from vault.secrets where name = 'langquest_push_delivery_secret');
begin
  if old_id is not null and new_id is null then
    perform vault.update_secret(old_id, new_name => 'langquest_push_delivery_secret');
  elsif old_id is not null then
    delete from vault.secrets where id = old_id;
  end if;
end $$;

do $$
begin
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
    );
  $job$);
end $$;
