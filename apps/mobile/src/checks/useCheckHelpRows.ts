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
  open: { screen: 'material_editor'; params: Record<string, string> } | { screen: 'study_guide' } | { bible: string }
    /** A set of notes, key words or articles from the library: what it has on this passage, in a sheet. */
    | { passage: string };
}

/** A check's helps (decision 91) with their names and how each opens. */
export function useCheckHelpRows(ctx: Ctx, state: LanguageState | null | undefined, kindId: string): HelpRow[] {
  const lib = useLibrary(ctx);
  const helps = useMemo(() => (state ? checkHelps(state, kindId) : []), [state, kindId]);
  const docs = useLibraryDocs(lib.orgId, helps.map((h) => ('itemId' in h ? lib.item(h.itemId)?.current : undefined)), { deps: false });
  if (!state) return [];
  // With a set of key-word links on the check, the key words' articles open from its row: no row of their own.
  const linksWords = helps.some((h) => { const d = 'itemId' in h ? docs.get(lib.item(h.itemId)?.current) : undefined; return d?.format === 'helps@1' && d.kind === 'wordLinks'; });
  return helps.flatMap((h): HelpRow[] => {
    if ('materialId' in h) {
      const m = state.materials[h.materialId];
      if (!m) return [];
      return [{ key: h.materialId, name: m.title, sub: referenceKindName(m.kind), icon: 'note', open: { screen: 'material_editor', params: { materialId: h.materialId, languageId: ctx.language.languageId } } }];
    }
    const it = lib.item(h.itemId);
    if (!it) return [];
    const doc = docs.get(it.current);
    // A question set is asked, not read (the check's questions, decision 91 as amended 2026-10-19).
    if ((doc?.format === 'helps@1' || doc?.format === 'material@1') && doc.kind === 'questions') return [];
    if (doc?.format === 'contents@1' && doc.kind === 'words' && linksWords) return [];
    if (doc?.format === 'helps@1' || doc?.format === 'contents@1') return [{ key: h.itemId, name: it.name, icon: doc.format === 'contents@1' ? 'book' : 'note', open: { passage: h.itemId } }];
    const kind = refKindOf(doc);
    if (kind === 'source') return [{ key: h.itemId, name: it.name, icon: 'book', open: { bible: h.itemId } }];
    if (kind === 'guide') return [{ key: h.itemId, name: it.name, icon: 'sparkle', open: { screen: 'study_guide' } }];
    return [{ key: h.itemId, name: it.name, ...(it.description ? { sub: it.description } : {}), icon: 'note', open: { screen: 'material_editor', params: { itemId: h.itemId } } }];
  });
}
