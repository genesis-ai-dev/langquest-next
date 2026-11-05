-- Two reads for the ops dashboard. First, the count of feedback not yet done (Support). It read
-- diag.feedback directly, which diag_reader may not (it may call diag's
-- functions, never read its tables), so Postgres refused it on every load
-- and the page showed "–". A count and the oldest open item's time, never
-- the feedback itself.

create or replace function diag.ops_feedback_open() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('open', count(*), 'oldestAt', min(f.created_at))
  from diag.feedback f where f.done_at is null
$$;
revoke all on function diag.ops_feedback_open() from public;
grant execute on function diag.ops_feedback_open() to diag_reader;

-- Since when the database's own counters run, so the page can say it: the
-- RPC timings (pg_stat_statements) and the commits, cache hits and
-- deadlocks (pg_stat_database) each count from their last reset.
create or replace function diag.ops_counts_since() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'statements', (select i.stats_reset from extensions.pg_stat_statements_info i),
    'database', (select d.stats_reset from pg_catalog.pg_stat_database d where d.datname = current_database())
  )
$$;
revoke all on function diag.ops_counts_since() from public;
grant execute on function diag.ops_counts_since() to diag_reader;
