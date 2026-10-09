import type { AgentQuery, AgentWrite, Answer, OrgAccess } from './org';
import { handleMcp } from './mcp';
import type { AgentStore, TokenRecord } from './store';
import {
  hashSecret, newSecret, newUserCode, normalizeUserCode, parseScopes, SCOPE_TEXT, SCOPES, TOKEN_PREFIX, type Grant, type Scope
} from './tokens';
import { handlePublicLink, sessionLinks, tokenLinks } from './links';
import { isRefusal, parseRelease, parseReview, type ApiStatus, type LinkReviewInput, type LinkSpec, type LinkView, type PassageFilter, type ReviewLink, type VoiceNote } from './view';
import { readVoiceNote } from './voice';

/**
 * `/api/v1/*`: the access-token API for apps and agents (docs/agent-api.md,
 * decisions.md 70), its device flow, review links (links.ts), and the
 * signed-in routes the connect page and the app use to make, approve and
 * revoke tokens and links.
 */

/** One organization's Durable Object, as this file uses it. */
export interface OrgStub {
  read(grant: Grant, q: AgentQuery): Promise<Answer<unknown>>;
  write(grant: Grant, w: AgentWrite): Promise<Answer<unknown>>;
  access(profileId: string): Promise<OrgAccess | null>;
  /** Count one voice note upload against a token's or link's hourly uploads; false when they are spent. */
  spend(key: string): Promise<boolean>;
  /** Count one write that is not an event (a review link made with a token) against the token's writes. */
  spendWrite(key: string): Promise<boolean>;
  /** Is the link open: not revoked or expired, and its sharer can still record (decisions.md 75)? */
  linkOpen(link: ReviewLink): Promise<boolean>;
  /** May this person take back a link someone else shared in its language? */
  mayRevokeLink(profileId: string, link: ReviewLink): Promise<boolean>;
  checkLink(profileId: string, spec: LinkSpec): Promise<Answer<{ takeId: string }>>;
  linkInfo(link: ReviewLink): Promise<Answer<LinkView>>;
  linkReview(link: ReviewLink, input: LinkReviewInput): Promise<Answer<{ duplicate: boolean }>>;
}

export interface AgentDeps {
  store: AgentStore;
  /** The profile a Supabase access token belongs to (the connect page's session). */
  profileOf(jwt: string): Promise<string | null>;
  org(orgId: string): OrgStub;
  /** Store a voice note under the language and record it, returning its hash; null when file storage is not set up. */
  saveVoiceNote: ((orgId: string, languageId: string, bytes: Uint8Array<ArrayBuffer>, format: VoiceNote['format']) => Promise<string>) | null;
  /** False when this caller (by address) has asked too often. The device endpoints and review links need no sign-in. */
  publicAllowed?(request: Request, what: 'device' | 'link'): Promise<boolean>;
  now?: () => number;
}

/** How long an app has to get a person to approve it. */
export const DEVICE_CODE_TTL_S = 10 * 60;
/** Seconds an app waits between polls. */
export const POLL_INTERVAL_S = 5;
/** last_used_at is written at most this often per token. */
const TOUCH_EVERY_MS = 5 * 60 * 1000;

const STATUSES: readonly ApiStatus[] = ['not_started', 'drafting', 'in_review', 'feedback', 'approved'];

