-- Run against a local database after the OBT migration. Every test write rolls back.
\set ON_ERROR_STOP on
begin;
insert into public.server_config default values on conflict do nothing;
insert into storage.buckets(id,name,public) values('blobs','blobs',false) on conflict do nothing;
insert into auth.users(id,email) values('10000000-0000-0000-0000-000000000009','back@test.local');
select public._append_event_as('mt','O','P','v1.MemberAdded','t','obt-test','{"profileId":"t","role":"translator"}');
select public._apply_member_event('O','P','v1.MemberAdded','{"profileId":"t","role":"translator"}','000000000000001:000000:test');
select public._append_event_as('mc','O','P','v1.MemberAdded','t','obt-test','{"profileId":"c","role":"coordinator"}');
select public._apply_member_event('O','P','v1.MemberAdded','{"profileId":"c","role":"coordinator"}','000000000000001:000000:test');
select public._append_event_as('mo','O','P','v1.MemberAdded','t','obt-test','{"profileId":"o","role":"owner"}');
select public._apply_member_event('O','P','v1.MemberAdded','{"profileId":"o","role":"owner"}','000000000000001:000000:test');
select public._append_event_as('mr','O','P','v1.MemberAdded','t','obt-test','{"profileId":"r","role":"reviewer"}');
select public._apply_member_event('O','P','v1.MemberAdded','{"profileId":"r","role":"reviewer"}','000000000000001:000000:test');
select public._append_event_as('lane','O','P','v1.LaneAdded','t','obt-test','{"laneId":"L","languoidId":"target"}');
select public._append_event_as('unit','O','P','v1.UnitAdded','t','obt-test','{"unitId":"U","parentUnitId":null,"kind":"passage","label":"Mark 1","order":"0"}');
select public._append_event_as('flow','O','P','v1.LaneFlowSelected','t','obt-test','{"laneId":"L","flowId":"spoken_worldwide","catalogVersion":1}');
select public._append_event_as('policy','O','P','v1.ObtPolicySet','o','obt-test','{"laneId":"L","consultantRole":"coordinator","finalRole":"owner","minimumInteractions":1}');
select public._append_event_as('draft-audio','O','P','v1.RecordingAdded','t','obt-test','{"unitId":"U","laneId":"L","recordingId":"draft","kind":"target","cards":[{"hash":"1111111111111111111111111111111111111111111111111111111111111111","durationMs":1000,"format":"wav"}]}');
select public._append_event_as('draft','O','P','v1.TakeComposed','t','obt-test','{"unitId":"U","laneId":"L","takeId":"draft","cardHashes":["1111111111111111111111111111111111111111111111111111111111111111"],"parentTakeId":null}');
select public._append_event_as('bt-audio','O','P','v1.RecordingAdded','t','obt-test','{"unitId":"U","laneId":"L","recordingId":"bt","kind":"target","cards":[{"hash":"2222222222222222222222222222222222222222222222222222222222222222","durationMs":1000,"format":"wav"}]}');
select public._append_event_as('bt','O','P','v1.TakeComposed','t','obt-test','{"unitId":"U","laneId":"L","takeId":"bt","cardHashes":["2222222222222222222222222222222222222222222222222222222222222222"],"parentTakeId":null}');
select public._append_event_as('final-audio','O','P','v1.RecordingAdded','t','obt-test','{"unitId":"U","laneId":"L","recordingId":"final","kind":"target","cards":[{"hash":"3333333333333333333333333333333333333333333333333333333333333333","durationMs":1000,"format":"wav"}]}');
select public._append_event_as('final','O','P','v1.TakeComposed','t','obt-test','{"unitId":"U","laneId":"L","takeId":"final","cardHashes":["3333333333333333333333333333333333333333333333333333333333333333"],"parentTakeId":null}');
select public._append_event_as('round','O','P','v1.ObtRoundStarted','t','obt-test','{"unitId":"U","laneId":"L","roundId":"round","firstDraftId":"draft","previousRoundId":null}');
select public._append_event_as('clip','O','P','v1.ObtAudioAdded','t','obt-test','{"unitId":"U","laneId":"L","clipId":"clip","cards":[{"hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","durationMs":2000,"format":"m4a"}]}');
select public._append_event_as('interaction','O','P','v1.ObtInteractionSet','r','obt-test','{"unitId":"U","laneId":"L","interactionId":"interaction","roundId":"round","draftId":"draft","participantName":"Listener","comments":"Meaning understood","clipIds":["clip"],"photoHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}');
select public._append_event_as('community','O','P','v1.ObtStepRecorded','r','obt-test','{"unitId":"U","laneId":"L","roundId":"round","step":"community","inputId":"round","decision":"complete"}');
select public._append_event_as('revision','O','P','v1.ObtStepRecorded','t','obt-test','{"unitId":"U","laneId":"L","roundId":"round","step":"revision","inputId":"community","decision":"complete","takeId":"draft"}');
select set_config('request.jwt.claim.sub','c',true);
create temp table test_packet as select public.obt_open_workspace('O','P','revision','back@test.local','English') as packet;
do $$ declare w text; again jsonb; begin
  select packet->>'workspaceId' into w from test_packet;
  again:=public.obt_open_workspace('O','P','revision','back@test.local','English');
  if again->>'workspaceId'<>w then raise exception 'retry duplicated workspace'; end if;
  if exists(select 1 from public.events where project_id=w and (type in ('v1.MaterialDefined','v1.ReferenceAttached','v1.KeyTermDefined') or (type='v1.RecordingAdded' and payload->>'kind'='source'))) then raise exception 'source leaked into workspace'; end if;
  if public.member_role('O',w,'10000000-0000-0000-0000-000000000009') <> 'translator' then raise exception 'assignment missing'; end if;
