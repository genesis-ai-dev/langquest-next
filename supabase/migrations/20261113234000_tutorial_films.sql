-- Every film of every tutorial video, for the ops dashboard's video list and
-- timeline (docs/tutorial-videos.md "On the ops dashboard", decisions.md 186
-- amended 2026-11-13): when each was made, chosen and put up on YouTube, and
-- why its last try to go up failed. ops.tutorial_videos keeps one row for
-- each film ever made (its primary key holds the film's SHA-256), so the
-- history is already here; this only lets diag_reader read it. The films of
-- the last 60 days, and each video's newest film and newest film on YouTube
-- whatever their age, so a video filmed long ago still has a row.

create or replace function diag.ops_tutorial_films() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('tutorial', f.tutorial, 'language', f.language, 'sha256', f.sha256,
      'madeAt', f.made_at, 'chosenAt', f.chosen_at, 'publishedAt', f.published_at, 'youtubeId', f.youtube_id,
      'failed', f.failed, 'failedAt', f.failed_at) order by f.language, f.position, f.made_at), '[]'::jsonb)
  from ops.tutorial_videos f
  where f.made_at > now() - interval '60 days'
     or f.made_at = (select max(n.made_at) from ops.tutorial_videos n where n.tutorial = f.tutorial and n.language = f.language)
     or f.published_at = (select max(p.published_at) from ops.tutorial_videos p where p.tutorial = f.tutorial and p.language = f.language)
$$;
revoke all on function diag.ops_tutorial_films from public;
grant execute on function diag.ops_tutorial_films to diag_reader;
