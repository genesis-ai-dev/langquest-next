-- The ops dashboard's longest query and oldest transaction say whose they
-- are: the role, the client (application_name) and the kind of backend,
-- never the query's text, which can hold what someone sent. Background work
-- that always runs is left out: every backend that is not a client's
-- (autovacuum, WAL senders, pg_cron's launcher, pg_net's worker) and
-- Realtime's sessions. Counting them raised "a query has been running for
-- 9 minutes" for work that was only Supabase's own. The rest of
-- diag.ops_database is as in 20261023100000_ops_dashboard.sql.

create or replace function diag.ops_database() returns jsonb
language sql stable security definer set search_path = '' as $$
  -- Queries and transactions someone or something asked for: client backends
  -- only (not autovacuum, WAL senders, pg_cron's launcher or pg_net's worker),
  -- and not Realtime's own sessions, which run as long as it does.
  with work as (
    select a.query_start, a.xact_start, a.state, a.usename, a.application_name, a.backend_type, a.wait_event_type
    from pg_catalog.pg_stat_activity a
    where a.datname = current_database() and a.pid <> pg_backend_pid()
      and a.backend_type = 'client backend'
      and coalesce(a.application_name, '') not ilike '%realtime%'
  )
  select jsonb_build_object(
    'bytes', pg_database_size(current_database()),
    'connections', (select count(*) from pg_catalog.pg_stat_activity a where a.datname = current_database()),
    -- Kept for a page from before this migration; the objects below say whose.
    'longestQueryS', (select round(extract(epoch from now() - w.query_start)) from work w where w.state = 'active' order by w.query_start limit 1),
    'oldestXactS', (select round(extract(epoch from now() - w.xact_start)) from work w where w.xact_start is not null order by w.xact_start limit 1),
    'longestQuery', (select jsonb_build_object('seconds', round(extract(epoch from now() - w.query_start)),
        'role', w.usename, 'client', left(nullif(w.application_name, ''), 40), 'kind', w.backend_type, 'waitingOn', w.wait_event_type)
      from work w where w.state = 'active' order by w.query_start limit 1),
    'oldestXact', (select jsonb_build_object('seconds', round(extract(epoch from now() - w.xact_start)),
        'role', w.usename, 'client', left(nullif(w.application_name, ''), 40), 'kind', w.backend_type, 'state', w.state)
      from work w where w.xact_start is not null order by w.xact_start limit 1),
    -- What was left out and running now, by kind: Realtime, or the backend type.
    'background', coalesce((select jsonb_agg(jsonb_build_object('kind', b.kind, 'n', b.n, 'seconds', b.s) order by b.s desc nulls last, b.kind)
      from (select case when a.backend_type = 'client backend' then 'Realtime' else a.backend_type end as kind, count(*) as n,
                   round(max(extract(epoch from now() - coalesce(a.xact_start, a.query_start, a.backend_start)))) as s
            from pg_catalog.pg_stat_activity a
            where a.datname = current_database() and a.state = 'active' and a.pid <> pg_backend_pid()
              and (a.backend_type <> 'client backend' or coalesce(a.application_name, '') ilike '%realtime%')
            group by 1) b), '[]'::jsonb),
    'tables', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'bytes', x.bytes, 'rows', x.rows, 'deadRatio', x.dead)
        order by x.bytes desc, x.name)
      from (select t.schemaname || '.' || t.relname as name, pg_total_relation_size(t.relid) as bytes,
                   greatest(c.reltuples, 0)::bigint as rows,
                   case when t.n_live_tup + t.n_dead_tup > 0 then round(t.n_dead_tup::numeric / (t.n_live_tup + t.n_dead_tup), 4) end as dead
            from pg_catalog.pg_stat_user_tables t join pg_catalog.pg_class c on c.oid = t.relid
            order by pg_total_relation_size(t.relid) desc, 1 limit 10) x), '[]'::jsonb),
    'indexes', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'table', x.tbl, 'bytes', x.bytes)
        order by x.bytes desc, x.name)
      from (select i.schemaname || '.' || i.indexrelname as name, i.schemaname || '.' || i.relname as tbl,
                   pg_relation_size(i.indexrelid) as bytes
            from pg_catalog.pg_stat_user_indexes i order by pg_relation_size(i.indexrelid) desc, 1 limit 10) x), '[]'::jsonb)
  )
$$;
