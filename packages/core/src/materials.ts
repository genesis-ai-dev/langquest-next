import type { EventPayloads } from './events';
import { QUESTION_TEMPLATES } from './record';
import type { LanguageState } from './state';

/**
 * Reference material and key terms (docs/flow-coverage-audit.md 5.E).
 *
 * A material is a titled document of a kind (TMF, Brief, TG, FIA study,
 * question set, …) at a scope: the whole language, one unit, or one review step. Its
 * content is fields, each a register, so two people filling different
 * blanks of the same material offline both land. Question sets are
 * materials of kind `questions` whose fields are the questions. Locking
 * (UX spec A7) restricts editing; it never hides.
 *
 * Key terms are the language's living glossary: renderings with context,
 * recorded adjustments (text or audio) that may name the translation they
 * happened during, and links from a submitted take to the terms it relied
 * on. Everything is grow-only, so nothing can conflict.
 */

/** Where a material applies; empty means the whole language. */
interface MaterialScope {
  unitId?: string;
  /** For question sets: the kind of review they are for. */
  stepId?: string;
}

export type MaterialEvents = {
  'v1.MaterialDefined': { materialId: string; kind: string; title: string; scope: MaterialScope; templateRef?: string };
  'v1.MaterialFieldSet': { materialId: string; fieldId: string; text?: string; blobHash?: string };
  'v1.MaterialLocked': { materialId: string; locked: boolean };
  'v1.KeyTermDefined': { termId: string; term: string; gloss: string; unitScope: string[] };
  'v1.KeyTermRenderingAdded': { termId: string; renderingId: string; rendering: string; context: string };
  'v1.KeyTermAdjusted': { termId: string; adjustmentId: string; note: string; blobHash?: string; duringTakeId?: string };
  'v1.KeyTermLinked': { takeId: string; termId: string; note?: string; adjustmentId?: string };
};

/** The language's Translation Guidelines document: one per language. */
export const TG_MATERIAL_ID = 'tg';

/** A shipped question set's material id, decided by the set, so two admins adding it offline agree. */
export function questionSetMaterialId(templateId: string): string {
  return `questions/${templateId}`;
}

/** Every event a shipped question set implies: the material plus one field per question. */
export function instantiateQuestionSet(
  templateId: string
): { type: 'v1.MaterialDefined' | 'v1.MaterialFieldSet'; payload: EventPayloads['v1.MaterialDefined'] | EventPayloads['v1.MaterialFieldSet'] }[] {
  const t = QUESTION_TEMPLATES.find((q) => q.id === templateId);
  if (!t) throw new Error(`Unknown question template ${templateId}`);
  const materialId = questionSetMaterialId(templateId);
  return [
    {
      type: 'v1.MaterialDefined',
      payload: { materialId, kind: 'questions', title: t.name, scope: { stepId: t.kindId }, templateRef: `questions/${templateId}` }
    },
    ...t.questions.map((q) => ({
      type: 'v1.MaterialFieldSet' as const,
      payload: { materialId, fieldId: q.id, text: q.text }
    }))
  ];
}

// ---- derivations ---------------------------------------------------------

export interface MaterialView {
  materialId: string;
  kind: string;
  title: string;
  scope: MaterialScope;
  templateRef?: string;
  createdBy: string;
  locked: boolean;
  fields: { fieldId: string; text?: string; blobHash?: string }[];
  /** Fields the template expects that nobody has filled (0 for free-form material). */
  blanks: number;
}

/** Field ids a material's template expects; free-form materials expect none. */
export function templateFields(templateRef: string | undefined): string[] {
  if (!templateRef) return [];
  const [kind, id] = templateRef.split('/');
  if (kind === 'questions') return QUESTION_TEMPLATES.find((q) => q.id === id)?.questions.map((q) => q.id) ?? [];
  if (kind === 'fia_study') return ['summary', 'key_ideas', 'scenes', 'discussion'];
  return [];
}

export function materialView(state: LanguageState, materialId: string): MaterialView | null {
  const m = state.materials[materialId];
  if (!m) return null;
  const fields = Object.entries(m.fields)
    .filter(([, f]) => f.hlc !== '')
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([fieldId, f]) => ({ fieldId, ...f.value }));
  const filled = new Set(fields.filter((f) => (f.text ?? '') !== '' || f.blobHash).map((f) => f.fieldId));
  const expected = templateFields(m.templateRef);
  return {
    materialId,
    kind: m.kind,
    title: m.title,
    scope: m.scope,
    ...(m.templateRef !== undefined ? { templateRef: m.templateRef } : {}),
    createdBy: m.createdBy,
    locked: m.locked.value === true,
    fields,
    blanks: expected.filter((id) => !filled.has(id)).length
  };
}

