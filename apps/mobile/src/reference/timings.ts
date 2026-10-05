// Publishing a timing job's results (docs/reference-material.md, "Timing
// jobs"): each passing `timing@1` becomes a library document numbered by the
// versification's hash, its book's `sourceBook@1` gets a new version naming
// it, and the source gets a new version naming the books. Pure, with the
// hash function passed in: the same results always make the same documents,
// so running it again publishes nothing new, and a chapter that already has
// a timing keeps it.
import {
  canonicalJson, isHash, validateDoc, withDeps,
  type LibraryDoc, type SourceBookDoc, type SourceDoc, type TimingDoc
} from '@langquest-next/core';

/** One row of `timing_job_results`. */
export interface TimingResultRow {
  book: string;
  chapter: number;
  ok: boolean;
  body: unknown;
}

export interface TimingPublication {
  /** New documents, each after what it depends on: timings, then books, then the source. */
  docs: { hash: string; text: string; doc: LibraryDoc }[];
  /** The source's next version, or null when nothing changed. */
  source: { doc: SourceDoc; hash: string } | null;
  /** Chapters that now have a timing they did not have. */
  placed: { book: string; chapter: number }[];
  /** Chapters that did not pass, with why: listed, never published. */
  failed: { book: string; chapter: number; reason: string }[];
  /** Chapters that already had another timing, which they keep. */
  kept: { book: string; chapter: number }[];
}

type Get = (hash: string | null | undefined) => LibraryDoc | null;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Why a chapter did not pass, in words: the aligner's flags, or its check. */
function failure(body: unknown): string {
  const check = isObj(body) && isObj(body['check']) ? body['check'] : null;
  const flags = check && Array.isArray(check['flags']) ? (check['flags'] as unknown[]).filter(isObj) : [];
  if (flags.length) {
    const first = flags[0]!;
    const more = flags.length > 1 ? ` (and ${flags.length - 1} more)` : '';
    return `Verse ${String(first['verseStart'] ?? '?')}: ${String(first['reason'] ?? 'flagged')}${more}`;
  }
  if (check && typeof check['maxDeviation'] === 'number') return `Did not pass the check (off by up to ${Math.round(check['maxDeviation'] as number)} ms)`;
  return 'Did not pass the check';
}

/**
 * The documents to publish for a finished job's results against the
 * source's current version. `get` reads the source's loaded documents (its
 * books and their timings); `versifications` names the hash of each
 * versification by its code ("eng"), the source's own first.
 */
export async function timingPublication(
  input: {
    source: SourceDoc;
    sourceHash: string;
    rows: TimingResultRow[];
    get: Get;
    versifications: { code: string; hash: string }[];
  },
  hashOf: (text: string) => Promise<string>
): Promise<TimingPublication> {
  const { source, rows, get } = input;
  const failed: TimingPublication['failed'] = [];
  const kept: TimingPublication['kept'] = [];
  const placed: TimingPublication['placed'] = [];
  const inSource = new Set(source.books.map((b) => b.book));
  const v11n = (code: unknown): string | null => {
    if (isHash(code)) return code;
    return input.versifications.find((v) => v.code === code)?.hash ?? null;
  };

  // 1. Each passing result as a canonical timing document.
  const timings = new Map<string, Map<number, { doc: TimingDoc; text: string; hash: string }>>();
  for (const row of [...rows].sort((a, b) => (a.book < b.book ? -1 : a.book > b.book ? 1 : a.chapter - b.chapter))) {
    const at = { book: row.book, chapter: row.chapter };
    if (!row.ok) { failed.push({ ...at, reason: failure(row.body) }); continue; }
    if (!isObj(row.body) || row.body['format'] !== 'timing@1') { failed.push({ ...at, reason: 'Not a timing document' }); continue; }
    if (!inSource.has(row.book)) { failed.push({ ...at, reason: 'This Bible does not have that book' }); continue; }
    const hash = v11n(row.body['versification']);
    if (!hash) { failed.push({ ...at, reason: `Numbered in a versification this organization does not have (${String(row.body['versification'])})` }); continue; }
    const doc = withDeps({ ...(row.body as unknown as TimingDoc), versification: hash, deps: [] });
    if (doc.book !== row.book || doc.chapter !== row.chapter) { failed.push({ ...at, reason: 'The result names another chapter' }); continue; }
    const invalid = validateDoc(doc);
    if (invalid) { failed.push({ ...at, reason: `Not a valid timing: ${invalid}` }); continue; }
    const text = canonicalJson(doc);
    const byChapter = timings.get(row.book) ?? new Map();
    byChapter.set(row.chapter, { doc, text, hash: await hashOf(text) });
    timings.set(row.book, byChapter);
  }

  // 2. Each book that changes gets its next version.
  const docs: TimingPublication['docs'] = [];
  const bookHashes = new Map<string, string>();
  for (const b of source.books) {
    const results = timings.get(b.book);
    if (!results) continue;
    const prior = get(b.doc) as SourceBookDoc | null;
    if (b.doc && !prior) {
      // The book's document is not on this phone: changing it would drop its text or audio.
      for (const chapter of results.keys()) failed.push({ book: b.book, chapter, reason: "This Bible's book is not loaded yet. Try again when connected." });
      continue;
    }
    const chapters = (prior?.chapters ?? []).map((c) => ({ ...c }));
    let changed = false;
    for (const [chapter, t] of results) {
      const at = chapters.find((c) => c.chapter === chapter);
      if (at?.timing === t.hash) continue;
      // A chapter already timed keeps its timing: a person's correction, FCBH's, or an earlier job's.
      // So jobs never undo each other, whatever order phones publish them in.
      if (at?.timing) { kept.push({ book: b.book, chapter }); continue; }
      if (at) at.timing = t.hash;
      else chapters.push({ chapter, timing: t.hash });
      docs.push({ hash: t.hash, text: t.text, doc: t.doc });
      placed.push({ book: b.book, chapter });
      changed = true;
    }
    if (!changed) continue;
    chapters.sort((x, y) => x.chapter - y.chapter);
    const book = withDeps<SourceBookDoc>({ ...(prior ?? { format: 'sourceBook@1', book: b.book, chapters: [], deps: [] }), chapters, deps: [] });
    const text = canonicalJson(book);
    const hash = await hashOf(text);
    bookHashes.set(b.book, hash);
    docs.push({ hash, text, doc: book });
  }

  // 3. The source's next version names the new books.
  if (bookHashes.size === 0) return { docs: [], source: null, placed, failed, kept };
  const next = withDeps<SourceDoc>({ ...source, books: source.books.map((b) => (bookHashes.has(b.book) ? { ...b, doc: bookHashes.get(b.book)! } : b)), deps: [] });
  const text = canonicalJson(next);
  const hash = await hashOf(text);
  if (hash === input.sourceHash) return { docs: [], source: null, placed: [], failed, kept };
  docs.push({ hash, text, doc: next });
  return { docs, source: { doc: next, hash }, placed, failed, kept };
}
