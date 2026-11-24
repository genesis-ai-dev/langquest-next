-- Slow statements and what each connection waits on, for both read logins
-- (docs/production-reads.md, "The two logins";
-- docs/decisions/2026-11-24-agents-read-everything-but-personal-data.md).
--
-- 20261124223000 tried to grant pg_read_all_stats, but on the hosted
-- project postgres is a member of it without the right to grant it, so the
-- grant was skipped (checked 2026-11-24). Without it pg_stat_statements
-- shows a login only its own statements. These two functions run as
-- postgres, which may read them all, and hand back no IP address, with
-- emails, phone numbers and IP addresses in a statement's text masked.

create or replace function masked.statements()
returns table (rolname name, calls bigint, total_exec_time double precision, mean_exec_time double precision,
               max_exec_time double precision, rows bigint, shared_blks_hit bigint, shared_blks_read bigint, query text)
language sql stable security definer set search_path = '' as $$
  select r.rolname, s.calls, s.total_exec_time, s.mean_exec_time, s.max_exec_time, s.rows,
         s.shared_blks_hit, s.shared_blks_read, masked.personal(s.query)
    from extensions.pg_stat_statements s
    left join pg_catalog.pg_roles r on r.oid = s.userid
$$;

create or replace function masked.activity()
returns table (pid integer, usename name, application_name text, backend_type text, state text,
               backend_start timestamptz, xact_start timestamptz, query_start timestamptz, state_change timestamptz,
               wait_event_type text, wait_event text, blocked_by integer[], query text)
language sql stable security definer set search_path = '' as $$
  select a.pid, a.usename, a.application_name, a.backend_type, a.state,
         a.backend_start, a.xact_start, a.query_start, a.state_change,
         a.wait_event_type, a.wait_event, pg_catalog.pg_blocking_pids(a.pid), masked.personal(a.query)
    from pg_catalog.pg_stat_activity a
$$;

revoke all on function masked.statements(), masked.activity() from public;
grant execute on function masked.statements(), masked.activity() to agent_reader, claude_reader;

create or replace view masked.slow_statements as select * from masked.statements();
create or replace view masked.connections as select * from masked.activity();
grant select on masked.slow_statements, masked.connections to agent_reader, claude_reader;
