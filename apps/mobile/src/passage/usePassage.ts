// One passage as its screens read it (passage/passageView.ts builds the view).
import { languageName } from '@langquest-next/core';
import { useMemo } from 'react';
import type { Ctx } from '../shell/ctx';
import { passageView, type PassageView } from './passageView';

/**
 * The passage a screen is about, from its `unitId`/`languageId` params; null
 * while loading or when unknown. A `languageId` param opens that language's
 * stream, so the open language is the one the passage is in.
 */
export function usePassage(ctx: Ctx): PassageView | null {
  const state = ctx.language.state;
  const unitId = ctx.params['unitId'];
  const languageId = ctx.params['languageId'] ?? ctx.languageId ?? undefined;
  const orgState = ctx.org.state;
  const openLanguageId = ctx.language.languageId;
  return useMemo(() => {
    if (!state || !unitId || !languageId || languageId !== openLanguageId || !state.units[unitId]) return null;
    return passageView(state, unitId, languageId, languageName(orgState, languageId));
  }, [state, unitId, languageId, openLanguageId, orgState]);
}
