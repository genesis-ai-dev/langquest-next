// Breaking up the Bible (decisions.md 74), pure: the ways LangQuest offers
// and the organization's own, in the order an admin sees them (what other
// languages here use first), what each gives a book, and whether a change
// to a template becomes its next version or a copy for some languages.
// Screens and hooks are in parts.tsx and useBreakup.ts.
import {
  bookParts, templateBooks, wayPartCount, parseRef,
  type LibraryItemView, type TemplateDoc, type VersificationDoc
} from '@langquest-next/core';
import { englishBookName, STARTER_TEMPLATE, type LibraryChoice } from '../contentTemplates';
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
  if (names.length === 1) return `Used in ${names[0]}`;
  if (names.length === 2) return `Used in ${names[0]} and ${names[1]}`;
  return `Used in ${names[0]} and ${names.length - 1} more`;
}

const fmt = (n: number) => n.toLocaleString('en-US');

/** What a way gives the whole Bible: "2,376 passages in 46 books", "1,189 chapters". */
export function countLine(doc: TemplateDoc, v11n: VersificationDoc | null): string {
  const books = templateBooks(doc);
  const divided = books.filter((b) => b.divide);
  if (divided.length === 0) return 'Each book waits until a coordinator breaks it up';
  const parts = wayPartCount(doc, v11n);
  const names = [...new Set(divided.map((b) => (b.part ?? doc.levels[doc.levels.length - 1]?.name ?? 'part').toLowerCase()))];
  const noun = names.length === 1 ? names[0]! : 'part';
  const plural = parts === 1 ? noun : noun.endsWith('y') ? `${noun.slice(0, -1)}ies` : `${noun}s`;
  return divided.length === books.length ? `${fmt(parts)} ${plural}` : `${fmt(parts)} ${plural} in ${divided.length} ${divided.length === 1 ? "book" : "books"}`;
}

/** Books a way leaves for later: "Romans, Hebrews and 18 more". */
export function emptyLine(doc: TemplateDoc): string {
  const empty = templateBooks(doc).filter((b) => !b.divide).map((b) => englishBookName(b.book));
  if (empty.length === 0) return '';
  if (empty.length <= 3) return empty.join(', ');
  return `${empty.slice(0, 2).join(', ')} and ${empty.length - 2} more`;
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
  const name = englishBookName(book);
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

/** "FIA passages (Hadiyya)", "FIA passages (Hadiyya and Sidamo)", for a copy split off for some languages. */
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

/** "How is material broken up?": five slides, one idea each (round 2 of the prototype, kept). */
export const LESSON: LessonSlide[] = [
  {
    title: 'Your team records material in pieces',
    text: 'Material is sorted into folders, and people record the pieces inside them. Here are stories, sorted into collections.',
    tree: [{ name: 'How things began', items: ['Why the river is wide', 'The first fire'] }, { name: 'Stories of our grandparents', items: ['The long walk'] }]
  },
  {
    title: 'A Bible has books, chapters and verses',
    text: 'Each book is a folder. Inside, the book is cut into pieces to record, and each verse marks a place in the recording.',
    tree: [{ name: 'Ruth', items: ['Ruth 1 · verses 1 to 22', 'Ruth 2 · verses 1 to 23', 'Ruth 3', 'Ruth 4'] }]
  },
  {
    title: 'The same book can be cut in different places',
    text: 'Here is Ruth three ways. Same verses, different pieces.',
    ways: [{ item: 'langquest.bible.chapters', label: 'By chapter' }, { item: 'langquest.bible.fia', label: 'FIA passages' }, { item: 'langquest.bible.unfoldingword', label: 'unfoldingWord chunks' }]
  },
  {
    title: 'Not all Bibles are the same',
    text: 'Churches use Bibles with different books, and some number the same verses differently.',
    rows: [
      ['Protestant Bibles', '66 books. “The Lord is my shepherd” is Psalm 23. Malachi has 4 chapters.'],
      ['Catholic Bibles', '73 books, adding Tobit, Judith, Maccabees and others. Many count Malachi as 3 chapters, and Daniel 3 has 100 verses.'],
      ['Orthodox Bibles', 'Up to 81 books. “The Lord is my shepherd” is Psalm 22, because Psalms 9 and 10 are one psalm.']
    ]
  },
  {
    title: 'So you choose two things',
    text: 'First, what your team will translate. Then, for the Bible, how it is broken up: every book now, or one book at a time later. Some study guides, like FIA, come with their own way of breaking it up. Verse numbers sort themselves out from the Bibles you pick.'
  }
];
