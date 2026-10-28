import { encodeHlc, foldOrg, type AnyEvent, type LanguageProgress, type PassageState } from '@langquest-next/core';
import {
  agoWords, bookEntries, bookRowWords, chapterRows, chapterTiles, chaptersAreWhole, clusterView, filterEntries, funnelLayers, funnelRows, inFilter, isOutline,
  mapSearch, mapShelf, openState, OTHER, outlineSections, searchLanguages, stageRamp, statusTotals, summarizeBooks, tileLabel,
  type BookSummary, type Entry, type StatusLanguage
} from '../src/map/mapModel';
import { canonBook } from '../src/reference/canon';

// The Map's rules (decision 71, 105; screens/map.tsx): what it groups, counts,
// searches and says, tested without a screen.

/** A passage as the Map reads it: where it sits and the few facts the rules look at. */
function entry(unitId: string, bookId: string | null, chapters: number[], s: Partial<PassageState> = {}): Entry {
  return {
    unitId,
    place: { bookId, bookLabel: bookId ?? 'Lesson folder', chapters, canon: bookId ? 0 : 999, testament: null },
    s: { unitId, recorded: false, done: false, drafting: false, steps: [], awaitingResponse: [], ...s } as unknown as PassageState
  };
}
const step = (complete: boolean) => ({ complete });
const recorded = (steps: boolean[], extra: Partial<PassageState> = {}) => ({ recorded: true, steps: steps.map(step), ...extra }) as unknown as Partial<PassageState>;
const lang = (languageId: string, name: string, progress: LanguageProgress | null, asOf: string | null = null): StatusLanguage =>
  ({ languageId, here: false, name, code: languageId.toUpperCase(), flow: '', progress, asOf, stepNames: undefined });
const prog = (p: Partial<LanguageProgress>): LanguageProgress => ({ total: 0, recorded: 0, done: 0, steps: [], waiting: 0, feedback: 0, ...p });

describe('the open language', () => {
  it('shows a language only once it is the one open', () => {
    // Why: until a `languageId` param has opened its stream, the state on hand is the previous language's.
    const state = {} as never;
    expect(openState({ languageId: 'din', state }, 'din')).toBe(state);
    expect(openState({ languageId: 'din', state }, 'nus')).toBeNull();
    expect(openState({ languageId: 'din', state }, null)).toBeNull();
  });
});

