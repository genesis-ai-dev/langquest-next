// Which numbering each of Bible Brain's Bibles uses (scripts/bible-survey.ts,
// docs/breaking-up-the-bible.md "Bibles from Bible Brain"). Pure, so the
// choice of chapters to read and the verdict are tested: the survey reads a
// Bible's books and chapters, then the last verse of the chapters where the
// standard systems disagree, and names the system that fits every one.

/** The standard systems (library/versifications), in the order a tie is settled: the commonest first. */
export const SYSTEMS = ['eng', 'org', 'vul', 'rsc', 'rso', 'lxx'] as const;
export type System = (typeof SYSTEMS)[number];

/** A system's last verse in each chapter of each book (`library/versifications/<code>.json` maxVerses). */
export type LastVerses = Record<string, number[]>;

/** One chapter, as `BOOK n` ("PSA 3"). */
export const chapterKey = (book: string, chapter: number) => `${book} ${chapter}`;

/** The last verse of a chapter in a system; 0 when the system has no such chapter or book. */
export function expected(system: LastVerses, book: string, chapter: number): number {
  return system[book]?.[chapter - 1] ?? 0;
}

/** A versification file's maxVerses as numbers. */
export function lastVersesOf(maxVerses: Record<string, (string | number)[]>): LastVerses {
  return Object.fromEntries(Object.entries(maxVerses).map(([book, list]) => [book, list.map((v) => Number(v))]));
}

const PAIRS = SYSTEMS.flatMap((a, i) => SYSTEMS.slice(i + 1).map((b) => [a, b] as const));

/**
 * The chapters to read in a Bible with these books. First the fewest the
 * greedy choice finds so that every two systems differ in at least `perPair`
 * of them, where the books allow (a New Testament cannot tell the Hebrew
 * numbering from the English). Then `spread` more, evenly over every other
 * chapter where any two systems differ, in book order: where numberings
 * part is where a Bible's own numbering would part from them too.
 */
export function chaptersToRead(
  systems: Record<System, LastVerses>,
  books: { book: string; chapters: number }[],
  opts: { perPair?: number; spread?: number } = {}
): { book: string; chapter: number }[] {
  const { perPair = 4, spread = 30 } = opts;
  const candidates: { book: string; chapter: number; splits: Set<number> }[] = [];
  for (const { book, chapters } of books) {
    // A chapter past the Bible's own last one says nothing about its numbering.
    for (let chapter = 1; chapter <= chapters; chapter++) {
      const splits = new Set<number>();
      PAIRS.forEach(([a, b], i) => {
        // A system without the book says nothing about it (fits() leaves it out too).
        if (!systems[a][book] || !systems[b][book]) return;
        if (expected(systems[a], book, chapter) !== expected(systems[b], book, chapter)) splits.add(i);
      });
      if (splits.size) candidates.push({ book, chapter, splits });
    }
  }
  const need = PAIRS.map((_, i) => Math.min(perPair, candidates.filter((c) => c.splits.has(i)).length));
  const chosen: { book: string; chapter: number }[] = [];
  const left = [...candidates];
  for (;;) {
    let best = -1;
    let bestGain = 0;
    left.forEach((c, i) => {
      let gain = 0;
      for (const p of c.splits) if (need[p]! > 0) gain++;
      if (gain > bestGain) [best, bestGain] = [i, gain];
    });
    if (best < 0) break;
    const [c] = left.splice(best, 1);
    for (const p of c!.splits) if (need[p]! > 0) need[p]!--;
    chosen.push({ book: c!.book, chapter: c!.chapter });
  }
  const step = left.length / Math.min(spread, left.length);
  for (let i = 0; i < Math.min(spread, left.length); i++) {
    const c = left[Math.floor(i * step)]!;
    chosen.push({ book: c.book, chapter: c.chapter });
  }
  return chosen;
}

/** What the survey saw in one Bible's text. */
export interface Observed {
  /** Each book's chapters, as Bible Brain lists them. */
  books: { book: string; chapters: number }[];
  /** The last verse of each chapter read; 0 when Bible Brain had no text for it. */
  lastVerse: Record<string, number>;
  /** The text holds only part of its testaments (a size like NTP): a missing chapter or a short book says nothing. */
  partial: boolean;
}

/** Where a Bible and a system part. */
export interface Difference {
  at: string;
  saw: number;
  expected: number;
}

/** How well one system fits what was seen. */
export interface Fit {
  system: System;
  differences: Difference[];
}

/**
 * Every system's fit, best first: the books' chapter counts (Malachi 3 or
 * 4, Joel 3 or 4) and the last verse of every chapter read. Books a system
 * does not have are left out, so a Bible with the deuterocanon still fits
 * the English numbering of the books they share.
 */
export function fits(systems: Record<System, LastVerses>, seen: Observed): Fit[] {
  return SYSTEMS.map((system) => {
    const s = systems[system];
    const differences: Difference[] = [];
    for (const { book, chapters } of seen.books) {
      const theirs = s[book]?.length;
      if (!theirs || chapters === theirs) continue;
      if (seen.partial && chapters < theirs) continue;
      differences.push({ at: book, saw: chapters, expected: theirs });
    }
    for (const [at, saw] of Object.entries(seen.lastVerse)) {
      const [book, n] = at.split(' ') as [string, string];
      if (!s[book]) continue;
      if (saw === 0 && seen.partial) continue;
      const want = expected(s, book, Number(n));
      if (saw !== want) differences.push({ at, saw, expected: want });
    }
    return { system, differences };
  }).sort((a, b) => a.differences.length - b.differences.length || SYSTEMS.indexOf(a.system) - SYSTEMS.indexOf(b.system));
}

/** The survey's word on one Bible. */
export interface Verdict {
  /** The system every chapter read agrees with, or custom when none does. */
  numbering: System | 'custom';
  /** For custom: the system that fits best, and where the Bible parts from it. */
  nearest?: System;
  differences?: Difference[];
  /** Other systems that fit as well (a New Testament alone cannot tell English from Hebrew numbering). */
  alsoFits?: System[];
}

export function verdict(all: Fit[]): Verdict {
  const best = all[0]!;
  if (best.differences.length > 0) return { numbering: 'custom', nearest: best.system, differences: best.differences };
  const alsoFits = all.slice(1).filter((f) => f.differences.length === 0).map((f) => f.system);
  return { numbering: best.system, ...(alsoFits.length ? { alsoFits } : {}) };
}

/** `[verseStart, verseEnd]` rows to the chapter's last verse; 0 for none. */
export function lastVerseOf(rows: [number, number, ...unknown[]][]): number {
  return rows.reduce((m, [start, end]) => Math.max(m, start, end), 0);
}
