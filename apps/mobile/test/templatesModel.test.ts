// The template screens' rules (src/templates/model.ts): which view this is,
// the lines a card says, what the picker offers, and when the editor may save.
import { describe, expect, it } from 'vitest';
import type { LibraryItemView, TemplateDoc, TemplateDocV2, VersificationDoc } from '@langquest-next/core';
import { newTemplateForm, type LibraryChoice, type TemplateForm } from '../src/contentTemplates';
import type { SharedItem } from '../src/library/model';
import {
  bookRowSub, choiceInUse, defaultDisplay, displayExample, editorSub, filterBooks, formReady, isOpenLanguage, joinNames, languageSummary,
  languageVersionView, levelNameAt, levelSub, missingBooks, movesLine, outlineHolds, outlineSummary, partsCount, pendingUpdate,
  pickerLists, pickerNote, publishedVersion, redividedBooks, renamedTitle, savedToast, splitArchived, templatesLevel, versionLineOf, versificationLabel
} from '../src/templates/model';

const item = (over: Partial<LibraryItemView> = {}): LibraryItemView => ({
  itemId: 'stories.abc', kind: 'template', name: 'Stories', description: '', source: 'own', copiedFrom: null, subscription: null,
  shared: false, subscribable: false, archived: false, versions: [], current: null, ...over
});

const followed = (autoUpdate: boolean, active = true): LibraryItemView =>
  item({ source: 'subscription', subscription: { sourceOrgId: 'lq', sourceOrgName: 'LangQuest', sourceItemId: 'x', autoUpdate, active } });

const version = (docHash: string, n: number) => ({ docHash, n, hlc: `h${n}`, eventId: `e${n}`, note: '' }) as LibraryItemView['versions'][number];

const shared = { org_id: 'lq', org_name: 'LangQuest', item_id: 'x', name: 'FIA', version_count: 1, latest_hash: 'h' } as unknown as SharedItem;
const ours = (it: LibraryItemView): LibraryChoice => ({ key: `ours:${it.itemId}`, source: 'ours', item: it, name: it.name, hash: 'h' });
const theirs: LibraryChoice = { key: 'shared:lq/x', source: 'shared', shared, name: 'FIA', hash: 'h' };

describe('names and counts', () => {
  it('joins names with commas and "and"', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['Dinka'])).toBe('Dinka');
    expect(joinNames(['Dinka', 'Nuer'])).toBe('Dinka and Nuer');
    expect(joinNames(['Dinka', 'Nuer', 'Shilluk'])).toBe('Dinka, Nuer and Shilluk');
  });

  it('says who moves to a new version, agreeing with how many', () => {
    expect(movesLine([])).toBe('');
    expect(movesLine(['Dinka'])).toBe('Dinka moves to it by itself.');
    expect(movesLine(['Dinka', 'Nuer'])).toBe('Dinka and Nuer move to it by themselves.');
  });

  it("counts a language's parts in the template's word, lower-cased", () => {
    expect(partsCount(1, { one: 'Story', many: 'Stories' })).toBe('1 story');
    expect(partsCount(12, { one: 'Passage', many: 'Passages' })).toBe('12 passages');
  });
});

describe('which view of templates this is', () => {
  it('follows the params first', () => {
    expect(templatesLevel({ level: 'org' }, { level: 'language', languageId: 'din' }, 'din')).toEqual({ level: 'org', languageId: null });
    expect(templatesLevel({ level: 'language' }, null, 'din')).toEqual({ level: 'language', languageId: 'din' });
    expect(templatesLevel({ languageId: 'nue' }, { level: 'org' }, 'din')).toEqual({ level: 'language', languageId: 'nue' });
  });

  it("otherwise follows the viewer's own scope", () => {
    expect(templatesLevel({}, { level: 'org' }, 'din')).toEqual({ level: 'org', languageId: null });
    expect(templatesLevel({}, { level: 'language', languageId: 'nue' }, 'din')).toEqual({ level: 'language', languageId: 'nue' });
    expect(templatesLevel({}, null, 'din')).toEqual({ level: 'language', languageId: 'din' });
    expect(templatesLevel({}, null, null)).toEqual({ level: 'language', languageId: null });
  });

  it('reads state only for the open language', () => {
    expect(isOpenLanguage('din', 'din')).toBe(true);
    expect(isOpenLanguage('din', 'nue')).toBe(false);
    expect(isOpenLanguage('din', null)).toBe(false);
  });
});

