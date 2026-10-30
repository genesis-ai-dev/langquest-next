import fs from 'node:fs';
import path from 'node:path';
import { foldOrg, libraryItemView, ORG_STREAM, subscriptionItemId, type AnyEvent, type TemplateDocV2, type VersificationDoc } from '@langquest-next/core';
import { withBookBrokenUp } from '@langquest-next/core';
import {
  booksLine, copyName, copyOffOps, countLine, divisionLine, emptyLine, groupNames, isItself, piecesOf, planChange, sharedTemplateShown, usedLine, wayNow, wayOf, wayRows,
  type TemplateUser
} from '../src/breakup/model';
import type { LibraryChoice } from '../src/templates/contentTemplatesModel';
import { publishOps, subscribeOps, type LibraryOp, type SharedItem } from '../src/library/model';
import { addCatalog, showLanguage } from '../src/i18n';

const H = (c: string) => c.repeat(64);
let seq = 0;
const fold = (ops: LibraryOp[]) => foldOrg(ops.map((op) => ({ ...op, id: `e${++seq}`, orgId: 'o', streamId: ORG_STREAM, actorId: 'a', deviceId: 'd', hlc: `${String(seq).padStart(15, '0')}:000000:d` }) as AnyEvent)).library;

const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../library/versifications/eng.json'), 'utf8'));
const eng: VersificationDoc = {
  format: 'versification@1', code: 'eng', name: 'English', mappedVerses: raw.mappedVerses ?? {},
  maxVerses: Object.fromEntries(Object.entries(raw.maxVerses as Record<string, string[]>).map(([b, vs]) => [b, vs.map(Number)]))
};

const doc = (name: string, books: TemplateDocV2['bible'] extends infer B ? B extends { books: infer X } ? X : never : never): TemplateDocV2 => ({
  format: 'template@2', name, description: '', structure: 'bible', levels: [{ name: 'Book' }, { name: 'Passage' }], bible: { versification: H('e'), books }, deps: [H('e')]
});
const fia = doc('FIA passages', [
  { book: 'RUT', name: 'Ruth', divide: 'passages', part: 'Passage', passages: [{ ref: 'RUT 1:1-7' }, { ref: 'RUT 1:8-19a' }, { ref: 'RUT 1:19b-2:2' }, { ref: 'RUT 2:3-4:22' }] },
  { book: 'ROM', name: 'Romans' }, { book: 'HEB', name: 'Hebrews' }, { book: 'REV', name: 'Revelation' }, { book: 'JER', name: 'Jeremiah' }
]);
const chapters = doc('By chapter', [{ book: 'RUT', name: 'Ruth', divide: 'chapters', part: 'Chapter' }, { book: 'ROM', name: 'Romans', divide: 'chapters', part: 'Chapter' }]);
const later = doc('Book by book', [{ book: 'RUT', name: 'Ruth' }]);

const share = (item: string, hash: string, name: string): SharedItem => ({
  org_id: 'langquest', org_name: 'LangQuest', item_id: item, kind: 'template', name, description: '', subscribable: true, version_count: 1, latest_hash: hash, updated_hlc: ''
});
const docs = new Map([[H('f'), fia], [H('c'), chapters], [H('l'), later]]);

