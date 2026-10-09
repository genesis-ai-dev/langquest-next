-- Exercises the library's server contract (docs/library.md) on a fresh local
-- database, after smoke.sql. Run via `npm run db:test`. Fails loudly on any
-- unexpected result.

\set ON_ERROR_STOP on

-- Session helpers: an event envelope on a rising clock, a push that must be
-- accepted, a document's name, and the hashes the script has seen.
create temp sequence lib_clock start 20001;
create temp table lib_docs (k text primary key, hash text not null, body text not null);

create function pg_temp.ev(p_id text, p_org text, p_actor text, p_type text, p_payload jsonb, p_hlc text default null)
returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'orgId', p_org, 'streamId', '_org', 'actorId', p_actor, 'deviceId', 'd-' || p_actor,
    'hlc', coalesce(p_hlc, lpad(nextval('lib_clock')::text, 15, '0') || ':000000:d-' || p_actor), 'type', p_type, 'payload', p_payload);
$$;
create function pg_temp.push(p_events jsonb) returns void language plpgsql as $$
declare r record;
begin
  for r in select * from public.append_events(p_events) loop
    if not r.accepted then raise exception 'event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;
create function pg_temp.push1(p_event jsonb) returns void language sql as $$ select pg_temp.push(jsonb_build_array(p_event)); $$;
create function pg_temp.hash_of(p_body text) returns text language sql as $$ select encode(sha256(convert_to(p_body, 'UTF8')), 'hex'); $$;
create function pg_temp.h(p_k text) returns text language sql as $$ select hash from lib_docs where k = p_k; $$;
create function pg_temp.body(p_k text, p_body text) returns text language sql as $$
  insert into lib_docs (k, hash, body) values (p_k, pg_temp.hash_of(p_body), p_body) returning hash;
$$;
create function pg_temp.put(p_org text, p_k text) returns text language plpgsql as $$
declare v text;
begin
  v := public.library_put_document(p_org, (select body from lib_docs where k = p_k));
  if v <> pg_temp.h(p_k) then raise exception 'put % named it %, expected %', p_k, v, pg_temp.h(p_k); end if;
  return v;
end $$;
create function pg_temp.readable(p_org text, variadic p_keys text[]) returns int language sql as $$
  select count(*)::int from public.library_get_documents(p_org, array(select pg_temp.h(k) from unnest(p_keys) k));
$$;
create function pg_temp.pins(p_org text, p_k text) returns int language sql as $$
  select count(*)::int from public.events e
  where e.org_id = p_org and e.stream_id = '_org' and e.type = 'v1.LibraryPinned' and e.payload->>'docHash' = pg_temp.h(p_k);
$$;

-- 1. Three organizations, each bootstrapped by its creator. libB also has a
--    member who may only look.
do $$
declare
  v_all jsonb := '["manage_structure","invite_members","manage_roles","manage_templates","shape_templates","manage_reference","manage_flows","manage_teams","assign_work","override_checkpoints","translate","fill_reference","send_to_reviewers","review","view_status"]';
  o record;
begin
  for o in select * from (values ('libA', 'alice', 'Alpha Translators'), ('libB', 'bob', 'Beta Mission'), ('libC', 'carol', 'Gamma Team')) t (org, actor, name) loop
    perform set_config('request.jwt.claim.sub', o.actor, false);
    perform pg_temp.push(jsonb_build_array(
      pg_temp.ev(o.org || '-1', o.org, o.actor, 'v1.OrgCreated', jsonb_build_object('name', o.name)),
      pg_temp.ev(o.org || '-2', o.org, o.actor, 'v1.RoleDefined', jsonb_build_object('roleId', 'admin', 'name', 'Admin', 'privileges', v_all)),
      pg_temp.ev(o.org || '-3', o.org, o.actor, 'v1.MemberAdded', jsonb_build_object('profileId', o.actor, 'roleId', 'admin', 'scope', jsonb_build_object('level', 'org')))));
  end loop;
  perform set_config('request.jwt.claim.sub', 'bob', false);
  perform pg_temp.push(jsonb_build_array(
    pg_temp.ev('libB-4', 'libB', 'bob', 'v1.RoleDefined', '{"roleId":"viewer","name":"Viewer","privileges":["view_status"]}'),
    pg_temp.ev('libB-5', 'libB', 'bob', 'v1.MemberAdded', '{"profileId":"vic","roleId":"viewer","scope":{"level":"org"}}')));
