-- What comes in about the tutorial videos, and what Claude suggests doing
-- about it (docs/tutorial-videos.md "Feedback", decisions.md 185). Three
-- kinds of input, each about one video or none:
--   comment  what people wrote under a video on YouTube, read each day by
--            the comments job (server/tutorialComments.ts), as written;
--   code     a change merged into main that changes what a video shows or
--            says, found by Claude's nightly look (tutorial-review.yml);
--   note     what someone at LangQuest wrote on the ops dashboard.
-- Each night Claude looks at the inputs it has not seen, puts each comment
-- into English with a reply the channel could post, and suggests changes:
-- to a video's script, its screens, its voice, the app's code (a Linear
-- issue), or a new video. A Global Viewer accepts, edits or rejects each
-- suggestion on the dashboard (162); an accepted code change goes to
-- Linear. Replying to and moderating comments stay in YouTube Studio (184).
--
-- A comment is kept as YouTube shows it, never with who wrote it, for a
-- year. Only the service role writes or reads these tables; the dashboard
-- reads them as diag_reader through diag.ops_tutorial_feedback().

create table if not exists ops.tutorial_inputs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('comment', 'code', 'note')),
  -- The video it is about: a comment's video when it is one of ours, a code change's, a note's if it names one.
  tutorial text check (tutorial is null or (tutorial ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(tutorial) <= 80)),
  -- A comment's channel's language.
  language text check (language is null or language ~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?$'),
  -- When it happened: a comment posted, a change merged into main, a note written.
  at timestamptz not null,
  -- A comment's thread id on YouTube (its first comment's); a code change's commit on main.
  ref text check (ref is null or ref ~ '^[A-Za-z0-9_.-]{7,100}$'),
  -- A comment's channel and video on YouTube.
  channel_id text check (channel_id is null or channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  youtube_id text check (youtube_id is null or youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  -- A code change's pull request.
  pr int check (pr is null or pr between 1 and 10000000),
  -- A comment as written, a pull request's title, a note.
  text text not null check (length(text) between 1 and 10000),
  -- A comment in English, or what a code change changes in the video: Claude's words.
  english text check (english is null or length(english) between 1 and 5000),
  -- A reply the channel could post, in the comment's language and in English: Claude's words.
  reply text check (reply is null or length(reply) <= 2000),
  reply_english text check (reply_english is null or length(reply_english) <= 2000),
  -- A note's writer.
  by uuid,
  added_at timestamptz not null default now(),
  -- When Claude looked at it, and, when it suggested nothing for it, why.
  looked_at timestamptz,
  outcome text check (outcome is null or length(outcome) between 1 and 500),
  check (kind <> 'comment' or (ref is not null and channel_id is not null and language is not null)),
  check (kind <> 'code' or (ref is not null and tutorial is not null)),
  check (kind <> 'note' or by is not null)
);
create unique index if not exists tutorial_inputs_comment_idx on ops.tutorial_inputs (ref) where kind = 'comment';
create unique index if not exists tutorial_inputs_code_idx on ops.tutorial_inputs (ref, tutorial) where kind = 'code';
create index if not exists tutorial_inputs_unlooked_idx on ops.tutorial_inputs (at) where looked_at is null;
create index if not exists tutorial_inputs_by_time_idx on ops.tutorial_inputs (at desc);
alter table ops.tutorial_inputs enable row level security;

-- Claude's nightly looks: up to which commit on main it read the changes, and what it did.
create table if not exists ops.tutorial_reviews (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  sha text not null check (sha ~ '^[0-9a-f]{40}$'),
  run_url text not null check (run_url ~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$'),
  looked int not null default 0 check (looked between 0 and 100000),
  suggested int not null default 0 check (suggested between 0 and 100000),
  code int not null default 0 check (code between 0 and 100000)
);
create index if not exists tutorial_reviews_at_idx on ops.tutorial_reviews (at desc);
alter table ops.tutorial_reviews enable row level security;

create table if not exists ops.tutorial_suggestions (
  id uuid primary key default gen_random_uuid(),
  -- script: what is said; screen: what is shown or tapped; voice: how it is said; code: the app itself; new: a video not made yet.
  kind text not null check (kind in ('script', 'screen', 'voice', 'code', 'new')),
  tutorial text check (tutorial is null or (tutorial ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(tutorial) <= 80)),
  title text not null check (length(title) between 1 and 200),
  detail text not null check (length(detail) between 1 and 4000),
  review bigint references ops.tutorial_reviews (id) on delete set null,
  made_at timestamptz not null default now(),
  -- A person's change to the detail before deciding.
  edited_at timestamptz,
  edited_by uuid,
  decision text check (decision is null or decision in ('accepted', 'rejected')),
  decided_at timestamptz,
  decided_by uuid,
  -- Why it was rejected, or a word on accepting it.
  reason text check (reason is null or length(reason) between 1 and 500),
  -- The Linear issue an accepted code change became.
  issue text check (issue is null or issue ~ '^[A-Z]{1,10}-[0-9]{1,7}$'),
  issue_url text check (issue_url is null or issue_url ~ '^https://linear\.app/'),
  check (kind <> 'new' or tutorial is null),
  check ((edited_at is null) = (edited_by is null)),
  check ((decision is null) = (decided_at is null) and (decided_at is null) = (decided_by is null)),
  check ((issue is null) = (issue_url is null)),
  check (issue is null or (kind = 'code' and decision = 'accepted'))
);
create index if not exists tutorial_suggestions_open_idx on ops.tutorial_suggestions (made_at) where decision is null;
create index if not exists tutorial_suggestions_by_time_idx on ops.tutorial_suggestions (made_at desc);
alter table ops.tutorial_suggestions enable row level security;

-- Which inputs each suggestion answers.
create table if not exists ops.tutorial_suggestion_inputs (
  suggestion uuid not null references ops.tutorial_suggestions (id) on delete cascade,
  input uuid not null references ops.tutorial_inputs (id) on delete cascade,
  primary key (suggestion, input)
);
create index if not exists tutorial_suggestion_inputs_input_idx on ops.tutorial_suggestion_inputs (input);
alter table ops.tutorial_suggestion_inputs enable row level security;

-- An input is open while Claude has not looked at it, or a suggestion that answers it waits for a person.
create or replace function ops.tutorial_input_open(p_input uuid, p_looked timestamptz) returns boolean
language sql stable set search_path = '' as $$
  select p_looked is null or exists (
    select 1 from ops.tutorial_suggestion_inputs l join ops.tutorial_suggestions s on s.id = l.suggestion
    where l.input = p_input and s.decision is null)
$$;
revoke all on function ops.tutorial_input_open from public;

-- An input as Claude and the dashboard see it.
create or replace function ops.tutorial_input_json(i ops.tutorial_inputs) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', i.id, 'kind', i.kind, 'tutorial', i.tutorial, 'language', i.language, 'at', i.at,
    'ref', i.ref, 'youtubeId', i.youtube_id, 'pr', i.pr, 'text', i.text, 'english', i.english,
    'reply', i.reply, 'replyEnglish', i.reply_english, 'lookedAt', i.looked_at, 'outcome', i.outcome)
$$;
revoke all on function ops.tutorial_input_json from public;

-- A suggestion with the inputs it answers.
create or replace function ops.tutorial_suggestion_json(s ops.tutorial_suggestions) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'kind', s.kind, 'tutorial', s.tutorial, 'title', s.title, 'detail', s.detail,
    'madeAt', s.made_at, 'editedAt', s.edited_at, 'decision', s.decision, 'decidedAt', s.decided_at, 'reason', s.reason,
    'issue', s.issue, 'issueUrl', s.issue_url,
    'inputs', coalesce((select jsonb_agg(ops.tutorial_input_json(i) order by i.at)
      from ops.tutorial_suggestion_inputs l join ops.tutorial_inputs i on i.id = l.input where l.suggestion = s.id), '[]'::jsonb))
