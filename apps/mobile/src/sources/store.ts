// The device side of sources: the Bible Brain client with its answers kept
// in AsyncStorage, and the person's own Bibles (device-local, per account,
// organization and language). Account deletion forgets both kinds of key
// that name the account (accountDeletion.ts); kept Bible Brain answers are
// public text, shared by every account on the phone.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { reportsServer } from '../useOrgSummary';
import { BibleBrainClient, CACHE_PREFIX, textKey, type JsonCache } from './bibleBrain';

const kept = new Set<string>();
const listeners = new Set<() => void>();
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

/** Re-render when answers are kept. */
export function useKeptRevision(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const l = () => setN((x) => x + 1);
    listeners.add(l);
    void loadKeptIndex();
    return () => { listeners.delete(l); };
  }, []);
  return n;
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

const myKey = (actorId: string, orgId: string, languageId: string) => `my-bibles:${actorId}:${orgId}:${languageId}`;
const myListeners = new Set<() => void>();

async function readMine(key: string): Promise<MyBible[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const list = raw ? (JSON.parse(raw) as MyBible[]) : [];
    return Array.isArray(list) ? list.filter((b) => b && typeof b.itemId === 'string') : [];
  } catch {
    return [];
  }
}

/** The person's own Bibles for one language, on this phone. */
export function useMyBibles(actorId: string, orgId: string, languageId: string | null | undefined) {
  const key = languageId ? myKey(actorId, orgId, languageId) : null;
  const [list, setList] = useState<MyBible[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!key) { setList([]); setLoaded(true); return; }
    let live = true;
    const load = () => void readMine(key).then((l) => { if (live) { setList(l); setLoaded(true); } });
    load();
    myListeners.add(load);
    return () => { live = false; myListeners.delete(load); };
  }, [key]);
  const save = useCallback(async (next: MyBible[]) => {
    if (!key) return;
    await AsyncStorage.setItem(key, JSON.stringify(next));
    for (const l of myListeners) l();
  }, [key]);
  const add = useCallback(async (b: MyBible) => {
    if (!key) return;
    const now = await readMine(key);
    if (!now.some((x) => x.itemId === b.itemId)) await save([...now, b]);
  }, [key, save]);
  const remove = useCallback(async (itemId: string) => {
    if (!key) return;
    await save((await readMine(key)).filter((x) => x.itemId !== itemId));
  }, [key, save]);
  return useMemo(() => ({ list, loaded, add, remove, has: (itemId: string) => list.some((b) => b.itemId === itemId) }), [list, loaded, add, remove]);
}
