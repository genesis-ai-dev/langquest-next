// What the library editors and key-word sheets keep on this phone while they
// are unfinished (decision 111): the template, flow and material editors,
// a key word's new rendering, and a new key term. Each screen holds its form
// with useDraft (useDraft.ts); these say what a stored draft may look like,
// so one this version cannot read is dropped rather than shown half.
//
// An editor's draft is null while the form is as it started, so opening and
// closing an editor leaves nothing behind; `v` keeps a draft whose only change
// is a field emptied (hasContent would read it as nothing).
import type { KindDef } from '@langquest-next/core';
import type { DraftStep, QuestionDraft } from '../config/model';
import type { TermDraft } from '../keyTerms/model';
import type { VersificationChoice } from '../reference/materialModel';
import type { TemplateForm } from '../templates/contentTemplates';
import { isRecord } from './draftModel';

/** An editor's unfinished changes, and the version they were begun on (null for something new). */
export interface EditorDraft<F> {
  v: 1;
  form: F;
  basis: string | null;
}

/** The draft to keep for `form`: none while it is as it started (`start`). */
export function editorDraft<F>(form: F, start: F, basis: string | null): EditorDraft<F> | null {
  return JSON.stringify(form) === JSON.stringify(start) ? null : { v: 1, form, basis };
}

/** A draft begun on a version older than the one published now: someone published since. */
export function draftBehind(draft: EditorDraft<unknown> | null, current: string | null | undefined): boolean {
  return !!(draft?.basis && current && draft.basis !== current);
}

// ---- small guards ------------------------------------------------------------------

const isString = (x: unknown): x is string => typeof x === 'string';
const isStringOrNull = (x: unknown): x is string | null => x === null || typeof x === 'string';
const isBool = (x: unknown): x is boolean => typeof x === 'boolean';
const optional = (x: unknown, guard: (y: unknown) => boolean) => x === undefined || guard(x);
const listOf = (guard: (y: unknown) => boolean) => (x: unknown): boolean => Array.isArray(x) && x.every(guard);
const listOrNull = (guard: (y: unknown) => boolean) => (x: unknown): boolean => x === null || listOf(guard)(x);
const isStringList = listOf(isString);

/** A guard for an editor's stored draft, given one for its form; null (no draft) passes. */
function draftOf<F>(isForm: (x: unknown) => x is F) {
  return (x: unknown): x is EditorDraft<F> | null =>
    x === null || (isRecord(x) && x['v'] === 1 && isStringOrNull(x['basis']) && isForm(x['form']));
}

// ---- templates (screens/content.tsx) ------------------------------------------------

function isOutlineNode(x: unknown): boolean {
  return isRecord(x) && isString(x['id']) && isString(x['title']) && optional(x['children'], listOf(isOutlineNode));
}

const isLevel = (x: unknown) => isRecord(x) && isString(x['name']) && optional(x['display'], (d) => d === 'reference' || d === 'name' || d === 'both');
const isBookName = (x: unknown) => isRecord(x) && isString(x['book']) && isString(x['name']);
const isPassage = (x: unknown) => isRecord(x) && isString(x['ref']) && optional(x['name'], isString);

export function isTemplateForm(x: unknown): x is TemplateForm {
  if (!isRecord(x)) return false;
  return isString(x['name']) && isString(x['description']) && (x['structure'] === 'bible' || x['structure'] === 'outline')
    && listOf(isLevel)(x['levels']) && isStringOrNull(x['versification']) && listOf(isBookName)(x['books'])
    && (x['divide'] === 'books' || x['divide'] === 'chapters' || x['divide'] === 'passages')
    && listOf(isPassage)(x['passages']) && listOf(isOutlineNode)(x['outline'])
    && optional(x['bookParts'], listOf((b) => isRecord(b) && isString(b['book'])))
    && optional(x['numbering'], isString) && optional(x['goesWith'], (g) => isRecord(g) && isString(g['pattern']));
}

export type TemplateDraft = EditorDraft<TemplateForm>;
export const isTemplateDraft = draftOf(isTemplateForm);

// ---- flows (screens/config.tsx LibraryFlowEditor) -----------------------------------

/** What the flow editor changed; null is "as the flow has it". */
export interface FlowEdits {
  name: string | null;
  description: string | null;
  steps: DraftStep[] | null;
  /** Kinds of check named in the editor. */
  added: KindDef[];
}

export const NO_FLOW_EDITS: FlowEdits = { name: null, description: null, steps: null, added: [] };

