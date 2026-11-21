-- A change to a video that failed, and that a pull request of its own fixed later (migration
-- *_tutorial_fixed_elsewhere.sql, docs/decisions/2026-11-21-a-failed-video-change-learns-the-pull-request-that-fixed-it.md):
-- the video fix run gets the changes that failed whose video has a newer film, says which pull request fixed one,
-- and the database keeps it only when a film came in after the merge; the dashboard and the card's record say it.
-- Run by `npm run db:test`. Every write rolls back.
\set ON_ERROR_STOP on
begin;

insert into ops.tutorial_suggestions (id, kind, tutorial, language, title, detail, decision, decided_at, decided_by, fix_state, fix_at, fix_note) values
  ('0e000000-0000-0000-0000-000000000001', 'instruction', 'how-langquest-works', 'fr', 'The French film was held', 'Fix the capitalization in the app, refilm',
    'accepted', now() - interval '3 hours', '0d000000-0000-0000-0000-0000000000aa', 'failed', now() - interval '2 hours',
    'The capital comes from the app (common.justNow in apps/mobile/src/i18n/fr.json), not the video.'),
  -- No film after the failure: the run is not asked about it.
  ('0e000000-0000-0000-0000-000000000002', 'screen', 'add-a-language', 'es', 'The Spanish count', 'It says 1 listos.',
    'accepted', now() - interval '3 hours', '0d000000-0000-0000-0000-0000000000aa', 'failed', now() - interval '2 hours', 'From es.json in the app.'),
  -- A change that is still being written.
  ('0e000000-0000-0000-0000-000000000003', 'script', 'how-langquest-works', 'fr', 'Say Done', 'Step 9 says Save.',
    'accepted', now() - interval '3 hours', '0d000000-0000-0000-0000-0000000000aa', 'working', now() - interval '2 hours', null);
insert into ops.tutorial_videos (tutorial, language, sha256, title, description, playlist, position, seconds, bytes, made_at) values
  ('how-langquest-works', 'fr', repeat('b', 64), 'Comment LangQuest fonctionne', 'x', 'Tous', 1, 175, 1000, now() - interval '30 minutes'),
  ('add-a-language', 'es', repeat('c', 64), 'Añadir un idioma', 'x', 'Todos', 1, 60, 1000, now() - interval '5 hours');

do $$
declare
  fr constant uuid := '0e000000-0000-0000-0000-000000000001';
  v jsonb;
begin
  -- The run is asked only about the French change: its video has a film newer than the failure.
  v := public.ops_tutorial_fixes(10)->'failed';
  assert jsonb_array_length(v) = 1 and v->0->>'id' = fr::text and v->0->>'filmedAt' is not null and v->0->>'note' like '%fr.json%', format('failed: %s', v);
  assert ops.tutorial_suggestion_json((select s from ops.tutorial_suggestions s where id = fr))->'fixedBy' = 'null'::jsonb, 'not fixed yet';

  -- What it refuses: a merge before the failure, a merge after the newest film, a change that did not fail, an unknown one.
  assert public.ops_tutorial_fixed_elsewhere(fr, 633, now() - interval '150 minutes', 'apps/mobile/src/i18n/fr.json') = 'refused', 'merged before the failure';
  assert public.ops_tutorial_fixed_elsewhere(fr, 633, now() - interval '10 minutes', 'apps/mobile/src/i18n/fr.json') = 'refused', 'no film after the merge';
  assert public.ops_tutorial_fixed_elsewhere('0e000000-0000-0000-0000-000000000003', 633, now() - interval '1 hour', null) = 'refused', 'its fix did not fail';
  assert public.ops_tutorial_fixed_elsewhere(gen_random_uuid(), 633, now() - interval '1 hour', null) = 'not_found', 'not found';

  -- PR 633 merged an hour ago, and the film came in after it.
  assert public.ops_tutorial_fixed_elsewhere(fr, 633, now() - interval '1 hour', 'apps/mobile/src/i18n/fr.json') = 'ok', 'kept';
  assert public.ops_tutorial_fixed_elsewhere(fr, 634, now() - interval '50 minutes', null) = 'refused', 'once only';
  v := ops.tutorial_suggestion_json((select s from ops.tutorial_suggestions s where id = fr))->'fixedBy';
  assert v->>'pr' = '633' and v->>'file' = 'apps/mobile/src/i18n/fr.json' and (v->>'filmedAt')::timestamptz = now() - interval '30 minutes', format('fixedBy: %s', v);
  assert jsonb_array_length(public.ops_tutorial_fixes(10)->'failed') = 0, 'not asked again';

  -- The card's record has the step.
  assert diag.ops_card_record('video') @> '[{"what": "fixed_elsewhere", "key": "how-langquest-works/fr", "pr": 633, "detail": "apps/mobile/src/i18n/fr.json"}]'::jsonb,
    format('the record: %s', diag.ops_card_record('video'));

  -- Try again makes a new fix: the old answer no longer counts.
  update ops.tutorial_suggestions set fix_state = 'working', fix_at = now() where id = fr;
  assert ops.tutorial_suggestion_json((select s from ops.tutorial_suggestions s where id = fr))->'fixedBy' = 'null'::jsonb, 'a new fix';
  assert not diag.ops_card_record('video') @> '[{"what": "fixed_elsewhere"}]'::jsonb, 'out of the record';
end $$;

do $$ begin
  set local role authenticated;
  perform public.ops_tutorial_fixed_elsewhere('0e000000-0000-0000-0000-000000000001', 633, now(), null);
  raise exception 'a signed-in person said a fix was made';
exception when insufficient_privilege then null;
end $$;
reset role;

rollback;
