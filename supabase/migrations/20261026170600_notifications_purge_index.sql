-- The daily Inbox purge (20261016120000_notifications_indexes_and_purge.sql:
-- inactive rows changed over 30 days ago, with no push receipt waiting)
-- found its rows by scanning the table. Inactive rows are the minority and
-- the only ones it wants, so a partial index serves it (its receipt check
-- already has push_receipts_notification). performance-audit-2026-10-26.md,
-- push delivery and notifications.
create index if not exists notifications_purge on public.notifications (changed_at) where not active;
