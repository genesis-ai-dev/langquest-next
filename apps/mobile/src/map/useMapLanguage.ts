// What the Map knows about the open language and this person, memoised per
// revision (decision 71; screens/map.tsx). The choices are in mapModel.ts.
import { useMemo } from 'react';
import type { LanguageState } from '@langquest-next/core';
import type { Ctx } from '../shell/ctx';
import type { IconName } from '../ui/kit';
import { forYouIds, nextPassage } from './mapModel';

/** Passages with something for this person on My Work: marked on the map, not listed (ADR-017). */
export function useForYou(ctx: Ctx, state: LanguageState | null): Set<string> {
  const canRecord = ctx.session.can('translate');
  const canReview = ctx.session.can('review');
  return useMemo(() => forYouIds(state, ctx.session.actorId, { canRecord, canReview }), [state, ctx.session.actorId, canRecord, canReview]);
}

/** This person's next passage on the map (demo Map's "Next"; see `nextPassage`). */
export function useNextPassage(ctx: Ctx, state: LanguageState | null): { unitId: string; icon: IconName } | null {
  const canRecord = ctx.session.can('translate');
  const canReview = ctx.session.can('review');
  return useMemo(() => nextPassage(state, ctx.session.actorId, { canRecord, canReview }), [state, ctx.session.actorId, canRecord, canReview]);
}
