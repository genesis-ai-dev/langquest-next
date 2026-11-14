import AsyncStorage from '@react-native-async-storage/async-storage';
import { keepChainName } from './chainNamesModel';

/**
 * Names from checked chains, by account (docs/nearby-sync-plan.md 14.1, 5 "Teammates"): someone
 * let in offline, shown under the name in their chain wherever the directory has none, until the
 * server knows them. Kept in `chain-names:<actorId>`, apart from the directory a server read
 * replaces whole; `useDisplayNames` lays them under it (chainNamesModel.ts).
 */
const held = new Map<string, Record<string, string>>();
const listeners = new Set<() => void>();
const keyOf = (actorId: string) => `chain-names:${actorId}`;

/** What is held for this account, once read; undefined before. */
export function chainNamesHere(actorId: string): Record<string, string> | undefined {
  return held.get(actorId);
}

/** Be told when a name is kept. Returns the unsubscribe. */
export function onChainNames(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** This account's names, read from the phone the first time. Anything unreadable reads as none. */
export async function readChainNames(actorId: string): Promise<Record<string, string>> {
  const here = held.get(actorId);
  if (here) return here;
  const read: Record<string, string> = {};
  try {
    const raw = JSON.parse((await AsyncStorage.getItem(keyOf(actorId))) ?? '{}') as unknown;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [id, n] of Object.entries(raw)) if (typeof n === 'string') read[id] = n;
  } catch { /* none */ }
  const now = held.get(actorId) ?? read;
  held.set(actorId, now);
  return now;
}

/** Keep the name a checked chain gives someone let in offline, for this account's screens. */
export async function noteChainName(actorId: string, profileId: string, name: string): Promise<void> {
  const next = keepChainName(await readChainNames(actorId), profileId, name);
  if (!next) return;
  held.set(actorId, next);
  for (const hear of listeners) hear();
  await AsyncStorage.setItem(keyOf(actorId), JSON.stringify(next));
}
