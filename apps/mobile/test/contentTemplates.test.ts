import {
  emptyState, buildIndexes, fold, HlcClock, instantiateTemplate, selectTemplateSpecs, validateDoc, withDeps,
  type AnyEvent, type EventSpec, type LibraryItemState, type LibraryItemView, type PartitionState, type TemplateDoc, type VersificationDoc
} from '@langquest-next/core';
import {
  addNode, bibleBook, bookRows, bookSegments, chapterBlocks, chipLabel, continuesInto, countOutline, defaultBooks, docFromForm, fiaStarts,
  formChanged, formFromDoc, laneTemplateLine, laneTemplateOf, levelsForDivide, levelsForOutline, libraryChoices, moveNode, newTemplateForm,
  parseRange, partName, pluralOf, rangeOfLabel, rangeOfUnit, recordedCount, removeNode, renameNode, setAsideCount, siblingsOf, toSegments,
  verseKey, versesText, versificationBooks
} from '../src/contentTemplates';
import type { SharedItem } from '../src/library/model';

const luke = bibleBook('luk')!;
const reg = <T,>(value: T) => ({ value, hlc: '1', eventId: 'e' });
const HASH = 'a'.repeat(64);
const V11N_HASH = 'b'.repeat(64);

let seq = 0;
const clock = new HlcClock('dev1', () => 1_700_000_000_000 + seq * 1000);
const fromSpecs = (specs: EventSpec[]) => specs.map((s) => {
  seq += 1;
  return { id: s.id, type: s.type, orgId: 'o1', partitionId: 'p1', actorId: 'admin', deviceId: 'dev1', hlc: clock.next(), payload: s.payload } as AnyEvent;
});

/** English numbering for Luke and Mark only, enough for these tests. */
const v11n: VersificationDoc = {
  format: 'versification@1', code: 'eng', name: 'English',
  maxVerses: { LUK: luke.verses, MRK: bibleBook('mar')!.verses, TOB: [22, 14] }, mappedVerses: {}
};

/** A passages template whose books are named in the language. */
const passagesDoc: TemplateDoc = {
  format: 'template@1', name: 'Story units', description: 'Luke in stories', structure: 'bible',
  levels: [{ name: 'Book' }, { name: 'Story', display: 'name' }],
  bible: {
    versification: V11N_HASH, books: [{ book: 'LUK', name: 'Luka' }], divide: 'passages',
    passages: [{ ref: 'LUK 15:1-10', name: 'The lost sheep' }, { ref: 'LUK 15:11-32', name: 'The lost son' }]
  },
  deps: [V11N_HASH]
};

/** A language on a legacy catalog template, as the app used to set one up. */
function withCatalogTemplate(templateId: string, laneId = 'L'): PartitionState {
  const s = emptyState();
  s.lanes[laneId] = { languoidId: 'din' };
  s.laneTemplates[laneId] = reg({ templateId, catalogVersion: 1 });
  for (const p of instantiateTemplate(templateId)) {
    s.units[p.unitId] = { parentUnitId: p.parentUnitId, kind: p.kind, label: p.label, order: p.order } as PartitionState['units'][string];
  }
  return s;
}

/** A language on a version of a library template. */
function withLibraryTemplate(doc: TemplateDoc, base?: PartitionState, books?: string[]): PartitionState {
  const start = base ?? fold(fromSpecs([{ id: 'lane', type: 'v1.LaneAdded', payload: { laneId: 'L', languoidId: 'din' } } as EventSpec]));
  const specs = selectTemplateSpecs(start, { commandId: `c${seq}`, laneId: 'L', itemId: 'stories.abc', docHash: HASH, doc, versification: v11n, ...(books ? { books } : {}) });
  return fold(fromSpecs(specs), start);
}

