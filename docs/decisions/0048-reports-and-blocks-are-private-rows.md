# 48. Reports and blocks are private rows, not events, and acting on a report is a redaction

Date: 2026-09-30 · By: Caleb Koster · Status: accepted

Reason: Google Play's user-generated content policy asks that people can
report objectionable content and users from inside the app, that someone
acts on reports, that abusive users can be blocked, and that terms forbid
such content before anyone posts. Reports and blocks stay out of the log:
every member's phone pulls a partition, so a report there would tell the
reported person who reported them, and a block is one person's private
choice. They are rows (`content_reports`, `user_blocks`; migration
`20260930220000_report_and_block.sql`) sent from the account outbox like a
profile name, so they work offline (`report_content`, `set_blocked`). Reports
go to the organization and to LangQuest staff (Caleb, 2026-09-30). An
organization's moderators, whoever holds what `v1.Redacted` needs
(`manage_structure`) for that language, or `invite_members` organization-wide
for a report about a person, see its open reports in the Inbox without who
sent them (`org_content_reports`, and a notification from the projection
worker), never one about themselves. Staff see every report with the
reporter (`npm run moderation`). Acting uses what the log already has:
removing something appends `v1.Redacted` as the moderator for every event
that holds it (`remove_content`; a version is its take, submission,
what-changed note and answer), so every phone's fold drops it and its
passage's status is derived again; removing a person is
`v1.OrgMemberRemoved` from Members; staff can also suspend a sign-in
(`suspend_account`). Blocking hides a person's words, audio and photos on the
blocker's phones behind Show (`Authored` in `reportSheet.tsx`) and keeps
their updates out of the Inbox, but their versions and reviews still count
toward status, so a block never stalls a team (Caleb, 2026-09-30). The
report queue's `resolved_at` and `resolution` columns are an operational
queue on the server, not app state, so the no-status-column rule does not
reach them. No new event type, so `REDUCER_VERSION` is unchanged. The flag,
its sheet and Blocked people are app-only, not in the demo, and not flow
nodes. The Terms of Use now list what is not allowed and promise action on
reports within 24 hours (`TERMS_VERSION` 2026-09-30).
Reverse if: blocking has to stop someone reaching a person (asking them for
work, reviewing their recordings) rather than hide what they add, which
puts blocks on the server's write path; moderators need to know who
reported, which needs the reporter's consent; or report volume outgrows a
script, which calls for a staff screen.

Amended (2026-10-01, Caleb Koster): emailing staff when something is
reported is deferred, not dropped. Until it exists, staff keep the terms'
24-hour promise by checking `npm run moderation -- --hosted` daily, and an
organization's moderators get a server Inbox row from the projection worker,
which now runs every five minutes in production (decision 42). When it is
built, the worker is the sender's natural home: it already reads open
reports each pass and runs where the email relay's secret lives. It needs a
staff address and a sender address chosen first.
