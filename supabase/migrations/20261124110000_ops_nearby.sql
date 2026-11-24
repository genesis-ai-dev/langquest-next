-- The ops dashboard's Nearby sync part, in Work safety
-- (docs/ops-dashboard-plan.md 5.4, docs/admin.md): how Share nearby and sharing
-- while LangQuest is open went across every organization, from the phones'
-- `nearby` records that arrived in the last 7 days (decision 235, as amended
-- 2026-11-24), and which organizations have the features on. Read live, as
-- diag_reader, through diag_records_kind_idx: the records are few, so the
-- part needs no daily totals of its own.
--
-- Counts and codes only. Organizations are named, as the rest of the page
-- names them (diag._org_name); never a language, a person or who met whom,
-- which no record holds. A small team's language would point at people, so
-- the part stops at the organization.

-- Find's native codes that mean the code or the radio failed, not that the
-- person turned Bluetooth, Wi-Fi or a permission off, nor that the phone has
-- no such radio: the dashboard's "Find failing" line counts installs with one
-- of these in the last day.
create or replace function diag.ops_nearby_fault_codes() returns text[] language sql immutable as $$
  select array['ADVERTISE_FAILED', 'SCAN_FAILED', 'FIND_NOT_RUNNING', 'BAD_ARGUMENT', 'INTERNAL']
$$;

