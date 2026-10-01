-- Reporting, acting on reports, and blocking (decisions.md 48).
-- Repeatable; every write rolls back.
\set ON_ERROR_STOP on
begin;
-- a: organization admin · t: translator · r: reviewer who reports
-- l: manages another language only · x: not a member
insert into auth.users (id, email) values
  ('e0000000-0000-0000-0000-00000000000a', 'mod-admin@example.org'),
  ('e0000000-0000-0000-0000-00000000000b', 'mod-translator@example.org'),
  ('e0000000-0000-0000-0000-00000000000c', 'mod-reporter@example.org'),
  ('e0000000-0000-0000-0000-00000000000d', 'mod-lane-admin@example.org'),
  ('e0000000-0000-0000-0000-00000000000e', 'mod-outsider@example.org');
select public._apply_org_event('mod-org','v1.RoleDefined',
  '{"roleId":"admin","name":"Admin","privileges":["invite_members","manage_structure","translate","review"]}', '000000000000001:000001:test');
select public._apply_org_event('mod-org','v1.RoleDefined',
  '{"roleId":"member","name":"Member","privileges":["translate","review"]}', '000000000000001:000002:test');
select public._apply_org_event('mod-org','v1.OrgMemberAdded',
  '{"profileId":"e0000000-0000-0000-0000-00000000000a","roleId":"admin","scope":{"level":"org"}}','000000000000002:000001:test');
select public._apply_org_event('mod-org','v1.OrgMemberAdded',
  '{"profileId":"e0000000-0000-0000-0000-00000000000b","roleId":"member","scope":{"level":"org"}}','000000000000002:000002:test');
select public._apply_org_event('mod-org','v1.OrgMemberAdded',
  '{"profileId":"e0000000-0000-0000-0000-00000000000c","roleId":"member","scope":{"level":"org"}}','000000000000002:000003:test');
select public._apply_org_event('mod-org','v1.OrgMemberAdded',
  '{"profileId":"e0000000-0000-0000-0000-00000000000d","roleId":"admin","scope":{"level":"project","projectId":"p2"}}','000000000000002:000004:test');

-- The translator's version (take, submission, what changed), a note, and the reviewer's review.
select public._append_event_as('mod-take','mod-org','p1','v1.TakeComposed','e0000000-0000-0000-0000-00000000000b','dev-t',
  '{"takeId":"take1","unitId":"u1","laneId":"l1","cardHashes":["h1"],"parentTakeId":null}');
select public._append_event_as('mod-submit','mod-org','p1','v1.TakeSubmitted','e0000000-0000-0000-0000-00000000000b','dev-t',
  '{"takeId":"take1"}');
select public._append_event_as('mod-change','mod-org','p1','v1.NoteAdded','e0000000-0000-0000-0000-00000000000b','dev-t',
  '{"noteId":"c1","unitId":"u1","laneId":"l1","anchor":{"kind":"version","takeId":"take1","role":"change"},"text":"first"}');
select public._append_event_as('mod-note','mod-org','p1','v1.NoteAdded','e0000000-0000-0000-0000-00000000000b','dev-t',
  '{"noteId":"n1","unitId":"u1","laneId":"l1","anchor":{"kind":"passage"},"text":"something offensive"}');
select public._append_event_as('mod-review','mod-org','p1','v1.ReviewRecorded','e0000000-0000-0000-0000-00000000000c','dev-r',
  '{"reviewId":"rev1","takeId":"take1","kindId":"peer","outcome":"looks_good","via":"app"}');

create function pg_temp.fails(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then return sqlstate;
end $$;
create function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p, true);
$$;

-- ---- reporting -------------------------------------------------------------
select pg_temp.as_user('');
do $$ begin
  if pg_temp.fails($q$select public.report_content('rep-0','mod-org','p1','note','n1','e0000000-0000-0000-0000-00000000000b','offensive')$q$) <> '42501' then
    raise exception 'reported while signed out';
  end if;
