# 170. Reading a language's work and seeing its report are two rules on purpose, and core holds both against SQL

Date: 2026-10-26 · By: Carl Sauder · Status: accepted

Reason: a separation-of-concerns audit found read access written twice with
different answers and nothing comparing them. SQL `_can_read_stream_at`
(and `blob_access` through it) lets anyone with any privilege on a language
read its stream and files; core's `mayViewLanguage`, which the Worker uses
for reports and agent views, needs `view_status`. Every seeded role has
`view_status`, so they disagree only for a custom role without it, but the
file-write rule in `blob_access` existed only in SQL, and
`scripts/record-parity-sql.ts` checked writes of events alone. Carl chose
(2026-10-26) to keep both rules and pin them:

- Reading the work (the stream, its files) needs any privilege on the
  language, or for the organization stream any membership; seeing its
  report needs `view_status`. A custom role without `view_status` may
  record and review a language yet not see its report.
- Core says both: `mayReadLanguage` and `mayWriteFiles` (`org.ts`) mirror
  `_can_read_stream_at` (a person who is not a Global Viewer) and the write
  branch of `blob_access`, beside `mayViewLanguage`, and say why they
  differ.
- `scripts/record-parity-sql.ts` (the `server` guardrail) generates roles,
  memberships and languages and compares the SQL answers with core's, as it
  already did for `role_may_emit_event`.
- No call site changed: the Worker still asks SQL for files and core's
  `mayViewLanguage` for reports.

Reverse if: a role should read a language without being able to see its
progress for a reason the team does not accept, when the report rule
becomes the read rule; or the two rules are found to confuse people (work
visible, report refused), when the screens say why.
