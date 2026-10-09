# The LangQuest API, review links, and MCP

Other apps, AI agents and people without an account can take part in a translation's review. Why it is built this way: `docs/decisions.md` 70 (tokens), 72 (reviews, releases, review links) and 79 (external values).

- **Partner apps and agents** use an access token. They read passages, record reviews, report where a version is published, and store values of their own with a language.
- **Anyone with a review link** (`/r/<code>`, shared on WhatsApp, say) can hear one version and answer, with any name.

Base address: `https://next.langquest.org/api/v1` (preview: `next-preview.langquest.org`). `GET /api/v1` lists every endpoint.

## What outside writes become

Everything written from outside is one of three events in the organization's log. The team sees the first two on the passage.

- **A review** (`v1.ReviewRecorded`, given by link). It is either:
  - **listener feedback** (kind `listener`): never clears or blocks a step, but "needs changes" asks the translator to respond; or
  - **a review of a step in the language's flow**: counts like any review. If a partner's approval is needed before release, make it a step in the flow (for example "Partner check") and the partner records it.

  A review from outside never clears a checkpoint. Checkpoints need a review given in the app.
- **A release** (`v1.VersionReleased`): "version 3 is live in the Every Language app", or taken down. It is a fact, not a verdict. Only the approved version can go live.
- **An external value** (`v1.ExternalValueSet`): a value an app stores with a language under a key it chooses, such as play counts or a playlist. LangQuest keeps it and never acts on it: it changes no status and completes or blocks no step.

**Approved** always means the passage's *approved version*: the newest version every step approved by reviews of that very version. The team's own status can say "approved" while a newer recording waits for review. The approved version is still the older one, and that is what a listening app plays and a partner releases.

## Tokens

A token belongs to one person in one organization. **It can never do more than that person can do today.** Every request checks the person's current role, then narrows it by the token's scopes and languages.

| Scope | Gives | The person needs |
| --- | --- | --- |
| `read:published` | Each passage's approved version only, with its audio. | to view the language |
| `read` | Every passage shared for review: versions, reviews, the flow's steps. | to view the language |
| `review` | Record reviews: listener feedback, or a flow step, with a comment or voice note. Share review links (with `read`). | to review or translate |
| `release` | Report where a version is published, or taken down. | to assign work (a coordinator) |
| `external_values` | Store, read and delete the app's own values with a language. | to translate, review or fill reference material |

A token can be limited to some languages. It never expires unless given an expiry, and is revoked on `/connect`. Only its hash is stored.

### Where to keep a token

A token inside a phone app or a web page can be read by anyone who wants it. They can watch the traffic or unpack the app.

- **`review`, `release` and `external_values` tokens belong on a server.** A listening app should send its listeners' reactions to its own backend. The backend checks its own users and limits, then calls this API with the token. It passes its user id as `reviewerId`.
- **A `read:published` token alone** exposes only approved audio, so it may ship inside an app if the organization's license allows. The audio links play without a token anyway.

### Making one

- **Yourself:** open `https://next.langquest.org/connect`. It uses the web app's session if this browser has one; otherwise sign in. Choose scopes and languages, and copy the token, which is shown once.
- **An app asks** (OAuth device flow, RFC 8628):
  1. `POST /api/v1/device/code` with `{"clientName": "…", "scopes": [...]}`. You get back `device_code` (secret), `user_code`, `verification_uri_complete`, `interval` (5 s) and `expires_in` (10 min).
  2. Show the person the link and code. On `/connect` they see the app's name, marked unverified, and what it asks for. Scopes that write start unticked. They choose languages and expiry, then approve or deny. They can narrow the request, never widen it.
  3. Poll `POST /api/v1/device/token` with `{"device_code": "…"}`. The answer is `authorization_pending` (or `slow_down`) until they decide. Then it is `access_denied`, `expired_token`, or `{"access_token": …}`. The access token is the device code itself.
  4. Each address may call the device endpoints 20 times a minute.

## Reading

```bash
T='Authorization: Bearer lqp_…'
curl -H "$T" https://next.langquest.org/api/v1/me
curl -H "$T" 'https://next.langquest.org/api/v1/languages/LANG/passages?status=approved&changedSince=2026-10-01T00:00:00Z'
curl -H "$T" https://next.langquest.org/api/v1/languages/LANG/passages/UNIT     # URL-encode the unit id
```

- **Languages** say what the token can do there: `can: { read: "all" | "published" | null, review, release, externalValues: { read, write } }`.
- **Passages** come in display order. Each has `unitId`, `label`, `path` (book, chapter), `status` (`not_started`, `drafting`, `in_review`, `feedback`, `approved`), `version`, `approvedVersion`, `releases` and `listenerFeedback`.
  - `version` is the latest version with `read`, and the approved one with `read:published` alone.
