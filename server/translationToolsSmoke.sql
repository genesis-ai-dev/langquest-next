-- Run in a transaction after the translation-tools migration.
\set ON_ERROR_STOP on
begin;
select public._apply_member_event('tools-test','P','v1.MemberAdded',
  '{"profileId":"translator","role":"translator"}', '000000000000001:000000:test');
select public._apply_member_event('tools-test','P','v1.MemberAdded',
  '{"profileId":"viewer","role":"viewer"}', '000000000000001:000000:test');
select public._append_event_as('tools-lane','tools-test','P','v1.LaneAdded','owner','test',
  '{"laneId":"L","languoidId":"fra"}');
select public._append_event_as('tools-take','tools-test','P','v1.TakeComposed','translator','test',
  '{"takeId":"take","unitId":"U","laneId":"L","cardHashes":[],"parentTakeId":null}');
select public._append_event_as('tools-material','tools-test','P','v1.MaterialDefined','owner','test',
  '{"materialId":"study","kind":"fia_study","title":"Study","scope":{"laneId":"L"}}');
select public._append_event_as('tools-lock','tools-test','P','v1.MaterialLocked','owner','test',
  '{"materialId":"study","locked":true}');
select public._append_event_as('tools-progress','tools-test','P','v1.MaterialDefined','owner','test',
  '{"materialId":"progress","kind":"fia_progress","title":"Progress","scope":{"laneId":"L"}}');
select set_config('request.jwt.claim.sub','translator',true);
set local role authenticated;
do $$
declare base jsonb := jsonb_build_object('orgId','tools-test','projectId','P',
  'actorId','translator','deviceId','test','hlc','000000000000001:000000:test');
  p jsonb := '{"translationId":"original","unitId":"U","laneId":"L","parentTranslationId":null,"text":"Hello","origin":"written"}';
  r record;
begin
  for r in select * from public.append_events(jsonb_build_array(base || jsonb_build_object(
    'id','tools-original','type','v1.TextTranslationCreated','payload',p)),4) loop
    if not r.accepted then raise exception 'Original rejected: %',r.reason; end if;
  end loop;
  for r in select * from public.append_events(jsonb_build_array(base || jsonb_build_object(
    'id','tools-child','type','v1.TextTranslationCreated','payload',p ||
      '{"translationId":"child","parentTranslationId":"original","text":"Hello again"}')),4) loop
    if not r.accepted then raise exception 'Child rejected: %',r.reason; end if;
  end loop;
  for r in select * from public.append_events(jsonb_build_array(base || jsonb_build_object(
    'id','tools-overwrite','type','v1.TextTranslationCreated','payload',p || '{"text":"Overwrite"}')),4) loop
    if r.accepted then raise exception 'Immutable original overwritten'; end if;
  end loop;
  for r in select * from public.append_events(jsonb_build_array(base || jsonb_build_object(
    'id','tools-wrong-scope','type','v1.TextTranslationCreated','payload',p ||
      '{"translationId":"wrong","parentTranslationId":"original","unitId":"other"}')),4) loop
    if r.accepted then raise exception 'Cross-passage parent accepted'; end if;
  end loop;
  for r in select * from public.append_events(jsonb_build_array(base || jsonb_build_object(
    'id','tools-metadata','type','v1.TakeMetadataSet','payload',
    '{"takeId":"take","unitId":"U","laneId":"L","name":"Opening","milestones":[]}'::jsonb)),4) loop
    if not r.accepted then raise exception 'Metadata rejected: %',r.reason; end if;
  end loop;
  for r in select * from public.append_events(jsonb_build_array(base || jsonb_build_object(
    'id','tools-locked-edit','type','v1.MaterialFieldSet','payload',
    '{"materialId":"study","fieldId":"hear","text":"overwrite"}'::jsonb)),4) loop
    if r.accepted then raise exception 'Translator overwrote locked FIA guidance'; end if;
  end loop;
  for r in select * from public.append_events(jsonb_build_array(base || jsonb_build_object(
    'id','tools-progress-own','type','v1.MaterialFieldSet','payload',
    '{"materialId":"progress","fieldId":"fia-progress:translator:U:hear","text":"done"}'::jsonb)),4) loop
    if not r.accepted then raise exception 'Personal FIA progress blocked: %',r.reason; end if;
  end loop;
  for r in select * from public.append_events(jsonb_build_array(base || jsonb_build_object(
    'id','tools-progress-other','type','v1.MaterialFieldSet','payload',
    '{"materialId":"progress","fieldId":"fia-progress:other:U:hear","text":"done"}'::jsonb)),4) loop
    if r.accepted then raise exception 'Another participant progress was overwritten'; end if;
  end loop;
  for i in 1..30 loop
    if not public.claim_translation_assist('tools-test','P','L') then raise exception 'AI quota prematurely denied'; end if;
  end loop;
  if public.claim_translation_assist('tools-test','P','L') then raise exception 'AI quota unlimited'; end if;
  if not public.translation_assist_allowed('tools-test','P','L') then raise exception 'Translator AI denied'; end if;
  if public.translation_assist_allowed('tools-test','other','L') then raise exception 'Cross-project AI allowed'; end if;
end $$;
select set_config('request.jwt.claim.sub','viewer',true);
do $$ declare r record; begin
  if public.translation_assist_allowed('tools-test','P','L') then raise exception 'Viewer AI allowed'; end if;
  for r in select * from public.append_events('[{"id":"tools-viewer","orgId":"tools-test","projectId":"P","actorId":"viewer","deviceId":"test","hlc":"000000000000001:000000:test","type":"v1.TextTranslationCreated","payload":{"translationId":"viewer","unitId":"U","laneId":"L","text":"Hello","origin":"written","parentTranslationId":null}}]',4) loop
    if r.accepted then raise exception 'Viewer can write translations'; end if;
  end loop;
end $$;
reset role;
do $$ begin
  if public.validate_payload('v1.TakeMetadataSet','{"takeId":"take","unitId":"U","laneId":"L","name":"x","milestones":[{"verseStart":2,"verseEnd":1,"startMs":0}]}') is null then raise exception 'Invalid verse range accepted'; end if;
  if public.validate_payload('v1.TextTranslationCreated','{"translationId":"t","unitId":"U","laneId":"L","text":"x","origin":"invented","parentTranslationId":null}') is null then raise exception 'Invalid origin accepted'; end if;
end $$;
rollback;
