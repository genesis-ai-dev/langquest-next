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
  const ids = useMemo(() => (unitId ? [unitId] : []), [unitId]);
  return useStudyGuides(ctx, ids, laneId).get(unitId ?? '') ?? null;
}

/**
 * Guides for many passages at once (the offline prefetch, decisions.md 59).
 * A passage missing from the map has no guide, or its documents have not loaded.
 */
export function useStudyGuides(ctx: Ctx, unitIds: readonly string[], laneId?: string | null): Map<string, StudyGuide> {
  const state = ctx.project.state;
  const orgId = ctx.project.orgId;
  const lane = laneId ?? ctx.laneId;
  const own: GuideSource[] = useMemo(() => libraryItems(ctx.org.state?.library ?? {}, 'material')
    .filter((i) => i.current && !i.archived)
    .map((i) => ({ key: i.itemId, hash: i.current! })), [ctx.org.state?.library]);
  const shared = useSharedItems('material', orgId, unitIds.length > 0);
  const others: GuideSource[] = useMemo(() => shared.rows.map((r) => ({ key: `${r.org_id}.${r.item_id}`, hash: r.latest_hash })), [shared.rows]);
  const sel = lane && state ? state.laneTemplates[lane]?.value : undefined;
  const { get } = useLibraryDocs(orgId, [...own.map((s) => s.hash), ...others.map((s) => s.hash), sel?.docHash]);

  const choices = useMemo(() => {
    const out = new Map<string, { id: string; hash: string }>();
    if (!state) return out;
    for (const unitId of unitIds) {
      const passage = passageVerses(state, unitId, lane, get);
      const choice = passage ? bestGuide(passage, [own, others], get) : null;
      if (choice) out.set(unitId, choice);
    }
    return out;
  }, [state, unitIds, lane, own, others, get]);

  // The chosen guides' own documents (a collection's entries) load on demand.
  const entry = useLibraryDocs(orgId, [...choices.values()].map((c) => c.hash));
  const entryGet = entry.get;
  return useMemo(() => {
    const out = new Map<string, StudyGuide>();
    for (const [unitId, choice] of choices) {
      const doc = entryGet(choice.hash);
      if (doc && doc.format === 'study@1') out.set(unitId, guideFromDoc(choice.id, doc as StudyDoc));
    }
    return out;
  }, [choices, entryGet]);
}
