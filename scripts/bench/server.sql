-- Server costs the fleet cannot see (performance-audit.md section 2.5):
-- append_events per 200-event batch (the time it holds the stream's lock,
-- so the time a second writer to that stream waits), a pull page, and the
-- snapshot download RPCs on a Bible-sized snapshot. One transaction,
-- rolled back: the local database is left as it was. Run it with
-- `npm run bench:server`, which reads the `bench` notices.
--
-- An empty organization is the best case for every lookup; a real one has
-- larger tables. Compare runs with each other.

\set ON_ERROR_STOP on
begin;
update public.server_config set min_client_version = 0;
select set_config('request.jwt.claim.sub', 'bench-lead', true);

do $$ declare r record; begin
  for r in select * from public.append_events('[
    {"id":"bench-o1","type":"v1.OrgCreated","orgId":"bench-org","streamId":"_org","actorId":"bench-lead","deviceId":"dA","hlc":"000000000000001:000000:dA","payload":{"name":"Bench"}},
    {"id":"bench-o2","type":"v1.RoleDefined","orgId":"bench-org","streamId":"_org","actorId":"bench-lead","deviceId":"dA","hlc":"000000000000002:000000:dA","payload":{"roleId":"org_admin","name":"Organization Admin","privileges":["manage_structure","invite_members","manage_roles","manage_templates","shape_templates","manage_reference","manage_flows","manage_teams","assign_work","override_checkpoints","translate","fill_reference","send_to_reviewers","review","view_status"]}},
    {"id":"bench-o3","type":"v1.MemberAdded","orgId":"bench-org","streamId":"_org","actorId":"bench-lead","deviceId":"dA","hlc":"000000000000003:000000:dA","payload":{"profileId":"bench-lead","roleId":"org_admin","scope":{"level":"org"}}},
    {"id":"bench-o4","type":"v1.LanguageAdded","orgId":"bench-org","streamId":"_org","actorId":"bench-lead","deviceId":"dA","hlc":"000000000000004:000000:dA","payload":{"languageId":"bench-L","name":"Bench Language","code":"fia","sourceCode":"eng"}}
  ]'::jsonb) loop
    if not r.accepted then raise exception 'bench setup event % refused: %', r.id, r.reason; end if;
  end loop;
end $$;