/** Materials visible from a place: the language-wide ones, the unit's (and its ancestors'), the step's. */
export function materialsFor(state: LanguageState, at: MaterialScope = {}): MaterialView[] {
  const ancestors = at.unitId ? unitAncestry(state, at.unitId) : new Set<string>();
  return Object.keys(state.materials)
    .map((id) => materialView(state, id)!)
    .filter((m) => {
      const s = m.scope;
      if (s.stepId !== undefined) return s.stepId === at.stepId;
      if (s.unitId !== undefined) return ancestors.has(s.unitId);
      return true;
    })
    .sort((a, b) => (a.title < b.title ? -1 : 1));
}

interface QuestionView {
  /** `${materialId}#${fieldId}`: the key answers are stored under. */
  id: string;
  materialId: string;
  fieldId: string;
  text: string;
}

export function questionsOf(sets: MaterialView[]): QuestionView[] {
  return sets.flatMap((m) =>
    m.fields.filter((f) => (f.text ?? '') !== '').map((f) => ({ id: `${m.materialId}#${f.fieldId}`, materialId: m.materialId, fieldId: f.fieldId, text: f.text! }))
  );
}

// ---- key terms -------------------------------------------------------------

export interface KeyTermView {
  termId: string;
  term: string;
  gloss: string;
  unitScope: string[];
  renderings: { renderingId: string; rendering: string; context: string }[];
  adjustments: { adjustmentId: string; note: string; blobHash?: string; duringTakeId?: string; actorId: string; hlc: string }[];
}

export function keyTermView(state: LanguageState, termId: string): KeyTermView | null {
  const t = state.keyTerms[termId];
  if (!t) return null;
  return {
    termId,
    term: t.term,
    gloss: t.gloss,
    unitScope: t.unitScope,
    renderings: Object.entries(t.renderings)
      .sort(([, a], [, b]) => (a.hlc < b.hlc ? -1 : 1))
      .map(([renderingId, r]) => ({ renderingId, rendering: r.rendering, context: r.context })),
    adjustments: Object.entries(t.adjustments)
      .sort(([, a], [, b]) => (a.hlc < b.hlc ? -1 : 1))
      .map(([adjustmentId, a]) => ({ adjustmentId, ...a }))
  };
}

/** The language's glossary, alphabetical. */
export function keyTermsFor(state: LanguageState): KeyTermView[] {
  return Object.keys(state.keyTerms)
    .filter((id) => state.keyTerms[id]!.term !== '')
    .map((id) => keyTermView(state, id)!)
    .sort((a, b) => (a.term.toLowerCase() < b.term.toLowerCase() ? -1 : 1));
}

/**
 * The in-translation shortlist (UX spec: "books this term matters in"): a
 * term is relevant to a unit when its scope names the unit or an ancestor,
 * or when it has no scope at all.
 */
export function keyTermsForUnit(state: LanguageState, unitId: string): KeyTermView[] {
  const ancestors = unitAncestry(state, unitId);
  return keyTermsFor(state).filter((t) => t.unitScope.length === 0 || t.unitScope.some((u) => ancestors.has(u)));
}

/** The terms a submitted take relied on (reviewer's "terms the translator tied in"). */
export function keyTermLinksFor(state: LanguageState, takeId: string): { term: KeyTermView; note?: string; adjustmentId?: string }[] {
  return Object.entries(state.keyTermLinks[takeId] ?? {})
    .map(([termId, l]) => {
      const term = keyTermView(state, termId);
      return term ? { term, ...(l.note !== undefined ? { note: l.note } : {}), ...(l.adjustmentId !== undefined ? { adjustmentId: l.adjustmentId } : {}) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/** Inverse index: every take that tied in this term (key_term_detail's "linked translations"). */
export function takesLinkingTerm(state: LanguageState, termId: string): { takeId: string; note?: string; adjustmentId?: string }[] {
  const out: { takeId: string; note?: string; adjustmentId?: string }[] = [];
  for (const [takeId, byTerm] of Object.entries(state.keyTermLinks)) {
    const l = byTerm[termId];
    if (l) out.push({ takeId, ...(l.note !== undefined ? { note: l.note } : {}), ...(l.adjustmentId !== undefined ? { adjustmentId: l.adjustmentId } : {}) });
  }
  return out.sort((a, b) => (a.takeId < b.takeId ? -1 : 1));
}

/** The unit and every ancestor up to the root. */
export function unitAncestry(state: LanguageState, unitId: string): Set<string> {
  const out = new Set<string>();
  let cur: string | null = unitId;
  while (cur && !out.has(cur)) {
    out.add(cur);
    cur = state.units[cur]?.parentUnitId ?? null;
  }
  return out;
}

