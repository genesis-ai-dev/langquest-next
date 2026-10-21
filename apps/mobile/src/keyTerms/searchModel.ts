// What the Key words screen and a word's sheet ask of key-word lists
// (decision 149): one search across the team's words and every list, the
// chips that narrow it, how many passages a word is linked to, and a word's
// full meaning as paragraphs with its links to other words. Apart from
// listsModel.ts so the recorder's first load does not carry them: the
// screen and the sheet that use them load when opened. Pure: no React, so
// it is tested (test/keyWordListsModel.test.ts).
import { parseRef, type KeyTermView, type KeyWordDoc } from '@langquest-next/core';
import { inlineParts } from '../study/text';
import { sameWord, shortName, wordOfTermId, type KeyWordList } from './listsModel';

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
