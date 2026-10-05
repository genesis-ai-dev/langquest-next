// The study guide for a passage, from the library (docs/library.md,
// docs/reference-material.md): what the organization or the language
// recommends, or an admin linked to the passage, first; then the rest of the
// organization's own, copied or followed material. What other organizations
// merely share is never offered: an admin follows or copies it first
// (`reference/offered.ts`). Matching is `guideMatch.ts`; this hook only
// gathers the documents.
import { libraryItemView, type StudyDoc, type StudyDoc2 } from '@langquest-next/core';
import { useMemo } from 'react';
import { Platform } from 'react-native';
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
  const { recommended, own } = useMemo(() => {
    const library = ctx.org.state?.library ?? {};
    const offered = offeredGuideSources(library, ctx.org.state?.recommendations, state, lane, unitId);
    // An item this organization controls (not a follow) is named, so its single guides offer Edit (guides/GuideEditor.tsx).
    const named = (s: { key: string; hash: string }): GuideSource => {
      const it = libraryItemView(library, s.key);
      return it && it.source !== 'subscription' ? { ...s, itemId: it.itemId } : s;
    };
    return { recommended: offered.recommended.map(named), own: offered.own.map(named) };
    // The org fold changes its maps in place; the state object is new on every change.
  }, [ctx.org.state, state, lane, unitId]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = lane && state ? state.laneTemplates[lane]?.value : undefined;
  const { get } = useLibraryDocs(orgId, [...recommended.map((s) => s.hash), ...own.map((s) => s.hash), sel?.docHash]);

  const choice = useMemo(() => {
    if (!state || !unitId) return null;
    // A part of an outline template has no verses; guides placed on it by template node still match.
    const passage = passageVerses(state, unitId, lane, get);
    return bestGuide({ unitId, range: passage?.range ?? null, versification: passage?.versification ?? null }, [recommended, own], get);
  }, [state, unitId, lane, recommended, own, get]);

  // The chosen guide's own document (a collection's entry) loads on demand.
  const entry = useLibraryDocs(orgId, [choice?.hash]);
  const entryGet = entry.get;
  return useMemo(() => {
    if (!choice) return null;
    const doc = entryGet(choice.hash);
    if (!doc || (doc.format !== 'study@1' && doc.format !== 'study@2')) return null;
    // Only a single guide of an item this organization controls is edited in place; the rest are adapted from a copy.
    const direct = choice.source.hash === choice.hash && choice.source.itemId;
    const origin = { docHash: choice.hash, ...(direct ? { itemId: choice.source.itemId } : {}) };
    return guideFromDoc(choice.id, doc as StudyDoc | StudyDoc2, { phone: Platform.OS !== 'web', origin });
  }, [choice, entryGet]);
}
