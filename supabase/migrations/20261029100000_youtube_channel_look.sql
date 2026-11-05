-- How each tutorial channel looks (docs/tutorial-videos.md, server/youtube.ts
-- brandChannel): its description, its language, its banner and its list of
-- the other channels, put on by the publish job before any video whenever
-- they differ from what the channel has. `branded` is the hash of the look
-- last put on (youtube.ts brandOf), so a channel is changed again only when
-- its words or banner are; `brand_failed` is the last try's code until one works.
-- The same job counts the comments each channel holds for review (`held`),
-- so the dashboard says when a person should look at them in YouTube Studio.
alter table ops.youtube_channels add column if not exists branded text check (branded is null or branded ~ '^[0-9a-f]{64}$');
alter table ops.youtube_channels add column if not exists brand_failed text check (brand_failed is null or brand_failed ~ '^[A-Za-z0-9_.:-]{1,80}$');
alter table ops.youtube_channels add column if not exists held int check (held is null or held between 0 and 100000);
alter table ops.youtube_channels add column if not exists held_at timestamptz;

-- The publish job's list of the connected channels, with the look each has.
create or replace function public.ops_youtube_channels() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('channelId', channel_id, 'language', language, 'branded', branded) order by language), '[]'::jsonb)
  from ops.youtube_channels
$$;

-- What became of a channel's look: put on (p_branded), or not, with p_failed's code.
create or replace function public.ops_youtube_branded(p_channel text, p_branded text, p_failed text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_branded is not null then
    update ops.youtube_channels set branded = p_branded, brand_failed = null where channel_id = p_channel;
  else
    update ops.youtube_channels set brand_failed = coalesce(p_failed, 'unknown') where channel_id = p_channel;
  end if;
end $$;

-- How many comments the channel holds for review, counted just now.
create or replace function public.ops_youtube_held(p_channel text, p_count int) returns void
language sql security definer set search_path = '' as $$
  update ops.youtube_channels set held = p_count, held_at = now() where channel_id = p_channel
$$;

revoke all on function public.ops_youtube_channels, public.ops_youtube_branded, public.ops_youtube_held from public, anon, authenticated;
grant execute on function public.ops_youtube_channels, public.ops_youtube_branded, public.ops_youtube_held to service_role;

-- The dashboard's summary, as before, with whether each channel has its look (or the last failure's code) and its held comments.
create or replace function diag.ops_tutorials() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'channels', coalesce((select jsonb_agg(jsonb_build_object('channelId', c.channel_id, 'language', c.language, 'title', c.title,
        'connectedAt', c.connected_at, 'section', c.section,
        'branded', c.branded is not null, 'brandFailed', c.brand_failed, 'held', c.held, 'heldAt', c.held_at) order by c.language) from ops.youtube_channels c), '[]'::jsonb),
    'waiting', coalesce((select jsonb_agg(jsonb_build_object('tutorial', w.tutorial, 'language', w.language, 'sha256', w.sha256,
        'title', w.title, 'playlist', w.playlist, 'seconds', w.seconds, 'madeAt', w.made_at, 'chosenAt', w.chosen_at,
        'failed', w.failed, 'failedAt', w.failed_at, 'replaces', w.replaces) order by w.language, w.position)
      from (
        select distinct on (v.tutorial, v.language) v.*,
          (select p.youtube_id from ops.tutorial_videos p where p.tutorial = v.tutorial and p.language = v.language
           and p.youtube_id is not null order by p.published_at desc limit 1) as replaces
        from ops.tutorial_videos v
        order by v.tutorial, v.language, v.made_at desc
      ) w where w.youtube_id is null), '[]'::jsonb),
    'published', coalesce((select jsonb_agg(jsonb_build_object('language', p.language, 'videos', p.videos, 'latestAt', p.latest)
        order by p.language)
      from (select language, count(distinct tutorial) as videos, max(published_at) as latest
            from ops.tutorial_videos where youtube_id is not null group by language) p), '[]'::jsonb)
  )
$$;
revoke all on function diag.ops_tutorials from public;
grant execute on function diag.ops_tutorials to diag_reader;
