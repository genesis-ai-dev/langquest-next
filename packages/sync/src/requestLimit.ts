import { OfflineError, type Transport } from './types';

/**
 * How long one call to the server may go without an answer before a sync
 * stops waiting for it. A backup: the app's own fetch stops a request at 2
 * minutes (apps/mobile/src/server/sessionSafeFetch.ts, ANSWER_WITHIN_MS), so
 * this fires only when that limit did not, as for a request that goes
 * around it. A sync holds its stream's turn while its call is out, and
 * without an end that stream sent and fetched nothing more until the app
 * restarted (LAN-339).
 */
export const REQUEST_LIMIT_MS = 150_000;

/** The message of a call the sync stopped waiting for: it reads as offline. */
export const NO_ANSWER_IN_TIME = 'Network request failed: the server did not answer in time';

/**
 * `transport`, each of whose calls fails as offline once it has waited `ms`
 * for its answer; `late` hears the call's name. The call itself is not
 * stopped (nothing here can stop it), only the wait for it: the next sync
 * sends it again, and every call is safe to repeat (appends are idempotent
 * by event id). A call that answers at once (`watch`) is passed on as it is.
 */
export function withRequestLimit<T extends Transport>(transport: T, ms: number, late: (call: string) => void): T {
  return new Proxy(transport, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const out: unknown = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (!isPromiseLike(out)) return out;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const waited = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            late(String(prop));
            reject(new OfflineError(NO_ANSWER_IN_TIME));
          }, ms);
        });
        return Promise.race([out, waited]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
      };
    }
  });
}

function isPromiseLike(v: unknown): v is PromiseLike<unknown> {
  return typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function';
}
