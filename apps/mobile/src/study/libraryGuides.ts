// The study guide for a passage, from the library (docs/library.md): the
// organization's own, copied or followed study material first, then what
// other organizations share (LangQuest's FIA guides). Matching is
// `guideMatch.ts`; this hook only gathers the documents.
import { libraryItems, type StudyDoc } from '@langquest-next/core';
import { useMemo } from 'react';
import type { Ctx } from '../ctx';
import { useLibraryDocs, useSharedItems } from '../library/useLibrary';
import { bestGuide, guideFromDoc, passageVerses, type GuideSource } from './guideMatch';
import type { StudyGuide } from './guides';

export { glossaryEntryOf } from './guideMatch';

/** The guide for a passage, or null while its documents load or when none covers it. */
export function useStudyGuide(ctx: Ctx, unitId: string | null | undefined, laneId?: string | null): StudyGuide | null {
  const state = ctx.project.state;
  const orgId = ctx.project.orgId;
  const lane = laneId ?? ctx.laneId;
  const own: GuideSource[] = useMemo(() => libraryItems(ctx.org.state?.library ?? {}, 'material')
    .filter((i) => i.current && !i.archived)
    .map((i) => ({ key: i.itemId, hash: i.current! })), [ctx.org.state?.library]);
  const shared = useSharedItems('material', orgId, !!unitId);
  const others: GuideSource[] = useMemo(() => shared.rows.map((r) => ({ key: `${r.org_id}.${r.item_id}`, hash: r.latest_hash })), [shared.rows]);
  const sel = lane && state ? state.laneTemplates[lane]?.value : undefined;
  const { get } = useLibraryDocs(orgId, [...own.map((s) => s.hash), ...others.map((s) => s.hash), sel?.docHash]);

  const choice = useMemo(() => {
    if (!state || !unitId) return null;
    const passage = passageVerses(state, unitId, lane, get);
    return passage ? bestGuide(passage, [own, others], get) : null;
  }, [state, unitId, lane, own, others, get]);

  // The chosen guide's own document (a collection's entry) loads on demand.
  const entry = useLibraryDocs(orgId, [choice?.hash]);
  const entryGet = entry.get;
  return useMemo(() => {
    if (!choice) return null;
    const doc = entryGet(choice.hash);
    return doc && doc.format === 'study@1' ? guideFromDoc(choice.id, doc as StudyDoc) : null;
  }, [choice, entryGet]);
}
