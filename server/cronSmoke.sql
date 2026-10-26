-- The scheduled jobs (decision 42): push delivery, which calls the Edge
-- Function push-delivery, created by the schedule migration where the Vault
-- secrets exist. The projection pass is never on pg_cron: it runs in the
-- app's Worker's job container, on a local stack too (decisions.md 141,
-- 148). A reset
-- leaves neither, so scripts/db-test.mjs sets the secrets and runs the
-- migration before this file; it cleans up after itself. The Inbox purge
-- (decision 122) and the purge of cron's own run history need no secret:
-- their migrations schedule them, so a reset keeps them and so does the
-- clean-up here. Push delivery calls the function only when
-- push_work_waiting() says something is waiting.
\set ON_ERROR_STOP on

do $$ declare j record; begin
  for j in select * from (values
    ('langquest-push-delivery', '* * * * *', '/functions/v1/push-delivery'),
    ('langquest-purge-cron-history', '41 3 * * *', 'delete from cron.job_run_details'),
    ('langquest-purge-notifications', '17 3 * * *', 'delete from public.notifications')
  ) as t(name, schedule, fragment) loop
    if (select count(*) from cron.job where jobname = j.name) <> 1 then raise exception 'expected exactly one cron job %', j.name; end if;
    if (select schedule from cron.job where jobname = j.name) <> j.schedule then raise exception 'cron job % has schedule %', j.name, (select schedule from cron.job where jobname = j.name); end if;
    if (select command from cron.job where jobname = j.name) not like '%' || j.fragment || '%' then raise exception 'cron job % does not call %', j.name, j.fragment; end if;
    if j.name = 'langquest-push-delivery' and (select command from cron.job where jobname = j.name) not like '%push_work_waiting()%' then raise exception 'push delivery is called when nothing is waiting'; end if;
    if not (select active from cron.job where jobname = j.name) then raise exception 'cron job % is inactive', j.name; end if;
  end loop;
  if exists (select 1 from cron.job where jobname = 'langquest-stream-projections') then raise exception 'the projection pass is scheduled on pg_cron; it runs in the job container'; end if;
  if (select count(*) from cron.job where jobname like 'langquest-%') <> 3 then raise exception 'unexpected langquest cron jobs: %', (select string_agg(jobname, ', ') from cron.job where jobname like 'langquest-%'); end if;
end $$;

-- Leave the database as a reset does.
select cron.unschedule(jobid) from cron.job where jobname in ('langquest-stream-projections', 'langquest-push-delivery');
delete from vault.secrets where name in ('langquest_project_url', 'langquest_push_delivery_secret');
