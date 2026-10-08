/**
 * Access tokens for apps and agents (docs/agent-api.md, decisions.md 70).
 * A token belongs to one person in one organization. It can never do more
 * than that person can do right now: every request checks their current
 * privileges, then narrows them by the token's scopes and languages.
 */

/** What a token may do. `read` includes `read:published`. */
export const SCOPES = ['read:published', 'read', 'review', 'release'] as const;
export type Scope = (typeof SCOPES)[number];

export const SCOPE_TEXT: Record<Scope, string> = {
  'read:published': 'Read the approved version of each passage and play its audio',
  read: 'Read every passage shared for review, with its versions and reviews',
  review: 'Record reviews as you: listener feedback, or a review step in the flow, with a comment or a voice note',
  release: 'Say where a version is published (live in an app or on a site), or taken down'
};

/** The prefix every token and device code starts with, so a leaked one is easy to spot and scan for. */
export const TOKEN_PREFIX = 'lqp_';

/** What a request carries once its token checks out. */
export interface Grant {
  tokenId: string;
  orgId: string;
  /** The person who made or approved the token; events are written as them. */
  profileId: string;
  scopes: Scope[];
  /** Null: every language the person may view. */
  languageIds: string[] | null;
}

/** Known scopes only, without repeats, in catalog order; null when any is unknown or none is given. */
export function parseScopes(input: unknown): Scope[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  if (!input.every((s) => typeof s === 'string' && (SCOPES as readonly string[]).includes(s))) return null;
  return SCOPES.filter((s) => input.includes(s));
}

export const canRead = (g: Pick<Grant, 'scopes'>, all = false): boolean =>
  g.scopes.includes('read') || (!all && g.scopes.includes('read:published'));

export const coversLanguage = (g: Pick<Grant, 'languageIds'>, languageId: string): boolean =>
  g.languageIds === null || g.languageIds.includes(languageId);

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** 256 random bits. */
export function newSecret(): string {
  return TOKEN_PREFIX + base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** A review link's code: 128 random bits, short enough for a WhatsApp message. Only its hash is stored. */
export function newLinkCode(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

/** Consonants only, so a code never spells a word, and nothing that reads like a digit. */
const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';

/** What a person types or confirms on the connect page: `BCDF-GHJK`. */
export function newUserCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]!);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

export function normalizeUserCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[^A-Z]/g, '');
  if (s.length !== 8 || [...s].some((c) => !CODE_ALPHABET.includes(c))) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export async function sha256Hex(input: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', typeof input === 'string' ? new TextEncoder().encode(input) : input);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Only the hash is stored, as for invites: a database leak hands out no working tokens. */
export const hashSecret = (secret: string) => sha256Hex(secret);