describe('the organization library', () => {
  it('splits what is in use from what is set aside', () => {
    const a = item({ itemId: 'a' });
    const b = item({ itemId: 'b', archived: true });
    expect(splitArchived([a, b])).toEqual({ active: [a], archived: [b] });
  });

  it('offers an update only for a followed template that does not take them by itself', () => {
    const updates = { 'stories.abc': 'newhash' };
    expect(pendingUpdate(followed(false), updates)).toBe('newhash');
    expect(pendingUpdate(followed(true), updates)).toBeUndefined();
    expect(pendingUpdate(followed(false, false), updates)).toBeUndefined();
    expect(pendingUpdate(item(), updates)).toBeUndefined();
    expect(pendingUpdate(null, updates)).toBeUndefined();
  });
});

describe("a language's template card", () => {
  it('words the version by where it came from', () => {
    expect(versionLineOf(2, item())).toBe('Version 2');
    expect(versionLineOf(2, followed(true))).toBe('Version 2 · from LangQuest');
    expect(versionLineOf(3, item({ copiedFrom: { orgId: 'lq', orgName: 'LangQuest', itemId: 'x', docHash: 'h' } }))).toBe('Version 3 · copied from LangQuest');
    expect(versionLineOf(null, followed(true))).toBe('from LangQuest');
    expect(versionLineOf(null, item())).toBe('');
    expect(versionLineOf(null, null)).toBe('');
  });

  it('says when the item has moved on from the version the language uses', () => {
    const it = item({ versions: [version('h1', 1), version('h2', 2)], current: 'h2' });
    expect(languageVersionView(it, { docHash: 'h1' }, {})).toMatchObject({ versionLine: 'Version 1', newer: 2, update: undefined });
    expect(languageVersionView(it, { docHash: 'h2' }, {}).newer).toBeNull();
    expect(languageVersionView(it, null, {}).newer).toBeNull();
    expect(languageVersionView(null, { docHash: 'h1' }, {})).toEqual({ versionLine: '', newer: null, update: undefined });
  });

  it('carries a followed update through', () => {
    const it = { ...followed(false), versions: [version('h1', 1)], current: 'h1' };
    expect(languageVersionView(it, { docHash: 'h1' }, { 'stories.abc': 'h9' }).update).toBe('h9');
  });

  const bibleDoc = { structure: 'bible', bible: { books: [{ book: 'LUK' }, { book: 'MRK' }] } } as unknown as TemplateDoc;
  const outlineDoc = { structure: 'outline' } as unknown as TemplateDoc;
  const words = { one: 'Story', many: 'Stories' };

  it('summarises a Bible template: books chosen, numbering, parts and recordings', () => {
    const v11n = { name: 'English' } as VersificationDoc;
    expect(languageSummary({ doc: bibleDoc, chosenBooks: 1, v11n, bookRows: 1, progress: { total: 4, recorded: 2 }, words })).toEqual({
      bibleLine: '1 of its 2 books · English versification',
      countsLine: '4 stories · 2 recorded'
    });
  });

  it('counts books in the counts line only when the template is not Scripture', () => {
    const out = languageSummary({ doc: outlineDoc, chosenBooks: null, v11n: null, bookRows: 3, progress: { total: 0, recorded: 0 }, words });
    expect(out.bibleLine).toBeNull();
    expect(out.countsLine.startsWith('3 books · ')).toBe(true);
    const bible = languageSummary({ doc: bibleDoc, chosenBooks: null, v11n: null, bookRows: 3, progress: { total: 0, recorded: 0 }, words });
    expect(bible.countsLine.startsWith('0 stories')).toBe(true);
    expect(bible.bibleLine).toContain('2 books');
  });

  it('finds a book by any of its names', () => {
    const rows = [
      { label: 'Luka', book: { itemId: 'luk', label: 'Luke' } },
      { label: 'Marko', book: { itemId: 'mar', label: 'Mark' } }
    ];
    const nameOf = (id: string) => ({ luk: 'Luke (app)', mar: 'Mark (app)' })[id] ?? id;
    expect(filterBooks(rows, '', nameOf)).toHaveLength(2);
    expect(filterBooks(rows, '  ', nameOf)).toHaveLength(2);
    expect(filterBooks(rows, 'luk', nameOf).map((r) => r.label)).toEqual(['Luka']);
    expect(filterBooks(rows, 'MARK', nameOf).map((r) => r.label)).toEqual(['Marko']);
    expect(filterBooks(rows, '(app)', nameOf)).toHaveLength(2);
    expect(filterBooks(rows, 'john', nameOf)).toEqual([]);
  });
});

