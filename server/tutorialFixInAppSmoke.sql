-- "Fix it" on a tutorial video's suggestion (migration *_tutorial_fix_in_app.sql,
-- docs/decisions/2026-11-21-fix-it-sends-a-video-suggestion-to-the-agent-team.md): an admin asks the
-- agent team to change the app for a suggestion about the app that waits for an answer, or for one whose
-- change to the video failed, and the video fix run hands one over itself when the cause is in the app;
-- it goes to Linear, and once its issue is known an instruction waits for the agent team, with `go` (the
-- admin's word is the yes); later instructions on that issue are taken; after the merge the video is
-- filmed again; the dashboard reads the chain. Run by `npm run db:test`. Every write rolls back.
\set ON_ERROR_STOP on
begin;

-- Five suggestions, as Claude's look and an admin's instruction leave them.
insert into ops.tutorial_suggestions (id, kind, tutorial, language, title, detail) values
  ('0f000000-0000-0000-0000-000000000001', 'code', 'consultant-check', 'fr', 'Say "Faire l''approbation finale"', 'The French button says "Faire la approbation finale".'),
  ('0f000000-0000-0000-0000-000000000003', 'code', 'record-a-passage', null, 'Save does nothing', 'Viewers say Save does nothing.'),
  ('0f000000-0000-0000-0000-000000000004', 'new', null, null, 'A video on maps', 'Show how to read the map.');
insert into ops.tutorial_suggestions (id, kind, tutorial, language, title, detail, decision, decided_at, decided_by, fix_state, fix_at, fix_note) values
  ('0f000000-0000-0000-0000-000000000002', 'instruction', 'how-langquest-works', 'fr', 'The French film was held', 'Fix the capitalization in the app, refilm',
    'accepted', now(), '0d000000-0000-0000-0000-0000000000aa', 'failed', now(), 'The capital comes from the app (common.justNow), not the video.'),
  ('0f000000-0000-0000-0000-000000000005', 'script', 'record-a-passage', null, 'Say Done', 'Step 9 says Save.',
    'accepted', now(), '0d000000-0000-0000-0000-0000000000aa', 'working', now(), null),
  ('0f000000-0000-0000-0000-000000000006', 'screen', 'record-a-passage', 'es', 'The Spanish button', 'The button says Guardar twice.',
    'accepted', now(), '0d000000-0000-0000-0000-0000000000aa', 'failed', now(), 'The second Guardar comes from the app (es.json), not the video.');
insert into ops.tutorial_suggestions (id, kind, tutorial, language, title, detail, decision, decided_at, clear, fix_state, fix_at, fix_note) values
  ('0f000000-0000-0000-0000-000000000007', 'script', 'record-a-passage', null, 'Say Tap', 'Step 3 says Press.',
    'accepted', now(), true, 'failed', now(), 'The word comes from the app.');

-- As the owner, which reads the tables the functions write; the last block checks who may call them.
do $$
declare
  admin constant uuid := '0d000000-0000-0000-0000-0000000000aa';
  code constant uuid := '0f000000-0000-0000-0000-000000000001';
  told constant uuid := '0f000000-0000-0000-0000-000000000002';
  v jsonb;
  n text;
begin
  -- Fix it on a suggestion about the app that waits for an answer: it is accepted, and waits for Linear.
  v := public.ops_suggestion_fix_in_app(code, admin);
  assert v->>'result' = 'asked' and v->>'kind' = 'code' and v->'issue' = 'null'::jsonb, 'asked: %', v;
  assert (select decision = 'accepted' and decided_by = admin and app_asked_by = admin from ops.tutorial_suggestions where id = code), 'accepted by the admin who asked';
  assert public.ops_suggestion_fix_in_app(code, admin)->>'result' = 'already', 'once only';
  assert public.ops_suggestion_decide(code, 'rejected', null, 'no', admin)->>'result' = 'decided', 'no second answer';
  assert not exists (select 1 from ops.user_issue_notes), 'no instruction before the issue is known';

  -- Fix it on an instruction whose change to the video failed: it keeps its first answer.
  v := public.ops_suggestion_fix_in_app(told, admin, true);
  assert v->>'result' = 'asked' and v->>'kind' = 'instruction', 'the failed change asked: %', v;
  assert (select app_ask_first and not app_handed from ops.tutorial_suggestions where id = told), 'asked to see it first';

  -- What it refuses.
  assert public.ops_suggestion_fix_in_app('0f000000-0000-0000-0000-000000000004', admin)->>'result' = 'decided', 'a new video has nothing to fix in the app';
  assert public.ops_suggestion_fix_in_app('0f000000-0000-0000-0000-000000000005', admin)->>'result' = 'refused', 'Claude still makes a change to the video';
  assert public.ops_suggestion_decide('0f000000-0000-0000-0000-000000000003', 'rejected', null, 'no', admin)->>'result' = 'rejected', 'rejected';
  assert public.ops_suggestion_fix_in_app('0f000000-0000-0000-0000-000000000003', admin)->>'result' = 'decided', 'a rejected suggestion';
  assert public.ops_suggestion_fix_in_app(gen_random_uuid(), admin)->>'result' = 'not_found', 'not found';

  -- The video fix run hands over a change whose cause is in the app, only for a person's yes.
  assert public.ops_tutorial_fix_to_app('0f000000-0000-0000-0000-000000000006') = 'handed', 'handed over';
  assert (select app_handed and app_asked_by = admin from ops.tutorial_suggestions where id = '0f000000-0000-0000-0000-000000000006'), 'as the admin who accepted it';
  assert public.ops_tutorial_fix_to_app('0f000000-0000-0000-0000-000000000006') = 'already', 'once only';
  assert public.ops_tutorial_fix_to_app('0f000000-0000-0000-0000-000000000007') = 'refused', 'a clear fix Claude accepted itself waits for a person';
  assert public.ops_tutorial_fix_to_app('0f000000-0000-0000-0000-000000000005') = 'refused', 'its change to the video did not fail';
  assert not exists (select 1 from jsonb_array_elements(public.ops_tutorial_fixes(10)->'toFix') x where x->>'id' = '0f000000-0000-0000-0000-000000000006'), 'the video fix run does not take it again';

  -- All three go to Linear, oldest first.
  v := public.ops_suggestions_to_file(10);
  assert jsonb_array_length(v) = 3 and v->0->'app'->>'askedAt' is not null, 'all wait for Linear: %', v;
  perform public.ops_suggestion_filed(code, 'LAN-400', 'https://linear.app/frontierrnd/issue/LAN-400');
  perform public.ops_suggestion_filed(told, 'LAN-401', 'https://linear.app/frontierrnd/issue/LAN-401');
  perform public.ops_suggestion_filed('0f000000-0000-0000-0000-000000000006', 'LAN-402', 'https://linear.app/frontierrnd/issue/LAN-402');
  assert jsonb_array_length(public.ops_suggestions_to_file(10)) = 0, 'filed once';

  -- Once filed, an instruction waits for the agent team, and the watch hands it to the fix jobs.
  assert (select count(*) from ops.user_issue_notes where named and go and by = admin) = 3, 'one instruction each, by the admin who asked, with go';
  n := (select text from ops.user_issue_notes where issue = 'LAN-401');
  assert n like 'Fix it, from the Tutorial videos page%' and n like '%"how-langquest-works" (fr)%' and n like '%When Claude tried to change the video: The capital comes from the app%'
    and n like '%Ask me first: show me the change before it merges.', 'the instruction: %', n;
  assert (select text not like '%Ask me first%' from ops.user_issue_notes where issue = 'LAN-400'), 'no ask first when the admin did not ask';
  v := public.ops_user_issue_notes_waiting();
  assert (select count(*) from jsonb_array_elements(v) x where x->>'issue' in ('LAN-400', 'LAN-401', 'LAN-402')) = 3, 'the watch sees all: %', v;
  v := public.ops_user_issue_notes('LAN-401');
  assert v->>'askFirst' = 'true' and v->'waiting'->0->>'go' = 'true', 'the fix job reads go and ask first: %', v;
  assert public.ops_user_issue_notes('LAN-400')->>'askFirst' = 'false', 'not asked first';

  -- "merge it" from the card is taken on that issue; an issue nobody asked about is not.
  assert public.ops_user_issue_instruct('LAN-400', 'merge it', admin) ~ '^[0-9a-f-]{36}$', 'merge it taken';
  assert (select named and go from ops.user_issue_notes where issue = 'LAN-400' and text = 'merge it'), 'kept as named, so the watch takes it, and go';
  assert public.ops_user_issue_instruct('LAN-999', 'merge it', admin) = 'not_found', 'not an issue of a suggestion';

  -- The dashboard reads where the fix is: the instructions, the newest first, then the agent team's record.
  v := ops.tutorial_suggestion_json((select s from ops.tutorial_suggestions s where id = code));
  assert jsonb_array_length(v->'app'->'notes') = 2 and v->'app'->'notes' @> '[{"text": "merge it"}]'::jsonb and v->'app'->'fix' = 'null'::jsonb, format('before the team wrote: %s', v->'app');
  perform public.ops_user_issue_fixes_done(jsonb_build_object('runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/300',
    'fixes', jsonb_build_array(jsonb_build_object('issue', 'LAN-400', 'decision', 'waits', 'reason', 'instruction', 'pr', 640, 'verdict', 'review',
      'summary', 'The French button now shortens "la" before a vowel.'))));
  v := ops.tutorial_suggestion_json((select s from ops.tutorial_suggestions s where id = code));
  assert v->'app'->'fix'->>'pr' = '640' and v->'app'->'fix'->>'decision' = 'waits' and v->'app'->'fix'->>'before' = 'false', format('the team record: %s', v->'app');
  assert ops.tutorial_suggestion_json((select s from ops.tutorial_suggestions s where id = '0f000000-0000-0000-0000-000000000005'))->'app' = 'null'::jsonb, 'none while nobody asked';

  -- Once the team opened its pull request, the video fix run asks GitHub whether it merged, then films the video again.
  v := public.ops_tutorial_fixes(10)->'refilm';
  assert jsonb_array_length(v) = 1 and v->0->>'pr' = '640' and v->0->>'tutorial' = 'consultant-check' and v->0->>'language' = 'fr', 'the refilm list: %', v;
  assert public.ops_tutorial_app_refilmed(code, 640) = 'ok', 'sent to be filmed again';
  assert public.ops_tutorial_app_refilmed(code, 640) = 'refused', 'once only';
  assert public.ops_tutorial_app_refilmed('0f000000-0000-0000-0000-000000000005', 641) = 'refused', 'not a fix in the app';
  assert jsonb_array_length(public.ops_tutorial_fixes(10)->'refilm') = 0, 'not sent twice';
  insert into ops.tutorial_videos (tutorial, language, sha256, title, description, playlist, position, seconds, bytes, made_at)
    values ('consultant-check', 'fr', repeat('a', 64), 'Vérification', 'x', 'Consultants', 1, 60, 1000, now() + interval '1 minute');
  v := ops.tutorial_suggestion_json((select s from ops.tutorial_suggestions s where id = code))->'app';
  assert v->>'refilmPr' = '640' and v->>'refilmAt' is not null and v->>'filmedAt' is not null and v->>'askFirst' = 'false', format('the film: %s', v);

  -- The card's record holds the chain.
  v := diag.ops_card_record('video');
  assert v @> '[{"what": "refilm", "key": "consultant-check/fr", "pr": 640}, {"what": "filmed", "key": "consultant-check/fr"}, {"what": "appfix", "key": "consultant-check/fr", "pr": 640}]'::jsonb, format('the chain: %s', v);
  assert v @> '[{"what": "handed", "key": "record-a-passage/es"}]'::jsonb, format('the handover: %s', v);

  -- The dashboard's record of the action.
  perform public.ops_record_action(admin, 'suggestion_fix', code::text, 'ok', 'LAN-400');
  assert diag.ops_card_record('video') @> '[{"what": "suggestion_fix", "key": "consultant-check/fr"}]'::jsonb, 'the tap on the card';
end $$;

do $$ begin
  set local role service_role;
  perform public.ops_suggestion_fix_in_app(gen_random_uuid(), '0d000000-0000-0000-0000-0000000000aa');
  reset role;
  set local role authenticated;
  perform public.ops_suggestion_fix_in_app('0f000000-0000-0000-0000-000000000001', '0d000000-0000-0000-0000-0000000000aa');
  raise exception 'a signed-in person asked for a fix';
exception when insufficient_privilege then null;
end $$;
reset role;

rollback;
