// Key-word lists from the library (decision 149): FIA's key words, and any
// list an organization publishes in the same format (`material@1` of kind
// `key_terms`). Which of a list's words show on a passage, which of them the
// team has made its own, and what a search finds among the team's words and
// every list. Pure: no React, so it is tested (test/keyWordListsModel.test.ts).
import {
  orgVerses, parseRef, versesInChapter,
  type KeyTermView, type KeyWordDoc, type LibraryDoc, type MaterialDoc, type VerseRange, type VersificationDoc
} from '@langquest-next/core';
import { markTerms } from '../recording/workspaceModel';
import { sameLanguage } from '../reference/languages';
import { inlineParts } from '../study/text';

/** One list the team can use: its library item, and the words its document holds. */
export interface KeyWordList {
  itemId: string;
  /** "FIA key words (English)". */
  name: string;
  /** ISO 639-3: the language its words are in. */
  language: string;
  /** "FIA", when it goes with a method's guides. */
  pattern: string | null;
  /** The credit line readers see. */
  source: string;
  /** The hash of the numbering its links are in. */
  versification: string | null;
  words: KeyWordDoc[];
}

/** Is this document a key-word list? */
export function isKeyWordList(doc: LibraryDoc | null | undefined): doc is MaterialDoc {
  return doc?.format === 'material@1' && doc.kind === 'key_terms';
}

/** A library item's document as a list, or null when it is not one (or holds no words). */
export function keyWordList(itemId: string, name: string, doc: LibraryDoc | null | undefined): KeyWordList | null {
  if (!isKeyWordList(doc) || !doc.terms?.length) return null;
  return {
    itemId, name, language: doc.language ?? '', pattern: doc.pattern ?? null, source: doc.source ?? '',
    versification: doc.versification ?? null, words: doc.terms
  };
}

/**
 * The id a word keeps when the team makes it its own: `fia:t104` for FIA's,
 * which the app already reads as from FIA (`isFiaTerm`), so the team's word
 * and FIA's stay one word; a list without a method keeps its item's id.
 */
export function ownTermId(list: Pick<KeyWordList, 'itemId' | 'pattern'>, word: Pick<KeyWordDoc, 'id'>): string {
  return list.pattern ? `${list.pattern.toLowerCase()}:${word.id}` : `${list.itemId}:${word.id}`;
}

/** The list and word a team's own word came from, by its id: `fia:t104` is FIA's t104 in whichever list the team uses. */
export function wordOfTermId(lists: readonly KeyWordList[], termId: string): { list: KeyWordList; word: KeyWordDoc } | null {
  for (const list of lists) {
    const prefix = list.pattern ? `${list.pattern.toLowerCase()}:` : `${list.itemId}:`;
    if (!termId.startsWith(prefix)) continue;
    const word = list.words.find((w) => w.id === termId.slice(prefix.length));
    if (word) return { list, word };
  }
  return null;
}

/**
 * The forms a word is found by: the word, each part of "clean/unclean",
 * the other forms its list gives, and in English the endings that make
 * plurals and past tenses ("prophets", "Pharisees", "anointed").
 */
export function wordForms(word: Pick<KeyWordDoc, 'term' | 'match'>, language: string): string[] {
  const base = [word.term, ...word.term.split('/'), ...(word.match ?? [])].map((w) => w.trim()).filter((w) => w.length > 1);
  const out = new Set(base.map((w) => w.toLowerCase()));
  if (sameLanguage(language, 'eng')) {
    for (const w of base) {
      if (w.includes(' ')) continue;
      const l = w.toLowerCase();
      for (const end of l.endsWith('e') ? ['s', 'd'] : ['s', 'es', 'ed', 'ing']) out.add(l + end);
    }
  }
  return [...out];
}

/** A Bible the team reads, with the passage's verses in it. */
export interface PassageBible { language: string; rows: readonly { key: string; text: string }[] }

/** A list's word on a passage: the verses it is found in, and whether its list links it to these verses. */
export interface WordHere {
  list: KeyWordList;
  word: KeyWordDoc;
  /** Verse keys ("13:33") of the first Bible it is found in. */
  verses: string[];
  /** How the first of those verses says it, when not as the word itself ("Blessed" for "bless"). */
  form: string | null;
  linked: boolean;
}

