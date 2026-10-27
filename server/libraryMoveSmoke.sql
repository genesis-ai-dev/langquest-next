-- Moving a library item to another organization (decisions.md 174): one
-- organization offers an item, another takes it, and when the new item is
-- shared for following, its followers follow it and the old item retires.
-- Repeatable against a populated database; every test write rolls back.
\set ON_ERROR_STOP on
begin;
-- Owners of Alpha (gives), Beta (takes), Gamma and Delta (follow), and a Beta coordinator who manages no reference material.
insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('4c000000-0000-0000-0000-00000000000a', 'mv-a@example.org', 'authenticated', 'authenticated', '{}'),
  ('4c000000-0000-0000-0000-00000000000b', 'mv-b@example.org', 'authenticated', 'authenticated', '{}'),
  ('4c000000-0000-0000-0000-00000000000c', 'mv-c@example.org', 'authenticated', 'authenticated', '{}'),
  ('4c000000-0000-0000-0000-00000000000d', 'mv-d@example.org', 'authenticated', 'authenticated', '{}'),
  ('4c000000-0000-0000-0000-0000000000b2', 'mv-b2@example.org', 'authenticated', 'authenticated', '{}');

create temp sequence mv_clock start 1;
create temp table mv_docs (k text primary key, hash text not null, body text not null);
create temp table mv_move (k text primary key, id uuid);
grant all on mv_docs, mv_move to authenticated;
grant usage on sequence mv_clock to authenticated;

create function pg_temp.as_caller(p_profile text) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_profile is null then '' else json_build_object('sub', p_profile)::text end, true);
$$;
create function pg_temp.ev(p_org text, p_actor text, p_type text, p_payload jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id', 'mv-' || nextval('mv_clock'), 'orgId', p_org, 'streamId', '_org', 'actorId', p_actor, 'deviceId', 'dM',
    'hlc', lpad((500 + currval('mv_clock'))::text, 15, '0') || ':000000:dM', 'type', p_type, 'payload', p_payload);
$$;
create function pg_temp.push(p_events jsonb) returns void language plpgsql as $$
declare r record;
begin
  for r in select * from public.append_events(p_events, (select min_client_version from public.server_config)) loop
    if not r.accepted then raise exception 'event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;
create function pg_temp.h(p_k text) returns text language sql as $$ select hash from mv_docs where k = p_k; $$;
create function pg_temp.body(p_k text, p_body text) returns text language sql as $$
  insert into mv_docs (k, hash, body) values (p_k, encode(sha256(convert_to(p_body, 'UTF8')), 'hex'), p_body) returning hash;
$$;
create function pg_temp.mv(p_k text) returns uuid language sql as $$ select id from mv_move where k = p_k; $$;
create function pg_temp.sub(p_org text, p_item text) returns public.library_subscriptions language sql as $$
  select * from public.library_subscriptions where org_id = p_org and item_id = p_item;
$$;

select pg_temp.as_caller(null);
do $$
declare v_all jsonb := '["manage_structure","invite_members","manage_roles","manage_templates","manage_reference","manage_flows","translate","review","view_status"]';
        o record;
begin
  for o in select * from (values ('mv-a', '4c000000-0000-0000-0000-00000000000a', 'Alpha Movers'), ('mv-b', '4c000000-0000-0000-0000-00000000000b', 'Beta Hosts'),
                                 ('mv-c', '4c000000-0000-0000-0000-00000000000c', 'Gamma Team'), ('mv-d', '4c000000-0000-0000-0000-00000000000d', 'Delta Team')) t (org, actor, name) loop
    perform pg_temp.push(jsonb_build_array(
      pg_temp.ev(o.org, o.actor, 'v1.OrgCreated', jsonb_build_object('name', o.name)),
      pg_temp.ev(o.org, o.actor, 'v1.RoleDefined', jsonb_build_object('roleId', 'admin', 'name', 'Admin', 'privileges', v_all)),
      pg_temp.ev(o.org, o.actor, 'v1.MemberAdded', jsonb_build_object('profileId', o.actor, 'roleId', 'admin', 'scope', jsonb_build_object('level', 'org')))));
  end loop;
  perform pg_temp.push(jsonb_build_array(
    pg_temp.ev('mv-b', '4c000000-0000-0000-0000-00000000000b', 'v1.RoleDefined', '{"roleId":"coord","name":"Coordinator","privileges":["invite_members","manage_structure"]}'),
    pg_temp.ev('mv-b', '4c000000-0000-0000-0000-00000000000b', 'v1.MemberAdded', '{"profileId":"4c000000-0000-0000-0000-0000000000b2","roleId":"coord","scope":{"level":"org"}}')));
  -- Beta has a blue check, so Alpha can find it.
  insert into public.org_verifications (org_id, domain, granted_by) values ('mv-b', 'beta-hosts.example', 'Smoke');
