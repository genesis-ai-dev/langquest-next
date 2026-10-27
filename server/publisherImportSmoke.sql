-- Publisher imports (decisions.md 174): staff turn on an importer, an admin
-- asks for a run, the Worker keeps documents for it that nobody can read, and
-- the admin's publishing makes them the organization's.
-- Repeatable against a populated database; every test write rolls back.
\set ON_ERROR_STOP on
begin;
-- An admin with Manage Reference, a coordinator without it.
insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('4b000000-0000-0000-0000-00000000000a', 'pi-admin@example.org', 'authenticated', 'authenticated', '{}'),
  ('4b000000-0000-0000-0000-00000000000b', 'pi-coord@example.org', 'authenticated', 'authenticated', '{}');

select set_config('request.jwt.claim.sub','',true);
do $$ declare r record; begin
  for r in select * from public.append_events('[
    {"id":"pi-o1","type":"v1.OrgCreated","orgId":"pi-org","streamId":"_org","actorId":"4b000000-0000-0000-0000-00000000000a","deviceId":"dP","hlc":"000000000000001:000000:dP","payload":{"name":"Publisher Bible Society"}},
    {"id":"pi-o2","type":"v1.RoleDefined","orgId":"pi-org","streamId":"_org","actorId":"4b000000-0000-0000-0000-00000000000a","deviceId":"dP","hlc":"000000000000002:000000:dP","payload":{"roleId":"admin","name":"Admin","privileges":["invite_members","manage_roles","manage_reference"]}},
    {"id":"pi-o3","type":"v1.RoleDefined","orgId":"pi-org","streamId":"_org","actorId":"4b000000-0000-0000-0000-00000000000a","deviceId":"dP","hlc":"000000000000003:000000:dP","payload":{"roleId":"coord","name":"Coordinator","privileges":["invite_members","manage_structure"]}},
    {"id":"pi-o4","type":"v1.MemberAdded","orgId":"pi-org","streamId":"_org","actorId":"4b000000-0000-0000-0000-00000000000a","deviceId":"dP","hlc":"000000000000004:000000:dP","payload":{"profileId":"4b000000-0000-0000-0000-00000000000a","roleId":"admin","scope":{"level":"org"}}},
    {"id":"pi-o5","type":"v1.MemberAdded","orgId":"pi-org","streamId":"_org","actorId":"4b000000-0000-0000-0000-00000000000a","deviceId":"dP","hlc":"000000000000005:000000:dP","payload":{"profileId":"4b000000-0000-0000-0000-00000000000b","roleId":"coord","scope":{"level":"org"}}}
  ]'::jsonb, (select min_client_version from public.server_config)) loop
    if not r.accepted then raise exception 'setup event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;

create function pg_temp.as_caller(p_profile text) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_profile is null then '' else json_build_object('sub', p_profile)::text end, true);
$$;
create temp table smoke_run (id uuid, v11n_hash text, study text, coll text);
grant all on smoke_run to authenticated;

-- 1. Staff turn the importer on.
select pg_temp.as_caller(null);
do $$ begin
  if public.org_importer_grant('pi-nowhere', 'fia', 'BibleAquifer', 'Staff') <> 'no_org' then raise exception 'an organization that does not exist'; end if;
  if public.org_importer_grant('pi-org', 'fia', 'BibleAquifer', ' ') <> 'say_who' then raise exception 'staff must say who they are'; end if;
  if public.org_importer_grant('pi-org', 'fia', 'BibleAquifer', 'Staff') <> 'granted' then raise exception 'granting'; end if;
  begin perform public.org_importer_grant('pi-org', 'fia', 'not a source!', 'Staff'); raise exception 'a bad source was kept';
  exception when check_violation then null; end;
end $$;

-- 2. Someone without Manage Reference sees no importer and may not ask.
set local role authenticated;
select pg_temp.as_caller('4b000000-0000-0000-0000-00000000000b');
do $$ begin
  if exists (select 1 from public.org_importers('pi-org')) then raise exception 'a coordinator saw the importer'; end if;
  if public.import_request('pi-org', 'fia', '{"languages":["eng"]}')->>'reason' <> 'not_allowed' then raise exception 'a coordinator asked'; end if;
  begin perform public.import_runs_for('pi-org'); raise exception 'a coordinator read the runs';
  exception when insufficient_privilege then null; end;
end $$;

