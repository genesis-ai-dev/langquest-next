-- "Fix it" on a tutorial video's suggestion (docs/tutorial-videos.md "Feedback", decisions.md 186,
-- docs/decisions/2026-11-21-fix-it-sends-a-video-suggestion-to-the-agent-team.md). Caleb (2026-11-21):
-- a suggestion whose fix is in the app (a word in the French app, a screen that is wrong) could only go
-- to Linear, for a person to fix later. Now an admin's word on the card is enough: the agent team
-- (docs/agent-team.md) writes the change in the app, it merges on the preset rules with no tap, and the
-- video is filmed again as soon as it is in main.
--
-- - An admin taps Fix it on a suggestion about the app that waits for an answer (it is accepted then),
--   or on an accepted suggestion whose change to the video failed. The suggestion keeps when and who
--   (`app_asked_at`, `app_asked_by`), and whether the admin asked to see the change first (`app_ask_first`).
-- - The video fix run hands it over by itself when Claude finds that the cause of an accepted change is in
--   the app, and a person accepted or wrote it (`app_handed`, ops_tutorial_fix_to_app).
-- - It is filed in Linear as an accepted code change is (ops_suggestions_to_file). When its issue is known,
--   an instruction for that issue waits for the agent team (ops.user_issue_notes, `named` and `go`): `go`
--   says that the admin's word is the yes, so the fix merges when it keeps every other part of the rule.
-- - A later instruction on that issue from the card ("ask me first", "merge it") is taken, with `go` too.
-- - Once the fix's pull request merged, the video fix run films the video again (ops_tutorial_fixes
--   `refilm`, ops_tutorial_app_refilmed).
-- - The dashboard reads the chain from the suggestion (`app`) and from the card's record.

alter table ops.tutorial_suggestions
  add column if not exists app_asked_at timestamptz,
  add column if not exists app_asked_by uuid,
  add column if not exists app_ask_first boolean not null default false,
  add column if not exists app_handed boolean not null default false,
  add column if not exists app_refilm_at timestamptz,
  add column if not exists app_refilm_pr int;
alter table ops.tutorial_suggestions drop constraint if exists tutorial_suggestions_app_check;
alter table ops.tutorial_suggestions add constraint tutorial_suggestions_app_check check (
  (app_asked_at is null) = (app_asked_by is null)
  and (app_asked_at is null or (decision = 'accepted' and kind <> 'new' and tutorial is not null))
  and (app_asked_at is not null or not (app_ask_first or app_handed))
  and (app_refilm_at is null or app_asked_at is not null)
  and (app_refilm_pr is null or (app_refilm_at is not null and app_refilm_pr between 1 and 100000000))
);

alter table ops.user_issue_notes add column if not exists go boolean not null default false;
comment on column ops.user_issue_notes.go is
  'An admin''s Fix it on a tutorial video''s card, or a later instruction on that issue: the admin''s word is the yes, and the fix merges when it keeps every other part of the rule (docs/agent-team.md), unless an instruction asks to see it first.';
-- An issue in Linear: an accepted code change, or any suggestion an admin asked to fix in the app.
alter table ops.tutorial_suggestions drop constraint if exists tutorial_suggestions_check4;
alter table ops.tutorial_suggestions drop constraint if exists tutorial_suggestions_issue_kind_check;
drop function if exists public.ops_suggestion_fix_in_app(uuid, uuid);
alter table ops.tutorial_suggestions add constraint tutorial_suggestions_issue_kind_check
  check (issue is null or (decision = 'accepted' and (kind = 'code' or app_asked_at is not null)));

-- What the agent team is told: the change in the app, the suggestion's words, and what Claude found when
-- it tried to change the video. At most 2000 characters (ops.user_issue_notes.text).
create or replace function ops.tutorial_app_note(s ops.tutorial_suggestions) returns text
language sql stable set search_path = '' as $$
  select left(concat_ws(e'\n\n',
    'Fix it, from the Tutorial videos page of the ops dashboard. Change the app (its code, its words or the library), not the video. '
      || 'The video "' || s.tutorial || '"' || coalesce(' (' || s.language || ')', '') || ' is filmed again once the change is in main.',
    s.title, s.detail,
    case when s.fix_state = 'failed' and s.fix_note is not null then 'When Claude tried to change the video: ' || s.fix_note end,
    case when s.app_ask_first then 'Ask me first: show me the change before it merges.' end), 2000)
