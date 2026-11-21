-- The record on each card of the ops dashboard that talks with Claude
-- (docs/decisions/2026-11-21-every-dashboard-tap-shows-its-state.md): who did
-- what, and when, so each admin sees what another admin did already, and
-- whose turn it is. It reads what is kept already: the taps on the page
-- (ops.actions, with the admin's display name), Claude's suggestions and
-- changes to a video (ops.tutorial_suggestions), and Claude's answers to an
-- instruction on a Linear issue (ops.user_issue_notes). 30 days, newest first.
-- p_kind 'video': each row's key is '<tutorial>/<language>'. 'issue': the Linear id.

create or replace function diag.ops_card_record(p_kind text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with taps as (
    select a.at, a.action, a.result, a.detail, a.target,
      coalesce(nullif(btrim(p.display_name), ''), 'An admin') as who
    from ops.actions a
    left join public.profiles p on p.id = a.profile_id::text
    where a.at > now() - interval '30 days'
      and a.action in ('tutorial_note', 'suggestion_accepted', 'suggestion_rejected', 'suggestion_edited',
                       'reply_posted', 'reply_none', 'reply_open', 'user_issue_note')
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
