// What the material editors decide and write (ORG-8): the questions as stored,
// which fields a save would change, whether Save is enabled, the commands'
// inputs, and the library editor's versification choices, verse-link parts
// and published document. Pure: no React, so it is tested
// (test/materialModel.test.ts).
import {
  formatQuestionField, parseQuestionField, subscriptionItemId, templateFields, unitPrefixOf, unitTitle,
  type KindDef, type LanguageState, type LibraryItemView, type MaterialDoc, type MaterialView, type QuestionSpec
} from '@langquest-next/core';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import type { SharedItem } from '../library/model';
import type { QuestionDraft } from '../config/model';

// ---- the organization's own material -----------------------------------------------

/** How a question is answered, by name in the language showing. */
export function questionTypes(): { id: QuestionSpec['type']; label: string }[] {
  return [
    { id: 'text', label: t('config.questionTypes.text') },
    { id: 'yesno', label: t('config.questionTypes.yesNo') },
    { id: 'rating', label: t('config.questionTypes.rating', { low: formatNumber(1), high: formatNumber(5) }) }
  ];
}

/** A question field as stored: `[yesno!] Is it clear?`; an empty question clears the field. */
export function storedQuestion(q: Pick<QuestionDraft, 'text' | 'type' | 'required'>): string {
  return q.text.trim() ? formatQuestionField({ text: q.text.trim(), type: q.type, required: q.required }) : '';
}

/** Legacy question text without a type prefix reads as the same question once formatted. */
export function normalizedQuestion(raw: string): string {
  if (!raw.trim()) return '';
  const [type, required, text] = parseQuestionField(raw);
  return storedQuestion({ text, type, required });
}

/** Where a material applies: its unit, or the language's team. */
export function materialScopeName(state: LanguageState, m: Pick<MaterialView, 'scope'>, language: string): string {
  return m.scope.unitId ? unitTitle(state, m.scope.unitId) : t('config.reference.languageTeam', { language });
}