$$;
revoke all on function ops.tutorial_app_note from public;

-- From the dashboard (opsActions.ts): fix this suggestion in the app; p_ask_first: the admin asked to see the
-- change before it merges. {result, kind, issue}:
--   asked      kept; `issue` is its Linear issue when it has one, and then the instruction waits already;
--   not_found  no suggestion has that id;
--   decided    rejected, or a new video: nothing to fix in the app;
--   refused    accepted, and its change to the video did not fail: Claude makes it there;
--   already    asked before.
create or replace function public.ops_suggestion_fix_in_app(p_id uuid, p_by uuid, p_ask_first boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s ops.tutorial_suggestions;
begin
  if p_by is null then raise exception 'no person' using errcode = '22023'; end if;
  select * into s from ops.tutorial_suggestions where id = p_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if s.app_asked_at is not null then return jsonb_build_object('result', 'already', 'kind', s.kind, 'issue', s.issue); end if;
  if s.kind = 'new' or s.tutorial is null or s.decision = 'rejected' then return jsonb_build_object('result', 'decided', 'kind', s.kind); end if;
  if s.decision = 'accepted' and s.kind <> 'code' and s.fix_state is distinct from 'failed' then
    return jsonb_build_object('result', 'refused', 'kind', s.kind);
  end if;
  update ops.tutorial_suggestions set
    decision = 'accepted',
    decided_at = coalesce(decided_at, now()),
    decided_by = case when decided_at is null then p_by else decided_by end,
    app_asked_at = now(), app_asked_by = p_by, app_ask_first = coalesce(p_ask_first, false)
  where id = p_id
  returning * into s;
  if s.issue is not null then
    insert into ops.user_issue_notes (issue, text, by, named, go) values (s.issue, ops.tutorial_app_note(s), p_by, true, true);
  end if;
  return jsonb_build_object('result', 'asked', 'kind', s.kind, 'issue', s.issue);
end $$;

-- As in 20261029120000_tutorial_feedback.sql, and the suggestions an admin asked to fix in the app.
create or replace function public.ops_suggestions_to_file(p_limit int, p_id uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(ops.tutorial_suggestion_json(x.s) order by (x.s).decided_at), '[]'::jsonb)
  from (select s from ops.tutorial_suggestions s
        where (s.kind = 'code' or s.app_asked_at is not null) and s.decision = 'accepted' and s.issue is null and (p_id is null or s.id = p_id)
        order by s.decided_at limit least(greatest(p_limit, 0), 100)) x
$$;

-- As in 20261029120000_tutorial_feedback.sql, and: a suggestion an admin asked to fix in the app is
-- handed to the agent team once its issue is known.
create or replace function public.ops_suggestion_filed(p_id uuid, p_issue text, p_url text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s ops.tutorial_suggestions;
begin
  update ops.tutorial_suggestions set issue = p_issue, issue_url = p_url
  where id = p_id and (kind = 'code' or app_asked_at is not null) and decision = 'accepted' and issue is null
  returning * into s;
  if found and s.app_asked_at is not null then
    insert into ops.user_issue_notes (issue, text, by, named, go) values (s.issue, ops.tutorial_app_note(s), s.app_asked_by, true, true);
  end if;
end $$;

-- As in 20261121203000_user_issue_notes_named.sql, and: the issue of a suggestion an admin asked to fix
-- in the app takes instructions too ("ask me first" or "merge it" from its card), kept as `named` so the watch
-- hands them on, and as `go`: the admin's word on that card stays the yes.
create or replace function public.ops_user_issue_instruct(p_issue text, p_text text, p_by uuid, p_named boolean default false) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_go boolean := exists (select 1 from ops.tutorial_suggestions s where s.issue = p_issue and s.app_asked_at is not null);
  v_named boolean := coalesce(p_named, false) or v_go;
begin
  if not v_named
     and not exists (select 1 from ops.user_issues u where u.issue = p_issue and u.verdict in ('filed', 'known') and u.closed_at is null)
     and not exists (select 1 from ops.research_items r where r.issue = p_issue and r.decision = 'recommend') then
    return 'not_found';
  end if;
  if (select count(*) from ops.user_issue_notes n
      where n.issue = p_issue and n.answered_at is null and n.tries < ops._user_issue_note_tries()) >= 3 then
    return 'full';
  end if;
  insert into ops.user_issue_notes (issue, text, by, named, go) values (p_issue, btrim(p_text), p_by, v_named, v_go) returning id into v_id;
  return v_id::text;
end $$;

-- Where the fix in the app is, for the dashboard: whether the admin asked to see it first, whether the video
-- fix run handed it over, the instructions on its issue, the newest first, with the agent team's answers,
-- the team's record of the issue (as diag.ops_user_issue_fixes says it), when the video was sent to be
-- filmed again and when its new film came in. Null while nobody asked for it. Never the admin's id.
create or replace function ops.tutorial_app_json(s ops.tutorial_suggestions) returns jsonb
language sql stable set search_path = '' as $$
  select case when s.app_asked_at is null then null else jsonb_build_object(
    'askedAt', s.app_asked_at, 'askFirst', s.app_ask_first, 'handed', s.app_handed,
    'notes', coalesce((select jsonb_agg(jsonb_build_object('at', n.at, 'text', n.text, 'takenAt', n.taken_at, 'tries', n.tries,
        'answeredAt', n.answered_at, 'result', n.result, 'answer', n.answer, 'pr', n.pr) order by n.at desc)
      from (select * from ops.user_issue_notes where s.issue is not null and issue = s.issue and at >= s.app_asked_at order by at desc limit 10) n), '[]'::jsonb),
    'fix', (select jsonb_build_object('decision', x.decision, 'reason', x.reason, 'why', x.why, 'pr', x.pr, 'verdict', x.verdict,
        'summary', x.summary, 'cause', x.cause, 'review', x.review, 'runUrl', x.run_url, 'at', x.at,
        'before', x.before_jpg is not null, 'beforeAfter', x.after_jpg is not null)
      from ops.user_issue_fixes x where s.issue is not null and x.issue = s.issue and x.at >= s.app_asked_at),
    'refilmAt', s.app_refilm_at, 'refilmPr', s.app_refilm_pr,
    'filmedAt', (select min(v.made_at) from ops.tutorial_videos v
      where s.app_refilm_at is not null and v.tutorial = s.tutorial and v.language = coalesce(s.language, 'en') and v.made_at > s.app_refilm_at)
  ) end
$$;
revoke all on function ops.tutorial_app_json from public;

-- The video fix run, when Claude found that the cause of an accepted change is in the app (fix.json `app`):
-- the change goes to the agent team as if the admin who accepted or wrote it had tapped Fix it. Only for a
-- person's yes (decided_by): a clear fix that Claude accepted itself stays failed, and its card asks.
--   handed   kept; filed in Linear next, and then the instruction waits (ops_suggestion_filed);
--   already  asked before;   not_found;   refused  not a person's yes, or its change to the video did not fail.
create or replace function public.ops_tutorial_fix_to_app(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  s ops.tutorial_suggestions;
begin
  select * into s from ops.tutorial_suggestions where id = p_id for update;
  if not found then return 'not_found'; end if;
  if s.app_asked_at is not null then return 'already'; end if;
  if s.decision is distinct from 'accepted' or s.decided_by is null or s.kind = 'new' or s.tutorial is null
     or s.fix_state is distinct from 'failed' then
    return 'refused';
  end if;
  update ops.tutorial_suggestions set app_asked_at = now(), app_asked_by = s.decided_by, app_handed = true
  where id = p_id returning * into s;
  if s.issue is not null then
    insert into ops.user_issue_notes (issue, text, by, named, go) values (s.issue, ops.tutorial_app_note(s), s.app_asked_by, true, true);
  end if;
  return 'handed';
end $$;

-- The video fix run: the fix in the app merged (pull request p_pr), and the run sent the video to be filmed
-- again. 'ok', or 'refused' when it is not a fix in the app, or was sent already.
create or replace function public.ops_tutorial_app_refilmed(p_id uuid, p_pr int) returns text
language plpgsql security definer set search_path = '' as $$
begin
  update ops.tutorial_suggestions set app_refilm_at = now(), app_refilm_pr = p_pr
  where id = p_id and app_asked_at is not null and app_refilm_at is null and p_pr between 1 and 100000000;
  return case when found then 'ok' else 'refused' end;
end $$;

-- As in 20261116210000_tutorial_clear_fixes.sql, and `refilm`: each fix in the app of the last 30 days whose
-- pull request the agent team opened and whose video was not sent to be filmed again. The run asks GitHub
-- whether it merged.
create or replace function public.ops_tutorial_fixes(p_limit int) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'toFix', coalesce((select jsonb_agg(ops.tutorial_suggestion_json(x.s) order by (x.s).decided_at)
      from (select s from ops.tutorial_suggestions s
            where ops.tutorial_fixable(s) and s.app_asked_at is null
              and (s.fix_state is null or (s.fix_state = 'working' and s.fix_at < now() - interval '3 hours'))
            order by s.decided_at limit least(greatest(p_limit, 0), 10)) x), '[]'::jsonb),
    'open', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'pr', s.fix_pr, 'at', s.fix_at) order by s.fix_at)
      from ops.tutorial_suggestions s where s.fix_state = 'open'), '[]'::jsonb),
    'refilm', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'tutorial', s.tutorial, 'language', s.language, 'pr', x.pr) order by s.app_asked_at)
      from ops.tutorial_suggestions s join ops.user_issue_fixes x on x.issue = s.issue and x.at >= s.app_asked_at and x.pr is not null
      where s.app_asked_at > now() - interval '30 days' and s.app_refilm_at is null), '[]'::jsonb)
  )
