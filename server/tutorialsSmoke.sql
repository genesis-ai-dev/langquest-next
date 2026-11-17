-- Tutorial videos on YouTube (migration *_tutorial_videos.sql, decisions.md
-- 180): only the service role connects a channel, reads its refresh token back
-- out of Vault, records a video and marks one published; diag_reader reads the
-- dashboard's summary, never a token; the intake that lists the nightly
-- films is a daily job, as are the read of the videos' comments and Claude's
-- look at them, and it chooses the wide ones itself. Run by
-- `npm run db:test`. Every write rolls back.
\set ON_ERROR_STOP on
begin;

set local role service_role;
-- Connect English and Spanish; Spanish twice, as a second Connect replaces its token.
select public.ops_youtube_connected('UC8Ry8oFIPWzDygngMwvkBLQ', 'en', 'LangQuest', '1//refresh-en-0123456789', '0d000000-0000-0000-0000-0000000000aa', 'made');
select public.ops_youtube_connected('UCpZYy6RO9gLD__QuUDVaEYg', 'es', 'LangQuest - Español', '1//refresh-es-old-0123456789', '0d000000-0000-0000-0000-0000000000aa', null);
select public.ops_youtube_connected('UCpZYy6RO9gLD__QuUDVaEYg', 'es', 'LangQuest - Español', '1//refresh-es-new-0123456789', '0d000000-0000-0000-0000-0000000000aa', 'updated');

do $$ begin
  assert public.ops_youtube_refresh('UC8Ry8oFIPWzDygngMwvkBLQ') = '1//refresh-en-0123456789', 'the token comes back out of Vault';
  assert public.ops_youtube_refresh('UCpZYy6RO9gLD__QuUDVaEYg') = '1//refresh-es-new-0123456789', 'a second Connect replaces the token';
  assert public.ops_youtube_refresh('UCDdH4nGZOzkE4cAsk43qhog') is null, 'a channel never connected has none';
  assert (select count(*) from vault.secrets where name like 'youtube_refresh_%') = 2, 'one secret per channel';
end $$;

-- Two versions of Record a passage in English (the second made later), one in Spanish, and one in French, whose channel is not connected.
select public.ops_tutorial_made('record-a-passage', 'en', repeat('a', 64), 'Record a passage', 'How to record.', 'Translators', 29, 75, 12000000);
select public.ops_tutorial_made('record-a-passage', 'es', repeat('b', 64), 'Grabar un pasaje', 'Cómo grabar.', 'Traductores', 29, 80, 13000000);
select public.ops_tutorial_made('record-a-passage', 'fr', repeat('c', 64), 'Enregistrer un passage', 'Comment enregistrer.', 'Traducteurs', 29, 81, 13000000);
do $$ begin
  assert not public.ops_tutorial_made('record-a-passage', 'en', repeat('a', 64), 'Record a passage', 'How to record.', 'Translators', 29, 75, 12000000),
    'the same file again is not new';
  begin
    perform public.ops_tutorial_made('record-a-passage', 'en', repeat('d', 64), 'Record <a> passage', 'x', 'Translators', 29, 75, 1);
    raise exception 'a title YouTube refuses was accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.ops_youtube_connected('not-a-channel', 'en', 'x', '1//refresh-0123456789', '0d000000-0000-0000-0000-0000000000aa', null);
    raise exception 'a channel id that is not one was accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- Publish chooses English and French; Spanish waits. Nothing is due for French: its channel is not connected.
do $$ declare v jsonb; begin
  assert public.ops_tutorials_approve(jsonb_build_array(jsonb_build_array('record-a-passage', 'en', repeat('a', 64)),
    jsonb_build_array('record-a-passage', 'fr', repeat('c', 64))), '0d000000-0000-0000-0000-0000000000aa') = 2, 'two marked';
  assert public.ops_tutorials_approve(jsonb_build_array(jsonb_build_array('record-a-passage', 'en', repeat('a', 64))), '0d000000-0000-0000-0000-0000000000aa') = 0,
    'marking again marks nothing new';
  v := public.ops_tutorials_due(10);
  assert jsonb_array_length(v) = 1 and v->0->>'language' = 'en' and v->0->>'channelId' = 'UC8Ry8oFIPWzDygngMwvkBLQ', 'English is due: %', v;
  assert v->0->'replaces' = 'null'::jsonb, 'the first version replaces nothing';

  -- A try that hit the day's limit.
  perform public.ops_tutorial_published('record-a-passage', 'en', repeat('a', 64), null, 'youtube_uploadLimitExceeded');
end $$;
reset role;
do $$ begin
  assert (select failed from ops.tutorial_videos where language = 'en') = 'youtube_uploadLimitExceeded', 'the failure is kept';
end $$;
-- The next day's try, which worked.
set local role service_role;
do $$ begin
  perform public.ops_tutorial_published('record-a-passage', 'en', repeat('a', 64), 'dQw4w9WgXcQ', null);
  assert jsonb_array_length(public.ops_tutorials_due(10)) = 0, 'nothing due once it is up';
  -- What a link to the video in another language goes on to (migration *_tutorial_intake.sql).
  assert public.ops_tutorial_watch('record-a-passage', 'en') = 'dQw4w9WgXcQ', 'the English link goes to the video up';
  assert public.ops_tutorial_watch('record-a-passage', 'es') is null, 'the Spanish link goes to the channel while none is up';
  begin
    perform 1 from ops.tutorial_videos;
    raise exception 'the service role read ops.tutorial_videos directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select failed is null and youtube_id = 'dQw4w9WgXcQ' from ops.tutorial_videos where language = 'en'), 'up, and the failure cleared';
end $$;

-- A newer English version, approved: due, and it replaces the one up.
update ops.tutorial_videos set made_at = now() - interval '1 day' where sha256 = repeat('a', 64);
set local role service_role;
select public.ops_tutorial_made('record-a-passage', 'en', repeat('e', 64), 'Record a passage', 'How to record, again.', 'Translators', 29, 76, 12100000);
do $$ declare v jsonb; begin
  -- What a video's download link and the videos page give (migration *_tutorial_downloads.sql, decisions.md 187):
  -- the newest version a person chose, not one made since and not chosen yet.
  assert public.ops_tutorial_download('record-a-passage', 'en') = repeat('a', 64), 'the English download is the version chosen, not the newer one';
  perform public.ops_tutorials_approve(jsonb_build_array(jsonb_build_array('record-a-passage', 'en', repeat('e', 64))), '0d000000-0000-0000-0000-0000000000aa');
  v := public.ops_tutorials_due(10);
  assert jsonb_array_length(v) = 1 and v->0->>'sha256' = repeat('e', 64) and v->0->>'replaces' = 'dQw4w9WgXcQ', 'the new version replaces the old: %', v;
  -- Once chosen, the newer one is the download at once, before YouTube has it.
  assert public.ops_tutorial_download('record-a-passage', 'en') = repeat('e', 64), 'the English download is the newer version once chosen';
  assert public.ops_tutorial_download('record-a-passage', 'fr') = repeat('c', 64), 'French downloads without a channel connected';
  assert public.ops_tutorial_download('record-a-passage', 'es') is null, 'nothing to download in Spanish until one is chosen';
  v := public.ops_tutorial_list('en');
  assert jsonb_array_length(v) = 1 and v->0->>'sha256' = repeat('e', 64) and v->0->>'title' = 'Record a passage'
    and v->0->>'playlist' = 'Translators' and (v->0->>'seconds')::int = 76 and (v->0->>'youtube')::boolean, 'the English page: %', v;
  v := public.ops_tutorial_list('fr');
  assert jsonb_array_length(v) = 1 and not (v->0->>'youtube')::boolean, 'the French page, nothing on YouTube yet: %', v;
  assert public.ops_tutorial_list('es') = '[]'::jsonb, 'the Spanish page is empty';
