// A passage's translation helps from the library (core helpDocs.ts,
// helpsOnPassage.ts): notes on its verses, its key words with their
// articles, the words of an aligned Bible they are about, and the questions
// a check asks of it. Sets are what the passage is offered
// (reference/offered.ts): what the organization or language recommends and
// what an admin linked to it first, then the organization's own in the
// team's languages. Pure, so it is tested (test/libraryHelpsModel.test.ts);
// useLibraryHelps.ts gathers the documents.
import {
  alignedSpans, helpBookDocs, helpsQuestionSpec, passageQuestions, rowsByVerse, rowsOnPassage,
  type AlignmentDoc, type ContentsDoc, type HelpBookDoc, type HelpRow, type HelpsDoc, type HelpsPassage, type LibraryDoc, type LibraryItemState,
  type LanguageState, type MaterialDoc, type SourcedQuestion, type SourceDoc, type TemplateDoc, type VersificationDoc
} from '@langquest-next/core';
import { passageVerses } from '../study/guideMatch';
import type { VerseRow } from '../sources/model';
import { sameLanguage } from '../reference/languages';

type Get = (hash: string | null | undefined) => LibraryDoc | null;

/** One offered set: its library item and its current document. */
export interface OfferedSet<T> { itemId: string; hash: string; doc: T }

export interface OfferedHelps {
  notes: OfferedSet<HelpsDoc>[];
  questions: OfferedSet<HelpsDoc>[];
  wordLinks: OfferedSet<HelpsDoc>[];
  words: OfferedSet<ContentsDoc>[];
  academy: OfferedSet<ContentsDoc>[];
}

/**
 * The helps sets among what a passage is offered: recommended and linked
 * ones first; the organization's own only where nothing of that kind is
 * recommended, and then only in the team's languages (`reads`, the
 * reference language first). Each kind in the team's languages first.
 */
export function offeredHelps(groups: { recommended: { key: string; hash: string }[]; own: { key: string; hash: string }[] }, get: Get, reads: readonly string[]): OfferedHelps {
  const rank = (lang: string) => { const i = reads.findIndex((r) => sameLanguage(r, lang)); return i < 0 ? reads.length : i; };
  const add = (from: { key: string; hash: string }[], ownOnly: boolean) => {
    const got: OfferedHelps = { notes: [], questions: [], wordLinks: [], words: [], academy: [] };
    for (const s of from) {
      const doc = get(s.hash);
      if (!doc) continue;
      if (ownOnly && 'language' in doc && typeof doc.language === 'string' && rank(doc.language) === reads.length) continue;
      if (doc.format === 'helps@1') got[doc.kind].push({ itemId: s.key, hash: s.hash, doc });
      else if (doc.format === 'contents@1' && (doc.kind === 'words' || doc.kind === 'academy')) got[doc.kind].push({ itemId: s.key, hash: s.hash, doc });
    }
    return got;
  };
  const first = add(groups.recommended, false);
  const rest = add(groups.own, true);
  const pick = <T extends { language: string }>(a: OfferedSet<T>[], b: OfferedSet<T>[]) =>
    [...(a.length ? a : b)].sort((x, y) => rank(x.doc.language) - rank(y.doc.language));
  return {
    notes: pick(first.notes, rest.notes), questions: pick(first.questions, rest.questions), wordLinks: pick(first.wordLinks, rest.wordLinks),
    words: pick(first.words, rest.words), academy: pick(first.academy, rest.academy)
  };
}

/**
 * Does the language's template come from this template item (the same
 * item, a copy of it, or a follow of it)? Stories' helps name the template
 * they are placed on.
 */
export function usesTemplate(state: LanguageState, library: Record<string, LibraryItemState>, templateItemId: string): boolean {
  const own = state.template?.value?.itemId;
  if (!own) return false;
  if (own === templateItemId) return true;
  const it = library[own];
  return it?.subscription.value?.sourceItemId === templateItemId || it?.copiedFrom.value?.itemId === templateItemId;
}

/**
 * Where a passage is for its helps: its verses in its template's numbering,
 * or, in an outline template placed on by stories, the story its part is.
 */