end $$;
grant select on test_packet to authenticated;
-- Valid membership must actually read and write through public APIs.
set local role authenticated;
do $$ declare result record; begin
  if not exists(select 1 from public.pull_events('O','P',0,200,3)) then raise exception 'manager cannot read'; end if;
  perform public.pull_events('O','P',0,200,1); -- old clients still sync
  if public.validate_payload('v1.ObtRoundStarted','{"unitId":"U","laneId":"L","roundId":"r","firstDraftId":"draft"}') is null then raise exception 'missing previous round accepted'; end if;
  if public.validate_payload('v1.ObtAudioAdded','{"unitId":" ","laneId":"L","clipId":"x","cards":[]}') is null then raise exception 'blank scope accepted'; end if;
  select * into result from public.append_events('[{"id":"valid-policy","orgId":"O","projectId":"P","actorId":"c","deviceId":"test","hlc":"000000000000001:000000:test","type":"v1.ObtPolicySet","payload":{"laneId":"L","consultantRole":"coordinator","finalRole":"owner","minimumInteractions":2}}]',0);
  if not result.accepted then raise exception 'valid policy rejected: %',result.reason; end if;
end $$;
reset role;
-- Forbidden source audio exists in storage. Even a later membership grant
-- must not reopen this source partition for the back translator.
insert into storage.objects(bucket_id,name,metadata) values('blobs','O/P/secret.wav','{"size":12}');
select public._apply_member_event('O','P','v1.MemberAdded','{"profileId":"10000000-0000-0000-0000-000000000009","role":"owner"}','999999999999999:000000:test');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000009',true);
set local role authenticated;
do $$ declare r record; w text; begin
  select packet->>'workspaceId' into w from test_packet;
  if not exists(select 1 from public.pull_events('O',w,0,200,3)) then raise exception 'back translator cannot read assigned draft'; end if;
  select * into r from public.append_events(jsonb_build_array(jsonb_build_object('id','forbidden-source','orgId','O','projectId',w,'actorId',public.caller_id(),'deviceId','test','hlc','000000000000001:000000:test','type','v1.ReferenceAttached','payload',jsonb_build_object('unitId','passage','refId','forbidden','kind','text','text','source'))),3);
  if r.accepted then raise exception 'source reference accepted in workspace'; end if;
  if public.member_role('O','P',public.caller_id()) is not null then raise exception 'source role escalated'; end if;
  if exists(select 1 from public.events where org_id='O' and project_id='P') then raise exception 'raw source events leaked'; end if;
  if exists(select 1 from storage.objects where name='O/P/secret.wav') then raise exception 'source blob leaked'; end if;
  begin perform public.pull_events('O','P',0,200,1); raise exception 'source events leaked'; exception when insufficient_privilege then null; end;
  begin perform public.get_snapshot_meta('O','P',3); raise exception 'source snapshot metadata leaked'; exception when insufficient_privilege then null; end;
  begin perform public.get_snapshot_chunk('O','P',3,1,0); raise exception 'source snapshot chunk leaked'; exception when insufficient_privilege then null; end;
  begin perform public.get_snapshot('O','P',3); raise exception 'source snapshot leaked'; exception when insufficient_privilege then null; end;
  begin perform public._append_service_event('forged-service','O','P','v1.TakeSubmitted','{"takeId":"draft"}'); raise exception 'service helper exposed'; exception when insufficient_privilege then null; end;
  begin perform public._append_event_as('forged-as','O','P','v1.TakeSubmitted','c','test','{"takeId":"draft"}'); raise exception 'actor helper exposed'; exception when insufficient_privilege then null; end;
  begin perform public.append_events_pre_obt('[]',1); raise exception 'legacy bypass callable'; exception when insufficient_privilege then null; end;
  for r in select * from public.append_events('[{"id":"forged-step","orgId":"O","projectId":"P","actorId":"10000000-0000-0000-0000-000000000009","deviceId":"test","hlc":"000000000000001:000000:test","type":"v1.TakeSubmitted","payload":{"takeId":"draft"}}]',3) loop
    if r.accepted then raise exception 'source mutation accepted'; end if;
  end loop;
  begin perform public.obt_result_packet('O','P','revision'); raise exception 'source result packet leaked'; exception when insufficient_privilege then null; end;
  if exists(select 1 from public.my_organizations() where project_id='P') then raise exception 'source discovery leaked'; end if;
