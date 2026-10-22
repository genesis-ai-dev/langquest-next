import { ClientTooOldError, type SupabaseTransport } from '@langquest-next/sync';

/**
 * Below the lowest version that may still sync (appVersionModel.ts,
 * decisions.md 150), every stream's transport refuses as the server does for
 * a client too old (LQ001): sync stops, and the person's work stays on the
 * phone, marked to send, until the app is updated.
 */
let tooOld = false;

export function setBelowMinimum(below: boolean) {
  tooOld = below;
}

export function belowMinimum(): boolean {
  return tooOld;
}

/** The transport, refusing every call while this version is below the minimum. */
export function gated(transport: SupabaseTransport): SupabaseTransport {
  return new Proxy(transport, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        if (tooOld) return Promise.reject(new ClientTooOldError('below_min_version'));
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    }
  });
}
