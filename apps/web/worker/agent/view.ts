import {
  approvedVersion, buildIndexes, derivePassage, encodeHlc, kindOf, languageInfo, LISTENER_KIND, mayViewLanguage, orgLanguages, passageWork,
  privilegesFor, PUBLICATION_KIND, publicationOf, referencedBlobs, stateRevision, validateEvent,
  type AnyEvent, type Card, type LanguageState, type OrgState, type PassageState, type Version
} from '@langquest-next/core';
import { canRead, coversLanguage, sha256Hex, type Grant } from './tokens';

/**
 * What a token may see and write, read from the same folded state the
 * dashboard reports come from (decision 44). Pure apart from hashing and
 * the link signer it is handed, so tests drive it with an in-memory log.
 */

export type ApiStatus = 'not_started' | 'drafting' | 'in_review' | 'feedback' | 'approved';

export interface LanguageView {
  languageId: string;
  name: string;
  code: string;
  country: string | null;
  /** What this token can do here, given its scopes and the person's privileges today. */
  can: { read: 'all' | 'published' | null; feedback: boolean; publish: boolean };
}

export interface PassageSummary {
  unitId: string;
  label: string;
  /** Labels of the units that hold it, outermost first ("Genesis", "Chapter 1"). */
  path: string[];
  status: ApiStatus;
  /**
   * The version this token hears: the latest shared for review with `read`,
   * the approved one with `read:published` alone. Null when there is none.
   */
  version: { n: number; takeId: string; submittedAt: string; durationMs: number } | null;
  /** The newest version every step approved on its own (core approvedVersion); what a listening app should play. */
  approvedVersion: { n: number; takeId: string } | null;
  publication: { ready: boolean; versionN: number; decidedAt: string; note?: string } | null;
  /** Listener feedback on `version`. */
  listenerFeedback: { looksGood: number; needsChanges: number };
  /** The newest thing that happened to the passage's versions or reviews. */
  updatedAt: string | null;
}

export interface AudioCard {
  hash: string;
  format: 'wav' | 'm4a';
  durationMs: number;
  /** Plays without a token until `expiresAt` (Range supported); ask for the passage again for a fresh one. */
  url: string;
  expiresAt: string;
}

export interface ReviewOut {
  kindId: string;
  kind: string;
  outcome: 'looks_good' | 'needs_changes' | 'recorded';
  via: 'app' | 'link' | 'logged';
  versionN: number;
  at: string;
  comment?: string;
  givenBy?: string;
  voiceNote?: { url: string; expiresAt: string };
}

export interface PassageDetail extends PassageSummary {
  /** `version`'s cards, in playing order. Empty when there is none. */
  audio: AudioCard[];
  /** With `read`: every review of every version. With `read:published` only: listener and publication reviews. */
  reviews: ReviewOut[];
  /** With `read`: the language's flow and where the passage is in it. */
  steps?: { name: string; complete: boolean }[];
  versions?: { n: number; takeId: string; submittedAt: string }[];
}

export interface Refusal {
  status: number;
  code: string;
  error: string;
}

export const isRefusal = (x: unknown): x is Refusal => typeof x === 'object' && x !== null && 'code' in x && 'status' in x;

/** Signs a read link for an object key; the Worker's own `readPath`, absolute. */
export type Signer = (key: string) => Promise<{ url: string; expiresAt: number }>;

const wallOf = (hlc: string): number => Number(hlc.slice(0, hlc.indexOf(':')));
const iso = (hlc: string) => new Date(wallOf(hlc)).toISOString();

const refuse = (status: number, code: string, error: string): Refusal => ({ status, code, error });

/** The languages this token reaches: covered by it, and viewable by its person today. */
export function languagesFor(grant: Grant, org: OrgState): LanguageView[] {
  return orgLanguages(org)
    .filter((l) => coversLanguage(grant, l.languageId) && mayViewLanguage(org, grant.profileId, l.languageId))
    .map((l) => ({ languageId: l.languageId, name: l.name, code: l.code, country: l.country, can: abilities(grant, org, l.languageId) }));
}

