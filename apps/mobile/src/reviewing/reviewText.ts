// Words for the review screen (reviewing/review.tsx).
import { type KeyTermView, type PassageNote, type ReviewView } from '@langquest-next/core';
import { t } from '../i18n';
import type { StudyProgress } from '../study/progress';

export interface BackgroundData {
  terms: KeyTermView[];
  notes: PassageNote[];
  anchor: (n: PassageNote) => string;
  olderVersion: (n: PassageNote) => string | undefined;
  study: StudyProgress | null;
  earlier: ReviewView[];
}

/**
 * The Background row's line: what there is, in the translator's name ("The
 * passage, Deng's notes, key words, earlier checks"). `you` when the
 * translator is the person looking ("your notes").
 */
export function backgroundLine(d: BackgroundData, translator: { id: string; name: string; you: boolean }): string {
  const parts = [t('review.simple.bgLine.passage')];
  if (d.study) parts.push(t('review.simple.bgLine.study'));
  if (d.notes.length) {
    parts.push(!d.notes.every((n) => n.by === translator.id) ? t('review.simple.bgLine.notes')
      : translator.you ? t('review.simple.bgLine.yourNotes') : t('review.simple.bgLine.theirNotes', { name: translator.name }));
  }
  if (d.terms.length) parts.push(t('review.simple.bgLine.keyWords'));
  if (d.earlier.length) parts.push(t('review.simple.bgLine.earlier'));
  return parts.join(', ');
}