end $$;

select pg_temp.as_user('e0000000-0000-0000-0000-00000000000c');
select public.report_content('rep-1','mod-org','p1','note','n1','e0000000-0000-0000-0000-00000000000b','offensive','  said this to me  ','u1','l1');
-- A retried send is the same report.
select public.report_content('rep-1','mod-org','p1','note','n1','e0000000-0000-0000-0000-00000000000b','offensive','  said this to me  ','u1','l1');
select public.report_content('rep-2','mod-org','p1','version','take1','e0000000-0000-0000-0000-00000000000b','sexual');
select public.report_content('rep-3','mod-org','_org','person','e0000000-0000-0000-0000-00000000000b','e0000000-0000-0000-0000-00000000000b','harassment');
select public.report_content('rep-4','mod-org','_org','person','e0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-00000000000a','harassment');
do $$ begin
  if (select count(*) from public.content_reports where id = 'rep-1') <> 1 then raise exception 'retry duplicated a report'; end if;
  if (select details from public.content_reports where id = 'rep-1') <> 'said this to me' then raise exception 'details not trimmed'; end if;
  if (select reporter_id from public.content_reports where id = 'rep-1') <> 'e0000000-0000-0000-0000-00000000000c' then raise exception 'reporter not kept for staff'; end if;
  -- Blamed on someone who did not make it.
  if pg_temp.fails($q$select public.report_content('rep-5','mod-org','p1','note','n1','e0000000-0000-0000-0000-00000000000a','spam')$q$) <> '22023' then
    raise exception 'reported under the wrong maker';
  end if;
  if pg_temp.fails($q$select public.report_content('rep-6','mod-org','p1','note','nope','e0000000-0000-0000-0000-00000000000b','spam')$q$) <> '22023' then
    raise exception 'reported something that is not on the record';
  end if;
  if pg_temp.fails($q$select public.report_content('rep-7','mod-org','p1','review','rev1','e0000000-0000-0000-0000-00000000000c','spam')$q$) <> '22023' then
    raise exception 'reported their own review';
  end if;
  if pg_temp.fails($q$select public.report_content('rep-8','mod-org','p1','person','e0000000-0000-0000-0000-00000000000b','e0000000-0000-0000-0000-00000000000b','spam')$q$) <> '22023' then
    raise exception 'a person reported in a language partition';
  end if;
  if pg_temp.fails($q$select public.report_content('rep-9','mod-org','p1','note','n1','e0000000-0000-0000-0000-00000000000b','rude')$q$) <> '22023' then
    raise exception 'an unknown reason was accepted';
  end if;
  if pg_temp.fails($q$select public.report_content('rep-10','mod-org',null,'note','n1','e0000000-0000-0000-0000-00000000000b','spam')$q$) <> '22023' then
    raise exception 'a report without a partition was not refused as invalid';
  end if;
end $$;

select pg_temp.as_user('e0000000-0000-0000-0000-00000000000e');
do $$ begin
  if pg_temp.fails($q$select public.report_content('rep-11','mod-org','p1','note','n1','e0000000-0000-0000-0000-00000000000b','spam')$q$) <> '42501' then
    raise exception 'an outsider reported';
  end if;
  if pg_temp.fails($q$select public.report_content('rep-1','mod-org','p1','note','n1','e0000000-0000-0000-0000-00000000000b','offensive')$q$) <> '22023' then
    raise exception 'someone else reused a report id';
  end if;
end $$;

