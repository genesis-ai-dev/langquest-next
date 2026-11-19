-- An admin's instruction on a user issue, from its card on the ops dashboard
-- (docs/decisions/2026-11-18-an-admin-tells-claude-what-to-do-with-a-user-issue.md).
--
-- The card has a box, "Tell Claude what to do", as a tutorial video's card has
-- (decisions.md 186). What the admin writes is kept here. The watch for user
-- issues (decisions.md 202) hands it to Claude at its next run, with the issue
-- and its draft fix; Claude answers, and may change the draft fix. The answer
-- comes back through the Worker's door (/api/user-issues) and shows on the card
-- under the admin's words.
--
-- 1. ops.user_issue_notes keeps each instruction and its answer.
-- 2. ops_user_issue_instruct() takes one from the dashboard (the service role, after
--    apps/web/worker/opsActions.ts checked the person).
-- 3. ops_user_issue_notes_waiting() and ops_user_issue_notes() hand them to the watch.
-- 4. ops_user_issue_notes_done() takes what a run did with them.
-- 5. diag.ops_user_issue_notes() hands each open issue's last ones to the dashboard.

create table if not exists ops.user_issue_notes (
  id uuid primary key default gen_random_uuid(),
  issue text not null check (issue ~ '^[A-Z]{1,10}-[0-9]{1,7}$'),
  -- The admin's words. Shown on the dashboard and handed to Claude; never written to Linear or GitHub.
  text text not null check (length(text) between 1 and 2000),
  by uuid not null,
  at timestamptz not null default now(),
  -- How many runs took it. A run that stops before it answers leaves the note for one more run.
  tries int not null default 0 check (tries between 0 and 100),
  taken_at timestamptz,
  run_url text check (run_url is null or run_url ~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$'),
  answered_at timestamptz,
  -- changed: the draft fix changed (or a new one was written); answered: only words; none: Claude wrote neither.
  result text check (result is null or result in ('changed', 'answered', 'none')),
  -- Claude's words: never an address (server/userIssues.ts checks them).
  answer text check (answer is null or length(answer) between 1 and 1000),
  pr int check (pr is null or pr between 1 and 100000000),
  check ((answered_at is null) = (result is null))
);
create index if not exists user_issue_notes_issue on ops.user_issue_notes (issue, at desc);
create index if not exists user_issue_notes_waiting on ops.user_issue_notes (at) where answered_at is null;
alter table ops.user_issue_notes enable row level security;

-- A run takes a note at most this many times.
create or replace function ops._user_issue_note_tries() returns int
language sql immutable set search_path = '' as $$ select 2 $$;

-- From the dashboard: the note's id; 'not_found' when the watch has no open issue with that id;
-- 'full' when three notes on that issue wait already.
create or replace function public.ops_user_issue_instruct(p_issue text, p_text text, p_by uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from ops.user_issues u where u.issue = p_issue and u.verdict in ('filed', 'known') and u.closed_at is null) then
    return 'not_found';
  end if;
  if (select count(*) from ops.user_issue_notes n
      where n.issue = p_issue and n.answered_at is null and n.tries < ops._user_issue_note_tries()) >= 3 then
    return 'full';
  end if;
  insert into ops.user_issue_notes (issue, text, by) values (p_issue, btrim(p_text), p_by) returning id into v_id;
  return v_id::text;
end $$;
revoke all on function public.ops_user_issue_instruct from public, anon, authenticated;
grant execute on function public.ops_user_issue_instruct to service_role;

-- For the watch: each open issue that has a note waiting, the oldest note first, with its notes' ids.
create or replace function public.ops_user_issue_notes_waiting() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('issue', w.issue, 'ids', w.ids) order by w.first_at), '[]'::jsonb)
  from (
    select n.issue, min(n.at) as first_at, jsonb_agg(n.id order by n.at) as ids
    from ops.user_issue_notes n
    where n.answered_at is null and n.tries < ops._user_issue_note_tries()
      and exists (select 1 from ops.user_issues u where u.issue = n.issue and u.verdict in ('filed', 'known') and u.closed_at is null)
    group by n.issue
    order by min(n.at)
    limit 20
  ) w
