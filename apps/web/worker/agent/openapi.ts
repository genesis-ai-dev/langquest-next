import { EXTERNAL_KEY_MAX, KIND_STATE_LABEL } from '@langquest-next/core';
import { LINK_DAYS, LINK_MAX_DAYS } from './links';
import { UPLOADS_PER_HOUR, WRITES_PER_HOUR } from './org';
import { SCOPE_TEXT, SCOPES, TOKEN_PREFIX } from './tokens';
import {
  API_STATUSES, EXTERNAL_DATA_MAX_BYTES, EXTERNAL_VALUES_PAGE, MAX_VOICE_NOTES, MEDIA, PASSAGE_INCLUDES, PASSAGES_PAGE, PASSAGES_PAGE_MAX, TEAM_ONLY
} from './view';

/**
 * The access-token API as OpenAPI 3.1 (decisions.md 86), served at
 * `/api/v1/openapi.json`. It is the reference; docs/agent-api.md is the
 * guide. It names the code's own constants, so limits and enums cannot
 * drift, and apps/web/test/agentApi.test.ts checks every response the API
 * tests produce against it, so a field cannot change without it.
 *
 * Object schemas leave additionalProperties open, so a field added later
 * does not break a generated client; the tests close them, so every field
 * the API sends must be listed here.
 *
 * Not here: `/session/*` and `/links/*`, which only LangQuest's own pages
 * call (the connect page and the review page), with no CORS.
 */

type Schema = Record<string, unknown>;

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const text = (description?: string, extra: Schema = {}): Schema => ({ type: 'string', ...(description ? { description } : {}), ...extra });
const time = (description?: string): Schema => text(description, { format: 'date-time' });
const int = (description?: string, extra: Schema = {}): Schema => ({ type: 'integer', ...(description ? { description } : {}), ...extra });
const bool = (description?: string): Schema => ({ type: 'boolean', ...(description ? { description } : {}) });
const list = (items: Schema, description?: string, extra: Schema = {}): Schema => ({ type: 'array', items, ...(description ? { description } : {}), ...extra });
const nullable = (s: Schema): Schema =>
  '$ref' in s ? { oneOf: [s, { type: 'null' }] } : { ...s, type: [s['type'], 'null'], ...(s['enum'] ? { enum: [...(s['enum'] as unknown[]), null] } : {}) };
/** An object whose properties are all required except those named in `optional`. */
const obj = (properties: Record<string, Schema>, optional: string[] = [], description?: string): Schema => ({
  type: 'object', ...(description ? { description } : {}), properties, required: Object.keys(properties).filter((k) => !optional.includes(k))
});
const json = (schema: Schema, description: string) => ({ description, content: { 'application/json': { schema } } });
const body = (schema: Schema, description?: string) => ({ required: true, ...(description ? { description } : {}), content: { 'application/json': { schema } } });

const ERRORS = { default: json(ref('Error'), 'An error: what happened in words, and a short code. The status says what kind (see the descriptions).') };

const LANGUAGE_ID = { name: 'languageId', in: 'path', required: true, schema: text(), description: 'A languageId from GET /languages.' };
const UNIT_ID = {
  name: 'unitId', in: 'path', required: true, schema: text(),
  description: 'A unitId from the passage list. Unit ids hold slashes: URL-encode it (a slash as %2F), or send the slashes as they are.'
};
const VALUE_KEY = {
  name: 'key', in: 'path', required: true, schema: text(undefined, { maxLength: EXTERNAL_KEY_MAX }),
  description: 'A key your app chose: segments of letters, digits and . _ ~ : @ + - joined by /. Start it with your app\'s own name, such as org.example.app/plays/….'
};
const CHANGED_SINCE = { name: 'changedSince', in: 'query', schema: time(), description: 'Only what changed after this time. Pass the newest updatedAt (or at) you have seen to follow changes.' };

