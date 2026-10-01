-- The projection job (server/schedule-projections.sql) runs on pg_cron and
-- calls the worker over pg_net. Production had both enabled by hand; a
-- persistent preview branch is built from migrations alone, so they are
-- declared here. Same schemas the dashboard uses, so production is a no-op.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
