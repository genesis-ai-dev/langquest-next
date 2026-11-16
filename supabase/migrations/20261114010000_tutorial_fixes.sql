-- Claude makes an accepted change to a tutorial video (docs/tutorial-videos.md
-- "Feedback", decisions.md 186 amended 2026-11-13). A suggestion to change a
-- video's script, screens or voice that a person accepted on the ops
-- dashboard is written by Claude as a draft pull request
-- (tutorial-review.yml, its fix jobs): a person reads it, marks it Ready for
-- review and merges it, and the merge films the video again (183). Each
-- suggestion keeps where its fix is:
--   (none)   accepted, waiting for the next fix run (every 30 minutes);
--   working  a run is writing it (fix_run), since fix_at;
--   open     its draft pull request (fix_pr) waits for a person to merge it;
--   merged   merged into main: the film run that follows films it again;
--   closed   its pull request was closed without a merge;
--   failed   Claude wrote no fix, or the workflow could not open it (fix_note says why).
-- A run that stops while working leaves the suggestion to the next run after
-- three hours.
--
-- An admin's instruction (Caleb, 2026-11-13): on a card for a comment, a
-- screen change or a film that failed or was held, an admin writes what
-- Claude must do. It is an accepted suggestion at once, of the kind
-- 'instruction', and the next fix run makes it like any other.

alter table ops.tutorial_suggestions
  -- The language of the film an instruction is about (its log and pictures); none means English.
  add column if not exists language text check (language is null or language ~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?$'),
  add column if not exists fix_state text check (fix_state is null or fix_state in ('working', 'open', 'merged', 'closed', 'failed')),
  add column if not exists fix_pr int check (fix_pr is null or fix_pr between 1 and 10000000),
  add column if not exists fix_at timestamptz,
  add column if not exists fix_run text check (fix_run is null or fix_run ~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$'),
  add column if not exists fix_note text check (fix_note is null or length(fix_note) between 1 and 1000);

-- instruction: what an admin told Claude to do with a video; never the look's own.
alter table ops.tutorial_suggestions drop constraint if exists tutorial_suggestions_kind_check;
alter table ops.tutorial_suggestions add constraint tutorial_suggestions_kind_check
  check (kind in ('script', 'screen', 'voice', 'code', 'new', 'instruction'));
alter table ops.tutorial_suggestions drop constraint if exists tutorial_suggestions_instruction_check;
alter table ops.tutorial_suggestions add constraint tutorial_suggestions_instruction_check
  check (kind <> 'instruction' or (tutorial is not null and decision is not distinct from 'accepted'));
alter table ops.tutorial_suggestions drop constraint if exists tutorial_suggestions_fix_check;
alter table ops.tutorial_suggestions add constraint tutorial_suggestions_fix_check check (
  (fix_state is null) = (fix_at is null)
  and (fix_state is null or (decision is not distinct from 'accepted' and kind in ('script', 'screen', 'voice', 'instruction')))
  and (fix_state not in ('open', 'merged', 'closed') or fix_pr is not null)
);
create index if not exists tutorial_suggestions_to_fix_idx on ops.tutorial_suggestions (decided_at)
  where decision = 'accepted' and kind in ('script', 'screen', 'voice', 'instruction') and (fix_state is null or fix_state in ('working', 'open'));

-- What Claude may make: an accepted change to a video's script, screens or voice, or an admin's instruction.
create or replace function ops.tutorial_fixable(s ops.tutorial_suggestions) returns boolean
language sql immutable set search_path = '' as $$
  select s.decision = 'accepted' and s.kind in ('script', 'screen', 'voice', 'instruction') and s.tutorial is not null
$$;
revoke all on function ops.tutorial_fixable from public;

-- A suggestion with the inputs it answers, and where its fix is.
create or replace function ops.tutorial_suggestion_json(s ops.tutorial_suggestions) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'kind', s.kind, 'tutorial', s.tutorial, 'language', s.language, 'title', s.title, 'detail', s.detail,
    'madeAt', s.made_at, 'editedAt', s.edited_at, 'decision', s.decision, 'decidedAt', s.decided_at, 'reason', s.reason,
    'issue', s.issue, 'issueUrl', s.issue_url,
    'fix', case when s.fix_state is null then null else jsonb_build_object('state', s.fix_state, 'pr', s.fix_pr, 'at', s.fix_at,
      'run', s.fix_run, 'note', s.fix_note) end,
    'inputs', coalesce((select jsonb_agg(ops.tutorial_input_json(i) order by i.at)
      from ops.tutorial_suggestion_inputs l join ops.tutorial_inputs i on i.id = l.input where l.suggestion = s.id), '[]'::jsonb))
$$;
revoke all on function ops.tutorial_suggestion_json from public;

-- ---- the fix jobs, through the app Worker's /api/tutorial-review/fixes ------------------------------

-- What waits for Claude, oldest accepted first (at most p_limit, and 10): accepted changes with no
-- fix yet, or one a run left working more than three hours ago; and the draft pull requests that
-- wait for a person, to ask GitHub whether they were merged or closed.
create or replace function public.ops_tutorial_fixes(p_limit int) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'toFix', coalesce((select jsonb_agg(ops.tutorial_suggestion_json(x.s) order by (x.s).decided_at)
      from (select s from ops.tutorial_suggestions s
            where ops.tutorial_fixable(s) and (s.fix_state is null or (s.fix_state = 'working' and s.fix_at < now() - interval '3 hours'))
            order by s.decided_at limit least(greatest(p_limit, 0), 10)) x), '[]'::jsonb),
    'open', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'pr', s.fix_pr) order by s.fix_at)
      from ops.tutorial_suggestions s where s.fix_state = 'open'), '[]'::jsonb)
  )
$$;

