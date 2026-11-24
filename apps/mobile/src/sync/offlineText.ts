// What is kept on this phone, and how it is said (sync/offline.tsx).
import type { OfflineSummary, UnitOffline } from '@langquest-next/core';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { formatBytes } from '../i18n/format';
import { studyCounts, studyKnown, studyRevision } from '../study/studyFiles';
import { referenceCounts, referenceKnown, referenceRevision } from '../sources/referenceCounts';

/**
 * A passage's audio counts with its reference material folded in: its study
 * guide's files (`study`) and its chapters of reference audio (`ref`,
 * sources/referenceCounts.ts). Ready means all of it is here. `studyUnknown`,
 * `refUnknown`: its guide has not been looked up, or its reference audio not
 * worked out, yet, so the device cannot say they are here: not ready, still
 * checking (decisions.md 166).
 */
export type KeptOffline = UnitOffline & {
  studyHere: number; studyTotal: number; studyUnknown: boolean;
  refHere: number; refTotal: number; refUnknown: boolean;
  /** Study files the guide names that their source refused (not there): left out of `studyTotal`, and named instead. */
  studyRefused?: number;
  /** Chapters of reference audio that cannot come, left out of `refTotal` and named instead: no room kept for them, or not downloadable now. */
  refFull?: number;
  refUnavailable?: number;
};

/**
 * Every kept passage takes its reference material along: its study guide's files and its reference audio
 * (docs/decisions/2026-11-20-a-book-has-its-own-download-button.md, amended 2026-11-23). A file that cannot come (a
 * study file its source refused, reference audio there is no room for or that cannot be downloaded now) cannot keep
 * the passage from being ready, and is named instead, as a recording nobody has sent yet is (decisions.md 61).
 */
export function withStudy(u: UnitOffline, unitId: string): KeptOffline {
  if (!u.reason) return { ...u, studyHere: 0, studyTotal: 0, studyUnknown: false, refHere: 0, refTotal: 0, refUnknown: false };
  const { here, total, refused } = studyCounts(unitId);
  const studyUnknown = !studyKnown(unitId);
  const ref = referenceCounts(unitId);
  const refUnknown = !referenceKnown(unitId);
  return {
    ...u, studyHere: here, studyTotal: total, studyUnknown, ...(refused ? { studyRefused: refused } : {}),
    refHere: ref.here, refTotal: ref.total, refUnknown, ...(ref.full ? { refFull: ref.full } : {}), ...(ref.unavailable ? { refUnavailable: ref.unavailable } : {}),
    ready: u.ready && !studyUnknown && here === total && !refUnknown && ref.here === ref.total
  };
}

/**
 * Counts for every kept passage, for marks on long lists. A passage missing
 * from the map is not kept. Shared by every row drawn from the same inputs.
 * Worked out from the phone's table after changes (useLanguage), not on
 * every draw (decisions.md 143).
 */
export function keptOfflineMap(ctx: Ctx): Map<string, KeptOffline> {
  const { keptOffline: counted } = ctx.language.blobs;
  if (!counted) return new Map();
  const rev = studyRevision() * 1_000_000 + referenceRevision();
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
  if (u.ready) return t('offline.onDevice');
  // Its recordings are here and its reference material not worked out yet: nothing is coming down, the device is still checking.
  return (u.studyUnknown || u.refUnknown) && u.toFetch === 0 ? t('offline.summary.checking') : t('offline.downloading');
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
