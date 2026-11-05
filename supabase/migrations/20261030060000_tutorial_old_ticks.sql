-- A tick from before the films were wide no longer puts a video up
-- (docs/tutorial-videos.md, decisions.md 191, 192 amended). Every film made
-- before decision 191 is tall, and YouTube makes a tall film under three
-- minutes a Short, whose links cannot be clicked. Those films were chosen
-- with Publish on 2026-10-29, before the intake chose the wide ones itself
-- (192), and a video whose wide film did not come out that night still had
-- its tall one chosen, so the publish would have put it up as a Short. Now a
-- choice made before PR 284 went live counts as no choice: the job does not
-- put it up, the dashboard lists it as not chosen, and a person's Publish can
-- choose it again. No row changes; who chose what stays as it was.

create or replace function ops.tutorial_ticks_from() returns timestamptz
language sql immutable set search_path = '' as $$ select timestamptz '2026-10-30 04:33:00+00' $$;
revoke all on function ops.tutorial_ticks_from from public;

-- What the job puts up next: as before (migration *_tutorial_newest_due.sql), but only a choice made since.
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
    where v.chosen_at >= ops.tutorial_ticks_from() and v.youtube_id is null
      and not exists (select 1 from ops.tutorial_videos n where n.tutorial = v.tutorial and n.language = v.language
                      and n.made_at > v.made_at)
    order by priority, v.position, v.language, v.made_at
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) d
$$;

-- Publish: as before, and a version an old tick chose can be chosen again.
create or replace function public.ops_tutorials_approve(p_items jsonb, p_by uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 2000 then raise exception 'items: an array of up to 2000' using errcode = '22023'; end if;
  update ops.tutorial_videos v set chosen_at = now(), chosen_by = p_by
  from jsonb_array_elements(p_items) i
  where v.tutorial = i->>0 and v.language = i->>1 and v.sha256 = i->>2
    and (v.chosen_at is null or v.chosen_at < ops.tutorial_ticks_from()) and v.youtube_id is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- The dashboard's summary: as before (migration *_youtube_channel_look.sql), with an old tick shown as no choice.
create or replace function diag.ops_tutorials() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'channels', coalesce((select jsonb_agg(jsonb_build_object('channelId', c.channel_id, 'language', c.language, 'title', c.title,
        'connectedAt', c.connected_at, 'section', c.section,
        'branded', c.branded is not null, 'brandFailed', c.brand_failed, 'held', c.held, 'heldAt', c.held_at) order by c.language) from ops.youtube_channels c), '[]'::jsonb),
    'waiting', coalesce((select jsonb_agg(jsonb_build_object('tutorial', w.tutorial, 'language', w.language, 'sha256', w.sha256,
        'title', w.title, 'playlist', w.playlist, 'seconds', w.seconds, 'madeAt', w.made_at,
        'chosenAt', case when w.chosen_at >= ops.tutorial_ticks_from() then w.chosen_at end,
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
