-- Who may put what in the log (decisions.md 75): nobody is added without
-- joining, a grantor grants only what they hold, one id names one event,
-- one create makes one entity, and an organization the server seeded
-- cannot be claimed. Repeatable; every write rolls back.
\set ON_ERROR_STOP on
begin;
update public.server_config set min_client_version = 0;

-- An owner, a coordinator (everything but Manage roles), a translator in
-- one language, and a viewer, set up as the server would (an import).
select set_config('request.jwt.claim.sub', '', true);
do $$ declare r record; begin
  for r in select * from public.append_events('[
    {"id":"gr-1","type":"v1.OrgCreated","orgId":"gr-org","streamId":"_org","actorId":"gr-owner","deviceId":"dG","hlc":"000000000000001:000000:dG","payload":{"name":"Grants"}},
    {"id":"gr-2","type":"v1.RoleDefined","orgId":"gr-org","streamId":"_org","actorId":"gr-owner","deviceId":"dG","hlc":"000000000000002:000000:dG","payload":{"roleId":"org_admin","name":"Organization Admin","privileges":["manage_structure","invite_members","manage_roles","manage_templates","shape_templates","manage_reference","manage_flows","manage_teams","assign_work","override_checkpoints","translate","fill_reference","send_to_reviewers","review","view_status"]}},
    {"id":"gr-3","type":"v1.RoleDefined","orgId":"gr-org","streamId":"_org","actorId":"gr-owner","deviceId":"dG","hlc":"000000000000003:000000:dG","payload":{"roleId":"coordinator","name":"Coordinator","privileges":["manage_structure","invite_members","manage_templates","shape_templates","manage_reference","manage_flows","manage_teams","assign_work","override_checkpoints","translate","fill_reference","send_to_reviewers","review","view_status"]}},
    {"id":"gr-4","type":"v1.RoleDefined","orgId":"gr-org","streamId":"_org","actorId":"gr-owner","deviceId":"dG","hlc":"000000000000004:000000:dG","payload":{"roleId":"translator","name":"Translator","privileges":["translate","fill_reference","send_to_reviewers","view_status"]}},
    {"id":"gr-5","type":"v1.RoleDefined","orgId":"gr-org","streamId":"_org","actorId":"gr-owner","deviceId":"dG","hlc":"000000000000005:000000:dG","payload":{"roleId":"viewer","name":"Viewer","privileges":["view_status"]}},
    {"id":"gr-6","type":"v1.MemberAdded","orgId":"gr-org","streamId":"_org","actorId":"gr-owner","deviceId":"dG","hlc":"000000000000006:000000:dG","payload":{"profileId":"gr-owner","roleId":"org_admin","scope":{"level":"org"}}},
    {"id":"gr-7","type":"v1.LanguageAdded","orgId":"gr-org","streamId":"_org","actorId":"gr-owner","deviceId":"dG","hlc":"000000000000007:000000:dG","payload":{"languageId":"gr-L","name":"Grantish","code":"grt","sourceCode":"eng"}},
    {"id":"gr-8","type":"v1.MemberAdded","orgId":"gr-org","streamId":"_org","actorId":"gr-owner","deviceId":"dG","hlc":"000000000000008:000000:dG","payload":{"profileId":"gr-coord","roleId":"coordinator","scope":{"level":"org"}}},
    {"id":"gr-9","type":"v1.MemberAdded","orgId":"gr-org","streamId":"_org","actorId":"gr-owner","deviceId":"dG","hlc":"000000000000009:000000:dG","payload":{"profileId":"gr-tr","roleId":"translator","scope":{"level":"language","languageId":"gr-L"}}},
    {"id":"gr-10","type":"v1.MemberAdded","orgId":"gr-org","streamId":"_org","actorId":"gr-owner","deviceId":"dG","hlc":"000000000000010:000000:dG","payload":{"profileId":"gr-view","roleId":"viewer","scope":{"level":"org"}}}
  ]'::jsonb) loop
    if not r.accepted then raise exception 'setup event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;

