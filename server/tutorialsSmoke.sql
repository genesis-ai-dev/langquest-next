-- Tutorial videos on YouTube (migration *_tutorial_videos.sql, decisions.md
-- 180): only the service role connects a channel, reads its refresh token back
-- out of Vault, records a video and marks one published; diag_reader reads the
-- dashboard's summary, never a token; the intake that lists the nightly
-- films is a daily job. Run by `npm run db:test`. Every write rolls back.
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
  perform public.ops_tutorials_approve(jsonb_build_array(jsonb_build_array('record-a-passage', 'en', repeat('e', 64))), '0d000000-0000-0000-0000-0000000000aa');
  v := public.ops_tutorials_due(10);
  assert jsonb_array_length(v) = 1 and v->0->>'sha256' = repeat('e', 64) and v->0->>'replaces' = 'dQw4w9WgXcQ', 'the new version replaces the old: %', v;
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

rollback;
