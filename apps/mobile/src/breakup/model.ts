// Breaking up the Bible (decisions.md 74), pure: the ways LangQuest offers
// and the organization's own, in the order an admin sees them (what other
// languages here use first), what each gives a book, and whether a change
// to a template becomes its next version or a copy for some languages.
// Screens and hooks are in parts.tsx and useBreakup.ts.
import {
  bookParts, templateBooks, wayPartCount, parseRef,
  type LibraryItemView, type TemplateDoc, type VersificationDoc
} from '@langquest-next/core';
import { bookNameOf, STARTER_TEMPLATE, type LibraryChoice } from '../contentTemplates';
import { bookName } from '../coreText';
import { t } from '../i18n';
import type { LibraryOp } from '../library/model';

/** The ways LangQuest publishes (scripts/library-seed.ts `breakupWays`), in the order offered. */
export const WAY_ITEMS = [
  'langquest.bible.fia',
  'langquest.bible.chapters',
  'langquest.bible.unfoldingword',
  'langquest.bible.openbible-long',
  'langquest.bible.openbible-usual',
  'langquest.bible.openbible-short'
] as const;
/** Every book waiting to be broken up, one at a time. */
export const LATER_ITEM = 'langquest.bible.book-by-book';
/** What the books FIA leaves out are broken up with, when the admin says "by chapter". */
export const CHAPTERS_ITEM = 'langquest.bible.chapters';

/** The book the ways are shown with: short, and every way breaks it up (FIA too). */
export const SAMPLE_BOOK = 'RUT';
/** Books a preview offers, the sample first. */
export const PREVIEW_BOOKS = ['RUT', 'LUK', 'GEN', 'ROM'] as const;

/** The LangQuest item a choice is, or follows, or was copied from; null for the organization's own. */
export function wayOf(c: LibraryChoice): string | null {
  if (c.source === 'shared') return c.shared.org_id === STARTER_TEMPLATE.orgId ? c.shared.item_id : null;
  const sub = c.item.subscription;
  if (sub) return sub.sourceOrgId === STARTER_TEMPLATE.orgId ? sub.sourceItemId : null;
  return null;
}

/** The item a language would use for a choice: ours as it is, a shared one by the id following it gets. */
export function itemIdOf(c: LibraryChoice, follow: (s: { org_id: string; item_id: string }) => string): string {
  return c.source === 'ours' ? c.item.itemId : follow(c.shared);
}

export interface WayRow {
  choice: LibraryChoice;
  /** Languages of this organization (not this one) that use it, by name. */
  usedIn: string[];
  /** Whether this language uses it now. */
  inUse: boolean;
  later: boolean;
}

/**
 * The list an admin picks from (decision 74): the ways other languages here
 * use first, marked with where they are used; then LangQuest's ways; then
 * "Book by book". A Bible template of the organization's own that no other
 * language uses is offered after LangQuest's. Outlines are not here.
 */
export function wayRows(c: {
  choices: LibraryChoice[];
  docOf: (hash: string) => TemplateDoc | null;
  /** languageId -> the item its template is, for the organization's other languages. */
  others: { languageId: string; name: string; itemId: string }[];
  /** The item this language uses, if any. */
  current: string | null;
  follow: (s: { org_id: string; item_id: string }) => string;
}): WayRow[] {
  const bible = c.choices.filter((ch) => {
    const d = c.docOf(ch.hash);
    return !!d && d.structure === 'bible';
  });
  const usedIn = (ch: LibraryChoice) => {
    const id = itemIdOf(ch, c.follow);
    return c.others.filter((o) => o.itemId === id).map((o) => o.name);
  };
  const row = (ch: LibraryChoice): WayRow => ({
    choice: ch, usedIn: usedIn(ch), inUse: itemIdOf(ch, c.follow) === c.current, later: wayOf(ch) === LATER_ITEM
  });
  const rows = bible.map(row);
  const used = rows.filter((r) => r.usedIn.length > 0 || r.inUse)
    .sort((a, b) => b.usedIn.length - a.usedIn.length || Number(b.inUse) - Number(a.inUse));
  const ways = WAY_ITEMS.flatMap((id) => rows.filter((r) => !used.includes(r) && wayOf(r.choice) === id));
  const own = rows.filter((r) => !used.includes(r) && !ways.includes(r) && !r.later && r.choice.source === 'ours' && !r.choice.item.subscription);
  const later = rows.filter((r) => !used.includes(r) && r.later);
  return [...used, ...ways, ...own, ...later];
}

/** "Used in Dinka", "Used in Dinka and 2 more". */
export function usedLine(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return t('breakup.usedIn.one', { name: names[0] });
  if (names.length === 2) return t('breakup.usedIn.two', { first: names[0], second: names[1] });
  return t('breakup.usedIn.more', { name: names[0], count: names.length - 1 });
}

