import type { LocalPerson } from '../session/localPersonModel';

/**
 * The local person (docs/nearby-sync-plan.md 14.1, 5). Joining offline is Android only, because
 * an iPhone cannot install an app offline and the web shares nothing nearby (decision 58), so
 * the record lives behind localPerson.android.ts. Here there is never one, and nothing of it
 * is in this bundle.
 */

export type { LocalPerson } from '../session/localPersonModel';

export async function readLocalPerson(): Promise<LocalPerson | null> {
  return null;
}

export function localPersonNow(): LocalPerson | null | undefined {
  return null;
}

export function onLocalPerson(_listener: (p: LocalPerson | null) => void): () => void {
  return () => {};
}

/** Never kept here: joining offline needs Android. */
export async function keepLocalPerson(_next: LocalPerson): Promise<boolean> {
  return false;
}

export async function updateLocalPerson(_profileId: string, _change: (p: LocalPerson) => LocalPerson): Promise<LocalPerson | null> {
  return null;
}

export async function forgetLocalPerson(_profileId: string): Promise<void> {}

export function localPersonHolds(): boolean {
  return false;
}