function abilities(grant: Grant, org: OrgState, languageId: string): LanguageView['can'] {
  const reviews = privilegesFor(org, grant.profileId, languageId).has('review');
  return {
    read: canRead(grant, true) ? 'all' : canRead(grant) ? 'published' : null,
    feedback: reviews && grant.scopes.includes('feedback'),
    publish: reviews && grant.scopes.includes('publish')
  };
}

/** Null when the token may not open this language; otherwise what it may do there. */
export function languageAccess(grant: Grant, org: OrgState, languageId: string): LanguageView['can'] | null {
  if (!languageInfo(org, languageId) || !coversLanguage(grant, languageId) || !mayViewLanguage(org, grant.profileId, languageId)) return null;
  return abilities(grant, org, languageId);
}

const cardsCache = new WeakMap<LanguageState, { revision: number; cards: Map<string, Card> }>();

/** Every target card by hash, for durations and formats. */
function cardsOf(state: LanguageState): Map<string, Card> {
  const revision = stateRevision(state);
  const hit = cardsCache.get(state);
  if (hit && hit.revision === revision) return hit.cards;
  const cards = new Map<string, Card>();
  for (const r of Object.values(state.recordings)) for (const c of r.cards) if (!cards.has(c.hash)) cards.set(c.hash, c);
  cardsCache.set(state, { revision, cards });
  return cards;
}

function pathOf(state: LanguageState, unitId: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let parent = state.units[unitId]?.parentUnitId ?? null;
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const u = state.units[parent];
    if (!u) break;
    out.unshift(u.label);
    parent = u.parentUnitId;
  }
  return out;
}

const statusOf = (s: PassageState): ApiStatus => {
  const w = passageWork(s);
  return w === 'done' ? 'approved' : w;
};

/** The version a token hears: the approved one for a published-only token, else the latest. */
const heard = (grant: Grant, s: PassageState): Version | null => (canRead(grant, true) ? s.latest ?? null : approvedVersion(s));

function summarize(grant: Grant, state: LanguageState, s: PassageState): PassageSummary {
  const cards = cardsOf(state);
  const v = heard(grant, s);
  const approved = approvedVersion(s);
  const onVersion = v ? s.reviews.filter((r) => r.takeId === v.takeId && r.kindId === LISTENER_KIND) : [];
  const pub = publicationOf(s);
  let newest: string | null = s.latest?.hlc ?? null;
  for (const r of s.reviews) if (!newest || r.hlc > newest) newest = r.hlc;
  return {
    unitId: s.unitId,
    label: state.units[s.unitId]?.label ?? s.unitId,
    path: pathOf(state, s.unitId),
    status: statusOf(s),
    version: v
      ? { n: v.n, takeId: v.takeId, submittedAt: iso(v.hlc), durationMs: v.cardHashes.reduce((t, h) => t + (cards.get(h)?.durationMs ?? 0), 0) }
      : null,
    approvedVersion: approved ? { n: approved.n, takeId: approved.takeId } : null,
    publication: pub ? { ready: pub.ready, versionN: pub.versionN, decidedAt: iso(pub.hlc), ...(pub.note !== undefined ? { note: pub.note } : {}) } : null,
    listenerFeedback: {
      looksGood: onVersion.filter((r) => r.outcome === 'looks_good').length,
      needsChanges: onVersion.filter((r) => r.outcome === 'needs_changes').length
    },
    updatedAt: newest ? iso(newest) : null
  };
}

/** A token with only `read:published` sees passages with an approved version, and only that version. */
const visible = (grant: Grant, s: PassageState) => canRead(grant, true) || (canRead(grant) && approvedVersion(s) !== null);

export interface PassageFilter {
  status?: ApiStatus;
  /** Only passages that became ready for publication (true) or are not (false). */
  ready?: boolean;
  /** ISO time: only passages with something newer than it. */
  changedSince?: string;
}

