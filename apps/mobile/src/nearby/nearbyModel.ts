import type { OrgState } from '@langquest-next/core';

/**
 * What a phone keeps of its nearby identity, and when it asks for more
 * (docs/nearby-sync-plan.md 5.5, 5.10, 5.12 "The store", "Generations" and
 * the paragraph on `useNearbyIdentity`). Pure: the server's answers come in
 * as plain values and what to store goes out as plain values, so every rule
 * is tested without a phone. Nothing here reads, logs or sends a key.
 */

/** The flag a feature is granted under (`org_features`, decision 53 as amended). */
export const NEARBY_FEATURE = 'nearby';

/** A certificate refreshes once a day (5.5). */
export const ASK_EVERY_MS = 86_400_000;

/** The Worker takes at most this many languages in one call. */
export const MAX_LANGUAGES = 500;

// ---- the flag, from get_user_state -------------------------------------------------

/** `orgFeatures` of `get_user_state`'s answer, or null from a server before the field: then nothing is known, and nothing is dropped. */
export function orgFeaturesOf(userState: unknown): Record<string, string[]> | null {
  const v = (userState as { orgFeatures?: unknown } | null)?.orgFeatures;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const out: Record<string, string[]> = {};
  for (const [org, features] of Object.entries(v)) {
    if (Array.isArray(features)) out[org] = features.filter((f): f is string => typeof f === 'string');
  }
  return out;
}

/** `nearbyRevokedSeq`: each organization's newest revocation list, by its `seq`. */
export function revokedSeqsOf(userState: unknown): Record<string, number> {
  const v = (userState as { nearbyRevokedSeq?: unknown } | null)?.nearbyRevokedSeq;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [org, seq] of Object.entries(v)) if (typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 1) out[org] = seq;
  return out;
}

/** The organizations of mine with nearby sync on. */
export function nearbyOrgsOf(features: Readonly<Record<string, readonly string[]>>): Set<string> {
  return new Set(Object.entries(features).filter(([, f]) => f.includes(NEARBY_FEATURE)).map(([org]) => org));
}

// ---- the Worker's public keys --------------------------------------------------------

const KID = /^[A-Za-z0-9_-]{1,64}$/;
const KEY32 = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

/** A 32-byte value in canonical base64url, as core's `isBase64url` reads it. */
export const isKey32 = (v: unknown): v is string => typeof v === 'string' && KEY32.test(v);

/**
 * `EXPO_PUBLIC_NEARBY_CERT_KEYS`, `kid:base64url,...`, read as the Worker reads `NEARBY_CERT_KEYS`
 * (`parseCertKeys` in apps/web/worker/nearbyKeys.ts): any entry that is not a kid and a 32-byte
 * key empties the whole list, so a typo refuses every chain rather than trusting part of a list.
 */
export function parseCertKeys(text: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of (text ?? '').split(',').map((e) => e.trim()).filter(Boolean)) {
    const at = entry.indexOf(':');
    const kid = entry.slice(0, at);
    const key = entry.slice(at + 1);
    if (at < 1 || !KID.test(kid) || !isKey32(key) || out.has(kid)) return new Map();
    out.set(kid, key);
  }
  return out;
}

// ---- discovery keys --------------------------------------------------------------------

/** One language's discovery key, as `nearbyFindKeys:<profileId>` holds it (5.12, Generations). */
export interface FindKey {
  gen: number;
  /** Base64url, 32 bytes. */
  key: string;
  /** The oldest generation this phone scans down to; it moves only when the server says. */
  floor: number;
  /** From the server, so it may be handed on once (5.12, the hand-on). */
  direct: boolean;
}

/** `"<orgId>/<languageId>"` to that language's key. */
export type FindKeys = Record<string, FindKey>;

const isGen = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;

function findKeyOf(v: unknown): FindKey | null {
  const k = v as Partial<FindKey> | null;
  if (typeof k !== 'object' || k === null || !isGen(k.gen) || !isGen(k.floor) || k.floor > k.gen || !isKey32(k.key) || typeof k.direct !== 'boolean') return null;
  return { gen: k.gen, key: k.key, floor: k.floor, direct: k.direct };
}

/** What is stored, with anything unreadable left out: a missing key is asked for again. */
export function parseFindKeys(raw: string | null): FindKeys {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: FindKeys = {};
    for (const [where, v] of Object.entries(parsed)) {
      const key = findKeyOf(v);
      if (key && where.includes('/')) out[where] = key;
    }
    return out;
  } catch {
    return {};
  }
}