- **Following changes:** pass the newest `updatedAt` you have seen as `changedSince`. Versions, reviews and releases all count as changes. The server catches up with the log at least once a minute.
- **One passage** adds `audio`: `version`'s cards in playing order. Each has a `url` that plays without a token for ten minutes, with Range support. It also has `reviews`, plus `steps` and `versions` with `read`.

## Writing

Writes are recorded as the token's person, from a device of the token's own. A token makes at most 600 writes an hour.

### Reviews

```bash
curl -X POST -H "$T" -H 'content-type: application/json' \
  https://next.langquest.org/api/v1/languages/LANG/passages/UNIT/reviews \
  -d '{"outcome":"needs_changes","reviewerId":"user-8d1f","reviewerName":"Mary K.","comment":"Verse 3 is hard to follow"}'
```

- `outcome`: `looks_good` or `needs_changes`.
- `kindId`: `listener` (the default) or a kind in the language's flow (see `steps` on the passage).
- `reviewerId` is required: your id for whoever gave it. Only a hash is stored. It records one answer per reviewer, version, kind and outcome, so a retry records nothing new. Send `submissionId` to let one reviewer answer again.
- `reviewerName` is shown to the team.
- `takeId` defaults to `version`.
- Voice notes, up to 10, each optionally about a moment of the recording:
  1. `PUT …/languages/LANG/voice-notes` for each, with the audio as the body and a `Content-Length`. It must be AAC in MP4 (`.m4a`) or WAV, up to 20 MB, and counts as an upload. It returns `{ "voiceNote": { hash, format, durationMs } }`. Attach it within six hours: audio the server stored earlier, or audio already in the language, is refused.
  2. Send them as `"voiceNotes": [{ …voiceNote, "durationMs": 4200, "atMs": 41500 }]`. `atMs` is where in the version the note is about, in whole milliseconds from the start; leave it out for the whole version.
- Reading a passage, each review's `voiceNotes` come back in order, each with a playable `url`, `durationMs` and `atMs` if it has one.

### Releases

```bash
curl -X POST -H "$T" -H 'content-type: application/json' \
  https://next.langquest.org/api/v1/languages/LANG/passages/UNIT/releases \
  -d '{"channel":"Every Language app","live":true,"url":"https://…"}'
```

- `takeId` defaults to the approved version, and only that version can go live.
- `{"live": false}` takes any version down.
- A newer approved version does not inherit a release. The passage shows where each version is live.

## Review links

Someone who may send work to reviewers, and may review or translate, shares a link to one version of one passage, for one kind of review. Anyone holding it can listen on `/r/<code>` and answer.
- No account is needed.
- The page is one column with nothing else on it:
  - play, with a scrubber;
  - **Comment here**, which pauses and records a voice clip pinned to that moment (up to 10, shown as marks on the scrubber; tap one to jump there);
  - Good or Needs changes;
  - an optional written comment;
  - any name (the browser remembers it);
  - Send.
- Clips are MP4 where the browser can record it, otherwise WAV; phones play both.
- The page links the privacy policy, which says what a review link keeps.

**Making one**, from the app (signed in) or with a token that has `read` and `review`:

```bash
curl -X POST -H "$T" -H 'content-type: application/json' https://next.langquest.org/api/v1/review-links \
  -d '{"languageId":"LANG","unitId":"UNIT","kindId":"community","counts":true,"label":"Women'"'"'s fellowship"}'
# → { "url": "https://next.langquest.org/r/…", "id": "…", "expiresAt": "…", … }
```

- `counts`: whether answers count toward the step (`true`) or are listener feedback (`false`).
  - A counting link needs a step that allows links. Every step does, except checkpoints, unless the language changes it (`v1.FlowStepLinksSet`).
  - A link answer never clears a checkpoint anyway.
- `takeId` defaults to the latest version. `expiresInDays` defaults to 14 and can be at most 90.
- The app uses `POST /api/v1/session/review-links` with the same body plus `orgId`. It lists a passage's links with `GET …/session/review-links?orgId&languageId&unitId` and revokes one with `POST …/session/review-links/:id/revoke`. The sharer may revoke a link, and so may anyone who assigns work in its language.
- A link made with a token belongs to the token too: revoking the token closes it, and it lasts no longer than the token. A person may have 200 open links in an organization.

