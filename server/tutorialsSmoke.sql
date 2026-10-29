-- Tutorial videos on YouTube (migration *_tutorial_videos.sql, decisions.md
-- 180): only the service role connects a channel, reads its refresh token back
-- out of Vault, records a video and marks one published; diag_reader reads the
-- dashboard's summary, never a token; the intake that lists the nightly
-- films is a daily job, as are the read of the videos' comments and Claude's
-- look at them. Run by
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
  -- An answered comment a year old is taken out on the next read.
  update ops.tutorial_inputs set at = now() - interval '13 months' where ref = 'Ugcomment-thanks-02';
end $$;
set local role service_role;
select public.ops_comments_read('en', 'UC8Ry8oFIPWzDygngMwvkBLQ', '[]'::jsonb);
reset role;
do $$ begin
  assert not exists (select 1 from ops.tutorial_inputs where ref = 'Ugcomment-thanks-02'), 'kept a year';
end $$;
set local role diag_reader;
do $$ declare v jsonb := diag.ops_tutorial_feedback(); begin
  assert jsonb_array_length(v->'suggestions') = 2 and (v->>'open')::int = 0 and (v->>'waiting')::int = 0 and (v->>'unfiled')::int = 0, 'the dashboard''s feedback: %', v;
  assert v->'last'->>'runUrl' like '%/124/attempts/2' and v->'videos'->0->>'title' = 'Record a passage', 'its last look and the videos: %', v;
end $$;
reset role;
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

rollback;
