-- Each YouTube channel's trailer (decisions.md 188, e2e/tutorials/trailer):
-- the publish job's list of the connected channels also says which YouTube
-- video the language's newest trailer became, so a channel's look includes
-- it and a trailer that could not be set as the channel's is set on the next
-- run (server/tutorialPublisher.ts).
create or replace function public.ops_youtube_channels() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('channelId', c.channel_id, 'language', c.language, 'branded', c.branded,
      'trailer', (select v.youtube_id from ops.tutorial_videos v
                  where v.tutorial = 'trailer' and v.language = c.language and v.youtube_id is not null
                  order by v.published_at desc limit 1)) order by c.language), '[]'::jsonb)
  from ops.youtube_channels c
$$;

revoke all on function public.ops_youtube_channels from public, anon, authenticated;
grant execute on function public.ops_youtube_channels to service_role;
