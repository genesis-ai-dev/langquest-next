-- suspend_account (20260930220000) set banned_until to 'infinity', which the
-- auth server cannot read: a suspended person saw "Database error querying
-- schema" instead of "User is banned". A date a century out reads as a ban
-- and lasts as long (decisions.md 48).
create or replace function public.suspend_account(p_profile text, p_suspended boolean default true)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update auth.users set banned_until = case when p_suspended then now() + interval '100 years' end
   where id::text = p_profile;
  return found;
end $$;
revoke all on function public.suspend_account(text, boolean) from public, anon, authenticated;
grant execute on function public.suspend_account(text, boolean) to service_role;
