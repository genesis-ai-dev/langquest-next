-- Content-addressed audio blobs. See PLAN.md section 14.
--
-- Objects live in the private "blobs" bucket at <org>/<project>/<hash>.<ext>.
-- When one lands, a trigger appends v1.BlobStored to that project's event
-- log under the service actor. That event is the only confirmation clients
-- ever see, and clients cannot forge it: append_events refuses the type.

-- member_role is called from storage policies as the requesting user. The
-- events table is deny-by-default, so the fold must run as definer or it
-- sees no rows and every member looks like a stranger.
create or replace function public.member_role(
  p_org_id text, p_project_id text, p_profile_id text
) returns text language sql stable security definer set search_path = public as $$
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

insert into storage.buckets (id, name, public)
values ('blobs', 'blobs', false)
on conflict (id) do nothing;

-- Members of a project may upload into and read from its prefix. Uploads are
-- idempotent (upsert) and content-addressed, so re-uploading is harmless.
create policy "blobs: members read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'blobs'
    and public.member_role(split_part(name, '/', 1), split_part(name, '/', 2), public.caller_id()) is not null
  );

create policy "blobs: members write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'blobs'
    and public.member_role(split_part(name, '/', 1), split_part(name, '/', 2), public.caller_id()) is not null
  );

create policy "blobs: members overwrite"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'blobs'
    and public.member_role(split_part(name, '/', 1), split_part(name, '/', 2), public.caller_id()) is not null
  );

-- ---------------------------------------------------------------------------
-- Confirmation: storage.objects insert -> v1.BlobStored in the project log.
-- Idempotent by event id, so a re-upload (upsert) or replayed trigger is a
-- no-op. The seq is allocated like any other event so pulls see it in order.
-- ---------------------------------------------------------------------------
create or replace function public.record_blob_stored()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_org text := split_part(new.name, '/', 1);
  v_project text := split_part(new.name, '/', 2);
  v_file text := split_part(new.name, '/', 3);
  v_hash text := split_part(v_file, '.', 1);
  v_size bigint := coalesce((new.metadata ->> 'size')::bigint, 0);
  v_id text;
  v_seq bigint;
begin
  if new.bucket_id <> 'blobs' or v_org = '' or v_project = '' or v_hash = '' then
    return new;
  end if;
  v_id := format('blob:%s:%s:%s', v_org, v_project, v_hash);
  if exists (select 1 from public.events e where e.id = v_id) then
    return new;
  end if;

  insert into public.partition_cursors (org_id, project_id) values (v_org, v_project)
    on conflict do nothing;
  update public.partition_cursors c set next_seq = c.next_seq + 1
    where c.org_id = v_org and c.project_id = v_project
    returning c.next_seq - 1 into v_seq;

  insert into public.events (id, org_id, project_id, server_seq, type, actor_id, device_id, hlc, payload)
  values (
    v_id, v_org, v_project, v_seq, 'v1.BlobStored', 'service', 'storage',
    -- HLC-shaped so it sorts with device clocks; the server is the tie-breaker.
    lpad((extract(epoch from now()) * 1000)::bigint::text, 15, '0') || ':000000:storage',
    jsonb_build_object('hash', v_hash, 'size', v_size)
  );
  return new;
end $$;

drop trigger if exists blobs_record_stored on storage.objects;
create trigger blobs_record_stored
  after insert on storage.objects
  for each row execute function public.record_blob_stored();

-- ---------------------------------------------------------------------------
-- Clients may not emit the confirmation.
-- ---------------------------------------------------------------------------
create or replace function public.role_may_emit(p_role text, p_type text)
returns boolean language sql immutable as $$
  select case
    when p_type = 'v1.BlobStored' then false
    when p_role in ('owner', 'coordinator') then true
    when p_role = 'translator' then p_type in (
      'v1.RecordingAdded', 'v1.TakeComposed', 'v1.TakeArchived', 'v1.TakeSelected', 'v1.TakeSubmitted',
      'v1.ReferenceAttached')
    when p_role = 'reviewer' then p_type in ('v1.ReviewSubmitted')
    else false
  end;
$$;
