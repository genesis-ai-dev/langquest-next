-- Comments copied from our YouTube videos are kept 30 days, not a year
-- (decisions.md 186, amended 2026-11-03). YouTube's developer policies let an
-- API client keep what it reads about other people for 30 days, then it must
-- read it again or delete it, and Google's quota audit checks that we do what
-- the privacy policy says (apps/mobile/public/privacy.html, "Our YouTube
-- channels"). A comment goes, with its English and the reply Claude
-- suggested, 30 days after it was posted, whether or not Claude has looked at
-- it and whether or not a suggestion that answers it still waits; the
-- suggestion stays, without it. A comment already older is never copied, and
-- the comments job reads back only as far (server/tutorialCommentsModel.ts
-- KEPT_DAYS), so nothing taken out comes back. Code changes and notes keep
-- the year they had.
--
-- An hourly pg_cron job takes them out, so a comments job or a nightly look
-- that stops running keeps nothing longer. It needs no secret, so a reset
-- keeps it (server/cronSmoke.sql).

-- Takes out the comments posted more than 30 days ago; how many.
create or replace function ops.tutorial_comments_expire() returns int
language sql set search_path = '' as $$
  with gone as (
    delete from ops.tutorial_inputs where kind = 'comment' and at < now() - interval '30 days' returning 1)
  select count(*)::int from gone
$$;
revoke all on function ops.tutorial_comments_expire from public;

-- New comments from a channel ({id, videoId, text, publishedAt} each), each kept with the
-- tutorial its video is a version of; how many were new. A comment posted more than 30 days
-- ago is not kept. Takes out the comments over 30 days old, and code changes and notes over
-- a year old and answered.
create or replace function public.ops_comments_read(p_language text, p_channel text, p_comments jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_new int;
begin
  perform ops.tutorial_comments_expire();
  delete from ops.tutorial_inputs i
    where i.kind <> 'comment' and i.at < now() - interval '1 year' and not ops.tutorial_input_open(i.id, i.looked_at);
  insert into ops.tutorial_inputs (kind, ref, channel_id, language, youtube_id, tutorial, text, at)
  select 'comment', c->>'id', p_channel, p_language, c->>'videoId',
    (select v.tutorial from ops.tutorial_videos v where v.youtube_id = c->>'videoId' limit 1),
    left(c->>'text', 10000), (c->>'publishedAt')::timestamptz
  from jsonb_array_elements(coalesce(p_comments, '[]'::jsonb)) c
  where c->>'id' ~ '^[A-Za-z0-9_.-]{8,100}$' and length(c->>'text') > 0
    and (c->>'videoId' is null or c->>'videoId' ~ '^[A-Za-z0-9_-]{11}$')
    and (c->>'publishedAt')::timestamptz >= now() - interval '30 days'
  on conflict (ref) where kind = 'comment' do nothing;
  get diagnostics v_new = row_count;
  return v_new;
end $$;

-- What was kept for a year until now goes at once.
select ops.tutorial_comments_expire();

do $$
begin
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'langquest-purge-tutorial-comments';
  perform cron.schedule('langquest-purge-tutorial-comments', '29 * * * *', $job$
    select ops.tutorial_comments_expire();
  $job$);
end $$;
