-- Whether an access token's session is still live, for the Worker
-- (apps/web/worker/liveSessions.ts, decisions.md 118).
--
-- The Worker verifies access tokens itself (getClaims), and a token stays
-- valid until it expires, an hour, even once its session is gone: after
-- "sign out my other phones" for a lost phone (sign-in-code), or after the
-- account is deleted, the old phone could still read recordings and
-- reports, and mint API tokens, until then. The Worker now asks this too.

create or replace function public.session_is_live(p_session uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.sessions s where s.id = p_session and (s.not_after is null or s.not_after > now()));
$$;
revoke all on function public.session_is_live(uuid) from public, anon, authenticated;
grant execute on function public.session_is_live(uuid) to service_role;
