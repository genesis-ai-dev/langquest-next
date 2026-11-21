-- The record on each card of the ops dashboard (migration 20261121213000_ops_card_record.sql):
-- diag_reader reads who did what on each card, with the admin's display name, and what Claude
-- did; nobody signed in reads it. Run by `npm run db:test`. Every write rolls back.
\set ON_ERROR_STOP on
begin;

insert into public.profiles (id, display_name) values ('0e000000-0000-0000-0000-0000000000aa', 'Record Admin');
-- An admin accepted Claude's suggestion on the Spanish film; another tap on it was refused.
with s as (
  insert into ops.tutorial_suggestions (kind, tutorial, language, title, detail, decision, decided_at, decided_by)
  values ('screen', 'record-smoke-video', 'es', 'Light the button', 'Light it', 'accepted', now(), '0e000000-0000-0000-0000-0000000000aa') returning id)
insert into ops.actions (profile_id, action, target, result, detail)
select '0e000000-0000-0000-0000-0000000000aa', a.action, s.id::text, a.result, a.detail
from s, (values ('suggestion_accepted', 'ok', 'screen'), ('suggestion_accepted', 'refused', 'decided')) a(action, result, detail);
-- An admin sent an instruction on a Linear issue, and Claude answered it.
with n as (
  insert into ops.user_issue_notes (issue, text, by, answered_at, result, answer)
  values ('LAN-90909', 'Prove the cause first', '0e000000-0000-0000-0000-0000000000aa', now(), 'answered', 'I cannot prove it yet.') returning id)
insert into ops.actions (profile_id, action, target, result, detail)
select '0e000000-0000-0000-0000-0000000000aa', 'user_issue_note', 'LAN-90909', 'ok', 'note:' || n.id from n;

grant diag_reader to postgres;
set local role diag_reader;
do $$ declare v jsonb := diag.ops_card_record('video'); i jsonb := diag.ops_card_record('issue'); x jsonb; begin
  assert jsonb_typeof(v) = 'array' and jsonb_typeof(i) = 'array', 'each kind is a list';
  select e into x from jsonb_array_elements(v) e where e->>'key' = 'record-smoke-video/es' and e->>'what' = 'suggestion_accepted' and e->>'result' = 'ok';
  assert x->>'who' = 'Record Admin', 'a tap names the admin by display name';
  assert x->>'words' = 'Light the button', 'a tap on a suggestion carries its title';
  assert exists (select 1 from jsonb_array_elements(v) e where e->>'key' = 'record-smoke-video/es' and e->>'result' = 'refused' and e->>'detail' = 'decided'), 'a refused tap is in the record';
  assert exists (select 1 from jsonb_array_elements(v) e where e->>'key' = 'record-smoke-video/es' and e->>'who' = 'Claude' and e->>'what' = 'suggested'), 'Claude''s suggestion is in the record';
  assert not exists (select 1 from jsonb_array_elements(v) e where e->>'key' = 'LAN-90909'), 'the videos'' record holds no issue';
  select e into x from jsonb_array_elements(i) e where e->>'key' = 'LAN-90909' and e->>'what' = 'user_issue_note';
  assert x->>'who' = 'Record Admin' and x->>'words' = 'Prove the cause first', 'an instruction names its admin and its words';
  assert exists (select 1 from jsonb_array_elements(i) e where e->>'key' = 'LAN-90909' and e->>'who' = 'Claude' and e->>'what' = 'answered'), 'Claude''s answer is in the record';
end $$;
reset role;

set local role authenticated;
do $$ begin
  begin
    perform diag.ops_card_record('issue');
    raise exception 'authenticated read the record';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