const orgOf = (where: string) => where.slice(0, where.indexOf('/'));

/** Keys of organizations no longer on go, with no call (5.12). */
export function findKeysForOrgs(held: FindKeys, orgsOn: ReadonlySet<string>): FindKeys {
  return Object.fromEntries(Object.entries(held).filter(([where]) => orgsOn.has(orgOf(where))));
}

/** One discovery key in a certificate answer. */
export interface AnsweredFindKey {
  orgId: string;
  languageId: string;
  gen: number;
  floor: number;
  key: string;
}

/**
 * After a certificate answer: each language it answered is replaced with `direct: true`; a
 * language this phone named and it did not answer goes, since this person may no longer read
 * it or its organization is off; and keys of organizations it holds no chain for go. A key
 * named by nobody stays as it was. `keptOrgs`, organizations whose new chain could not be
 * checked while the one held still checks (the Worker's key rotated past this build), are as
 * after a 429 or 503: their keys stay as held, and what the answer said of them is not taken.
 */
export function findKeysAfterAnswer(
  held: FindKeys, named: readonly string[], answered: readonly AnsweredFindKey[], chainOrgs: ReadonlySet<string>, keptOrgs: ReadonlySet<string> = new Set()
): FindKeys {
  const out: FindKeys = { ...held };
  for (const where of named) if (!keptOrgs.has(orgOf(where))) delete out[where];
  for (const a of answered) {
    if (!chainOrgs.has(a.orgId) || keptOrgs.has(a.orgId)) continue;
    out[`${a.orgId}/${a.languageId}`] = { gen: a.gen, key: a.key, floor: a.floor, direct: true };
  }
  return findKeysForOrgs(out, chainOrgs);
}

// ---- the certificate answer --------------------------------------------------------------

export interface SignedText {
  orgId: string;
  text: string;
  kid: string;
  sig: string;
}

export type CertificateAnswer =
  | { revoked: true }
  | { revoked: false; chains: { orgId: string; chain: unknown[] }[]; discoveryKeys: AnsweredFindKey[]; revocations: SignedText[] };

const isId = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= 256;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The Worker's 200 answer, shape checked; null for anything it would not send, which the phone
 * treats as no answer and keeps what it holds. The chains and lists are checked against the
 * Worker's keys by the caller before anything is kept.
 */
export function certificateAnswerOf(body: unknown): CertificateAnswer | null {
  if (!isObject(body)) return null;
  if (body['revoked'] === true) return { revoked: true };
  const { chains, discoveryKeys, revocations } = body;
  if (!Array.isArray(chains) || !Array.isArray(discoveryKeys) || !Array.isArray(revocations)) return null;
  const out: CertificateAnswer = { revoked: false, chains: [], discoveryKeys: [], revocations: [] };
  for (const c of chains as unknown[]) {
    if (!isObject(c) || !isId(c['orgId']) || !Array.isArray(c['chain'])) return null;
    out.chains.push({ orgId: c['orgId'], chain: c['chain'] as unknown[] });
  }
  for (const k of discoveryKeys as unknown[]) {
    if (!isObject(k) || !isId(k['orgId']) || !isId(k['languageId']) || !isGen(k['gen']) || !isGen(k['floor']) || k['floor'] > k['gen'] || !isKey32(k['key'])) return null;
    out.discoveryKeys.push({ orgId: k['orgId'], languageId: k['languageId'], gen: k['gen'], floor: k['floor'], key: k['key'] });
  }
  for (const r of revocations as unknown[]) {
    if (!isObject(r) || !isId(r['orgId']) || typeof r['text'] !== 'string' || !isId(r['kid']) || typeof r['sig'] !== 'string') return null;
    out.revocations.push({ orgId: r['orgId'], text: r['text'], kid: r['kid'], sig: r['sig'] });
  }
  return out;
}

// ---- chains as stored ------------------------------------------------------------------

/** `nearbyChain:<profileId>`: organization id to that organization's chain, replaced whole by each answer. */
export type HeldChains = Record<string, unknown[]>;

export function parseChains(raw: string | null | undefined): HeldChains {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, unknown[]] => Array.isArray(e[1])));
  } catch {
    return {};
  }
}

/** Chains of organizations no longer on go, with no call. */
export function chainsForOrgs(held: HeldChains, orgsOn: ReadonlySet<string>): HeldChains {
  return Object.fromEntries(Object.entries(held).filter(([org]) => orgsOn.has(org)));
}

// ---- when to ask -----------------------------------------------------------------------

