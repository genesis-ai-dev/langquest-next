-- A helper's code that names who it is for (docs/nearby-sync-plan.md 14.1,
-- 6 "After"; decision 241). A local person whose key no longer signs in
-- (`needsCode`) gets their session from a helper's code, and their phone
-- takes only a session for their own id (server/auth.ts setSession). Taken
-- first and refused on the phone, a code made for someone else would be spent
-- for nothing, and that person's key sign-in closed with it. So the phone
-- names its id, and a live code made for anyone else is refused before
-- anything is written.
--
-- Old builds' calls keep their results (decisions.md 151, 152): sign-in-code
-- calls this only when the phone sent an id, and take_sign_in_code_v2 stays as
-- it is. Only the service role calls it, as with every take_sign_in_code.
create or replace function public.take_sign_in_code_for(p_code_hash text, p_profile_id uuid)
returns table (profile_id uuid, email text, lost boolean, helper_name text)
language plpgsql security definer set search_path = public as $$
begin
  if public.caller_id() is not null then raise exception 'service role only' using errcode = '42501'; end if;
  if p_profile_id is null then raise exception 'name who the code is for' using errcode = '22023'; end if;
  -- A code's person never changes, so a code that passes here is taken below only for this person.
  if exists (select 1 from public.sign_in_codes c
             where c.code_hash = p_code_hash and c.used_at is null and c.expires_at > now() and c.profile_id <> p_profile_id) then
    raise exception 'this code was made for someone else' using errcode = '28000';
  end if;
  return query select t.profile_id, t.email, t.lost, t.helper_name from public.take_sign_in_code_v2(p_code_hash) t;
end $$;

revoke all on function public.take_sign_in_code_for(text, uuid) from public, anon, authenticated;
grant execute on function public.take_sign_in_code_for(text, uuid) to service_role;