describe('the progress overview', () => {
  it('sums only the languages that have figures, and says the oldest as-of', () => {
    // Why: a language the server has never counted must not drag the percentages down.
    const t = statusTotals([
      lang('a', 'A', prog({ total: 10, recorded: 6, done: 2, waiting: 1 }), '2026-10-14T10:00:00Z'),
      lang('b', 'B', null),
      lang('c', 'C', prog({ total: 30, recorded: 3, done: 3, waiting: 4 }), '2026-10-13T10:00:00Z')
    ]);
    expect(t).toMatchObject({ total: 40, recorded: 9, done: 5, waiting: 5 });
    expect(t.known).toHaveLength(2);
    expect(t.asOf).toBe('2026-10-13T10:00:00Z');
    expect(statusTotals([])).toMatchObject({ total: 0, asOf: null });
  });

  it('finds a language by name or code, ignoring case and surrounding spaces', () => {
    const all = [lang('din', 'Dinka', null), lang('nus', 'Nuer', null)];
    expect(searchLanguages(all, '  NUE ').map((l) => l.languageId)).toEqual(['nus']);
    expect(searchLanguages(all, 'din').map((l) => l.languageId)).toEqual(['din']);
    expect(searchLanguages(all, '   ')).toHaveLength(2);
    expect(searchLanguages(all, 'zzz')).toEqual([]);
  });

  it('says how long ago in the biggest unit that fits', () => {
    const now = Date.parse('2026-10-15T12:00:00Z');
    expect(agoWords('2026-10-15T11:59:40Z', now)).toBe('just now');
    expect(agoWords('2026-10-15T11:55:00Z', now)).toBe('5 minutes ago');
    expect(agoWords('2026-10-15T11:00:00Z', now)).toBe('1 hour ago');
    expect(agoWords('2026-10-12T12:00:00Z', now)).toBe('3 days ago');
    expect(agoWords('2026-10-16T12:00:00Z', now)).toBe('just now');
  });

  it('shades stages pale to full, and a lone stage full', () => {
    expect(stageRamp(1)).toEqual(['#4b2c9e']);
    const ramp = stageRamp(3);
    expect(ramp[0]).toBe('#c2b2f3');
    expect(ramp[2]).toBe('#4b2c9e');
    expect(ramp).toHaveLength(3);
  });

  it('lays the funnel out recorded, each step, done, with the longest bar at the back', () => {
    // Why: bands overlap from zero; a shorter bar drawn first would be hidden behind a longer one.
    const p = prog({ total: 10, recorded: 8, done: 2, steps: [{ name: 'Check', cleared: 5, checkpoint: false }, { name: 'Sign off', cleared: 0, checkpoint: true }] });
    const rows = funnelRows(p, ['Checked'], '#0f0');
    expect(rows.map((r) => [r.label, r.n])).toEqual([['Recorded', 8], ['Checked', 5], ['Sign off', 0], ['Done', 2]]);
    expect(rows[3]!.color).toBe('#0f0');
    expect(rows[2]!.checkpoint).toBe(true);
    expect(funnelLayers(rows).map((r) => r.label)).toEqual(['Recorded', 'Checked', 'Done']);
    // No steps in the flow: no Done row.
    expect(funnelRows(prog({ total: 3, recorded: 3 }), undefined, '#0f0').map((r) => r.label)).toEqual(['Recorded']);
  });

  it('keeps ties in flow order', () => {
    const rows = funnelRows(prog({ total: 4, recorded: 4, done: 4, steps: [{ name: 'S', cleared: 4, checkpoint: false }] }), undefined, 'g');
    expect(funnelLayers(rows).map((r) => r.i)).toEqual([0, 1, 2]);
  });

  describe('clusters', () => {
    const ev = (type: string, payload: unknown, n: number) => ({ id: `e${n}`, type, orgId: 'o', streamId: '_org', actorId: 'lead', deviceId: 'd', hlc: encodeHlc(1_700_000_000_000 + n, 0, 'd'), payload }) as unknown as AnyEvent;
    const org = foldOrg([
      ev('v1.LanguageAdded', { languageId: 'dip', name: 'Dinka NE', code: 'dip', sourceCode: 'eng' }, 1),
      ev('v1.LanguageAdded', { languageId: 'nus', name: 'Nuer', code: 'nus', sourceCode: 'eng' }, 2),
      ev('v1.ClusterNamed', { clusterId: 'dinka', name: 'Dinka' }, 3),
      ev('v1.LanguageClusterSet', { languageId: 'dip', clusterId: 'dinka', inCluster: true }, 4)
    ]);
    it('keeps the cluster chosen, and falls back to all when it holds none of the languages listed', () => {
      const one = clusterView(org, ['dip', 'nus'], { kind: 'cluster', clusterId: 'dinka' });
      expect(one.filter).toEqual({ kind: 'cluster', clusterId: 'dinka' });
      expect([...one.kept]).toEqual(['dip']);
      expect(one.outside).toBe(1);
      expect(one.clusters.map((c) => c.languageIds)).toEqual([['dip']]);
      const gone = clusterView(org, ['nus'], { kind: 'cluster', clusterId: 'dinka' });
      expect(gone.filter).toEqual({ kind: 'all' });
      expect(gone.clusters).toEqual([]);
      expect([...gone.kept]).toEqual(['nus']);
    });
  });
});