end $$;
reset role;
-- A real back translation writes through the same API as a device.
set local role authenticated;
do $$ declare w text; base jsonb; result record; begin
  select packet->>'workspaceId' into w from test_packet;
  base:=jsonb_build_object('orgId','O','projectId',w,'actorId',public.caller_id(),'deviceId','test','hlc','000000000000001:000000:test');
  for result in select * from public.append_events(jsonb_build_array(
    base||jsonb_build_object('id','bt-out-audio','type','v1.RecordingAdded','payload',jsonb_build_object('unitId','passage','laneId','output','recordingId','out','kind','target','cards',jsonb_build_array(jsonb_build_object('hash',repeat('c',64),'durationMs',900,'format','m4a')))),
    base||jsonb_build_object('id','bt-out-take','type','v1.TakeComposed','payload',jsonb_build_object('unitId','passage','laneId','output','takeId','out','cardHashes',jsonb_build_array(repeat('c',64)),'parentTakeId',null)),
    base||jsonb_build_object('id','bt-out-submit','type','v1.TakeSubmitted','payload',jsonb_build_object('takeId','out'))
  ),3) loop
    if not result.accepted then raise exception 'back translation write rejected: %',result.reason; end if;
  end loop;
end $$;
reset role;
select set_config('request.jwt.claim.sub','c',true);
select public.obt_result_packet('O','P','revision');
do $$ begin
  begin perform public.obt_collect_result('O','P','revision','bt-out-submit'); raise exception 'collected missing audio'; exception when invalid_parameter_value then null; end;
end $$;
insert into storage.objects(bucket_id,name,metadata) values('blobs','O/P/'||repeat('c',64)||'.m4a','{"size":100}');
select public.obt_collect_result('O','P','revision','bt-out-submit');
select public.obt_collect_result('O','P','revision','bt-out-submit');
do $$ begin
  if (select count(*) from public.events where org_id='O' and project_id='P' and type='v1.ObtStepRecorded' and payload->>'step'='back_translation') <> 1 then raise exception 'collection not idempotent'; end if;
  if (select payload->>'takeId' from public.events where org_id='O' and project_id='P' and type='v1.ObtStepRecorded' and payload->>'step'='back_translation')='draft' then raise exception 'back translation replaced draft'; end if;
end $$;
set local role anon;
do $$ begin
  begin perform public.get_snapshot('O','P',3); raise exception 'anonymous snapshot exposed'; exception when insufficient_privilege then null; end;
  begin perform public.get_snapshot_meta('O','P',3); raise exception 'anonymous snapshot metadata exposed'; exception when insufficient_privilege then null; end;
  begin perform public.get_snapshot_chunk('O','P',3,1,0); raise exception 'anonymous snapshot chunk exposed'; exception when insufficient_privilege then null; end;
  begin perform public.put_snapshot('O','P',3,1,'{}'); raise exception 'anonymous snapshot write exposed'; exception when insufficient_privilege then null; end;
  begin perform public.list_partitions(); raise exception 'anonymous partition list exposed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
