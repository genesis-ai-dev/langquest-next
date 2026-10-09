import fs from 'node:fs';
import path from 'node:path';
import { foldLanguage as fold } from '../src/reducer';
import { emptyLanguageState, type LanguageState } from '../src/state';
import { asTemplateV2, templateBooks, validateDoc, withDeps, type TemplateDocV1, type TemplateDocV2 } from '../src/libraryDocs';
import { selectTemplateSpecs, templateUnits } from '../src/libraryApply';
import { bookParts, emptyBooks, goesWith, partCount, sameParts, verseNumbering, wayCovers, withBookBrokenUp, withEmptyBooksFilled } from '../src/breakup';
import { booksWaiting, buildIndexes, languagePassages } from '../src/indexes';
import { unitPlace, unitTitle } from '../src/passage';
import type { VersificationDoc } from '../src/versification';
import type { AnyEvent } from '../src/events';
import type { EventSpec } from '../src/commands';

const H = (c: string) => c.repeat(64);

function load(code: string): VersificationDoc {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../library/versifications', `${code}.json`), 'utf8'));
  return {
    format: 'versification@1', code, name: code,
    maxVerses: Object.fromEntries(Object.entries(raw.maxVerses as Record<string, string[]>).map(([b, vs]) => [b, vs.map(Number)])),
    mappedVerses: raw.mappedVerses ?? {}, excludedVerses: raw.excludedVerses ?? [], partialVerses: raw.partialVerses ?? {}
  };
}
const eng = load('eng');
const rsc = load('rsc');

const bible = (books: TemplateDocV2['bible'] extends infer B ? B extends { books: infer X } ? X : never : never, extra: Partial<TemplateDocV2> = {}): TemplateDocV2 => withDeps({
  format: 'template@2', name: 'Bible', description: '', structure: 'bible', levels: [{ name: 'Book' }, { name: 'Passage' }],
  bible: { versification: H('e'), books }, deps: [], ...extra
});

const fia = bible([
  { book: 'RUT', name: 'Ruth', divide: 'passages', part: 'Passage', passages: [{ ref: 'RUT 1:1-7' }, { ref: 'RUT 1:8-19a' }, { ref: 'RUT 1:19b-2:2' }, { ref: 'RUT 2:3-4:22' }] },
  { book: 'LUK', name: 'Luke', divide: 'passages', part: 'Passage', passages: [{ ref: 'LUK 15:1-10', name: 'The lost sheep and coin' }, { ref: 'LUK 15:11-32' }] },
  { book: 'ROM', name: 'Romans' }
], { name: 'FIA passages', goesWith: { pattern: 'FIA' } });
const chapters = bible([
  { book: 'RUT', name: 'Ruth', divide: 'chapters', part: 'Chapter' },
  { book: 'LUK', name: 'Luke', divide: 'chapters', part: 'Chapter' },
  { book: 'ROM', name: 'Romans', divide: 'chapters', part: 'Chapter' }
], { name: 'By chapter' });
const later = bible([{ book: 'RUT', name: 'Ruth' }, { book: 'LUK', name: 'Luke' }, { book: 'ROM', name: 'Romans' }], { name: 'Book by book' });

const apply = (state: LanguageState, specs: EventSpec[], at: number) =>
  fold(specs.map((s, i) => ({ ...s, orgId: 'o', streamId: 'L1', actorId: 'a', deviceId: 'd', hlc: `${String(at + i).padStart(15, '0')}:000000:d` }) as AnyEvent), state);

