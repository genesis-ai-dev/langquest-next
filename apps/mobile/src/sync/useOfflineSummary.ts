// What is kept on this phone, for screens to follow (sync/offline.tsx).
import { useMemo, useSyncExternalStore } from 'react';
import type { Ctx } from '../shell/ctx';
import { keptOfflineMap, type OfflineOverview } from './offlineText';
import { onStudyFiles, studyRevision } from '../study/studyFiles';

/**
 * The whole scope: the audio counts worked out from the phone's table after
 * changes (decisions.md 143), with passages counted ready only once their
 * study files are here too. Null until first counted.
 */
export function useOfflineSummary(ctx: Ctx): OfflineOverview | null {
  const { offlineSummary: audio, keptOffline } = ctx.language.blobs;
  const rev = useStudyRevision();
  return useMemo(() => {
    if (!audio) return null;
    const kept = [...keptOfflineMap(ctx).values()];
    return { ...audio, ready: kept.filter((u) => u.ready).length, studyToFetch: kept.reduce((n, u) => n + u.studyTotal - u.studyHere, 0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ctx is read for the same inputs listed here
  }, [audio, keptOffline, rev]);
}

/** Re-render when a study file arrives or the prefetcher learns a guide. */
export function useStudyRevision(): number {
  return useSyncExternalStore(onStudyFiles, studyRevision, studyRevision);
}
