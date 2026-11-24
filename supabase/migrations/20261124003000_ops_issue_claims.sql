-- A developer claims a Linear issue on the ops dashboard, and each admin sees Claude's latest replies
-- to them (docs/decisions/2026-11-24-claim-issues-and-see-claudes-replies.md).
--
-- 1. Two developers took the same user issue: the card did not say that someone works on it. Now a
--    Global Viewer taps Claim on the issue's card (a user issue's card, or a line's card with one
--    Linear issue). The card shows "Claimed by <display name>" to every admin. Only the one who
--    claimed it can release it. ops.issue_claims keeps one claim for each issue; ops_issue_claim()
--    takes a claim or a release from the dashboard (the service role, after
--    apps/web/worker/opsActions.ts checked the person).
-- 2. Claude answers on a card (an instruction on a user issue, a question from any card, an
--    instruction on a tutorial video), but an admin saw an answer only on its card. Now the corner of
--    the dashboard has Claude's replies: diag.ops_mine(p_by) lists, for the admin the dashboard's
--    Worker checked, Claude's replies of the last 30 days on each card that admin talked on, and on
--    each issue that admin claimed, with the time the admin last opened the list (the action
--    replies_seen in ops.actions).
-- 3. diag.ops_card_record('issue') also names who claimed and released an issue. The function is a
--    whole copy of its last definition (20261121233000_tutorial_fixed_elsewhere.sql) with that change.

create table if not exists ops.issue_claims (
  issue text primary key check (issue ~ '^[A-Z]{1,10}-[0-9]{1,7}$'),
  -- The Global Viewer's profile id. The dashboard shows the display name, never an address.
  by uuid not null,
  at timestamptz not null default now()
);
alter table ops.issue_claims enable row level security;

