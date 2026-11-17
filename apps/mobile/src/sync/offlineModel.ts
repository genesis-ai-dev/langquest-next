// What a passage's download button and line say, from what this device knows (decisions.md 166). Pure.
import { t } from '../i18n';
import type { KeptOffline } from './offlineText';

/**
 * Where a passage's audio stands on this device, as its download button and
 * line say it (decisions.md 61, 166). Each says only what the device knows:
 * "On this device" once its own count says every file is here, "Downloading"
 * only while a file of it is coming down, and no download offered while the
 * device is offline.
 */
export type OfflineLook = { kind: 'checking' | 'none' | 'noConnection' | 'downloading' | 'partial' | 'ready'; label: string };

export function offlineLook(u: KeptOffline | 'checking', o: { offline: boolean; downloading: boolean }): OfflineLook {
  if (u === 'checking') return { kind: 'checking', label: t('offline.summary.checking') };
  if (!u.reason) return o.offline ? { kind: 'noConnection', label: t('offline.needsConnection') } : { kind: 'none', label: t('offline.download') };
  if (u.ready) return { kind: 'ready', label: t('offline.onDevice') };
  const here = u.here + u.studyHere;
  const total = u.audio + u.studyTotal;
  // Kept, but its rows have not reached this device yet (decisions.md 147).
  if (total === 0) return { kind: 'partial', label: t('offline.notHere.title') };
  return o.downloading && !o.offline
    ? { kind: 'downloading', label: t('offline.passage.downloadingCount', { here, total }) }
    : { kind: 'partial', label: t('offline.passage.onlySomeHere', { here, count: total }) };
}

/** The language download a screen has shown its banner for: which language, and how many passages it had to fill. */
export type FillSeen = { languageId: string; total: number };

/**
 * What the first-download banner shows (decisions.md 147): the fill while it
 * runs, then, once this screen has shown it, the finished fill in the same
 * place until the person leaves the screen. Taken away the moment the last
 * passage arrived, the list under it moved up by the banner's height while
 * someone was tapping a row, and the tap missed (LAN-253). Nothing for a
 * fill this screen never showed, or one of another language.
 */
export function fillBanner(fill: { filled: number; total: number } | null, seen: FillSeen | null, languageId: string):
  { filled: number; total: number; done: boolean } | null {
  if (fill && fill.total > 0) return { filled: fill.filled, total: fill.total, done: false };
  if (!fill && seen && seen.languageId === languageId) return { filled: seen.total, total: seen.total, done: true };
  return null;
}
