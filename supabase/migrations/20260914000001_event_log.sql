-- Event log and snapshots. See PLAN.md sections 5, 7, 9 and server/README.md.
--
-- Two tables. `events` is append-only: no UPDATE or DELETE grant exists for
-- any role, and the trigger below refuses both even for the owner. Everything
-- else is a projection and lives elsewhere.

create table public.events (
  id text primary key,
  org_id text not null,
  project_id text not null,
  server_seq bigint not null,
  type text not null,
  actor_id text not null,
  device_id text not null,
  hlc text not null,
  parent_event_id text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  unique (org_id, project_id, server_seq)
);

-- Index plan from PLAN.md section 5.
create index events_pull_idx on public.events (org_id, project_id, server_seq);
create index events_parent_idx on public.events (org_id, project_id, parent_event_id)
  where parent_event_id is not null;
create index events_type_idx on public.events (org_id, project_id, type);

create table public.snapshots (
  org_id text not null,
  project_id text not null,
  reducer_version int not null,
  server_seq bigint not null,
  state jsonb not null,
  created_at timestamptz not null default now(),
  primary key (org_id, project_id, reducer_version, server_seq)
);

-- Per-project sequence counter. One row per partition; the append RPC locks
-- it, which serializes writes per project (and only per project).
create table public.partition_cursors (
  org_id text not null,
  project_id text not null,
  next_seq bigint not null default 1,
  primary key (org_id, project_id)
);

create or replace function public.events_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'events are append-only (%)', tg_op using errcode = '42501';
end $$;

create trigger events_no_update before update on public.events
  for each row execute function public.events_immutable();
create trigger events_no_delete before delete on public.events
  for each row execute function public.events_immutable();

-- Deny by default. Clients only reach the log through the two RPCs below.
alter table public.events enable row level security;
alter table public.snapshots enable row level security;
alter table public.partition_cursors enable row level security;

-- Caller identity as opaque text (no uuid cast; actor ids are strings here).
-- Reads the PostgREST JWT claims, or the legacy per-claim setting for tests.
create or replace function public.caller_id()
returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
    nullif(current_setting('request.jwt.claim.sub', true), '')
  );
$$;

-- ---------------------------------------------------------------------------
-- Membership fold (the only server-side fold on the write path).
-- Latest-HLC-wins over v1.MemberAdded / v1.MemberRoleChanged / v1.MemberRemoved.
-- Returns the actor's role, or null if not a member or removed.
-- ---------------------------------------------------------------------------
create or replace function public.member_role(
  p_org_id text, p_project_id text, p_profile_id text
) returns text language sql stable as $$
  with role_events as (
    select payload->>'role' as role, hlc
    from public.events
    where org_id = p_org_id and project_id = p_project_id
      and type in ('v1.MemberAdded', 'v1.MemberRoleChanged')
      and payload->>'profileId' = p_profile_id
  ),
  removed_events as (
    select (type = 'v1.MemberRemoved') as removed, hlc
    from public.events
    where org_id = p_org_id and project_id = p_project_id
      and type in ('v1.MemberAdded', 'v1.MemberRemoved')
      and payload->>'profileId' = p_profile_id
  )
  select case
    when (select removed from removed_events order by hlc desc limit 1) then null
    else (select role from role_events order by hlc desc limit 1)
  end;
$$;

-- Which roles may emit which event types. Bootstrapping is handled in
-- append_events: a project with no members accepts ProjectCreated and the
-- creator adding themselves.
create or replace function public.role_may_emit(p_role text, p_type text)
returns boolean language sql immutable as $$
  select case
    when p_role in ('owner', 'coordinator') then true
    when p_role = 'translator' then p_type in (
      'v1.RecordingAdded', 'v1.TakeComposed', 'v1.TakeArchived', 'v1.TakeSelected')
    when p_role = 'reviewer' then p_type in ('v1.ReviewSubmitted')
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- append_events: the entire synchronous write path.
-- Input: jsonb array of envelopes (PLAN.md section 7) without server_seq.
-- Output: one row per input event: accepted with its server_seq, or rejected
-- with a reason. Duplicate ids are accepted idempotently (returns existing seq).
-- ---------------------------------------------------------------------------
create or replace function public.append_events(p_events jsonb)
returns table (id text, accepted boolean, server_seq bigint, reason text)
language plpgsql security definer set search_path = public as $$
declare
  ev jsonb;
  v_actor text := public.caller_id();
  v_org text; v_project text; v_type text; v_id text;
  v_role text; v_seq bigint; v_existing bigint; v_count bigint;
