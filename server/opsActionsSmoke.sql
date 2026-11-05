-- The ops dashboard's actions log (migration *_ops_actions.sql, decisions.md
-- 153): only the service role writes it, diag_reader reads it through
-- diag.ops_actions, and a row holds ids and codes only. Run by
-- `npm run db:test`. Every write rolls back.
\set ON_ERROR_STOP on
begin;

-- The app's Worker records an action as the service role.
set local role service_role;
select public.ops_record_action('0d000000-0000-0000-0000-0000000000aa', 'run_job', 'projection', 'ok', 'started');
select public.ops_record_action('0d000000-0000-0000-0000-0000000000aa', 'feedback_done', '11111111-1111-4111-8111-111111111111', 'refused', 'not_found');
reset role;

do $$ begin
  -- A detail that is not a code, or an action not on the list, is refused.
  begin
    perform public.ops_record_action('0d000000-0000-0000-0000-0000000000aa', 'run_job', 'projection', 'ok', 'a sentence with spaces');
    raise exception 'free text was accepted as detail';
  exception when check_violation then null;
  end;
  begin
    perform public.ops_record_action('0d000000-0000-0000-0000-0000000000aa', 'suspend_account', 'x', 'ok', null);
    raise exception 'an action off the list was accepted';
  exception when check_violation then null;
  end;
end $$;

-- diag_reader reads the latest, newest first, and cannot touch the table or write.
grant diag_reader to postgres;
set local role diag_reader;
do $$ declare v jsonb := diag.ops_actions(5); begin
  assert jsonb_typeof(v) = 'array', 'ops_actions is an array';
  assert v->0->>'action' in ('run_job', 'feedback_done'), 'ops_actions has the rows';
  assert (select count(*) from jsonb_object_keys(v->0)) = 6, 'ops_actions returns at, profileId, action, target, result, detail';
  begin
    perform 1 from ops.actions;
    raise exception 'diag_reader read ops.actions directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ops_record_action('0d000000-0000-0000-0000-0000000000aa', 'run_job', 'projection', 'ok', null);
    raise exception 'diag_reader wrote an action';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Nobody signed in may write or read it.
set local role authenticated;
do $$ begin
  begin
    perform public.ops_record_action('0d000000-0000-0000-0000-0000000000aa', 'run_job', 'projection', 'ok', null);
    raise exception 'authenticated wrote an action';
  exception when insufficient_privilege then null;
  end;
  begin
    perform diag.ops_actions(5);
    raise exception 'authenticated read the actions';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
