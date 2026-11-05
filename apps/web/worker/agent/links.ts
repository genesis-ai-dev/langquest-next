import { answer, body, fail, json, type AgentDeps } from './http';
import type { TokenRecord } from './store';
import { coversLanguage, hashSecret, newLinkCode, type Grant } from './tokens';
import { isRefusal, LINK_MAX_OPEN, LINK_MAX_REVIEWS, parseLinkReview, type LinkSpec, type ReviewLink } from './view';
import { readVoiceNote } from './voice';

/**
 * Review links (decisions.md 72): someone who may send work to reviewers
 * shares a link, on WhatsApp say, and anyone holding it hears one version
 * and answers for one kind with any name, on `/r/<code>` (reviewPage.ts).
 * The code is the only credential, so it is long and random, only its hash
 * is kept, and it expires.
 *
 *   POST /api/v1/session/review-links             make one (the app, signed in)
 *   GET  /api/v1/session/review-links?orgId&languageId&unitId   a passage's links
 *   POST /api/v1/session/review-links/:id/revoke  (its sharer, or whoever assigns work in the language)
 *   POST /api/v1/review-links                     make one with a token (read + review scopes)
 *   GET  /api/v1/links/:code                      what the page shows
 *   PUT  /api/v1/links/:code/voice-note           a voice note (m4a or WAV)
 *   POST /api/v1/links/:code/reviews              the answer
 */

/** How long a link lasts unless the sharer says otherwise, and at most. */
export const LINK_DAYS = 14;
export const LINK_MAX_DAYS = 90;

export const linkOut = (l: ReviewLink, origin?: string, code?: string) => ({
  id: l.id, languageId: l.languageId, unitId: l.unitId, takeId: l.takeId, kindId: l.kindId, counts: l.counts, label: l.label,
  createdBy: l.createdBy, createdAt: l.createdAt, expiresAt: l.expiresAt, revokedAt: l.revokedAt,
  ...(origin && code ? { url: `${origin}/r/${code}` } : {})
});

/** Made with a token: the link closes when the token is revoked, and lasts no longer than it does. */
interface ViaToken {
  tokenId: string;
  expiresAt: string | null;
}

async function createLink(
  b: Record<string, unknown>, url: URL, profileId: string, orgId: string, deps: AgentDeps, cors: boolean,
  mayUse: (languageId: string) => boolean, via: ViaToken | null = null
): Promise<Response> {
  const text = (k: string, max: number) => (typeof b[k] === 'string' && b[k].trim() && (b[k] as string).length <= max ? (b[k] as string).trim() : null);
  const languageId = text('languageId', 200);
  const unitId = text('unitId', 400);
  const kindId = text('kindId', 100);
  if (!languageId || !unitId || !kindId) return fail(400, 'bad_request', 'languageId, unitId and kindId are required.', cors);
  if (typeof b['counts'] !== 'boolean') return fail(400, 'bad_request', 'counts says whether reviews through the link count toward the step (true) or are feedback (false).', cors);
  if (b['takeId'] !== undefined && !text('takeId', 200)) return fail(400, 'bad_request', 'takeId must be a version id.', cors);
  if (b['label'] !== undefined && !text('label', 120)) return fail(400, 'bad_request', 'label is at most 120 characters, such as who it is for.', cors);
  const days = b['expiresInDays'] === undefined ? LINK_DAYS : Number(b['expiresInDays']);
  if (!Number.isInteger(days) || days < 1 || days > LINK_MAX_DAYS) return fail(400, 'bad_request', `expiresInDays is a whole number from 1 to ${LINK_MAX_DAYS}.`, cors);
  if (!mayUse(languageId)) return fail(404, 'no_language', 'You cannot open that language.', cors);
  const spec: LinkSpec = {
    languageId, unitId, kindId, counts: b['counts'],
    ...(b['takeId'] !== undefined ? { takeId: text('takeId', 200)! } : {}), ...(b['label'] !== undefined ? { label: text('label', 120)! } : {})
  };
  const checked = await deps.org(orgId).checkLink(profileId, spec);
  if (!checked.ok) return answer(checked, cors);
  const now = (deps.now ?? Date.now)();
  if ((await deps.store.openLinkCount(orgId, profileId, new Date(now).toISOString())) >= LINK_MAX_OPEN) {
    return fail(429, 'too_many_links', `You have ${LINK_MAX_OPEN} open review links in this organization. Revoke some, or wait for them to expire.`, cors);
  }
  if (via && !(await deps.org(orgId).spendWrite(via.tokenId))) return fail(429, 'rate_limited', 'This token has used its writes for this hour. Try again later.', cors);
  const code = newLinkCode();
  const until = Math.min(now + days * 86_400_000, via?.expiresAt ? Date.parse(via.expiresAt) : Infinity);
  const link = await deps.store.insertLink({
    codeHash: await hashSecret(code), orgId, languageId, unitId, takeId: checked.data.takeId, kindId, counts: spec.counts,
    label: spec.label ?? null, createdBy: profileId, tokenId: via?.tokenId ?? null, expiresAt: new Date(until).toISOString()
  });
  return json(200, linkOut(link, url.origin, code), cors);
}

