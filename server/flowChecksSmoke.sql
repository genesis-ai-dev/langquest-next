-- Phase 2a: v2.WorkflowStepSet, v1.ReviewKindDefined, v1.CheckRecorded.
-- Run in a migrated local test database. Every test write rolls back.
\set ON_ERROR_STOP on
begin;
select public._apply_member_event('flow-test','P','v1.MemberAdded','{"profileId":"owner","role":"owner"}','000000000000001:000000:test');
select public._apply_member_event('flow-test','P','v1.MemberAdded','{"profileId":"translator","role":"translator"}','000000000000001:000000:test');
select public._apply_member_event('flow-test','P','v1.MemberAdded','{"profileId":"reviewer","role":"reviewer"}','000000000000001:000000:test');
do $$
declare payload jsonb; result record; facts integer;
begin
  -- Validation equals core (packages/core/src/eventRegistry.ts).
  if public.validate_payload('v2.WorkflowStepSet','{"stepId":"s1","laneId":"L","order":"s00","kindIds":["kind@1/peer","elder"],"checkpoint":true,"label":"Together"}') is not null
    or public.validate_payload('v1.ReviewKindDefined','{"kindId":"elder","name":"Elder Review","icon":"chat","withholdsContext":false,"produces":{"what":"bt","language":"eng","checkedByKindId":"kind@1/consultant"}}') is not null
    or public.validate_payload('v1.CheckRecorded','{"checkId":"c1","unitId":"u","laneId":"L","takeId":"t","kindId":"k","outcome":"looks_good"}') is not null
    or public.validate_payload('v1.CheckRecorded','{"checkId":"c2","unitId":"u","laneId":"L","takeId":"t","kindId":"k","outcome":"needs_changes","commentBlobHash":"h","skippedQuestions":[{"questionId":"q","reason":"n/a"}],"answers":{"q1":"yes"}}') is not null then
    raise exception 'Valid Phase 2a payload rejected';
  end if;
  foreach payload in array array[
    '{"stepId":"s1","order":"s00","kindIds":[],"checkpoint":true}'::jsonb,
    '{"stepId":"s1","order":"s00","kindIds":[""],"checkpoint":true}'::jsonb,
    '{"stepId":"s1","order":"s00","kindIds":["k"]}'::jsonb,
    '{"stepId":"s1","order":"s00","kindIds":["k"],"checkpoint":true,"laneId":null}'::jsonb
  ] loop
    if public.validate_payload('v2.WorkflowStepSet',payload) is null then raise exception 'Invalid step accepted: %',payload; end if;
  end loop;
  foreach payload in array array[
    '{"kindId":"k"}'::jsonb,
    '{"kindId":"k","name":"x","produces":{"what":"bt","language":"eng"}}'::jsonb,
    '{"kindId":"k","name":"x","withholdsContext":"yes"}'::jsonb
  ] loop
    if public.validate_payload('v1.ReviewKindDefined',payload) is null then raise exception 'Invalid kind accepted: %',payload; end if;
  end loop;
  foreach payload in array array[
    '{"checkId":"c","unitId":"u","laneId":"L","takeId":"t","kindId":"k","outcome":"needs_changes"}'::jsonb,
    '{"checkId":"c","unitId":"u","laneId":"L","takeId":"t","kindId":"k","outcome":"maybe"}'::jsonb,
    '{"checkId":"c","unitId":"u","laneId":"L","takeId":"t","outcome":"looks_good"}'::jsonb,
    '{"checkId":"c","unitId":"u","laneId":"L","takeId":"t","kindId":"k","outcome":"looks_good","answers":{"q":1}}'::jsonb,
    '{"checkId":"c","unitId":"u","laneId":"L","takeId":"t","kindId":"k","outcome":"looks_good","skippedQuestions":[{"questionId":"q"}]}'::jsonb
  ] loop
    if public.validate_payload('v1.CheckRecorded',payload) is null then raise exception 'Invalid check accepted: %',payload; end if;
  end loop;

  -- Privileges: flows need manage_flows, checks need review.
  if not public.may_emit('flow-test','P','owner','v2.WorkflowStepSet','{"laneId":"L"}')
    or public.may_emit('flow-test','P','translator','v2.WorkflowStepSet','{"laneId":"L"}')
    or public.may_emit('flow-test','P','reviewer','v1.ReviewKindDefined','{}') then
    raise exception 'Flow privileges drifted from core';
  end if;
  if not public.may_emit('flow-test','P','reviewer','v1.CheckRecorded','{"laneId":"L"}')
    or public.may_emit('flow-test','P','translator','v1.CheckRecorded','{"laneId":"L"}') then
    raise exception 'Check privileges drifted from core';
  end if;

  -- Coexistence: an old client (version 0) appends legacy facts next to the
  -- new ones, and pulls every fact, familiar or not.
  perform set_config('request.jwt.claims','{"sub":"owner","role":"authenticated"}',true);
  for result in select * from public.append_events('[
    {"id":"flow-project","orgId":"flow-test","projectId":"P","type":"v1.ProjectCreated","actorId":"owner","deviceId":"new","hlc":"000000000000002:000000:new","payload":{"name":"Flows","sourceLanguoidId":"eng"}},
    {"id":"flow-step","orgId":"flow-test","projectId":"P","type":"v2.WorkflowStepSet","actorId":"owner","deviceId":"new","hlc":"000000000000003:000000:new","payload":{"stepId":"s1","laneId":"L","order":"s00","kindIds":["kind@1/peer","kind@1/community"],"checkpoint":true}},
    {"id":"flow-kind","orgId":"flow-test","projectId":"P","type":"v1.ReviewKindDefined","actorId":"owner","deviceId":"new","hlc":"000000000000004:000000:new","payload":{"kindId":"elder","name":"Elder Review"}},
    {"id":"flow-v1-step","orgId":"flow-test","projectId":"P","type":"v1.WorkflowStepSet","actorId":"owner","deviceId":"old","hlc":"000000000000005:000000:old","payload":{"stepId":"legacy","laneId":"L2","order":"s00","role":"reviewer","required":true,"rule":"any"}}
  ]'::jsonb,0) loop
    if not result.accepted then raise exception 'Flow append refused: %',row_to_json(result); end if;
  end loop;
  perform set_config('request.jwt.claims','{"sub":"reviewer","role":"authenticated"}',true);
  for result in select * from public.append_events('[
    {"id":"flow-check","orgId":"flow-test","projectId":"P","type":"v1.CheckRecorded","actorId":"reviewer","deviceId":"new-r","hlc":"000000000000006:000000:new-r","payload":{"checkId":"c1","unitId":"u","laneId":"L","takeId":"t","kindId":"kind@1/peer","stepId":"s1","outcome":"needs_changes","comment":"Slower"}},
    {"id":"flow-legacy-review","orgId":"flow-test","projectId":"P","type":"v1.ReviewSubmitted","actorId":"reviewer","deviceId":"old-r","hlc":"000000000000007:000000:old-r","payload":{"takeId":"t","stepId":"legacy","decision":"approve"}},
    {"id":"flow-bad-check","orgId":"flow-test","projectId":"P","type":"v1.CheckRecorded","actorId":"reviewer","deviceId":"new-r","hlc":"000000000000008:000000:new-r","payload":{"checkId":"c2","unitId":"u","laneId":"L","takeId":"t","kindId":"k","outcome":"needs_changes"}}
  ]'::jsonb,0) loop
    if result.accepted is distinct from (result.id <> 'flow-bad-check') then
      raise exception 'Unexpected check append result: %',row_to_json(result);
    end if;
  end loop;
  select count(*) into facts from public.pull_events('flow-test','P',0,50,0);
  if facts <> 6 then raise exception 'Old client did not receive every fact: %',facts; end if;
  if (select min_client_version from public.server_config) <> 0 then
    raise exception 'Sync must not require an app upgrade';
  end if;
end $$;
rollback;