begin
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events must be a jsonb array' using errcode = '22023';
  end if;

  for ev in select * from jsonb_array_elements(p_events) loop
    v_id := ev->>'id'; v_org := ev->>'orgId'; v_project := ev->>'projectId'; v_type := ev->>'type';

    if v_id is null or v_org is null or v_project is null or v_type is null or ev->'payload' is null then
      id := v_id; accepted := false; server_seq := null; reason := 'malformed envelope';
      return next; continue;
    end if;

    if v_actor is not null and ev->>'actorId' <> v_actor then
      id := v_id; accepted := false; server_seq := null; reason := 'actorId does not match caller';
      return next; continue;
    end if;

    select e.server_seq into v_existing from public.events e where e.id = v_id;
    if found then
      id := v_id; accepted := true; server_seq := v_existing; reason := 'duplicate';
      return next; continue;
    end if;

    -- Authorization: membership fold, with the bootstrap exception.
    v_role := public.member_role(v_org, v_project, ev->>'actorId');
    if v_role is null then
      -- Bootstrap: while the project has no members, the creator may create
      -- it and add exactly themselves. Everything else needs a role.
      select count(*) into v_count from public.events e
        where e.org_id = v_org and e.project_id = v_project and e.type = 'v1.MemberAdded';
      if not (v_count = 0 and (
        v_type = 'v1.ProjectCreated'
        or (v_type = 'v1.MemberAdded' and ev->'payload'->>'profileId' = ev->>'actorId')
      )) then
        id := v_id; accepted := false; server_seq := null; reason := 'not a member';
        return next; continue;
      end if;
    elsif not public.role_may_emit(v_role, v_type) then
      id := v_id; accepted := false; server_seq := null;
      reason := format('role %s may not emit %s', v_role, v_type);
      return next; continue;
    end if;

    -- Assign the next sequence for this partition (row lock serializes per project).
    insert into public.partition_cursors (org_id, project_id) values (v_org, v_project)
      on conflict do nothing;
    update public.partition_cursors c set next_seq = c.next_seq + 1
      where c.org_id = v_org and c.project_id = v_project
      returning c.next_seq - 1 into v_seq;

    insert into public.events (id, org_id, project_id, server_seq, type, actor_id, device_id,
                               hlc, parent_event_id, payload)
    values (v_id, v_org, v_project, v_seq, v_type, ev->>'actorId', ev->>'deviceId',
            ev->>'hlc', ev->>'parentEventId', ev->'payload');

    id := v_id; accepted := true; server_seq := v_seq; reason := null;
    return next;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- pull_events: bounded page of a partition after a cursor. Members only.
-- ---------------------------------------------------------------------------
create or replace function public.pull_events(
  p_org_id text, p_project_id text, p_after bigint default 0, p_limit int default 500
) returns setof public.events
language plpgsql security definer set search_path = public stable as $$
declare
  v_actor text := public.caller_id();
begin
  -- An empty partition is readable by anyone (there is nothing to read); a
  -- populated one only by members. Lets a device open a project before the
  -- creator's bootstrap has synced without treating that as an error.
  if v_actor is not null and public.member_role(p_org_id, p_project_id, v_actor) is null
     and exists (select 1 from public.events e where e.org_id = p_org_id and e.project_id = p_project_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return query
    select * from public.events e
    where e.org_id = p_org_id and e.project_id = p_project_id and e.server_seq > p_after
    order by e.server_seq
    limit least(greatest(p_limit, 1), 1000);
end $$;

grant execute on function public.append_events(jsonb) to authenticated;
grant execute on function public.pull_events(text, text, bigint, int) to authenticated;