$$;
revoke all on function public.ops_user_issue_notes_waiting from public, anon, authenticated;
grant execute on function public.ops_user_issue_notes_waiting to service_role;

-- For the run that writes the fix: one issue's waiting notes, and its last answered ones (what was said before).
create or replace function public.ops_user_issue_notes(p_issue text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'waiting', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'at', n.at, 'text', n.text) order by n.at)
      from ops.user_issue_notes n
      where n.issue = p_issue and n.answered_at is null and n.tries <= ops._user_issue_note_tries()), '[]'::jsonb),
    'before', coalesce((select jsonb_agg(jsonb_build_object('at', b.at, 'text', b.text, 'result', b.result, 'answer', b.answer) order by b.at)
      from (select * from ops.user_issue_notes n where n.issue = p_issue and n.answered_at is not null order by n.at desc limit 5) b), '[]'::jsonb))
$$;
revoke all on function public.ops_user_issue_notes from public, anon, authenticated;
grant execute on function public.ops_user_issue_notes to service_role;

-- What a run did with its notes: `taken` when the run starts on one, then its result and Claude's answer.
-- A note answered already stays as it is.
create or replace function public.ops_user_issue_notes_done(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  n jsonb;
  v_taken int := 0;
  v_answered int := 0;
begin
  if coalesce(p->>'runUrl', '') !~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$' then
    raise exception 'not a run of this repository' using errcode = '22023';
  end if;
  for n in select value from jsonb_array_elements(coalesce(p->'notes', '[]'::jsonb)) loop
    if (n->>'taken')::boolean then
      update ops.user_issue_notes set tries = tries + 1, taken_at = now(), run_url = p->>'runUrl'
      where id = (n->>'id')::uuid and answered_at is null;
      if found then v_taken := v_taken + 1; end if;
    else
      update ops.user_issue_notes set answered_at = now(), result = n->>'result', answer = nullif(n->>'answer', ''),
        pr = (n->>'pr')::int, run_url = p->>'runUrl'
      where id = (n->>'id')::uuid and answered_at is null;
      if found then v_answered := v_answered + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('taken', v_taken, 'answered', v_answered);
end $$;
revoke all on function public.ops_user_issue_notes_done from public, anon, authenticated;
grant execute on function public.ops_user_issue_notes_done to service_role;

-- For the dashboard: by issue, the last five notes of the last 90 days, oldest first. Not who wrote one.
-- `state`: waiting (no run took it), working (a run has it), answered, or stopped (two runs took it,
-- the last one more than three hours ago, and neither answered).
create or replace function diag.ops_user_issue_notes() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(i.issue, (
    select jsonb_agg(jsonb_build_object('at', x.at, 'text', x.text,
        'state', case when x.answered_at is not null then 'answered'
                      when x.tries >= ops._user_issue_note_tries() and x.taken_at < now() - interval '3 hours' then 'stopped'
                      when x.tries > 0 then 'working' else 'waiting' end,
        'answeredAt', x.answered_at, 'result', x.result, 'answer', x.answer, 'pr', x.pr, 'runUrl', x.run_url) order by x.at)
    from (select * from ops.user_issue_notes n
          where n.issue = i.issue and n.at > now() - interval '90 days' order by n.at desc limit 5) x)), '{}'::jsonb)
  from (select distinct n.issue from ops.user_issue_notes n where n.at > now() - interval '90 days') i
$$;
revoke all on function diag.ops_user_issue_notes from public;
grant execute on function diag.ops_user_issue_notes to diag_reader;

-- The dashboard's new action, in its log (ops.actions): the issue is the target, the note's id the detail.
alter table ops.actions drop constraint if exists actions_action_check;
alter table ops.actions add constraint actions_action_check
  check (action in ('feedback_new', 'feedback_seen', 'feedback_done', 'run_job', 'verification_grant', 'verification_decline',
    'youtube_start', 'youtube_connect', 'tutorials_publish', 'tutorial_note', 'suggestion_accepted', 'suggestion_rejected', 'suggestion_edited',
    'quiet_ok', 'quiet_ok_undo', 'user_issue_note'));
