-- What became of the reply Claude suggested for a comment on a tutorial video (docs/tutorial-videos.md
-- "On the ops dashboard", decisions.md 186 amended 2026-11-19). Caleb (2026-11-19, thread "Make tutorial
-- videos dashboard page clear"): the page gave him a comment and a suggested reply with nothing to press,
-- and nothing told him what he must do.
--
-- - The card for a reply now copies the reply and opens the comment on YouTube, and a person says there
--   what became of it: Done (they posted it) or No reply needed. Nothing is posted from the dashboard: a
--   comment is untrusted, and a reply goes out only by a person's own hand (186).
-- - A comment keeps that answer (`reply_done`, with when and who), so the card leaves the page for every
--   admin and the page says only what is so. Before, a card stayed 14 days whatever was done, since
--   nothing recorded it.
-- - Only the service role writes it, through the dashboard's action `tutorial-reply` (decisions.md 162),
--   which is recorded in ops.actions as `reply_posted`, `reply_none` or `reply_open` (taken back).

alter table ops.tutorial_inputs
  add column if not exists reply_done text check (reply_done is null or reply_done in ('posted', 'none')),
  add column if not exists reply_done_at timestamptz,
  add column if not exists reply_done_by uuid;

-- An input as Claude and the dashboard see it, now with what became of its reply.
create or replace function ops.tutorial_input_json(i ops.tutorial_inputs) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', i.id, 'kind', i.kind, 'tutorial', i.tutorial, 'language', i.language, 'at', i.at,
    'ref', i.ref, 'youtubeId', i.youtube_id, 'pr', i.pr, 'text', i.text, 'english', i.english,
    'reply', i.reply, 'replyEnglish', i.reply_english, 'lookedAt', i.looked_at, 'outcome', i.outcome,
    'replyDone', i.reply_done, 'replyDoneAt', i.reply_done_at)
$$;
revoke all on function ops.tutorial_input_json from public;

-- A person says what became of a comment's suggested reply: `posted`, `none`, or `open` to take that
-- back. 'ok', or 'not_found' when no comment with a suggested reply has that id.
create or replace function public.ops_tutorial_reply_done(p_id uuid, p_done text, p_by uuid) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if p_done is null or p_done not in ('posted', 'none', 'open') then
    raise exception 'not an answer for a reply: %', p_done using errcode = '22023';
  end if;
  update ops.tutorial_inputs
    set reply_done = nullif(p_done, 'open'),
        reply_done_at = case when p_done = 'open' then null else now() end,
        reply_done_by = case when p_done = 'open' then null else p_by end
    where id = p_id and kind = 'comment' and reply is not null;
  return case when found then 'ok' else 'not_found' end;
end $$;
revoke all on function public.ops_tutorial_reply_done from public, anon, authenticated;
grant execute on function public.ops_tutorial_reply_done to service_role;

-- The dashboard's new action, in its log (ops.actions): the comment's input id is the target.
-- `user_issue_note` is the action of migration 20261118073000_user_issue_notes.sql, kept here so that
-- the two migrations give the same list in either order.
alter table ops.actions drop constraint if exists actions_action_check;
alter table ops.actions add constraint actions_action_check
  check (action in ('feedback_new', 'feedback_seen', 'feedback_done', 'run_job', 'verification_grant', 'verification_decline',
    'youtube_start', 'youtube_connect', 'tutorials_publish', 'tutorial_note', 'suggestion_accepted', 'suggestion_rejected', 'suggestion_edited',
    'quiet_ok', 'quiet_ok_undo', 'user_issue_note', 'reply_posted', 'reply_none', 'reply_open'));