-- A person's event in gr-org, as JSON, at a clock just behind the server's.
create function pg_temp.ev(p_id text, p_stream text, p_actor text, p_type text, p_payload jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'type', p_type, 'orgId', 'gr-org', 'streamId', p_stream, 'actorId', p_actor, 'deviceId', 'dG',
    'hlc', lpad(((extract(epoch from clock_timestamp()) * 1000)::bigint - 1000)::text, 15, '0') || ':000000:dG', 'payload', p_payload);
$$;
-- Append one event as its actor; the server's answer.
create function pg_temp.push(p_event jsonb) returns record language plpgsql as $$
declare r record;
begin
  perform set_config('request.jwt.claim.sub', p_event->>'actorId', true);
  select * into r from public.append_events(jsonb_build_array(p_event));
  return r;
end $$;
create function pg_temp.refused(p_event jsonb, p_reason text, p_what text) returns void language plpgsql as $$
declare r record := pg_temp.push(p_event);
begin
  if r.accepted or r.reason <> p_reason then raise exception '%: expected "%", got %', p_what, p_reason, r; end if;
end $$;
create function pg_temp.accepted(p_event jsonb, p_what text) returns void language plpgsql as $$
declare r record := pg_temp.push(p_event);
begin
  if not r.accepted then raise exception '%: refused: %', p_what, r.reason; end if;
end $$;

-- 1. Nobody is added without joining.
select pg_temp.refused(pg_temp.ev('gr-a1', '_org', 'gr-owner', 'v1.MemberAdded', '{"profileId":"gr-stranger","roleId":"viewer","scope":{"level":"org"}}'),
  'may not emit v1.MemberAdded: they have not joined this organization; invite them', 'an owner adding someone who never joined');
-- Removing first does not make them "joined".
select pg_temp.accepted(pg_temp.ev('gr-a2', '_org', 'gr-owner', 'v1.MemberRemoved', '{"profileId":"gr-stranger","scope":{"level":"org"}}'), 'a removal');
select pg_temp.refused(pg_temp.ev('gr-a3', '_org', 'gr-owner', 'v1.MemberAdded', '{"profileId":"gr-stranger","roleId":"viewer","scope":{"level":"org"}}'),
  'may not emit v1.MemberAdded: they have not joined this organization; invite them', 'adding someone after a removal they never had');
-- A member may be given another scope.
select pg_temp.accepted(pg_temp.ev('gr-a4', '_org', 'gr-owner', 'v1.MemberAdded', '{"profileId":"gr-view","roleId":"translator","scope":{"level":"language","languageId":"gr-L"}}'),
  'a member given a language');

-- 2. A grantor grants only what they hold.
select pg_temp.refused(pg_temp.ev('gr-b1', '_org', 'gr-coord', 'v1.MemberAdded', '{"profileId":"gr-coord","roleId":"org_admin","scope":{"level":"org"}}'),
  'may not emit v1.MemberAdded: you may only grant a role whose privileges you hold', 'a coordinator making themselves owner');
select pg_temp.refused(pg_temp.ev('gr-b2', '_org', 'gr-coord', 'v1.MemberAdded', '{"profileId":"gr-tr","roleId":"org_admin","scope":{"level":"language","languageId":"gr-L"}}'),
  'may not emit v1.MemberAdded: you may only grant a role whose privileges you hold', 'a coordinator making someone owner of a language');
select pg_temp.accepted(pg_temp.ev('gr-b3', '_org', 'gr-coord', 'v1.MemberAdded', '{"profileId":"gr-view","roleId":"translator","scope":{"level":"org"}}'),
  'a coordinator granting a role below theirs');
select pg_temp.refused(pg_temp.ev('gr-b4', '_org', 'gr-coord', 'v1.MemberRemoved', '{"profileId":"gr-owner","scope":{"level":"org"}}'),
  'may not emit v1.MemberRemoved: they hold more there than you do', 'a coordinator removing the owner');
select pg_temp.refused(pg_temp.ev('gr-b5', '_org', 'gr-coord', 'v1.MemberAdded', '{"profileId":"gr-owner","roleId":"viewer","scope":{"level":"org"}}'),
  'may not emit v1.MemberAdded: they hold more there than you do', 'a coordinator demoting the owner');
