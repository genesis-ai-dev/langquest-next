-- Blob integrity. Confirmation carries the stored size and is re-issued
-- when an object is overwritten with a different size, so a device can
-- compare against its file. v1.BlobInvalidated is the reconciler's verdict
-- that stored bytes do not match their hash; clients cannot emit it.
-- record_blob / invalidate_blob are service-role entry points for the
-- reconciler (packages/client/src/blobReconciler.ts), which lists the bucket
-- independently of the storage trigger and so also heals a trigger that
-- Supabase's storage upgrades might silently break.

create or replace function public.validate_payload(p_type text, p jsonb)
returns text language plpgsql immutable as $$
declare c jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'payload must be an object'; end if;
  case p_type
    when 'v1.ProjectCreated' then
      if not (public._is_str(p->'name') and public._is_str(p->'sourceLanguoidId')) then return 'name and sourceLanguoidId must be non-empty strings'; end if;
    when 'v1.ProjectConfigChanged' then
      if jsonb_typeof(p->'config') is distinct from 'object' then return 'config must be an object'; end if;
    when 'v1.MemberAdded', 'v1.MemberRoleChanged' then
      if not public._is_str(p->'profileId') then return 'profileId must be a non-empty string'; end if;
      if not public._is_role(p->>'role') then return 'role must be a role'; end if;
    when 'v1.MemberRemoved' then
      if not public._is_str(p->'profileId') then return 'profileId must be a non-empty string'; end if;
    when 'v1.LaneAdded' then
      if not (public._is_str(p->'laneId') and public._is_str(p->'languoidId')) then return 'laneId and languoidId must be non-empty strings'; end if;
    when 'v1.UnitAdded' then
      if not (public._is_str(p->'unitId') and public._is_str(p->'kind') and public._is_str(p->'label') and public._is_str(p->'order')) then return 'unitId, kind, label, order must be non-empty strings'; end if;
      if jsonb_typeof(p->'parentUnitId') not in ('null', 'string') then return 'parentUnitId must be a string or null'; end if;
    when 'v1.ReferenceAttached' then
      if not (public._is_str(p->'unitId') and public._is_str(p->'refId') and public._is_str(p->'kind')) then return 'unitId, refId, kind must be non-empty strings'; end if;
    when 'v1.RecordingAdded' then
      if not (public._is_str(p->'recordingId') and public._is_str(p->'unitId') and public._is_str(p->'laneId')) then return 'recordingId, unitId, laneId must be non-empty strings'; end if;
      if p->>'kind' not in ('source', 'target') then return 'kind must be source or target'; end if;
      if jsonb_typeof(p->'cards') is distinct from 'array' then return 'cards must be an array'; end if;
      for c in select * from jsonb_array_elements(p->'cards') loop
        if jsonb_typeof(c) <> 'object' or not public._is_str(c->'hash') or jsonb_typeof(c->'durationMs') is distinct from 'number' then
          return 'cards entries need a hash and durationMs';
        end if;
      end loop;
    when 'v1.TakeComposed' then
      if not (public._is_str(p->'takeId') and public._is_str(p->'unitId') and public._is_str(p->'laneId')) then return 'takeId, unitId, laneId must be non-empty strings'; end if;
      if not public._is_str_array(p->'cardHashes') then return 'cardHashes must be a string array'; end if;
      if jsonb_typeof(p->'parentTakeId') not in ('null', 'string') then return 'parentTakeId must be a string or null'; end if;
    when 'v1.TakeArchived', 'v1.TakeSubmitted' then
      if not public._is_str(p->'takeId') then return 'takeId must be a non-empty string'; end if;
    when 'v1.TakeSelected' then
      if not (public._is_str(p->'unitId') and public._is_str(p->'laneId') and public._is_str(p->'takeId')) then return 'unitId, laneId, takeId must be non-empty strings'; end if;
    when 'v1.ReviewSubmitted' then
      if not (public._is_str(p->'takeId') and public._is_str(p->'stepId')) then return 'takeId and stepId must be non-empty strings'; end if;
      if p->>'decision' not in ('approve', 'suggest_changes') then return 'decision must be approve or suggest_changes'; end if;
    when 'v1.AssignmentMade' then
      if not (public._is_str(p->'unitId') and public._is_str(p->'laneId') and public._is_str(p->'profileId')) then return 'unitId, laneId, profileId must be non-empty strings'; end if;
      if not public._is_role(p->>'role') then return 'role must be a role'; end if;
    when 'v1.SourceImported' then
      if not public._is_str(p->'sourceProjectId') then return 'sourceProjectId must be a non-empty string'; end if;
      if jsonb_typeof(p->'sourceSeq') is distinct from 'number' then return 'sourceSeq must be a number'; end if;
      if not public._is_str_array(p->'unitIds') then return 'unitIds must be a string array'; end if;
    when 'v1.BlobStored' then
      if not public._is_str(p->'hash') or jsonb_typeof(p->'size') is distinct from 'number' then return 'hash and size required'; end if;
    when 'v1.BlobInvalidated' then
      if not public._is_str(p->'hash') then return 'hash must be a non-empty string'; end if;
    when 'v1.Redacted' then
      if not public._is_str(p->'eventId') then return 'eventId must be a non-empty string'; end if;
    else null;
  end case;
  return null;