-- ---- who sees reports ------------------------------------------------------
do $$ begin
  perform pg_temp.as_user('e0000000-0000-0000-0000-00000000000b');
  if exists (select 1 from public.org_content_reports('mod-org')) then raise exception 'a translator sees reports'; end if;
  perform pg_temp.as_user('e0000000-0000-0000-0000-00000000000d');
  if exists (select 1 from public.org_content_reports('mod-org')) then raise exception 'another language''s admin sees reports'; end if;
  perform pg_temp.as_user('e0000000-0000-0000-0000-00000000000a');
  if (select count(*) from public.org_content_reports('mod-org')) <> 3 then raise exception 'the admin does not see the open reports'; end if;
  if exists (select 1 from public.org_content_reports('mod-org') where id = 'rep-4') then raise exception 'the admin sees a report about themselves'; end if;
  if not has_function_privilege('authenticated', 'public.org_content_reports(text)', 'execute') then raise exception 'moderators cannot list'; end if;
  if has_table_privilege('authenticated', 'public.content_reports', 'select') then raise exception 'reports readable directly'; end if;
end $$;

-- ---- acting on reports -----------------------------------------------------
select pg_temp.as_user('e0000000-0000-0000-0000-00000000000b');
do $$ begin
  if pg_temp.fails($q$select public.remove_content('mod-org','p1','note','n1','mine')$q$) <> '42501' then raise exception 'a translator removed content'; end if;
  if pg_temp.fails($q$select public.dismiss_reports('mod-org','p1','note','n1')$q$) <> '42501' then raise exception 'a translator dismissed a report'; end if;
end $$;

select pg_temp.as_user('e0000000-0000-0000-0000-00000000000a');
do $$ declare n int; begin
  n := public.remove_content('mod-org','p1','version','take1','offensive');
  if n <> 3 then raise exception 'version removal redacted % events, expected take, submission and what changed', n; end if;
  if public.remove_content('mod-org','p1','version','take1','again') <> 0 then raise exception 'removed twice'; end if;
  if (select count(*) from public.events where type = 'v1.Redacted' and actor_id = 'e0000000-0000-0000-0000-00000000000a'
        and payload->>'eventId' in ('mod-take','mod-submit','mod-change')) <> 3 then raise exception 'redactions not appended as the admin'; end if;
  if exists (select 1 from public.events where type = 'v1.Redacted' and payload->>'eventId' in ('mod-note','mod-review')) then
    raise exception 'removal reached other content';
  end if;
  if (select resolution from public.content_reports where id = 'rep-2') is distinct from 'removed' then raise exception 'report not closed by removal'; end if;
  perform public.dismiss_reports('mod-org','p1','note','n1');
  if (select resolution from public.content_reports where id = 'rep-1') is distinct from 'dismissed' then raise exception 'report not dismissed'; end if;
  if pg_temp.fails($q$select public.remove_content('mod-org','_org','person','e0000000-0000-0000-0000-00000000000b')$q$) <> '22023' then
    raise exception 'a person was removed as content';
  end if;
  -- Nobody can dismiss a report about themselves.
  perform public.dismiss_reports('mod-org','_org','person','e0000000-0000-0000-0000-00000000000a');
  if (select resolved_at from public.content_reports where id = 'rep-4') is not null then raise exception 'dismissed a report about themselves'; end if;
end $$;

-- Something already removed takes no new report.
select pg_temp.as_user('e0000000-0000-0000-0000-00000000000c');
select public.report_content('rep-12','mod-org','p1','version','take1','e0000000-0000-0000-0000-00000000000b','spam');
do $$ begin
  if exists (select 1 from public.content_reports where id = 'rep-12') then raise exception 'reported something already removed'; end if;
end $$;

-- ---- as the app calls them: the authenticated role, through the grants ----
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-00000000000c',true);
set local role authenticated;
select public.report_content('rep-30','mod-org','p1','note','n1','e0000000-0000-0000-0000-00000000000b','spam');
reset role;
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-00000000000a',true);
set local role authenticated;
do $$ begin
  if not exists (select 1 from public.org_content_reports('mod-org') where id = 'rep-30') then
    raise exception 'the app cannot list reports';
  end if;