/** What a way gives the whole Bible: "2,376 passages in 46 books", "1,189 chapters". */
export function countLine(doc: TemplateDoc, v11n: VersificationDoc | null): string {
  const books = templateBooks(doc);
  const divided = books.filter((b) => b.divide);
  if (divided.length === 0) return t('breakup.count.waits');
  const parts = wayPartCount(doc, v11n);
  // The template's own word for its pieces, when every book uses the same one; else the app's "part".
  const names = [...new Set(divided.map((b) => (b.part ?? doc.levels[doc.levels.length - 1]?.name)?.toLowerCase() ?? null))];
  const noun = names.length === 1 ? names[0] : null;
  const pieces = noun
    ? t('breakup.count.named', { count: parts, part: noun, parts: noun.endsWith('y') ? `${noun.slice(0, -1)}ies` : `${noun}s` })
    : t('breakup.count.parts', { count: parts });
  return divided.length === books.length ? pieces : t('breakup.count.inBooks', { pieces, books: t('breakup.count.books', { count: divided.length }) });
}

/** Books a way leaves for later: "Romans, Hebrews and 18 more". */
export function emptyLine(doc: TemplateDoc): string {
  const empty = templateBooks(doc).filter((b) => !b.divide).map((b) => bookNameOf(b.book));
  if (empty.length <= 1) return empty[0] ?? '';
  if (empty.length === 2) return t('breakup.emptyBooks.two', { first: empty[0], second: empty[1] });
  if (empty.length === 3) return t('breakup.emptyBooks.three', { first: empty[0], second: empty[1], third: empty[2] });
  return t('breakup.emptyBooks.more', { first: empty[0], second: empty[1], count: empty.length - 2 });
}

export interface Piece {
  /** "Ruth 1:1–7", "Ruth 2". */
  label: string;
  /** How many verses it covers, for the bar. */
  verses: number;
}

/** A book's pieces in a way, in order; empty when the way does not break it up. */
export function piecesOf(doc: TemplateDoc, book: string, v11n: VersificationDoc | null): Piece[] {
  const b = bookParts(doc, book);
  if (!b) return [];
  const name = bookNameOf(book);
  const max = v11n?.maxVerses[book] ?? [];
  if (b.divide === 'book') return [{ label: name, verses: max.reduce((n, v) => n + v, 0) || 1 }];
  if (b.divide === 'chapters') return max.map((v, i) => ({ label: `${name} ${i + 1}`, verses: v }));
  return (b.passages ?? []).map((p) => {
    const r = parseRef(p.ref);
    if (!r) return { label: p.name ?? p.ref, verses: 1 };
    let verses = 0;
    for (let c = r.start.chapter; c <= r.end.chapter; c++) {
      const from = c === r.start.chapter ? r.start.verse : 1;
      const to = c === r.end.chapter ? r.end.verse : (max[c - 1] ?? r.end.verse);
      verses += Math.max(0, to - from + 1);
    }
    const where = r.start.chapter === r.end.chapter
      ? (r.start.verse === r.end.verse ? `${r.start.chapter}:${r.start.verse}` : `${r.start.chapter}:${r.start.verse}–${r.end.verse}`)
      : `${r.start.chapter}:${r.start.verse}–${r.end.chapter}:${r.end.verse}`;
    return { label: p.name ? `${p.name} · ${name} ${where}` : `${name} ${where}`, verses: Math.max(1, verses) };
  });
}

// ---- a change to a template, for which languages --------------------------------------------

export interface TemplateUser {
  languageId: string;
  name: string;
  /** Whether this person may change that language's template. */
  mayChange: boolean;
  unitPrefix: string;
  books?: string[];
}

/**
 * How a change to the template a language uses is published (decision
 * 74): as the item's next version when the organization controls it and
 * every language using it is to change; otherwise as a copy split off for
 * the chosen languages, which keep their part ids. `users` null means the
 * phone could not tell who else uses it (offline): then only a copy is safe.
 */
export function planChange(c: { item: LibraryItemView; users: TemplateUser[] | null; chosen: Set<string> }): 'version' | 'copy' {
  if (c.item.source === 'subscription') return 'copy';
  if (c.users === null) return 'copy';
  return c.users.every((u) => c.chosen.has(u.languageId)) ? 'version' : 'copy';
}

