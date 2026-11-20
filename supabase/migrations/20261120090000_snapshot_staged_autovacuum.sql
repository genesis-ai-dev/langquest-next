-- public.snapshot_units_staged is filled in batches and emptied whole at the end
-- of each cut, so its rows are all dead until autovacuum comes. It kept the
-- default (a fifth of the table dead), unlike its neighbours in
-- 20261104120000_snapshot_purge.sql, and the ops dashboard showed it 100% dead.
alter table public.snapshot_units_staged set (
  autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
  toast.autovacuum_vacuum_scale_factor = 0.02, toast.autovacuum_vacuum_threshold = 1000);
