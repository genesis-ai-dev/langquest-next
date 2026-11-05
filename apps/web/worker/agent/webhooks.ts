import { buildIndexes, derivePassage, passageWork, approvedVersion, type LanguageState } from '@langquest-next/core';
import type { ApiStatus } from './view';
import { inSlices, type LanguageRecords } from '../languageRecords';

/**
 * Webhooks and the change feed (docs/agent-api.md, decisions.md 101). A
 * delivery is a nudge: it says what kind of thing changed in a language and
 * where the feed has it, never the data. An app reads the change feed, or
 * the passages by unitIds, with its token, so permissions and audio links
 * are always fresh and a missed delivery loses nothing.
 *
 * The log has no event for a passage leaving the list or being renamed: a
 * unit is hidden, a template changes, a book is divided again. So changes
 * are found by comparing what the API shows of a language before and after
 * (a digest), not by reading event types. Pure; dispatch.ts keeps the
 * state and sends.
 */

/** What a webhook may subscribe to. Passage and unit events are per language; token.revoked is the token's last. */
export const WEBHOOK_EVENTS = [
  'passage.version.submitted', 'passage.status.changed', 'passage.review.created', 'passage.release.created',
  'unit.created', 'unit.updated', 'unit.deleted',
  'language.added', 'language.removed',
  'token.revoked'
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** The kinds of change the feed lists, one row per passage. */
export type ChangeType = Exclude<WebhookEvent, 'language.added' | 'language.removed' | 'token.revoked'>;

export const WEBHOOKS_PER_TOKEN = 10;
/** Unit ids one delivery names; the feed has them all. */
export const UNIT_IDS_PER_DELIVERY = 100;
/** How long a response may take before the attempt counts as failed. */
export const DELIVERY_TIMEOUT_MS = 10_000;
/** A burst of pokes (a recording session) waits this long, so one delivery names many takes. */
export const COALESCE_MS = 3_000;
/** When each attempt is made, after the change was seen. The last is a day on; after it fails, the webhook is turned off. */
export const RETRY_AT_MS = [0, 30e3, 2 * 60e3, 10 * 60e3, 30 * 60e3, 3600e3, 2 * 3600e3, 4 * 3600e3, 8 * 3600e3, 16 * 3600e3, 24 * 3600e3];
/** Feed rows older than this are dropped; a cursor from before them gets 410 cursor_expired. */
export const CHANGES_KEPT_MS = 90 * 24 * 3600e3;
export const CHANGES_PAGE = 500;
export const CHANGES_PAGE_MAX = 1000;
/** Attempts kept per webhook for GET …/deliveries. */
export const DELIVERIES_KEPT = 100;

export const SECRET_PREFIX = 'whsec_';

export interface WebhookInput {
  url: string;
  events: WebhookEvent[];
  languageIds: string[] | null;
}

type Refused = { status: number; code: string; error: string };

/** An https address with a name, not an address literal: a webhook must reach a server the app runs, not this network. */
export function webhookUrlError(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2000) return 'url must be an https address of at most 2000 characters.';
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'url is not a valid address.';
  }
  if (u.protocol !== 'https:') return 'url must start with https://.';
  if (u.username || u.password) return 'url must not hold a user name or password; check the signature instead.';
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || /^[\d.]+$/.test(host) || host.startsWith('[')) return 'url must name a public host, not localhost or an IP address.';
  return null;
}

