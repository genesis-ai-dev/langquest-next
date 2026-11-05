-- Verse timing jobs (docs/reference-material.md, decision 62): who may ask,
-- see and take them. The worker and the publisher are the service role; an
-- organization's members read progress; only whoever manages reference
-- material reads the results. Repeatable; every write rolls back.
\set ON_ERROR_STOP on
begin;
update public.server_config set min_client_version = 0;
-- Other smokes may leave jobs; these tests count open ones.
delete from public.timing_jobs;

insert into auth.users (id, email, aud, role) values
  ('52000000-0000-0000-0000-00000000000a', 'tm-admin@example.org', 'authenticated', 'authenticated'),
  ('52000000-0000-0000-0000-00000000000b', 'tm-member@example.org', 'authenticated', 'authenticated'),
  ('52000000-0000-0000-0000-00000000000c', 'tm-stranger@example.org', 'authenticated', 'authenticated');

-- tm-org: an admin who manages reference material, a translator who does not.
select set_config('request.jwt.claim.sub', '', true);
do $$ declare r record; begin
  for r in select * from public.append_events('[
    {"id":"tm-1","type":"v1.OrgCreated","orgId":"tm-org","streamId":"_org","actorId":"52000000-0000-0000-0000-00000000000a","deviceId":"dT","hlc":"000000000000001:000000:dT","payload":{"name":"Timings"}},
    {"id":"tm-2","type":"v1.RoleDefined","orgId":"tm-org","streamId":"_org","actorId":"52000000-0000-0000-0000-00000000000a","deviceId":"dT","hlc":"000000000000002:000000:dT","payload":{"roleId":"admin","name":"Admin","privileges":["manage_reference","manage_structure","translate"]}},
    {"id":"tm-3","type":"v1.RoleDefined","orgId":"tm-org","streamId":"_org","actorId":"52000000-0000-0000-0000-00000000000a","deviceId":"dT","hlc":"000000000000003:000000:dT","payload":{"roleId":"translator","name":"Translator","privileges":["translate"]}},
    {"id":"tm-4","type":"v1.MemberAdded","orgId":"tm-org","streamId":"_org","actorId":"52000000-0000-0000-0000-00000000000a","deviceId":"dT","hlc":"000000000000004:000000:dT","payload":{"profileId":"52000000-0000-0000-0000-00000000000a","roleId":"admin","scope":{"level":"org"}}}
  ]'::jsonb) loop
    if not r.accepted then raise exception 'setup event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;

-- The translator joined by invite, which this smoke does not repeat.
insert into public.org_memberships (org_id, profile_id, scope_key, scope_level, role_id)
  values ('tm-org', '52000000-0000-0000-0000-00000000000b', 'org', 'org', 'translator');

-- 1. Only an admin who manages reference material may ask; the job is theirs.
set role authenticated;
select set_config('request.jwt.claim.sub', '52000000-0000-0000-0000-00000000000b', true);
do $$ begin
  perform public.request_timings('tm-org', 'item1', 'ENGESV', 'ENGESVN2DA', null, array['JHN']);
  raise exception 'a translator must not ask for timings';
exception when insufficient_privilege then null;
end $$;
select set_config('request.jwt.claim.sub', '52000000-0000-0000-0000-00000000000a', true);
create temp table tm_job as select public.request_timings('tm-org', 'item1', 'ENGESV', 'ENGESVN2DA', null, array['JHN']) as id;
grant select on tm_job to authenticated, service_role;
do $$ begin
  if public.request_timings('tm-org', 'item1', 'ENGESV', 'ENGESVN2DA', null, array['JHN']) <> (select id from tm_job) then
    raise exception 'asking twice for the same audio should return the open job';
  end if;
end $$;

-- 2. Progress is for members; the results are for whoever manages reference material.
select set_config('request.jwt.claim.sub', '52000000-0000-0000-0000-00000000000c', true);
do $$ begin
  perform * from public.timing_jobs_for('tm-org');
  raise exception 'a stranger must not see an organization''s timing jobs';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform * from public.timing_job_results('tm-org', (select id from tm_job));
  raise exception 'a stranger must not read timing results';
exception when insufficient_privilege then null;
end $$;
select set_config('request.jwt.claim.sub', '52000000-0000-0000-0000-00000000000b', true);
do $$ begin
  if (select count(*) from public.timing_jobs_for('tm-org')) <> 1 then raise exception 'a member should see the organization''s job'; end if;
  perform * from public.timing_job_results('tm-org', (select id from tm_job));
  raise exception 'a member without Manage reference must not read timing results';
exception when insufficient_privilege then null;
end $$;

-- 3. The worker, the publisher and results-for-publisher are the service
-- role's: neither signed-in people nor signed-out callers run them.
do $$ declare f text; begin
  foreach f in array array['timing_job_claim(text)', 'timing_job_finish(uuid,jsonb,text)', 'timing_job_progress(uuid,int,int,text)',
                           'timing_job_published(uuid)', 'timing_job_results_for_publisher(uuid)', 'timing_jobs_to_publish()'] loop
    if has_function_privilege('authenticated', 'public.' || f, 'execute') then raise exception 'signed-in people may run %', f; end if;
    if has_function_privilege('anon', 'public.' || f, 'execute') then raise exception 'anon may run %', f; end if;
    if not has_function_privilege('service_role', 'public.' || f, 'execute') then raise exception 'the service role may not run %', f; end if;
  end loop;
end $$;
reset role;

-- A second job that publishes to a LangQuest item, finished by the worker.
insert into public.timing_jobs (org_id, item_id, requested_by, bible_id, audio_fileset, books, publish_org, publish_item, requested_at)
  values ('tm-org', 'item2', '52000000-0000-0000-0000-00000000000a', 'ENGESV', 'ENGESVN1DA', array['JHN'], 'langquest', 'langquest.source.eng', now() + interval '1 second');
