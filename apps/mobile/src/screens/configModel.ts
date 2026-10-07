// Pure reading for the configuration screens in config.tsx (roles, reference
// material, key terms, review flows): no React, no I/O, so it is tested on
// its own (test/configModel.test.ts). Ports the demo's data.ts helpers for
// these screens (PRIVILEGE_DESC, SCOPE_LABEL, roleVisibleAt, isFiaTerm) onto
// the event log's folds, and the documents flows and reference material are
// published as in the library (docs/library.md). ORG-3, ORG-4, ORG-8,
// TERM-1..6, FLOW-1..4.
import {
  CommandError, commands, deriveFlow, deriveKinds, formatQuestionField, formatRef, languageName, materialView, parseQuestionField,
  parseRef, SEED_ROLES, unitAncestry,
  type EventSpec, type FlowDoc, type FlowSelection, type FlowStep, type KeyTermView, type KindDef, type LibraryDoc, type MaterialDoc,
  type MaterialView, type OrgState, type Privilege, type LanguageState, type QuestionSpec, type Scope
} from '@langquest-next/core';

// ---- roles (ORG-3, ORG-4) ----------------------------------------------------------

/** The demo's permission names and what each one lets someone do (data.ts PRIVILEGE_DESC). */
export const PRIVILEGE_INFO: Record<Privilege, { label: string; desc: string }> = {
  manage_structure: { label: 'Manage Org Structure', desc: 'Change org structures in their scope (languages)' },
  invite_members: { label: 'Invite Members', desc: 'Invite people in their scope' },
  manage_roles: { label: 'Manage Roles', desc: 'Create and edit roles in their scope' },
  manage_templates: { label: 'Manage Content Templates', desc: 'Make and edit content templates in their scope' },
  shape_templates: { label: 'Shape Content Templates', desc: 'Divide books into passages, name them, and publish those changes for their language' },
  manage_reference: { label: 'Manage Reference Material', desc: 'Make and edit reference material in their scope' },
  manage_flows: { label: 'Manage Review Flows', desc: 'Make review flows, mark checkpoints, and apply flows to languages' },
  manage_teams: { label: 'Manage Review Teams', desc: 'Make and edit review teams (groups) in their scope' },
  assign_work: { label: 'Assign Work', desc: 'Ask anyone in their scope to record or review a passage' },
  override_checkpoints: { label: 'Override Checkpoints', desc: 'Move a passage past a checkpoint, with the reason logged' },
  translate: { label: 'Translate', desc: 'Record and revise translations (turn off to keep, say, consultants from drafting)' },
  fill_reference: { label: 'Fill Reference Content', desc: 'Add key terms, notes, and reference content' },
  send_to_reviewers: { label: 'Ask for Reviews', desc: 'Ask teammates, or someone outside the app by link, to review' },
  review: { label: 'Review', desc: 'Give reviews, and record checks that happened outside the app' },
  view_status: { label: 'View Status', desc: 'See the map and passage records read-only in their scope' }
};

type ViewLevel = Scope['level'];
export const LEVEL_LABEL: Record<ViewLevel, string> = { org: 'Organization', language: 'Language' };

/**
 * Which home the roles screens are seen from (demo `roleViewLevel`): an
 * explicit `level` param, a language when a `languageId` came along, else the
 * highest scope this person manages.
 */
export function viewLevelFrom(params: Record<string, string>, adminScope: Scope | null): ViewLevel {
  const level = params['level'];
  if (level === 'org' || level === 'language') return level;
  if (params['languageId']) return 'language';
  return adminScope?.level === 'language' ? 'language' : 'org';
}

interface RoleRow {
  roleId: string;
  name: string;
  privileges: Privilege[];
  members: number;
  /** Ships with every organization (the five fixed roles). */
  builtIn: boolean;
  /**
   * Defined above the level it is seen from, so view only there (ORG-3).
   * Every role lives in the organization, so seen from a language every
   * role is inherited.
   */
  inherited: boolean;
}

interface RoleHolder {
  profileId: string;
  scope: Scope;
}

/** Everyone holding a role, at any scope. */
export function holdersOf(org: OrgState | null, roleId: string): RoleHolder[] {
  const out: RoleHolder[] = [];
  for (const [profileId, byScope] of Object.entries(org?.members ?? {})) {
    for (const m of Object.values(byScope)) {
      if (m.removed.value || m.roleId.value !== roleId) continue;
      out.push({ profileId, scope: m.scope });
    }
  }
  return out;
}