end $$;

-- The documents: a versification, templates on it, a study guide and a
-- collection of it, and an unshared versification with material on it.
select pg_temp.body('V', '{"code":"eng","format":"versification@1","mappedVerses":{},"maxVerses":{"GEN":[31,25]},"name":"English"}');
select pg_temp.body('V2', '{"code":"org","format":"versification@1","mappedVerses":{},"maxVerses":{"GEN":[31,25]},"name":"Original"}');
select pg_temp.body('T1', format('{"bible":{"books":[{"book":"GEN","name":"Genesis"}],"divide":"chapters","versification":"%s"},"deps":["%s"],"description":"","format":"template@1","levels":[{"name":"Book"},{"name":"Chapter"}],"name":"Genesis","structure":"bible"}', pg_temp.h('V'), pg_temp.h('V')));
select pg_temp.body('T2', replace((select body from lib_docs where k = 'T1'), '"name":"Genesis","structure"', '"name":"Genesis v2","structure"'));
select pg_temp.body('T3', replace((select body from lib_docs where k = 'T1'), '"name":"Genesis","structure"', '"name":"Genesis v3","structure"'));
select pg_temp.body('T4', replace((select body from lib_docs where k = 'T1'), '"name":"Genesis","structure"', '"name":"Genesis v4","structure"'));
select pg_temp.body('TB', replace((select body from lib_docs where k = 'T1'), '"name":"Genesis","structure"', '"name":"Beta Genesis","structure"'));
select pg_temp.body('S', format('{"about":"","deps":["%s"],"format":"study@1","language":"eng","pattern":"FIA","ref":"GEN 1:1-2:3","resources":[],"source":"test","steps":[{"id":"s1","text":"Listen.","title":"Listen"}],"terms":[],"title":"Creation","versification":"%s"}', pg_temp.h('V'), pg_temp.h('V')));
select pg_temp.body('C', format('{"deps":["%s","%s"],"description":"","entries":[{"doc":"%s","ref":"GEN 1:1-2:3","title":"Creation"}],"format":"collection@1","title":"FIA Genesis","versification":"%s"}',
  least(pg_temp.h('S'), pg_temp.h('V')), greatest(pg_temp.h('S'), pg_temp.h('V')), pg_temp.h('S'), pg_temp.h('V')));
select pg_temp.body('M', format('{"deps":["%s"],"format":"material@1","kind":"brief","links":[{"ref":"GEN 1:1"}],"title":"Brief","versification":"%s"}', pg_temp.h('V2'), pg_temp.h('V2')));

-- 2. Putting and getting documents.
select set_config('request.jwt.claim.sub', 'alice', false);
do $$ declare n int; begin
  perform pg_temp.put('libA', 'V');
  perform pg_temp.put('libA', 'V');  -- again: same name, nothing new
  perform pg_temp.put('libA', 'T1');
  if pg_temp.readable('libA', 'V', 'T1') <> 2 then raise exception 'owner should read what it put'; end if;
  select count(*) into n from public.library_documents where hash = pg_temp.h('T1') and format = 'template@1' and deps = array[pg_temp.h('V')];
  if n <> 1 then raise exception 'document row wrong'; end if;

  -- Not JSON, not an object, an unknown format, deps that are not hashes.
  begin perform public.library_put_document('libA', 'not json'); raise exception 'non-JSON accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.library_put_document('libA', '[1,2]'); raise exception 'array accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.library_put_document('libA', '{"deps":[],"format":"song@1"}'); raise exception 'unknown format accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.library_put_document('libA', '{"deps":["abc"],"format":"material@1","kind":"brief","title":"x"}'); raise exception 'bad deps accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.library_put_document('libA', '{"format":"material@1","kind":"brief","title":"x"}'); raise exception 'missing deps accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.library_put_document('libA', '{"deps":[],"format":"material@1","body":"' || repeat('a', 4194304) || '"}'); raise exception 'oversize accepted';
  exception when sqlstate '54000' then null; end;
  begin perform public.library_get_documents('libA', array(select md5(g::text) from generate_series(1, 201) g)); raise exception '201 hashes accepted';
  exception when sqlstate '22023' then null; end;
