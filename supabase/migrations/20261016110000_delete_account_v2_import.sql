-- Deleting an account also forgets what the v2 import kept about it
-- (decisions.md 46; docs/v2-import.md).
--
-- _delete_account removed everything the privacy policy lists, but the v2
-- import's own tables, added later, kept what Welcome back listed of the
-- person's v2 work (v2_import.arrivals), their email on a confirmed link from
-- a v2 person to this account (v2_import.people_links), which the import
-- also kept following, naming the deleted account in memberships, and
-- their email in the sign-in limiter for up to an hour.
--
-- _delete_account is restated whole, as `create or replace`, from
-- 20261006000000_baseline.sql's. SQL test: server/delete-account-smoke.sql.

create or replace function public._delete_account(p_actor text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  m record;
begin
  if p_actor is null or p_actor = '' then raise exception 'no account' using errcode = '22023'; end if;
  select u.email into v_email from auth.users u where u.id::text = p_actor;

  for m in select om.org_id, om.scope_key, om.scope_level, om.language_id
             from public.org_memberships om
            where om.profile_id = p_actor and not om.removed loop
    perform public._append_event_as('accountdeleted:' || p_actor || ':' || m.scope_key,
      m.org_id, '_org', 'v1.MemberRemoved', 'service', 'server',
      jsonb_build_object('profileId', p_actor, 'scope', jsonb_strip_nulls(jsonb_build_object(
        'level', m.scope_level, 'languageId', m.language_id))));
  end loop;

  delete from public.push_receipts r using public.push_tokens t
    where r.token = t.token and t.profile_id = p_actor;
  delete from public.push_tokens where profile_id = p_actor;
  delete from public.notifications where profile_id = p_actor;
  delete from public.join_requests where profile_id = p_actor;
  delete from public.profiles where id = p_actor;
  if v_email is not null then
    update public.invites set email = null where lower(email) = lower(v_email);
  end if;
  delete from diag.records where delivered_by = p_actor;
  delete from diag.installs where profile_id = p_actor;
  update storage.objects set owner = null, owner_id = null where owner_id = p_actor;
  delete from public.user_blocks where blocker_id = p_actor or blocked_id = p_actor;
  update public.content_reports set reporter_id = null where reporter_id = p_actor;
  -- What the v2 import knows of this account: what Welcome back listed, and a link from a v2 person to it, turned off so the import
  -- names the v2 person again rather than an account that is gone.
  delete from v2_import.arrivals where profile_id = p_actor;
  update v2_import.people_links set active = false, email = null, confirmed_at = now() where next_id = p_actor;
  if v_email is not null then delete from v2_import.sign_in_failures where email = lower(v_email); end if;

  delete from auth.users where id::text = p_actor;
end $$;
