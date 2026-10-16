// What is kept on this phone, for screens to follow (sync/offline.tsx).
import { offlineSummary } from '@langquest-next/core';
import { useMemo } from 'react';
import type { Ctx } from '../shell/ctx';
import { keptOfflineMap, type OfflineOverview } from './offlineText';
import { useSyncExternalStore } from 'react';
import { onStudyFiles, studyRevision } from '../study/studyFiles';

export function useOfflineSummary(ctx: Ctx): OfflineOverview | null {
  const state = ctx.language.state;
  const { present, keptUnits } = ctx.language.blobs;
  const me = ctx.session.actorId;
  const rev = useStudyRevision();
  return useMemo(() => {
    if (!state) return null;
    const audio = offlineSummary(state, present, me, keptUnits);
    const kept = [...keptOfflineMap(ctx).values()];
    return { ...audio, ready: kept.filter((u) => u.ready).length, studyToFetch: kept.reduce((n, u) => n + u.studyTotal - u.studyHere, 0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ctx is read for the same inputs listed here
  }, [state, present, keptUnits, me, rev]);
}

/** Re-render when a study file arrives or the prefetcher learns a guide. */
export function useStudyRevision(): number {
  return useSyncExternalStore(onStudyFiles, studyRevision, studyRevision);
}
