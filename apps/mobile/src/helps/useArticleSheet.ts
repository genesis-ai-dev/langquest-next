// Which article a passage's helps have open (libraryHelps.tsx ArticleSheet).
import type { ContentsDoc } from '@langquest-next/core';
import { useState } from 'react';
import { articleEntry, helpLink, type OfferedSet, type PassageKeyWord } from './libraryHelpsModel';

/** An article to show: from a link, or a key word. */
export interface ArticleOpen { title: string; doc?: string; kind: 'academy' | 'words'; id: string; keyWord?: PassageKeyWord }

/** Where a help's link goes: an article in the sheet, or nothing for a Bible place (it is only read). */
export function useArticleSheet(sets: { academy: readonly OfferedSet<ContentsDoc>[]; words: readonly OfferedSet<ContentsDoc>[] }) {
  const [open, setOpen] = useState<ArticleOpen | null>(null);
  const openRef = (ref: string) => {
    const link = helpLink(ref);
    if (!link || link.kind === 'bible') return;
    const e = articleEntry(link.kind === 'academy' ? sets.academy : sets.words, link.id);
    setOpen({ title: e?.title ?? link.id, kind: link.kind, id: link.id, ...(e ? { doc: e.doc } : {}) });
  };
  const openWord = (k: PassageKeyWord) => setOpen({ title: k.title, kind: 'words', id: k.article, keyWord: k, ...(k.doc ? { doc: k.doc } : {}) });
  return { open, openRef, openWord, close: () => setOpen(null) };
}