end $$;

-- A dependency the organization cannot read is refused.
select set_config('request.jwt.claim.sub', 'bob', false);
do $$ begin
  begin perform pg_temp.put('libB', 'TB'); raise exception 'unreadable dependency accepted';
  exception when sqlstate '42501' then null; end;
end $$;

-- Non-members and members who manage nothing are refused.
select set_config('request.jwt.claim.sub', 'vic', false);
do $$ begin
  begin perform pg_temp.put('libB', 'V'); raise exception 'viewer put a document';
  exception when sqlstate '42501' then null; end;
end $$;
select set_config('request.jwt.claim.sub', 'mallory', false);
do $$ begin
  begin perform pg_temp.put('libA', 'V'); raise exception 'stranger put a document';
  exception when sqlstate '42501' then null; end;
  begin perform pg_temp.readable('libA', 'V'); raise exception 'stranger read a library';
  exception when sqlstate '42501' then null; end;
  begin perform * from public.library_updates('libA'); raise exception 'stranger read updates';
  exception when sqlstate '42501' then null; end;
  begin perform public.library_adopt('libA', 'libA', 'tpl', pg_temp.h('T1')); raise exception 'stranger adopted';
  exception when sqlstate '42501' then null; end;
end $$;

-- 3. Publishing and sharing. Unshared, nobody else sees it.
select set_config('request.jwt.claim.sub', 'alice', false);
select pg_temp.push(jsonb_build_array(
  pg_temp.ev('a-tpl-1', 'libA', 'alice', 'v1.LibraryItemDefined', '{"itemId":"tpl","kind":"template","name":"Genesis chapters","description":"By chapter."}'),
  pg_temp.ev('a-tpl-2', 'libA', 'alice', 'v1.LibraryVersionPublished', jsonb_build_object('itemId', 'tpl', 'kind', 'template', 'docHash', pg_temp.h('T1'), 'note', 'First.'))));
do $$ declare r record; begin
  select * into r from public.library_items where org_id = 'libA' and item_id = 'tpl';
  if r.kind <> 'template' or r.name <> 'Genesis chapters' or r.shared then raise exception 'item projection wrong: %', r; end if;
  select * into r from public.library_versions where org_id = 'libA' and item_id = 'tpl';
  if r.doc_hash <> pg_temp.h('T1') or r.event_id <> 'a-tpl-2' or r.actor_id <> 'alice' or r.note <> 'First.' then raise exception 'version projection wrong: %', r; end if;
end $$;

-- The fold is order-independent: an older definition arriving late keeps the
-- newer name, and a later copy of the same version keeps the earliest.
select pg_temp.push(jsonb_build_array(
  pg_temp.ev('a-tpl-0', 'libA', 'alice', 'v1.LibraryItemDefined', '{"itemId":"tpl","kind":"flow","name":"Old name","description":""}', '000000000000001:000000:d-alice'),
  pg_temp.ev('a-tpl-dup', 'libA', 'alice', 'v1.LibraryVersionPublished', jsonb_build_object('itemId', 'tpl', 'kind', 'template', 'docHash', pg_temp.h('T1')))));
do $$ declare r record; begin
  select * into r from public.library_items where org_id = 'libA' and item_id = 'tpl';
  if r.name <> 'Genesis chapters' then raise exception 'late old definition overwrote the name'; end if;
  if r.kind <> 'flow' then raise exception 'kind should be the earliest definition''s'; end if;
  if (select event_id from public.library_versions where org_id = 'libA' and item_id = 'tpl') <> 'a-tpl-2' then raise exception 'version should keep its earliest event'; end if;
end $$;
-- Back to a template (the earliest event decides kind), for what follows.
select pg_temp.push1(pg_temp.ev('a-tpl-00', 'libA', 'alice', 'v1.LibraryItemDefined', '{"itemId":"tpl","kind":"template","name":"Old name","description":""}', '000000000000000:000000:d-alice'));