/** Books whose verses a numbering may move into each other (as coverage.ts). */
const ACROSS = new Set(['DAN|DAG', 'EST|ESG', 'DAG|S3Y', 'DAG|SUS', 'DAG|BEL']);
const sameBook = (a: string, b: string) => a === b || ACROSS.has(`${a}|${b}`) || ACROSS.has(`${b}|${a}`);
const before = (a: { chapter: number; verse: number }, b: { chapter: number; verse: number }) => a.chapter < b.chapter || (a.chapter === b.chapter && a.verse <= b.verse);

/**
 * The words of the lists that show on a passage (decision 149): those a list
 * links to its verses (each side read in its own numbering, as guides are
 * matched), and those found in a Bible the team reads in the list's own
 * language. Words the team has made its own are left out: they show with
 * the team's words. Sorted by the first verse each is in, linked-only ones
 * last.
 */
export function wordsOnPassage(c: {
  lists: readonly KeyWordList[];
  /** The passage's verses, in `numbering`; null for a part with no verses. */
  range: VerseRange | null;
  numbering: VersificationDoc | null;
  versificationOf: (hash: string) => VersificationDoc | null;
  bibles: readonly PassageBible[];
  own: readonly Pick<KeyTermView, 'termId' | 'term'>[];
}): WordHere[] {
  const ownIds = new Set(c.own.map((x) => x.termId));
  const ownWords = new Set(c.own.map((x) => x.term.trim().toLowerCase()));
  const here = c.range;
  let passageVerses: Set<string> | null = null;
  const linkedHere = (list: KeyWordList, word: KeyWordDoc): boolean => {
    if (!here || !word.links?.length) return false;
    const lv = list.versification ? c.versificationOf(list.versification) : null;
    for (const l of word.links) {
      if (!('ref' in l)) continue;
      const r = parseRef(l.ref, lv ? (b, ch) => versesInChapter(lv, b, ch) : undefined);
      if (!r || !sameBook(r.book, here.book)) continue;
      const pv = c.numbering ?? lv;
      const tv = lv ?? c.numbering;
      if (!pv || !tv) {
        if (r.book === here.book && before(here.start, r.end) && before(r.start, here.end)) return true;
        continue;
      }
      passageVerses ??= orgVerses(pv, here);
      for (const k of orgVerses(tv, r)) if (passageVerses.has(k)) return true;
    }
    return false;
  };
  const out: WordHere[] = [];
  // Each Bible's verses as one lowercase text: a word none of whose forms is in it is not looked for verse by verse.
  const whole = new Map(c.bibles.map((b) => [b, b.rows.map((r) => r.text).join('\n').toLowerCase()]));
  for (const list of c.lists) {
    const bibles = c.bibles.filter((b) => sameLanguage(b.language, list.language));
    for (const word of list.words) {
      if (ownIds.has(ownTermId(list, word)) || ownWords.has(word.term.trim().toLowerCase())) continue;
      const forms = wordForms(word, list.language).map((f) => ({ termId: word.id, term: f }));
      let verses: string[] = [];
      let form: string | null = null;
      for (const b of bibles) {
        const text = whole.get(b)!;
        if (!forms.some((f) => text.includes(f.term))) continue;
        const hits = b.rows.flatMap((r) => {
          const said = markTerms(r.text, forms).find((p) => p.termId)?.text;
          return said ? [{ key: r.key, said }] : [];
        });
        if (!hits.length) continue;
        verses = hits.map((h) => h.key);
        const said = hits[0]!.said;
        form = said.toLowerCase() === word.term.trim().toLowerCase() ? null : said;
        break;
      }
      const linked = linkedHere(list, word);
      if (verses.length || linked) out.push({ list, word, verses, form, linked });
    }
  }
  const firstVerse = (w: WordHere) => {
    const m = w.verses[0] ? /^(\d+):(\d+)/.exec(w.verses[0]) : null;
    return m ? Number(m[1]) * 1000 + Number(m[2]) : Number.MAX_SAFE_INTEGER;
  };
  return out.sort((a, b) => firstVerse(a) - firstVerse(b) || a.word.term.localeCompare(b.word.term));
}