describe('a template that breaks up each book its own way (decision 74)', () => {
  it('validates book by book: an empty book is fine, a passage in the wrong book is not', () => {
    expect(validateDoc(fia)).toBeNull();
    expect(validateDoc(later)).toBeNull();
    const wrong = bible([{ book: 'RUT', name: 'Ruth', divide: 'passages', passages: [{ ref: 'LUK 1:1-4' }] }]);
    expect(validateDoc(wrong)).toMatch(/another book/);
    const twice = bible([{ book: 'RUT', name: 'Ruth' }, { book: 'RUT', name: 'Ruth' }]);
    expect(validateDoc(twice)).toMatch(/twice/);
    expect(validateDoc({ ...later, goesWith: { pattern: '' } })).toMatch(/goesWith/);
  });

  it('lists every book, with nothing in one that is not broken up yet', () => {
    const units = templateUnits(fia, 'fia', eng);
    expect(units.filter((u) => u.parentUnitId === null).map((u) => [u.unitId, u.kind])).toEqual([['fia/RUT', 'book'], ['fia/LUK', 'book'], ['fia/ROM', 'book']]);
    expect(units.filter((u) => u.parentUnitId === 'fia/ROM')).toEqual([]);
    expect(units.find((u) => u.unitId === 'fia/LUK.15.1-10')?.label).toBe('The lost sheep and coin');
    expect(units.find((u) => u.unitId === 'fia/LUK.15.11-32')?.label).toBe('Luke 15:11–32');
    expect(templateUnits(chapters, 'c', eng).filter((u) => u.parentUnitId === 'c/RUT').map((u) => u.unitId)).toEqual(['c/RUT.1', 'c/RUT.2', 'c/RUT.3', 'c/RUT.4']);
  });

  it('gives a template@1 the same parts, with the same ids, when it becomes a template@2', () => {
    const v1: TemplateDocV1 = withDeps({
      format: 'template@1', name: 'FIA', description: '', structure: 'bible', levels: [{ name: 'Book' }, { name: 'Passage' }],
      bible: { versification: H('e'), books: [{ book: 'RUT', name: 'Ruth' }], divide: 'passages', passages: [{ ref: 'RUT 1:1-7' }, { ref: 'RUT 1:8-22' }] }, deps: []
    });
    const v2 = asTemplateV2(v1);
    expect(validateDoc(v2)).toBeNull();
    const ids = (d: TemplateDocV1 | TemplateDocV2) => templateUnits(d, 'x', eng).map((u) => u.unitId);
    expect(ids(v2)).toEqual(ids(v1));
    expect(templateBooks(v2)[0]).toEqual({ book: 'RUT', name: 'Ruth', divide: 'passages', part: 'Passage', passages: [{ ref: 'RUT 1:1-7' }, { ref: 'RUT 1:8-22' }] });
  });

  it('breaks up one book from a way, leaving every other book as it was', () => {
    const next = withBookBrokenUp(later, 'RUT', fia);
    expect(bookParts(next, 'RUT')?.passages?.length).toBe(4);
    expect(bookParts(next, 'LUK')).toBeNull();
    expect(emptyBooks(next)).toEqual(['LUK', 'ROM']);
    expect(templateBooks(next).find((b) => b.book === 'RUT')?.name).toBe('Ruth');
    expect(() => withBookBrokenUp(later, 'ROM', fia)).toThrow(/does not break up ROM/);
    expect(wayCovers(fia, 'ROM')).toBe(false);
    expect(partCount(chapters, 'RUT', eng)).toBe(4);
    expect(sameParts(next, fia, 'RUT')).toBe(true);
    expect(sameParts(next, chapters, 'RUT')).toBe(false);
  });

  it("fills only the empty books from a second way (FIA's passages, then chapters)", () => {
    const filled = withEmptyBooksFilled(fia, chapters);
    expect(bookParts(filled, 'ROM')?.divide).toBe('chapters');
    expect(sameParts(filled, fia, 'LUK')).toBe(true);
    expect(goesWith(filled, 'FIA')).toBe(true);
    expect(goesWith(chapters, 'FIA')).toBe(false);
  });
});

