# 118. A Worker request needs a session that is still live

Date: 2026-10-15 · By: Carl Sauder · Status: accepted

Reason: the Worker verifies access tokens itself (`getClaims`), and a
verified token stays valid until it expires, an hour, after its session is
gone. A security audit found that a lost phone signed out from another
(`sign-in-code`'s "sign out my other phones"), or a deleted account, kept
reading recordings and reports, and could mint API tokens, until then. Now
`profileOf` also asks `session_is_live` for the token's `session_id`
(migration 20261016100000), remembering the answer for 30 seconds per
isolate so a run of blob requests asks once (`apps/web/worker/liveSessions.ts`).
When the question cannot be answered, the verified token stands: a
database hiccup must not sign every phone out.
Reverse if: the extra query shows in the Worker's latency; then ask only on
the routes that mint credentials or change data.