select set_config('request.jwt.claim.sub', 'bob', false);
do $$ begin
  if exists (select 1 from public.library_shared_items('template', null, 50, 0) s where s.org_id = 'libA') then raise exception 'unshared item listed'; end if;
  if pg_temp.readable('libB', 'T1') <> 0 then raise exception 'unshared version readable'; end if;
  begin perform public.library_adopt('libB', 'libA', 'tpl', pg_temp.h('T1')); raise exception 'adopted an unshared item';
  exception when sqlstate '42501' then null; end;
end $$;

select set_config('request.jwt.claim.sub', 'alice', false);
select pg_temp.push1(pg_temp.ev('a-tpl-3', 'libA', 'alice', 'v1.LibrarySharingSet', '{"itemId":"tpl","kind":"template","shared":true,"subscribable":false}'));

select set_config('request.jwt.claim.sub', 'bob', false);
do $$ declare r record; begin
  select * into r from public.library_shared_items('template', 'genesis', 50, 0) s where s.org_id = 'libA' and s.item_id = 'tpl';
  if not found then raise exception 'shared item not listed'; end if;
  if r.org_name <> 'Alpha Translators' or r.latest_hash <> pg_temp.h('T1') or r.version_count <> 1 or r.subscribable then raise exception 'listing wrong: %', r; end if;
  if exists (select 1 from public.library_shared_items('flow', null, 50, 0) s where s.org_id = 'libA') then raise exception 'kind filter ignored'; end if;
  if exists (select 1 from public.library_shared_items(null, 'no such thing', 50, 0)) then raise exception 'query filter ignored'; end if;
  -- Browsing reads the shared version and what it depends on, without adopting.
  if pg_temp.readable('libB', 'T1', 'V') <> 2 then raise exception 'shared version and its dependency should be readable'; end if;
  if exists (select 1 from public.library_document_access where org_id = 'libB') then raise exception 'browsing granted access'; end if;
end $$;

-- 4. Adopting: checks, then access to the version and its dependencies.
select set_config('request.jwt.claim.sub', 'vic', false);
do $$ begin
  begin perform public.library_adopt('libB', 'libA', 'tpl', pg_temp.h('T1')); raise exception 'viewer adopted';
  exception when sqlstate '42501' then null; end;
end $$;
select set_config('request.jwt.claim.sub', 'bob', false);
do $$ begin
  begin perform public.library_adopt('libB', 'libA', 'tpl', repeat('f', 64)); raise exception 'adopted a hash that is no version';
  exception when sqlstate '22023' then null; end;
  perform public.library_adopt('libB', 'libA', 'tpl', pg_temp.h('T1'));
  if (select count(*) from public.library_document_access where org_id = 'libB' and hash in (pg_temp.h('T1'), pg_temp.h('V'))) <> 2 then
    raise exception 'adopt should give the version and its dependency';
  end if;
  -- Now bob's own documents may depend on the adopted versification.
  perform pg_temp.put('libB', 'TB');
end $$;

-- 5. A shared collection: an organization that adopted nothing reads the
--    collection's guides; it never reads what an unshared item depends on.
select set_config('request.jwt.claim.sub', 'alice', false);
select pg_temp.put('libA', 'S');
select pg_temp.put('libA', 'C');
select pg_temp.put('libA', 'V2');
select pg_temp.put('libA', 'M');
select pg_temp.push(jsonb_build_array(
  pg_temp.ev('a-fia-1', 'libA', 'alice', 'v1.LibraryItemDefined', '{"itemId":"fia","kind":"material","name":"FIA Genesis","description":""}'),
  pg_temp.ev('a-fia-2', 'libA', 'alice', 'v1.LibraryVersionPublished', jsonb_build_object('itemId', 'fia', 'kind', 'material', 'docHash', pg_temp.h('C'))),
  pg_temp.ev('a-fia-3', 'libA', 'alice', 'v1.LibrarySharingSet', '{"itemId":"fia","kind":"material","shared":true,"subscribable":true}'),
  pg_temp.ev('a-brief-1', 'libA', 'alice', 'v1.LibraryItemDefined', '{"itemId":"brief","kind":"material","name":"Brief","description":""}'),
  pg_temp.ev('a-brief-2', 'libA', 'alice', 'v1.LibraryVersionPublished', jsonb_build_object('itemId', 'brief', 'kind', 'material', 'docHash', pg_temp.h('M')))));
