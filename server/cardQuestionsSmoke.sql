-- Questions to Claude from any card of the ops dashboard (migration 20261123233000_ops_card_questions.sql):
-- the dashboard's Worker keeps one, the workflow takes it and answers, diag_reader reads it with the
-- admin's display name; nobody signed in reads or writes it. Run by `npm run db:test`. Every write rolls back.
\set ON_ERROR_STOP on
begin;

insert into public.profiles (id, display_name) values ('0e000000-0000-0000-0000-0000000000ab', 'Asking Admin');

do $$ declare
  v_id text; v_waiting jsonb; v_done jsonb; v_seen jsonb; v_q jsonb; n int;
begin
  v_id := public.ops_card_ask('line:capacity-r2-class-a', 'storage', 'R2 class A operations are past the plan',
    'Recording uploads this month 5,524,967 of 1,000,000 free', 'What does this cost, and why so many?', '0e000000-0000-0000-0000-0000000000ab');
  assert v_id ~ '^[0-9a-f-]{36}$', 'a question is kept: ' || v_id;
  perform public.ops_card_ask('line:capacity-r2-class-a', 'storage', 'R2', '', 'Second', '0e000000-0000-0000-0000-0000000000ab');
  perform public.ops_card_ask('line:capacity-r2-class-a', 'storage', 'R2', '', 'Third', '0e000000-0000-0000-0000-0000000000ab');
  assert public.ops_card_ask('line:capacity-r2-class-a', 'storage', 'R2', '', 'Fourth', '0e000000-0000-0000-0000-0000000000ab') = 'full',
    'three waiting questions fill a card';
  assert public.ops_card_ask('page:storage', 'storage', 'Storage and cost', '', 'Any duplicates in downloads?', '0e000000-0000-0000-0000-0000000000ab') ~ '^[0-9a-f-]{36}$',
    'another card takes its own question';

  v_waiting := public.ops_card_questions_waiting();
  assert jsonb_array_length(v_waiting) = 4, 'the workflow gets the four waiting questions';
  select e into v_q from jsonb_array_elements(v_waiting) e where e->>'id' = v_id;
  assert v_q->>'context' like 'Recording uploads%' and v_q->>'page' = 'storage', 'a question goes with the card''s words';
  assert not (v_q ? 'by') and not (v_q ? 'who'), 'the workflow does not learn who asked';

  v_done := public.ops_card_questions_done(jsonb_build_object('runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/123',
    'questions', jsonb_build_array(jsonb_build_object('id', v_id, 'taken', true))));
  assert (v_done->>'taken')::int = 1, 'a run takes a question';
  select diag.ops_card_questions() into v_seen;
  assert v_seen->'line:capacity-r2-class-a'->0->>'state' = 'working', 'a taken question is working';
  v_done := public.ops_card_questions_done(jsonb_build_object('runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/123',
    'questions', jsonb_build_array(jsonb_build_object('id', v_id, 'taken', false, 'result', 'answered', 'answer', 'About $20 so far. Uploads list each file first.'))));
  assert (v_done->>'answered')::int = 1, 'a run answers a question';
  v_done := public.ops_card_questions_done(jsonb_build_object('runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/124',
    'questions', jsonb_build_array(jsonb_build_object('id', v_id, 'taken', false, 'result', 'answered', 'answer', 'Another'))));
  assert (v_done->>'answered')::int = 0, 'an answered question stays as it is';

  select diag.ops_card_questions() into v_seen;
  v_q := v_seen->'line:capacity-r2-class-a'->0;
  assert v_q->>'state' = 'answered' and v_q->>'answer' like 'About $20%' and v_q->>'who' = 'Asking Admin', 'the card shows the answer and who asked';
  select count(*) into n from jsonb_array_elements(public.ops_card_questions_waiting()) e where e->>'card' = 'line:capacity-r2-class-a';
  assert n = 2, 'the answered question waits no more';
  assert (select e->'before'->0->>'answer' from jsonb_array_elements(public.ops_card_questions_waiting()) e where e->>'card' = 'line:capacity-r2-class-a' limit 1) like 'About $20%',
    'a later question on the card carries what was said before';

  begin
    perform public.ops_card_questions_done(jsonb_build_object('runUrl', 'https://example.com/runs/1', 'questions', '[]'::jsonb));
    raise exception 'a run of another repository was taken';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.ops_card_ask('feedback:x', 'storage', 'x', '', 'x', '0e000000-0000-0000-0000-0000000000ab');
    raise exception 'a card that is neither a line nor a page was kept';
  exception when check_violation then null;
  end;
end $$;

insert into ops.actions (profile_id, action, target, result, detail)
values ('0e000000-0000-0000-0000-0000000000ab', 'card_question', 'line:capacity-r2-class-a', 'ok', 'question:x');

grant diag_reader to postgres;
set local role diag_reader;
do $$ begin
  assert jsonb_typeof(diag.ops_card_questions()) = 'object', 'diag_reader reads the questions';
end $$;
reset role;

set local role authenticated;
do $$ begin
  begin
    perform diag.ops_card_questions();
    raise exception 'authenticated read the questions';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ops_card_ask('page:storage', 'storage', 'x', '', 'x', '0e000000-0000-0000-0000-0000000000ab');
    raise exception 'authenticated asked';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