-- Where a fix is now (server/tutorialFeedback.ts `FixUpdate`, already checked): a run starts it,
-- opens its draft pull request or says why there is none, and a later run says it was merged or
-- closed. A state only moves forward: working from none, failed or a stale working; open from
-- working; merged or closed from open; open again from closed (reopened). 'ok', 'not_found' or
-- 'refused' (the move is not one of these, or the change is not one Claude makes).
create or replace function public.ops_tutorial_fixed(p_id uuid, p_state text, p_pr int, p_run text, p_note text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  s ops.tutorial_suggestions;
  v_moves boolean;
begin
  if p_state is null or p_state not in ('working', 'open', 'merged', 'closed', 'failed') then raise exception 'not a fix state' using errcode = '22023'; end if;
  select * into s from ops.tutorial_suggestions where id = p_id for update;
  if not found then return 'not_found'; end if;
  if not ops.tutorial_fixable(s) then return 'refused'; end if;
  v_moves := case p_state
      when 'working' then s.fix_state is null or s.fix_state = 'failed' or (s.fix_state = 'working' and s.fix_at < now() - interval '3 hours')
      when 'open' then (s.fix_state = 'working' or s.fix_state = 'closed') and p_pr is not null
      when 'failed' then s.fix_state = 'working'
      else s.fix_state = 'open' and p_pr = s.fix_pr
    end;
  if not coalesce(v_moves, false) then return 'refused'; end if;
  update ops.tutorial_suggestions set fix_state = p_state, fix_at = now(),
    fix_pr = case when p_state = 'working' then null else coalesce(p_pr, fix_pr) end,
    fix_run = case when p_state in ('working', 'open', 'failed') then coalesce(p_run, fix_run) else fix_run end,
    fix_note = case when p_state = 'failed' then left(nullif(p_note, ''), 1000) when p_state = 'working' then null else fix_note end
  where id = p_id;
  return 'ok';
end $$;

-- ---- an admin's instruction, through the ops dashboard's action (opsActions.ts) ---------------------

-- What an admin told Claude to do with a video: kept as a note, and an accepted suggestion of the kind
-- 'instruction' at once, with no second Accept. The inputs the admin's card showed (a comment, a code
-- change) are answered by it, so the look does not suggest them again. The suggestion's id.
create or replace function public.ops_tutorial_instruct(p_tutorial text, p_language text, p_problem text, p_text text, p_inputs uuid[], p_by uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_note uuid;
  v_sug uuid;
begin
  if p_tutorial is null or p_by is null or nullif(trim(p_text), '') is null then raise exception 'not an instruction' using errcode = '22023'; end if;
  if coalesce(cardinality(p_inputs), 0) > 20 then raise exception 'too many inputs' using errcode = '22023'; end if;
  insert into ops.tutorial_inputs (kind, tutorial, language, text, by, at, looked_at)
    values ('note', p_tutorial, p_language, p_text, p_by, now(), now()) returning id into v_note;
  insert into ops.tutorial_suggestions (kind, tutorial, language, title, detail, decision, decided_at, decided_by)
    values ('instruction', p_tutorial, p_language, left(coalesce(nullif(trim(p_problem), ''), 'An admin''s instruction'), 200), p_text,
      'accepted', now(), p_by) returning id into v_sug;
  insert into ops.tutorial_suggestion_inputs (suggestion, input)
    select v_sug, i.id from ops.tutorial_inputs i where i.id = v_note or i.id = any(coalesce(p_inputs, '{}'))
    on conflict do nothing;
  update ops.tutorial_inputs set looked_at = coalesce(looked_at, now()) where id = any(coalesce(p_inputs, '{}'));
  return v_sug;
end $$;

revoke all on function public.ops_tutorial_fixes, public.ops_tutorial_fixed, public.ops_tutorial_instruct from public, anon, authenticated;
grant execute on function public.ops_tutorial_fixes, public.ops_tutorial_fixed, public.ops_tutorial_instruct to service_role;

-- ---- what the dashboard reads -----------------------------------------------------------------------

-- As before (20261029120000_tutorial_feedback.sql), and: a suggestion whose fix is not done stays
-- listed after 30 days, with how many changes wait for Claude (toFix), Claude is writing (fixing)
-- and wait for a person to merge (toMerge).
create or replace function diag.ops_tutorial_feedback() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'suggestions', coalesce((select jsonb_agg(ops.tutorial_suggestion_json(x.s) order by (x.s).decision nulls first, (x.s).made_at desc)
      from (select s from ops.tutorial_suggestions s
            where s.decision is null or s.decided_at > now() - interval '30 days' or s.fix_state in ('working', 'open')
               or (ops.tutorial_fixable(s) and s.fix_state is null)
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
    'toFix', (select count(*) from ops.tutorial_suggestions s where ops.tutorial_fixable(s) and s.fix_state is null),
    'fixing', (select count(*) from ops.tutorial_suggestions where fix_state = 'working'),
    'toMerge', (select count(*) from ops.tutorial_suggestions where fix_state = 'open'),
    'last', (select jsonb_build_object('at', r.at, 'sha', r.sha, 'runUrl', r.run_url, 'looked', r.looked, 'suggested', r.suggested, 'code', r.code)
      from ops.tutorial_reviews r order by r.at desc, r.id desc limit 1),
    'videos', coalesce((select jsonb_agg(jsonb_build_object('tutorial', t.tutorial, 'title', t.title) order by t.title)
      from (select distinct on (tutorial) tutorial, title from ops.tutorial_videos where language = 'en' order by tutorial, made_at desc) t), '[]'::jsonb)
  )
$$;
revoke all on function diag.ops_tutorial_feedback from public;
grant execute on function diag.ops_tutorial_feedback to diag_reader;