/** Question sets in the order of the review kinds they belong to; those tied to none last. */
export function sortQuestionSets<T extends Pick<MaterialView, 'scope'>>(sets: T[], kinds: KindDef[]): T[] {
  return [...sets].sort((a, b) => {
    const ia = kinds.findIndex((k) => k.id === a.scope.stepId), ib = kinds.findIndex((k) => k.id === b.scope.stepId);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
}

/** One field a save would write, with what it holds now (for Undo). */
export interface FieldChange { fieldId: string; text: string; before: string }

/**
 * The sections of a material: its template's, the ones it has, one body for
 * new material without a template, and those added in this session. A new FIA
 * study follows its template (summary, key ideas, scenes, discussion); other
 * new material starts with one section.
 */
export function materialFieldIds(c: { existing: MaterialView | null; isNew: boolean; materialKind: string; extraFields: string[] }): string[] {
  const newTemplateRef = c.isNew && c.materialKind === 'fia_study' ? 'fia_study' : undefined;
  return [...new Set([
    ...templateFields(c.existing?.templateRef ?? newTemplateRef), ...(c.existing?.fields.map((f) => f.fieldId) ?? []),
    ...(c.isNew && !newTemplateRef ? ['body'] : []), ...c.extraFields
  ])];
}

/**
 * What saving would write: for question sets, each question whose stored form
 * differs, and each one removed (cleared); otherwise each section typed into
 * that differs from what it holds. Only touched fields are written (each
 * field is its own register, so two people filling different blanks both land).
 */
export function materialChanges(c: {
  isQuestions: boolean; questions: QuestionDraft[]; baseQuestions: QuestionDraft[]; fieldIds: string[];
  texts: Record<string, string>; before: (fieldId: string) => string;
}): FieldChange[] {
  const changes: FieldChange[] = [];
  if (c.isQuestions) {
    for (const q of c.questions) {
      const text = storedQuestion(q);
      if (text !== normalizedQuestion(c.before(q.fieldId))) changes.push({ fieldId: q.fieldId, text, before: c.before(q.fieldId) });
    }
    for (const q of c.baseQuestions) if (!c.questions.some((x) => x.fieldId === q.fieldId)) changes.push({ fieldId: q.fieldId, text: '', before: c.before(q.fieldId) });
  } else {
    for (const fieldId of c.fieldIds) {
      const draft = c.texts[fieldId];
      if (draft !== undefined && draft.trim() !== c.before(fieldId)) changes.push({ fieldId, text: draft.trim(), before: c.before(fieldId) });
    }
  }
  return changes;
}

/** Is Save enabled: new material needs a title (and a question, for a set) and a place to go; an edit needs a change. */
export function materialReady(c: { isNew: boolean; title: string; isQuestions: boolean; changes: FieldChange[]; toLibrary: boolean; hasLanguage: boolean }): boolean {
  return c.isNew
    ? c.title.trim() !== '' && (!c.isQuestions || c.changes.some((x) => x.text)) && (c.toLibrary || c.hasLanguage)
    : c.changes.length > 0;
}

/** The fields a command writes. */
export function fieldWrites(changes: FieldChange[]): { fieldId: string; text: string }[] {
  return changes.map((f) => ({ fieldId: f.fieldId, text: f.text }));
}

/** The fields an Undo writes: what each held before. */
export function fieldRestores(changes: FieldChange[]): { fieldId: string; text: string }[] {
  return changes.map((f) => ({ fieldId: f.fieldId, text: f.before }));
}

/** The input of `defineMaterial` for new material; a question set is scoped to the review kind it is for. */
export function defineMaterialInput(c: {
  commandId: string; materialId: string; materialKind: string; title: string; changes: FieldChange[]; isQuestions: boolean; reviewKind: string;
}) {
  const newTemplateRef = c.materialKind === 'fia_study' ? 'fia_study' : undefined;
  return {
    commandId: c.commandId, materialId: c.materialId, kind: c.materialKind, title: c.title.trim(), fields: fieldWrites(c.changes),
    ...(newTemplateRef ? { templateRef: newTemplateRef } : {}),
    scope: c.isQuestions ? { stepId: c.reviewKind } : {}
  };
}

// ---- the library's material --------------------------------------------------------

/** Kinds of simple material the library editor makes; question sets and study guides come from elsewhere. */
export const LIBRARY_MATERIAL_KINDS = ['note', 'tg', 'tmf', 'brief', 'document'];

/** A versification a verse link can be read in: one this organization has, or one another shares (followed or copied on Save). */
export interface VersificationChoice { key: string; label: string; hash: string | null; shared?: SharedItem }

/**
 * The versifications a verse link can be numbered in: each language's own,
 * this organization's, and those others share that it does not already follow.
 */
export function versificationChoices(
  own: LibraryItemView[], sharedRows: SharedItem[], isFollowed: (itemId: string) => boolean
): VersificationChoice[] {
  return [
    { key: 'none', label: t('config.libraryMaterial.eachLanguagesOwn'), hash: null },
    ...own.map((v) => ({ key: v.itemId, label: v.name, hash: v.current })),
    ...sharedRows.filter((s) => !isFollowed(subscriptionItemId(s.org_id, s.item_id)))
      .map((s) => ({ key: `${s.org_id}/${s.item_id}`, label: `${s.name} · ${s.org_name}`, hash: s.latest_hash, shared: s }))
  ];
}

/** The choice a stored document had: its own versification, or a stand-in named once it loads. */
export function baseVersificationChoice(choices: VersificationChoice[], baseHash: string | null, loadedName: string | null): VersificationChoice {
  return choices.find((c) => c.hash === baseHash && !c.shared)
    ?? { key: 'doc', label: loadedName ?? t('common.loading'), hash: baseHash };
}

/** The units a verse link's part can be picked from: those of templates, by title, filtered by a search. */
export function templatePartChoices(state: LanguageState, q: string): { unitId: string; label: string }[] {
  const needle = q.trim().toLowerCase();
  return Object.keys(state.units)
    .filter((u) => unitPrefixOf(u) !== null)
    .map((u) => ({ unitId: u, label: unitTitle(state, u) }))
    .filter((u) => !needle || u.label.toLowerCase().includes(needle))
    .sort((x, y) => x.label.localeCompare(y.label));
}

/** A template part a material links, as stored. */
export interface PartLink { template: string; node: string }

/** The part a template unit id names (`template/node`). */
export function partOfUnit(unitId: string): PartLink {
  const slash = unitId.indexOf('/');
  return { template: unitId.slice(0, slash), node: unitId.slice(slash + 1) };
}

/** The parts with one more, unless it is already there. */
export function addPart(linked: PartLink[], link: PartLink): PartLink[] {
  return linked.some((l) => l.template === link.template && l.node === link.node) ? linked : [...linked, link];
}

/** The document a library material Save publishes: the stored one with the form's fields over it. */
export function libraryMaterialDoc(c: {
  material: MaterialDoc | null; kind: string; title: string; language: string | null; body: string; refs: string[]; linked: PartLink[]; versification: string | null;
}): MaterialDoc {
  const { links: _links, versification: _v, body: _b, language: _l, ...rest } = c.material ?? { format: 'material@1' as const, kind: c.kind, title: c.title, deps: [] };
  const links = [...c.refs.map((ref) => ({ ref })), ...c.linked];
  return {
    ...rest, format: 'material@1', kind: c.kind, title: c.title.trim(), deps: [], ...(c.language ? { language: c.language } : {}),
    ...(c.body.trim() ? { body: c.body.trim() } : {}), ...(links.length ? { links } : {}), ...(c.versification ? { versification: c.versification } : {})
  };
}
