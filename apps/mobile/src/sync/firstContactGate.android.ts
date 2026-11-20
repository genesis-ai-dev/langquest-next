import { OfflineError, type SupabaseTransport } from '@langquest-next/sync';
import { onAuthChange, savedSignIn } from '../server/auth';
import { localPersonHolds } from '../server/localPerson';

const opened = new Set<() => void>();

/**
 * Be told when first contact saves the session and the gate opens. Until then every sync was
 * turned away as offline, so each stream waits out its offline backoff, 15 seconds or more:
 * Sync said Offline that long after a newcomer's phone came back online, where a signed-in
 * phone said Online at once (Carl's test, 2026-11-20). Told, a stream syncs at once. Not
 * `onWake`, which would wake first contact too, in the middle of the turn that saved the session.
 */
export function onGateOpen(fn: () => void): () => void {
  opened.add(fn);
  return () => { opened.delete(fn); };
}

/** First contact saved the session: the streams the gate turned away sync now. */
export function gateOpened(): void {
  for (const fn of [...opened]) fn();
}

/**
 * While a local person holds the phone with no session saved (docs/nearby-sync-plan.md 14.1, 5
 * "Requests"), the transport asks the server nothing: each call fails as offline, so their
 * events stay `pending` and nothing is marked refused, because `pushNow` marks what the server
 * answers as rejected. Asked at each call, so the streams already open go on as soon as first
 * contact saves a session.
 *
 * The live channel is asked for once, when a stream opens, which for a newcomer is before first
 * contact. So it waits for the sign-in to change and opens once a session is saved. Checked only
 * when the stream opened, it never opened, and Sync said Connected, not Live, until the app
 * started again (Carl's offline onboarding test, 2026-11-18).
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
          // One check at a time; a sign-in change during one asks for another after it, so a session saved mid-check is not missed.
          let checking = false;
          let again = false;
          let listening: (() => void) | null = null;
          const stopListening = () => { listening?.(); listening = null; };
          const open = () => {
            if (gone || off) return;
            if (checking) { again = true; return; }
            checking = true;
            const settle = (shut: boolean) => {
              checking = false;
              if (gone || off) return;
              if (!shut) { off = call(...args) as () => void; stopListening(); return; }
              if (again) { again = false; open(); }
            };
            closed().then(settle, () => settle(true));
          };
          listening = onAuthChange((_event, session) => { if (session) open(); });
          open();
          return () => { gone = true; stopListening(); off?.(); };
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
