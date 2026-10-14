import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import type { RecentPassage } from '../ctx';

/** Passages this person opened lately (WORK-2), newest first, twelve at most, per organization on this device. */
export function useRecentPassages(actorId: string, orgId: string) {
  const recentKey = `recent:${actorId}:${orgId}`;
  const [recent, setRecent] = useState<RecentPassage[]>([]);
  useEffect(() => { AsyncStorage.getItem(recentKey).then((v) => setRecent(v ? JSON.parse(v) : [])).catch(() => {}); }, [recentKey]);
  const remember = useCallback((unitId: string, inLanguage: string) => {
    setRecent((prev) => {
      const next = [{ unitId, languageId: inLanguage, at: Date.now() }, ...prev.filter((r) => r.unitId !== unitId || r.languageId !== inLanguage)].slice(0, 12);
      AsyncStorage.setItem(recentKey, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, [recentKey]);
  return { recent, remember };
}
