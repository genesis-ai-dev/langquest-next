-- An admin asks Claude a question from any card or page of the ops dashboard
-- (docs/decisions/2026-11-23-ask-claude-from-every-dashboard-card.md).
--
-- A user issue's card and a tutorial video's card have a box to tell Claude what
-- to do. Every other card had none: a line such as "R2 class A operations this
-- month are past what the plan includes" said "You do this one yourself", and the
-- admin could not ask Claude what it costs, why it grows, or what to do about it.
-- Now each card, and each page, has a box "Ask Claude". The question goes with
-- the card's words and numbers as the page drew them. The workflow
-- card-questions.yml (every 5 minutes) hands it to Claude, which reads the code,
-- production (agent_reader), the logs and, when the question needs it, public
-- web pages, and answers. The answer shows under the question on the card.
--
-- 1. ops.card_questions keeps each question, the card's words, and the answer.
-- 2. ops_card_ask() takes one from the dashboard (the service role, after
--    apps/web/worker/opsActions.ts checked the person).
-- 3. ops_card_questions_waiting() hands the waiting ones to the workflow.
-- 4. ops_card_questions_done() takes what a run did with them.
-- 5. diag.ops_card_questions() hands each card's last questions to the dashboard.

create table if not exists ops.card_questions (
  id uuid primary key default gen_random_uuid(),
  -- The card: 'line:<key>[:<subject>]' (apps/admin/src/pageCards.ts lineCardId) or 'page:<section>'.
  card text not null check (card ~ '^(line|page):[^[:cntrl:]]{1,200}$'),
  -- The section the card is on (apps/admin/src/pageOps.ts GROUPS).
  page text not null check (page ~ '^[a-z0-9_]{1,40}$'),
  title text not null check (length(title) between 1 and 300),
  -- The card's words and numbers as the page drew them when the admin asked.
  context text not null default '' check (length(context) <= 6000),
  -- The admin's words. Shown on the dashboard and handed to Claude; never written to Linear or GitHub.
  text text not null check (length(text) between 1 and 2000),
  by uuid not null,
  at timestamptz not null default now(),
  -- How many runs took it. A run that stops before it answers leaves the question for one more run.
  tries int not null default 0 check (tries between 0 and 100),
  taken_at timestamptz,
  run_url text check (run_url is null or run_url ~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$'),
  answered_at timestamptz,
  -- answered: Claude wrote an answer; none: the run ended without one.
  result text check (result is null or result in ('answered', 'none')),
  -- Claude's words: never an address (server/cardQuestions.ts checks them).
  answer text check (answer is null or length(answer) between 1 and 8000),
  check ((answered_at is null) = (result is null))
);
create index if not exists card_questions_card on ops.card_questions (card, at desc);
create index if not exists card_questions_waiting on ops.card_questions (at) where answered_at is null;
alter table ops.card_questions enable row level security;

-- A run takes a question at most this many times.
create or replace function ops._card_question_tries() returns int
language sql immutable set search_path = '' as $$ select 2 $$;

-- From the dashboard: the question's id; 'full' when three questions on that card wait already;
-- 'many' when twenty wait on the whole dashboard (each answer is a run of Claude).
create or replace function public.ops_card_ask(p_card text, p_page text, p_title text, p_context text, p_text text, p_by uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if (select count(*) from ops.card_questions q
      where q.card = p_card and q.answered_at is null and q.tries < ops._card_question_tries()) >= 3 then
    return 'full';
  end if;
  if (select count(*) from ops.card_questions q
      where q.answered_at is null and q.tries < ops._card_question_tries()) >= 20 then
    return 'many';
  end if;
  insert into ops.card_questions (card, page, title, context, text, by)
  values (p_card, p_page, btrim(p_title), coalesce(p_context, ''), btrim(p_text), p_by) returning id into v_id;
  return v_id::text;
end $$;
revoke all on function public.ops_card_ask from public, anon, authenticated;
grant execute on function public.ops_card_ask to service_role;

-- For the workflow: the five oldest questions that wait, each with the card's last answered
-- questions (what was said before on it). Not who asked.
create or replace function public.ops_card_questions_waiting() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'card', w.card, 'page', w.page, 'title', w.title,
      'context', w.context, 'text', w.text, 'at', w.at,
      'before', coalesce((select jsonb_agg(jsonb_build_object('at', b.at, 'text', b.text, 'answer', b.answer) order by b.at)
        from (select * from ops.card_questions p where p.card = w.card and p.answered_at is not null and p.answer is not null
              order by p.at desc limit 3) b), '[]'::jsonb)) order by w.at), '[]'::jsonb)
  from (select * from ops.card_questions q
        where q.answered_at is null and q.tries < ops._card_question_tries()
        order by q.at limit 5) w
