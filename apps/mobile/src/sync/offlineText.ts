// What is kept on this phone, and how it is said (sync/offline.tsx).
import type { OfflineSummary, UnitOffline } from '@langquest-next/core';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { formatBytes } from '../i18n/format';
import { studyCounts, studyRevision } from '../study/studyFiles';

/** A passage's audio counts with its study files folded in: ready means both are here. */
export type KeptOffline = UnitOffline & { studyHere: number; studyTotal: number };

export function withStudy(u: UnitOffline, unitId: string): KeptOffline {
  const { here, total } = u.reason ? studyCounts(unitId) : { here: 0, total: 0 };
  return { ...u, studyHere: here, studyTotal: total, ready: u.ready && here === total };
}

/**
 * Counts for every kept passage, for marks on long lists. A passage missing
 * from the map is not kept. Shared by every row drawn from the same inputs.
 * Worked out from the phone's table after changes (useLanguage), not on
 * every draw (decisions.md 134).
 */
export function keptOfflineMap(ctx: Ctx): Map<string, KeptOffline> {
  const counted = ctx.language.blobs.keptOffline;
  if (!counted) return new Map();
  const rev = studyRevision();
  const last = keptCache;
  if (last && last.counted === counted && last.rev === rev) return last.map;
  const map = new Map<string, KeptOffline>();
  for (const [id, u] of counted) map.set(id, withStudy(u, id));
  keptCache = { counted, rev, map };
  return map;
}

export let keptCache: { counted: ReadonlyMap<string, UnitOffline>; rev: number; map: Map<string, KeptOffline> } | null = null;

/** The whole scope: audio from core, with passages counted ready only once their study files are here too. */
export type OfflineOverview = OfflineSummary & { studyToFetch: number };

/** Words for a Map row's screen reader label. */
export function offlineWords(u: KeptOffline | undefined): string {
  if (!u?.reason) return t('offline.audioNotKept');
  return u.ready ? t('offline.onDevice') : t('offline.downloading');
}

/** Settings' one line. */
export function offlineLine(s: OfflineOverview | null): string {
  if (!s) return t('offline.summary.checking');
  if (s.kept === 0) return t('offline.summary.noneKept');
  if (s.ready === s.kept) return t('offline.summary.allReady', { count: s.kept });
  const size = s.bytesToFetch ? formatBytes(s.bytesToFetch) : null;
  const studyFiles = s.studyToFetch ? t('offline.summary.studyFiles', { count: s.studyToFetch }) : null;
  const counts = { ready: s.ready, count: s.kept };
  if (size && studyFiles) return t('offline.summary.someReadyAudioStudy', { ...counts, size, studyFiles });
  if (size) return t('offline.summary.someReadyAudio', { ...counts, size });
  if (studyFiles) return t('offline.summary.someReadyStudy', { ...counts, studyFiles });
  return t('offline.summary.someReady', counts);
}
