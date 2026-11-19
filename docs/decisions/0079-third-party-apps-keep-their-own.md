# 79. Third-party apps keep their own values with a language, as external values LangQuest never acts on

Date: 2026-10-09 · By: Carl Sauder · Status: accepted

Reason: partly supersedes 72, which said everything written from outside
is one of two events. Partners' apps want to keep data of their own with a
language's work, clearly marked as coming from outside LangQuest; Every
Language's listening app is the example (play counts, playlists). Carl
chose a key-value store per language, named so an API user can tell the
values are external to LangQuest (`docs/agent-api.md`). Chosen:
- `PUT`, `GET` and `DELETE /api/v1/languages/{languageId}/external-values/{key}`
  and a list (`keyPrefix`, `changedSince`, `after`) on the access-token API
  (70), and the MCP tools `set_external_value` and `get_external_values`.
  The body is `{ data }`, a JSON object of at most 4 KB, checked by the
  Worker, which is the only writer.
- Each write is `v1.ExternalValueSet { key, data }` in the language stream:
  a register per key, the later clock then the higher id, and `data: null`
  a deleted key. The Worker stamps a write after the value it replaces, so
  two in one millisecond keep their order. Nothing in LangQuest reads it: no
  status, step, report or screen. `REDUCER_VERSION` is 14.
- Only the Worker appends it. `append_events` refuses it from people and
  takes it from the service role only for a device `api-<token id>` that
  is a live token of the author's, with the new `external_values` scope,
  reaching the language (`_external_values_token`, migration
  `20261009220000_external_values.sql`, `server/externalValuesSmoke.sql`).
  The author must translate, review or fill reference material there.
  Reading needs `read` or `external_values`, and each value says which
  token, app and person wrote it.
- One shared store per language: apps keep apart by starting keys with
  their own reverse-domain name. Every token belongs to a member the
  organization trusts, nothing acts on the values, and every member's
  phone downloads the stream anyway, so namespaces per app would hide
  nothing from the people who can see it.
- Nothing points into LangQuest: no passage field. An app that ties a value
  to a passage puts the unit id in the key. Showing values on a passage
  later would need a field added to a shipped event (as 72's `atMs` was)
  or a `v2`. No files yet either.
- Keys are segments of letters, digits and `. _ ~ : @ + -` joined by `/`,
  at most 256 characters, none empty, `.` or `..`, so a key reads back
  unchanged as a URL path (core `externalKeyError`, SQL `validate_payload`).
Rejected: an opaque subject or a namespace per app (key prefixes do the
same with nothing to check); an idempotency key from the caller (the
newest write wins, so a retry reads the same); a sibling stream phones do
not pull (more to build before anyone has seen the cost); `/values` as the
path (it reads as LangQuest's own settings for the language).
Reverse if: external values grow past a set share of a language's events or
slow its downloads (then a sibling stream phones do not pull), partners
that do not trust each other share a language (then a namespace per app),
or values start to drive anything in LangQuest.