select set_config('request.jwt.claim.sub', 'carol', false);
do $$ begin
  if pg_temp.readable('libC', 'C', 'S', 'V') <> 3 then raise exception 'a shared collection''s guides should be readable'; end if;
  if pg_temp.readable('libC', 'M', 'V2') <> 0 then raise exception 'an unshared item or its dependency was readable'; end if;
end $$;

-- 6. Subscribing with automatic updates.
select set_config('request.jwt.claim.sub', 'alice', false);
select pg_temp.push1(pg_temp.ev('a-tpl-4', 'libA', 'alice', 'v1.LibrarySharingSet', '{"itemId":"tpl","kind":"template","shared":true,"subscribable":true}'));
select set_config('request.jwt.claim.sub', 'bob', false);
select pg_temp.push(jsonb_build_array(
  pg_temp.ev('b-sub-1', 'libB', 'bob', 'v1.LibrarySubscribed', '{"itemId":"sub.libA.tpl","kind":"template","sourceOrgId":"libA","sourceOrgName":"Alpha Translators","sourceItemId":"tpl","name":"Genesis chapters","autoUpdate":true,"active":true}'),
  pg_temp.ev('b-sub-2', 'libB', 'bob', 'v1.LibraryPinned', jsonb_build_object('itemId', 'sub.libA.tpl', 'kind', 'template', 'docHash', pg_temp.h('T1')))));
do $$ declare r record; begin
  select * into r from public.library_updates('libB');
  if r.item_id <> 'sub.libA.tpl' or r.source_org_id <> 'libA' or r.pinned_hash <> pg_temp.h('T1') or r.latest_hash <> pg_temp.h('T1') then
    raise exception 'updates wrong: %', r;
  end if;
end $$;

-- The owner publishes a new version (document first): the subscriber is pinned to it.
select set_config('request.jwt.claim.sub', 'alice', false);
select pg_temp.put('libA', 'T2');
select pg_temp.push1(pg_temp.ev('a-tpl-5', 'libA', 'alice', 'v1.LibraryVersionPublished', jsonb_build_object('itemId', 'tpl', 'kind', 'template', 'docHash', pg_temp.h('T2'))));
do $$ declare r record; begin
  select * into r from public.events where id = 'pin:libB:sub.libA.tpl:' || pg_temp.h('T2');
  if not found or r.org_id <> 'libB' or r.stream_id <> '_org' or r.actor_id <> 'server' or r.device_id <> 'server'
     or r.payload <> jsonb_build_object('itemId', 'sub.libA.tpl', 'kind', 'template', 'docHash', pg_temp.h('T2')) then
    raise exception 'automatic pin wrong: %', r;
  end if;
  if public.validate_payload(r.type, r.payload) is not null then raise exception 'automatic pin is not a valid event'; end if;
  if (select pinned from public.library_subscriptions where org_id = 'libB' and item_id = 'sub.libA.tpl') <> pg_temp.h('T2') then
    raise exception 'automatic pin not folded';
  end if;
  if not exists (select 1 from public.library_document_access where org_id = 'libB' and hash = pg_temp.h('T2')) then raise exception 'subscriber not given the new version'; end if;
end $$;

-- Event first, document second (an offline publish): nothing until the document arrives.
select pg_temp.push1(pg_temp.ev('a-tpl-6', 'libA', 'alice', 'v1.LibraryVersionPublished', jsonb_build_object('itemId', 'tpl', 'kind', 'template', 'docHash', pg_temp.h('T3'))));
do $$ begin
  if pg_temp.pins('libB', 'T3') <> 0 then raise exception 'pinned a version whose document is missing'; end if;
  perform set_config('request.jwt.claim.sub', 'bob', false);
  if (select latest_hash from public.library_updates('libB')) <> pg_temp.h('T2') then raise exception 'offered a version whose document is missing'; end if;
  perform set_config('request.jwt.claim.sub', 'alice', false);
  perform pg_temp.put('libA', 'T3');
  if pg_temp.pins('libB', 'T3') <> 1 then raise exception 'putting the document should hand the version on'; end if;
  if not exists (select 1 from public.library_document_access where org_id = 'libB' and hash = pg_temp.h('T3')) then raise exception 'subscriber not given the late document'; end if;
  perform pg_temp.put('libA', 'T3');  -- again: still one pin
  if pg_temp.pins('libB', 'T3') <> 1 then raise exception 'handing on twice appended twice'; end if;
