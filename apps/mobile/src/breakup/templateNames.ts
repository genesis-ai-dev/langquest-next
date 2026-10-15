// A book's name as a template gives it (breakup/BreakUpBook.tsx).
import { templateBooks, type TemplateDoc } from '@langquest-next/core';
import { t } from '../i18n';

/** "Used in Dinka too. Change Ruth for which of them?", for the languages that share the template. */
export function alsoUsedLine(names: string[], book: string): string {
  if (names.length <= 1) return t('breakup.book.alsoUsedOne', { name: names[0] ?? '', book });
  if (names.length === 2) return t('breakup.book.alsoUsedTwo', { first: names[0], second: names[1], book });
  return t('breakup.book.alsoUsedMore', { name: names[0], count: names.length - 1, book });
}

/** The template's name for a book, else the fallback (the app's name for it). */
export function templateBookName(doc: TemplateDoc | null, book: string, fallback: string): string {
  return (doc ? templateBooks(doc).find((b) => b.book === book)?.name : undefined) ?? fallback;
}
