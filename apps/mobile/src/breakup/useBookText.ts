// A book's text, for dividing it a language's own way (breakup/DivideOwnWay.tsx).
import { formatRef } from '@langquest-next/core';
import { useMemo } from 'react';
import type { Ctx } from '../shell/ctx';
import { choiceKey, useChoice } from '../sources/SourceReader';
import { usePassageSource, useSources } from '../sources/useSources';
import { atOf, type At } from './ownWay';

/** The book in a Bible the team has (the language's Bibles, the one chosen last on this phone first), else one LangQuest shares. */
export function useBookText(ctx: Ctx, book: string, maxVerses: readonly number[]) {
  const languageId = ctx.language.languageId;
  // A book opened in the template editor may have no team behind it: LangQuest's Bibles stand in (decision 107).
  const sources = useSources(ctx, null, languageId, { wholeBook: true });
  const [chosen, choose] = useChoice(choiceKey(ctx.session.actorId, ctx.language.orgId, languageId ?? ''));
  const option = sources.options.find((o) => o.itemId === chosen) ?? sources.options[0];
  const range = useMemo(() => (maxVerses.length
    ? { book, start: { chapter: 1, verse: 1 }, end: { chapter: maxVerses.length, verse: maxVerses[maxVerses.length - 1]! } } : null), [book, maxVerses]);
  const src = usePassageSource(ctx, option, { ...sources, range, ref: range ? formatRef(range) : '' });
  const byAt = useMemo(() => {
    const out = new Map<At, string>();
    for (const r of src?.rows ?? []) for (let v = r.verseStart; v <= r.verseEnd; v++) out.set(atOf(r.chapter, v), v === r.verseStart ? r.text : '');
    return out;
  }, [src?.rows]);
  return { options: sources.options, option, byAt, choose, loading: sources.loading || !!src?.loading, problem: src && !src.loading ? src.textProblem : null };
}