select pg_temp.refused(pg_temp.ev('gr-b6', '_org', 'gr-owner', 'v1.MemberAdded', '{"profileId":"gr-view","roleId":"nobody","scope":{"level":"org"}}'),
  'may not emit v1.MemberAdded: there is no role nobody', 'granting a role that does not exist');
-- An owner holds everything and may change the coordinator.
select pg_temp.accepted(pg_temp.ev('gr-b7', '_org', 'gr-owner', 'v1.MemberAdded', '{"profileId":"gr-coord","roleId":"coordinator","scope":{"level":"language","languageId":"gr-L"}}'),
  'an owner giving a coordinator a language');
-- Roles: an owner whose own role lost Manage templates may not give a role more than they hold.
select set_config('request.jwt.claim.sub', '', true);
select public.append_events(jsonb_build_array(
  pg_temp.ev('gr-c0', '_org', 'gr-owner', 'v1.RoleDefined', '{"roleId":"half_admin","name":"Half admin","privileges":["manage_roles","invite_members","view_status"]}'),
  pg_temp.ev('gr-c0b', '_org', 'gr-owner', 'v1.MemberAdded', '{"profileId":"gr-view","roleId":"half_admin","scope":{"level":"org"}}')));
select pg_temp.refused(pg_temp.ev('gr-c1', '_org', 'gr-view', 'v1.RoleDefined', '{"roleId":"big","name":"Big","privileges":["manage_roles","assign_work"]}'),
  'may not emit v1.RoleDefined: you may only give a role privileges you hold', 'defining a role above one''s own');
select pg_temp.refused(pg_temp.ev('gr-c2', '_org', 'gr-view', 'v1.RoleDefined', '{"roleId":"coordinator","name":"Coordinator","privileges":["view_status"]}'),
  'may not emit v1.RoleDefined: that role holds more than you do', 'stripping a role above one''s own');
select pg_temp.refused(pg_temp.ev('gr-c3', '_org', 'gr-view', 'v1.RoleRetired', '{"roleId":"coordinator"}'),
  'may not emit v1.RoleRetired: that role holds more than you do', 'retiring a role above one''s own');
select pg_temp.accepted(pg_temp.ev('gr-c4', '_org', 'gr-view', 'v1.RoleDefined', '{"roleId":"watcher","name":"Watcher","privileges":["view_status"]}'),
  'defining a role within one''s own');

-- 3. Invites and admissions grant only what the grantor holds, and an
--    invite lapses when its issuer could no longer issue it.
select set_config('request.jwt.claim.sub', 'gr-coord', true);
do $$ begin
  begin
    perform public.issue_invite_v3('gr-org', 'gr-inv-1', encode(extensions.digest(repeat('1', 64), 'sha256'), 'hex'), 'org_admin',
      '{"level":"org"}', now() + interval '1 day');
    raise exception 'a coordinator invited someone as owner';
  exception when insufficient_privilege then null; end;
  perform public.issue_invite_v3('gr-org', 'gr-inv-2', encode(extensions.digest(repeat('2', 64), 'sha256'), 'hex'), 'translator',
    '{"level":"language","languageId":"gr-L"}', now() + interval '1 day');
end $$;
select set_config('request.jwt.claim.sub', 'gr-asker', true);
select public.create_join_request('gr-org', 'gr-req-1', 'hello');
select set_config('request.jwt.claim.sub', 'gr-coord', true);
do $$ begin
  begin
    perform public.decide_join_request_v2('gr-req-1', true, 'org_admin', '{"level":"org"}');
    raise exception 'a coordinator admitted someone as owner';
  exception when insufficient_privilege then null; end;
end $$;
-- The owner takes Invite away from the coordinator: their invite no longer redeems.
select pg_temp.accepted(pg_temp.ev('gr-d1', '_org', 'gr-owner', 'v1.MemberAdded', '{"profileId":"gr-coord","roleId":"viewer","scope":{"level":"org"}}'),
  'an owner demoting the coordinator');
