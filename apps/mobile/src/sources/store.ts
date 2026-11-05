// The device side of sources: the Bible Brain client with its answers kept
// in AsyncStorage, and the person's own Bibles (device-local, per account,
// organization and language). Account deletion forgets both kinds of key
// that name the account (accountDeletion.ts); kept Bible Brain answers are
// public text, shared by every account on the phone.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportsServer } from '../reports/reportsServer';
import { BibleBrainClient, CACHE_PREFIX, textKey, type JsonCache } from './bibleBrain';

const kept = new Set<string>();
export const listeners = new Set<() => void>();
const notify = () => { for (const l of listeners) l(); };
let indexed: Promise<void> | null = null;

/** One listing of kept answers, so "on this phone" can be said without waiting. */
export function loadKeptIndex(): Promise<void> {
  indexed ??= AsyncStorage.getAllKeys()
    .then((keys) => { for (const k of keys) if (k.startsWith(CACHE_PREFIX)) kept.add(k); notify(); })
    .catch(() => undefined);
  return indexed;
}

const cache: JsonCache = {
  get: (k) => AsyncStorage.getItem(k),
  set: async (k, v) => {
    await AsyncStorage.setItem(k, v);
    if (!kept.has(k)) { kept.add(k); notify(); }
  }
};

/** Null on a phone build that has no Worker address (EXPO_PUBLIC_API_URL): explore then says Bible Brain isn't set up. */
export const bibleBrain: BibleBrainClient | null = reportsServer ? new BibleBrainClient(reportsServer, cache) : null;

/** A chapter's Bible Brain text is on this phone. */
export function textKept(filesetId: string, book: string, chapter: number): boolean {
  return kept.has(CACHE_PREFIX + textKey(filesetId, book, chapter));
}

// ---- My Bibles ------------------------------------------------------------------------------

/** A Bible the translator chose for themselves: a library source, or one explored on Bible Brain. */
export interface MyBible {
  itemId: string;
  kind: 'library' | 'biblebrain';
  name: string;
  abbreviation: string;
  language: string;
  bibleId?: string;
}

export const myKey = (actorId: string, orgId: string, languageId: string) => `my-bibles:${actorId}:${orgId}:${languageId}`;
export const myListeners = new Set<() => void>();

export async function readMine(key: string): Promise<MyBible[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const list = raw ? (JSON.parse(raw) as MyBible[]) : [];
    return Array.isArray(list) ? list.filter((b) => b && typeof b.itemId === 'string') : [];
  } catch {
    return [];
  }
}

