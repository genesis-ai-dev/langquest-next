// The help rows a check shows (checks/parts.tsx).
import { checkHelps, type LanguageState } from '@langquest-next/core';
import { useMemo } from 'react';
import type { Ctx } from '../shell/ctx';
import type { IconName } from '../ui/kit';
import { useLibrary, useLibraryDocs } from '../library/useLibrary';
import { refKindOf } from '../reference/model';
import { referenceKindName } from '../config/model';

/** A help on a check, as a reviewer opens it: a note or document, a study guide, or a Bible. */
export interface HelpRow {
  key: string;
  name: string;
  sub?: string;
  icon: IconName;
  open: { screen: 'material_editor'; params: Record<string, string> } | { screen: 'study_guide' } | { bible: string };
}

/** A check's helps (decision 91) with their names and how each opens. */
export function useCheckHelpRows(ctx: Ctx, state: LanguageState | null | undefined, kindId: string): HelpRow[] {
  const lib = useLibrary(ctx);
  const helps = useMemo(() => (state ? checkHelps(state, kindId) : []), [state, kindId]);
  const docs = useLibraryDocs(lib.orgId, helps.map((h) => ('itemId' in h ? lib.item(h.itemId)?.current : undefined)), { deps: false });
  if (!state) return [];
  return helps.flatMap((h): HelpRow[] => {
    if ('materialId' in h) {
      const m = state.materials[h.materialId];
      if (!m) return [];
      return [{ key: h.materialId, name: m.title, sub: referenceKindName(m.kind), icon: 'note', open: { screen: 'material_editor', params: { materialId: h.materialId, languageId: ctx.language.languageId } } }];
    }
    const it = lib.item(h.itemId);
    if (!it) return [];
    const kind = refKindOf(docs.get(it.current));
    if (kind === 'source') return [{ key: h.itemId, name: it.name, icon: 'book', open: { bible: h.itemId } }];
    if (kind === 'guide') return [{ key: h.itemId, name: it.name, icon: 'sparkle', open: { screen: 'study_guide' } }];
    return [{ key: h.itemId, name: it.name, ...(it.description ? { sub: it.description } : {}), icon: 'note', open: { screen: 'material_editor', params: { itemId: h.itemId } } }];
  });
}