$$;
revoke all on function ops.tutorial_suggestion_json from public;

-- ---- the comments job, as the service role ----------------------------------------------------------

-- Which of these comments were read before.
create or replace function public.ops_comments_known(p_ids text[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(ref), '[]'::jsonb) from ops.tutorial_inputs where kind = 'comment' and ref = any(p_ids)
$$;

-- New comments from a channel ({id, videoId, text, publishedAt} each), each kept with the
-- tutorial its video is a version of; how many were new. Takes out what is over a year old
-- and answered.
create or replace function public.ops_comments_read(p_language text, p_channel text, p_comments jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_new int;
begin
  delete from ops.tutorial_inputs i where i.at < now() - interval '1 year' and not ops.tutorial_input_open(i.id, i.looked_at);
  insert into ops.tutorial_inputs (kind, ref, channel_id, language, youtube_id, tutorial, text, at)
  select 'comment', c->>'id', p_channel, p_language, c->>'videoId',
    (select v.tutorial from ops.tutorial_videos v where v.youtube_id = c->>'videoId' limit 1),
    left(c->>'text', 10000), (c->>'publishedAt')::timestamptz
  from jsonb_array_elements(coalesce(p_comments, '[]'::jsonb)) c
  where c->>'id' ~ '^[A-Za-z0-9_.-]{8,100}$' and length(c->>'text') > 0
    and (c->>'videoId' is null or c->>'videoId' ~ '^[A-Za-z0-9_-]{11}$')
  on conflict (ref) where kind = 'comment' do nothing;
  get diagnostics v_new = row_count;
  return v_new;
end $$;

-- Accepted code changes not yet in Linear (or the one given), oldest first, with what they answer.
create or replace function public.ops_suggestions_to_file(p_limit int, p_id uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(ops.tutorial_suggestion_json(x.s) order by (x.s).decided_at), '[]'::jsonb)
  from (select s from ops.tutorial_suggestions s
        where s.kind = 'code' and s.decision = 'accepted' and s.issue is null and (p_id is null or s.id = p_id)
        order by s.decided_at limit least(greatest(p_limit, 0), 100)) x
$$;

-- The Linear issue an accepted code change became.
create or replace function public.ops_suggestion_filed(p_id uuid, p_issue text, p_url text) returns void
language sql security definer set search_path = '' as $$
  update ops.tutorial_suggestions set issue = p_issue, issue_url = p_url
  where id = p_id and kind = 'code' and decision = 'accepted' and issue is null
$$;

-- ---- the dashboard's actions, through the app Worker (162) ------------------------------------------

-- A note from someone at LangQuest, about one video or none.
create or replace function public.ops_tutorial_note(p_tutorial text, p_text text, p_by uuid) returns uuid
language sql security definer set search_path = '' as $$
  insert into ops.tutorial_inputs (kind, tutorial, text, by, at) values ('note', p_tutorial, p_text, p_by, now()) returning id
$$;

-- A person's answer to a suggestion: accepted or rejected (with the detail as they edited it,
-- and a reason), or only its detail edited. {result: accepted|rejected|edited|not_found|decided, kind}.
create or replace function public.ops_suggestion_decide(p_id uuid, p_decision text, p_detail text, p_reason text, p_by uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s ops.tutorial_suggestions;
  v_edit boolean;
begin
  if p_decision not in ('accepted', 'rejected', 'edited') then raise exception 'not a decision' using errcode = '22023'; end if;
  select * into s from ops.tutorial_suggestions where id = p_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if s.decision is not null then return jsonb_build_object('result', 'decided', 'kind', s.kind); end if;
  v_edit := p_detail is not null and p_detail <> s.detail;
  if p_decision = 'edited' and p_detail is null then raise exception 'no detail' using errcode = '22023'; end if;
  update ops.tutorial_suggestions set
    detail = coalesce(p_detail, detail),
    edited_at = case when v_edit then now() else edited_at end,
    edited_by = case when v_edit then p_by else edited_by end,
    decision = case when p_decision = 'edited' then null else p_decision end,
    decided_at = case when p_decision = 'edited' then null else now() end,
    decided_by = case when p_decision = 'edited' then null else p_by end,
    reason = case when p_decision = 'edited' then reason else nullif(p_reason, '') end
  where id = p_id;
  return jsonb_build_object('result', p_decision, 'kind', s.kind);
end $$;

-- ---- Claude's nightly look, through the app Worker's /api/tutorial-review ---------------------------

-- What Claude needs: the commit its last look read up to, every input still open, the
-- suggestions of the last 180 days with how people answered them, and the videos.
create or replace function public.ops_tutorial_review_state() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'last', (select jsonb_build_object('sha', r.sha, 'at', r.at) from ops.tutorial_reviews r order by r.at desc, r.id desc limit 1),
    'inputs', coalesce((select jsonb_agg(ops.tutorial_input_json(x.i) order by (x.i).at)
      from (select i from ops.tutorial_inputs i where ops.tutorial_input_open(i.id, i.looked_at) order by i.at limit 2000) x), '[]'::jsonb),
    'suggestions', coalesce((select jsonb_agg(ops.tutorial_suggestion_json(x.s) order by (x.s).made_at)
      from (select s from ops.tutorial_suggestions s where s.decision is null or s.made_at > now() - interval '180 days'
            order by s.made_at desc limit 1000) x), '[]'::jsonb),
    'videos', coalesce((select jsonb_agg(jsonb_build_object('tutorial', t.tutorial, 'title', t.title, 'filmedAt', t.made_at) order by t.tutorial)
      from (select distinct on (tutorial) tutorial, title, made_at from ops.tutorial_videos where language = 'en'
            order by tutorial, made_at desc) t), '[]'::jsonb)
  )
$$;

-- What Claude's look made (server/tutorialFeedback.ts `Review`, already checked):
-- the code changes it found, each comment in English with a reply, the inputs it looked at and
-- why it suggested nothing for some, new suggestions and more inputs for open ones. An input
-- is named by its id or, for a code change found in the same look, by its key. Unknown ids
-- are skipped and counted. Takes out looks, inputs and answered suggestions over a year old.
create or replace function public.ops_tutorial_reviewed(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_review bigint;
  v_keys jsonb := '{}'::jsonb;
  v_id uuid;
  v_sug uuid;
  v_ref text;
  v_skipped int := 0;
  v_code int := 0;
  v_suggested int := 0;
  v_looked int := 0;
  c jsonb;
  r jsonb;
begin
  delete from ops.tutorial_reviews where at < now() - interval '1 year';
  delete from ops.tutorial_suggestions where decided_at < now() - interval '1 year';
  insert into ops.tutorial_reviews (sha, run_url) values (p->>'sha', p->>'runUrl') returning id into v_review;

  for c in select * from jsonb_array_elements(coalesce(p->'code', '[]'::jsonb)) loop
    insert into ops.tutorial_inputs (kind, ref, tutorial, pr, text, english, at, looked_at)
    values ('code', c->>'sha', c->>'tutorial', (c->>'pr')::int, c->>'title', c->>'english', (c->>'at')::timestamptz, now())
    on conflict (ref, tutorial) where kind = 'code' do update set english = excluded.english
    returning id into v_id;
    v_keys := v_keys || jsonb_build_object(c->>'key', v_id);
    v_code := v_code + 1;
  end loop;

  for c in select * from jsonb_array_elements(coalesce(p->'comments', '[]'::jsonb)) loop
    update ops.tutorial_inputs set english = c->>'english', reply = nullif(c->>'reply', ''), reply_english = nullif(c->>'replyEnglish', '')
    where id = (c->>'id')::uuid and kind = 'comment';
    if not found then v_skipped := v_skipped + 1; end if;
  end loop;

  for c in select * from jsonb_array_elements(coalesce(p->'looked', '[]'::jsonb)) loop
    update ops.tutorial_inputs set looked_at = now(), outcome = nullif(c->>'outcome', '')
    where id = coalesce((v_keys->>(c->>'input'))::uuid, case when c->>'input' ~ '^[0-9a-f-]{36}$' then (c->>'input')::uuid end);
    if found then v_looked := v_looked + 1; else v_skipped := v_skipped + 1; end if;
  end loop;

  for c in select * from jsonb_array_elements(coalesce(p->'suggestions', '[]'::jsonb)) loop
    insert into ops.tutorial_suggestions (kind, tutorial, title, detail, review)
    values (c->>'kind', c->>'tutorial', c->>'title', c->>'detail', v_review) returning id into v_sug;
    v_suggested := v_suggested + 1;
    for v_ref in select jsonb_array_elements_text(coalesce(c->'inputs', '[]'::jsonb)) loop
      v_id := coalesce((v_keys->>v_ref)::uuid, case when v_ref ~ '^[0-9a-f-]{36}$' then v_ref::uuid end);
      if v_id is not null and exists (select 1 from ops.tutorial_inputs where id = v_id) then
        insert into ops.tutorial_suggestion_inputs (suggestion, input) values (v_sug, v_id) on conflict do nothing;
        update ops.tutorial_inputs set looked_at = coalesce(looked_at, now()) where id = v_id;
      else
        v_skipped := v_skipped + 1;
      end if;
    end loop;
  end loop;

  for c in select * from jsonb_array_elements(coalesce(p->'attach', '[]'::jsonb)) loop
    if not exists (select 1 from ops.tutorial_suggestions where id = (c->>'suggestion')::uuid and decision is null) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    for v_ref in select jsonb_array_elements_text(coalesce(c->'inputs', '[]'::jsonb)) loop
      v_id := coalesce((v_keys->>v_ref)::uuid, case when v_ref ~ '^[0-9a-f-]{36}$' then v_ref::uuid end);
      if v_id is not null and exists (select 1 from ops.tutorial_inputs where id = v_id) then
        insert into ops.tutorial_suggestion_inputs (suggestion, input) values ((c->>'suggestion')::uuid, v_id) on conflict do nothing;
        update ops.tutorial_inputs set looked_at = coalesce(looked_at, now()) where id = v_id;
      else
        v_skipped := v_skipped + 1;
      end if;
    end loop;
  end loop;

  update ops.tutorial_reviews set looked = v_looked, suggested = v_suggested, code = v_code where id = v_review;
  return jsonb_build_object('review', v_review, 'code', v_code, 'looked', v_looked, 'suggested', v_suggested, 'skipped', v_skipped);
end $$;

revoke all on function public.ops_comments_known, public.ops_comments_read, public.ops_suggestions_to_file, public.ops_suggestion_filed,
  public.ops_tutorial_note, public.ops_suggestion_decide, public.ops_tutorial_review_state, public.ops_tutorial_reviewed
  from public, anon, authenticated;
grant execute on function public.ops_comments_known, public.ops_comments_read, public.ops_suggestions_to_file, public.ops_suggestion_filed,
  public.ops_tutorial_note, public.ops_suggestion_decide, public.ops_tutorial_review_state, public.ops_tutorial_reviewed
  to service_role;

-- ---- what the dashboard reads -----------------------------------------------------------------------

-- Suggestions waiting for a person and those answered in the last 30 days (at most 300), inputs
-- Claude has not looked at yet and those it suggested nothing for in the last 30 days (at most
-- 300), its last look, and each video's English title (for a note).
create or replace function diag.ops_tutorial_feedback() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'suggestions', coalesce((select jsonb_agg(ops.tutorial_suggestion_json(x.s) order by (x.s).decision nulls first, (x.s).made_at desc)
      from (select s from ops.tutorial_suggestions s where s.decision is null or s.decided_at > now() - interval '30 days'
            order by s.decision nulls first, s.made_at desc limit 300) x), '[]'::jsonb),
    'inputs', coalesce((select jsonb_agg(ops.tutorial_input_json(x.i) order by (x.i).at desc)
      from (select i from ops.tutorial_inputs i
            where i.looked_at is null
               or (i.outcome is not null and i.looked_at > now() - interval '30 days'
                   and not exists (select 1 from ops.tutorial_suggestion_inputs l where l.input = i.id))
            order by i.at desc limit 300) x), '[]'::jsonb),
    'waiting', (select count(*) from ops.tutorial_inputs where looked_at is null),
    'open', (select count(*) from ops.tutorial_suggestions where decision is null),
    'unfiled', (select count(*) from ops.tutorial_suggestions where kind = 'code' and decision = 'accepted' and issue is null),
    'last', (select jsonb_build_object('at', r.at, 'sha', r.sha, 'runUrl', r.run_url, 'looked', r.looked, 'suggested', r.suggested, 'code', r.code)
      from ops.tutorial_reviews r order by r.at desc, r.id desc limit 1),
    'videos', coalesce((select jsonb_agg(jsonb_build_object('tutorial', t.tutorial, 'title', t.title) order by t.title)
      from (select distinct on (tutorial) tutorial, title from ops.tutorial_videos where language = 'en' order by tutorial, made_at desc) t), '[]'::jsonb)
  )
$$;
revoke all on function diag.ops_tutorial_feedback from public;
grant execute on function diag.ops_tutorial_feedback to diag_reader;

-- ---- the actions log and the runs -------------------------------------------------------------------

alter table ops.actions drop constraint if exists actions_action_check;
alter table ops.actions add constraint actions_action_check
  check (action in ('feedback_new', 'feedback_seen', 'feedback_done', 'run_job', 'verification_grant', 'verification_decline',
    'youtube_start', 'youtube_connect', 'tutorials_publish', 'tutorial_note', 'suggestion_accepted', 'suggestion_rejected', 'suggestion_edited'));

-- Their runs, as any job's: a day without one shows on the ops dashboard.
insert into diag.job_schedule (job, every, slack, runs_on) values
  ('tutorial_comments', interval '1 day', interval '2 hours', 'Cloudflare container behind the app Worker (23:50 UTC, after the publish job)'),
  ('tutorial_review', interval '1 day', interval '2 hours', 'GitHub Actions, tutorial-review.yml, signed in to a Claude plan (10:00 UTC)')
on conflict (job) do update set every = excluded.every, slack = excluded.slack, runs_on = excluded.runs_on;
