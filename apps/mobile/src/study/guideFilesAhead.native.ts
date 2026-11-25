// Takes a team's own guide pictures and audio along for kept passages (2026-11-24 review, item 20).
// Guides the guide editor wrote name their files by hash (study@2); before this they came only when a
// screen showed them while online, and a passage said ready without them. The prefetcher
// (StudyPrefetch.tsx) hands over each kept passage's files; while online they are fetched into the
// blob store from the organization's guide files, one at a time; a passage is ready only once they
// are here (they count among its study files, `countStoredStudyFiles`); and a teammate's phone is
// asked for them first (nearby's `guideFilesWanted`).
import { classifyTransferFailure } from '@langquest-next/sync';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getBlobStore, type BlobStore } from '../sync/blobs';
import { isStoredFormat, type StoredFile } from '../storage/storedFile';
import { noteExpected } from '../diagnostics/report';
import { isRecording } from '../recording/recorderState';
import { fetchGuideFile } from './guideFileFetch';
import { countStoredStudyFiles, studyFolder } from './studyFiles';
import { guideFilesOf } from './studyFilesModel';
import type { StudyGuide } from './guides';

/** Each language's last whole list of its kept passages' guide files, by hash: `guide-files:wants:<org>/<language>`. */
const WANTS_PREFIX = 'guide-files:wants:';

let wanted = new Map<string, StoredFile[]>();
/** Every language's saved list, read once a run; null until read, or when it cannot be. */
let elsewhere: Set<string> | null = null;
void (async () => {
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(WANTS_PREFIX));
  const out = new Set<string>();
  for (const [, raw] of await AsyncStorage.multiGet(keys)) {
    for (const h of JSON.parse(raw ?? '[]') as unknown[]) if (typeof h === 'string') out.add(h);
  }
  elsewhere = new Set([...out, ...(elsewhere ?? [])]);
})().catch((e: unknown) => noteExpected('guide files ahead: lists', e));
let orgId: string | null = null;
let online = false;
let store: BlobStore | null = null;
let running = false;
let again = false;

/** A guide's files the blob store keeps (`guideFilesOf`), as the store names them. */
export function guideStoredFiles(guide: StudyGuide): StoredFile[] {
  return guideFilesOf(guide).flatMap((f) => (isStoredFormat(f.format) ? [{ hash: f.hash, format: f.format }] : []));
}

/**
 * The kept passages' guide files, by passage, and whether the device is online to fetch them.
 * `complete`: the list names every guide file this language's kept passages need, so it is saved
 * as the language's, for nearby in any language to keep (`guideFilesKeptAnywhere`).
 */
export function setGuideFilesWanted(
  next: Map<string, StoredFile[]>, isOnline: boolean, org: string | null, language?: { orgId: string; languageId: string } | null, complete = false
): void {
  wanted = next;
  online = isOnline;
  orgId = org;
  if (complete && language?.orgId && language.languageId) {
    const hashes = [...guideFilesWanted()].sort();
    if (elsewhere) for (const h of hashes) elsewhere.add(h);
    void AsyncStorage.setItem(`${WANTS_PREFIX}${language.orgId}/${language.languageId}`, JSON.stringify(hashes))
      .catch((e: unknown) => noteExpected('guide files ahead: lists', e));
  }
  if (store) void drain();
  else {
    void getBlobStore().then((s) => {
      store = s;
      // Counts drawn before the store was open said none was here.
      studyFolder.changed();
      void drain();
    }).catch((e: unknown) => noteExpected('guide files ahead: store', e));
  }
}

/** How many of a kept passage's guide files are here, out of how many its guide names. */
export function guideFileCounts(unitId: string): { here: number; total: number } {
  const files = wanted.get(unitId) ?? [];
  if (!store) return { here: 0, total: files.length };
  let here = 0;
  for (const f of files) if (store.has(f.hash)) here++;
  return { here, total: files.length };
}
countStoredStudyFiles(guideFileCounts);

/** Every kept passage's guide files by hash: a teammate's phone is asked for these first, and a covered phone for these alone. */
export function guideFilesWanted(): ReadonlySet<string> {
  return new Set([...wanted.values()].flat().map((f) => f.hash));
}

/**
 * The guide files any language's kept passages need on this phone, as each last listed them whole,
 * and this language's now: nearby keeps these, and other library files are spare (2026-11-24
 * review, item 24). Null until the saved lists are read.
 */
export function guideFilesKeptAnywhere(): ReadonlySet<string> | null {
  return elsewhere ? new Set([...elsewhere, ...guideFilesWanted()]) : null;
}

async function drain(): Promise<void> {
  if (running) { again = true; return; }
  if (!online || !orgId || !store) return;
  running = true;
  try {
    const s = store;
    const seen = new Set<string>();
    for (const f of [...wanted.values()].flat()) {
      if (!online || orgId === null) break;
      if (isRecording()) break;
      if (seen.has(f.hash) || s.has(f.hash)) continue;
      seen.add(f.hash);
      try {
        await fetchGuideFile(orgId, f, s);
        studyFolder.changed();
      } catch (e) {
        // Offline, or not there yet: tried again the next time the wish list changes, after a minute's wait.
        noteExpected('guide files ahead', e, classifyTransferFailure(e));
      }
    }
  } finally {
    running = false;
    if (again) { again = false; void drain(); }
  }
}
