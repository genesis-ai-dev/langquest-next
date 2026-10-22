import { ClientTooOldError, type SupabaseTransport } from '@langquest-next/sync';

/**
 * Below the lowest version that may still sync (appVersionModel.ts,
 * decisions.md 150), the phone sends its waiting work first, then stops:
 * every stream's transport still sends (`append`), and refuses everything
 * that downloads other people's changes as the server does for a client too
 * old (LQ001). The sync client sends before it downloads, so each sync sends
 * what waits and then reports the app too old. A send that fails, for
 * example because a server call it uses is gone, throws instead of refusing
 * the events, so the work stays on the phone, marked to send, and goes once
 * the app is updated. Recordings go through their own transport
 * (blobTransport.ts), which this does not stop.
 */
let tooOld = false;

export function setBelowMinimum(below: boolean) {
  tooOld = below;
}

export function belowMinimum(): boolean {
  return tooOld;
}

/** What still reaches the server below the minimum: sending the phone's own work. */
const SENDS = new Set<PropertyKey>(['append']);

/** The transport, refusing every download while this version is below the minimum. */
export function gated(transport: SupabaseTransport): SupabaseTransport {
  return new Proxy(transport, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        if (tooOld && !SENDS.has(key)) return Promise.reject(new ClientTooOldError('below_min_version'));
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    }
  });
}
