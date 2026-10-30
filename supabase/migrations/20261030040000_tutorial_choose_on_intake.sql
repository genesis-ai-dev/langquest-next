-- Tutorial videos go up as soon as they are filmed (docs/tutorial-videos.md,
-- decisions.md 192). The filming tells the app's Worker when its films are in
-- the release (apps/web/worker/tutorialFilmed.ts); the intake then lists each
-- new film and chooses it for YouTube itself, so nobody has to press Publish,
-- and the publish job follows the intake at once. The intake's own time
-- moves to five past midnight in California, when YouTube's day of uploads
-- begins, with the publish after it. Only a film made wide
-- (decisions.md 191) is chosen this way: a tall film left from before, whose
-- refilm failed, would go up as a Short, so it waits for a person.
--
-- A version a person chose keeps who chose it; one the intake chose has a
-- time and nobody.

alter table ops.tutorial_videos drop constraint if exists tutorial_videos_check;
alter table ops.tutorial_videos add constraint tutorial_videos_chosen_check check (chosen_by is null or chosen_at is not null);

drop function if exists public.ops_tutorial_made(text, text, text, text, text, text, int, int, bigint);

-- A video the filming made, put in R2: true when it is new. The same file
-- again changes nothing, except that p_choose chooses it for YouTube if it is
-- not chosen or up yet (an intake before this one may have listed it).
create or replace function public.ops_tutorial_made(p_tutorial text, p_language text, p_sha256 text, p_title text, p_description text,
  p_playlist text, p_position int, p_seconds int, p_bytes bigint, p_choose boolean default false)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_new boolean;
begin
  insert into ops.tutorial_videos (tutorial, language, sha256, title, description, playlist, position, seconds, bytes)
  values (p_tutorial, p_language, p_sha256, p_title, p_description, p_playlist, p_position, p_seconds, p_bytes)
  on conflict (tutorial, language, sha256) do nothing;
  v_new := found;
  if p_choose then
    update ops.tutorial_videos set chosen_at = now()
    where tutorial = p_tutorial and language = p_language and sha256 = p_sha256 and chosen_at is null and youtube_id is null;
  end if;
  return v_new;
end $$;

revoke all on function public.ops_tutorial_made from public, anon, authenticated;
grant execute on function public.ops_tutorial_made to service_role;

update diag.job_schedule
  set runs_on = 'Cloudflare container behind the app Worker (when the nightly filming on GitHub has new films, and 00:05 Pacific)'
  where job = 'tutorial_intake';
update diag.job_schedule
  set runs_on = 'Cloudflare container behind the app Worker (after each intake, and on Publish on the ops dashboard)'
  where job = 'tutorial_publish';
