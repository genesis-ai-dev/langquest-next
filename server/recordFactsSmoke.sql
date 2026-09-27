-- Phase 2b: departures (StepSetAside, CheckpointOverridden, DepartureUndone).
-- Run in a migrated local test database. Every test write rolls back.
\set ON_ERROR_STOP on
begin;
select public._apply_member_event('record-test','P','v1.MemberAdded','{"profileId":"owner","role":"owner"}','000000000000001:000000:test');
select public._apply_member_event('record-test','P','v1.MemberAdded','{"profileId":"translator","role":"translator"}','000000000000001:000000:test');
select public._apply_member_event('record-test','P','v1.MemberAdded','{"profileId":"reviewer","role":"reviewer"}','000000000000001:000000:test');
do $$
declare payload jsonb; result record; facts integer;
begin
  -- ---- departures: validation equals core (packages/core/src/eventRegistry.ts).
  if public.validate_payload('v1.StepSetAside','{"departureId":"d","unitId":"u","laneId":"L","stepId":"s","kindId":"k","reason":"No one available"}') is not null
    or public.validate_payload('v1.StepSetAside','{"departureId":"d","unitId":"u","laneId":"L","stepId":"s","reason":"","reasonBlobHash":"h"}') is not null
    or public.validate_payload('v1.CheckpointOverridden','{"departureId":"o","unitId":"u","laneId":"L","stepId":"s","reason":"Visit is months away"}') is not null
    or public.validate_payload('v1.DepartureUndone','{"undoId":"x","departureId":"d","departureKind":"set_aside"}') is not null
    or public.validate_payload('v1.DepartureUndone','{"undoId":"x","departureId":"o","departureKind":"override","reason":"Consultant came"}') is not null then
    raise exception 'Valid departure payload rejected';
  end if;
  foreach payload in array array[
    '{"departureId":"d","unitId":"u","laneId":"L","stepId":"s"}'::jsonb,
    '{"departureId":"d","unitId":"u","laneId":"L","stepId":"s","reason":""}'::jsonb,
    '{"departureId":"d","unitId":"u","laneId":"L","stepId":"s","reason":1}'::jsonb,
    '{"departureId":"d","unitId":"u","laneId":"L","stepId":"s","reason":"x","kindId":""}'::jsonb,
    '{"departureId":"d","unitId":"u","laneId":"L","reason":"x"}'::jsonb
  ] loop
    if public.validate_payload('v1.StepSetAside',payload) is null then raise exception 'Invalid set-aside accepted: %',payload; end if;
  end loop;
  foreach payload in array array[
    '{"departureId":"o","unitId":"u","laneId":"L","stepId":"s"}'::jsonb,
    '{"departureId":"o","unitId":"u","laneId":"L","stepId":"s","reasonBlobHash":""}'::jsonb
  ] loop
    if public.validate_payload('v1.CheckpointOverridden',payload) is null then raise exception 'Invalid override accepted: %',payload; end if;
  end loop;
  foreach payload in array array[
    '{"undoId":"x","departureId":"d"}'::jsonb,
    '{"undoId":"x","departureId":"d","departureKind":"skip"}'::jsonb,
    '{"undoId":"x","departureKind":"set_aside"}'::jsonb
  ] loop
    if public.validate_payload('v1.DepartureUndone',payload) is null then raise exception 'Invalid undo accepted: %',payload; end if;
  end loop;

  -- Privileges: set aside needs translate, override needs manage_flows, and an
  -- undo needs the privilege of the departure kind it names.
  if not public.may_emit('record-test','P','translator','v1.StepSetAside','{"laneId":"L"}')
    or public.may_emit('record-test','P','reviewer','v1.StepSetAside','{"laneId":"L"}')
    or not public.may_emit('record-test','P','owner','v1.CheckpointOverridden','{"laneId":"L"}')
    or public.may_emit('record-test','P','translator','v1.CheckpointOverridden','{"laneId":"L"}')
    or not public.may_emit('record-test','P','translator','v1.DepartureUndone','{"laneId":"L","departureKind":"set_aside"}')
    or public.may_emit('record-test','P','translator','v1.DepartureUndone','{"laneId":"L","departureKind":"override"}')
    or not public.may_emit('record-test','P','owner','v1.DepartureUndone','{"laneId":"L","departureKind":"override"}') then
    raise exception 'Departure privileges drifted from core';
  end if;

  -- Coexistence: an old client (version 0) appends legacy facts next to the
  -- new ones, and pulls every fact, familiar or not.
  perform set_config('request.jwt.claims','{"sub":"owner","role":"authenticated"}',true);
  for result in select * from public.append_events('[
    {"id":"rec-project","orgId":"record-test","projectId":"P","type":"v1.ProjectCreated","actorId":"owner","deviceId":"new","hlc":"000000000000002:000000:new","payload":{"name":"Records","sourceLanguoidId":"eng"}},
    {"id":"rec-override","orgId":"record-test","projectId":"P","type":"v1.CheckpointOverridden","actorId":"owner","deviceId":"new","hlc":"000000000000003:000000:new","payload":{"departureId":"o1","unitId":"u","laneId":"L","stepId":"s2","reason":"Visit is months away"}},
    {"id":"rec-old-assign","orgId":"record-test","projectId":"P","type":"v1.AssignmentMade","actorId":"owner","deviceId":"old","hlc":"000000000000004:000000:old","payload":{"unitId":"u","laneId":"L","profileId":"translator","role":"translator"}}
  ]'::jsonb,0) loop
    if not result.accepted then raise exception 'Departure append refused: %',row_to_json(result); end if;
  end loop;
  perform set_config('request.jwt.claims','{"sub":"translator","role":"authenticated"}',true);
  for result in select * from public.append_events('[
    {"id":"rec-aside","orgId":"record-test","projectId":"P","type":"v1.StepSetAside","actorId":"translator","deviceId":"new-t","hlc":"000000000000005:000000:new-t","payload":{"departureId":"d1","unitId":"u","laneId":"L","stepId":"s1","reason":"No one available"}},
    {"id":"rec-undo-aside","orgId":"record-test","projectId":"P","type":"v1.DepartureUndone","actorId":"translator","deviceId":"new-t","hlc":"000000000000006:000000:new-t","payload":{"undoId":"u1","departureId":"d1","departureKind":"set_aside"}},
    {"id":"rec-undo-override","orgId":"record-test","projectId":"P","type":"v1.DepartureUndone","actorId":"translator","deviceId":"new-t","hlc":"000000000000007:000000:new-t","payload":{"undoId":"u2","departureId":"o1","departureKind":"override"}},
    {"id":"rec-bad-aside","orgId":"record-test","projectId":"P","type":"v1.StepSetAside","actorId":"translator","deviceId":"new-t","hlc":"000000000000008:000000:new-t","payload":{"departureId":"d2","unitId":"u","laneId":"L","stepId":"s1"}}
  ]'::jsonb,0) loop
    if result.accepted is distinct from (result.id in ('rec-aside','rec-undo-aside')) then
      raise exception 'Unexpected departure append result: %',row_to_json(result);
    end if;
  end loop;
  select count(*) into facts from public.pull_events('record-test','P',0,50,0);
  if facts <> 5 then raise exception 'Old client did not receive every fact: %',facts; end if;

  if (select min_client_version from public.server_config) <> 0 then
    raise exception 'Sync must not require an app upgrade';
  end if;
end $$;
rollback;
