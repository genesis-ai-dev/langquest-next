// The Bibles this person keeps, for screens to follow (sources/store.ts).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { listeners, loadKeptIndex, myKey, myListeners, readMine, type MyBible } from './store';

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