end $$;
select public.dismiss_reports('mod-org','p1','note','n1');
select public.remove_content('mod-org','p1','review','rev1','checked through the grants');
reset role;
do $$ begin
  if (select resolution from public.content_reports where id = 'rep-30') <> 'dismissed' then raise exception 'dismiss through the grants failed'; end if;
  if not exists (select 1 from public.events where id = 'removed:mod-review') then raise exception 'remove through the grants failed'; end if;
end $$;

-- ---- staff -----------------------------------------------------------------
do $$ begin
  if has_function_privilege('authenticated', 'public.staff_resolve_report(text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.suspend_account(text,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public._remove_content(text,text,text,text,text,text)', 'execute') then
    raise exception 'the app can act as staff';
  end if;
end $$;
select pg_temp.as_user('e0000000-0000-0000-0000-00000000000c');
select public.report_content('rep-13','mod-org','p1','note','n1','e0000000-0000-0000-0000-00000000000b','violence');
do $$ begin
  if public.staff_resolve_report('rep-13','remove') <> 1 then raise exception 'staff removal did not redact the note'; end if;
  if (select actor_id from public.events where id = 'removed:mod-note') <> 'service' then raise exception 'staff removal not by the service actor'; end if;
  perform public.staff_resolve_report('rep-4','dismiss');
  if (select resolution from public.content_reports where id = 'rep-4') <> 'dismissed' then raise exception 'staff could not dismiss'; end if;
  if not public.suspend_account('e0000000-0000-0000-0000-00000000000b') then raise exception 'suspend found nobody'; end if;
  if (select banned_until from auth.users where id::text = 'e0000000-0000-0000-0000-00000000000b') <> 'infinity' then raise exception 'not suspended'; end if;
  perform public.suspend_account('e0000000-0000-0000-0000-00000000000b', false);
  if (select banned_until from auth.users where id::text = 'e0000000-0000-0000-0000-00000000000b') is not null then raise exception 'not let back'; end if;
end $$;

-- ---- blocking --------------------------------------------------------------
select pg_temp.as_user('e0000000-0000-0000-0000-00000000000c');
select public.set_blocked('e0000000-0000-0000-0000-00000000000b', true);
select public.set_blocked('e0000000-0000-0000-0000-00000000000b', true);
select public.set_blocked('e0000000-0000-0000-0000-00000000000a', true);
select public.set_blocked('e0000000-0000-0000-0000-00000000000a', false);
select pg_temp.as_user('e0000000-0000-0000-0000-00000000000a');
select public.set_blocked('e0000000-0000-0000-0000-00000000000c', true);
do $$ begin
  perform pg_temp.as_user('e0000000-0000-0000-0000-00000000000c');
  if pg_temp.fails($q$select public.set_blocked('e0000000-0000-0000-0000-00000000000c', true)$q$) <> '22023' then raise exception 'blocked themselves'; end if;
  if (select array_agg(blocked_id) from public.user_blocks where blocker_id = 'e0000000-0000-0000-0000-00000000000c')
       <> array['e0000000-0000-0000-0000-00000000000b'] then raise exception 'block list wrong'; end if;
end $$;
-- Each person reads only their own list.
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-00000000000c',true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.user_blocks) <> 1 then raise exception 'read someone else''s blocks'; end if;
end $$;
reset role;

-- ---- account deletion forgets blocks and who reported ----------------------
select pg_temp.as_user('e0000000-0000-0000-0000-00000000000c');
select public.delete_my_account();
do $$ begin
  if exists (select 1 from public.user_blocks where 'e0000000-0000-0000-0000-00000000000c' in (blocker_id, blocked_id)) then
    raise exception 'blocks kept after deletion';
  end if;
  if exists (select 1 from public.content_reports where reporter_id = 'e0000000-0000-0000-0000-00000000000c') then
    raise exception 'reporter kept after deletion';
  end if;
  if (select count(*) from public.content_reports where id like 'rep-%') <> 6 then raise exception 'reports lost with the reporter'; end if;
end $$;
rollback;