$$;

-- As in 20261118073000_user_issue_notes.sql, and `go` on each note, and `askFirst`: an admin asked on the
-- card of a tutorial video's suggestion to see the change before it merges.
create or replace function public.ops_user_issue_notes(p_issue text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'waiting', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'at', n.at, 'text', n.text, 'go', n.go) order by n.at)
      from ops.user_issue_notes n
      where n.issue = p_issue and n.answered_at is null and n.tries <= ops._user_issue_note_tries()), '[]'::jsonb),
    'before', coalesce((select jsonb_agg(jsonb_build_object('at', b.at, 'text', b.text, 'result', b.result, 'answer', b.answer, 'go', b.go) order by b.at)
      from (select * from ops.user_issue_notes n where n.issue = p_issue and n.answered_at is not null order by n.at desc limit 5) b), '[]'::jsonb),
    'askFirst', exists (select 1 from ops.tutorial_suggestions s where s.issue = p_issue and s.app_asked_at is not null and s.app_ask_first))
$$;

revoke all on function public.ops_tutorial_fix_to_app, public.ops_tutorial_app_refilmed, public.ops_tutorial_fixes,
  public.ops_user_issue_notes from public, anon, authenticated;
grant execute on function public.ops_tutorial_fix_to_app, public.ops_tutorial_app_refilmed, public.ops_tutorial_fixes,
  public.ops_user_issue_notes to service_role;