describe('verse ranges', () => {
  it('reads chapters, passages and partial verses', () => {
    expect(parseRange('15', luke)).toEqual({ from: { c: 15, v: 1 }, to: { c: 15, v: 32 } });
    expect(parseRange('15:11-32', luke)).toEqual({ from: { c: 15, v: 11 }, to: { c: 15, v: 32 } });
    expect(parseRange('15:30–16:8', luke)).toEqual({ from: { c: 15, v: 30 }, to: { c: 16, v: 8 } });
    expect(parseRange('12:9b-20', luke)).toEqual({ from: { c: 12, v: 9 }, to: { c: 12, v: 20 } });
    expect(parseRange('99', luke)).toBeNull();
    expect(parseRange('Luke', luke)).toBeNull();
  });

  it('reads a unit label against its book', () => {
    expect(rangeOfLabel('Luke', luke)).toEqual({ from: { c: 1, v: 1 }, to: { c: 24, v: 53 } });
    expect(rangeOfLabel('Luke 15', luke)?.to).toEqual({ c: 15, v: 32 });
    expect(rangeOfLabel('John 3', luke)).toBeNull();
  });

  it('writes ranges as the demo does', () => {
    expect(versesText({ from: { c: 15, v: 11 }, to: { c: 15, v: 32 } })).toBe('15:11–32');
    expect(chipLabel(luke, { from: { c: 15, v: 1 }, to: { c: 15, v: 32 } })).toBe('Ch 15');
    expect(chipLabel(luke, { from: { c: 15, v: 11 }, to: { c: 15, v: 32 } })).toBe('15:11–32');
  });

  it('pluralises level names', () => {
    expect(pluralOf('Story')).toBe('Stories');
    expect(pluralOf('Passage')).toBe('Passages');
    expect(pluralOf('Chapter')).toBe('Chapters');
  });
});

describe('segments and blocks', () => {
  it('never lets two parts claim a verse', () => {
    const segs = toSegments(luke, [
      { unitId: 'b', label: 'Luke 12:9b-20' },
      { unitId: 'a', label: 'Luke 12:1-9a' },
      { unitId: 'x', label: 'not a reference' }
    ]);
    expect(segs.map((s) => [s.unitId, versesText(s)])).toEqual([['a', '12:1–9'], ['b', '12:10–20']]);
  });

  it('lays out a chapter: cards where parts start, FIA suggestions, gaps and verse runs', () => {
    const segs = toSegments(luke, [{ unitId: 'p1', label: 'Luke 15:1-10' }]);
    const blocks = chapterBlocks(luke, 15, segs, new Set([verseKey({ c: 15, v: 11 })]), (_c, v) => (v === 1 ? 'Now the tax collectors…' : undefined));
    expect(blocks[0]).toMatchObject({ kind: 'card', n: 1 });
    expect(blocks[1]).toMatchObject({ kind: 'para', n: 1 });
    expect((blocks[1] as { verses: unknown[] }).verses).toHaveLength(10);
    expect((blocks[1] as { verses: { text?: string }[] }).verses[0]!.text).toBe('Now the tax collectors…');
    expect(blocks.slice(2).map((b) => b.kind)).toEqual(['fia', 'gap', 'para']);
    expect(blocks[3]).toEqual({ kind: 'gap', from: 11 });
  });

  it('says which part a chapter continues', () => {
    const segs = toSegments(luke, [{ unitId: 'p', label: 'Luke 15:30-16:8' }]);
    expect(continuesInto(segs, 16)?.unitId).toBe('p');
    expect(continuesInto(segs, 15)).toBeNull();
  });

  it('knows where FIA starts passages', () => {
    const starts = fiaStarts(luke);
    expect(starts.size).toBeGreaterThan(10);
    expect(fiaStarts(bibleBook('lev')!).size).toBe(0);
  });
});

