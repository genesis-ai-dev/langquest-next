-- Resolved lines on the ops dashboard (migration 20261124013000_ops_line_resolves.sql): the dashboard's
-- Worker keeps a resolve, the watch ends it when the line goes, an admin shows it again, diag_reader reads
-- the open ones with the admin's display name; nobody signed in reads or writes them. Run by
-- `npm run db:test`. Every write rolls back.
\set ON_ERROR_STOP on
begin;

insert into public.profiles (id, display_name) values ('0e000000-0000-0000-0000-0000000000ac', 'Resolving Admin');

do $$ declare
  v jsonb; n int;
begin
  n := public.ops_line_resolve(jsonb_build_array(
    jsonb_build_object('line', 'usage-billed:R2 class A operations', 'part', 'capacity', 'level', 'watch', 'measure', 20.25,
      'title', 'R2 class A operations this month are past what the plan includes'),
    jsonb_build_object('line', 'job-stopped:projection', 'part', 'jobs', 'level', 'problem', 'title', 'projection stopped')),
    '0e000000-0000-0000-0000-0000000000ac');
  assert n = 2, 'two lines resolved';
  v := diag.ops_line_resolves();
  assert jsonb_array_length(v) = 2, 'both resolves are open';
  assert (select e->>'who' from jsonb_array_elements(v) e where e->>'line' = 'job-stopped:projection') = 'Resolving Admin', 'the dashboard names who resolved it';
  assert (select (e->>'measure')::numeric from jsonb_array_elements(v) e where e->>'line' like 'usage-billed:%') = 20.25, 'the measure is kept';

  -- Resolved again (it came back): one open resolve for the line, the new one.
  perform public.ops_line_resolve(jsonb_build_array(jsonb_build_object('line', 'job-stopped:projection', 'part', 'jobs', 'level', 'urgent', 'title', 'projection stopped')),
    '0e000000-0000-0000-0000-0000000000ac');
  assert (select count(*) from ops.line_resolves where line = 'job-stopped:projection' and ended_at is null) = 1, 'one open resolve for a line';
  assert (select count(*) from ops.line_resolves where line = 'job-stopped:projection' and ended = 'again') = 1, 'the old one ended as resolved again';

  -- The watch sees the page: jobs answered without the line, capacity did not answer.
  n := public.ops_line_resolves_seen(array['db-connections'], array['jobs', 'database']);
  assert n = 1, 'the line that went from a part that answered ends';
  assert (select ended from ops.line_resolves where line = 'job-stopped:projection' order by at desc limit 1) = 'gone', 'it ended as gone';
  assert exists (select 1 from ops.line_resolves where line like 'usage-billed:%' and ended_at is null), 'a part that did not answer keeps its resolves';
  n := public.ops_line_resolves_seen(array['usage-billed:R2 class A operations'], array['capacity']);
  assert n = 0, 'a line still there stays resolved';

  -- Shown again by an admin.
  assert public.ops_line_show(array['usage-billed:R2 class A operations'], '0e000000-0000-0000-0000-0000000000ac') = 1, 'shown again';
  assert jsonb_array_length(diag.ops_line_resolves()) = 0, 'nothing is resolved now';
  assert public.ops_line_show(array['usage-billed:R2 class A operations'], '0e000000-0000-0000-0000-0000000000ac') = 0, 'showing it twice changes nothing';

  begin
    perform public.ops_line_resolve(jsonb_build_array(jsonb_build_object('line', 'Not A Line', 'part', 'jobs', 'level', 'watch', 'title', 'x')), '0e000000-0000-0000-0000-0000000000ac');
    raise exception 'a line that is not a line id was kept';
  exception when check_violation then null;
  end;
  begin
    perform public.ops_line_resolve(jsonb_build_array(jsonb_build_object('line', 'job-stopped:x', 'part', 'jobs', 'level', 'bad', 'title', 'x')), '0e000000-0000-0000-0000-0000000000ac');
    raise exception 'a level off the list was kept';
  exception when check_violation then null;
  end;
end $$;

insert into ops.actions (profile_id, action, target, result, detail)
values ('0e000000-0000-0000-0000-0000000000ac', 'line_resolved', 'usage-billed:R2 class A operations', 'ok', 'lines:1'),
       ('0e000000-0000-0000-0000-0000000000ac', 'line_shown', 'usage-billed:R2 class A operations', 'ok', 'lines:1');
-- The names that were on the list before are on it still.
insert into ops.actions (profile_id, action, target, result, detail)
values ('0e000000-0000-0000-0000-0000000000ac', 'card_question', 'line:x', 'ok', null);

grant diag_reader to postgres;
set local role diag_reader;
do $$ begin
  assert jsonb_typeof(diag.ops_line_resolves()) = 'array', 'diag_reader reads the resolves';
  begin
    perform 1 from ops.line_resolves;
    raise exception 'diag_reader read the table directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
do $$ begin
  begin
    perform diag.ops_line_resolves();
    raise exception 'authenticated read the resolves';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ops_line_resolve('[]'::jsonb, '0e000000-0000-0000-0000-0000000000ac');
    raise exception 'authenticated resolved';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ops_line_resolves_seen(array['x'], array['jobs']);
    raise exception 'authenticated ended resolves';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
