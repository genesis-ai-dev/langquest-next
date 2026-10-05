// The study guide for a passage, from the library (docs/library.md,
// docs/reference-material.md): what the organization or the language
// recommends, or an admin linked to the passage, first; then the rest of the
// organization's own, copied or followed material. What other organizations
// merely share is never offered: an admin follows or copies it first
// (`reference/offered.ts`). Matching is `guideMatch.ts`; this hook only
// gathers the documents.
import { type StudyDoc } from '@langquest-next/core';
import { useMemo } from 'react';
import type { Ctx } from '../ctx';
import { useLibraryDocs } from '../library/useLibrary';
import { offeredGuideSources } from '../reference/offered';
import { bestGuide, guideFromDoc, passageVerses, type GuideSource } from './guideMatch';
import type { StudyGuide } from './guides';

export { glossaryEntryOf } from './guideMatch';

/** The guide for a passage, or null while its documents load or when none covers it. */
export function useStudyGuide(ctx: Ctx, unitId: string | null | undefined, laneId?: string | null): StudyGuide | null {
  const state = ctx.project.state;
  const orgId = ctx.project.orgId;
  const lane = laneId ?? ctx.laneId;
  const { recommended, own } = useMemo(
    () => offeredGuideSources(ctx.org.state?.library ?? {}, ctx.org.state?.recommendations, state, lane, unitId),
    // The org fold changes its maps in place; the state object is new on every change.
    [ctx.org.state, state, lane, unitId]
  ) as { recommended: GuideSource[]; own: GuideSource[] };
  const sel = lane && state ? state.laneTemplates[lane]?.value : undefined;
  const { get } = useLibraryDocs(orgId, [...recommended.map((s) => s.hash), ...own.map((s) => s.hash), sel?.docHash]);

  const choice = useMemo(() => {
    if (!state || !unitId) return null;
    const passage = passageVerses(state, unitId, lane, get);
    return passage ? bestGuide(passage, [recommended, own], get) : null;
  }, [state, unitId, lane, recommended, own, get]);

  // The chosen guide's own document (a collection's entry) loads on demand.
  const entry = useLibraryDocs(orgId, [choice?.hash]);
  const entryGet = entry.get;
  return useMemo(() => {
    if (!choice) return null;
    const doc = entryGet(choice.hash);
    return doc && doc.format === 'study@1' ? guideFromDoc(choice.id, doc as StudyDoc) : null;
  }, [choice, entryGet]);
}