describe('a language on a template from the app (legacy)', () => {
  it('reads its name, levels, books and a book as segments', () => {
    const s = withCatalogTemplate('bible');
    expect(laneTemplateOf(s, 'L')).toMatchObject({ source: 'legacy', name: 'Chapter Units', levels: ['Book', 'Chapter'] });
    expect(laneTemplateLine(s, () => null, 'L')).toBe('Chapter Units · from the app');
    const idx = buildIndexes(s);
    const rows = bookRows(s, idx, 'L');
    expect(rows).toHaveLength(66);
    expect(rows.find((r) => r.book.itemId === 'luk')).toMatchObject({ label: 'Luke', parts: 24 });
    const segs = bookSegments(s, idx, 'L', luke);
    expect(segs).toHaveLength(24);
    expect(segs[14]).toMatchObject({ from: { c: 15, v: 1 }, to: { c: 15, v: 32 } });
    expect(partName(s, 'L')).toBe('Chapter');
  });

  it('reads FIA passages, spelling Mark and John the canon way', () => {
    const s = withCatalogTemplate('fia');
    const mark = bookSegments(s, buildIndexes(s), 'L', bibleBook('mar')!);
    expect(mark.length).toBeGreaterThan(5);
    expect(mark[0]!.from).toEqual({ c: 1, v: 1 });
    expect(partName(s, 'L')).toBe('Passage');
  });
});

describe('a language on a library template', () => {
  it('reads its passages from their ids, whatever the language calls them', () => {
    const s = withLibraryTemplate(passagesDoc);
    expect(laneTemplateOf(s, 'L')).toEqual({ source: 'library', itemId: 'stories.abc', docHash: HASH, books: null });
    const idx = buildIndexes(s);
    expect(bookRows(s, idx, 'L')).toEqual([{ book: luke, label: 'Luka', parts: 2 }]);
    const segs = bookSegments(s, idx, 'L', luke);
    expect(segs.map(versesText)).toEqual(['15:1–10', '15:11–32']);
    expect(partName(s, 'L', passagesDoc)).toBe('Story');
    expect(partName(s, 'L')).toBe('Passage');
  });

  it('reads a book or a chapter unit as all of it', () => {
    expect(rangeOfUnit('x.1/LUK', 'Luka', luke)).toEqual({ from: { c: 1, v: 1 }, to: { c: 24, v: 53 } });
    expect(rangeOfUnit('x.1/LUK.15', 'Luka 15', luke)).toEqual({ from: { c: 15, v: 1 }, to: { c: 15, v: 32 } });
    expect(rangeOfUnit('x.1/MRK.1', 'Mark 1', luke)).toBeNull();
    expect(rangeOfUnit('bible@1/luk-15', 'Luke 15', luke)?.from).toEqual({ c: 15, v: 1 });
  });

  it('names its version on the language row', () => {
    const s = withLibraryTemplate(passagesDoc);
    const item = { itemId: 'stories.abc', name: 'Story units', versions: [{ docHash: 'c'.repeat(64), n: 1 }, { docHash: HASH, n: 2 }] } as LibraryItemView;
    expect(laneTemplateLine(s, () => null, 'L')).toBe('A template');
    expect(laneTemplateLine(s, (id) => (id === item.itemId ? item : null), 'L')).toBe('Story units · version 2');
  });

  it('counts recordings set aside by another template, a dropped part, or narrowed books', () => {
    const s = withLibraryTemplate(passagesDoc);
    const take = (unitId: string) => ({ unitId, laneId: 'L', cardHashes: ['h'], parentTakeId: null, actorId: 'a', hlc: '1', archived: false });
    s.takes['t1'] = take('stories.abc/LUK.15.1-10');
    s.takes['t2'] = take('bible@1/luk-15');
    s.takes['t3'] = take('hand-added');
    expect(setAsideCount(s, 'L')).toBe(1);
    // The next version drops the lost sheep: hidden, never deleted (TPL-7).
    const next = withLibraryTemplate({ ...passagesDoc, bible: { ...passagesDoc.bible!, passages: passagesDoc.bible!.passages!.slice(1) } }, s);
    expect(next.laneHiddenUnits['L']?.['stories.abc/LUK.15.1-10']?.value).toBe(true);
    expect(setAsideCount(next, 'L')).toBe(2);
    expect(recordedCount(next, 'L')).toBe(3);
  });
});

