// The key-word lists' words on one passage (decision 149): the passage's
// verses in its template's numbering, a Bible's verses the caller already
// has (and the language they are in), and `wordsOnPassage`. The recorder's
// Key words tab, a passage's helps and a check's key words all ask this.
import { keyTermsFor, versesInChapter, type KeyTermView, type TemplateDoc, type VersificationDoc } from '@langquest-next/core';
import { useMemo } from 'react';
import type { Ctx } from '../shell/ctx';
import { useLibraryDocs } from '../library/useLibrary';
import { catalogVerses, unitCoordinates } from '../sources/model';
import { splitOwn, wordsOnPassage, type KeyWordList, type WordHere } from './listsModel';
import { useKeyWordLists } from './useKeyWordLists';

export interface PassageKeyWords {
  /** The lists the open language uses. */
  lists: KeyWordList[];
  /** The lists' words on the passage, first verse first; without the team's own unless `includeOwn`. */
  words: WordHere[];
  /** The team's words that a list places on the passage (they show with the team's words). */
  own: KeyTermView[];
  /** A list or its numbering may still be on its way. */
  loading: boolean;
}

export function usePassageKeyWords(ctx: Ctx, unitId: string | null | undefined, opts: {
  /** The passage's verses in a Bible the team reads, when the caller has them: words are found in them too. */
  rows?: readonly { key: string; text: string }[] | null;
  /** ISO 639-3: the language of `rows`. Only a list in the same language looks for its words in them. */
  rowsLanguage?: string | null;
  /** The team's words a list word is left out for; every key word of the language when not given. */
  own?: readonly KeyTermView[];
  /** Keep the words the team has made its own among `words` (a check shows every list word on the passage). */
  includeOwn?: boolean;
} = {}): PassageKeyWords {
  const state = ctx.language.state;
  const { lists, versificationOf, loading } = useKeyWordLists(ctx);
  const templateHash = state?.template?.value.docHash;
  const docs = useLibraryDocs(ctx.language.orgId, [templateHash]);
  const template = docs.get<TemplateDoc>(templateHash);
  const v11nHash = template?.bible?.versification;
  const v11nDocs = useLibraryDocs(ctx.language.orgId, [v11nHash]);
  const numbering = v11nHash ? v11nDocs.get<VersificationDoc>(v11nHash) : null;
  // The passage's verses as its Bible text is read (sources/useSources.ts).
  const range = useMemo(() => (unitId
    ? unitCoordinates(unitId, numbering ? (b, c) => versesInChapter(numbering, b, c) ?? catalogVerses(b, c) : catalogVerses)
    : null), [unitId, numbering]);
  const allOwn = useMemo(() => (state ? keyTermsFor(state) : []), [state]);
  const own = opts.own ?? allOwn;
  const { rows, rowsLanguage, includeOwn } = opts;
  const found = useMemo(() => {
    if (!unitId || !lists.length) return { words: [], own: [] };
    const all = wordsOnPassage({
      lists, range, numbering, versificationOf, own: [],
      bibles: rows && rowsLanguage ? [{ language: rowsLanguage, rows }] : []
    });
    const split = splitOwn(all, own);
    return includeOwn ? { words: all, own: split.own } : split;
  }, [unitId, lists, range, numbering, versificationOf, rows, rowsLanguage, own, includeOwn]);
  return { lists, words: found.words, own: found.own, loading: loading || (!!templateHash && !template) };
}