describe('a language\'s books', () => {
  const entries = [
    entry('p1', 'luk', [1], recorded([true, false])),
    entry('p2', 'luk', [1], { recorded: true, done: true, steps: [step(true)] } as never),
    entry('p3', 'luk', [2], { awaitingResponse: [{}] } as never),
    entry('p4', 'joh', [3]),
    entry('p5', null, [])
  ];

  it('counts each book, in canon order, with passages in no book last', () => {
    const books = summarizeBooks(entries, 'all', new Set(['p3']));
    expect(books.map((b) => b.key)).toEqual(['luk', 'joh', OTHER]);
    const luk = books.find((b) => b.key === 'luk')!;
    expect(luk).toMatchObject({ total: 3, recorded: 2, done: 1, feedback: 1, matching: 3, mine: 1 });
    expect(luk.waiting).toBeUndefined();
    expect(books[books.length - 1]).toMatchObject({ key: OTHER, book: null, total: 1, name: 'Other' });
  });

  it('counts what matches the filter', () => {
    const luk = summarizeBooks(entries, 'done', new Set()).find((b) => b.key === 'luk')!;
    expect(luk.matching).toBe(1);
    expect(summarizeBooks(entries, 'feedback', new Set()).find((b) => b.key === 'luk')!.matching).toBe(1);
  });

  it('lists a book waiting to be broken up with nothing in it, unless it has passages', () => {
    const books = summarizeBooks([], 'all', new Set(), ['rut', 'nonsense']);
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({ key: 'rut', waiting: true, total: 0 });
    // Passages arriving make it a real row, still marked waiting until counted otherwise.
    expect(summarizeBooks([entry('r1', 'rut', [1])], 'all', new Set(), ['rut'])[0]).toMatchObject({ key: 'rut', total: 1, waiting: true });
  });

  it('keeps a waiting book in view under any filter, and others only when something matches', () => {
    const [waiting] = summarizeBooks([], 'done', new Set(), ['rut']);
    const luk = summarizeBooks(entries, 'all', new Set()).find((b) => b.key === 'luk')!;
    expect(inFilter(waiting!, 'done')).toBe(true);
    expect(inFilter({ ...luk, matching: 0 }, 'done')).toBe(false);
    expect(inFilter({ ...luk, matching: 0 }, 'all')).toBe(true);
  });

  it('says a book row for the eye and the ear', () => {
    const base = summarizeBooks(entries, 'all', new Set(['p3'])).find((b) => b.key === 'luk')!;
    const plain = bookRowWords(base, 'all');
    expect(plain.sub).toContain('2');
    expect(plain.label.startsWith(`${base.name}. `)).toBe(true);
    expect(plain.label).toContain('1 with feedback');
    // With the feedback filter set, "N with feedback" is said once, as the match count.
    expect(bookRowWords(base, 'feedback').label.match(/with feedback/g)).toHaveLength(1);
    const none: BookSummary = { ...base, recorded: 0, done: 0, feedback: 0, mine: 0 };
    expect(bookRowWords(none, 'all').sub).toBe('Not started');
    expect(bookRowWords({ ...none, waiting: true }, 'all').sub).toBe('Waiting to be divided');
  });

  it('knows an outline language: passages in no book and none waiting', () => {
    expect(isOutline([entry('a', null, []), entry('b', null, [])], [])).toBe(true);
    expect(isOutline(entries, [])).toBe(false);
    expect(isOutline([entry('a', null, [])], ['rut'])).toBe(false);
    expect(isOutline([], [])).toBe(false);
  });

  it('groups an outline by folder in the order they first appear', () => {
    const a = entry('a', null, []);
    const b = { ...entry('b', null, []), place: { ...entry('b', null, []).place, bookLabel: 'Stories' } };
    const c = entry('c', null, []);
    expect(outlineSections([a, b, c]).map(([name, list]) => [name, list.map((e) => e.unitId)])).toEqual([['Lesson folder', ['a', 'c']], ['Stories', ['b']]]);
  });

  it('splits the shelf by testament, New first, and honours a pick only if the language has it', () => {
    const books = summarizeBooks([entry('p1', 'luk', [1]), entry('p2', 'gen', [1]), entry('p3', null, [])], 'all', new Set());
    const shelf = mapShelf(books, 'all', null);
    expect(shelf.testaments).toEqual(['nt', 'ot']);
    expect(shelf.shownTestament).toBe('nt');
    expect(shelf.visible.map((b) => b.key)).toEqual(['luk']);
    expect(shelf.other?.key).toBe(OTHER);
    expect(mapShelf(books, 'all', 'ot').visible.map((b) => b.key)).toEqual(['gen']);
    const ntOnly = summarizeBooks([entry('p1', 'luk', [1])], 'all', new Set());
    expect(mapShelf(ntOnly, 'all', 'ot').shownTestament).toBe('nt');
    expect(mapShelf([], 'all', null)).toMatchObject({ testaments: [], shownTestament: undefined, visible: [], other: undefined });
  });

  it('hides books and Other that the filter leaves empty', () => {
    const books = summarizeBooks(entries, 'done', new Set());
    const shelf = mapShelf(books, 'done', null);
    expect(shelf.visible.map((b) => b.key)).toEqual(['luk']);
    expect(shelf.other).toBeUndefined();
  });

  describe('search', () => {
    const books = summarizeBooks(entries, 'all', new Set());
    it('finds books by name until a chapter is typed, then the passages there', () => {
      expect(mapSearch('', books, entries)).toMatchObject({ searching: false, bookHits: [], passageHits: [] });
      const byName = mapSearch('lu', books, entries);
      expect(byName).toMatchObject({ searching: true, byChapter: false });
      expect(byName.bookHits.map((b) => b.key)).toEqual(['luk']);
      expect(byName.passageHits).toEqual([]);
      const byChapter = mapSearch('luke 1', books, entries);
      expect(byChapter.byChapter).toBe(true);
      expect(byChapter.bookHits).toEqual([]);
      expect(byChapter.passageHits.map((e) => e.unitId)).toEqual(['p1', 'p2']);
    });
    it('treats blank text as no search', () => {
      expect(mapSearch('   ', books, entries).searching).toBe(false);
    });
  });
});

