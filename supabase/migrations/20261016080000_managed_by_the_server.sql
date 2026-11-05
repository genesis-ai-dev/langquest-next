-- A looked-after account is one `join` made, not any address in its domain
-- (decisions.md 54, amended 2026-10-15).
--
-- is_managed_account asked only whether the email ended in
-- @people.langquest.org, and sign-up is open, so anyone could make a
-- password account in that domain and be treated as looked-after: helpers
-- with the person's privileges may issue it sign-in codes, and it takes a
-- sign-in name `join` would give someone else. Now an account is
-- looked-after when it is in the domain and its app_metadata (which only
-- the service role writes) says `managed`, as `join` now sets. Accounts in
-- the domain today were all made by `join`, so they are marked here.
-- take_sign_in_code keeps its email check: a looked-after person who has
-- since set their own email is no longer one.

update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"managed": true}'::jsonb
 where public.is_managed_email(email::text);

create or replace function public.is_managed_account(p_profile text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select public.is_managed_email(u.email::text) and u.raw_app_meta_data->>'managed' = 'true'
                     from auth.users u where u.id::text = p_profile), false);
$$;