$$;
revoke all on function public.ops_card_questions_waiting from public, anon, authenticated;
grant execute on function public.ops_card_questions_waiting to service_role;

-- What a run did with its questions: `taken` when the run starts on one, then Claude's answer.
-- A question answered already stays as it is.
create or replace function public.ops_card_questions_done(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  n jsonb;
  v_taken int := 0;
  v_answered int := 0;
begin
  if coalesce(p->>'runUrl', '') !~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$' then
    raise exception 'not a run of this repository' using errcode = '22023';
  end if;
  for n in select value from jsonb_array_elements(coalesce(p->'questions', '[]'::jsonb)) loop
    if (n->>'taken')::boolean then
      update ops.card_questions set tries = tries + 1, taken_at = now(), run_url = p->>'runUrl'
      where id = (n->>'id')::uuid and answered_at is null;
      if found then v_taken := v_taken + 1; end if;
    else
      update ops.card_questions set answered_at = now(), result = n->>'result', answer = nullif(n->>'answer', ''), run_url = p->>'runUrl'
      where id = (n->>'id')::uuid and answered_at is null;
      if found then v_answered := v_answered + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('taken', v_taken, 'answered', v_answered);
end $$;
revoke all on function public.ops_card_questions_done from public, anon, authenticated;
grant execute on function public.ops_card_questions_done to service_role;

-- For the dashboard: by card, the last five questions of the last 90 days, oldest first, with the
-- admin's display name (the record on each card names who did what:
-- docs/decisions/2026-11-21-every-dashboard-tap-shows-its-state.md).
-- `state`: waiting (no run took it), working (a run has it), answered, or stopped (two runs took it,
-- the last one more than an hour ago, and neither answered).
create or replace function diag.ops_card_questions() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(c.card, (
    select jsonb_agg(jsonb_build_object('id', x.id, 'at', x.at, 'text', x.text,
        'who', coalesce(nullif(btrim(p.display_name), ''), 'An admin'),
        'state', case when x.answered_at is not null then 'answered'
                      when x.tries >= ops._card_question_tries() and x.taken_at < now() - interval '1 hour' then 'stopped'
                      when x.tries > 0 then 'working' else 'waiting' end,
        'answeredAt', x.answered_at, 'result', x.result, 'answer', x.answer, 'runUrl', x.run_url) order by x.at)
    from (select * from ops.card_questions q
          where q.card = c.card and q.at > now() - interval '90 days' order by q.at desc limit 5) x
    left join public.profiles p on p.id = x.by::text)), '{}'::jsonb)
  from (select distinct q.card from ops.card_questions q where q.at > now() - interval '90 days') c
$$;
revoke all on function diag.ops_card_questions from public;
grant execute on function diag.ops_card_questions to diag_reader;

-- The dashboard's new action, in its log (ops.actions): the card is the target, the question's id the detail.
alter table ops.actions drop constraint if exists actions_action_check;
alter table ops.actions add constraint actions_action_check
  check (action in ('feedback_new', 'feedback_seen', 'feedback_done', 'run_job', 'verification_grant', 'verification_decline',
    'youtube_start', 'youtube_connect', 'tutorials_publish', 'tutorial_note', 'suggestion_accepted', 'suggestion_rejected', 'suggestion_edited',
    'quiet_ok', 'quiet_ok_undo', 'user_issue_note', 'reply_posted', 'reply_none', 'reply_open', 'filming_on', 'filming_off', 'suggestion_fix',
    'card_question'));
