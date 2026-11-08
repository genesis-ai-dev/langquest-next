import {
  isLocalIdentity, LOCAL_PERSON_KEY, localPersonText, mayKeepLocalPerson, parseLocalPerson, type LocalPerson
} from '../session/localPersonModel';
import { secureStorage } from './secureStorage';

/**
 * The local person on an Android phone (docs/nearby-sync-plan.md 14.1, 5 "Working"; the rules
 * are session/localPersonModel.ts): kept in `secureStorage` under its own name, outside any
 * session and outside decision 168's seal, since a local person has no session to seal it with
 * and cannot sign out. Read once, then held here, so the fetch gate can answer at once. Writes
 * go one at a time. Nothing here holds a key: the install key is nearbyKey.android.ts's.
 */

export type { LocalPerson } from '../session/localPersonModel';

let held: LocalPerson | null | undefined;
let reading: Promise<LocalPerson | null> | null = null;
const listeners = new Set<(p: LocalPerson | null) => void>();
let turn: Promise<unknown> = Promise.resolve();

function hold(p: LocalPerson | null): void {
  held = p;
  for (const listener of listeners) {
    try { listener(p); } catch { /* a listener never stops a write */ }
  }
}

/** The local person, read from storage the first time. */
export function readLocalPerson(): Promise<LocalPerson | null> {
  if (held !== undefined) return Promise.resolve(held);
  reading ??= secureStorage.getItem(LOCAL_PERSON_KEY).then(
    (raw) => { if (held === undefined) held = parseLocalPerson(raw); return held; },
    () => { held ??= null; return held; }
  ).finally(() => { reading = null; });
  return reading;
}

/** The record as last read or written; undefined until read. */
export function localPersonNow(): LocalPerson | null | undefined {
  return held;
}

/** Be told when the record changes. Returns the unsubscribe. */
export function onLocalPerson(listener: (p: LocalPerson | null) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Keep `next`, if it may replace what is held (one local person to an install; a stage never goes
 * back). Answers whether it was kept. The read before the write is the stored one, not the copy
 * held, so two callers cannot both win.
 */
export function keepLocalPerson(next: LocalPerson): Promise<boolean> {
  const run = turn.then(async () => {
    const stored = parseLocalPerson(await secureStorage.getItem(LOCAL_PERSON_KEY));
    if (!mayKeepLocalPerson(stored, next)) return false;
    await secureStorage.setItem(LOCAL_PERSON_KEY, localPersonText(next));
    hold(next);
    return true;
  });
  turn = run.catch(() => undefined);
  return run;
}

/** Change the held record of this person, if it is still theirs. Answers the record kept, or null. */
export async function updateLocalPerson(profileId: string, change: (p: LocalPerson) => LocalPerson): Promise<LocalPerson | null> {
  const now = await readLocalPerson();
  if (!now || now.profileId !== profileId) return null;
  const next = change(now);
  return (await keepLocalPerson(next)) ? next : null;
}

/** Remove this person's record, and only theirs (a stale caller never removes someone else's). */
export function forgetLocalPerson(profileId: string): Promise<void> {
  const run = turn.then(async () => {
    const stored = parseLocalPerson(await secureStorage.getItem(LOCAL_PERSON_KEY));
    if (stored && stored.profileId !== profileId) return;
    await secureStorage.removeItem(LOCAL_PERSON_KEY);
    hold(null);
  });
  turn = run.catch(() => undefined);
  return run;
}

/**
 * Does a local person hold this phone, so that a request as no one is offline, not refused
 * (section 14.1, 5 "Requests")? From `ready` until the certificate route answers after first
 * contact; once a session is saved, the session key answers that by itself.
 */
export function localPersonHolds(): boolean {
  return isLocalIdentity(held);
}