describe('choosing a template', () => {
  it("marks the language's own template as in use, and only an organization's own", () => {
    const mine = ours(item());
    expect(choiceInUse(mine, { itemId: 'stories.abc' })).toBe(true);
    expect(choiceInUse(mine, { itemId: 'other' })).toBe(false);
    expect(choiceInUse(mine, null)).toBe(false);
    expect(choiceInUse(theirs, { itemId: 'x' })).toBe(false);
  });

  it("offers what others share only to someone who may write the organization's library", () => {
    const all = [ours(item()), theirs];
    expect(pickerLists(all, true)).toEqual({ ours: [all[0]], others: [theirs] });
    expect(pickerLists(all, false)).toEqual({ ours: [all[0]], others: [] });
  });

  it("offers LangQuest's ways once, in the language's numbering, and not its older templates (decision 106)", () => {
    const lq = (item_id: string): LibraryChoice => ({ key: `shared:langquest/${item_id}`, source: 'shared', shared: { ...shared, org_id: 'langquest', item_id }, name: item_id, hash: 'h' });
    const all = [lq('langquest.bible.fia'), lq('langquest.bible.fia.org-66'), lq('langquest.template.bible-chapters-rso'), theirs];
    expect(pickerLists(all, true).others.map((c) => c.name)).toEqual(['langquest.bible.fia', 'FIA']);
    expect(pickerLists(all, true, 'org').others.map((c) => c.name)).toEqual(['langquest.bible.fia.org-66', 'FIA']);
  });

  it('names the books a save divides again, so Save warns first (decision 106)', () => {
    const tpl = (books: TemplateDocV2['bible'] extends infer B ? B extends { books: infer X } ? X : never : never): TemplateDocV2 => ({
      format: 'template@2', name: 't', description: '', structure: 'bible', levels: [{ name: 'Book' }, { name: 'Passage' }], bible: { versification: 'v', books }, deps: ['v']
    });
    const start = tpl([{ book: 'RUT', name: 'Ruth', divide: 'chapters' }, { book: 'ROM', name: 'Romans' }]);
    const now = tpl([{ book: 'RUT', name: 'Ruth', divide: 'passages', passages: [{ ref: 'RUT 1:1-4:22' }] }, { book: 'ROM', name: 'Romans', divide: 'chapters' }]);
    // Ruth was divided and is divided differently; Romans was waiting, so dividing it moves nothing.
    expect(redividedBooks(start, now, [{ book: 'RUT', name: 'Ruth' }, { book: 'ROM', name: 'Romans' }])).toEqual(['Ruth']);
    expect(redividedBooks(start, start, [{ book: 'RUT', name: 'Ruth' }])).toEqual([]);
  });

  it('says what changing does: hides parts, hides recorded ones, or starts afresh', () => {
    const base = { language: 'Dinka', currentParts: 'stories', pick: ours(item({ name: 'Passages' })) };
    expect(pickerNote({ ...base, hasCurrent: true, recorded: 0 })).toBe("Dinka's current stories are hidden, not deleted.");
    expect(pickerNote({ ...base, hasCurrent: true, recorded: 5 })).toContain('5 parts have recordings');
    expect(pickerNote({ ...base, hasCurrent: false, recorded: 5 })).toBe('Dinka will record against Passages. You can change it later; nothing recorded is ever deleted.');
    expect(pickerNote({ ...base, hasCurrent: false, recorded: 0 })).not.toContain('follows it');
  });

  it('adds that a shared template is followed', () => {
    const note = pickerNote({ language: 'Dinka', currentParts: 'stories', pick: theirs, hasCurrent: false, recorded: 0 });
    expect(note).toBe("Dinka will record against FIA. You can change it later; nothing recorded is ever deleted. Your organization follows it, so LangQuest's new versions reach Dinka by themselves.");
  });
});

