-- Issue claims and Claude's replies for each admin (migration 20261124003000_ops_issue_claims.sql): the
-- dashboard's Worker claims and releases an issue, diag_reader reads the claims with the display name and
-- each admin's replies; nobody signed in reads or writes them. Run by `npm run db:test`. Every write rolls back.
\set ON_ERROR_STOP on
begin;

insert into public.profiles (id, display_name) values
  ('0e000000-0000-0000-0000-0000000000c1', 'Claiming Dev'),
  ('0e000000-0000-0000-0000-0000000000c2', 'Other Dev');

do $$ declare
  a constant uuid := '0e000000-0000-0000-0000-0000000000c1';
  b constant uuid := '0e000000-0000-0000-0000-0000000000c2';
  v jsonb; v_q text; v_note uuid;
begin
  assert public.ops_issue_claim('LAN-901', true, a) = 'claimed', 'a dev claims a free issue';
  assert public.ops_issue_claim('LAN-901', true, a) = 'claimed', 'claiming it again keeps the claim';
  assert public.ops_issue_claim('LAN-901', true, b) = 'taken', 'another dev cannot claim it';
  assert public.ops_issue_claim('LAN-901', false, b) = 'not_yours', 'another dev cannot release it';
  assert (select by from ops.issue_claims where issue = 'LAN-901') = a, 'the first claim stays';

  v := diag.ops_mine(b);
  assert v->'claims'->'LAN-901'->>'who' = 'Claiming Dev', 'every admin sees who claimed it, by display name';
  assert (v->'claims'->'LAN-901'->>'mine')::boolean = false, 'it is not the other dev''s';
  assert (diag.ops_mine(a)->'claims'->'LAN-901'->>'mine')::boolean, 'it is the claimer''s';
  assert not (v->'claims'->'LAN-901' ? 'by'), 'no profile id goes to the page';

  assert public.ops_issue_claim('LAN-901', false, a) = 'released', 'the claimer releases it';
  assert not exists (select 1 from ops.issue_claims where issue = 'LAN-901'), 'a released issue has no claim';
  assert public.ops_issue_claim('LAN-901', false, a) = 'released', 'releasing a free issue does nothing';
  assert public.ops_issue_claim('LAN-901', true, b) = 'claimed', 'then the other dev can claim it';

  begin
    perform public.ops_issue_claim('not an issue', true, a);
    raise exception 'a claim on something that is not an issue was kept';
  exception when sqlstate '22023' then null;
  end;

  -- Claude's replies: only on the cards the admin talked on, and on the issues the admin claimed.
  insert into ops.user_issue_notes (issue, text, by, answered_at, result, answer)
    values ('LAN-902', 'Why does it fail?', a, now() - interval '2 hours', 'answered', 'The upload times out after 60 s.')
    returning id into v_note;
  insert into ops.user_issue_notes (issue, text, by, answered_at, result, answer)
    values ('LAN-902', 'And on Android?', b, now() - interval '1 hour', 'answered', 'The same on Android.');
  insert into ops.user_issue_notes (issue, text, by, answered_at, result, answer)
    values ('LAN-903', 'Only the other dev talks here', b, now() - interval '1 hour', 'answered', 'Not for the first dev.');
  -- LAN-901 is the other dev's claim: answers on it go to the other dev.
  insert into ops.user_issue_notes (issue, text, by, answered_at, result, answer)
    values ('LAN-901', 'Question on a claimed issue', a, now() - interval '30 minutes', 'answered', 'An answer on LAN-901.');
  v_q := public.ops_card_ask('page:storage', 'storage', 'Storage and cost', '', 'Any duplicates?', a);
  perform public.ops_card_questions_done(jsonb_build_object('runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/9',
    'questions', jsonb_build_array(jsonb_build_object('id', v_q, 'taken', false, 'result', 'answered', 'answer', 'No duplicates.'))));
  -- An answer older than 30 days does not show.
  insert into ops.user_issue_notes (issue, text, by, at, answered_at, result, answer)
    values ('LAN-904', 'Old', a, now() - interval '40 days', now() - interval '40 days', 'answered', 'Old answer.');

  v := diag.ops_mine(a);
  assert jsonb_array_length(v->'replies') = 4, 'the first dev gets 4 replies: ' || (v->'replies')::text;
  assert v->'replies'->0->>'answer' = 'No duplicates.' and v->'replies'->0->>'kind' = 'question' and v->'replies'->0->>'page' = 'storage',
    'the newest reply is first';
  assert exists (select 1 from jsonb_array_elements(v->'replies') e where e->>'answer' = 'The same on Android.' and not (e->>'mine')::boolean),
    'a reply to another admin on the same issue shows, not as the dev''s own';
  assert exists (select 1 from jsonb_array_elements(v->'replies') e where e->>'card' = 'LAN-902' and (e->>'mine')::boolean),
    'a reply to the dev''s own words shows as the dev''s';
  assert not exists (select 1 from jsonb_array_elements(v->'replies') e where e->>'card' in ('LAN-903', 'LAN-904')), 'other cards and old replies do not show';
  assert v->'seenAt' = 'null'::jsonb, 'the dev never opened the list';

  v := diag.ops_mine(b);
  assert exists (select 1 from jsonb_array_elements(v->'replies') e where e->>'card' = 'LAN-901'), 'answers on a claimed issue go to the claimer';
  assert not exists (select 1 from jsonb_array_elements(v->'replies') e where e->>'card' = 'page:storage'), 'a question of the first dev does not go to the other';

  perform public.ops_record_action(a, 'replies_seen', 'replies', 'ok');
  assert (diag.ops_mine(a)->>'seenAt') is not null, 'opening the list keeps the time';
  assert diag.ops_mine(b)->'seenAt' = 'null'::jsonb, 'each admin has a time of their own';

  perform public.ops_record_action(b, 'issue_claim', 'LAN-902', 'ok');
  assert exists (select 1 from jsonb_array_elements(diag.ops_card_record('issue')) e
    where e->>'key' = 'LAN-902' and e->>'what' = 'issue_claim' and e->>'who' = 'Other Dev'), 'the issue''s record names who claimed it';
end $$;

grant diag_reader to postgres;
set local role diag_reader;
do $$ begin
  assert jsonb_typeof(diag.ops_mine('0e000000-0000-0000-0000-0000000000c1')) = 'object', 'diag_reader reads claims and replies';
end $$;
reset role;

set local role authenticated;
do $$ begin
  begin
    perform diag.ops_mine('0e000000-0000-0000-0000-0000000000c1');
    raise exception 'authenticated read the replies';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ops_issue_claim('LAN-905', true, '0e000000-0000-0000-0000-0000000000c1');
    raise exception 'authenticated claimed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