export function passagesFor(grant: Grant, state: LanguageState, filter: PassageFilter = {}): PassageSummary[] {
  const idx = buildIndexes(state);
  const out: PassageSummary[] = [];
  for (const unitId of idx.passages) {
    const s = derivePassage(state, unitId, idx);
    if (!visible(grant, s)) continue;
    const sum = summarize(grant, state, s);
    if (filter.status && sum.status !== filter.status) continue;
    if (filter.ready !== undefined && (sum.publication?.ready ?? false) !== filter.ready) continue;
    if (filter.changedSince && (!sum.updatedAt || sum.updatedAt <= filter.changedSince)) continue;
    out.push(sum);
  }
  return out;
}

export async function passageFor(
  grant: Grant, orgId: string, languageId: string, state: LanguageState, unitId: string, sign: Signer
): Promise<PassageDetail | Refusal> {
  const idx = buildIndexes(state);
  if (!idx.passages.includes(unitId)) return refuse(404, 'no_passage', 'There is no passage with that id in this language.');
  const s = derivePassage(state, unitId, idx);
  if (!visible(grant, s)) return refuse(404, 'no_passage', 'There is no approved passage with that id in this language.');
  const all = canRead(grant, true);
  const cards = cardsOf(state);
  const key = (hash: string, format: string) => `${orgId}/${languageId}/${hash}.${format}`;
  const audio: AudioCard[] = [];
  const v = heard(grant, s);
  for (const hash of v?.cardHashes ?? []) {
    const card = cards.get(hash);
    const format = card?.format ?? 'wav';
    const link = await sign(key(hash, format));
    audio.push({ hash, format, durationMs: card?.durationMs ?? 0, url: link.url, expiresAt: new Date(link.expiresAt).toISOString() });
  }
  const reviews: ReviewOut[] = [];
  for (const r of s.reviews) {
    if (!all && ((r.kindId !== LISTENER_KIND && r.kindId !== PUBLICATION_KIND) || r.takeId !== v?.takeId)) continue;
    const out: ReviewOut = { kindId: r.kindId, kind: kindOf(state, r.kindId).name, outcome: r.outcome, via: r.via, versionN: r.versionN, at: iso(r.hlc) };
    if (r.comment !== undefined) out.comment = r.comment;
    if (r.givenBy !== undefined) out.givenBy = r.givenBy;
    if (r.commentBlobHash) {
      const link = await sign(key(r.commentBlobHash, 'm4a'));
      out.voiceNote = { url: link.url, expiresAt: new Date(link.expiresAt).toISOString() };
    }
    reviews.push(out);
  }
  const detail: PassageDetail = { ...summarize(grant, state, s), audio, reviews };
  if (all) {
    detail.steps = s.steps.map((st) => ({ name: st.step.kindIds.map((k) => kindOf(state, k).name).join(' + '), complete: st.complete }));
    detail.versions = s.versions.map((v) => ({ n: v.n, takeId: v.takeId, submittedAt: iso(v.hlc) }));
  }
  return detail;
}

// ---- writes ------------------------------------------------------------------------

export interface FeedbackInput {
  /** The version heard; the latest when left out. */
  takeId?: string;
  outcome: 'looks_good' | 'needs_changes';
  comment?: string;
  /** The listening app's own id for the person or device. One answer per listener, version and outcome (or feedbackId). */
  listenerId: string;
  /** Shown to the team as who gave it. */
  listenerName?: string;
  /** A voice note uploaded with PUT /api/v1/languages/:id/voice-notes. */
  voiceNoteHash?: string;
  /** Lets one listener leave more than one comment on a version. */
  feedbackId?: string;
}

export interface PublicationInput {
  /** The version decided on; must be the approved one (core approvedVersion), which it defaults to. */
  takeId?: string;
  ready: boolean;
  note?: string;
}