const isStep = (x: unknown) => isRecord(x) && isString(x['key']) && optional(x['stepId'], isString) && isStringList(x['kindIds']) && isBool(x['checkpoint']);
const isKind = (x: unknown) => isRecord(x) && isString(x['id']) && isString(x['name']) && isString(x['description']) && isString(x['usualReviewer']);

export function isFlowEdits(x: unknown): x is FlowEdits {
  return isRecord(x) && isStringOrNull(x['name']) && isStringOrNull(x['description']) && listOrNull(isStep)(x['steps']) && listOf(isKind)(x['added']);
}

export type FlowDraft = EditorDraft<FlowEdits>;
export const isFlowDraft = draftOf(isFlowEdits);

// ---- material in a language (screens/config.tsx AppMaterialEditor) -----------------

/** What the material editor changed; null is "as it is" (or, for new material, as it starts). */
export interface MaterialEdits {
  kind: string | null;
  title: string;
  forLanguage: boolean | null;
  reviewKind: string | null;
  libraryLanguage: string | null;
  /** Sections typed into, by field id. */
  texts: Record<string, string>;
  /** Sections added in the editor. */
  extraFields: string[];
  questions: QuestionDraft[] | null;
}

export const NO_MATERIAL_EDITS: MaterialEdits = {
  kind: null, title: '', forLanguage: null, reviewKind: null, libraryLanguage: null, texts: {}, extraFields: [], questions: null
};

const isQuestion = (x: unknown) => isRecord(x) && isString(x['fieldId']) && isString(x['text'])
  && (x['type'] === 'text' || x['type'] === 'yesno' || x['type'] === 'rating') && isBool(x['required']);

export function isMaterialEdits(x: unknown): x is MaterialEdits {
  return isRecord(x) && isStringOrNull(x['kind']) && isString(x['title']) && (x['forLanguage'] === null || isBool(x['forLanguage']))
    && isStringOrNull(x['reviewKind']) && isStringOrNull(x['libraryLanguage'])
    && isRecord(x['texts']) && Object.values(x['texts']).every(isString)
    && isStringList(x['extraFields']) && listOrNull(isQuestion)(x['questions']);
}

export type MaterialDraft = EditorDraft<MaterialEdits>;
export const isMaterialDraft = draftOf(isMaterialEdits);

// ---- the library's material (screens/config.tsx LibraryMaterialEditor) ---------------

/** What the library material editor changed; null is "as the library has it". */
export interface LibraryMaterialEdits {
  kind: string | null;
  title: string | null;
  body: string | null;
  refsText: string | null;
  parts: { template: string; node: string }[] | null;
  v11n: VersificationChoice | null;
  language: string | null;
}

export const NO_LIBRARY_MATERIAL_EDITS: LibraryMaterialEdits = {
  kind: null, title: null, body: null, refsText: null, parts: null, v11n: null, language: null
};

const isPart = (x: unknown) => isRecord(x) && isString(x['template']) && isString(x['node']);
const isV11nChoice = (x: unknown) => x === null || (isRecord(x) && isString(x['key']) && isString(x['label']) && isStringOrNull(x['hash'])
  && optional(x['shared'], isRecord));

export function isLibraryMaterialEdits(x: unknown): x is LibraryMaterialEdits {
  return isRecord(x) && isStringOrNull(x['kind']) && isStringOrNull(x['title']) && isStringOrNull(x['body']) && isStringOrNull(x['refsText'])
    && listOrNull(isPart)(x['parts']) && isV11nChoice(x['v11n']) && isStringOrNull(x['language']);
}

export type LibraryMaterialDraft = EditorDraft<LibraryMaterialEdits>;
export const isLibraryMaterialDraft = draftOf(isLibraryMaterialEdits);

// ---- key words (screens/config.tsx KeyTerms, KeyTermDetail) --------------------------

/** A new rendering of a key word, or a change to it, and why. */
export interface RenderingDraft {
  rendering: string;
  context: string;
  note: string;
  hash: string | null;
}

export const EMPTY_RENDERING: RenderingDraft = { rendering: '', context: '', note: '', hash: null };

export function isRenderingDraft(x: unknown): x is RenderingDraft {
  return isRecord(x) && isString(x['rendering']) && isString(x['context']) && isString(x['note']) && isStringOrNull(x['hash']);
}

export function isTermDraft(x: unknown): x is TermDraft {
  return isRecord(x) && isString(x['term']) && isString(x['gloss']) && isString(x['rendering']) && isString(x['context']);
}