describe('a language on a template broken up book by book', () => {
  it('shows a book that is not broken up as waiting, and nothing in it as a passage', () => {
    let state = emptyLanguageState();
    state = apply(state, selectTemplateSpecs(state, { commandId: 'c1', itemId: 'bible', docHash: H('1'), doc: withBookBrokenUp(later, 'RUT', fia), versification: eng }), 10);
    const idx = buildIndexes(state);
    expect(booksWaiting(state, idx)).toEqual(['bible/LUK', 'bible/ROM']);
    expect(languagePassages(state, idx)).toEqual(['bible/RUT.1.1-7', 'bible/RUT.1.8-19', 'bible/RUT.1.19-2.2', 'bible/RUT.2.3-4.22']);
  });

  it('keeps every part of every other book when one book is broken up, and hides the old parts of a book broken up again', () => {
    let state = emptyLanguageState();
    const one = withBookBrokenUp(later, 'RUT', chapters);
    state = apply(state, selectTemplateSpecs(state, { commandId: 'c1', itemId: 'bible', docHash: H('1'), doc: one, versification: eng }), 10);
    const two = withBookBrokenUp(one, 'LUK', fia);
    state = apply(state, selectTemplateSpecs(state, { commandId: 'c2', itemId: 'bible', docHash: H('2'), doc: two, versification: eng }), 100);
    expect(Object.values(state.hiddenUnits).filter((h) => h.value)).toEqual([]);
    expect(booksWaiting(state)).toEqual(['bible/ROM']);
    const three = withBookBrokenUp(two, 'RUT', fia);
    state = apply(state, selectTemplateSpecs(state, { commandId: 'c3', itemId: 'bible', docHash: H('3'), doc: three, versification: eng }), 200);
    expect(state.hiddenUnits['bible/RUT.1']?.value).toBe(true);
    // Hidden, not deleted: the chapter is still there for its recordings.
    expect(state.units['bible/RUT.1']).toBeDefined();
    expect(languagePassages(state).filter((u) => u.startsWith('bible/RUT'))).toHaveLength(4);
  });

  it("keeps the language's part ids when it moves to a copy split off from its template", () => {
    let state = emptyLanguageState();
    state = apply(state, selectTemplateSpecs(state, { commandId: 'c1', itemId: 'shared', docHash: H('1'), doc: withBookBrokenUp(later, 'RUT', chapters), versification: eng }), 10);
    const copy = withBookBrokenUp(withBookBrokenUp(later, 'RUT', chapters), 'LUK', fia);
    state = apply(state, selectTemplateSpecs(state, { commandId: 'c2', itemId: 'shared-hadiyya', docHash: H('2'), doc: copy, versification: eng, unitPrefix: 'shared' }), 100);
    expect(state.template?.value).toMatchObject({ itemId: 'shared-hadiyya', unitPrefix: 'shared' });
    expect(languagePassages(state).filter((u) => u.startsWith('shared/RUT'))).toEqual(['shared/RUT.1', 'shared/RUT.2', 'shared/RUT.3', 'shared/RUT.4']);
    expect(Object.values(state.hiddenUnits).filter((h) => h.value)).toEqual([]);
    // Its next version keeps that prefix too.
    state = apply(state, selectTemplateSpecs(state, { commandId: 'c3', itemId: 'shared-hadiyya', docHash: H('3'), doc: withBookBrokenUp(copy, 'ROM', chapters), versification: eng }), 200);
    expect(state.template?.value.unitPrefix).toBe('shared');
    expect(booksWaiting(state)).toEqual([]);
  });
});

describe('book names in the language', () => {
  it("names a book the language's way everywhere its template's name was", () => {
    let state = emptyLanguageState();
    state = apply(state, selectTemplateSpecs(state, { commandId: 'c1', itemId: 'bible', docHash: H('1'), doc: withBookBrokenUp(later, 'LUK', fia), versification: eng }), 10);
    expect(unitTitle(state, 'bible/LUK.15.11-32')).toBe('Luke 15:11–32');
    state = apply(state, [{ id: 'n1', type: 'v1.BookNameSet', payload: { book: 'LUK', name: 'Luqaas' } } as EventSpec], 50);
    expect(unitTitle(state, 'bible/LUK')).toBe('Luqaas');
    expect(unitTitle(state, 'bible/LUK.15.11-32')).toBe('Luqaas 15:11–32');
    // A passage the template named keeps its own name.
    expect(unitTitle(state, 'bible/LUK.15.1-10')).toBe('The lost sheep and coin');
    expect(unitPlace(state, 'bible/LUK.15.11-32').bookLabel).toBe('Luqaas');
  });
});

describe("verse numbers from a language's Bibles", () => {
  it('is English with no Bibles, the shared numbering when they agree, and shows one verse when they do not', () => {
    expect(verseNumbering([], eng)).toEqual({ code: 'eng', clash: null });
    expect(verseNumbering([{ name: 'NIV', versification: eng }, { name: 'ESV', versification: eng }], eng)).toEqual({ code: 'eng', clash: null });
    const both = verseNumbering([{ name: 'NIV', versification: eng }, { name: 'Russian Synodal', versification: rsc }], eng);
    expect(both.clash?.says).toBe('The Lord is my shepherd');
    expect(both.clash?.places).toEqual([{ name: 'NIV', ref: 'PSA 23:1' }, { name: 'Russian Synodal', ref: 'PSA 22:1' }]);
  });
});
