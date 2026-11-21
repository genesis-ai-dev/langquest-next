-- An admin's instruction on a Linear issue that a line of the ops dashboard names itself
-- (docs/decisions/2026-11-18-an-admin-tells-claude-what-to-do-with-a-user-issue.md, amended 2026-11-21).
--
-- A nightly test's line names its own Linear issue (scripts/nightly-report.mjs and
-- scripts/phone-tests.mjs file them, not the watch for user issues), so ops.user_issues has no row
-- for it. Its card on the dashboard showed the box "Tell Claude what to do", and
-- ops_user_issue_instruct() refused every instruction: "The watch has no open issue with that id."
-- (LAN-278, 2026-11-21). Now the app Worker asks the dashboard's Worker which issues its lines
-- name now (apps/admin/src/lines.ts `named`), and says so with p_named. Such a note is kept with
-- `named`, and the watch hands it to Claude like any other.
--
-- Each function is a whole copy of its last definition (20261119234319_agent_research.sql) with
-- these changes.

alter table ops.user_issue_notes add column if not exists named boolean not null default false;
comment on column ops.user_issue_notes.named is
  'A line of the ops dashboard named this issue when the admin wrote the note (a nightly test''s issue): the watch takes it without a row in ops.user_issues.';

-- From the dashboard: the note's id; 'not_found' when neither the watch, the research nor a line
-- of the dashboard (p_named, checked by the app Worker) has an open issue with that id;
-- 'full' when three notes on that issue wait already.
drop function if exists public.ops_user_issue_instruct(text, text, uuid);
create or replace function public.ops_user_issue_instruct(p_issue text, p_text text, p_by uuid, p_named boolean default false) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not coalesce(p_named, false)
     and not exists (select 1 from ops.user_issues u where u.issue = p_issue and u.verdict in ('filed', 'known') and u.closed_at is null)
     and not exists (select 1 from ops.research_items r where r.issue = p_issue and r.decision = 'recommend') then
    return 'not_found';
  end if;
  if (select count(*) from ops.user_issue_notes n
      where n.issue = p_issue and n.answered_at is null and n.tries < ops._user_issue_note_tries()) >= 3 then
    return 'full';
  end if;
  insert into ops.user_issue_notes (issue, text, by, named) values (p_issue, btrim(p_text), p_by, coalesce(p_named, false)) returning id into v_id;
  return v_id::text;
end $$;
revoke all on function public.ops_user_issue_instruct from public, anon, authenticated;
grant execute on function public.ops_user_issue_instruct to service_role;

create or replace function public.ops_user_issue_notes_waiting() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('issue', w.issue, 'ids', w.ids) order by w.first_at), '[]'::jsonb)
  from (
    select n.issue, min(n.at) as first_at, jsonb_agg(n.id order by n.at) as ids
    from ops.user_issue_notes n
    where n.answered_at is null and n.tries < ops._user_issue_note_tries()
      and (n.named
        or exists (select 1 from ops.user_issues u where u.issue = n.issue and u.verdict in ('filed', 'known') and u.closed_at is null)
        or exists (select 1 from ops.research_items r where r.issue = n.issue and r.decision = 'recommend'))
    group by n.issue
    order by min(n.at)
    limit 20
  ) w
$$;
revoke all on function public.ops_user_issue_notes_waiting from public, anon, authenticated;
grant execute on function public.ops_user_issue_notes_waiting to service_role;
