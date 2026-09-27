-- Phase 2b: departures (StepSetAside, CheckpointOverridden, DepartureUndone)
-- kept feedback (FeedbackKept) and requests (RequestMade, RequestWithdrawn).
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

  -- ---- kept feedback
  if public.validate_payload('v1.FeedbackKept','{"keptId":"k","checkId":"c","reason":"Listeners preferred the current wording"}') is not null
    or public.validate_payload('v1.FeedbackKept','{"keptId":"k","legacyTarget":{"takeId":"t","stepId":"s","reviewerId":"r"},"reasonBlobHash":"h"}') is not null then
    raise exception 'Valid kept payload rejected';
  end if;
  foreach payload in array array[
    '{"keptId":"k","reason":"x"}'::jsonb,
    '{"keptId":"k","checkId":"c"}'::jsonb,
    '{"keptId":"k","checkId":"","reason":"x"}'::jsonb,
    '{"keptId":"k","legacyTarget":{"takeId":"t","stepId":"s"},"reason":"x"}'::jsonb,
    '{"keptId":"k","legacyTarget":"t","reason":"x"}'::jsonb
  ] loop
    if public.validate_payload('v1.FeedbackKept',payload) is null then raise exception 'Invalid kept accepted: %',payload; end if;
  end loop;
  if not public.may_emit('record-test','P','translator','v1.FeedbackKept','{}')
    or public.may_emit('record-test','P','reviewer','v1.FeedbackKept','{}') then
    raise exception 'Kept privileges drifted from core';
  end if;

  -- ---- requests
  if public.validate_payload('v1.RequestMade','{"requestId":"r","unitId":"u","laneId":"L","what":"check","kindId":"kind@1/peer","assigneeId":"reviewer","dueDate":"2026-10-04","note":"Names","noteBlobHash":"h","questionSetId":"q"}') is not null
    or public.validate_payload('v1.RequestMade','{"requestId":"r","unitId":"u","laneId":"L","what":"record"}') is not null
    or public.validate_payload('v1.RequestWithdrawn','{"requestId":"r","reason":"wrong person"}') is not null then
    raise exception 'Valid request payload rejected';
  end if;
  foreach payload in array array[
    '{"requestId":"r","unitId":"u","laneId":"L"}'::jsonb,
    '{"requestId":"r","unitId":"u","laneId":"L","what":"review"}'::jsonb,
    '{"requestId":"r","unitId":"u","laneId":"L","what":"check","dueDate":"Sep 30"}'::jsonb,
    '{"requestId":"r","unitId":"u","laneId":"L","what":"check","dueDate":"2026-10-04T00:00"}'::jsonb,
    '{"requestId":"r","unitId":"u","laneId":"L","what":"check","assigneeId":""}'::jsonb,
    '{"requestId":"r","unitId":"u","laneId":"L","what":"check","note":3}'::jsonb
  ] loop
    if public.validate_payload('v1.RequestMade',payload) is null then raise exception 'Invalid request accepted: %',payload; end if;
  end loop;
  if public.validate_payload('v1.RequestWithdrawn','{"reason":"x"}') is null then raise exception 'Invalid withdrawal accepted'; end if;
  -- A translator may ask for a check (their own review) but not ask someone to record.
  if not public.may_emit('record-test','P','translator','v1.RequestMade','{"laneId":"L","what":"check"}')
    or public.may_emit('record-test','P','translator','v1.RequestMade','{"laneId":"L","what":"record"}')
    or not public.may_emit('record-test','P','owner','v1.RequestMade','{"laneId":"L","what":"record"}')
    or public.may_emit('record-test','P','reviewer','v1.RequestMade','{"laneId":"L","what":"check"}')
    or not public.may_emit('record-test','P','translator','v1.RequestWithdrawn','{}')
    or public.may_emit('record-test','P','reviewer','v1.RequestWithdrawn','{}') then
    raise exception 'Request privileges drifted from core';
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
    {"id":"rec-kept","orgId":"record-test","projectId":"P","type":"v1.FeedbackKept","actorId":"translator","deviceId":"new-t","hlc":"000000000000008:000000:new-t","payload":{"keptId":"k1","checkId":"c1","reason":"Matches our key terms decision"}},
    {"id":"rec-ask","orgId":"record-test","projectId":"P","type":"v1.RequestMade","actorId":"translator","deviceId":"new-t","hlc":"000000000000009:000000:new-t","payload":{"requestId":"rq1","unitId":"u","laneId":"L","what":"check","kindId":"kind@1/peer","assigneeId":"reviewer","dueDate":"2026-10-04"}},
    {"id":"rec-withdraw","orgId":"record-test","projectId":"P","type":"v1.RequestWithdrawn","actorId":"translator","deviceId":"new-t","hlc":"000000000000010:000000:new-t","payload":{"requestId":"rq1"}},
    {"id":"rec-bad-record-ask","orgId":"record-test","projectId":"P","type":"v1.RequestMade","actorId":"translator","deviceId":"new-t","hlc":"000000000000011:000000:new-t","payload":{"requestId":"rq2","unitId":"u","laneId":"L","what":"record","assigneeId":"translator"}},
    {"id":"rec-bad-aside","orgId":"record-test","projectId":"P","type":"v1.StepSetAside","actorId":"translator","deviceId":"new-t","hlc":"000000000000012:000000:new-t","payload":{"departureId":"d2","unitId":"u","laneId":"L","stepId":"s1"}}
  ]'::jsonb,0) loop
    if result.accepted is distinct from (result.id in ('rec-aside','rec-undo-aside','rec-kept','rec-ask','rec-withdraw')) then
      raise exception 'Unexpected departure append result: %',row_to_json(result);
    end if;
  end loop;
  select count(*) into facts from public.pull_events('record-test','P',0,50,0);
  if facts <> 8 then raise exception 'Old client did not receive every fact: %',facts; end if;

  if (select min_client_version from public.server_config) <> 0 then
    raise exception 'Sync must not require an app upgrade';
  end if;
end $$;
rollback;