describe('the ways to break up the Bible, in the order an admin sees them', () => {
  const lib = fold(subscribeOps(share('langquest.bible.chapters', H('c'), 'By chapter'), true).ops);
  const ours = libraryItemView(lib, subscriptionItemId('langquest', 'langquest.bible.chapters'))!;
  const choices: LibraryChoice[] = [
    { key: 'ours:chapters', source: 'ours', item: ours, name: ours.name, hash: H('c') },
    { key: 'shared:fia', source: 'shared', shared: share('langquest.bible.fia', H('f'), 'FIA passages'), name: 'FIA passages', hash: H('f') },
    { key: 'shared:later', source: 'shared', shared: share('langquest.bible.book-by-book', H('l'), 'Book by book'), name: 'Book by book', hash: H('l') }
  ];
  const follow = (s: { org_id: string; item_id: string }) => subscriptionItemId(s.org_id, s.item_id);

  it("puts what other languages use first, marked with where, then LangQuest's ways, then book by book", () => {
    const rows = wayRows({ choices, docOf: (h) => docs.get(h) ?? null, others: [{ languageId: 'din', name: 'Dinka', itemId: ours.itemId }], current: null, follow });
    expect(rows.map((r) => [r.choice.name, r.usedIn])).toEqual([['By chapter', ['Dinka']], ['FIA passages', []], ['Book by book', []]]);
    expect(rows[2]!.later).toBe(true);
    expect(wayOf(choices[0]!)).toBe('langquest.bible.chapters');
    const plain = wayRows({ choices, docOf: (h) => docs.get(h) ?? null, others: [], current: null, follow });
    expect(plain.map((r) => r.choice.name)).toEqual(['FIA passages', 'By chapter', 'Book by book']);
  });

  it('says where a way is used and what it gives the whole Bible', () => {
    expect(usedLine(['Dinka'])).toBe('Used in Dinka');
    expect(usedLine(['Dinka', 'Nuer', 'Hadiyya'])).toBe('Used in Dinka and 2 more');
    expect(countLine(fia, eng)).toBe('4 passages in 1 book');
    expect(countLine(chapters, eng)).toBe('20 chapters');
    expect(countLine(later, eng)).toBe('Each book waits until a coordinator breaks it up');
    expect(emptyLine(fia)).toBe('Romans, Hebrews and 2 more');
  });

  it('counts in the language showing, not in English (decision 194)', () => {
    addCatalog('hi', JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/i18n/hi.json'), 'utf8')));
    showLanguage('hi');
    try {
      expect(countLine(fia, eng)).toBe('1 पुस्तक में 4 अंश');
      expect(countLine(chapters, eng)).toBe('20 अध्याय');
    } finally {
      showLanguage('en');
    }
    expect(countLine(chapters, eng)).toBe('20 chapters');
  });

  it('draws a book as its pieces, each as long as its verses', () => {
    expect(piecesOf(chapters, 'RUT', eng).map((p) => [p.label, p.verses])).toEqual([['Ruth 1', 22], ['Ruth 2', 23], ['Ruth 3', 18], ['Ruth 4', 22]]);
    const f = piecesOf(fia, 'RUT', eng);
    expect(f.map((p) => p.label)).toEqual(['Ruth 1:1–7', 'Ruth 1:8–19', 'Ruth 1:19–2:2', 'Ruth 2:3–4:22']);
    expect(f[0]!.verses).toBe(7);
    expect(piecesOf(fia, 'ROM', eng)).toEqual([]);
  });
});

describe('how a book is divided now, and what lists offer (decision 107)', () => {
  const follow = (s: { org_id: string; item_id: string }) => subscriptionItemId(s.org_id, s.item_id);
  // The language's own copy ("Book by book (Kara)"), with Ruth divided its own way and Romans as By chapter has it.
  const ownLib = fold(publishOps({}, { itemId: 'kara', kind: 'template', name: 'Book by book (Kara)', description: '', docHash: H('k') }));
  const kara = libraryItemView(ownLib, 'kara')!;
  const own = withBookBrokenUp(withBookBrokenUp(doc('Book by book (Kara)', [{ book: 'RUT', name: 'Ruth' }, { book: 'ROM', name: 'Romans' }]), 'RUT',
    doc('own', [{ book: 'RUT', name: 'Ruth', divide: 'passages', part: 'Section', passages: [{ ref: 'RUT 1:1-5' }, { ref: 'RUT 1:6-4:22' }] }])), 'ROM', chapters);
  const choices: LibraryChoice[] = [
    { key: 'ours:kara', source: 'ours', item: kara, name: kara.name, hash: H('k') },
    { key: 'shared:chapters', source: 'shared', shared: share('langquest.bible.chapters', H('c'), 'By chapter'), name: 'By chapter', hash: H('c') }
  ];
  const all = new Map([...docs, [H('k'), own]]);
  const rows = wayRows({ choices, docOf: (h) => all.get(h) ?? null, others: [], current: 'kara', follow });
  const docOf = (r: (typeof rows)[number]) => all.get(r.choice.hash) ?? null;

  it("names the ready-made way a book matches, never the language's own template", () => {
    expect(isItself(rows.find((r) => r.choice.key === 'ours:kara')!)).toBe(true);
    expect(wayNow(rows, docOf, own, 'ROM')?.choice.name).toBe('By chapter');
    // Ruth is divided its own way: the copy holds it as it is, but that is not a way it was divided by.
    expect(wayNow(rows, docOf, own, 'RUT')).toBeNull();
    // Editing the template from Content Templates while another language is open: the item edited is still itself.
    const elsewhere = wayRows({ choices, docOf: (h) => all.get(h) ?? null, others: [], current: null, follow });
    expect(wayNow(elsewhere, docOf, own, 'RUT', 'kara')).toBeNull();
    expect(wayNow(elsewhere, docOf, own, 'RUT')?.choice.name).toBe('Book by book (Kara)');
  });

  it('says how each book is divided in a line', () => {
    expect(divisionLine(own, 'ROM', 'By chapter', eng)).toBe('By chapter · 16 sections');
    expect(divisionLine(own, 'RUT', null, eng)).toBe('Its own way · 2 sections');
    expect(divisionLine(fia, 'ROM', null, eng)).toBe('Waiting to be divided');
  });

  it("lists LangQuest's ways once, in the numbering, and not its older templates", () => {
    const lq = (item_id: string) => ({ org_id: 'langquest', item_id });
    expect(sharedTemplateShown(lq('langquest.bible.fia'), 'eng')).toBe(true);
    expect(sharedTemplateShown(lq('langquest.bible.openbible-usual'), 'eng')).toBe(true);
    expect(sharedTemplateShown(lq('langquest.bible.fia.org-66'), 'eng')).toBe(false);
    expect(sharedTemplateShown(lq('langquest.bible.fia.org-66'), 'org')).toBe(true);
    expect(sharedTemplateShown(lq('langquest.bible.fia'), 'org')).toBe(false);
    expect(sharedTemplateShown(lq('langquest.template.bible-chapters-rso'), 'eng')).toBe(false);
    expect(sharedTemplateShown({ org_id: 'spoken', item_id: 'spoken-sections' }, 'org')).toBe(true);
  });
});

describe('the books a way leaves out, and the names a book is given (demo ADR-042)', () => {
  it('lists the books short', () => {
    const twenty = ['Proverbs', 'Ecclesiastes', ...Array.from({ length: 18 }, (_, i) => `Book ${i}`)];
    expect(booksLine(twenty)).toBe('Proverbs, Ecclesiastes and 18 more');
    expect(booksLine(['Romans', 'Hebrews', 'Revelation'])).toBe('Romans, Hebrews, Revelation');
  });

  it('gives each name once, with everyone who uses it', () => {
    expect(groupNames([
      { name: 'Romans', from: 'World English Bible' }, { name: 'Warumi', from: 'Swahili Bible' }, { name: 'Romans ', from: 'Berean Standard Bible' },
      { name: ' ', from: 'Empty' }, { name: 'Romans', from: 'World English Bible' }
    ])).toEqual([{ name: 'Romans', from: ['World English Bible', 'Berean Standard Bible'] }, { name: 'Warumi', from: ['Swahili Bible'] }]);
  });
});

describe('a change to a template, for which languages', () => {
  const lib = fold(publishOps({}, { itemId: 'ours', kind: 'template', name: 'FIA passages (Dinka)', description: '', docHash: H('1') }));
  const item = libraryItemView(lib, 'ours')!;
  const users: TemplateUser[] = [
    { languageId: 'din', name: 'Dinka', mayChange: true, unitPrefix: 'ours' },
    { languageId: 'nus', name: 'Nuer', mayChange: true, unitPrefix: 'ours' }
  ];

  it('is the next version when every language using it changes, else a copy', () => {
    expect(planChange({ item, users, chosen: new Set(['din', 'nus']) })).toBe('version');
    expect(planChange({ item, users, chosen: new Set(['din']) })).toBe('copy');
    // Offline nobody knows who else uses it: only a copy is safe.
    expect(planChange({ item, users: null, chosen: new Set(['din']) })).toBe('copy');
    const followed = libraryItemView(fold(subscribeOps(share('langquest.bible.fia', H('f'), 'FIA passages'), true).ops), subscriptionItemId('langquest', 'langquest.bible.fia'))!;
    expect(planChange({ item: followed, users: [users[0]!], chosen: new Set(['din']) })).toBe('copy');
  });

  it('splits a copy off that says where it came from, at the version the languages had, then the change', () => {
    const ops = copyOffOps({ orgId: 'o', orgName: 'Our org', item, itemId: 'copy1', name: copyName(item.name, ['Hadiyya']), from: H('1'), next: H('2') });
    const copy = libraryItemView(fold(ops), 'copy1')!;
    expect(copy.name).toBe('FIA passages (Hadiyya)');
    expect(copy.copiedFrom).toEqual({ orgId: 'o', orgName: 'Our org', itemId: 'ours', docHash: H('1') });
    expect(copy.versions.map((v) => v.docHash)).toEqual([H('1'), H('2')]);
    expect(copy.current).toBe(H('2'));
    expect(copyName('FIA passages', ['Hadiyya', 'Sidamo', 'Gedeo'])).toBe('FIA passages (Hadiyya and 2 more)');
  });
});
