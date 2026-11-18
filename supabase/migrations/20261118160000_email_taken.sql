-- Edit Profile's email (LAN-304, functions/change-email,
-- docs/decisions/2026-11-18-edit-profile-holds-email-and-password.md): does
-- another account already have this address, in any case? Auth's own update
-- answers a taken address with only "Error updating user", and its unique
-- index tells capitals apart, so the function asks here before it changes
-- anything. The service role alone may ask: for anyone else it would say who
-- uses LangQuest.
create or replace function public.email_taken(p_email text, p_self uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
     where lower(u.email) = lower(btrim(p_email)) and u.id <> p_self
  );
$$;
revoke all on function public.email_taken(text, uuid) from public, anon, authenticated;
grant execute on function public.email_taken(text, uuid) to service_role;