/**
 * Any origin may call with a token: it travels in a header, never a cookie,
 * so a listening app on the web works like one on a phone. The signed-in
 * routes are for the connect page on this origin only, and get no CORS.
 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-expose-headers': 'mcp-session-id'
};

export function json(status: number, body: unknown, cors = true): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', ...(cors ? CORS : {}) }
  });
}

export const fail = (status: number, code: string, error: string, cors = true) => json(status, { error, code }, cors);

export const answer = (a: Answer<unknown>, cors = true) => (a.ok ? json(200, a.data, cors) : fail(a.status, a.code, a.error, cors));

export const bearer = (request: Request) => /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]?.trim();

export async function body(request: Request): Promise<Record<string, unknown> | null> {
  const type = request.headers.get('content-type') ?? '';
  try {
    if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(await request.text()));
    const text = await request.text();
    if (!text.trim()) return {};
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const segments = (path: string): string[] | null => {
  try {
    return path.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
};

/** The token behind a request, or the response that refuses it. */
export async function grantFor(request: Request, deps: AgentDeps): Promise<{ grant: Grant; token: TokenRecord } | Response> {
  const secret = bearer(request);
  if (!secret) return fail(401, 'no_token', `Send your access token as "Authorization: Bearer ${TOKEN_PREFIX}…". Make one at /connect.`);
  if (!secret.startsWith(TOKEN_PREFIX)) return fail(401, 'bad_token', `That is not a LangQuest access token; they start with "${TOKEN_PREFIX}".`);
  const token = await deps.store.tokenByHash(await hashSecret(secret));
  const now = (deps.now ?? Date.now)();
  if (!token) return fail(401, 'bad_token', 'This token is not known. It may have been mistyped, or its app request was never approved.');
  if (token.revokedAt) return fail(401, 'revoked', 'This token was revoked.');
  if (token.expiresAt && Date.parse(token.expiresAt) <= now) return fail(401, 'expired', 'This token has expired. Make a new one at /connect.');
  if (!token.lastUsedAt || Date.parse(token.lastUsedAt) < now - TOUCH_EVERY_MS) {
    await deps.store.touchToken(token.id, new Date(now).toISOString()).catch((e: unknown) => console.error('touch token', e));
  }
  return { grant: { tokenId: token.id, orgId: token.orgId, profileId: token.profileId, scopes: token.scopes, languageIds: token.languageIds }, token };
}

export const tokenOut = (t: TokenRecord) => ({
  id: t.id, orgId: t.orgId, name: t.name, scopes: t.scopes, languageIds: t.languageIds, createdVia: t.createdVia,
  clientName: t.clientName, createdAt: t.createdAt, expiresAt: t.expiresAt, revokedAt: t.revokedAt, lastUsedAt: t.lastUsedAt
});

export async function handleAgentApi(request: Request, deps: AgentDeps): Promise<Response> {
  const url = new URL(request.url);
  const parts = segments(url.pathname.slice('/api/v1'.length));
  if (!parts) return fail(400, 'bad_request', 'That address is not valid.');
  const session = parts[0] === 'session';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: session ? {} : CORS });
  try {
    if (session) return await sessionRoute(request, parts.slice(1), url, deps);
    if (parts[0] === 'device') return await deviceRoute(request, parts.slice(1), url, deps);
    if (parts[0] === 'links') return await handlePublicLink(request, parts.slice(1), deps);
    if (parts.length === 0) return json(200, index(url));
    const auth = await grantFor(request, deps);
    if (auth instanceof Response) return auth;
    if (parts[0] === 'mcp' && parts.length === 1) return await handleMcp(request, auth.grant, deps.org(auth.grant.orgId), url);
    return await tokenRoute(request, parts, url, auth, deps);
  } catch (e) {
    console.error(`agent api ${request.method} ${url.pathname}:`, e);
    return fail(502, 'unavailable', 'The server could not answer just now. Try again.', !session);
  }
}

function index(url: URL) {
  const base = `${url.origin}/api/v1`;
  return {
    name: 'LangQuest API',
    docs: 'https://github.com/genesis-ai-dev/langquest-next/blob/main/docs/agent-api.md',
    connect: `${url.origin}/connect`,
    auth: `Authorization: Bearer ${TOKEN_PREFIX}…`,
    scopes: SCOPE_TEXT,
    endpoints: {
      me: `GET ${base}/me`,
      languages: `GET ${base}/languages`,
      passages: `GET ${base}/languages/{languageId}/passages?status=approved&changedSince=ISO`,
      passage: `GET ${base}/languages/{languageId}/passages/{unitId}`,
      review: `POST ${base}/languages/{languageId}/passages/{unitId}/reviews`,
      release: `POST ${base}/languages/{languageId}/passages/{unitId}/releases`,
      voiceNote: `PUT ${base}/languages/{languageId}/voice-notes (m4a or WAV body)`,
      reviewLink: `POST ${base}/review-links`,
      mcp: `POST ${base}/mcp (Model Context Protocol, streamable HTTP)`,
      deviceCode: `POST ${base}/device/code`,
      deviceToken: `POST ${base}/device/token`
    }
  };
}