export function helpsPassage(state: LanguageState, unitId: string, get: Get, isStoryTemplate: boolean): HelpsPassage | null {
  if (isStoryTemplate) {
    const node = unitId.slice(unitId.lastIndexOf('/') + 1);
    const story = /^\d+$/.test(node) ? Number(node) : NaN;
    return Number.isInteger(story) && story > 0 ? { kind: 'story', story } : null;
  }
  const sel = state.template?.value;
  const template = sel?.docHash ? (get(sel.docHash) as TemplateDoc | null) : null;
  if (template?.structure === 'outline') return null;
  const p = passageVerses(state, unitId, get);
  return p ? { kind: 'bible', range: p.range, versification: p.versification } : null;
}

/** The book and chapters a passage's helps are in. */
export function passagePlace(p: HelpsPassage): { book: string; chapters: [number, number] } {
  return p.kind === 'story' ? { book: 'OBS', chapters: [p.story, p.story] } : { book: p.range.book, chapters: [p.range.start.chapter, p.range.end.chapter] };
}

/** The documents a passage needs from these sets: the parts of its book. */
export function partsFor(p: HelpsPassage, sets: readonly OfferedSet<HelpsDoc>[]): string[] {
  const { book, chapters } = passagePlace(p);
  return [...new Set(sets.flatMap((s) => helpBookDocs(s.doc, book, chapters)))];
}

/** A set's numbering (null for stories, or while it loads). */
const v11nOf = (set: HelpsDoc, get: Get) => (set.versification ? (get(set.versification) as VersificationDoc | null) : null);

/** The rows of one set on the passage, from whichever of its parts are here. */
function rowsOf(p: HelpsPassage, s: OfferedSet<HelpsDoc>, get: Get) {
  const { book, chapters } = passagePlace(p);
  const placed = helpBookDocs(s.doc, book, chapters).flatMap((h) => {
    const b = get(h) as HelpBookDoc | null;
    return b && b.format === 'helpBook@1' ? rowsOnPassage(b, p, v11nOf(s.doc, get)) : [];
  });
  const seen = new Set<string>();
  return placed.filter((r) => (seen.has(r.row.id) ? false : (seen.add(r.row.id), true)));
}

/** One set's notes on a passage, by the verse each is on (introductions under `""`). */
export interface NoteGroup { itemId: string; title: string; credit: string; language: string; byVerse: [string, HelpRow[]][] }

export function passageNotes(p: HelpsPassage, sets: readonly OfferedSet<HelpsDoc>[], get: Get): NoteGroup[] {
  return sets.flatMap((s) => {
    const rows = rowsOf(p, s, get);
    return rows.length ? [{ itemId: s.itemId, title: s.doc.title, credit: s.doc.credit, language: s.doc.language, byVerse: rowsByVerse(rows) }] : [];
  });
}

/** A key word on the passage: its article, where it is, and the original words it stands for there. */
export interface PassageKeyWord {
  article: string;
  title: string;
  /** Verses it is on (`"3:16"`), in order. */
  at: string[];
  words: string[];
  /** Its article's document, from the first key-word set that has it (the team's language first). */
  doc?: string;
  /** That set's item, for the record of what was used. */
  from?: string;
}

/** The passage's key words from the first word-link set that has any, named from the key-word sets. */
export function passageKeyWords(p: HelpsPassage, linkSets: readonly OfferedSet<HelpsDoc>[], words: readonly OfferedSet<ContentsDoc>[], get: Get): PassageKeyWord[] {
  const out = new Map<string, PassageKeyWord>();
  for (const s of linkSets) {
    const rows = rowsOf(p, s, get);
    for (const r of rows) {
      const id = r.row.article;
      if (!id) continue;
      const k = out.get(id) ?? { article: id, title: id.slice(id.indexOf('/') + 1), at: [], words: [] };
      if (r.at && !k.at.includes(r.at)) k.at.push(r.at);
      for (const w of r.row.words ?? []) if (!k.words.includes(w)) k.words.push(w);
      out.set(id, k);
    }
    if (out.size) break;
  }
  for (const k of out.values()) {
    for (const w of words) {
      const e = w.doc.entries.find((x) => x.id === k.article);
      if (e) { k.title = e.title; k.doc = e.doc; k.from = w.itemId; break; }
    }
  }
  return [...out.values()].sort((a, b) => (a.at[0] ?? '').localeCompare(b.at[0] ?? '', undefined, { numeric: true }) || a.title.localeCompare(b.title));
}

