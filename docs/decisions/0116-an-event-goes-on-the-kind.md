# 116. An event goes on the kind of stream it belongs to

Date: 2026-10-15 · By: Carl Sauder · Status: accepted

Reason: `append_events` asked whether the author held an event's privilege,
not whether the event belonged on that stream. A security audit found that
an organization's events (`RoleDefined`, `MemberAdded`, `InviteIssued`)
could be written into a language's stream by someone holding the privilege
there, past the grant checks that run only on the organization stream
(`_grant_refusal`), and a language's events into the organization stream.
The folds skip foreign types, so they did nothing yet, but a later fold or
report that read them would have believed them. Now, for signed-in callers,
the organization's events (core `ORG_EVENT_TYPES`, SQL `_org_event_types`)
go only on `_org`, every other event only on a language's stream, and
`v1.Redacted` on either (migration 20261016050000; the parity script holds
the two lists together; server smoke 5f). The service role's imports keep
their own rules.
Reverse if: an event needs to live on both kinds of stream; then list it
with `v1.Redacted`.