create temp table tm_pub as select id from public.timing_jobs where audio_fileset = 'ENGESVN1DA';
grant select on tm_pub to service_role, authenticated;

-- 4. Claim is single-winner: each open job goes to one worker, oldest first.
set role service_role;
select set_config('request.jwt.claim.sub', '', true);
create temp table tm_claims (n int, got jsonb);
grant all on tm_claims to service_role;
insert into tm_claims select 1, public.timing_job_claim('worker-a');
insert into tm_claims select 2, public.timing_job_claim('worker-b');
insert into tm_claims select 3, public.timing_job_claim('worker-c');
do $$ declare a jsonb; b jsonb; c jsonb; begin
  select got into a from tm_claims where n = 1;
  select got into b from tm_claims where n = 2;
  select got into c from tm_claims where n = 3;
  if a->>'job_id' <> (select id::text from tm_job) then raise exception 'the oldest open job goes first, got %', a; end if;
  if b->>'job_id' <> (select id::text from tm_pub) then raise exception 'the second worker gets the other job, got %', b; end if;
  if c is not null and c <> 'null'::jsonb then raise exception 'nothing is left to claim, got %', c; end if;
  if (select claimed_by from public.timing_jobs where id = (select id from tm_job)) <> 'worker-a' then raise exception 'the claim records its worker'; end if;
end $$;
-- A claim held under an hour is not taken again; one held for over an hour is.
update public.timing_jobs set claimed_at = now() - interval '2 hours' where id = (select id from tm_job);
do $$ begin
  if public.timing_job_claim('worker-d')->>'job_id' <> (select id::text from tm_job) then raise exception 'a stale claim should be taken over'; end if;
end $$;

-- 5. Progress, then finish: a malformed result is refused whole; results are stored once per chapter.
select public.timing_job_progress((select id from tm_job), 3, 10, 'chapter 3');
do $$ begin
  if (select done || '/' || total || ' ' || note from public.timing_jobs where id = (select id from tm_job)) <> '3/10 chapter 3' then
    raise exception 'progress should be recorded';
  end if;
  begin
    perform public.timing_job_finish((select id from tm_job), '[{"format":"nope","book":"JHN","chapter":1}]'::jsonb, null);
    raise exception 'a result that is not timing@1 must be refused';
  exception when sqlstate '22023' then null;
  end;
  if (select finished_at from public.timing_jobs where id = (select id from tm_job)) is not null then raise exception 'a refused finish must not finish the job'; end if;
end $$;
select public.timing_job_finish((select id from tm_job),
  '[{"format":"timing@1","book":"JHN","chapter":1,"check":{"ok":true}},{"format":"timing@1","book":"JHN","chapter":2,"check":{"ok":false}}]'::jsonb, null);
select public.timing_job_finish((select id from tm_job),
  '[{"format":"timing@1","book":"JHN","chapter":1,"check":{"ok":true}}]'::jsonb, null);
select public.timing_job_finish((select id from tm_pub),
  '[{"format":"timing@1","book":"JHN","chapter":1,"check":{"ok":true,"versification":"eng"},"versification":"eng"}]'::jsonb, null);
do $$ begin
  if (select count(*) from public.timing_job_results where job_id = (select id from tm_job)) <> 2 then raise exception 'finishing twice should keep one row per chapter'; end if;
  if (select count(*) from public.timing_job_results_for_publisher((select id from tm_job))) <> 2 then raise exception 'the publisher reads every chapter'; end if;
  if public.timing_job_claim('worker-e') is not null then raise exception 'a finished job must not be claimed'; end if;
end $$;

-- 6. Results reach the admin of the organization that asked, not a stranger or
-- another organization's admin.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '52000000-0000-0000-0000-00000000000a', true);
do $$ begin
  if (select count(*) from public.timing_job_results('tm-org', (select id from tm_job))) <> 2 then raise exception 'the admin should read the results'; end if;
  if (select count(*) from public.timing_job_results('tm-org', (select id from tm_pub))) <> 1 then raise exception 'the admin should read the publish job''s results'; end if;
  if (select failed from public.timing_jobs_for('tm-org') where id = (select id from tm_job)) <> 1
     or (select results from public.timing_jobs_for('tm-org') where id = (select id from tm_job)) <> 2 then
    raise exception 'timing_jobs_for should count results';
  end if;
end $$;
do $$ begin
  perform * from public.timing_job_results('rls-org', (select id from tm_job));
  raise exception 'an admin must not read results through an organization they do not manage';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  if (select count(*) from public.timing_job_results('tm-org', gen_random_uuid())) <> 0 then raise exception 'an unknown job has no results'; end if;
end $$;
select set_config('request.jwt.claim.sub', '52000000-0000-0000-0000-00000000000c', true);
do $$ begin
  perform * from public.timing_job_results('tm-org', (select id from tm_job));
  raise exception 'a stranger must not read results after the job finished';
exception when insufficient_privilege then null;
end $$;
reset role;

-- 7. The publisher's queue holds finished publish jobs and empties once each is published.
set role service_role;
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  if (select array_agg(id) from public.timing_jobs_to_publish()) is distinct from array[(select id from tm_pub)] then
    raise exception 'only the finished publish job is waiting to be published';
  end if;
end $$;
select public.timing_job_published((select id from tm_pub));
do $$ begin
  if exists (select 1 from public.timing_jobs_to_publish()) then raise exception 'timing_jobs_to_publish should be empty after timing_job_published'; end if;
  perform public.timing_job_published((select id from tm_pub));
  if exists (select 1 from public.timing_jobs_to_publish()) then raise exception 'publishing twice changes nothing'; end if;
end $$;
reset role;

rollback;
