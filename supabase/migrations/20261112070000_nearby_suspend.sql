-- Suspending an account stops its nearby keys too (docs/nearby-sync-plan.md
-- 5.5 and section 6). suspend_account set only auth.users.banned_until, which
-- Auth enforces at sign-in and the relay reads per author, so a suspended
-- person's phone kept its certificate and its join pass on teammates' phones,
-- and the language kept its discovery key. Suspending now also revokes the
-- person's install keys through _revoke_install_keys, as a lost phone does:
-- the keys go on every organization's revocation list, which teammates take
-- from the next phone back from town; the next certificate call for any of
-- the organization's languages makes a new discovery generation; and their
-- sessions end. pass_refusal (20261112050000) refuses a suspended inviter's
-- pass.
--
-- Restated from 20261006000000_baseline.sql with the same signature and
-- answers (decisions.md 151, 152): true when the account was found. Letting
-- someone back revokes nothing and gives no key back; their phone asks for a
-- new certificate under a new key, as after a lost phone.
create or replace function public.suspend_account(p_profile text, p_suspended boolean default true)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  update auth.users set banned_until = case when p_suspended then now() + interval '100 years' end
   where id::text = p_profile
  returning id into v_id;
  if not found then return false; end if;
  if p_suspended then perform public._revoke_install_keys(v_id, 'suspended'); end if;
  return true;
end $$;

-- Restated with create or replace, which keeps grants; said again so this file holds them.
revoke all on function public.suspend_account(text, boolean) from public, anon, authenticated;
grant execute on function public.suspend_account(text, boolean) to service_role;