select pg_temp.accepted(pg_temp.ev('gr-d2', '_org', 'gr-owner', 'v1.MemberRemoved', '{"profileId":"gr-coord","scope":{"level":"language","languageId":"gr-L"}}'),
  'an owner taking the coordinator off the language');
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  if public.preview_invite(repeat('2', 64))->>'status' <> 'retired' then raise exception 'the lapsed invite should read as retired'; end if;
  begin
    perform public.redeem_invite_for('gr-joiner', repeat('2', 64));
    raise exception 'an invite redeemed after its issuer lost Invite';
  exception when sqlstate '22023' then null; end;
end $$;

-- 4. One id, one event.
select pg_temp.accepted(pg_temp.ev('gr-e1', 'gr-L', 'gr-tr', 'v1.TakeComposed', jsonb_build_object('takeId', 'gr-take', 'unitId', 'u1',
  'cardHashes', jsonb_build_array(repeat('a', 64)), 'parentTakeId', null)), 'a take');
do $$ declare r record; begin
  -- The same event again is a duplicate.
  select * into r from public.append_events((select jsonb_build_array(jsonb_build_object('id', e.id, 'type', e.type, 'orgId', e.org_id,
    'streamId', e.stream_id, 'actorId', e.actor_id, 'deviceId', e.device_id, 'hlc', e.hlc, 'payload', e.payload)) from public.events e where e.id = 'gr-e1'));
  if not r.accepted or r.reason <> 'duplicate' then raise exception 'a resend should be a duplicate, got %', r; end if;
end $$;
select pg_temp.refused(pg_temp.ev('gr-e1', 'gr-L', 'gr-tr', 'v1.NoteAdded', '{"noteId":"gr-n0","unitId":"u1","anchor":{"kind":"passage"},"text":"x"}'),
  'malformed envelope: event id already used', 'an id reused for another event');
select pg_temp.refused(pg_temp.ev('gr-1', 'gr-L', 'gr-tr', 'v1.NoteAdded', '{"noteId":"gr-n9","unitId":"u1","anchor":{"kind":"passage"},"text":"x"}'),
  'malformed envelope: event id already used', 'another person''s id in another stream');
select pg_temp.refused(pg_temp.ev('removed:gr-e9', 'gr-L', 'gr-tr', 'v1.NoteAdded', '{"noteId":"gr-n1","unitId":"u1","anchor":{"kind":"passage"},"text":"x"}'),
  'malformed envelope: event id reserved for the server', 'a moderation id taken first');
select pg_temp.refused(pg_temp.ev('accountdeleted:gr-owner:org', 'gr-L', 'gr-tr', 'v1.NoteAdded', '{"noteId":"gr-n2","unitId":"u1","anchor":{"kind":"passage"},"text":"x"}'),
  'malformed envelope: event id reserved for the server', 'an account-deletion id taken first');
select pg_temp.refused(pg_temp.ev('invitemember:gr-inv-2', 'gr-L', 'gr-tr', 'v1.NoteAdded', '{"noteId":"gr-n3","unitId":"u1","anchor":{"kind":"passage"},"text":"x"}'),
  'malformed envelope: event id reserved for the server', 'an invite''s membership id taken first');
select pg_temp.refused(pg_temp.ev('invitecheck:gr-inv-2:peer:gr-joiner', 'gr-L', 'gr-tr', 'v1.NoteAdded', '{"noteId":"gr-n4","unitId":"u1","anchor":{"kind":"passage"},"text":"x"}'),
  'malformed envelope: event id reserved for the server', 'an invite''s check-team id taken first');

-- 5. One create, one entity: no second compose of a take, no backdated review over someone's.
select pg_temp.refused(pg_temp.ev('gr-e2', 'gr-L', 'gr-tr', 'v1.TakeComposed', jsonb_build_object('takeId', 'gr-take', 'unitId', 'u1',
  'cardHashes', jsonb_build_array(repeat('f', 64)), 'parentTakeId', null)), 'invalid payload: take id gr-take is already used', 'a second compose of a take');
