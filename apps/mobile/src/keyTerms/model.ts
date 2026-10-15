// What the key-term screens decide and write (TERM-1..6): the first-rendering
// note, which terms a passage holds, where a term was used, whether a draft
// can be tied to it, and the inputs of the commands a save runs. Pure: no
// React, so it is tested (test/keyTermsModel.test.ts).
import {
  derivePassage, takesLinkingTerm, unitTitle,
  type KeyTermView, type LanguageState, type PassageState
} from '@langquest-next/core';
import { t } from '../i18n';
import { indexesFor } from '../indexes';
import { matchesTerm } from '../config/model';

/**
 * A new term's first adjustment, when nobody wrote why: written into the
 * event log in English (everyone reads the same log), and said in the
 * language showing wherever it is shown here (`adjustmentNote`).
 */
export function firstRenderingNote(rendering: string): string {
  return `First rendering: ${rendering}.`; // i18n-ignore: stored in the event log; adjustmentNote shows it translated
}
const FIRST_RENDERING = /^First rendering: ([\s\S]*)\.$/;

/** An adjustment's note as written, or the app's own first-rendering note in the language showing. */
export function adjustmentNote(note: string): string {
  const m = FIRST_RENDERING.exec(note);
  return m ? t('config.keyTerm.firstRendering', { rendering: m[1] }) : note;
}

/** The terms matching a search, split into those in the open passage and the rest. */
export function groupTerms(terms: KeyTermView[], here: ReadonlySet<string>, q: string): { inPassage: KeyTermView[]; rest: KeyTermView[] } {
  const matching = terms.filter((term) => matchesTerm(term, q));
  return {
    inPassage: matching.filter((term) => here.has(term.termId)),
    rest: matching.filter((term) => !here.has(term.termId))
  };
}

/** What a new term is made of, typed in the sheet. */
export interface TermDraft { term: string; gloss: string; rendering: string; context: string }

export const EMPTY_TERM_DRAFT: TermDraft = { term: '', gloss: '', rendering: '', context: '' };

/** A new term needs the word and its first rendering. */
export function termDraftReady(draft: TermDraft): boolean {
  return !!draft.term.trim() && !!draft.rendering.trim();
}

/**
 * The input of `defineKeyTerm` (TERM-6): the concept scoped to the passage's
 * book, its first rendering, and that as its first adjustment (who, when,
 * which passage: the take being drafted, else the latest one).
 */
export function defineTermInput(
  state: LanguageState, draft: TermDraft, unitId: string | undefined, ids: { commandId: string; termId: string }
) {
  const book = unitId ? state.units[unitId]?.parentUnitId ?? unitId : null;
  const during = unitId && state.units[unitId] ? derivePassage(state, unitId, indexesFor(state)) : null;
  const duringTakeId = during?.draftTakeId ?? during?.latest?.takeId;
  return {
    commandId: ids.commandId, termId: ids.termId, term: draft.term, gloss: draft.gloss, unitScope: book ? [book] : [],
    rendering: draft.rendering, context: draft.context,
    note: draft.context.trim() || firstRenderingNote(draft.rendering.trim()), ...(duringTakeId ? { duringTakeId } : {})
  };
}

/** A version of a passage that a term is used in. */
export interface TermUse {
  takeId: string; note?: string; adjustmentId?: string;
  unitId: string; title: string; n: number; by: string; hlc: string;
}

/** The versions whose takes link the term, with the passage and version number each belongs to (those that no longer exist drop out). */
export function termUsedIn(state: LanguageState, termId: string): TermUse[] {
  const idx = indexesFor(state);
  return takesLinkingTerm(state, termId).flatMap((l) => {
    const take = state.takes[l.takeId];
    if (!take) return [];
    const v = derivePassage(state, take.unitId, idx).versions.find((x) => x.takeId === l.takeId);
    return v ? [{ ...l, unitId: take.unitId, title: unitTitle(state, take.unitId), n: v.n, by: v.by, hlc: v.hlc }] : [];
  });
}

/** The version a take is, for a link to it; null when the take is gone. n is null if the passage no longer lists it. */
export function versionOfTake(state: LanguageState, takeId: string | undefined): { unitId: string; takeId: string; title: string; n: number | null } | null {
  const take = takeId ? state.takes[takeId] : undefined;
  if (!take || !takeId) return null;
  const v = derivePassage(state, take.unitId, indexesFor(state)).versions.find((x) => x.takeId === takeId);
  return { unitId: take.unitId, takeId, title: unitTitle(state, take.unitId), n: v?.n ?? null };
}

/** Whether a draft can be tied to the term, and whether it already is (TERM-4). */
export function tieState(
  state: LanguageState, termId: string, draftTakeId: string | null | undefined, takeParam: string | undefined,
  can: { translate: boolean; edit: boolean }
): { canTie: boolean; isLinked: boolean } {
  // TERM-4 is offered from the workspace, which passes the draft (or no take); a version's page passes that version.
  const fromDraft = !takeParam || takeParam === draftTakeId;
  return {
    canTie: !!draftTakeId && fromDraft && can.translate && can.edit,
    isLinked: !!draftTakeId && !!state.keyTermLinks[draftTakeId]?.[termId]
  };
}

/** Is there something to save in an adjustment: a typed note or a recorded one. */
export function adjustmentReady(note: string, hash: string | null): boolean {
  return !!note.trim() || !!hash;
}

/** The take an adjustment was made during: the draft, else the passage's latest version. */
export function adjustDuringTake(draftTakeId: string | null | undefined, passage: Pick<PassageState, 'latest'> | null): string | undefined {
  return draftTakeId ?? passage?.latest?.takeId;
}