-- From the dashboard: p_claim true takes the issue ('claimed', or 'taken' when another admin has it);
-- false releases it ('released', or 'not_yours' when another admin has it).
create or replace function public.ops_issue_claim(p_issue text, p_claim boolean, p_by uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_by uuid;
begin
  if p_issue is null or p_issue !~ '^[A-Z]{1,10}-[0-9]{1,7}$' or p_by is null or p_claim is null then
    raise exception 'not a claim' using errcode = '22023';
  end if;
  select c.by into v_by from ops.issue_claims c where c.issue = p_issue for update;
  if p_claim then
    if v_by is not null then return case when v_by = p_by then 'claimed' else 'taken' end; end if;
    insert into ops.issue_claims (issue, by) values (p_issue, p_by) on conflict (issue) do nothing;
    -- Another admin claimed it in the same moment.
    if not found then return 'taken'; end if;
    return 'claimed';
  end if;
  if v_by is null then return 'released'; end if;
  if v_by <> p_by then return 'not_yours'; end if;
  delete from ops.issue_claims where issue = p_issue;
  return 'released';
end $$;
revoke all on function public.ops_issue_claim from public, anon, authenticated;
grant execute on function public.ops_issue_claim to service_role;

-- For the dashboard, for the admin its Worker checked (p_by):
--   claims:  each claimed issue with who claimed it (display name), when, and whether it is p_by's;
--   replies: Claude's last 40 replies of the last 30 days on each card p_by talked on in that time, and
--            on each issue p_by claimed; mine says whether p_by wrote the words Claude answered;
--   seenAt:  when p_by last opened the list.
create or replace function diag.ops_mine(p_by uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with my_issues as (
    select n.issue from ops.user_issue_notes n where n.by = p_by and n.at > now() - interval '30 days'
    union
    select c.issue from ops.issue_claims c where c.by = p_by
  ),
  my_cards as (
    select q.card from ops.card_questions q where q.by = p_by and q.at > now() - interval '30 days'
  ),
  replies as (
    -- Claude's answer to an instruction on a Linear issue (the watch's run).
    select n.answered_at as at, 'issue' as kind, n.issue as card, 'userissues' as page,
      coalesce((select max(u.title) from ops.user_issues u where u.issue = n.issue), n.issue) as title,
      left(n.text, 300) as asked, n.by = p_by as mine, left(n.answer, 600) as answer, n.result, n.pr
    from ops.user_issue_notes n
    where n.answered_at > now() - interval '30 days' and n.issue in (select issue from my_issues)
    union all
    -- Claude's answer to a question from a card or a page.
    select q.answered_at, 'question', q.card, q.page, q.title, left(q.text, 300), q.by = p_by, left(q.answer, 600), q.result, null::int
    from ops.card_questions q
    where q.answered_at > now() - interval '30 days' and q.card in (select card from my_cards)
    union all
    -- Where Claude's change for p_by's instruction on a tutorial video is now: its pull request, or why it failed.
    select s.fix_at, 'video', s.tutorial || '/' || coalesce(s.language, 'en'), 'tutorials', s.title, left(s.detail, 300), true,
      left(s.fix_note, 600), s.fix_state, s.fix_pr
    from ops.tutorial_suggestions s
    where s.kind = 'instruction' and s.decided_by = p_by and s.fix_state in ('open', 'merged', 'closed', 'failed')
      and s.fix_at > now() - interval '30 days'
  )
  select jsonb_build_object(
    'claims', coalesce((select jsonb_object_agg(c.issue, jsonb_build_object('who', coalesce(nullif(btrim(p.display_name), ''), 'An admin'),
        'at', c.at, 'mine', c.by = p_by))
      from ops.issue_claims c left join public.profiles p on p.id = c.by::text), '{}'::jsonb),
    'replies', coalesce((select jsonb_agg(jsonb_build_object('at', r.at, 'kind', r.kind, 'card', r.card, 'page', r.page, 'title', r.title,
        'asked', r.asked, 'mine', r.mine, 'answer', r.answer, 'result', r.result, 'pr', r.pr) order by r.at desc)
      from (select * from replies order by at desc limit 40) r), '[]'::jsonb),
    'seenAt', (select max(a.at) from ops.actions a where a.profile_id = p_by and a.action = 'replies_seen' and a.result = 'ok'))
$$;
revoke all on function diag.ops_mine from public;
grant execute on function diag.ops_mine to diag_reader;

-- The dashboard's new actions, in its log (ops.actions): the issue is the target of a claim and a release;
-- 'replies' is the target of replies_seen.
alter table ops.actions drop constraint if exists actions_action_check;
alter table ops.actions add constraint actions_action_check
  check (action in ('feedback_new', 'feedback_seen', 'feedback_done', 'run_job', 'verification_grant', 'verification_decline',
    'youtube_start', 'youtube_connect', 'tutorials_publish', 'tutorial_note', 'suggestion_accepted', 'suggestion_rejected', 'suggestion_edited',
    'quiet_ok', 'quiet_ok_undo', 'user_issue_note', 'reply_posted', 'reply_none', 'reply_open', 'filming_on', 'filming_off', 'suggestion_fix',
    'card_question', 'issue_claim', 'issue_release', 'replies_seen',
    -- The thread that adds a Resolved button to dashboard notices (20261124013000_ops_line_resolves.sql) adds these two.
    'line_resolved', 'line_shown'));
create index if not exists ops_actions_seen_idx on ops.actions (profile_id, at desc) where action = 'replies_seen';

-- As in 20261121233000_tutorial_fixed_elsewhere.sql, and: an issue's record names who claimed and released it.
create or replace function diag.ops_card_record(p_kind text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with taps as (
    select a.at, a.action, a.result, a.detail, a.target,
      coalesce(nullif(btrim(p.display_name), ''), 'An admin') as who
    from ops.actions a
    left join public.profiles p on p.id = a.profile_id::text
    where a.at > now() - interval '30 days'
      and a.action in ('tutorial_note', 'suggestion_accepted', 'suggestion_rejected', 'suggestion_edited',
                       'reply_posted', 'reply_none', 'reply_open', 'user_issue_note', 'suggestion_fix', 'issue_claim', 'issue_release')
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
    where t.action not in ('user_issue_note', 'issue_claim', 'issue_release')
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
    where t.action in ('user_issue_note', 'issue_claim', 'issue_release')
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