export async function sessionLinks(request: Request, parts: string[], url: URL, profileId: string, deps: AgentDeps): Promise<Response> {
  if (parts.length === 0 && request.method === 'POST') {
    const b = await body(request);
    if (!b) return fail(400, 'bad_request', 'Send a JSON object.', false);
    const orgId = typeof b['orgId'] === 'string' ? b['orgId'] : '';
    if (!orgId || !(await deps.store.orgsOf(profileId)).includes(orgId)) return fail(404, 'no_org', 'You are not in that organization.', false);
    return createLink(b, url, profileId, orgId, deps, false, () => true);
  }
  if (parts.length === 0 && request.method === 'GET') {
    const [orgId, languageId, unitId] = ['orgId', 'languageId', 'unitId'].map((k) => url.searchParams.get(k) ?? '');
    if (!orgId || !languageId || !unitId) return fail(400, 'bad_request', 'orgId, languageId and unitId are required.', false);
    // Membership first, so nobody can wake an organization's object by naming it.
    const access = (await deps.store.orgsOf(profileId)).includes(orgId) ? await deps.org(orgId).access(profileId) : null;
    if (!access?.languages.some((l) => l.languageId === languageId)) return fail(404, 'no_language', 'You cannot open that language.', false);
    return json(200, (await deps.store.linksOf(orgId, languageId, unitId)).map((l) => linkOut(l)), false);
  }
  if (parts.length === 2 && parts[1] === 'revoke' && request.method === 'POST') {
    // Its sharer, or whoever assigns work in its language, may take a link back.
    const link = /^[0-9a-f-]{36}$/i.test(parts[0]!) ? await deps.store.linkById(parts[0]!) : null;
    const mine = link?.createdBy === profileId;
    const may = !!link && !link.revokedAt && (mine
      || ((await deps.store.orgsOf(profileId)).includes(link.orgId) && (await deps.org(link.orgId).mayRevokeLink(profileId, link))));
    if (!link || !may) return fail(404, 'not_found', 'There is no open link with that id that you may revoke.', false);
    return (await deps.store.revokeLink(link.id)) ? json(200, { revoked: true }, false) : fail(404, 'not_found', 'That link is already closed.', false);
  }
  return fail(404, 'not_found', 'Not found.', false);
}

/**
 * An app or agent shares a link as the token's person: it needs to read
 * every version (read) and record reviews (review). The link belongs to the
 * token as well, so revoking the token closes it.
 */
export async function tokenLinks(request: Request, parts: string[], url: URL, grant: Grant, token: Pick<TokenRecord, 'expiresAt'>, deps: AgentDeps): Promise<Response> {
  if (parts.length !== 0 || request.method !== 'POST') return fail(404, 'not_found', 'Not found.');
  if (!grant.scopes.includes('read') || !grant.scopes.includes('review')) return fail(403, 'scope', 'Sharing a review link needs the read and review scopes.');
  const b = await body(request);
  if (!b) return fail(400, 'bad_request', 'Send a JSON object.');
  return createLink(b, url, grant.profileId, grant.orgId, deps, true, (languageId) => coversLanguage(grant, languageId),
    { tokenId: grant.tokenId, expiresAt: token.expiresAt });
}

/** What anyone holding a link may do with it. No CORS: only the page on this origin calls these. */
export async function handlePublicLink(request: Request, parts: string[], deps: AgentDeps): Promise<Response> {
  const code = parts[0];
  if (!code || !/^[A-Za-z0-9_-]{22}$/.test(code) || parts.length > 2) return fail(404, 'no_link', 'This review link is not known.', false);
  if (deps.publicAllowed && !(await deps.publicAllowed(request, 'link'))) return fail(429, 'rate_limited', 'Too many requests. Wait a minute and try again.', false);
  const link = await deps.store.linkByCodeHash(await hashSecret(code));
  if (!link) return fail(404, 'no_link', 'This review link is not known. Check it was copied whole.', false);
  const org = deps.org(link.orgId);
  // Closed when revoked or expired, and when its sharer can no longer record (decisions.md 75).
  // A closed link says only that: not who it was for, nor the passage, language or kind.
  if (!(await org.linkOpen(link))) return fail(410, 'closed', 'This review link has closed. Ask whoever sent it for a new one.', false);
  if (parts.length === 1 && request.method === 'GET') return answer(await org.linkInfo(link), false);
  if (parts[1] === 'voice-note' && request.method === 'PUT') {
    if (!deps.saveVoiceNote) return fail(503, 'unavailable', 'Voice notes cannot be kept here just now. Write your comment instead.', false);
    if (!(await org.spend(`link:${link.id}`))) return fail(429, 'rate_limited', 'This review link is busy. Try again in a while.', false);
    const read = await readVoiceNote(request);
    if ('error' in read) return fail(read.status, 'bad_voice_note', read.error, false);
    const hash = await deps.saveVoiceNote(link.orgId, link.languageId, read.bytes, read.note.format);
    return json(200, { voiceNote: { hash, ...read.note } }, false);
  }
  if (parts[1] === 'reviews' && request.method === 'POST') {
    const input = parseLinkReview(await body(request));
    if (isRefusal(input)) return fail(input.status, input.code, input.error, false);
    return answer(await org.linkReview(link, input), false);
  }
  return fail(405, 'method', `Not here. A link takes at most ${LINK_MAX_REVIEWS} reviews.`, false);
}
