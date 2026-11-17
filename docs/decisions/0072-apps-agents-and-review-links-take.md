# 72. Apps, agents and review links take part through reviews and releases; outside reviews never clear a checkpoint

Date: 2026-10-08 · By: Ryder Wishart · Status: partly superseded by 79

Reason: supersedes 70's publishing and scopes. Partners want their own apps on LangQuest's data. Every
Language's listening app plays approved chapters and wants listeners'
reactions back; agents (Claude, ChatGPT, over MCP) want to read and
review; and a team wants to send a passage on WhatsApp to someone with no
account and get a review back (LAN-41; the partner calls of 2026-08-24,
09-22 and 10-06). Chosen:
- Tokens (`lqp_…`) belong to one person in one organization and are never
  more than that person: each request reads their privileges from the
  folded log today, then narrows by scope (`read:published`, `read`,
  `review`, `release`) and, if set, a list of languages. Only the hash is
  kept (`api_tokens`). They are made on `/connect`, a page the Worker
  serves, or asked for by an app with the OAuth device flow (RFC 8628): a
  person approves on `/connect?code=…`, may narrow but never widen, and the
  app's device code becomes its token, so no plaintext secret is stored.
- `/api/v1/*` is answered by the organization's Durable Object from the
  folds the reports use (decision 44), and the same operations are MCP
  tools at `/api/v1/mcp`. A `read:published` token sees only a passage's
  approved version, core `approvedVersion`: the newest version every step
  approved by reviews of that very version. `done` is looser (each kind's
  latest review of any version, and an answered "needs changes" counts), so
  a re-recorded passage stays done while its new audio is unheard.
- Everything written from outside is one of two events, appended with
  `append_events` as a person so the database checks their privileges:
  - `v1.ReviewRecorded` given by link. Through a token it is listener
    feedback (kind `listener`, in no flow, so it never clears or blocks a
    step) or a review of a kind in the language's flow, so a partner's
    sign-off is a flow step rather than a parallel approval.
  - `v1.VersionReleased {takeId, channel, live}`, new: where a version is
    live, a fact rather than a verdict (core `releasesOf`). Going live needs
    the approved version; anything may be taken down. It needs
    `assign_work`. This replaces 70's "ready for publication" mark, which
    was an approval kept outside the flow, and its `feedback` and
    `publish` scopes (migration `20261008140000` renames issued ones).
- Review links: whoever may send work to reviewers (`send_to_reviewers` or
  `assign_work`, configurable per role) and may record a review given by
  link shares `/r/<code>`, one version and one kind, open to many people
  until it expires (14 days by default) or is revoked (`review_links`, hash
  only). The page plays the version and takes any name (kept in the
  browser), looks good or needs changes, an optional comment, and voice
  clips said at a moment of the recording, up to ten, each kept as a
  review artifact with its own format (m4a, or WAV from browsers that
  cannot record MP4) and its moment (`atMs`). The page is one column with
  nothing else on it, and links the privacy policy, which now says what a
  review link and a connected app keep. The sharer chooses per link whether answers
  count toward the step or are listener feedback; whether a step may be
  reviewed by a counting link is the language's setting, new event
  `v1.FlowStepLinksSet` (default: any step but a checkpoint). A review given
  by link is recorded as the sharer, like a check logged from outside the
  app: `review` or `translate` may record it, and, like a logged check, it
  completes ordinary steps but never clears a checkpoint (passage.ts
  `clears`, which decision 29 had let link reviews clear; none existed yet).
  A browser's latest answer stands; a resend records once; a link takes 500
  answers, 10 per browser, and closes when its sharer can no longer record.
- Abuse: 600 writes an hour per token or link, per-address limits on the
  device endpoints and links, voice notes must be new uploads, MCP batches
  hold at most 20.
Moments on clips: `Card` gains an optional `atMs` (core and SQL
`_is_cards`). That adds a field to a shipped event's payload
(`v1.ReviewRecorded.artifacts`, and `v1.RecordingAdded.cards`, which share
the type), which AGENTS.md says never to do. It is additive and optional:
older validators and reducers accept and keep it, and older apps simply
play the clip without its moment. A versioned `v2.ReviewRecorded` would
have meant a second review shape in every reader for one optional number;
notes per clip (`v1.NoteAdded`) would have lost the reviewer's name and
split one answer across events.
Rejected: OAuth with redirects (more than a partner's backend or a pasted
MCP config needs today); service accounts (every write needs an author in
the privilege model); a guest `v1.RequestMade` per link (a guest needs a
WhatsApp or SMS contact, and a group link has none); a separate API Worker
(it would refold what the Durable Object already holds).
Reverse if: partners need each of their users to act as themselves (then
OAuth authorization codes), shared links attract abuse that names and
browser ids cannot contain (then one-person links with a contact), or Worker
CPU from folds per request shows up in cost.

Amended (2026-10-09, Carl Sauder): a link closes for listening, not only
for answering, once its sharer can no longer record; whoever assigns work in
the language may revoke anyone's link; a link made with a token closes with
it, and a person may have 200 open in an organization. Voice notes take
their own budget, 100 an hour per token or link. A review given by link
counts toward a step only while the step takes links, read in the fold, so
turning links off also stops links and tokens already out (75).

Amended (2026-10-13, Carl Sauder): an answered "needs changes" no longer
counts toward `done` (96).
