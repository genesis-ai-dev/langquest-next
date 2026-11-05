-- Tutorial videos on YouTube (docs/tutorial-videos.md, decisions.md 180): the
-- ops dashboard's Tutorial videos section. Each app language has a YouTube
-- channel, connected once by a Global Viewer (Connect YouTube); each video
-- the filming made is a file in R2 named by its SHA-256 (tutorials/<language>/
-- <tutorial>/<sha256>.mp4); a Global Viewer's Publish marks the ones to put
-- up, and the publish job (server/tutorialPublish.ts) puts them up and says
-- which YouTube video each became.
--
-- A channel's refresh token is kept in Vault, never in a table, and only the
-- service role reads it back: the app's Worker writes it on Connect, the job
-- reads it to publish. The dashboard reads everything else as diag_reader
-- through diag.ops_tutorials(): ids, titles, times and codes, no token.

-- ---- channels -------------------------------------------------------------------------------------

create table if not exists ops.youtube_channels (
  channel_id text primary key check (channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  language text not null unique check (language ~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?$'),
  -- The channel's name on YouTube, as Google gave it on Connect.
  title text not null check (length(title) between 1 and 100),
  connected_at timestamptz not null default now(),
  connected_by uuid not null,
  -- How the channel's "Other LangQuest channels" section went on Connect: made, updated, or a failure's code.
  section text check (section is null or section ~ '^[A-Za-z0-9_.:-]{1,80}$')
);
alter table ops.youtube_channels enable row level security;

-- ---- videos ---------------------------------------------------------------------------------------

create table if not exists ops.tutorial_videos (
  tutorial text not null check (tutorial ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(tutorial) <= 80),
  language text not null check (language ~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?$'),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- YouTube's limits: a title of 100 characters, a description of 5,000 bytes, and neither may hold < or >.
  title text not null check (length(title) between 1 and 100 and title !~ '[<>]'),
  description text not null check (octet_length(description) <= 5000 and description !~ '[<>]'),
  -- The playlist it goes in, by its title in the video's language (who it is for: Translators, Reviewers...).
  playlist text not null check (length(playlist) between 1 and 150 and playlist !~ '[<>]'),
  -- Its place among the language's videos, the plan's order: the first full set goes up in it.
  position int not null check (position between 0 and 10000),
  seconds int not null check (seconds between 1 and 3600),
  bytes bigint not null check (bytes between 1 and 2147483647),
  made_at timestamptz not null default now(),
  chosen_at timestamptz,
  chosen_by uuid,
  youtube_id text check (youtube_id is null or youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  published_at timestamptz,
  -- The last try that did not work, as a code (youtube_quotaExceeded); cleared once it is up.
  failed text check (failed is null or failed ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  failed_at timestamptz,
  primary key (tutorial, language, sha256),
  check ((chosen_at is null) = (chosen_by is null)),
  check ((youtube_id is null) = (published_at is null))
);
create index if not exists tutorial_videos_by_video_idx on ops.tutorial_videos (tutorial, language, made_at desc);
alter table ops.tutorial_videos enable row level security;

-- ---- what the service role does ------------------------------------------------------------------

-- Connect: the channel, and its refresh token into Vault (one secret per channel, replaced on a second Connect).
create or replace function public.ops_youtube_connected(p_channel text, p_language text, p_title text, p_refresh text, p_by uuid, p_section text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_name text := 'youtube_refresh_' || p_channel;
  v_id uuid;
begin
  if p_channel !~ '^UC[A-Za-z0-9_-]{22}$' then raise exception 'not a channel id' using errcode = '22023'; end if;
  if coalesce(length(p_refresh), 0) not between 10 and 2000 then raise exception 'not a refresh token' using errcode = '22023'; end if;
  insert into ops.youtube_channels (channel_id, language, title, connected_at, connected_by, section)
  values (p_channel, p_language, left(p_title, 100), now(), p_by, p_section)
  on conflict (channel_id) do update set language = excluded.language, title = excluded.title, connected_at = excluded.connected_at,
    connected_by = excluded.connected_by, section = excluded.section;
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then
    perform vault.create_secret(p_refresh, v_name, 'YouTube refresh token for a LangQuest tutorial channel (ops.youtube_channels)');
  else
    perform vault.update_secret(v_id, p_refresh);
  end if;
end $$;

-- The publish job's way to a channel's refresh token.
create or replace function public.ops_youtube_refresh(p_channel text) returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'youtube_refresh_' || p_channel
$$;

-- A video the filming made, put in R2: true when it is new. The same file again changes nothing.
create or replace function public.ops_tutorial_made(p_tutorial text, p_language text, p_sha256 text, p_title text, p_description text,
  p_playlist text, p_position int, p_seconds int, p_bytes bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  insert into ops.tutorial_videos (tutorial, language, sha256, title, description, playlist, position, seconds, bytes)
  values (p_tutorial, p_language, p_sha256, p_title, p_description, p_playlist, p_position, p_seconds, p_bytes)
  on conflict (tutorial, language, sha256) do nothing;
  return found;
end $$;

-- Publish: the versions a Global Viewer chose, each [tutorial, language, sha256], marked to go up. Answers how many were newly marked.
create or replace function public.ops_tutorials_approve(p_items jsonb, p_by uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 2000 then raise exception 'items: an array of up to 2000' using errcode = '22023'; end if;
  update ops.tutorial_videos v set chosen_at = now(), chosen_by = p_by
  from jsonb_array_elements(p_items) i
  where v.tutorial = i->>0 and v.language = i->>1 and v.sha256 = i->>2 and v.chosen_at is null and v.youtube_id is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- What the job puts up next, in the plan's order: each approved version not
-- up yet, unless a newer version of the same video is approved too, with the
-- YouTube video it replaces and its channel. Only connected channels.
create or replace function public.ops_tutorials_due(p_limit int default 100) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('tutorial', d.tutorial, 'language', d.language, 'sha256', d.sha256, 'title', d.title,
      'description', d.description, 'playlist', d.playlist, 'bytes', d.bytes, 'channelId', d.channel_id, 'replaces', d.replaces)
    order by d.language, d.position, d.made_at), '[]'::jsonb)
  from (
    select v.*, c.channel_id,
      (select p.youtube_id from ops.tutorial_videos p
       where p.tutorial = v.tutorial and p.language = v.language and p.youtube_id is not null
       order by p.published_at desc limit 1) as replaces
    from ops.tutorial_videos v
    join ops.youtube_channels c on c.language = v.language
    where v.chosen_at is not null and v.youtube_id is null
      and not exists (select 1 from ops.tutorial_videos n where n.tutorial = v.tutorial and n.language = v.language
                      and n.chosen_at is not null and n.made_at > v.made_at)
    order by v.language, v.position, v.made_at
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) d
$$;

-- What became of one: up on YouTube as p_youtube_id, or not, with p_failed's code.
create or replace function public.ops_tutorial_published(p_tutorial text, p_language text, p_sha256 text, p_youtube_id text, p_failed text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_youtube_id is not null then
    update ops.tutorial_videos set youtube_id = p_youtube_id, published_at = now(), failed = null, failed_at = null
    where tutorial = p_tutorial and language = p_language and sha256 = p_sha256;
  else
    update ops.tutorial_videos set failed = coalesce(p_failed, 'unknown'), failed_at = now()
    where tutorial = p_tutorial and language = p_language and sha256 = p_sha256;
  end if;
end $$;

revoke all on function public.ops_youtube_connected, public.ops_youtube_refresh, public.ops_tutorial_made, public.ops_tutorials_approve,
  public.ops_tutorials_due, public.ops_tutorial_published from public, anon, authenticated;
grant execute on function public.ops_youtube_connected, public.ops_youtube_refresh, public.ops_tutorial_made, public.ops_tutorials_approve,
  public.ops_tutorials_due, public.ops_tutorial_published to service_role;

-- ---- what the dashboard reads (diag_reader) ------------------------------------------------------

-- Every channel and whether it is connected; each video's newest version
-- that is not up yet (ready, or approved and waiting for the job), and the
-- count up in each language.
create or replace function diag.ops_tutorials() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'channels', coalesce((select jsonb_agg(jsonb_build_object('channelId', c.channel_id, 'language', c.language, 'title', c.title,
        'connectedAt', c.connected_at, 'section', c.section) order by c.language) from ops.youtube_channels c), '[]'::jsonb),
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

-- ---- the actions log and the job ------------------------------------------------------------------

alter table ops.actions drop constraint if exists actions_action_check;
alter table ops.actions add constraint actions_action_check
  check (action in ('feedback_new', 'feedback_seen', 'feedback_done', 'run_job', 'verification_grant', 'verification_decline',
    'youtube_start', 'youtube_connect', 'tutorials_publish'));

-- The publish job: started by Publish, and each day after YouTube's allowance
-- comes back (midnight Pacific) while approved videos wait.
insert into diag.job_schedule (job, every, slack, runs_on) values
  ('tutorial_publish', null, interval '0', 'Cloudflare container behind the app Worker (Publish on the ops dashboard, and 08:10 UTC)')
on conflict (job) do update set every = excluded.every, slack = excluded.slack, runs_on = excluded.runs_on;