**Answers** are recorded as the person who shared the link, with the typed name as who gave it.
- A browser's latest answer stands, and a resend records once.
- A link takes 500 answers in all and 10 from one browser.
- A link closes when revoked, when it expires, or when its sharer can no longer record reviews. A closed link answers `410 closed` and says nothing else: not who it was for, nor the passage, language or kind.
- A link or token takes 100 voice notes an hour.
- A review given by link (through a link or a token) counts toward a step only while the step takes links (`v1.FlowStepLinksSet`). Where it does not, the review is kept and completes nothing. A counting link whose step stopped taking links records its answers as listener feedback.

### External values

An app's own values, stored with a language under keys the app chooses. LangQuest keeps them and never acts on them. Every token in the organization that can read the language can read them, so they are shared between the organization's apps.

```bash
K='org.everylanguage.listening/plays/MRK.1.1-8/2026-10-08'
curl -X PUT -H "$T" -H 'content-type: application/json' \
  https://next.langquest.org/api/v1/languages/LANG/external-values/$K -d '{"data":{"count":12}}'
curl -H "$T" https://next.langquest.org/api/v1/languages/LANG/external-values/$K
curl -H "$T" 'https://next.langquest.org/api/v1/languages/LANG/external-values?keyPrefix=org.everylanguage.listening/plays/'
curl -X DELETE -H "$T" https://next.langquest.org/api/v1/languages/LANG/external-values/$K
```

- **Writing needs the `external_values` scope; reading needs `read` or `external_values`.**
- **The newest write to a key wins.** A retry writes the same value again, which reads the same.
- **Keys** are segments of letters, digits and `. _ ~ : @ + -` joined by `/`, at most 256 characters. No segment may be empty, `.` or `..`. A key is the rest of the URL path, so it reads back as written.
- **Keep apps apart with the key.** LangQuest does not: any token that may write in a language may write any key. Start every key with your app's own reverse-domain name, such as `org.everylanguage.listening/…`.
- **`data`** is a JSON object of at most 4096 bytes. Store totals, such as one value per passage per day, not one per play: every phone that opens the language downloads them.
- **No personal identifiers in keys or data.** Hash a listener's id, or use your own internal id.
- **What comes back:** `{ key, data, writtenBy: { profileId, tokenId, app }, at }`. `app` is the writing token's app name.
- **Listing** returns `{ values, nextAfter }`, 500 at a time in key order. Pass `nextAfter` as `after` for the next page.
- **Following changes:** pass `changedSince`. Deleted keys then come back with `data: null`; without it, they are left out.
- Values are not shown on a passage, and nothing in a value points to one. To tie a value to a passage, put its unit id in the key.

## MCP (Claude, ChatGPT and other agents)

```json
{ "mcpServers": { "langquest": { "type": "http", "url": "https://next.langquest.org/api/v1/mcp",
  "headers": { "Authorization": "Bearer lqp_…" } } } }
```

In Claude Code: `claude mcp add --transport http langquest https://next.langquest.org/api/v1/mcp --header "Authorization: Bearer lqp_…"`.

- The tools are `whoami`, `list_languages`, `list_passages`, `get_passage`, `record_review`, `report_release`, `set_external_value` and `get_external_values`. An agent sees only the tools its scopes allow.
- A batch holds at most 20 messages.
- Reviewers' comments come from people outside the team. An agent that reads them and can also write should treat them as data, not instructions.

## Errors

Errors are JSON: `{ "error": "what happened, in words", "code": "short_code" }`.

| Status | Means |
| --- | --- |
| `401` | missing, unknown, revoked or expired token |
| `403` | a scope or role that does not allow it |
| `404` | not there, or not visible to this token |
| `409` | not approved, or not that version |
| `410` | a closed review link |
| `413` | an external value's data over 4096 bytes |
| `429` | a write or request limit |

The device endpoints use OAuth's error codes.

## Where it lives

| Part | Code |
| --- | --- |
| Routes, device flow, signed-in routes | `apps/web/worker/agent/http.ts` |
| Review links | `apps/web/worker/agent/links.ts`, page `reviewPage.ts` |
| What a token or link sees and writes | `apps/web/worker/agent/view.ts` |
| Per-organization reads and writes, limits | `apps/web/worker/agent/org.ts`, in the `OrgSnapshot` Durable Object |
| MCP | `apps/web/worker/agent/mcp.ts` |
| `/connect` | `apps/web/worker/agent/connectPage.ts` |
| Voice note checks | `apps/web/worker/agent/voice.ts` |
| Tables (service role only) | `supabase/migrations/20261008000000_api_tokens.sql`, `20261008140000_review_links_releases.sql` |
| Approved version, releases, links per step | core `approvedVersion`, `releasesOf`, `stepAllowsLinks`; events `v1.VersionReleased`, `v1.FlowStepLinksSet` |
| Tests | `apps/web/test/agentApi.test.ts`, `packages/core/test/externalReview.test.ts` |
