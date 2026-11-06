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

-- Quiet installs by account: an account with two quiet phones and one that still reports, one with
-- a browser gone quiet (left out), one with no other device that reports, and one that nothing reports for.
insert into auth.users (id, email) values
  ('0d000000-0000-0000-0000-00000000000a', 'quiet-a@example.org'),
  ('0d000000-0000-0000-0000-00000000000b', 'quiet-b@example.org');
insert into diag.installs (install_id, profile_id, context, last_seen) values
  ('qa-1', '0d000000-0000-0000-0000-00000000000a', '{"os":"android","model":"OnePlus8Pro"}', now() - interval '5 days'),
  ('qa-2', '0d000000-0000-0000-0000-00000000000a', '{"os":"ios"}', now() - interval '6 days'),
  ('qa-3', '0d000000-0000-0000-0000-00000000000a', '{"os":"android","model":"OnePlus8Pro"}', now() - interval '1 hour'),
  ('qa-old', '0d000000-0000-0000-0000-00000000000a', '{"os":"android"}', now() - interval '40 days'),
  ('qb-1', '0d000000-0000-0000-0000-00000000000b', '{"os":"android","model":"Pixel 5"}', now() - interval '4 days'),
  ('qb-2', '0d000000-0000-0000-0000-00000000000b', '{"os":"web"}', now() - interval '1 hour'),
  ('qb-web', '0d000000-0000-0000-0000-00000000000b', '{"os":"web"}', now() - interval '4 days'),
  ('qc-1', 'quiet-alone', '{"os":"android"}', now() - interval '4 days');
do $$ declare v jsonb := diag.ops_quiet_accounts(); before int := (v->>'count')::int; a jsonb; begin
  select x into a from jsonb_array_elements(v->'accounts') x where x->>'profile' = '0d000000-0000-0000-0000-00000000000a';
  assert (a->>'quiet')::int = 2, 'two quiet installs: not the one past 30 days, not the one that reports';
  assert (a->>'reporting')::int = 1, 'one install still reports';
  assert a->'devices' = '{"OnePlus8Pro":1,"ios":1}'::jsonb, 'quiet installs by device, the system where there is no model';
  assert not exists (select 1 from jsonb_array_elements(v->'accounts') x where x->>'profile' = 'quiet-alone'), 'no other device reports: not listed';
  assert (select count(*) from jsonb_array_elements(v->'accounts') x where x->>'profile' = '0d000000-0000-0000-0000-00000000000b') = 1, 'a browser that reports counts as another device';
  assert (select (x->>'quiet')::int from jsonb_array_elements(v->'accounts') x where x->>'profile' = '0d000000-0000-0000-0000-00000000000b') = 1, 'a quiet browser is left out';

  -- Marked: it leaves the list and the count, shows who marked it, and comes back with Undo.
  assert public.ops_quiet_account_mark('0d000000-0000-0000-0000-00000000000a', true, '0d000000-0000-0000-0000-0000000000aa') = 'marked', 'marked';
  assert public.ops_quiet_account_mark('0d000000-0000-0000-0000-00000000000a', true, '0d000000-0000-0000-0000-0000000000aa') = 'marked', 'marking twice is the same';
  v := diag.ops_quiet_accounts();
  assert (v->>'count')::int = before - 2 and (v->>'markedCount')::int = 2, 'its two installs leave the count';
  assert not exists (select 1 from jsonb_array_elements(v->'accounts') x where x->>'profile' = '0d000000-0000-0000-0000-00000000000a'), 'it leaves the list';
  assert v->'marked'->0->>'profile' = '0d000000-0000-0000-0000-00000000000a' and (v->'marked'->0->>'quiet')::int = 2
    and v->'marked'->0->>'by' = '0d000000-0000-0000-0000-0000000000aa' and v->'marked'->0->>'at' is not null, 'the marked list says who and when';
  assert public.ops_quiet_account_mark('0d000000-0000-0000-0000-00000000000a', false, '0d000000-0000-0000-0000-0000000000aa') = 'unmarked', 'undone';
  v := diag.ops_quiet_accounts();
  assert (v->>'count')::int = before and (v->>'markedCount')::int = 0 and jsonb_array_length(v->'marked') = 0, 'it counts again';

  assert public.ops_quiet_account_mark('0d000000-0000-0000-0000-0000000000ff', true, '0d000000-0000-0000-0000-0000000000aa') = 'not_found', 'an account that is not there';

  -- A deleted account's mark goes with it.
  perform public.ops_quiet_account_mark('0d000000-0000-0000-0000-00000000000b', true, '0d000000-0000-0000-0000-0000000000aa');
  delete from auth.users where id = '0d000000-0000-0000-0000-00000000000b';
  assert not exists (select 1 from ops.quiet_accounts_ok where profile_id = '0d000000-0000-0000-0000-00000000000b'), 'the mark goes with the account';

  -- Both actions are on the log's list.
  perform public.ops_record_action('0d000000-0000-0000-0000-0000000000aa', 'quiet_ok', '0d000000-0000-0000-0000-00000000000a', 'ok', null);
  perform public.ops_record_action('0d000000-0000-0000-0000-0000000000aa', 'quiet_ok_undo', '0d000000-0000-0000-0000-00000000000a', 'ok', null);
end $$;

-- diag_reader reads the list only, and only the service role marks.
set local role diag_reader;
do $$ begin
  perform diag.ops_quiet_accounts();
  begin
    perform 1 from ops.quiet_accounts_ok;
    raise exception 'diag_reader read the marks directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ops_quiet_account_mark('0d000000-0000-0000-0000-00000000000a', true, '0d000000-0000-0000-0000-0000000000aa');
    raise exception 'diag_reader marked an account';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin
    perform public.ops_quiet_account_mark('0d000000-0000-0000-0000-00000000000a', true, '0d000000-0000-0000-0000-0000000000aa');
    raise exception 'authenticated marked an account';
  exception when insufficient_privilege then null;
  end;
  begin
    perform diag.ops_quiet_accounts();
    raise exception 'authenticated read the list';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role service_role;
select public.ops_quiet_account_mark('0d000000-0000-0000-0000-00000000000a', true, '0d000000-0000-0000-0000-0000000000aa');
reset role;

rollback;