create or replace function diag.ops_nearby() returns jsonb
language sql stable security definer set search_path = '' as $$
  with near as (
    select r.install_id, r.org_id, r.received_at, r.n, r.t, coalesce(r.t->>'mode', 'screen') as mode
    from diag.records r where r.kind = 'nearby' and r.received_at > now() - interval '7 days'
  ),
  rooms as (select * from near where t->>'event' = 'room'),
  sessions as (select * from near where t->>'event' = 'session'),
  delivers as (select * from near where t->>'event' = 'deliver'),
  feat as (
    select f.org_id, bool_or(f.feature = 'nearby') as nearby, bool_or(f.feature = 'nearby_join') as joins, bool_or(f.feature = 'nearby_open') as quiet
    from public.org_features f where f.revoked_at is null group by 1
  ),
  orgs as (
    select org_id from feat union select org_id from near where org_id is not null
  )
  select jsonb_build_object(
    'installs', (select count(distinct install_id) from near),
    -- Rooms by the way each ran: on Share nearby (`screen`) or while LangQuest was open (`open`).
    'screen', (select jsonb_build_object(
        'rooms', count(*), 'installs', count(distinct install_id),
        'heardAny', count(*) filter (where coalesce((n->>'heard')::numeric, 0) + coalesce((n->>'alone')::numeric, 0) > 0),
        'met', count(*) filter (where coalesce((n->>'sessions')::numeric, 0) > 0),
        'sessions', coalesce(sum((n->>'sessions')::numeric), 0), 'done', coalesce(sum((n->>'done')::numeric), 0),
        'greets', coalesce(sum((n->>'greets')::numeric), 0))
      from rooms where mode = 'screen'),
    'open', (select jsonb_build_object(
        'runs', count(*), 'installs', count(distinct install_id),
        'met', count(*) filter (where coalesce((n->>'sessions')::numeric, 0) > 0),
        'sessions', coalesce(sum((n->>'sessions')::numeric), 0), 'done', coalesce(sum((n->>'done')::numeric), 0),
        'openMin', coalesce(sum((n->>'openMin')::numeric), 0), 'pauseMin', coalesce(sum((n->>'pauseMin')::numeric), 0),
        'scanMin', coalesce(sum((n->>'scanMin')::numeric), 0), 'syncMin', coalesce(sum((n->>'syncMin')::numeric), 0),
        'events', coalesce(sum((n->>'events')::numeric), 0), 'files', coalesce(sum((n->>'files')::numeric), 0),
        'viaDirect', coalesce(sum((n->>'viaDirect')::numeric), 0))
      from rooms where mode = 'open'),
    -- Sessions that did not finish, by how they ended (`end` or `end:bye`): one that finished while
    -- open has no record of its own, so a room's `done` counts it.
    'unfinished', (select coalesce(jsonb_object_agg(k, c), '{}'::jsonb) from (
        select coalesce(t->>'end', '?') || coalesce(':' || (t->>'bye'), '') as k, count(*) as c
        from sessions where coalesce(t->>'end', '') <> 'done' and coalesce(t->>'bye', '') <> 'done' group by 1) x),
    'refusals', (select coalesce(jsonb_object_agg(k, c), '{}'::jsonb) from (
        select t->>'refusal' as k, count(*) as c from sessions where t ? 'refusal' group by 1) x),
    'links', (select coalesce(jsonb_object_agg(k, c), '{}'::jsonb) from (
        select t->>'link' as k, count(*) as c from sessions where t ? 'link' group by 1) x),
    -- Teammates' work a phone carried to the server (docs/nearby-sync-plan.md section 6).
    'deliver', (select jsonb_build_object(
        'times', count(*), 'installs', count(distinct install_id),
        'sent', coalesce(sum((n->>'sent')::numeric), 0), 'taken', coalesce(sum((n->>'events')::numeric), 0),
        'refused', coalesce(sum((n->>'refused')::numeric), 0), 'farAhead', coalesce(sum((n->>'farAhead')::numeric), 0),
        'keyRefused', coalesce(sum((n->>'keyRefused')::numeric), 0))
      from delivers),
    -- The last day, for the lines: Find failing on phones, and carried work refused as stamped too far ahead.
    'day', jsonb_build_object(
      'findFaultInstalls', (select count(distinct install_id) from near
        where t->>'event' = 'find' and t->>'code' = any (diag.ops_nearby_fault_codes()) and received_at > now() - interval '1 day'),
      'findCodes', (select coalesce(jsonb_object_agg(k, c), '{}'::jsonb) from (
        select t->>'code' as k, count(distinct install_id) as c from near
        where t->>'event' = 'find' and t ? 'code' and received_at > now() - interval '1 day' group by 1) x),
      'farAhead', (select coalesce(sum((n->>'farAhead')::numeric), 0) from delivers where received_at > now() - interval '1 day'),
      'farAheadInstalls', (select count(distinct install_id) from delivers
        where coalesce((n->>'farAhead')::numeric, 0) > 0 and received_at > now() - interval '1 day')),
    -- Phones whose key was revoked that tried to share with an organization's phones, by organization.
    'revoked', (select coalesce(jsonb_agg(jsonb_build_object(
        'orgId', x.org_id, 'name', diag._org_name(x.org_id), 'refusals', x.c, 'installs', x.i, 'lastAt', x.last_at) order by x.last_at desc), '[]'::jsonb)
      from (select org_id, count(*) as c, count(distinct install_id) as i, max(received_at) as last_at
            from sessions where t->>'refusal' = 'revoked' and org_id is not null group by 1) x),
    -- Each organization with a feature on, or with records this week, and what its phones did.
    'orgs', (select coalesce(jsonb_agg(jsonb_build_object(
        'orgId', o.org_id, 'name', diag._org_name(o.org_id),
        'nearby', coalesce(f.nearby, false), 'join', coalesce(f.joins, false), 'open', coalesce(f.quiet, false),
        'installs', (select count(distinct install_id) from near x where x.org_id = o.org_id),
        'rooms', (select count(*) from rooms x where x.org_id = o.org_id and x.mode = 'screen'),
        'runs', (select count(*) from rooms x where x.org_id = o.org_id and x.mode = 'open'),
        'met', (select count(*) from rooms x where x.org_id = o.org_id and coalesce((x.n->>'sessions')::numeric, 0) > 0),
        'revoked', (select count(*) from sessions x where x.org_id = o.org_id and x.t->>'refusal' = 'revoked'),
        'lastAt', (select max(received_at) from near x where x.org_id = o.org_id)
      ) order by o.org_id), '[]'::jsonb)
      from orgs o left join feat f using (org_id))
  )
$$;

revoke all on function diag.ops_nearby_fault_codes() from public;
revoke all on function diag.ops_nearby() from public;
grant execute on function diag.ops_nearby_fault_codes() to diag_reader;
grant execute on function diag.ops_nearby() to diag_reader;
-- The same answers the page gives, for Claude's reads (20261121194800_claude_readers.sql).
grant execute on function diag.ops_nearby() to claude_reader;