async function tokenRoute(request: Request, parts: string[], url: URL, auth: { grant: Grant; token: TokenRecord }, deps: AgentDeps): Promise<Response> {
  const { grant } = auth;
  const org = deps.org(grant.orgId);
  const get = request.method === 'GET';
  if (parts[0] === 'me' && parts.length === 1 && get) {
    const languages = await org.read(grant, { op: 'languages' });
    return json(200, { token: tokenOut(auth.token), languages: languages.ok ? languages.data : [] });
  }
  if (parts[0] === 'review-links') return tokenLinks(request, parts.slice(1), url, grant, auth.token, deps);
  if (parts[0] !== 'languages') return fail(404, 'not_found', 'Not found. GET /api/v1 lists what is here.');
  if (parts.length === 1 && get) return answer(await org.read(grant, { op: 'languages' }));
  const languageId = parts[1]!;
  if (parts.length === 2 && get) {
    const all = await org.read(grant, { op: 'languages' });
    const one = all.ok ? (all.data as { languageId: string }[]).find((l) => l.languageId === languageId) : undefined;
    return one ? json(200, one) : fail(404, 'no_language', 'This token cannot open that language.');
  }
  if (parts[2] === 'voice-notes' && parts.length === 3 && request.method === 'PUT') return voiceNote(request, grant, languageId, deps);
  if (parts[2] !== 'passages') return fail(404, 'not_found', 'Not found. GET /api/v1 lists what is here.');
  if (parts.length === 3 && get) {
    const filter = filterFrom(url);
    return isRefusal(filter) ? fail(filter.status, filter.code, filter.error) : answer(await org.read(grant, { op: 'passages', languageId, filter }));
  }
  const last = parts[parts.length - 1];
  const action = parts.length > 4 && (last === 'reviews' || last === 'releases') ? last : undefined;
  const unitId = parts.slice(3, action ? -1 : undefined).join('/');
  if (!unitId) return fail(404, 'not_found', 'Not found.');
  if (get && !action) return answer(await org.read(grant, { op: 'passage', languageId, unitId }));
  if (request.method !== 'POST' || !action) return fail(405, 'method', 'Use GET for a passage, POST for its reviews or releases.');
  const b = await body(request);
  if (!b) return fail(400, 'bad_request', 'Send a JSON object.');
  if (action === 'reviews') {
    const input = parseReview(b);
    return isRefusal(input) ? fail(input.status, input.code, input.error) : answer(await org.write(grant, { op: 'review', languageId, unitId, input }));
  }
  const input = parseRelease(b);
  return isRefusal(input) ? fail(input.status, input.code, input.error) : answer(await org.write(grant, { op: 'release', languageId, unitId, input }));
}

export function filterFrom(url: URL): PassageFilter | { status: number; code: string; error: string } {
  const filter: PassageFilter = {};
  const status = url.searchParams.get('status');
  if (status) {
    if (!(STATUSES as readonly string[]).includes(status)) return { status: 400, code: 'bad_request', error: `status is one of ${STATUSES.join(', ')}.` };
    filter.status = status as ApiStatus;
  }
  const since = url.searchParams.get('changedSince');
  if (since) {
    const ms = Date.parse(since);
    if (Number.isNaN(ms)) return { status: 400, code: 'bad_request', error: 'changedSince must be an ISO date and time.' };
    filter.changedSince = new Date(ms).toISOString();
  }
  return filter;
}

