-- The order the publish job puts the chosen tutorial videos up in
-- (server/tutorialPublisher.ts, decisions.md 180): English, then French, the
-- languages that come first, then each other language's next video in turn,
-- in the plan's order. It went language by language from a to z, so Arabic
-- went first and English waited. YouTube limits how many videos a channel
-- puts up a day, so in turn every language gets its first videos up soonest.
create or replace function public.ops_tutorials_due(p_limit int default 100) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('tutorial', d.tutorial, 'language', d.language, 'sha256', d.sha256, 'title', d.title,
      'description', d.description, 'playlist', d.playlist, 'bytes', d.bytes, 'channelId', d.channel_id, 'replaces', d.replaces)
    order by d.priority, d.position, d.language, d.made_at), '[]'::jsonb)
  from (
    select v.*, c.channel_id,
      case v.language when 'en' then 0 when 'fr' then 1 else 2 end as priority,
      (select p.youtube_id from ops.tutorial_videos p
       where p.tutorial = v.tutorial and p.language = v.language and p.youtube_id is not null
       order by p.published_at desc limit 1) as replaces
    from ops.tutorial_videos v
    join ops.youtube_channels c on c.language = v.language
    where v.chosen_at is not null and v.youtube_id is null
      and not exists (select 1 from ops.tutorial_videos n where n.tutorial = v.tutorial and n.language = v.language
                      and n.chosen_at is not null and n.made_at > v.made_at)
    order by priority, v.position, v.language, v.made_at
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) d
$$;
