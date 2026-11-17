import { OfflineError, type SupabaseTransport } from '@langquest-next/sync';
import { savedSignIn } from '../server/auth';
import { localPersonHolds } from '../server/localPerson';

/**
 * While a local person holds the phone with no session saved (docs/nearby-sync-plan.md 14.1, 5
 * "Requests"), the transport asks the server nothing: each call fails as offline, so their
 * events stay `pending` and nothing is marked refused, because `pushNow` marks what the server
 * answers as rejected. Asked at each call, so the streams already open go on as soon as first
 * contact saves a session. The live channel waits the same way.
 */
export function untilFirstContact(transport: SupabaseTransport): SupabaseTransport {
  const closed = async () => localPersonHolds() && (await savedSignIn()) === null;
  return new Proxy(transport, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') return value;
      const call = (...args: unknown[]) => (value as (...a: unknown[]) => unknown).apply(target, args);
      if (key === 'watch') {
        return (...args: unknown[]) => {
          if (!localPersonHolds()) return call(...args);
          let off: (() => void) | null = null;
          let gone = false;
          void closed().then((shut) => { if (!shut && !gone) off = call(...args) as () => void; }, () => undefined);
          return () => { gone = true; off?.(); };
        };
      }
      return async (...args: unknown[]) => {
        // i18n-ignore: the error's message, for the sync layer and diagnostics
        if (await closed()) throw new OfflineError('A local person has no session until first contact.');
        return call(...args);
      };
    }
  });
}
