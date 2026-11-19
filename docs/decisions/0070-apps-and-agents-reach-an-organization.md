# 70. Apps and agents reach an organization with scoped access tokens, through the app's Worker

Date: 2026-10-07 · By: Ryder Wishart · Status: partly superseded by 72

Reason: partners want their own apps on LangQuest's data. Every
Language's listening app plays approved chapters, lets listeners say
whether a passage sounds right, and marks what is ready to publish; agents
(Claude, ChatGPT and others over MCP) want to read and comment the same way
(LAN-41; the partner calls of 2026-08-24, 09-22 and 10-06). Chosen:
- A token belongs to one person in one organization and is never more than
  that person: every request reads their privileges from the folded log
  today, then narrows by the token's scopes (`read:published`, `read`,
  `feedback`, `publish`) and, if set, a list of languages. Leaving the
  organization or losing a role takes the token's reach with it; nothing
  about access is stored but the narrowing. Only the token's SHA-256 is
  kept (`api_tokens`, migration `20261008000000_api_tokens.sql`), as for
  invites; it never expires unless asked to, and is revoked on the page.
- Tokens are made on `/connect`, a page the Worker serves itself (the Expo
  app's screens follow the partner demo, which has none for this), or asked
  for by an app with the OAuth device flow (RFC 8628): the app gets a code,
  a person opens `/connect?code=…`, sees what the app calls itself marked
  unverified, may narrow but never widen what it asked for, and approves;
  the app's poll then succeeds and its device code is its token, so no
  plaintext secret is ever stored. This is the "poll to create a token" the
  partners asked for, and spares the Aquila lesson of approving every action
  by link.
- The API is `/api/v1/*` on the dashboard Worker, answered by the
  organization's Durable Object from the same folds as the reports
  (decision 44, `apps/web/worker/agent/`), with the same rules as MCP tools
  at `/api/v1/mcp` (stateless streamable HTTP, a bearer header, so any MCP
  client connects with one URL). A `read:published` token sees only a
  passage's approved version, core `approvedVersion`: the newest version
  every step approved by reviews of that very version. `done` is looser (it
  reads each kind's latest review of any version, and an answered "needs
  changes" counts), so a re-recorded passage stays done while its new audio
  is unheard; a listening app keeps playing the version that was approved.
  Audio comes as the ten-minute read links of decision 69. Any origin may
  call it, since the token is a header and never a cookie.
- Writes are ordinary events, appended with `append_events` as the token's
  person from a device of the token's own (`api-<token id>`), so the
  database applies their phone's privilege checks: listener feedback is
  `v1.ReviewRecorded` of kind `listener` given by link, with the listener's
  name in `givenBy` and the app's listener id only as a hash in the review
  id (one answer per listener, version and outcome, against griefing), plus
  600 writes an hour per token (voice-note uploads included), and the
  device endpoints, open to anyone, are rate-limited per address. Ready for
  publication is a review of kind `publication` on the approved version,
  read by core `publicationOf`, so it never outlives that version or its
  approval. Both
  kinds are in no flow: they never complete or block a step. No new event
  type was needed.
Rejected: OAuth with redirects and client registration (more moving parts
than a partner's app or a pasted MCP config needs today); tokens not tied
to a person (a service account would need its own place in the privilege
model, and every write needs an author); a separate API Worker or Supabase
function (it would refold what the Durable Object already holds).
Reverse if: partners need many users of one app to act as themselves (then
OAuth authorization codes with per-user consent), the per-object rate limit
or folds per request show up in Worker CPU, or publication needs to gate
something (then it joins the flow as a checkpoint kind instead).

Amended (2026-10-12, Carl Sauder): the passage list now returns
`{ passages, nextAfter }` a page at a time, picks passages by `unitIds`,
and adds any part of one passage with `include` (85).

Amended (2026-10-13, Carl Sauder): an answered "needs changes" no longer
counts toward `done`: the check stays open until its reviewer passes the
new version (96).

Amended (2026-10-13, Ryder Wishart): a token can revoke itself
(`DELETE /api/v1/token`) and have webhooks, and `/me` names its
organization (101).
