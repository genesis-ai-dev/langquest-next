// What the key-term screens decide and write (TERM-1..6): the first-rendering
// note, which terms a passage holds, where a term was used, whether a draft
// can be tied to it, and the inputs of the commands a save runs. Pure: no
// React, so it is tested (test/keyTermsModel.test.ts).
import {
  derivePassage, takesLinkingTerm, unitTitle,
  type KeyTermView, type LanguageState, type PassageState
} from '@langquest-next/core';
import { t } from '../i18n';
import { indexesFor } from '../sync/indexes';
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

// ---- the team's words for a term (LAN-233) ----------------------------------------------------

/** What the team's words are read from: a term's renderings and the changes made with them, and the clips recorded as examples of a way of saying it (decision 207). */
type TermWordsOf = Pick<KeyTermView, 'renderings' | 'adjustments'> & Partial<Pick<KeyTermView, 'audioRenderings'>>;

/** The latest voice recording of the term in this language: what a tile's ▶ plays (a recorded example when no word was said in a change). */
export function termVoice(term: Pick<KeyTermView, 'adjustments'> & Partial<Pick<KeyTermView, 'audioRenderings'>>): string | undefined {
  return [...term.adjustments].reverse().find((a) => a.blobHash)?.blobHash ?? term.audioRenderings?.[term.audioRenderings.length - 1]?.blobHash;
}

/**
 * The team's word for a term as a tile or a chip in the Bible shows it: the
 * newest written word (with the newest voice, to play), else a word that was
 * only said, else none yet.
 */
export type OurWord =
  | { kind: 'text'; text: string; voice?: string }
  | { kind: 'voice'; voice: string }
  | { kind: 'none' };

export function ourWord(term: TermWordsOf): OurWord {
  const voice = termVoice(term);
  const text = [...term.renderings].reverse().find((r) => r.rendering.trim())?.rendering.trim();
  if (text) return { kind: 'text', text, ...(voice ? { voice } : {}) };
  return voice ? { kind: 'voice', voice } : { kind: 'none' };
}

/** The word for each term that has one, by term id: what the Bible's chips read. */
export function ourWords(terms: readonly (TermWordsOf & Pick<KeyTermView, 'termId'>)[]): Map<string, OurWord> {
  const out = new Map<string, OurWord>();
  for (const term of terms) {
    const word = ourWord(term);
    if (word.kind !== 'none') out.set(term.termId, word);
  }
  return out;
}

/** One word the team has for a term, with the version it was said in and the versions that used it. */
export interface TermWord {
  /** The rendering's id, or the change's id for a word that was only said. */
  id: string;
  /** Written; empty for a word that was only said. */
  rendering: string;
  context: string;
  /** The recording of it, when it was said. */
  voice?: string;
  /** The version it was said or written during, when the term's change named one. */
  saidIn?: { unitId: string; takeId: string; title: string; n: number | null };
  /** The versions that tied the term in with this word. */
  usedIn: TermUse[];
}

/** The command that made a rendering and its change: `rendering:<id>` and `adjustment:<id>` share `<id>`. */
const commandOf = (id: string) => id.slice(id.indexOf(':') + 1);

/**
 * The team's words for a term, newest first: each written rendering with the
 * change made with it (its voice, the version it was said in), and each
 * change that holds a voice and no rendering (a word that was only said). A
 * change with neither (a note on why) is not a word. `uses` says which
 * version tied the term in with which word (`KeyTermLinked.adjustmentId`);
 * `versionOf` finds a take's version (`versionOfTake`).
 */
export function termWords(
  term: TermWordsOf, uses: readonly TermUse[],
  versionOf: (takeId: string) => { unitId: string; takeId: string; title: string; n: number | null } | null
): TermWord[] {
  const writtenIn = new Set(term.renderings.filter((r) => r.rendering.trim()).map((r) => commandOf(r.renderingId)));
  const changeOf = new Map(term.adjustments.map((a) => [commandOf(a.adjustmentId), a]));
  const make = (id: string, rendering: string, context: string, a: KeyTermView['adjustments'][number] | undefined): { word: TermWord; hlc: string } => {
    const saidIn = a?.duringTakeId ? versionOf(a.duringTakeId) : null;
    return {
      hlc: a?.hlc ?? '',
      word: { id, rendering, context, ...(a?.blobHash ? { voice: a.blobHash } : {}), ...(saidIn ? { saidIn } : {}), usedIn: a ? uses.filter((u) => u.adjustmentId === a.adjustmentId) : [] }
    };
  };
  // A clip recorded as an example of a way of saying the term (decision 207) is that way's voice: a written word's when the way is
  // that word's, else a word that was only said.
  const clips = new Map<string, NonNullable<TermWordsOf['audioRenderings']>[number]>();
  for (const c of term.audioRenderings ?? []) clips.set(c.wayId, c);
  const made = [
    // A rendering with no change of its own is older than any that has one.
    ...term.renderings.filter((r) => r.rendering.trim()).map((r) => {
      const m = make(r.renderingId, r.rendering.trim(), r.context.trim(), changeOf.get(commandOf(r.renderingId)));
      const clip = clips.get(r.renderingId);
      if (clip && !m.word.voice) m.word.voice = clip.blobHash;
      return m;
    }),
    ...term.adjustments.filter((a) => a.blobHash && !writtenIn.has(commandOf(a.adjustmentId))).map((a) => make(a.adjustmentId, '', '', a)),
    ...[...clips].filter(([wayId]) => !term.renderings.some((r) => r.renderingId === wayId && r.rendering.trim())).map(([wayId, c]) => {
      const saidIn = c.duringTakeId ? versionOf(c.duringTakeId) : null;
      return { hlc: '', word: { id: wayId, rendering: '', context: '', voice: c.blobHash, ...(saidIn ? { saidIn } : {}), usedIn: [] as TermUse[] } };
    })
  ];
  return made.map((m, i) => ({ m, i })).sort((x, y) => (x.m.hlc < y.m.hlc ? -1 : x.m.hlc > y.m.hlc ? 1 : x.i - y.i)).map((x) => x.m.word).reverse();
}