/** The org events that split a copy off an item: defined as a copy of it at `from`, then `from` and `next` as its versions. */
export function copyOffOps(c: {
  orgId: string; orgName: string; item: LibraryItemView; itemId: string; name: string; from: string; next: string;
}): LibraryOp[] {
  const sub = c.item.subscription;
  const copiedFrom = sub
    ? { orgId: sub.sourceOrgId, orgName: sub.sourceOrgName, itemId: sub.sourceItemId, docHash: c.from }
    : { orgId: c.orgId, orgName: c.orgName, itemId: c.item.itemId, docHash: c.from };
  return [
    { type: 'v1.LibraryItemDefined', payload: { itemId: c.itemId, kind: 'template', name: c.name, description: c.item.description, copiedFrom } },
    { type: 'v1.LibraryVersionPublished', payload: { itemId: c.itemId, kind: 'template', docHash: c.from } },
    ...(c.next !== c.from ? [{ type: 'v1.LibraryVersionPublished' as const, payload: { itemId: c.itemId, kind: 'template' as const, docHash: c.next } }] : [])
  ];
}

/**
 * "FIA passages (Hadiyya)", "FIA passages (Hadiyya and Sidamo)", for a copy
 * split off for some languages. It is the copy's name in the event log
 * (`v1.LibraryItemDefined`), shown as written like any library name.
 */
export function copyName(base: string, languages: string[]): string {
  const clean = base.replace(/\s*\([^)]*\)\s*$/, '');
  if (languages.length === 0) return `${clean} (copy)`;
  if (languages.length <= 2) return `${clean} (${languages.join(' and ')})`;
  return `${clean} (${languages[0]} and ${languages.length - 1} more)`;
}

// ---- the walk-through ---------------------------------------------------------------------------

export interface LessonSlide {
  title: string;
  text: string;
  /** Folders and what is recorded in them, for the storytelling and Bible slides. */
  tree?: { name: string; items: string[] }[];
  /** Ways to show as bars for the sample book. */
  ways?: { item: string; label: string }[];
  rows?: [string, string][];
}

/** "How is material broken up?": five slides, one idea each (round 2 of the prototype, kept), in the language showing. */
export function lessonSlides(): LessonSlide[] {
  const ruth = bookName('rut');
  return [
    {
      title: t('breakup.lesson.pieces.title'),
      text: t('breakup.lesson.pieces.text'),
      tree: [
        { name: t('breakup.lesson.pieces.began'), items: [t('breakup.lesson.pieces.river'), t('breakup.lesson.pieces.fire')] },
        { name: t('breakup.lesson.pieces.grandparents'), items: [t('breakup.lesson.pieces.walk')] }
      ]
    },
    {
      title: t('breakup.lesson.bible.title'),
      text: t('breakup.lesson.bible.text'),
      tree: [{
        name: ruth,
        items: [
          t('breakup.lesson.bible.chapterVerses', { book: ruth, chapter: 1, last: 22 }),
          t('breakup.lesson.bible.chapterVerses', { book: ruth, chapter: 2, last: 23 }),
          `${ruth} 3`,
          `${ruth} 4`
        ]
      }]
    },
    {
      title: t('breakup.lesson.places.title'),
      text: t('breakup.lesson.places.text', { book: ruth }),
      ways: [
        { item: 'langquest.bible.chapters', label: t('breakup.lesson.places.byChapter') },
        { item: 'langquest.bible.fia', label: t('breakup.lesson.places.fia') },
        { item: 'langquest.bible.unfoldingword', label: t('breakup.lesson.places.unfoldingWord') }
      ]
    },
    {
      title: t('breakup.lesson.bibles.title'),
      text: t('breakup.lesson.bibles.text'),
      rows: [
        [t('breakup.lesson.bibles.protestant'), t('breakup.lesson.bibles.protestantText', { verse: t('breakup.verses.shepherd') })],
        [t('breakup.lesson.bibles.catholic'), t('breakup.lesson.bibles.catholicText')],
        [t('breakup.lesson.bibles.orthodox'), t('breakup.lesson.bibles.orthodoxText', { verse: t('breakup.verses.shepherd') })]
      ]
    },
    {
      title: t('breakup.lesson.choose.title'),
      text: t('breakup.lesson.choose.text')
    }
  ];
}

/**
 * What a verse core uses to show a numbering clash says (`NumberingClash.says`,
 * core's English), in the language showing, as people's Bibles say it.
 */
export function verseSays(says: string): string {
  switch (says) {
    case 'The Lord is my shepherd': return t('breakup.verses.shepherd');
    case 'The day is coming, burning like an oven': return t('breakup.verses.dayIsComing');
    case 'Have mercy on me, O God': return t('breakup.verses.haveMercy');
    case 'I will pour out my Spirit': return t('breakup.verses.pourOutSpirit');
    case 'Now to him who is able to strengthen you': return t('breakup.verses.ableToStrengthen');
    case 'King Nebuchadnezzar, to all peoples': return t('breakup.verses.nebuchadnezzar');
    case 'Peace be to you': return t('breakup.verses.peaceToYou');
    default: return says;
  }
}
