-- Account deletion (decisions.md 46 and 47). The person asks from the app,
-- or by email and staff run delete_account_for_email; either way this
-- removes who they are and leaves the organization's work.
--
-- Removed: the sign-in (auth.users, with its sessions and identities), the
-- profile name, push tokens and receipts, inbox rows, join requests and
-- their messages, the email on invites sent to them, field diagnostics
-- delivered from their account, and the uploader mark on stored audio.
-- Their memberships end through the same events an administrator would
-- append, so every phone's fold drops them.
--
-- Erased: the one place the log held a name, displayName on the
-- OrgMemberAdded that made an organization's creator a member. It is the
-- one change the log allows (decision 47): the field is removed in place,
-- the event is also redacted so phones that already hold it stop showing
-- it, and that organization's snapshots, which may hold the name folded in,
-- are dropped (they are rebuilt from the log).
--
-- Kept: the events they authored, and the audio those name. Recordings are
-- the organization's work under its license (decision 38), and without the
-- account the actor id on them is a random id that no longer leads to a
-- person.

-- The log stays append-only, except for erasing a deleted person's name.
-- The erasure sets langquest.erase_profile to that person's id for its own
-- transaction; any other update or any delete is still refused.
create or replace function public.events_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and old.type = 'v1.OrgMemberAdded'
     and old.payload ? 'displayName'
     and coalesce(current_setting('langquest.erase_profile', true), '') <> ''
     and old.payload->>'profileId' = current_setting('langquest.erase_profile', true)
     and new.payload = old.payload - 'displayName'
     and to_jsonb(new) - 'payload' = to_jsonb(old) - 'payload' then
    return new;
  end if;
  raise exception 'events are append-only (%)', tg_op using errcode = '42501';
end $$;

create or replace function public._delete_account(p_actor text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_hlc text;
  v_payload jsonb;
  m record;
begin
  if p_actor is null or p_actor = '' then raise exception 'no account' using errcode = '22023'; end if;
  select u.email into v_email from auth.users u where u.id::text = p_actor;

  -- Organization memberships, at every scope still held.
  for m in select om.org_id, om.scope_key, om.scope_level, om.partition_id, om.lane_id
             from public.org_memberships om
            where om.profile_id = p_actor and not om.removed loop
    v_payload := jsonb_build_object('profileId', p_actor, 'scope', jsonb_strip_nulls(jsonb_build_object(
      'level', m.scope_level, 'partitionId', m.partition_id, 'laneId', m.lane_id)));
    v_hlc := public._append_event_as('accountdeleted:' || p_actor || ':' || m.scope_key,
      m.org_id, '_org', 'v1.OrgMemberRemoved', 'service', 'server', v_payload);
    if v_hlc is not null then
      perform public._apply_org_event(m.org_id, 'v1.OrgMemberRemoved', v_payload, v_hlc);
    end if;
  end loop;

  -- Language (partition) memberships.
  for m in select pm.org_id, pm.partition_id from public.memberships pm
            where pm.profile_id = p_actor and not pm.removed loop
    v_payload := jsonb_build_object('profileId', p_actor);
    v_hlc := public._append_event_as('accountdeleted:' || p_actor || ':' || m.org_id || '/' || m.partition_id,
      m.org_id, m.partition_id, 'v1.MemberRemoved', 'service', 'server', v_payload);
    if v_hlc is not null then
      perform public._apply_member_event(m.org_id, m.partition_id, 'v1.MemberRemoved', v_payload, v_hlc);
    end if;
  end loop;

  -- The name an organization's creator was added with: redact the event
  -- (phones that hold it stop showing it), drop that partition's snapshots,
  -- then erase the field itself.
  for m in select e.id, e.org_id, e.partition_id from public.events e
            where e.type = 'v1.OrgMemberAdded' and e.payload->>'profileId' = p_actor
              and e.payload ? 'displayName' loop
    perform public._append_event_as('accountdeleted:' || p_actor || ':redact:' || m.id,
      m.org_id, m.partition_id, 'v1.Redacted', 'service', 'server',
      jsonb_build_object('eventId', m.id, 'reason', 'account deleted'));
    delete from public.snapshots s where s.org_id = m.org_id and s.partition_id = m.partition_id;
  end loop;
  perform set_config('langquest.erase_profile', p_actor, true);
  update public.events set payload = payload - 'displayName'
    where type = 'v1.OrgMemberAdded' and payload->>'profileId' = p_actor and payload ? 'displayName';
  perform set_config('langquest.erase_profile', '', true);

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

  delete from auth.users where id::text = p_actor;
end $$;
revoke all on function public._delete_account(text) from public, anon, authenticated;

-- From the app: the signed-in person deletes themselves.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  perform public._delete_account(v_actor);
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- For staff, answering an emailed request (langquest.org/en/next/delete-account):
-- in the Supabase SQL editor, select public.delete_account_for_email('them@example.org');
-- Returns false when no account has that email. Never callable from the app.
create or replace function public.delete_account_for_email(p_email text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  select u.id::text into v_id from auth.users u where lower(u.email) = lower(trim(p_email));
  if v_id is null then return false; end if;
  perform public._delete_account(v_id);
  return true;
end $$;
revoke all on function public.delete_account_for_email(text) from public, anon, authenticated;
grant execute on function public.delete_account_for_email(text) to service_role;
notify pgrst, 'reload schema';