interface WriteContext {
  grant: Grant;
  org: OrgState;
  state: LanguageState;
  languageId: string;
  unitId: string;
  now: number;
}

const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const optStr = (v: unknown, max: number) => v === undefined || str(v, max);

export function parseFeedback(body: unknown): FeedbackInput | Refusal {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b['outcome'] !== 'looks_good' && b['outcome'] !== 'needs_changes') return refuse(400, 'bad_request', 'outcome must be "looks_good" or "needs_changes".');
  if (!str(b['listenerId'], 200)) return refuse(400, 'bad_request', 'listenerId is required: your app\'s id for the listener or device (at most 200 characters).');
  if (!optStr(b['takeId'], 200) || !optStr(b['comment'], 4000) || !optStr(b['listenerName'], 120) || !optStr(b['feedbackId'], 64)) {
    return refuse(400, 'bad_request', 'takeId, comment (4000), listenerName (120) and feedbackId (64) must be non-empty text within those lengths.');
  }
  if (b['voiceNoteHash'] !== undefined && !(typeof b['voiceNoteHash'] === 'string' && /^[0-9a-f]{64}$/.test(b['voiceNoteHash']))) {
    return refuse(400, 'bad_request', 'voiceNoteHash must be the hash returned when the voice note was uploaded.');
  }
  return {
    outcome: b['outcome'], listenerId: b['listenerId'] as string,
    ...(b['takeId'] !== undefined ? { takeId: b['takeId'] as string } : {}),
    ...(b['comment'] !== undefined ? { comment: b['comment'] as string } : {}),
    ...(b['listenerName'] !== undefined ? { listenerName: b['listenerName'] as string } : {}),
    ...(b['voiceNoteHash'] !== undefined ? { voiceNoteHash: b['voiceNoteHash'] as string } : {}),
    ...(b['feedbackId'] !== undefined ? { feedbackId: b['feedbackId'] as string } : {})
  };
}

export function parsePublication(body: unknown): PublicationInput | Refusal {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b['ready'] !== 'boolean') return refuse(400, 'bad_request', 'ready must be true or false.');
  if (!optStr(b['takeId'], 200) || !optStr(b['note'], 4000)) return refuse(400, 'bad_request', 'takeId and note (4000) must be non-empty text.');
  if (b['ready'] === false && b['note'] === undefined) return refuse(400, 'bad_request', 'Say why in note when taking readiness back; the team sees it as feedback.');
  return { ready: b['ready'], ...(b['takeId'] !== undefined ? { takeId: b['takeId'] as string } : {}), ...(b['note'] !== undefined ? { note: b['note'] as string } : {}) };
}

/** The passage and version a write is about, after the checks every write shares. */
function target(ctx: WriteContext, scope: 'feedback' | 'publish', takeId: string | undefined): { s: PassageState; takeId: string } | Refusal {
  const { grant, org, state, languageId, unitId } = ctx;
  if (!grant.scopes.includes(scope)) return refuse(403, 'scope', `This token was not given the "${scope}" scope.`);
  const can = languageAccess(grant, org, languageId);
  if (!can) return refuse(404, 'no_language', 'This token cannot open that language.');
  if (!(scope === 'feedback' ? can.feedback : can.publish)) {
    return refuse(403, 'privilege', 'The account behind this token cannot review in this language. Ask a coordinator to give it a role that reviews.');
  }
  const idx = buildIndexes(state);
  if (!idx.passages.includes(unitId)) return refuse(404, 'no_passage', 'There is no passage with that id in this language.');
  const s = derivePassage(state, unitId, idx);
  // What a token cannot read, it cannot answer either: a published-only token hears the approved version.
  const own = heard(grant, s);
  if (!own) return refuse(canRead(grant, true) ? 409 : 404, canRead(grant, true) ? 'no_version' : 'no_passage', canRead(grant, true) ? 'This passage has no version shared for review yet.' : 'There is no approved passage with that id in this language.');
  const id = takeId ?? own.takeId;
  if (!s.versions.some((v) => v.takeId === id)) return refuse(404, 'no_version', 'That takeId is not a version of this passage.');
  if (!canRead(grant, true) && id !== own.takeId) return refuse(404, 'no_version', 'This token hears only the approved version.');
  return { s, takeId: id };
}

