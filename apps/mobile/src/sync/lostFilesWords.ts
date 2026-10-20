// What the lost-files notice says (sync/lostFiles.tsx).
import type { LostFile } from '@langquest-next/sync';
import { lostFilesView, unitTitle, type LanguageState, type LostFilesView } from '@langquest-next/core';

/** Passages named in the alert; the rest are counted. */
export const NAMED = 4;

export interface LostFilesWords {
  total: number;
  /** Recordings the server never had: gone. */
  unsent: number;
  /** Files the server has: nothing lost there. */
  safe: number;
  /** The passages to record again, by name. */
  passages: string[];
  morePassages: number;
}

/** What the alert says, from the open language and the files lost. `view` comes from the phone's table for a language kept on disk (decisions.md 143). */
export function lostFilesWords(state: LanguageState, lost: readonly LostFile[], view: LostFilesView = lostFilesView(state, lost.map((l) => l.hash))): LostFilesWords {
  return {
    total: lost.length,
    unsent: view.unsent,
    safe: view.safe,
    passages: view.unitIds.slice(0, NAMED).map((id) => unitTitle(state, id)),
    morePassages: Math.max(0, view.unitIds.length - NAMED)
  };
}
