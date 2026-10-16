// Which source audio a phone wants to keep (the pure half of offline.ts).
//
// Given a language's state, the organization's library and recommendations,
// and what the person picked, this says which chapters of which sources
// fall inside the offline scope. Fetching, hashing and the index are
// offline.ts; nothing here touches storage, files or the network.
import { defaultOfflineScope, isHash, libraryItemView, recommendedFor, type LanguageState, type OrgState, type SourceBookDoc, type SourceDoc } from '@langquest-next/core';
import type { BlobFile } from '../sync/blobs';
import { chaptersOf, filesetsFor, unitCoordinates, type SourceOption } from './model';

export type AudioFormat = BlobFile['format'];

/** A person's own pick of a Bible, as `my-bibles:` keeps it. */
export interface MyPick {
  itemId: string;
  kind: string;
  bibleId?: string;
}

export const bbKey = (fileset: string, book: string, chapter: number) => `bb:${fileset}:${book}:${chapter}`;
const libKey = (hash: string) => `lib:${hash}`;
/** A library chapter's audio: by its hash when the document gives one, else by its link. */
export const libAudioKey = (a: { hash?: string; url?: string }) => (a.hash ? libKey(a.hash) : `url:${a.url ?? ''}`);

/** A library audio's format as the store names it. */
export function audioFormatOf(format: string | undefined): AudioFormat {
  return format === 'm4a' || format === 'wav' ? format : 'mp3';
}

export interface Want {
  key: string;
  /** Library audio: its URL and the hash it must have. */
  url?: string;
  hash?: string;
  format?: AudioFormat;
  /** Bible Brain audio: asked for at download time. */
  fileset?: string;
  book: string;
  chapter: number;
}

/** The passages to keep audio for: the default scope plus the units the person keeps offline. */
export function offlineScope(state: LanguageState, actorId: string, keptUnits: Iterable<string>): Set<string> {
  const scope = defaultOfflineScope(state, actorId);
  for (const u of keptUnits) scope.add(u);
  return scope;
}

/** The current document hash of every recommended library item and every pick of the person's. */
export function sourceHashes(org: Pick<OrgState, 'library' | 'recommendations'> | null | undefined, state: LanguageState, mine: readonly MyPick[]): Set<string> {
  const out = new Set<string>();
  for (const itemId of [...recommendedFor(org?.recommendations, state).keys(), ...mine.map((m) => m.itemId)]) {
    const h = libraryItemView(org?.library ?? {}, itemId)?.current;
    if (h) out.add(h);
  }
  return out;
}

/**
 * The library source options a language offers for downloading: recommended
 * sources and the person's own picks, kept only when the document says
 * `offline: 'allowed'`. A stream-only source never appears.
 */
export function offlineOptions(
  org: Pick<OrgState, 'library' | 'recommendations'> | null | undefined, state: LanguageState, mine: readonly (MyPick & { kind: string })[],
  getDoc: (h: string) => SourceDoc | null
): SourceOption[] {
  const out: SourceOption[] = [];
  const library = org?.library ?? {};
  const recs = recommendedFor(org?.recommendations, state);
  const ids = new Set([...recs.keys(), ...mine.filter((m) => m.kind === 'library').map((m) => m.itemId)]);
  for (const itemId of ids) {
    const hash = libraryItemView(library, itemId)?.current;
    const doc = hash ? getDoc(hash) : null;
    if (doc && doc.format === 'source@1') out.push({ itemId, kind: 'library', from: recs.get(itemId) ?? 'mine', name: doc.name, abbreviation: doc.abbreviation, language: doc.language, doc, docHash: hash! });
  }
  return out.filter((o) => o.doc?.offline === 'allowed');
}

/** The book documents of the options for the books the scope's passages are in (a source lists every book it has). */
export function bookHashesFor(scope: Iterable<string>, options: readonly SourceOption[]): Set<string> {
  const out = new Set<string>();
  for (const unitId of scope) {
    const book = unitCoordinates(unitId)?.book;
    for (const o of options) {
      const h = book ? o.doc?.books.find((b) => b.book === book)?.doc : undefined;
      if (h) out.add(h);
    }
  }
  return out;
}

/**
 * Every chapter of every option that the scope's passages touch. A library
 * chapter is wanted only when its document gives a link; a Bible Brain one
 * when the option has an audio fileset for the book.
 */
export function wantedChapters(scope: Iterable<string>, options: readonly SourceOption[], docs: ReadonlyMap<string, unknown>): Want[] {
  const wants: Want[] = [];
  for (const unitId of scope) {
    const range = unitCoordinates(unitId);
    if (!range) continue;
    for (const o of options) {
      const chapters = chaptersOf(range);
      if (o.doc?.provider.kind === 'library') {
        const bookHash = o.doc.books.find((b) => b.book === range.book)?.doc;
        const book = bookHash ? (docs.get(bookHash) as SourceBookDoc | undefined) : undefined;
        for (const c of chapters) {
          const a = book?.chapters.find((x) => x.chapter === c)?.audio;
          // TODO(sources): audio carried only by hash (no URL) needs the library media route the guide editor adds.
          if (a?.url) wants.push({ key: libAudioKey(a), url: a.url, ...(isHash(a.hash) ? { hash: a.hash } : {}), format: audioFormatOf(a.format), book: range.book, chapter: c });
        }
      } else {
        const fileset = filesetsFor(o, range.book).audio;
        if (fileset) for (const c of chapters) wants.push({ key: bbKey(fileset, range.book, c), fileset, book: range.book, chapter: c });
      }
    }
  }
  return wants;
}
