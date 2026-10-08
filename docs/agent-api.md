# The LangQuest API, for apps and agents

Other apps and AI agents can read an organization's translations and send feedback back. A listening app can play approved chapters, collect listeners' reactions, and mark chapters ready for publication. An agent in Claude or ChatGPT can do the same through MCP. Why it is built this way: `docs/decisions.md` 70.

Base address: `https://next.langquest.org/api/v1` (preview: `next-preview.langquest.org`). `GET /api/v1` lists every endpoint.

## Tokens

A token belongs to one person in one organization. **It can never do more than that person can do today.** Every request checks the person's current role in the log, then narrows it by the token's scopes and languages. If the person leaves the organization or loses a role, the token loses that access too.

| Scope | Gives |
| --- | --- |
| `read:published` | Approved passages only, with their audio. A token with only this scope never sees anything unapproved. |
| `read` | Every passage, including drafts' status, versions in review, the team's reviews and the flow's steps. |
| `feedback` | Send listener feedback (looks good or needs changes, a comment, a voice note). The person needs a role that reviews. |
| `publish` | Mark an approved passage ready for publication, or take that back. The person needs a role that reviews. |

A token can be limited to some languages. Left unlimited, it covers every language the person can see, including ones added later. It never expires unless you choose an expiry. Revoke it on `/connect` at any time.

Send the token as `Authorization: Bearer lqp_…`. Only its hash is stored, so a lost token cannot be recovered; make a new one.

### Making one yourself

Open `https://next.langquest.org/connect`. If the LangQuest web app is open in the same browser, the page uses that session; otherwise sign in. Under "Make a token", choose the scopes and languages. You see the token once, with a `curl` line and an MCP config to copy.

### Letting an app ask for one (device flow)

This is the OAuth 2.0 device authorization flow (RFC 8628). Off-the-shelf device-flow clients work with it.

1. The app asks for a code:

   ```bash
   curl -X POST https://next.langquest.org/api/v1/device/code \
     -H 'content-type: application/json' \
     -d '{"clientName":"Every Language Listener","scopes":["read:published","feedback","publish"]}'
   ```

   It gets back `device_code` (secret; keep it), `user_code` (show it), `verification_uri_complete`, `interval` (5 seconds) and `expires_in` (15 minutes).

2. The app shows the person `verification_uri_complete` (a link or QR code) and the `user_code`. The person opens the page and signs in. They see what the app calls itself, marked unverified, and what it asks for. They may untick scopes, pick the organization and languages, set an expiry, then approve or deny. They can narrow what the app asked for, never widen it.

3. Meanwhile the app polls every `interval` seconds:

   ```bash
   curl -X POST https://next.langquest.org/api/v1/device/token \
     -H 'content-type: application/json' -d '{"device_code":"lqp_…"}'
   ```

   Until the person decides, the answer is `400 {"error":"authorization_pending"}` (`slow_down` if the app polls too fast). Then it is `access_denied` or `expired_token`, or `200 {"access_token":"lqp_…","scope":"…","org_id":"…","language_ids":…}`. The access token is the device code itself, so nothing secret is ever stored in plain text.

## Reading

```bash
T='Authorization: Bearer lqp_…'
curl -H "$T" https://next.langquest.org/api/v1/me          # the token, and the languages it reaches
curl -H "$T" https://next.langquest.org/api/v1/languages
curl -H "$T" 'https://next.langquest.org/api/v1/languages/LANG/passages?status=approved'
curl -H "$T" 'https://next.langquest.org/api/v1/languages/LANG/passages/UNIT'   # URL-encode the unit id
```

- **Languages** say what the token can do there: `can: { read: "all" | "published" | null, feedback, publish }`.
- **Passages** come in display order. Each has `unitId`, `label`, `path` (the book and chapter that hold it), `status`, the latest `version` (`n`, `takeId`, `submittedAt`, `durationMs`), `publication` and `listenerFeedback` counts on the latest version.
  - `status` is one of `not_started`, `drafting`, `in_review`, `feedback` (someone asked for changes nobody answered) or `approved`.
  - Filters: `status=`, `ready=true|false` (ready for publication) and `changedSince=<ISO time>`.
