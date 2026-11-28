// What a file check says, in the reader's language (LAN-229). Core gives each
// problem as a code and its facts (`UsfmProblem`); the sentence is here.
import { englishBookName, type UsfmProblem } from '@langquest-next/core';
import { t } from '../i18n';
import type { PickFailure } from './files';

export function problemText(p: UsfmProblem): string {
  switch (p.code) {
    case 'frontBack': case 'unknownCode': return t(`usfm.problem.${p.code}`, { code: p.book });
    case 'badChapter': return t('usfm.problem.badChapter', { text: p.text });
    case 'chapterTwice': case 'missingChapters': return t(`usfm.problem.${p.code}`, { chapter: p.chapter });
    case 'chapterOrder': return t('usfm.problem.chapterOrder', { chapter: p.chapter, after: p.after });
    case 'badVerse': return t('usfm.problem.badVerse', { chapter: p.chapter, text: p.text });
    case 'backward': return t('usfm.problem.backward', { chapter: p.chapter, start: p.start, end: p.end });
    case 'outOfOrder': case 'emptyVerses': return t(`usfm.problem.${p.code}`, { count: p.count });
    case 'duplicateBook': return t('usfm.problem.duplicateBook', { book: englishBookName(p.book), other: p.other });
    default: return t(`usfm.problem.${p.code}`);
  }
}

export const pickFailureText = (f: PickFailure) => t(`usfm.pickFailure.${f}`);