end $$;

select pg_temp.body('V', '{"code":"mv","format":"versification@1","mappedVerses":{},"maxVerses":{"GEN":[31,25]},"name":"Mover numbering"}');
select pg_temp.body('M1', format('{"deps":["%s"],"format":"material@1","kind":"brief","links":[{"ref":"GEN 1:1"}],"title":"Brief","versification":"%s"}', pg_temp.h('V'), pg_temp.h('V')));
select pg_temp.body('M2', format('{"deps":["%s"],"format":"material@1","kind":"brief","links":[{"ref":"GEN 1:1"}],"title":"Brief v2","versification":"%s"}', pg_temp.h('V'), pg_temp.h('V')));
select pg_temp.body('M3', format('{"deps":["%s"],"format":"material@1","kind":"brief","links":[{"ref":"GEN 1:1"}],"title":"Brief v3","versification":"%s"}', pg_temp.h('V'), pg_temp.h('V')));
select pg_temp.body('N', format('{"deps":["%s"],"format":"material@1","kind":"brief","links":[{"ref":"GEN 2:1"}],"title":"Notes","versification":"%s"}', pg_temp.h('V'), pg_temp.h('V')));

-- 1. Alpha publishes "brief" (two versions) and "notes", shared for following; Gamma follows both automatically, Delta follows "brief" by hand.
set local role authenticated;
select pg_temp.as_caller('4c000000-0000-0000-0000-00000000000a');
do $$ begin
  perform public.library_put_document('mv-a', (select body from mv_docs where k = 'V'));
  perform public.library_put_document('mv-a', (select body from mv_docs where k = 'M1'));
  perform public.library_put_document('mv-a', (select body from mv_docs where k = 'M2'));
  perform public.library_put_document('mv-a', (select body from mv_docs where k = 'N'));
end $$;
reset role;
select pg_temp.as_caller(null);
do $$
declare a text := '4c000000-0000-0000-0000-00000000000a'; c text := '4c000000-0000-0000-0000-00000000000c'; d text := '4c000000-0000-0000-0000-00000000000d';
begin
  perform pg_temp.push(jsonb_build_array(
    pg_temp.ev('mv-a', a, 'v1.LibraryItemDefined', '{"itemId":"brief","kind":"material","name":"Brief","description":"A brief."}'),
    pg_temp.ev('mv-a', a, 'v1.LibraryVersionPublished', jsonb_build_object('itemId', 'brief', 'kind', 'material', 'docHash', pg_temp.h('M1'), 'note', 'first')),
    pg_temp.ev('mv-a', a, 'v1.LibraryVersionPublished', jsonb_build_object('itemId', 'brief', 'kind', 'material', 'docHash', pg_temp.h('M2'))),
    pg_temp.ev('mv-a', a, 'v1.LibrarySharingSet', '{"itemId":"brief","kind":"material","shared":true,"subscribable":true}'),
    pg_temp.ev('mv-a', a, 'v1.LibraryItemDefined', '{"itemId":"notes","kind":"material","name":"Notes","description":""}'),
    pg_temp.ev('mv-a', a, 'v1.LibraryVersionPublished', jsonb_build_object('itemId', 'notes', 'kind', 'material', 'docHash', pg_temp.h('N'))),
    pg_temp.ev('mv-a', a, 'v1.LibrarySharingSet', '{"itemId":"notes","kind":"material","shared":true,"subscribable":true}')));
  perform public._library_grant('mv-c', pg_temp.h('M2'));
  perform public._library_grant('mv-c', pg_temp.h('N'));
  perform public._library_grant('mv-d', pg_temp.h('M1'));
  perform pg_temp.push(jsonb_build_array(
    pg_temp.ev('mv-c', c, 'v1.LibrarySubscribed', '{"itemId":"sub.mv-a.brief","kind":"material","sourceOrgId":"mv-a","sourceOrgName":"Alpha Movers","sourceItemId":"brief","name":"Brief","autoUpdate":true,"active":true}'),
    pg_temp.ev('mv-c', c, 'v1.LibraryPinned', jsonb_build_object('itemId', 'sub.mv-a.brief', 'kind', 'material', 'docHash', pg_temp.h('M2'))),
    pg_temp.ev('mv-c', c, 'v1.LibrarySubscribed', '{"itemId":"sub.mv-a.notes","kind":"material","sourceOrgId":"mv-a","sourceOrgName":"Alpha Movers","sourceItemId":"notes","name":"Notes","autoUpdate":true,"active":true}'),
    pg_temp.ev('mv-c', c, 'v1.LibraryPinned', jsonb_build_object('itemId', 'sub.mv-a.notes', 'kind', 'material', 'docHash', pg_temp.h('N'))),
    pg_temp.ev('mv-d', d, 'v1.LibrarySubscribed', '{"itemId":"sub.mv-a.brief","kind":"material","sourceOrgId":"mv-a","sourceOrgName":"Alpha Movers","sourceItemId":"brief","name":"Brief","autoUpdate":false,"active":true}'),
    pg_temp.ev('mv-d', d, 'v1.LibraryPinned', jsonb_build_object('itemId', 'sub.mv-a.brief', 'kind', 'material', 'docHash', pg_temp.h('M1')))));
