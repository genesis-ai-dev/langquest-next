-- When each channel's uploads of the last 24 hours went up, for the publish
-- job (server/tutorialPublisher.ts, docs/tutorial-videos.md, decisions.md 180
-- amended). YouTube counts a channel's own limit over the last 24 hours, not
-- by the day: on 2026-11-23 the run reached Spanish about a minute before
-- the day before's ten uploads were 24 hours old, YouTube refused the
-- channel, and its videos waited a whole day more. With these times the job
-- knows when the channel can upload again, and waits for that when it is a
-- few minutes away. Only the service role reads it; no title, no person.

create or replace function public.ops_youtube_uploads_day() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('channelId', c.channel_id, 'at', v.published_at) order by v.published_at), '[]'::jsonb)
  from ops.tutorial_videos v
  join ops.youtube_channels c on c.language = v.language
  where v.published_at > now() - interval '24 hours'
$$;
revoke all on function public.ops_youtube_uploads_day from public, anon, authenticated;
grant execute on function public.ops_youtube_uploads_day to service_role;
