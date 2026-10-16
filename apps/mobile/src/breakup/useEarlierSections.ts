// Sections from an earlier break-up of a book, as the screen shows them (breakup/earlier.tsx).
import { earlierSections, isTemplateDoc, templateUnits, unitPrefixOf, type LanguageState, type VersificationDoc } from '@langquest-next/core';
import { useMemo } from 'react';
import type { Ctx } from '../shell/ctx';
import { indexesFor } from '../sync/indexes';
import { useLibraryDocs } from '../library/useLibrary';
import { numberedLike } from './earlierSections';

export interface Earlier {
  /** Current section -> the expired sections with work that overlap it. */
  over: Map<string, string[]>;
  /** An expired section -> how it was numbered, when that is not how the language numbers now. */
  numbered: Map<string, string>;
}

export function useEarlierSections(ctx: Ctx, state: LanguageState | null): Earlier {
  const history = state?.templateHistory ?? {};
  const current = state?.template?.value;
  const hashes = [...Object.keys(history), current?.docHash];
  const docs = useLibraryDocs(ctx.language.orgId, hashes);
  return useMemo(() => {
    const out: Earlier = { over: new Map(), numbered: new Map() };
    if (!state || !current) return out;
    const idx = indexesFor(state);
    const now = new Set(idx.passages);
    const worked = new Set([...Object.values(state.recordings).map((r) => r.unitId), ...Object.values(state.takes).map((take) => take.unitId)]);
    const expired = [...worked].filter((u) => !now.has(u) && state.units[u] && unitPrefixOf(u) !== null && !idx.containers.includes(u));
    if (expired.length === 0) return out;
    const want = new Set(expired);
    // The numbering each expired section was made in: the earliest template version that had it.
    const madeIn = new Map<string, VersificationDoc>();
    const versions = Object.entries(history).sort(([, a], [, b]) => (a.hlc < b.hlc ? -1 : 1));
    for (const [hash, h] of versions) {
      const d = docs.get(hash);
      if (!d || !isTemplateDoc(d) || !d.bible) continue;
      const v = docs.get<VersificationDoc>(d.bible.versification);
      if (!v) continue;
      for (const u of templateUnits(d, h.unitPrefix, v)) if (want.has(u.unitId) && !madeIn.has(u.unitId)) madeIn.set(u.unitId, v);
    }
    const doc = docs.get(current.docHash);
    const numbering = doc && isTemplateDoc(doc) && doc.bible ? docs.get<VersificationDoc>(doc.bible.versification) : null;
    for (const [u, v] of madeIn) if (numbering && v.code !== numbering.code) out.numbered.set(u, numberedLike(v.code) ?? v.name);
    out.over = earlierSections({ current: idx.passages, expired, currentNumbering: numbering, numberingOf: (u) => madeIn.get(u) ?? null });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- docs.get changes when documents arrive
  }, [state, current, docs.get]);
}
