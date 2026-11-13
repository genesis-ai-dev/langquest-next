// i18n-ignore-file: HTTP plumbing; its strings are header names and error messages for the sync layer, never shown.
import type { Session } from '@supabase/supabase-js';
import { savedSession } from '../session/authState';
import { noteRefusal } from '../session/signOutCause';

/**
 * The fetch every Supabase client on the phone uses (decision 87). Two
 * rules keep a person signed in through a long time offline and a moment
 * online:
 *
 * - Renewing the sign-in: supabase-js keeps the saved sign-in only when the
 *   network failed or the server answered 5xx; any other answer, with an
 *   expired token, deletes it. A 429 when many phones share one connection,
 *   or a web page from something between the phone and Supabase, is not the
 *   server saying the sign-in is over, so those reach supabase-js as a
 *   network failure and it tries again later. Only Supabase Auth's own
 *   error, with its code, ends a sign-in.
 * - Everything else: while the sign-in cannot be renewed, supabase-js sends
 *   requests with the public key, as no one, and the server answers "not a
 *   member". A person who still has a saved sign-in is offline for this,
 *   not refused, so such a request fails as a network failure would.
 *
 * Pure (no app imports), so the tests run it against supabase-js itself.
 */
export interface SessionSafeOptions {
  /** The project's public key: a request carrying it as its bearer is sent as no one. */
  anonKey: string;
  /** Whether this client's storage still holds a sign-in. */
  hasSavedSession: () => Promise<boolean>;
  /**
   * Whether a local person holds the phone (docs/nearby-sync-plan.md 14.1, 5 "Requests"): they
   * have no session until first contact, and a request as no one would be refused, not offline,
   * which would mark their work refused. So it fails as offline, but for a helper's code
   * (`sign-in-code`), which is how one whose key no longer signs in gets their session, and
   * which the function refuses for a code made for anyone else.
   */
  localPersonHolds?: () => boolean;
  /** Told when a renewal could not reach Supabase Auth, and when one worked (answerAtOnceWhileOffline). */
  watch?: RenewalWatch;
  /** The fetch underneath; the global one when left out. */
  base?: typeof fetch;
}

/** When a renewal last failed for want of a network (or a busy one); null once one has worked. */
export interface RenewalWatch {
  failedAt: number | null;
  /** How renewing fails now, when it does, and since when; when one last worked. For `renewalChanges`. */
  failing?: 'offline' | 'http';
  failingSince?: number;
  okAt?: number;
}

/**
 * Renewal changed state: it started failing (no network, or an answer that
 * is not Supabase Auth's: 429, 5xx, a hotspot's page), or worked again.
 * `ms`: how long it had been failing; `sinceOkMs`: since one last worked,
 * when one has since the app started. Told once per change, never per try.
 */
export type RenewalChange =
  | { outcome: 'offline' }
  | { outcome: 'http'; status: number }
  | { outcome: 'ok'; ms: number; sinceOkMs?: number };

/** Who hears a renewal change (diagnostics); module-wide, so the clients made in supabase.ts need no option for it. */
export const renewalChanges = new Set<(change: RenewalChange) => void>();

/**
 * Changes told while nobody listened, oldest first, for the first listener
 * (`listenToRenewals`). supabase-js renews an expired sign-in as soon as its
 * client is made, before the app's first render starts listening, and a
 * browser opened with no connection fails at once: that failure was never
 * recorded, only the later recovery (field snapshot, 2026-11-03).
 */
const unheard: RenewalChange[] = [];
const UNHEARD_MAX = 4;

function tell(change: RenewalChange): void {
  if (renewalChanges.size === 0) {
    unheard.push(change);
    if (unheard.length > UNHEARD_MAX) unheard.shift();
    return;
  }
  for (const listener of renewalChanges) {
    try { listener(change); } catch { /* a listener never breaks a renewal */ }
  }
}

/** Hear renewal changes, starting with any told before anyone listened. Returns the unsubscribe. */
export function listenToRenewals(listener: (change: RenewalChange) => void): () => void {
  renewalChanges.add(listener);
  for (const change of unheard.splice(0)) {
    try { listener(change); } catch { /* a listener never breaks a renewal */ }
  }
  return () => { renewalChanges.delete(listener); };
}

/** Track a renewal's result on its watch, telling listeners only when the state changes. */
function renewed(watch: RenewalWatch | undefined, result: { failed: 'offline' } | { failed: 'http'; status: number } | { failed: null }, now = Date.now()): void {
  if (!watch) return;
  if (result.failed === null) {
    watch.failedAt = null;
    if (watch.failing) {
      tell({ outcome: 'ok', ms: now - (watch.failingSince ?? now), ...(watch.okAt !== undefined ? { sinceOkMs: now - watch.okAt } : {}) });
    }
    delete watch.failing;
    delete watch.failingSince;
    watch.okAt = now;
    return;
  }
  watch.failedAt = now;
  if (watch.failing === result.failed) return;
  if (!watch.failing) watch.failingSince = now;
  watch.failing = result.failed;
  tell(result.failed === 'http' ? { outcome: 'http', status: result.status } : { outcome: 'offline' });
}

