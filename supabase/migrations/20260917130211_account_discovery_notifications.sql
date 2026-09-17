-- Account data does not require project membership. Every mutation derives
-- its owner from the JWT; no caller supplies another profile's identity.
create table public.profiles (
  id text primary key,
  display_name text not null check (length(display_name) between 1 and 100),
  avatar_blob text,
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create or replace function public.profile_visible(p_profile text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.caller_id() is not null and (
    p_profile = public.caller_id() or exists (
      select 1 from public.org_memberships me
      join public.org_memberships other on other.org_id = me.org_id
      where me.profile_id = public.caller_id() and not me.removed
        and other.profile_id = p_profile and not other.removed
    )
  );
$$;
revoke all on function public.profile_visible(text) from public, anon;
grant execute on function public.profile_visible(text) to authenticated;
create policy profiles_read on public.profiles for select to authenticated
  using (public.profile_visible(id));
grant select on public.profiles to authenticated;

create or replace function public.save_profile(p_display_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if length(trim(p_display_name)) not between 1 and 100 or p_display_name is null then
    raise exception 'Use a name between 1 and 100 characters.' using errcode = '22023';
  end if;
  insert into public.profiles(id, display_name) values(v_actor, trim(p_display_name))
  on conflict(id) do update set display_name = excluded.display_name, updated_at = now();
end $$;
revoke all on function public.save_profile(text) from public, anon;
grant execute on function public.save_profile(text) to authenticated;

-- Small, append-only private partition. Generic project pulls cannot read it.
create or replace function public.record_user_event(p_id text, p_type text, p_payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.caller_id();
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if p_id is null or length(p_id) > 256 or p_id not like v_actor || ':%' then
    raise exception 'invalid event id' using errcode = '22023';
  end if;
  if p_type not in ('v1.TermsAccepted','v1.VisionSeen','v1.WalkthroughDone')
    or p_type is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'invalid user event' using errcode = '22023';
  end if;
  if p_type = 'v1.TermsAccepted' and (
    not public._is_str(p_payload->'version') or length(p_payload->>'version') > 100
  ) then raise exception 'terms version required' using errcode = '22023'; end if;
  perform public._append_event_as(p_id, '_user', v_actor, p_type,
    v_actor, 'server', p_payload);
end $$;
create or replace function public.get_user_state()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'termsVersion', (select payload->>'version' from public.events
      where org_id = '_user' and project_id = public.caller_id()
        and type = 'v1.TermsAccepted' order by server_seq desc limit 1),
    'visionSeen', exists(select 1 from public.events where org_id = '_user'
      and project_id = public.caller_id() and type = 'v1.VisionSeen'),
    'walkthroughDone', exists(select 1 from public.events where org_id = '_user'
      and project_id = public.caller_id() and type = 'v1.WalkthroughDone'));
$$;
revoke all on function public.record_user_event(text,text,jsonb), public.get_user_state() from public, anon;
grant execute on function public.record_user_event(text,text,jsonb), public.get_user_state() to authenticated;

-- Navigation exposes only organizations the caller belongs to.
create or replace function public.my_organizations()
returns table(org_id text, project_id text, name text)
language sql stable security definer set search_path = '' as $$
  select distinct m.org_id, p.payload->>'projectId',
    coalesce((select e.payload->>'name' from public.events e
      where e.org_id=m.org_id and e.project_id='_org' and e.type='v1.OrgCreated'
      order by e.hlc desc limit 1), m.org_id)
  from public.org_memberships m
  left join public.events p on p.org_id=m.org_id and p.project_id='_org'
    and p.type='v1.ProjectRegistered'
    and (m.scope_level='org' or m.project_id=p.payload->>'projectId')
  where m.profile_id=public.caller_id() and not m.removed;
$$;
revoke all on function public.my_organizations() from public, anon;
grant execute on function public.my_organizations() to authenticated;

-- Public means explicitly listed. No raw event, membership or recording
-- becomes public. The worker writes only these safe aggregate columns.
create table public.project_visibility (
  org_id text not null, project_id text not null,
  listed boolean not null default false,
  primary key(org_id, project_id)
);
alter table public.project_visibility enable row level security;
create table public.public_projects (
  org_id text not null, project_id text not null, name text not null,
  languages text[] not null default '{}', translated_pct double precision not null default 0,
  updated_at timestamptz not null default now(), primary key(org_id, project_id)
);
alter table public.public_projects enable row level security;
create policy visibility_read on public.project_visibility for select to anon, authenticated using (listed);
grant select on public.project_visibility to anon, authenticated;
create policy public_projects_read on public.public_projects for select to anon, authenticated
  using (exists(select 1 from public.project_visibility v
    where v.org_id=public_projects.org_id and v.project_id=public_projects.project_id and v.listed));
grant select on public.public_projects to anon, authenticated;
create or replace function public.set_project_visibility(p_org text, p_project text, p_listed boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.caller_id() is null or not ('manage_structure'=any(
    public.org_privileges(p_org, public.caller_id(), p_project, null))) then
    raise exception 'Project management permission required.' using errcode='42501';
  end if;
  insert into public.project_visibility values(p_org,p_project,p_listed)
    on conflict(org_id,project_id) do update set listed=excluded.listed;
  if not p_listed then delete from public.public_projects where org_id=p_org and project_id=p_project; end if;
end $$;
revoke all on function public.set_project_visibility(text,text,boolean) from public, anon;
grant execute on function public.set_project_visibility(text,text,boolean) to authenticated;

create table public.notifications (
  id text primary key, seq bigint generated always as identity unique,
  profile_id text not null, org_id text not null, project_id text not null,
  kind text not null, title text not null, task_id text, unit_id text, lane_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(), pushed_at timestamptz
);
create index notifications_inbox on public.notifications(profile_id,seq);
create index notifications_push on public.notifications(seq) where pushed_at is null and active;
alter table public.notifications enable row level security;
create policy notifications_read on public.notifications for select to authenticated
  using(profile_id=(select public.caller_id()));
grant select on public.notifications to authenticated;
create table public.push_tokens (
  token text primary key, profile_id text not null,
  updated_at timestamptz not null default now()
);
create index push_tokens_profile on public.push_tokens(profile_id);
alter table public.push_tokens enable row level security;
create or replace function public.register_push_token(p_token text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.caller_id() is null then raise exception 'sign in required' using errcode='42501'; end if;
  if p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' or length(p_token)>200 then
    raise exception 'invalid push token' using errcode='22023';
  end if;
  insert into public.push_tokens(token,profile_id) values(p_token,public.caller_id())
    on conflict(token) do update set profile_id=excluded.profile_id,updated_at=now();
end $$;
create or replace function public.unregister_push_token(p_token text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_tokens where token=p_token and profile_id=public.caller_id();
$$;
revoke all on function public.register_push_token(text),public.unregister_push_token(text) from public,anon;
grant execute on function public.register_push_token(text),public.unregister_push_token(text) to authenticated;
grant all on public.profiles,public.project_visibility,public.public_projects,public.notifications,public.push_tokens to service_role;
grant usage, select on sequence public.notifications_seq_seq to service_role;
notify pgrst, 'reload schema';

-- A projection pass changes inbox rows atomically. The sequence advances
-- only when a row changes, including becoming inactive, for cursor pulls.
create or replace function public.reconcile_notifications(p_org text,p_project text,p_rows jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications n set active=false,seq=default
    where n.org_id=p_org and n.project_id=p_project and n.active
      and not exists(select 1 from jsonb_array_elements(p_rows) r where r->>'id'=n.id);
  insert into public.notifications(id,profile_id,org_id,project_id,kind,title,task_id,unit_id,lane_id)
    select r->>'id',r->>'profile_id',p_org,p_project,r->>'kind',r->>'title',
      r->>'task_id',r->>'unit_id',r->>'lane_id'
    from jsonb_array_elements(p_rows) r
    on conflict(id) do update set active=true,title=excluded.title,seq=default
      where not notifications.active or notifications.title<>excluded.title;
end $$;
revoke all on function public.reconcile_notifications(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reconcile_notifications(text,text,jsonb) to service_role;
alter table public.notifications add column push_lease_until timestamptz;
create or replace function public.claim_notification_pushes()
returns setof public.notifications language sql security definer set search_path = '' as $$
  update public.notifications n set push_lease_until=now()+interval '5 minutes'
  where id in (select id from public.notifications
    where active and pushed_at is null
      and exists (select 1 from public.push_tokens t
        where t.profile_id=notifications.profile_id)
      and (push_lease_until is null or push_lease_until<now())
    order by seq limit 100 for update skip locked)
  returning n.*;
$$;
revoke all on function public.claim_notification_pushes() from public,anon,authenticated;
grant execute on function public.claim_notification_pushes() to service_role;
create table public.push_receipts (
  ticket_id text primary key, token text not null,
  notification_id text not null references public.notifications(id),
  created_at timestamptz not null default now()
);
alter table public.push_receipts enable row level security;
grant all on public.push_receipts to service_role;

alter table public.invites add column if not exists email text;
alter table public.invites add column if not exists email_sent_at timestamptz;

-- Open work permits translators to assign themselves, never someone else.
create or replace function public.may_emit(p_org text, p_project text, p_profile text, p_type text, p jsonb)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_priv text := public.event_privilege(p_type, p);
  v_role text;
begin
  if v_priv is null then return false; end if;
  if v_priv = 'bootstrap' then return false; end if;
  if p_project <> '_org' then
    select case when m.removed then null else m.role end into v_role
      from public.memberships m
      where m.org_id = p_org and m.project_id = p_project and m.profile_id = p_profile;
    if p_type='v1.AssignmentMade' and p->>'profileId'=p_profile
      and p->>'role'='translator' and (
        'translate'=any(public.fixed_role_privileges(v_role)) or
        'translate'=any(public.org_privileges(p_org,p_profile,p_project,p->>'laneId'))
      ) then return true; end if;
    if v_role is not null and public.role_may_emit_event(v_role, p_type, p) then return true; end if;
  end if;
  return v_priv = any(public.org_privileges(p_org, p_profile, p_project, p->>'laneId'));
end $$;
