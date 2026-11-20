// What is kept on this phone, and how it is said (sync/offline.tsx).
import type { OfflineSummary, UnitOffline } from '@langquest-next/core';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { formatBytes } from '../i18n/format';
import { studyCounts, studyKnown, studyRevision } from '../study/studyFiles';

/**
 * A passage's audio counts with its study files folded in: ready means both
 * are here. `recordingsOnly`: chosen through its book's or section's button,
 * so kept for its recordings alone and its study files are not counted
 * (docs/decisions/2026-11-20-a-book-has-its-own-download-button.md, amended).
 * `studyUnknown`: its guide has not been looked up yet, so the device cannot
 * say its study files are here: not ready, still checking (decisions.md 166).
 */
export type KeptOffline = UnitOffline & { studyHere: number; studyTotal: number; recordingsOnly: boolean; studyUnknown: boolean };

/** `light`: the passage is in the kept-for-recordings list (`blobs.recordingsOnly`). One that is the person's work takes its study guide whatever list it is in. */
export function withStudy(u: UnitOffline, unitId: string, light = false): KeptOffline {
  const recordingsOnly = light && u.reason === 'chosen';
  if (!u.reason || recordingsOnly) return { ...u, studyHere: 0, studyTotal: 0, recordingsOnly, studyUnknown: false };
  const { here, total } = studyCounts(unitId);
  const studyUnknown = !studyKnown(unitId);
  return { ...u, studyHere: here, studyTotal: total, recordingsOnly, studyUnknown, ready: u.ready && !studyUnknown && here === total };
}

/**
 * Counts for every kept passage, for marks on long lists. A passage missing
 * from the map is not kept. Shared by every row drawn from the same inputs.
 * Worked out from the phone's table after changes (useLanguage), not on
 * every draw (decisions.md 143).
 */
export function keptOfflineMap(ctx: Ctx): Map<string, KeptOffline> {
  const { keptOffline: counted, recordingsOnly: light } = ctx.language.blobs;
  if (!counted) return new Map();
  const rev = studyRevision();
  const last = keptCache;
  if (last && last.counted === counted && last.light === light && last.rev === rev) return last.map;
  const map = new Map<string, KeptOffline>();
  for (const [id, u] of counted) map.set(id, withStudy(u, id, light.has(id)));
  keptCache = { counted, light, rev, map };
  return map;
}

export let keptCache: { counted: ReadonlyMap<string, UnitOffline>; light: ReadonlySet<string>; rev: number; map: Map<string, KeptOffline> } | null = null;

/** The whole scope: audio from core, with passages counted ready only once their study files are here too. */
export type OfflineOverview = OfflineSummary & { studyToFetch: number };

/** Words for a Map row's screen reader label. */
export function offlineWords(u: KeptOffline | undefined): string {
  if (!u?.reason) return t('offline.audioNotKept');
  if (u.ready) return u.recordingsOnly ? t('offline.recordingsHere') : t('offline.onDevice');
  // Its recordings are here and its study guide has not been looked up yet: nothing is coming down, the device is still checking.
  return u.studyUnknown && u.toFetch === 0 ? t('offline.summary.checking') : t('offline.downloading');
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

/** Whole sentences, one after another. */
export function sentences(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
