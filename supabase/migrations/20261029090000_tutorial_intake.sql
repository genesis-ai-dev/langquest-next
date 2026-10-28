-- The tutorial intake (docs/tutorial-videos.md, server/tutorialIntake.ts): the
-- films the nightly filming made on GitHub, which holds no production key
-- (decisions.md 141), brought into R2 by the job container each day at 13:10
-- UTC and listed for Publish with ops_tutorial_made. Its runs are recorded
-- as any job's are; a day without one shows on the ops dashboard.
insert into diag.job_schedule (job, every, slack, runs_on) values
  ('tutorial_intake', interval '1 day', interval '2 hours', 'Cloudflare container behind the app Worker (13:10 UTC, after the nightly filming on GitHub)')
on conflict (job) do update set every = excluded.every, slack = excluded.slack, runs_on = excluded.runs_on;

-- Where a video's link to itself in another language goes
-- (e2e/tutorials/playlists.ts watchLink, apps/web/worker/tutorialVideos.ts
-- handleWatch): the YouTube video its newest published version became, or
-- null while none is up. Only the app's Worker asks, with the service role.
create or replace function public.ops_tutorial_watch(p_tutorial text, p_language text) returns text
language sql stable security definer set search_path = '' as $$
  select youtube_id from ops.tutorial_videos
  where tutorial = p_tutorial and language = p_language and youtube_id is not null
  order by published_at desc limit 1
$$;
revoke all on function public.ops_tutorial_watch from public, anon, authenticated;
grant execute on function public.ops_tutorial_watch to service_role;