select pg_temp.accepted(pg_temp.ev('gr-e3', 'gr-L', 'gr-owner', 'v1.ReviewRecorded', '{"reviewId":"gr-rev","takeId":"gr-take","kindId":"peer","outcome":"needs_changes","via":"app"}'),
  'a review');
do $$ declare r record; begin
  perform set_config('request.jwt.claim.sub', 'gr-tr', true);
  select * into r from public.append_events('[{"id":"gr-e4","type":"v1.ReviewRecorded","orgId":"gr-org","streamId":"gr-L","actorId":"gr-tr","deviceId":"dG",
    "hlc":"000000000000001:000000:dG","payload":{"reviewId":"gr-rev","takeId":"gr-take","kindId":"peer","outcome":"looks_good","via":"logged"}}]'::jsonb);
  if r.accepted or r.reason <> 'invalid payload: review id gr-rev is already used' then raise exception 'a backdated review over someone''s, got %', r; end if;
end $$;

-- 6. An organization someone else has written to cannot be bootstrapped:
--    the library seed and an import write before anyone is a member.
select set_config('request.jwt.claim.sub', '', true);
select public.library_seed_events('gr-seeded', '[{"id":"seed:gr-seeded:created","type":"v1.OrgCreated","payload":{"name":"Seeded"}}]');
do $$ declare r record; begin
  perform set_config('request.jwt.claim.sub', 'gr-squatter', true);
  for r in select * from public.append_events('[
    {"id":"gr-s1","type":"v1.OrgCreated","orgId":"gr-seeded","streamId":"_org","actorId":"gr-squatter","deviceId":"dS","hlc":"000000000000001:000000:dS","payload":{"name":"Mine"}},
    {"id":"gr-s2","type":"v1.MemberAdded","orgId":"gr-seeded","streamId":"_org","actorId":"gr-squatter","deviceId":"dS","hlc":"000000000000002:000000:dS","payload":{"profileId":"gr-squatter","roleId":"x","scope":{"level":"org"}}}
  ]'::jsonb) loop
    if r.accepted then raise exception 'a seeded organization was claimed: %', r; end if;
  end loop;
end $$;

-- 7. Writing a file needs more than reading its stream: a language's files
--    by whoever does more than view it, once it is listed; the
--    organization's guide files by whoever manages its library; a person's
--    stream by nobody. Reading is unchanged.
select set_config('request.jwt.claim.sub', '', true);
select public.append_events(jsonb_build_array(
  pg_temp.ev('gr-f0', '_org', 'gr-owner', 'v1.MemberAdded', '{"profileId":"gr-viewer","roleId":"viewer","scope":{"level":"org"}}')));
do $$
declare h text := repeat('b', 64);
begin
  if not public.blob_access('gr-org/gr-L/' || h || '.m4a', 'gr-tr', true) then raise exception 'a translator should upload to their language'; end if;
  if public.blob_access('gr-org/gr-L/' || h || '.m4a', 'gr-viewer', true) then raise exception 'a viewer uploaded to a language'; end if;
  if not public.blob_access('gr-org/gr-L/' || h || '.m4a', 'gr-viewer', false) then raise exception 'a viewer should still hear the language'; end if;
  if public.blob_access('gr-org/made-up/' || h || '.m4a', 'gr-owner', true) then raise exception 'an upload made a stream nobody listed'; end if;
  if public.blob_access('_person/gr-tr/' || h || '.m4a', 'gr-tr', true) then raise exception 'an upload reached a person stream'; end if;
  if public.blob_access('gr-org/_org/' || h || '.jpg', 'gr-tr', true) then raise exception 'a translator uploaded guide files'; end if;
  if not public.blob_access('gr-org/_org/' || h || '.jpg', 'gr-owner', true) then raise exception 'an owner should upload guide files'; end if;
  if public.blob_access('gr-org/gr-L/' || h || '.m4a', 'gr-stranger', false) then raise exception 'a stranger heard a language'; end if;
end $$;

-- 8. Nobody signed in asks what someone else may do.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'gr-tr', true);
do $$ begin
  perform public.may_emit('gr-org', '_org', 'gr-owner', 'v1.RoleDefined', '{}');
  raise exception 'a signed-in person asked may_emit about someone else';