-- As in 20261117193000_tutorial_pictures.sql, and `app`: where the fix in the app is.
create or replace function ops.tutorial_suggestion_json(s ops.tutorial_suggestions) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'kind', s.kind, 'tutorial', s.tutorial, 'language', s.language, 'title', s.title, 'detail', s.detail,
    'madeAt', s.made_at, 'editedAt', s.edited_at, 'decision', s.decision, 'decidedAt', s.decided_at, 'reason', s.reason, 'clear', s.clear,
    'issue', s.issue, 'issueUrl', s.issue_url,
    'fix', case when s.fix_state is null then null else jsonb_build_object('state', s.fix_state, 'pr', s.fix_pr, 'at', s.fix_at,
      'run', s.fix_run, 'note', s.fix_note) end,
    'app', ops.tutorial_app_json(s),
    'pictures', s.pictures, 'after', s.after_pictures,
    'inputs', coalesce((select jsonb_agg(ops.tutorial_input_json(i) order by i.at)
      from ops.tutorial_suggestion_inputs l join ops.tutorial_inputs i on i.id = l.input where l.suggestion = s.id), '[]'::jsonb))
$$;
revoke all on function ops.tutorial_suggestion_json from public;

-- As in 20261119171500_tutorial_reply_done.sql, and `suggestion_fix`: Fix it on a suggestion. `filming_on` and
-- `filming_off` are the actions of 20261121220000_tutorial_filming_switch.sql (PR 632), which already lists
-- `suggestion_fix`; this keeps the same list.
alter table ops.actions drop constraint if exists actions_action_check;
alter table ops.actions add constraint actions_action_check
  check (action in ('feedback_new', 'feedback_seen', 'feedback_done', 'run_job', 'verification_grant', 'verification_decline',
    'youtube_start', 'youtube_connect', 'tutorials_publish', 'tutorial_note', 'suggestion_accepted', 'suggestion_rejected', 'suggestion_edited',
    'quiet_ok', 'quiet_ok_undo', 'user_issue_note', 'reply_posted', 'reply_none', 'reply_open', 'filming_on', 'filming_off', 'suggestion_fix'));