-- 3. The admin asks; one run at a time.
select pg_temp.as_caller('4b000000-0000-0000-0000-00000000000a');
do $$ declare v jsonb; begin
  if (select count(*) from public.org_importers('pi-org')) <> 1 then raise exception 'the admin sees the importer'; end if;
  if public.import_request('pi-org', 'door43', '{}')->>'reason' <> 'no_importer' then raise exception 'an importer not turned on'; end if;
  if public.import_request('pi-org', 'fia', '{"languages":[]}')->>'reason' <> 'bad_options' then raise exception 'no languages'; end if;
  if public.import_request('pi-org', 'fia', '{"languages":["English"]}')->>'reason' <> 'bad_options' then raise exception 'a language name, not a code'; end if;
  v := public.import_request('pi-org', 'fia', '{"languages":["fra","eng","eng"]}');
  if (v->>'ok')::boolean is not true or v#>>'{run,state}' <> 'waiting' or v#>'{run,options,languages}' <> '["eng","fra"]' then raise exception 'asking: %', v; end if;
  insert into smoke_run (id) values ((v#>>'{run,id}')::uuid);
  v := public.import_request('pi-org', 'fia', '{"languages":["eng"]}');
  if v->>'reason' <> 'running' or v#>>'{run,id}' <> (select id::text from smoke_run) then raise exception 'asking again: %', v; end if;
  if jsonb_array_length(public.import_runs_for('pi-org')) <> 1 then raise exception 'the runs'; end if;
end $$;

-- 4. Only the Worker builds a run.
do $$ begin
  begin perform public.import_run_next(600); raise exception 'a client took a run';
  exception when insufficient_privilege then null; end;
  begin perform public.import_run_put_documents((select id from smoke_run), array['{}']); raise exception 'a client stored a document';
  exception when insufficient_privilege then null; end;
  begin perform public.import_run_finish((select id from smoke_run), '[]'); raise exception 'a client finished a run';
  exception when insufficient_privilege then null; end;
  begin perform public.import_run_put_part((select id from smoke_run), 'eng', array['x']); raise exception 'a client said what a part took';
  exception when insufficient_privilege then null; end;
  begin perform public.import_check_next(0); raise exception 'a client looked at a source';
  exception when insufficient_privilege then null; end;
  begin perform public.import_check_save('pi-org', 'fia', '{}'); raise exception 'a client said what is new';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 5. The Worker takes the run, holds it, and keeps documents for it.
select pg_temp.as_caller(null);
do $$ declare v jsonb; h text[]; v11n text; begin
  v := public.import_run_next(600);
  if (v->>'id')::uuid <> (select id from smoke_run) or v->>'source' <> 'BibleAquifer' or v#>'{options,languages}' <> '["eng","fra"]' then raise exception 'the next run: %', v; end if;
  if public.import_run_next(600) is not null then raise exception 'a held run was taken twice'; end if;
  v11n := '{"format":"versification@1","code":"pi-eng","name":"Smoke English","maxVerses":{"JHN":[51]}}';
  begin perform public.import_run_put_documents((select id from smoke_run),
      array['{"format":"study@1","title":"John 1","deps":["' || encode(sha256(convert_to(v11n, 'UTF8')), 'hex') || '"]}']);
    raise exception 'a document depending on one the run lacks';
  exception when insufficient_privilege then null; end;
  h := public.import_run_put_documents((select id from smoke_run), array[v11n]);
  h := h || public.import_run_put_documents((select id from smoke_run),
      array['{"format":"study@1","title":"John 1:1-5","deps":["' || h[1] || '"]}']);
  h := h || public.import_run_put_documents((select id from smoke_run),
      array['{"format":"collection@1","title":"FIA (English)","entries":[{"ref":"JHN 1:1-5","title":"John 1:1-5","doc":"' || h[2] || '"}],"deps":["' || h[1] || '","' || h[2] || '"]}']);
  update smoke_run set v11n_hash = h[1], study = h[2], coll = h[3];
  perform public.import_run_put_part((select id from smoke_run), 'eng', array['pi-jhn-p1-v1', 'pi-jhn-p2-v1']);
  if not public.import_run_save((select id from smoke_run), '{"languages":["eng"]}', 1, 2) then raise exception 'saving'; end if;
  if (select org_id from public.library_document_access where hash = h[2]) is distinct from '_import.' || (select id from smoke_run) then
    raise exception 'the run keeps its documents under its own key';
  end if;
end $$;

-- 6. Nobody reads a run's documents, and an unfinished run cannot be published.
set local role authenticated;
select pg_temp.as_caller('4b000000-0000-0000-0000-00000000000a');
do $$ declare v jsonb; begin
  if exists (select 1 from public.library_get_documents('pi-org', array[(select study from smoke_run)])) then raise exception 'the admin read a run''s document early'; end if;
  v := public.import_run_accept('pi-org', (select id from smoke_run));
  if v->>'reason' <> 'not_ready' then raise exception 'publishing an unfinished run: %', v; end if;
  v := public.import_runs_for('pi-org')->0;
  if v->>'state' <> 'importing' or (v->>'done')::int <> 1 or (v->>'total')::int <> 2 then raise exception 'the progress: %', v; end if;
end $$;
reset role;

-- 7. The Worker finishes: every item's document must be the run's.
select pg_temp.as_caller(null);
do $$ begin
  begin perform public.import_run_finish((select id from smoke_run),
      jsonb_build_array(jsonb_build_object('itemId', 'fia.eng', 'kind', 'material', 'name', 'FIA (English)', 'docHash', repeat('0', 64))));
    raise exception 'an item whose document is not the run''s';
  exception when invalid_parameter_value then null; end;
  if not public.import_run_finish((select id from smoke_run),
      jsonb_build_array(jsonb_build_object('itemId', 'fia.eng', 'kind', 'material', 'name', 'FIA (English)', 'description', 'FIA in English.', 'docHash', (select coll from smoke_run), 'count', 1))) then
    raise exception 'finishing';
  end if;
  if public.import_run_save((select id from smoke_run), null, 2, 2) then raise exception 'a finished run is no longer the Worker''s'; end if;
end $$;

-- 8. The admin publishes: the documents become the organization's, once.
set local role authenticated;
select pg_temp.as_caller('4b000000-0000-0000-0000-00000000000a');
do $$ declare v jsonb; begin
  if public.import_runs_for('pi-org')->0->>'state' <> 'ready' then raise exception 'ready'; end if;
  v := public.import_run_accept('pi-org', (select id from smoke_run));
  if v#>>'{items,0,itemId}' <> 'fia.eng' or v#>>'{items,0,docHash}' <> (select coll from smoke_run) then raise exception 'the items to publish: %', v; end if;
  if (select count(*) from public.library_get_documents('pi-org', array[(select study from smoke_run), (select coll from smoke_run), (select v11n_hash from smoke_run)])) <> 3 then
    raise exception 'the organization reads what it published';
  end if;
  if public.import_run_accept('pi-org', (select id from smoke_run))->'items' is null then raise exception 'publishing again'; end if;
  if public.import_runs_for('pi-org')->0->>'state' <> 'published' then raise exception 'published'; end if;
  if public.import_run_withdraw('pi-org', (select id from smoke_run)) <> 'not_open' then raise exception 'a published run cannot be taken back'; end if;
end $$;
reset role;
select pg_temp.as_caller(null);
do $$ begin
  if exists (select 1 from public.library_document_access where org_id = '_import.' || (select id from smoke_run)) then raise exception 'the run''s own key is gone'; end if;
end $$;

-- 9. Once a day the Worker looks at the source of a published import; the admin sees what is new.
create function pg_temp.next_check(p_org text) returns jsonb language plpgsql as $$
declare v jsonb; begin
  -- Other organizations in a populated database may come first.
  for i in 1..1000 loop
    v := public.import_check_next(0);
    if v is null or v->>'orgId' = p_org then return v; end if;
  end loop;
  raise exception 'never came to %', p_org;
end $$;
select pg_temp.as_caller(null);
do $$ declare v jsonb; w jsonb; begin
  v := pg_temp.next_check('pi-org');
  if v->>'importer' <> 'fia' or v->>'source' <> 'BibleAquifer' or v#>'{parts,eng}' <> '["pi-jhn-p1-v1","pi-jhn-p2-v1"]' then raise exception 'what to look at: %', v; end if;
  for i in 1..1000 loop
    w := public.import_check_next(86400);
    exit when w is null;
    if w->>'orgId' = 'pi-org' then raise exception 'a source looked at twice in a day'; end if;
  end loop;
  begin perform public.import_check_save('pi-org', 'fia', '{"eng":{"added":-1,"updated":0}}'); raise exception 'a count below nothing';
  exception when invalid_parameter_value then null; end;
  perform public.import_check_save('pi-org', 'fia', '{"eng":{"added":2,"updated":1}}');
end $$;
set local role authenticated;
select pg_temp.as_caller('4b000000-0000-0000-0000-00000000000a');
do $$ declare v record; begin
  select * into v from public.org_importers('pi-org');
  if v.found <> '{"eng":{"added":2,"updated":1}}' or v.checked_at is null then raise exception 'the admin sees what is new: %', v.found; end if;
  update smoke_run set id = (public.import_request('pi-org', 'fia', '{"languages":["eng"]}')#>>'{run,id}')::uuid;
end $$;
reset role;

-- 10. Importing it again takes in what was new: the old list goes, and nothing counts as new.
select pg_temp.as_caller(null);
do $$ declare h text[]; begin
  perform public.import_run_next(600);
  h := public.import_run_put_documents((select id from smoke_run), array['{"format":"versification@1","code":"pi-eng","name":"Smoke English","maxVerses":{"JHN":[51]}}']);
  perform public.import_run_put_part((select id from smoke_run), 'eng', array['pi-jhn-p1-v1.1', 'pi-jhn-p2-v1', 'pi-jhn-p3-v1']);
  perform public.import_run_finish((select id from smoke_run),
    jsonb_build_array(jsonb_build_object('itemId', 'fia.eng', 'kind', 'material', 'name', 'FIA (English)', 'docHash', h[1], 'count', 3)));
end $$;
set local role authenticated;
select pg_temp.as_caller('4b000000-0000-0000-0000-00000000000a');
do $$ begin
  perform public.import_run_accept('pi-org', (select id from smoke_run));
  if (select i.found from public.org_importers('pi-org') i) <> '{}' then raise exception 'what was new is in'; end if;
end $$;
reset role;
select pg_temp.as_caller(null);
do $$ begin
  if (select count(*) from public.import_run_parts p join public.import_runs r on r.id = p.run_id where r.org_id = 'pi-org') <> 1 then raise exception 'one list a part'; end if;
  if pg_temp.next_check('pi-org')#>'{parts,eng}' <> '["pi-jhn-p1-v1.1","pi-jhn-p2-v1","pi-jhn-p3-v1"]' then raise exception 'the next look starts from the new list'; end if;
end $$;

-- 11. Taking back a run drops what it made; turning the importer off stops the rest.
set local role authenticated;
select pg_temp.as_caller('4b000000-0000-0000-0000-00000000000a');
do $$ declare v jsonb; begin
  v := public.import_request('pi-org', 'fia', '{"languages":["eng"]}');
  update smoke_run set id = (v#>>'{run,id}')::uuid;
end $$;
reset role;
select pg_temp.as_caller(null);
do $$ begin
  perform public.import_run_next(600);
  perform public.import_run_put_documents((select id from smoke_run), array['{"format":"versification@1","code":"pi-x","name":"Taken back","maxVerses":{}}']);
end $$;
set local role authenticated;
select pg_temp.as_caller('4b000000-0000-0000-0000-00000000000a');
do $$ begin
  if public.import_run_withdraw('pi-org', (select id from smoke_run)) <> 'withdrawn' then raise exception 'taking back a run'; end if;
  if public.import_runs_for('pi-org')->0->>'state' <> 'withdrawn' then raise exception 'withdrawn'; end if;
  perform public.import_request('pi-org', 'fia', '{"languages":["eng"]}');
end $$;
reset role;
select pg_temp.as_caller(null);
do $$ begin
  if exists (select 1 from public.library_document_access where org_id = '_import.' || (select id from smoke_run)) then raise exception 'a withdrawn run keeps nothing'; end if;
  if public.org_importer_revoke('pi-org', 'fia', 'Staff') <> 'revoked' then raise exception 'revoking'; end if;
  if public.org_importer_revoke('pi-org', 'fia', 'Staff') <> 'not_granted' then raise exception 'revoking twice'; end if;
  if public.import_run_next(600) is not null then raise exception 'a run went on after its importer was turned off'; end if;
  if (select r.failure from public.import_runs r where r.org_id = 'pi-org' order by r.requested_at desc limit 1) is null then raise exception 'the open run failed'; end if;
  if (select count(*) from public.org_importer_list() l where l.org_id = 'pi-org' and l.revoked_by = 'Staff' and l.runs = 4) <> 1 then raise exception 'the staff list'; end if;
end $$;
set local role authenticated;
select pg_temp.as_caller('4b000000-0000-0000-0000-00000000000a');
do $$ begin
  if exists (select 1 from public.org_importers('pi-org')) then raise exception 'a revoked importer still shows'; end if;
  if public.import_request('pi-org', 'fia', '{"languages":["eng"]}')->>'reason' <> 'no_importer' then raise exception 'asking after revoking'; end if;
end $$;
reset role;

rollback;
\echo 'publisher import smoke ok'
