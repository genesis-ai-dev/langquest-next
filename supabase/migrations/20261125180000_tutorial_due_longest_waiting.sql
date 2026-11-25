-- The publish job puts up first the video that has waited longest since it
-- last went up (server/tutorialPublisher.ts, decision 180 amended
-- 2026-11-25). The order was English, then French, then the rest, each by
-- its place in the plan alone. A channel may put up only so many videos a
-- day (Spanish: 10), and the videos early in the plan are filmed again most
-- days, so their new versions took every place each day. By 2026-11-25 the
-- Spanish videos at places 0 to 33 had gone up again one to four times in
-- six days, and the 15 at places 35 to 46 had waited since 16 to 20
-- November, never tried. Now, inside each of those three groups, a video
-- never up comes first, then the one whose version up is oldest (by its
-- day), and only then the plan's order. A first set still goes up in the
-- plan's order, as every one of its videos has none up.

create or replace function public.ops_tutorials_due(p_limit int default 100) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('tutorial', d.tutorial, 'language', d.language, 'sha256', d.sha256, 'title', d.title,
      'description', d.description, 'playlist', d.playlist, 'bytes', d.bytes, 'channelId', d.channel_id, 'replaces', d.replaces)
    order by d.priority, d.up_day nulls first, d.position, d.language, d.made_at), '[]'::jsonb)
  from (
    select v.*, c.channel_id,
      case v.language when 'en' then 0 when 'fr' then 1 else 2 end as priority,
      u.youtube_id as replaces,
      date_trunc('day', u.published_at, 'UTC') as up_day
    from ops.tutorial_videos v
    join ops.youtube_channels c on c.language = v.language
    left join lateral (
      select p.youtube_id, p.published_at from ops.tutorial_videos p
      where p.tutorial = v.tutorial and p.language = v.language and p.youtube_id is not null
      order by p.published_at desc limit 1
    ) u on true
    where v.chosen_at >= ops.tutorial_ticks_from() and v.youtube_id is null
      and not exists (select 1 from ops.tutorial_videos n where n.tutorial = v.tutorial and n.language = v.language
                      and n.made_at > v.made_at)
    order by priority, up_day nulls first, v.position, v.language, v.made_at
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) d
$$;