exception when insufficient_privilege then null;
end $$;
reset role;

-- 9. The language tables are public, but not who added a row.
set local role anon;
do $$ begin
  perform l.id, l.name from public.languoid l limit 1;
  begin
    perform l.creator_id from public.languoid l limit 1;
    raise exception 'creator_id was readable signed out';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 10. Taking back a checkpoint override needs Override checkpoints, as making
-- one does (PASS-056, decided 2026-10-13): may_emit looks the departure up.
-- Undoing a set-aside keeps the wider list.
select pg_temp.accepted(pg_temp.ev('gr-f1', 'gr-L', 'gr-owner', 'v1.DepartureRecorded',
  '{"departureId":"dep:gr-o","unitId":"u1","type":"override","stepId":"s1","reason":"Consultant away"}'), 'an owner overriding a checkpoint');
select pg_temp.refused(pg_temp.ev('gr-f2', 'gr-L', 'gr-tr', 'v1.DepartureUndone', '{"departureId":"dep:gr-o"}'),
  'may not emit v1.DepartureUndone', 'a translator undoing an override');
select pg_temp.accepted(pg_temp.ev('gr-f3', 'gr-L', 'gr-tr', 'v1.DepartureRecorded',
  '{"departureId":"dep:gr-s","unitId":"u1","type":"skip","kindId":"peer","reason":"Done on paper"}'), 'a translator setting a check aside');
select pg_temp.accepted(pg_temp.ev('gr-f4', 'gr-L', 'gr-tr', 'v1.DepartureUndone', '{"departureId":"dep:gr-s"}'), 'a translator undoing a set-aside');
select pg_temp.accepted(pg_temp.ev('gr-f5', 'gr-L', 'gr-owner', 'v1.DepartureUndone', '{"departureId":"dep:gr-o"}'), 'an owner undoing an override');

-- 10b. Only whoever recorded a review or added a note may take it back
-- (LAN-84, decisions.md 111): may_emit looks it up in the same stream.
-- gr-rev is gr-owner's (section 5); gr-tr adds a note of their own.
select pg_temp.refused(pg_temp.ev('gr-w1', 'gr-L', 'gr-tr', 'v1.ReviewWithdrawn', '{"reviewId":"gr-rev"}'),
  'may not emit v1.ReviewWithdrawn', 'someone taking back another person''s review');
select pg_temp.refused(pg_temp.ev('gr-w2', 'gr-L', 'gr-owner', 'v1.ReviewWithdrawn', '{"reviewId":"gr-nobody"}'),
  'may not emit v1.ReviewWithdrawn', 'taking back a review the server has not seen');
select pg_temp.accepted(pg_temp.ev('gr-w3', 'gr-L', 'gr-owner', 'v1.ReviewWithdrawn', '{"reviewId":"gr-rev"}'), 'a reviewer taking back their own review');
select pg_temp.accepted(pg_temp.ev('gr-w4', 'gr-L', 'gr-tr', 'v1.NoteAdded', '{"noteId":"gr-wn","unitId":"u1","anchor":{"kind":"passage"},"text":"x"}'), 'a note');
select pg_temp.refused(pg_temp.ev('gr-w5', 'gr-L', 'gr-owner', 'v1.NoteWithdrawn', '{"noteId":"gr-wn"}'),
  'may not emit v1.NoteWithdrawn', 'an owner taking back someone else''s note');
select pg_temp.accepted(pg_temp.ev('gr-w6', 'gr-L', 'gr-tr', 'v1.NoteWithdrawn', '{"noteId":"gr-wn"}'), 'a translator taking back their own note');

-- 11. An organization always keeps someone who can manage roles (PEOPLE-026,
-- decided 2026-10-13). gr-view's half admin role (section 2) manages roles too; once
-- gr-view is a viewer again, gr-owner is the only one.
select pg_temp.accepted(pg_temp.ev('gr-g0', '_org', 'gr-owner', 'v1.MemberAdded', '{"profileId":"gr-view","roleId":"viewer","scope":{"level":"org"}}'),
  'an owner demoting one of two who manage roles');