describe('one book', () => {
  const entries = [
    entry('p1', 'luk', [1], recorded([true, false])),
    entry('p2', 'luk', [1], recorded([true, true])),
    entry('p3', 'luk', [2, 3], { awaitingResponse: [{}] } as never),
    entry('p4', 'joh', [3]),
    entry('p5', null, [])
  ];
  const luk = canonBook('luk')!;

  it('picks a book\'s passages, or those in no book for Other', () => {
    expect(bookEntries(entries, 'luk').map((e) => e.unitId)).toEqual(['p1', 'p2', 'p3']);
    expect(bookEntries(entries, OTHER).map((e) => e.unitId)).toEqual(['p5']);
    expect(bookEntries(entries, 'zzz')).toEqual([]);
  });

  it('filters passages, and lets all through for all', () => {
    expect(filterEntries(entries, 'all')).toHaveLength(5);
    expect(filterEntries(entries, 'feedback').map((e) => e.unitId)).toEqual(['p3']);
  });

  it('makes a tile for every chapter, filled from the passages that cover it', () => {
    const tiles = chapterTiles(luk, bookEntries(entries, 'luk'), new Set(['p3']), 'all');
    expect(tiles).toHaveLength(luk.chapters);
    expect(tiles[0]!.list.map((e) => e.unitId)).toEqual(['p1', 'p2']);
    // A passage spanning two chapters sits in both.
    expect(tiles[1]!.list.map((e) => e.unitId)).toEqual(['p3']);
    expect(tiles[2]!.list.map((e) => e.unitId)).toEqual(['p3']);
    expect(tiles[3]!.list).toEqual([]);
    expect(tiles[1]!.mine).toBe(true);
    expect(tiles[0]!.mine).toBe(false);
    expect(tiles.every((c) => c.matches)).toBe(true);
  });

  it('shows tiles only for a book whose passages are its chapters, one each (decisions.md 166)', () => {
    expect(chaptersAreWhole([entry('a', 'luk', [1]), entry('b', 'luk', [2])])).toBe(true);
    expect(chaptersAreWhole([])).toBe(true);
    // Two passages in one chapter, or one across two: passages.
    expect(chaptersAreWhole([entry('a', 'luk', [1]), entry('b', 'luk', [1])])).toBe(false);
    expect(chaptersAreWhole([entry('a', 'luk', [7, 8])])).toBe(false);
    expect(chaptersAreWhole(bookEntries(entries, 'luk'))).toBe(false);
  });

  it('counts steps cleared as the least of the recorded parts, and none until every part is recorded', () => {
    const tiles = chapterTiles(luk, bookEntries(entries, 'luk'), new Set(), 'all');
    expect(tiles[0]).toMatchObject({ steps: 2, cleared: 1 });
    const partly = chapterTiles(luk, [entry('a', 'luk', [1], recorded([true])), entry('b', 'luk', [1])], new Set(), 'all');
    expect(partly[0]).toMatchObject({ steps: 1, cleared: 0 });
    expect(chapterTiles(luk, [], new Set(), 'all')[0]).toMatchObject({ steps: 0, cleared: 0, tone: 'none' });
  });

  it('marks tiles outside the filter', () => {
    const tiles = chapterTiles(luk, bookEntries(entries, 'luk'), new Set(), 'feedback');
    expect(tiles.map((c) => c.matches).slice(0, 4)).toEqual([false, true, true, false]);
  });

  it('lays tiles in rows of the given width, the last one short', () => {
    const tiles = chapterTiles(luk, [], new Set(), 'all');
    const rows = chapterRows(tiles, 5);
    expect(rows.slice(0, -1).every((r) => r.length === 5)).toBe(true);
    expect(rows.flat()).toHaveLength(luk.chapters);
    expect(rows[rows.length - 1]!.length).toBe(luk.chapters % 5 || 5);
    expect(chapterRows([], 5)).toEqual([]);
  });

  describe('a tile\'s spoken label', () => {
    const tile = (extra: Partial<ReturnType<typeof chapterTiles>[number]>) =>
      ({ n: 3, list: [entry('a', 'luk', [3])], tone: 'todo', steps: 0, cleared: 0, mine: false, matches: true, ...extra }) as ReturnType<typeof chapterTiles>[number];
    it('starts with the chapter and its state', () => {
      expect(tileLabel(tile({}), [], false)).toBe('Chapter 3: Not recorded');
    });
    it('names steps cleared while in review', () => {
      expect(tileLabel(tile({ tone: 'review', steps: 3, cleared: 1 }), [], false)).toBe('Chapter 3: Recorded, in review (1 of 3 steps)');
    });
    it('adds parts, for you, changed and outside the filter, in that order', () => {
      const two = [entry('a', 'luk', [3]), entry('b', 'luk', [3])];
      expect(tileLabel(tile({ list: two, mine: true, matches: false }), [], true))
        .toBe('Chapter 3: Not recorded, 2 parts, for you, divisions changed since recorded, outside the filter');
    });
    it('says kept: all, some, and downloading until every kept one is ready', () => {
      const two = [entry('a', 'luk', [3]), entry('b', 'luk', [3])];
      expect(tileLabel(tile({}), [{ ready: true }], false)).toBe('Chapter 3: Not recorded, kept on this device');
      expect(tileLabel(tile({ list: two }), [{ ready: true }, { ready: true }], false)).toContain('all parts on this device');
      expect(tileLabel(tile({ list: two }), [{ ready: true }], false)).toContain('1 of 2 parts on this device');
      expect(tileLabel(tile({}), [{ ready: false }], false)).toContain('kept on this device (downloading)');
    });
  });
});