function schemas(): Record<string, Schema> {
  const summary: Record<string, Schema> = {
    unitId: text(),
    label: text('Such as "Matthew 5".'),
    path: list(text(), 'Labels of the units that hold it, outermost first ("Matthew").'),
    status: ref('Status'),
    version: nullable(obj({
      n: int(), takeId: text(), submittedAt: time(),
      durationMs: int('The length of what audio plays: the version\'s own recording, or for a written version the recording added to it; 0 when there is none.'),
      medium: ref('Medium'),
      madeBy: ref('MadeBy'),
      added: list(ref('Added'), 'What steps added to this version, one entry per medium; present when a step added something. It belongs to the version.')
    }, ['madeBy', 'added'], 'The version this token hears: the latest with read, the approved one with read:published alone. Null when there is none.')),
    approvedVersion: nullable(obj({ n: int(), takeId: text(), medium: ref('Medium') }, [], 'The newest version every step approved; what a listening app should play.')),
    releases: list(ref('Release'), 'Where a version is live, one entry per channel.'),
    listenerFeedback: obj({ looksGood: int(), needsChanges: int() }, [], 'Listener feedback on version.'),
    updatedAt: nullable(time('The newest version, review, release, or thing a step made or added; pass it back as changedSince.'))
  };
  const includes: Record<(typeof PASSAGE_INCLUDES)[number], Schema> = {
    audio: list(ref('AudioCard'), 'What version plays, in order: a recorded version\'s own cards, or the recording a step added to a written version. Empty when there is none.'),
    text: list(ref('TextPart'), 'version\'s words, in order: a written version\'s own parts, or the words a step added to a recorded version. Parts whose words have not arrived are left out; empty when there are none.'),
    reviews: list(ref('Review'), 'With read: every review of every version. With read:published alone: listener reviews of version.'),
    steps: list(ref('Step'), 'The language\'s review flow and where the passage is in it. Needs read.'),
    requests: list(ref('Request'), 'Work asked for and not done yet, oldest first. Needs read.'),
    versions: list(obj({ n: int(), takeId: text(), submittedAt: time(), medium: ref('Medium'), madeBy: ref('MadeBy') }, ['madeBy']), 'Every version, oldest first. Needs read.'),
    made: list(ref('Made'), 'What was made beside the passage\'s versions (back translations, written copies), and added to them, oldest first; never a version a step made. Needs read.')
  };
  const passage = (optional: string[], description: string) => obj({ ...summary, ...includes }, optional, description);

  return {
    Error: obj({ error: text('What happened, in words.'), code: text('A short code, such as scope, no_language or rate_limited.') }),
    OAuthError: obj({
      error: text('An OAuth device-flow error (RFC 8628).', { enum: ['authorization_pending', 'slow_down', 'access_denied', 'expired_token', 'invalid_grant'] }),
      error_description: text()
    }),
    Scope: text(Object.entries(SCOPE_TEXT).map(([s, t]) => `${s}: ${t}.`).join(' '), { enum: [...SCOPES] }),
    Index: obj({
      name: text(), docs: text(), connect: text(), openapi: text(), auth: text(),
      scopes: { type: 'object', additionalProperties: text() },
      endpoints: { type: 'object', additionalProperties: text() }
    }),
    Token: obj({
      id: text(), orgId: text(), name: text(), scopes: list(ref('Scope')),
      languageIds: nullable(list(text(), 'The languages it reaches; null for every language its person may view.')),
      createdVia: text(undefined, { enum: ['page', 'device'] }), clientName: nullable(text('The app that asked for it, by the device flow.')),
      createdAt: time(), expiresAt: nullable(time()), revokedAt: nullable(time()), lastUsedAt: nullable(time())
    }),
    Language: obj({
      languageId: text(), name: text(), code: text(), country: nullable(text()),
      can: obj({
        read: nullable(text('all with read, published with read:published alone.', { enum: ['all', 'published'] })),
        review: bool(), release: bool(), externalValues: obj({ read: bool(), write: bool() })
      }, [], 'What this token can do here, given its scopes and its person\'s privileges today.')
    }),
    Me: obj({ token: ref('Token'), languages: list(ref('Language')) }),
    Status: text(undefined, { enum: [...API_STATUSES] }),
    Release: obj({ channel: text(), versionN: int(), takeId: text(), url: text(), at: time() }, ['url']),
    AudioCard: obj({
      hash: text(), format: text(undefined, { enum: ['wav', 'm4a'] }), durationMs: int(),
      url: text('Plays without a token until expiresAt (ten minutes), with Range support. Ask again for a fresh one.'), expiresAt: time()
    }),
    Review: obj({
      kindId: text('listener, or a kind in the language\'s flow.'), kind: text('The kind\'s name, such as "Peer Review".'),
      outcome: text(undefined, { enum: ['looks_good', 'needs_changes', 'recorded'] }), via: text(undefined, { enum: ['app', 'link', 'logged'] }),
      versionN: int(), at: time(), comment: text(), givenBy: text(),
      voiceNotes: list(obj({ url: text(), expiresAt: time(), durationMs: int(), atMs: int('Where in the version it is about.') }, ['atMs']))
    }, ['comment', 'givenBy', 'voiceNotes']),
    Step: obj({
      name: text('Such as "Peer Review + Back Translation".'), complete: bool(), checkpoint: bool(),
      kinds: list(obj({
        kindId: text('What a review of this step sends as kindId.'), name: text(),
        state: text(undefined, { enum: Object.keys(KIND_STATE_LABEL) }),
        apiReviewCounts: bool('Whether a review through this API completes it: on an ordinary step that takes links, never on a checkpoint.')
      }))
    }),
    Request: obj({
      requestId: text(), what: text(undefined, { enum: ['record', 'review'] }), kindId: text('A review of this kind answers it.'), kind: text(),
      forYou: bool('Asked of the token\'s person, or a team they are in.'), team: text(), dueDate: text(), note: text(), askedAt: time()
    }, ['kindId', 'kind', 'team', 'dueDate', 'note']),
    Medium: text('A version, or something made, is recorded (audio) or written (text).', { enum: [...MEDIA] }),
    MadeBy: obj({
      kindId: text('The step that made it.'), kind: text('The step\'s name, such as "Final recording".'),
      fromVersionN: int('The version it was made from. The checks before that step count from that version.')
    }, [], 'A step made this version from an earlier one, which it replaces. Absent when someone published it by hand.'),
    Added: obj({
      medium: ref('Medium'),
      kindId: text('The step that added it.'), kind: text(),
      addedAt: time('When this medium was first added to the version.'),
      changedAt: time('When it last changed, if it changed after it was first added.'),
      changedAfterReview: obj({ kindId: text(), kind: text(), at: time() }, [],
        'The newest review of the version given after it was first added and before it last changed: the content changed after that review. The approval stands; the team decides whether it needs another review.')
    }, ['kindId', 'kind', 'changedAt', 'changedAfterReview'], 'Words a step added to a recording, or a recording added to writing. The latest holds.'),
    TextPart: obj({
      text: text('The words of one written part, usually a verse.'),
      verses: obj({ from: text('chapter:verse'), to: text('chapter:verse') }, [], 'The verses it holds, when someone set them.')
    }, ['verses']),
    Made: obj({
      madeId: text(), kindId: text('The step that made it; absent when none did (brought over from LangQuest v2).'), kind: text(),
      medium: ref('Medium'),
      language: text('The language it is in, when not the team\'s own (ISO 639-3 or a glottocode).'),
      fromVersionN: int('The version it was made from, directly or from something made from it.'),
      added: bool('It was added to that version, which holds it (version.added).'),
      at: time(),
      text: list(ref('TextPart'), 'Its words, when written.'),
      audio: list(ref('AudioCard'), 'Its recording, when recorded.')
    }, ['kindId', 'kind', 'language', 'text', 'audio'], 'Something a step made from a version. It stays with that version and is never out of date.'),
    PassageListItem: passage([...PASSAGE_INCLUDES], 'A passage\'s summary, with the fields include named.'),
    PassageDetail: passage([...TEAM_ONLY], `Everything the token may see of one passage; ${TEAM_ONLY.join(', ')} need read.`),
    PassagePage: obj({
      passages: list(ref('PassageListItem')),
      nextAfter: nullable(text('Pass it as after for the next page; null when nothing more matches.'))
    }),
    VoiceNote: obj({
      hash: text(undefined, { pattern: '^[0-9a-f]{64}$' }), format: text(undefined, { enum: ['m4a', 'wav'] }), durationMs: int(undefined, { minimum: 0 })
    }, [], 'A voice note just uploaded.'),
    ReviewInput: obj({
      outcome: text('needs_changes asks the translator to respond.', { enum: ['looks_good', 'needs_changes'] }),
      reviewerId: text('Your own id for whoever gave it, such as a listener or a device. Only a hash is kept. One answer per reviewer, version, kind and outcome.', { minLength: 1, maxLength: 200 }),
      kindId: text('listener (the default, which never clears a step) or a kindId from the passage\'s steps. To answer a request, send its kindId.', { minLength: 1, maxLength: 100 }),
      takeId: text('The version heard; the passage\'s version when left out.', { minLength: 1, maxLength: 200 }),
      comment: text(undefined, { minLength: 1, maxLength: 4000 }),
      reviewerName: text('Shown to the team as who gave it.', { minLength: 1, maxLength: 120 }),
      submissionId: text('Lets one reviewer answer again.', { minLength: 1, maxLength: 64 }),
      voiceNotes: list(obj({
        hash: text(undefined, { pattern: '^[0-9a-f]{64}$' }), format: text(undefined, { enum: ['m4a', 'wav'] }),
        durationMs: { type: 'number', minimum: 0 }, atMs: int('Where in the version it is about, ms from the start.', { minimum: 0 })
      }, ['durationMs', 'atMs']), 'What PUT …/voice-notes returned, each attached within six hours of its upload.', { maxItems: MAX_VOICE_NOTES, uniqueItems: true })
    }, ['kindId', 'takeId', 'comment', 'reviewerName', 'submissionId', 'voiceNotes']),
    ReleaseInput: obj({
      live: bool('true: it is published there; false: it was taken down.'),
      channel: text('Where, such as "Every Language app".', { minLength: 1, maxLength: 60 }),
      takeId: text('The version; the approved one when left out.', { minLength: 1, maxLength: 200 }),
      url: text('An https link to it there.', { pattern: '^https://\\S{1,2000}$' })
    }, ['takeId', 'url']),
    WriteResult: obj({
      eventId: text(), duplicate: bool('True when this was already recorded, so nothing new was.'),
      passage: nullable(ref('PassageDetail'))
    }),
    ExternalValue: obj({
      key: text(),
      data: nullable({ type: 'object', description: 'Null when the key was deleted (listed only with changedSince).' }),
      writtenBy: obj({ profileId: text(), tokenId: nullable(text()), app: text('The app behind the token.') }, ['app']),
      at: time()
    }),
    ExternalValuePage: obj({
      values: list(ref('ExternalValue')),
      nextAfter: nullable(text('Pass it as after for the next page; null when there is no more.'))
    }),
    ExternalValueInput: obj({ data: { type: 'object', description: `A JSON object of at most ${EXTERNAL_DATA_MAX_BYTES} bytes.` } }),
    ExternalValueDeleted: obj({ key: text(), deleted: { const: true } }),
    ReviewLinkInput: obj({
      languageId: text(undefined, { maxLength: 200 }), unitId: text(undefined, { maxLength: 400 }), kindId: text('The kind its reviews are of.', { maxLength: 100 }),
      counts: bool('Whether reviews through it count toward the step (true) or are listener feedback (false).'),
      takeId: text('The version it plays; the latest when left out.', { maxLength: 200 }),
      label: text('Such as who it is for.', { maxLength: 120 }),
      expiresInDays: int(`${LINK_DAYS} when left out.`, { minimum: 1, maximum: LINK_MAX_DAYS })
    }, ['takeId', 'label', 'expiresInDays']),
    ReviewLink: obj({
      id: text(), languageId: text(), unitId: text(), takeId: text(), kindId: text(), counts: bool(), label: nullable(text()),
      createdBy: text(), createdAt: time(), expiresAt: time(), revokedAt: nullable(time()),
      url: text('The link to share. Only this answer has it; LangQuest keeps only its hash.')
    }),
    DeviceCodeInput: {
      ...obj({
        clientName: text('What your app or agent is called. One of clientName, client_name or client_id is required.', { minLength: 1, maxLength: 120 }),
        client_name: text('clientName, as OAuth clients send it.', { minLength: 1, maxLength: 120 }),
        client_id: text('clientName, as OAuth clients send it.', { minLength: 1, maxLength: 120 }),
        scopes: list(ref('Scope'), 'read:published when left out.'),
        scope: text('Scopes separated by spaces, as OAuth sends them, instead of scopes.'),
        orgId: text('The organization to suggest.')
      }, ['clientName', 'client_name', 'client_id', 'scopes', 'scope', 'orgId']),
      anyOf: [{ required: ['clientName'] }, { required: ['client_name'] }, { required: ['client_id'] }]
    },
    DeviceCode: obj({
      device_code: text('Poll with it; once approved it is the access token.'), user_code: text(), verification_uri: text(),
      verification_uri_complete: text(), expires_in: int(), interval: int('Seconds to wait between polls.'), message: text()
    }),
    DeviceTokenInput: obj({ device_code: text() }),
    DeviceToken: obj({
      access_token: text(), token_type: { const: 'Bearer' }, scope: text('Scopes separated by spaces.'), org_id: text(),
      language_ids: nullable(list(text())), expires_at: nullable(time())
    }),
    JsonRpc: { type: ['object', 'array'], description: 'A JSON-RPC 2.0 message, or a batch of at most 20.' }
  };
}

