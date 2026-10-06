-- Reporting and blocking (decisions.md 48). Google Play's user-generated
-- content policy asks for a way to report objectionable content and people
-- from inside the app, someone who acts on reports, and a way to block.
--
-- Neither a report nor a block is an event. Every member's phone pulls a
-- partition's log, so a report there would tell the reported person who
-- reported them, and a block is one person's private choice. Both are rows
-- here, sent from the phone's account outbox like a profile name.
--
-- Acting on a report uses what the log already has: removing something from
-- the record appends v1.Redacted for the events that hold it, and removing a
-- person is the ordinary v1.OrgMemberRemoved from the Members screen.

-- ---------------------------------------------------------------------------
-- What someone reported. A moderation queue, not app state: staff read it
-- with the service role (npm run moderation) and an organization's
-- moderators through org_content_reports, which never returns who reported.
-- ---------------------------------------------------------------------------
create table public.content_reports (
  -- Made on the phone, so a retried send is the same report.
  id text primary key check (length(id) between 1 and 100),
  org_id text not null,
  -- '_org' for a person, otherwise the language partition holding the content.
  partition_id text not null,
  target_kind text not null check (target_kind in ('version', 'review', 'note', 'request', 'person')),
  -- takeId, reviewId, noteId, requestId or profileId.
  target_id text not null check (length(target_id) between 1 and 300),
  -- Where to open it; never used to authorize.
  unit_id text check (length(unit_id) <= 300),
  lane_id text check (length(lane_id) <= 300),
  -- Who made it, checked against the log's actor ids.
  reported_profile text not null,
  -- Null once the reporter's account is deleted.
  reporter_id text,
  reason text not null check (reason in ('offensive', 'sexual', 'harassment', 'violence', 'spam', 'other')),
  details text check (length(details) <= 1000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  resolution text check (resolution in ('removed', 'dismissed')),
  check ((resolved_at is null) = (resolution is null))
);
create index content_reports_open on public.content_reports (org_id, created_at) where resolved_at is null;
create index content_reports_reporter on public.content_reports (reporter_id, created_at);
alter table public.content_reports enable row level security;
-- No policy and no grant: nobody reads the table directly but the service role.
revoke all on public.content_reports from public, anon, authenticated;
grant all on public.content_reports to service_role;

-- The events that hold one piece of content, with whether each is already
-- redacted. A version is its take, its submission, what changed and the
-- answer it gave; a v1 review is read by the id passage.ts gives it.
create or replace function public._content_events(p_org text, p_partition text, p_kind text, p_target text)
returns table(event_id text, actor_id text, redacted boolean)
language sql stable security definer set search_path = public as $$
  select e.id, e.actor_id, exists (
    select 1 from public.events r
     where r.org_id = e.org_id and r.partition_id = e.partition_id
       and r.type = 'v1.Redacted' and r.payload->>'eventId' = e.id)
  from public.events e
  where e.org_id = p_org and e.partition_id = p_partition and (
    (p_kind = 'note' and e.type = 'v1.NoteAdded' and e.payload->>'noteId' = p_target)
    or (p_kind = 'request' and e.type = 'v1.RequestMade' and e.payload->>'requestId' = p_target)
    or (p_kind = 'review' and e.type = 'v1.ReviewRecorded' and e.payload->>'reviewId' = p_target)
    or (p_kind = 'review' and p_target like 'v1:%'
        and e.type in ('v1.ReviewSubmitted', 'v1.ReviewCommentRecorded')
        and 'v1:' || (e.payload->>'takeId') || ':' || (e.payload->>'stepId') || ':' || e.actor_id = p_target)
    or (p_kind = 'version' and e.type in ('v1.TakeComposed', 'v1.TakeSubmitted', 'v1.ResponseRecorded')
        and e.payload->>'takeId' = p_target)
    or (p_kind = 'version' and e.type = 'v1.NoteAdded'
        and e.payload->'anchor'->>'kind' = 'version' and e.payload->'anchor'->>'role' = 'change'
        and e.payload->'anchor'->>'takeId' = p_target));
$$;
revoke all on function public._content_events(text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Report something, from the phone's account outbox. Only what the caller
-- may read can be reported, and only by its maker's id.
-- ---------------------------------------------------------------------------
create or replace function public.report_content(
  p_id text, p_org text, p_partition text, p_kind text, p_target text, p_profile text,
  p_reason text, p_details text default null, p_unit text default null, p_lane text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if p_id is null or length(p_id) not between 1 and 100 then
    raise exception 'invalid report id' using errcode = '22023';
  end if;
  if exists (select 1 from public.content_reports r where r.id = p_id) then
    if exists (select 1 from public.content_reports r where r.id = p_id and r.reporter_id = v_actor) then return; end if;
    raise exception 'report id already used' using errcode = '22023';
  end if;
  if p_org is null or p_partition is null
     or p_kind is null or p_kind not in ('version', 'review', 'note', 'request', 'person')
     or p_reason is null or p_reason not in ('offensive', 'sexual', 'harassment', 'violence', 'spam', 'other')
     or p_target is null or length(p_target) not between 1 and 300
     or p_profile is null or length(p_profile) > 100
     or length(p_details) > 1000 or length(p_unit) > 300 or length(p_lane) > 300 then
    raise exception 'invalid report' using errcode = '22023';
  end if;
  if (p_kind = 'person') <> (p_partition = '_org') then
    raise exception 'invalid report' using errcode = '22023';
  end if;
  if not exists (select 1 from public.org_memberships m
                  where m.org_id = p_org and m.profile_id = v_actor and not m.removed)
     or (p_partition <> '_org' and public.member_role(p_org, p_partition, v_actor) is null) then
    raise exception 'Only members can report what is in an organization.' using errcode = '42501';
  end if;
  if p_profile = v_actor then
    raise exception 'You cannot report yourself.' using errcode = '22023';
  end if;
  if p_kind = 'person' then
    if p_target <> p_profile or not exists (select 1 from public.org_memberships m
                                             where m.org_id = p_org and m.profile_id = p_profile) then
      raise exception 'That person is not in this organization.' using errcode = '22023';
    end if;
  else
    if not exists (select 1 from public._content_events(p_org, p_partition, p_kind, p_target) c
                    where c.actor_id = p_profile) then
      raise exception 'That is not on the record.' using errcode = '22023';
    end if;
    -- Already taken out of the record: nothing left to act on.
    if not exists (select 1 from public._content_events(p_org, p_partition, p_kind, p_target) c
                    where not c.redacted) then return; end if;
  end if;
  if (select count(*) from public.content_reports r
       where r.reporter_id = v_actor and r.created_at > now() - interval '1 day') >= 50 then
    raise exception 'That is a lot of reports for one day. Email admin@frontierrnd.com instead.' using errcode = '22023';
  end if;
  insert into public.content_reports (id, org_id, partition_id, target_kind, target_id, unit_id, lane_id,
    reported_profile, reporter_id, reason, details)
  values (p_id, p_org, p_partition, p_kind, p_target, p_unit, p_lane,
    p_profile, v_actor, p_reason, nullif(trim(p_details), ''));
end $$;
revoke all on function public.report_content(text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.report_content(text, text, text, text, text, text, text, text, text, text) to authenticated;

-- May this person act on reports about this partition? Content needs what
-- v1.Redacted needs (manage_structure, core EVENT_PRIVILEGE); a person needs
-- what removing a member needs (invite_members), organization-wide.
create or replace function public._may_moderate(p_org text, p_partition text, p_kind text, p_profile text)
returns boolean language sql stable security definer set search_path = public as $$
  select case when p_kind = 'person'
    then 'invite_members' = any(public.org_privileges(p_org, p_profile, null, null))
    else 'manage_structure' = any(public.org_privileges(p_org, p_profile, p_partition, null)) end;
$$;
revoke all on function public._may_moderate(text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- An organization's open reports, for those who may act on them. Never who
-- reported, and never reports about the caller (staff see those).
-- ---------------------------------------------------------------------------
create or replace function public.org_content_reports(p_org text)
returns table(id text, partition_id text, target_kind text, target_id text, unit_id text, lane_id text,
  reported_profile text, reason text, details text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.partition_id, r.target_kind, r.target_id, r.unit_id, r.lane_id,
         r.reported_profile, r.reason, r.details, r.created_at
    from public.content_reports r
   where r.org_id = p_org and r.resolved_at is null
     and public.caller_id() is not null
     and r.reported_profile <> public.caller_id()
     and public._may_moderate(r.org_id, r.partition_id, r.target_kind, public.caller_id())
   order by r.created_at
   limit 200;
$$;
revoke all on function public.org_content_reports(text) from public, anon;
grant execute on function public.org_content_reports(text) to authenticated;

-- Take content out of the record: v1.Redacted for every event that holds it,
-- as the person who decided, so every phone's fold drops it. Closes the open
-- reports about it. Returns how many events were redacted.
create or replace function public._remove_content(
  p_org text, p_partition text, p_kind text, p_target text, p_actor text, p_reason text
) returns int language plpgsql security definer set search_path = public as $$
declare
  v_count int := 0;
  c record;
begin
  if p_kind is null or p_kind not in ('version', 'review', 'note', 'request') then
    raise exception 'Only something on the record can be removed.' using errcode = '22023';
  end if;
  for c in select * from public._content_events(p_org, p_partition, p_kind, p_target) where not redacted loop
    if public._append_event_as('removed:' || c.event_id, p_org, p_partition, 'v1.Redacted', p_actor, 'server',
         jsonb_build_object('eventId', c.event_id, 'reason', left(coalesce(nullif(trim(p_reason), ''), 'reported'), 200)))
       is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  update public.content_reports r set resolved_at = now(), resolved_by = p_actor, resolution = 'removed'
   where r.org_id = p_org and r.partition_id = p_partition and r.target_kind = p_kind
     and r.target_id = p_target and r.resolved_at is null;
  return v_count;
end $$;
revoke all on function public._remove_content(text, text, text, text, text, text) from public, anon, authenticated;

-- From the app: a moderator removes something, reported or not.
create or replace function public.remove_content(
  p_org text, p_partition text, p_kind text, p_target text, p_reason text default null
) returns int language plpgsql security definer set search_path = public as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if not public._may_moderate(p_org, p_partition, p_kind, v_actor) then
    raise exception 'Only someone who manages this language can remove things from its record.' using errcode = '42501';
  end if;
  return public._remove_content(p_org, p_partition, p_kind, p_target, v_actor, p_reason);
end $$;
revoke all on function public.remove_content(text, text, text, text, text) from public, anon;
grant execute on function public.remove_content(text, text, text, text, text) to authenticated;

-- From the app: a moderator looked and leaves it. Closes every open report
-- about that one thing or person.
create or replace function public.dismiss_reports(p_org text, p_partition text, p_kind text, p_target text)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if not public._may_moderate(p_org, p_partition, p_kind, v_actor) then
    raise exception 'Only someone who manages this language can answer its reports.' using errcode = '42501';
  end if;
  update public.content_reports r set resolved_at = now(), resolved_by = v_actor, resolution = 'dismissed'
   where r.org_id = p_org and r.partition_id = p_partition and r.target_kind = p_kind
     and r.target_id = p_target and r.resolved_at is null and r.reported_profile <> v_actor;
end $$;
revoke all on function public.dismiss_reports(text, text, text, text) from public, anon;
grant execute on function public.dismiss_reports(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- For staff (npm run moderation, or the Supabase SQL editor). Service role
-- only; the actor on a redaction is 'service'.
-- ---------------------------------------------------------------------------
create or replace function public.staff_resolve_report(p_report text, p_action text)
returns int language plpgsql security definer set search_path = public as $$
declare r public.content_reports;
begin
  select * into r from public.content_reports where id = p_report;
  if not found then raise exception 'no report %', p_report using errcode = '22023'; end if;
  if p_action = 'remove' then
    return public._remove_content(r.org_id, r.partition_id, r.target_kind, r.target_id, 'service', 'removed by LangQuest staff');
  elsif p_action = 'dismiss' then
    update public.content_reports c set resolved_at = now(), resolved_by = 'service', resolution = 'dismissed'
     where c.org_id = r.org_id and c.partition_id = r.partition_id and c.target_kind = r.target_kind
       and c.target_id = r.target_id and c.resolved_at is null;
    return 0;
  end if;
  raise exception 'action is remove or dismiss' using errcode = '22023';
end $$;
revoke all on function public.staff_resolve_report(text, text) from public, anon, authenticated;
grant execute on function public.staff_resolve_report(text, text) to service_role;

-- Stop an account signing in, or let it back. Sessions it already has end
-- when their access token expires (at most an hour). Returns false when no
-- account has that id.
create or replace function public.suspend_account(p_profile text, p_suspended boolean default true)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update auth.users set banned_until = case when p_suspended then 'infinity'::timestamptz end
   where id::text = p_profile;
  return found;
end $$;
revoke all on function public.suspend_account(text, boolean) from public, anon, authenticated;
grant execute on function public.suspend_account(text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Blocks: one person's private list. The phone hides what a blocked person
-- adds; nothing about the block reaches them or anyone else. Kept here so it
-- follows the account to a new phone.
-- ---------------------------------------------------------------------------
create table public.user_blocks (
  blocker_id text not null,
  blocked_id text not null check (length(blocked_id) between 1 and 100),
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.user_blocks enable row level security;
create policy user_blocks_read on public.user_blocks for select to authenticated
  using (blocker_id = (select public.caller_id()));
revoke all on public.user_blocks from public, anon, authenticated;
grant select on public.user_blocks to authenticated;
grant all on public.user_blocks to service_role;

create or replace function public.set_blocked(p_profile text, p_blocked boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if p_profile is null or length(p_profile) not between 1 and 100 or p_blocked is null then
    raise exception 'invalid block' using errcode = '22023';
  end if;
  if p_profile = v_actor then raise exception 'You cannot block yourself.' using errcode = '22023'; end if;
  if p_blocked then
    if (select count(*) from public.user_blocks where blocker_id = v_actor) >= 1000 then
      raise exception 'You have blocked as many people as one account can.' using errcode = '22023';
    end if;
    insert into public.user_blocks (blocker_id, blocked_id) values (v_actor, p_profile)
      on conflict do nothing;
  else
    delete from public.user_blocks where blocker_id = v_actor and blocked_id = p_profile;
  end if;
end $$;
revoke all on function public.set_blocked(text, boolean) from public, anon;
grant execute on function public.set_blocked(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Account deletion (decision 46) also forgets the person's blocks, blocks of
-- them, and that they reported anything. Unchanged otherwise.
-- ---------------------------------------------------------------------------
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
  delete from public.user_blocks where blocker_id = p_actor or blocked_id = p_actor;
  update public.content_reports set reporter_id = null where reporter_id = p_actor;

  delete from auth.users where id::text = p_actor;
end $$;
revoke all on function public._delete_account(text) from public, anon, authenticated;
notify pgrst, 'reload schema';