end $$;

create or replace function public.role_may_emit(p_role text, p_type text)
returns boolean language sql immutable as $$
  select case
    when p_type in ('v1.BlobStored', 'v1.BlobInvalidated') then false
    when p_role in ('owner', 'coordinator') then true
    when p_role = 'translator' then p_type in (
      'v1.RecordingAdded', 'v1.TakeComposed', 'v1.TakeArchived', 'v1.TakeSelected', 'v1.TakeSubmitted',
      'v1.ReferenceAttached')
    when p_role = 'reviewer' then p_type in ('v1.ReviewSubmitted')
    else false
  end;
$$;

-- One append helper for every server-issued blob verdict. Idempotent by id.
create or replace function public._append_service_event(
  p_id text, p_org text, p_project text, p_type text, p_payload jsonb
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_seq bigint;
begin
  if exists (select 1 from public.events e where e.id = p_id) then return false; end if;
  insert into public.partition_cursors (org_id, project_id) values (p_org, p_project)
    on conflict do nothing;
  update public.partition_cursors c set next_seq = c.next_seq + 1
    where c.org_id = p_org and c.project_id = p_project
    returning c.next_seq - 1 into v_seq;
  insert into public.events (id, org_id, project_id, server_seq, type, actor_id, device_id, hlc, payload)
  values (p_id, p_org, p_project, v_seq, p_type, 'service', 'storage',
          lpad((extract(epoch from clock_timestamp()) * 1000)::bigint::text, 15, '0') || ':' || lpad((v_seq % 1000000)::text, 6, '0') || ':storage',
          p_payload);
  return true;
end $$;

-- The storage trigger: fires on insert and on metadata change (an upsert
-- that replaced the bytes). The id carries the size, so a re-upload with
-- different bytes produces a fresh confirmation the reducer prefers.
create or replace function public.record_blob_stored()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_org text := split_part(new.name, '/', 1);
  v_project text := split_part(new.name, '/', 2);
  v_hash text := split_part(split_part(new.name, '/', 3), '.', 1);
  v_size bigint := coalesce((new.metadata ->> 'size')::bigint, 0);
begin
  if new.bucket_id <> 'blobs' or v_org = '' or v_project = '' or v_hash = '' then return new; end if;
  if tg_op = 'UPDATE' and coalesce((old.metadata ->> 'size')::bigint, -1) = v_size then return new; end if;
  perform public._append_service_event(
    format('blob:%s:%s:%s:%s', v_org, v_project, v_hash, v_size), v_org, v_project,
    'v1.BlobStored', jsonb_build_object('hash', v_hash, 'size', v_size));
  return new;
end $$;

drop trigger if exists blobs_record_stored on storage.objects;
create trigger blobs_record_stored
  after insert or update of metadata on storage.objects
  for each row execute function public.record_blob_stored();

-- Reconciler entry points. Service role only.
create or replace function public.record_blob(p_org text, p_project text, p_hash text, p_size bigint)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if public.caller_id() is not null then raise exception 'service role only' using errcode = '42501'; end if;
  return public._append_service_event(
    format('blob:%s:%s:%s:%s', p_org, p_project, p_hash, p_size), p_org, p_project,
    'v1.BlobStored', jsonb_build_object('hash', p_hash, 'size', p_size));
end $$;

create or replace function public.invalidate_blob(p_org text, p_project text, p_hash text, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if public.caller_id() is not null then raise exception 'service role only' using errcode = '42501'; end if;
  return public._append_service_event(
    format('blobinvalid:%s:%s:%s:%s', p_org, p_project, p_hash, (extract(epoch from clock_timestamp()) * 1000)::bigint),
    p_org, p_project, 'v1.BlobInvalidated', jsonb_build_object('hash', p_hash, 'reason', p_reason));
end $$;

grant execute on function public.record_blob(text, text, text, bigint) to service_role;
grant execute on function public.invalidate_blob(text, text, text, text) to service_role;