describe('choosing a template', () => {
  const row = (org: string, item: string, name: string): SharedItem => ({
    org_id: org, org_name: org === 'langquest' ? 'LangQuest' : 'Wycliffe', item_id: item, kind: 'template', name, description: '',
    subscribable: true, version_count: 1, latest_hash: HASH, updated_hlc: '1'
  });

  it('lists ours first, then shared ones not followed yet, LangQuest and its starter first', () => {
    const library: Record<string, LibraryItemState> = {};
    const own = { itemId: 'mine.1', name: 'Ours', archived: false, current: HASH } as never;
    const archived = { itemId: 'old.1', name: 'Old', archived: true, current: HASH } as never;
    const noVersion = { itemId: 'new.1', name: 'New', archived: false, current: null } as never;
    library['sub.langquest.bible'] = {} as LibraryItemState;
    const choices = libraryChoices(library, [own, archived, noVersion], [
      row('wa', 'a', 'Acts stories'),
      row('langquest', 'bible', 'Bible chapters (English)'),
      row('langquest', 'books', 'Bible books (English)'),
      row('langquest', 'fia', 'FIA passages (English)')
    ], 'FIA passages (English)');
    expect(choices.map((c) => c.key)).toEqual(['ours:mine.1', 'shared:langquest/fia', 'shared:langquest/books', 'shared:wa/a']);
  });
});

describe('the template editor', () => {
  it('turns a document into a form and back into a valid document', () => {
    const f = formFromDoc(passagesDoc);
    expect(f).toMatchObject({ structure: 'bible', versification: V11N_HASH, divide: 'passages', books: [{ book: 'LUK', name: 'Luka' }] });
    const doc = withDeps(docFromForm(f));
    expect(validateDoc(doc)).toBeNull();
    expect(doc).toEqual(passagesDoc);
    expect(formChanged(f, formFromDoc(passagesDoc))).toBe(false);
    expect(formChanged({ ...f, books: [{ book: 'LUK', name: 'Luke' }] }, f)).toBe(true);
    // Passages of a book taken out go with it.
    expect(docFromForm({ ...f, books: [] }).bible!.passages).toEqual([]);
  });

  it('starts a Bible template from a versification with the canon books it has, in order', () => {
    expect(versificationBooks(v11n)).toEqual(['MRK', 'LUK', 'TOB']);
    expect(defaultBooks(v11n)).toEqual([{ book: 'MRK', name: 'Mark' }, { book: 'LUK', name: 'Luke' }]);
    const f = newTemplateForm('bible', { hash: V11N_HASH, doc: v11n });
    expect(validateDoc(withDeps(docFromForm({ ...f, name: 'Gospels' })))).toBeNull();
    expect(levelsForDivide(f.levels, 'books')).toEqual([{ name: 'Book' }]);
    expect(levelsForDivide([{ name: 'Kitab' }], 'passages')).toEqual([{ name: 'Kitab' }, { name: 'Passage', display: 'reference' }]);
  });

  it('edits an outline: add, rename, move and remove, with a level for each depth', () => {
    let o = addNode([], null, { id: 'm1', title: 'Module 1', folder: true });
    o = addNode(o, 'm1', { id: 'l1', title: 'Lesson 1', folder: false });
    o = addNode(o, 'm1', { id: 'l2', title: 'Lesson 2', folder: false });
    o = renameNode(o, 'l2', 'Hand washing');
    o = moveNode(o, 'l2', -1);
    expect(o[0]!.children!.map((n) => n.title)).toEqual(['Hand washing', 'Lesson 1']);
    expect(siblingsOf(o, 'l1').map((n) => n.id)).toEqual(['l2', 'l1']);
    expect(countOutline(o)).toEqual({ folders: 1, items: 2 });
    const sub = addNode(o, 'm1', { id: 'deep', title: 'Deep', folder: true });
    expect(levelsForOutline(addNode(sub, 'deep', { id: 'x', title: 'x', folder: false }), [{ name: 'Section' }, { name: 'Lesson' }]).map((l) => l.name))
      .toEqual(['Section', 'Part', 'Lesson']);
    o = removeNode(o, 'l1');
    const f = { ...newTemplateForm('outline'), name: 'Health', outline: o };
    expect(validateDoc(withDeps(docFromForm(f)))).toBeNull();
  });
});