end $$;

-- 2. Only someone who manages reference material at Alpha offers Alpha's item, to an organization that exists.
set local role authenticated;
select pg_temp.as_caller('4c000000-0000-0000-0000-00000000000b');
do $$ begin
  if public.library_move_offer('mv-a', 'brief', 'mv-b')->>'reason' <> 'not_allowed' then raise exception 'Beta offered Alpha''s item'; end if;
  begin perform public.library_move_targets('mv-a', 'Beta'); raise exception 'Beta searched for Alpha';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.as_caller('4c000000-0000-0000-0000-00000000000a');
do $$ declare v jsonb; begin
  if not exists (select 1 from public.library_move_targets('mv-a', 'beta h') t where t.org_id = 'mv-b') then raise exception 'Alpha finds Beta (blue check)'; end if;
  if exists (select 1 from public.library_move_targets('mv-a', 'Alpha') t where t.org_id = 'mv-a') then raise exception 'an organization finds itself'; end if;
  if exists (select 1 from public.library_move_targets('mv-a', 'b')) then raise exception 'one letter finds nothing'; end if;
  if public.library_move_offer('mv-a', 'nothing', 'mv-b')->>'reason' <> 'no_item' then raise exception 'an item that is not there'; end if;
  if public.library_move_offer('mv-a', 'brief', 'mv-a')->>'reason' <> 'no_org' then raise exception 'offering to itself'; end if;
  if public.library_move_offer('mv-a', 'brief', 'mv-nowhere')->>'reason' <> 'no_org' then raise exception 'offering to nobody'; end if;
  v := public.library_move_offer('mv-a', 'brief', 'mv-b');
  if (v->>'ok')::boolean is not true or v#>>'{move,state}' <> 'offered' or v#>>'{move,name}' <> 'Brief' or v#>>'{move,toOrgName}' <> 'Beta Hosts' then raise exception 'offering: %', v; end if;
  insert into mv_move values ('brief', (v#>>'{move,id}')::uuid);
  if public.library_move_offer('mv-a', 'brief', 'mv-c')->>'reason' <> 'open' then raise exception 'one open offer an item'; end if;
end $$;

-- 3. Beta's managers see the offer; its coordinator and the followers do not. Beta may turn it down; Alpha may take it back.
select pg_temp.as_caller('4c000000-0000-0000-0000-0000000000b2');
do $$ begin
  if jsonb_array_length(public.library_moves_for('mv-b')) <> 0 then raise exception 'a coordinator saw the offer'; end if;
  if public.library_move_accept('mv-b', pg_temp.mv('brief'), 'brief-b')->>'reason' <> 'not_allowed' then raise exception 'a coordinator took it'; end if;
end $$;
select pg_temp.as_caller('4c000000-0000-0000-0000-00000000000c');
do $$ begin
  if jsonb_array_length(public.library_moves_for('mv-c')) <> 0 then raise exception 'a follower saw the offer'; end if;
end $$;
select pg_temp.as_caller('4c000000-0000-0000-0000-00000000000b');
do $$ declare v jsonb; begin
  if public.library_moves_for('mv-b')->0->>'state' <> 'offered' then raise exception 'Beta sees the offer'; end if;
  if public.library_move_withdraw('mv-b', pg_temp.mv('brief')) <> 'not_open' then raise exception 'Beta took back Alpha''s offer'; end if;
  if public.library_move_decline('mv-b', pg_temp.mv('brief')) <> 'declined' then raise exception 'declining'; end if;
end $$;
select pg_temp.as_caller('4c000000-0000-0000-0000-00000000000a');
do $$ declare v jsonb; begin
  if public.library_moves_for('mv-a')->0->>'state' <> 'declined' then raise exception 'Alpha sees it declined'; end if;
  v := public.library_move_offer('mv-a', 'brief', 'mv-b');
  if public.library_move_withdraw('mv-a', (v#>>'{move,id}')::uuid) <> 'withdrawn' then raise exception 'taking back'; end if;
  v := public.library_move_offer('mv-a', 'brief', 'mv-b');
  update mv_move set id = (v#>>'{move,id}')::uuid where k = 'brief';
end $$;

-- 4. Beta takes it as a new item: it gets every version to publish, oldest first, and may read them. Nothing moves yet.
select pg_temp.as_caller('4c000000-0000-0000-0000-00000000000b');
do $$ declare v jsonb; begin
  if public.library_move_accept('mv-b', pg_temp.mv('brief'), 'bad/id')->>'reason' <> 'bad_item' then raise exception 'a bad item id'; end if;
  v := public.library_move_accept('mv-b', pg_temp.mv('brief'), 'brief-b');
  if v#>>'{move,state}' <> 'accepted' or (v->>'replace')::boolean or v->>'name' <> 'Brief' or v->>'description' <> 'A brief.'
     or v->'versions' <> jsonb_build_array(jsonb_build_object('docHash', pg_temp.h('M1'), 'note', 'first'), jsonb_build_object('docHash', pg_temp.h('M2'), 'note', null)) then
    raise exception 'taking it: %', v;
  end if;
  if (select count(*) from public.library_get_documents('mv-b', array[pg_temp.h('M1'), pg_temp.h('M2'), pg_temp.h('V')])) <> 3 then raise exception 'Beta reads the versions'; end if;
  if public.library_move_accept('mv-b', pg_temp.mv('brief'), 'other')->>'reason' <> 'not_open' then raise exception 'taking it as another item'; end if;
  if public.library_move_accept('mv-b', pg_temp.mv('brief'), 'brief-b')#>>'{move,state}' <> 'accepted' then raise exception 'taking it again'; end if;
  -- Beta's next version, kept for later.
  perform public.library_put_document('mv-b', (select body from mv_docs where k = 'M3'));
end $$;
select pg_temp.as_caller('4c000000-0000-0000-0000-00000000000a');
do $$ begin
  if public.library_move_withdraw('mv-a', pg_temp.mv('brief')) <> 'not_open' then raise exception 'Alpha took it back after Beta took it'; end if;
end $$;
reset role;

-- 5. Beta's app publishes it; once it is shared for following, the followers follow Beta's item and Alpha's retires.
select pg_temp.as_caller(null);
do $$ declare b text := '4c000000-0000-0000-0000-00000000000b'; begin
  perform pg_temp.push(jsonb_build_array(
    pg_temp.ev('mv-b', b, 'v1.LibraryItemDefined', '{"itemId":"brief-b","kind":"material","name":"Brief","description":"A brief."}'),
    pg_temp.ev('mv-b', b, 'v1.LibraryVersionPublished', jsonb_build_object('itemId', 'brief-b', 'kind', 'material', 'docHash', pg_temp.h('M1'), 'note', 'first')),
    pg_temp.ev('mv-b', b, 'v1.LibraryVersionPublished', jsonb_build_object('itemId', 'brief-b', 'kind', 'material', 'docHash', pg_temp.h('M2')))));
  if (select public._library_move_state(m) from public.library_moves m where m.id = pg_temp.mv('brief')) <> 'accepted' then raise exception 'moved before Beta shared it'; end if;
  perform pg_temp.push(jsonb_build_array(pg_temp.ev('mv-b', b, 'v1.LibrarySharingSet', '{"itemId":"brief-b","kind":"material","shared":true,"subscribable":true}')));
  if (select public._library_move_state(m) || ' ' || m.followers from public.library_moves m where m.id = pg_temp.mv('brief')) <> 'moved 2' then raise exception 'moved, with its two followers'; end if;
  if (pg_temp.sub('mv-c', 'sub.mv-a.brief')).source_org_id <> 'mv-b' or (pg_temp.sub('mv-c', 'sub.mv-a.brief')).source_item_id <> 'brief-b'
     or (pg_temp.sub('mv-c', 'sub.mv-a.brief')).source_org_name <> 'Beta Hosts' or not (pg_temp.sub('mv-c', 'sub.mv-a.brief')).auto_update
     or (pg_temp.sub('mv-c', 'sub.mv-a.brief')).pinned <> pg_temp.h('M2') then
    raise exception 'Gamma follows Beta''s item, as it followed Alpha''s';
  end if;
  if (pg_temp.sub('mv-d', 'sub.mv-a.brief')).source_org_id <> 'mv-b' or (pg_temp.sub('mv-d', 'sub.mv-a.brief')).auto_update
     or (pg_temp.sub('mv-d', 'sub.mv-a.brief')).pinned <> pg_temp.h('M1') then
    raise exception 'Delta follows Beta''s item by hand, at the version it had';
  end if;
  if not exists (select 1 from public.events e where e.org_id = 'mv-c' and e.type = 'v1.LibrarySubscribed' and e.actor_id = 'server') then raise exception 'the server wrote the change'; end if;
  if exists (select 1 from public.library_items i where i.org_id = 'mv-a' and i.item_id = 'brief' and (i.shared or not i.archived)) then raise exception 'Alpha''s item retires'; end if;
  perform pg_temp.as_caller('4c000000-0000-0000-0000-00000000000c');
  if exists (select 1 from public.library_shared_items('material', 'Brief') s where s.org_id = 'mv-a') then raise exception 'Alpha no longer shares it'; end if;
  if not exists (select 1 from public.library_shared_items('material', 'Brief') s where s.org_id = 'mv-b' and s.item_id = 'brief-b') then raise exception 'Beta shares it'; end if;
  perform pg_temp.as_caller(null);
  -- Beta's next version reaches Gamma automatically, not Delta.
  perform pg_temp.push(jsonb_build_array(pg_temp.ev('mv-b', b, 'v1.LibraryVersionPublished', jsonb_build_object('itemId', 'brief-b', 'kind', 'material', 'docHash', pg_temp.h('M3')))));
  if (pg_temp.sub('mv-c', 'sub.mv-a.brief')).pinned <> pg_temp.h('M3') then raise exception 'Gamma takes Beta''s new version'; end if;
  if (pg_temp.sub('mv-d', 'sub.mv-a.brief')).pinned <> pg_temp.h('M1') then raise exception 'Delta chooses its own updates'; end if;
end $$;

-- 6. In place of one of Beta's own: Alpha's "notes" moves onto "brief-b", which is already shared, so it moves at once.
set local role authenticated;
select pg_temp.as_caller('4c000000-0000-0000-0000-00000000000a');
do $$ declare v jsonb; begin
  v := public.library_move_offer('mv-a', 'notes', 'mv-b');
  insert into mv_move values ('notes', (v#>>'{move,id}')::uuid);
end $$;
select pg_temp.as_caller('4c000000-0000-0000-0000-00000000000b');
do $$ declare v jsonb; begin
  v := public.library_move_accept('mv-b', pg_temp.mv('notes'), 'brief-b');
  if v#>>'{move,state}' <> 'moved' or not (v->>'replace')::boolean or v->'versions' <> '[]' then raise exception 'in place of its own: %', v; end if;
end $$;
reset role;
select pg_temp.as_caller(null);
do $$ begin
  if (pg_temp.sub('mv-c', 'sub.mv-a.notes')).source_item_id <> 'brief-b' or (pg_temp.sub('mv-c', 'sub.mv-a.notes')).pinned <> pg_temp.h('M3') then
    raise exception 'Gamma''s notes follow Beta''s item, at its version';
  end if;
end $$;

-- 7. Only the server lands a move.
set local role authenticated;
do $$ begin
  begin perform public._library_move_land('mv-b', 'brief-b'); raise exception 'a client landed a move';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
\echo 'library move smoke ok'
