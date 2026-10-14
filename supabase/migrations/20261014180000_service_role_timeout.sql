-- Large languages' snapshots are written by a scheduled job with the
-- service role (decisions.md 103). put_snapshot serializes the state and
-- cuts its pieces in one statement; for the largest languages (Santhali's
-- state is 61 MB) that takes longer than the 8 s every API request inherits
-- from the authenticator role, and the write was cancelled. The service role
-- is used only by the server's own jobs, so its requests get two minutes
-- (Caleb Koster, 2026-10-14); people's requests keep anon 3 s and
-- authenticated 8 s.
alter role service_role set statement_timeout = '2min';
notify pgrst, 'reload config';
