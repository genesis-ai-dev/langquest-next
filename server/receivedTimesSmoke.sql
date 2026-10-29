-- When the server received a language's records (decisions.md 188):
-- received_times answers the access-token API's uploadedAt from the
-- database's own stamp on each event, by take, by entity and by id, for one
-- stream only, and only to the service role. Repeatable; every write rolls
-- back.
\set ON_ERROR_STOP on
begin;
update public.server_config set min_client_version = 0;

-- An organization with two languages, set up as the server would (an import).
select set_config('request.jwt.claim.sub', '', true);
do $$ declare r record; begin
  for r in select * from public.append_events('[
    {"id":"rt-1","type":"v1.OrgCreated","orgId":"rt-org","streamId":"_org","actorId":"rt-owner","deviceId":"dR","hlc":"000000000000001:000000:dR","payload":{"name":"Receipts"}},
    {"id":"rt-2","type":"v1.RoleDefined","orgId":"rt-org","streamId":"_org","actorId":"rt-owner","deviceId":"dR","hlc":"000000000000002:000000:dR","payload":{"roleId":"org_admin","name":"Organization Admin","privileges":["manage_structure","invite_members","manage_roles","manage_templates","shape_templates","manage_reference","manage_flows","manage_teams","assign_work","override_checkpoints","translate","fill_reference","send_to_reviewers","review","view_status"]}},
    {"id":"rt-3","type":"v1.MemberAdded","orgId":"rt-org","streamId":"_org","actorId":"rt-owner","deviceId":"dR","hlc":"000000000000003:000000:dR","payload":{"profileId":"rt-owner","roleId":"org_admin","scope":{"level":"org"}}},
    {"id":"rt-4","type":"v1.LanguageAdded","orgId":"rt-org","streamId":"_org","actorId":"rt-owner","deviceId":"dR","hlc":"000000000000004:000000:dR","payload":{"languageId":"rt-L","name":"Receiptish","code":"rcp","sourceCode":"eng"}},
    {"id":"rt-5","type":"v1.LanguageAdded","orgId":"rt-org","streamId":"_org","actorId":"rt-owner","deviceId":"dR","hlc":"000000000000005:000000:dR","payload":{"languageId":"rt-M","name":"Otherish","code":"oth","sourceCode":"eng"}}
  ]'::jsonb) loop
    if not r.accepted then raise exception 'setup event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;

-- The owner's work in rt-L, from a phone whose clock was a week behind (it
-- was offline), and a take of the same id in rt-M, which rt-L must not see.
create function pg_temp.ev(p_id text, p_stream text, p_type text, p_payload jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'type', p_type, 'orgId', 'rt-org', 'streamId', p_stream, 'actorId', 'rt-owner', 'deviceId', 'dR',
    'hlc', lpad(((extract(epoch from clock_timestamp()) * 1000)::bigint - 7 * 86400000)::text, 15, '0') || ':' || lpad(right(p_id, 2), 6, '0') || ':dR',
    'payload', p_payload);
$$;
do $$ declare r record; begin
  perform set_config('request.jwt.claim.sub', 'rt-owner', true);
  for r in select * from public.append_events(jsonb_build_array(
    pg_temp.ev('rt-L-01', 'rt-L', 'v1.UnitAdded', '{"unitId":"u1","parentUnitId":null,"kind":"passage","label":"One","order":"a"}'),
    pg_temp.ev('rt-L-02', 'rt-L', 'v1.TakeComposed', '{"takeId":"t1","unitId":"u1","cardHashes":[],"parentTakeId":null}'),
    pg_temp.ev('rt-L-03', 'rt-L', 'v1.TakeSubmitted', '{"takeId":"t1"}'),
    pg_temp.ev('rt-L-04', 'rt-L', 'v1.ReviewRecorded', '{"reviewId":"rv1","takeId":"t1","kindId":"peer","outcome":"looks_good","via":"app"}'),
    pg_temp.ev('rt-L-05', 'rt-L', 'v1.RequestMade', '{"requestId":"rq1","unitId":"u1","what":"review","kindId":"peer","profileId":"rt-owner"}'),
    pg_temp.ev('rt-M-06', 'rt-M', 'v1.UnitAdded', '{"unitId":"u1","parentUnitId":null,"kind":"passage","label":"One","order":"a"}'),
    pg_temp.ev('rt-M-07', 'rt-M', 'v1.TakeComposed', '{"takeId":"t1","unitId":"u1","cardHashes":[],"parentTakeId":null}'),
    pg_temp.ev('rt-M-08', 'rt-M', 'v1.TakeSubmitted', '{"takeId":"t1"}')
  )) loop
    if not r.accepted then raise exception 'work event % refused: %', r.id, r.reason; end if;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- 1. Each key is answered with the database's stamp, not the phone's week-old clock.
do $$ declare got jsonb; want jsonb; begin
  select jsonb_object_agg(t.key, t.received_at) into got
    from public.received_times('rt-org', 'rt-L', array['t1', 'nope'], array['review:rv1', 'request:rq1', 'review:nope'], array['rt-L-01', 'rt-M-06']) t;
  select jsonb_build_object(
      'submitted:t1', (select received_at from public.events where id = 'rt-L-03'),
      'review:rv1', (select received_at from public.events where id = 'rt-L-04'),
      'request:rq1', (select received_at from public.events where id = 'rt-L-05'),
      'event:rt-L-01', (select received_at from public.events where id = 'rt-L-01'))
    into want;
  -- Keys with no row in this stream (another language's event among them) are left out.
  if got is distinct from want then raise exception 'received_times: got %, want %', got, want; end if;
  if (got->>'submitted:t1')::timestamptz < now() - interval '1 minute' then raise exception 'a stamp should be the server''s time, not the phone''s: %', got; end if;
end $$;

-- 2. Nothing asked, nothing answered.
do $$ begin
  if exists (select 1 from public.received_times('rt-org', 'rt-L', '{}', '{}', '{}')) then raise exception 'empty lists should answer nothing'; end if;
end $$;

-- 3. The service role's alone: it answers about any stream.
do $$ declare v text; begin
  select string_agg(r, ', ') into v from unnest(array['anon', 'authenticated', 'public']) r
   where has_function_privilege(r, 'public.received_times(text, text, text[], text[], text[])', 'execute');
  if v is not null then raise exception 'received_times must be the service role''s alone, not: %', v; end if;
  if not has_function_privilege('service_role', 'public.received_times(text, text, text[], text[], text[])', 'execute') then
    raise exception 'the service role must run received_times';
  end if;
end $$;

rollback;
