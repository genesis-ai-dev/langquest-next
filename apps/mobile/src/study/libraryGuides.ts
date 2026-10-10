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
import { chosenOnly } from '../reference/guideSets';
import { offeredGuideSources } from '../reference/offered';
import { bestGuide, guideFromDoc, passageVerses, type GuideSource } from './guideMatch';
import type { StudyGuide } from './guides';

export { glossaryEntryOf } from './guideMatch';

/** The guide for a passage, or null while its documents load or when none covers it. */
export function useStudyGuide(ctx: Ctx, unitId: string | null | undefined): StudyGuide | null {
  const ids = useMemo(() => (unitId ? [unitId] : []), [unitId]);
  return useStudyGuides(ctx, ids).get(unitId ?? '') ?? null;
}

/**
 * Guides for many passages at once (the offline prefetch, decisions.md 61).
 * A passage missing from the map has no guide, or its documents have not loaded.
 */
export function useStudyGuides(ctx: Ctx, unitIds: readonly string[]): Map<string, StudyGuide> {
  const state = ctx.language.state;
  const orgId = ctx.language.orgId;
  // What each passage is offered: recommended or linked to it first, then the organization's own (reference/offered.ts).
  const offered = useMemo(() => {
    const library = ctx.org.state?.library ?? {};
    // An item this organization controls (not a follow) is named, so its single guides offer Edit (guides/GuideEditor.tsx).
    const named = (s: { key: string; hash: string; origin: string }): GuideSource => {
      const it = libraryItemView(library, s.key);
      return it && it.source !== 'subscription' ? { ...s, itemId: it.itemId } : s;
    };
    const out = new Map<string, { recommended: GuideSource[]; own: GuideSource[] }>();
    for (const unitId of unitIds) {
      const o = offeredGuideSources(library, ctx.org.state?.recommendations, state, unitId);
      out.set(unitId, { recommended: o.recommended.map(named), own: o.own.map(named) });
    }
    return out;
    // The org fold changes its maps in place; the state object is new on every change.
  }, [ctx.org.state, state, unitIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = state?.template?.value;
  const hashes = useMemo(() => [...new Set([...offered.values()].flatMap((o) => [...o.recommended, ...o.own].map((s) => s.hash)))], [offered]);
  // Nothing to match, nothing to load: the prefetch on the web, or a screen with no passage yet.
  const { get } = useLibraryDocs(orgId, unitIds.length ? [...hashes, sel?.docHash] : []);

  const choices = useMemo(() => {
    const out = new Map<string, NonNullable<ReturnType<typeof bestGuide>>>();
    if (!state) return out;
    for (const unitId of unitIds) {
      const o = offered.get(unitId);
      if (!o) continue;
      // A part of an outline template has no verses; guides placed on it by template node still match.
      const passage = passageVerses(state, unitId, get);
      // A guide set's languages the team did not choose stay out (decision 84).
      const choice = bestGuide({ unitId, range: passage?.range ?? null, versification: passage?.versification ?? null }, chosenOnly([o.recommended, o.own], get), get);
      if (choice) out.set(unitId, choice);
    }
    return out;
  }, [state, unitIds, offered, get]);

  // The chosen guides' own documents (a collection's entries) load on demand.
  const entry = useLibraryDocs(orgId, [...choices.values()].map((c) => c.hash));
  const entryGet = entry.get;
  return useMemo(() => {
    const out = new Map<string, StudyGuide>();
    for (const [unitId, choice] of choices) {
      const doc = entryGet(choice.hash);
      if (!doc || (doc.format !== 'study@1' && doc.format !== 'study@2')) continue;
      // Only a single guide of an item this organization controls is edited in place; the rest are adapted from a copy.
      const direct = choice.source.hash === choice.hash && choice.source.itemId;
      const origin = { docHash: choice.hash, ...(direct ? { itemId: choice.source.itemId } : {}) };
      out.set(unitId, guideFromDoc(choice.id, doc as StudyDoc | StudyDoc2, { phone: Platform.OS !== 'web', origin }));
    }
    return out;
  }, [choices, entryGet]);
}
