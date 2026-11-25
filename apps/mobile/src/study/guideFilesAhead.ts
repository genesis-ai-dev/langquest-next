// The web keeps no study files (`STUDY_FILES_OFFLINE`): a team's guide files are fetched when a
// screen shows them, and nothing is taken along ahead. The phones' download ahead is
// guideFilesAhead.native.ts (2026-11-24 review, item 20).
import type { StoredFile } from '../storage/storedFile';
import type { StudyGuide } from './guides';

export function guideStoredFiles(_guide: StudyGuide): StoredFile[] {
  return [];
}

export function setGuideFilesWanted(_next: Map<string, StoredFile[]>, _isOnline: boolean, _org: string | null, _language?: { orgId: string; languageId: string } | null, _complete = false): void {}

export function guideFileCounts(_unitId: string): { here: number; total: number } {
  return { here: 0, total: 0 };
}

export function guideFilesWanted(): ReadonlySet<string> {
  return new Set();
}

export function guideFilesKeptAnywhere(): ReadonlySet<string> | null {
  return null;
}
