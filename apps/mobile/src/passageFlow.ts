import {
  currentTake, deriveTakeStatus, keyTermsFor, keyTermsForUnit,
  type ProjectState
} from '@langquest-next/core';

export type PassageAction = 'reference' | 'terms' | 'record' | 'submit' | 'done';

/** UI guidance is derived, not a second persisted workflow status. */
export function passageProgress(
  state: ProjectState,
  laneId: string,
  unitId: string,
  referencePending: boolean
) {
  const terms = keyTermsForUnit(state, laneId, unitId);
  const glossary = keyTermsFor(state, laneId);
  const hasAudio = (term: (typeof terms)[number]) =>
    term.adjustments.some((a) => !!a.blobHash);
  const remainingTerms = terms.filter((t) => !hasAudio(t));
  const recordedTerms = glossary.filter(hasAudio).length;
  const takeId = currentTake(state, unitId, laneId);
  const take = takeId ? state.takes[takeId] : undefined;
  const status = takeId ? deriveTakeStatus(state, takeId) : null;
  const canSubmit = status?.outcome === 'draft' &&
    (take?.cardHashes.length ?? 0) > 0;
  let next: PassageAction;
  if (status?.submitted && status.outcome !== 'changes_requested') next = 'done';
  else if (status?.outcome === 'changes_requested') next = 'record';
  else if (canSubmit) next = 'submit';
  else if (referencePending) next = 'reference';
  else if (remainingTerms.length) next = 'terms';
  else next = 'record';
  return {
    next, takeId, status, canSubmit, terms, remainingTerms,
    recordedTerms, totalTerms: glossary.length
  };
}

/** Transfer acknowledgement is independent of approval status. */
export function handoffState(input: {
  pending: number;
  online: boolean | null;
  refused: string | null;
  tooOld: boolean;
  audioStored: boolean;
}): 'blocked' | 'queued' | 'sent' {
  if (input.refused || input.tooOld) return 'blocked';
  if (input.pending > 0 || !input.audioStored || input.online !== true) {
    return 'queued';
  }
  return 'sent';
}
