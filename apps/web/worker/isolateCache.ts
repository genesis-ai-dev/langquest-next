import { sha256Hex } from './agent/tokens';

/**
 * Small caches that live in one Worker isolate (V1 of the app performance
 * audit). A phone downloading thousands of files asks "who is this?" and
 * "may they open this file?" for every file; the answer rarely changes, so
 * an isolate remembers it for a short time. Nothing here is shared between
 * isolates or survives one, and a cold isolate simply asks again.
 */

/** A map whose entries lapse at a time of their own and that never holds more than `max`. */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; until: number }>();

  constructor(private readonly max: number, private readonly now: () => number = Date.now) {}

  get(key: string): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.until <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  /** Keep `value` until `until` (epoch ms). A time already past stores nothing. */
  set(key: string, value: V, until: number): void {
    const at = this.now();
    if (until <= at) return;
    this.entries.delete(key);
    if (this.entries.size >= this.max) {
      for (const [k, e] of this.entries) if (e.until <= at) this.entries.delete(k);
      // Still full: drop the oldest-inserted entries.
      while (this.entries.size >= this.max) this.entries.delete(this.entries.keys().next().value!);
    }
    this.entries.set(key, { value, until });
  }

  get size(): number {
    return this.entries.size;
  }
}

/** The longest an isolate trusts a verified token or a blob decision. */
export const AUTH_TTL_MS = 60_000;
/** A refusal is remembered more briefly, so a person just added gets in soon. */
export const DENIAL_TTL_MS = 10_000;
export const MAX_ENTRIES = 5_000;

export type Verified = {
  sub: string;
  /** Token expiry, epoch seconds, when the claims carry one. */
  exp?: number | undefined;
  /** The Auth session the token belongs to, when the claims carry one. */
  sessionId?: string | undefined;
  /** How the session was verified (`aal1`, `aal2` after an authenticator code), when the claims carry it. */
  aal?: string | undefined;
} | null;

/** Who a token belongs to, and how its session was verified. */
export type Identity = { profileId: string; aal?: string | undefined };

/**
 * Who a token belongs to, asking `verify` (Auth, while the project signs
 * with a shared secret) only the first time within a minute. Keyed by the
 * token's SHA-256, so the raw token is not kept. Only successes are
 * remembered, and never past the token's own expiry. Whether the token's
 * session is still live is asked on every call, cached or not
 * (`sessionLive`, decisions.md 118): remembering the token skips verifying
 * it again, never the check that it was signed out.
 */
export function cachedIdentityOf(
  verify: (token: string) => Promise<Verified>,
  now: () => number = Date.now,
  sessionLive?: (sessionId: string) => Promise<boolean>
) {
  const cache = new TtlCache<NonNullable<Verified>>(MAX_ENTRIES, now);
  return async (token: string): Promise<Identity | null> => {
    const key = await sha256Hex(token);
    let verified: Verified = cache.get(key) ?? null;
    if (!verified) {
      verified = await verify(token);
      if (!verified?.sub) return null;
      const until = Math.min(now() + AUTH_TTL_MS, verified.exp !== undefined ? verified.exp * 1000 : Infinity);
      cache.set(key, verified, until);
    }
    if (verified.sessionId && sessionLive && !(await sessionLive(verified.sessionId))) return null;
    return { profileId: verified.sub, aal: verified.aal };
  };
}

/** `cachedIdentityOf`, when only the person is wanted. */
export function cachedProfileOf(
  verify: (token: string) => Promise<Verified>,
  now: () => number = Date.now,
  sessionLive?: (sessionId: string) => Promise<boolean>
) {
  const identityOf = cachedIdentityOf(verify, now, sessionLive);
  return async (token: string): Promise<string | null> => (await identityOf(token))?.profileId ?? null;
}

/**
 * Whether a person may use a file, asking `ask` once per person, stream and
 * mode within 60 s (10 s for a refusal). Errors are not cached.
 *
 * Accepted trade-off (developer, V1): a member who is removed may keep
 * opening files for up to 60 s from the isolates that already answered for
 * them. A person just added may wait up to 10 s after a refusal.
 */
export function cachedBlobAccess(
  ask: (key: string, profileId: string, write: boolean, aal?: string) => Promise<boolean>,
  now: () => number = Date.now
) {
  const cache = new TtlCache<boolean>(MAX_ENTRIES, now);
  return async (key: string, profileId: string, write: boolean, aal?: string): Promise<boolean> => {
    // `blob_access` answers per org and stream, except that library media in
    // an organization's own stream (`org/_org/hash`) is allowed per file.
    // Missing parts read as empty, as split_part does in SQL, so no two names share a key unless the SQL sees the same org and stream.
    const [org = '', stream = ''] = key.split('/');
    const scope = stream === '_org' ? key : `${org}/${stream}`;
    // The session's level is part of the question: a Global Viewer reads only on aal2 (decisions.md 158).
    const id = `${profileId}|${aal ?? ''}|${scope}|${write ? 'w' : 'r'}`;
    const known = cache.get(id);
    if (known !== undefined) return known;
    const allowed = await ask(key, profileId, write, aal);
    cache.set(id, allowed, now() + (allowed ? AUTH_TTL_MS : DENIAL_TTL_MS));
    return allowed;
  };
}

/**
 * Whether a profile is a Global Viewer whose access is on at this session
 * level (decisions.md 158), asking `ask` once a minute (10 s for a no).
 * Only aal2 is asked about: below it, the answer is no without asking.
 */
export function cachedGlobalViewerOn(ask: (profileId: string) => Promise<boolean>, now: () => number = Date.now) {
  const cache = new TtlCache<boolean>(MAX_ENTRIES, now);
  return async (profileId: string, aal: string | undefined): Promise<boolean> => {
    if (aal !== 'aal2') return false;
    const known = cache.get(profileId);
    if (known !== undefined) return known;
    const on = await ask(profileId);
    cache.set(profileId, on, now() + (on ? AUTH_TTL_MS : DENIAL_TTL_MS));
    return on;
  };
}