/** The words a search finds, best first: by the word or its forms, then by the short meaning, then by the full meaning. */
export interface WordFound {
  list: KeyWordList;
  word: KeyWordDoc;
  by: 'word' | 'gloss' | 'meaning';
}

/** The full meaning without its markdown: "[mercy](#t91)" reads "mercy". */
export function plainMeaning(body: string | undefined): string {
  return (body ?? '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1');
}

/** What a search finds in the lists alone (`keyWordResults` searches the team's words with them). */
export function searchLists(lists: readonly KeyWordList[], query: string): WordFound[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: WordFound[] = [];
  for (const list of lists) {
    for (const word of list.words) {
      const by = [word.term, ...(word.match ?? [])].some((w) => w.toLowerCase().includes(q)) ? 'word'
        : word.gloss.toLowerCase().includes(q) ? 'gloss'
        : plainMeaning(word.body).toLowerCase().includes(q) ? 'meaning' : null;
      if (by) out.push({ list, word, by });
    }
  }
  const rank = { word: 0, gloss: 1, meaning: 2 } as const;
  return out.sort((a, b) => rank[a.by] - rank[b.by] || byWord(q)(a.word.term, b.word.term));
}

/** Words that start with what was typed first, then by the word. */
const byWord = (q: string) => (a: string, b: string): number =>
  Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q)) || a.localeCompare(b);


// ---- the team's own words, a guide's words, and the Key words screen ---------------------

/** A list's short name, as chips and section heads say it: its method ("FIA"), else its name. */
export function shortName(list: Pick<KeyWordList, 'pattern' | 'name'>): string {
  return list.pattern ?? list.name;
}

const sameWord = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The team's word that is this list's word: the one made from it (its id), else one spelt the same. */
export function ownWordOf<T extends Pick<KeyTermView, 'termId' | 'term'>>(list: Pick<KeyWordList, 'itemId' | 'pattern'>, word: Pick<KeyWordDoc, 'id' | 'term'>, own: readonly T[]): T | null {
  const id = ownTermId(list, word);
  return own.find((x) => x.termId === id) ?? own.find((x) => sameWord(x.term, word.term)) ?? null;
}

/** The list word a team's word is: the one it was made from (`wordOfTermId`), else one spelt the same. */
export function listWordOf(lists: readonly KeyWordList[], own: Pick<KeyTermView, 'termId' | 'term'>): { list: KeyWordList; word: KeyWordDoc } | null {
  const made = wordOfTermId(lists, own.termId);
  if (made) return made;
  for (const list of lists) {
    const word = list.words.find((w) => sameWord(w.term, own.term));
    if (word) return { list, word };
  }
  return null;
}

/**
 * A passage's list words, split: those the team has made its own give the
 * team's word (it shows with the team's words), the rest stay the list's.
 */
export function splitOwn<T extends Pick<KeyTermView, 'termId' | 'term'>>(words: readonly WordHere[], own: readonly T[]): { words: WordHere[]; own: T[] } {
  const rest: WordHere[] = [];
  const mine = new Map<string, T>();
  for (const w of words) {
    const o = ownWordOf(w.list, w.word, own);
    if (o) mine.set(o.termId, o);
    else rest.push(w);
  }
  return { words: rest, own: [...mine.values()] };
}

/**
 * The list word a guide's glossary link opens: FIA's guides link a word by
 * FIA's id ("t104"), and the team's list of the same method holds it by
 * that id.
 */
export function guideTermWord(lists: readonly KeyWordList[], pattern: string | null | undefined, ref: string): { list: KeyWordList; word: KeyWordDoc } | null {
  if (!pattern) return null;
  for (const list of lists) {
    if (list.pattern?.toLowerCase() !== pattern.toLowerCase()) continue;
    const word = list.words.find((w) => w.id === ref);
    if (word) return { list, word };
  }
  return null;
}

/** How many passages a word is linked to, and the books they are in (USFM codes, in the order first linked). */
export function linkedPassages(word: Pick<KeyWordDoc, 'links'>): { count: number; books: string[] } {
  const books: string[] = [];
  for (const l of word.links ?? []) {
    const book = 'ref' in l ? parseRef(l.ref)?.book : undefined;
    if (book && !books.includes(book)) books.push(book);
  }
  return { count: word.links?.length ?? 0, books };
}

