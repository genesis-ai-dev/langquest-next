import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { noteExpected } from './report';
import { v2Welcome } from './server/v2';
import { parseWelcome, type V2Welcome } from './welcomeBack';

/**
 * Welcome back's answer for this account (welcomeBack.ts), while `wanted`
 * (from v2, not yet welcomed). `loaded` holds routing until it is in, so a first sign-in lands
 * on Welcome back and not on the plain welcome. `refresh` asks again: Check
 * again, when their work is still on its way. The last answer stays on the
 * phone, so the screen still says it offline.
 */
export function useWelcomeBack(actorId: string, wanted: boolean): {
  data: V2Welcome | null;
  loaded: boolean;
  refresh: () => Promise<V2Welcome | null>;
} {
  const key = `v2welcome:${actorId}`;
  const [data, setData] = useState<V2Welcome | null>(null);
  const [done, setDone] = useState(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  const ask = useCallback(async (): Promise<V2Welcome | null> => {
    const { data: raw, error } = await v2Welcome();
    if (error) { noteExpected('v2 welcome', error); return null; }
    const w = parseWelcome(raw);
    if (w) {
      AsyncStorage.setItem(key, JSON.stringify(w)).catch(() => {});
      if (active.current) setData(w);
    }
    return w;
  }, [key]);

  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void (async () => {
      const cached = parseWelcome(JSON.parse((await AsyncStorage.getItem(key).catch(() => null)) ?? 'null'));
      if (cached && live) setData(cached);
      await ask();
    })().catch((e: unknown) => noteExpected('v2 welcome', e)).finally(() => { if (live) setDone(true); });
    return () => { live = false; };
  }, [wanted, key, ask]);

  return { data: wanted ? data : null, loaded: !wanted || done, refresh: ask };
}
