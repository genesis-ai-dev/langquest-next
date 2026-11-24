-- A user issue's state in Linear, on its card at once
-- (docs/decisions/2026-11-24-close-an-issue-from-its-card.md).
--
-- The card learned that an issue closed in Linear only at the watch's next run, which GitHub starts 5 to 25
-- minutes late; and the card had no way to close an issue. Now the app Worker closes an issue in Linear
-- from its card, and reads the state in Linear of the open issues the page shows, and keeps both here at once.
--
-- 1. ops_user_issue_states() keeps states, as the watch's ops_user_issues_looked() does, without a run.
-- 2. diag.ops_card_record() shows who closed an issue from its card (as in 20261124003000_ops_issue_claims.sql,
--    with the tap issue_close).

create or replace function public.ops_user_issue_states(p jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  s jsonb;
  v_changed int := 0;
  v_rows int;
begin
  for s in select value from jsonb_array_elements(coalesce(p->'states', '[]'::jsonb)) loop
    if coalesce(s->>'issue', '') !~ '^[A-Z]{1,10}-[0-9]{1,7}$' or nullif(s->>'state', '') is null or length(s->>'state') > 60 then continue; end if;
    if (s->>'closed')::boolean then
      -- Closed: as the watch keeps it (20261121231500_user_issue_known.sql), with the pull request Linear links when there is one.
      update ops.user_issues set verdict = 'fixed', closed_at = coalesce((s->>'closedAt')::timestamptz, now()), issue_state = s->>'state',
        fixed_by = coalesce((s->>'fixedBy')::int, fixed_by), fixed_at = coalesce(fixed_at, (s->>'closedAt')::timestamptz, now()), people = 0
      where issue = s->>'issue' and verdict in ('filed', 'known');
      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        update diag.feedback f set done_at = now(), seen_at = coalesce(f.seen_at, now())
        where f.done_at is null and exists (select 1 from ops.user_issues u where u.issue = s->>'issue' and u.key = 'feedback:' || f.id::text);
      end if;
    else
      update ops.user_issues set verdict = 'filed', closed_at = null, fixed_by = null, fixed_at = null, issue_state = s->>'state'
      where issue = s->>'issue' and verdict = 'fixed' and closed_at is not null;
      get diagnostics v_rows = row_count;
    end if;
    v_changed := v_changed + v_rows;
    update ops.user_issues set issue_state = s->>'state' where issue = s->>'issue' and issue_state is distinct from s->>'state';
    get diagnostics v_rows = row_count;
    v_changed := v_changed + v_rows;
  end loop;
  return v_changed;
end $$;
revoke all on function public.ops_user_issue_states from public, anon, authenticated;
grant execute on function public.ops_user_issue_states to service_role;

-- Who closed an issue from its card, with the card's other taps.
create or replace function diag.ops_card_record(p_kind text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with taps as (
    select a.at, a.action, a.result, a.detail, a.target,
      coalesce(nullif(btrim(p.display_name), ''), 'An admin') as who
    from ops.actions a
    left join public.profiles p on p.id = a.profile_id::text
    where a.at > now() - interval '30 days'
      and a.action in ('tutorial_note', 'suggestion_accepted', 'suggestion_rejected', 'suggestion_edited',
                       'reply_posted', 'reply_none', 'reply_open', 'user_issue_note', 'suggestion_fix', 'issue_claim', 'issue_release', 'issue_close')
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
    where t.action not in ('user_issue_note', 'issue_claim', 'issue_release', 'issue_close')
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
    -- A pull request of its own fixed the change that failed, and the video was filmed again after it.
    select s.fixed_at, 'Claude', 'fixed_elsewhere', 'ok', s.fixed_file, s.tutorial || '/' || coalesce(s.language, 'en'), left(s.title, 300), s.fixed_pr
    from ops.tutorial_suggestions s
    where ops.tutorial_fixed_json(s) is not null and s.fixed_at > now() - interval '30 days'
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
    where t.action in ('user_issue_note', 'issue_claim', 'issue_release', 'issue_close')
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
