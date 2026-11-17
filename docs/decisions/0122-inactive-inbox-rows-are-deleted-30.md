# 122. Inactive Inbox rows are deleted 30 days after they went inactive

Date: 2026-10-15 · By: Carl Sauder · Status: accepted

Reason: `reconcile_notifications` (68) marks a row inactive and never
deleted it, so the table only grew, the pass scanned it per language, and a
phone's Inbox read walked the dead rows (performance-audit-app.md V3). Rows
now record when they last changed (`changed_at`), and a daily pg_cron job
(`langquest-purge-notifications`) deletes rows inactive for 30 days, except
any a push receipt still names. A phone learns a row went away from the
inactive row itself, so one whose Inbox copy has not refreshed in 25 days
starts it over from cursor 0 (`INBOX_COPY_MAX_AGE_MS`,
`apps/mobile/src/notifications/notifications.ts`). Partial indexes serve
the reconcile's language and organization cases. Migration
`20261016120000_notifications_indexes_and_purge.sql`, smoke
`server/notificationsSmoke.sql`. Reverse if: someone needs Inbox history
older than a month (an audit of who was asked what); then archive rows
before deleting them.