/** A piece of a full meaning: text, bold, or another word of the same list (`[mercy](#t91)`, by its id). */
export type MeaningPart = { type: 'text'; text: string } | { type: 'bold'; text: string } | { type: 'word'; text: string; id: string };

/** A full meaning as paragraphs; a link to anything but a word of the list (`ids`) reads as plain text. */
export function meaningParagraphs(body: string | undefined, ids: ReadonlySet<string>): MeaningPart[][] {
  return (body ?? '').split(/\n\s*\n/).map((para) => para.trim()).filter(Boolean).map((para) =>
    inlineParts(para).map((p): MeaningPart => (p.type !== 'link' ? p : ids.has(p.ref) ? { type: 'word', text: p.text, id: p.ref } : { type: 'text', text: p.text })));
}

/** The chips of the Key words screen after All and Ours: one per list, by its short name (its full name when two share one). */
export function listChips(lists: readonly KeyWordList[]): { id: string; label: string }[] {
  return lists.map((l) => ({ id: l.itemId, label: lists.some((o) => o !== l && shortName(o) === shortName(l)) ? l.name : shortName(l) }));
}

/** What the Key words screen shows: everything (`all`), the team's words alone (`ours`), or one list's words (its item id). */
export type KeyWordFilter = string;

/** A row the Key words screen finds: the team's word, a list's word, or one row for both when the team's came from the list. */
export interface KeyWordResult<T> {
  key: string;
  own: T | null;
  from: { list: KeyWordList; word: KeyWordDoc } | null;
  term: string;
  /** The team's short meaning, else the list's. */
  gloss: string;
  by: 'word' | 'gloss' | 'meaning';
}

/**
 * One search across the team's words and every list (decision 149), as the
 * Key words screen shows it: the words found by the word or one of its forms,
 * then by the short meaning, then by the full meaning. A team's word made
 * from a list's word (or spelt the same) is one row with both. With nothing
 * typed, every word the filter keeps is found by its word. Words that start
 * with what was typed come first, then by the word.
 */
export function keyWordResults<T extends Pick<KeyTermView, 'termId' | 'term' | 'gloss'>>(c: {
  own: readonly T[]; lists: readonly KeyWordList[]; query: string; filter: KeyWordFilter;
}): { words: KeyWordResult<T>[]; inGloss: KeyWordResult<T>[]; inMeaning: KeyWordResult<T>[] } {
  const q = c.query.trim().toLowerCase();
  const has = (s: string | undefined) => !!s && s.toLowerCase().includes(q);
  const byOf = (forms: string[], gloss: string, body: string | undefined): KeyWordResult<T>['by'] | null =>
    !q || forms.some(has) ? 'word' : has(gloss) ? 'gloss' : has(plainMeaning(body)) ? 'meaning' : null;
  const keyOf = (list: KeyWordList, word: KeyWordDoc) => `${list.itemId}:${word.id}`;
  const out: KeyWordResult<T>[] = [];
  const merged = new Set<string>();
  for (const own of c.own) {
    const from = listWordOf(c.lists, own);
    if (from) merged.add(keyOf(from.list, from.word));
    if (c.filter !== 'all' && c.filter !== 'ours' && from?.list.itemId !== c.filter) continue;
    const gloss = own.gloss || from?.word.gloss || '';
    const by = byOf([own.term, ...(from ? [from.word.term, ...(from.word.match ?? [])] : [])], gloss, from?.word.body);
    if (by) out.push({ key: own.termId, own, from, term: own.term, gloss, by });
  }
  const lists = c.filter === 'all' ? c.lists : c.lists.filter((l) => l.itemId === c.filter);
  for (const list of lists) {
    for (const word of list.words) {
      if (merged.has(keyOf(list, word))) continue;
      const by = byOf([word.term, ...(word.match ?? [])], word.gloss, word.body);
      if (by) out.push({ key: keyOf(list, word), own: null, from: { list, word }, term: word.term, gloss: word.gloss, by });
    }
  }
  const order = byWord(q);
  out.sort((a, b) => order(a.term, b.term));
  return { words: out.filter((r) => r.by === 'word'), inGloss: out.filter((r) => r.by === 'gloss'), inMeaning: out.filter((r) => r.by === 'meaning') };
}