- **Following changes.** Keep the newest `updatedAt` you have seen and pass it as `changedSince`. You get back only passages with something newer: a new version, a review, an approval or a publication decision. Poll every few minutes. The server catches up with the log at least once a minute.
- **One passage** adds `audio`: the latest version's cards in playing order. Each card has a `url` that plays without a token for ten minutes, with Range support, so a media player can stream it. Fetch the passage again for fresh links.
  - It also has `reviews`. With `read`, that is every review. With `read:published` only, it is just listener and publication reviews.
  - With `read`, it also has `steps` and `versions`.

## Writing

Writes are recorded in the organization's log as the token's person, from a device of the token's own. The team sees them on the passage like any other review. A token makes at most 600 writes an hour.

### Listener feedback

```bash
curl -X POST -H "$T" -H 'content-type: application/json' \
  https://next.langquest.org/api/v1/languages/LANG/passages/UNIT/feedback \
  -d '{"outcome":"needs_changes","listenerId":"device-8d1f","listenerName":"Mary K.","comment":"Verse 3 is hard to follow"}'
```

- `outcome` is `looks_good` or `needs_changes`. `needs_changes` asks the translator to respond (the passage shows `feedback` until someone does).
- `listenerId` is required. It is your app's id for the person or device. LangQuest stores only a hash of it. It is used to record one answer per listener, version and outcome, so a double tap or a retry records nothing new, and one listener cannot flood a passage. Send `feedbackId` to let one listener leave several comments.
- `listenerName` is shown to the team. Without it, they see "Listener" and a short code.
- `takeId` names the version heard. It defaults to the latest. With only `read:published`, it must be the latest approved one.
- For a voice note, first `PUT /api/v1/languages/LANG/voice-notes` with the audio as the body. It must be AAC in an MP4 container (`.m4a`), at most 10 MB. Then send the `voiceNoteHash` it returns with the feedback.

### Ready for publication

```bash
curl -X POST -H "$T" -H 'content-type: application/json' \
  https://next.langquest.org/api/v1/languages/LANG/passages/UNIT/publication -d '{"ready":true}'
# take it back; the team sees the note as feedback
curl ... -d '{"ready":false,"note":"A name in verse 2 is wrong"}'
```

- Only an approved passage's latest version can be marked.
- Readiness belongs to that version. When the team records a new version, the passage is no longer ready until someone marks it again. A passage that stops being approved is never ready.
- List what is ready with `?ready=true`.

## MCP (Claude, ChatGPT and other agents)

The same API is offered as MCP tools at `https://next.langquest.org/api/v1/mcp`. It uses streamable HTTP with the token as a bearer header.

```json
{ "mcpServers": { "langquest": { "type": "http", "url": "https://next.langquest.org/api/v1/mcp",
  "headers": { "Authorization": "Bearer lqp_…" } } } }
```

In Claude Code: `claude mcp add --transport http langquest https://next.langquest.org/api/v1/mcp --header "Authorization: Bearer lqp_…"`.

The tools are `whoami`, `list_languages`, `list_passages`, `get_passage`, `send_feedback` and `set_publication_ready`. An agent sees only the tools its scopes allow.

## Errors

Errors are JSON: `{ "error": "what happened, in words", "code": "short_code" }`.

- `401`: a missing, unknown, revoked or expired token.
- `403`: a scope the token lacks, or a person whose role cannot do it.
- `404`: something that does not exist, or that the token cannot see.
- `409`: not approved, or not the latest version.
- `429`: the hourly write limit.

The device endpoints use OAuth's error codes.

## Where it lives

| Part | Code |
| --- | --- |
| Routes, device flow, connect-page API | `apps/web/worker/agent/http.ts` |
| What a token sees and may write | `apps/web/worker/agent/view.ts` |
| Per-organization reads and writes, rate limit | `apps/web/worker/agent/org.ts`, inside the `OrgSnapshot` Durable Object |
| MCP | `apps/web/worker/agent/mcp.ts` |
| `/connect` | `apps/web/worker/agent/connectPage.ts` |
| Tables | `supabase/migrations/20261008000000_api_tokens.sql` (service role only) |
| Ready for publication | core `publicationOf`, kinds `listener` and `publication` in `record.ts` |
| Tests | `apps/web/test/agentApi.test.ts`, `packages/core/test/publication.test.ts` |