select pg_temp.refused(pg_temp.ev('gr-g1', '_org', 'gr-owner', 'v1.MemberRemoved', '{"profileId":"gr-owner","scope":{"level":"org"}}'),
  'may not emit v1.MemberRemoved: nobody else could manage roles; give someone Manage roles first', 'the last admin leaving');
select pg_temp.refused(pg_temp.ev('gr-g2', '_org', 'gr-owner', 'v1.MemberAdded', '{"profileId":"gr-owner","roleId":"coordinator","scope":{"level":"org"}}'),
  'may not emit v1.MemberAdded: nobody else could manage roles; give someone Manage roles first', 'the last admin demoting themselves');
select pg_temp.refused(pg_temp.ev('gr-g3', '_org', 'gr-owner', 'v1.RoleDefined', '{"roleId":"org_admin","name":"Organization Admin","privileges":["invite_members","view_status"]}'),
  'may not emit v1.RoleDefined: nobody else could manage roles; give someone Manage roles first', 'taking Manage roles off the only role with it');
select pg_temp.refused(pg_temp.ev('gr-g4', '_org', 'gr-owner', 'v1.RoleRetired', '{"roleId":"org_admin"}'),
  'may not emit v1.RoleRetired: nobody else could manage roles; give someone Manage roles first', 'retiring the only role with Manage roles');
-- With a second admin, either may go.
select pg_temp.accepted(pg_temp.ev('gr-g5', '_org', 'gr-owner', 'v1.MemberAdded', '{"profileId":"gr-coord","roleId":"org_admin","scope":{"level":"org"}}'), 'a second admin');
select pg_temp.accepted(pg_temp.ev('gr-g6', '_org', 'gr-owner', 'v1.MemberRemoved', '{"profileId":"gr-owner","scope":{"level":"org"}}'), 'an admin leaving another behind');

-- 12. What one account writes dated one day (decisions.md 169): what was
-- taken counts, on the day of the event's own clock but never before the
-- account was made; an event over the allowance is refused on its own; the
-- service role is not counted.
create function pg_temp.dated(p_event jsonb, p_days int) returns jsonb language sql as $$
  select jsonb_set(p_event, '{hlc}', to_jsonb(lpad(((extract(epoch from now() - make_interval(days => p_days)) * 1000)::bigint)::text, 15, '0') || ':000000:dG'));
$$;
create function pg_temp.note(p_id text, p_actor text) returns jsonb language sql as $$
  select pg_temp.ev(p_id, 'gr-L', p_actor, 'v1.NoteAdded', jsonb_build_object('noteId', p_id || '-n', 'unitId', 'u1', 'anchor', '{"kind":"passage"}'::jsonb, 'text', 'x'));
$$;
create function pg_temp.used(p_actor text, p_days int) returns int language sql as $$
  select coalesce((select events from public.append_allowance where actor_id = p_actor and day = (now() at time zone 'utc')::date - p_days), 0);
$$;
select pg_temp.accepted(pg_temp.note('gr-q1', 'gr-tr'), 'a note');
do $$ declare v_before int := pg_temp.used('gr-tr', 0); begin
  if v_before < 1 then raise exception 'a note was not counted'; end if;
  perform pg_temp.push(pg_temp.note('gr-q1', 'gr-tr'));
  if pg_temp.used('gr-tr', 0) <> v_before then raise exception 'a duplicate was counted'; end if;
  update public.append_allowance set events = 20000 where actor_id = 'gr-tr' and day = (now() at time zone 'utc')::date;
end $$;
select pg_temp.refused(pg_temp.note('gr-q2', 'gr-tr'),
  format('may not emit v1.NoteAdded: this account has written 20000 events dated %s', (now() at time zone 'utc')::date), 'a note over the day''s allowance');
-- Work dated another day, as from a phone that was offline, still goes up.
select pg_temp.accepted(pg_temp.dated(pg_temp.note('gr-q3', 'gr-tr'), 5), 'a note made offline five days ago');
do $$ begin
  if pg_temp.used('gr-tr', 5) <> 1 then raise exception 'offline work was not counted on its own day'; end if;
  update public.append_allowance set events = 0, bytes = 104857600 where actor_id = 'gr-tr' and day = (now() at time zone 'utc')::date;
