-- What is up on YouTube, for the publish job to put each channel's playlists
-- in order (server/tutorialPublisher.ts `tidyChannel`, docs/tutorial-videos.md,
-- decisions.md 180 amended): for each video on a connected channel, its
-- newest version up, with its playlist and its place in the plan's order, and
-- the YouTube videos its older versions became. An upload whose later steps
-- did not work (its playlist place, its old version unlisted) is put right
-- from this on the next run. The newest is the one `ops_tutorials_due` says
-- a new version replaces. Only the service role reads it; no token, no
-- person.

create or replace function public.ops_tutorials_up() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('tutorial', n.tutorial, 'language', n.language, 'channelId', c.channel_id,
      'playlist', n.playlist, 'position', n.position, 'youtubeId', n.youtube_id,
      'older', coalesce((select jsonb_agg(o.youtube_id order by o.published_at) from ops.tutorial_videos o
                         where o.tutorial = n.tutorial and o.language = n.language and o.youtube_id is not null
                           and o.youtube_id <> n.youtube_id), '[]'::jsonb))
    order by n.language, n.position, n.tutorial), '[]'::jsonb)
  from (
    select distinct on (v.tutorial, v.language) v.tutorial, v.language, v.playlist, v.position, v.youtube_id
    from ops.tutorial_videos v
    where v.youtube_id is not null
    order by v.tutorial, v.language, v.published_at desc
  ) n
  join ops.youtube_channels c on c.language = n.language
$$;
revoke all on function public.ops_tutorials_up from public, anon, authenticated;
grant execute on function public.ops_tutorials_up to service_role;
