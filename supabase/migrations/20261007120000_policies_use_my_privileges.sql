-- The read policies on invites and join requests asked org_privileges,
-- which 20261007000000_no_anonymous_rpcs.sql made service-role only. A
-- policy runs as the caller, so every signed-in read of either table failed
-- with "permission denied for function org_privileges", and admins could no
-- longer see pending requests. They ask my_privileges instead: the caller's
-- own privileges, which signed-in people may already read. org_privileges
-- stays service-role only, since it answers for any profile in any
-- organization (decisions.md 64).

drop policy invites_read on public.invites;
create policy invites_read on public.invites for select to authenticated
  using ('invite_members' = any(public.my_privileges(org_id, scope->>'languageId')));

drop policy join_requests_read on public.join_requests;
create policy join_requests_read on public.join_requests for select to authenticated
  using (profile_id = public.caller_id() or 'invite_members' = any(public.my_privileges(org_id, null)));