end $$;
reset role;

-- diag_reader reads the summary, and nothing else.
grant diag_reader to postgres;
set local role diag_reader;
do $$ declare v jsonb := diag.ops_tutorials(); begin
  assert jsonb_array_length(v->'channels') = 2, 'both channels: %', v->'channels';
  assert v->'channels'->0->>'language' = 'en' and not (v->'channels'->0 ? 'refresh'), 'a channel without its token';
  assert jsonb_array_length(v->'waiting') = 3, 'English''s new version, Spanish and French wait: %', v->'waiting';
  assert (select count(*) from jsonb_array_elements(v->'waiting') w where w->>'language' = 'en' and w->>'replaces' = 'dQw4w9WgXcQ') = 1, 'English replaces the one up';
  assert v->'published'->0->>'language' = 'en' and (v->'published'->0->>'videos')::int = 1, 'one video up in English';
  -- Every film for the video list and timeline: English's two, Spanish's and French's, the one up with its YouTube id.
  v := diag.ops_tutorial_films();
  assert jsonb_array_length(v) = 4, 'four films: %', v;
  assert (select count(*) from jsonb_array_elements(v) f where f->>'language' = 'en' and f->>'youtubeId' = 'dQw4w9WgXcQ') = 1, 'the English film up: %', v;
  begin
    perform public.ops_youtube_refresh('UC8Ry8oFIPWzDygngMwvkBLQ');
    raise exception 'diag_reader read a refresh token';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from ops.tutorial_videos;
    raise exception 'diag_reader read ops.tutorial_videos directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Nobody signed in may touch any of it.
set local role authenticated;
do $$ begin
  begin
    perform public.ops_tutorials_approve('[]'::jsonb, '0d000000-0000-0000-0000-0000000000aa');
    raise exception 'authenticated approved videos';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ops_youtube_refresh('UC8Ry8oFIPWzDygngMwvkBLQ');
    raise exception 'authenticated read a refresh token';
  exception when insufficient_privilege then null;
  end;
  begin
    perform diag.ops_tutorials();
    raise exception 'authenticated read the summary';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ops_tutorial_watch('record-a-passage', 'en');
    raise exception 'authenticated asked where a link goes';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ops_tutorial_download('record-a-passage', 'en');
    raise exception 'authenticated asked where a download goes';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ops_tutorial_list('en');
    raise exception 'authenticated read the videos page''s list';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- The new actions are on the log's list.
select public.ops_record_action('0d000000-0000-0000-0000-0000000000aa', 'tutorials_publish', 'record-a-passage', 'ok', 'approved:1');
select public.ops_record_action('0d000000-0000-0000-0000-0000000000aa', 'youtube_connect', 'UC8Ry8oFIPWzDygngMwvkBLQ', 'ok', 'en');

-- The intake (migration *_tutorial_intake.sql) is a daily job, so a day without its run shows.
do $$ begin
  assert (select every from diag.job_schedule where job = 'tutorial_intake') = interval '1 day', 'the intake is on the schedule';
end $$;

-- How each channel looks (migration *_youtube_channel_look.sql): the job reads the channels with the
-- look each has, and records the one it put on or why it could not, and the comments each holds for
-- review; the dashboard sees whether its look is on and how many are held.
set local role service_role;
do $$ declare v jsonb := public.ops_youtube_channels(); begin
  assert jsonb_array_length(v) = 2 and v->0->>'language' = 'en' and v->0->'branded' = 'null'::jsonb, 'both channels, neither branded: %', v;
  perform public.ops_youtube_branded('UC8Ry8oFIPWzDygngMwvkBLQ', repeat('f', 64), null);
  perform public.ops_youtube_branded('UCpZYy6RO9gLD__QuUDVaEYg', null, 'youtube_quotaExceeded');
  perform public.ops_youtube_held('UC8Ry8oFIPWzDygngMwvkBLQ', 3);
  v := public.ops_youtube_channels();
  assert v->0->>'branded' = repeat('f', 64) and v->1->'branded' = 'null'::jsonb, 'English has its look, Spanish not yet: %', v;
end $$;
reset role;
set local role diag_reader;
do $$ declare v jsonb := diag.ops_tutorials()->'channels'; begin
  assert (v->0->>'branded')::boolean and v->0->'brandFailed' = 'null'::jsonb and (v->0->>'held')::int = 3, 'English branded, 3 held: %', v->0;
  assert not (v->1->>'branded')::boolean and v->1->>'brandFailed' = 'youtube_quotaExceeded', 'Spanish waits, with why: %', v->1;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin
    perform public.ops_youtube_branded('UC8Ry8oFIPWzDygngMwvkBLQ', repeat('0', 64), null);
    raise exception 'authenticated marked a channel branded';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Feedback on the videos (migration *_tutorial_feedback.sql, decisions.md 186): the comments job keeps