/** `nearbyCertAsked:<profileId>`: when this person last had an answer, and their membership then in each organization. */
export interface AskRecord {
  at: number;
  memberships: Record<string, string>;
}

export function parseAskRecord(raw: string | null | undefined): AskRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<AskRecord>;
    if (typeof v?.at !== 'number' || !isObject(v.memberships)) return null;
    return { at: v.at, memberships: Object.fromEntries(Object.entries(v.memberships).filter((e): e is [string, string] => typeof e[1] === 'string')) };
  } catch {
    return null;
  }
}

/**
 * This person's live memberships in one organization's fold, with each role's privileges, as
 * one string: a change in it is a membership change, which asks for a new certificate (5.5).
 */
export function membershipMarkOf(org: Pick<OrgState, 'members' | 'roles'> | null, profileId: string): string {
  const mine = org?.members[profileId] ?? {};
  return Object.keys(mine).sort().flatMap((scope) => {
    const m = mine[scope]!;
    if (m.removed.value) return [];
    const role = org?.roles[m.roleId.value];
    return [`${scope}=${m.roleId.value}:${role && !role.retired ? [...role.privileges.value].sort().join('+') : ''}`];
  }).join(',');
}

export interface AskFacts {
  now: number;
  last: AskRecord | null;
  /** The organization open here and this person's membership in its fold. */
  orgId: string;
  membership: string;
  /** Organizations of mine with nearby on, from the server this run. */
  orgsOn: ReadonlySet<string>;
  /** Organizations a chain is held for, for this person and this install key. */
  chainOrgs: ReadonlySet<string>;
  /** `nearbyRevokedSeq`, and the `seq` of each list held. */
  revokedSeqs: Readonly<Record<string, number>>;
  heldRevokedSeqs: Readonly<Record<string, number>>;
  /** A language open here with no discovery key, not yet asked for this run. */
  languageWithoutKey: boolean;
}

export type AskReason = 'first' | 'day' | 'membership' | 'revoked' | 'noChain' | 'language';

/**
 * Whether to ask for a certificate now, and why (5.12): only while an organization of theirs
 * is on; then the first time, once a day (a clock set back counts as a day gone, and the
 * answer's time puts it right), when their membership here changed, when a newer revocation
 * list waits, when an organization on has no chain held, or the first time a language opens
 * with no key.
 */
export function askReason(f: AskFacts): AskReason | null {
  if (f.orgsOn.size === 0) return null;
  if (!f.last) return 'first';
  if (f.now < f.last.at || f.now - f.last.at >= ASK_EVERY_MS) return 'day';
  if (f.orgsOn.has(f.orgId) && f.last.memberships[f.orgId] !== f.membership) return 'membership';
  if (Object.entries(f.revokedSeqs).some(([org, seq]) => f.orgsOn.has(org) && seq > (f.heldRevokedSeqs[org] ?? 0))) return 'revoked';
  if ([...f.orgsOn].some((org) => !f.chainOrgs.has(org))) return 'noChain';
  if (f.languageWithoutKey) return 'language';
  return null;
}

/**
 * The languages to name, `<orgId>/<languageId>`: those this phone holds a key for, and those of
 * the organization open here that this phone has opened (decision 37), of organizations on.
 */
export function languagesToName(held: FindKeys, orgId: string, opened: readonly string[], orgsOn: ReadonlySet<string>): string[] {
  const out = new Set(Object.keys(held).filter((where) => orgsOn.has(orgOf(where))));
  if (orgsOn.has(orgId)) for (const languageId of opened) if (languageId) out.add(`${orgId}/${languageId}`);
  return [...out].sort().slice(0, MAX_LANGUAGES);
}

// ---- what a phone holds for teammates ---------------------------------------------------

/** core's `HoldChoice`, written out here because only `.android` files import the nearby entries. */
export type HoldChoice = { hold: true } | { hold: false; reviewWindow: number };

/** Open-for-review passages a phone with the row off takes, as a starting guess (5.6). */
export const REVIEW_WINDOW = 5;

/** With nothing pressed, a phone holds teammates' recordings, unless it wears a disguise (Carl's answer 14). */
export function holdByDefault(worn: boolean): boolean {
  return !worn;
}

/** `nearbyHold` as pressed, or the default: a pressed choice stays, whatever the disguise does later. */
export function holdChoiceOf(pressed: string | null | undefined, worn: boolean, reviewWindow = REVIEW_WINDOW): HoldChoice {
  const hold = pressed === 'true' ? true : pressed === 'false' ? false : holdByDefault(worn);
  return hold ? { hold: true } : { hold: false, reviewWindow };
}