end $$;

-- No longer subscribable: nothing is handed on and no update is offered,
-- but what the subscriber already has stays.
select pg_temp.push1(pg_temp.ev('a-tpl-7', 'libA', 'alice', 'v1.LibrarySharingSet', '{"itemId":"tpl","kind":"template","shared":false,"subscribable":false}'));
select pg_temp.put('libA', 'T4');
select pg_temp.push1(pg_temp.ev('a-tpl-8', 'libA', 'alice', 'v1.LibraryVersionPublished', jsonb_build_object('itemId', 'tpl', 'kind', 'template', 'docHash', pg_temp.h('T4'))));
select set_config('request.jwt.claim.sub', 'bob', false);
do $$ declare r record; begin
  if pg_temp.pins('libB', 'T4') <> 0 then raise exception 'unsubscribable item handed on'; end if;
  select * into r from public.library_updates('libB');
  if r.latest_hash is not null or r.pinned_hash <> pg_temp.h('T3') then raise exception 'updates after unsharing wrong: %', r; end if;
  if pg_temp.readable('libB', 'T1', 'T3', 'V') <> 3 then raise exception 'unsharing took away adopted versions'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'carol', false);
do $$ begin
  if pg_temp.readable('libC', 'T4', 'T1') <> 0 then raise exception 'unshared item still browsable'; end if;
end $$;

-- 7. Seeding (service role; no signed-in caller): documents and events,
--    idempotent by event id.
select set_config('request.jwt.claim.sub', '', false);
do $$ declare n int; v text; begin
  v := public.library_seed_document('lqseed', (select body from lib_docs where k = 'V'));
  if v <> pg_temp.h('V') then raise exception 'seeded document named %', v; end if;
  for n in 1..2 loop
    if public.library_seed_events('lqseed', jsonb_build_array(
         jsonb_build_object('id', 'seed-1', 'type', 'v1.OrgCreated', 'payload', '{"name":"LangQuest"}'::jsonb),
         jsonb_build_object('id', 'seed-2', 'type', 'v1.LibraryItemDefined', 'payload', '{"itemId":"langquest.eng","kind":"versification","name":"English","description":""}'::jsonb),
         jsonb_build_object('id', 'seed-3', 'type', 'v1.LibraryVersionPublished', 'actorId', 'seeder',
           'payload', jsonb_build_object('itemId', 'langquest.eng', 'kind', 'versification', 'docHash', v)),
         jsonb_build_object('id', 'seed-4', 'type', 'v1.LibrarySharingSet', 'payload', '{"itemId":"langquest.eng","kind":"versification","shared":true,"subscribable":true}'::jsonb)))
       <> 4 * (2 - n) then
      raise exception 'seed run % appended the wrong number of events', n;
    end if;
  end loop;
  if (select actor_id from public.library_versions where org_id = 'lqseed' and item_id = 'langquest.eng') <> 'seeder' then raise exception 'seeded version not folded'; end if;
  if not (select shared from public.library_items where org_id = 'lqseed' and item_id = 'langquest.eng') then raise exception 'seeded sharing not folded'; end if;
  begin
    perform public.library_seed_events('lqseed', '[{"id":"seed-bad","type":"v1.LibraryPinned","payload":{"itemId":"x","kind":"template","docHash":"nope"}}]');
    raise exception 'invalid seed event accepted';
  exception when sqlstate '22023' then null; end;
end $$;

