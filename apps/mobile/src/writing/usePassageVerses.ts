// The passage's verses, as the recorder works them out (decisions.md 141).
import { versesInChapter } from '@langquest-next/core';
import { useMemo } from 'react';
import type { Ctx } from '../shell/ctx';
import { passageVerseKeys } from '../recording/verseModel';
import { catalogVerses } from '../sources/model';
import { useSources } from '../sources/useSources';

/** The passage's verses, as the recorder works them out. */
export function usePassageVerses(ctx: Ctx, unitId: string, languageId: string): string[] {
  const passage = useSources(ctx, unitId, languageId);
  const v11n = passage.versification;
  return useMemo(() => passageVerseKeys(passage.range, (b, c) => (v11n ? versesInChapter(v11n, b, c) : undefined) ?? catalogVerses(b, c)),
    [passage.range, v11n]);
}
