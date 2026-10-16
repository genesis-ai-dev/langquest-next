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
} | null;

/**
 * Who a token belongs to, asking `verify` (Auth, while the project signs
 * with a shared secret) only the first time within a minute. Keyed by the
 * token's SHA-256, so the raw token is not kept. Only successes are
 * remembered, and never past the token's own expiry. Whether the token's
 * session is still live is asked on every call, cached or not
 * (`sessionLive`, decisions.md 118): remembering the token skips verifying
 * it again, never the check that it was signed out.
 */
export function cachedProfileOf(
  verify: (token: string) => Promise<Verified>,
  now: () => number = Date.now,
  sessionLive?: (sessionId: string) => Promise<boolean>
) {
  const cache = new TtlCache<NonNullable<Verified>>(MAX_ENTRIES, now);
  return async (token: string): Promise<string | null> => {
    const key = await sha256Hex(token);
    let verified: Verified = cache.get(key) ?? null;
    if (!verified) {
      verified = await verify(token);
      if (!verified?.sub) return null;
      const until = Math.min(now() + AUTH_TTL_MS, verified.exp !== undefined ? verified.exp * 1000 : Infinity);
      cache.set(key, verified, until);
    }
    if (verified.sessionId && sessionLive && !(await sessionLive(verified.sessionId))) return null;
    return verified.sub;
  };
}

/**
 * Whether a person may use a file, asking `ask` once per person, stream and
 * mode within 60 s (10 s for a refusal). Errors are not cached.
 *
 * Accepted trade-off (developer, V1): a member who is removed may keep
 * opening files for up to 60 s from the isolates that already answered for
 * them. A person just added may wait up to 10 s after a refusal.
 */
export function cachedBlobAccess(ask: (key: string, profileId: string, write: boolean) => Promise<boolean>, now: () => number = Date.now) {
  const cache = new TtlCache<boolean>(MAX_ENTRIES, now);
  return async (key: string, profileId: string, write: boolean): Promise<boolean> => {
    // `blob_access` answers per org and stream, except that library media in
    // an organization's own stream (`org/_org/hash`) is allowed per file.
    // Missing parts read as empty, as split_part does in SQL, so no two names share a key unless the SQL sees the same org and stream.
    const [org = '', stream = ''] = key.split('/');
    const scope = stream === '_org' ? key : `${org}/${stream}`;
    const id = `${profileId}|${scope}|${write ? 'w' : 'r'}`;
    const known = cache.get(id);
    if (known !== undefined) return known;
    const allowed = await ask(key, profileId, write);
    cache.set(id, allowed, now() + (allowed ? AUTH_TTL_MS : DENIAL_TTL_MS));
    return allowed;
  };
}
