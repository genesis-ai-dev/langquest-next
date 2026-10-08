import {
  approvedVersion, buildIndexes, derivePassage, encodeHlc, kindOf, languageInfo, LISTENER_KIND, mayViewLanguage, orgLanguages, passageWork,
  privilegesFor, referencedBlobs, releasesOf, stateRevision, stepAllowsLinks, validateEvent,
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
  can: { read: 'all' | 'published' | null; review: boolean; release: boolean };
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
  /** Where a version is live, one entry per channel (core releasesOf). */
  releases: { channel: string; versionN: number; takeId: string; url?: string; at: string }[];
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
  /** Voice notes, each with where in the version it is about (`atMs`) when the reviewer said. */
  voiceNotes?: { url: string; expiresAt: string; durationMs: number; atMs?: number }[];
}

export interface PassageDetail extends PassageSummary {
  /** `version`'s cards, in playing order. Empty when there is none. */
  audio: AudioCard[];
  /** With `read`: every review of every version. With `read:published` only: listener reviews of `version`. */
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
  const privs = privilegesFor(org, grant.profileId, languageId);
  return {
    read: canRead(grant, true) ? 'all' : canRead(grant) ? 'published' : null,
    // Recorded like a check logged from outside the app: review or translate (core privilegeFor, via link).
    review: (privs.has('review') || privs.has('translate')) && grant.scopes.includes('review'),
    release: privs.has('assign_work') && grant.scopes.includes('release')
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
  const releases = releasesOf(state, s);
  let newest: string | null = s.latest?.hlc ?? null;
  for (const r of s.reviews) if (!newest || r.hlc > newest) newest = r.hlc;
  // A take-down leaves no release behind, so every report on any version counts as a change.
  for (const v of s.versions) for (const reg of Object.values(state.releases?.[v.takeId] ?? {})) if (!newest || reg.hlc > newest) newest = reg.hlc;
  return {
    unitId: s.unitId,
    label: state.units[s.unitId]?.label ?? s.unitId,
    path: pathOf(state, s.unitId),
    status: statusOf(s),
    version: v
      ? { n: v.n, takeId: v.takeId, submittedAt: iso(v.hlc), durationMs: v.cardHashes.reduce((t, h) => t + (cards.get(h)?.durationMs ?? 0), 0) }
      : null,
    approvedVersion: approved ? { n: approved.n, takeId: approved.takeId } : null,
    releases: releases.map((r) => ({ channel: r.channel, versionN: r.versionN, takeId: r.takeId, at: iso(r.hlc), ...(r.url !== undefined ? { url: r.url } : {}) })),
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
    if (!all && (r.kindId !== LISTENER_KIND || r.takeId !== v?.takeId)) continue;
    const out: ReviewOut = { kindId: r.kindId, kind: kindOf(state, r.kindId).name, outcome: r.outcome, via: r.via, versionN: r.versionN, at: iso(r.hlc) };
    if (r.comment !== undefined) out.comment = r.comment;
    if (r.givenBy !== undefined) out.givenBy = r.givenBy;
    // Voice notes: one in commentBlobHash (the app's; m4a unless the log says otherwise, decisions.md 73), and
    // clips among the artifacts (from outside; for a kind that makes content, the artifacts are that content, not notes).
    const notes: Card[] = [
      ...(r.commentBlobHash ? [{ hash: r.commentBlobHash, durationMs: 0, format: state.audioFormats[r.commentBlobHash]?.value ?? 'm4a' }] : []),
      ...(r.outcome !== 'recorded' ? r.artifacts ?? [] : [])
    ];
    if (notes.length) {
      out.voiceNotes = [];
      for (const n of notes) {
        const link = await sign(key(n.hash, n.format ?? 'wav'));
        out.voiceNotes.push({ url: link.url, expiresAt: new Date(link.expiresAt).toISOString(), durationMs: n.durationMs, ...(n.atMs !== undefined ? { atMs: n.atMs } : {}) });
      }
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

/** A voice note just uploaded (PUT …/voice-notes): AAC in MP4, or WAV from a browser that cannot record MP4. */
export interface VoiceNote {
  hash: string;
  format: 'm4a' | 'wav';
  durationMs: number;
  /** Where in the version it is about, ms from the start; absent for the whole version. */
  atMs?: number;
}

/** Clips one review may carry: enough for a careful listener, not a channel for files. */
export const MAX_VOICE_NOTES = 10;

export interface ReviewInput {
  /** A kind in the language's flow, or `listener` (the default): feedback that never clears a step. */
  kindId?: string;
  outcome: 'looks_good' | 'needs_changes';
  comment?: string;
  voiceNotes?: VoiceNote[];
  /** The caller's own id for whoever gave it (a listener, a device). Only a hash reaches the log. */
  reviewerId: string;
  /** Shown to the team as who gave it. */
  reviewerName?: string;
  /** The version heard; the token's `version` when left out. */
  takeId?: string;
  /** Separates one reviewer's answers to one version; without it, one answer per reviewer, version, kind and outcome. */
  submissionId?: string;
}

export interface ReleaseInput {
  /** The version; the approved one when left out. */
  takeId?: string;
  channel: string;
  live: boolean;
  url?: string;
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

function parseVoiceNote(v: unknown): VoiceNote | null {
  const o = (v ?? {}) as Record<string, unknown>;
  if (typeof o['hash'] !== 'string' || !/^[0-9a-f]{64}$/.test(o['hash']) || (o['format'] !== 'm4a' && o['format'] !== 'wav')) return null;
  if (o['atMs'] !== undefined && !(Number.isInteger(o['atMs']) && (o['atMs'] as number) >= 0)) return null;
  const durationMs = typeof o['durationMs'] === 'number' && o['durationMs'] >= 0 ? Math.round(o['durationMs']) : 0;
  return { hash: o['hash'], format: o['format'], durationMs, ...(o['atMs'] !== undefined ? { atMs: o['atMs'] as number } : {}) };
}

/** `voiceNotes`: what PUT …/voice-notes returned, each with `atMs` if it is about a moment. Undefined when none; null when malformed. */
export function parseVoiceNotes(v: unknown): VoiceNote[] | null | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > MAX_VOICE_NOTES) return null;
  const out = v.map(parseVoiceNote);
  return out.some((n) => n === null) || new Set(out.map((n) => n!.hash)).size !== out.length ? null : (out as VoiceNote[]);
}

export function parseReview(body: unknown): ReviewInput | Refusal {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b['outcome'] !== 'looks_good' && b['outcome'] !== 'needs_changes') return refuse(400, 'bad_request', 'outcome must be "looks_good" or "needs_changes".');
  if (!str(b['reviewerId'], 200)) return refuse(400, 'bad_request', 'reviewerId is required: your id for whoever gave it, such as a listener or device (at most 200 characters).');
  for (const [k, max] of [['kindId', 100], ['takeId', 200], ['comment', 4000], ['reviewerName', 120], ['submissionId', 64]] as const) {
    if (!optStr(b[k], max)) return refuse(400, 'bad_request', `${k} must be non-empty text of at most ${max} characters.`);
  }
  const voiceNotes = parseVoiceNotes(b['voiceNotes']);
  if (voiceNotes === null) return refuse(400, 'bad_request', `voiceNotes is a list of at most ${MAX_VOICE_NOTES}, each what PUT …/voice-notes returned, with atMs (a whole number) if it is about a moment.`);
  const pick = (k: string) => (b[k] !== undefined ? { [k]: b[k] as string } : {});
  return {
    outcome: b['outcome'], reviewerId: b['reviewerId'] as string,
    ...pick('kindId'), ...pick('takeId'), ...pick('comment'), ...pick('reviewerName'), ...pick('submissionId'),
    ...(voiceNotes?.length ? { voiceNotes } : {})
  };
}

export function parseRelease(body: unknown): ReleaseInput | Refusal {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b['live'] !== 'boolean') return refuse(400, 'bad_request', 'live must be true or false.');
  if (!str(b['channel'], 60)) return refuse(400, 'bad_request', 'channel names where it is published, such as "Every Language app" (at most 60 characters).');
  if (!optStr(b['takeId'], 200)) return refuse(400, 'bad_request', 'takeId must be a version id.');
  if (b['url'] !== undefined && !(typeof b['url'] === 'string' && /^https:\/\/\S{1,2000}$/.test(b['url']))) return refuse(400, 'bad_request', 'url must be an https link.');
  return { live: b['live'], channel: (b['channel'] as string).trim(), ...(b['takeId'] !== undefined ? { takeId: b['takeId'] as string } : {}), ...(b['url'] !== undefined ? { url: b['url'] as string } : {}) };
}

function checked(event: AnyEvent): AnyEvent | Refusal {
  const invalid = validateEvent(event);
  return invalid ? refuse(400, 'invalid', invalid) : event;
}

/** The kinds a review may be of here: `listener`, or a kind in the language's flow. */
export function reviewableKinds(state: LanguageState, unitId: string): Set<string> {
  const s = derivePassage(state, unitId);
  return new Set([LISTENER_KIND, ...s.flow.steps.flatMap((st) => st.kindIds)]);
}

/** A voice note is new audio from an upload; naming a card or note already in the language would hand out a link to it. */
const fresh = (state: LanguageState, notes: VoiceNote[] | undefined) => {
  const known = notes?.length ? referencedBlobs(state) : null;
  return !notes?.some((n) => known!.has(n.hash));
};

/**
 * The payload every outside review shares: given by link, by whoever is
 * named, with the voice note where phones will play it.
 */
function reviewPayload(input: Pick<ReviewInput, 'outcome' | 'comment' | 'voiceNotes'>, takeId: string, kindId: string, givenBy: string, reviewId: string) {
  // Voice notes are review artifacts: each card carries its own format, so phones play WAV and m4a alike, and its moment.
  const artifacts = (input.voiceNotes ?? [])
    .map((n) => ({ hash: n.hash, durationMs: n.durationMs, format: n.format, ...(n.atMs !== undefined ? { atMs: n.atMs } : {}) }))
    .sort((a, b) => (a.atMs ?? -1) - (b.atMs ?? -1));
  return {
    reviewId, takeId, kindId, outcome: input.outcome, via: 'link', people: 1, givenBy,
    ...(input.comment !== undefined ? { comment: input.comment } : {}),
    ...(artifacts.length ? { artifacts } : {})
  };
}

const deviceOf = (id: string) => `api-${id}`;

function envelope(orgId: string, languageId: string, actorId: string, device: string, now: number, type: AnyEvent['type'], id: string, payload: unknown): AnyEvent {
  return { id, type, orgId, streamId: languageId, actorId, deviceId: device, hlc: encodeHlc(now, 0, device), payload } as AnyEvent;
}

/**
 * A review sent with a token: recorded as its person, given by link, from a
 * device of the token's own. Its id comes from the token, version, reviewer,
 * kind and outcome (or submissionId), so a double tap or a retry records it
 * once and one reviewer cannot pile up answers on a version.
 */
export async function reviewEvent(ctx: WriteContext, input: ReviewInput): Promise<AnyEvent | Refusal> {
  const { grant, org, state, languageId, unitId } = ctx;
  if (!grant.scopes.includes('review')) return refuse(403, 'scope', 'This token was not given the "review" scope.');
  const can = languageAccess(grant, org, languageId);
  if (!can) return refuse(404, 'no_language', 'This token cannot open that language.');
  if (!can.review) return refuse(403, 'privilege', 'The account behind this token cannot review or translate in this language.');
  const idx = buildIndexes(state);
  if (!idx.passages.includes(unitId)) return refuse(404, 'no_passage', 'There is no passage with that id in this language.');
  const s = derivePassage(state, unitId, idx);
  // What a token cannot read, it cannot answer either: a published-only token hears the approved version.
  const own = heard(grant, s);
  if (!own) return canRead(grant, true) ? refuse(409, 'no_version', 'This passage has no version shared for review yet.') : refuse(404, 'no_passage', 'There is no approved passage with that id in this language.');
  const takeId = input.takeId ?? own.takeId;
  if (!s.versions.some((v) => v.takeId === takeId)) return refuse(404, 'no_version', 'That takeId is not a version of this passage.');
  if (!canRead(grant, true) && takeId !== own.takeId) return refuse(404, 'no_version', 'This token hears only the approved version.');
  const kindId = input.kindId ?? LISTENER_KIND;
  if (!reviewableKinds(state, unitId).has(kindId)) return refuse(400, 'no_kind', `kindId must be "${LISTENER_KIND}" or a kind in this language's flow.`);
  if (!fresh(state, input.voiceNotes)) return refuse(400, 'bad_request', 'voiceNotes must be ones you just uploaded.');
  const reviewer = (await sha256Hex(`${grant.tokenId}\n${input.reviewerId}`)).slice(0, 16);
  const reviewId = `${kindId === LISTENER_KIND ? LISTENER_KIND : 'review'}-${(await sha256Hex([grant.tokenId, takeId, reviewer, kindId, input.submissionId ?? input.outcome].join('\n'))).slice(0, 32)}`;
  const givenBy = input.reviewerName?.trim() || `Listener ${reviewer.slice(0, 6)}`;
  return checked(envelope(grant.orgId, languageId, grant.profileId, deviceOf(grant.tokenId), ctx.now, 'v1.ReviewRecorded', `api-${reviewId}`,
    reviewPayload(input, takeId, kindId, givenBy, reviewId)));
}

/** Live or taken down on a channel. Going live needs the approved version; anything may be taken down. */
export async function releaseEvent(ctx: WriteContext, input: ReleaseInput): Promise<AnyEvent | Refusal> {
  const { grant, org, state, languageId, unitId } = ctx;
  if (!grant.scopes.includes('release')) return refuse(403, 'scope', 'This token was not given the "release" scope.');
  const can = languageAccess(grant, org, languageId);
  if (!can) return refuse(404, 'no_language', 'This token cannot open that language.');
  if (!can.release) return refuse(403, 'privilege', 'The account behind this token cannot assign work in this language, which reporting releases needs.');
  const idx = buildIndexes(state);
  if (!idx.passages.includes(unitId)) return refuse(404, 'no_passage', 'There is no passage with that id in this language.');
  const s = derivePassage(state, unitId, idx);
  const approved = approvedVersion(s);
  const takeId = input.takeId ?? approved?.takeId;
  if (!takeId) return refuse(409, 'not_approved', 'This passage has no approved version to release.');
  if (!s.versions.some((v) => v.takeId === takeId)) return refuse(404, 'no_version', 'That takeId is not a version of this passage.');
  if (input.live && takeId !== approved?.takeId) return refuse(409, 'not_approved', 'Only the approved version can go live.');
  const id = `api-release-${(await sha256Hex([grant.tokenId, takeId, input.channel, String(input.live), String(ctx.now)].join('\n'))).slice(0, 32)}`;
  return checked(envelope(grant.orgId, languageId, grant.profileId, deviceOf(grant.tokenId), ctx.now, 'v1.VersionReleased', id,
    { takeId, channel: input.channel, live: input.live, ...(input.url !== undefined ? { url: input.url } : {}) }));
}

// ---- review links ------------------------------------------------------------------

/** A link someone shared to review one version for one kind (migration 20261008140000). */
export interface ReviewLink {
  id: string;
  orgId: string;
  languageId: string;
  unitId: string;
  takeId: string;
  kindId: string;
  /** Does a review through it count toward the step, or is it listener feedback? Chosen by the sharer. */
  counts: boolean;
  label: string | null;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface LinkSpec {
  languageId: string;
  unitId: string;
  /** The version to hear; the latest when left out. */
  takeId?: string;
  kindId: string;
  counts: boolean;
  label?: string;
}

/** Reviews one link takes, and one browser on it, before it stops: one group, not the internet. */
export const LINK_MAX_REVIEWS = 500;
export const LINK_MAX_PER_BROWSER = 10;

/**
 * May this person share this link? They need to be able to ask for reviews
 * (send_to_reviewers or assign_work), and to be able to record a review
 * given by link (review or translate: it is recorded as them). The step must
 * allow links; a link that does not count is listener feedback and may go
 * out for any version.
 */
export function checkLinkSpec(org: OrgState, state: LanguageState, profileId: string, spec: LinkSpec): { takeId: string } | Refusal {
  if (!languageInfo(org, spec.languageId)) return refuse(404, 'no_language', 'There is no such language.');
  const privs = privilegesFor(org, profileId, spec.languageId);
  if (!(privs.has('send_to_reviewers') || privs.has('assign_work')) || !(privs.has('review') || privs.has('translate'))) {
    return refuse(403, 'privilege', 'Your role cannot send work to reviewers in this language.');
  }
  const idx = buildIndexes(state);
  if (!idx.passages.includes(spec.unitId)) return refuse(404, 'no_passage', 'There is no passage with that id in this language.');
  const s = derivePassage(state, spec.unitId, idx);
  const takeId = spec.takeId ?? s.latest?.takeId;
  if (!takeId || !s.versions.some((v) => v.takeId === takeId)) return refuse(409, 'no_version', 'Share a version that was sent for review.');
  if (spec.counts) {
    const step = s.flow.steps.find((st) => st.kindIds.includes(spec.kindId));
    if (!step) return refuse(400, 'no_kind', "That kind is not in this language's flow; share it as feedback instead.");
    if (!stepAllowsLinks(state, step)) return refuse(403, 'links_off', 'This step is not reviewed by shared links. Share it as feedback, or ask a coordinator to allow links for the step.');
  }
  return { takeId };
}

export interface LinkView {
  label: string | null;
  passage: { label: string; path: string[] };
  language: string;
  kind: { id: string; name: string; description: string };
  counts: boolean;
  version: number;
  audio: AudioCard[];
  expiresAt: string;
  open: boolean;
}

/** What the review page shows: the version's audio and what is being asked, nothing else of the language. */
export async function linkView(link: ReviewLink, org: OrgState, state: LanguageState, sign: Signer, now: number): Promise<LinkView | Refusal> {
  const s = derivePassage(state, link.unitId);
  const v = s.versions.find((x) => x.takeId === link.takeId);
  if (!v) return refuse(404, 'gone', 'This passage is no longer here.');
  const open = !link.revokedAt && Date.parse(link.expiresAt) > now;
  const cards = cardsOf(state);
  const audio: AudioCard[] = [];
  // A closed link plays nothing: revoking it is how a sharer takes the audio back.
  for (const hash of open ? v.cardHashes : []) {
    const card = cards.get(hash);
    const format = card?.format ?? 'wav';
    const l = await sign(`${link.orgId}/${link.languageId}/${hash}.${format}`);
    audio.push({ hash, format, durationMs: card?.durationMs ?? 0, url: l.url, expiresAt: new Date(l.expiresAt).toISOString() });
  }
  const kind = kindOf(state, link.kindId);
  return {
    label: link.label, passage: { label: state.units[link.unitId]?.label ?? link.unitId, path: pathOf(state, link.unitId) },
    language: languageInfo(org, link.languageId)?.name ?? link.languageId,
    kind: { id: kind.id, name: kind.name, description: kind.description }, counts: link.counts, version: v.n, audio,
    expiresAt: link.expiresAt, open
  };
}

export interface LinkReviewInput {
  outcome: 'looks_good' | 'needs_changes';
  /** Any name; a label for the team, remembered by the browser. */
  name: string;
  comment?: string;
  voiceNotes?: VoiceNote[];
  /** Random, kept by the browser: tells one person's answers apart on a shared link. */
  browserId: string;
  /** Random per press of Send, so a retry records once and a changed mind records again. */
  submissionId: string;
}

export function parseLinkReview(body: unknown): LinkReviewInput | Refusal {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b['outcome'] !== 'looks_good' && b['outcome'] !== 'needs_changes') return refuse(400, 'bad_request', 'Choose looks good or needs changes.');
  if (!str(b['name'], 80)) return refuse(400, 'bad_request', 'Type your name (at most 80 characters).');
  if (!str(b['browserId'], 64) || !str(b['submissionId'], 64)) return refuse(400, 'bad_request', 'browserId and submissionId are required.');
  if (!optStr(b['comment'], 4000)) return refuse(400, 'bad_request', 'A comment can be at most 4000 characters.');
  const voiceNotes = parseVoiceNotes(b['voiceNotes']);
  if (voiceNotes === null) return refuse(400, 'bad_request', `Send at most ${MAX_VOICE_NOTES} voice notes, each uploaded here.`);
  return {
    outcome: b['outcome'], name: (b['name'] as string).trim(), browserId: b['browserId'] as string, submissionId: b['submissionId'] as string,
    ...(b['comment'] !== undefined ? { comment: b['comment'] as string } : {}), ...(voiceNotes?.length ? { voiceNotes } : {})
  };
}

/**
 * A review through a shared link, recorded as whoever shared it (decisions.md
 * 70), of the link's kind when it counts and as listener feedback when not.
 * Its id carries the link, the browser and the press of Send: the latest
 * answer from a browser is the one that stands, and the counts below come
 * from the log itself, so they survive the object's evictions.
 */
export async function linkReviewEvent(link: ReviewLink, org: OrgState, state: LanguageState, input: LinkReviewInput, now: number): Promise<AnyEvent | Refusal> {
  if (link.revokedAt || Date.parse(link.expiresAt) <= now) return refuse(410, 'closed', 'This review link has closed. Ask whoever sent it for a new one.');
  const s = derivePassage(state, link.unitId);
  if (!s.versions.some((v) => v.takeId === link.takeId)) return refuse(404, 'gone', 'This passage is no longer here.');
  if (!fresh(state, input.voiceNotes)) return refuse(400, 'bad_request', 'A voice note was not uploaded here.');
  const linkKey = link.id.replace(/-/g, '').slice(0, 12);
  const browser = (await sha256Hex(`${link.id}\n${input.browserId}`)).slice(0, 12);
  const prefix = `link-${linkKey}-`;
  const onLink = Object.keys(state.kindReviews ?? {}).filter((id) => id.startsWith(prefix));
  if (onLink.length >= LINK_MAX_REVIEWS) return refuse(429, 'full', 'This review link has taken all the reviews it can. Ask whoever sent it for a new one.');
  if (onLink.filter((id) => id.startsWith(`${prefix}${browser}-`)).length >= LINK_MAX_PER_BROWSER) return refuse(429, 'full', 'You have sent as many answers on this link as it takes.');
  const reviewId = `${prefix}${browser}-${(await sha256Hex(input.submissionId)).slice(0, 16)}`;
  const kindId = link.counts ? link.kindId : LISTENER_KIND;
  // A sharer who can no longer record it (left, or lost the role) closes their links.
  const privs = privilegesFor(org, link.createdBy, link.languageId);
  if (!(privs.has('review') || privs.has('translate'))) return refuse(410, 'closed', 'This review link has closed. Ask whoever sent it for a new one.');
  return checked(envelope(link.orgId, link.languageId, link.createdBy, `api-link-${linkKey}`, now, 'v1.ReviewRecorded', `api-${reviewId}`,
    reviewPayload(input, link.takeId, kindId, input.name, reviewId)));
}
