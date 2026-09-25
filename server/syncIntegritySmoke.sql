-- Isolated database only; all fixtures roll back.
\set ON_ERROR_STOP on
begin;
select public._apply_member_event('sync-compat','P','v1.MemberAdded',
  '{"profileId":"compat","role":"owner"}', '000000000000001:000000:test');
select set_config('request.jwt.claims', '{"sub":"compat","role":"authenticated"}', true);
do $$
declare result record; facts integer; version integer;
begin
  foreach version in array array[0,1,4,999,null] loop
    perform public.require_client_version(version);
    perform * from public.append_events('[]'::jsonb,version);
    perform * from public.pull_events('sync-compat','P',0,10,version);
  end loop;
  perform * from public.append_events('[]'::jsonb);
  for result in select * from public.append_events('[
    {"id":"sync-compat-project","orgId":"sync-compat","projectId":"P","type":"v1.ProjectCreated","actorId":"compat","deviceId":"old","hlc":"000000000000002:000000:old","payload":{"name":"Compatibility","sourceLanguoidId":"eng"}},
    {"id":"sync-compat-bible","orgId":"sync-compat","projectId":"P","type":"v1.BiblePassageSelected","actorId":"compat","deviceId":"new","hlc":"000000000000003:000000:new","payload":{"laneId":"L","book":"gen","start":1,"end":5}},
    {"id":"sync-compat-invalid","orgId":"sync-compat","projectId":"P","type":"v1.BiblePassageSelected","actorId":"compat","deviceId":"old","hlc":"000000000000004:000000:old","payload":{"laneId":"L","book":"gen","start":0,"end":5}}
  ]'::jsonb,0) loop
    if result.accepted is distinct from (result.id <> 'sync-compat-invalid') then
      raise exception 'Unexpected append result: %',row_to_json(result);
    end if;
  end loop;
  select count(*) into facts from public.pull_events('sync-compat','P',0,10,0);
  if facts <> 2 then raise exception 'Old client did not receive all facts: %',facts; end if;
  perform set_config('request.jwt.claims','{"sub":"outsider","role":"authenticated"}',true);
  begin
    perform * from public.pull_events('sync-compat','P',0,10,0);
    raise exception 'Old version bypassed membership';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.server_config set min_client_version=99;
    raise exception 'Global upgrade gate can be re-enabled';
  exception when check_violation then null;
  end;
end $$;
rollback;
