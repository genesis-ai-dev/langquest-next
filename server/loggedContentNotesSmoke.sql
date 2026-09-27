-- Phase 2b slice C: v1.CheckLogged (and, below, ContentProduced and ContextItemAdded).
-- Run in a migrated local test database. Every test write rolls back.
\set ON_ERROR_STOP on
begin;
select public._apply_member_event('slice-c','P','v1.MemberAdded','{"profileId":"owner","role":"owner"}','000000000000001:000000:test');
select public._apply_member_event('slice-c','P','v1.MemberAdded','{"profileId":"translator","role":"translator"}','000000000000001:000000:test');
select public._apply_member_event('slice-c','P','v1.MemberAdded','{"profileId":"reviewer","role":"reviewer"}','000000000000001:000000:test');
select public._apply_member_event('slice-c','P','v1.MemberAdded','{"profileId":"viewer","role":"viewer"}','000000000000001:000000:test');
do $$
declare payload jsonb; result record; facts integer;
begin
  -- CheckLogged validation equals core (packages/core/src/eventRegistry.ts).
  if public.validate_payload('v1.CheckLogged','{"checkId":"g1","unitId":"u","laneId":"L","takeId":"t","kindId":"kind@1/community","outcome":"looks_good","people":12,"place":"Bor church"}') is not null
    or public.validate_payload('v1.CheckLogged','{"checkId":"g2","unitId":"u","laneId":"L","takeId":"t","kindId":"k","outcome":"needs_changes","commentBlobHash":"h","givenBy":"Elder Deng","evidence":[{"hash":"e","durationMs":1000,"format":"m4a"}],"stepId":"s1","requestId":"rq"}') is not null then
    raise exception 'Valid CheckLogged rejected';
  end if;
  foreach payload in array array[
    '{"checkId":"g","unitId":"u","laneId":"L","takeId":"t","kindId":"k","outcome":"needs_changes"}'::jsonb,
    '{"checkId":"g","unitId":"u","laneId":"L","takeId":"t","kindId":"k","outcome":"looks_good","people":0}'::jsonb,
    '{"checkId":"g","unitId":"u","laneId":"L","takeId":"t","kindId":"k","outcome":"looks_good","people":2.5}'::jsonb,
    '{"checkId":"g","unitId":"u","laneId":"L","takeId":"t","kindId":"k","outcome":"looks_good","people":"12"}'::jsonb,
    '{"checkId":"g","unitId":"u","laneId":"L","takeId":"t","kindId":"k","outcome":"looks_good","givenBy":""}'::jsonb,
    '{"checkId":"g","unitId":"u","laneId":"L","takeId":"t","kindId":"k","outcome":"looks_good","evidence":[{"hash":"e"}]}'::jsonb,
    '{"checkId":"g","unitId":"u","laneId":"L","takeId":"t","outcome":"looks_good"}'::jsonb
  ] loop
    if public.validate_payload('v1.CheckLogged',payload) is null then raise exception 'Invalid CheckLogged accepted: %',payload; end if;
  end loop;

  -- A translator may log a check they ran (send_to_reviewers); a reviewer
  -- (review only) and a viewer may not.
  if not public.may_emit('slice-c','P','translator','v1.CheckLogged','{"laneId":"L"}')
    or public.may_emit('slice-c','P','reviewer','v1.CheckLogged','{"laneId":"L"}')
    or public.may_emit('slice-c','P','viewer','v1.CheckLogged','{"laneId":"L"}') then
    raise exception 'CheckLogged privileges drifted from core';
  end if;

  -- Coexistence: a new client logs a check next to an old client's legacy
  -- review; an old client (version 0) pulls every fact, familiar or not.
  perform set_config('request.jwt.claims','{"sub":"owner","role":"authenticated"}',true);
  for result in select * from public.append_events('[
    {"id":"c-project","orgId":"slice-c","projectId":"P","type":"v1.ProjectCreated","actorId":"owner","deviceId":"new","hlc":"000000000000002:000000:new","payload":{"name":"Slice C","sourceLanguoidId":"eng"}}
  ]'::jsonb,0) loop
    if not result.accepted then raise exception 'Project append refused: %',row_to_json(result); end if;
  end loop;
  perform set_config('request.jwt.claims','{"sub":"translator","role":"authenticated"}',true);
  for result in select * from public.append_events('[
    {"id":"c-logged-1","orgId":"slice-c","projectId":"P","type":"v1.CheckLogged","actorId":"translator","deviceId":"new-t","hlc":"000000000000003:000000:new-t","payload":{"checkId":"g1","unitId":"u1","laneId":"L","takeId":"t1","kindId":"kind@1/community","outcome":"looks_good","people":12,"place":"Bor church"}},
    {"id":"c-logged-2","orgId":"slice-c","projectId":"P","type":"v1.CheckLogged","actorId":"translator","deviceId":"new-t","hlc":"000000000000004:000000:new-t","payload":{"checkId":"g2","unitId":"u2","laneId":"L","takeId":"t2","kindId":"kind@1/community","outcome":"looks_good","people":12,"place":"Bor church"}},
    {"id":"c-old-take","orgId":"slice-c","projectId":"P","type":"v1.TakeSubmitted","actorId":"translator","deviceId":"old-t","hlc":"000000000000005:000000:old-t","payload":{"takeId":"t1"}},
    {"id":"c-bad-logged","orgId":"slice-c","projectId":"P","type":"v1.CheckLogged","actorId":"translator","deviceId":"new-t","hlc":"000000000000006:000000:new-t","payload":{"checkId":"g3","unitId":"u1","laneId":"L","takeId":"t1","kindId":"k","outcome":"needs_changes"}}
  ]'::jsonb,0) loop
    if result.accepted is distinct from (result.id <> 'c-bad-logged') then
      raise exception 'Unexpected CheckLogged append result: %',row_to_json(result);
    end if;
  end loop;
  -- ContentProduced validation equals core.
  if public.validate_payload('v1.ContentProduced','{"contentId":"b1","unitId":"u1","laneId":"L","fromTakeId":"t1","kindId":"kind@1/back_translation","language":"eng","cards":[{"hash":"h","durationMs":1000,"format":"m4a"}],"note":"verse 3?","noteBlobHash":"n","requestId":"rq"}') is not null then
    raise exception 'Valid ContentProduced rejected';
  end if;
  foreach payload in array array[
    '{"contentId":"b","unitId":"u","laneId":"L","fromTakeId":"t","kindId":"k","language":"eng","cards":[]}'::jsonb,
    '{"contentId":"b","unitId":"u","laneId":"L","fromTakeId":"t","kindId":"k","cards":[{"hash":"h","durationMs":1}]}'::jsonb,
    '{"contentId":"b","unitId":"u","laneId":"L","fromTakeId":"t","kindId":"k","language":"eng","cards":[{"hash":"h"}]}'::jsonb,
    '{"contentId":"b","unitId":"u","laneId":"L","fromTakeId":"t","kindId":"k","language":"eng","cards":[{"hash":"h","durationMs":1}],"note":3}'::jsonb
  ] loop
    if public.validate_payload('v1.ContentProduced',payload) is null then raise exception 'Invalid ContentProduced accepted: %',payload; end if;
  end loop;
  if not public.may_emit('slice-c','P','reviewer','v1.ContentProduced','{"laneId":"L"}')
    or public.may_emit('slice-c','P','translator','v1.ContentProduced','{"laneId":"L"}') then
    raise exception 'ContentProduced privileges drifted from core';
  end if;
  perform set_config('request.jwt.claims','{"sub":"reviewer","role":"authenticated"}',true);
  for result in select * from public.append_events('[
    {"id":"c-content","orgId":"slice-c","projectId":"P","type":"v1.ContentProduced","actorId":"reviewer","deviceId":"new-r","hlc":"000000000000007:000000:new-r","payload":{"contentId":"b1","unitId":"u1","laneId":"L","fromTakeId":"t1","kindId":"kind@1/back_translation","language":"eng","cards":[{"hash":"h","durationMs":1000,"format":"m4a"}]}}
  ]'::jsonb,0) loop
    if not result.accepted then raise exception 'ContentProduced append refused: %',row_to_json(result); end if;
  end loop;

  select count(*) into facts from public.pull_events('slice-c','P',0,50,0);
  if facts <> 5 then raise exception 'Old client did not receive every fact: %',facts; end if;
  if (select min_client_version from public.server_config) <> 0 then
    raise exception 'Sync must not require an app upgrade';
  end if;
end $$;
rollback;