/** The roles as the Roles screen lists them: the shipped ones first, in their order, then the organization's own by name. */
export function roleRows(org: OrgState | null, level: ViewLevel): RoleRow[] {
  const seedOrder = SEED_ROLES.map((r) => r.roleId);
  return Object.entries(org?.roles ?? {})
    .filter(([, r]) => !r.retired && r.name.hlc !== '')
    .map(([roleId, r]) => ({
      roleId,
      name: r.name.value,
      privileges: r.privileges.value ?? [],
      members: holdersOf(org, roleId).length,
      builtIn: seedOrder.includes(roleId),
      inherited: level !== 'org'
    }))
    .sort((a, b) => {
      const ia = seedOrder.indexOf(a.roleId), ib = seedOrder.indexOf(b.roleId);
      if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return a.name.localeCompare(b.name);
    });
}

/** The organization's name, or the language's name. */
export function scopeName(scope: Scope, org: OrgState | null): string {
  if (scope.level === 'org') return org?.org?.value.name ?? 'Organization';
  return languageName(org, scope.languageId);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

// ---- review flows (FLOW-1..4) --------------------------------------------------------
// Flows are library items (docs/library.md): a language uses one version of
// one, or steps of its own (a custom flow, core `saveFlowSteps`).

interface FlowUse {
  /** What its flow is called (`deriveFlow(...).name`). */
  flowName: string;
  /** The library item and version it uses; null for its own steps or none. */
  itemId: string | null;
  docHash: string | null;
  steps: FlowStep[];
  /** The language chose a flow (or saved its own steps). */
  chosen: boolean;
}

/** The flow the language uses (FLOW-4). */
export function flowUse(state: LanguageState): FlowUse {
  const flow = deriveFlow(state);
  return { flowName: flow.name, itemId: flow.itemId, docHash: flow.docHash, steps: flow.steps, chosen: !!state.flow };
}

/** What a language's flow is called: its flow's name, or none yet. */
export function flowLabel(use: Pick<FlowUse, 'flowName' | 'chosen'>): string {
  return use.chosen ? use.flowName : 'No flow chosen yet';
}

/**
 * How to put the language's flow back after choosing another (Undo), for
 * core `restoreFlow`: the flow it had and its steps, which were never
 * removed (decision 32). A language that never chose has nothing to go
 * back to.
 */
export function flowUndoFor(state: LanguageState): { flow: FlowSelection; steps: FlowStep[] } | null {
  const flow = state.flow?.value;
  return flow ? { flow, steps: deriveFlow(state).steps } : null;
}

/** A step in the flow editor; `key` is only for the list, `stepId` is kept from the version it was opened at. */
export interface DraftStep {
  key: string;
  stepId?: string;
  kindIds: string[];
  checkpoint: boolean;
}

/** The editor's starting point: a version's steps. */
export function draftFromDoc(doc: FlowDoc): DraftStep[] {
  return doc.steps.map((s, i) => ({ key: `${s.stepId}#${i}`, stepId: s.stepId, kindIds: [...s.kindIds], checkpoint: !!s.checkpoint }));
}

/** A new flow started from the language's steps as they read now (its own steps made a library flow). */
export function draftFromLanguage(state: LanguageState): DraftStep[] {
  return deriveFlow(state).steps.map((s, i) => ({ key: `${s.id}#${i}`, kindIds: [...s.kindIds], checkpoint: s.checkpoint }));
}

const STEP_ID = /^[^/@\s]+$/;

/**
 * The flow document a draft publishes: empty steps dropped (demo `save`),
 * step ids kept where they were valid and unique, new ones `step1`,
 * `step2`, ...; and every kind its steps use, from the kinds known here, so
 * the flow travels whole (docs/library.md).
 */
export function flowDocFrom(c: { name: string; description: string; steps: DraftStep[]; kinds: KindDef[] }): FlowDoc {
  const steps = c.steps.filter((s) => s.kindIds.length > 0);
  const taken = new Set<string>();
  const kept = steps.map((s) => {
    const ok = s.stepId !== undefined && STEP_ID.test(s.stepId) && !taken.has(s.stepId);
    if (ok) taken.add(s.stepId!);
    return ok ? s.stepId! : undefined;
  });
  const ids = kept.map((id) => {
    if (id) return id;
    const fresh = nextFieldId(taken, 'step');
    taken.add(fresh);
    return fresh;
  });
  const used = [...new Set(steps.flatMap((s) => s.kindIds))];
  const kinds = used.map((id): KindDef => {
    const k = c.kinds.find((x) => x.id === id) ?? { id, name: fieldLabel(id), description: '', usualReviewer: '' };
    return {
      id: k.id, name: k.name, description: k.description ?? '', usualReviewer: k.usualReviewer ?? '',
      ...(k.withholdsContext ? { withholdsContext: true } : {}), ...(k.produces ? { produces: k.produces } : {})
    };
  });
  return {
    format: 'flow@1', name: c.name.trim(), description: c.description.trim(), kinds,
    steps: steps.map((s, i) => ({ stepId: ids[i]!, kindIds: [...s.kindIds], ...(s.checkpoint ? { checkpoint: true } : {}) })),
    deps: []
  };
}

export function draftChanged(before: DraftStep[], after: DraftStep[]): boolean {
  const shape = (d: DraftStep[]) => d.map((s) => ({ kindIds: s.kindIds, checkpoint: s.checkpoint }));
  const a = shape(before), b = shape(after);
  return a.length !== b.length || a.some((s, i) => s.checkpoint !== b[i]!.checkpoint || s.kindIds.join('|') !== b[i]!.kindIds.join('|'));
}

export function moveStep<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** A kind id from its name ("Elder Review" -> "elder_review"), unique among the kinds already known. */
export function newKindId(name: string, taken: Iterable<string>): string {
  const base = name.trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'kind';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}_${n}`)) return `${base}_${n}`;
}

// ---- reference material (ORG-8) -----------------------------------------------------

/** The kinds of reference material, with the codes the UX spec gives them (Q7). */
export const REFERENCE_KINDS: { id: string; code: string; name: string }[] = [
  { id: 'tmf', code: 'TMF', name: 'Translation Management Framework' },
  { id: 'brief', code: 'Brief', name: 'Translation Brief' },
  { id: 'tg', code: 'TG', name: 'Translation Guidelines' },
  { id: 'fia_study', code: 'FIA', name: 'FIA Study Material' },
  { id: 'key_terms', code: 'KT', name: 'Key Terms' },
  { id: 'questions', code: 'Q', name: 'Review Questions' }
];

/**
 * The language's own material, written in the app. Material for every
 * language is a library item the organization recommends (decision 62).
 */
interface ReferenceView {
  study: MaterialView[];
  /** Question sets tied to a kind of review (`scope.stepId` = kind id). */
  questionSets: MaterialView[];
  general: MaterialView[];
}

const isStudy = (m: MaterialView) => m.kind === 'fia_study' || m.templateRef === 'fia_study';

export function referenceView(state: LanguageState): ReferenceView {
  const all = Object.keys(state.materials)
    .map((id) => materialView(state, id))
    .filter((m): m is MaterialView => m !== null && m.kind !== '')
    .sort((a, b) => a.title.localeCompare(b.title));
  return {
    study: all.filter(isStudy),
    questionSets: all.filter((m) => m.kind === 'questions'),
    general: all.filter((m) => !isStudy(m) && m.kind !== 'questions')
  };
}

/** Written questions in a set: fields with text. */
export function questionCount(m: Pick<MaterialView, 'fields'>): number {
  return m.fields.filter((f) => (f.text ?? '').trim() !== '').length;
}

export function questionCountLabel(n: number): string {
  return n === 0 ? 'No questions yet' : plural(n, 'question');
}

/** The kind of review a question set belongs to, by name; null for an older set tied to none. */
export function setKindName(kinds: KindDef[], m: Pick<MaterialView, 'scope'>): string | null {
  const id = m.scope.stepId;
  if (!id) return null;
  return kinds.find((k) => k.id === id)?.name ?? id;
}

export interface QuestionDraft {
  fieldId: string;
  text: string;
  type: QuestionSpec['type'];
  required: boolean;
}

export function questionDrafts(m: Pick<MaterialView, 'fields'> | null): QuestionDraft[] {
  return (m?.fields ?? [])
    .filter((f) => (f.text ?? '').trim() !== '')
    .map((f) => {
      const [type, required, text] = parseQuestionField(f.text ?? '');
      return { fieldId: f.fieldId, text, type, required };
    });
}

/** The next free field id for a new question or section: q1, q2, ... */
export function nextFieldId(taken: Iterable<string>, prefix = 'q'): string {
  const used = new Set(taken);
  for (let n = 1; ; n++) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

/** A field id as a label: "key_ideas" -> "Key ideas". */
export function fieldLabel(fieldId: string): string {
  const s = fieldId.replace(/[_-]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : fieldId;
}

/** A reference kind's name ("Translation Guidelines"), or its id as words for a partner's own. */
export function referenceKindName(kind: string): string {
  // Notes for translators are library material only (docs/reference-material.md).
  if (kind === 'note') return 'Note for translators';
  return REFERENCE_KINDS.find((k) => k.id === kind)?.name ?? fieldLabel(kind);
}

// ---- reference material in the library (docs/library.md) ----------------------------

/** The library item an in-app material is published as: the same one every time, on any phone. */
export function materialItemId(materialId: string): string {
  return `m.${materialId.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}`.slice(0, 120);
}

/**
 * The `material@1` document an in-app material publishes: its kind, title
 * and filled fields (a lone `body` field is the body), a question set's
 * questions and kind of review, and a link to its passage or part when it
 * is scoped to one of a template's units.
 */
export function materialDocFrom(m: Pick<MaterialView, 'kind' | 'title' | 'scope' | 'fields'>, label: (fieldId: string) => string): MaterialDoc {
  const filled = m.fields.filter((f) => (f.text ?? '').trim() !== '');
  const isQuestions = m.kind === 'questions';
  const body = !isQuestions ? filled.find((f) => f.fieldId === 'body')?.text?.trim() : undefined;
  const fields = filled.filter((f) => isQuestions || f.fieldId !== 'body').map((f) => ({ id: f.fieldId, label: label(f.fieldId), text: f.text!.trim() }));
  const unit = m.scope.unitId;
  const slash = unit ? unit.indexOf('/') : -1;
  return {
    format: 'material@1', kind: m.kind, title: m.title,
    ...(body ? { body } : {}),
    ...(fields.length ? { fields } : {}),
    ...(isQuestions ? { questions: questionsOf({ fields: filled }) } : {}),
    ...(isQuestions && m.scope.stepId ? { reviewKindId: m.scope.stepId } : {}),
    ...(unit && slash > 0 ? { links: [{ template: unit.slice(0, slash), node: unit.slice(slash + 1) }] } : {}),
    deps: []
  };
}

function questionsOf(m: { fields: { fieldId: string; text?: string }[] }): QuestionSpec[] {
  return m.fields.filter((f) => (f.text ?? '').trim() !== '').map((f) => {
    const [type, required, text] = parseQuestionField(f.text!.trim());
    return { id: f.fieldId, text, type, ...(required ? { required: true } : {}) };
  });
}

/** A library question set's questions: its `questions`, else its fields read as questions. */
export function libraryQuestions(doc: MaterialDoc): QuestionSpec[] {
  if (doc.questions?.length) return doc.questions;
  return questionsOf({ fields: (doc.fields ?? []).map((f) => ({ fieldId: f.id, text: f.text })) });
}

/**
 * "Use in reviews": a library question set copied into the language's
 * in-app question set for its kind of review (core `questionsForKind` reads
 * those), under an id taken from the item so doing it again updates the
 * same set. Undo puts the fields back as they were (empty for a new set, so
 * reviewers stop seeing them).
 */
export function questionSetToReviews(state: LanguageState, c: { commandId: string; itemId: string; doc: MaterialDoc }): { materialId: string; specs: EventSpec[]; undo: EventSpec[] } {
  const kindId = c.doc.reviewKindId;
  if (!kindId) throw new CommandError('This question set is not for a kind of review.');
  const questions = libraryQuestions(c.doc);
  if (questions.length === 0) throw new CommandError('This question set has no questions.');
  const materialId = `qs.${c.itemId}`;
  const cmd = commands(state);
  const used = new Set<string>();
  const fields = questions.map((q) => {
    const fieldId = q.id && !used.has(q.id) ? q.id : nextFieldId(used);
    used.add(fieldId);
    return { fieldId, text: formatQuestionField({ text: q.text, type: q.type, ...(q.required ? { required: true } : {}) }) };
  });
  const existing = state.materials[materialId];
  const before = (fieldId: string) => existing?.fields[fieldId]?.value.text ?? '';
  const cleared = Object.keys(existing?.fields ?? {}).filter((id) => !used.has(id) && before(id) !== '').map((fieldId) => ({ fieldId, text: '' }));
  const specs = existing
    ? cmd.setMaterialFields({ commandId: c.commandId, materialId, fields: [...fields, ...cleared] })
    : cmd.defineMaterial({ commandId: c.commandId, materialId, kind: 'questions', title: c.doc.title, scope: { stepId: kindId }, fields });
  const undo = cmd.setMaterialFields({
    commandId: `${c.commandId}-undo`, materialId,
    fields: [...fields, ...cleared].map((f) => ({ fieldId: f.fieldId, text: before(f.fieldId) }))
  });
  return { materialId, specs, undo };
}

/** Verse references typed one per line (or `;` apart): the readable ones, normalised, and the rest. */
export function parseRefLinks(text: string): { refs: string[]; bad: string[] } {
  const refs: string[] = [];
  const bad: string[] = [];
  for (const part of text.split(/[\n;]+/).map((s) => s.trim()).filter(Boolean)) {
    const r = parseRef(part.toUpperCase().replace(/^([A-Z0-9]{3})\s*/, '$1 '));
    if (r) { if (!refs.includes(formatRef(r))) refs.push(formatRef(r)); } else bad.push(part);
  }
  return { refs, bad };
}

/** What a library material is, in one line under its name; null while its document loads. */
export function libraryMaterialLine(doc: LibraryDoc | null, versificationName: string | null, kinds: KindDef[]): { type: 'study' | 'questions' | 'material'; line: string } | null {
  if (!doc) return null;
  const v = versificationName ? ` · ${versificationName}` : '';
  switch (doc.format) {
    case 'study@1': return { type: 'study', line: `Study guide · ${doc.ref} · 1 passage${v}` };
    case 'collection@1': return { type: 'study', line: `Study guides · ${plural(doc.entries.length, 'passage')}${v}` };
    case 'material@1': {
      if (doc.kind === 'questions') {
        const kind = doc.reviewKindId ? kinds.find((k) => k.id === doc.reviewKindId)?.name ?? fieldLabel(doc.reviewKindId) : 'Not tied to a kind of review';
        return { type: 'questions', line: `Question set · ${kind} · ${questionCountLabel(libraryQuestions(doc).length)}` };
      }
      return { type: 'material', line: referenceKindName(doc.kind) };
    }
    case 'study@2': {
      const where = doc.ref ?? (doc.links?.length ? plural(doc.links.length, 'place') : 'Not placed yet');
      return { type: 'study', line: `Study guide · ${where} · ${plural(doc.steps.length, 'step')}${doc.ref ? v : ''}` };
    }
    case 'source@1': return { type: 'material', line: `Bible · ${doc.abbreviation} · ${doc.language}` };
    default: return { type: 'material', line: 'Not reference material' };
  }
}

// ---- key terms (TERM-1..6) ------------------------------------------------------------

/**
 * A term from FIA's shared list (TERM-1, demo `isFiaTerm`). The log has no
 * source field for a term yet, so FIA terms are known by their id prefix
 * (`fia:`), the convention for terms imported from FIA's glossary.
 */
export function isFiaTerm(t: Pick<KeyTermView, 'termId'>): boolean {
  return /^fia[:/-]/i.test(t.termId);
}

/** Search on the term and its meaning (TERM-2). */
export function matchesTerm(t: Pick<KeyTermView, 'term' | 'gloss'>, q: string): boolean {
  const needle = q.trim().toLowerCase();
  return !needle || `${t.term} ${t.gloss}`.toLowerCase().includes(needle);
}

/** The words a term is found by in a text: "Word (Logos)" -> ["word", "logos"]. */
export function termWords(term: string): string[] {
  return term
    .toLowerCase()
    .split(/[()\/,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

/**
 * "In this passage" (TERM-2): terms scoped to the passage or a part it
 * belongs to, and terms whose words appear in its source text.
 */
export function termsInPassage(state: LanguageState, terms: KeyTermView[], unitId: string, source: string | null): Set<string> {
  const ancestors = unitAncestry(state, unitId);
  const text = source?.toLowerCase() ?? '';
  const out = new Set<string>();
  for (const t of terms) {
    if (t.unitScope.some((u) => ancestors.has(u))) { out.add(t.termId); continue; }
    if (text && termWords(t.term).some((w) => new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(text))) out.add(t.termId);
  }
  return out;
}

/** Kinds known to the organization, for the flow editor's picker. */
export function allKinds(state: LanguageState): KindDef[] {
  return deriveKinds(state);
}
