// Upload your own Bible (LAN-229, decision 206): what the admin fills in, what
// is ready to publish, and the documents it becomes. Pure: no React Native.
import { bookOrder, type UsfmBibleDoc, type UsfmBookDoc, type UsfmCheck } from '@langquest-next/core';

/** What the admin types and picks after the files pass their checks. */
export interface UsfmDetails {
  name: string;
  abbreviation: string;
  /** ISO 639-3 language of the text. */
  language: string | null;
  /** Code of the numbering the verses follow ("eng"). */
  numbering: string;
  copyright: string;
  /** The uploader says they may share this text. */
  rights: boolean;
  share: boolean;
}

export const emptyDetails = (): UsfmDetails => ({ name: '', abbreviation: '', language: null, numbering: 'eng', copyright: '', rights: false, share: false });

/** A short name to start the abbreviation from: the capitals of the Bible's name, else its first letters. */
export function suggestAbbreviation(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const caps = words.map((w) => w[0]!).join('').toUpperCase();
  return (words.length > 1 ? caps : words[0]!.slice(0, 4).toUpperCase()).slice(0, 8);
}

/** The files that passed, in canon order: the ones that will be published. */
export function readyBooks(checks: readonly UsfmCheck[]): UsfmCheck[] {
  return checks.filter((c) => c.book && !c.errors.length).sort((a, b) => bookOrder(a.book!) - bookOrder(b.book!));
}

/** Whether publishing is open, or what it still waits for. */
export type UsfmMissing = 'books' | 'name' | 'abbreviation' | 'language' | 'rights' | null;
export function missingDetail(checks: readonly UsfmCheck[], d: UsfmDetails): UsfmMissing {
  if (!readyBooks(checks).length) return 'books';
  if (!d.name.trim()) return 'name';
  if (!d.abbreviation.trim()) return 'abbreviation';
  if (!d.language) return 'language';
  if (!d.rights) return 'rights';
  return null;
}

/** The book document for one passing file. */
export function bookDoc(check: UsfmCheck, usfm: string): UsfmBookDoc {
  return { format: 'usfmBook@1', book: check.book!, name: check.name || check.book!, chapters: check.chapters, usfm, deps: [] };
}

/** The Bible's header once its books have hashes (`docs`, by book code). */
export function bibleDoc(checks: readonly UsfmCheck[], docs: ReadonlyMap<string, string>, d: UsfmDetails, versification: string, license: string): UsfmBibleDoc {
  return {
    format: 'usfmBible@1',
    name: d.name.trim(),
    abbreviation: d.abbreviation.trim(),
    language: d.language!,
    versification,
    copyright: d.copyright.trim(),
    license,
    rightsConfirmed: true,
    books: readyBooks(checks).map((c) => ({ book: c.book!, name: c.name || c.book!, doc: docs.get(c.book!)!, chapters: c.chapters.length, verses: c.verseCount })),
    deps: []
  };
}