/** The message fetch failures carry, so OfflineError (supabaseTransport.ts) and supabase-js both read it as no network. */
export const NOT_RENEWED = 'Network request failed: the sign-in could not be renewed yet';

export function sessionSafeFetch(opts: SessionSafeOptions): typeof fetch {
  const base = opts.base ?? ((input, init) => fetch(input, init));
  return async (input, init) => {
    const url = urlOf(input);
    if (isRenewal(url)) {
      const watch = opts.watch;
      let res: Response;
      try {
        res = await base(input, init);
      } catch (e) {
        renewed(watch, { failed: 'offline' });
        throw e;
      }
      if (res.ok) {
        renewed(watch, { failed: null });
        return res;
      }
      const refusal = await refusalOf(res);
      if (refusal) {
        // The server ended the sign-in; supabase-js signs out next (signOutCause.ts says why).
        noteRefusal(refusal.code, res.status);
        if (watch) { watch.failedAt = null; delete watch.failing; delete watch.failingSince; }
        return res;
      }
      renewed(watch, { failed: 'http', status: res.status });
      throw new TypeError(`Network request failed: sign-in renewal answered ${res.status}`);
    }
    if (isData(url) && bearerOf(input, init) === opts.anonKey &&
        ((opts.localPersonHolds?.() === true && !isHelperCode(url)) || await opts.hasSavedSession())) {
      throw new TypeError(NOT_RENEWED);
    }
    return base(input, init);
  };
}

/**
 * Supabase Auth's own refusal: JSON with an error code, and not a rate
 * limit or a timeout. Answers its code (`refresh_token_not_found`), kept
 * only when it is code-shaped, or null when this is not a refusal.
 */
async function refusalOf(res: Response): Promise<{ code?: string } | null> {
  if (res.status === 408 || res.status === 429 || res.status >= 500) return null;
  try {
    const body = (await res.clone().json()) as { code?: unknown; error_code?: unknown } | null;
    const code = typeof body?.error_code === 'string' ? body.error_code : typeof body?.code === 'string' ? body.code : null;
    if (code === null) return null;
    return /^[A-Za-z0-9_]{1,40}$/.test(code) ? { code } : {};
  } catch {
    return null;
  }
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isRenewal(url: string): boolean {
  return /\/auth\/v1\/token\?(.*&)?grant_type=refresh_token(&|$)/.test(url);
}

/** Requests that act as the person: the database, files and functions. Auth's own calls are left alone. */
function isData(url: string): boolean {
  return /\/(rest|storage|functions)\/v1\//.test(url);
}

/** A helper's sign-in code: holding the code is the permission, so it goes as no one. */
function isHelperCode(url: string): boolean {
  return /\/functions\/v1\/sign-in-code([?#]|$)/.test(url);
}

function bearerOf(input: RequestInfo | URL, init: RequestInit | undefined): string | null {
  const headers = new Headers(init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined));
  const auth = headers.get('Authorization');
  return auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
}

/**
 * supabase-js retries a failed renewal for about 25 seconds, and every call
 * that needs the person's token waits for it, the first one after the app
 * starts included: offline, a screen waiting on one call stayed blank that
 * long. While a renewal has just failed for want of a network, a sign-in
 * that needs renewing answers at once: still good, it is used; expired, the
 * call goes as offline (the fetch above stops it). supabase-js's own timer
 * keeps renewing in the background, and the first renewal that works ends
 * this.
 */
export function answerAtOnceWhileOffline(
  auth: { getSession: () => Promise<{ data: { session: Session | null }; error: unknown }> },
  opts: { readSaved: () => Promise<string | null>; watch: RenewalWatch; now?: () => number }
): void {
  const original = auth.getSession.bind(auth);
  const now = opts.now ?? Date.now;
  auth.getSession = async () => {
    const failedAt = opts.watch.failedAt;
    if (failedAt !== null && now() - failedAt < RECENT_MS) {
      const saved = savedSession(await opts.readSaved());
      const expiresMs = (saved?.expires_at ?? 0) * 1000;
      // supabase-js renews within 90 seconds of expiry; before that it answers at once by itself.
      if (saved && expiresMs - now() < RENEW_MARGIN_MS) {
        return { data: { session: expiresMs > now() ? saved : null }, error: null };
      }
    }
    return original();
  };
}

/** Long enough to span supabase-js's cooldown after a failed renewal (60 s) and its next try. */
const RECENT_MS = 120_000;
const RENEW_MARGIN_MS = 90_000;
