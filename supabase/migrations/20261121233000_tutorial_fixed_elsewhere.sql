-- A change to a video that failed, and that a pull request of its own fixed later
-- (docs/decisions/2026-11-21-a-failed-video-change-learns-the-pull-request-that-fixed-it.md). Caleb's card
-- "How LangQuest works (fr)" (suggestion f8c4546f) kept saying "Claude could not make the change" after PR 633
-- changed the French words in the app and the video was filmed again with no problem: nothing told the card.
--
-- - ops_tutorial_fixes `failed`: each change of the last 30 days whose fix failed, that was not sent to the agent
--   team (Fix it has its own chain, 20261121223000_tutorial_fix_in_app.sql), and whose video has a film newer than
--   the failure in the suggestion's language. The video fix run (`queue`) looks on GitHub for a pull request merged
--   into main after the failure that names the suggestion (its first 8 characters), or that changed a file Claude
--   named as the cause when the change failed (fix_note), outside e2e/tutorials.
-- - ops_tutorial_fixed_elsewhere: the run says which pull request, when it merged and which file. The database
--   keeps it only when a film of that video and language came in after the merge (a film in ops.tutorial_videos
--   passed the frame check), and keeps that film's time.
-- - The suggestion says it (`fixedBy`) while its fix is still the one that failed; "Try again" makes a new fix
--   and the old answer no longer counts. The card's record has the step.

alter table ops.tutorial_suggestions
  add column if not exists fixed_pr int,
  add column if not exists fixed_merged_at timestamptz,
  add column if not exists fixed_file text,
  add column if not exists fixed_filmed_at timestamptz,
  add column if not exists fixed_at timestamptz;
alter table ops.tutorial_suggestions drop constraint if exists tutorial_suggestions_fixed_check;
alter table ops.tutorial_suggestions add constraint tutorial_suggestions_fixed_check check (
  (fixed_at is null) = (fixed_pr is null)
  and (fixed_at is null) = (fixed_merged_at is null)
  and (fixed_at is null) = (fixed_filmed_at is null)
  and (fixed_pr is null or fixed_pr between 1 and 100000000)
  and (fixed_file is null or (fixed_at is not null and length(fixed_file) between 1 and 300))
);

-- Where a pull request of its own fixed a change that failed, for the dashboard. Null while there is none, or when
-- the fix moved on after it (Try again).
create or replace function ops.tutorial_fixed_json(s ops.tutorial_suggestions) returns jsonb
language sql stable set search_path = '' as $$
  select case when s.fixed_at is null or s.fix_state is distinct from 'failed' or s.fixed_merged_at <= s.fix_at then null
    else jsonb_build_object('pr', s.fixed_pr, 'mergedAt', s.fixed_merged_at, 'file', s.fixed_file, 'filmedAt', s.fixed_filmed_at, 'at', s.fixed_at) end
$$;
revoke all on function ops.tutorial_fixed_json from public;

-- The video fix run: pull request p_pr, merged at p_merged_at, fixed the change p_id that failed. p_file is the file
-- Claude named that it changed, or null when the pull request names the suggestion.
--   ok;  not_found;  refused  its fix did not fail, it went to the agent team, the merge is not after the failure,
--   no film of the video came in after the merge, or it is known already.
create or replace function public.ops_tutorial_fixed_elsewhere(p_id uuid, p_pr int, p_merged_at timestamptz, p_file text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  s ops.tutorial_suggestions;
  v_film timestamptz;
begin
  select * into s from ops.tutorial_suggestions where id = p_id for update;
  if not found then return 'not_found'; end if;
  if s.fix_state is distinct from 'failed' or s.app_asked_at is not null or s.tutorial is null
     or p_pr is null or p_pr not between 1 and 100000000 or p_merged_at is null or p_merged_at <= s.fix_at or p_merged_at > now()
     or (s.fixed_at is not null and s.fixed_merged_at > s.fix_at) then
    return 'refused';
  end if;
  select min(v.made_at) into v_film from ops.tutorial_videos v
  where v.tutorial = s.tutorial and v.language = coalesce(s.language, 'en') and v.made_at > p_merged_at;
  if v_film is null then return 'refused'; end if;
  update ops.tutorial_suggestions set fixed_pr = p_pr, fixed_merged_at = p_merged_at, fixed_file = left(nullif(btrim(p_file), ''), 300),
    fixed_filmed_at = v_film, fixed_at = now()
  where id = p_id;
  return 'ok';
end $$;

-- As in 20261121223000_tutorial_fix_in_app.sql, and `failed`.
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
      where s.app_asked_at > now() - interval '30 days' and s.app_refilm_at is null), '[]'::jsonb),
    'failed', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'tutorial', s.tutorial, 'language', s.language,
        'fixAt', s.fix_at, 'note', s.fix_note, 'filmedAt', f.made_at) order by s.fix_at)
      from ops.tutorial_suggestions s
      cross join lateral (select max(v.made_at) as made_at from ops.tutorial_videos v
        where v.tutorial = s.tutorial and v.language = coalesce(s.language, 'en')) f
      where s.fix_state = 'failed' and s.fix_at > now() - interval '30 days' and s.app_asked_at is null and s.tutorial is not null
        and (s.fixed_at is null or s.fixed_merged_at <= s.fix_at) and f.made_at > s.fix_at), '[]'::jsonb)
  )
$$;

revoke all on function public.ops_tutorial_fixed_elsewhere, public.ops_tutorial_fixes from public, anon, authenticated;
grant execute on function public.ops_tutorial_fixed_elsewhere, public.ops_tutorial_fixes to service_role;

-- As in 20261121223000_tutorial_fix_in_app.sql, and `fixedBy`.
create or replace function ops.tutorial_suggestion_json(s ops.tutorial_suggestions) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'kind', s.kind, 'tutorial', s.tutorial, 'language', s.language, 'title', s.title, 'detail', s.detail,
    'madeAt', s.made_at, 'editedAt', s.edited_at, 'decision', s.decision, 'decidedAt', s.decided_at, 'reason', s.reason, 'clear', s.clear,
    'issue', s.issue, 'issueUrl', s.issue_url,
    'fix', case when s.fix_state is null then null else jsonb_build_object('state', s.fix_state, 'pr', s.fix_pr, 'at', s.fix_at,
      'run', s.fix_run, 'note', s.fix_note) end,
    'app', ops.tutorial_app_json(s),
    'fixedBy', ops.tutorial_fixed_json(s),
    'pictures', s.pictures, 'after', s.after_pictures,
    'inputs', coalesce((select jsonb_agg(ops.tutorial_input_json(i) order by i.at)
      from ops.tutorial_suggestion_inputs l join ops.tutorial_inputs i on i.id = l.input where l.suggestion = s.id), '[]'::jsonb))
$$;
revoke all on function ops.tutorial_suggestion_json from public;

-- As in 20261121223000_tutorial_fix_in_app.sql, and the step 'fixed_elsewhere': a pull request of its own fixed a
-- change that failed, and the video was filmed again (detail: the file Claude named, or null).
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
