// The open language's passages for the reference screens: with their verses
// in its template's numbering, once the template and its versification have
// loaded. The rules are in passagesModel.ts.
import { useMemo } from 'react';
import type { TemplateDoc } from '@langquest-next/core';
import type { Ctx } from '../shell/ctx';
import { useLibraryDocs } from '../library/useLibrary';
import { indexesFor } from '../sync/indexes';
import { languagePassageList, templateVersification } from './passagesModel';

/** The open language's passages with their verses, in its template's numbering; null when `enabled` is false or no language is open. */
export function usePassages(ctx: Ctx, enabled: boolean) {
  const state = ctx.language.state;
  const open = enabled && !!ctx.language.languageId;
  const sel = open ? state?.template?.value : undefined;
  const tdocs = useLibraryDocs(ctx.language.orgId, [sel?.docHash]);
  return useMemo(() => {
    if (!state || !open) return null;
    const template = sel?.docHash ? (tdocs.get(sel.docHash) as TemplateDoc | null) : null;
    return languagePassageList(state, indexesFor(state), templateVersification(template, (h) => tdocs.get(h)));
  }, [state, open, sel?.docHash, tdocs]);
}
