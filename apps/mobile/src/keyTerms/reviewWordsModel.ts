// A key-word list on a check (decision 149; the agreed design's screen 5):
// each of the list's words on the passage, with the team's word for it and
// whether the translator marked it in the version being checked. Pure: no
// React, so it is tested (test/keyWordListsModel.test.ts).
import type { KeyTermView } from '@langquest-next/core';
import { ownWordOf, type WordHere } from './listsModel';

/** Where a list's word stands in a version: used (the translator marked it), not marked, or the team has no word for it. */
export type ReviewWordStatus = 'used' | 'notMarked' | 'noWord';

export interface ReviewWord<T extends Pick<KeyTermView, 'termId' | 'term' | 'adjustments'>> {
  here: WordHere;
  /** The team's word for it, when it has one. */
  own: T | null;
  /** The team's latest recording of its word. */
  voice: string | null;
  status: ReviewWordStatus;
}

/** The latest recording of a team word: what "▶ Sidamo word" plays. */
export function latestVoice(term: Pick<KeyTermView, 'adjustments'>): string | null {
  return [...term.adjustments].reverse().find((a) => a.blobHash)?.blobHash ?? null;
}

/**
 * One list's words on the passage as a reviewer sees them: in the order the
 * passage has them, each with the team's word and where it stands. `tied`
 * holds the team words the translator marked in this version
 * (`keyTermLinksFor`).
 */
export function reviewWords<T extends Pick<KeyTermView, 'termId' | 'term' | 'adjustments'>>(
  words: readonly WordHere[], own: readonly T[], tied: ReadonlySet<string>
): ReviewWord<T>[] {
  return words.map((here) => {
    const mine = ownWordOf(here.list, here.word, own);
    return {
      here, own: mine, voice: mine ? latestVoice(mine) : null,
      status: !mine ? 'noWord' : tied.has(mine.termId) ? 'used' : 'notMarked'
    };
  });
}

/** How many of the list's words on the passage the team has a word for: "6 here · Sidamo has a word for 2". */
export function reviewCounts(rows: readonly ReviewWord<Pick<KeyTermView, 'termId' | 'term' | 'adjustments'>>[]): { here: number; have: number } {
  return { here: rows.length, have: rows.filter((r) => r.own).length };
}
