-- An issue's card in plain words (docs/card-words.md "An issue's card",
-- docs/decisions/2026-11-25-the-issue-manager-writes-the-card-and-a-naive-reader-checks-it.md).
--
-- The watch wrote an issue's lines (Wrong, Known, Next) before anyone looked at the
-- cause, and nothing replaced them after Claude proved it, so a card kept the first
-- guess and hid the choice (LAN-339). Now Claude writes the card: a title, what the
-- issue is about, what happened as numbered events, what is known, and the choice
-- with what each option leads to. The watch writes it when it files an issue, the
-- issue manager writes it again after its work, and a run of the job `cards` writes
-- it for open issues that have none. The dashboard shows it in place of the lines.
--
-- 1. ops.user_issue_cards keeps one card for each issue: the newest.
-- 2. ops_user_issue_cards_done() takes the cards of a run, through the Worker's door
--    (/api/user-issues, server/userIssues.ts parseIssueCard checks each first).
-- 3. diag.ops_user_issue_cards() hands them to the dashboard, by issue.

create table if not exists ops.user_issue_cards (
  issue text primary key check (issue ~ '^[A-Z]{1,10}-[0-9]{1,7}$'),
  -- { title, about, events: [{ at, until, about, happened, bug }], known, ask, options: [{ option, then }] }
  card jsonb not null check (jsonb_typeof(card) = 'object' and length(card::text) <= 6000),
  run_url text check (run_url is null or run_url ~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$'),
  at timestamptz not null default now()
);
alter table ops.user_issue_cards enable row level security;

create or replace function public.ops_user_issue_cards_done(p jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  c jsonb;
  v_kept int := 0;
begin
  if coalesce(p->>'runUrl', '') !~ '^https://github\.com/genesis-ai-dev/langquest-next/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$' then
    raise exception 'not a run of this repository' using errcode = '22023';
  end if;
  delete from ops.user_issue_cards where at < now() - interval '365 days';
  for c in select value from jsonb_array_elements(coalesce(p->'cards', '[]'::jsonb)) loop
    insert into ops.user_issue_cards (issue, card, run_url) values (c->>'issue', c->'card', p->>'runUrl')
    on conflict (issue) do update set card = excluded.card, run_url = excluded.run_url, at = now();
    v_kept := v_kept + 1;
  end loop;
  return v_kept;
end $$;
revoke all on function public.ops_user_issue_cards_done from public, anon, authenticated;
grant execute on function public.ops_user_issue_cards_done to service_role;

create or replace function diag.ops_user_issue_cards() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(c.issue, c.card || jsonb_build_object('at', c.at)), '{}'::jsonb) from ops.user_issue_cards c
$$;
revoke all on function diag.ops_user_issue_cards from public;
grant execute on function diag.ops_user_issue_cards to diag_reader;
