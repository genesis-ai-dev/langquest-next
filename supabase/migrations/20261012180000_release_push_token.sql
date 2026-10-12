-- Someone who signs out of a phone offline leaves their sign-in locked on it
-- (decisions.md 88), so the phone cannot ask, as them, to stop their
-- notifications. Holding the device's push token and the person's id is
-- enough to detach that one device: it only stops notifications reaching it,
-- and never touches the same token registered to someone else since.
create or replace function public.release_push_token(p_token text, p_profile text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_tokens where token = p_token and profile_id = p_profile;
$$;

revoke all on function public.release_push_token(text, text) from public;
grant execute on function public.release_push_token(text, text) to anon, authenticated, service_role;