-- 200-event batches, as phones push: units (no create-once check) and
-- recordings (create-once: the entity check under the stream's lock).
do $$
declare
  kind text;
  b int;
  batch jsonb;
  t0 timestamptz;
  ms numeric;
  refused int;
  times numeric[];
  seq int := 0;
begin
  foreach kind in array array['UnitAdded', 'RecordingAdded'] loop
    times := '{}';
    for b in 1..5 loop
      select jsonb_agg(jsonb_build_object(
        'id', format('bench-%s-%s-%s', kind, b, g), 'type', 'v1.' || kind, 'orgId', 'bench-org', 'streamId', 'bench-L',
        'actorId', 'bench-lead', 'deviceId', 'dA', 'hlc', format('%s:000000:dA', lpad((1000 + b * 1000 + g)::text, 15, '0')),
        'payload', case kind
          when 'UnitAdded' then jsonb_build_object('unitId', format('u-%s-%s', b, g), 'parentUnitId', null, 'kind', 'passage', 'label', format('P %s', g), 'order', lpad(g::text, 5, '0'))
          else jsonb_build_object('recordingId', format('r-%s-%s', b, g), 'unitId', format('u-1-%s', g), 'kind', 'target',
                                  'cards', jsonb_build_array(jsonb_build_object('hash', md5(b::text || g::text) || md5(g::text || b::text), 'durationMs', 4000)))
        end))
        into batch from generate_series(1, 200) g;
      t0 := clock_timestamp();
      select count(*) filter (where not accepted) into refused from public.append_events(batch);
      ms := extract(epoch from clock_timestamp() - t0) * 1000;
      if refused > 0 then raise exception 'bench batch of % refused % events', kind, refused; end if;
      times := times || round(ms, 1);
    end loop;
    raise notice 'bench %', jsonb_build_object('measure', 'append 200 ' || kind, 'ms', to_jsonb(times));
  end loop;
end $$;

-- Realtime pokes one 200-event push makes (the notify trigger may wait
-- for commit, so fire any deferred ones now).
do $$ declare before bigint; batch jsonb; n bigint; begin
  select count(*) into before from realtime.messages;
  select jsonb_agg(jsonb_build_object(
    'id', format('bench-poke-%s', g), 'type', 'v1.UnitAdded', 'orgId', 'bench-org', 'streamId', 'bench-L',
    'actorId', 'bench-lead', 'deviceId', 'dA', 'hlc', format('%s:000000:dA', lpad((900000 + g)::text, 15, '0')),
    'payload', jsonb_build_object('unitId', format('poke-%s', g), 'parentUnitId', null, 'kind', 'passage', 'label', 'P', 'order', 'p')))
    into batch from generate_series(1, 200) g;
  perform * from public.append_events(batch);
  set constraints all immediate;
  select count(*) - before into n from realtime.messages;
  raise notice 'bench %', jsonb_build_object('measure', 'realtime messages per 200-event push', 'ms', 0, 'messages', n);
end $$;

-- One pull page, as a phone asks for it.
do $$ declare t0 timestamptz; n int; begin
  t0 := clock_timestamp();
  select count(*) into n from public.pull_events('bench-org', 'bench-L', 0, 500, 0);
  raise notice 'bench %', jsonb_build_object('measure', 'pull 500 events', 'ms', round(extract(epoch from clock_timestamp() - t0) * 1000, 1), 'rows', n);
end $$;

-- A Bible-sized snapshot (about 13 MB of JSON, varied enough not to
-- compress unrealistically), then the RPCs a phone's cold start calls.
select set_config('request.jwt.claim.sub', '', true);
do $$ declare state jsonb; t0 timestamptz; begin
  select jsonb_build_object('units', jsonb_object_agg(format('b%s/p%s', g / 40, g), jsonb_build_object(
           'label', md5(g::text), 'kind', 'passage', 'order', md5(g::text || 'o'),
           'hlc', format('%s:000000:%s', lpad((1700000000000 + g)::text, 15, '0'), md5(g::text)), 'eventId', md5(g::text || 'e'))))
    into state from generate_series(1, 60000) g;
  t0 := clock_timestamp();
  perform public.put_snapshot('bench-org', 'bench-L', 1, 1000, state);
  raise notice 'bench %', jsonb_build_object('measure', 'put_snapshot', 'ms', round(extract(epoch from clock_timestamp() - t0) * 1000, 1), 'jsonChars', length(state::text));
end $$;

select set_config('request.jwt.claim.sub', 'bench-lead', true);
do $$ declare m record; t0 timestamptz; i int; times numeric[] := '{}'; begin
  t0 := clock_timestamp();
  select * into m from public.get_snapshot_meta('bench-org', 'bench-L', 1);
  raise notice 'bench %', jsonb_build_object('measure', 'get_snapshot_meta', 'ms', round(extract(epoch from clock_timestamp() - t0) * 1000, 1), 'chunks', m.chunks, 'bytes', m.bytes);
  foreach i in array array[0, m.chunks / 2, m.chunks - 1] loop
    t0 := clock_timestamp();
    perform public.get_snapshot_chunk('bench-org', 'bench-L', 1, m.server_seq, i);
    times := times || round(extract(epoch from clock_timestamp() - t0) * 1000, 1);
  end loop;
  raise notice 'bench %', jsonb_build_object('measure', 'get_snapshot_chunk (first, middle, last)', 'ms', to_jsonb(times), 'chunks', m.chunks);
end $$;

rollback;