async function voiceNote(request: Request, grant: Grant, languageId: string, deps: AgentDeps): Promise<Response> {
  if (!deps.saveVoiceNote) return fail(503, 'unavailable', 'File storage is not set up here.');
  const can = await deps.org(grant.orgId).read(grant, { op: 'can', languageId });
  if (!can.ok) return answer(can);
  if (!(can.data as { review: boolean }).review) return fail(403, 'scope', 'Voice notes go with reviews, and this token cannot record reviews in this language.');
  if (!(await deps.org(grant.orgId).spend(grant.tokenId))) return fail(429, 'rate_limited', 'This token has used its writes for this hour. Try again later.');
  const read = await readVoiceNote(request);
  if ('error' in read) return fail(read.status, 'bad_voice_note', read.error);
  const hash = await deps.saveVoiceNote(grant.orgId, languageId, read.bytes, read.note.format);
  // Send this object back as the review's voiceNote.
  return json(200, { voiceNote: { hash, ...read.note } });
}

// ---- the device flow (RFC 8628) ----------------------------------------------------

async function deviceRoute(request: Request, parts: string[], url: URL, deps: AgentDeps): Promise<Response> {
  if (request.method !== 'POST') return fail(405, 'method', 'Use POST.');
  if (deps.publicAllowed && !(await deps.publicAllowed(request, 'device'))) return json(429, { error: 'slow_down', error_description: 'Too many requests from this address. Wait a minute.' });
  const b = await body(request);
  if (!b) return fail(400, 'invalid_request', 'Send a JSON or form body.');
  const now = (deps.now ?? Date.now)();
  if (parts[0] === 'code' && parts.length === 1) {
    const clientName = String(b['clientName'] ?? b['client_name'] ?? b['client_id'] ?? '').trim();
    if (clientName.length < 1 || clientName.length > 120) return fail(400, 'invalid_request', 'clientName is required: what your app or agent is called (at most 120 characters).');
    const rawScopes = Array.isArray(b['scopes']) ? b['scopes'] : typeof b['scope'] === 'string' ? b['scope'].split(/\s+/).filter(Boolean) : ['read:published'];
    const scopes = parseScopes(rawScopes);
    if (!scopes) return fail(400, 'invalid_scope', `scopes is a list of ${SCOPES.join(', ')}.`);
    const orgId = typeof b['orgId'] === 'string' && b['orgId'] ? b['orgId'] : null;
    const deviceCode = newSecret();
    const userCode = newUserCode();
    await deps.store.insertGrant({
      deviceCodeHash: await hashSecret(deviceCode), userCode, clientName, requestedScopes: scopes, requestedOrgId: orgId,
      expiresAt: new Date(now + DEVICE_CODE_TTL_S * 1000).toISOString()
    });
    const verify = `${url.origin}/connect`;
    return json(200, {
      device_code: deviceCode, user_code: userCode, verification_uri: verify,
      verification_uri_complete: `${verify}?code=${encodeURIComponent(userCode)}`,
      expires_in: DEVICE_CODE_TTL_S, interval: POLL_INTERVAL_S,
      message: `Open ${verify}?code=${userCode}, sign in, and approve "${clientName}". Then poll POST ${url.origin}/api/v1/device/token with this device_code; once approved, the device_code is your access token.`
    });
  }
  if (parts[0] === 'token' && parts.length === 1) {
    const deviceCode = String(b['device_code'] ?? b['deviceCode'] ?? '');
    if (!deviceCode.startsWith(TOKEN_PREFIX)) return fail(400, 'invalid_request', 'device_code is required.');
    const grant = await deps.store.grantByDeviceHash(await hashSecret(deviceCode));
    // OAuth's error codes, so off-the-shelf device-flow clients understand them.
    if (!grant) return json(400, { error: 'invalid_grant', error_description: 'This device code is not known.' });
    if (grant.deniedAt) return json(400, { error: 'access_denied', error_description: 'The person declined.' });
    if (grant.approvedAt && grant.tokenId) {
      const token = await deps.store.tokenByHash(grant.deviceCodeHash);
      if (!token || token.revokedAt) return json(400, { error: 'access_denied', error_description: 'The token was revoked.' });
      return json(200, {
        access_token: deviceCode, token_type: 'Bearer', scope: token.scopes.join(' '),
        org_id: token.orgId, language_ids: token.languageIds, expires_at: token.expiresAt
      });
    }
    if (Date.parse(grant.expiresAt) <= now) return json(400, { error: 'expired_token', error_description: 'Nobody approved it in time. Ask for a new code.' });
    const tooSoon = grant.lastPolledAt && Date.parse(grant.lastPolledAt) > now - (POLL_INTERVAL_S - 1) * 1000;
    await deps.store.updateGrant(grant.id, { lastPolledAt: new Date(now).toISOString() });
    return json(400, tooSoon
      ? { error: 'slow_down', error_description: `Poll every ${POLL_INTERVAL_S} seconds.` }
      : { error: 'authorization_pending', error_description: 'Waiting for a person to approve it.' });
  }
  return fail(404, 'not_found', 'Not found.');
}