end $$;
select pg_temp.refused(pg_temp.note('gr-q4', 'gr-tr'),
  format('may not emit v1.NoteAdded: this account has written 100 MB of events dated %s', (now() at time zone 'utc')::date), 'a note over the day''s bytes');
-- An account made three days ago cannot date its events earlier to write more.
insert into auth.users (id, created_at) values ('00000000-0000-0000-0000-0000000000a1', now() - interval '3 days');
do $$ declare r record; begin
  -- Joined, as the server adds them (an invite).
  perform set_config('request.jwt.claim.sub', '', true);
  select * into r from public.append_events(jsonb_build_array(pg_temp.ev('gr-q5', '_org', 'gr-coord', 'v1.MemberAdded',
    '{"profileId":"00000000-0000-0000-0000-0000000000a1","roleId":"translator","scope":{"level":"language","languageId":"gr-L"}}')));
  if not r.accepted then raise exception 'a new account joining: refused: %', r.reason; end if;
end $$;
select pg_temp.accepted(pg_temp.dated(pg_temp.note('gr-q6', '00000000-0000-0000-0000-0000000000a1'), 10), 'a note dated before the account');
do $$ begin
  if pg_temp.used('00000000-0000-0000-0000-0000000000a1', 3) <> 1 then raise exception 'a note dated before the account was not counted on the day it was made'; end if;
  update public.append_allowance set events = 20000 where actor_id = '00000000-0000-0000-0000-0000000000a1';
end $$;
select pg_temp.refused(pg_temp.dated(pg_temp.note('gr-q7', '00000000-0000-0000-0000-0000000000a1'), 9),
  format('may not emit v1.NoteAdded: this account has written 20000 events dated %s', (now() at time zone 'utc')::date - 3), 'a note dated earlier still to write more');
do $$ declare v_before int := pg_temp.used('gr-tr', 0); begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.append_events(jsonb_build_array(pg_temp.note('gr-q8', 'gr-tr')));
  if not exists (select 1 from public.events where id = 'gr-q8') then raise exception 'the service role''s import was refused'; end if;
  if pg_temp.used('gr-tr', 0) <> v_before then raise exception 'the service role''s import was counted'; end if;
end $$;
-- A person's stream holds each kind of event once, the terms once a version.
select set_config('request.jwt.claim.sub', 'gr-tr', true);
select public.record_user_event('gr-tr:v1.VisionSeen:1', 'v1.VisionSeen', '{}');
select public.record_user_event('gr-tr:v1.VisionSeen:2', 'v1.VisionSeen', '{}');
select public.record_user_event('gr-tr:v1.TermsAccepted:a', 'v1.TermsAccepted', '{"version":"a"}');
select public.record_user_event('gr-tr:v1.TermsAccepted:a2', 'v1.TermsAccepted', '{"version":"a"}');
select public.record_user_event('gr-tr:v1.TermsAccepted:b', 'v1.TermsAccepted', '{"version":"b"}');
do $$ begin
  if (select count(*) from public.events where org_id = '_person' and stream_id = 'gr-tr' and type = 'v1.VisionSeen') <> 1 then
    raise exception 'the welcome was kept twice';
  end if;
  if (select count(*) from public.events where org_id = '_person' and stream_id = 'gr-tr' and type = 'v1.TermsAccepted') <> 2 then
    raise exception 'expected one acceptance for each of two versions';
  end if;
  begin
    perform public.record_user_event('gr-tr:v1.WalkthroughDone:1', 'v1.WalkthroughDone', '{"pad":"xxxxxxxx"}');
    raise exception 'a person event with a payload was kept';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.record_user_event('gr-tr:v1.TermsAccepted:c', 'v1.TermsAccepted', '{"version":"c","pad":"x"}');
    raise exception 'terms with more than a version were kept';
  exception when sqlstate '22023' then null; end;
end $$;
rollback;
