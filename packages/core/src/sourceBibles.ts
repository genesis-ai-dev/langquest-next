import { BIBLE_BOOKS, FIA_PERICOPES } from './catalogData';
import { bibleRangeFromUnit, verseAddress } from './dynamicBible';
import { catalogEnabled, catalogKey, type OrgState } from './org';

/** BSB is the default. Explicit organization/project opt-outs still win. */
export const SOURCE_BIBLES = [
  { id: 'berean-bsb-fs', name: 'Berean Standard Bible', code: 'BSB',
    directory: 'bsb_frederick_surrey', narrator: 'Frederick Surrey', suffix: 'FS' },
  { id: 'berean-msb-fs', name: 'Majority Standard Bible', code: 'MSB',
    directory: 'msb_frederick_surrey', narrator: 'Frederick Surrey', suffix: 'FS' },
  { id: 'berean-bsb-hays', name: 'Berean Standard Bible', code: 'BSB',
    directory: 'hays', narrator: 'Barry Hays', suffix: 'H' }
] as const;
export const DEFAULT_SOURCE_BIBLE_ID = 'berean-bsb-hays';
export type SourceBible = typeof SOURCE_BIBLES[number];

export function sourceBibleEnabled(
  org: OrgState, id: string, projectId?: string
): boolean {
  return (org.catalog[catalogKey('reference', id, 'org')]?.value ??
    id === DEFAULT_SOURCE_BIBLE_ID) &&
    catalogEnabled(org, 'reference', id, projectId);
}

// OpenBible's filenames use these spellings, which differ from our book ids.
const AUDIO_BOOKS = (
  'Gen Exo Lev Num Deu Jos Jdg Rut 1Sa 2Sa 1Ki 2Ki 1Ch 2Ch Ezr Neh ' +
  'Est Job Psa Pro Ecc Sng Isa Jer Lam Ezk Dan Hos Jol Amo Oba Jon Mic ' +
  'Nam Hab Zep Hag Zec Mal Mat Mrk Luk Jhn Act Rom 1Co 2Co Gal Eph Php ' +
  'Col 1Th 2Th 1Ti 2Ti Tts Phm Heb Jas 1Pe 2Pe 1Jn 2Jn 3Jn Jud Rev'
).split(' ');

export type SourceChapter = { book: string; chapter: number; label: string };

/** Only resolve known template ids; never guess from a passage's display text. */
export function sourceChapters(unitId: string): SourceChapter[] {
  const dynamic = bibleRangeFromUnit(unitId);
  if (dynamic) {
    const first = verseAddress(dynamic.book, dynamic.start)!;
    const last = verseAddress(dynamic.book, dynamic.end)!;
    const book = BIBLE_BOOKS.find(b => b.itemId === dynamic.book)!;
    return Array.from({ length: last.chapter - first.chapter + 1 }, (_, i) => ({
      book: dynamic.book, chapter: first.chapter + i,
      label: `${book.label} ${first.chapter + i}`
    }));
  }
  const match = /^(bible|fia|book)@1\/(.+)$/.exec(unitId);
  if (!match) return [];
  const [, template, item] = match;
  const passage = template === 'fia'
    ? FIA_PERICOPES.find((p) => p.itemId === item) : undefined;
  const chapterItem = template === 'bible' ? /^(.+)-(\d+)$/.exec(item!) : null;
  const rawBookId = passage?.book ?? chapterItem?.[1] ?? item;
  // FIA seeds use a different abbreviation for Mark and John.
  const bookId = rawBookId === 'mrk' ? 'mar' : rawBookId === 'jhn' ? 'joh' : rawBookId;
  const book = BIBLE_BOOKS.find((b) => b.itemId === bookId);
  if (!book) return [];
  let first = chapterItem ? Number(chapterItem[2]) : 1;
  let last = chapterItem ? first : book.verses.length;
  if (template === 'fia') {
    if (!passage) return [];
    const range = /^(\d+):[^–-]+(?:[–-](?:(\d+):)?.+)?$/.exec(passage.verseRange);
    if (!range) return [];
    first = Number(range[1]);
    last = range[2] ? Number(range[2]) : first;
  }
  if (first < 1 || last < first || last > book.verses.length) return [];
  return Array.from({ length: last - first + 1 }, (_, i) => ({
    book: book.itemId, chapter: first + i,
    label: `${book.label} ${first + i}`
  }));
}

export function sourceAudioFile(bible: SourceBible, item: SourceChapter): string {
  const index = BIBLE_BOOKS.findIndex((b) => b.itemId === item.book);
  if (index < 0 || !Number.isInteger(item.chapter) || item.chapter < 1 ||
      item.chapter > BIBLE_BOOKS[index]!.verses.length) {
    throw new Error('Unknown source chapter');
  }
  return `${bible.code}_${String(index + 1).padStart(2, '0')}_` +
    `${AUDIO_BOOKS[index]}_${String(item.chapter).padStart(3, '0')}_${bible.suffix}.mp3`;
}

export function sourceAudioUrl(
  bible: SourceBible, item: SourceChapter, pilotBaseUrl?: string
): string {
  const file = sourceAudioFile(bible, item);
  // The trial mirrors Jonah only. Other chapters stay on the publisher CDN.
  if (pilotBaseUrl && item.book === 'jon' && bible.suffix === 'FS') {
    return `${pilotBaseUrl.replace(/\/$/, '')}/${bible.id}/${file}`;
  }
  return `https://openbible.com/audio/${bible.directory}/${file}`;
}