-- 7b. template@2 (decisions.md 74), and which template each language uses.
select set_config('request.jwt.claim.sub', 'alice', false);
select pg_temp.body('T2V', format('{"bible":{"books":[{"book":"GEN","divide":"chapters","name":"Genesis","part":"Chapter"},{"book":"EXO","name":"Exodus"}],"versification":"%s"},"deps":["%s"],"description":"","format":"template@2","goesWith":{"pattern":"FIA"},"levels":[{"name":"Book"},{"name":"Chapter"}],"name":"Book by book","structure":"bible"}', pg_temp.h('V'), pg_temp.h('V')));
do $$ declare n int; r record; begin
  perform pg_temp.put('libA', 'T2V');
  select count(*) into n from public.library_documents where hash = pg_temp.h('T2V') and format = 'template@2';
  if n <> 1 then raise exception 'template@2 not stored'; end if;
  perform pg_temp.push(jsonb_build_array(
    pg_temp.ev('a-lang-1', 'libA', 'alice', 'v1.LanguageAdded', '{"languageId":"tu-one","name":"One","code":"one","sourceCode":"eng"}'),
    pg_temp.ev('a-lang-2', 'libA', 'alice', 'v1.LanguageAdded', '{"languageId":"tu-two","name":"Two","code":"two","sourceCode":"eng"}')));
  perform pg_temp.push(jsonb_build_array(
    jsonb_set(pg_temp.ev('tu-1', 'libA', 'alice', 'v1.TemplateSelected', jsonb_build_object('itemId', 'tpl', 'docHash', pg_temp.h('T1'), 'unitPrefix', 'tpl')), '{streamId}', '"tu-one"'),
    jsonb_set(pg_temp.ev('tu-2', 'libA', 'alice', 'v1.TemplateSelected', jsonb_build_object('itemId', 'tpl-two', 'docHash', pg_temp.h('T2V'), 'unitPrefix', 'tpl')), '{streamId}', '"tu-one"'),
    jsonb_set(pg_temp.ev('tu-3', 'libA', 'alice', 'v1.TemplateSelected', jsonb_build_object('itemId', 'tpl', 'docHash', pg_temp.h('T1'), 'unitPrefix', 'tpl')), '{streamId}', '"tu-two"'),
    jsonb_set(pg_temp.ev('tu-4', 'libA', 'alice', 'v1.BookNameSet', '{"book":"GEN","name":"1 Mose"}'), '{streamId}', '"tu-two"')));
  select count(*) into n from public.library_template_users('libA');
  if n <> 2 then raise exception 'expected two languages with a template, got %', n; end if;
  select * into r from public.library_template_users('libA') where language_id = 'tu-one';
  if r.item_id <> 'tpl-two' or r.unit_prefix <> 'tpl' then raise exception 'latest selection not returned: %', r.item_id; end if;
  begin
    perform pg_temp.push1(jsonb_set(pg_temp.ev('tu-5', 'libA', 'alice', 'v1.BookNameSet', '{"book":"gen","name":"x"}'), '{streamId}', '"tu-two"'));
    raise exception 'a lower-case book was accepted';
  exception when others then if sqlerrm not like '%refused%' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub', 'mallory', false);
do $$ begin
  begin perform * from public.library_template_users('libA'); raise exception 'stranger read template users';
  exception when sqlstate '42501' then null; end;
end $$;

-- 8. Clients cannot reach the tables or the service functions.
do $$ begin
  if has_table_privilege('authenticated', 'public.library_documents', 'select')
     or has_table_privilege('anon', 'public.library_document_access', 'select')
     or has_table_privilege('authenticated', 'public.library_items', 'insert') then
    raise exception 'library tables reachable by a client';
  end if;
  if has_function_privilege('authenticated', 'public.library_seed_events(text, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.library_seed_document(text, text)', 'execute')
     or has_function_privilege('anon', 'public.library_get_documents(text, text[])', 'execute')
     or has_function_privilege('authenticated', 'public._library_store(text, text)', 'execute')
     or has_function_privilege('authenticated', 'public._apply_org_event(text, text, text, jsonb, text, text)', 'execute') then
    raise exception 'a service function is callable by a client';
  end if;
  if not has_function_privilege('authenticated', 'public.library_put_document(text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.library_template_users(text)', 'execute')
     or not has_function_privilege('service_role', 'public.library_seed_events(text, jsonb)', 'execute') then
    raise exception 'library RPCs not granted';
  end if;
end $$;

select 'library smoke ok' as result;
