-- Tutorial videos to download from LangQuest (docs/tutorial-videos.md
-- "Downloads", decisions.md 187): each video's lasting download link
-- (next.langquest.org/v/<language>/<tutorial>.mp4, given in its description
-- on YouTube) and the page of a language's videos (next.langquest.org/videos).
-- Both give the newest version a person chose to publish, so a download is
-- what YouTube shows or is about to, without waiting for YouTube's uploads a
-- day. Only the app's Worker asks, with the service role.

-- The newest chosen version of one video, by its file's hash, or null while none is chosen.
create or replace function public.ops_tutorial_download(p_tutorial text, p_language text) returns text
language sql stable security definer set search_path = '' as $$
  select sha256 from ops.tutorial_videos
  where tutorial = p_tutorial and language = p_language and chosen_at is not null
  order by made_at desc limit 1
$$;
revoke all on function public.ops_tutorial_download from public, anon, authenticated;
grant execute on function public.ops_tutorial_download to service_role;

-- A language's videos for the page, in the plan's order: each one's newest
-- chosen version (its hash, title, playlist, length and size) and whether a
-- version of it is up on YouTube.
create or replace function public.ops_tutorial_list(p_language text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('tutorial', v.tutorial, 'sha256', v.sha256, 'title', v.title, 'playlist', v.playlist,
      'seconds', v.seconds, 'bytes', v.bytes, 'youtube', v.youtube) order by v.position, v.tutorial), '[]'::jsonb)
  from (
    select distinct on (t.tutorial) t.tutorial, t.sha256, t.title, t.playlist, t.position, t.seconds, t.bytes,
      exists (select 1 from ops.tutorial_videos y where y.tutorial = t.tutorial and y.language = t.language and y.youtube_id is not null) as youtube
    from ops.tutorial_videos t
    where t.language = p_language and t.chosen_at is not null
    order by t.tutorial, t.made_at desc
  ) v
$$;
revoke all on function public.ops_tutorial_list from public, anon, authenticated;
grant execute on function public.ops_tutorial_list to service_role;