function paths(): Record<string, Schema> {
  const auth = { security: [{ token: [] }] };
  const open = { security: [] };
  return {
    '/': { get: { ...open, operationId: 'index', summary: 'What is here: the routes, the scopes and where to get a token.', responses: { 200: json(ref('Index'), 'The index.') } } },
    '/openapi.json': { get: { ...open, operationId: 'openapi', summary: 'This document.', responses: { 200: json({ type: 'object' }, 'OpenAPI 3.1.') } } },
    '/me': { get: { ...auth, operationId: 'me', summary: 'The token, and the languages it can open.', responses: { 200: json(ref('Me'), 'The token and its languages.'), ...ERRORS } } },
    '/languages': { get: { ...auth, operationId: 'listLanguages', summary: 'The languages this token can open, and what it can do in each.', responses: { 200: json(list(ref('Language')), 'Languages.'), ...ERRORS } } },
    '/languages/{languageId}': {
      get: { ...auth, operationId: 'getLanguage', parameters: [LANGUAGE_ID], summary: 'One language.', responses: { 200: json(ref('Language'), 'The language.'), ...ERRORS } }
    },
    '/languages/{languageId}/passages': {
      get: {
        ...auth, operationId: 'listPassages',
        summary: 'Passages in display order, a page at a time.',
        description: `A token with read:published alone sees approved passages only. include adds fields of one passage to every passage on the page, and links are signed only for the page; ${TEAM_ONLY.join(', ')} need read (403 scope otherwise).`,
        parameters: [
          LANGUAGE_ID,
          { name: 'status', in: 'query', schema: ref('Status'), description: 'Only passages with this status.' },
          CHANGED_SINCE,
          { name: 'unitIds', in: 'query', style: 'form', explode: true, schema: list(text(), undefined, { maxItems: PASSAGES_PAGE_MAX }), description: 'Only these passages, still in display order. Repeat it once per id, since an id may hold a comma. Ids that do not exist, or this token cannot see, are left out.' },
          { name: 'include', in: 'query', style: 'form', explode: false, schema: list(text(undefined, { enum: [...PASSAGE_INCLUDES] })), description: 'Comma-separated fields of one passage to add to each passage.' },
          { name: 'limit', in: 'query', schema: int(`Passages per page; ${PASSAGES_PAGE} when left out.`, { minimum: 1, maximum: PASSAGES_PAGE_MAX }) },
          { name: 'after', in: 'query', schema: text('The nextAfter of the page before.') }
        ],
        responses: { 200: json(ref('PassagePage'), 'A page of passages.'), ...ERRORS }
      }
    },
    '/languages/{languageId}/passages/{unitId}': {
      get: {
        ...auth, operationId: 'getPassage', parameters: [LANGUAGE_ID, UNIT_ID],
        summary: 'Everything this token may see of one passage: the list with every include, for one unit.',
        responses: { 200: json(ref('PassageDetail'), 'The passage.'), ...ERRORS }
      }
    },
    '/languages/{languageId}/passages/{unitId}/reviews': {
      post: {
        ...auth, operationId: 'recordReview', parameters: [LANGUAGE_ID, UNIT_ID],
        summary: 'Record a review as the token\'s person: listener feedback, or a step in the flow. Needs the review scope.',
        description: `A review through the API never clears a checkpoint. A token makes at most ${WRITES_PER_HOUR} writes an hour (429 rate_limited).`,
        requestBody: body(ref('ReviewInput')),
        responses: { 200: json(ref('WriteResult'), 'Recorded; passage shows it.'), ...ERRORS }
      }
    },
    '/languages/{languageId}/passages/{unitId}/releases': {
      post: {
        ...auth, operationId: 'reportRelease', parameters: [LANGUAGE_ID, UNIT_ID],
        summary: 'Say where a version is published, or that it was taken down. Needs the release scope.',
        description: 'Only the approved version can go live (409 not_approved).',
        requestBody: body(ref('ReleaseInput')),
        responses: { 200: json(ref('WriteResult'), 'Recorded; passage shows it.'), ...ERRORS }
      }
    },
    '/languages/{languageId}/voice-notes': {
      put: {
        ...auth, operationId: 'uploadVoiceNote', parameters: [LANGUAGE_ID],
        summary: 'Upload a voice note to attach to a review within six hours. Needs the review scope.',
        description: `AAC in MP4 or WAV, at most 20 MB, with Content-Length. A token uploads at most ${UPLOADS_PER_HOUR} an hour.`,
        requestBody: { required: true, content: { 'audio/mp4': { schema: text(undefined, { format: 'binary' }) }, 'audio/wav': { schema: text(undefined, { format: 'binary' }) } } },
        responses: { 200: json(obj({ voiceNote: ref('VoiceNote') }), 'Send voiceNote back in the review\'s voiceNotes.'), ...ERRORS }
      }
    },
    '/languages/{languageId}/external-values': {
      get: {
        ...auth, operationId: 'listExternalValues',
        summary: `Values your apps keep with the language, ${EXTERNAL_VALUES_PAGE} at a time in key order. Needs read or external_values.`,
        parameters: [
          LANGUAGE_ID,
          { name: 'keyPrefix', in: 'query', schema: text(undefined, { maxLength: EXTERNAL_KEY_MAX }) },
          { ...CHANGED_SINCE, description: 'Only values changed after this time, deletions included (data null).' },
          { name: 'after', in: 'query', schema: text('The nextAfter of the page before.') }
        ],
        responses: { 200: json(ref('ExternalValuePage'), 'A page of values.'), ...ERRORS }
      }
    },
    '/languages/{languageId}/external-values/{key}': {
      get: { ...auth, operationId: 'getExternalValue', parameters: [LANGUAGE_ID, VALUE_KEY], summary: 'One value. Needs read or external_values.', responses: { 200: json(ref('ExternalValue'), 'The value.'), ...ERRORS } },
      put: {
        ...auth, operationId: 'setExternalValue', parameters: [LANGUAGE_ID, VALUE_KEY],
        summary: 'Store a value as the token\'s person. Needs external_values. LangQuest keeps it and never acts on it.',
        requestBody: body(ref('ExternalValueInput')),
        responses: { 200: json(ref('ExternalValue'), 'What is stored now.'), ...ERRORS }
      },
      delete: { ...auth, operationId: 'deleteExternalValue', parameters: [LANGUAGE_ID, VALUE_KEY], summary: 'Delete a key. Needs external_values.', responses: { 200: json(ref('ExternalValueDeleted'), 'Deleted.'), ...ERRORS } }
    },
    '/review-links': {
      post: {
        ...auth, operationId: 'createReviewLink',
        summary: 'Share a link anyone can review one version through, as the token\'s person. Needs read and review.',
        description: 'The link closes when the token is revoked, and lasts no longer than the token.',
        requestBody: body(ref('ReviewLinkInput')),
        responses: { 200: json(ref('ReviewLink'), 'The link, with its url.'), ...ERRORS }
      }
    },
    '/mcp': {
      post: {
        ...auth, operationId: 'mcp',
        summary: 'Model Context Protocol (stateless streamable HTTP): the same API as tools for an agent.',
        requestBody: body(ref('JsonRpc')),
        responses: {
          200: json(ref('JsonRpc'), 'The answer.'), 202: { description: 'Notifications only; nothing to answer.' },
          400: json(ref('JsonRpc'), 'A JSON-RPC error: not JSON, or a batch of more than 20.'), ...ERRORS
        }
      },
      delete: { ...auth, operationId: 'mcpClose', summary: 'Close an MCP session. The server keeps none, so this changes nothing.', responses: { 204: { description: 'Closed.' }, ...ERRORS } }
    },
    '/device/code': {
      post: {
        ...open, operationId: 'deviceCode',
        summary: 'Ask for a token for your app (OAuth device flow, RFC 8628). A person approves it at verification_uri.',
        description: 'JSON or a form body. Each address may call the device routes 20 times a minute (429 slow_down).',
        requestBody: { required: true, content: { 'application/json': { schema: ref('DeviceCodeInput') }, 'application/x-www-form-urlencoded': { schema: ref('DeviceCodeInput') } } },
        responses: { 200: json(ref('DeviceCode'), 'Show the person user_code and verification_uri, then poll /device/token.'), 429: json(ref('OAuthError'), 'Too many requests from this address.'), ...ERRORS }
      }
    },
    '/device/token': {
      post: {
        ...open, operationId: 'deviceToken',
        summary: 'Poll for the token every interval seconds until the person decides.',
        requestBody: { required: true, content: { 'application/json': { schema: ref('DeviceTokenInput') }, 'application/x-www-form-urlencoded': { schema: ref('DeviceTokenInput') } } },
        responses: {
          200: json(ref('DeviceToken'), 'Approved: access_token is the device code.'),
          400: json({ anyOf: [ref('OAuthError'), ref('Error')] }, 'Not yet (authorization_pending, slow_down) or never (access_denied, expired_token, invalid_grant).'),
          429: json(ref('OAuthError'), 'Too many requests from this address.'),
          ...ERRORS
        }
      }
    }
  };
}

/** The document, with the address it is served from. */
export function openApi(origin: string): Schema {
  return {
    openapi: '3.1.0',
    info: {
      title: 'LangQuest API',
      version: '1',
      summary: 'Oral Bible translation work: languages, passages recorded as audio or written, their reviews and releases.',
      description: 'For apps and agents, with an access token. The guide is docs/agent-api.md: https://github.com/genesis-ai-dev/langquest-next/blob/main/docs/agent-api.md'
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ token: [] }],
    components: {
      securitySchemes: {
        token: { type: 'http', scheme: 'bearer', description: `An access token, which starts with ${TOKEN_PREFIX}. Make one at /connect, or ask with the device flow. It can never do more than its person can do today.` }
      },
      schemas: schemas()
    },
    paths: paths()
  };
}