describe('the template editor', () => {
  const outline = (): TemplateForm => ({ ...newTemplateForm('outline'), name: 'Songs', outline: [{ id: 'a', title: 'One' }] });
  const bible = (): TemplateForm => ({ ...newTemplateForm('outline'), structure: 'bible', name: 'Luke', versification: 'vhash', books: [{ book: 'LUK', name: 'Luke' }] });

  it('saves an outline only with a name and a part', () => {
    expect(formReady(outline())).toBe(true);
    expect(formReady({ ...outline(), name: '   ' })).toBe(false);
    expect(formReady({ ...outline(), outline: [] })).toBe(false);
  });

  it('saves Scripture only with a name, a versification and a book', () => {
    expect(formReady(bible())).toBe(true);
    expect(formReady({ ...bible(), versification: null })).toBe(false);
    expect(formReady({ ...bible(), books: [] })).toBe(false);
    expect(formReady({ ...bible(), name: '' })).toBe(false);
    // An outline is not needed for Scripture.
    expect(formReady({ ...bible(), outline: [] })).toBe(true);
  });

  it('names the versification by its document, else the choice, else says why not', () => {
    expect(versificationLabel({ name: 'English' } as VersificationDoc, 'Other', 'h')).toBe('English');
    expect(versificationLabel(null, 'Other', 'h')).toBe('Other');
    expect(versificationLabel(null, undefined, 'h')).toBe('Loading…');
    expect(versificationLabel(null, undefined, null)).toBe('Choose one');
  });

  it('numbers the version a save publishes', () => {
    expect(publishedVersion(null, 'h1')).toBe(1);
    const it = item({ versions: [version('h1', 1), version('h2', 2)] });
    expect(publishedVersion(it, 'h3')).toBe(3);
    // Saving what is already a version adds none.
    expect(publishedVersion(it, 'h1')).toBe(2);
  });

  it('says what a save did, and who moves to the new version', () => {
    expect(savedToast({ isNew: true, name: 'Songs', n: 1, users: ['Dinka'] })).toBe('Songs created.');
    expect(savedToast({ isNew: false, name: 'Songs', n: 2, users: ['Dinka'] })).toBe('Songs saved as version 2. Dinka moves to it by itself.');
    expect(savedToast({ isNew: false, name: 'Songs', n: 2, users: [] })).toBe('Songs saved as version 2.');
  });

  it('puts the right line under the title', () => {
    expect(editorSub(true, null, 'Org')).toBe(editorSub(true, item(), 'Org'));
    expect(editorSub(false, followed(true), 'Org')).not.toBe(editorSub(false, item(), 'Org'));
  });

  it('lists the books the versification has that the template lacks', () => {
    expect(missingBooks(['GEN', 'LUK', 'MRK'], [{ book: 'LUK' }])).toEqual(['GEN', 'MRK']);
    expect(missingBooks(['LUK'], [{ book: 'LUK' }])).toEqual([]);
    expect(missingBooks(null, [{ book: 'LUK' }])).toEqual([]);
  });

  it("shows the app's name for a book only when the template renames it, and the chapter count when known", () => {
    expect(bookRowSub('LUK', 'Luka', 'Luke', 24)).toBe('LUK · Luke · 24 chapters');
    expect(bookRowSub('LUK', 'Luke', 'Luke', 24)).toBe('LUK · 24 chapters');
    expect(bookRowSub('LUK', 'Luke', 'Luke', 0)).toBe('LUK');
  });

  it('explains each level by what it holds, and how the last is shown', () => {
    expect(levelSub(0, 3)).not.toBe(levelSub(1, 3));
    expect(levelSub(1, 3)).not.toBe(levelSub(2, 3, 'reference'));
    expect(levelSub(0, 3)).toBe(levelSub(0, 4));
    expect(new Set([levelSub(2, 3, 'reference'), levelSub(2, 3, 'name'), levelSub(2, 3, 'both')]).size).toBe(3);
    expect(levelSub(2, 3)).toBe(levelSub(2, 3, 'reference'));
  });

  it('shows parts by reference for Scripture and by name otherwise, unless told', () => {
    expect(defaultDisplay({}, true)).toBe('reference');
    expect(defaultDisplay({}, false)).toBe('name');
    expect(defaultDisplay({ display: 'both' }, true)).toBe('both');
  });

  it('gives an example of each way of showing a part', () => {
    expect(displayExample('reference', 'Luke 15:11–32')).toBe('Luke 15:11–32');
    expect(displayExample('name', 'Luke 15:11–32')).not.toContain('Luke 15');
    expect(displayExample('both', 'Luke 15:11–32')).toContain('Luke 15:11–32');
  });
});

describe('the outline', () => {
  it('knows what a level holds, so only a matching add button shows', () => {
    expect(outlineHolds([])).toBe('either');
    expect(outlineHolds([{ id: 'a', title: 'A', children: [] }])).toBe('folders');
    expect(outlineHolds([{ id: 'a', title: 'A' }])).toBe('items');
  });

  it('says what a folder holds: folders if it has any, else items', () => {
    expect(outlineSummary([{ id: 'a', title: 'A', children: [] }])).toBe('1 folder');
    expect(outlineSummary([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }])).toBe('2 items');
    expect(outlineSummary([])).toBe('0 items');
  });

  it('names a depth after its level, the last for anything deeper', () => {
    const levels = [{ name: 'Book' }, { name: 'Chapter' }, { name: 'Story' }];
    expect(levelNameAt(levels, 0)).toBe('Book');
    expect(levelNameAt(levels, 2)).toBe('Story');
    expect(levelNameAt(levels, 7)).toBe('Story');
    expect(levelNameAt([], 0)).toBe('Part');
  });

  it('renames only to a filled-in, different title', () => {
    expect(renamedTitle('  Psalms ', 'Songs')).toBe('Psalms');
    expect(renamedTitle('Songs', 'Songs')).toBeNull();
    expect(renamedTitle(' Songs ', 'Songs')).toBeNull();
    expect(renamedTitle('   ', 'Songs')).toBeNull();
  });
});