// ---- the signed-in routes, for the connect page -------------------------------------

async function sessionRoute(request: Request, parts: string[], url: URL, deps: AgentDeps): Promise<Response> {
  const jwt = bearer(request);
  const profileId = jwt && !jwt.startsWith(TOKEN_PREFIX) ? await deps.profileOf(jwt) : null;
  if (!profileId) return fail(401, 'sign_in', 'Sign in again.', false);
  const now = (deps.now ?? Date.now)();
  if (parts[0] === 'orgs' && parts.length === 1 && request.method === 'GET') return json(200, await accessOf(profileId, deps), false);
  if (parts[0] === 'review-links') return sessionLinks(request, parts.slice(1), url, profileId, deps);

  if (parts[0] === 'tokens') {
    if (parts.length === 1 && request.method === 'GET') {
      const orgs = await deps.store.orgsOf(profileId);
      const lists = await Promise.all(orgs.map((o) => deps.store.tokensOf(o, profileId)));
      return json(200, lists.flat().map(tokenOut), false);
    }
    if (parts.length === 1 && request.method === 'POST') {
      const b = await body(request);
      const spec = b ? await tokenSpec(b, profileId, deps, now) : { error: 'Send a JSON object.' };
      if ('error' in spec) return fail(400, 'bad_request', spec.error, false);
      const secret = newSecret();
      const token = await deps.store.insertToken({ ...spec, tokenHash: await hashSecret(secret), profileId, createdVia: 'page', clientName: null });
      return json(200, { token: secret, record: tokenOut(token) }, false);
    }
    if (parts.length === 3 && parts[2] === 'revoke' && request.method === 'POST') {
      return (await deps.store.revokeToken(parts[1]!, profileId)) ? json(200, { revoked: true }, false) : fail(404, 'not_found', 'There is no live token of yours with that id.', false);
    }
  }

  if (parts[0] === 'device' && parts.length === 2) {
    const code = normalizeUserCode(parts[1]!);
    const grant = code ? await deps.store.grantByUserCode(code) : null;
    if (!grant) return fail(404, 'no_code', 'There is no request with that code. Check it, or ask the app for a new one.', false);
    const expired = Date.parse(grant.expiresAt) <= now;
    const view = {
      userCode: grant.userCode, clientName: grant.clientName, requestedScopes: grant.requestedScopes, requestedOrgId: grant.requestedOrgId,
      createdAt: grant.createdAt, expiresAt: grant.expiresAt, state: grant.approvedAt ? 'approved' : grant.deniedAt ? 'denied' : expired ? 'expired' : 'pending'
    };
    if (request.method === 'GET') return json(200, view, false);
    if (request.method !== 'POST') return fail(405, 'method', 'Use GET or POST.', false);
    if (view.state !== 'pending') return fail(409, view.state, `This request is already ${view.state}.`, false);
    const b = await body(request);
    if (b?.['decision'] === 'deny') {
      if (!(await deps.store.decideGrant(grant.id, { deniedAt: new Date(now).toISOString() }))) return fail(409, 'decided', 'Someone already decided on this request.', false);
      return json(200, { ...view, state: 'denied' }, false);
    }
    if (b?.['decision'] !== 'approve') return fail(400, 'bad_request', 'decision is "approve" or "deny".', false);
    const spec = await tokenSpec({ name: grant.clientName, ...b }, profileId, deps, now);
    if ('error' in spec) return fail(400, 'bad_request', spec.error, false);
    // A person can narrow what the app asked for, never widen it.
    if (spec.scopes.some((s) => !grant.requestedScopes.includes(s))) return fail(400, 'bad_request', 'You can approve only scopes the app asked for.', false);
    const token = await deps.store.insertToken({ ...spec, tokenHash: grant.deviceCodeHash, profileId, createdVia: 'device', clientName: grant.clientName });
    if (!(await deps.store.decideGrant(grant.id, { approvedAt: new Date(now).toISOString(), tokenId: token.id }))) {
      // Denied (or approved elsewhere) while this was on its way: the token must not outlive that.
      await deps.store.revokeToken(token.id, profileId);
      return fail(409, 'decided', 'Someone already decided on this request.', false);
    }
    return json(200, { ...view, state: 'approved', record: tokenOut(token) }, false);
  }
  return fail(404, 'not_found', 'Not found.', false);
}

