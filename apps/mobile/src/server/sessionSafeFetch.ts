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
 * And every request gets its answer within ANSWER_WITHIN_MS, or fails as a
 * lost network does (`answerWithin`); one still out when the network goes or
 * comes back is stopped (`stopRequestsInFlight`).
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
  /** How long a request may wait for its answer; ANSWER_WITHIN_MS when left out. */
  answerWithinMs?: number;
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

/**
 * How long a request may wait for its answer. React Native's fetch on
 * Android sets no time limit, and its promise settles only once the whole
 * answer is in: a request whose connection died with the network waited for
 * ever. A sync holds its language's turn while its request is out, so that
 * language sent and fetched nothing more until the app restarted, while the
 * organization's sync and the live channel went on (LAN-339). Long enough
 * for the largest answer, a snapshot's 256 KB piece, on a slow link.
 */
export const ANSWER_WITHIN_MS = 120_000;

/** The message of a request that got no answer in time: "Network request failed", so it reads as offline. */
export const NO_ANSWER = 'Network request failed: no answer in time';

/** The message of a request stopped because the network went or came back (`stopRequestsInFlight`). */
export const NETWORK_CHANGED = 'Network request failed: the network changed';

/** Why the app stopped a request: no answer in time, or the network changed. For field diagnostics (`listenToStops`). */
export type StopReason = 'no_answer' | 'network_changed';

const stopListeners = new Set<(why: StopReason) => void>();

/** Hear each request the app stops, and why. Returns the unsubscribe. */
export function listenToStops(listener: (why: StopReason) => void): () => void {
  stopListeners.add(listener);
  return () => { stopListeners.delete(listener); };
}

function told(why: StopReason): void {
  for (const listener of stopListeners) {
    try { listener(why); } catch { /* a listener never breaks a request */ }
  }
}

/** A request still waiting for its answer or its body: when it began, and how to stop it. */
interface InFlight {
  startedAt: number;
  stop: (error: TypeError, why: StopReason) => void;
}

/** Requests `stopRequestsInFlight` may stop. A renewal is never one of them (`sessionSafeFetch`). */
const inFlight = new Set<InFlight>();

/**
 * Stop every request still waiting for its answer, as a lost network does:
 * a request sent before the network went or came back waits on a
 * connection that is gone, and stays out until its time limit. Stopped
 * now, the sync that the same change wakes sends it again at once
 * (sync/wake.ts). Answers how many it stopped.
 */
export function stopRequestsInFlight(): number {
  const now = [...inFlight];
  for (const request of now) request.stop(new TypeError(NETWORK_CHANGED), 'network_changed');
  return now.length;
}

/** The app stopped this request: no answer in time, or the network changed. */
export function isStoppedRequest(e: unknown): e is TypeError {
  return e instanceof TypeError && (e.message === NO_ANSWER || e.message === NETWORK_CHANGED);
}

/** The ways a body is read; each is held to the request's time limit (`answerWithin`). */
const BODY_READS = ['arrayBuffer', 'blob', 'bytes', 'formData', 'json', 'text'] as const;

/**
 * `base`, failing as a lost network does once a request has waited `ms`
 * for its answer and its body, and stopping the request. The limit holds
 * until the body is read: Expo's fetch answers as soon as the headers come,
 * and a body can stop coming too. A caller's own signal still stops it.
 * `listed: false` leaves it out of `stopRequestsInFlight`. `idle: true`
 * holds the body to `ms` between one piece and the next instead
 * (`whileBytesCome`), for a download whose size is not known before it starts.
 */
export function answerWithin(base: typeof fetch, ms: number, opts: { listed?: boolean; idle?: boolean } = {}): typeof fetch {
  return (input, init) => {
    const halt = new AbortController();
    const theirs = init?.signal ?? undefined;
    const passOn = () => halt.abort(theirs?.reason);
    if (theirs?.aborted) passOn();
    else theirs?.addEventListener('abort', passOn);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let over = false;
    const request: InFlight = { startedAt: Date.now(), stop: () => {} };
    const done = () => {
      over = true;
      clearTimeout(timer);
      inFlight.delete(request);
      theirs?.removeEventListener('abort', passOn);
    };
    // Settles first even when `base` ignores the stop, as a request on a dead connection may.
    const failed = new Promise<never>((_, reject) => {
      request.stop = (error, why) => {
        done();
        reject(error);
        halt.abort(error);
        told(why);
      };
    });
    // Starts the limit again; never once the request is over.
    const arm = () => {
      if (over) return;
      clearTimeout(timer);
      timer = setTimeout(() => request.stop(new TypeError(NO_ANSWER), 'no_answer'), ms);
    };
    arm();
    if (opts.listed !== false) inFlight.add(request);
    // A `base` that throws at once fails this request too, and its timer goes with it.
    const sent = new Promise<Response>((resolve) => resolve(base(input, { ...init, signal: halt.signal })));
    return Promise.race([sent, failed]).then(
      (res) => (opts.idle && res.body ? whileBytesCome(res, failed, arm, done) : readWithin(res, failed, done)),
      (e: unknown) => { done(); throw e; }
    );
  };
}

