-- On an issue a developer claimed on the ops dashboard, the agent fix team assists and never merges
-- (docs/decisions/2026-11-24-claim-issues-and-see-claudes-replies.md, amended 2026-11-24).
--
-- Caleb (2026-11-24): "Claude fix team can suggest solutions and make PRs for an issue a developer has
-- claimed, but shouldn't merge on its own. Its role is more of an assistant to the developer in that case."
-- 1. ops_user_issue_notes() answers, for the watch's door (GET ?notes=<issue>), the issue's instructions and
--    draft fix as before; the Worker now also asks ops_issue_claimed(), and the gate
--    (scripts/agent-team.mjs) holds the fix for the developer with the reason 'claimed'.
-- 2. ops.user_issue_fixes takes that reason.

create or replace function public.ops_issue_claimed(p_issue text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ops.issue_claims c where c.issue = p_issue)
$$;
revoke all on function public.ops_issue_claimed from public, anon, authenticated;
grant execute on function public.ops_issue_claimed to service_role;

alter table ops.user_issue_fixes drop constraint if exists user_issue_fixes_reason_check;
alter table ops.user_issue_fixes add constraint user_issue_fixes_reason_check
  check (reason is null or reason in ('mode', 'review', 'decision', 'not_a_bug', 'unconfirmed', 'cause', 'paths', 'checks', 'reviewer', 'instruction', 'app', 'stalled', 'claimed'));