-- each comment once, with the tutorial its video is a version of; a note comes from the dashboard; Claude's
-- nightly look reads every open input and the suggestions so far, adds the code changes it found, each
-- comment in English with a reply, what it looked at and suggests; a person accepts, edits or rejects
-- each suggestion once, and an accepted code change waits for Linear until it is filed. The dashboard
-- reads it all. Only the service role writes; authenticated reads nothing.
set local role service_role;
do $$ declare v jsonb; n int; note uuid; bug uuid; thanks uuid; s1 uuid; s2 uuid; r jsonb; begin
  n := public.ops_comments_read('en', 'UC8Ry8oFIPWzDygngMwvkBLQ', jsonb_build_array(
    jsonb_build_object('id', 'Ugcomment-bug-0001', 'videoId', 'dQw4w9WgXcQ', 'text', 'The Save button does nothing', 'publishedAt', now() - interval '2 days'),
    jsonb_build_object('id', 'Ugcomment-thanks-02', 'videoId', 'dQw4w9WgXcQ', 'text', 'Merci !', 'publishedAt', now() - interval '1 day'),
    jsonb_build_object('id', 'bad id', 'videoId', 'dQw4w9WgXcQ', 'text', 'not kept', 'publishedAt', now())));
  assert n = 2, 'two kept, the malformed one left out: %', n;
  assert public.ops_comments_read('en', 'UC8Ry8oFIPWzDygngMwvkBLQ', jsonb_build_array(
    jsonb_build_object('id', 'Ugcomment-bug-0001', 'videoId', 'dQw4w9WgXcQ', 'text', 'again', 'publishedAt', now()))) = 0, 'a comment read again is not new';
  assert public.ops_comments_known(array['Ugcomment-bug-0001', 'Ugcomment-other-03']) = '["Ugcomment-bug-0001"]'::jsonb, 'known: the one read';
  note := public.ops_tutorial_note('record-a-passage', 'The voice says "tap Save" but the button says Done.', '0d000000-0000-0000-0000-0000000000aa');

  v := public.ops_tutorial_review_state();
  assert v->'last' = 'null'::jsonb and jsonb_array_length(v->'inputs') = 3 and jsonb_array_length(v->'suggestions') = 0, 'no look yet, three open inputs: %', v;
  assert v->'inputs'->0->>'ref' = 'Ugcomment-bug-0001' and v->'inputs'->0->>'tutorial' = 'record-a-passage', 'oldest first, with its tutorial: %', v->'inputs'->0;
  assert v->'videos'->0->>'tutorial' = 'record-a-passage' and v->'videos'->0->>'title' = 'Record a passage', 'the videos: %', v->'videos';
  bug := (v->'inputs'->0->>'id')::uuid;
  thanks := (v->'inputs'->1->>'id')::uuid;

  r := public.ops_tutorial_reviewed(jsonb_build_object('sha', repeat('1', 40), 'runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/123',
    'code', jsonb_build_array(jsonb_build_object('key', 'code-1', 'sha', repeat('2', 40), 'tutorial', 'record-a-passage', 'pr', 272,
      'title', 'Save is now Done on the record screen', 'english', 'The button the video taps is called Done now.', 'at', now() - interval '3 hours')),
    'comments', jsonb_build_array(
      jsonb_build_object('id', bug, 'english', 'The Save button does nothing', 'reply', 'Thanks, we are looking at it.', 'replyEnglish', 'Thanks, we are looking at it.'),
      jsonb_build_object('id', thanks, 'english', 'Thank you!', 'reply', '', 'replyEnglish', '')),
    'looked', jsonb_build_array(jsonb_build_object('input', thanks, 'outcome', 'Thanks; nothing to change.'),
      jsonb_build_object('input', gen_random_uuid(), 'outcome', 'an id that is not there')),
    'suggestions', jsonb_build_array(
      jsonb_build_object('kind', 'script', 'tutorial', 'record-a-passage', 'title', 'Say Done, not Save', 'detail', 'Line 9: "Tap Done."', 'inputs', jsonb_build_array('code-1', note)),
      jsonb_build_object('kind', 'code', 'tutorial', 'record-a-passage', 'title', 'Save does nothing on Record', 'detail', 'A viewer says Save does nothing.', 'inputs', jsonb_build_array(bug)))));
  assert (r->>'code')::int = 1 and (r->>'looked')::int = 1 and (r->>'suggested')::int = 2 and (r->>'skipped')::int = 1, 'what the look did: %', r;

  v := public.ops_tutorial_review_state();
  assert v->'last'->>'sha' = repeat('1', 40), 'the look is remembered: %', v->'last';
  assert jsonb_array_length(v->'inputs') = 3, 'three inputs wait on the two suggestions (the thanks is done): %', v->'inputs';
  assert jsonb_array_length(v->'suggestions') = 2, 'two suggestions: %', v->'suggestions';
  s1 := (select (x->>'id')::uuid from jsonb_array_elements(v->'suggestions') x where x->>'kind' = 'script');
  s2 := (select (x->>'id')::uuid from jsonb_array_elements(v->'suggestions') x where x->>'kind' = 'code');
  assert (select jsonb_array_length(x->'inputs') from jsonb_array_elements(v->'suggestions') x where x->>'kind' = 'script') = 2, 'the script change answers the code change and the note';

  -- A second look adds the same code change again (kept once) and gives the thanks to no one.
  r := public.ops_tutorial_reviewed(jsonb_build_object('sha', repeat('3', 40), 'runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/124/attempts/2',
    'code', jsonb_build_array(jsonb_build_object('key', 'k', 'sha', repeat('2', 40), 'tutorial', 'record-a-passage', 'pr', 272,
      'title', 'Save is now Done on the record screen', 'english', 'The button is Done.', 'at', now())),
    'attach', jsonb_build_array(jsonb_build_object('suggestion', s1, 'inputs', jsonb_build_array('k')),
      jsonb_build_object('suggestion', gen_random_uuid(), 'inputs', jsonb_build_array('k')))));
  assert (r->>'code')::int = 1 and (r->>'skipped')::int = 1, 'the second look: %', r;

  -- A person edits the script change and accepts it; rejects the code change; neither can be answered twice.
  assert public.ops_suggestion_decide(s1, 'edited', 'Line 9: "Now tap Done."', null, '0d000000-0000-0000-0000-0000000000aa')->>'result' = 'edited', 'edited';
  assert public.ops_suggestion_decide(s1, 'accepted', null, null, '0d000000-0000-0000-0000-0000000000aa')->>'result' = 'accepted', 'accepted';
  assert public.ops_suggestion_decide(s1, 'rejected', null, 'no', '0d000000-0000-0000-0000-0000000000aa')->>'result' = 'decided', 'once only';
  assert public.ops_suggestion_decide(gen_random_uuid(), 'accepted', null, null, '0d000000-0000-0000-0000-0000000000aa')->>'result' = 'not_found', 'not found';
  assert jsonb_array_length(public.ops_suggestions_to_file(10)) = 0, 'nothing for Linear yet';
  assert public.ops_suggestion_decide(s2, 'accepted', 'A viewer says Save does nothing on Record.', 'worth a look', '0d000000-0000-0000-0000-0000000000aa')->>'kind' = 'code', 'the code change accepted';
  v := public.ops_suggestions_to_file(10);
  assert jsonb_array_length(v) = 1 and v->0->>'detail' = 'A viewer says Save does nothing on Record.' and v->0->'inputs'->0->>'youtubeId' = 'dQw4w9WgXcQ', 'waits for Linear with its comment: %', v;
  assert jsonb_array_length(public.ops_suggestions_to_file(10, s1)) = 0, 'a script change never goes to Linear';
  perform public.ops_suggestion_filed(s2, 'LAN-170', 'https://linear.app/frontierrnd/issue/LAN-170');
  assert jsonb_array_length(public.ops_suggestions_to_file(10)) = 0, 'filed once';
  assert jsonb_array_length(public.ops_tutorial_review_state()->'inputs') = 0, 'every input answered';

  -- Claude writes the accepted script change as a draft pull request (migration *_tutorial_fixes.sql,
  -- decisions.md 186 amended 2026-11-13): it waits for a fix run, which starts it, opens it or says why
  -- not; a later run says it was merged. A state only moves forward, and only a change Claude makes moves.
  v := public.ops_tutorial_fixes(3);
  assert jsonb_array_length(v->'toFix') = 1 and (v->'toFix'->0->>'id')::uuid = s1 and v->'toFix'->0->'fix' = 'null'::jsonb and v->'open' = '[]'::jsonb,
    'the accepted script change waits for Claude, the code change does not: %', v;
  assert jsonb_array_length(public.ops_tutorial_fixes(0)->'toFix') = 0, 'none when none asked';
  assert public.ops_tutorial_fixed(s2, 'working', null, null, null) = 'refused', 'a code change goes to Linear, not to Claude';
  assert public.ops_tutorial_fixed(gen_random_uuid(), 'working', null, null, null) = 'not_found', 'not found';
  assert public.ops_tutorial_fixed(s1, 'open', 451, null, null) = 'refused', 'opened only after it was started';
  assert public.ops_tutorial_fixed(s1, 'working', null, 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/200', null) = 'ok', 'started';
  assert public.ops_tutorial_fixed(s1, 'working', null, 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/201', null) = 'refused', 'one run at a time';
  assert jsonb_array_length(public.ops_tutorial_fixes(3)->'toFix') = 0, 'a run is on it';
  assert public.ops_tutorial_fixed(s1, 'failed', null, null, 'The script has no line 9.') = 'ok', 'no fix, and why';
  assert public.ops_tutorial_fixed(s1, 'working', null, 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/202', null) = 'ok', 'tried again';
  assert public.ops_tutorial_fixed(s1, 'open', 451, null, null) = 'ok', 'its draft pull request';
  v := public.ops_tutorial_fixes(3);
  assert v->'toFix' = '[]'::jsonb and jsonb_array_length(v->'open') = 1 and (v->'open'->0->>'id')::uuid = s1 and (v->'open'->0->>'pr')::int = 451
    and v->'open'->0->>'at' is not null, 'it waits for its checks, with since when: %', v;
  assert public.ops_tutorial_fixed(s1, 'merged', 452, null, null) = 'refused', 'another pull request';
  assert public.ops_tutorial_fixed(s1, 'merged', 451, null, null) = 'ok', 'merged';
  assert public.ops_tutorial_fixed(s1, 'closed', 451, null, null) = 'refused', 'merged stays merged';
  assert public.ops_tutorial_fixes(3)->'open' = '[]'::jsonb, 'nothing waits';
  v := (select x->'fix' from jsonb_array_elements(public.ops_tutorial_review_state()->'suggestions') x where (x->>'id')::uuid = s1);
  assert v->>'state' = 'merged' and (v->>'pr')::int = 451 and v->>'run' like '%/runs/202' and v->'note' = 'null'::jsonb and v->>'at' is not null, 'where its fix is: %', v;
end $$;
reset role;
do $$ begin
  assert (select edited_by is not null and detail = 'Line 9: "Now tap Done."' from ops.tutorial_suggestions where kind = 'script'), 'the edit is kept, and who made it';
  assert (select reason = 'worth a look' and issue = 'LAN-170' from ops.tutorial_suggestions where kind = 'code'), 'the reason and the issue';
  assert (select count(*) from ops.tutorial_inputs where kind = 'code') = 1, 'one code change';
  assert (select count(*) from ops.tutorial_reviews) = 2, 'two looks';
  begin
    insert into ops.tutorial_suggestions (kind, tutorial, title, detail) values ('new', 'record-a-passage', 'x', 'y');
    raise exception 'a new video named an old one';
  exception when check_violation then null;
  end;
  -- A comment is kept 30 days after it was posted (migration *_tutorial_comments_30_days.sql); a note a year.
  update ops.tutorial_inputs set at = now() - interval '31 days' where ref = 'Ugcomment-thanks-02' or kind = 'note';
end $$;
set local role service_role;
select public.ops_comments_read('en', 'UC8Ry8oFIPWzDygngMwvkBLQ', jsonb_build_array(
  jsonb_build_object('id', 'Ugcomment-old-0004', 'videoId', 'dQw4w9WgXcQ', 'text', 'Too old to copy', 'publishedAt', now() - interval '31 days'),
  jsonb_build_object('id', 'Ugcomment-open-005', 'videoId', 'dQw4w9WgXcQ', 'text', 'Where is the record button?', 'publishedAt', now() - interval '3 days')));
reset role;
do $$ begin
  assert not exists (select 1 from ops.tutorial_inputs where ref = 'Ugcomment-thanks-02'), 'a comment is kept 30 days';
  assert not exists (select 1 from ops.tutorial_inputs where ref = 'Ugcomment-old-0004'), 'a comment posted over 30 days ago is not copied';
  assert exists (select 1 from ops.tutorial_inputs where kind = 'note'), 'a note is kept a year';
  assert exists (select 1 from ops.tutorial_inputs where ref = 'Ugcomment-bug-0001'), 'a comment of 2 days stays';
  -- One Claude has not looked at goes too, by the hourly job, and its suggestions stay.
  update ops.tutorial_inputs set at = now() - interval '31 days' where ref in ('Ugcomment-open-005', 'Ugcomment-bug-0001');
  assert ops.tutorial_comments_expire() = 2, 'the two comments over 30 days taken out';
  assert not exists (select 1 from ops.tutorial_inputs where kind = 'comment'), 'no comment over 30 days old';
  assert (select count(*) from ops.tutorial_suggestions) = 2, 'the suggestions stay without their comment';
  assert (select command from cron.job where jobname = 'langquest-purge-tutorial-comments') like '%ops.tutorial_comments_expire()%', 'taken out each hour';
end $$;
set local role diag_reader;
do $$ declare v jsonb := diag.ops_tutorial_feedback(); begin
  assert jsonb_array_length(v->'suggestions') = 2 and (v->>'open')::int = 0 and (v->>'waiting')::int = 0 and (v->>'unfiled')::int = 0, 'the dashboard''s feedback: %', v;
  assert v->'last'->>'runUrl' like '%/124/attempts/2' and v->'videos'->0->>'title' = 'Record a passage', 'its last look and the videos: %', v;
  assert (v->>'toFix')::int = 0 and (v->>'fixing')::int = 0 and (v->>'toMerge')::int = 0, 'no fix waits: %', v;
  assert (select x->'fix'->>'state' from jsonb_array_elements(v->'suggestions') x where x->>'kind' = 'script') = 'merged', 'the dashboard sees the fix';
end $$;
reset role;
-- A fix still open stays on the dashboard after 30 days; a run that stopped leaves its fix to the next after three hours.
do $$ begin
  update ops.tutorial_suggestions set decided_at = now() - interval '40 days', fix_state = 'open', fix_at = now() - interval '40 days' where kind = 'script';
  assert jsonb_array_length(diag.ops_tutorial_feedback()->'suggestions') = 2 and (diag.ops_tutorial_feedback()->>'toMerge')::int = 1, 'an open fix stays listed';
  update ops.tutorial_suggestions set fix_state = 'working', fix_pr = null, fix_at = now() - interval '4 hours' where kind = 'script';
  assert jsonb_array_length(public.ops_tutorial_fixes(3)->'toFix') = 1, 'a stale run''s fix is handed out again';
  begin
    update ops.tutorial_suggestions set fix_state = 'open', fix_pr = null where kind = 'script';
    raise exception 'an open fix with no pull request';
  exception when check_violation then null;
  end;
  begin
    update ops.tutorial_suggestions set fix_state = 'working', fix_at = now() where kind = 'code';
    raise exception 'a fix for a code change';
  exception when check_violation then null;
  end;
end $$;
-- An admin's instruction from a card on the dashboard is accepted as written, with no second Accept, and
-- answers the inputs the card showed; the next fix run takes it like any accepted change.
set local role service_role;
do $$ declare v jsonb; c uuid; s uuid; begin
  perform public.ops_comments_read('en', 'UC8Ry8oFIPWzDygngMwvkBLQ', jsonb_build_array(
    jsonb_build_object('id', 'Ugcomment-steps-06', 'videoId', 'dQw4w9WgXcQ', 'text', 'It stops at step 4', 'publishedAt', now() - interval '1 day')));
  c := (select (x->>'id')::uuid from jsonb_array_elements(public.ops_tutorial_review_state()->'inputs') x where x->>'ref' = 'Ugcomment-steps-06');
  s := public.ops_tutorial_instruct('record-a-passage', 'en', 'Record a passage (en): the film fails',
    'The button is now called On this device. Change the script.', array[c, c], '0d000000-0000-0000-0000-0000000000aa');
  assert not exists (select 1 from jsonb_array_elements(public.ops_tutorial_review_state()->'inputs') x where (x->>'id')::uuid = c),
    'the comment it answers is looked at, so the look does not suggest it again';
  v := (select x from jsonb_array_elements(public.ops_tutorial_fixes(3)->'toFix') x where (x->>'id')::uuid = s);
  assert v->>'kind' = 'instruction' and v->>'decision' = 'accepted' and v->>'language' = 'en' and v->>'title' = 'Record a passage (en): the film fails'
    and v->>'detail' like 'The button is now called On this device.%' and v->'fix' = 'null'::jsonb and jsonb_array_length(v->'inputs') = 2,
    'an instruction waits for the next fix run, with the note and the comment: %', v;
  assert public.ops_suggestion_decide(s, 'rejected', null, null, '0d000000-0000-0000-0000-0000000000aa')->>'result' = 'decided', 'no second answer';
  assert public.ops_tutorial_fixed(s, 'working', null, 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/300', null) = 'ok', 'a run starts it';
  begin
    perform public.ops_tutorial_instruct(null, null, null, 'Do it.', null, '0d000000-0000-0000-0000-0000000000aa');
    raise exception 'an instruction for no video';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.ops_tutorial_instruct('record-a-passage', null, null, ' ', null, '0d000000-0000-0000-0000-0000000000aa');
    raise exception 'an empty instruction';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.ops_tutorial_instruct('record-a-passage', null, null, 'Do it.', array_fill(c, array[21]), '0d000000-0000-0000-0000-0000000000aa');
    raise exception 'an instruction naming 21 inputs';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select count(*) from ops.tutorial_inputs where kind = 'note' and by = '0d000000-0000-0000-0000-0000000000aa' and looked_at is not null
    and text like 'The button is now called%') = 1, 'the instruction is kept as its writer''s note';
  assert (select decided_by = '0d000000-0000-0000-0000-0000000000aa' and fix_state = 'working' from ops.tutorial_suggestions where kind = 'instruction'), 'accepted by its writer';
  begin
    update ops.tutorial_suggestions set decision = null, decided_at = null, decided_by = null, fix_state = null, fix_at = null where kind = 'instruction';
    raise exception 'an instruction not accepted';
  exception when check_violation then null;
  end;
  begin
    update ops.tutorial_suggestions set decision = null, decided_at = null, decided_by = null where kind = 'script';
    raise exception 'a fix for a change no one accepted';
  exception when check_violation then null;
  end;
end $$;
-- A clear fix (decisions.md 186, amended 2026-11-16): the look calls a change to a video's script, screens
-- or voice clear, and Claude accepts it at once, with no person; anything else marked clear waits for a
-- person. A suggestion may name its film's language. A fix that needs no change is unneeded, and one
-- whose checks failed goes from open to failed, keeping its pull request.
set local role service_role;
do $$ declare r jsonb; v jsonb; c uuid; d uuid; w uuid; begin
  r := public.ops_tutorial_reviewed(jsonb_build_object('sha', repeat('4', 40), 'runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/125',
    'suggestions', jsonb_build_array(
      jsonb_build_object('kind', 'screen', 'tutorial', 'record-a-passage', 'language', 'fr', 'clear', true, 'title', 'Tap On this device', 'detail', 'Step 4 taps a button that is gone.', 'inputs', '[]'::jsonb),
      jsonb_build_object('kind', 'script', 'tutorial', 'record-a-passage', 'clear', true, 'title', 'Say Done', 'detail', 'Step 9 says Save.', 'inputs', '[]'::jsonb),
      jsonb_build_object('kind', 'code', 'tutorial', 'record-a-passage', 'clear', true, 'title', 'Name the button', 'detail', 'The app.', 'inputs', '[]'::jsonb))));
  assert (r->>'suggested')::int = 3, 'three suggestions: %', r;
  v := public.ops_tutorial_review_state();
  c := (select (x->>'id')::uuid from jsonb_array_elements(v->'suggestions') x where x->>'title' = 'Tap On this device');
  d := (select (x->>'id')::uuid from jsonb_array_elements(v->'suggestions') x where x->>'title' = 'Say Done');
  w := (select (x->>'id')::uuid from jsonb_array_elements(v->'suggestions') x where x->>'title' = 'Name the button');
  v := (select x from jsonb_array_elements(public.ops_tutorial_fixes(10)->'toFix') x where (x->>'id')::uuid = c);
  assert v->>'decision' = 'accepted' and (v->>'clear')::boolean and v->>'language' = 'fr' and v->>'decidedAt' is not null,
    'a clear fix is accepted by Claude and waits for the next fix run: %', v;
  v := (select x from jsonb_array_elements(public.ops_tutorial_review_state()->'suggestions') x where (x->>'id')::uuid = w);
  assert v->'decision' = 'null'::jsonb and not (v->>'clear')::boolean, 'a change to the app is never clear: it waits for a person: %', v;
  assert public.ops_tutorial_fixed(c, 'working', null, 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/400', null) = 'ok', 'started';
  assert public.ops_tutorial_fixed(c, 'unneeded', null, null, 'Step 4 already taps On this device.') = 'ok', 'nothing to change';
  assert public.ops_tutorial_fixed(c, 'open', 470, null, null) = 'refused', 'an unneeded fix opens nothing';
  assert public.ops_tutorial_fixed(c, 'working', null, null, null) = 'refused', 'and is not started again';
  assert public.ops_tutorial_fixed(d, 'working', null, 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/401', null) = 'ok', 'started';
  assert public.ops_tutorial_fixed(d, 'open', 471, null, null) = 'ok', 'its pull request runs its checks';
  assert public.ops_tutorial_fixed(d, 'failed', 472, null, 'Its checks failed.') = 'refused', 'another pull request';
  assert public.ops_tutorial_fixed(d, 'failed', 471, null, 'Its checks failed; the pull request is closed.') = 'ok', 'its checks failed';
  v := (select x->'fix' from jsonb_array_elements(public.ops_tutorial_review_state()->'suggestions') x where (x->>'id')::uuid = d);
  assert v->>'state' = 'failed' and (v->>'pr')::int = 471 and v->>'note' like 'Its checks failed%', 'failed, with its pull request and why: %', v;
  assert public.ops_tutorial_fixed(d, 'working', null, 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/402', null) = 'ok', 'a failed fix can be tried again';
end $$;
reset role;
do $$ begin
  assert (select decided_by is null and clear and fix_state = 'unneeded' and fix_note like 'Step 4 already%' from ops.tutorial_suggestions where title = 'Tap On this device'),
    'decided by Claude, not by a person, and unneeded with why';
  begin
    update ops.tutorial_suggestions set clear = true, decision = 'accepted', decided_at = now() where title = 'Name the button';
    raise exception 'a clear change to the app';
  exception when check_violation then null;
  end;
  begin
    update ops.tutorial_suggestions set decision = 'accepted', decided_at = now() where title = 'Name the button';
    raise exception 'accepted by no one';
  exception when check_violation then null;
  end;
end $$;
-- Pictures (decisions.md 186, amended 2026-11-17): a new suggestion keeps the pictures the look picked; a later
-- look adds them to one that waits or has none, and pictures after its fix only once the fix is merged. It may
-- say a waiting one's words again in plain words, never over an admin's edit. A list or words the table would
-- refuse are skipped and counted, never the whole look.
set local role service_role;
do $$ declare r jsonb; v jsonb; p jsonb; q jsonb; s uuid; d uuid; e uuid; begin
  p := jsonb_build_array(jsonb_build_object('picture', repeat('c', 64) || '.jpg', 'language', 'fr', 'tutorial', 'study-a-passage', 'kind', 'still', 'n', 14,
    'at', 81.31, 'caption', 'The dark band starts in the middle of the words.', 'ring', jsonb_build_array(0.61, 0.38, 0.25, 0.35)));
  q := jsonb_build_array(jsonb_build_object('picture', repeat('d', 64) || '.png', 'language', 'en', 'tutorial', 'record-a-passage', 'kind', 'step', 'n', 9,
    'caption', 'Step 9. The button says Done.'));
  r := public.ops_tutorial_reviewed(jsonb_build_object('sha', repeat('5', 40), 'runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/126',
    'suggestions', jsonb_build_array(
      jsonb_build_object('kind', 'screen', 'tutorial', 'study-a-passage', 'language', 'fr', 'title', 'Wait for the dark band', 'detail', 'd', 'inputs', '[]'::jsonb, 'pictures', p),
      jsonb_build_object('kind', 'screen', 'tutorial', 'study-a-passage', 'title', 'Bad pictures', 'detail', 'd', 'inputs', '[]'::jsonb,
        'pictures', jsonb_build_array(jsonb_build_object('picture', 'x.png'))))));
  assert (r->>'suggested')::int = 2 and (r->>'skipped')::int = 1 and (r->>'pictured')::int = 0, 'both suggested, the bad pictures skipped: %', r;
  v := (select x from jsonb_array_elements(public.ops_tutorial_review_state()->'suggestions') x where x->>'title' = 'Wait for the dark band');
  assert v->'pictures' = p and v->'after' = '[]'::jsonb, 'a suggestion keeps its pictures: %', v;
  s := (v->>'id')::uuid;
  assert (select x->'pictures' from jsonb_array_elements(public.ops_tutorial_review_state()->'suggestions') x where x->>'title' = 'Bad pictures') = '[]'::jsonb, 'none kept';
  e := (select (x->>'id')::uuid from jsonb_array_elements(public.ops_tutorial_review_state()->'suggestions') x where x->>'title' = 'Bad pictures');
  assert public.ops_suggestion_decide(e, 'edited', 'An admin''s own words.', null, '0d000000-0000-0000-0000-0000000000aa')->>'result' = 'edited', 'an admin edits it';
  d := (select (x->>'id')::uuid from jsonb_array_elements(public.ops_tutorial_review_state()->'suggestions') x where x->>'title' = 'Say Done');
  assert public.ops_tutorial_fixed(d, 'open', 473, null, null) = 'ok' and public.ops_tutorial_fixed(d, 'merged', 473, null, null) = 'ok', 'its fix merged';
  r := public.ops_tutorial_reviewed(jsonb_build_object('sha', repeat('6', 40), 'runUrl', 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/127',
    'pictures', jsonb_build_array(
      jsonb_build_object('suggestion', s, 'when', 'now', 'pictures', q),
      jsonb_build_object('suggestion', d, 'pictures', q),
      jsonb_build_object('suggestion', d, 'when', 'after', 'pictures', p),
      jsonb_build_object('suggestion', s, 'when', 'after', 'pictures', p),
      jsonb_build_object('suggestion', d, 'when', 'now', 'pictures', p),
      jsonb_build_object('suggestion', gen_random_uuid(), 'pictures', p),
      jsonb_build_object('suggestion', s, 'pictures', '[]'::jsonb),
      jsonb_build_object('suggestion', s, 'title', 'At the end, the screen is only half dark', 'detail', 'Picture 1 shows it.'),
      jsonb_build_object('suggestion', e, 'title', 'Other words', 'detail', 'Other words.'),
      jsonb_build_object('suggestion', d, 'title', 'Other words'),
      jsonb_build_object('suggestion', s, 'title', repeat('x', 201)))));
  assert (r->>'pictured')::int = 4 and (r->>'skipped')::int = 7,
    'a waiting one''s pictures and words replaced, an answered one''s pictures added once, after only once merged; the rest skipped: %', r;
  v := (select x from jsonb_array_elements(public.ops_tutorial_review_state()->'suggestions') x where (x->>'id')::uuid = s);
  assert v->'pictures' = q and v->'after' = '[]'::jsonb, 'the waiting suggestion shows its new pictures: %', v;
  assert v->>'title' = 'At the end, the screen is only half dark' and v->>'detail' = 'Picture 1 shows it.' and v->'editedAt' = 'null'::jsonb,
    'and its words, said again in plain words, as no admin''s edit: %', v;
  v := (select x from jsonb_array_elements(public.ops_tutorial_review_state()->'suggestions') x where (x->>'id')::uuid = e);
  assert v->>'title' = 'Bad pictures' and v->>'detail' = 'An admin''s own words.', 'an admin''s edit is never written over: %', v;
  v := (select x from jsonb_array_elements(public.ops_tutorial_review_state()->'suggestions') x where (x->>'id')::uuid = d);
  assert v->'pictures' = q and v->'after' = p and v->>'title' = 'Say Done', 'the merged fix shows before and after, in its own words: %', v;
end $$;
reset role;
set local role diag_reader;
do $$ declare v jsonb; begin
  v := (select x from jsonb_array_elements(diag.ops_tutorial_feedback()->'suggestions') x where x->>'title' = 'Say Done');
  assert jsonb_array_length(v->'pictures') = 1 and v->'after'->0->>'caption' like 'The dark band%' and v->'after'->0->'ring' = '[0.61, 0.38, 0.25, 0.35]'::jsonb,
    'the dashboard reads the pictures, before and after, with the ring: %', v;
end $$;
reset role;
do $$ begin
  begin
    update ops.tutorial_suggestions set pictures = '[{"picture": "../x.png"}]'::jsonb where title = 'Say Done';
    raise exception 'a picture with no hash';
  exception when check_violation then null;
  end;
  begin
    update ops.tutorial_suggestions set after_pictures = (select jsonb_agg(pictures->0) from generate_series(1, 7), ops.tutorial_suggestions where title = 'Say Done')
      where title = 'Say Done';
    raise exception 'seven pictures';
  exception when check_violation then null;
  end;
end $$;
set local role authenticated;
do $$ begin
  begin
    perform public.ops_comments_read('en', 'UC8Ry8oFIPWzDygngMwvkBLQ', '[]'::jsonb);
    raise exception 'authenticated kept comments';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ops_tutorial_reviewed('{}'::jsonb);
    raise exception 'authenticated wrote a look';
  exception when insufficient_privilege then null;
  end;
  begin
    perform diag.ops_tutorial_feedback();
    raise exception 'authenticated read the feedback';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ops_tutorial_fixed(gen_random_uuid(), 'working', null, null, null);
    raise exception 'authenticated moved a fix';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ops_tutorial_fixes(3);
    raise exception 'authenticated read the fixes';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ops_tutorial_instruct('record-a-passage', null, null, 'Do it.', null, gen_random_uuid());
    raise exception 'authenticated wrote an instruction';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select public.ops_record_action('0d000000-0000-0000-0000-0000000000aa', 'suggestion_accepted', '0d000000-0000-0000-0000-0000000000bb', 'ok', 'script');
do $$ begin
  assert (select every from diag.job_schedule where job = 'tutorial_comments') = interval '1 day', 'the comments job is on the schedule';
  assert (select every from diag.job_schedule where job = 'tutorial_review') = interval '1 day', 'so is Claude''s look';
end $$;

-- The order the job puts them up in (migration *_tutorial_publish_order.sql): English, then French,
-- then the other languages' videos in turn, by their place in the plan.
set local role service_role;
select public.ops_youtube_connected('UCDdH4nGZOzkE4cAsk43qhog', 'fr', 'LangQuest - Français', '1//refresh-fr-0123456789', '0d000000-0000-0000-0000-0000000000aa', 'made');
select public.ops_tutorial_made('key-words', 'es', repeat('f', 64), 'Palabras clave', 'Cómo marcar palabras.', 'Traductores', 5, 60, 9000000);
do $$ declare v jsonb; begin
  perform public.ops_tutorials_approve(jsonb_build_array(jsonb_build_array('record-a-passage', 'es', repeat('b', 64)),
    jsonb_build_array('key-words', 'es', repeat('f', 64))), '0d000000-0000-0000-0000-0000000000aa');
  v := public.ops_tutorials_due(10);
  assert (select string_agg((x->>'language') || ' ' || (x->>'tutorial'), ', ' order by n) from jsonb_array_elements(v) with ordinality t(x, n))
    = 'en record-a-passage, fr record-a-passage, es key-words, es record-a-passage', 'English, then French, then the rest by place: %', v;
end $$;
reset role;

-- Only a video's newest version goes up (migration *_tutorial_newest_due.sql, decisions.md 191): a chosen
-- version not up yet waits no longer once a newer one is made, and the newer one goes up once it is chosen.
update ops.tutorial_videos set made_at = now() - interval '1 day' where sha256 = repeat('f', 64);
set local role service_role;
select public.ops_tutorial_made('key-words', 'es', repeat('7', 64), 'Palabras clave', 'Así se marcan las palabras.', 'Traductores', 5, 60, 9000000);
do $$ declare v jsonb; begin
  v := public.ops_tutorials_due(10);
  assert not exists (select 1 from jsonb_array_elements(v) x where x->>'tutorial' = 'key-words'), 'the older chosen version waits no longer: %', v;
  perform public.ops_tutorials_approve(jsonb_build_array(jsonb_build_array('key-words', 'es', repeat('7', 64))), '0d000000-0000-0000-0000-0000000000aa');
  v := public.ops_tutorials_due(10);
  assert exists (select 1 from jsonb_array_elements(v) x where x->>'tutorial' = 'key-words' and x->>'sha256' = repeat('7', 64)), 'the newest goes up once chosen: %', v;
end $$;
reset role;

-- Each channel's trailer (migration *_youtube_channel_trailer.sql, decisions.md 189): the job reads the
-- video the language's newest trailer became, so a channel whose trailer was not set gets it next run.
set local role service_role;
select public.ops_tutorial_made('trailer', 'es', repeat('9', 64), 'LangQuest Next · Escucha. Habla.', 'Cada uno merece un lugar seguro.', 'Todos', 0, 48, 5000000);
do $$ declare v jsonb; begin
  v := public.ops_youtube_channels();
  assert (select x->'trailer' from jsonb_array_elements(v) x where x->>'language' = 'es') = 'null'::jsonb, 'not up yet: %', v;
  perform public.ops_tutorial_published('trailer', 'es', repeat('9', 64), 'Tr41l3r_es0', null);
  v := public.ops_youtube_channels();
  assert (select x->>'trailer' from jsonb_array_elements(v) x where x->>'language' = 'es') = 'Tr41l3r_es0', 'Spanish has its trailer: %', v;
  assert (select x->'trailer' from jsonb_array_elements(v) x where x->>'language' = 'en') = 'null'::jsonb, 'English has none: %', v;
end $$;
reset role;

-- Films go up as soon as they are filmed (migration *_tutorial_choose_on_intake.sql, decisions.md 192): the
-- intake chooses a wide film itself, as it lists it or later, with nobody's name; never one already up.
set local role service_role;
do $$ declare v jsonb; begin
  assert public.ops_tutorial_made('find-your-way-around', 'es', repeat('3', 64), 'Ubícate', 'Por dónde ir.', 'Todos', 1, 40, 4000000, true),
    'a wide film is new';
  v := public.ops_tutorials_due(10);
  assert exists (select 1 from jsonb_array_elements(v) x where x->>'tutorial' = 'find-your-way-around'), 'it goes up without a Publish: %', v;
  -- A tall film, listed by an intake before this one, waits; the next intake that finds it wide chooses it.
  assert public.ops_tutorial_made('join-your-team', 'es', repeat('4', 64), 'Únete', 'Cómo unirte.', 'Todos', 2, 40, 4000000), 'new';
  v := public.ops_tutorials_due(10);
  assert not exists (select 1 from jsonb_array_elements(v) x where x->>'tutorial' = 'join-your-team'), 'a tall film waits for a person: %', v;
  assert not public.ops_tutorial_made('join-your-team', 'es', repeat('4', 64), 'Únete', 'Cómo unirte.', 'Todos', 2, 40, 4000000, true), 'not new';
  v := public.ops_tutorials_due(10);
  assert exists (select 1 from jsonb_array_elements(v) x where x->>'tutorial' = 'join-your-team'), 'chosen when it comes in wide: %', v;
  perform public.ops_tutorial_published('find-your-way-around', 'es', repeat('3', 64), 'Ub1cat3_es0', null);
end $$;
reset role;
do $$ begin
  assert (select chosen_at is not null and chosen_by is null from ops.tutorial_videos where sha256 = repeat('3', 64)), 'chosen by the intake, by nobody';
  begin
    update ops.tutorial_videos set chosen_at = null, chosen_by = '0d000000-0000-0000-0000-0000000000aa' where sha256 = repeat('4', 64);
    raise exception 'a chooser without a time was accepted';
  exception when check_violation then null;
  end;
end $$;
-- One already up is not chosen again.
update ops.tutorial_videos set chosen_at = null where sha256 = repeat('3', 64);
set local role service_role;
select public.ops_tutorial_made('find-your-way-around', 'es', repeat('3', 64), 'Ubícate', 'Por dónde ir.', 'Todos', 1, 40, 4000000, true);
reset role;
do $$ begin
  assert (select chosen_at is null from ops.tutorial_videos where sha256 = repeat('3', 64)), 'one up is not chosen again';
  begin
    set local role authenticated;
    perform public.ops_tutorial_made('join-your-team', 'es', repeat('5', 64), 'Únete', 'x', 'Todos', 2, 40, 1, true);
    raise exception 'a signed-in person listed a film';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- A tick from before the films were wide puts nothing up (migration *_tutorial_old_ticks.sql, decisions.md 192
-- amended): the job skips it, the dashboard shows it as not chosen, and Publish can choose it again.
set local role service_role;
select public.ops_tutorial_made('give-each-part-its-verse', 'es', repeat('6', 64), 'Versículos', 'Cada parte, su versículo.', 'Traductores', 9, 40, 4000000);
select public.ops_tutorials_approve(jsonb_build_array(jsonb_build_array('give-each-part-its-verse', 'es', repeat('6', 64))), '0d000000-0000-0000-0000-0000000000aa');
reset role;
update ops.tutorial_videos set chosen_at = timestamptz '2026-10-29 04:15:00+00' where sha256 = repeat('6', 64);
set local role service_role;
do $$ declare v jsonb; begin
  v := public.ops_tutorials_due(500);
  assert not exists (select 1 from jsonb_array_elements(v) x where x->>'sha256' = repeat('6', 64)), 'an old tick goes nowhere: %', v;
  assert public.ops_tutorials_approve(jsonb_build_array(jsonb_build_array('give-each-part-its-verse', 'es', repeat('6', 64))),
    '0d000000-0000-0000-0000-0000000000aa') = 1, 'Publish chooses it again';
  v := public.ops_tutorials_due(500);
  assert exists (select 1 from jsonb_array_elements(v) x where x->>'sha256' = repeat('6', 64)), 'chosen again, it goes up: %', v;
end $$;
reset role;
update ops.tutorial_videos set chosen_at = timestamptz '2026-10-29 04:15:00+00' where sha256 = repeat('6', 64);
set local role diag_reader;
do $$ declare w jsonb; begin
  select x into w from jsonb_array_elements(diag.ops_tutorials()->'waiting') x where x->>'sha256' = repeat('6', 64);
  assert w is not null and w->'chosenAt' = 'null'::jsonb, 'the dashboard shows an old tick as not chosen: %', w;
end $$;
reset role;

-- What is up, for the job to put each channel's playlists in order (migration *_tutorials_up.sql, decisions.md
-- 180 amended): each video's newest version up, its playlist and place, and the videos its older versions became.
update ops.tutorial_videos set published_at = now() - interval '1 day' where language = 'en' and sha256 = repeat('a', 64);
set local role service_role;
do $$ declare v jsonb; x jsonb; begin
  perform public.ops_tutorial_published('record-a-passage', 'en', repeat('e', 64), 'N3wV3rs10n0', null);
  v := public.ops_tutorials_up();
  assert jsonb_array_length(v) = 3, 'English''s one video and Spanish''s two; French has none up: %', v;
  select e into x from jsonb_array_elements(v) e where e->>'language' = 'en';
  assert x->>'youtubeId' = 'N3wV3rs10n0' and x->'older' = '["dQw4w9WgXcQ"]'::jsonb and x->>'playlist' = 'Translators'
    and (x->>'position')::int = 29 and x->>'channelId' = 'UC8Ry8oFIPWzDygngMwvkBLQ', 'the newest English version, and the old one it replaced: %', x;
  assert (select array_agg(e->>'tutorial') from jsonb_array_elements(v) e where e->>'language' = 'es') = array['trailer', 'find-your-way-around'],
    'Spanish in the plan''s order, the trailer first: %', v;
  assert (select bool_and(e->'older' = '[]'::jsonb) from jsonb_array_elements(v) e where e->>'language' = 'es'), 'nothing older in Spanish: %', v;
end $$;
reset role;
do $$ begin
  set local role authenticated;
  perform public.ops_tutorials_up();
  raise exception 'a signed-in person read what is up';
exception when insufficient_privilege then null;
end $$;
reset role;

rollback;
