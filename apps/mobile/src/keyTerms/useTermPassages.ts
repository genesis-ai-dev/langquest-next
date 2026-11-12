// The language with every passage a key term was tied in or changed during
// read in, for its uses: the key word's page and the sheet over the recorder
// both list the versions that used each of the team's words, and those
// passages may not be in memory (decision 143).
import type { KeyTermView, LanguageState } from '@langquest-next/core';
import { useEffect, useState } from 'react';
import type { Ctx } from '../shell/ctx';

/** The language with those passages read in; null until read. */
export function useTermPassages(ctx: Ctx, termId: string, term: KeyTermView | null): LanguageState | null {
  const [view, setView] = useState<LanguageState | null>(null);
  const { state, passagesLinkingTerm, passageOfTake, withPassages } = ctx.language;
  useEffect(() => {
    if (!state || !term) return;
    let current = true;
    void (async () => {
      const units = new Set(await passagesLinkingTerm(termId));
      for (const a of [...term.adjustments, ...term.audioRenderings]) {
        const u = a.duringTakeId ? await passageOfTake(a.duringTakeId) : null;
        if (u) units.add(u);
      }
      const read = await withPassages([...units]);
      if (current) setView(read);
    })().catch(() => { /* read again on the next change */ });
    return () => { current = false; };
  }, [state, term, termId, passagesLinkingTerm, passageOfTake, withPassages]);
  return view;
}