async function accessOf(profileId: string, deps: AgentDeps): Promise<OrgAccess[]> {
  const orgs = await deps.store.orgsOf(profileId);
  const out = await Promise.all(orgs.map((o) => deps.org(o).access(profileId)));
  return out.filter((a): a is OrgAccess => a !== null && a.languages.length > 0);
}

interface TokenSpec {
  orgId: string;
  name: string;
  scopes: Scope[];
  languageIds: string[] | null;
  expiresAt: string | null;
}

/** What a person asked for, checked against what they can do in the organization today. */
async function tokenSpec(b: Record<string, unknown>, profileId: string, deps: AgentDeps, now: number): Promise<TokenSpec | { error: string }> {
  const orgId = typeof b['orgId'] === 'string' ? b['orgId'] : '';
  const name = typeof b['name'] === 'string' ? b['name'].trim() : '';
  if (name.length < 1 || name.length > 120) return { error: 'Give the token a name (at most 120 characters), such as the app it is for.' };
  const scopes = parseScopes(b['scopes']);
  if (!scopes) return { error: `Choose at least one of ${SCOPES.join(', ')}.` };
  // Membership first, so nobody can wake an organization's object by naming it.
  const access = orgId && (await deps.store.orgsOf(profileId)).includes(orgId) ? await deps.org(orgId).access(profileId) : null;
  if (!access || access.languages.length === 0) return { error: 'You are not in that organization, or you can see none of its languages.' };
  let languageIds: string[] | null = null;
  if (b['languageIds'] !== undefined && b['languageIds'] !== null) {
    const ids = b['languageIds'];
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((i) => typeof i === 'string')) return { error: 'languageIds is a list of language ids, or null for all of them.' };
    const known = new Set(access.languages.map((l) => l.languageId));
    if (!ids.every((i) => known.has(i as string))) return { error: 'You can only give a token languages you can see.' };
    languageIds = [...new Set(ids as string[])].sort();
  }
  const reach = access.languages.filter((l) => languageIds === null || languageIds.includes(l.languageId));
  if (scopes.includes('review') && !reach.some((l) => l.mayReview)) {
    return { error: 'The review scope records reviews as you, and you cannot review or translate in any of these languages.' };
  }
  let expiresAt: string | null = null;
  if (b['expiresInDays'] !== undefined && b['expiresInDays'] !== null) {
    const days = Number(b['expiresInDays']);
    if (!Number.isInteger(days) || days < 1 || days > 3650) return { error: 'expiresInDays is a whole number from 1 to 3650, or null for never.' };
    expiresAt = new Date(now + days * 86_400_000).toISOString();
  }
  return { orgId, name, scopes, languageIds, expiresAt };
}