/** `res`, its body reads held to the request's limit: the first read that settles ends the limit. */
function readWithin(res: Response, failed: Promise<never>, done: () => void): Response {
  for (const name of BODY_READS) {
    const read = (res as unknown as Record<string, unknown>)[name];
    if (typeof read !== 'function') continue;
    Object.defineProperty(res, name, {
      configurable: true,
      value: (...args: unknown[]) => Promise.race([(read as (...a: unknown[]) => Promise<unknown>).apply(res, args), failed]).finally(done)
    });
  }
  return res;
}

/**
 * `res` with a body held to the limit between one piece and the next: each
 * read of a piece starts the limit again (`arm`), so a slow link that keeps
 * sending finishes and a dead one fails. The end of the body, its failure or
 * a cancel ends the limit. Cancel the body of an answer you do not read.
 */
function whileBytesCome(res: Response, failed: Promise<never>, arm: () => void, done: () => void): Response {
  const reader = res.body!.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      arm();
      try {
        const piece = await Promise.race([reader.read(), failed]);
        if (piece.done) {
          done();
          controller.close();
        } else controller.enqueue(piece.value);
      } catch (e) {
        done();
        controller.error(e);
      }
    },
    cancel(reason) {
      done();
      return reader.cancel(reason);
    }
  });
  // Its reads also race the stop, so a stopped download fails with the app's own error.
  return readWithin(new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers }), failed, done);
}

/**
 * The global fetch, held to the same limit: the app's calls to its Worker
 * (nearby.ts, blobTransport.ts), which go through no Supabase client. A file
 * the web sends whole takes `transferLimitMs` instead.
 */
export function limitedFetch(input: RequestInfo | URL, init?: RequestInit, ms = ANSWER_WITHIN_MS): Promise<Response> {
  return answerWithin((i, n) => fetch(i, n), ms)(input, init);
}

/**
 * The global fetch for a file the web downloads whole, whose size is not known before it starts:
 * its answer must come within `ms`, and then each piece of its body within `ms` of the last. A
 * network change stops it too (`stopRequestsInFlight`). Without a limit, a download on a dead
 * connection never ended, and held the downloads after it until the tab was reloaded (LAN-343).
 */
export function limitedDownload(input: RequestInfo | URL, init?: RequestInit, ms = ANSWER_WITHIN_MS): Promise<Response> {
  return answerWithin((i, n) => fetch(i, n), ms, { idle: true })(input, init);
}

/** The slowest link a whole file is given time for: 4 KB a second (32 kbit/s), more than a weak 2G link. */
const SLOWEST_BYTES_PER_S = 4_096;

/** How long a file of `bytes` may take to go whole in one request: ANSWER_WITHIN_MS, and its bytes at the slowest link. */
export function transferLimitMs(bytes: number): number {
  return ANSWER_WITHIN_MS + Math.ceil(bytes / SLOWEST_BYTES_PER_S) * 1000;
}

export function sessionSafeFetch(opts: SessionSafeOptions): typeof fetch {
  const global = opts.base ?? ((input, init) => fetch(input, init));
  const ms = opts.answerWithinMs ?? ANSWER_WITHIN_MS;
  const base = answerWithin(global, ms);
  // A renewal is never stopped on a network change: Supabase Auth may have used its token already,
  // and a token sent again after its 10 seconds of grace ends the sign-in. Its time limit stays.
  const renew = answerWithin(global, ms, { listed: false });
  return async (input, init) => {
    const url = urlOf(input);
    if (isRenewal(url)) {
      const watch = opts.watch;
      let res: Response;
      try {
        res = await renew(input, init);
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