export function parseWebhookInput(body: Record<string, unknown>): WebhookInput | Refused {
  const bad = (error: string): Refused => ({ status: 400, code: 'bad_request', error });
  const urlError = webhookUrlError(body['url']);
  if (urlError) return bad(urlError);
  const events = body['events'];
  if (!Array.isArray(events) || events.length === 0 || !events.every((e) => typeof e === 'string' && (WEBHOOK_EVENTS as readonly string[]).includes(e))) {
    return bad(`events is a list of one or more of: ${WEBHOOK_EVENTS.join(', ')}.`);
  }
  const ids = body['languageIds'];
  if (ids !== undefined && ids !== null && (!Array.isArray(ids) || ids.length === 0 || !ids.every((i) => typeof i === 'string' && i.length > 0 && i.length <= 200))) {
    return bad('languageIds is a list of language ids, or left out for every language the token reaches.');
  }
  return {
    url: body['url'] as string,
    events: WEBHOOK_EVENTS.filter((e) => events.includes(e)),
    languageIds: Array.isArray(ids) ? [...new Set(ids as string[])] : null
  };
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** 256 random bits. Kept as it is, unlike a token: signing needs it. */
export const newWebhookSecret = () => SECRET_PREFIX + base64url(crypto.getRandomValues(new Uint8Array(32)));

export const newEventId = () => `evt_${crypto.randomUUID().replace(/-/g, '')}`;

/** `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`, as Stripe signs. */
export async function signature(secret: string, unixSeconds: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${unixSeconds}.${body}`));
  return `t=${unixSeconds},v1=${[...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// ---- what a language shows, and how it changed --------------------------------------

/** One passage as far as changes go: what the passage list shows of it, without counts and links. */
export interface PassageMark {
  /** label, order, parentUnitId, kind and path: a change is unit.updated. */
  unit: [string, string, string | null, string, string];
  take: string | null;
  status: ApiStatus;
  approved: string | null;
  review: string | null;
  release: string | null;
}

export type Digest = Record<string, PassageMark>;

function pathKey(state: LanguageState, unitId: string): string {
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
  return out.join('\u001f');
}

/** Every passage the list shows, by unit id. */
export function digestOf(state: LanguageState): Digest {
  return digestOfPassages(state, buildIndexes(state).passages);
}

/**
 * The same, read a slice of passages at a time from the object's records of
 * the language (decisions.md 147), so a Bible-size language is never whole
 * in memory while its changes are looked for.
 */
export async function digestOfRecords(records: LanguageRecords): Promise<Digest> {
  const out: Digest = {};
  for await (const { unitIds, state } of inSlices(records)) Object.assign(out, digestOfPassages(state, unitIds));
  return out;
}

/** These passages' marks, from a state that holds their records. */
function digestOfPassages(state: LanguageState, unitIds: readonly string[]): Digest {
  const idx = buildIndexes(state);
  const out: Digest = {};
  for (const unitId of unitIds) {
    const u = state.units[unitId]!;
    const s = derivePassage(state, unitId, idx);
    const work = passageWork(s);
    let review: string | null = null;
    for (const r of s.reviews) if (!review || r.hlc > review) review = r.hlc;
    let release: string | null = null;
    for (const v of s.versions) for (const reg of Object.values(state.releases?.[v.takeId] ?? {})) if (!release || reg.hlc > release) release = reg.hlc;
    out[unitId] = {
      unit: [u.label, u.order, u.parentUnitId, u.kind, pathKey(state, unitId)],
      take: s.latest?.takeId ?? null,
      status: work === 'done' ? 'approved' : work,
      approved: approvedVersion(s)?.takeId ?? null,
      review,
      release
    };
  }
  return out;
}

export interface Change {
  type: ChangeType;
  unitId: string;
}

const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** What happened between two digests, in the order the feed lists it: structure first, then work. */
export function diffDigests(before: Digest, after: Digest): Change[] {
  const out: Change[] = [];
  for (const [unitId, a] of Object.entries(after)) {
    const b = before[unitId];
    if (!b) out.push({ type: 'unit.created', unitId });
    else if (!same(a.unit, b.unit)) out.push({ type: 'unit.updated', unitId });
  }
  for (const unitId of Object.keys(before)) if (!after[unitId]) out.push({ type: 'unit.deleted', unitId });
  for (const [unitId, a] of Object.entries(after)) {
    const b = before[unitId];
    if (a.take && a.take !== b?.take) out.push({ type: 'passage.version.submitted', unitId });
    // A passage that just appeared with nothing done is unit.created alone.
    if (b ? a.status !== b.status || a.approved !== b.approved : a.status !== 'not_started') out.push({ type: 'passage.status.changed', unitId });
    if (a.review && a.review !== b?.review) out.push({ type: 'passage.review.created', unitId });
    if (a.release && a.release !== b?.release) out.push({ type: 'passage.release.created', unitId });
  }
  return out;
}