/** The alignment of a passage's book in the chosen Bible, when it is word-aligned. */
export function alignmentHash(source: SourceDoc | null | undefined, book: string): string | undefined {
  return source?.books.find((b) => b.book === book)?.alignment;
}

/**
 * Where to mark a verse of the chosen Bible: the words that stand for the
 * Hebrew or Greek the passage's notes and key words are about there.
 */
export function verseMarks(row: VerseRow, alignment: AlignmentDoc | null, notes: readonly NoteGroup[], keyWords: readonly PassageKeyWord[]): [number, number][] {
  if (!alignment) return [];
  const here = (at: string) => at === `${row.chapter}:${row.verseStart}`;
  const originals = [
    ...notes.flatMap((g) => g.byVerse.filter(([at]) => here(at)).flatMap(([, rows]) => rows.flatMap((r) => r.words ?? []))),
    ...keyWords.filter((k) => k.at.some(here)).flatMap((k) => k.words)
  ];
  return alignedSpans(alignment, row.chapter, row.verseStart, [...new Set(originals)], row.text);
}

/** A link in help text: an article of the manual (`ta:`), a key word (`tw:`), or a Bible place. */
export type HelpLink = { kind: 'academy' | 'words'; id: string } | { kind: 'bible'; ref: string };

export function helpLink(ref: string): HelpLink | null {
  const m = /^(ta|tw|bible):(.+)$/.exec(ref.trim());
  if (!m) return null;
  if (m[1] === 'bible') return { kind: 'bible', ref: m[2]! };
  return { kind: m[1] === 'ta' ? 'academy' : 'words', id: m[2]! };
}

/** An article's entry in the first set that has it: its document, and the set. */
export function articleEntry(sets: readonly OfferedSet<ContentsDoc>[], id: string): { doc: string; title: string; set: OfferedSet<ContentsDoc> } | null {
  for (const s of sets) {
    const e = s.doc.entries.find((x) => x.id === id);
    if (e) return { doc: e.doc, title: e.title, set: s };
  }
  return null;
}

/**
 * The questions a check asks of this passage from the library sets linked
 * to it (`v1.CheckHelpSet`): a set placed by verse asks those on the
 * passage, with their suggested answers; a question set for every passage
 * (`material@1` kind `questions`, like the manual's forms) asks all of its.
 */
export function linkedQuestions(p: HelpsPassage | null, linked: readonly { itemId: string; doc: LibraryDoc | null }[], get: Get): SourcedQuestion[] {
  const out: SourcedQuestion[] = [];
  for (const { itemId, doc } of linked) {
    if (!doc) continue;
    if (doc.format === 'material@1' && doc.kind === 'questions') {
      for (const q of (doc as MaterialDoc).questions ?? []) out.push({ q: helpsQuestionSpec(itemId, q), source: 'library', required: !!q.required });
    } else if (doc.format === 'helps@1' && doc.kind === 'questions' && p) {
      const { book, chapters } = passagePlace(p);
      for (const h of helpBookDocs(doc, book, chapters)) {
        const b = get(h) as HelpBookDoc | null;
        for (const x of passageQuestions(itemId, doc, b, p, v11nOf(doc, get))) {
          out.push({ q: x.q, source: 'library', required: false, ...(x.answer ? { answer: x.answer } : {}), ...(x.at ? { at: x.at } : {}) });
        }
      }
    }
  }
  return out;
}

/**
 * What kept passages need of their helps on the phone (sources/offline.ts):
 * first the parts of the sets' books (`pieces`), then, once those are here,
 * the articles of their key words (`articles`). Notes cite manual articles
 * too; those come when someone opens one.
 */
export function offlineHelpDocs(passages: readonly HelpsPassage[], sets: OfferedHelps, get: Get): { pieces: string[]; articles: string[] } {
  const pieces = new Set<string>();
  const articles = new Set<string>();
  for (const p of passages) {
    for (const h of partsFor(p, [...sets.notes, ...sets.questions, ...sets.wordLinks])) pieces.add(h);
    for (const k of passageKeyWords(p, sets.wordLinks, sets.words, get)) if (k.doc) articles.add(k.doc);
  }
  return { pieces: [...pieces], articles: [...articles] };
}
