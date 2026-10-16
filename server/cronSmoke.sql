-- The scheduled jobs (decision 42): the projection pass and push delivery,
-- created by the schedule migration where the Vault secrets exist. A reset
-- leaves neither, so scripts/db-test.mjs sets the secrets and runs the
-- migration before this file; it cleans up after itself. The Inbox purge
-- (decision 122) needs no secret: its migration schedules it, so a reset
-- keeps it and so does the clean-up here.
\set ON_ERROR_STOP on

do $$ declare j record; begin
  for j in select * from (values
    ('langquest-stream-projections', '*/5 * * * *', '/functions/v1/stream-projections'),
    ('langquest-push-delivery', '* * * * *', '"task":"pushes"'),
    ('langquest-purge-notifications', '17 3 * * *', 'delete from public.notifications')
  ) as t(name, schedule, fragment) loop
    if (select count(*) from cron.job where jobname = j.name) <> 1 then raise exception 'expected exactly one cron job %', j.name; end if;
    if (select schedule from cron.job where jobname = j.name) <> j.schedule then raise exception 'cron job % has schedule %', j.name, (select schedule from cron.job where jobname = j.name); end if;
    if (select command from cron.job where jobname = j.name) not like '%' || j.fragment || '%' then raise exception 'cron job % does not call %', j.name, j.fragment; end if;
    if not (select active from cron.job where jobname = j.name) then raise exception 'cron job % is inactive', j.name; end if;
  end loop;
  if (select count(*) from cron.job where jobname like 'langquest-%') <> 3 then raise exception 'unexpected langquest cron jobs: %', (select string_agg(jobname, ', ') from cron.job where jobname like 'langquest-%'); end if;
end $$;

-- Leave the database as a reset does.
select cron.unschedule(jobid) from cron.job where jobname in ('langquest-stream-projections', 'langquest-push-delivery');
delete from vault.secrets where name in ('langquest_project_url', 'langquest_projection_worker_secret');