revoke all on function public.ops_suggestion_fix_in_app, public.ops_suggestions_to_file, public.ops_suggestion_filed,
  public.ops_user_issue_instruct from public, anon, authenticated;
grant execute on function public.ops_suggestion_fix_in_app, public.ops_suggestions_to_file, public.ops_suggestion_filed,
  public.ops_user_issue_instruct to service_role;

-- As in 20261121213000_ops_card_record.sql, and on a video's card the chain of a fix in the app: the admin's
-- Fix it tap, the video fix run's handover, the agent team taking the instruction, its answer and its record
-- of the fix, the video sent to be filmed again after the merge, and its new film; and the admin's later
-- instructions on that issue.
create or replace function diag.ops_card_record(p_kind text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with taps as (
    select a.at, a.action, a.result, a.detail, a.target,
      coalesce(nullif(btrim(p.display_name), ''), 'An admin') as who
    from ops.actions a
    left join public.profiles p on p.id = a.profile_id::text
    where a.at > now() - interval '30 days'
      and a.action in ('tutorial_note', 'suggestion_accepted', 'suggestion_rejected', 'suggestion_edited',
                       'reply_posted', 'reply_none', 'reply_open', 'user_issue_note', 'suggestion_fix')
  ),
  video as (
    -- A tap on a video's card, with the video and language it was about.
    select t.at, t.who, t.action as what, t.result, t.detail,
      coalesce(s.tutorial, i.tutorial, si.tutorial, t.target) || '/' || coalesce(s.language, i.language, si.language, 'en') as key,
      left(coalesce(si.detail, s.title), 300) as words, null::int as pr
    from taps t
    left join ops.tutorial_suggestions s on t.action like 'suggestion\_%' and s.id::text = t.target
    left join ops.tutorial_inputs i on t.action like 'reply\_%' and i.id::text = t.target
    left join ops.tutorial_suggestions si on t.action = 'tutorial_note' and t.detail like 'instruction:%' and si.id::text = substr(t.detail, 13)
    where t.action <> 'user_issue_note'
    union all
    -- Claude's suggestions (an admin's instruction is the admin's own tap, above).
    select s.made_at, 'Claude', 'suggested', 'ok', s.kind, s.tutorial || '/' || coalesce(s.language, 'en'), left(s.title, 300), null
    from ops.tutorial_suggestions s
    where s.kind <> 'instruction' and s.made_at > now() - interval '30 days' and s.tutorial is not null
    union all
    -- Where Claude's change to the video is now.
    select s.fix_at, 'Claude', 'fix', 'ok', s.fix_state, s.tutorial || '/' || coalesce(s.language, 'en'), left(s.title, 300), s.fix_pr
    from ops.tutorial_suggestions s
    where s.fix_state is not null and s.fix_at > now() - interval '30 days' and s.tutorial is not null
    union all
    -- The fix in the app: the video fix run handed it over, then each step of the agent team and the film.
    select a.at, a.who, a.what, 'ok', a.detail, s.tutorial || '/' || coalesce(s.language, 'en'), a.words, a.pr
    from ops.tutorial_suggestions s
    cross join lateral (
      select s.app_asked_at as at, 'Claude' as who, 'handed' as what, null::text as detail, left(s.fix_note, 300) as words, null::int as pr where s.app_handed
      union all
      select n.taken_at, 'Claude', 'taken', null, left(n.text, 300), null
      from ops.user_issue_notes n where n.issue = s.issue and n.at >= s.app_asked_at and n.taken_at is not null
      union all
      select n.answered_at, 'Claude', 'answered', n.result, left(n.answer, 300), n.pr
      from ops.user_issue_notes n where n.issue = s.issue and n.at >= s.app_asked_at and n.answered_at is not null
      union all
      select x.at, 'Claude', 'appfix', x.decision || coalesce(':' || x.reason, ''), left(coalesce(x.summary, x.why), 300), x.pr
      from ops.user_issue_fixes x where x.issue = s.issue and x.at >= s.app_asked_at
      union all
      select s.app_refilm_at, 'Claude', 'refilm', null, null, s.app_refilm_pr where s.app_refilm_at is not null
      union all
      select min(v.made_at), 'Claude', 'filmed', null, null, null
      from ops.tutorial_videos v
      where s.app_refilm_at is not null and v.tutorial = s.tutorial and v.language = coalesce(s.language, 'en') and v.made_at > s.app_refilm_at
      having min(v.made_at) is not null
    ) a
    where s.app_asked_at > now() - interval '30 days' and a.at > now() - interval '30 days'
    union all
    -- An admin's instruction on the issue of a fix in the app ("ask me first", "merge it") shows on the video's card too.
    select t.at, t.who, t.action, t.result, case when t.result = 'ok' then null else t.detail end,
      s.tutorial || '/' || coalesce(s.language, 'en'), left(n.text, 300), null
    from taps t
    join ops.tutorial_suggestions s on s.issue = t.target and s.app_asked_at is not null and t.at >= s.app_asked_at
    left join ops.user_issue_notes n on t.detail like 'note:%' and n.id::text = substr(t.detail, 6)
    where t.action = 'user_issue_note'
  ),
  issue as (
    select t.at, t.who, t.action as what, t.result, case when t.result = 'ok' then null else t.detail end as detail, t.target as key,
      left(n.text, 300) as words, null::int as pr
    from taps t
    left join ops.user_issue_notes n on t.detail like 'note:%' and n.id::text = substr(t.detail, 6)
    where t.action = 'user_issue_note'
    union all
    -- Claude's answer to each instruction.
    select n.answered_at, 'Claude', 'answered', 'ok', n.result, n.issue, left(n.answer, 300), n.pr
    from ops.user_issue_notes n
    where n.answered_at > now() - interval '30 days'
  )
  select coalesce(jsonb_agg(jsonb_build_object('at', r.at, 'who', r.who, 'what', r.what, 'result', r.result, 'detail', r.detail,
      'key', r.key, 'words', r.words, 'pr', r.pr) order by r.at desc), '[]'::jsonb)
  from (
    select * from video where p_kind = 'video'
    union all
    select * from issue where p_kind = 'issue'
    order by at desc limit 400
  ) r
$$;
revoke all on function diag.ops_card_record from public;
grant execute on function diag.ops_card_record to diag_reader;