function envelope(ctx: WriteContext, reviewId: string, payload: Record<string, unknown>): AnyEvent {
  // A device of its own per token: the team can tell what came through it, and its clock never mixes with a phone's.
  const deviceId = `api-${ctx.grant.tokenId}`;
  return {
    id: `api-${reviewId}`, type: 'v1.ReviewRecorded', orgId: ctx.grant.orgId, streamId: ctx.languageId,
    actorId: ctx.grant.profileId, deviceId, hlc: encodeHlc(ctx.now, 0, deviceId),
    payload: { reviewId, ...payload }
  } as AnyEvent;
}

function checked(event: AnyEvent): AnyEvent | Refusal {
  const invalid = validateEvent(event);
  return invalid ? refuse(400, 'invalid', invalid) : event;
}

/**
 * Listener feedback as a review of the `listener` kind, given by link. Its id
 * comes from the token, the version, the listener and the outcome (or
 * feedbackId), so a listener tapping twice, or an app retrying, records it
 * once, and one listener cannot pile up answers on one version.
 */
export async function feedbackEvent(ctx: WriteContext, input: FeedbackInput): Promise<AnyEvent | Refusal> {
  const t = target(ctx, 'feedback', input.takeId);
  if (isRefusal(t)) return t;
  // A voice note is new audio from this upload; naming a card or note already in the language would hand out a link to it.
  if (input.voiceNoteHash && referencedBlobs(ctx.state).has(input.voiceNoteHash)) {
    return refuse(400, 'bad_request', 'voiceNoteHash must be a voice note you just uploaded.');
  }
  // Only a hash of the app's listener id reaches the log.
  const listener = (await sha256Hex(`${ctx.grant.tokenId}\n${input.listenerId}`)).slice(0, 16);
  const reviewId = `${LISTENER_KIND}-${(await sha256Hex([ctx.grant.tokenId, t.takeId, listener, input.feedbackId ?? input.outcome].join('\n'))).slice(0, 32)}`;
  return checked(envelope(ctx, reviewId, {
    takeId: t.takeId, kindId: LISTENER_KIND, outcome: input.outcome, via: 'link', people: 1,
    givenBy: input.listenerName?.trim() || `Listener ${listener.slice(0, 6)}`,
    ...(input.comment !== undefined ? { comment: input.comment } : {}),
    ...(input.voiceNoteHash !== undefined ? { commentBlobHash: input.voiceNoteHash } : {})
  }));
}

/** Ready for publication, or taken back, as a review of the `publication` kind on the approved latest version. */
export async function publicationEvent(ctx: WriteContext, input: PublicationInput): Promise<AnyEvent | Refusal> {
  const approved = approvedVersion(derivePassage(ctx.state, ctx.unitId));
  const t = target(ctx, 'publish', input.takeId ?? approved?.takeId);
  if (isRefusal(t)) return t;
  if (!approved) return refuse(409, 'not_approved', 'Only a version every step approved can be marked ready for publication.');
  if (t.takeId !== approved.takeId) return refuse(409, 'not_approved', `Readiness is decided on the approved version, ${approved.n}.`);
  const reviewId = `${PUBLICATION_KIND}-${(await sha256Hex([ctx.grant.tokenId, t.takeId, String(input.ready), String(ctx.now)].join('\n'))).slice(0, 32)}`;
  return checked(envelope(ctx, reviewId, {
    takeId: t.takeId, kindId: PUBLICATION_KIND, outcome: input.ready ? 'looks_good' : 'needs_changes', via: 'link',
    ...(input.note !== undefined ? { comment: input.note } : {})
  }));
}
