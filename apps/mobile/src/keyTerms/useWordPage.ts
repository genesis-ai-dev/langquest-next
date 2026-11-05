// What a key word's own page lists (decision 172; wordPageModel.ts): every
// passage of the open language the word is in, with where the team stands,
// and the notes and reviews about it. The passages' verses come from the
// template's numbering; the team's Bible (the one chosen last on this phone)
// is read whole for the book the word belongs to, so a word is found in that
// book's passages; its list's links place it in any book. Notes are read
// from those passages' records, which may not be in memory (decision 143).
import {
  derivePassage, languagePassages, unitTitle, versesInChapter,
  type KeyTermView, type KeyWordDoc, type LanguageState, type TemplateDoc, type VerseRange, type VersificationDoc
} from '@langquest-next/core';
import { useEffect, useMemo, useState } from 'react';
import type { Ctx } from '../shell/ctx';
import { useLibraryDocs } from '../library/useLibrary';
import { indexesFor } from '../sync/indexes';
import { catalogVerses, inSourceNumbering, passageRows, unitCoordinates } from '../sources/model';
import { choiceKey } from '../sources/sourceText';
import { useChoice } from '../sources/useSourceChoice';
import { usePassageSource, useSources } from '../sources/useSources';
import { wordForms, type KeyWordList } from './listsModel';
import { usedByPassage, wordNotes, wordPassages, type WordNote, type WordPassage } from './wordPageModel';
import { useKeyWordLists } from './useKeyWordLists';

export interface WordPage {
  passages: WordPassage[];
  notes: WordNote[];
  /** The Bible the word was looked for in ("BSB"), when one was read. */
  bibleName: string;
  loading: boolean;
}

export function useWordPage(ctx: Ctx, c: {
  /** The team's word, when the page is one of its own words. */
  term: KeyTermView | null;
  /** The list's word: FIA's word the team has not taken, or the one a team's word was made from. */
  from: { list: KeyWordList; word: KeyWordDoc } | null;
  /** Versions that marked the team's word (`termUsedIn`). */
  uses: readonly { unitId: string; n: number; takeId: string }[];
}): WordPage {
  const state = ctx.language.state;
  const languageId = ctx.language.languageId;
  const { versificationOf } = useKeyWordLists(ctx);
  // The template's numbering, as a passage's verses are read (usePassageKeyWords.ts).
  const templateHash = state?.template?.value.docHash;
  const tdocs = useLibraryDocs(ctx.language.orgId, [templateHash]);
  const template = tdocs.get<TemplateDoc>(templateHash);
  const v11nHash = template?.bible?.versification;
  const vdocs = useLibraryDocs(ctx.language.orgId, [v11nHash]);
  const numbering = v11nHash ? vdocs.get<VersificationDoc>(v11nHash) : null;
  const passages = useMemo(() => {
    if (!state) return [];
    const versesIn = numbering ? (b: string, ch: number) => versesInChapter(numbering, b, ch) ?? catalogVerses(b, ch) : catalogVerses;
    return languagePassages(state, indexesFor(state)).map((unitId) => ({ unitId, label: unitTitle(state, unitId), range: unitCoordinates(unitId, versesIn) }));
  }, [state, numbering]);

  // The book the word belongs to (a team's word is kept to the book it was added in), read whole in the team's Bible.
  const book = useMemo(() => bookOfWord(state, c.term, passages), [state, c.term, passages]);
  const sources = useSources(ctx, null, languageId, { wholeBook: true });
  const [chosen] = useChoice(choiceKey(ctx.session.actorId, ctx.language.orgId, languageId ?? ''));
  const option = sources.options.find((o) => o.itemId === chosen) ?? sources.options[0];
  const bookRange = useMemo((): VerseRange | null => {
    const max = book && numbering ? numbering.maxVerses[book] : undefined;
    return book && max?.length ? { book, start: { chapter: 1, verse: 1 }, end: { chapter: max.length, verse: max[max.length - 1]! } } : null;
  }, [book, numbering]);
  const text = usePassageSource(ctx, option, { ...sources, range: bookRange, ref: book ?? '' });
  const sourceV11n = option?.doc ? (vdocs.get<VersificationDoc>(option.doc.versification) ?? null) : null;
  const chapters = useMemo(() => {
    const out = new Map<number, [number, number, string][]>();
    for (const r of text?.rows ?? []) out.set(r.chapter, [...(out.get(r.chapter) ?? []), [r.verseStart, r.verseEnd, r.text]]);
    return out;
  }, [text?.rows]);

  const forms = useMemo(() => {
    // A word the team has not taken is placed by its list's links alone.
    if (!c.term) return [];
    const language = option?.language ?? c.from?.list.language ?? '';
    return [...new Set([...wordForms({ term: c.term.term }, language), ...(c.from ? wordForms(c.from.word, c.from.list.language) : [])])];
  }, [c.term, c.from, option?.language]);

  const lines = ctx.language.lines;
  const rows = useMemo(() => wordPassages({
    passages, numbering, versificationOf, from: c.from, forms, own: !!c.term, used: usedByPassage(c.uses),
    rowsOf: (_unitId, range) => (range && book && range.book === book && chapters.size ? passageRows(inSourceNumbering(range, numbering, sourceV11n), chapters) : null),
    line: (unitId) => {
      const l = lines.get(unitId);
      return { recorded: l.recorded, ...(l.latest ? { latest: { n: l.latest.n, takeId: l.latest.takeId } } : {}) };
    }
  }), [passages, numbering, versificationOf, c.from, forms, c.term, c.uses, book, chapters, sourceV11n, lines]);

  // The notes and reviews about the word, read from its passages' records.
  const [notes, setNotes] = useState<WordNote[]>([]);
  const { withPassages } = ctx.language;
  const termId = c.term?.termId ?? null;
  const unitKey = rows.map((r) => r.unitId).join(',');
  useEffect(() => {
    if (!termId || !unitKey) { setNotes([]); return; }
    let current = true;
    const units = unitKey.split(',');
    void withPassages(units).then((view) => {
      if (!current || !view) return;
      const idx = indexesFor(view);
      setNotes(wordNotes(units.map((unitId) => ({ unitId, label: unitTitle(view, unitId), state: derivePassage(view, unitId, idx) })), termId));
    }).catch(() => { /* read again on the next change */ });
    return () => { current = false; };
  }, [termId, unitKey, withPassages, state]);

  return { passages: rows, notes, bibleName: book && chapters.size ? option?.abbreviation ?? '' : '', loading: !state || (!!book && !!text?.loading) };
}

/** The book a team's word belongs to: the book unit it was added in, else the book of its first scope part; none for a word of every book. */
function bookOfWord(state: LanguageState | null, term: KeyTermView | null, passages: readonly { unitId: string; range: VerseRange | null }[]): string | null {
  if (!state || !term) return null;
  for (const scope of term.unitScope) {
    const inside = passages.find((p) => p.unitId === scope || p.unitId.startsWith(`${scope}.`) || isUnder(state, p.unitId, scope));
    if (inside?.range) return inside.range.book;
  }
  return null;
}

const isUnder = (state: LanguageState, unitId: string, ancestor: string): boolean => {
  let at: string | null | undefined = state.units[unitId]?.parentUnitId;
  for (let i = 0; at && i < 20; i++) {
    if (at === ancestor) return true;
    at = state.units[at]?.parentUnitId;
  }
  return false;
};
